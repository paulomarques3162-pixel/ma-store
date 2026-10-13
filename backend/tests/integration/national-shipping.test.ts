import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { api, db, makeApp, resetDatabase } from "../helpers";
import { validateNationalTable } from "../../src/shipping-local/bootstrap/national-table";
import { installNationalShippingTable } from "../../src/shipping-local/bootstrap/prisma-store";
import { NATIONAL_METHODS, NATIONAL_ZONES } from "../../src/shipping-local/bootstrap/national-table";

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

async function install() {
  return installNationalShippingTable(await db());
}

async function makeProduct(over: Record<string, unknown> = {}) {
  const prisma = await db();
  return prisma.product.create({
    data: {
      name: "Perfume Nacional 100ml",
      slug: `nacional-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      sku: `NAC-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      price: "100.00",
      stock: 50,
      weightGrams: 1500,
      hasShipping: true,
      active: true,
      ...over,
    },
  });
}

async function quote(cep: string, productId: string, quantity = 1) {
  const response = await api(app, {
    method: "POST",
    url: "/api/shipping/quote",
    payload: { cep, sessionId: "sess-nacional", items: [{ productId, quantity }] },
  });
  return response;
}

type QuoteData = {
  zone: { id: string; name: string } | null;
  weightGrams: number;
  subtotal: number;
  isFreeShipping: boolean;
  options: Array<{ code: string | null; price: number; deliveryDays: number | null }>;
};

describe("tabela nacional de frete — instalacao automatica", () => {
  it("instala zonas, modalidades, regras e configuracoes no primeiro boot", async () => {
    const validation = validateNationalTable();
    const result = await install();

    expect(result.skipped).toBe(false);
    expect(result.methodsCreated).toBe(NATIONAL_METHODS.length);
    expect(result.zonesCreated).toBe(NATIONAL_ZONES.length);
    expect(result.rulesCreated).toBe(validation.rules);
    expect(result.settingsCreated).toBe(true);

    const prisma = await db();
    expect(await prisma.shippingMethod.count({ where: { active: true } })).toBe(NATIONAL_METHODS.length);
    expect(await prisma.shippingZone.count({ where: { active: true } })).toBe(NATIONAL_ZONES.length);
    expect(await prisma.shippingWeightRule.count()).toBe(validation.rules);

    const settings = await prisma.shippingSettings.findUnique({ where: { id: "default" } });
    expect(settings?.enabled).toBe(true);
    expect(settings?.originZipCodeProvisional).toBe(true);
    expect(settings?.originZipCode).toBe("01001000");
    expect(settings?.freeShippingEnabled).toBe(true);
  });

  it("cobre as 27 UFs e nao duplica regras ao reinstalar", async () => {
    await install();
    const prisma = await db();
    const firstVersion = (await prisma.shippingSettings.findUnique({ where: { id: "default" } }))!.configVersion;

    const second = await install();
    expect(second.zonesCreated).toBe(0);
    expect(second.rulesCreated).toBe(0);
    expect(second.methodsCreated).toBe(0);
    expect(second.settingsCreated).toBe(false);

    expect(await prisma.shippingZone.count()).toBe(NATIONAL_ZONES.length);
    expect(await prisma.shippingWeightRule.count()).toBe(validateNationalTable().rules);
    const states = new Set((await prisma.shippingZone.findMany()).map((zone) => zone.state));
    expect(states.size).toBe(27);

    const afterVersion = (await prisma.shippingSettings.findUnique({ where: { id: "default" } }))!.configVersion;
    expect(afterVersion).toBe(firstVersion);
  });

  it("preserva o preco editado pelo administrador na reinstalacao", async () => {
    await install();
    const prisma = await db();
    const rule = await prisma.shippingWeightRule.findFirstOrThrow({
      where: { seedKey: { not: null } },
    });
    await prisma.shippingWeightRule.update({ where: { id: rule.id }, data: { price: "999.99" } });

    await install();
    const after = await prisma.shippingWeightRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(after.price.toString()).toBe("999.99");
  });

  it("nao aplica a tabela inicial quando ja existem zonas do administrador", async () => {
    const prisma = await db();
    await prisma.shippingZone.create({
      data: { name: "Zona própria", state: "SP", zipCodeFrom: 10000000, zipCodeTo: 19999999 },
    });

    const result = await install();
    expect(result.skipped).toBe(true);
    expect(result.customZonesDetected).toBe(1);
    expect(await prisma.shippingZone.count()).toBe(1);
    expect(await prisma.shippingWeightRule.count()).toBe(0);
  });
});

