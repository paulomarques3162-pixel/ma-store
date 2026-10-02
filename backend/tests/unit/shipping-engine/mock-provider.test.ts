import { describe, expect, it } from "vitest";
import {
  MockShippingProvider,
  ShippingError,
  type ShippingQuoteRequest,
} from "../../../src/shipping-engine/index.js";

function request(overrides: Partial<ShippingQuoteRequest> = {}): ShippingQuoteRequest {
  return {
    storeId: "loja-1",
    origin: { postalCode: "01310-100" },
    destination: { postalCode: "20040-020" },
    packages: [{ weightGrams: 1000, heightCm: 10, widthCm: 20, lengthCm: 30 }],
    ...overrides,
  };
}

describe("MockShippingProvider", () => {
  it("cota todos os serviços por padrão e devolve o formato canônico", async () => {
    const provider = new MockShippingProvider();
    const quotes = await provider.getQuotes(request());

    expect(quotes).toHaveLength(2);
    const [standard] = quotes;
    expect(standard).toBeDefined();
    expect(standard!.carrier).toBe("mock");
    expect(standard!.serviceCode).toBe("MOCK-STD");
    expect(standard!.type).toBe("STANDARD");
    expect(standard!.currency).toBe("BRL");
    expect(standard!.origin.postalCode).toBe("01310100");
    expect(standard!.destination.postalCode).toBe("20040020");
    expect(standard!.trace.length).toBeGreaterThan(0);
  });

  it("filtra pelos serviços pedidos", async () => {
    const provider = new MockShippingProvider();
    const quotes = await provider.getQuotes(request({ services: ["MOCK-EXP"] }));

    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.type).toBe("EXPRESS");
  });

  it("propaga falha simulada", async () => {
    const provider = new MockShippingProvider({ failWith: "PROVIDER_TIMEOUT" });

    await expect(provider.getQuotes(request())).rejects.toBeInstanceOf(ShippingError);
    await expect(provider.getQuotes(request())).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });

  it("rejeita CEP inválido", async () => {
    const provider = new MockShippingProvider();
    await expect(provider.getQuotes(request({ destination: { postalCode: "abc" } }))).rejects.toMatchObject({
      code: "INVALID_POSTAL_CODE",
    });
  });

  it("responde ao health check", async () => {
    await expect(new MockShippingProvider().healthCheck()).resolves.toMatchObject({ status: "healthy" });
    await expect(new MockShippingProvider({ enabled: false }).healthCheck()).resolves.toMatchObject({
      status: "not_configured",
    });
    await expect(new MockShippingProvider({ failWith: "PROVIDER_UNAVAILABLE" }).healthCheck()).resolves.toMatchObject({
      status: "unavailable",
    });
  });
});
