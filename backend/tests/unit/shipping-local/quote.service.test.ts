import { describe, expect, it } from "vitest";
import { quoteLocalShipping } from "../../../src/shipping-local/application/quote.service";
import { selectWeightRule } from "../../../src/shipping-local/domain/rule";
import type {
  CreateQuoteInput,
  LocalShippingRepository,
  ProductLogistics,
  ShippingCepExceptionRecord,
  ShippingMethodRecord,
  ShippingSettingsRecord,
  ShippingWeightRuleRecord,
  ShippingZoneRecord,
} from "../../../src/shipping-local/domain/types";

const settings = (over: Partial<ShippingSettingsRecord> = {}): ShippingSettingsRecord => ({
  enabled: true,
  originZipCode: "13610000",
  packagePaddingGrams: null,
  defaultHandlingDays: null,
  defaultDeliveryDays: null,
  freeShippingEnabled: false,
  freeShippingMinimumOrderValue: null,
  showEstimateDisclaimer: true,
  configVersion: 1,
  ...over,
});

const product = (over: Partial<ProductLogistics> = {}): ProductLogistics => ({
  id: "p1",
  name: "Produto Teste",
  active: true,
  price: 100,
  weightGrams: 500,
  heightCm: 10,
  widthCm: 5,
  lengthCm: 2,
  hasShipping: true,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

const zone: ShippingZoneRecord = {
  id: "z1",
  name: "Zona Teste",
  description: null,
  state: "SP",
  zipCodeFrom: 10000000,
  zipCodeTo: 19999999,
  active: true,
  priority: 0,
};

const method = (over: Partial<ShippingMethodRecord> = {}): ShippingMethodRecord => ({
  id: "m1",
  name: "Frete Padrao",
  code: "STANDARD",
  description: "Entrega padrao",
  active: true,
  priority: 0,
  position: 0,
  ...over,
});

const weightRule = (over: Partial<ShippingWeightRuleRecord> = {}): ShippingWeightRuleRecord => ({
  id: "r1",
  zoneId: "z1",
  shippingMethodId: "m1",
  minWeightGrams: 0,
  maxWeightGrams: 5000,
  price: 24.9,
  deliveryDays: 4,
  estimatedMinBusinessDays: 5,
  estimatedMaxBusinessDays: 8,
  active: true,
  priority: 0,
  ...over,
});

function fakeRepo(over: Partial<LocalShippingRepository> = {}): LocalShippingRepository {
  const createQuote = async (input: CreateQuoteInput) => ({
    quoteId: "qt_test",
    expiresAt: input.expiresAt.toISOString(),
  });
  return {
    getSettings: async () => settings(),
    countActiveZones: async () => 1,
    findActiveZonesByZip: async () => [zone],
    findWeightRules: async () => [weightRule()],
    findActiveMethods: async () => [method()],
    findCepExceptions: async () => [],
    findProducts: async () => [product()],
    createQuote,
    ...over,
  };
}

async function expectErrorCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error("deveria ter falhado");
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
  }
}

