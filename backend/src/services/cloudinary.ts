import { createHash } from "node:crypto";
import { env } from "../env.js";
import { validationError } from "../lib/errors.js";
import { EXT_BY_MIME, validateImage } from "./storage.js";

/**
 * Integracao Cloudinary (upload assinado via API REST).
 *
 * - O `api_secret` NUNCA sai do backend: a assinatura SHA-1 e calculada aqui.
 * - O arquivo e validado por MAGIC BYTES e dimensoes antes de sair do processo
 *   (nunca confiamos em extensao/Content-Type do servidor remoto).
 * - `f_auto` + `q_auto:good` sao aplicados na URL entregue: o CDN escolhe
 *   AVIF/WebP/JPEG automaticamente conforme o navegador.
 */

export type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folder: string;
};

export function cloudinaryConfig(): CloudinaryConfig | null {
  if (!env.isCloudinaryEnabled) return null;
  return {
    cloudName: env.CLOUDINARY_CLOUD_NAME.trim(),
    apiKey: env.CLOUDINARY_API_KEY.trim(),
    apiSecret: env.CLOUDINARY_API_SECRET.trim(),
    folder: env.CLOUDINARY_FOLDER.trim().replace(/^\/+|\/+$/g, "") || "ma-store",
  };
}

export function isCloudinaryConfigured(): boolean {
  return cloudinaryConfig() !== null;
}

/** Assinatura oficial: SHA-1 dos parametros ordenados + api_secret. */
export function buildUploadSignature(params: Record<string, string | number | boolean>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${String(params[key])}`)
    .join("&");
  return createHash("sha1").update(`${toSign}${apiSecret}`).digest("hex");
}

export type DeliveryOptions = {
  /** `f_auto,q_auto:good` por padrao. */
  transformation?: string;
  width?: number;
};

/**
 * URL de entrega otimizada. `version` invalida cache antigo quando o asset e
 * reenviado (mesmo `public_id`).
 */
export function buildDeliveryUrl(
  publicId: string,
  options: { version?: number | string | null; format?: string | null; transformation?: string; cloudName?: string; deliveryUrl?: string } = {},
): string {
  const cloudName = options.cloudName ?? env.CLOUDINARY_CLOUD_NAME.trim();
  const base = (options.deliveryUrl || env.CLOUDINARY_DELIVERY_URL || "").trim().replace(/\/+$/, "")
    || `https://res.cloudinary.com/${cloudName}`;
  const transformation = options.transformation ?? "f_auto,q_auto:good";
  const version = options.version ? `v${String(options.version).replace(/^v/, "")}/` : "";
  const format = options.format ? `.${options.format}` : "";
  return `${base}/image/upload/${transformation}/${version}${publicId}${format}`;
}

/** `public_id` deterministico por URL: recuperar duas vezes nao duplica asset. */
export function publicIdForUrl(sourceUrl: string, folder: string): string {
  const hash = createHash("sha1").update(sourceUrl.trim()).digest("hex").slice(0, 32);
  const safeFolder = folder.replace(/^\/+|\/+$/g, "");
  return `${safeFolder}/recuperadas/${hash}`;
}

export type CloudinaryUploadResult = {
  url: string;
  secureUrl: string;
  publicId: string;
  format: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number;
  version: number |
    null;
  provider: "cloudinary";
};

/** Erro de upload com mensagem segura (sem credenciais/URLs assinadas). */
export class CloudinaryUploadError extends Error {
  readonly httpStatus: number | null;
  constructor(message: string, httpStatus: number | null = null) {
    super(message);
    this.name = "CloudinaryUploadError";
    this.httpStatus = httpStatus;
  }
}

type UploadDeps = {
  fetch?: typeof fetch;
  config?: CloudinaryConfig | null;
  now?: () => Date;
};

/**
 * Envia a imagem para o Cloudinary.
 *
 * A validacao local (tamanho, magic bytes, dimensoes) acontece ANTES de
 * qualquer requisicao de rede.
 */
