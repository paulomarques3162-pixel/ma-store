import { createHash } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { cachedJson } from "./cache.js";
import { serialize } from "./serialize.js";

/**
 * Resposta publica com cache em memoria + ETag + Cache-Control.
 *
 * Fluxo:
 *  1. consulta o cache (singleflight) — uma unica execucao por chave;
 *  2. serializa o envelope `{ data, meta? }` (Decimal -> number) UMA vez;
 *  3. calcula `ETag` (hash do corpo) e devolve 304 quando o cliente ja tem a
 *     mesma versao (`If-None-Match`), economizando banda e parse de JSON;
 *  4. envia o JSON ja pronto, evitando re-serializacao a cada requisicao.
 *
 * NADA aqui pode ser usado em rota autenticada: o cache e compartilhado entre
 * todos os visitantes. As rotas administrativas e de pedidos continuam sem
 * cache.
 */

export type CachedResponseOptions = {
  /** Chave unica e determinística (inclui filtros, pagina e ordenacao). */
  key: string;
  /** Tempo de vida do cache em milissegundos. */
  ttlMs?: number;
  /** Cabecalho `Cache-Control` publico (sem dados privados). */
  cacheControl?: string;
};

const DEFAULT_TTL_MS = 20_000;
const DEFAULT_CACHE_CONTROL = "public, max-age=20, stale-while-revalidate=120";

/** Monta uma chave de cache estavel a partir de query params (ordem fixa). */
export function cacheKeyFromQuery(prefix: string, query: Record<string, unknown> = {}): string {
  const parts = Object.keys(query)
    .filter((key) => query[key] !== undefined && query[key] !== null && query[key] !== "")
    .sort()
    .map((key) => `${key}=${String(query[key])}`);
  return `${prefix}:${parts.join("&")}`;
}

function weakEtag(payload: string): string {
  return `W/"${createHash("sha1").update(payload).digest("base64url")}"`;
}

function ifNoneMatchMatches(header: string | string[] | undefined, etag: string): boolean {
  if (!header) return false;
  const raw = Array.isArray(header) ? header.join(",") : header;
  return raw
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === etag || value === "*");
}

export type LoadedPayload = { data: unknown; meta?: unknown };

export async function sendCached(
  request: FastifyRequest,
  reply: FastifyReply,
  options: CachedResponseOptions,
  loader: () => Promise<LoadedPayload>,
): Promise<FastifyReply> {
  const payload = await cachedJson(options.key, options.ttlMs ?? DEFAULT_TTL_MS, async () => {
    const { data, meta } = await loader();
    const body = meta === undefined ? { data: serialize(data) } : { data: serialize(data), meta: serialize(meta) };
    return JSON.stringify(body);
  });

  const etag = weakEtag(payload);
  reply.header("ETag", etag);
  reply.header("Cache-Control", options.cacheControl ?? DEFAULT_CACHE_CONTROL);

  if (ifNoneMatchMatches(request.headers["if-none-match"], etag)) {
    return reply.status(304).send();
  }

  return reply.type("application/json; charset=utf-8").send(payload);
}
