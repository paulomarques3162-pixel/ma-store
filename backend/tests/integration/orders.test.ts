import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADDRESS, api, createAdmin, createClient, createShopFixture, db, makeApp, resetDatabase } from "../helpers";

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

async function makeCoupon(overrides: Record<string, unknown> = {}) {
  const prisma = await db();
  return prisma.coupon.create({
    data: {
      code: `CUPOM${Date.now().toString().slice(-6)}`,
      type: "PERCENT",
      value: "10.00",
      active: true,
      appliesToAll: true,
      maxUsesPerUser: 2,
      ...overrides,
    },
  });
}

async function checkout(client: { accessToken: string }, payload: Record<string, unknown> = {}, key?: string) {
  return api(app, {
    method: "POST",
    url: "/api/orders",
    token: client.accessToken,
    headers: key ? { "x-idempotency-key": key } : undefined,
    payload: {
      paymentMethod: "PIX",
      address: ADDRESS,
      ...payload,
    },
  });
}

describe("cupons (validacao no backend)", () => {
  it("aplica desconto percentual sobre os itens elegiveis", async () => {
    const { product } = await createShopFixture({ price: "100.00" });
    const client = await createClient(app);
    const coupon = await makeCoupon({ value: "15.00" });

    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 2 } });

    const response = await api(app, {
      method: "POST",
      url: "/api/coupons/validate",
      token: client.accessToken,
      payload: { code: coupon.code },
    });

    expect(response.status).toBe(200);
    expect((response.body.data as { discount: number }).discount).toBe(30);
  });

  it("aplica desconto fixo limitado ao subtotal", async () => {
    const { product } = await createShopFixture({ price: "20.00" });
    const client = await createClient(app);
    const coupon = await makeCoupon({ type: "FIXED", value: "500.00" });

    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });

    const response = await api(app, {
      method: "POST",
      url: "/api/coupons/validate",
      token: client.accessToken,
      payload: { code: coupon.code },
    });

    expect((response.body.data as { discount: number }).discount).toBe(20);
  });

  it("aceita codigo em minusculas", async () => {
    const { product } = await createShopFixture();
    const client = await createClient(app);
    const coupon = await makeCoupon();
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });

    const response = await api(app, {
      method: "POST",
      url: "/api/coupons/validate",
      token: client.accessToken,
      payload: { code: coupon.code.toLowerCase() },
    });
    expect(response.status).toBe(200);
  });

  it("rejeita cupom expirado, inativo, inexistente e fora da vigencia", async () => {
    const { product } = await createShopFixture();
    const client = await createClient(app);
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });

    const expired = await makeCoupon({ endsAt: new Date(Date.now() - 86400000) });
    const inactive = await makeCoupon({ active: false });
    const future = await makeCoupon({ startsAt: new Date(Date.now() + 86400000) });

    for (const code of [expired.code, inactive.code, future.code, "INEXISTENTE"]) {
      const response = await api(app, {
        method: "POST",
        url: "/api/coupons/validate",
        token: client.accessToken,
        payload: { code },
      });
      expect(response.status, `cupom ${code}`).toBe(422);
    }
  });

  it("rejeita quando o subtotal nao atinge o minimo", async () => {
    const { product } = await createShopFixture({ price: "50.00" });
    const client = await createClient(app);
    const coupon = await makeCoupon({ minOrderValue: "200.00" });
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });

    const response = await api(app, {
      method: "POST",
      url: "/api/coupons/validate",
      token: client.accessToken,
      payload: { code: coupon.code },
    });
    expect(response.status).toBe(422);
    expect(response.body.error?.message).toContain("minimo");
  });

  it("respeita o limite por usuario", async () => {
    const { product, shipping } = await createShopFixture({ price: "50.00", stock: 20 });
    const client = await createClient(app);
    const coupon = await makeCoupon({ maxUsesPerUser: 1 });

    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });
    const first = await checkout(client, { couponCode: coupon.code, shippingMethodId: shipping.id }, `k-${Date.now()}`);
    expect(first.status).toBe(201);

    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });
    const second = await api(app, {
      method: "POST",
      url: "/api/coupons/validate",
      token: client.accessToken,
      payload: { code: coupon.code },
    });
    expect(second.status).toBe(422);
  });

  it("nao aplica cupom restrito a produto fora do carrinho", async () => {
    const prisma = await db();
    const { product } = await createShopFixture({ price: "100.00" });
    const other = await prisma.product.create({
      data: { name: "Outro", slug: `outro-${Date.now()}`, sku: `OUT-${Date.now()}`, price: "30.00", stock: 5, active: true },
    });

    const client = await createClient(app);
    const coupon = await makeCoupon({ appliesToAll: false });
    await prisma.couponProduct.create({ data: { couponId: coupon.id, productId: other.id } });

    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });

    const response = await api(app, {
      method: "POST",
      url: "/api/coupons/validate",
      token: client.accessToken,
      payload: { code: coupon.code },
    });
    expect(response.status).toBe(422);
  });

  it("nao aplica cupom em produto marcado como sem cupom", async () => {
    const prisma = await db();
    const { product } = await createShopFixture({ price: "100.00" });
    await prisma.product.update({ where: { id: product.id }, data: { allowCoupon: false } });

    const client = await createClient(app);
    const coupon = await makeCoupon();
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });

    const response = await api(app, {
      method: "POST",
      url: "/api/coupons/validate",
      token: client.accessToken,
      payload: { code: coupon.code },
    });
    expect(response.status).toBe(422);
  });
});

