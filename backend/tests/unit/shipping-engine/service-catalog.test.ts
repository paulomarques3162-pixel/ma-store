import { describe, expect, it } from "vitest";
import {
  createServiceCatalog,
  defineService,
  isShippingServiceType,
  normalizeProviderId,
} from "../../../src/shipping-engine/index.js";

describe("service-catalog", () => {
  it("normaliza id de provedor", () => {
    expect(normalizeProviderId(" Correios ")).toBe("correios");
  });

  it("valida o tipo de serviço", () => {
    expect(isShippingServiceType("EXPRESS")).toBe(true);
    expect(isShippingServiceType("TELEPORTE")).toBe(false);
  });

  it("registra e consulta serviços por provedor", () => {
    const catalog = createServiceCatalog([
      defineService({ provider: "correios", code: "04510", name: "PAC", type: "STANDARD" }),
      defineService({ provider: "correios", code: "04014", name: "SEDEX", type: "EXPRESS" }),
    ]);

    expect(catalog.has("Correios", "04510")).toBe(true);
    expect(catalog.get("correios", "04014")?.name).toBe("SEDEX");
    expect(catalog.listByProvider("correios")).toHaveLength(2);
    expect(catalog.providers()).toEqual(["correios"]);
  });

  it("recusa descritor incompleto", () => {
    expect(() => defineService({ provider: "", code: "1", name: "x", type: "STANDARD" })).toThrowError();
    expect(() =>
      defineService({ provider: "p", code: "1", name: "x", type: "INVALIDO" as never }),
    ).toThrowError();
  });
});
