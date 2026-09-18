import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADDRESS, api, createAdmin, createClient, createShopFixture, db, makeApp, resetDatabase } from "../helpers";

let app: FastifyInstance;
let admin: { token: string; id: string; email: string };

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
  admin = await createAdmin(app);
});

async function auth() {
  return { token: admin.token };
}

describe("dashboard", () => {
  it("retorna metricas reais (sem numeros inventados)", async () => {
    const { product, shipping } = await createShopFixture();
    const client = await createClient(app);
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });
    await api(app, {
      method: "POST",
      url: "/api/orders",
      token: client.accessToken,
      headers: { "x-idempotency-key": `dash-${Date.now()}` },
      payload: { paymentMethod: "PIX", shippingMethodId: shipping.id, address: ADDRESS },
    });

    const response = await api(app, { method: "GET", url: "/api/admin/dashboard", ...(await auth()) });
    expect(response.status).toBe(200);

    const data = response.body.data as {
      orders: { today: number; pending: number };
      customers: { total: number };
      catalog: { active: number };
      chart: { salesByDay: unknown[] };
      topProducts: unknown[];
      recentOrders: unknown[];
    };

    expect(data.orders.today).toBe(1);
    expect(data.orders.pending).toBe(1);
    expect(data.customers.total).toBe(1);
    expect(data.catalog.active).toBe(1);
    expect(Array.isArray(data.chart.salesByDay)).toBe(true);
    expect(data.recentOrders.length).toBe(1);
  });

  it("alerta sobre estoque baixo", async () => {
    const prisma = await db();
    const { product } = await createShopFixture({ stock: 1 });
    await prisma.product.update({ where: { id: product.id }, data: { minStock: 5 } });

    const response = await api(app, { method: "GET", url: "/api/admin/dashboard", ...(await auth()) });
    const data = response.body.data as { catalog: { lowStockList: Array<{ id: string }> } };
    expect(data.catalog.lowStockList.map((p) => p.id)).toContain(product.id);
  });
});

