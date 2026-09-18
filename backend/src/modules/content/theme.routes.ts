import type { FastifyInstance } from "fastify";
import { prisma } from "../../db.js";
import { ok } from "../../lib/http.js";

/**
 * Tema visual publicado.
 *
 * O admin edita em rascunho e publica; o site publico SO consome o tema ativo.
 * Se nada estiver publicado, devolvemos valores neutros (o frontend usa o
 * proprio padrao) em vez de inventar uma identidade visual da loja.
 */
export async function themeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    const theme = await prisma.siteTheme.findFirst({
      where: { isActive: true },
      select: { id: true, name: true, settings: true, publishedAt: true },
    });

    reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");

    if (!theme) {
      return ok(reply, {
        published: false,
        name: null,
        settings: null,
        publishedAt: null,
        message: "Nenhum tema publicado. Personalize no painel administrativo.",
      });
    }

    return ok(reply, { published: true, ...theme });
  });
}
