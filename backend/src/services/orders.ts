import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import {
  badRequest,
  insufficientStock,
  notFound,
  validationError,
} from "../lib/errors.js";
import {
  DELIVERED_ORDER_STATUS,
  INITIAL_ORDER_STATUS,
  buildOrderTimeline,
  isOrderStatus,
} from "../lib/order-status.js";
import { decimalToNumber } from "../lib/serialize.js";
import type { CreatePedidoInput } from "../lib/validation.js";
import { env } from "../env.js";
import { getPixConfig } from "./payment-config.js";
import { buildPixPayload } from "./pix.js";
import { quoteShipping } from "./shipping/index.js";
import type { ShippingItem } from "./shipping/types.js";
import { localShippingCache, localShippingRepository } from "../shipping-local/application/container.js";
import { quoteLocalShipping } from "../shipping-local/application/quote.service.js";
import {
  findPedidoByQuoteId,
  resolveQuoteSelection,
} from "../shipping-local/application/quote-validation.service.js";

/** Token publico de rastreio: criptograficamente seguro e nao derivado do ID. */
export function generateTrackingToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Texto do prazo estimado do motor proprio (null quando nao configurado). */
function formatLocalDeadline(minDays: number | null, maxDays: number | null): string | null {
  if (minDays === null && maxDays === null) return null;
  if (minDays !== null && maxDays !== null && minDays === maxDays) {
    return `${minDays} dia(s) util(eis)`;
  }
  if (minDays !== null && maxDays !== null) return `${minDays} a ${maxDays} dias uteis`;
  return `${minDays ?? maxDays} dia(s) util(eis)`;
}

export type PedidoSnapshotItem = {
  id: string;
  nome: string;
  quantidade: number;
  preco: number;
  peso_unitario: number;
};

export type PedidoPublic = {
  id: number;
  token_rastreio_unico: string;
  status_atual: string;
  cliente_nome: string;
  cliente_whatsapp: string;
  endereco_completo: unknown;
  produtos_carrinho: PedidoSnapshotItem[];
  frete_escolhido_nome: string | null;
  frete_escolhido_valor: number | null;
  frete_escolhido_prazo: string | null;
  frete_zona_id: string | null;
  frete_regra_id: string | null;
  frete_metodo_id: string | null;
  frete_metodo_codigo: string | null;
  frete_quote_id: string | null;
  frete_prazo_dias: number | null;
  frete_estimado: boolean;
  frete_prazo_min_dias: number | null;
  frete_prazo_max_dias: number | null;
  metodo_pagamento: string | null;
  pagamento_status: string;
  pagamento_payload: string | null;
  pagamento_expira_em: string | null;
  recebido_por: string | null;
  data_entrega: string | null;
  criado_em: string;
  subtotal: number;
  total: number;
  timeline: ReturnType<typeof buildOrderTimeline>;
};

function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `${digits.slice(0, 4)}****${digits.slice(-2)}`;
}