describe("produtos (admin)", () => {
  it("cria, edita, duplica, altera estoque e desativa", async () => {
    const create = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      ...(await auth()),
      payload: {
        name: "Perfume Admin",
        sku: `ADM-${Date.now()}`,
        price: 199.9,
        comparePrice: 249.9,
        stock: 10,
        minStock: 2,
        volume: "100ml",
        isFeatured: true,
        images: [{ url: "https://exemplo.test/img.jpg", alt: "frente" }],
      },
    });
    expect(create.status).toBe(201);
    const product = create.body.data as { id: string; slug: string; images: unknown[] };
    expect(product.slug).toBe("perfume-admin");
    expect(product.images).toHaveLength(1);

    const update = await api(app, {
      method: "PATCH",
      url: `/api/admin/products/${product.id}`,
      ...(await auth()),
      payload: { price: 179.9, isLaunch: true, name: "Perfume Admin Editado" },
    });
    expect(update.status).toBe(200);
    expect((update.body.data as { price: number }).price).toBe(179.9);
    expect((update.body.data as { slug: string }).slug).toBe("perfume-admin-editado");

    const duplicate = await api(app, { method: "POST", url: `/api/admin/products/${product.id}/duplicate`, ...(await auth()) });
    expect(duplicate.status).toBe(201);
    expect((duplicate.body.data as { active: boolean }).active).toBe(false);

    const stock = await api(app, {
      method: "PATCH",
      url: `/api/admin/products/${product.id}/stock`,
      ...(await auth()),
      payload: { stock: 42, minStock: 5, reason: "Inventario" },
    });
    expect((stock.body.data as { stock: number }).stock).toBe(42);

    const deactivate = await api(app, { method: "DELETE", url: `/api/admin/products/${product.id}`, ...(await auth()) });
    expect(deactivate.status).toBe(200);
    expect((deactivate.body.data as { active: boolean }).active).toBe(false);
  });

  it("impede SKU duplicado", async () => {
    const first = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      ...(await auth()),
      payload: { name: "P1", sku: "SKU-UNICO", price: 10, stock: 1 },
    });
    expect(first.status).toBe(201);

    const second = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      ...(await auth()),
      payload: { name: "P2", sku: "SKU-UNICO", price: 10, stock: 1 },
    });
    expect(second.status).toBe(409);
  });

  it("nao deixa o estoque ficar menor que o reservado", async () => {
    const prisma = await db();
    const { product, shipping } = await createShopFixture({ stock: 5 });
    const client = await createClient(app);
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 3 } });
    await api(app, {
      method: "POST",
      url: "/api/orders",
      token: client.accessToken,
      headers: { "x-idempotency-key": `res-${Date.now()}` },
      payload: { paymentMethod: "PIX", shippingMethodId: shipping.id, address: ADDRESS },
    });

    const current = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(current.reservedStock).toBe(3);

    const response = await api(app, {
      method: "PATCH",
      url: `/api/admin/products/${product.id}/stock`,
      ...(await auth()),
      payload: { stock: 1 },
    });
    expect(response.status).toBe(400);
  });

  it("nao exclui de verdade um produto ja vendido", async () => {
    const { product, shipping } = await createShopFixture();
    const client = await createClient(app);
    await api(app, { method: "POST", url: "/api/cart/items", token: client.accessToken, payload: { productId: product.id, quantity: 1 } });
    await api(app, {
      method: "POST",
      url: "/api/orders",
      token: client.accessToken,
      headers: { "x-idempotency-key": `del-${Date.now()}` },
      payload: { paymentMethod: "PIX", shippingMethodId: shipping.id, address: ADDRESS },
    });

    const response = await api(app, { method: "DELETE", url: `/api/admin/products/${product.id}?hard=true`, ...(await auth()) });
    expect(response.status).toBe(400);
  });

  it("registra auditoria com antes/depois", async () => {
    const prisma = await db();
    const create = await api(app, {
      method: "POST",
      url: "/api/admin/products",
      ...(await auth()),
      payload: { name: "Auditado", sku: `AUD-${Date.now()}`, price: 100, stock: 5 },
    });
    const id = (create.body.data as { id: string }).id;

    await api(app, { method: "PATCH", url: `/api/admin/products/${id}`, ...(await auth()), payload: { price: 250 } });

    const audit = await prisma.adminAuditLog.findFirstOrThrow({ where: { entity: "Product", entityId: id, action: "UPDATE" } });
    expect(audit.adminId).toBe(admin.id);
    expect(JSON.stringify(audit.after)).toContain("250");
    expect(audit.requestId).toBeTruthy();
  });
});

describe("categorias, marcas, cupons e frete", () => {
  it("gerencia categorias com slug unico e soft delete", async () => {
    const first = await api(app, { method: "POST", url: "/api/admin/categories", ...(await auth()), payload: { name: "Decants" } });
    expect(first.status).toBe(201);
    const id = (first.body.data as { id: string }).id;

    const second = await api(app, { method: "POST", url: "/api/admin/categories", ...(await auth()), payload: { name: "Decants" } });
    expect((second.body.data as { slug: string }).slug).toBe("decants-2");

    const { product } = await createShopFixture();
    const prisma = await db();
    await prisma.product.update({ where: { id: product.id }, data: { categoryId: id } });

    const removed = await api(app, { method: "DELETE", url: `/api/admin/categories/${id}`, ...(await auth()) });
    expect((removed.body.data as { deactivated: boolean }).deactivated).toBe(true);
  });

  it("gerencia marcas", async () => {
    const created = await api(app, { method: "POST", url: "/api/admin/brands", ...(await auth()), payload: { name: "Marca X" } });
    expect(created.status).toBe(201);
    const id = (created.body.data as { id: string }).id;

    const updated = await api(app, { method: "PATCH", url: `/api/admin/brands/${id}`, ...(await auth()), payload: { name: "Marca Y" } });
    expect((updated.body.data as { name: string }).name).toBe("Marca Y");

    const deleted = await api(app, { method: "DELETE", url: `/api/admin/brands/${id}`, ...(await auth()) });
    expect((deleted.body.data as { deleted: boolean }).deleted).toBe(true);
  });

  it("gerencia cupons com regras e limite percentual", async () => {
    const created = await api(app, {
      method: "POST",
      url: "/api/admin/coupons",
      ...(await auth()),
      payload: { code: "promo20", type: "PERCENT", value: 20, maxUses: 100, maxUsesPerUser: 1, minOrderValue: 50 },
    });
    expect(created.status).toBe(201);
    expect((created.body.data as { code: string }).code).toBe("PROMO20");

    const invalid = await api(app, {
      method: "POST",
      url: "/api/admin/coupons",
      ...(await auth()),
      payload: { code: "INVALIDO", type: "PERCENT", value: 150 },
    });
    expect(invalid.status).toBe(409);

    const id = (created.body.data as { id: string }).id;
    const toggled = await api(app, { method: "POST", url: `/api/admin/coupons/${id}/toggle`, ...(await auth()) });
    expect((toggled.body.data as { active: boolean }).active).toBe(false);

    const list = await api(app, { method: "GET", url: "/api/admin/coupons", ...(await auth()) });
    expect(list.status).toBe(200);
  });

  it("gerencia modalidades de frete", async () => {
    const created = await api(app, {
      method: "POST",
      url: "/api/admin/shipping",
      ...(await auth()),
      payload: { name: "Expresso", price: 39.9, minDays: 1, maxDays: 2, regions: ["SP", "RJ"], freeAbove: 500 },
    });
    expect(created.status).toBe(201);

    const invalid = await api(app, {
      method: "POST",
      url: "/api/admin/shipping",
      ...(await auth()),
      payload: { name: "Invalido", price: 10, minDays: 5, maxDays: 2 },
    });
    expect(invalid.status).toBe(400);

    const id = (created.body.data as { id: string }).id;
    const updated = await api(app, { method: "PATCH", url: `/api/admin/shipping/${id}`, ...(await auth()), payload: { price: 45 } });
    expect((updated.body.data as { price: number }).price).toBe(45);
  });
});

