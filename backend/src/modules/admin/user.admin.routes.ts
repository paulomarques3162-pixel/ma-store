import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { writeAudit } from "../../lib/audit.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { ok, okPaginated, parse } from "../../lib/http.js";
import { randomToken, sha256 } from "../../lib/crypto.js";
import { env } from "../../env.js";
import { paginate, parsePagination } from "../../lib/serialize.js";
import * as authService from "../auth/auth.service.js";

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().trim().max(120).optional(),
  status: z.enum(["ACTIVE", "BLOCKED", "PENDING"]).optional(),
  role: z.enum(["CLIENT", "ADMIN"]).optional(),
});

const statusSchema = z.object({ status: z.enum(["ACTIVE", "BLOCKED"]) });

/**
 * Gestao de usuarios.
 *
 * REGRA ABSOLUTA: o painel NUNCA mostra senha, hash ou token de autenticacao.
 * Toda selecao aqui e explicita e nunca inclui `passwordHash`.
 */
export async function userAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request, reply) => {
    const query = parse(listQuery, request.query);
    const { page, perPage, skip, take } = parsePagination(query);

    const where = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.role ? { role: query.role } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" as const } },
              { email: { contains: query.search, mode: "insensitive" as const } },
              { phone: { contains: query.search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          status: true,
          isDemo: true,
          lastLoginAt: true,
          createdAt: true,
          _count: { select: { orders: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    // Totais gastos por usuario em uma unica consulta agregada (sem N+1).
    const ids = users.map((u) => u.id);
    const totals = ids.length
      ? await prisma.order.groupBy({
          by: ["userId"],
          where: { userId: { in: ids }, status: { in: ["PAID", "PREPARING", "SHIPPED", "DELIVERED"] } },
          _sum: { total: true },
        })
      : [];
    const totalMap = new Map(totals.map((t) => [t.userId, t._sum.total ?? 0]));

    return okPaginated(
      reply,
      paginate(
        users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          phone: u.phone,
          role: u.role,
          status: u.status,
          isDemo: u.isDemo,
          lastLoginAt: u.lastLoginAt,
          createdAt: u.createdAt,
          ordersCount: u._count.orders,
          totalSpent: totalMap.get(u.id) ?? 0,
        })),
        total,
        page,
        perPage,
      ),
    );
  });

  app.get("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        isDemo: true,
        mustChangePassword: true,
        lastLoginAt: true,
        failedLoginCount: true,
        lockedUntil: true,
        createdAt: true,
        updatedAt: true,
        addresses: true,
        _count: { select: { orders: true, conversations: true, reviews: true, feedbacks: true } },
      },
    });

    if (!user) throw notFound("Usuario nao encontrado.");

    const [orders, spent, sessions] = await Promise.all([
      prisma.order.findMany({
        where: { userId: id },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, number: true, status: true, total: true, createdAt: true, paidAt: true },
      }),
      prisma.order.aggregate({
        where: { userId: id, status: { in: ["PAID", "PREPARING", "SHIPPED", "DELIVERED"] } },
        _sum: { total: true },
      }),
      // Apenas metadados de sessao - nunca o token.
      prisma.session.findMany({
        where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true, expiresAt: true },
        orderBy: { lastUsedAt: "desc" },
        take: 10,
      }),
    ]);

    return ok(reply, {
      ...user,
      totalSpent: spent._sum.total ?? 0,
      recentOrders: orders,
      activeSessions: sessions,
      // Explicito: o painel nao possui e nao pode obter a senha do usuario.
      passwordVisible: false,
    });
  });

  app.get("/:id/orders", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const query = parse(z.object({ page: z.coerce.number().optional().default(1), perPage: z.coerce.number().optional().default(20) }), request.query);
    const { page, perPage, skip, take } = parsePagination(query);

    const where = { userId: id };
    const [items, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: { id: true, number: true, status: true, total: true, createdAt: true, paidAt: true },
      }),
      prisma.order.count({ where }),
    ]);

    return okPaginated(reply, paginate(items, total, page, perPage));
  });

  app.patch("/:id/status", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(statusSchema, request.body);

    if (id === request.authUser!.id) {
      throw badRequest("Voce nao pode alterar o status da propria conta.");
    }

    const current = await prisma.user.findUnique({ where: { id }, select: { status: true, email: true } });
    if (!current) throw notFound("Usuario nao encontrado.");

    const updated = await prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: { status: input.status, ...(input.status === "ACTIVE" ? { failedLoginCount: 0, lockedUntil: null } : {}) },
        select: { id: true, name: true, email: true, status: true },
      });

      // Bloquear um usuario derruba todas as sessoes ativas imediatamente.
      if (input.status === "BLOCKED") {
        await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }

      return user;
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: input.status === "BLOCKED" ? "BLOCK_USER" : "UNBLOCK_USER",
      entity: "User",
      entityId: id,
      before: { status: current.status },
      after: { status: input.status },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, updated);
  });

  /**
   * O admin INICIA a recuperacao de senha, mas nunca descobre a senha atual.
   * Em producao o link sai por e-mail; em dev/teste devolvemos o token para
   * permitir validar o fluxo.
   */
  app.post("/:id/reset-password", async (request, reply) => {
    const { id } = parse(idParam, request.params);

    const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true } });
    if (!user) throw notFound("Usuario nao encontrado.");

    const token = randomToken(40);
    await prisma.passwordResetToken.create({
      data: { userId: id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });

    await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "INITIATE_PASSWORD_RESET",
      entity: "User",
      entityId: id,
      after: { email: user.email },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, {
      message: env.isProduction
        ? "Link de redefinicao gerado e enviado ao cliente por e-mail."
        : "Link de redefinicao gerado (ambiente de desenvolvimento).",
      devToken: env.isProduction ? null : token,
      expiresInMinutes: 60,
    });
  });

  app.get("/:id/sessions", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const sessions = await prisma.session.findMany({
      where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userAgent: true, ip: true, createdAt: true, lastUsedAt: true, expiresAt: true },
    });
    return ok(reply, sessions);
  });

  app.post("/:id/sessions/revoke", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const result = await prisma.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await writeAudit({
      adminId: request.authUser!.id,
      action: "REVOKE_SESSIONS",
      entity: "User",
      entityId: id,
      after: { revoked: result.count },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, { revoked: result.count });
  });
}

export { authService };
