import { isShippingError, providerTimeout } from "../domain/errors.js";

export type ResiliencePolicy = {
  timeoutMs: number;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export const DEFAULT_RESILIENCE_POLICY: ResiliencePolicy = {
  timeoutMs: 8000,
  maxAttempts: 2,
  baseDelayMs: 200,
  maxDelayMs: 2000,
};

export type CircuitState = "closed" | "open" | "half-open";

export type CircuitBreakerOptions = {
  failureThreshold: number;
  resetTimeoutMs: number;
};

const DEFAULT_BREAKER_OPTIONS: CircuitBreakerOptions = { failureThreshold: 5, resetTimeoutMs: 30_000 };

type CircuitEntry = { failures: number; openedAt: number | null };

/**
 * Circuit breaker por provedor. Quando aberto, novas chamadas falham rápido
 * (`PROVIDER_UNAVAILABLE`) em vez de derrubar o checkout. Após o período de
 * reset entra em meio-aberto e libera uma tentativa de sondagem.
 */
export class CircuitBreaker {
  private readonly entries = new Map<string, CircuitEntry>();
  private readonly options: CircuitBreakerOptions;

  constructor(options: Partial<CircuitBreakerOptions> = {}, private readonly now: () => number = Date.now) {
    this.options = { ...DEFAULT_BREAKER_OPTIONS, ...options };
  }

  state(key: string): CircuitState {
    const entry = this.entries.get(key);
    if (!entry || entry.openedAt === null) return "closed";
    return this.now() - entry.openedAt >= this.options.resetTimeoutMs ? "half-open" : "open";
  }

  canRequest(key: string): boolean {
    const state = this.state(key);
    if (state === "open") return false;
    if (state === "half-open") {
      // A primeira chamada em meio-aberto sonda o provedor e "reabre" até provar.
      const entry = this.entries.get(key);
      if (entry) entry.openedAt = this.now();
    }
    return true;
  }

  onSuccess(key: string): void {
    this.entries.set(key, { failures: 0, openedAt: null });
  }

  onFailure(key: string): void {
    const entry = this.entries.get(key) ?? { failures: 0, openedAt: null };
    entry.failures += 1;
    if (entry.failures >= this.options.failureThreshold) {
      entry.openedAt = this.now();
    }
    this.entries.set(key, entry);
  }

  reset(key?: string): void {
    if (key) this.entries.delete(key);
    else this.entries.clear();
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) return operation;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(providerTimeout()), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export type ResilienceContext = {
  breaker?: CircuitBreaker;
  key?: string;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * Executa uma operação com timeout e retry (apenas em erros transitórios),
 * respeitando o circuit breaker. Erros de validação/autenticação NÃO são
 * repetidos.
 */
export async function executeWithResilience<T>(
  operation: (attempt: number) => Promise<T>,
  policy: ResiliencePolicy = DEFAULT_RESILIENCE_POLICY,
  context: ResilienceContext = {},
): Promise<T> {
  const breaker = context.breaker;
  const key = context.key ?? "default";
  const sleep = context.sleep ?? defaultSleep;

  if (breaker && !breaker.canRequest(key)) {
    throw providerTimeout("Provedor em modo de proteção (circuit breaker aberto).");
  }

  let lastError: unknown;
  const attempts = Math.max(1, policy.maxAttempts);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await withTimeout(operation(attempt), policy.timeoutMs);
      breaker?.onSuccess(key);
      return result;
    } catch (error) {
      lastError = error;
      const retryable = isShippingError(error) && error.retryable;
      breaker?.onFailure(key);
      if (!retryable || attempt >= attempts) break;
      const delay = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
      await sleep(delay + Math.floor(Math.random() * 50));
    }
  }

  throw lastError;
}
