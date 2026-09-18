import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { created, ok, parse } from "../../lib/http.js";

const productParam = z.object({ productId: z.string().min(1) });

const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1, "Nota de 1 a 5.").max(5, "Nota de 1 a 5."),
  title: z.string().trim().max(120).optional().or(z.literal("")),
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
  orderId: z.string().optional(),
});

const feedbackSchema = z.object({
  type: z.enum(["PRODUCT", "DELIVERY", "EXPERIENCE"]).default("EXPERIENCE"),
  orderId: z.string().optional(),
  productId: z.string().optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  comment: z.string().trim().max(2000).optional().or(z.literal("")),
  contact: z.string().trim().max(160).optional().or(z.literal("")),
});

/**
 * Avaliacoes e feedback.
 *
 * Regra do projeto: so quem COMPROU pode avaliar o produto (pedido entregue).
 * Isso evita avaliacoes e depoimentos inventados.
 */
export async function reviewRoutes(app: FastifyInstance): Promise<void> {
  app.post("/products/:productId/reviews", { preHandler: app.authenticate }, async (request, reply) => {
    const { productId } = parse(productParam, request.params);
    const input = parse(reviewSchema, request.body);
    const userId = request.authUser!.id;

    const product = await prisma.product.findFirst({ where: { id: productId, active: true }, select: { id: true } });
    if (!product) throw notFound("Produto nao encontrado.");

    // Precisa ter recebido o produto em algum pedido entregue.
    const delivered = await prisma.order.findFirst({
      where: {
        userId,
        status: "DELIVERED",
        items: { some: { productId } },
        ...(input.orderId ? { id: input.orderId } : {}),
      },
      select: { id: true },
      orderBy: { deliveredAt: "desc" },
    });

    if (!delivered) {
      throw badRequest(
        "Voce so pode avaliar produtos que ja recebeu. Assim que seu pedido for entregue, a avaliacao fica disponivel.",
      );
    }

    const existing = await prisma.review.findFirst({
      where: { productId, userId, orderId: delivered.id },
      select: { id: true },
    });
    if (existing) throw conflict("Voce ja avaliou este produto neste pedido.");

    const review = await prisma.review.create({
      data: {
        productId,
        userId,
        orderId: delivered.id,
        rating: input.rating,
        title: input.title || null,
        comment: input.comment || null,
        status: "PENDING",
      },
      select: { id: true, rating: true, title: true, comment: true, status: true, createdAt: true },
    });

    return created(reply, {
      ...review,
      message: "Avaliacao enviada! Ela aparece no site apos a moderacao.",
    });
  });

  app.get("/reviews/mine", { preHandler: app.authenticate }, async (request, reply) => {
    const reviews = await prisma.review.findMany({
      where: { userId: request.authUser!.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        rating: true,
        title: true,
        comment: true,
        status: true,
        createdAt: true,
        product: { select: { id: true, name: true, slug: true } },
      },
    });
    return ok(reply, reviews);
  });

  /** Produtos comprados e ainda nao avaliados (usado na tela de feedback). */
  app.get("/reviews/pending", { preHandler: app.authenticate }, async (request, reply) => {
    const orders = await prisma.order.findMany({
      where: { userId: request.authUser!.id, status: "DELIVERED" },
      select: {
        id: true,
        number: true,
        items: { select: { productId: true, nameSnapshot: true } },
      },
      orderBy: { deliveredAt: "desc" },
      take: 20,
    });

    const reviewed = await prisma.review.findMany({
      where: { userId: request.authUser!.id },
      select: { productId: true, orderId: true },
    });
    const reviewedKeys = new Set(reviewed.map((r) => `${r.orderId}:${r.productId}`));

    const pending = orders.flatMap((order) =>
      order.items
        .filter((item) => item.productId && !reviewedKeys.has(`${order.id}:${item.productId}`))
        .map((item) => ({
          orderId: order.id,
          orderNumber: order.number,
          productId: item.productId,
          productName: item.nameSnapshot,
        })),
    );

    return ok(reply, pending);
  });

  app.post("/feedback", { preHandler: app.authenticate }, async (request, reply) => {
    const input = parse(feedbackSchema, request.body);
    const userId = request.authUser!.id;

    if (input.orderId) {
      const order = await prisma.order.findFirst({ where: { id: input.orderId, userId }, select: { id: true } });
      if (!order) throw notFound("Pedido nao encontrado na sua conta.");
    }

    const feedback = await prisma.feedback.create({
      data: {
        userId,
        orderId: input.orderId ?? null,
        productId: input.productId ?? null,
        type: input.type,
        rating: input.rating ?? null,
        comment: input.comment || null,
        contact: input.contact || null,
        status: "PENDING",
      },
      select: { id: true, type: true, rating: true, comment: true, status: true, createdAt: true },
    });

    const admins = await prisma.user.findMany({ where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } });
    if (admins.length > 0) {
      await prisma.notification.createMany({
        data: admins.map((admin) => ({
          userId: admin.id,
          type: "NEW_FEEDBACK" as const,
          title: "Novo feedback recebido",
          body: input.comment?.slice(0, 100) ?? "Sem comentario.",
          link: "/admin/feedbacks",
        })),
      });
    }

    return created(reply, { ...feedback, message: "Obrigado pelo seu feedback!" });
  });

  app.get("/feedback/mine", { preHandler: app.authenticate }, async (request, reply) => {
    const items = await prisma.feedback.findMany({
      where: { userId: request.authUser!.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, type: true, rating: true, comment: true, status: true, createdAt: true },
    });
    return ok(reply, items);
  });
}
