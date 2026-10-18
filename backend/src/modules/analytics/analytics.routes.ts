import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ok, parse } from "../../lib/http.js";
import { ANALYTICS_EVENT_TYPES, recordEvent } from "../../services/analytics.js";

/**
 * Ingestão pública de eventos de audiência.
 *
 * Recebe apenas dados anônimos e minimizados. A validação (tipo, tamanhos) e o
 * limite de requisições global (rate limit) protegem contra abuso. Eventos
 * repetidos com o mesmo `eventId` são ignorados (idempotência).
 */
const eventSchema = z.object({
  eventId: z.string().trim().max(64).optional(),
  type: z.enum(ANALYTICS_EVENT_TYPES),
  path: z.string().trim().max(300).optional(),
  productId: z.string().trim().max(40).optional(),
  sessionId: z.string().trim().max(64).optional(),
  referrer: z.string().trim().max(300).optional(),
});

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/events", async (request, reply) => {
    const input = parse(eventSchema, request.body);
    const result = await recordEvent({
      ...input,
      userAgent: (request.headers["user-agent"] as string | undefined) ?? null,
    });
    reply.header("Cache-Control", "no-store");
    return ok(reply, result);
  });
}
