import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { validationError } from "../../lib/errors.js";
import { ok, parse } from "../../lib/http.js";
import { getAnalyticsSummary, purgeOldEvents } from "../../services/analytics.js";

/**
 * Painel de audiência (SOMENTE ADMIN — hook global do admin).
 * Os números são agregações reais dos eventos coletados; nada é inventado.
 */
const rangeSchema = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
});

export async function analyticsAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (request, reply) => {
    const query = parse(rangeSchema, request.query);
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : new Date(to.getTime() - (query.days ?? 30) * 24 * 60 * 60 * 1000);

    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw validationError("Periodo invalido. Use datas ISO validas.");
    }
    if (from.getTime() > to.getTime()) {
      throw validationError("A data inicial nao pode ser maior que a final.");
    }

    const summary = await getAnalyticsSummary(from, to);
    reply.header("Cache-Control", "no-store");
    return ok(reply, summary);
  });

  /** Minimização/retenção: remove eventos antigos (>= 7 dias). */
  app.post("/purge", async (request, reply) => {
    const input = parse(
      z.object({ days: z.coerce.number().int().min(7).max(3650).default(365) }),
      request.body ?? {},
    );
    const removed = await purgeOldEvents(input.days);
    return ok(reply, { removed });
  });
}
