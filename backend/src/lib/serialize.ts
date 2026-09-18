import type { Prisma } from "@prisma/client";

/** Converte valores Decimal do Prisma em number para serializacao JSON. */
export function decimalToNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value === "object" && "toNumber" in (value as object)) {
    return (value as { toNumber: () => number }).toNumber();
  }
  if (typeof value === "object" && "toString" in (value as object)) {
    return Number((value as { toString: () => string }).toString());
  }
  return Number(value as never);
}

/** Serializa recursivamente qualquer objeto com Decimal/BigInt/Date para JSON puro. */
export function serialize<T>(input: T): T {
  if (input === null || input === undefined) return input;
  if (Array.isArray(input)) return input.map((item) => serialize(item)) as unknown as T;
  if (input instanceof Date) return input.toISOString() as unknown as T;
  if (typeof input === "bigint") return Number(input) as unknown as T;
  if (typeof input === "object") {
    // Deteccao de Decimal por "duck typing": funciona mesmo quando o bundler
    // renomeia a classe (o nome `Decimal` nao e garantido apos o build).
    const maybeDecimal = input as { toNumber?: () => number; toFixed?: (digits?: number) => string };
    if (typeof maybeDecimal.toNumber === "function" && typeof maybeDecimal.toFixed === "function") {
      return maybeDecimal.toNumber() as unknown as T;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      out[key] = serialize(value);
    }
    return out as unknown as T;
  }
  return input;
}

export type Paginated<T> = {
  data: T[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
};

export const DEFAULT_PER_PAGE = 20;
export const MAX_PER_PAGE = 100;

/** Normaliza parametros de paginacao com limites seguros. */
export function parsePagination(query: { page?: unknown; perPage?: unknown; per_page?: unknown }) {
  const rawPage = Number(query.page ?? 1);
  const rawPerPage = Number(query.perPage ?? query.per_page ?? DEFAULT_PER_PAGE);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const perPage = Number.isFinite(rawPerPage) && rawPerPage > 0
    ? Math.min(Math.floor(rawPerPage), MAX_PER_PAGE)
    : DEFAULT_PER_PAGE;

  return { page, perPage, skip: (page - 1) * perPage, take: perPage };
}

export function paginate<T>(data: T[], total: number, page: number, perPage: number): Paginated<T> {
  const totalPages = perPage > 0 ? Math.ceil(total / perPage) : 0;
  return {
    data,
    meta: {
      page,
      perPage,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  };
}

/** Gerador de slug amigavel para URL, com suporte a acentos pt-BR. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

/** Selecao publica de produto: nao expor custo nem campos internos. */
export const publicProductSelect = {
  id: true,
  name: true,
  slug: true,
  sku: true,
  shortDescription: true,
  description: true,
  price: true,
  comparePrice: true,
  volume: true,
  stock: true,
  minStock: true,
  hasShipping: true,
  allowCoupon: true,
  isLaunch: true,
  isFeatured: true,
  isBestSeller: true,
  active: true,
  metaTitle: true,
  metaDescription: true,
  createdAt: true,
  updatedAt: true,
  brandId: true,
  categoryId: true,
  brand: { select: { id: true, name: true, slug: true } },
  category: { select: { id: true, name: true, slug: true } },
  images: { select: { id: true, url: true, alt: true, position: true }, orderBy: { position: "asc" } },
} satisfies Prisma.ProductSelect;

export type PublicProduct = Prisma.ProductGetPayload<{ select: typeof publicProductSelect }>;
