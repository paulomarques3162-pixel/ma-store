import { describe, expect, it } from "vitest";
import {
  applyStorePricing,
  isFreeShippingEligible,
  type StoreShippingConfig,
} from "../../../src/shipping-engine/index.js";

function config(overrides: Partial<StoreShippingConfig> = {}): StoreShippingConfig {
  return {
    storeId: "loja-1",
    originPostalCode: null,
    providers: [],
    pricing: {},
    freeShipping: { enabled: false, minimumOrderValue: null },
    declaredValueEnabled: true,
    ...overrides,
  };
}

const service = { serviceCode: "04510", serviceName: "PAC" };

describe("applyStorePricing", () => {
  it("aplica taxa fixa e percentual", () => {
    expect(applyStorePricing(24.9, config({ pricing: { fee: { type: "fixed", value: 5 } } }), service).price).toBe(29.9);
    expect(
      applyStorePricing(100, config({ pricing: { fee: { type: "percent", value: 10 } } }), service).price,
    ).toBe(110);
  });

  it("aplica subsídio sem deixar preço negativo", () => {
    expect(applyStorePricing(24.9, config({ pricing: { subsidy: { type: "fixed", value: 10 } } }), service).price).toBe(14.9);
    expect(applyStorePricing(5, config({ pricing: { subsidy: { type: "fixed", value: 10 } } }), service).price).toBe(0);
  });

  it("zera o frete quando a regra de frete grátis se aplica", () => {
    const result = applyStorePricing(
      24.9,
      config({ freeShipping: { enabled: true, minimumOrderValue: 199.9 } }),
      service,
      { orderValue: 250 },
    );
    expect(result.price).toBe(0);
    expect(result.freeShippingApplied).toBe(true);
    expect(result.appliedRules).toContain("freeShipping");
  });

  it("não aplica frete grátis abaixo do mínimo nem fora da região/serviço", () => {
    const rule = { enabled: true, minimumOrderValue: 199.9 };
    expect(isFreeShippingEligible(rule, service, { orderValue: 100 })).toBe(false);
    expect(isFreeShippingEligible(rule, service, { orderValue: 250 })).toBe(true);
    expect(
      isFreeShippingEligible({ ...rule, services: ["SEDEX"] }, service, { orderValue: 250 }),
    ).toBe(false);
    expect(
      isFreeShippingEligible({ ...rule, regionPrefixes: ["13"] }, service, {
        orderValue: 250,
        destinationPostalCode: "20040020",
      }),
    ).toBe(false);
  });
});