describe("tabela nacional de frete — calculo no checkout", () => {
  it("calcula preco por regiao e por peso (backend, sem confiar no frontend)", async () => {
    await install();
    const product = await makeProduct();

    const spCapital = await quote("01310-100", product.id);
    const amazonas = await quote("69900-000", product.id);
    expect(spCapital.status, JSON.stringify(spCapital.body)).toBe(200);
    expect(amazonas.status, JSON.stringify(amazonas.body)).toBe(200);

    const spData = spCapital.body.data as QuoteData;
    const amData = amazonas.body.data as QuoteData;

    expect(spData.options).toHaveLength(NATIONAL_METHODS.length);
    expect(amData.options).toHaveLength(NATIONAL_METHODS.length);
    expect(spData.zone?.name).toContain("Capital");
    expect(amData.zone?.name).toBe("Acre");

    const spEconomic = spData.options.find((option) => option.code === "ECONOMIC")!;
    const amEconomic = amData.options.find((option) => option.code === "ECONOMIC")!;
    expect(spEconomic.price).toBe(24.9); // faixa 1001-3000g, SP capital
    expect(amEconomic.price).toBeGreaterThan(spEconomic.price);
    expect(amEconomic.deliveryDays!).toBeGreaterThan(spEconomic.deliveryDays!);
  });

  it("recalcula quando o peso do item muda (faixa diferente)", async () => {
    await install();
    const light = await makeProduct({ weightGrams: 200, price: "50.00" });
    const heavy = await makeProduct({ weightGrams: 1500, price: "50.00" });

    const lightQuote = (await quote("01310-100", light.id)).body.data as QuoteData;
    const heavyQuote = (await quote("01310-100", heavy.id)).body.data as QuoteData;

    const lightPrice = lightQuote.options.find((option) => option.code === "ECONOMIC")!.price;
    const heavyPrice = heavyQuote.options.find((option) => option.code === "ECONOMIC")!.price;
    expect(heavyPrice).toBeGreaterThan(lightPrice);
  });

  it("aplica frete gratis acima do limite comercial inicial", async () => {
    await install();
    const product = await makeProduct({ price: "100.00" });

    const below = (await quote("01310-100", product.id, 1)).body.data as QuoteData;
    const above = (await quote("01310-100", product.id, 2)).body.data as QuoteData;

    expect(below.subtotal).toBe(100);
    expect(below.isFreeShipping).toBe(false);
    expect(below.options.every((option) => option.price > 0)).toBe(true);

    expect(above.subtotal).toBe(200);
    expect(above.isFreeShipping).toBe(true);
    expect(above.options.every((option) => option.price === 0)).toBe(true);
  });

  it("rejeita CEP invalido e CEP sem cobertura", async () => {
    await install();
    const product = await makeProduct();

    const invalid = await quote("123", product.id);
    expect(invalid.status).toBe(422);
    expect(invalid.body.error?.code).toBe("INVALID_ZIP_CODE");

    const uncovered = await quote("10000-000", product.id);
    expect(uncovered.status).toBe(422);
    expect(uncovered.body.error?.code).toBe("SHIPPING_ZONE_NOT_FOUND");
  });

  it("nao inventa peso para produto sem peso configurado", async () => {
    await install();
    const product = await makeProduct({ weightGrams: null });

    const response = await quote("01310-100", product.id);
    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe("PRODUCT_WEIGHT_MISSING");
  });

  it("resolve limites das faixas de CEP", async () => {
    await install();
    const product = await makeProduct();

    const lastCapital = (await quote("05999-999", product.id)).body.data as QuoteData;
    const firstMetro = (await quote("06000-000", product.id)).body.data as QuoteData;
    expect(lastCapital.zone?.name).toContain("Capital");
    expect(firstMetro.zone?.name).toContain("Grande São Paulo");
  });
});