function toPublic(pedido: {
  id: number;
  tokenRastreioUnico: string;
  statusAtual: string;
  clienteNome: string;
  clienteWhatsapp: string;
  enderecoCompleto: Prisma.JsonValue;
  produtosCarrinho: Prisma.JsonValue;
  freteEscolhidoNome: string | null;
  freteEscolhidoValor: Prisma.Decimal | null;
  freteEscolhidoPrazo: string | null;
  fretePagoDireto: boolean;
  freteZonaId: string | null;
  freteRegraId: string | null;
  freteMetodoId: string | null;
  freteMetodoCodigo: string | null;
  freteQuoteId: string | null;
  fretePrazoDias: number | null;
  freteEstimado: boolean;
  fretePrazoMinDias: number | null;
  fretePrazoMaxDias: number | null;
  metodoPagamento: string | null;
  pagamentoStatus: string;
  pagamentoPayload: string | null;
  pagamentoExpiraEm: Date | null;
  recebidoPor: string | null;
  dataEntrega: Date | null;
  criadoEm: Date;
}): PedidoPublic {
  const items = Array.isArray(pedido.produtosCarrinho)
    ? (pedido.produtosCarrinho as unknown as PedidoSnapshotItem[])
    : [];

  const subtotal = items.reduce((total, item) => total + Number(item.preco) * Number(item.quantidade), 0);
  const frete = pedido.freteEscolhidoValor === null ? 0 : decimalToNumber(pedido.freteEscolhidoValor);
  // Frete pago direto a transportadora (Correios) NAO entra no total da loja.
  const freteIncluidoNoTotal = pedido.fretePagoDireto ? 0 : frete;

  return {
    id: pedido.id,
    token_rastreio_unico: pedido.tokenRastreioUnico,
    status_atual: pedido.statusAtual,
    cliente_nome: pedido.clienteNome,
    cliente_whatsapp: maskPhone(pedido.clienteWhatsapp),
    endereco_completo: pedido.enderecoCompleto,
    produtos_carrinho: items,
    frete_escolhido_nome: pedido.freteEscolhidoNome,
    frete_escolhido_valor: pedido.freteEscolhidoValor === null ? null : frete,
    frete_escolhido_prazo: pedido.freteEscolhidoPrazo,
    frete_zona_id: pedido.freteZonaId,
    frete_regra_id: pedido.freteRegraId,
    frete_metodo_id: pedido.freteMetodoId,
    frete_metodo_codigo: pedido.freteMetodoCodigo,
    frete_quote_id: pedido.freteQuoteId,
    frete_prazo_dias: pedido.fretePrazoDias,
    frete_estimado: pedido.freteEstimado,
    frete_prazo_min_dias: pedido.fretePrazoMinDias,
    frete_prazo_max_dias: pedido.fretePrazoMaxDias,
    metodo_pagamento: pedido.metodoPagamento,
    pagamento_status: pedido.pagamentoStatus,
    pagamento_payload: pedido.pagamentoPayload,
    pagamento_expira_em: pedido.pagamentoExpiraEm ? pedido.pagamentoExpiraEm.toISOString() : null,
    recebido_por: pedido.recebidoPor,
    data_entrega: pedido.dataEntrega ? pedido.dataEntrega.toISOString() : null,
    criado_em: pedido.criadoEm.toISOString(),
    subtotal: Math.round(subtotal * 100) / 100,
    total: Math.round((subtotal + freteIncluidoNoTotal) * 100) / 100,
    timeline: buildOrderTimeline(pedido.statusAtual),
  };
}

/**
 * Cria um pedido Guest Checkout.
 *
 * Seguranca:
 *  - o cliente NAO informa id, token nem status: tudo e gerado no servidor;
 *  - precos e pesos sao RECALCULADOS a partir do catalogo (nunca confiamos no
 *    frontend);
 *  - a modalidade de frete e re-cotada e validada no servidor;
 *  - pedido + baixa de estoque acontecem dentro de uma transacao PostgreSQL.
 */