describe("quoteLocalShipping (multi-modalidade)", () => {
  it("retorna as modalidades ativas com preco e prazo da regra", async () => {
    const result = await quoteLocalShipping(
      { cep: "13610-000", items: [{ productId: "p1", quantity: 2 }] },
      { repository: fakeRepo() },
    );

    expect(result.success).toBe(true);
    expect(result.quoteId).toBe("qt_test");
    expect(result.weightGrams).toBe(1000);
    expect(result.subtotal).toBe(200);
    expect(result.options).toHaveLength(1);
    expect(result.options[0]!.methodId).toBe("m1");
    expect(result.options[0]!.price).toBe(24.9);
    expect(result.options[0]!.deliveryDays).toBe(4);
  });

  it("aceita destinationZipCode (compatibilidade) e normaliza o CEP", async () => {
    const result = await quoteLocalShipping(
      { destinationZipCode: "13610000", items: [{ productId: "p1", quantity: 1 }] },
      { repository: fakeRepo() },
    );
    expect(result.normalizedZipCode).toBe("13610000");
  });

  it("ordena as modalidades por prioridade", async () => {
    const repo = fakeRepo({
      findActiveMethods: async () => [
        method({ id: "econ", name: "Economico", code: "ECONOMIC", priority: 0 }),
        method({ id: "exp", name: "Expresso", code: "EXPRESS", priority: 10 }),
      ],
      findWeightRules: async () => [
        weightRule({ id: "r-econ", shippingMethodId: "econ", price: 14.9, deliveryDays: 7 }),
        weightRule({ id: "r-exp", shippingMethodId: "exp", price: 34.9, deliveryDays: 2 }),
      ],
    });
    const result = await quoteLocalShipping(
      { cep: "13610000", items: [{ productId: "p1", quantity: 1 }] },
      { repository: repo },
    );
    expect(result.options.map((option) => option.methodId)).toEqual(["exp", "econ"]);
  });

  it("ignora modalidade sem regra de peso (nao inventa preco)", async () => {
    const repo = fakeRepo({
      findActiveMethods: async () => [
        method({ id: "econ", code: "ECONOMIC" }),
        method({ id: "exp", code: "EXPRESS" }),
      ],
      findWeightRules: async () => [weightRule({ id: "r-econ", shippingMethodId: "econ" })],
    });
    const result = await quoteLocalShipping(
      { cep: "13610000", items: [{ productId: "p1", quantity: 1 }] },
      { repository: repo },
    );
    expect(result.options).toHaveLength(1);
    expect(result.options[0]!.methodId).toBe("econ");
  });

  it("retorna SHIPPING_ENGINE_DISABLED quando o motor esta desligado", async () => {
    await expectErrorCode(
      quoteLocalShipping(
        { cep: "13610000", items: [{ productId: "p1", quantity: 1 }] },
        { repository: fakeRepo({ getSettings: async () => settings({ enabled: false }) }) },
      ),
      "SHIPPING_ENGINE_DISABLED",
    );
  });

  it("retorna SHIPPING_NOT_CONFIGURED quando nao ha zonas", async () => {
    await expectErrorCode(
      quoteLocalShipping(
        { cep: "13610000", items: [{ productId: "p1", quantity: 1 }] },
        { repository: fakeRepo({ countActiveZones: async () => 0, findActiveZonesByZip: async () => [] }) },
      ),
      "SHIPPING_NOT_CONFIGURED",
    );
  });

  it("retorna SHIPPING_ZONE_NOT_FOUND para CEP fora da cobertura", async () => {
    await expectErrorCode(
      quoteLocalShipping(
        { cep: "99999999", items: [{ productId: "p1", quantity: 1 }] },
        { repository: fakeRepo({ findActiveZonesByZip: async () => [] }) },
      ),
      "SHIPPING_ZONE_NOT_FOUND",
    );
  });

  it("retorna SHIPPING_RULE_NOT_FOUND quando nenhuma modalidade tem faixa", async () => {
    await expectErrorCode(
      quoteLocalShipping(
        { cep: "13610000", items: [{ productId: "p1", quantity: 1 }] },
        { repository: fakeRepo({ findWeightRules: async () => [] }) },
      ),
      "SHIPPING_RULE_NOT_FOUND",
    );
  });

  it("retorna PRODUCT_WEIGHT_MISSING (nunca assume 1kg)", async () => {
    await expectErrorCode(
      quoteLocalShipping(
        { cep: "13610000", items: [{ productId: "p1", quantity: 1 }] },
        { repository: fakeRepo({ findProducts: async () => [product({ weightGrams: null })] }) },
      ),
      "PRODUCT_WEIGHT_MISSING",
    );
  });

  it("retorna INVALID_QUANTITY para quantidade invalida", async () => {
    await expectErrorCode(
      quoteLocalShipping(
        { cep: "13610000", items: [{ productId: "p1", quantity: 0 }] },
        { repository: fakeRepo() },
      ),
      "INVALID_QUANTITY",
    );
  });

  it("aplica frete gratis no limite e acima do minimo", async () => {
    const repo = fakeRepo({
      getSettings: async () =>
        settings({ freeShippingEnabled: true, freeShippingMinimumOrderValue: 200 }),
    });

    const below = await quoteLocalShipping(
      { cep: "13610000", items: [{ productId: "p1", quantity: 1 }] },
      { repository: repo },
    );
    const atLimit = await quoteLocalShipping(
      { cep: "13610000", items: [{ productId: "p1", quantity: 2 }] },
      { repository: repo },
    );

    expect(below.isFreeShipping).toBe(false);
    expect(below.options[0]!.price).toBe(24.9);
    expect(atLimit.isFreeShipping).toBe(true);
    expect(atLimit.options[0]!.price).toBe(0);
  });

  it("nao aplica frete gratis quando o admin nao configurou", async () => {
    const result = await quoteLocalShipping(
      { cep: "13610000", items: [{ productId: "p1", quantity: 1 }] },
      { repository: fakeRepo() },
    );
    expect(result.isFreeShipping).toBe(false);
    expect(result.options[0]!.price).toBe(24.9);
  });

  it("aplica excecao de CEP sobrescrevendo preco e prazo", async () => {
    const repo = fakeRepo({
      findCepExceptions: async (): Promise<ShippingCepExceptionRecord[]> => [
        {
          id: "x1",
          cep: "13610000",
          shippingMethodId: "m1",
          priceOverride: 9.9,
          deliveryDaysOverride: 1,
          active: true,
        },
      ],
    });
    const result = await quoteLocalShipping(
      { cep: "13610000", items: [{ productId: "p1", quantity: 1 }] },
      { repository: repo },
    );
    expect(result.options[0]!.price).toBe(9.9);
    expect(result.options[0]!.deliveryDays).toBe(1);
  });

  it("usa prazo padrao configurado quando a regra nao define prazo", async () => {
    const repo = fakeRepo({
      getSettings: async () => settings({ defaultDeliveryDays: 6 }),
      findWeightRules: async () => [
        weightRule({ deliveryDays: null, estimatedMinBusinessDays: null, estimatedMaxBusinessDays: null }),
      ],
    });
    const result = await quoteLocalShipping(
      { cep: "13610000", items: [{ productId: "p1", quantity: 1 }] },
      { repository: repo },
    );
    expect(result.options[0]!.deliveryDays).toBe(6);
  });

  it("quando nenhum item exige frete, retorna opcao sem custo", async () => {
    const repo = fakeRepo({
      findProducts: async () => [product({ hasShipping: false })],
    });
    const result = await quoteLocalShipping(
      { cep: "13610000", items: [{ productId: "p1", quantity: 1 }] },
      { repository: repo },
    );
    expect(result.requiresShipping).toBe(false);
    expect(result.options).toHaveLength(1);
    expect(result.options[0]!.price).toBe(0);
  });

  it("ignora preco/peso enviados pelo cliente (seguranca)", async () => {
    const result = await quoteLocalShipping(
      {
        cep: "13610000",
        items: [{ productId: "p1", quantity: 1 }],
        ...({ price: 0, valor: 0, peso_unitario: 1, weight: 999 } as Record<string, unknown>),
      },
      { repository: fakeRepo() },
    );
    expect(result.options[0]!.price).toBe(24.9);
  });

  it("selectWeightRule escolhe a faixa que contem o peso", () => {
    const rules = [
      weightRule({ id: "a", minWeightGrams: 0, maxWeightGrams: 1000 }),
      weightRule({ id: "b", minWeightGrams: 1001, maxWeightGrams: 3000, priority: 1 }),
    ];
    expect(selectWeightRule(rules, 1001)?.id).toBe("b");
    expect(selectWeightRule(rules, 5000)).toBeNull();
  });
});