describe("usuarios (admin)", () => {
  it("lista com pedidos e total gasto, sem qualquer senha", async () => {
    const client = await createClient(app, { email: "listado@teste.local" });
    const response = await api(app, { method: "GET", url: "/api/admin/users", ...(await auth()) });

    expect(response.status).toBe(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("Cliente@123");

    const user = (response.body.data as Array<{ email: string; ordersCount: number; totalSpent: number }>).find(
      (u) => u.email === client.email,
    );
    expect(user).toBeTruthy();
    expect(user!.ordersCount).toBe(0);
  });

  it("detalhe do usuario informa explicitamente que a senha nao e visivel", async () => {
    const client = await createClient(app);
    const response = await api(app, { method: "GET", url: `/api/admin/users/${client.user.id}`, ...(await auth()) });

    expect(response.status).toBe(200);
    const data = response.body.data as { passwordVisible: boolean; activeSessions: unknown[] };
    expect(data.passwordVisible).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain("passwordHash");
  });

  it("bloqueia o usuario e derruba as sessoes", async () => {
    const prisma = await db();
    const client = await createClient(app);

    const active = await prisma.session.count({ where: { userId: client.user.id, revokedAt: null } });
    expect(active).toBeGreaterThan(0);

    const response = await api(app, {
      method: "PATCH",
      url: `/api/admin/users/${client.user.id}/status`,
      ...(await auth()),
      payload: { status: "BLOCKED" },
    });
    expect(response.status).toBe(200);

    expect(await prisma.session.count({ where: { userId: client.user.id, revokedAt: null } })).toBe(0);

    const blockedLogin = await api(app, {
      method: "POST",
      url: "/api/auth/login",
      payload: { email: client.email, password: client.password },
    });
    expect(blockedLogin.status).toBe(401);
  });

  it("nao deixa o admin bloquear a propria conta", async () => {
    const response = await api(app, {
      method: "PATCH",
      url: `/api/admin/users/${admin.id}/status`,
      ...(await auth()),
      payload: { status: "BLOCKED" },
    });
    expect(response.status).toBe(400);
  });

  it("inicia a recuperacao de senha sem revelar a senha atual", async () => {
    const client = await createClient(app);
    const response = await api(app, { method: "POST", url: `/api/admin/users/${client.user.id}/reset-password`, ...(await auth()) });

    expect(response.status).toBe(200);
    const data = response.body.data as { message: string; devToken: string | null };
    expect(data.message).toContain("redefinicao");
    expect(JSON.stringify(response.body)).not.toContain(client.password);
  });
});

describe("mensagens e moderacao", () => {
  it("responde o cliente e atualiza o status da conversa", async () => {
    const client = await createClient(app);

    const created = await api(app, {
      method: "POST",
      url: "/api/messages/conversations",
      token: client.accessToken,
      payload: { subject: "Duvida", message: "Bom dia!" },
    });
    const conversationId = (created.body.data as { id: string }).id;

    const list = await api(app, { method: "GET", url: "/api/admin/conversations", ...(await auth()) });
    expect(list.status).toBe(200);
    const item = (list.body.data as Array<{ id: string; unreadForAdmin: number }>).find((c) => c.id === conversationId);
    expect(item?.unreadForAdmin ?? 0).toBeGreaterThan(0);

    await api(app, { method: "POST", url: `/api/admin/conversations/${conversationId}/messages`, ...(await auth()), payload: { body: "Bom dia! Como posso ajudar?" } });

    const status = await api(app, { method: "PATCH", url: `/api/admin/conversations/${conversationId}/status`, ...(await auth()), payload: { status: "RESOLVED" } });
    expect((status.body.data as { status: string }).status).toBe("RESOLVED");
  });

  it("modera avaliacoes e feedbacks", async () => {
    const prisma = await db();
    const { product } = await createShopFixture();
    const client = await createClient(app);

    const review = await prisma.review.create({
      data: { productId: product.id, userId: client.user.id, rating: 5, comment: "Otimo", status: "PENDING" },
    });

    const list = await api(app, { method: "GET", url: "/api/admin/reviews", ...(await auth()) });
    expect(list.status).toBe(200);
    expect((list.body.data as unknown[]).length).toBe(1);

    const approved = await api(app, { method: "PATCH", url: `/api/admin/reviews/${review.id}`, ...(await auth()), payload: { status: "APPROVED" } });
    expect((approved.body.data as { status: string }).status).toBe("APPROVED");

    // Avaliacao aprovada aparece no site
    const publicReviews = await api(app, { method: "GET", url: `/api/products/${product.slug}/reviews` });
    expect((publicReviews.body.data as { total: number }).total).toBe(1);

    const rejected = await api(app, { method: "PATCH", url: `/api/admin/reviews/${review.id}`, ...(await auth()), payload: { status: "REJECTED" } });
    expect((rejected.body.data as { status: string }).status).toBe("REJECTED");

    const hidden = await api(app, { method: "GET", url: `/api/products/${product.slug}/reviews` });
    expect((hidden.body.data as { total: number }).total).toBe(0);
  });

  it("lista pagamentos e webhooks", async () => {
    const payments = await api(app, { method: "GET", url: "/api/admin/payments", ...(await auth()) });
    expect(payments.status).toBe(200);
    expect((payments.body as { environment?: string }).environment).toBe("sandbox");

    const webhooks = await api(app, { method: "GET", url: "/api/admin/webhooks", ...(await auth()) });
    expect(webhooks.status).toBe(200);
  });
});

describe("conteudo, banners, tema e configuracoes", () => {
  it("cria as chaves de conteudo vazias (sem inventar dados da loja)", async () => {
    // O seed do sistema cria as chaves ao primeiro acesso do admin
    const response = await api(app, { method: "GET", url: "/api/admin/settings", ...(await auth()) });
    expect(response.status).toBe(200);

    const data = response.body.data as { items: Array<{ key: string; value: string | null }> };
    expect(data.items.length).toBeGreaterThan(20);

    const storeName = data.items.find((i) => i.key === "store.name");
    expect(storeName).toBeTruthy();
    expect(storeName!.value).toBeNull();

    // E nao ha nenhum dado de contato inventado
    expect(JSON.stringify(data.items)).not.toMatch(/@(?!teste\.local)[a-z]+\.com/);
  });

  it("salva conteudo e registra auditoria", async () => {
    await api(app, { method: "GET", url: "/api/admin/settings", ...(await auth()) });

    const response = await api(app, {
      method: "PUT",
      url: "/api/admin/content",
      ...(await auth()),
      payload: { entries: [{ key: "store.name", value: "MA STORE" }] },
    });
    expect(response.status).toBe(200);

    const publicContent = await api(app, { method: "GET", url: "/api/content" });
    expect((publicContent.body.data as { values: Record<string, string> }).values["store.name"]).toBe("MA STORE");

    const prisma = await db();
    const audit = await prisma.adminAuditLog.findFirst({ where: { entity: "SiteContent", action: "UPDATE_CONTENT" } });
    expect(audit).toBeTruthy();
  });

  it("nao expoe conteudo marcado como privado", async () => {
    await api(app, { method: "GET", url: "/api/admin/settings", ...(await auth()) });
    await api(app, {
      method: "PUT",
      url: "/api/admin/content",
      ...(await auth()),
      payload: { entries: [{ key: "payment.pixKey", value: "chave-secreta" }] },
    });

    const prisma = await db();
    await prisma.siteContent.update({ where: { key: "payment.pixKey" }, data: { isPublic: false } });

    const publicContent = await api(app, { method: "GET", url: "/api/content" });
    expect((publicContent.body.data as { values: Record<string, string> }).values["payment.pixKey"]).toBeUndefined();
  });

  it("gerencia banners com reordenacao e vigencia", async () => {
    const created = await api(app, {
      method: "POST",
      url: "/api/admin/banners",
      ...(await auth()),
      payload: { title: "Banner 1", position: "hero", order: 1, active: true },
    });
    expect(created.status).toBe(201);
    const id = (created.body.data as { id: string }).id;

    const publicBanners = await api(app, { method: "GET", url: "/api/banners?position=hero" });
    expect((publicBanners.body.data as unknown[]).length).toBe(1);

    await api(app, {
      method: "PATCH",
      url: `/api/admin/banners/${id}`,
      ...(await auth()),
      payload: { endsAt: new Date(Date.now() - 86400000).toISOString() },
    });

    const expired = await api(app, { method: "GET", url: "/api/banners?position=hero" });
    expect((expired.body.data as unknown[]).length).toBe(0);
  });

  it("exige publicacao explicita do tema (rascunho x publicado)", async () => {
    const draft = await api(app, {
      method: "POST",
      url: "/api/admin/theme",
      ...(await auth()),
      payload: { name: "Tema Novo", settings: { primaryColor: "#111", buttonRadius: 8 } },
    });
    const id = (draft.body.data as { id: string }).id;

    const beforePublish = await api(app, { method: "GET", url: "/api/theme" });
    expect((beforePublish.body.data as { published: boolean }).published).toBe(false);

    await api(app, { method: "POST", url: `/api/admin/theme/${id}/publish`, ...(await auth()) });

    const afterPublish = await api(app, { method: "GET", url: "/api/theme" });
    const data = afterPublish.body.data as { published: boolean; settings: { primaryColor: string } };
    expect(data.published).toBe(true);
    expect(data.settings.primaryColor).toBe("#111");

    // Tema publicado nao pode ser editado
    const editPublished = await api(app, { method: "PATCH", url: `/api/admin/theme/${id}`, ...(await auth()), payload: { name: "X" } });
    expect(editPublished.status).toBe(400);
  });
});

describe("auditoria e logs", () => {
  it("lista a auditoria com filtros", async () => {
    await api(app, {
      method: "POST",
      url: "/api/admin/products",
      ...(await auth()),
      payload: { name: "Para auditar", sku: `AU2-${Date.now()}`, price: 10, stock: 1 },
    });

    const response = await api(app, { method: "GET", url: "/api/admin/audit-logs?entity=Product", ...(await auth()) });
    expect(response.status).toBe(200);
    const data = response.body.data as Array<{ entity: string; admin: { email: string } }>;
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((a) => a.entity === "Product")).toBe(true);
    expect(data[0]!.admin.email).toBe(admin.email);
  });

  it("expõe logs de webhook e falhas de teste", async () => {
    const response = await api(app, { method: "GET", url: "/api/admin/logs", ...(await auth()) });
    expect(response.status).toBe(200);
    const data = response.body.data as { webhookEvents: unknown[]; failingChecks: unknown[] };
    expect(Array.isArray(data.webhookEvents)).toBe(true);
    expect(Array.isArray(data.failingChecks)).toBe(true);
  });
});
