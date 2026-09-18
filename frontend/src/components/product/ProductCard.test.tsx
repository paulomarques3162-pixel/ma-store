import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductCard, ProductGrid } from "@/components/product/ProductCard";
import { useAuthStore } from "@/stores/auth";
import { mockApi, outOfStockProductFixture, productFixture, renderWithProviders } from "@/tests/mocks";

/** Rotas padrão usadas pelo card. */
function routes(extra: Array<{ path: string; data?: unknown; status?: number; error?: { code: string; message: string } }> = []) {
  return [
    { path: "/favorites/ids", data: [] },
    { path: "/cart/items", data: { id: "cart", items: [], summary: { subtotal: 0, totalItems: 1, shipping: 0, discount: 0, total: 0, hasIssues: false } } },
    { path: "/content", data: { values: {}, entries: [] } },
    ...extra,
  ];
}

describe("ProductCard", () => {
  it("mostra nome, marca, volume e preço", () => {
    mockApi(routes());
    renderWithProviders(<ProductCard product={productFixture} />);

    expect(screen.getByText(productFixture.name)).toBeInTheDocument();
    expect(screen.getByText("Marca Teste")).toBeInTheDocument();
    expect(screen.getByText("100ml")).toBeInTheDocument();
    expect(screen.getByText(/199,90/)).toBeInTheDocument();
  });

  it("usa o placeholder quando o produto não tem imagem cadastrada", () => {
    mockApi(routes());
    renderWithProviders(<ProductCard product={outOfStockProductFixture} />);

    const image = screen.getByRole("img", { name: /imagem não cadastrada/i });
    expect(image).toHaveAttribute("src", "/placeholder-product.svg");
  });

  it("desabilita a compra e avisa quando está sem estoque", () => {
    mockApi(routes());
    renderWithProviders(<ProductCard product={outOfStockProductFixture} />);

    expect(screen.getByRole("button", { name: "Produto indisponível" })).toBeDisabled();
    expect(screen.getByText("Indisponível")).toBeInTheDocument();
  });

  it("envia o produto ao carrinho e abre a gaveta quando autenticado", async () => {
    const fetchMock = mockApi(routes());
    useAuthStore.setState({
      status: "authenticated",
      user: {
        id: "u1",
        name: "Cliente",
        email: "cliente@teste.local",
        phone: null,
        role: "CLIENT",
        status: "ACTIVE",
        mustChangePassword: false,
        lastLoginAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    renderWithProviders(<ProductCard product={productFixture} />);
    await userEvent.click(screen.getByRole("button", { name: "Comprar" }));

    await waitFor(() => {
      const called = fetchMock.mock.calls.some(([input, init]) => {
        const url = String(input);
        return url.includes("/cart/items") && (init?.method ?? "GET").toUpperCase() === "POST";
      });
      expect(called).toBe(true);
    });

    // A chamada precisa enviar o id do produto e a quantidade.
    const cartCall = fetchMock.mock.calls.find(([input, init]) => String(input).includes("/cart/items") && (init?.method ?? "") === "POST");
    expect(JSON.parse(String(cartCall?.[1]?.body))).toEqual({ productId: productFixture.id, quantity: 1 });

    useAuthStore.setState({ user: null, status: "guest" });
  });

  it("não permite favoritar sem sessão (leva ao login)", async () => {
    const fetchMock = mockApi(routes());
    useAuthStore.setState({ user: null, status: "guest" });

    renderWithProviders(<ProductCard product={productFixture} />);

    const favorite = screen.getByRole("button", { name: /Adicionar .* aos favoritos/ });
    await userEvent.click(favorite);

    const calledFavorites = fetchMock.mock.calls.some(([input]) => String(input).includes("/favorites/"));
    expect(calledFavorites).toBe(false);
  });

  it("mostra os selos de promoção e lançamento", () => {
    mockApi(routes());
    renderWithProviders(<ProductCard product={productFixture} />);

    expect(screen.getByText("20% off")).toBeInTheDocument();
    expect(screen.getByText("Lançamento")).toBeInTheDocument();
  });
});

describe("ProductGrid", () => {
  it("renderiza um card por produto", () => {
    mockApi(routes());
    renderWithProviders(<ProductGrid products={[productFixture, outOfStockProductFixture]} />);

    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("não renderiza nada com a lista vazia (a página cuida do estado vazio)", () => {
    mockApi(routes());
    const { container } = renderWithProviders(<ProductGrid products={[]} />);
    expect(container.querySelectorAll("article")).toHaveLength(0);
  });
});
