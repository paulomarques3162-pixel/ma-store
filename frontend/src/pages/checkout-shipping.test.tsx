import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CheckoutPage from "@/pages/CheckoutPage";
import { useAuthStore } from "@/stores/auth";
import { useGuestCartStore } from "@/stores/cart";
import { mockApi, renderWithProviders } from "@/tests/mocks";

const GUEST_ITEMS = [
  {
    productId: "p1",
    slug: "perfume-de-teste",
    name: "Perfume de Teste 100ml",
    price: 199.9,
    comparePrice: 249.9,
    volume: "100ml",
    image: null,
    brand: "Marca Teste",
    category: "Categoria Teste",
    weightKg: 0.5,
    stock: 5,
    quantity: 2,
  },
];

const LOCAL_QUOTE = {
  success: true,
  available: true,
  quoteId: "qt_test",
  expiresAt: new Date(Date.now() + 900_000).toISOString(),
  normalizedZipCode: "13610000",
  zone: { id: "z1", name: "Zona Teste" },
  weightGrams: 1100,
  subtotal: 399.8,
  isFreeShipping: false,
  requiresShipping: true,
  isEstimate: true,
  disclaimer: "Valor e prazo estimados.",
  currency: "BRL",
  options: [
    {
      methodId: "m1",
      code: "STANDARD",
      name: "Frete Padrao",
      description: "Entrega padrao",
      price: 24.9,
      deliveryDays: 4,
      zoneId: "z1",
      ruleId: "r1",
    },
  ],
};

async function fillUntilDelivery() {
  renderWithProviders(<CheckoutPage />, { route: "/checkout" });

  await waitFor(() => expect(screen.getByLabelText(/Nome completo/)).toBeInTheDocument());
  await userEvent.type(screen.getByLabelText(/Nome completo/), "Cliente de Teste");
  await userEvent.type(screen.getByLabelText(/WhatsApp/), "11999990000");
  await userEvent.click(screen.getByRole("button", { name: /Continuar/ }));

  await waitFor(() => expect(screen.getByLabelText(/CEP/)).toBeInTheDocument());
  await userEvent.type(screen.getByLabelText(/CEP/), "13610000");
  await userEvent.type(screen.getByLabelText(/Número/), "100");
  await userEvent.type(screen.getByLabelText(/Logradouro/), "Rua de Teste");
  await userEvent.type(screen.getByLabelText(/Bairro/), "Centro");
  await userEvent.type(screen.getByLabelText(/Cidade/), "Pirassununga");
  await userEvent.click(screen.getByRole("button", { name: /Continuar/ }));
}

describe("Checkout — Shipping Engine próprio", () => {
  it("mostra a estimativa do motor próprio (sucesso)", async () => {
    useAuthStore.setState({ status: "guest", user: null });
    useGuestCartStore.setState({ items: GUEST_ITEMS });
    mockApi([
      { path: "/shipping/engine/status", data: { enabled: true, configured: true, activeZones: 1, activeWeightRules: 1, hasZones: true, freeShippingEnabled: false, originZipCode: "13610000" } },
      { path: "/shipping/quote", data: LOCAL_QUOTE },
      { path: "/payment-methods", data: { methods: [] } },
    ]);

    await fillUntilDelivery();

    await waitFor(() => expect(screen.getAllByText(/Frete Padrao/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/24,90/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Nenhuma modalidade disponível/)).not.toBeInTheDocument();
  });

  it("exibe a mensagem de frete não configurado (sem preço fictício)", async () => {
    useAuthStore.setState({ status: "guest", user: null });
    useGuestCartStore.setState({ items: GUEST_ITEMS });
    mockApi([
      { path: "/shipping/engine/status", data: { enabled: true, configured: false, activeZones: 0, activeWeightRules: 0, hasZones: false, freeShippingEnabled: false, originZipCode: null } },
      {
        path: "/shipping/quote",
        status: 422,
        error: { code: "SHIPPING_NOT_CONFIGURED", message: "O frete ainda nao esta configurado para este destino." },
      },
      { path: "/payment-methods", data: { methods: [] } },
    ]);

    await fillUntilDelivery();

    await waitFor(() =>
      expect(screen.getByText(/frete ainda nao esta configurado para este destino/i)).toBeInTheDocument(),
    );
  });
});
