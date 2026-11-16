import { prisma } from "../../db.js";
import type { ImageAssetType, ImageRecoveryStatus, Prisma } from "@prisma/client";
import {
  isBrokenStatus,
  isWorkingStatus,
  STATUS_LABELS,
} from "./checker.js";

/**
 * AUDITORIA das referencias de imagem da loja.
 *
 * Percorre TODOS os lugares que guardam URL de imagem — nao apenas produtos:
 *   ProductImage.url, Banner.imageUrl, Category.imageUrl e Brand.logoUrl.
 *
 * Esta rotina e SOMENTE LEITURA nas tabelas originais: ela cria/atualiza
 * registros em `image_recovery_assets` e nunca altera produtos, banners,
 * categorias, marcas, precos, estoque ou pedidos.
 */

export type DiscoveredReference = {
  assetType: ImageAssetType;
  assetId: string;
  productId: string | null;
  label: string;
  field: string;
  currentUrl: string;
};

type KnownAsset = {
  id: string;
  assetType: ImageAssetType;
  assetId: string;
  field: string;
  currentUrl: string;
  originalUrl: string | null;
  status: ImageRecoveryStatus;
};

/** Coleta todas as referencias de imagem existentes no banco. */
export async function collectImageReferences(): Promise<DiscoveredReference[]> {
  const [productImages, banners, categories, brands] = await Promise.all([
    prisma.productImage.findMany({
      select: {
        id: true,
        url: true,
        position: true,
        product: { select: { id: true, name: true, sku: true } },
      },
      orderBy: [{ productId: "asc" }, { position: "asc" }],
    }),
    prisma.banner.findMany({
      where: { imageUrl: { not: null } },
      select: { id: true, title: true, imageUrl: true },
    }),
    prisma.category.findMany({
      where: { imageUrl: { not: null } },
      select: { id: true, name: true, imageUrl: true },
    }),
    prisma.brand.findMany({
      where: { logoUrl: { not: null } },
      select: { id: true, name: true, logoUrl: true },
    }),
  ]);

  const references: DiscoveredReference[] = [];

  for (const image of productImages) {
    const url = (image.url ?? "").trim();
    if (!url) continue;
    references.push({
      assetType: "PRODUCT_IMAGE",
      assetId: image.id,
      productId: image.product.id,
      label: `${image.product.name} — imagem ${image.position + 1}`,
      field: "url",
      currentUrl: url,
    });
  }

  for (const banner of banners) {
    const url = (banner.imageUrl ?? "").trim();
    if (!url) continue;
    references.push({
      assetType: "BANNER",
      assetId: banner.id,
      productId: null,
      label: `Banner: ${banner.title ?? banner.id}`,
      field: "imageUrl",
      currentUrl: url,
    });
  }

  for (const category of categories) {
    const url = (category.imageUrl ?? "").trim();
    if (!url) continue;
    references.push({
      assetType: "CATEGORY",
      assetId: category.id,
      productId: null,
      label: `Categoria: ${category.name}`,
      field: "imageUrl",
      currentUrl: url,
    });
  }

  for (const brand of brands) {
    const url = (brand.logoUrl ?? "").trim();
    if (!url) continue;
    references.push({
      assetType: "BRAND",
      assetId: brand.id,
      productId: null,
      label: `Marca: ${brand.name}`,
      field: "logoUrl",
      currentUrl: url,
    });
  }

  return references;
}

export type ScanResult = {
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  duplicates: Array<{ url: string; count: number }>;
  byType: Record<string, number>;
  finishedAt: string;
};

/**
 * Executa a auditoria (idempotente).
 *
 * `originalUrl` e gravado UMA vez e nunca sobrescrito: mesmo depois de uma
 * recuperacao, o endereco antigo continua registrado para o relatorio.
 */
