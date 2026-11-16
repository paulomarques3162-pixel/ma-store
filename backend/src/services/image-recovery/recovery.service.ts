import { prisma } from "../../db.js";
import { invalidateCatalogCache } from "../../lib/cache.js";
import { badRequest, notFound } from "../../lib/errors.js";
import { env } from "../../env.js";
import type { ImageAssetType, ImageRecoveryAsset, ImageRecoveryResult, Prisma } from "@prisma/client";
import { validateImage } from "../storage.js";
import { deleteCloudinaryAsset, isCloudinaryConfigured } from "../cloudinary.js";
import { saveImage, storageStatus } from "../storage-provider.js";
import {
  checkImageUrl,
  isCloudinaryUrl,
  isRecoverableStatus,
  type ImageCheckResult,
} from "./checker.js";
import { statusFilterToWhere } from "./scanner.js";
import { safeFetch } from "./url-safety.js";

/**
 * Recuperacao individual de imagens.
 *
 * Fluxo OBRIGATORIO (nunca substitui nada automaticamente):
 *   1. verificar a URL original;
 *   2. baixar o arquivo e validar assinatura/dimensoes/tamanho;
 *   3. enviar ao Cloudinary (sem redimensionar, preservando o original);
 *   4. verificar a nova URL;
 *   5. deixar em PENDING_CONFIRMATION;
 *   6. so trocar a referencia do produto depois de `confirmAsset`.
 */

export type AssetPreview = {
  id: string;
  assetType: string;
  assetId: string;
  productId: string | null;
  productName: string | null;
  label: string;
  field: string;
  status: string;
  currentUrl: string;
  originalUrl: string | null;
  recoveredUrl: string | null;
  newUrl: string | null;
  publicId: string | null;
  storageProvider: string | null;
  format: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  httpStatus: number | null;
  contentType: string | null;
  failureReason: string | null;
  attempts: number;
  lastCheckedAt: string | null;
  recoveredAt: string | null;
  createdAt: string;
  updatedAt: string;
  canRecover: boolean;
  isCloudinary: boolean;
  awaitingConfirmation: boolean;
};

function toPreview(asset: ImageRecoveryAsset, productName: string | null = null): AssetPreview {
  return {
    id: asset.id,
    assetType: asset.assetType,
    assetId: asset.assetId,
    productId: asset.productId,
    productName,
    label: asset.label,
    field: asset.field,
    status: asset.status,
    currentUrl: asset.currentUrl,
    originalUrl: asset.originalUrl,
    recoveredUrl: asset.newUrl,
    newUrl: asset.newUrl,
    publicId: asset.publicId,
    storageProvider: asset.storageProvider,
    format: asset.format,
    width: asset.width,
    height: asset.height,
    sizeBytes: asset.sizeBytes,
    httpStatus: asset.httpStatus,
    contentType: asset.contentType,
    failureReason: asset.failureReason,
    attempts: asset.attempts,
    lastCheckedAt: asset.lastCheckedAt?.toISOString() ?? null,
    recoveredAt: asset.recoveredAt?.toISOString() ?? null,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
    canRecover: isRecoverableStatus(asset.status) || asset.status === "PENDING_CONFIRMATION",
    isCloudinary: isCloudinaryUrl(asset.currentUrl),
    awaitingConfirmation: asset.status === "PENDING_CONFIRMATION",
  };
}

async function productNameFor(asset: ImageRecoveryAsset): Promise<string | null> {
  if (!asset.productId) return null;
  const product = await prisma.product.findUnique({
    where: { id: asset.productId },
    select: { name: true },
  });
  return product?.name ?? null;
}

export async function getAsset(id: string): Promise<AssetPreview> {
  const asset = await prisma.imageRecoveryAsset.findUnique({ where: { id } });
  if (!asset) throw notFound("Referencia de imagem nao encontrada. Execute a auditoria novamente.");
  return toPreview(asset, await productNameFor(asset));
}

export type ListAssetsParams = {
  page?: number;
  perPage?: number;
  status?: string;
  search?: string;
  type?: string;
  sort?: string;
};

