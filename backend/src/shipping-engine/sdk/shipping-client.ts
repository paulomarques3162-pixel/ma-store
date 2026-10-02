import type { ShippingErrorCode } from "../domain/errors.js";
import type { ShippingQuote } from "../domain/types.js";
import type { ShippingQuoteRequestDto } from "../http/schemas.js";

export type ShippingErrorPayload = {
  success: false;
  error: { code: ShippingErrorCode | "INVALID_REQUEST" | "NETWORK_ERROR"; message: string; details?: unknown };
};

export type ShippingQuoteResponse = {
  success: boolean;
  data: {
    quotes: ShippingQuote[];
    warnings: string[];
    errors: Array<{ provider: string; code: string; message: string }>;
    meta: Record<string, unknown>;
  };
};

export type ShippingClientOptions = {
  /** Ex.: "https://api.minhaloja.com/api/v1/shipping" */
  baseUrl: string;
  /** Injeção para testes/Node. */
  fetchImpl?: typeof fetch;
  /** Headers extras (ex.: Authorization de loja). */
  headers?: Record<string, string>;
};

export class ShippingClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ShippingClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * SDK universal do Shipping Engine — funciona em React, Next.js, Vite, Vue,
 * Angular e JS puro (usa `fetch`). Não conhece nada de Correios internamente.
 */
export class ShippingClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(options: ShippingClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.headers = { "Content-Type": "application/json", ...(options.headers ?? {}) };
  }

  async quotes(request: ShippingQuoteRequestDto): Promise<ShippingQuoteResponse> {
    return this.request<ShippingQuoteResponse>("/quotes", { method: "POST", body: JSON.stringify(request) });
  }

  async validate(request: ShippingQuoteRequestDto): Promise<{ success: boolean; data: unknown }> {
    return this.request("/validate", { method: "POST", body: JSON.stringify(request) });
  }

  async providers(): Promise<{ success: boolean; data: { providers: unknown[] } }> {
    return this.request("/providers", { method: "GET" });
  }

  async services(): Promise<{ success: boolean; data: { services: unknown[] } }> {
    return this.request("/services", { method: "GET" });
  }

  async health(): Promise<{ status: string; providers: Record<string, string> }> {
    return this.request("/health", { method: "GET" });
  }

  private async request<T>(path: string, init: { method: string; body?: string }): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: this.headers,
        ...(init.body ? { body: init.body } : {}),
      });
    } catch {
      throw new ShippingClientError(0, "NETWORK_ERROR", "Não foi possível conectar ao serviço de frete.");
    }

    const payload = (await response.json().catch(() => null)) as
      | (T & { success?: boolean; error?: { code: string; message: string; details?: unknown } })
      | null;

    if (!response.ok || (payload && payload.success === false)) {
      const error = payload?.error;
      throw new ShippingClientError(
        response.status,
        error?.code ?? "SHIPPING_ERROR",
        error?.message ?? "Não foi possível calcular o frete.",
        error?.details,
      );
    }

    return payload as T;
  }
}
