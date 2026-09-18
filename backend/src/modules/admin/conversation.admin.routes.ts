import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { writeAudit } from "../../lib/audit.js";
import { ok, okPaginated, parse } from "../../lib/http.js";
import { paginate, parsePagination } from "../../lib/serialize.js";
import * as messages from "../messages/message.service.js";

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.enum(["OPEN", "ARCHIVED", "RESOLVED"]).optional(),
  search: z.string().trim().max(120).optional(),
});

/** Central de atendimento do administrador. */
export async function conversationAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request, reply) => {
    const query = parse(listQuery, request.query);
    const { page, perPage, skip, take } = parsePagination(query);

    const result = await messages.listConversationsForAdmin({
      status: query.status,
      search: query.search,
      skip,
      take,
    });

    return reply.status(200).send({
      data: result.items,
      meta: paginate<unknown>([], result.total, page, perPage).meta,
      unreadConversations: result.unreadConversations,
    });
  });

  app.get("/unread-count", async (_request, reply) => {
    const counts = await messages.countUnreadForUser("");
    return ok(reply, { conversations: counts.forAdmin });
  });

  app.get("/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const conversation = await messages.getConversationForAdmin(id);
    return ok(reply, conversation);
  });

  app.post("/:id/messages", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(z.object({ body: z.string().trim().min(1, "Escreva a resposta.").max(4000) }), request.body);

    const message = await messages.sendAdminMessage(request.authUser!.id, id, input.body);

    await writeAudit({
      adminId: request.authUser!.id,
      action: "REPLY_MESSAGE",
      entity: "Conversation",
      entityId: id,
      after: { messageId: message.id },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, message);
  });

  app.patch("/:id/status", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(z.object({ status: z.enum(["OPEN", "ARCHIVED", "RESOLVED"]) }), request.body);

    const conversation = await messages.setConversationStatus(id, input.status);

    await writeAudit({
      adminId: request.authUser!.id,
      action: "SET_CONVERSATION_STATUS",
      entity: "Conversation",
      entityId: id,
      after: { status: input.status },
      ip: request.ip,
      requestId: request.id,
    });

    return ok(reply, conversation);
  });
}