describe("frete", () => {
  it("cota por CEP e informa a regiao", async () => {
    const { product } = await createShopFixture();
    const client = await createClient(app);
    // A cotacao parte sempre do carrinho real do cliente.
    await api(app, {
      method: "POST",
      url: "/api/cart/items",
      token: client.accessToken,
      payload: { productId: product.id, quantity: 1 },
    });

    const response = await api(app, {
      method: "POST",
      url: "/api/shipping/quote",
      token: client.accessToken,
      payload: { cep: "01310100" },
    });

    expect(response.status).toBe(200);
    const data = response.body.data as { region: string; required: boolean; options: Array<{ price: number }> };
    expect(data.region).toBe("SP");
    expect(data.required).toBe(true);
    expect(data.options.length).toBeGreaterThan(0);
  });

  it("nao cobra frete quando nenhum item exige entrega", async () => {
    const prisma = await db();
    const { product } = await createShopFixture();
    await prisma.product.update({ where: { id: product.id }, data: { hasShipping: false } });

    const client = await createClient(app);
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });

    const response = await api(app, {
      method: "POST",
      url: "/api/shipping/quote",
      token: client.accessToken,
      payload: { cep: "01310100" },
    });

    expect((response.body.data as { required: boolean }).required).toBe(false);
  });

  it("aplica frete gratis acima do valor configurado", async () => {
    const { shipping } = await createShopFixture({ price: "500.00" });
    const prisma = await db();
    await prisma.shippingMethod.update({ where: { id: shipping.id }, data: { freeAbove: "300.00" } });

    const client = await createClient(app);
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: (await prisma.product.findFirstOrThrow()).id, quantity: 1 } });

    const response = await api(app, {
      method: "POST",
      url: "/api/shipping/quote",
      token: client.accessToken,
      payload: { cep: "01310100" },
    });

    const options = (response.body.data as { options: Array<{ isFree: boolean; price: number }> }).options;
    expect(options.some((o) => o.isFree && o.price === 0)).toBe(true);
  });

  it("informa UF a partir do CEP", async () => {
    const response = await api(app, { method: "POST", url: "/api/shipping/cep", payload: { cep: "20040020" } });
    expect((response.body.data as { uf: string }).uf).toBe("RJ");
  });
});

