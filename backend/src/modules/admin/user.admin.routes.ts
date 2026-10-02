import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { writeAudit } from "../../lib/audit.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { ok, parse } from "../../lib/http.js";
import { parsePagination } from "../../lib/serialize.js";
import * as authService from "../auth/auth.service.js";

/**
 * Usuários (painel administrativo).
 *
 * Nunca expõe `passwordHash`. O cliente vê apenas dados seguros + métricas de
 * pedidos e sessões. Bloquear um usuário derruba todas as sessões ativas.
 */

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  search: z.string().trim().max(120).optional(),
  role: z.enum(["CLIENT", "ADMIN", "DELIVERY_PERSON"]).optional(),
  status: z.enum(["ACTIVE", "BLOCKED", "PENDING"]).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(50),
});

const statusSchema = z.object({ status: z.enum(["ACTIVE", "BLOCKED"]) });

const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  status: true,
  isDemo: true,
  mustChangePassword: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function ordersMetrics(userIds: string[]): Promise<Map<string, { ordersCount: number; totalSpent: number }>> {
  if (userIds.length === 0) return new Map();
  const grouped = await prisma.order.groupBy({
    by: ["userId"],
    where: { userId: { in: userIds } },
    _count: { _all: true },
    _sum: { total: true },
  });
  return new Map(
    grouped.map((row) => [
      row.userId,
      { ordersCount: row._count._all, totalSpent: Number(row._sum.total ?? 0) },
    ]),
  );
}

export async function userAdminRoutes(app: FastifyInstance): Promise<void> {
  /** Lista usuários com contagem de pedidos e total gasto (sem senha). */
  app.get("/", async (request, reply) => {
    const query = parse(listQuery, request.query);
    const { skip, take } = parsePagination({ page: query.page, perPage: query.perPage });

    const where = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" as const } },
              { email: { contains: query.search, mode: "insensitive" as const } },
              { phone: { contains: query.search } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, skip, take, select: SAFE_USER_SELECT }),
      prisma.user.count({ where }),
    ]);

    const metrics = await ordersMetrics(users.map((user) => user.id));
    const data = users.map((user) => ({
      ...user,
      ordersCount: metrics.get(user.id)?.ordersCount ?? 0,
      totalSpent: metrics.get(user.id)?.totalSpent ?? 0,
    }));

    return reply.send({ data, meta: { total, page: query.page, perPage: query.perPage } });
  });

  /** Detalhe do usuário: sessões ativas + métricas. Senha explicitamente não visível. */
  app.get("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const user = await prisma.user.findUnique({ where: { id }, select: SAFE_USER_SELECT });
    if (!user) throw notFound("Usuário não encontrado.");

    const now = new Date();
    const [sessions, metrics] = await Promise.all([
      prisma.session.findMany({
        where: { userId: id, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { lastUsedAt: "desc" },
        select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true, expiresAt: true },
      }),
      ordersMetrics([id]),
    ]);

    return ok(reply, {
      ...user,
      ordersCount: metrics.get(id)?.ordersCount ?? 0,
      totalSpent: metrics.get(id)?.totalSpent ?? 0,
      activeSessions: sessions,
      passwordVisible: false,
    });
  });

  /** Ativa/bloqueia o usuário. Bloquear derruba todas as sessões. */
  app.patch("/:id/status", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const { status } = parse(statusSchema, request.body);

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, status: true } });
    if (!target) throw notFound("Usuário não encontrado.");

    if (id === request.authUser!.id && status === "BLOCKED") {
      throw badRequest("Você não pode bloquear a própria conta.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (status === "BLOCKED") {
        await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return tx.user.update({ where: { id }, data: { status }, select: SAFE_USER_SELECT });
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: status === "BLOCKED" ? "BLOCK_USER" : "UNBLOCK_USER",
      entity: "User",
      entityId: id,
      before: { status: target.status },
      after: { status },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });

  /** Inicia a recuperação de senha do usuário, sem revelar a senha atual. */
  app.post("/:id/reset-password", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!target) throw notFound("Usuário não encontrado.");

    const result = await authService.forgotPassword(target.email);

    await writeAudit({
      adminId: request.authUser!.id,
      action: "RESET_PASSWORD",
      entity: "User",
      entityId: id,
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, {
      message: "Link de redefinicao de senha gerado com sucesso.",
      devToken: result.devToken,
    });
  });
}
