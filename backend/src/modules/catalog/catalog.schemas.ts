import { z } from "zod";

export const idParam = z.object({ id: z.string().min(1) });
export const slugParam = z.object({ slug: z.string().min(1) });

/** Converte numero/string monetaria para string com 2 casas (Decimal seguro). */
const money = z
  .union([z.number(), z.string()])
  .transform((v) => Number(v))
  .refine((v) => Number.isFinite(v) && v >= 0, "Valor invalido.")
  .transform((v) => v.toFixed(2));

const optionalMoney = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v) => (v === null || v === undefined || v === "" ? undefined : Number(v)))
  .refine((v) => v === undefined || (Number.isFinite(v) && v >= 0), "Valor invalido.")
  .transform((v) => (v === undefined ? undefined : v.toFixed(2)));

export const productImageSchema = z.object({
  url: z.string().trim().min(1, "Informe a URL da imagem.").max(500),
  alt: z.string().trim().max(200).optional(),
  position: z.coerce.number().int().min(0).optional().default(0),
  /** Enquadramento: preset (center/top/…) ou valor CSS "50% 30%". */
  focalPoint: z
    .string()
    .trim()
    .max(30)
    .optional()
    .transform((v) => (v && v.length > 0 ? v : "center")),
});

export const createProductSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do produto.").max(160),
  sku: z.string().trim().min(1, "Informe o SKU.").max(60),
  shortDescription: z.string().trim().max(300).optional().or(z.literal("")),
  description: z.string().trim().max(8000).optional().or(z.literal("")),
  brandId: z.string().optional().nullable(),
  categoryId: z.string().optional().nullable(),
  price: money,
  comparePrice: optionalMoney,
  costPrice: optionalMoney,
  volume: z.string().trim().max(40).optional().or(z.literal("")),
  weightGrams: z.coerce.number().int().min(0).max(100000).optional(),
  stock: z.coerce.number().int().min(0).default(0),
  minStock: z.coerce.number().int().min(0).default(0),
  hasShipping: z.boolean().default(true),
  allowCoupon: z.boolean().default(true),
  isLaunch: z.boolean().default(false),
  isFeatured: z.boolean().default(false),
  isBestSeller: z.boolean().default(false),
  active: z.boolean().default(true),
  metaTitle: z.string().trim().max(160).optional().or(z.literal("")),
  metaDescription: z.string().trim().max(300).optional().or(z.literal("")),
  images: z.array(productImageSchema).max(12).optional().default([]),
});

export const updateProductSchema = createProductSchema.partial().extend({
  images: z.array(productImageSchema).max(12).optional(),
});

export const updateStockSchema = z.object({
  stock: z.coerce.number().int().min(0),
  minStock: z.coerce.number().int().min(0).optional(),
  reason: z.string().trim().max(300).optional(),
});

export const listProductQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().trim().max(120).optional(),
  category: z.string().trim().max(120).optional(),
  brand: z.string().trim().max(120).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  volume: z.string().trim().max(40).optional(),
  inStock: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true" || v === "1")),
  onSale: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true" || v === "1")),
  launch: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true" || v === "1")),
  featured: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true" || v === "1")),
  bestSeller: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true" || v === "1")),
  sort: z
    .enum(["relevance", "price_asc", "price_desc", "newest", "oldest", "name_asc", "best_sellers"])
    .optional()
    .default("newest"),
});

export const createCategorySchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da categoria.").max(120),
  slug: z.string().trim().max(120).optional().or(z.literal("")),
  description: z.string().trim().max(600).optional().or(z.literal("")),
  imageUrl: z.string().trim().max(500).optional().or(z.literal("")),
  parentId: z.string().optional().nullable(),
  position: z.coerce.number().int().min(0).default(0),
  active: z.boolean().default(true),
});

export const updateCategorySchema = createCategorySchema.partial();

export const createBrandSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da marca.").max(120),
  slug: z.string().trim().max(120).optional().or(z.literal("")),
  logoUrl: z.string().trim().max(500).optional().or(z.literal("")),
  active: z.boolean().default(true),
});

export const updateBrandSchema = createBrandSchema.partial();
