import { env } from "../env.js";
import { cloudinaryConfig, deleteCloudinaryAsset, uploadImageToCloudinary } from "./cloudinary.js";
import { deleteS3Upload, saveS3Upload } from "./storage-s3.js";
import { deleteLocalUpload, saveUpload, type SavedUpload } from "./storage.js";

/**
 * Camada CENTRALIZADA de armazenamento.
 *
 * Toda gravacao de imagem (upload manual do admin e recuperador automatico)
 * passa por aqui. O driver e escolhido por `STORAGE_DRIVER`:
 *
 *   local       -> disco do processo (dev; efemero no Render)
 *   s3          -> qualquer API compativel com S3 (AWS/R2/MinIO)
 *   cloudinary  -> CDN + f_auto/q_auto (padrao para recuperacao)
 *
 * Nenhum chamador precisa conhecer credenciais ou detalhes do provedor.
 */

export type StorageDriverName = "local" | "s3" | "cloudinary" | "other";

export function activeStorageDriver(): StorageDriverName {
  return env.storageDriver;
}

export type StorageStatus = {
  driver: StorageDriverName;
  persistent: boolean;
  cloudinaryConfigured: boolean;
  /** Pasta publica usada pelo recuperador (sem expor credenciais). */
  cloudinaryFolder: string | null;
};

export function storageStatus(): StorageStatus {
  const config = cloudinaryConfig();
  return {
    driver: activeStorageDriver(),
    persistent: activeStorageDriver() === "s3" || activeStorageDriver() === "cloudinary",
    cloudinaryConfigured: config !== null,
    cloudinaryFolder: config?.folder ?? null,
  };
}

export type SaveImageOptions = {
  /** Nome/ID sugerido (o provedor pode normalizar). */
  publicId?: string;
  folder?: string;
  filename?: string;
};

/**
 * Grava uma imagem validada no driver ativo.
 * Lanca AppError (422) quando a imagem e invalida; CloudinaryUploadError quando
 * o provedor falha.
 */
export async function saveImage(buffer: Uint8Array, options: SaveImageOptions = {}): Promise<SavedUpload> {
  switch (activeStorageDriver()) {
    case "cloudinary": {
      const uploaded = await uploadImageToCloudinary(buffer, options);
      return {
        // `url` e a URL otimizada (f_auto/q_auto) usada pela vitrine.
        url: uploaded.url,
        filename: uploaded.publicId,
        mime: uploaded.format ? `image/${uploaded.format === "jpg" ? "jpeg" : uploaded.format}` : "image/jpeg",
        width: uploaded.width ?? 0,
        height: uploaded.height ?? 0,
        size: uploaded.sizeBytes,
      };
    }
    case "s3":
      return saveS3Upload(buffer);
    default:
      return saveUpload(buffer);
  }
}

/** Remove um arquivo/asset pelo URL gravado no banco (best-effort). */
export async function deleteStoredImage(url: string): Promise<boolean> {
  if (!url) return false;
  switch (activeStorageDriver()) {
    case "cloudinary": {
      const publicId = extractCloudinaryPublicId(url);
      if (!publicId) return false;
      return deleteCloudinaryAsset(publicId);
    }
    case "s3":
      return deleteS3Upload(url);
    default:
      return deleteLocalUpload(url);
  }
}

/** Extrai o `public_id` de uma URL de entrega do Cloudinary. */
export function extractCloudinaryPublicId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.toLowerCase().endsWith("cloudinary.com")) return null;
    const marker = "/image/upload/";
    const index = parsed.pathname.indexOf(marker);
    if (index < 0) return null;
    let rest = parsed.pathname.slice(index + marker.length);
    // Remove transformacao e versao (`f_auto,q_auto:good/v123/`).
    const parts = rest.split("/").filter(Boolean);
    while (parts.length > 1 && (/^v\d+$/.test(parts[0]!) || parts[0]!.includes(",") || /^[a-z]_[a-z]/i.test(parts[0]!))) {
      parts.shift();
    }
    rest = parts.join("/");
    return rest.replace(/\.[a-z0-9]+$/i, "") || null;
  } catch {
    return null;
  }
}
