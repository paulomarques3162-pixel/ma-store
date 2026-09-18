import type { Prisma } from "@prisma/client";
import { prisma } from "../../db.js";
import { notFound } from "../../lib/errors.js";
import { publicProductSelect, slugify } from "../../lib/serialize.js";

type ListFilters = {
  search?: string;
  category?: string;
  brand?: string;
  minPrice?: number;
  maxPrice?: number;
  volume?: string;
  inStock?: boolean;
  onSale?: boolean;
  launch?: boolean;
  featured?: boolean;
  bestSeller?: boolean;
  sort?: string;
};

/** Monta o `where` da listagem publica. Nunca expoe produto inativo. */
export function buildPublicWhere(filters: ListFilters): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = { active: true };

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { sku: { contains: filters.search, mode: "insensitive" } },
      { shortDescription: { contains: filters.search, mode: "insensitive" } },
      { brand: { name: { contains: filters.search, mode: "insensitive" } } },
      { category: { name: { contains: filters.search, mode: "insensitive" } } },
    ];
  }

  if (filters.category) where.category = { slug: filters.category, active: true };
  if (filters.brand) where.brand = { slug: filters.brand, active: true };
  if (filters.volume) where.volume = filters.volume;
  if (filters.inStock) where.stock = { gt: 0 };
  if (filters.launch) where.isLaunch = true;
  if (filters.featured) where.isFeatured = true;
  if (filters.bestSeller) where.isBestSeller = true;
  if (filters.onSale) where.comparePrice = { not: null, gt: 0 };

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    where.price = {
      ...(filters.minPrice !== undefined ? { gte: filters.minPrice } : {}),
      ...(filters.maxPrice !== undefined ? { lte: filters.maxPrice } : {}),
    };
  }

  return where;
}

export function buildOrderBy(sort: string | undefined): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "price_asc":
      return [{ price: "asc" }];
    case "price_desc":
      return [{ price: "desc" }];
    case "name_asc":
      return [{ name: "asc" }];
    case "oldest":
      return [{ createdAt: "asc" }];
    case "best_sellers":
      return [{ soldStock: "desc" }, { createdAt: "desc" }];
    case "relevance":
      // Sem motor de ranking: prioriza destaque e depois novidades.
      return [{ isFeatured: "desc" }, { soldStock: "desc" }, { createdAt: "desc" }];
    case "newest":
    default:
      return [{ createdAt: "desc" }];
  }
}

/**
 * Lista produtos publicos com paginacao.
 * Uma unica query + uma count; nada de N+1 (as relacoes vem por `select`).
 */
export async function listPublicProducts(filters: ListFilters, skip: number, take: number) {
  const where = buildPublicWhere(filters);
  const orderBy = buildOrderBy(filters.sort);

  const [items, total] = await Promise.all([
    prisma.product.findMany({ where, orderBy, skip, take, select: publicProductSelect }),
    prisma.product.count({ where }),
  ]);

  return { items, total };
}

export async function getPublicProductBySlug(slug: string) {
  const product = await prisma.product.findFirst({
    where: { slug, active: true },
    select: publicProductSelect,
  });
  if (!product) throw notFound("Produto nao encontrado.");
  return product;
}

export async function listRelatedProducts(productId: string, categoryId: string | null, take = 8) {
  return prisma.product.findMany({
    where: {
      active: true,
      id: { not: productId },
      ...(categoryId ? { categoryId } : {}),
    },
    select: publicProductSelect,
    orderBy: [{ soldStock: "desc" }, { createdAt: "desc" }],
    take,
  });
}

/** Lista categorias ativas com contagem de produtos (uma query agregada). */
export async function listPublicCategories() {
  return prisma.category.findMany({
    where: { active: true },
    orderBy: [{ position: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      imageUrl: true,
      parentId: true,
      position: true,
      _count: { select: { products: { where: { active: true } } } },
    },
  });
}

export async function listPublicBrands() {
  return prisma.brand.findMany({
    where: { active: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      logoUrl: true,
      _count: { select: { products: { where: { active: true } } } },
    },
  });
}

/** Facetas para os filtros da vitrine: volumes e faixa de preco reais. */
export async function getCatalogFacets() {
  const [volumes, priceRange] = await Promise.all([
    prisma.product.findMany({
      where: { active: true, volume: { not: null } },
      select: { volume: true },
      distinct: ["volume"],
      orderBy: { volume: "asc" },
    }),
    prisma.product.aggregate({
      where: { active: true },
      _min: { price: true },
      _max: { price: true },
    }),
  ]);

  return {
    volumes: volumes.map((v) => v.volume).filter(Boolean),
    priceMin: priceRange._min.price,
    priceMax: priceRange._max.price,
  };
}

/** Garante slug unico. */
export async function uniqueSlug(
  base: string,
  table: "product" | "category" | "brand",
  ignoreId?: string,
): Promise<string> {
  const root = slugify(base) || `item-${Date.now()}`;
  let candidate = root;
  let counter = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found =
      table === "product"
        ? await prisma.product.findUnique({ where: { slug: candidate }, select: { id: true } })
        : table === "category"
          ? await prisma.category.findUnique({ where: { slug: candidate }, select: { id: true } })
          : await prisma.brand.findUnique({ where: { slug: candidate }, select: { id: true } });

    if (!found || found.id === ignoreId) return candidate;
    counter += 1;
    candidate = `${root}-${counter}`;
  }
}
