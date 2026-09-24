import { describe, expect, it } from "vitest";
import { ShippingClient, ShippingClientError } from "../../../src/shipping-engine/index.js";

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const payload = {
  storeId: "loja-1",
  origin: { postalCode: "01310100" },
  destination: { postalCode: "20040020" },
  packages: [{ weightGrams: 1000, heightCm: 10, widthCm: 20, lengthCm: 30 }],
};

describe("ShippingClient (SDK)", () => {
  it("consome /quotes e devolve o envelope", async () => {
    const client = new ShippingClient({
      baseUrl: "https://api.exemplo.com/api/v1/shipping/",
      fetchImpl: async () => response({ success: true, data: { quotes: [], warnings: [], errors: [], meta: {} } }),
    });
    const result = await client.quotes(payload);
    expect(result.success).toBe(true);
    expect(result.data.quotes).toEqual([]);
  });

  it("transforma erro da API em ShippingClientError", async () => {
    const client = new ShippingClient({
      baseUrl: "https://api.exemplo.com/api/v1/shipping",
      fetchImpl: async () => response({ success: false, error: { code: "INVALID_POSTAL_CODE", message: "CEP inválido." } }, 422),
    });
    await expect(client.quotes(payload)).rejects.toBeInstanceOf(ShippingClientError);
    await expect(client.quotes(payload)).rejects.toMatchObject({ code: "INVALID_POSTAL_CODE", status: 422 });
  });

  it("trata falha de rede", async () => {
    const client = new ShippingClient({
      baseUrl: "https://api.exemplo.com/api/v1/shipping",
      fetchImpl: async () => {
        throw new Error("offline");
      },
    });
    await expect(client.quotes(payload)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
});