export async function listAssets(params: ListAssetsParams) {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(1, params.perPage ?? 24));

  const where: Prisma.ImageRecoveryAssetWhereInput = {
    ...statusFilterToWhere(params.status),
    ...(params.type && params.type !== "all"
      ? { assetType: params.type as ImageAssetType }
      : {}),
  };

  const search = (params.search ?? "").trim();
  if (search) {
    where.OR = [
      { label: { contains: search, mode: "insensitive" } },
      { currentUrl: { contains: search, mode: "insensitive" } },
      { originalUrl: { contains: search, mode: "insensitive" } },
    ];
  }

  const orderBy: Prisma.ImageRecoveryAssetOrderByWithRelationInput =
    params.sort === "checked"
      ? { lastCheckedAt: "desc" }
      : params.sort === "name"
        ? { label: "asc" }
        : { updatedAt: "desc" };

  const [items, total] = await Promise.all([
    prisma.imageRecoveryAsset.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.imageRecoveryAsset.count({ where }),
  ]);

  const productIds = [...new Set(items.map((item) => item.productId).filter((id): id is string => Boolean(id)))];
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(products.map((product) => [product.id, product.name]));

  return {
    data: items.map((item) => toPreview(item, item.productId ? nameById.get(item.productId) ?? null : null)),
    meta: {
      page,
      perPage,
      total,
      totalPages: Math.ceil(total / perPage),
      hasNext: page < Math.ceil(total / perPage),
      hasPrev: page > 1,
    },
  };
}

function applyCheckToAsset(result: ImageCheckResult, asset: ImageRecoveryAsset): Prisma.ImageRecoveryAssetUpdateInput {
  return {
    status: result.status,
    httpStatus: result.httpStatus,
    contentType: result.contentType,
    format: result.format ?? asset.format,
    width: result.width ?? asset.width,
    height: result.height ?? asset.height,
    sizeBytes: result.sizeBytes ?? asset.sizeBytes,
    finalUrl: result.finalUrl,
    redirected: result.redirected,
    failureReason: result.status === "AVAILABLE" || result.status === "RECOVERABLE" || result.status === "REDIRECT" ? null : result.reason,
    lastCheckedAt: new Date(),
    attempts: { increment: 1 },
    nextCheckAt: result.retryable ? new Date(Date.now() + 60 * 60 * 1000) : null,
  };
}

/** Verifica uma referencia e persiste o resultado. Nunca altera o produto. */
export async function checkAsset(id: string, adminId?: string | null): Promise<AssetPreview> {
  const asset = await prisma.imageRecoveryAsset.findUnique({ where: { id } });
  if (!asset) throw notFound("Referencia de imagem nao encontrada.");

  const result = await checkImageUrl(asset.currentUrl);
  const updated = await prisma.imageRecoveryAsset.update({
    where: { id },
    data: { ...applyCheckToAsset(result, asset), lastAdminId: adminId ?? null },
  });

  await prisma.imageRecoveryLog.create({
    data: {
      assetType: asset.assetType,
      assetId: asset.assetId,
      productId: asset.productId,
      productName: await productNameFor(asset),
      originalUrl: asset.originalUrl ?? asset.currentUrl,
      result: result.status,
      reason: result.reason,
      adminId: adminId ?? null,
    },
  });

  return toPreview(updated, await productNameFor(updated));
}

export type RecoverOutcome = {
  ok: boolean;
  message: string;
  asset: AssetPreview;
};

