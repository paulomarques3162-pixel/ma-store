import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ok, parse } from "../../lib/http.js";
import {
  getVapidPublicKey,
  isPushEnabled,
  removePushSubscription,
  savePushSubscription,
} from "../../services/push.js";

/**
 * Web Push (PWA) — rotas PÚBLICAS.
 *
 * A loja opera em Guest Checkout, então não exigimos conta para receber
 * notificações: o consentimento é do navegador.
 *
 * Proteção contra abuso: `/subscribe` ESCREVE no banco a partir de uma rota
 * pública, então além do rate limit global aplicamos um limite dedicado e mais
 * apertado. Sem ele, um script poderia inserir milhares de inscrições falsas
 * (endpoint + chaves inventadas) e inflar a tabela / o custo de cada envio.
 * O limite é generoso para um usuário real (ele se inscreve uma vez por
 * navegador) e apertado para um script.
 */
const PUSH_WRITE_RATE_LIMIT = { max: 20, timeWindow: "1 minute" } as const;

const subscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(2048),
});

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  /** Informa se o push está ativo e devolve a chave PÚBLICA VAPID. */
  app.get("/public-key", async (_request, reply) => {
    return ok(reply, { enabled: isPushEnabled(), key: getVapidPublicKey() });
  });

  /** Registra a inscrição do navegador (após o usuário aceitar). */
  app.post("/subscribe", { config: { rateLimit: PUSH_WRITE_RATE_LIMIT } }, async (request, reply) => {
    const input = parse(subscribeSchema, request.body);
    const userAgent = typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"] : null;
    await savePushSubscription(input, userAgent);
    return ok(reply, { subscribed: true });
  });

  /** Remove a inscrição (usuário desativou as notificações). */
  app.post("/unsubscribe", { config: { rateLimit: PUSH_WRITE_RATE_LIMIT } }, async (request, reply) => {
    const input = parse(unsubscribeSchema, request.body);
    await removePushSubscription(input.endpoint);
    return ok(reply, { unsubscribed: true });
  });
}
