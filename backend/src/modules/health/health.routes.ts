import type { FastifyInstance } from "fastify";
import { checkDatabase } from "../../db.js";
import { env } from "../../env.js";
import { ok } from "../../lib/http.js";

/**
 * GET /api/health
 *
 * Retorna apenas o essencial: API online, status do banco, versao, ambiente e
 * timestamp. Nunca expoe credenciais, host do banco ou variaveis de ambiente.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_request, reply) => {
    const db = await checkDatabase();

    return ok(reply, {
      status: db.connected ? "ok" : "degraded",
      api: "online",
      database: {
        connected: db.connected,
        latencyMs: db.latencyMs,
      },
      version: env.APP_VERSION,
      environment: env.APP_ENV,
      payments: env.PAYMENT_ENV,
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/", async (_request, reply) =>
    ok(reply, {
      name: "MA STORE API",
      version: env.APP_VERSION,
      docs: "/api/health",
      timestamp: new Date().toISOString(),
    }),
  );
}