describe("checkout", () => {
  it("cria o pedido com totais corretos e reserva o estoque", async () => {
    const prisma = await db();
    const { product, shipping } = await createShopFixture({ price: "100.00", stock: 5 });
    const coupon = await makeCoupon({ value: "10.00" });
    const client = await createClient(app);

    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 2 } });

    const response = await checkout(client, { couponCode: coupon.code, shippingMethodId: shipping.id }, `key-${Date.now()}`);
    expect(response.status).toBe(201);

    const order = response.body.data as { number: string; total: number; subtotal: number; discount: number; shippingCost: number; status: string };
    expect(order.subtotal).toBe(200);
    expect(order.discount).toBe(20);
    expect(order.shippingCost).toBe(20);
    expect(order.total).toBe(200);
    expect(order.status).toBe("AWAITING_PAYMENT");
    expect(order.number).toMatch(/^MA-\d{4}-\d{6}$/);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.stock).toBe(3);
    expect(after.reservedStock).toBe(2);
    expect(after.soldStock).toBe(0);

    const cart = await api(app, { method: "GET", url: "/api/cart", token: client.accessToken });
    expect((cart.body.data as { items: unknown[] }).items).toHaveLength(0);
  });

  it("grava snapshots dos itens e o endereco", async () => {
    const { product, shipping } = await createShopFixture();
    const client = await createClient(app);
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });

    const response = await checkout(client, { shippingMethodId: shipping.id }, `snap-${Date.now()}`);
    const orderId = (response.body.data as { id: string }).id;

    const prisma = await db();
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    expect(item.nameSnapshot).toBe(product.name);
    expect(item.skuSnapshot).toBe(product.sku);

    // Alterar o produto NAO altera o pedido ja criado.
    await prisma.product.update({ where: { id: product.id }, data: { name: "Nome Novo" } });
    const unchanged = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    expect(unchanged.nameSnapshot).toBe(product.name);
  });

  it("e idempotente com a mesma chave", async () => {
    const prisma = await db();
    const { product, shipping } = await createShopFixture({ stock: 10 });
    const client = await createClient(app);
    const key = `idem-${Date.now()}`;

    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });
    const first = await checkout(client, { shippingMethodId: shipping.id }, key);
    const second = await checkout(client, { shippingMethodId: shipping.id }, key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((first.body.data as { id: string }).id).toBe((second.body.data as { id: string }).id);

    expect(await prisma.order.count()).toBe(1);
    // O estoque so foi reservado uma vez.
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.reservedStock).toBe(1);
  });

  it("recusa checkout com carrinho vazio", async () => {
    const client = await createClient(app);
    const response = await checkout(client, { shippingMethodId: "qualquer" });
    expect(response.status).toBe(400);
  });

  it("exige modalidade de frete quando ha item para entrega", async () => {
    const { product } = await createShopFixture();
    const client = await createClient(app);
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });

    const response = await checkout(client, {});
    expect(response.status).toBe(422);
    expect(response.body.error?.message).toContain("frete");
  });

  it("exige endereco", async () => {
    const { product, shipping } = await createShopFixture();
    const client = await createClient(app);
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });

    const response = await api(app, {
      method: "POST",
      url: "/api/orders",
      token: client.accessToken,
      payload: { paymentMethod: "PIX", shippingMethodId: shipping.id },
    });
    expect(response.status).toBe(422);
  });

  it("aceita endereco salvo na conta", async () => {
    const { product, shipping } = await createShopFixture();
    const client = await createClient(app);
    const address = await api(app, { method: "POST", url: "/api/users/me/addresses", token: client.accessToken, payload: ADDRESS });
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });

    const addressId = (address.body.data as { id: string }).id;
    const response = await checkout(client, { addressId, shippingMethodId: shipping.id }, `saved-${Date.now()}`);
    expect(response.status).toBe(201);
  });

  it("recusa endereco que nao pertence ao usuario", async () => {
    const { product, shipping } = await createShopFixture();
    const owner = await createClient(app);
    const intruder = await createClient(app);

    const address = await api(app, { method: "POST", url: "/api/users/me/addresses", token: owner.accessToken, payload: ADDRESS });
    await api(app, { method: "POST", url: "/api/cart/items", token: intruder.accessToken, payload: { productId: product.id, quantity: 1 } });

    const response = await checkout(intruder, { addressId: (address.body.data as { id: string }).id, shippingMethodId: shipping.id });
    expect(response.status).toBe(404);
  });

  it("nao permite comprar acima do estoque", async () => {
    const prisma = await db();
    const { product, shipping } = await createShopFixture({ stock: 5 });
    const client = await createClient(app);

    // Cliente coloca 2 no carrinho...
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 2 } });

    // ...e o estoque cai para 1 antes de finalizar (ex.: outra venda simultanea).
    await prisma.$executeRaw`UPDATE "products" SET "stock" = 1 WHERE "id" = ${product.id}`;

    const response = await checkout(client, { shippingMethodId: shipping.id });
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("INSUFFICIENT_STOCK");

    // O pedido NAO foi criado e o estoque nao ficou negativo.
    expect(await prisma.order.count()).toBe(0);
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.stock).toBe(1);
  });

  it("mantem o estoque consistente com compras simultaneas do ultimo item", async () => {
    const prisma = await db();
    const { shipping } = await createShopFixture();
    const scarcity = await prisma.product.create({
      data: {
        name: "Ultimo item",
        slug: `ultimo-${Date.now()}`,
        sku: `ULT-${Date.now()}`,
        price: "30.00",
        stock: 1,
        active: true,
      },
    });

    const a = await createClient(app);
    const b = await createClient(app);
    const c = await createClient(app);

    for (const client of [a, b, c]) {
      await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: scarcity.id, quantity: 1 } });
    }

    const results = await Promise.all(
      [a, b, c].map((client, index) =>
        checkout(client, { shippingMethodId: shipping.id }, `race-${Date.now()}-${index}`),
      ),
    );

    const created = results.filter((r) => r.status === 201).length;
    const rejected = results.filter((r) => r.status === 409).length;

    expect(created).toBe(1);
    expect(rejected).toBe(2);

    const after = await prisma.product.findUniqueOrThrow({ where: { id: scarcity.id } });
    expect(after.stock).toBe(0);
    expect(after.stock).toBeGreaterThanOrEqual(0);
    expect(after.reservedStock).toBe(1);
  });
});

