import type { PaymentMethod, PaymentStatus } from "@prisma/client";
import { prisma } from "../../db.js";
import { env } from "../../env.js";
import { badRequest, notFound, paymentError } from "../../lib/errors.js";
import { hmacHex, randomToken, safeEqual } from "../../lib/crypto.js";
import { decimalToNumber } from "../../lib/serialize.js";
import { updateOrderStatus } from "../orders/order.service.js";

/**
 * Camada de pagamentos.
 *
 * Arquitetura preparada para multiplos gateways (PIX, cartao, boleto), com
 * separacao clara entre SANDBOX e PRODUCAO. Nenhum dado completo de cartao e
 * armazenado - apenas metadados nao sensiveis.
 */

export type PaymentIntent = {
  paymentId: string;
  orderId: string;
  method: PaymentMethod;
  amount: number;
  provider: string;
  providerRef: string | null;
  status: PaymentStatus;
  expiresAt: Date | null;
  /** Em PIX real, viria do gateway. No sandbox devolvemos um conteudo ficticio. */
  instructions: string | null;
  qrCode: string | null;
  sandbox: boolean;
};

function providerName(): string {
  return env.PAYMENT_PROVIDER || "mock";
}

/**
 * Cria (ou reaproveita) a intencao de pagamento de um pedido.
 * Regra: nunca criar um segundo pagamento ativo para o mesmo pedido.
 */
export async function createPaymentIntent(orderId: string, userId: string, method: PaymentMethod): Promise<PaymentIntent> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: { id: true, number: true, total: true, status: true, userId: true },
  });
  if (!order) throw notFound("Pedido nao encontrado.");

  if (["CANCELED", "REFUNDED"].includes(order.status)) {
    throw badRequest("Este pedido nao pode mais receber pagamento.");
  }

  const active = await prisma.payment.findFirst({
    where: { orderId, status: { in: ["PENDING", "APPROVED"] } },
    orderBy: { createdAt: "desc" },
  });

  if (active?.status === "APPROVED") {
    throw badRequest("Este pedido ja esta pago.");
  }

  // O pedido ja nasce com um registro de pagamento PENDING, mas ele ainda nao
  // tem `providerRef` (a referencia so existe quando o gateway e acionado).
  // Sem essa referencia o webhook nao consegue correlacionar o evento, entao
  // garantimos aqui que TODA intencao tenha uma.
  const payment = active
    ? await prisma.payment.update({
        where: { id: active.id },
        data: {
          method,
          ...(active.providerRef ? {} : { providerRef: `sbx_${randomToken(12)}` }),
          ...(active.expiresAt && active.expiresAt < new Date()
            ? { expiresAt: new Date(Date.now() + env.PAYMENT_EXPIRES_MINUTES * 60 * 1000) }
            : {}),
        },
      })
    : await prisma.payment.create({
        data: {
          orderId,
          method,
          status: "PENDING",
          amount: order.total.toFixed(2),
          provider: providerName(),
          providerRef: `sbx_${randomToken(12)}`,
          expiresAt: new Date(Date.now() + env.PAYMENT_EXPIRES_MINUTES * 60 * 1000),
          metadata: {
            environment: env.PAYMENT_ENV,
            orderNumber: order.number,
          },
        },
      });

  // Em sandbox devolvemos instrucoes marcadas como TESTE - jamais um PIX real.
  const sandbox = env.isSandboxPayments;
  let instructions: string | null = null;
  let qrCode: string | null = null;

  if (sandbox) {
    if (method === "PIX") {
      instructions =
        "[SANDBOX] Pagamento de teste. Use a rota POST /api/payments/:id/simulate para aprovar, recusar, cancelar ou expirar.";
      qrCode = null;
    } else if (method === "BOLETO") {
      instructions = "[SANDBOX] Boleto de teste. Nenhum valor real sera cobrado.";
    } else {
      instructions = "[SANDBOX] Transacao de teste via cartao (dados de cartao nao sao armazenados).";
    }
  }

  return {
    paymentId: payment.id,
    orderId,
    method: payment.method,
    amount: decimalToNumber(payment.amount),
    provider: payment.provider,
    providerRef: payment.providerRef,
    status: payment.status,
    expiresAt: payment.expiresAt,
    instructions,
    qrCode,
    sandbox,
  };
}

/** Resultado possivel de uma tentativa de pagamento. */
export type SimulatedOutcome = "APPROVED" | "DECLINED" | "CANCELED" | "EXPIRED";

const STATUS_BY_OUTCOME: Record<SimulatedOutcome, PaymentStatus> = {
  APPROVED: "APPROVED",
  DECLINED: "DECLINED",
  CANCELED: "CANCELED",
  EXPIRED: "EXPIRED",
};

/**
 * Aplica o resultado de um pagamento (usado pelo sandbox e pelo webhook).
 *
 * Tudo em transacao + idempotente: se o pagamento ja estiver no estado final,
 * nao faz nada e devolve `alreadyProcessed: true`.
 */
