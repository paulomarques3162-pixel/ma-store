import { describe, expect, it } from "vitest";
import {
  CorreiosClient,
  type CorreiosConfig,
  type HttpResponseLike,
} from "../../../src/shipping-engine/index.js";

function json(body: unknown, status = 200): HttpResponseLike {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

function baseConfig(overrides: Partial<CorreiosConfig> = {}): CorreiosConfig {
  return {
    enabled: true,
    environment: "production",
    baseUrl: "https://api.correios.com.br",
    auth: { mode: "pre-generated-token", token: "tkn" },
    originPostalCode: "01310100",
    services: [{ code: "04510", name: "PAC", type: "STANDARD" }],
    declaredValueEnabled: true,
    timeoutMs: 5000,
    ...overrides,
  };
}

describe("CorreiosClient", () => {
  it("consulta preço (em gramas) e prazo", async () => {
    const calls: string[] = [];
    const client = new CorreiosClient(baseConfig(), async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.includes("/preco/")) return json({ pcFinal: "25,90" });
      if (url.includes("/prazo/")) return json({ prazoEntrega: 7 });
      return json({}, 404);
    });

    const price = await client.getPrice({
      serviceCode: "04510",
      origin: "01310100",
      destination: "20040020",
      weightGrams: 1000,
      heightCm: 10,
      widthCm: 20,
      lengthCm: 30,
    });
    expect(price.price).toBe(25.9);

    const priceCall = calls.find((call) => call.includes("/preco/"));
    expect(priceCall).toContain("psObjeto=1000");
    expect(priceCall).toContain("tpObjeto=2");
    expect(priceCall).toContain("comprimento=30");
    expect(priceCall).toContain("largura=20");
    expect(priceCall).toContain("altura=10");

    const deadline = await client.getDeadline({ serviceCode: "04510", origin: "01310100", destination: "20040020" });
    expect(deadline.deliveryDays).toBe(7);
  });

  it("autentica com Basic quando não há token pré-gerado", async () => {
    let authHeader = "";
    const client = new CorreiosClient(
      baseConfig({ auth: { mode: "id-correios", username: "user", password: "pass" } }),
      async (url, init) => {
        if (url.includes("/token/")) {
          authHeader = init?.headers?.Authorization ?? "";
          return json({ token: "novo", expiraEm: "2099-01-01T00:00:00Z" });
        }
        return json({ pcFinal: "10,00" });
      },
    );

    await client.getPrice({
      serviceCode: "04510",
      origin: "01310100",
      destination: "20040020",
      weightGrams: 500,
      heightCm: 5,
      widthCm: 5,
      lengthCm: 5,
    });
    expect(authHeader).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);
  });

  it("traduz status HTTP para códigos padronizados", async () => {
    const unauthorized = new CorreiosClient(
      baseConfig({ auth: { mode: "id-correios", username: "u", password: "p" } }),
      async () => json({}, 401),
    );
    await expect(unauthorized.getToken()).rejects.toMatchObject({ code: "PROVIDER_AUTH_ERROR" });

    const limited = new CorreiosClient(baseConfig(), async (url) =>
      url.includes("/preco/") ? json({}, 429) : json({}, 404),
    );
    await expect(
      limited.getPrice({ serviceCode: "04510", origin: "01310100", destination: "20040020", weightGrams: 100, heightCm: 5, widthCm: 5, lengthCm: 5 }),
    ).rejects.toMatchObject({ code: "RATE_LIMITED" });

    const down = new CorreiosClient(baseConfig(), async (url) =>
      url.includes("/preco/") ? json({}, 503) : json({}, 404),
    );
    await expect(
      down.getPrice({ serviceCode: "04510", origin: "01310100", destination: "20040020", weightGrams: 100, heightCm: 5, widthCm: 5, lengthCm: 5 }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  });
});
