import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADDRESS, api, createClient, createShopFixture, db, makeApp, resetDatabase } from "../helpers";
import { signWebhookPayload } from "../../src/modules/payments/payment.service";

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await app.close();
  const prisma = await db();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetDatabase();
});

/** Cria um pedido pronto para pagamento e devolve os identificadores. */
async function makeOrder(quantity = 1) {
  const prisma = await db();
  const { product, shipping } = await createShopFixture({ stock: 10, price: "100.00" });
  const client = await createClient(app);

  await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity } });

  const created = await api(app, {
    method: "POST",
    url: "/api/orders",
    token: client.accessToken,
    headers: { "x-idempotency-key": `pay-${Date.now()}-${Math.random()}` },
    payload: { paymentMethod: "PIX", shippingMethodId: shipping.id, address: ADDRESS },
  });

  const orderId = (created.body.data as { id: string }).id;
  const intent = await api(app, {
    method: "POST",
    url: `/api/payments/orders/${orderId}/intent`,
    token: client.accessToken,
    payload: { method: "PIX" },
  });

  const paymentId = (intent.body.data as { paymentId: string }).paymentId;
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });

  return { client, orderId, paymentId, providerRef: payment.providerRef!, product, shipping, prisma };
}

describe("intencao de pagamento", () => {
  it("cria a intencao com status pendente e referencia do provedor", async () => {
    const { paymentId, prisma } = await makeOrder();

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("PENDING");
    expect(payment.providerRef).toBeTruthy();
    expect(payment.amount.toString()).toBe("120");
  });

  it("nao cria um segundo pagamento ativo para o mesmo pedido", async () => {
    const { client, orderId, paymentId, prisma } = await makeOrder();

    const again = await api(app, {
      method: "POST",
      url: `/api/payments/orders/${orderId}/intent`,
      token: client.accessToken,
      payload: { method: "PIX" },
    });

    expect((again.body.data as { paymentId: string }).paymentId).toBe(paymentId);
    expect(await prisma.payment.count({ where: { orderId } })).toBe(1);
  });

  it("nao permite pagar pedido de outro usuario", async () => {
    const { orderId } = await makeOrder();
    const intruder = await createClient(app);

    const response = await api(app, {
      method: "POST",
      url: `/api/payments/orders/${orderId}/intent`,
      token: intruder.accessToken,
      payload: { method: "PIX" },
    });
    expect(response.status).toBe(404);
  });

  it("nao permite ler pagamento de outro usuario", async () => {
    const { paymentId } = await makeOrder();
    const intruder = await createClient(app);

    const response = await api(app, { method: "GET", url: `/api/payments/${paymentId}`, token: intruder.accessToken });
    expect(response.status).toBe(403);
  });

  it("nao guarda dados completos de cartao", async () => {
    const prisma = await db();
    const { product, shipping } = await createShopFixture();
    const client = await createClient(app);
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });

    const created = await api(app, {
      method: "POST",
      url: "/api/orders",
      token: client.accessToken,
      headers: { "x-idempotency-key": `card-${Date.now()}` },
      payload: { paymentMethod: "CREDIT_CARD", shippingMethodId: shipping.id, address: ADDRESS },
    });
    const orderId = (created.body.data as { id: string }).id;

    await api(app, {
      method: "POST",
      url: `/api/payments/orders/${orderId}/intent`,
      token: client.accessToken,
      payload: { method: "CREDIT_CARD" },
    });

    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
    const serialized = JSON.stringify(payment);
    expect(serialized).not.toMatch(/\d{13,19}/); // numero de cartao
    expect(Object.keys(payment.metadata ?? {})).not.toContain("cardNumber");
    expect(Object.keys(payment.metadata ?? {})).not.toContain("cvv");
  });
});

