import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../env.js";
import { prisma } from "../../db.js";
import { forbidden, notFound } from "../../lib/errors.js";
import { ok, parse } from "../../lib/http.js";
import { decimalToNumber } from "../../lib/serialize.js";
import * as payments from "./payment.service.js";

const orderParam = z.object({ orderId: z.string().min(1) });
const paymentParam = z.object({ id: z.string().min(1) });
const providerParam = z.object({ provider: z.string().min(1).max(40) });

const intentSchema = z.object({
  method: z.enum(["PIX", "CREDIT_CARD", "BOLETO", "MANUAL"]),
});

const simulateSchema = z.object({
  outcome: z.enum(["APPROVED", "DECLINED", "CANCELED", "EXPIRED"]),
});

const webhookSchema = z.object({
  eventId: z.string().min(1).max(120),
  eventType: z.string().min(1).max(80),
  providerRef: z.string().min(1).max(120),
  outcome: z.enum(["APPROVED", "DECLINED", "CANCELED", "EXPIRED"]),
  amount: z.number().optional(),
});

/** Confere se o usuario autenticado e dono do pagamento (ou admin). */
async function assertOwnership(request: FastifyRequest, paymentId: string) {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, order: { select: { userId: true } } },
  });
  if (!payment) throw notFound("Pagamento nao encontrado.");

  const user = request.authUser!;
  if (user.role !== "ADMIN" && payment.order.userId !== user.id) {
    throw forbidden("Voce nao tem acesso a este pagamento.");
  }
  return payment;
}

export async function paymentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Parser que preserva o corpo cru - necessario para validar a assinatura HMAC
   * do webhook. Escopo encapsulado: nao afeta as demais rotas da API.
   */
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    (request as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    try {
      done(null, JSON.parse(body as string));
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  // ---- Cliente --------------------------------------------------------------
  app.post("/orders/:orderId/intent", { preHandler: app.authenticate }, async (request, reply) => {
    const { orderId } = parse(orderParam, request.params);
    const input = parse(intentSchema, request.body);
    const intent = await payments.createPaymentIntent(orderId, request.authUser!.id, input.method);
    return ok(reply, intent);
  });

  app.get("/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const { id } = parse(paymentParam, request.params);
    await assertOwnership(request, id);

    const payment = await prisma.payment.findUnique({
      where: { id },
      select: {
        id: true,
        orderId: true,
        method: true,
        status: true,
        amount: true,
        provider: true,
        providerRef: true,
        expiresAt: true,
        approvedAt: true,
        createdAt: true,
        attempts: {
          select: { status: true, errorMessage: true, createdAt: true, durationMs: true },
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    });
    if (!payment) throw notFound("Pagamento nao encontrado.");

    return ok(reply, { ...payment, sandbox: env.isSandboxPayments });
  });

  /**
   * Sandbox: simula o retorno do gateway (aprovado, recusado, cancelado,
   * expirado). Bloqueado quando PAYMENT_ENV=production.
   */
  app.post("/:id/simulate", { preHandler: app.authenticate }, async (request, reply) => {
    if (!env.isSandboxPayments) {
      throw forbidden("Simulacao de pagamento disponivel apenas no ambiente de testes.");
    }

    const { id } = parse(paymentParam, request.params);
    await assertOwnership(request, id);
    const input = parse(simulateSchema, request.body);

    const result = await payments.applyPaymentResult(id, input.outcome, {
      source: "sandbox",
      payload: { simulatedBy: request.authUser!.id },
    });

    return ok(reply, result);
  });

  // ---- Webhook do gateway (publico, mas exigindo assinatura valida) ---------
  app.post("/webhooks/:provider", async (request, reply) => {
    const { provider } = parse(providerParam, request.params);
    const rawBody =
      (request as FastifyRequest & { rawBody?: string }).rawBody ?? JSON.stringify(request.body ?? {});

    const signature =
      (request.headers["x-webhook-signature"] as string | undefined) ??
      (request.headers["x-signature"] as string | undefined);

    const signatureValid = payments.verifyWebhookSignature(rawBody, signature);
    const payload = parse(webhookSchema, request.body ?? {});

    const result = await payments.processWebhook(provider, payload, signatureValid);

    // Sempre 200 para o gateway nao ficar reenviando um evento invalido
    // (o evento fica registrado como INVALID_SIGNATURE para auditoria).
    return reply.status(200).send({ data: result });
  });
}

/** Utilitario exposto para o laboratorio/testes gerarem uma assinatura valida. */
export function buildWebhookRequest(payload: payments.WebhookPayload) {
  const raw = JSON.stringify(payload);
  return { raw, signature: payments.signWebhookPayload(raw) };
}

export { decimalToNumber };
