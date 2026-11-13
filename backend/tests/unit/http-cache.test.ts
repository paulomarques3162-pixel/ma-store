import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { cacheKeyFromQuery, sendCached } from "../../src/lib/http-cache.js";
import { resetCacheForTests } from "../../src/lib/cache.js";

/**
 * ETag/304: o navegador do cliente revalida a vitrine sem baixar o JSON de
 * novo. Também garante que a chave de cache inclui todos os filtros.
 */
describe("sendCached (ETag + Cache-Control)", () => {
  const app = Fastify({ logger: false });
  const loader = vi.fn(async () => ({ data: [{ id: "p1", price: 19.9 }], meta: { total: 1 } }));
  let calls = 0;

  app.get("/products", async (request, reply) => {
    const key = cacheKeyFromQuery("catalog:products", request.query as Record<string, unknown>);
    return sendCached(request, reply, { key, ttlMs: 60_000, cacheControl: "public, max-age=30" }, async () => {
      calls += 1;
      return loader();
    });
  });

  afterAll(async () => {
    await app.close();
    resetCacheForTests();
  });

  it("responde com ETag e Cache-Control público", async () => {
    resetCacheForTests();
    const response = await app.inject({ method: "GET", url: "/products?page=1" });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toMatch(/^W\/"/);
    expect(response.headers["cache-control"]).toBe("public, max-age=30");
    expect(response.json()).toEqual({ data: [{ id: "p1", price: 19.9 }], meta: { total: 1 } });
  });

  it("devolve 304 quando o If-None-Match corresponde", async () => {
    resetCacheForTests();
    const first = await app.inject({ method: "GET", url: "/products?page=1" });
    const etag = first.headers.etag as string;

    const second = await app.inject({
      method: "GET",
      url: "/products?page=1",
      headers: { "if-none-match": etag },
    });

    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
  });

  it("não compartilha cache entre filtros diferentes", async () => {
    resetCacheForTests();
    const before = calls;
    await app.inject({ method: "GET", url: "/products?page=1&search=perfume" });
    await app.inject({ method: "GET", url: "/products?page=1&search=kit" });
    expect(calls - before).toBe(2);
  });

  it("gera chave estável independente da ordem dos parâmetros", () => {
    expect(cacheKeyFromQuery("catalog:products", { page: 1, search: "x" })).toBe(
      cacheKeyFromQuery("catalog:products", { search: "x", page: 1 }),
    );
    expect(cacheKeyFromQuery("catalog:products", { page: 1, search: "" })).toBe("catalog:products:page=1");
  });
});