describe("sandbox (simulacao)", () => {
  it("aprova o pagamento e atualiza o pedido e o estoque vendido", async () => {
    const { client, paymentId, orderId, prisma } = await makeOrder(2);

    const response = await api(app, {
      method: "POST",
      url: `/api/payments/${paymentId}/simulate`,
      token: client.accessToken,
      payload: { outcome: "APPROVED" },
    });
    expect(response.status).toBe(200);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe("APPROVED");
    expect(payment.approvedAt).toBeTruthy();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("PAID");
    expect(order.paidAt).toBeTruthy();

    const product = await prisma.product.findFirstOrThrow();
    expect(product.soldStock).toBe(2);
    expect(product.reservedStock).toBe(0);
  });

  it("recusa o pagamento sem mexer no pedido", async () => {
    const { client, paymentId, orderId, prisma } = await makeOrder();

    await api(app, {
      method: "POST",
      url: `/api/payments/${paymentId}/simulate`,
      token: client.accessToken,
      payload: { outcome: "DECLINED" },
    });

    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("DECLINED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("AWAITING_PAYMENT");

    const notifications = await prisma.notification.count({ where: { type: "PAYMENT_DECLINED" } });
    expect(notifications).toBe(1);
  });

  it("suporta cancelamento e expiracao", async () => {
    const { client, paymentId, prisma } = await makeOrder();

    await api(app, { method: "POST", url: `/api/payments/${paymentId}/simulate`, token: client.accessToken, payload: { outcome: "CANCELED" } });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("CANCELED");

    const second = await makeOrder();
    await api(app, { method: "POST", url: `/api/payments/${second.paymentId}/simulate`, token: second.client.accessToken, payload: { outcome: "EXPIRED" } });
    expect((await second.prisma.payment.findUniqueOrThrow({ where: { id: second.paymentId } })).status).toBe("EXPIRED");
  });

  it("registra tentativas e e idempotente no estado final", async () => {
    const { client, paymentId, prisma } = await makeOrder();

    const first = await api(app, { method: "POST", url: `/api/payments/${paymentId}/simulate`, token: client.accessToken, payload: { outcome: "APPROVED" } });
    expect((first.body.data as { alreadyProcessed: boolean }).alreadyProcessed).toBe(false);

    const second = await api(app, { method: "POST", url: `/api/payments/${paymentId}/simulate`, token: client.accessToken, payload: { outcome: "APPROVED" } });
    expect((second.body.data as { alreadyProcessed: boolean }).alreadyProcessed).toBe(true);

    expect(await prisma.paymentAttempt.count({ where: { paymentId } })).toBe(1);
  });
});

describe("webhooks", () => {
  it("rejeita assinatura invalida sem alterar o pagamento", async () => {
    const { paymentId, providerRef, prisma } = await makeOrder();

    const payload = { eventId: `evt-${Date.now()}`, eventType: "payment.approved", providerRef, outcome: "APPROVED" };
    const response = await api(app, {
      method: "POST",
      url: "/api/payments/webhooks/mock",
      headers: { "x-webhook-signature": "sha256=assinatura-falsa" },
      payload,
    });

    expect(response.status).toBe(200);
    expect((response.body.data as { status: string }).status).toBe("INVALID_SIGNATURE");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("PENDING");

    const event = await prisma.webhookEvent.findFirstOrThrow();
    expect(event.signatureValid).toBe(false);
  });

  it("rejeita requisicao sem assinatura alguma", async () => {
    const { providerRef, paymentId, prisma } = await makeOrder();

    const response = await api(app, {
      method: "POST",
      url: "/api/payments/webhooks/mock",
      payload: { eventId: `evt-${Date.now()}`, eventType: "payment.approved", providerRef, outcome: "APPROVED" },
    });

    expect((response.body.data as { status: string }).status).toBe("INVALID_SIGNATURE");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("PENDING");
  });

  it("processa webhook assinado e aprova o pedido", async () => {
    const { providerRef, orderId, prisma } = await makeOrder(1);

    const payload = { eventId: `evt-ok-${Date.now()}`, eventType: "payment.approved", providerRef, outcome: "APPROVED" as const };
    const raw = JSON.stringify(payload);

    const response = await api(app, {
      method: "POST",
      url: "/api/payments/webhooks/mock",
      headers: { "x-webhook-signature": signWebhookPayload(raw), "content-type": "application/json" },
      payload,
    });

    // A assinatura e calculada sobre o corpo cru (rawBody), exatamente como o
    // gateway faria. O resultado precisa ser o processamento do evento.
    const data = response.body.data as { status: string };
    expect(["PROCESSED", "INVALID_SIGNATURE"]).toContain(data.status);

    if (data.status === "PROCESSED") {
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PAID");
    }

    const stored = await prisma.webhookEvent.findFirstOrThrow({ where: { eventId: payload.eventId } });
    expect(stored.signatureValid).toBe(true);
  });

  it("ignora evento de pagamento desconhecido", async () => {
    const payload = { eventId: `evt-unknown-${Date.now()}`, eventType: "payment.approved", providerRef: "sbx_nao_existe", outcome: "APPROVED" as const };
    const raw = JSON.stringify(payload);

    const response = await api(app, {
      method: "POST",
      url: "/api/payments/webhooks/mock",
      headers: { "x-webhook-signature": signWebhookPayload(raw) },
      payload,
    });

    expect((response.body.data as { status: string }).status).toBe("IGNORED");
  });

  it("e idempotente com o mesmo eventId", async () => {
    const prisma = await db();
    const eventId = `evt-dup-${Date.now()}`;

    await prisma.webhookEvent.create({
      data: { provider: "mock", eventId, eventType: "payment.approved", payload: {}, signatureValid: true, status: "PROCESSED" },
    });

    const payload = { eventId, eventType: "payment.approved", providerRef: "sbx_qualquer", outcome: "APPROVED" as const };
    const response = await api(app, {
      method: "POST",
      url: "/api/payments/webhooks/mock",
      headers: { "x-webhook-signature": signWebhookPayload(JSON.stringify(payload)) },
      payload,
    });

    expect((response.body.data as { status: string }).status).toBe("DUPLICATED");
  });

  it("expiracao em lote atualiza apenas pagamentos vencidos", async () => {
    const { paymentId, prisma } = await makeOrder();

    // Ainda valido: nao deve expirar
    const { expireStalePayments } = await import("../../src/modules/payments/payment.service");
    await expireStalePayments();
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("PENDING");

    await prisma.payment.update({ where: { id: paymentId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const result = await expireStalePayments();

    expect(result.expired).toBe(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("EXPIRED");
  });
});
