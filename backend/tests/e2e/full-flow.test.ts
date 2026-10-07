/**
 * FLUXO E2E COMPLETO (regra #33 do projeto)
 *
 *   Cadastro -> Login -> Produto -> Carrinho -> Cupom -> Frete -> Checkout
 *   -> Pagamento (sandbox) -> Pedido -> Administracao -> Atualizacao do pedido
 *   -> Comprovante -> Avaliacao
 *
 * O teste exercita a API real (mesma pilha de middlewares, validacoes e banco)
 * do inicio ao fim, com um unico cliente.
 */
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADDRESS, api, createAdmin, createShopFixture, db, makeApp, resetDatabase } from "../helpers";
import { signWebhookPayload } from "../../src/modules/payments/payment.service";

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
  await resetDatabase();
});

afterAll(async () => {
  await app.close();
  const prisma = await db();
  await prisma.$disconnect();
});

describe("fluxo completo de compra", () => {
  it("percorre todas as etapas com sucesso", async () => {
    const prisma = await db();
    const runId = Date.now();
    const steps: string[] = [];
    const record = (name: string) => steps.push(name);

    // ---------------------------------------------------------------- ADMIN
    const admin = await createAdmin(app);
    record("admin criado");

    // ------------------------------------------------------------- CATALOGO
    const { product, category, shipping } = await createShopFixture({ stock: 10, price: "200.00" });
    await prisma.product.update({ where: { id: product.id }, data: { isFeatured: true, isLaunch: true } });
    record("catalogo preparado");

    // ------------------------------------------------------------- CUPOM
    const coupon = await prisma.coupon.create({
      data: {
        code: `E2E${runId.toString().slice(-6)}`,
        type: "PERCENT",
        value: "10.00",
        active: true,
        appliesToAll: true,
        maxUsesPerUser: 1,
        startsAt: new Date(Date.now() - 3600_000),
        endsAt: new Date(Date.now() + 86400_000),
      },
    });
    record("cupom criado");

    // ------------------------------------------------------------ CADASTRO
    const email = `e2e-${runId}@teste.local`;
    const password = "E2e@12345";
    const register = await api(app, {
      method: "POST",
      url: "/api/auth/register",
      payload: { name: "Cliente E2E", email, phone: "11988887777", password, confirmPassword: password, acceptTerms: true },
    });
    expect(register.status, "cadastro").toBe(201);
    record("cadastro");

    // --------------------------------------------------------------- LOGIN
    const login = await api(app, { method: "POST", url: "/api/auth/login", payload: { email, password } });
    expect(login.status, "login").toBe(200);
    const { accessToken, refreshToken } = login.body.data as { accessToken: string; refreshToken: string };
    record("login");

    const me = await api(app, { method: "GET", url: "/api/auth/me", token: accessToken });
    expect((me.body.data as { email: string }).email).toBe(email);
    record("sessao validada");

    // ------------------------------------------------------------ ENDERECO
    const address = await api(app, { method: "POST", url: "/api/users/me/addresses", token: accessToken, payload: ADDRESS });
    expect(address.status, "endereco").toBe(201);
    const addressId = (address.body.data as { id: string }).id;
    record("endereco cadastrado");

    // -------------------------------------------------------------- BUSCA
    const search = await api(app, { method: "GET", url: "/api/products?search=Perfume&inStock=true" });
    expect((search.body.data as unknown[]).length).toBeGreaterThan(0);
    record("busca");

    // ------------------------------------------------------------ PRODUTO
    const detail = await api(app, { method: "GET", url: `/api/products/${product.slug}` });
    expect(detail.status, "detalhe do produto").toBe(200);
    expect((detail.body.data as { stock: number }).stock).toBe(10);
    record("produto consultado");

    // ----------------------------------------------------------- FAVORITO
    const favorite = await api(app, { method: "POST", url: `/api/favorites/${product.id}`, token: accessToken });
    expect(favorite.status, "favoritar").toBe(200);
    record("favoritado");

    // ------------------------------------------------------------ CARRINHO
    const cartAdd = await api(app, {
      method: "POST",
      url: "/api/cart/items",
      token: accessToken,
      payload: { productId: product.id, quantity: 2 },
    });
    expect(cartAdd.status, "adicionar ao carrinho").toBe(200);
    const cartSummary = (cartAdd.body.data as { summary: { subtotal: number; totalItems: number } }).summary;
    expect(cartSummary.subtotal).toBe(400);
    expect(cartSummary.totalItems).toBe(2);
    record("carrinho");

    // -------------------------------------------------------------- CUPOM
    const couponCheck = await api(app, {
      method: "POST",
      url: "/api/coupons/validate",
      token: accessToken,
      payload: { code: coupon.code },
    });
    expect(couponCheck.status, "validar cupom").toBe(200);
    expect((couponCheck.body.data as { discount: number }).discount).toBe(40);
    record("cupom validado");

    // -------------------------------------------------------------- FRETE
    const quote = await api(app, { method: "POST", url: "/api/shipping/quote", token: accessToken, payload: { cep: ADDRESS.cep } });
    expect(quote.status, "cotar frete").toBe(200);
    const shippingQuote = quote.body.data as { region: string; options: Array<{ id: string; price: number }> };
    expect(shippingQuote.region).toBe("SP");
    const chosenShipping = shippingQuote.options.find((o) => o.id === shipping.id) ?? shippingQuote.options[0]!;
    record("frete calculado");

    // ----------------------------------------------------------- CHECKOUT
    const checkout = await api(app, {
      method: "POST",
      url: "/api/orders",
      token: accessToken,
      headers: { "x-idempotency-key": `e2e-${runId}` },
      payload: {
        addressId,
        shippingMethodId: chosenShipping.id,
        couponCode: coupon.code,
        paymentMethod: "PIX",
        notes: "Pedido do fluxo E2E",
      },
    });
    expect(checkout.status, "checkout").toBe(201);
    const order = checkout.body.data as { id: string; number: string; total: number; status: string; subtotal: number; discount: number; shippingCost: number };
    expect(order.status).toBe("AWAITING_PAYMENT");
    expect(order.subtotal).toBe(400);
    expect(order.discount).toBe(40);
    expect(order.total).toBe(Number((400 - 40 + chosenShipping.price).toFixed(2)));
    record("checkout");

    // Estoque reservado
    const reserved = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(reserved.stock).toBe(8);
    expect(reserved.reservedStock).toBe(2);
    record("estoque reservado");

    // ---------------------------------------------------------- PAGAMENTO
    const intent = await api(app, {
      method: "POST",
      url: `/api/payments/orders/${order.id}/intent`,
      token: accessToken,
      payload: { method: "PIX" },
    });
    expect(intent.status, "intencao de pagamento").toBe(200);
    const intentData = intent.body.data as { paymentId: string; sandbox: boolean };
    expect(intentData.sandbox).toBe(true);
    record("pagamento iniciado (sandbox)");

    const simulate = await api(app, {
      method: "POST",
      url: `/api/payments/${intentData.paymentId}/simulate`,
      token: accessToken,
      payload: { outcome: "APPROVED" },
    });
    expect(simulate.status, "simular aprovacao").toBe(200);
    record("pagamento aprovado");

    const paidOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paidOrder.status).toBe("PAID");

    const sold = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(sold.soldStock).toBe(2);
    expect(sold.reservedStock).toBe(0);
    record("estoque confirmado como vendido");

    // ------------------------------------------------ WEBHOOK (idempotente)
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: intentData.paymentId } });
    const webhookPayload = {
      eventId: `e2e-evt-${runId}`,
      eventType: "payment.approved",
      providerRef: payment.providerRef!,
      outcome: "APPROVED" as const,
    };
    const webhook = await api(app, {
      method: "POST",
      url: "/api/payments/webhooks/mock",
      headers: { "x-webhook-signature": signWebhookPayload(JSON.stringify(webhookPayload)) },
      payload: webhookPayload,
    });
    expect(webhook.status, "webhook").toBe(200);
    record("webhook processado");

    // ------------------------------------------------------- MEUS PEDIDOS
    const myOrders = await api(app, { method: "GET", url: "/api/orders", token: accessToken });
    const orders = myOrders.body.data as Array<{ id: string; status: string }>;
    expect(orders[0]!.status).toBe("PAID");
    record("meus pedidos");

    // --------------------------------------------------------- COMPROVANTE
    const receipt = await api(app, { method: "GET", url: `/api/orders/${order.id}/receipt`, token: accessToken });
    expect(receipt.status, "comprovante").toBe(200);
    const receiptData = receipt.body.data as { number: string; items: unknown[]; payments: unknown[]; shippingAddress: { city: string } };
    expect(receiptData.number).toBe(order.number);
    expect(receiptData.items).toHaveLength(1);
    expect(receiptData.shippingAddress.city).toBe("Sao Paulo");
    record("comprovante emitido");

    // ---------------------------------------------------------- MENSAGENS
    const conversation = await api(app, {
      method: "POST",
      url: "/api/messages/conversations",
      token: accessToken,
      payload: { subject: "Pedido E2E", message: "Quando sera enviado?", orderId: order.id },
    });
    expect(conversation.status, "abrir conversa").toBe(201);
    const conversationId = (conversation.body.data as { id: string }).id;

    const reply = await api(app, {
      method: "POST",
      url: `/api/admin/conversations/${conversationId}/messages`,
      token: admin.token,
      payload: { body: "Seu pedido sera enviado hoje." },
    });
    expect(reply.status, "resposta do admin").toBe(200);
    record("atendimento");

    // -------------------------------------------------------------- ADMIN
    const dashboard = await api(app, { method: "GET", url: "/api/admin/dashboard", token: admin.token });
    expect(dashboard.status, "dashboard").toBe(200);
    expect((dashboard.body.data as { orders: { today: number } }).orders.today).toBe(1);
    record("dashboard");

    const adminOrder = await api(app, { method: "GET", url: `/api/admin/orders/${order.id}`, token: admin.token });
    expect(adminOrder.status, "pedido no admin").toBe(200);
    record("pedido recebido pelo admin");

    // -------------------------------------------- ATUALIZACAO DO PEDIDO
    const preparing = await api(app, {
      method: "PATCH",
      url: `/api/admin/orders/${order.id}/status`,
      token: admin.token,
      payload: { status: "PREPARING", note: "Separacao iniciada" },
    });
    expect(preparing.status, "preparando").toBe(200);

    const shipped = await api(app, {
      method: "PATCH",
      url: `/api/admin/orders/${order.id}/status`,
      token: admin.token,
      payload: { status: "SHIPPED", note: "Enviado", trackingCode: "BR123456789", carrier: "Correios" },
    });
    expect(shipped.status, "enviado").toBe(200);

    const delivered = await api(app, {
      method: "PATCH",
      url: `/api/admin/orders/${order.id}/status`,
      token: admin.token,
      payload: { status: "DELIVERED" },
    });
    expect(delivered.status, "entregue").toBe(200);
    record("status atualizado pelo admin");

    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } });
    expect(history.map((h) => h.toStatus)).toEqual([
      "AWAITING_PAYMENT",
      "PAID",
      "PREPARING",
      "SHIPPED",
      "DELIVERED",
    ]);
    record("historico de status");

    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(shipment.trackingCode).toBe("BR123456789");
    expect(shipment.status).toBe("DELIVERED");
    record("rastreamento");

    // --------------------------------------------------------- NOTIFICACOES
    const notifications = await api(app, { method: "GET", url: "/api/notifications", token: accessToken });
    const types = (notifications.body.data as Array<{ type: string }>).map((n) => n.type);
    expect(types).toContain("ORDER_CREATED");
    expect(types).toContain("PAYMENT_APPROVED");
    expect(types).toContain("ORDER_SHIPPED");
    expect(types).toContain("ORDER_DELIVERED");
    record("notificacoes");

    // ----------------------------------------------------------- AVALIACAO
    const review = await api(app, {
      method: "POST",
      url: `/api/products/${product.id}/reviews`,
      token: accessToken,
      payload: { rating: 5, title: "Excelente", comment: "Chegou rapido e bem embalado", orderId: order.id },
    });
    expect(review.status, "avaliar produto").toBe(201);

    const approve = await api(app, {
      method: "PATCH",
      url: `/api/admin/reviews/${(review.body.data as { id: string }).id}`,
      token: admin.token,
      payload: { status: "APPROVED" },
    });
    expect(approve.status, "moderar avaliacao").toBe(200);

    const publicReviews = await api(app, { method: "GET", url: `/api/products/${product.slug}/reviews` });
    expect((publicReviews.body.data as { average: number; total: number }).average).toBe(5);
    record("avaliacao moderada e publicada");

    // -------------------------------------------------------------- FEEDBACK
    const feedback = await api(app, {
      method: "POST",
      url: "/api/feedback",
      token: accessToken,
      payload: { type: "DELIVERY", orderId: order.id, rating: 5, comment: "Entrega dentro do prazo" },
    });
    expect(feedback.status, "feedback").toBe(201);
    record("feedback");

    // ---------------------------------------------------- SESSAO ENCERRADA
    const logout = await api(app, { method: "POST", url: "/api/auth/logout", token: accessToken, payload: { refreshToken } });
    expect(logout.status, "logout").toBe(200);

    const afterLogout = await api(app, { method: "POST", url: "/api/auth/refresh", payload: { refreshToken } });
    expect(afterLogout.status, "sessao revogada").toBe(401);
    record("logout");

    // ------------------------------------------------------- AUDITORIA FINAL
    const audits = await prisma.adminAuditLog.count();
    expect(audits).toBeGreaterThan(0);

    const categoryStillThere = await prisma.category.findUnique({ where: { id: category.id } });
    expect(categoryStillThere).toBeTruthy();

    // Resumo legivel do fluxo executado
    expect(steps.length).toBeGreaterThan(20);
  });
});
