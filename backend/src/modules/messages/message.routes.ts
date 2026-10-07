import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { created, ok, parse } from "../../lib/http.js";
import * as messages from "./message.service.js";

const createSchema = z.object({
  subject: z.string().trim().max(160).optional(),
  orderId: z.string().optional(),
  message: z.string().trim().min(1, "Escreva sua mensagem.").max(4000),
});

const messageSchema = z.object({
  body: z.string().trim().min(1, "Escreva sua mensagem.").max(4000),
});

const idParam = z.object({ id: z.string().min(1) });

/** Central de mensagens do cliente (atalho 💬). */
export async function messageRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.authenticate);

  app.get("/conversations", async (request, reply) => {
    const items = await messages.listMyConversations(request.authUser!.id);
    return ok(reply, items);
  });

  app.get("/unread", async (request, reply) => {
    const counts = await messages.countUnreadForUser(request.authUser!.id);
    return ok(reply, counts);
  });

  app.post("/conversations", async (request, reply) => {
    const input = parse(createSchema, request.body);
    const result = await messages.createConversation(request.authUser!.id, input);
    return created(reply, result);
  });

  app.get("/conversations/:id", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const conversation = await messages.getConversationForUser(request.authUser!.id, id);
    return ok(reply, conversation);
  });

  app.post("/conversations/:id/messages", async (request, reply) => {
    const { id } = parse(idParam, request.params);
    const input = parse(messageSchema, request.body);
    const message = await messages.sendClientMessage(request.authUser!.id, id, input.body);
    return created(reply, message);
  });
}
