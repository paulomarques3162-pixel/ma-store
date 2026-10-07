import { describe, expect, it } from "vitest";
import {
  CircuitBreaker,
  DEFAULT_RESILIENCE_POLICY,
  executeWithResilience,
  invalidRequest,
  providerUnavailable,
  type ShippingError,
} from "../../../src/shipping-engine/index.js";

const fastPolicy = { ...DEFAULT_RESILIENCE_POLICY, baseDelayMs: 1, maxDelayMs: 1, timeoutMs: 1000 };

describe("executeWithResilience", () => {
  it("repete erros transitórios com backoff e devolve o resultado", async () => {
    let attempts = 0;
    const result = await executeWithResilience(
      async () => {
        attempts += 1;
        if (attempts < 3) throw providerUnavailable();
        return "ok";
      },
      { ...fastPolicy, maxAttempts: 3 },
      { sleep: async () => {} },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("NÃO repete erro de validação (não transitório)", async () => {
    let attempts = 0;
    await expect(
      executeWithResilience(async () => {
        attempts += 1;
        throw invalidRequest();
      }, { ...fastPolicy, maxAttempts: 3 }, { sleep: async () => {} }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(attempts).toBe(1);
  });

  it("estoura o timeout como PROVIDER_TIMEOUT", async () => {
    await expect(
      executeWithResilience(() => new Promise(() => {}), { ...fastPolicy, timeoutMs: 10, maxAttempts: 1 }),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });
});

describe("CircuitBreaker", () => {
  it("abre após o limite de falhas e fecha no sucesso", () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetTimeoutMs: 1000 }, () => now);
    expect(breaker.canRequest("correios")).toBe(true);
    breaker.onFailure("correios");
    expect(breaker.state("correios")).toBe("closed");
    breaker.onFailure("correios");
    expect(breaker.state("correios")).toBe("open");
    expect(breaker.canRequest("correios")).toBe(false);

    now = 1001;
    expect(breaker.state("correios")).toBe("half-open");
    breaker.onSuccess("correios");
    expect(breaker.state("correios")).toBe("closed");
  });

  it("falha rápido quando aberto", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 10_000 });
    breaker.onFailure("x");
    await expect(
      executeWithResilience(async () => "nunca", fastPolicy, { breaker, key: "x" }),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });
});

export type { ShippingError };
