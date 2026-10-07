import type { FastifyInstance } from "fastify";
import { ok, okPaginated, parse } from "../../lib/http.js";
import { paginate, parsePagination } from "../../lib/serialize.js";
import { idParam, listProductQuery, slugParam } from "./catalog.schemas.js";
import * as catalog from "./catalog.service.js";

/** Rotas publicas de produto: vitrine, busca, filtros e pagina do produto. */
export async function productRoutes(app: FastifyInstance): Promise<void> {
  // Cache curto na borda: dados de vitrine mudam pouco e sao publicos.
  app.get("/", async (request, reply) => {
    const query = parse(listProductQuery, request.query);
    const { page, perPage, skip, take } = parsePagination(query);
    const { items, total } = await catalog.listPublicProducts(query, skip, take);
    reply.header("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    return okPaginated(reply, paginate(items, total, page, perPage));
  });

  app.get("/facets", async (_request, reply) => {
    const facets = await catalog.getCatalogFacets();
    reply.header("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    return ok(reply, facets);
  });

  app.get("/:slug", async (request, reply) => {
    const { slug } = parse(slugParam, request.params);
    const product = await catalog.getPublicProductBySlug(slug);
    reply.header("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
    return ok(reply, product);
  });

  app.get("/:slug/related", async (request, reply) => {
    const { slug } = parse(slugParam, request.params);
    const product = await catalog.getPublicProductBySlug(slug);
    const related = await catalog.listRelatedProducts(product.id, product.categoryId);
    return ok(reply, related);
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
