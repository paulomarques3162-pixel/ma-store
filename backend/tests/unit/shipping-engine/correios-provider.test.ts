import { describe, expect, it } from "vitest";
import {
  CorreiosProvider,
  type CorreiosConfig,
  type HttpResponseLike,
  type ShippingQuoteRequest,
} from "../../../src/shipping-engine/index.js";

function json(body: unknown, status = 200): HttpResponseLike {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function configured(overrides: Partial<CorreiosConfig> = {}): CorreiosConfig {
  return {
    enabled: true,
    environment: "production",
    baseUrl: "https://api.correios.com.br",
    auth: { mode: "pre-generated-token", token: "tkn" },
    originPostalCode: "01310100",
    services: [
      { code: "04510", name: "PAC", type: "STANDARD" },
      { code: "04014", name: "SEDEX", type: "EXPRESS" },
    ],
    declaredValueEnabled: true,
    timeoutMs: 5000,
    ...overrides,
  };
}

function fakeFetch(): (url: string, init?: { method?: string; body?: string }) => Promise<HttpResponseLike> {
  return async (url, init) => {
    if (url.includes("/preco/")) {
      const code = url.split("/nacional/")[1]?.split("?")[0];
      return json({ pcFinal: code === "04510" ? "25,90" : "39,90" });
    }
    if (url.includes("/prazo/")) {
      const body = JSON.parse(init?.body ?? "{}") as { parametrosPrazo: Array<{ coProduto: string }> };
      const code = body.parametrosPrazo[0]?.coProduto;
      return json({ prazoEntrega: code === "04510" ? 7 : 3 });
    }
    return json({}, 404);
  };
}

function request(packages: ShippingQuoteRequest["packages"] = [
  { weightGrams: 1000, heightCm: 10, widthCm: 20, lengthCm: 30 },
]): ShippingQuoteRequest {
  return {
    storeId: "loja-1",
    origin: { postalCode: "01310100" },
    destination: { postalCode: "20040020" },
    packages,
  };
}

describe("CorreiosProvider", () => {
  it("cota PAC e SEDEX com preço e prazo reais normalizados", async () => {
    const provider = new CorreiosProvider(configured(), fakeFetch());
    const quotes = await provider.getQuotes(request());

    expect(quotes).toHaveLength(2);
    const pac = quotes.find((quote) => quote.serviceCode === "04510");
    const sedex = quotes.find((quote) => quote.serviceCode === "04014");
    expect(pac?.price).toBe(25.9);
    expect(pac?.deliveryDays).toBe(7);
    expect(pac?.type).toBe("STANDARD");
    expect(sedex?.price).toBe(39.9);
    expect(sedex?.type).toBe("EXPRESS");
    expect(quotes[0]!.estimatedDeliveryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("soma o preço por volume (não multiplica um único pacote)", async () => {
    const provider = new CorreiosProvider(configured(), fakeFetch());
    const quotes = await provider.getQuotes(
      request([
        { weightGrams: 1000, heightCm: 10, widthCm: 20, lengthCm: 30 },
        { weightGrams: 500, heightCm: 5, widthCm: 10, lengthCm: 15 },
      ]),
    );
    const pac = quotes.find((quote) => quote.serviceCode === "04510");
    expect(pac?.price).toBe(51.8);
  });

  it("filtra pelos serviços pedidos", async () => {
    const provider = new CorreiosProvider(configured(), fakeFetch());
    const quotes = await provider.getQuotes({ ...request(), services: ["SEDEX"] });
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.serviceName).toBe("SEDEX");
  });

  it("não oferta nada sem credenciais/CEP de origem", async () => {
    const provider = new CorreiosProvider(configured({ auth: { mode: "id-correios" } }), fakeFetch());
    expect(await provider.getQuotes(request())).toEqual([]);
    await expect(provider.healthCheck()).resolves.toMatchObject({ status: "not_configured" });
  });
});
