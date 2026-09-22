import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { imageSize } from "image-size";
import { env } from "../env.js";
import { validationError } from "../lib/errors.js";

/**
 * Upload de imagens com validação por MAGIC BYTES (não confia no MIME/extensão
 * enviados pelo cliente) + limite de tamanho e dimensões.
 *
 * Driver `local` grava em disco (bom para dev/Render com disco persistente).
 * Em ambiente serverless puro, troque por storage de objetos — a interface é a
 * mesma (`saveUpload` devolve uma URL pública).
 */

export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
};

const MIN_DIMENSION = 100;
const MAX_DIMENSION = 6000;

/** Detecta o tipo real da imagem pelos bytes iniciais. Retorna null se não for imagem suportada. */
export function detectImageMime(buffer: Uint8Array): string | null {
  if (buffer.length < 12) return null;

  const b = (i: number) => buffer[i] ?? 0;

  // JPEG: FF D8 FF
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) return "image/png";
  // GIF: "GIF8"
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38) return "image/gif";
  // WEBP: "RIFF" .... "WEBP"
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) {
    return "image/webp";
  }
  // AVIF/HEIF: bytes 4..8 = "ftyp", brand contém "avif"/"avis"
  if (b(4) === 0x66 && b(5) === 0x74 && b(6) === 0x79 && b(7) === 0x70) {
    const brand = String.fromCharCode(b(8), b(9), b(10), b(11));
    if (brand === "avif" || brand === "avis" || brand === "mif1") return "image/avif";
  }

  return null;
}

export type UploadValidation = {
  ok: boolean;
  mime?: string;
  ext?: string;
  width?: number;
  height?: number;
  reason?: string;
};

/** Valida tamanho, tipo real e dimensões. Não grava nada. */
export function validateImage(buffer: Uint8Array, maxBytes: number): UploadValidation {
  if (buffer.length === 0) return { ok: false, reason: "Arquivo vazio." };
  if (buffer.length > maxBytes) {
    return { ok: false, reason: `Arquivo maior que o limite de ${Math.round(maxBytes / (1024 * 1024))} MB.` };
  }

  const mime = detectImageMime(buffer);
  if (!mime || !ALLOWED_IMAGE_MIME.includes(mime as (typeof ALLOWED_IMAGE_MIME)[number])) {
    return { ok: false, reason: "Arquivo não é uma imagem válida (JPEG, PNG, WEBP, GIF ou AVIF)." };
  }

  let width: number | undefined;
  let height: number | undefined;
  try {
    const size = imageSize(buffer);
    width = size.width;
    height = size.height;
  } catch {
    return { ok: false, reason: "Não foi possível ler as dimensões da imagem." };
  }

  if (!width || !height) return { ok: false, reason: "Imagem sem dimensões válidas." };
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    return { ok: false, reason: `Imagem muito pequena (mínimo ${MIN_DIMENSION}x${MIN_DIMENSION}).` };
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    return { ok: false, reason: `Imagem muito grande (máximo ${MAX_DIMENSION}x${MAX_DIMENSION}).` };
  }

  return { ok: true, mime, ext: EXT_BY_MIME[mime] ?? "bin", width, height };
}

export type SavedUpload = { url: string; filename: string; mime: string; width: number; height: number; size: number };

/** Valida e grava a imagem. Lança AppError (422) quando inválida. */
export async function saveUpload(buffer: Uint8Array): Promise<SavedUpload> {
  const maxBytes = env.UPLOAD_MAX_MB * 1024 * 1024;
  const result = validateImage(buffer, maxBytes);
  if (!result.ok) throw validationError(result.reason ?? "Imagem inválida.");

  const filename = `${Date.now()}-${randomBytes(8).toString("hex")}.${result.ext}`;
  const dir = resolve(process.cwd(), env.STORAGE_LOCAL_DIR);

  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, filename), buffer);

  const base = env.STORAGE_PUBLIC_URL.replace(/\/$/, "");
  return {
    url: `${base}/${filename}`,
    filename,
    mime: result.mime!,
    width: result.width!,
    height: result.height!,
    size: buffer.length,
  };
}
