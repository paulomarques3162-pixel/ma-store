import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CartPage from "@/pages/CartPage";
import NotificationsPage from "@/pages/NotificationsPage";
import { useAuthStore } from "@/stores/auth";
import type { User } from "@/types/api";
import { cartFixture, emptyCartFixture, mockApi, renderWithProviders } from "@/tests/mocks";

const clientUser: User = {
  id: "u1",
  name: "Cliente Teste",
  email: "cliente@teste.local",
  phone: null,
  role: "CLIENT",
  status: "ACTIVE",
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: new Date().toISOString(),
};

function authenticate() {
  useAuthStore.setState({ status: "authenticated", user: clientUser, sessionExpired: false });
}

describe("Carrinho", () => {
  it("pede login quando o visitante abre o carrinho", () => {
    useAuthStore.setState({ status: "guest", user: null });
    mockApi([{ path: "/cart", data: emptyCartFixture }]);

    renderWithProviders(<CartPage />);

    expect(screen.getByText("Entre para ver seu carrinho")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Entrar/ })).toBeInTheDocument();
  });

  it("mostra o estado vazio quando não há itens", async () => {
    authenticate();
    mockApi([{ path: "/cart", data: emptyCartFixture }]);

    renderWithProviders(<CartPage />);

    await waitFor(() => expect(screen.getByText("Seu carrinho está vazio")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /Ver produtos/ })).toBeInTheDocument();
  });

  it("lista os itens com quantidade, preço unitário e subtotal", async () => {
    authenticate();
    mockApi([{ path: "/cart", data: cartFixture }]);

    renderWithProviders(<CartPage />);

    await waitFor(() => expect(screen.getByText(cartFixture.items[0]!.product.name)).toBeInTheDocument());
    // O valor aparece na linha do item e no resumo — os dois corretos.
    expect(screen.getAllByText(/399,80/).length).toBeGreaterThanOrEqual(2);
    // O seletor de quantidade é um grupo acessível (com botões + e −).
    expect(screen.getByRole("group", { name: `Quantidade de ${cartFixture.items[0]!.product.name}` })).toBeInTheDocument();
  });

  it("aplica o cupom e exibe o desconto calculado pelo backend", async () => {
    authenticate();
    mockApi([
      { path: "/coupons/validate", data: { valid: true, code: "PROMO10", type: "PERCENT", value: 10, discount: 39.98, shippingDiscount: 0, appliesToShipping: false, subtotal: 399.8, total: 359.82 } },
      { path: "/cart", data: cartFixture },
    ]);

    renderWithProviders(<CartPage />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Aplicar/ })).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText("Código do cupom"), "PROMO10");
    await userEvent.click(screen.getByRole("button", { name: /Aplicar/ }));

    await waitFor(() => expect(screen.getByText(/Cupom PROMO10 aplicado/)).toBeInTheDocument());
    expect(screen.getAllByText(/39,98/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/359,82/).length).toBeGreaterThan(0);
  });

  it("mostra a mensagem do backend quando o cupom é inválido", async () => {
    authenticate();
    mockApi([
      { path: "/coupons/validate", status: 422, error: { code: "COUPON_INVALID", message: "Cupom não encontrado." } },
      { path: "/cart", data: cartFixture },
    ]);

    renderWithProviders(<CartPage />);

    await waitFor(() => expect(screen.getByRole("button", { name: /Aplicar/ })).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText("Código do cupom"), "NAOEXISTE");
    await userEvent.click(screen.getByRole("button", { name: /Aplicar/ }));

    await waitFor(() => expect(screen.getByText("Cupom não encontrado.")).toBeInTheDocument());
  });

  it("explica que o frete é calculado no checkout", async () => {
    authenticate();
    mockApi([{ path: "/cart", data: cartFixture }]);

    renderWithProviders(<CartPage />);

    await waitFor(() => expect(screen.getByText(/frete é calculado no checkout/i)).toBeInTheDocument());
  });
});

describe("Notificações", () => {
  it("mostra o estado vazio quando não há avisos", async () => {
    authenticate();
    mockApi([{ path: "/notifications", data: [] }]);

    renderWithProviders(<NotificationsPage />);

    await waitFor(() => expect(screen.getByText("Nenhuma notificação")).toBeInTheDocument());
  });

  it("marca uma notificação como lida", async () => {
    authenticate();
    const fetchMock = mockApi([
      { path: "/notifications", data: [{ id: "n1", type: "ORDER_CREATED", title: "Pedido recebido", body: "Aguardando pagamento.", link: null, readAt: null, createdAt: new Date().toISOString() }] },
      { path: "/read", data: { read: true } },
    ]);

    renderWithProviders(<NotificationsPage />);

    await waitFor(() => expect(screen.getByText("Pedido recebido")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Marcar como lida/ }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/notifications/n1/read"))).toBe(true),
    );
  });
});