export async function scanImageReferences(): Promise<ScanResult> {
  const references = await collectImageReferences();

  const existing = await prisma.imageRecoveryAsset.findMany({
    select: {
      id: true,
      assetType: true,
      assetId: true,
      field: true,
      currentUrl: true,
      originalUrl: true,
      status: true,
    },
  });
  const existingMap = new Map<string, KnownAsset>();
  for (const asset of existing) {
    existingMap.set(`${asset.assetType}:${asset.assetId}:${asset.field}`, asset as KnownAsset);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  // Lotes para nao abrir centenas de transacoes simultaneas.
  const CHUNK = 50;
  for (let index = 0; index < references.length; index += CHUNK) {
    const slice = references.slice(index, index + CHUNK);
    await prisma.$transaction(
      slice.map((reference) => {
        const key = `${reference.assetType}:${reference.assetId}:${reference.field}`;
        const known = existingMap.get(key);

        if (!known) {
          created += 1;
          return prisma.imageRecoveryAsset.create({
            data: {
              assetType: reference.assetType,
              assetId: reference.assetId,
              productId: reference.productId,
              label: reference.label,
              field: reference.field,
              currentUrl: reference.currentUrl,
              originalUrl: reference.currentUrl,
              status: "PENDING",
            },
          });
        }

        const changedUrl = known.currentUrl !== reference.currentUrl;
        const changedLabel = false;
        if (!changedUrl && !changedLabel && known.originalUrl) {
          unchanged += 1;
          return prisma.imageRecoveryAsset.update({
            where: { id: known.id },
            data: { label: reference.label, productId: reference.productId },
          });
        }

        updated += 1;
        // Se a URL atual mudou (ex.: admin trocou manualmente), o registro
        // volta para analise — exceto quando a recuperacao foi confirmada e a
        // URL atual ja e a nova (nesse caso nao ha nada a reanalisar).
        const resetStatus = changedUrl && known.status !== "RECOVERED";
        return prisma.imageRecoveryAsset.update({
          where: { id: known.id },
          data: {
            label: reference.label,
            productId: reference.productId,
            currentUrl: reference.currentUrl,
            originalUrl: known.originalUrl ?? reference.currentUrl,
            ...(resetStatus ? { status: "PENDING" as const, failureReason: null } : {}),
          },
        });
      }),
    );
  }

  const duplicates = await findDuplicateUrls();
  const byType: Record<string, number> = {};
  for (const reference of references) {
    byType[reference.assetType] = (byType[reference.assetType] ?? 0) + 1;
  }

  return {
    scanned: references.length,
    created,
    updated,
    unchanged,
    duplicates,
    byType,
    finishedAt: new Date().toISOString(),
  };
}

/** URLs repetidas em mais de uma referencia (possivel imagem duplicada). */
export async function findDuplicateUrls(limit = 25): Promise<Array<{ url: string; count: number }>> {
  const grouped = await prisma.imageRecoveryAsset.groupBy({
    by: ["currentUrl"],
    _count: { _all: true },
    having: { currentUrl: { _count: { gt: 1 } } },
    orderBy: { _count: { currentUrl: "desc" } },
    take: limit,
  });
  return grouped.map((group) => ({ url: group.currentUrl, count: group._count._all }));
}

export type RecoverySummary = {
  products: number;
  productsWithoutImage: number;
  references: number;
  byType: Record<string, number>;
  total: number;
  working: number;
  broken: number;
  recoverable: number;
  unavailable: number;
  temporary: number;
  migrated: number;
  awaitingAnalysis: number;
  awaitingConfirmation: number;
  byStatus: Array<{ status: string; label: string; count: number }>;
  duplicates: number;
  lastScanAt: string | null;
  lastCheckAt: string | null;
};

const TEMPORARY: ImageRecoveryStatus[] = ["SERVER_UNAVAILABLE", "CONNECTION_ERROR", "ACCESS_BLOCKED"];
const UNAVAILABLE: ImageRecoveryStatus[] = ["NOT_FOUND", "INVALID_URL", "INVALID_CONTENT", "UNAVAILABLE"];

/** Contadores do painel (sempre calculados a partir do banco, sem cache). */
export async function getRecoverySummary(): Promise<RecoverySummary> {
  const [products, productsWithImages, grouped, typeGrouped, duplicateGroups, bounds] = await Promise.all([
    prisma.product.count(),
    prisma.productImage.findMany({ distinct: ["productId"], select: { productId: true } }),
    prisma.imageRecoveryAsset.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.imageRecoveryAsset.groupBy({ by: ["assetType"], _count: { _all: true } }),
    prisma.imageRecoveryAsset.groupBy({
      by: ["currentUrl"],
      _count: { _all: true },
      having: { currentUrl: { _count: { gt: 1 } } },
    }),
    prisma.imageRecoveryAsset.aggregate({
      _max: { updatedAt: true, lastCheckedAt: true },
    }),
  ]);

  const counts = new Map<ImageRecoveryStatus, number>();
  for (const row of grouped) counts.set(row.status, row._count._all);
  const count = (statuses: ImageRecoveryStatus[]) => statuses.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0);

  const byType: Record<string, number> = {};
  for (const row of typeGrouped) byType[row.assetType] = row._count._all;

  const byStatus = [...counts.entries()]
    .map(([status, amount]) => ({ status, label: STATUS_LABELS[status] ?? status, count: amount }))
    .sort((a, b) => b.count - a.count);

  const total = byStatus.reduce((sum, row) => sum + row.count, 0);
  const working = byStatus
    .filter((row) => isWorkingStatus(row.status))
    .reduce((sum, row) => sum + row.count, 0);
  const broken = byStatus
    .filter((row) => isBrokenStatus(row.status))
    .reduce((sum, row) => sum + row.count, 0);

  return {
    products,
    productsWithoutImage: Math.max(0, products - productsWithImages.length),
    references: total,
    byType,
    total,
    working,
    broken,
    recoverable: count(["RECOVERABLE", "REDIRECT"]),
    unavailable: count(UNAVAILABLE),
    temporary: count(TEMPORARY),
    migrated: count(["CLOUDINARY", "RECOVERED"]),
    awaitingAnalysis: count(["PENDING"]),
    awaitingConfirmation: count(["PENDING_CONFIRMATION"]),
    byStatus,
    duplicates: duplicateGroups.length,
    lastScanAt: bounds._max.updatedAt ? bounds._max.updatedAt.toISOString() : null,
    lastCheckAt: bounds._max.lastCheckedAt ? bounds._max.lastCheckedAt.toISOString() : null,
  };
}

/** Filtro Prisma a partir do filtro de tela (todas, quebradas, etc.). */
export function statusFilterToWhere(filter: string | undefined): Prisma.ImageRecoveryAssetWhereInput {
  switch (filter) {
    case "broken":
    case "quebradas":
      return {
        status: {
          in: ["NOT_FOUND", "INVALID_URL", "INVALID_CONTENT", "ACCESS_BLOCKED", "SERVER_UNAVAILABLE", "CONNECTION_ERROR", "UNAVAILABLE"],
        },
      };
    case "recoverable":
      return { status: { in: ["RECOVERABLE", "REDIRECT"] } };
    case "unavailable":
      return { status: { in: UNAVAILABLE } };
    case "recovered":
      return { status: "RECOVERED" };
    case "cloudinary":
      return { status: "CLOUDINARY" };
    case "pending":
      return { status: { in: ["PENDING", "PENDING_CONFIRMATION"] } };
    case "working":
      return { status: { in: ["AVAILABLE", "RECOVERABLE", "REDIRECT", "CLOUDINARY", "RECOVERED"] } };
    default:
      return {};
  }
}
