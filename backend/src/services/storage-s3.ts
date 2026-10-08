import { randomBytes } from "node:crypto";
import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { extname } from "node:path";
import { env } from "../env.js";
import { validationError } from "../lib/errors.js";
import {
  UPLOAD_EXTENSIONS,
  validateImage,
  type ListUploadsOptions,
  type SavedUpload,
  type UploadedFileInfo,
} from "./storage.js";

/**
 * Driver de armazenamento de objetos compativel com a API S3.
 *
 * Funciona com AWS S3, Cloudflare R2, Backblaze B2, MinIO, DigitalOcean
 * Spaces, etc. E ATIVADO somente quando `STORAGE_DRIVER=s3` E o bucket esta
 * definido — caso contrario o driver local continua sendo o padrao.
 *
 * Persistencia: em producao (Render/serverless) o disco e efemero; usar um
 * bucket resolve as imagens "quebradas" apos cada deploy.
 */

let cachedClient: S3Client | null = null;
let cachedClientKey: string | null = null;

function client(): S3Client {
  const cacheKey = [
    env.STORAGE_S3_REGION,
    env.STORAGE_S3_ENDPOINT,
    env.STORAGE_S3_ACCESS_KEY_ID,
    String(env.STORAGE_S3_FORCE_PATH_STYLE),
  ].join("|");

  if (!cachedClient || cachedClientKey !== cacheKey) {
    cachedClient = new S3Client({
      region: env.STORAGE_S3_REGION,
      ...(env.STORAGE_S3_ENDPOINT ? { endpoint: env.STORAGE_S3_ENDPOINT } : {}),
      ...(env.STORAGE_S3_ACCESS_KEY_ID
        ? {
            credentials: {
              accessKeyId: env.STORAGE_S3_ACCESS_KEY_ID,
              secretAccessKey: env.STORAGE_S3_SECRET_ACCESS_KEY,
            },
          }
        : {}),
      forcePathStyle: env.STORAGE_S3_FORCE_PATH_STYLE,
    });
    cachedClientKey = cacheKey;
  }
  return cachedClient;
}

function prefix(): string {
  const raw = env.STORAGE_S3_PREFIX.trim();
  if (!raw) return "";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

/** Chave do objeto dentro do bucket (prefixo + nome do arquivo). */
export function objectKey(filename: string): string {
  return `${prefix()}${filename}`;
}

/**
 * URL publica do objeto.
 *
 * Ordem de precedencia:
 *  1. `STORAGE_PUBLIC_URL` (CDN/dominio publico do bucket) — recomendado;
 *  2. endpoint customizado (path-style quando configurado);
 *  3. URL padrao da AWS.
 */
export function resolveObjectUrl(filename: string): string {
  const key = objectKey(filename);
  const base = env.STORAGE_PUBLIC_URL.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(base)) return `${base}/${key}`;

  const endpoint = env.STORAGE_S3_ENDPOINT.trim().replace(/\/+$/, "");
  if (endpoint) {
    return env.STORAGE_S3_FORCE_PATH_STYLE
      ? `${endpoint}/${env.STORAGE_S3_BUCKET}/${key}`
      : `${endpoint}/${key}`;
  }

  return `https://${env.STORAGE_S3_BUCKET}.s3.${env.STORAGE_S3_REGION}.amazonaws.com/${key}`;
}

/** Extrai o nome do arquivo da URL publica (sem query/fragmento). */
export function filenameFromUrl(url: string): string | null {
  const path = url.split("?")[0]?.split("#")[0] ?? "";
  const match = path.match(/([A-Za-z0-9._-]+)$/);
  return match?.[1] ?? null;
}

/** Valida e grava a imagem no bucket. Lança AppError (422) quando inválida. */
export async function saveS3Upload(buffer: Uint8Array): Promise<SavedUpload> {
  const maxBytes = env.UPLOAD_MAX_MB * 1024 * 1024;
  const result = validateImage(buffer, maxBytes);
  if (!result.ok) throw validationError(result.reason ?? "Imagem inválida.");

  const filename = `${Date.now()}-${randomBytes(8).toString("hex")}.${result.ext}`;

  await client().send(
    new PutObjectCommand({
      Bucket: env.STORAGE_S3_BUCKET,
      Key: objectKey(filename),
      Body: buffer,
      ContentType: result.mime,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return {
    url: resolveObjectUrl(filename),
    filename,
    mime: result.mime ?? "application/octet-stream",
    width: result.width ?? 0,
    height: result.height ?? 0,
    size: buffer.length,
  };
}

/** Lista as imagens do bucket (uma pagina de ate 1000 objetos), com busca/paginacao. */
export async function listS3Uploads(
  options: ListUploadsOptions = {},
): Promise<{ items: UploadedFileInfo[]; total: number; page: number; perPage: number }> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const perPage = Math.min(100, Math.max(1, Math.floor(options.perPage ?? 24)));

  let contents: Array<{ Key?: string; Size?: number; LastModified?: Date }> = [];
  try {
    const response = await client().send(
      new ListObjectsV2Command({ Bucket: env.STORAGE_S3_BUCKET, Prefix: prefix(), MaxKeys: 1000 }),
    );
    contents = response.Contents ?? [];
  } catch {
    return { items: [], total: 0, page, perPage };
  }

  let items: UploadedFileInfo[] = contents
    .filter((object) => {
      const filename = object.Key?.slice(prefix().length) ?? "";
      return filename.length > 0 && UPLOAD_EXTENSIONS.has(extname(filename).slice(1).toLowerCase());
    })
    .map((object) => {
      const filename = (object.Key ?? "").slice(prefix().length);
      return {
        filename,
        url: resolveObjectUrl(filename),
        size: object.Size ?? 0,
        createdAt: (object.LastModified ?? new Date()).toISOString(),
      };
    });

  const search = (options.search ?? "").trim().toLowerCase();
  if (search) items = items.filter((item) => item.filename.toLowerCase().includes(search));
  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const total = items.length;
  const start = (page - 1) * perPage;
  return { items: items.slice(start, start + perPage), total, page, perPage };
}

/** Remove um objeto do bucket (best-effort; nunca lanca). */
export async function deleteS3Upload(url: string): Promise<boolean> {
  const filename = filenameFromUrl(url);
  if (!filename) return false;
  try {
    await client().send(
      new DeleteObjectCommand({ Bucket: env.STORAGE_S3_BUCKET, Key: objectKey(filename) }),
    );
    return true;
  } catch {
    return false;
  }
}
