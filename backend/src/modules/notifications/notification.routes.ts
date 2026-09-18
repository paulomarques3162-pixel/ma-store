import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { ok, okPaginated, parse } from "../../lib/http.js";
import { paginate, parsePagination } from "../../lib/serialize.js";

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(50).optional().default(20),
  onlyUnread: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? false : v === "true" || v === "1")),
});

/** Notificacoes do usuario autenticado. */
export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.get("/", async (request, reply) => {
    const query = parse(listQuery, request.query);
    const { page, perPage, skip, take } = parsePagination(query);

    const where = { userId: request.authUser!.id, ...(query.onlyUnread ? { readAt: null } : {}) };

    const [items, total, unread] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip, take }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId: request.authUser!.id, readAt: null } }),
    ]);

    const response = okPaginated(reply, paginate(items, total, page, perPage));
    reply.header("X-Unread-Count", String(unread));
    return response;
  });

  app.get("/unread-count", async (request, reply) => {
    const unread = await prisma.notification.count({
      where: { userId: request.authUser!.id, readAt: null },
    });
    return ok(reply, { unread });
  });

  app.post("/:id/read", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    await prisma.notification.updateMany({
      where: { id, userId: request.authUser!.id, readAt: null },
      data: { readAt: new Date() },
    });
    return ok(reply, { read: true });
  });

  app.post("/read-all", async (request, reply) => {
    const result = await prisma.notification.updateMany({
      where: { userId: request.authUser!.id, readAt: null },
      data: { readAt: new Date() },
    });
    return ok(reply, { updated: result.count });
  });

  app.delete("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    await prisma.notification.deleteMany({ where: { id, userId: request.authUser!.id } });
    return ok(reply, { deleted: true });
  });
}
