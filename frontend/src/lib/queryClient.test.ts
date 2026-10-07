import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateStorefront } from "./queryClient";

/**
 * Sincronização admin → loja: depois de uma alteração administrativa, os caches
 * públicos da vitrine precisam ser invalidados para o cliente não continuar
 * vendo dados antigos (preço, estoque, imagem, produto novo etc.).
 */
describe("invalidateStorefront", () => {
  it("invalida todas as chaves públicas da vitrine", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");

    invalidateStorefront(client);

    const invalidated = spy.mock.calls.map(([arg]) => (arg as { queryKey: unknown[] }).queryKey[0]);
    expect(invalidated).toEqual(
      expect.arrayContaining([
        "products",
        "product",
        "catalog",
        "categories",
        "brands",
        "content",
        "banners",
        "theme",
        "search",
      ]),
    );
  });

  it("não invalida caches privados/administrativos", () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, "invalidateQueries");

    invalidateStorefront(client);

    const invalidated = spy.mock.calls.map(([arg]) => (arg as { queryKey: unknown[] }).queryKey[0]);
    expect(invalidated).not.toContain("cart");
    expect(invalidated).not.toContain("orders");
    expect(invalidated).not.toContain("admin");
  });
});
