import { describe, expect, it } from "vitest";
import { buildPayer } from "../../src/services/mercadopago/index.js";

/**
 * `buildPayer` monta o pagador no formato EXATO do Mercado Pago. O endereço é
 * obrigatório para boleto e deve usar os nomes snake_case da API de Payments.
 */
describe("buildPayer (Mercado Pago)", () => {
  it("mapeia o endereço para os campos exigidos no boleto", () => {
    const payer = buildPayer({
      email: "ana@teste.local",
      firstName: "Ana",
      lastName: "Silva",
      docType: "CPF",
      docNumber: "123.456.789-09",
      address: {
        zipCode: "13630000",
        streetName: "Rua das Flores",
        streetNumber: "123",
        neighborhood: "Centro",
        city: "Pirassununga",
        federalUnit: "SP",
      },
    });

    expect(payer).toMatchObject({
      email: "ana@teste.local",
      first_name: "Ana",
      last_name: "Silva",
      identification: { type: "CPF", number: "12345678909" },
      address: {
        zip_code: "13630000",
        street_name: "Rua das Flores",
        street_number: "123",
        neighborhood: "Centro",
        city: "Pirassununga",
        federal_unit: "SP",
      },
    });
  });

  it("não envia `address` quando ausente (PIX/cartão não exigem)", () => {
    const payer = buildPayer({ email: "pix@teste.local" });
    expect(payer).not.toHaveProperty("address");
  });
});
