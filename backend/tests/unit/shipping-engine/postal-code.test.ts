import { describe, expect, it } from "vitest";
import {
  formatPostalCode,
  isShippingError,
  isValidPostalCode,
  normalizePostalCode,
  type ShippingError,
} from "../../../src/shipping-engine/index.js";

function capture(fn: () => unknown): ShippingError {
  try {
    fn();
  } catch (error) {
    if (isShippingError(error)) return error;
    throw error;
  }
  throw new Error("Esperava um ShippingError, mas nada foi lançado.");
}

describe("postal-code", () => {
  it("normaliza CEP com máscara e espaços", () => {
    expect(normalizePostalCode("01310-100")).toBe("01310100");
    expect(normalizePostalCode(" 01310100 ")).toBe("01310100");
  });

  it("rejeita CEP inválido com INVALID_POSTAL_CODE", () => {
    const error = capture(() => normalizePostalCode("1234"));
    expect(error.code).toBe("INVALID_POSTAL_CODE");
    expect(error.httpStatus).toBe(422);
  });

  it("valida e formata para exibição", () => {
    expect(isValidPostalCode("01310-100")).toBe(true);
    expect(isValidPostalCode("123")).toBe(false);
    expect(formatPostalCode("01310100")).toBe("01310-100");
  });
});
