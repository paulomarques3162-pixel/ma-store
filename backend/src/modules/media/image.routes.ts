import type { FastifyInstance, FastifyReply } from "fastify";
import { env } from "../../env.js";
import {
  getImageVariant,
  isVariantWidth,
  type ImageVariantFormat,
} from "../../services/image-variants.js";

/**
 * Entrega das variantes otimizadas das imagens de produto.
 *
 *   GET /uploads/opt/640/1712345678-abcdef.jpg        -> WebP 640px
 *   GET /uploads/opt/avif/640/1712345678-abcdef.jpg   -> AVIF 640px
 *
 * Por que uma rota propria (e nao `?w=`/`?fm=`): o `srcset` precisa de URLs
 * estaveis e cacheaveis; alem disso, o @fastify/static serve `/uploads/*` e uma
 * rota mais especifica tem prioridade no roteador do Fastify.
 *
 * O `Vary`/negociacao por `Accept` NAO e usado de proposito: a URL precisa ter
 * uma unica representacao para o cache imutavel (`max-age=31536000, immutable`)
 * funcionar em CDN e no navegador. O formato vive no caminho.
 *
 * Seguranca:
 *  - somente nomes de arquivo simples (sem barras, sem `..`);
 *  - largura precisa estar na lista suportada;
 *  - a leitura acontece dentro do diretorio de uploads;
 *  - se a imagem nao existir/nao puder ser processada, 404 — o navegador cai
 *    no WebP e, por fim, no `src` original (o `srcset` e progressivo).
 */
export async function imageVariantRoutes(app: FastifyInstance): Promise<void> {
  // Armazenamento externo (S3/R2/CDN) nao e transformado aqui: o frontend usa
  // a URL original nesse caso (limitacao documentada no relatorio final).
  if (env.STORAGE_DRIVER !== "local") return;

  async function sendVariant(
    format: ImageVariantFormat,
    width: string,
    file: string,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    if (!isVariantWidth(width) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file) || file.includes("..")) {
      return reply.status(404).send();
    }

    const variant = await getImageVariant(file, Number(width), { format });
    if (!variant) return reply.status(404).send();

    return reply
      .header("Content-Type", format === "avif" ? "image/avif" : "image/webp")
      // O nome do arquivo original e unico e imutavel; a variante tambem.
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("X-Content-Type-Options", "nosniff")
      .send(variant.buffer);
  }

  // WebP (fallback universal) — caminho historico mantido intacto.
  app.get<{ Params: { width: string; file: string } }>("/opt/:width/:file", async (request, reply) => {
    const { width, file } = request.params;
    return sendVariant("webp", width, file, reply);
  });

  // AVIF (melhor compressao) — usado pelo `<picture>` quando o navegador aceita.
  app.get<{ Params: { width: string; file: string } }>("/opt/avif/:width/:file", async (request, reply) => {
    const { width, file } = request.params;
    return sendVariant("avif", width, file, reply);
  });
}
