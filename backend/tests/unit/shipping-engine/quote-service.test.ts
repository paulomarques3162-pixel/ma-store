import { describe, expect, it } from "vitest";
import {
  CircuitBreaker,
  InMemoryShippingCache,
  InMemoryShippingMetrics,
  InMemoryStoreShippingConfigRepository,
  MockShippingProvider,
  ShippingQuoteService,
  createEngineProviderFactory,
  createStoreShippingConfig,
  providerUnavailable,
  type ShippingProvider,
  type ShippingProviderHealth,
  type ShippingQuote,
  type ShippingQuoteRequest,
} from "../../../src/shipping-engine/index.js";

class FailingProvider implements ShippingProvider {
  readonly id = "failing";
  readonly name = "Failing";
  readonly capabilities = {
    quotes: true,
    tracking: false,
    labels: false,
    declaredValue: false,
    environments: ["production"] as Array<"sandbox" | "production">,
  };

  async getQuotes(): Promise<ShippingQuote[]> {
    throw providerUnavailable();
  }

  async healthCheck(): Promise<ShippingProviderHealth> {
    return { provider: this.id, status: "unavailable" };
  }
}

function request(overrides: Partial<ShippingQuoteRequest> = {}): ShippingQuoteRequest {
  return {
    storeId: "loja-1",
    origin: { postalCode: "01310100" },
    destination: { postalCode: "20040020" },
    packages: [{ weightGrams: 1000, heightCm: 10, widthCm: 20, lengthCm: 30 }],
    ...overrides,
  };
}

function buildService(config = createStoreShippingConfig({ storeId: "loja-1" }), cache = new InMemoryShippingCache()) {
  const factory = createEngineProviderFactory({
    mock: new MockShippingProvider({ id: "mock" }),
    extra: [new FailingProvider()],
  });
  return new ShippingQuoteService({
    providers: factory,
    configRepository: new InMemoryStoreShippingConfigRepository([config]),
    cache,
    breaker: new CircuitBreaker(),
    metrics: new InMemoryShippingMetrics(),
    policy: { timeoutMs: 1000, maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });
}

describe("ShippingQuoteService", () => {
  it("cota via provedores e normaliza a resposta", async () => {
    const service = buildService();
    const result = await service.quote(request());

    expect(result.success).toBe(true);
    expect(result.quotes.length).toBeGreaterThan(0);
    expect(result.quotes[0]!.estimatedDeliveryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.meta.providers).toContain("mock");
  });

  it("isola falha de um provedor sem derrubar os demais", async () => {
    const service = buildService();
    const result = await service.quote(request());

    expect(result.quotes.some((quote) => quote.carrier === "mock")).toBe(true);
    expect(result.errors.some((error) => error.provider === "failing")).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("aplica frete grátis da loja", async () => {
    const service = buildService(
      createStoreShippingConfig({
        storeId: "loja-1",
        freeShipping: { enabled: true, minimumOrderValue: 100 },
      }),
    );
    const result = await service.quote(request({ orderValue: 250 }));
    expect(result.quotes.every((quote) => quote.price === 0)).toBe(true);
    expect(result.quotes[0]!.appliedRules).toContain("freeShipping");
  });

  it("usa cache na segunda consulta idêntica", async () => {
    const cache = new InMemoryShippingCache();
    const service = buildService(createStoreShippingConfig({ storeId: "loja-1" }), cache);

    const first = await service.quote(request());
    const second = await service.quote(request());

    expect(first.meta.cacheHit).toBe(false);
    expect(second.meta.cacheHit).toBe(true);
  });

  it("valida a requisição sem consultar provedores", () => {
    const service = buildService();
    const validated = service.validate(request());
    expect(validated.origin).toBe("01310100");
    expect(validated.destination).toBe("20040020");
    expect(validated.packages).toHaveLength(1);
  });

  it("lista provedores, serviços e health", async () => {
    const service = buildService();
    expect((await service.listProviders()).map((provider) => provider.id).sort()).toEqual(["failing", "mock"]);
    expect((await service.listServices()).some((service2) => service2.provider === "mock")).toBe(true);
    const health = await service.health();
    expect(health.providers.mock).toBe("healthy");
  });
});
