import { describe, expect, it } from "vitest";
import {
  MockShippingProvider,
  createShippingProviderFactory,
  isShippingError,
  type ShippingError,
} from "../../../src/shipping-engine/index.js";

function capture(fn: () => unknown): ShippingError {
  try {
    fn();
  } catch (error) {
    if (isShippingError(error)) return error;
    throw error;
  }
  throw new Error("Esperava um ShippingError, mas nada foi lançado.");
}

describe("ShippingProviderFactory", () => {
  it("registra, busca e lista provedores (id normalizado)", () => {
    const enabled = new MockShippingProvider({ id: "mock-a" });
    const disabled = new MockShippingProvider({ id: "mock-b", enabled: false });
    const factory = createShippingProviderFactory([enabled]).register(disabled);

    expect(factory.ids()).toEqual(["mock-a", "mock-b"]);
    expect(factory.get("MOCK-A")).toBe(enabled);
    expect(factory.has("mock-b")).toBe(true);
    expect(factory.getAll()).toHaveLength(2);
  });

  it("lança PROVIDER_UNAVAILABLE para provedor inexistente", () => {
    const factory = createShippingProviderFactory();
    expect(capture(() => factory.get("nao-existe")).code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("recusa registro duplicado", () => {
    const factory = createShippingProviderFactory([new MockShippingProvider({ id: "dup" })]);
    expect(capture(() => factory.register(new MockShippingProvider({ id: "dup" }))).code).toBe(
      "INVALID_REQUEST",
    );
  });

  it("filtra por habilitado e por allowlist (isolamento por loja)", () => {
    const factory = createShippingProviderFactory([
      new MockShippingProvider({ id: "correios" }),
      new MockShippingProvider({ id: "jadlog", enabled: false }),
    ]);

    expect(factory.getEnabled().map((provider) => provider.id)).toEqual(["correios"]);
    expect(factory.getEnabled(["correios"]).map((provider) => provider.id)).toEqual(["correios"]);
    expect(factory.getEnabled(["jadlog"])).toHaveLength(0);
  });

  it("remove provedores", () => {
    const factory = createShippingProviderFactory([new MockShippingProvider({ id: "mock-a" })]);
    expect(factory.unregister("mock-a")).toBe(true);
    expect(factory.unregister("mock-a")).toBe(false);
    expect(factory.ids()).toEqual([]);
  });
});
