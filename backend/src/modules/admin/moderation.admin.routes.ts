import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { writeAudit } from "../../lib/audit.js";
import { notFound } from "../../lib/errors.js";
import { ok, okPaginated, parse } from "../../lib/http.js";
import { paginate, parsePagination } from "../../lib/serialize.js";
import { expireStalePayments } from "../payments/payment.service.js";

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  type: z.enum(["PRODUCT", "DELIVERY", "EXPERIENCE"]).optional(),
});

/** Consulta generica de listagem paginada (webhooks, etc). */
const pagedQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(20),
});

/** Pagamentos usam os seus proprios status (nunca o status de moderacao). */
const paymentsQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.enum(["PENDING", "APPROVED", "DECLINED", "CANCELED", "EXPIRED", "REFUNDED"]).optional(),
  method: z.enum(["PIX", "CREDIT_CARD", "BOLETO", "MANUAL"]).optional(),
});

/**
 * Moderacao de conteudo e acompanhamento de pagamentos.
 *
 * O painel permite esconder comentarios abusivos/spam, mas NUNCA editar o texto
 * original do cliente (integridade do feedback).
 */
export async function moderationAdminRoutes(app: FastifyInstance): Promise<void> {
  // ---- Avaliacoes -----------------------------------------------------------
  app.get("/reviews", async (request, reply) => {
    const query = parse(listQuery, request.query);
    const { page, perPage, skip, take } = parsePagination(query);

    const where = { ...(query.status ? { status: query.status } : {}) };

    const [items, total, counts] = await Promise.all([
      prisma.review.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          rating: true,
          title: true,
          comment: true,
          status: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
          product: { select: { id: true, name: true, slug: true } },
          order: { select: { number: true } },
        },
      }),
      prisma.review.count({ where }),
      prisma.review.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    return reply.status(200).send({
      data: items,
      meta: paginate<unknown>([], total, page, perPage).meta,
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    });
  });

  app.patch("/reviews/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]) }), request.body);

    const current = await prisma.review.findUnique({ where: { id }, select: { status: true, productId: true } });
    if (!current) throw notFound("Avaliacao nao encontrada.");

    const updated = await prisma.review.update({
      where: { id },
      data: { status: input.status },
      select: { id: true, status: true, productId: true },
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "MODERATE_REVIEW",
      entity: "Review",
      entityId: id,
      before: { status: current.status },
      after: { status: input.status },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });

  app.delete("/reviews/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const current = await prisma.review.findUnique({ where: { id }, select: { rating: true, productId: true } });
    if (!current) throw notFound("Avaliacao nao encontrada.");

    await prisma.review.delete({ where: { id } });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "DELETE_REVIEW",
      entity: "Review",
      entityId: id,
      before: { rating: current.rating },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, { deleted: true });
  });

  // ---- Feedbacks ------------------------------------------------------------
  app.get("/feedbacks", async (request, reply) => {
    const query = parse(listQuery, request.query);
    const { page, perPage, skip, take } = parsePagination(query);

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
    };

    const [items, total, counts] = await Promise.all([
      prisma.feedback.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        include: {
          user: { select: { id: true, name: true, email: true } },
          order: { select: { number: true } },
        },
      }),
      prisma.feedback.count({ where }),
      prisma.feedback.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    return reply.status(200).send({
      data: items,
      meta: paginate<unknown>([], total, page, perPage).meta,
      statusCounts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    });
  });

  app.patch("/feedbacks/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(z.object({ status: z.enum(["PENDING", "APPROVED", "REJECTED"]) }), request.body);

    const current = await prisma.feedback.findUnique({ where: { id }, select: { status: true } });
    if (!current) throw notFound("Feedback nao encontrado.");

    const updated = await prisma.feedback.update({ where: { id }, data: { status: input.status } });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "MODERATE_FEEDBACK",
      entity: "Feedback",
      entityId: id,
      before: { status: current.status },
      after: { status: input.status },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });

  app.delete("/feedbacks/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const current = await prisma.feedback.findUnique({ where: { id }, select: { comment: true } });
    if (!current) throw notFound("Feedback nao encontrado.");

    await prisma.feedback.delete({ where: { id } });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "DELETE_FEEDBACK",
      entity: "Feedback",
      entityId: id,
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, { deleted: true });
  });

  // ---- Pagamentos -----------------------------------------------------------
  app.get("/payments", async (request, reply) => {
    const query = parse(paymentsQuery, request.query);
    const { page, perPage, skip, take } = parsePagination(query);

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.method ? { method: query.method } : {}),
    };

    const [items, total, summary] = await Promise.all([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          method: true,
          status: true,
          amount: true,
          provider: true,
          providerRef: true,
          expiresAt: true,
          approvedAt: true,
          createdAt: true,
          order: { select: { id: true, number: true, user: { select: { name: true, email: true } } } },
          _count: { select: { attempts: true } },
        },
      }),
      prisma.payment.count({ where }),
      prisma.payment.groupBy({ by: ["status"], _sum: { amount: true }, _count: { _all: true } }),
    ]);

    return reply.status(200).send({
      data: items,
      meta: paginate<unknown>([], total, page, perPage).meta,
      summary: summary.map((s) => ({ status: s.status, count: s._count._all, amount: s._sum.amount ?? 0 })),
      environment: process.env.PAYMENT_ENV ?? "sandbox",
    });
  });

  /** Expira pagamentos pendentes vencidos (mantem o pedido consistente). */
  app.post("/payments/expire-stale", async (request, reply) => {
    const result = await expireStalePayments();

    await writeAudit({
      adminId: request.authUser!.id,
      action: "EXPIRE_STALE_PAYMENTS",
      entity: "Payment",
      after: { expired: result.expired },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, result);
  });

  // ---- Webhooks (auditoria) -------------------------------------------------
  app.get("/webhooks", async (request, reply) => {
    const query = parse(pagedQuery, request.query);
    const { page, perPage, skip, take } = parsePagination(query);

    const [items, total] = await Promise.all([
      prisma.webhookEvent.findMany({ orderBy: { createdAt: "desc" }, skip, take }),
      prisma.webhookEvent.count(),
    ]);

    return okPaginated(reply, paginate(items, total, page, perPage));
  });
}
