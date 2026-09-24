import { describe, expect, it } from "vitest";
import {
  SHIPPING_ERROR_CODES,
  ShippingError,
  isShippingError,
  providerTimeout,
  serviceUnavailable,
  invalidPostalCode,
} from "../../../src/shipping-engine/index.js";

describe("errors", () => {
  it("expõe todos os códigos padronizados", () => {
    expect(SHIPPING_ERROR_CODES).toContain("INVALID_POSTAL_CODE");
    expect(SHIPPING_ERROR_CODES).toContain("PROVIDER_TIMEOUT");
    expect(SHIPPING_ERROR_CODES).toContain("NO_QUOTES_AVAILABLE");
    expect(SHIPPING_ERROR_CODES).toHaveLength(10);
  });

  it("mapeia status HTTP e retry por código", () => {
    const timeout = providerTimeout();
    expect(timeout).toBeInstanceOf(ShippingError);
    expect(timeout.httpStatus).toBe(504);
    expect(timeout.retryable).toBe(true);

    const validation = invalidPostalCode();
    expect(validation.httpStatus).toBe(422);
    expect(validation.retryable).toBe(false);

    expect(serviceUnavailable().retryable).toBe(true);
  });

  it("identifica erros de domínio", () => {
    expect(isShippingError(providerTimeout())).toBe(true);
    expect(isShippingError(new Error("comum"))).toBe(false);
    expect(isShippingError(null)).toBe(false);
  });

  it("permite sobrepor o retry", () => {
    const error = new ShippingError("PROVIDER_TIMEOUT", "x", { retryable: false });
    expect(error.retryable).toBe(false);
  });
});