export async function createGuestPedido(input: CreatePedidoInput): Promise<PedidoPublic> {
  const productIds = input.produtos.map((item) => item.id);

  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, price: true, weightGrams: true, hasShipping: true, active: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  // Idempotencia: se a mesma cotacao ja gerou um pedido, devolve o mesmo
  // (protege contra duplo clique sem criar pedido duplicado).
  if (input.frete?.quoteId) {
    const existingId = await findPedidoByQuoteId(input.frete.quoteId);
    if (existingId) {
      const existing = await prisma.pedido.findUnique({ where: { id: existingId } });
      if (existing) return toPublic(existing);
    }
  }

  const items: PedidoSnapshotItem[] = [];
  for (const item of input.produtos) {
    const product = byId.get(item.id);
    if (!product) {
      throw validationError(`Produto não encontrado: ${item.id}.`);
    }
    if (!product.active) {
      throw validationError(`Produto indisponível: ${product.name}.`);
    }
    const quantity = Math.floor(item.quantidade);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw validationError("Quantidade invalida.");
    }

    const price = decimalToNumber(product.price);
    const weightKg = product.weightGrams && product.weightGrams > 0
      ? product.weightGrams / 1000
      : Math.max(0, Number(item.peso_unitario) || 0);

    items.push({
      id: product.id,
      nome: product.name,
      quantidade: quantity,
      preco: price,
      peso_unitario: Math.round(weightKg * 1000) / 1000,
    });
  }

  const subtotalPedido = items.reduce((total, item) => total + item.preco * item.quantidade, 0);

  // ---- Re-cota o frete no servidor (nunca confia no valor do frontend) -----
  // Tipo normalizado usado tanto pelo motor proprio quanto pelo legado.
  type ResolvedShipping = {
    nome: string;
    valor: number;
    prazo: string | null;
    pagoDireto: boolean;
    incluirNoTotal: boolean;
    zoneId: string | null;
    ruleId: string | null;
    isEstimate: boolean;
    minDays: number | null;
    maxDays: number | null;
    methodId: string | null;
    methodCode: string | null;
    deliveryDays: number | null;
    quoteId: string | null;
  };

  const shippingItems: ShippingItem[] = items.map((item) => ({
    id: item.id,
    nome: item.nome,
    quantidade: item.quantidade,
    peso_unitario: item.peso_unitario,
  }));

  const localSettings = await localShippingRepository.getSettings().catch(() => null);
  let resolved: ResolvedShipping;

  // Peso recalculado no servidor (usado para revalidar a cotacao).
  const totalWeightGrams =
    items.reduce((total, item) => {
      const product = byId.get(item.id);
      if (!product?.hasShipping) return total;
      return total + (product.weightGrams ?? 0) * item.quantidade;
    }, 0) + (localSettings?.packagePaddingGrams ?? 0);

  if (localSettings?.enabled) {
    // Shipping Engine PROPRIO: o preco vem SEMPRE da cotacao persistida.
    if (input.frete?.quoteId) {
      const selection = await resolveQuoteSelection({
        quoteId: input.frete.quoteId,
        shippingMethodId: input.frete.methodId ?? input.frete.id ?? "",
        sessionId: input.sessionId ?? null,
        subtotal: subtotalPedido,
        totalWeightGrams,
      });
      resolved = {
        nome: selection.methodName,
        valor: selection.price,
        prazo:
          selection.deliveryDays !== null
            ? formatLocalDeadline(selection.deliveryDays, selection.deliveryDays)
            : null,
        pagoDireto: false,
        incluirNoTotal: true,
        zoneId: selection.zoneId,
        ruleId: selection.ruleId,
        isEstimate: true,
        minDays: selection.deliveryDays,
        maxDays: selection.deliveryDays,
        methodId: selection.methodId,
        methodCode: selection.methodCode,
        deliveryDays: selection.deliveryDays,
        quoteId: selection.quoteId,
      };
    } else {
      // Cliente antigo (sem quoteId): recota e escolhe a modalidade pelo id.
      const localQuote = await quoteLocalShipping(
        {
          cep: input.endereco.cep,
          items: items.map((item) => ({ productId: item.id, quantity: item.quantidade })),
          sessionId: input.sessionId ?? null,
        },
        { repository: localShippingRepository, cache: localShippingCache },
      );
      const chosenOption = localQuote.options.find(
        (option) => option.methodId === (input.frete?.methodId ?? input.frete?.id),
      );
      if (!chosenOption) {
        throw validationError("Selecione uma modalidade de frete válida para o CEP informado.");
      }
      resolved = {
        nome: chosenOption.name,
        valor: chosenOption.price,
        prazo:
          chosenOption.deliveryDays !== null
            ? formatLocalDeadline(chosenOption.deliveryDays, chosenOption.deliveryDays)
            : null,
        pagoDireto: false,
        incluirNoTotal: true,
        zoneId: chosenOption.zoneId,
        ruleId: chosenOption.ruleId,
        isEstimate: true,
        minDays: chosenOption.deliveryDays,
        maxDays: chosenOption.deliveryDays,
        methodId: chosenOption.methodId,
        methodCode: chosenOption.code,
        deliveryDays: chosenOption.deliveryDays,
        quoteId: localQuote.quoteId,
      };
    }
  } else {
    const quote = await quoteShipping({ cep: input.endereco.cep, items: shippingItems });
    const chosen = input.frete?.id
      ? quote.options.find((option) => option.id === input.frete?.id) ?? null
      : null;

    if (!chosen) {
      throw validationError("Selecione uma modalidade de frete válida para o CEP informado.");
    }

    resolved = {
      nome: chosen.nome,
      valor: chosen.valor,
      prazo: chosen.prazo,
      pagoDireto: chosen.pagoDireto,
      incluirNoTotal: chosen.incluirNoTotal,
      zoneId: null,
      ruleId: null,
      isEstimate: false,
      minDays: null,
      maxDays: null,
      methodId: null,
      methodCode: null,
      deliveryDays: null,
      quoteId: null,
    };
  }

  const endereco = {
    cep: input.endereco.cep,
    logradouro: input.endereco.logradouro,
    numero: input.endereco.numero,
    complemento: input.endereco.complemento || null,
    bairro: input.endereco.bairro,
    cidade: input.endereco.cidade,
    uf: input.endereco.uf,
  };

  const token = generateTrackingToken();

  // ---- Pagamento: NUNCA inventa confirmacao. PIX gera o BR Code real a partir
  // da chave configurada pelo administrador; o status permanece "Pendente"
  // ate confirmacao real (banco/webhook) ou acao do administrador.
  const metodoPagamento = input.pagamento?.metodo ?? "COMBINAR";
  let pagamentoPayload: string | null = null;
  let pagamentoExpiraEm: Date | null = null;

  const freteCobrado = resolved.incluirNoTotal ? resolved.valor : 0;
  const totalPedido = Math.round((subtotalPedido + freteCobrado) * 100) / 100;

  if (metodoPagamento === "PIX") {
    const pix = await getPixConfig();
    if (!pix.status.enabled) {
      throw validationError("PIX indisponível no momento.");
    }
    if (!pix.status.configured || !pix.key || !pix.holder || !pix.city) {
      throw validationError(`PIX ainda não configurado pela loja (${pix.status.missing.join(", ")}).`);
    }
    pagamentoPayload = buildPixPayload({
      key: pix.key,
      merchantName: pix.holder,
      merchantCity: pix.city,
      amount: totalPedido,
      txid: token.slice(0, 20),
    });
    pagamentoExpiraEm = new Date(Date.now() + env.PAYMENT_EXPIRES_MINUTES * 60 * 1000);
  }

  let pedido: Parameters<typeof toPublic>[0];
  try {
    pedido = await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const affected = await tx.$executeRaw`
          UPDATE "products"
             SET "stock" = "stock" - ${item.quantidade},
                 "reservedStock" = "reservedStock" + ${item.quantidade},
                 "updatedAt" = now()
           WHERE "id" = ${item.id}
             AND "active" = true
             AND "stock" >= ${item.quantidade}
        `;
        if (affected === 0) {
          throw insufficientStock(`Estoque insuficiente para ${item.nome}.`);
        }
      }

      // Consome a cotacao dentro da transacao: so pode ser usada uma vez.
      if (resolved.quoteId) {
        await tx.shippingQuote.update({ where: { id: resolved.quoteId }, data: { usedAt: new Date() } });
      }

      return tx.pedido.create({
        data: {
          tokenRastreioUnico: token,
          clienteNome: input.cliente.nome,
          clienteWhatsapp: input.cliente.whatsapp,
          clienteEmail: input.cliente.email || null,
          enderecoCompleto: endereco,
          produtosCarrinho: items as unknown as Prisma.InputJsonValue,
          freteEscolhidoNome: resolved.nome,
          freteEscolhidoValor: new Prisma.Decimal(resolved.valor.toFixed(2)),
          freteEscolhidoPrazo: resolved.prazo,
          fretePagoDireto: resolved.pagoDireto,
          freteZonaId: resolved.zoneId,
          freteRegraId: resolved.ruleId,
          freteMetodoId: resolved.methodId,
          freteMetodoCodigo: resolved.methodCode,
          freteQuoteId: resolved.quoteId,
          fretePrazoDias: resolved.deliveryDays,
          freteEstimado: resolved.isEstimate,
          fretePrazoMinDias: resolved.minDays,
          fretePrazoMaxDias: resolved.maxDays,
          statusAtual: INITIAL_ORDER_STATUS,
          metodoPagamento,
          pagamentoStatus: "Pendente",
          pagamentoPayload,
          pagamentoExpiraEm,
        },
      });
    });
  } catch (error) {
    // Corrida de duplo clique: a constraint unica de `frete_quote_id` rejeita a
    // segunda gravacao; devolvemos o pedido ja criado (idempotente).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" && resolved.quoteId) {
      const existingId = await findPedidoByQuoteId(resolved.quoteId);
      if (existingId) {
        const existing = await prisma.pedido.findUnique({ where: { id: existingId } });
        if (existing) return toPublic(existing);
      }
    }
    throw error;
  }

  return toPublic(pedido);
}

