import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../../db.js";
import { notFound } from "../../lib/errors.js";
import { ok, parse } from "../../lib/http.js";

const keyParam = z.object({ key: z.string().min(1).max(120) });

/**
 * Conteudo do site (CMS).
 *
 * Todo texto institucional vem do banco - nada hardcoded no frontend. Chaves
 * ainda nao preenchidas pelo admin retornam `null`, e o frontend mostra um
 * placeholder em vez de inventar informacao da loja.
 */
export async function contentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async (_request, reply) => {
    // Conteúdo de vitrine: pode ser cacheado na borda. Nada de dado pessoal aqui.
    reply.header("Cache-Control", "public, max-age=120, stale-while-revalidate=600");

    const items = await prisma.siteContent.findMany({
      where: { isPublic: true },
      orderBy: [{ group: "asc" }, { key: "asc" }],
      select: { key: true, value: true, group: true, label: true },
    });

    const map: Record<string, string | null> = {};
    for (const item of items) map[item.key] = item.value;

    return ok(reply, {
      values: map,
      entries: items,
    });
  });

  app.get("/:key", async (request, reply) => {
    const { key } = parse(keyParam, request.params);
    reply.header("Cache-Control", "public, max-age=120, stale-while-revalidate=600");

    const item = await prisma.siteContent.findUnique({ where: { key } });
    if (!item || !item.isPublic) throw notFound("Conteudo nao encontrado.");
    return ok(reply, { key: item.key, value: item.value, group: item.group, label: item.label });
  });
}
