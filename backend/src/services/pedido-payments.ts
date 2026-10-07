import type { Prisma, PaymentStatus } from "@prisma/client";
import { prisma } from "../db.js";
import { badRequest, notFound, paymentError, validationError } from "../lib/errors.js";
import { decimalToNumber } from "../lib/serialize.js";
import { INITIAL_ORDER_STATUS, isOrderStatus } from "../lib/order-status.js";
import { env } from "../env.js";
import { getMercadoPagoStatus } from "./mercadopago/config.js";
import {
  createBoletoPayment,
  createCardPayment,
  createPixPayment,
  getMercadoPagoPayment,
  notificationUrl,
  type MercadoPagoPayer,
  type MercadoPagoPaymentResult,
} from "./mercadopago/index.js";
import { mapPedidoPaymentLabel } from "./mercadopago/status-map.js";
import { assertMercadoPagoReady, toPaymentAppError } from "./mercadopago/errors.js";

/**
 * Pagamentos do pedido Guest via Mercado Pago.
 *
 * Regras:
 *  - o VALOR e sempre recalculado no servidor a partir do snapshot do pedido;
 *  - nunca marcamos o pedido como pago sem confirmacao real do gateway;
 *  - idempotencia em todos os pontos (chave unica + transicoes de status).
 */

export type PedidoPaymentMethod = "PIX" | "CREDIT_CARD" | "BOLETO";
export type CheckoutPaymentMethod = PedidoPaymentMethod | "COMBINAR";

export type CardTokenInput = {
  token: string;
  paymentMethodId?: string;
  issuerId?: string;
  installments?: number;
};

export type PayerInput = {
  email?: string;
  docType?: "CPF" | "CNPJ";
  docNumber?: string;
};

type PedidoRow = {
  id: number;
  produtosCarrinho: Prisma.JsonValue;
  freteEscolhidoValor: Prisma.Decimal | null;
  fretePagoDireto: boolean;
  pagamentoStatus: string;
  statusAtual: string;
};

type SnapshotItem = { id?: string; quantidade?: number; preco?: number };

/** Recalcula o total do pedido a partir do snapshot gravado (nunca do frontend). */
export function computePedidoAmount(pedido: Pick<PedidoRow, "produtosCarrinho" | "freteEscolhidoValor" | "fretePagoDireto">): number {
  const items = Array.isArray(pedido.produtosCarrinho) ? (pedido.produtosCarrinho as unknown as SnapshotItem[]) : [];
  const subtotal = items.reduce((total, item) => {
    const price = Number(item?.preco ?? 0);
    const quantity = Number(item?.quantidade ?? 0);
    if (!Number.isFinite(price) || !Number.isFinite(quantity)) return total;
    return total + price * quantity;
  }, 0);
  const frete = pedido.freteEscolhidoValor === null ? 0 : decimalToNumber(pedido.freteEscolhidoValor);
  const freteIncluido = pedido.fretePagoDireto ? 0 : frete;
  return Math.round((subtotal + freteIncluido) * 100) / 100;
}

function payerFromPedido(
  pedido: { clienteEmail: string | null; clienteNome: string; clienteWhatsapp: string },
  override?: PayerInput,
): MercadoPagoPayer {
  const email = (override?.email || pedido.clienteEmail || "").trim();
  const parts = pedido.clienteNome.trim().split(/\s+/);
  const firstName = parts[0] || undefined;
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : undefined;
  return {
    // O Mercado Pago exige um e-mail; quando o cliente nao informa usamos um
    // endereco tecnico da loja (nao e um segredo).
    email: email || "comprador@mastore.local",
    firstName,
    lastName,
    docType: override?.docType,
    docNumber: override?.docNumber,
  };
}

export type StartPedidoPaymentInput = {
  metodo: PedidoPaymentMethod;
  card?: CardTokenInput;
  payer?: PayerInput;
  idempotencyKey: string;
};

/**
 * Cria a cobranca no Mercado Pago para um pedido Guest existente e grava a
 * referencia/status no banco. Nunca cria duas cobrancas para a mesma tentativa.
 */