/** Baixa o arquivo original com limite, sem confiar em MIME/extensao. */
async function downloadOriginal(url: string): Promise<{ buffer: Buffer; mime: string; width: number; height: number; size: number; format: string | null }> {
  const maxBytes = Math.min(env.IMAGE_RECOVERY_MAX_MB, env.UPLOAD_MAX_MB) * 1024 * 1024;

  // safeFetch aplica allowlist de IP/DNS, pinagem, redirects revalidados,
  // timeout e limite de bytes.
  const response = await safeFetch(url, {
    method: "GET",
    maxBytes,
    timeoutMs: env.IMAGE_RECOVERY_TIMEOUT_MS,
    maxRedirects: env.IMAGE_RECOVERY_MAX_REDIRECTS,
  });

  if (response.status < 200 || response.status >= 300) {
    throw badRequest(`O servidor original respondeu HTTP ${response.status} ao baixar a imagem.`);
  }
  if (response.truncated || response.body.length >= maxBytes) {
    throw badRequest(`A imagem excede o limite de ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  }
  if (response.contentLength && response.contentLength > maxBytes) {
    throw badRequest("A imagem informada e maior que o limite permitido.");
  }

  const validation = validateImage(response.body, maxBytes);
  if (!validation.ok) throw badRequest(validation.reason ?? "O arquivo baixado nao e uma imagem valida.");

  return {
    buffer: response.body,
    mime: validation.mime!,
    width: validation.width!,
    height: validation.height!,
    size: response.body.length,
    format: validation.ext ?? null,
  };
}

/**
 * Executa a recuperacao ate a PRE-VISUALIZACAO (nao troca a imagem do produto).
 * A confirmacao e uma chamada separada (`confirmAsset`).
 */
export async function recoverAsset(id: string, adminId?: string | null): Promise<RecoverOutcome> {
  const asset = await prisma.imageRecoveryAsset.findUnique({ where: { id } });
  if (!asset) throw notFound("Referencia de imagem nao encontrada.");

  const name = await productNameFor(asset);

  // Ja existe uma recuperacao aguardando confirmacao: devolve a mesma previa
  // em vez de baixar/enviar de novo (evita duplicidade no Cloudinary).
  if (asset.status === "PENDING_CONFIRMATION" && asset.newUrl) {
    return {
      ok: true,
      message: "Esta imagem ja foi recuperada e aguarda confirmacao administrativa.",
      asset: toPreview(asset, name),
    };
  }

  if (isCloudinaryUrl(asset.currentUrl)) {
    const updated = await prisma.imageRecoveryAsset.update({
      where: { id },
      data: { status: "CLOUDINARY", failureReason: null },
    });
    return {
      ok: false,
      message: "A imagem ja esta armazenada no Cloudinary; nenhuma acao necessaria.",
      asset: toPreview(updated, name),
    };
  }

  if (!isCloudinaryConfigured()) {
    const updated = await prisma.imageRecoveryAsset.update({
      where: { id },
      data: {
        failureReason:
          "Cloudinary nao configurado. Defina CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET e STORAGE_DRIVER=cloudinary.",
      },
    });
    await logRecovery(asset, "FAILED", updated.failureReason, adminId, name);
    return { ok: false, message: updated.failureReason!, asset: toPreview(updated, name) };
  }

  // 1) Verificacao (nao baixa o arquivo inteiro).
  const check = await checkImageUrl(asset.currentUrl);
  if (!check.retryable && !isRecoverableStatus(check.status)) {
    const updated = await prisma.imageRecoveryAsset.update({
      where: { id },
      data: { ...applyCheckToAsset(check, asset), attempts: { increment: 1 } },
    });
    await logRecovery(asset, check.status, check.reason, adminId, name);
    return {
      ok: false,
      message: check.reason ?? "A imagem original nao esta acessivel.",
      asset: toPreview(updated, name),
    };
  }

  // 2) Download + validacao completa do arquivo.
  let downloaded: Awaited<ReturnType<typeof downloadOriginal>>;
  try {
    downloaded = await downloadOriginal(check.finalUrl ?? asset.currentUrl);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Falha ao baixar a imagem original.";
    const updated = await prisma.imageRecoveryAsset.update({
      where: { id },
      data: {
        status: check.status === "RECOVERABLE" || check.status === "AVAILABLE" ? "SERVER_UNAVAILABLE" : check.status,
        failureReason: reason,
        lastCheckedAt: new Date(),
        attempts: { increment: 1 },
        nextCheckAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await logRecovery(asset, "FAILED", reason, adminId, name);
    return { ok: false, message: reason, asset: toPreview(updated, name) };
  }

  // 3) Envio ao Cloudinary — sem redimensionar (proporcao/qualidade originais).
  const folder = storageStatus().cloudinaryFolder ?? "ma-store";
  let uploaded: Awaited<ReturnType<typeof saveImage>>;
  try {
    uploaded = await saveImage(downloaded.buffer, {
      folder,
      publicId: `${folder}/recuperadas/${asset.id}`,
      filename: `${asset.id}.${downloaded.format ?? "jpg"}`,
    });
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "Falha ao enviar a imagem para o Cloudinary.";
    // O status ORIGINAL da URL nao e alterado: uma falha de storage nao pode
    // ser confundida com "imagem perdida".
    const updated = await prisma.imageRecoveryAsset.update({
      where: { id },
      data: { failureReason: reason, attempts: { increment: 1 }, lastCheckedAt: new Date() },
    });
    await logRecovery(asset, "FAILED", reason, adminId, name);
    return { ok: false, message: reason, asset: toPreview(updated, name) };
  }

  // 4) Valida a nova URL antes de oferecer a substituicao.
  const verify = await checkImageUrl(uploaded.url);
  if (!["AVAILABLE", "RECOVERABLE", "REDIRECT"].includes(verify.status)) {
    const reason = `A imagem foi enviada, mas a URL do Cloudinary nao respondeu corretamente (${verify.status}).`;
    const updated = await prisma.imageRecoveryAsset.update({
      where: { id },
      data: { failureReason: reason, attempts: { increment: 1 } },
    });
    await logRecovery(asset, "FAILED", reason, adminId, name);
    return { ok: false, message: reason, asset: toPreview(updated, name) };
  }

  // 5) Aguarda confirmacao — o produto continua com a URL antiga.
  const updated = await prisma.imageRecoveryAsset.update({
    where: { id },
    data: {
      status: "PENDING_CONFIRMATION",
      newUrl: uploaded.url,
      publicId: uploaded.filename,
      storageProvider: "cloudinary",
      format: uploaded.mime.split("/")[1] === "jpeg" ? "jpg" : uploaded.mime.split("/")[1]!,
      width: uploaded.width || downloaded.width,
      height: uploaded.height || downloaded.height,
      sizeBytes: uploaded.size || downloaded.size,
      httpStatus: verify.httpStatus,
      contentType: verify.contentType,
      failureReason: null,
      lastCheckedAt: new Date(),
      attempts: { increment: 1 },
      lastAdminId: adminId ?? null,
      nextCheckAt: null,
    },
  });

  await logRecovery(asset, "RECOVERED", "Imagem copiada para o Cloudinary; aguardando confirmacao.", adminId, name, uploaded.url);

  return {
    ok: true,
    message: "Imagem recuperada. Confira a pre-visualizacao antes de substituir a referencia antiga.",
    asset: toPreview(updated, name),
  };
}

async function logRecovery(
  asset: ImageRecoveryAsset,
  result: ImageRecoveryResult,
  reason: string | null | undefined,
  adminId?: string | null,
  productName?: string | null,
  newUrl?: string | null,
) {
  await prisma.imageRecoveryLog.create({
    data: {
      assetType: asset.assetType,
      assetId: asset.assetId,
      productId: asset.productId,
      productName: productName ?? null,
      originalUrl: asset.originalUrl ?? asset.currentUrl,
      newUrl: newUrl ?? null,
      result,
      reason: reason ?? null,
      adminId: adminId ?? null,
    },
  });
}

export type ConfirmAction = "replace" | "keep" | "cancel";

export type ConfirmOutcome = {
  ok: boolean;
  message: string;
  asset: AssetPreview;
  updatedTarget: boolean;
};

/**
 * Confirmacao administrativa:
 *  - replace: troca SOMENTE a referencia de imagem (produto/banner/categoria/marca);
 *  - keep / cancel: descarta a recuperacao pendente e preserva a URL antiga.
 *
 * Precos, nomes, marcas, estoque, pedidos e historico nunca sao tocados.
 */
export async function confirmAsset(
  id: string,
  action: ConfirmAction,
  adminId?: string | null,
): Promise<ConfirmOutcome> {
  const asset = await prisma.imageRecoveryAsset.findUnique({ where: { id } });
  if (!asset) throw notFound("Referencia de imagem nao encontrada.");
  const name = await productNameFor(asset);

  if (action !== "replace") {
    const discardedUrl = asset.newUrl;
    const publicId = asset.publicId;

    if (publicId && asset.storageProvider === "cloudinary") {
      // Best-effort: remove a copia pendente para nao deixar lixo no CDN.
      await deleteCloudinaryAsset(publicId).catch(() => false);
    }

    const updated = await prisma.imageRecoveryAsset.update({
      where: { id },
      data: {
        status: isCloudinaryUrl(asset.currentUrl) ? "CLOUDINARY" : "RECOVERABLE",
        newUrl: null,
        publicId: null,
        storageProvider: null,
        failureReason: action === "cancel" ? "Recuperacao cancelada pelo administrador." : "Administrador optou por manter o endereco antigo.",
        lastAdminId: adminId ?? null,
      },
    });
    await logRecovery(asset, "KEPT_ORIGINAL", `Acao: ${action}.`, adminId, name, discardedUrl);
    return {
      ok: true,
      message:
        action === "cancel"
          ? "Recuperacao cancelada. A imagem antiga foi mantida."
          : "Endereco antigo mantido. Nenhuma alteracao foi feita no produto.",
      asset: toPreview(updated, name),
      updatedTarget: false,
    };
  }

  if (asset.status !== "PENDING_CONFIRMATION" || !asset.newUrl) {
    throw badRequest("Nao ha recuperacao pendente de confirmacao para esta imagem.");
  }

  const newUrl = asset.newUrl;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    switch (asset.assetType) {
      case "PRODUCT_IMAGE": {
        const image = await tx.productImage.findUnique({ where: { id: asset.assetId } });
        if (!image) throw notFound("A imagem do produto nao existe mais. A recuperacao foi descartada.");
        await tx.productImage.update({
          where: { id: asset.assetId },
          data: {
            url: newUrl,
            originalUrl: image.originalUrl ?? image.url,
            publicId: asset.publicId,
            storageProvider: asset.storageProvider ?? "cloudinary",
            format: asset.format,
            width: asset.width,
            height: asset.height,
            sizeBytes: asset.sizeBytes,
            recoveryStatus: "RECOVERED",
            recoveryCheckedAt: now,
          },
        });
        break;
      }
      case "BANNER": {
        const banner = await tx.banner.findUnique({ where: { id: asset.assetId } });
        if (!banner) throw notFound("O banner nao existe mais. A recuperacao foi descartada.");
        await tx.banner.update({ where: { id: asset.assetId }, data: { imageUrl: newUrl } });
        break;
      }
      case "CATEGORY": {
        const category = await tx.category.findUnique({ where: { id: asset.assetId } });
        if (!category) throw notFound("A categoria nao existe mais. A recuperacao foi descartada.");
        await tx.category.update({ where: { id: asset.assetId }, data: { imageUrl: newUrl } });
        break;
      }
      case "BRAND": {
        const brand = await tx.brand.findUnique({ where: { id: asset.assetId } });
        if (!brand) throw notFound("A marca nao existe mais. A recuperacao foi descartada.");
        await tx.brand.update({ where: { id: asset.assetId }, data: { logoUrl: newUrl } });
        break;
      }
      default:
        throw badRequest("Tipo de referencia de imagem nao suportado.");
    }

    await tx.imageRecoveryAsset.update({
      where: { id },
      data: {
        status: "RECOVERED",
        currentUrl: newUrl,
        originalUrl: asset.originalUrl ?? asset.currentUrl,
        recoveredAt: now,
        failureReason: null,
        lastAdminId: adminId ?? null,
      },
    });

    await tx.imageRecoveryLog.create({
      data: {
        assetType: asset.assetType,
        assetId: asset.assetId,
        productId: asset.productId,
        productName: name,
        originalUrl: asset.originalUrl ?? asset.currentUrl,
        newUrl,
        result: "CONFIRMED",
        reason: "Substituicao confirmada pelo administrador.",
        adminId: adminId ?? null,
      },
    });
  });

  invalidateCatalogCache();

  const updated = await prisma.imageRecoveryAsset.findUniqueOrThrow({ where: { id } });
  return {
    ok: true,
    message:
      asset.assetType === "PRODUCT_IMAGE"
        ? "Imagem do produto atualizada. Nome, preco, marca, estoque e pedidos nao foram alterados."
        : "Referencia de imagem atualizada.",
    asset: toPreview(updated, name),
    updatedTarget: true,
  };
}

/**
 * Endereco informado manualmente pelo admin. Fica em PENDING_CONFIRMATION:
 * nunca e tratado como "imagem original recuperada".
 */
export async function setManualUrl(id: string, rawUrl: string, adminId?: string | null): Promise<AssetPreview> {
  const asset = await prisma.imageRecoveryAsset.findUnique({ where: { id } });
  if (!asset) throw notFound("Referencia de imagem nao encontrada.");

  const check = await checkImageUrl(rawUrl);
  if (!isRecoverableStatus(check.status)) {
    throw badRequest(check.reason ?? "A URL informada nao aponta para uma imagem acessivel.");
  }

  const updated = await prisma.imageRecoveryAsset.update({
    where: { id },
    data: {
      newUrl: check.finalUrl ?? rawUrl,
      publicId: null,
      storageProvider: "manual-url",
      status: "PENDING_CONFIRMATION",
      format: check.format,
      width: check.width,
      height: check.height,
      sizeBytes: check.sizeBytes,
      httpStatus: check.httpStatus,
      contentType: check.contentType,
      failureReason: "Endereco informado manualmente (nao e a recuperacao do endereco original).",
      lastCheckedAt: new Date(),
      attempts: { increment: 1 },
      lastAdminId: adminId ?? null,
    },
  });
  await logRecovery(asset, "RECOVERABLE", "URL manual validada e aguardando confirmacao.", adminId, null, updated.newUrl);
  return toPreview(updated, await productNameFor(updated));
}

/** Upload manual de uma imagem substituta (tambem exige confirmacao). */
export async function setManualUpload(id: string, buffer: Uint8Array, adminId?: string | null): Promise<AssetPreview> {
  const asset = await prisma.imageRecoveryAsset.findUnique({ where: { id } });
  if (!asset) throw notFound("Referencia de imagem nao encontrada.");
  if (!isCloudinaryConfigured()) throw badRequest("Cloudinary nao configurado para armazenar o upload manual.");

  const folder = storageStatus().cloudinaryFolder ?? "ma-store";
  const uploaded = await saveImage(buffer, {
    folder,
    publicId: `${folder}/manuais/${asset.id}`,
    filename: `${asset.id}-manual`,
  });

  const updated = await prisma.imageRecoveryAsset.update({
    where: { id },
    data: {
      newUrl: uploaded.url,
      publicId: uploaded.filename,
      storageProvider: "cloudinary",
      status: "PENDING_CONFIRMATION",
      format: uploaded.mime.split("/")[1] === "jpeg" ? "jpg" : uploaded.mime.split("/")[1],
      width: uploaded.width,
      height: uploaded.height,
      sizeBytes: uploaded.size,
      failureReason: "Imagem substituta enviada manualmente (nao e a recuperacao do endereco original).",
      lastCheckedAt: new Date(),
      attempts: { increment: 1 },
      lastAdminId: adminId ?? null,
    },
  });
  await logRecovery(asset, "RECOVERABLE", "Upload manual aguardando confirmacao.", adminId, null, uploaded.url);
  return toPreview(updated, await productNameFor(updated));
}

/** Relatorio consolidado (JSON). */
export async function getRecoveryReport(limit = 200) {
  const logs = await prisma.imageRecoveryLog.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(1000, Math.max(1, limit)),
  });

  const totals = await prisma.imageRecoveryLog.groupBy({
    by: ["result"],
    _count: { _all: true },
  });

  return {
    generatedAt: new Date().toISOString(),
    totals: totals.map((row) => ({ result: row.result, count: row._count._all })),
    logs: logs.map((log) => ({
      id: log.id,
      date: log.createdAt.toISOString(),
      assetType: log.assetType,
      productName: log.productName,
      originalUrl: log.originalUrl,
      newUrl: log.newUrl,
      result: log.result,
      reason: log.reason,
      jobId: log.jobId,
    })),
  };
}

const CSV_COLUMNS = [
  "Data",
  "Tipo",
  "Produto",
  "URL original",
  "URL nova",
  "Resultado",
  "Motivo",
] as const;

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function buildRecoveryCsv(): Promise<string> {
  const logs = await prisma.imageRecoveryLog.findMany({ orderBy: { createdAt: "desc" } });
  const lines = [CSV_COLUMNS.join(";")];
  for (const log of logs) {
    lines.push(
      [
        log.createdAt.toISOString(),
        log.assetType,
        log.productName ?? "",
        log.originalUrl,
        log.newUrl ?? "",
        log.result,
        log.reason ?? "",
      ]
        .map(csvCell)
        .join(";"),
    );
  }
  // BOM para o Excel abrir acentos corretamente.
  return `\uFEFF${lines.join("\r\n")}`;
}
