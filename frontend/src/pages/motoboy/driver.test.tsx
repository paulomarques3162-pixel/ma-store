import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import DriverDashboardPage from "@/pages/motoboy/DriverDashboardPage";
import DriverDeliveriesPage from "@/pages/motoboy/DriverDeliveriesPage";
import { useAuthStore } from "@/stores/auth";
import { mockApi, renderWithProviders } from "@/tests/mocks";
import type { DeliveryListItem, User } from "@/types/api";

const driverUser: User = {
  id: "d1",
  name: "Motoboy Teste",
  email: "motoboy@test.local",
  phone: null,
  role: "DELIVERY_PERSON",
  status: "ACTIVE",
  mustChangePassword: false,
  lastLoginAt: null,
  createdAt: new Date().toISOString(),
};

const delivery: DeliveryListItem = {
  id: "del-1",
  pedidoId: 1024,
  orderNumber: 1024,
  status: "ASSIGNED",
  clienteNome: "João Cliente",
  endereco: "Rua das Flores, 123",
  bairro: "Centro",
  cidade: "Pirassununga",
  cep: "13610000",
  observacoes: "Deixar na portaria",
  driver: { id: "d1", name: "Motoboy Teste" },
  createdAt: new Date().toISOString(),
  deliveredAt: null,
};

const counters = { pending: 0, assigned: 1, outForDelivery: 0, delivered: 3, failed: 1, total: 5 };

function authenticateDriver() {
  useAuthStore.setState({ status: "authenticated", user: driverUser, sessionExpired: false });
}

describe("Área do entregador", () => {
  it("mostra a saudação e as entregas ativas no painel", async () => {
    authenticateDriver();
    mockApi([{ path: "/delivery/my", data: { deliveries: [delivery], counters } }]);

    renderWithProviders(<DriverDashboardPage />);

    await waitFor(() => expect(screen.getByText(/Olá, Motoboy Teste/)).toBeInTheDocument());
    expect(screen.getAllByText(/#1024/).length).toBeGreaterThan(0);
    expect(screen.getByText("João Cliente")).toBeInTheDocument();
    expect(screen.getByText(/Deixar na portaria/)).toBeInTheDocument();
  });

  it("lista as entregas com filtro no painel de entregas", async () => {
    authenticateDriver();
    mockApi([{ path: "/delivery/my", data: { deliveries: [delivery], counters } }]);

    renderWithProviders(<DriverDeliveriesPage />);

    await waitFor(() => expect(screen.getByText("Minhas entregas")).toBeInTheDocument());
    expect(screen.getByText(/#1024/)).toBeInTheDocument();
    expect(screen.getByText("Atribuída")).toBeInTheDocument();
  });
});