export async function uploadImageToCloudinary(
  buffer: Uint8Array,
  options: { publicId?: string; folder?: string; filename?: string } = {},
  deps: UploadDeps = {},
): Promise<CloudinaryUploadResult> {
  const config = deps.config === undefined ? cloudinaryConfig() : deps.config;
  if (!config) {
    throw new CloudinaryUploadError(
      "Cloudinary nao configurado. Defina CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET.",
    );
  }

  const maxBytes = Math.min(env.IMAGE_RECOVERY_MAX_MB, env.UPLOAD_MAX_MB) * 1024 * 1024;
  const validation = validateImage(buffer, maxBytes);
  if (!validation.ok) {
    throw validationError(validation.reason ?? "Imagem invalida para envio ao Cloudinary.");
  }

  const timestamp = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
  const folder = (options.folder ?? config.folder).replace(/^\/+|\/+$/g, "");
  const requestedId = options.publicId ?? `${folder}/recuperadas/${timestamp}-${validation.ext}`;
  // O Cloudinary ja prefixa `folder` no public_id final. Se o chamador
  // informou o caminho completo, removemos o prefixo para nao duplicar
  // (`ma-store/ma-store/...`).
  const publicId = requestedId.startsWith(`${folder}/`) ? requestedId.slice(folder.length + 1) : requestedId;
  const signature = buildUploadSignature({ folder, public_id: publicId, timestamp, overwrite: true }, config.apiSecret);

  const form = new FormData();
  const mime = validation.mime ?? "application/octet-stream";
  const filename = options.filename ?? `recuperada.${validation.ext ?? EXT_BY_MIME[mime] ?? "bin"}`;
  form.append("file", new Blob([buffer as unknown as ArrayBuffer], { type: mime }), filename);
  form.append("api_key", config.apiKey);
  form.append("timestamp", String(timestamp));
  form.append("folder", folder);
  form.append("public_id", publicId);
  form.append("overwrite", "true");
  form.append("signature", signature);

  const fetchImpl = deps.fetch ?? fetch;
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`;

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(Math.max(env.IMAGE_RECOVERY_TIMEOUT_MS, 20_000)),
    });
  } catch {
    throw new CloudinaryUploadError("Nao foi possivel conectar ao Cloudinary.");
  }

  if (!response.ok) {
    // Nao logamos o corpo cru: pode conter detalhes internos/credenciais.
    throw new CloudinaryUploadError(`Cloudinary recusou o envio (HTTP ${response.status}).`, response.status);
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new CloudinaryUploadError("Resposta invalida do Cloudinary.", response.status);
  }

  const secureUrl = typeof payload.secure_url === "string" ? payload.secure_url : null;
  const returnedPublicId = typeof payload.public_id === "string" ? payload.public_id : null;
  if (!secureUrl || !returnedPublicId) {
    throw new CloudinaryUploadError("Cloudinary nao retornou secure_url/public_id.");
  }

  const version = typeof payload.version === "number" ? payload.version : null;
  const format = typeof payload.format === "string" ? payload.format : validation.ext ?? null;

  return {
    url: buildDeliveryUrl(returnedPublicId, { version, format, cloudName: config.cloudName }),
    secureUrl,
    publicId: returnedPublicId,
    format,
    width: typeof payload.width === "number" ? payload.width : (validation.width ?? null),
    height: typeof payload.height === "number" ? payload.height : (validation.height ?? null),
    sizeBytes: typeof payload.bytes === "number" ? payload.bytes : buffer.length,
    version,
    provider: "cloudinary",
  };
}

/** Remove um asset do Cloudinary (usado ao descartar uma recuperacao pendente). */
export async function deleteCloudinaryAsset(
  publicId: string,
  deps: { fetch?: typeof fetch; config?: CloudinaryConfig | null; now?: () => Date } = {},
): Promise<boolean> {
  const config = deps.config === undefined ? cloudinaryConfig() : deps.config;
  if (!config) return false;
  const timestamp = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
  const signature = buildUploadSignature({ public_id: publicId, timestamp }, config.apiSecret);
  const body = new URLSearchParams({
    public_id: publicId,
    api_key: config.apiKey,
    timestamp: String(timestamp),
    signature,
  });
  try {
    const response = await (deps.fetch ?? fetch)(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/destroy`,
      { method: "POST", body, signal: AbortSignal.timeout(15_000) },
    );
    if (!response.ok) return false;
    const payload = (await response.json()) as { result?: string };
    return payload.result === "ok" || payload.result === "not found";
  } catch {
    return false;
  }
}