export async function applyPaymentResult(
  paymentId: string,
  outcome: SimulatedOutcome,
  meta: { source: "sandbox" | "webhook"; payload?: unknown; errorMessage?: string } = { source: "webhook" },
) {
  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: { order: { select: { id: true, number: true, status: true } } },
    });
    if (!payment) throw notFound("Pagamento nao encontrado.");

    const nextStatus = STATUS_BY_OUTCOME[outcome];

    if (["APPROVED", "DECLINED", "CANCELED", "EXPIRED", "REFUNDED"].includes(payment.status)) {
      return { alreadyProcessed: true, status: payment.status, orderId: payment.orderId, orderNumber: payment.order.number };
    }

    const startedAt = Date.now();

    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: nextStatus,
        ...(nextStatus === "APPROVED" ? { approvedAt: new Date() } : {}),
      },
    });

    await tx.paymentAttempt.create({
      data: {
        paymentId,
        status: nextStatus,
        requestPayload: { source: meta.source } as never,
        responsePayload: (meta.payload ?? { outcome }) as never,
        errorMessage: meta.errorMessage ?? null,
        durationMs: Date.now() - startedAt,
      },
    });

    return {
      alreadyProcessed: false,
      status: nextStatus,
      orderId: payment.orderId,
      orderNumber: payment.order.number,
      orderStatus: payment.order.status,
    };
  });

  if (result.alreadyProcessed) return result;

  // Efeitos no pedido (fora da transacao do pagamento, cada um transacional).
  if (outcome === "APPROVED") {
    if (result.orderStatus === "AWAITING_PAYMENT" || result.orderStatus === "PAYMENT_REVIEW") {
      await updateOrderStatus(result.orderId, "PAID", { note: `Pagamento aprovado (${meta.source}).` });
    }
  } else if (outcome === "DECLINED") {
    await prisma.notification
      .create({
        data: {
          userId: (await prisma.order.findUniqueOrThrow({ where: { id: result.orderId }, select: { userId: true } })).userId,
          type: "PAYMENT_DECLINED",
          title: `Pagamento recusado - pedido ${result.orderNumber}`,
          body: "Tente novamente com outra forma de pagamento.",
          link: `/meus-pedidos/${result.orderId}`,
        },
      })
      .catch(() => undefined);
  }

  return result;
}

/** Marca como expirados os pagamentos pendentes vencidos (job leve / sob demanda). */
export async function expireStalePayments() {
  const stale = await prisma.payment.findMany({
    where: { status: "PENDING", expiresAt: { lt: new Date() } },
    select: { id: true },
    take: 200,
  });

  for (const payment of stale) {
    await applyPaymentResult(payment.id, "EXPIRED", { source: "sandbox" }).catch(() => undefined);
  }

  return { expired: stale.length };
}

// -----------------------------------------------------------------------------
// Webhook
// -----------------------------------------------------------------------------

export type WebhookPayload = {
  eventId: string;
  eventType: string;
  providerRef: string;
  outcome: SimulatedOutcome;
  amount?: number;
};

/** Valida a assinatura HMAC do webhook. Sem assinatura valida, nada e processado. */
export function verifyWebhookSignature(rawBody: string, signature: string | undefined): boolean {
  if (!signature) return false;
  const expected = hmacHex(env.WEBHOOK_SECRET, rawBody);
  // aceita tanto "sha256=<hex>" quanto o hex puro
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  return safeEqual(expected, provided);
}

/** Assina um payload (usado nos testes e pelo sandbox). */
export function signWebhookPayload(rawBody: string): string {
  return `sha256=${hmacHex(env.WEBHOOK_SECRET, rawBody)}`;
}

/**
 * Processa o webhook de forma IDEMPOTENTE.
 * O mesmo `eventId` nunca e processado duas vezes - o unique (provider, eventId)
 * garante isso no banco, mesmo com requisicoes simultaneas.
 */
export async function processWebhook(provider: string, payload: WebhookPayload, signatureValid: boolean) {
  try {
    const event = await prisma.webhookEvent.create({
      data: {
        provider,
        eventId: payload.eventId,
        eventType: payload.eventType,
        payload: payload as never,
        signatureValid,
        status: signatureValid ? "RECEIVED" : "INVALID_SIGNATURE",
      },
    });

    if (!signatureValid) {
      return { status: "INVALID_SIGNATURE" as const, duplicated: false };
    }

    const payment = await prisma.payment.findFirst({
      where: { providerRef: payload.providerRef },
      select: { id: true },
    });

    if (!payment) {
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: "IGNORED", errorMessage: "Pagamento nao localizado para o providerRef.", processedAt: new Date() },
      });
      return { status: "IGNORED" as const, duplicated: false };
    }

    const result = await applyPaymentResult(payment.id, payload.outcome, {
      source: "webhook",
      payload,
    });

    await prisma.webhookEvent.update({
      where: { id: event.id },
      data: { status: "PROCESSED", processedAt: new Date() },
    });

    return {
      status: "PROCESSED" as const,
      duplicated: result.alreadyProcessed,
      paymentStatus: result.status,
      orderId: result.orderId,
    };
  } catch (error) {
    // P2002 = unique violation -> evento duplicado (idempotencia)
    if ((error as { code?: string }).code === "P2002") {
      return { status: "DUPLICATED" as const, duplicated: true };
    }
    throw paymentError("Falha ao processar o webhook.", {
      technical: error instanceof Error ? error.message : String(error),
    });
  }
}
