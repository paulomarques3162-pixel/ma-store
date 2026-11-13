import type { FastifyInstance } from "fastify";
import { sendCached } from "../../lib/http-cache.js";
import * as catalog from "./catalog.service.js";

/** Marcas publicas (filtro da vitrine). */
export async function brandRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request, reply) => {
    return sendCached(
      request,
      reply,
      {
        key: "catalog:brands",
        ttlMs: 60_000,
        cacheControl: "public, max-age=120, stale-while-revalidate=300",
      },
      async () => {
        const brands = await catalog.listPublicBrands();
        return {
          data: brands.map((b) => ({
            id: b.id,
            name: b.name,
            slug: b.slug,
            logoUrl: b.logoUrl,
            productCount: b._count.products,
          })),
        };
      },
    );
  });
}
