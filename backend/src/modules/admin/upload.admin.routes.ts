import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { created, ok } from "../../lib/http.js";
import { badRequest } from "../../lib/errors.js";
import { listUploads, saveUpload } from "../../services/storage.js";

const listQuery = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(24),
});

/** Upload de imagem + biblioteca de imagens salvas (protegido por ADMIN). */
export async function uploadAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  /** Biblioteca: lista as imagens já salvas para reaproveitamento. */
  app.get("/", async (request, reply) => {
    const query = listQuery.parse(request.query);
    const result = await listUploads(query);
    return ok(reply, result);
  });

  app.post("/", async (request, reply) => {
    const file = await request.file();
    if (!file) throw badRequest("Envie um arquivo de imagem no campo 'file'.");

    const buffer = await file.toBuffer();
    const saved = await saveUpload(buffer);
    return created(reply, saved);
  });
}
