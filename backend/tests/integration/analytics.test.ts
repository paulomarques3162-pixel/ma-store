import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, createAdmin, createShopFixture, db, makeApp, resetDatabase } from "../helpers";

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

async function track(payload: Record<string, unknown>, userAgent?: string) {
  return api(app, {
    method: "POST",
    url: "/api/analytics/events",
    payload,
    ...(userAgent ? { headers: { "user-agent": userAgent } } : {}),
  });
}

async function shippingSelection(productId: string) {
  const quote = await api(app, {
    method: "POST",
    url: "/api/shipping",
    payload: { cep: "13610000", items: [{ id: productId, nome: "Produto", quantidade: 1, peso_unitario: 0.5 }] },
  });
  const options = (quote.body as { options: Array<{ id: string; valor: number }> }).options;
  const option = options.find((entry) => Number(entry.valor) > 0) ?? options[0]!;
  return { id: option.id };
}

describe("Métricas de audiência — ingestão", () => {
  it("registra um evento anônimo", async () => {
    const response = await track(
      { eventId: "evt-1", type: "PAGE_VIEW", path: "/produtos", sessionId: "sess-1" },
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile",
    );
    expect(response.status).toBe(200);
    expect((response.body.data as { recorded: boolean }).recorded).toBe(true);

    const prisma = await db();
    const saved = await prisma.analyticsEvent.findFirstOrThrow();
    expect(saved.type).toBe("PAGE_VIEW");
    expect(saved.path).toBe("/produtos");
    expect(saved.deviceType).toBe("mobile");
    expect(saved.sessionId).toBe("sess-1");
  });

  it("é idempotente: o mesmo eventId não duplica", async () => {
    const first = await track({ eventId: "evt-dup", type: "PAGE_VIEW", path: "/", sessionId: "s1" });
    const second = await track({ eventId: "evt-dup", type: "PAGE_VIEW", path: "/", sessionId: "s1" });
    expect((first.body.data as { recorded: boolean }).recorded).toBe(true);
    expect((second.body.data as { recorded: boolean }).recorded).toBe(false);

    const prisma = await db();
    expect(await prisma.analyticsEvent.count()).toBe(1);
  });

  it("rejeita tipo de evento inválido (422)", async () => {
    const response = await track({ type: "HACK", path: "/" });
    expect(response.status).toBe(422);
  });

  it("guarda apenas o HOST do referrer (sem caminho/query)", async () => {
    await track({ type: "PAGE_VIEW", path: "/", referrer: "https://google.com/search?q=perfume" });
    const prisma = await db();
    const saved = await prisma.analyticsEvent.findFirstOrThrow();
    expect(saved.referrer).toBe("google.com");
  });

  it("ignora productId inexistente (não guarda lixo)", async () => {
    await track({ type: "PRODUCT_VIEW", productId: "produto-inexistente", path: "/p/x" });
    const prisma = await db();
    const saved = await prisma.analyticsEvent.findFirstOrThrow();
    expect(saved.productId).toBeNull();
  });
});

describe("Métricas de audiência — painel admin", () => {
  it("exige administrador (401 sem token)", async () => {
    const response = await api(app, { method: "GET", url: "/api/admin/analytics" });
    expect(response.status).toBe(401);
  });

  it("agrega visitas, produtos, carrinho, checkout e conversão", async () => {
    const admin = await createAdmin(app);
    const { product } = await createShopFixture({ stock: 5, price: "100.00" });

    await track({ type: "PAGE_VIEW", path: "/", sessionId: "a" }, "Mozilla/5.0 (Windows NT 10.0) Chrome");
    await track({ type: "PAGE_VIEW", path: "/produtos", sessionId: "a" });
    await track({ type: "PAGE_VIEW", path: "/", sessionId: "b" }, "Mozilla/5.0 (Linux; Android 13) Mobile");
    await track({ type: "PRODUCT_VIEW", productId: product.id, path: `/p/${product.sku}`, sessionId: "a" });
    await track({ type: "ADD_TO_CART", productId: product.id, sessionId: "a" });
    await track({ type: "BEGIN_CHECKOUT", sessionId: "a" });

    // Um pedido guest para a conversão (sem gateway: provider mock).
    const frete = await shippingSelection(product.id);
    const order = await api(app, {
      method: "POST",
      url: "/api/pedidos",
      payload: {
        cliente: { nome: "Cliente Métricas", whatsapp: "11999990000" },
        endereco: { cep: "13610000", logradouro: "Rua", numero: "1", bairro: "Centro", cidade: "Pirassununga", uf: "SP" },
        produtos: [{ id: product.id, quantidade: 1 }],
        frete,
        pagamento: { metodo: "COMBINAR" },
      },
    });
    expect(order.status, JSON.stringify(order.body)).toBe(201);

    const response = await api(app, { method: "GET", url: "/api/admin/analytics?days=1", token: admin.token });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const data = response.body.data as {
      totals: { pageViews: number; productViews: number; addToCart: number; beginCheckout: number; uniqueVisitors: number; orders: number };
      conversion: { visitToOrder: number | null; checkoutToOrder: number | null; denominators: { uniqueVisitors: number; beginCheckout: number } };
      topProducts: Array<{ productId: string; name: string | null; views: number }>;
      byDevice: Array<{ device: string; count: number }>;
      series: Array<{ day: string; pageViews: number; orders: number }>;
    };

    expect(data.totals.pageViews).toBe(3);
    expect(data.totals.productViews).toBe(1);
    expect(data.totals.addToCart).toBe(1);
    expect(data.totals.beginCheckout).toBe(1);
    expect(data.totals.uniqueVisitors).toBe(2);
    expect(data.totals.orders).toBe(1);

    expect(data.conversion.denominators.uniqueVisitors).toBe(2);
    expect(data.conversion.visitToOrder).toBe(50); // 1 pedido / 2 visitantes
    expect(data.conversion.checkoutToOrder).toBe(100); // 1 pedido / 1 checkout

    expect(data.topProducts[0]?.productId).toBe(product.id);
    expect(data.topProducts[0]?.name).toBe(product.name);

    const devices = Object.fromEntries(data.byDevice.map((entry) => [entry.device, entry.count]));
    expect(devices["mobile"]).toBeGreaterThanOrEqual(1);
    expect(devices["desktop"]).toBeGreaterThanOrEqual(1);

    expect(data.series.length).toBeGreaterThanOrEqual(1);
  });

  it("remove eventos antigos (retenção)", async () => {
    const admin = await createAdmin(app);
    await track({ type: "PAGE_VIEW", path: "/", sessionId: "s1" });
    const prisma = await db();
    // Envelhece o evento.
    await prisma.$executeRaw`UPDATE "analytics_events" SET "created_at" = now() - interval '400 days'`;

    const purge = await api(app, { method: "POST", url: "/api/admin/analytics/purge", token: admin.token, payload: { days: 365 } });
    expect(purge.status).toBe(200);
    expect((purge.body.data as { removed: number }).removed).toBe(1);
    expect(await prisma.analyticsEvent.count()).toBe(0);
  });
});
