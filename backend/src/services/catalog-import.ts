import { slugify } from "../lib/serialize.js";

/**
 * Importação segura de catálogo (fonte oficial -> banco).
 *
 * Garantias:
 *  - NUNCA apaga produto existente;
 *  - NUNCA inventa preço/estoque/descrição;
 *  - detecta duplicidade por SKU, slug e nome;
 *  - sinaliza divergência de preço (para revisão humana);
 *  - roda em modo "dry-run" por padrão (só escreve com `apply: true`).
 *
 * A lógica de planejamento é pura (sem banco), o que permite testá-la e
 * revisar o diff antes de aplicar qualquer alteração.
 */

export type CatalogSourceItem = {
  nome?: unknown;
  name?: unknown;
  sku?: unknown;
  slug?: unknown;
  preco?: unknown;
  price?: unknown;
  preco_antigo?: unknown;
  comparePrice?: unknown;
  marca?: unknown;
  brand?: unknown;
  categoria?: unknown;
  category?: unknown;
  descricao?: unknown;
  description?: unknown;
  volume?: unknown;
  peso_gramas?: unknown;
  weightGrams?: unknown;
  imagem?: unknown;
  imagem_urls?: unknown;
  images?: unknown;
};

export type NormalizedItem = {
  sourceIndex: number;
  name: string;
  sku: string;
  slug: string;
  price: number;
  comparePrice: number | null;
  brandName: string | null;
  categoryName: string | null;
  volume: string | null;
  weightGrams: number | null;
  description: string | null;
  imageUrls: string[];
};

export type InvalidItem = { sourceIndex: number; reason: string };

export type ExistingProduct = { id: string; name: string; sku: string; slug: string; price: number };

export type PlannedUpdate = {
  item: NormalizedItem;
  existing: ExistingProduct;
  /** Campos cujo valor diverge da fonte. */
  changes: string[];
  priceDivergent: boolean;
};

export type ImportPlan = {
  toCreate: NormalizedItem[];
  toUpdate: PlannedUpdate[];
  duplicates: Array<{ item: NormalizedItem; reason: string }>;
  invalid: InvalidItem[];
  summary: {
    total: number;
    valid: number;
    toCreate: number;
    toUpdate: number;
    duplicates: number;
    invalid: number;
    priceDivergent: number;
  };
};

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const normalized = value.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Normaliza um item cru da fonte, validando os campos mínimos. */
export function normalizeItem(raw: CatalogSourceItem, sourceIndex: number): NormalizedItem | InvalidItem {
  const name = asString(raw.nome) ?? asString(raw.name);
  if (!name || name.length < 2) return { sourceIndex, reason: "Nome ausente ou muito curto." };

  const price = asNumber(raw.preco ?? raw.price);
  if (price === null) return { sourceIndex, reason: "Preço ausente ou inválido." };
  if (price < 0) return { sourceIndex, reason: "Preço negativo." };

  const compareRaw = asNumber(raw.preco_antigo ?? raw.comparePrice);
  // Preço promocional maior que o preço original é incoerência -> ignorado.
  const comparePrice = compareRaw !== null && compareRaw > price ? compareRaw : null;

  const sku = asString(raw.sku) ?? `MA-${slugify(name).toUpperCase().slice(0, 40)}`;
  const slug = slugify(asString(raw.slug) ?? name);

  const imageList: string[] = [];
  const single = asString(raw.imagem);
  if (single) imageList.push(single);
  if (Array.isArray(raw.imagem_urls)) {
    for (const url of raw.imagem_urls) {
      const value = asString(url);
      if (value) imageList.push(value);
    }
  }
  if (Array.isArray(raw.images)) {
    for (const url of raw.images) {
      const value = asString(url);
      if (value) imageList.push(value);
    }
  }

  const weight = asNumber(raw.peso_gramas ?? raw.weightGrams);

  return {
    sourceIndex,
    name: name.slice(0, 160),
    sku: sku.slice(0, 60),
    slug,
    price: Math.round(price * 100) / 100,
    comparePrice: comparePrice === null ? null : Math.round(comparePrice * 100) / 100,
    brandName: asString(raw.marca ?? raw.brand),
    categoryName: asString(raw.categoria ?? raw.category),
    volume: asString(raw.volume),
    weightGrams: weight !== null && weight >= 0 ? Math.round(weight) : null,
    description: asString(raw.descricao ?? raw.description),
    imageUrls: [...new Set(imageList)].slice(0, 12),
  };
}

export function normalizeCatalogSource(raw: unknown): { valid: NormalizedItem[]; invalid: InvalidItem[] } {
  if (!Array.isArray(raw)) return { valid: [], invalid: [{ sourceIndex: -1, reason: "A fonte não é uma lista." }] };

  const valid: NormalizedItem[] = [];
  const invalid: InvalidItem[] = [];

  raw.forEach((entry, index) => {
    const result = normalizeItem((entry ?? {}) as CatalogSourceItem, index);
    if ("reason" in result) invalid.push(result);
    else valid.push(result);
  });

  return { valid, invalid };
}

/**
 * Planeja a importação: o que criar, o que atualizar e o que é duplicado.
 * Não toca no banco.
 */
export function planCatalogImport(
  items: NormalizedItem[],
  existing: ExistingProduct[],
): ImportPlan {
  const bySku = new Map(existing.map((p) => [p.sku.toLowerCase(), p]));
  const bySlug = new Map(existing.map((p) => [p.slug.toLowerCase(), p]));
  const byName = new Map(existing.map((p) => [p.name.trim().toLowerCase(), p]));

  const seenSku = new Set<string>();
  const seenSlug = new Set<string>();
  const seenName = new Set<string>();

  const toCreate: NormalizedItem[] = [];
  const toUpdate: PlannedUpdate[] = [];
  const duplicates: ImportPlan["duplicates"] = [];

  for (const item of items) {
    const skuKey = item.sku.toLowerCase();
    const slugKey = item.slug.toLowerCase();
    const nameKey = item.name.toLowerCase();

    if (seenSku.has(skuKey) || seenSlug.has(slugKey) || seenName.has(nameKey)) {
      duplicates.push({ item, reason: "Duplicado dentro da própria fonte." });
      continue;
    }
    seenSku.add(skuKey);
    seenSlug.add(slugKey);
    seenName.add(nameKey);

    const match = bySku.get(skuKey) ?? bySlug.get(slugKey) ?? byName.get(nameKey);
    if (!match) {
      toCreate.push(item);
      continue;
    }

    const changes: string[] = [];
    let priceDivergent = false;
    if (Math.abs(match.price - item.price) > 0.001) {
      changes.push(`preco: ${match.price.toFixed(2)} -> ${item.price.toFixed(2)}`);
      priceDivergent = true;
    }
    if (match.name.trim() !== item.name.trim()) changes.push("nome");
    if (changes.length > 0) toUpdate.push({ item, existing: match, changes, priceDivergent });
  }

  return {
    toCreate,
    toUpdate,
    duplicates,
    invalid: [],
    summary: {
      total: items.length,
      valid: items.length,
      toCreate: toCreate.length,
      toUpdate: toUpdate.length,
      duplicates: duplicates.length,
      invalid: 0,
      priceDivergent: toUpdate.filter((entry) => entry.priceDivergent).length,
    },
  };
}