describe("pedidos do cliente", () => {
  it("lista, detalha, emite comprovante e cancela antes do pagamento", async () => {
    const prisma = await db();
    const { product, shipping } = await createShopFixture({ stock: 5 });
    const client = await createClient(app);
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 2 } });

    const created = await checkout(client, { shippingMethodId: shipping.id }, `cancel-${Date.now()}`);
    const orderId = (created.body.data as { id: string }).id;

    const list = await api(app, { method: "GET", url: "/api/orders", token: client.accessToken });
    expect((list.body.data as unknown[]).length).toBe(1);

    const detail = await api(app, { method: "GET", url: `/api/orders/${orderId}`, token: client.accessToken });
    expect(detail.status).toBe(200);
    expect((detail.body.data as { statusHistory: unknown[] }).statusHistory.length).toBeGreaterThanOrEqual(1);

    const receipt = await api(app, { method: "GET", url: `/api/orders/${orderId}/receipt`, token: client.accessToken });
    expect(receipt.status).toBe(200);
    const receiptData = receipt.body.data as { number: string; items: unknown[]; total: number };
    expect(receiptData.number).toMatch(/^MA-/);
    expect(receiptData.items.length).toBe(1);

    const summary = await api(app, { method: "GET", url: "/api/orders/summary", token: client.accessToken });
    expect((summary.body.data as { totalOrders: number }).totalOrders).toBe(1);

    const canceled = await api(app, { method: "POST", url: `/api/orders/${orderId}/cancel`, token: client.accessToken, payload: { reason: "Desisti" } });
    expect(canceled.status).toBe(200);
    expect((canceled.body.data as { status: string }).status).toBe("CANCELED");

    // Estoque devolvido
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.stock).toBe(5);
    expect(after.reservedStock).toBe(0);
  });

  it("nao deixa o cliente ver pedido de outro", async () => {
    const { product, shipping } = await createShopFixture();
    const owner = await createClient(app);
    const intruder = await createClient(app);

    await api(app, { method: "POST", url: "/api/cart/items", token: owner.accessToken, payload: { productId: product.id, quantity: 1 } });
    const created = await checkout(owner, { shippingMethodId: shipping.id }, `iso-${Date.now()}`);
    const orderId = (created.body.data as { id: string }).id;

    const attempt = await api(app, { method: "GET", url: `/api/orders/${orderId}`, token: intruder.accessToken });
    expect(attempt.status).toBe(404);

    const receiptAttempt = await api(app, { method: "GET", url: `/api/orders/${orderId}/receipt`, token: intruder.accessToken });
    expect(receiptAttempt.status).toBe(404);
  });

  it("cria notificacao para o cliente e para a administracao", async () => {
    const prisma = await db();
    const admin = await createAdmin(app);
    const { product, shipping } = await createShopFixture();
    const client = await createClient(app);

    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });
    await checkout(client, { shippingMethodId: shipping.id }, `notif-${Date.now()}`);

    const clientNotifications = await api(app, { method: "GET", url: "/api/notifications", token: client.accessToken });
    expect((clientNotifications.body.data as Array<{ type: string }>).some((n) => n.type === "ORDER_CREATED")).toBe(true);

    const adminNotifications = await prisma.notification.count({ where: { userId: admin.id, type: "ORDER_CREATED" } });
    expect(adminNotifications).toBe(1);
  });
});
