import type { FastifyInstance } from "fastify";
import { ok } from "../../lib/http.js";
import * as catalog from "./catalog.service.js";

/** Marcas publicas (filtro da vitrine). */
export async function brandRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    const brands = await catalog.listPublicBrands();
    reply.header("Cache-Control", "public, max-age=120, stale-while-revalidate=300");
    return ok(
      reply,
      brands.map((b) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        logoUrl: b.logoUrl,
        productCount: b._count.products,
      })),
    );
  });
}