export async function startPedidoPayment(pedidoId: number, input: StartPedidoPaymentInput) {
  assertMercadoPagoReady();

  const pedido = await prisma.pedido.findUnique({ where: { id: pedidoId } });
  if (!pedido) throw notFound("Pedido nao encontrado.");
  if (pedido.pagamentoStatus === "Pago") throw badRequest("Este pedido ja esta pago.");

  const amount = computePedidoAmount(pedido);
  if (amount <= 0) throw validationError("O valor do pedido e invalido para pagamento.");

  const payer = payerFromPedido(pedido, input.payer);

  if (input.metodo === "BOLETO" && !payer.docNumber) {
    throw validationError("Informe o CPF/CNPJ para gerar o boleto.");
  }
  if (input.metodo === "CREDIT_CARD" && !input.card?.token) {
    throw validationError("Os dados do cartao nao foram tokenizados corretamente.");
  }

  const common = {
    amount,
    description: `Pedido MA STORE #${pedido.id}`,
    externalReference: pedido.tokenRastreioUnico,
    idempotencyKey: input.idempotencyKey,
    payer,
    notificationUrl: notificationUrl(),
  };

  let result: MercadoPagoPaymentResult;
  try {
    if (input.metodo === "PIX") {
      result = await createPixPayment(common);
    } else if (input.metodo === "BOLETO") {
      result = await createBoletoPayment(common);
    } else {
      result = await createCardPayment({
        ...common,
        token: input.card!.token,
        paymentMethodId: input.card!.paymentMethodId,
        issuerId: input.card!.issuerId,
        installments: input.card!.installments,
      });
    }
  } catch (error) {
    // Registra a tentativa sem expor segredo e devolve erro seguro.
    await prisma.pedido
      .update({
        where: { id: pedido.id },
        data: {
          pagamentoStatus: "Falha",
          pagamentoProvider: "mercadopago",
          pagamentoIdempotencyKey: input.idempotencyKey,
        },
      })
      .catch(() => undefined);
    throw toPaymentAppError(error);
  }

  await applyPedidoPaymentResult(pedido.id, result, { source: "checkout" });
  return { amount, result };
}

/** Persiste o resultado do gateway no pedido (idempotente). */
export async function applyPedidoPaymentResult(
  pedidoId: number,
  result: MercadoPagoPaymentResult,
  meta: { source: "checkout" | "webhook"; raw?: unknown } = { source: "webhook" },
) {
  const outcome = result.status;
  const label = mapPedidoPaymentLabel(outcome);

  const updated = await prisma.$transaction(async (tx) => {
    const pedido = await tx.pedido.findUnique({ where: { id: pedidoId } });
    if (!pedido) throw notFound("Pedido nao encontrado.");

    const alreadyFinal = ["Pago", "Recusado", "Cancelado", "Expirado", "Reembolsado"].includes(pedido.pagamentoStatus);
    if (alreadyFinal && pedido.pagamentoStatus === label) {
      return { pedido, changed: false, previousLabel: pedido.pagamentoStatus };
    }

    const wasPaid = pedido.pagamentoStatus === "Pago";
    const isPaid = label === "Pago";

    // ---- Efeitos de estoque (somente na transicao, nunca duplicado) --------
    if (isPaid && !wasPaid) {
      await confirmPedidoStock(tx, pedido.produtosCarrinho);
    } else if (!isPaid && wasPaid && ["Recusado", "Cancelado", "Expirado", "Reembolsado"].includes(label)) {
      await returnPedidoStock(tx, pedido.produtosCarrinho);
    } else if (!isPaid && !wasPaid && ["Cancelado", "Expirado"].includes(label)) {
      await releasePedidoStock(tx, pedido.produtosCarrinho);
    }

    const nextStatusAtual =
      isPaid && pedido.statusAtual === INITIAL_ORDER_STATUS ? "Empacotando Produto" : pedido.statusAtual;

    const saved = await tx.pedido.update({
      where: { id: pedido.id },
      data: {
        pagamentoStatus: label,
        pagamentoProvider: "mercadopago",
        pagamentoProviderRef: result.id || pedido.pagamentoProviderRef,
        pagamentoProviderStatus: result.mpStatus,
        pagamentoMetodoDetalhe: result.paymentMethodId ?? pedido.pagamentoMetodoDetalhe,
        ...(result.pix?.qrCode ? { pagamentoPayload: result.pix.qrCode } : {}),
        ...(result.pix?.qrCodeBase64 ? { pagamentoQrCodeBase64: result.pix.qrCodeBase64 } : {}),
        ...(result.boleto?.url ? { pagamentoBoletoUrl: result.boleto.url } : {}),
        ...(result.boleto?.barcode ? { pagamentoBoletoBarcode: result.boleto.barcode } : {}),
        ...(result.boleto?.expiresAt ? { pagamentoExpiraEm: result.boleto.expiresAt } : {}),
        ...(isPaid ? { pagoEm: new Date() } : {}),
        statusAtual: nextStatusAtual,
      },
    });

    return { pedido: saved, changed: true, previousLabel: pedido.pagamentoStatus };
  });

  void meta;
  return { pedido: updated.pedido, changed: updated.changed };
}

// -----------------------------------------------------------------------------
// Estoque do pedido Guest (reserva -> venda / liberacao)
// -----------------------------------------------------------------------------

type StockItem = { id?: string; quantidade?: number };

async function forEachStockItem(
  tx: Prisma.TransactionClient,
  produtos: Prisma.JsonValue,
  run: (tx: Prisma.TransactionClient, productId: string, quantity: number) => Promise<void>,
) {
  const items = Array.isArray(produtos) ? (produtos as unknown as StockItem[]) : [];
  for (const item of items) {
    const productId = typeof item?.id === "string" ? item.id : null;
    const quantity = Number(item?.quantidade ?? 0);
    if (!productId || !Number.isInteger(quantity) || quantity <= 0) continue;
    await run(tx, productId, quantity);
  }
}

