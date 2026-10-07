import { createHash } from "node:crypto";
import { normalizePackages, summarizePackages } from "../domain/package.js";
import { normalizePostalCode } from "../domain/postal-code.js";
import type { ShippingQuote, ShippingQuoteRequest } from "../domain/types.js";

export interface ShippingCache {
  get(key: string): ShippingQuote[] | undefined;
  set(key: string, quotes: readonly ShippingQuote[], ttlMs: number): void;
  clear(): void;
  size(): number;
}

export class InMemoryShippingCache implements ShippingCache {
  private readonly entries = new Map<string, { quotes: ShippingQuote[]; expiresAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  get(key: string): ShippingQuote[] | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.quotes;
  }

  set(key: string, quotes: readonly ShippingQuote[], ttlMs: number): void {
    if (ttlMs <= 0) return;
    // Copia defensiva: o chamador não deve conseguir mutar o cache.
    this.entries.set(key, { quotes: quotes.map((quote) => ({ ...quote })), expiresAt: this.now() + ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

export type CacheKeyInput = {
  storeId: string;
  provider: string;
  request: ShippingQuoteRequest;
  /** Impede servir preço antigo após mudança de regras da loja. */
  configFingerprint?: string;
};

/**
 * Chave determinística e sem dados sensíveis (hash SHA-256).
 * Considera loja, provedor, CEPs, volumes normalizados, valor declarado,
 * valor do pedido, serviços, moeda e a configuração relevante da loja.
 */
export function buildCacheKey(input: CacheKeyInput): string {
  const request = input.request;
  const packages = normalizePackages(request.packages);
  const summary = summarizePackages(packages);

  const payload = JSON.stringify({
    store: input.storeId,
    provider: input.provider.toLowerCase(),
    origin: normalizePostalCode(request.origin.postalCode),
    destination: normalizePostalCode(request.destination.postalCode),
    packages: packages.map((pkg) => ({
      w: pkg.weightGrams,
      h: pkg.heightCm,
      l: pkg.lengthCm,
      d: pkg.widthCm,
      q: pkg.quantity,
      c: pkg.cubicWeightGrams,
    })),
    billed: summary.totalBilledWeightGrams,
    declaredValue: request.declaredValue ?? null,
    orderValue: request.orderValue ?? null,
    services: [...(request.services ?? [])].map((service) => service.trim().toLowerCase()).sort(),
    currency: request.currency ?? "BRL",
    config: input.configFingerprint ?? "",
  });

  return createHash("sha256").update(payload).digest("hex");
}

/** Impressão digital estável da configuração que afeta o preço. */
export function configFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 16);
}
