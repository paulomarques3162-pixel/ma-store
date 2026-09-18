import type { FastifyInstance } from "fastify";
import { ok, parse } from "../../lib/http.js";
import { slugParam } from "./catalog.schemas.js";
import * as catalog from "./catalog.service.js";

/** Categorias publicas (arvore usada no menu e na home). */
export async function categoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    const categories = await catalog.listPublicCategories();
    reply.header("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    return ok(
      reply,
      categories.map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        description: c.description,
        imageUrl: c.imageUrl,
        parentId: c.parentId,
        position: c.position,
        productCount: c._count.products,
      })),
    );
  });

  app.get("/:slug", async (request, reply) => {
    const { prisma } = await import("../../db.js");
    const { slug } = parse(slugParam, request.params);
    const category = await prisma.category.findFirst({
      where: { slug, active: true },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        imageUrl: true,
        parentId: true,
        children: {
          where: { active: true },
          orderBy: { position: "asc" },
          select: { id: true, name: true, slug: true },
        },
      },
    });
    if (!category) {
      const { notFound } = await import("../../lib/errors.js");
      throw notFound("Categoria nao encontrada.");
    }
    return ok(reply, category);
  });
}
