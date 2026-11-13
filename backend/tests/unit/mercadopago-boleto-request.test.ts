import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contrato REAL do boleto: verifica o body que sai para a API de Payments.
 * O cliente do SDK é substituído por um spy — nenhuma chamada externa.
 */
const create = vi.fn(async (args: unknown) => ({
  id: 123456,
  status: "pending",
  status_detail: "pending_waiting_payment",
  transaction_amount: 149.9,
  payment_method_id: "bolbradesco",
  external_reference: "token-abc",
  date_of_expiration: "2026-03-13T12:00:00.000-03:00",
  transaction_details: {
    external_resource_url: "https://mp/boleto.pdf",
    barcode: { content: "23793381286000000003381260000000000000000000" },
  },
}));

vi.mock("../../src/services/mercadopago/client.js", () => ({
  getPaymentClient: () => ({ create, get: vi.fn() }),
}));

describe("createBoletoPayment (body enviado ao Mercado Pago)", () => {
  beforeEach(() => create.mockClear());

  it("envia bolbradesco, endereço completo e vencimento -03:00", async () => {
    const { createBoletoPayment } = await import("../../src/services/mercadopago/index.js");

    const result = await createBoletoPayment({
      amount: 149.9,
      description: "Pedido MA STORE #10",
      externalReference: "token-abc",
      idempotencyKey: "idem-12345678",
      notificationUrl: "https://api.exemplo.com/api/payments/webhooks/mercadopago",
      expiresAt: new Date("2026-03-13T15:00:00.000Z"),
      payer: {
        email: "ana@teste.local",
        firstName: "Ana",
        lastName: "Maria de Souza",
        docType: "CPF",
        docNumber: "52998224725",
        address: {
          zipCode: "13630000",
          streetName: "Rua das Flores",
          streetNumber: "123",
          neighborhood: "Centro",
          city: "Pirassununga",
          federalUnit: "SP",
          complement: "Apto 4",
        },
      },
    });

    expect(create).toHaveBeenCalledTimes(1);
    const body = (create.mock.calls[0]![0] as { body: Record<string, unknown>; requestOptions: { idempotencyKey: string } });

    expect(body.requestOptions.idempotencyKey).toBe("idem-12345678");
    expect(body.body).toMatchObject({
      transaction_amount: 149.9,
      payment_method_id: "bolbradesco",
      external_reference: "token-abc",
      date_of_expiration: "2026-03-13T12:00:00.000-03:00",
      payer: {
        email: "ana@teste.local",
        first_name: "Ana",
        last_name: "Maria de Souza",
        identification: { type: "CPF", number: "52998224725" },
        address: {
          zip_code: "13630000",
          street_name: "Rua das Flores",
          street_number: "123",
          neighborhood: "Centro",
          city: "Pirassununga",
          federal_unit: "SP",
          complement: "Apto 4",
        },
      },
      notification_url: "https://api.exemplo.com/api/payments/webhooks/mercadopago",
    });

    // A resposta real é mapeada para linha digitável + link do boleto.
    expect(result).toMatchObject({
      id: "123456",
      status: "PENDING",
      mpStatus: "pending",
      boleto: {
        url: "https://mp/boleto.pdf",
        barcode: "23793381286000000003381260000000000000000000",
      },
    });
  });
});
