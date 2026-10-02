import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { ok, parse } from "../../lib/http.js";

const query = z.object({ position: z.string().trim().max(40).optional() });

/** Banners ativos e dentro da vigencia - totalmente gerenciados pelo admin. */
export async function bannerRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request, reply) => {
    const filters = parse(query, request.query);
    const now = new Date();

    const banners = await prisma.banner.findMany({
      where: {
        active: true,
        ...(filters.position ? { position: filters.position } : {}),
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: [{ position: "asc" }, { order: "asc" }],
      select: {
        id: true,
        title: true,
        subtitle: true,
        imageUrl: true,
        linkUrl: true,
        ctaLabel: true,
        position: true,
        order: true,
      },
    });

    reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return ok(reply, banners);
  });
}
