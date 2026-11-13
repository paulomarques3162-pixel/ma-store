/**
 * Cache em memoria de CURTA duracao para leituras publicas da vitrine.
 *
 * Por que existe: cada abertura da home/categoria/busca executava as mesmas
 * consultas Prisma (produtos + count + facetas + categorias). Com dezenas de
 * visitantes simultaneos isso vira carga repetida no PostgreSQL sem nenhuma
 * mudanca no resultado.
 *
 * Regras de seguranca e consistencia:
 *  - SOMENTE dados publicos (produtos ativos, categorias, marcas, facetas).
 *    Nunca pedidos, clientes, tokens ou qualquer dado por usuario;
 *  - TTL curto (padrao 20 s) — a vitrine pode ficar alguns segundos atras sem
 *    prejuizo comercial;
 *  - invalidacao EXPLICITA em toda mutacao administrativa e em mudanca de
 *    estoque (checkout/webhook), de modo que o painel reflete na hora;
 *  - `singleflight`: requisicoes concorrentes para a mesma chave executam a
 *    consulta UMA vez (evita "thundering herd" no primeiro acesso);
 *  - LRU limitado: memoria constante mesmo com muitas combinacoes de filtros.
 */

type Entry = { value: string; expiresAt: number; lastUsed: number };

const DEFAULT_TTL_MS = 20_000;
const MAX_ENTRIES = 300;

const store = new Map<string, Entry>();
const inFlight = new Map<string, Promise<string>>();

function evictIfNeeded(): void {
  if (store.size <= MAX_ENTRIES) return;
  // Remove primeiro as entradas expiradas; se ainda estiver cheio, remove a
  // menos usada recentemente.
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
  while (store.size > MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestUse = Number.POSITIVE_INFINITY;
    for (const [key, entry] of store) {
      if (entry.lastUsed < oldestUse) {
        oldestUse = entry.lastUsed;
        oldestKey = key;
      }
    }
    if (!oldestKey) break;
    store.delete(oldestKey);
  }
}

/**
 * Le do cache (ou executa `loader`) e guarda o resultado por `ttlMs`.
 * O valor e sempre a string JSON ja serializada — quem chama decide o formato.
 */
export async function cachedJson(key: string, ttlMs: number, loader: () => Promise<string>): Promise<string> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    hit.lastUsed = now;
    return hit.value;
  }
  if (hit) store.delete(key);

  const pending = inFlight.get(key);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const value = await loader();
      store.set(key, { value, expiresAt: Date.now() + ttlMs, lastUsed: Date.now() });
      evictIfNeeded();
      return value;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

/** Invalida uma chave, um prefixo (`"products:"`) ou todo o cache. */
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    store.clear();
    return;
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Invalida todas as leituras publicas do catalogo. */
export function invalidateCatalogCache(): void {
  invalidateCache("catalog:");
}

/** Metricas simples para diagnostico (nao expoe conteudo). */
export function cacheStats(): { entries: number; pending: number } {
  return { entries: store.size, pending: inFlight.size };
}

/** Usado apenas em testes. */
export function resetCacheForTests(): void {
  store.clear();
  inFlight.clear();
}
