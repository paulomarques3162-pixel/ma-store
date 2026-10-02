import { describe, expect, it } from "vitest";
import {
  InMemoryShippingCache,
  buildCacheKey,
  type ShippingQuoteRequest,
} from "../../../src/shipping-engine/index.js";

function request(overrides: Partial<ShippingQuoteRequest> = {}): ShippingQuoteRequest {
  return {
    storeId: "loja-1",
    origin: { postalCode: "01310100" },
    destination: { postalCode: "20040020" },
    packages: [{ weightGrams: 1000, heightCm: 10, widthCm: 20, lengthCm: 30 }],
    ...overrides,
  };
}

describe("InMemoryShippingCache", () => {
  it("respeita o TTL", () => {
    let now = 0;
    const cache = new InMemoryShippingCache(() => now);
    cache.set("k", [], 1000);
    expect(cache.get("k")).toEqual([]);
    now = 1001;
    expect(cache.get("k")).toBeUndefined();
  });

  it("ignora TTL zero e limpa", () => {
    const cache = new InMemoryShippingCache();
    cache.set("k", [], 0);
    expect(cache.size()).toBe(0);
    cache.set("k2", [], 1000);
    cache.clear();
    expect(cache.size()).toBe(0);
  });
});

describe("buildCacheKey", () => {
  it("é determinística e sensível a CEP/provedor/serviços", () => {
    const base = buildCacheKey({ storeId: "loja-1", provider: "correios", request: request() });
    expect(base).toBe(buildCacheKey({ storeId: "loja-1", provider: "correios", request: request() }));
    expect(base).not.toBe(buildCacheKey({ storeId: "loja-2", provider: "correios", request: request() }));
    expect(base).not.toBe(buildCacheKey({ storeId: "loja-1", provider: "jadlog", request: request() }));
    expect(base).not.toBe(
      buildCacheKey({ storeId: "loja-1", provider: "correios", request: request({ destination: { postalCode: "30130010" } }) }),
    );
    expect(base).not.toBe(
      buildCacheKey({ storeId: "loja-1", provider: "correios", request: request({ services: ["PAC"] }) }),
    );
  });

  it("muda quando a configuração relevante muda", () => {
    const a = buildCacheKey({ storeId: "loja-1", provider: "correios", request: request(), configFingerprint: "a" });
    const b = buildCacheKey({ storeId: "loja-1", provider: "correios", request: request(), configFingerprint: "b" });
    expect(a).not.toBe(b);
  });
});
