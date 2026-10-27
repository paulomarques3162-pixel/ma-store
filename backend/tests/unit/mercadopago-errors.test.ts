import { describe, expect, it } from "vitest";
import { normalizeMercadoPagoError } from "../../src/services/mercadopago/errors.js";

/**
 * O erro do gateway precisa ser SANITIZADO (sem dados pessoais/credenciais) mas
 * PRESERVAR o motivo real da rejeicao (codigo/descricao/status) para diagnostico.
 */
describe("normalizeMercadoPagoError", () => {
  it("preserva codigos e descricao tecnica da rejeicao do Mercado Pago", () => {
    const result = normalizeMercadoPagoError({
      status: 400,
      message: "Invalid payment data",
      cause: [
        { code: "1", description: "payer.address.zip_code is required" },
        { code: "205", description: "payment_method_id invalid" },
      ],
    });

    expect(result.httpStatus).toBe(400);
    expect(result.causeCodes).toEqual(["1", "205"]);
    expect(result.technical).toContain("payer.address.zip_code is required");
    expect(result.technical).toContain("payment_method_id invalid");
    // Mensagem ao cliente permanece amigavel e generica.
    expect(result.message).toContain("invalidos");
  });

  it("redige CPF, CNPJ, CEP e credenciais do texto tecnico", () => {
    const result = normalizeMercadoPagoError({
      status: 400,
      message: "CPF 123.456.789-09 recusado; CNPJ 12.345.678/0001-90; CEP 13630-000; token APP_USR-123456",
    });

    expect(result.technical).not.toContain("123.456.789-09");
    expect(result.technical).not.toContain("12.345.678/0001-90");
    expect(result.technical).not.toContain("13630-000");
    expect(result.technical).not.toContain("APP_USR-123456");
    expect(result.technical).toContain("[CPF_REDACTED]");
    expect(result.technical).toContain("[CNPJ_REDACTED]");
    expect(result.technical).toContain("[CEP_REDACTED]");
    expect(result.technical).toContain("APP_USR-[REDACTED]");
  });

  it("captura o identificador de correlacao do gateway quando disponivel", () => {
    const result = normalizeMercadoPagoError({
      status: 400,
      api_response: { status: 400, id: "req-abc-123" },
      message: "bad request",
    });
    expect(result.requestId).toBe("req-abc-123");
  });

  it("classifica autenticacao, indisponibilidade e rede", () => {
    expect(normalizeMercadoPagoError({ status: 401 }).message).toContain("autenticacao");
    expect(normalizeMercadoPagoError({ status: 403 }).message).toContain("autenticacao");
    expect(normalizeMercadoPagoError({ status: 503 }).message).toContain("indisponivel");
    expect(normalizeMercadoPagoError({ message: "ETIMEDOUT" }).message).toContain("demorou");
  });
});
