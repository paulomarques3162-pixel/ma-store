import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { ok, okPaginated, parse } from "../../lib/http.js";
import { paginate, parsePagination } from "../../lib/serialize.js";
import { contentAdminRoutes } from "./content.admin.routes.js";
import { brandAdminRoutes } from "./brand.admin.routes.js";
import { categoryAdminRoutes } from "./category.admin.routes.js";
import { conversationAdminRoutes } from "./conversation.admin.routes.js";
import { couponAdminRoutes } from "./coupon.admin.routes.js";
import { moderationAdminRoutes } from "./moderation.admin.routes.js";
import { orderAdminRoutes } from "./order.admin.routes.js";
import { productAdminRoutes } from "./product.admin.routes.js";
import { shippingAdminRoutes } from "./shipping.admin.routes.js";

const auditQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(30),
  entity: z.string().trim().max(60).optional(),
  action: z.string().trim().max(60).optional(),
  adminId: z.string().optional(),
});

/**
 * Painel administrativo.
 *
 * Toda rota aqui exige role ADMIN (validado no backend). Os graficos usam
 * SOMENTE dados reais de pedidos - sem numeros de exemplo.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  // ---- Dashboard ------------------------------------------------------------
  app.get("/dashboard", async (_request, reply) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const paidStatuses = ["PAID", "PREPARING", "SHIPPED", "DELIVERED"] as const;

    const [
      ordersToday,
      ordersMonth,
      pendingOrders,
      revenueMonth,
      revenueTotal,
      customers,
      newCustomersMonth,
      productsActive,
      productsOutOfStock,
      lowStock,
      reviewsPending,
      feedbackPending,
      unreadConversations,
      activeCoupons,
      salesByDay,
      topProducts,
      recentOrders,
    ] = await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: startOfDay } } }),
      prisma.order.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.order.count({ where: { status: { in: ["AWAITING_PAYMENT", "PAYMENT_REVIEW", "PAID", "PREPARING"] } } }),
      prisma.order.aggregate({
        where: { status: { in: [...paidStatuses] }, createdAt: { gte: startOfMonth } },
        _sum: { total: true },
      }),
      prisma.order.aggregate({ where: { status: { in: [...paidStatuses] } }, _sum: { total: true } }),
      prisma.user.count({ where: { role: "CLIENT" } }),
      prisma.user.count({ where: { role: "CLIENT", createdAt: { gte: startOfMonth } } }),
      prisma.product.count({ where: { active: true } }),
      prisma.product.count({ where: { active: true, stock: 0 } }),
      prisma.product.count({ where: { active: true, minStock: { gt: 0 } } }),
      prisma.review.count({ where: { status: "PENDING" } }),
      prisma.feedback.count({ where: { status: "PENDING" } }),
      prisma.conversation.aggregate({ where: { unreadForAdmin: { gt: 0 } }, _count: { _all: true } }),
      prisma.coupon.count({ where: { active: true } }),
      prisma.$queryRaw<Array<{ day: Date; orders: bigint; revenue: unknown }>>`
        SELECT date_trunc('day', "createdAt") AS day,
               COUNT(*)::bigint AS orders,
               COALESCE(SUM("total"), 0) AS revenue
          FROM "orders"
         WHERE "createdAt" >= ${thirtyDaysAgo}
           AND "status"::text = ANY (ARRAY['PAID','PREPARING','SHIPPED','DELIVERED'])
         GROUP BY 1
         ORDER BY 1 ASC
      `,
      prisma.orderItem.groupBy({
        by: ["nameSnapshot"],
        _sum: { quantity: true, total: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 8,
      }),
      prisma.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
    ]);

    // Comparacao coluna-a-coluna (stock <= minStock) via SQL: o Prisma nao
    // expressa isso diretamente sem field references.
    const lowStockList = await prisma.$queryRaw<
      Array<{ id: string; name: string; sku: string; stock: number; minStock: number }>
    >`
      SELECT "id", "name", "sku", "stock", "minStock"
        FROM "products"
       WHERE "active" = true AND "minStock" > 0 AND "stock" <= "minStock"
       ORDER BY "stock" ASC
       LIMIT 10
    `;

    return ok(reply, {
      orders: {
        today: ordersToday,
        month: ordersMonth,
        pending: pendingOrders,
      },
      revenue: {
        month: revenueMonth._sum.total ?? 0,
        total: revenueTotal._sum.total ?? 0,
      },
      customers: { total: customers, newThisMonth: newCustomersMonth },
      catalog: {
        active: productsActive,
        outOfStock: productsOutOfStock,
        withMinStock: lowStock,
        lowStockList,
      },
      moderation: {
        pendingReviews: reviewsPending,
        pendingFeedback: feedbackPending,
      },
      messages: { conversationsWithUnread: unreadConversations._count._all },
      coupons: { active: activeCoupons },
      chart: {
        salesByDay: salesByDay.map((row) => ({
          day: row.day,
          orders: Number(row.orders),
          revenue: Number(row.revenue ?? 0),
        })),
      },
      topProducts: topProducts.map((p) => ({
        name: p.nameSnapshot,
        quantity: p._sum.quantity ?? 0,
        revenue: p._sum.total ?? 0,
      })),
      recentOrders,
    });
  });

  // ---- Auditoria ------------------------------------------------------------
  app.get("/audit-logs", async (request, reply) => {
    const query = parse(auditQuery, request.query);
    const { page, perPage, skip, take } = parsePagination(query);

    const where = {
      ...(query.entity ? { entity: query.entity } : {}),
      ...(query.action ? { action: { contains: query.action, mode: "insensitive" as const } } : {}),
      ...(query.adminId ? { adminId: query.adminId } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.adminAuditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          before: true,
          after: true,
          ip: true,
          requestId: true,
          createdAt: true,
          admin: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.adminAuditLog.count({ where }),
    ]);

    return okPaginated(reply, paginate(items, total, page, perPage));
  });

  // ---- Logs de erro (a partir dos eventos registrados) ----------------------
  app.get("/logs", async (request, reply) => {
    const query = parse(
      z.object({
        page: z.coerce.number().int().min(1).optional().default(1),
        perPage: z.coerce.number().int().min(1).max(100).optional().default(30),
      }),
      request.query,
    );
    const { page, perPage, skip, take } = parsePagination(query);

    const [webhooks, failedTests] = await Promise.all([
      prisma.webhookEvent.findMany({
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          provider: true,
          eventId: true,
          eventType: true,
          signatureValid: true,
          status: true,
          errorMessage: true,
          processedAt: true,
          createdAt: true,
        },
      }),
      prisma.testResult.findMany({
        where: { status: { in: ["FAIL", "WARN"] } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          name: true,
          category: true,
          status: true,
          endpoint: true,
          requestId: true,
          errorMessage: true,
          durationMs: true,
          createdAt: true,
        },
      }),
    ]);

    const total = await prisma.webhookEvent.count();

    return reply.status(200).send({
      data: { webhookEvents: webhooks, failingChecks: failedTests },
      meta: paginate<unknown>([], total, page, perPage).meta,
    });
  });

  // ---- Sub-modulos ----------------------------------------------------------
  await app.register(productAdminRoutes, { prefix: "/products" });
  await app.register(categoryAdminRoutes, { prefix: "/categories" });
  await app.register(brandAdminRoutes, { prefix: "/brands" });
  await app.register(orderAdminRoutes, { prefix: "/orders" });
  await app.register(couponAdminRoutes, { prefix: "/coupons" });
  await app.register(shippingAdminRoutes, { prefix: "/shipping" });
  await app.register(conversationAdminRoutes, { prefix: "/conversations" });
  await app.register(moderationAdminRoutes, { prefix: "/" });
  await app.register(contentAdminRoutes, { prefix: "/" });
}
