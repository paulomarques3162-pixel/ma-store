import type { FastifyInstance } from "fastify";
import { env } from "../../env.js";
import { getImageVariant, isVariantWidth } from "../../services/image-variants.js";

/**
 * Entrega das variantes otimizadas das imagens de produto.
 *
 *   GET /uploads/opt/640/1712345678-abcdef.jpg  ->  WebP 640px
 *
 * Por que uma rota propria (e nao `?w=`): o `srcset` precisa de URLs estaveis e
 * cacheaveis; alem disso, o @fastify/static serve `/uploads/*` e uma rota mais
 * especifica tem prioridade no roteador do Fastify.
 *
 * Seguranca:
 *  - somente nomes de arquivo simples (sem barras, sem `..`);
 *  - largura precisa estar na lista suportada;
 *  - a leitura acontece dentro do diretorio de uploads;
 *  - se a imagem nao existir/nao puder ser processada, 404 — o navegador cai
 *    no `src` original (o `srcset` e progressivo, nunca quebra a pagina).
 */
export async function imageVariantRoutes(app: FastifyInstance): Promise<void> {
  if (env.STORAGE_DRIVER !== "local") return;

  app.get<{ Params: { width: string; file: string } }>("/opt/:width/:file", async (request, reply) => {
    const { width, file } = request.params;

    if (!isVariantWidth(width) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file) || file.includes("..")) {
      return reply.status(404).send();
    }

    const variant = await getImageVariant(file, Number(width));
    if (!variant) return reply.status(404).send();

    return reply
      .header("Content-Type", "image/webp")
      // O nome do arquivo original e unico e imutavel; a variante tambem.
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("X-Content-Type-Options", "nosniff")
      .send(variant.buffer);
  });
}
