import type { FastifyInstance } from "fastify";
import { created } from "../../lib/http.js";
import { badRequest } from "../../lib/errors.js";
import { saveUpload } from "../../services/storage.js";

/** Upload de imagem para o cadastro de produtos (protegido por ADMIN). */
export async function uploadAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook("preHandler", app.requireAdmin);

  app.post("/", async (request, reply) => {
    const file = await request.file();
    if (!file) throw badRequest("Envie um arquivo de imagem no campo 'file'.");

    const buffer = await file.toBuffer();
    const saved = await saveUpload(buffer);
    return created(reply, saved);
  });
}
