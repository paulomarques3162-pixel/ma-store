import { describe, expect, it } from "vitest";
import { cepToUf, normalizeCep, UFS } from "../../src/modules/shipping/shipping.service";
import { assertTransition } from "../../src/modules/orders/order.service";
import { AppError } from "../../src/lib/errors";

describe("CEP -> UF", () => {
  it("normaliza CEP com ou sem mascara", () => {
    expect(normalizeCep("01310-100")).toBe("01310100");
    expect(normalizeCep("01310100")).toBe("01310100");
  });

  it("rejeita CEP invalido", () => {
    expect(() => normalizeCep("123")).toThrow(AppError);
  });

  it("mapeia as principais faixas", () => {
    expect(cepToUf("01310100")).toBe("SP");
    expect(cepToUf("20040020")).toBe("RJ");
    expect(cepToUf("30130010")).toBe("MG");
    expect(cepToUf("70040010")).toBe("DF");
    expect(cepToUf("80010000")).toBe("PR");
    expect(cepToUf("90010150")).toBe("RS");
    expect(cepToUf("40015010")).toBe("BA");
    expect(cepToUf("60060170")).toBe("CE");
  });

  it("expoe a lista de UFs", () => {
    expect(UFS).toHaveLength(27);
    expect(UFS).toContain("SP");
  });
});

describe("transicoes de status do pedido", () => {
  it("permite o caminho feliz", () => {
    expect(() => assertTransition("AWAITING_PAYMENT", "PAID")).not.toThrow();
    expect(() => assertTransition("PAID", "PREPARING")).not.toThrow();
    expect(() => assertTransition("PREPARING", "SHIPPED")).not.toThrow();
    expect(() => assertTransition("SHIPPED", "DELIVERED")).not.toThrow();
    expect(() => assertTransition("DELIVERED", "REFUNDED")).not.toThrow();
  });

  it("permite cancelamento nas etapas validas", () => {
    expect(() => assertTransition("AWAITING_PAYMENT", "CANCELED")).not.toThrow();
    expect(() => assertTransition("PAID", "CANCELED")).not.toThrow();
  });

  it("bloqueia saltos invalidos", () => {
    expect(() => assertTransition("AWAITING_PAYMENT", "DELIVERED")).toThrow(AppError);
    expect(() => assertTransition("PAID", "DELIVERED")).toThrow(AppError);
    expect(() => assertTransition("CANCELED", "PAID")).toThrow(AppError);
    expect(() => assertTransition("REFUNDED", "SHIPPED")).toThrow(AppError);
    expect(() => assertTransition("DELIVERED", "SHIPPED")).toThrow(AppError);
  });

  it("idempotente: mesmo status nao lanca erro", () => {
    expect(() => assertTransition("PAID", "PAID")).not.toThrow();
  });
});
