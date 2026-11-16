import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CatalogView } from "@/components/product/CatalogView";
import { productFixture, renderWithProviders } from "@/tests/mocks";

/**
 * Carregamento PROGRESSIVO da vitrine.
 *
 * A primeira requisição traz 12 produtos (`perPage=12`); "Carregar mais" anexa
 * a página seguinte sem duplicar itens e sem perder os filtros. Aqui a API é
 * simulada página a página para provar o comportamento do componente.
 */

function productPage(page: number) {
  return [1, 2].map((index) => ({
    ...productFixture,
    id: `p-${page}-${index}`,
    name: `Produto pagina ${page} item ${index}`,
    slug: `produto-${page}-${index}`,
  }));
}

function json(data: unknown, meta?: unknown) {
  return new Response(JSON.stringify({ data, meta }), { headers: { "content-type": "application/json" } });
}

describe("CatalogView — carregamento progressivo", () => {
  it("anexa a próxima página ao clicar em 'Carregar mais' sem duplicar", async () => {
    const requestedPages: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/products/facets")) return json({ volumes: [], priceMin: null, priceMax: null });
        if (url.includes("/categories")) return json([]);
        if (url.includes("/brands")) return json([]);
        if (url.includes("/content")) return json({ values: {}, published: false });
        if (url.includes("/products")) {
          const page = new URL(url, "http://localhost").searchParams.get("page") ?? "1";
          requestedPages.push(page);
          const hasNext = page === "1";
          return json(productPage(Number(page)), {
            page: Number(page),
            perPage: 12,
            total: 4,
            totalPages: 2,
            hasNext,
            hasPrev: Number(page) > 1,
          });
        }
        return json(null);
      }),
    );

    renderWithProviders(<CatalogView title="Produtos" />, { route: "/produtos" });

    // Primeira página visível, com o botão de carregar mais.
    expect(await screen.findByText("Produto pagina 1 item 1")).toBeInTheDocument();
    expect(screen.queryByText("Produto pagina 2 item 1")).not.toBeInTheDocument();
    expect(requestedPages[0]).toBe("1");

    const button = screen.getByRole("button", { name: /Carregar mais produtos/ });
    await userEvent.click(button);

    await waitFor(() => expect(screen.getByText("Produto pagina 2 item 1")).toBeInTheDocument());
    // A primeira página continua na lista (carregamento progressivo, não troca).
    expect(screen.getByText("Produto pagina 1 item 1")).toBeInTheDocument();
    // Nada duplicado.
    expect(screen.getAllByText("Produto pagina 1 item 1")).toHaveLength(1);
    expect(requestedPages).toEqual(["1", "2"]);

    // Tudo carregado: o botão some e o total aparece no rodapé.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Carregar mais produtos/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByText(/Você viu todos os 4 produtos/)).toBeInTheDocument();
  });

  it("mostra estado de erro com opção de tentar novamente", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/products/facets")) return json({ volumes: [], priceMin: null, priceMax: null });
        if (url.includes("/categories")) return json([]);
        if (url.includes("/brands")) return json([]);
        if (url.includes("/content")) return json({ values: {}, published: false });
        return new Response(
          JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Falha temporária na API.", requestId: "req-1" } }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      }),
    );

    renderWithProviders(<CatalogView title="Produtos" />, { route: "/produtos" });

    expect(await screen.findByText(/Falha temporária na API/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tentar novamente/i })).toBeInTheDocument();
  });
});
