/**
 * Cache curto do Shipping Engine proprio.
 *
 * Decisao de projeto: NAO usamos Redis (nao existe na infra atual). Um cache
 * em memoria por processo com TTL curto e suficiente, e a chave inclui:
 *   - CEP de destino;
 *   - itens (produto + quantidade + `updatedAt` do produto);
 *   - valor do pedido;
 *   - `configVersion` das configuracoes/regras.
 *
 * Assim, qualquer alteracao administrativa (que incrementa `configVersion`)
 * ou qualquer edicao de produto invalida a entrada naturalmente — o cache
 * nunca devolve frete incorreto depois de uma mudanca.
 */
import type { LocalQuoteResult } from "../domain/types.js";

type Entry = { value: LocalQuoteResult; expiresAt: number };

export class LocalShippingCache {
  private readonly store = new Map<string, Entry>();

  constructor(private readonly ttlMs: number = 30_000) {}

  get(key: string): LocalQuoteResult | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key: string, value: LocalQuoteResult): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    // Poda simples para nao crescer indefinidamente.
    if (this.store.size > 500) {
      const now = Date.now();
      for (const [k, entry] of this.store) {
        if (entry.expiresAt <= now) this.store.delete(k);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}

export function buildCacheKey(input: {
  normalizedZipCode: string;
  orderValue: number;
  configVersion: number;
  items: Array<{ productId: string; quantity: number; updatedAt: string }>;
}): string {
  const itemsSignature = input.items
    .map((item) => `${item.productId}:${item.quantity}:${item.updatedAt}`)
    .sort()
    .join("|");
  return `local_shipping:${input.normalizedZipCode}:${input.orderValue}:${input.configVersion}:${itemsSignature}`;
}