async function confirmPedidoStock(tx: Prisma.TransactionClient, produtos: Prisma.JsonValue) {
  await forEachStockItem(tx, produtos, async (client, productId, quantity) => {
    await client.$executeRaw`
      UPDATE "products"
         SET "reservedStock" = GREATEST("reservedStock" - ${quantity}, 0),
             "soldStock" = "soldStock" + ${quantity},
             "updatedAt" = now()
       WHERE "id" = ${productId}
    `;
  });
}

async function releasePedidoStock(tx: Prisma.TransactionClient, produtos: Prisma.JsonValue) {
  await forEachStockItem(tx, produtos, async (client, productId, quantity) => {
    await client.$executeRaw`
      UPDATE "products"
         SET "reservedStock" = GREATEST("reservedStock" - ${quantity}, 0),
             "stock" = "stock" + ${quantity},
             "updatedAt" = now()
       WHERE "id" = ${productId}
    `;
  });
}

async function returnPedidoStock(tx: Prisma.TransactionClient, produtos: Prisma.JsonValue) {
  await forEachStockItem(tx, produtos, async (client, productId, quantity) => {
    await client.$executeRaw`
      UPDATE "products"
         SET "soldStock" = GREATEST("soldStock" - ${quantity}, 0),
             "stock" = "stock" + ${quantity},
             "updatedAt" = now()
       WHERE "id" = ${productId}
    `;
  });
}

// -----------------------------------------------------------------------------
// Webhook: localizacao e confirmacao
// -----------------------------------------------------------------------------

export async function findPedidoByProviderRef(providerRef: string) {
  if (!providerRef) return null;
  return prisma.pedido.findFirst({ where: { pagamentoProviderRef: providerRef } });
}

/**
 * Processa uma notificacao do Mercado Pago de forma IDEMPOTENTE:
 *  1. valida assinatura (feito na rota);
 *  2. consulta o pagamento REAL no gateway;
 *  3. confere o valor contra o pedido;
 *  4. atualiza o pedido somente se o estado real for conclusivo.
 */
export async function processMercadoPagoNotification(args: {
  paymentId: string;
  providerRef?: string | null;
  externalReference?: string | null;
}) {
  let result: MercadoPagoPaymentResult;
  try {
    result = await getMercadoPagoPayment(args.paymentId);
  } catch (error) {
    throw toPaymentAppError(error);
  }

  const reference = args.externalReference || result.externalReference || null;
  const pedido =
    (args.providerRef ? await findPedidoByProviderRef(args.providerRef) : null) ??
    (reference ? await prisma.pedido.findUnique({ where: { tokenRastreioUnico: reference } }) : null);

  if (!pedido) {
    return { status: "IGNORED" as const, reason: "Pedido nao localizado." };
  }

  const expected = computePedidoAmount(pedido);
  // Nunca aceitamos um pagamento de valor diferente do pedido.
  if (result.amount > 0 && Math.abs(result.amount - expected) > 0.01) {
    await prisma.pedido.update({
      where: { id: pedido.id },
      data: { pagamentoProviderStatus: result.mpStatus, pagamentoStatus: "Divergente" },
    });
    return { status: "AMOUNT_MISMATCH" as const, expected, received: result.amount };
  }

  const applied = await applyPedidoPaymentResult(pedido.id, result, { source: "webhook", raw: result.raw });
  return {
    status: "PROCESSED" as const,
    changed: applied.changed,
    paymentStatus: applied.pedido.pagamentoStatus,
    pedidoId: applied.pedido.id,
  };
}

/** Marca pagamentos pendentes vencidos como expirados (job leve sob demanda). */
export async function expireStalePedidoPayments() {
  const stale = await prisma.pedido.findMany({
    where: { pagamentoStatus: "Pendente", pagamentoExpiraEm: { lt: new Date() } },
    select: { id: true },
    take: 200,
  });
  for (const pedido of stale) {
    await prisma.$transaction(async (tx) => {
      const row = await tx.pedido.findUnique({ where: { id: pedido.id } });
      if (!row || row.pagamentoStatus !== "Pendente") return;
      await releasePedidoStock(tx, row.produtosCarrinho);
      await tx.pedido.update({ where: { id: row.id }, data: { pagamentoStatus: "Expirado" } });
    });
  }
  return { expired: stale.length };
}

/** Verifica se o pagamento online esta habilitado para a loja. */
export function isOnlinePaymentEnabled(): boolean {
  return getMercadoPagoStatus().enabled && env.PAYMENT_PROVIDER.trim().toLowerCase() === "mercadopago";
}

export { isOrderStatus, paymentError };
