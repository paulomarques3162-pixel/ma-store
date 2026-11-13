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

describe("boleto Mercado Pago (contrato e vencimento)", () => {
  it("formata a data de vencimento no ISO -03:00 aceito pela API", async () => {
    const { formatMercadoPagoDate } = await import("../../src/services/mercadopago/index.js");
    expect(formatMercadoPagoDate(new Date("2026-03-10T15:30:00.000Z"))).toBe("2026-03-10T12:30:00.000-03:00");
  });

  it("extrai o endereço do snapshot aceitando os dois formatos históricos", async () => {
    const { payerAddressFromSnapshot } = await import("../../src/services/mercadopago/payer.js");

    expect(
      payerAddressFromSnapshot({
        cep: "13630-000",
        logradouro: "Rua A",
        numero: "10",
        bairro: "Centro",
        cidade: "Pirassununga",
        uf: "sp",
      }),
    ).toMatchObject({ zipCode: "13630000", city: "Pirassununga", federalUnit: "SP" });

    expect(
      payerAddressFromSnapshot({
        zipCode: "13630000",
        street: "Rua B",
        number: "20",
        neighborhood: "Jardim",
        city: "Campinas",
        state: "SP",
      }),
    ).toMatchObject({ streetName: "Rua B", streetNumber: "20" });

    // Sem CEP válido não devolvemos endereço (nunca inventamos dado).
    expect(payerAddressFromSnapshot({ logradouro: "Rua A", bairro: "Centro", cidade: "X", uf: "SP" })).toBeNull();
    expect(payerAddressFromSnapshot(null)).toBeNull();
  });

  it("divide nome completo em nome e sobrenome sem perder o restante", async () => {
    const { splitFullName } = await import("../../src/services/mercadopago/payer.js");
    expect(splitFullName("Ana Maria de Souza")).toEqual({ firstName: "Ana", lastName: "Maria de Souza" });
    expect(splitFullName("Ana")).toEqual({ firstName: "Ana", lastName: undefined });
    expect(splitFullName("   ")).toEqual({ firstName: undefined, lastName: undefined });
  });
});
