import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Bloqueio comercial do BOLETO (`BOLETO_ENABLED`).
 *
 * Estes testes cobrem a regra CENTRAL usada por todas as rotas que podem gerar
 * cobranca: criar pedido guest, iniciar pagamento de pedido e criar intent de
 * pagamento. Quando a flag esta desligada (padrao), a tentativa falha com 422
 * ANTES de gravar qualquer coisa ou chamar o Mercado Pago.
 */
async function loadFlags(boletoEnabled?: string) {
  vi.resetModules();
  vi.stubEnv("BOLETO_ENABLED", boletoEnabled ?? "");
  return import("../../src/services/payment-flags.js");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("payment-flags — boleto desativado (padrao)", () => {
  it("mantem o boleto indisponivel por padrao", async () => {
    const flags = await loadFlags();
    expect(flags.isBoletoEnabled()).toBe(false);
    expect(flags.isPaymentMethodEnabled("BOLETO")).toBe(false);
    // PIX, cartao e "combinar" continuam liberados.
    expect(flags.isPaymentMethodEnabled("PIX")).toBe(true);
    expect(flags.isPaymentMethodEnabled("CREDIT_CARD")).toBe(true);
    expect(flags.isPaymentMethodEnabled("COMBINAR")).toBe(true);
  });

  it("rejeita BOLETO com HTTP 422 e mensagem clara", async () => {
    const flags = await loadFlags();
    const { AppError } = await import("../../src/lib/errors.js");

    let error: unknown;
    try {
      flags.assertPaymentMethodEnabled("BOLETO");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AppError);
    const appError = error as InstanceType<typeof AppError>;
    expect(appError.statusCode).toBe(422);
    expect(appError.code).toBe("VALIDATION_ERROR");
    expect(appError.message).toContain("boleto temporariamente indisponível");
    expect(appError.message).toContain("PIX");
    expect(appError.message).toContain("cartão");
  });

  it("aceita variacoes de caixa/espaco do mesmo metodo", async () => {
    const flags = await loadFlags();
    expect(flags.normalizePaymentMethod(" boleto ")).toBe("BOLETO");
    expect(() => flags.assertPaymentMethodEnabled("Boleto")).toThrow();
    expect(() => flags.assertPaymentMethodEnabled(" boleto ")).toThrow();
  });

  it("nao bloqueia PIX nem cartao", async () => {
    const flags = await loadFlags();
    expect(() => flags.assertPaymentMethodEnabled("PIX")).not.toThrow();
    expect(() => flags.assertPaymentMethodEnabled("CREDIT_CARD")).not.toThrow();
    expect(() => flags.assertPaymentMethodEnabled("COMBINAR")).not.toThrow();
  });

  it("expoe o estado usado pelo checkout (visivel, mas nao selecionavel)", async () => {
    const flags = await loadFlags();
    const availability = flags.boletoAvailability();
    expect(availability.enabled).toBe(false);
    expect(availability.comingSoon).toBe(true);
    expect(availability.note).toContain("Em breve");
  });
});

describe("payment-flags — boleto reativado", () => {
  it("libera a selecao quando BOLETO_ENABLED=true", async () => {
    const flags = await loadFlags("true");
    expect(flags.isBoletoEnabled()).toBe(true);
    expect(flags.isPaymentMethodEnabled("BOLETO")).toBe(true);
    expect(() => flags.assertPaymentMethodEnabled("BOLETO")).not.toThrow();
    expect(flags.boletoAvailability().comingSoon).toBe(false);
  });
});
