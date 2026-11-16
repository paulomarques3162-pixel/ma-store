import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CheckoutPage from "@/pages/CheckoutPage";
import { useAuthStore } from "@/stores/auth";
import { useGuestCartStore } from "@/stores/cart";
import { useUiStore } from "@/stores/ui";
import { mockApi, renderWithProviders } from "@/tests/mocks";

/**
 * Boleto temporariamente indisponível no CHECKOUT.
 *
 * Regras verificadas (a autoridade final continua sendo o backend):
 *  - boleto aparece, mas o radio está `disabled` (não seleciona por clique nem
 *    por teclado);
 *  - PIX continua selecionável e permanece selecionado após o clique no boleto;
 *  - o aviso só aparece ao INTERAGIR com o boleto (nunca ao abrir o checkout);
 *  - a mensagem é exatamente a definida pela regra de negócio.
 */

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

const PAYMENT_METHODS = {
  provider: "mercadopago",
  environment: "sandbox",
  onlinePaymentsEnabled: true,
  publicKey: "TEST-public-key",
  boletoEnabled: false,
  methods: [
    { id: "PIX", label: "PIX", enabled: true, configured: true, comingSoon: false, gateway: "mercadopago", note: null },
    {
      id: "CREDIT_CARD",
      label: "Cartão de crédito",
      enabled: true,
      configured: true,
      comingSoon: false,
      gateway: "mercadopago",
      note: null,
    },
    {
      id: "BOLETO",
      label: "Boleto bancário",
      enabled: false,
      configured: true,
      comingSoon: true,
      gateway: "mercadopago",
      note: "Indisponível temporariamente. Em breve você poderá pagar suas compras por boleto bancário.",
    },
    {
      id: "COMBINAR",
      label: "Combinar com a loja (WhatsApp)",
      enabled: true,
      configured: true,
      comingSoon: false,
      gateway: null,
      note: null,
    },
  ],
};

async function goToReview() {
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

  await waitFor(() => expect(screen.getAllByText(/Frete Padrao/).length).toBeGreaterThan(0));
  await userEvent.click(screen.getByRole("button", { name: /Continuar/ }));

  await waitFor(() => expect(screen.getByRole("radio", { name: /PIX/ })).toBeInTheDocument());
}

describe("Checkout — boleto indisponível", () => {
  beforeEach(() => {
    useAuthStore.setState({ status: "guest", user: null });
    useGuestCartStore.setState({ items: GUEST_ITEMS });
    useUiStore.getState().clearToasts();
    mockApi([
      {
        path: "/shipping/engine/status",
        data: {
          enabled: true,
          configured: true,
          activeZones: 1,
          activeWeightRules: 1,
          hasZones: true,
          freeShippingEnabled: false,
          originZipCode: "13610000",
        },
      },
      { path: "/shipping/quote", data: LOCAL_QUOTE },
      { path: "/payment-methods", data: PAYMENT_METHODS },
    ]);
  });

  it("mantém o boleto visível, mas não selecionável, e preserva o PIX", async () => {
    await goToReview();

    const boleto = await screen.findByRole("radio", { name: /Boleto/i });
    expect(boleto).toBeDisabled();

    const pix = screen.getByRole("radio", { name: /PIX/ });
    expect(pix).toBeEnabled();
    expect(pix).toBeChecked();

    // Nenhum aviso ao apenas abrir a revisão do checkout.
    expect(useUiStore.getState().toasts).toHaveLength(0);

    // Clique na opção de boleto: aviso aparece, PIX continua selecionado.
    await userEvent.click(screen.getByText("Boleto bancário"));

    const toasts = useUiStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.tone).toBe("warning");
    expect(toasts[0]?.title).toContain("Pagamento por boleto indisponível no momento");
    expect(toasts[0]?.message).toContain("Estamos trabalhando para disponibilizar essa modalidade em breve");
    expect(toasts[0]?.message).toContain("escolha PIX ou cartão");

    expect(pix).toBeChecked();
    expect(boleto).not.toBeChecked();
  });

  it("exibe o selo 'Em breve' e a explicação na própria opção", async () => {
    await goToReview();

    expect(await screen.findByText("Em breve")).toBeInTheDocument();
    expect(screen.getByText("Indisponível temporariamente.")).toBeInTheDocument();
  });
});