/** Busca publica por token de rastreio (query parametrizada via Prisma). */
export async function getPedidoByToken(token: string): Promise<PedidoPublic> {
  const clean = token.trim();
  if (!clean || clean.length < 10) throw notFound("Pedido não encontrado.");

  const pedido = await prisma.pedido.findUnique({ where: { tokenRastreioUnico: clean } });
  if (!pedido) throw notFound("Pedido não encontrado.");
  return toPublic(pedido);
}

export type AdminListFilters = {
  status?: string;
  search?: string;
  page: number;
  perPage: number;
};

/** Listagem administrativa de pedidos. */
export async function listPedidos(filters: AdminListFilters) {
  const skip = (filters.page - 1) * filters.perPage;
  const where: Prisma.PedidoWhereInput = {
    ...(filters.status && isOrderStatus(filters.status) ? { statusAtual: filters.status } : {}),
    ...(filters.search
      ? {
          OR: [
            { clienteNome: { contains: filters.search, mode: "insensitive" } },
            { clienteWhatsapp: { contains: filters.search } },
            { tokenRastreioUnico: { contains: filters.search } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.pedido.findMany({ where, orderBy: { criadoEm: "desc" }, skip, take: filters.perPage }),
    prisma.pedido.count({ where }),
  ]);

  return {
    data: items.map(toPublic),
    total,
    page: filters.page,
    perPage: filters.perPage,
  };
}

export async function getPedidoById(id: number): Promise<PedidoPublic> {
  const pedido = await prisma.pedido.findUnique({ where: { id } });
  if (!pedido) throw notFound("Pedido não encontrado.");
  return toPublic(pedido);
}

/**
 * Atualiza o status pelo painel.
 *
 * Regra obrigatoria: "Entregue" exige `recebido_por` e grava `data_entrega`.
 * Ao sair de "Entregue", os campos de entrega sao limpos de forma consistente.
 */
export async function updatePedidoStatus(
  id: number,
  input: { status_atual: string; recebido_por?: string },
): Promise<PedidoPublic> {
  if (!Number.isInteger(id) || id <= 0) throw badRequest("Pedido invalido.");
  if (!isOrderStatus(input.status_atual)) throw validationError("Status inválido.");

  const existing = await prisma.pedido.findUnique({ where: { id } });
  if (!existing) throw notFound("Pedido não encontrado.");

  const delivered = input.status_atual === DELIVERED_ORDER_STATUS;
  const recebidoPor = (input.recebido_por ?? "").trim();

  if (delivered && recebidoPor.length < 2) {
    throw validationError("Informe quem recebeu o pedido para marcar como Entregue.");
  }

  const updated = await prisma.pedido.update({
    where: { id },
    data: {
      statusAtual: input.status_atual,
      recebidoPor: delivered ? recebidoPor : null,
      dataEntrega: delivered ? new Date() : null,
    },
  });

  return toPublic(updated);
}
