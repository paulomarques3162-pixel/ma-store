import Fastify from "fastify";
import { beforeAll, describe, expect, it } from "vitest";
import {
  InMemoryStoreShippingConfigRepository,
  MockShippingProvider,
  ShippingQuoteService,
  createEngineProviderFactory,
  createStoreShippingConfig,
  registerShippingEngineRoutes,
} from "../../../src/shipping-engine/index.js";

let app: ReturnType<typeof Fastify>;

beforeAll(async () => {
  const service = new ShippingQuoteService({
    providers: createEngineProviderFactory({ mock: new MockShippingProvider() }),
    configRepository: new InMemoryStoreShippingConfigRepository([
      createStoreShippingConfig({ storeId: "loja-1" }),
    ]),
    policy: { timeoutMs: 1000, maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });
  app = Fastify();
  await app.register(registerShippingEngineRoutes, { service });
  await app.ready();
});

const payload = {
  storeId: "loja-1",
  origin: { postalCode: "01310100" },
  destination: { postalCode: "20040020" },
  packages: [{ weightGrams: 1000, heightCm: 10, widthCm: 20, lengthCm: 30, quantity: 1 }],
};

describe("rotas do Shipping Engine", () => {
  it("POST /quotes devolve o envelope { success, data }", async () => {
    const response = await app.inject({ method: "POST", url: "/quotes", payload });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
    expect(body.data.quotes.length).toBeGreaterThan(0);
    expect(body.data.meta).toBeDefined();
  });

  it("rejeita CEP inválido com 422 e código padronizado", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/quotes",
      payload: { ...payload, destination: { postalCode: "abc" } },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe("INVALID_POSTAL_CODE");
  });

  it("rejeita payload inválido com 400", async () => {
    const response = await app.inject({ method: "POST", url: "/quotes", payload: { storeId: "x" } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("INVALID_REQUEST");
  });

  it("expõe providers, services, health e validate", async () => {
    expect((await app.inject({ method: "GET", url: "/providers" })).json().data.providers).toHaveLength(1);
    expect((await app.inject({ method: "GET", url: "/services" })).json().data.services.length).toBeGreaterThan(0);
    expect((await app.inject({ method: "GET", url: "/health" })).json().status).toBe("ok");
    expect((await app.inject({ method: "GET", url: "/providers/mock/health" })).json().status).toBe("healthy");
    const validated = await app.inject({ method: "POST", url: "/validate", payload });
    expect(validated.json().data.origin).toBe("01310100");
  });

  it("serve o contrato OpenAPI", async () => {
    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(response.statusCode).toBe(200);
    expect(response.json().openapi).toBe("3.0.3");
  });
});
