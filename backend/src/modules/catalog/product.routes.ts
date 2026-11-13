import type { FastifyInstance } from "fastify";
import { ok, parse } from "../../lib/http.js";
import { cacheKeyFromQuery, sendCached } from "../../lib/http-cache.js";
import { paginate, parsePagination } from "../../lib/serialize.js";
import { idParam, listProductQuery, slugParam } from "./catalog.schemas.js";
import * as catalog from "./catalog.service.js";

/** Rotas publicas de produto: vitrine, busca, filtros e pagina do produto. */
export async function productRoutes(app: FastifyInstance): Promise<void> {
  // Cache curto na memoria + ETag/304 + Cache-Control de borda.
  // A invalidacao acontece em toda mutacao administrativa (ver admin.routes).
  app.get("/", async (request, reply) => {
    const query = parse(listProductQuery, request.query);
    const { page, perPage, skip, take } = parsePagination(query);
    return sendCached(
      request,
      reply,
      {
        key: cacheKeyFromQuery("catalog:products", { ...query, page, perPage }),
        ttlMs: 20_000,
        cacheControl: "public, max-age=30, stale-while-revalidate=120",
      },
      async () => {
        const { items, total } = await catalog.listPublicProducts(query, skip, take);
        return { data: items, meta: paginate([], total, page, perPage).meta };
      },
    );
  });

  app.get("/facets", async (request, reply) => {
    return sendCached(
      request,
      reply,
      {
        key: "catalog:facets",
        ttlMs: 60_000,
        cacheControl: "public, max-age=120, stale-while-revalidate=300",
      },
      async () => ({ data: await catalog.getCatalogFacets() }),
    );
  });

  app.get("/:slug", async (request, reply) => {
    const { slug } = parse(slugParam, request.params);
    return sendCached(
      request,
      reply,
      {
        key: `catalog:product:${slug}`,
        ttlMs: 30_000,
        cacheControl: "public, max-age=30, stale-while-revalidate=120",
      },
      async () => ({ data: await catalog.getPublicProductBySlug(slug) }),
    );
  });

  app.get("/:slug/related", async (request, reply) => {
    const { slug } = parse(slugParam, request.params);
    return sendCached(
      request,
      reply,
      { key: `catalog:related:${slug}`, ttlMs: 60_000 },
      async () => {
        const product = await catalog.getPublicProductBySlug(slug);
        return { data: await catalog.listRelatedProducts(product.id, product.categoryId) };
      },
    );
  });

  app.get("/:slug/reviews", async (request, reply) => {
    const { prisma } = await import("../../db.js");
    const { slug } = parse(slugParam, request.params);
    const product = await catalog.getPublicProductBySlug(slug);

    const reviews = await prisma.review.findMany({
      where: { productId: product.id, status: "APPROVED" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        rating: true,
        title: true,
        comment: true,
        createdAt: true,
        user: { select: { name: true } },
      },
    });

    const aggregate = await prisma.review.aggregate({
      where: { productId: product.id, status: "APPROVED" },
      _avg: { rating: true },
      _count: { _all: true },
    });

    return ok(reply, {
      items: reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        title: r.title,
        comment: r.comment,
        createdAt: r.createdAt,
        author: r.user?.name ?? "Cliente",
      })),
      average: aggregate._avg.rating ?? 0,
      total: aggregate._count._all,
    });
  });

  app.get("/:slug/availability", async (request, reply) => {
    const { slug } = parse(slugParam, request.params);
    const product = await catalog.getPublicProductBySlug(slug);
    return ok(reply, {
      available: product.stock > 0,
      stock: Math.max(0, product.stock),
    });
  });

  // Rota de admin reutiliza o mesmo modulo apenas para leitura por id.
  app.get("/id/:id", { preHandler: app.requireAdmin }, async (request, reply) => {
    const { prisma } = await import("../../db.js");
    const { id } = parse(idParam, request.params);
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        images: { orderBy: { position: "asc" } },
        brand: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
      },
    });
    if (!product) throw new Error("Produto nao encontrado.");
    return ok(reply, product);
  });
}
