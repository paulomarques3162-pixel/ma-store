import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { conflict, notFound } from "../../lib/errors.js";
import { ok, parse } from "../../lib/http.js";
import { publicProductSelect } from "../../lib/serialize.js";

const productParam = z.object({ productId: z.string().min(1) });

/** Favoritos do cliente autenticado. */
export async function favoriteRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request, reply) => {
    const favorites = await prisma.favorite.findMany({
      where: { userId: request.authUser!.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        product: { select: publicProductSelect },
      },
    });

    return ok(
      reply,
      favorites.map((f) => ({ id: f.id, createdAt: f.createdAt, product: f.product })),
    );
  });

  app.get("/ids", async (request, reply) => {
    const favorites = await prisma.favorite.findMany({
      where: { userId: request.authUser!.id },
      select: { productId: true },
    });
    return ok(reply, favorites.map((f) => f.productId));
  });

  app.post("/:productId", async (request, reply) => {
    const { productId } = parse(productParam, request.params);

    const product = await prisma.product.findFirst({
      where: { id: productId, active: true },
      select: { id: true },
    });
    if (!product) throw notFound("Produto nao encontrado.");

    const existing = await prisma.favorite.findUnique({
      where: { userId_productId: { userId: request.authUser!.id, productId } },
    });
    if (existing) throw conflict("Este produto ja esta nos seus favoritos.");

    await prisma.favorite.create({ data: { userId: request.authUser!.id, productId } });
    return ok(reply, { favorited: true, productId });
  });

  app.delete("/:productId", async (request, reply) => {
    const { productId } = parse(productParam, request.params);
    await prisma.favorite.deleteMany({ where: { userId: request.authUser!.id, productId } });
    return ok(reply, { favorited: false, productId });
  });
}
