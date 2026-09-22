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
import { quoteShipping } from "./shipping/index.js";
import type { ShippingItem } from "./shipping/types.js";

/** Token publico de rastreio: criptograficamente seguro e nao derivado do ID. */
export function generateTrackingToken(): string {
  return randomBytes(32).toString("base64url");
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
    select: { id: true, name: true, price: true, weightGrams: true, active: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

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

  // Re-cota o frete no servidor e valida a modalidade escolhida.
  const shippingItems: ShippingItem[] = items.map((item) => ({
    id: item.id,
    nome: item.nome,
    quantidade: item.quantidade,
    peso_unitario: item.peso_unitario,
  }));
  const quote = await quoteShipping({ cep: input.endereco.cep, items: shippingItems });

  const chosen = input.frete?.id
    ? quote.options.find((option) => option.id === input.frete?.id) ?? null
    : null;

  if (!chosen) {
    throw validationError("Selecione uma modalidade de frete válida para o CEP informado.");
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

  const pedido = await prisma.$transaction(async (tx) => {
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

    return tx.pedido.create({
      data: {
        tokenRastreioUnico: token,
        clienteNome: input.cliente.nome,
        clienteWhatsapp: input.cliente.whatsapp,
        clienteEmail: input.cliente.email || null,
        enderecoCompleto: endereco,
        produtosCarrinho: items as unknown as Prisma.InputJsonValue,
        freteEscolhidoNome: chosen.nome,
        freteEscolhidoValor: new Prisma.Decimal(chosen.valor.toFixed(2)),
        freteEscolhidoPrazo: chosen.prazo,
        fretePagoDireto: chosen.pagoDireto,
        statusAtual: INITIAL_ORDER_STATUS,
      },
    });
  });

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
