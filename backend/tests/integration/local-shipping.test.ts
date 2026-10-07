import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, createAdmin, createClient, db, makeApp, resetDatabase } from "../helpers";

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

async function makeProduct(over: Record<string, unknown> = {}) {
  const prisma = await db();
  return prisma.product.create({
    data: {
      name: "Perfume Local 100ml",
      slug: `local-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      sku: `LOCAL-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      price: "100.00",
      stock: 20,
      weightGrams: 500,
      heightCm: 10,
      widthCm: 5,
      lengthCm: 2,
      hasShipping: true,
      active: true,
      ...over,
    },
  });
}

async function createMethod(token: string, payload: Record<string, unknown>) {
  const response = await api(app, { method: "POST", url: "/api/admin/shipping/methods", token, payload });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data as { id: string; code: string };
}

async function createRule(token: string, payload: Record<string, unknown>) {
  const response = await api(app, { method: "POST", url: "/api/admin/shipping/rules", token, payload });
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return response.body.data as { id: string };
}

async function configureEngine(token: string, over: Record<string, unknown> = {}) {
  const settings = await api(app, {
    method: "PUT",
    url: "/api/admin/shipping/settings",
    token,
    payload: {
      enabled: true,
      originZipCode: "13610000",
      packagePaddingGrams: 100,
      defaultHandlingDays: 1,
      defaultDeliveryDays: 5,
      freeShippingEnabled: false,
      showEstimateDisclaimer: true,
      ...over,
    },
  });
  expect(settings.status, JSON.stringify(settings.body)).toBe(200);

  const zone = await api(app, {
    method: "POST",
    url: "/api/admin/shipping/zones",
    token,
    payload: { name: "Capital SP", state: "SP", zipCodeFrom: "13600000", zipCodeTo: "13699999", active: true, priority: 0 },
  });
  expect(zone.status, JSON.stringify(zone.body)).toBe(201);
  const zoneId = (zone.body.data as { id: string }).id;

  const method = await createMethod(token, {
    name: "Frete Padrao",
    code: "STANDARD",
    description: "Entrega padrao",
    active: true,
    priority: 5,
  });
  const rule = await createRule(token, {
    zoneId,
    shippingMethodId: method.id,
    minWeightGrams: 0,
    maxWeightGrams: 5000,
    price: 24.9,
    deliveryDays: 4,
  });

  return { zoneId, methodId: method.id, methodCode: method.code, ruleId: rule.id };
}

async function quote(payload: Record<string, unknown>) {
  return api(app, { method: "POST", url: "/api/shipping/quote", payload });
}

type QuoteData = {
  quoteId: string;
  expiresAt: string;
  weightGrams: number;
  subtotal: number;
  options: Array<{ methodId: string; code: string | null; name: string; price: number; deliveryDays: number | null }>;
};

async function makeQuote(token: string, productId: string, over: Record<string, unknown> = {}) {
  const response = await quote({
    cep: "13610-000",
    sessionId: "sess-1",
    items: [{ productId, quantity: 2 }],
    ...over,
  });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body.data as QuoteData;
}

/** Payload completo de pedido guest. */
function orderPayload(over: Record<string, unknown> = {}) {
  return {
    cliente: { nome: "Cliente de Teste", whatsapp: "11999990000" },
    endereco: {
      cep: "13610000",
      logradouro: "Rua de Teste",
      numero: "100",
      bairro: "Centro",
      cidade: "Pirassununga",
      uf: "SP",
    },
    produtos: [{ id: "p1", quantidade: 2 }],
    pagamento: { metodo: "COMBINAR" },
    sessionId: "sess-1",
    ...over,
  };
}

