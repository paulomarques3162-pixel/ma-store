import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import sharp from "sharp";
import { env } from "../env.js";

/**
 * Variantes otimizadas das imagens de produto.
 *
 * PROBLEMA: a loja servia o arquivo ORIGINAL enviado pelo administrador (foto
 * de celular com 2-5 MB, 3000px). No card de 260px o celular baixava 5 MB por
 * produto — a maior causa da lentidao da vitrine em 4G.
 *
 * SOLUCAO (nao destrutiva):
 *  - o ORIGINAL nunca e alterado nem apagado;
 *  - geramos variantes WebP nos tamanhos realmente usados pelo layout
 *    (320/640/960/1280 px de largura), com qualidade visual alta;
 *  - as variantes ficam em `<uploads>/.cache/<largura>/<arquivo>.webp`;
 *  - sao geradas no upload (aquecidas) e tambem sob demanda para imagens
 *    antigas, entao nenhuma imagem existente fica sem variante;
 *  - GIF animado e SVG nao sao processados (perderiam animacao/vetor);
 *  - qualquer falha do sharp cai no original — a imagem NUNCA quebra.
 */

/** Larguras alinhadas com o CSS da vitrine (card, galeria, zoom). */
export const IMAGE_VARIANT_WIDTHS = [320, 640, 960, 1280] as const;
export type ImageVariantWidth = (typeof IMAGE_VARIANT_WIDTHS)[number];

const WEBP_QUALITY = 82;

/** Extensoes raster que podem virar WebP (GIF fica de fora: perderia animacao). */
const VARIANT_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "avif"]);
const MAX_INPUT_PIXELS = 40_000_000;

const inFlight = new Map<string, Promise<Buffer | null>>();

export function isVariantWidth(value: unknown): value is ImageVariantWidth {
  const numeric = Number(value);
  return (IMAGE_VARIANT_WIDTHS as readonly number[]).includes(numeric);
}

/** Diretorio raiz dos uploads (driver local). */
export function uploadsRoot(directory?: string): string {
  return resolve(directory ?? resolve(process.cwd(), env.STORAGE_LOCAL_DIR));
}

/** Caminho da variante, sempre DENTRO de `<uploads>/.cache`. */
export function variantPath(filename: string, width: number, directory?: string): string | null {
  if (!isVariantWidth(width)) return null;
  if (!VARIANT_EXTENSIONS.has(extname(filename).slice(1).toLowerCase())) return null;
  const root = uploadsRoot(directory);
  const target = resolve(root, ".cache", String(width), `${filename}.webp`);
  // Defesa contra path traversal: o alvo precisa ficar dentro da raiz.
  if (!target.startsWith(root + sep)) return null;
  return target;
}

/**
 * Alguns formatos nao devem passar pelo pipeline: GIF animado (perderia a
 * animacao) e SVG (nao e raster e nao e aceito no upload).
 */
export function isTransformable(filename: string): boolean {
  const ext = extname(filename).slice(1).toLowerCase();
  return ext !== "gif";
}

export type VariantResult = { buffer: Buffer; generated: boolean } | null;

/**
 * Devolve a variante WebP (gerando e gravando em disco na primeira chamada).
 * Retorna `null` quando a imagem nao existe / nao pode ser processada — quem
 * chama deve responder 404 para o `srcset` cair no original.
 */
export async function getImageVariant(
  filename: string,
  width: number,
  options: { directory?: string; persist?: boolean } = {},
): Promise<VariantResult> {
  if (!isTransformable(filename) || !isVariantWidth(width)) return null;

  const cachePath = variantPath(filename, width, options.directory);
  if (!cachePath) return null;

  const cached = await readFile(cachePath).catch(() => null);
  if (cached) return { buffer: cached, generated: false };

  const key = cachePath;
  const pending = inFlight.get(key);
  if (pending) {
    const buffer = await pending;
    return buffer ? { buffer, generated: false } : null;
  }

  const promise = (async (): Promise<Buffer | null> => {
    const sourcePath = resolve(uploadsRoot(options.directory), filename);
    const root = uploadsRoot(options.directory);
    if (!sourcePath.startsWith(root + sep)) return null;
    const sourceExists = await stat(sourcePath).then((info) => info.isFile()).catch(() => false);
    if (!sourceExists) return null;

    try {
      const buffer = await sharp(sourcePath, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "none" })
        // `withoutEnlargement`: uma foto 400px nunca vira 1280px "borrada".
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: WEBP_QUALITY, effort: 4 })
        .toBuffer();

      if (options.persist !== false) {
        await mkdir(resolve(cachePath, ".."), { recursive: true });
        await writeFile(cachePath, buffer);
      }
      return buffer;
    } catch {
      // Nunca derruba a request por causa de uma imagem: o frontend usa o original.
      return null;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  const buffer = await promise;
  return buffer ? { buffer, generated: true } : null;
}

/**
 * Pre-gera as variantes de um upload (chamado no upload, best-effort).
 * Nao lanca: se falhar, as variantes sao geradas sob demanda depois.
 */
export async function warmImageVariants(filename: string, directory?: string): Promise<void> {
  if (env.STORAGE_DRIVER !== "local" || !isTransformable(filename)) return;
  await Promise.all(
    IMAGE_VARIANT_WIDTHS.map((width) => getImageVariant(filename, width, { directory }).catch(() => null)),
  );
}

/** Remove as variantes de um arquivo (usado ao apagar a imagem original). */
export async function removeImageVariants(filename: string, directory?: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    IMAGE_VARIANT_WIDTHS.map(async (width) => {
      const target = variantPath(filename, width, directory);
      if (target) await rm(target, { force: true }).catch(() => undefined);
    }),
  );
}

