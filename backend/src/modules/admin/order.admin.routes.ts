import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { writeAudit } from "../../lib/audit.js";
import { notFound } from "../../lib/errors.js";
import { ok, okPaginated, parse } from "../../lib/http.js";
import { paginate, parsePagination } from "../../lib/serialize.js";
import { getOrderReceipt, updateOrderStatus } from "../orders/order.service.js";

const idParam = z.object({ id: z.string().min(1) });

const ORDER_STATUSES = [
  "AWAITING_PAYMENT",
  "PAYMENT_REVIEW",
  "PAID",
  "PREPARING",
  "SHIPPED",
  "DELIVERED",
  "CANCELED",
  "REFUNDED",
] as const;

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.enum(ORDER_STATUSES).optional(),
  search: z.string().trim().max(120).optional(),
  paymentMethod: z.enum(["PIX", "CREDIT_CARD", "BOLETO", "MANUAL"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(500).optional(),
  trackingCode: z.string().trim().max(120).optional(),
  carrier: z.string().trim().max(120).optional(),
});

/** Gestao de pedidos no painel. */
export async function orderAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request, reply) => {
    const query = parse(listQuery, request.query);
    const { page, perPage, skip, take } = parsePagination(query);

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { number: { contains: query.search, mode: "insensitive" as const } },
              { user: { name: { contains: query.search, mode: "insensitive" as const } } },
              { user: { email: { contains: query.search, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };

    const [items, total, byStatus] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          number: true,
          status: true,
          subtotal: true,
          discount: true,
          shippingCost: true,
          total: true,
          paymentMethod: true,
          createdAt: true,
          paidAt: true,
          user: { select: { id: true, name: true, email: true, phone: true } },
          _count: { select: { items: true } },
          payments: { select: { status: true }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      }),
      prisma.order.count({ where }),
      prisma.order.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    return reply.status(200).send({
      data: items,
      meta: paginate<unknown>([], total, page, perPage).meta,
      statusCounts: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    });
  });

  app.get("/pending-count", async (_request, reply) => {
    const count = await prisma.order.count({
      where: { status: { in: ["AWAITING_PAYMENT", "PAYMENT_REVIEW", "PAID", "PREPARING"] } },
    });
    return ok(reply, { pending: count });
  });

  app.get("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const order = await prisma.order.findFirst({
      where: { OR: [{ id }, { number: id }] },
      include: {
        items: true,
        statusHistory: {
          orderBy: { createdAt: "asc" },
          include: { changedBy: { select: { name: true, email: true } } },
        },
        payments: {
          orderBy: { createdAt: "desc" },
          include: { attempts: { orderBy: { createdAt: "desc" }, take: 10 } },
        },
        shipment: { include: { shippingMethod: true } },
        user: { select: { id: true, name: true, email: true, phone: true, createdAt: true } },
        coupon: { select: { code: true, type: true, value: true } },
      },
    });
    if (!order) throw notFound("Pedido nao encontrado.");
    return ok(reply, order);
  });

  app.get("/:id/receipt", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const receipt = await getOrderReceipt("", id, true);
    return ok(reply, receipt);
  });

  app.patch("/:id/status", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(updateStatusSchema, request.body);

    const before = await prisma.order.findUnique({ where: { id }, select: { status: true, number: true } });
    if (!before) throw notFound("Pedido nao encontrado.");

    const updated = await updateOrderStatus(id, input.status, {
      adminId: request.authUser!.id,
      note: input.note,
      trackingCode: input.trackingCode,
      carrier: input.carrier,
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "UPDATE_STATUS",
      entity: "Order",
      entityId: id,
      before: { status: before.status },
      after: { status: input.status, note: input.note ?? null, trackingCode: input.trackingCode ?? null },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });

  /** Cancelamento pelo painel (respeitando as transicoes validas). */
  app.post("/:id/cancel", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(z.object({ note: z.string().trim().max(500).optional() }).default({}), request.body ?? {});

    const updated = await updateOrderStatus(id, "CANCELED", {
      adminId: request.authUser!.id,
      note: input.note ?? "Cancelado pelo administrador.",
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "CANCEL",
      entity: "Order",
      entityId: id,
      after: { status: "CANCELED", note: input.note ?? null },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });
}