describe("Shipping Engine proprio v2 — cotacao", () => {
  it("retorna SHIPPING_ENGINE_DISABLED antes de qualquer configuracao", async () => {
    const product = await makeProduct();
    const response = await quote({ cep: "13610000", items: [{ productId: product.id, quantity: 1 }] });
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("SHIPPING_ENGINE_DISABLED");
  });

  it("retorna lista de modalidades com preco e prazo", async () => {
    const admin = await createAdmin(app);
    const { methodId } = await configureEngine(admin.token);
    const product = await makeProduct();

    const data = await makeQuote(admin.token, product.id);

    expect(data.options).toHaveLength(1);
    expect(data.options[0]!.methodId).toBe(methodId);
    expect(data.options[0]!.code).toBe("STANDARD");
    expect(data.options[0]!.price).toBe(24.9);
    expect(data.options[0]!.deliveryDays).toBe(4);
    // 500g x2 = 1000g + 100g de embalagem.
    expect(data.weightGrams).toBe(1100);
    expect(data.subtotal).toBe(200);
    expect(data.quoteId).toBeTruthy();
    expect(new Date(data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("retorna varias modalidades ordenadas por prioridade", async () => {
    const admin = await createAdmin(app);
    const { zoneId } = await configureEngine(admin.token);
    const express = await createMethod(admin.token, { name: "Frete Expresso", code: "EXPRESS", priority: 20 });
    await createRule(admin.token, {
      zoneId,
      shippingMethodId: express.id,
      minWeightGrams: 0,
      maxWeightGrams: 5000,
      price: 34.9,
      deliveryDays: 2,
    });
    const product = await makeProduct();

    const data = await makeQuote(admin.token, product.id);
    expect(data.options.map((option) => option.code)).toEqual(["EXPRESS", "STANDARD"]);
  });

  it("ignora preco/peso enviados pelo cliente (seguranca)", async () => {
    const admin = await createAdmin(app);
    await configureEngine(admin.token);
    const product = await makeProduct();

    const response = await quote({
      cep: "13610000",
      items: [{ productId: product.id, quantity: 1, weight: 999, price: 0 }],
      shippingPrice: 0,
      total: 0,
    });
    expect(response.status).toBe(200);
    expect((response.body.data as QuoteData).options[0]!.price).toBe(24.9);
  });

  it("rejeita CEP invalido", async () => {
    const admin = await createAdmin(app);
    await configureEngine(admin.token);
    const product = await makeProduct();
    const response = await quote({ cep: "123", items: [{ productId: product.id, quantity: 1 }] });
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("INVALID_ZIP_CODE");
  });

  it("rejeita produto inexistente", async () => {
    const admin = await createAdmin(app);
    await configureEngine(admin.token);
    const response = await quote({ cep: "13610000", items: [{ productId: "nao-existe", quantity: 1 }] });
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("rejeita produto sem peso configurado", async () => {
    const admin = await createAdmin(app);
    await configureEngine(admin.token);
    const product = await makeProduct({ weightGrams: null, heightCm: null, widthCm: null, lengthCm: null });
    const response = await quote({ cep: "13610000", items: [{ productId: product.id, quantity: 1 }] });
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("PRODUCT_WEIGHT_MISSING");
  });

  it("retorna SHIPPING_ZONE_NOT_FOUND para CEP fora da cobertura", async () => {
    const admin = await createAdmin(app);
    await configureEngine(admin.token);
    const product = await makeProduct();
    const response = await quote({ cep: "99999999", items: [{ productId: product.id, quantity: 1 }] });
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("SHIPPING_ZONE_NOT_FOUND");
  });

  it("retorna SHIPPING_RULE_NOT_FOUND quando o peso nao tem faixa", async () => {
    const admin = await createAdmin(app);
    await configureEngine(admin.token);
    const product = await makeProduct({ weightGrams: 50000 });
    const response = await quote({ cep: "13610000", items: [{ productId: product.id, quantity: 1 }] });
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("SHIPPING_RULE_NOT_FOUND");
  });

  it("aplica frete gratis no limite e acima do minimo", async () => {
    const admin = await createAdmin(app);
    await configureEngine(admin.token, { freeShippingEnabled: true, freeShippingMinimumOrderValue: 200 });
    const product = await makeProduct();

    const below = await makeQuote(admin.token, product.id, { items: [{ productId: product.id, quantity: 1 }] });
    const atLimit = await makeQuote(admin.token, product.id, { items: [{ productId: product.id, quantity: 2 }] });

    expect(below.options[0]!.price).toBe(24.9);
    expect(atLimit.options[0]!.price).toBe(0);
  });

  it("aplica excecao de CEP sobrescrevendo preco e prazo", async () => {
    const admin = await createAdmin(app);
    const { methodId } = await configureEngine(admin.token);
    const product = await makeProduct();

    const exception = await api(app, {
      method: "POST",
      url: "/api/admin/shipping/exceptions",
      token: admin.token,
      payload: { cep: "13610000", shippingMethodId: methodId, priceOverride: 9.9, deliveryDaysOverride: 1 },
    });
    expect(exception.status, JSON.stringify(exception.body)).toBe(201);

    const data = await makeQuote(admin.token, product.id);
    expect(data.options[0]!.price).toBe(9.9);
    expect(data.options[0]!.deliveryDays).toBe(1);
  });

  it("expõe status publico do motor sem segredos", async () => {
    const admin = await createAdmin(app);
    await configureEngine(admin.token);
    const status = await api(app, { method: "GET", url: "/api/shipping/engine/status" });
    expect(status.status).toBe(200);
    const data = status.body.data as { enabled: boolean; configured: boolean; activeZones: number; activeMethods: number };
    expect(data.enabled).toBe(true);
    expect(data.configured).toBe(true);
    expect(data.activeZones).toBe(1);
    expect(data.activeMethods).toBe(1);
  });
});

describe("Shipping Engine proprio v2 — admin", () => {
  it("exige ADMIN (RBAC)", async () => {
    const client = await createClient(app);
    const response = await api(app, {
      method: "PUT",
      url: "/api/admin/shipping/settings",
      token: client.accessToken,
      payload: { enabled: true },
    });
    expect([401, 403]).toContain(response.status);
  });

  it("bloqueia regioes com faixas sobrepostas", async () => {
    const admin = await createAdmin(app);
    const first = await api(app, {
      method: "POST",
      url: "/api/admin/shipping/zones",
      token: admin.token,
      payload: { name: "Zona A", zipCodeFrom: "13600000", zipCodeTo: "13699999" },
    });
    expect(first.status).toBe(201);
    const overlap = await api(app, {
      method: "POST",
      url: "/api/admin/shipping/zones",
      token: admin.token,
      payload: { name: "Zona B", zipCodeFrom: "13650000", zipCodeTo: "13799999" },
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error?.code).toBe("SHIPPING_CONFLICT");
  });

  it("bloqueia faixas de peso sobrepostas na mesma zona e modalidade", async () => {
    const admin = await createAdmin(app);
    const { zoneId, methodId } = await configureEngine(admin.token);
    const overlap = await api(app, {
      method: "POST",
      url: "/api/admin/shipping/rules",
      token: admin.token,
      payload: {
        zoneId,
        shippingMethodId: methodId,
        minWeightGrams: 3000,
        maxWeightGrams: 8000,
        price: 40,
        deliveryDays: 3,
      },
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.error?.code).toBe("SHIPPING_CONFLICT");
  });

  it("valida faixa de peso minima maior que a maxima", async () => {
    const admin = await createAdmin(app);
    const { zoneId, methodId } = await configureEngine(admin.token);
    const invalid = await api(app, {
      method: "POST",
      url: "/api/admin/shipping/rules",
      token: admin.token,
      payload: { zoneId, shippingMethodId: methodId, minWeightGrams: 2000, maxWeightGrams: 1000, price: 10 },
    });
    expect(invalid.status).toBe(422);
  });

  it("simula o frete mostrando as regras aplicadas", async () => {
    const admin = await createAdmin(app);
    const { ruleId } = await configureEngine(admin.token);
    const product = await makeProduct();

    const simulation = await api(app, {
      method: "POST",
      url: "/api/admin/shipping/simulate",
      token: admin.token,
      payload: { cep: "13610000", items: [{ productId: product.id, quantity: 2 }] },
    });

    expect(simulation.status, JSON.stringify(simulation.body)).toBe(200);
    const data = simulation.body.data as { appliedRules: Array<{ ruleId: string }>; weightGrams: number };
    expect(data.appliedRules[0]!.ruleId).toBe(ruleId);
    expect(data.weightGrams).toBe(1100);
  });

  it("registra auditoria ao criar modalidade", async () => {
    const admin = await createAdmin(app);
    await createMethod(admin.token, { name: "Auditada", code: "AUDIT" });
    const prisma = await db();
    const log = await prisma.adminAuditLog.findFirst({ where: { action: "shipping_method_created" } });
    expect(log).not.toBeNull();
  });
});

describe("Shipping Engine proprio v2 — validacao no pedido", () => {
  async function setupProduct(adminToken: string) {
    const product = await makeProduct();
    const quoteData = await makeQuote(adminToken, product.id);
    return { product, quoteData, methodId: quoteData.options[0]!.methodId };
  }

  it("cria o pedido com snapshot do frete usando o preco da cotacao", async () => {
    const admin = await createAdmin(app);
    await configureEngine(admin.token);
    const { product, quoteData, methodId } = await setupProduct(admin.token);

    const response = await api(app, {
      method: "POST",
      url: "/api/pedidos",
      payload: orderPayload({ produtos: [{ id: product.id, quantidade: 2 }], frete: { quoteId: quoteData.quoteId, methodId, valor: 0 } }),
    });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const pedido = (response.body.data as { pedido: Record<string, unknown> }).pedido;
    expect(pedido.frete_quote_id).toBe(quoteData.quoteId);
    expect(pedido.frete_metodo_id).toBe(methodId);
    expect(pedido.frete_metodo_codigo).toBe("STANDARD");
    expect(pedido.frete_prazo_dias).toBe(4);
    expect(pedido.frete_escolhido_valor).toBe(24.9);
    expect(pedido.subtotal).toBe(200);
    expect(pedido.total).toBe(224.9);
  });

  it("rejeita cotacao inexistente", async () => {
    const admin = await createAdmin(app);
    await configureEngine(admin.token);
    const product = await makeProduct();
    const response = await api(app, {
      method: "POST",
      url: "/api/pedidos",
      payload: orderPayload({ produtos: [{ id: product.id, quantidade: 2 }], frete: { quoteId: "inexistente", methodId: "m" } }),
    });
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("SHIPPING_QUOTE_NOT_FOUND");
  });

  it("rejeita cotacao expirada", async () => {
    const admin = await createAdmin(app);
    await configureEngine(admin.token);
    const { product, quoteData, methodId } = await setupProduct(admin.token);

    const prisma = await db();
    await prisma.shippingQuote.update({ where: { id: quoteData.quoteId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await api(app, {
      method: "POST",
      url: "/api/pedidos",
      payload: orderPayload({ produtos: [{ id: product.id, quantidade: 2 }], frete: { quoteId: quoteData.quoteId, methodId } }),
    });
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("SHIPPING_QUOTE_EXPIRED");
  });

  it("rejeita cotacao de outra sessao", async () => {
    const admin = await createAdmin(app);
    await configureEngine(admin.token);
    const { product, quoteData, methodId } = await setupProduct(admin.token);

    const response = await api(app, {
      method: "POST",
      url: "/api/pedidos",
      payload: orderPayload({
        produtos: [{ id: product.id, quantidade: 2 }],
        frete: { quoteId: quoteData.quoteId, methodId },
        sessionId: "sess-outra",
      }),
    });
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("SHIPPING_QUOTE_INVALID");
  });

  it("rejeita modalidade desativada apos a cotacao", async () => {
    const admin = await createAdmin(app);
    await configureEngine(admin.token);
    const { product, quoteData, methodId } = await setupProduct(admin.token);

    await api(app, { method: "PUT", url: `/api/admin/shipping/methods/${methodId}`, token: admin.token, payload: { active: false } });

    const response = await api(app, {
      method: "POST",
      url: "/api/pedidos",
      payload: orderPayload({ produtos: [{ id: product.id, quantidade: 2 }], frete: { quoteId: quoteData.quoteId, methodId } }),
    });
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("SHIPPING_QUOTE_INVALID");
  });

  it("rejeita quando o carrinho mudou desde a cotacao", async () => {
    const admin = await createAdmin(app);
    await configureEngine(admin.token);
    const { product, quoteData, methodId } = await setupProduct(admin.token);

    const response = await api(app, {
      method: "POST",
      url: "/api/pedidos",
      payload: orderPayload({ produtos: [{ id: product.id, quantidade: 1 }], frete: { quoteId: quoteData.quoteId, methodId } }),
    });
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("SHIPPING_QUOTE_EXPIRED");
  });

  it("é idempotente para duplo clique com a mesma cotacao", async () => {
    const admin = await createAdmin(app);
    await configureEngine(admin.token);
    const { product, quoteData, methodId } = await setupProduct(admin.token);
    const payload = orderPayload({ produtos: [{ id: product.id, quantidade: 2 }], frete: { quoteId: quoteData.quoteId, methodId } });

    const first = await api(app, { method: "POST", url: "/api/pedidos", payload });
    const second = await api(app, { method: "POST", url: "/api/pedidos", payload });

    expect(first.status).toBe(201);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const firstId = (first.body.data as { pedido: { id: number } }).pedido.id;
    const secondId = (second.body.data as { pedido: { id: number } }).pedido.id;
    expect(secondId).toBe(firstId);
  });
});
