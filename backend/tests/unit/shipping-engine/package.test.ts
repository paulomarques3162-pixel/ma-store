import { describe, expect, it } from "vitest";
import {
  isShippingError,
  normalizePackage,
  normalizePackages,
  summarizePackages,
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

describe("package", () => {
  it("normaliza volume e calcula peso cúbico e taxado", () => {
    const pkg = normalizePackage({ weightGrams: 1000, heightCm: 10, widthCm: 20, lengthCm: 30, quantity: 2 });
    expect(pkg.volumeCm3).toBe(6000);
    expect(pkg.cubicWeightGrams).toBe(1000);
    expect(pkg.billedWeightGrams).toBe(1000);
    expect(pkg.quantity).toBe(2);
  });

  it("usa o peso cúbico quando ele for maior que o real", () => {
    const pkg = normalizePackage({ weightGrams: 500, heightCm: 40, widthCm: 40, lengthCm: 40 });
    expect(pkg.cubicWeightGrams).toBe(10667);
    expect(pkg.billedWeightGrams).toBe(10667);
  });

  it("rejeita peso inválido com INVALID_WEIGHT", () => {
    expect(capture(() => normalizePackage({ weightGrams: 0, heightCm: 10, widthCm: 10, lengthCm: 10 })).code).toBe(
      "INVALID_WEIGHT",
    );
  });

  it("rejeita dimensões inválidas com INVALID_DIMENSIONS", () => {
    expect(capture(() => normalizePackage({ weightGrams: 100, heightCm: 0, widthCm: 10, lengthCm: 10 })).code).toBe(
      "INVALID_DIMENSIONS",
    );
    expect(
      capture(() => normalizePackage({ weightGrams: 100, heightCm: 200, widthCm: 200, lengthCm: 200 })).code,
    ).toBe("INVALID_DIMENSIONS");
  });

  it("exige ao menos um volume", () => {
    expect(capture(() => normalizePackages([])).code).toBe("INVALID_REQUEST");
  });

  it("resume os totais de múltiplos volumes", () => {
    const packages = normalizePackages([
      { weightGrams: 1000, heightCm: 10, widthCm: 10, lengthCm: 10, quantity: 2 },
      { weightGrams: 500, heightCm: 5, widthCm: 5, lengthCm: 5, quantity: 1 },
    ]);
    const summary = summarizePackages(packages);
    expect(summary.packageCount).toBe(2);
    expect(summary.totalQuantity).toBe(3);
    expect(summary.totalWeightGrams).toBe(2500);
  });
});
