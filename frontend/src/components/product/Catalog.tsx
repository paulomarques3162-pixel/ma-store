import { useState } from "react";
import { Badge, Button, Checkbox, Icon, Input, ProductImage } from "@/components/ui";
import { formatCurrency } from "@/lib/format";

/**
 * Galeria da página do produto.
 * Sem imagem cadastrada, mostra o placeholder do projeto.
 */
export function ProductGallery({
  images,
  name,
}: {
  images: Array<{ url: string; alt?: string | null; focalPoint?: string | null }>;
  name: string;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const safeImages = images.length > 0 ? images : [{ url: "/placeholder-product.svg", alt: name }];
  const active = safeImages[activeIndex] ?? safeImages[0]!;

  return (
    <div className="gallery">
      <div className="gallery__main">
        <ProductImage
          src={active.url}
          alt={active.alt ?? name}
          loading="eager"
          aspectRatio="1 / 1"
          objectPosition={active.focalPoint}
        />
      </div>

      {safeImages.length > 1 ? (
        <div className="gallery__thumbs" role="tablist" aria-label="Imagens do produto">
          {safeImages.map((image, index) => (
            <button
              key={`${image.url}-${index}`}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={`Imagem ${index + 1} de ${safeImages.length}`}
              className={["gallery__thumb", index === activeIndex ? "gallery__thumb--active" : ""].filter(Boolean).join(" ")}
              onClick={() => setActiveIndex(index)}
            >
              <img src={image.url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ========================================================================== */
/* Filtros da vitrine                                                          */
/* ========================================================================== */

export type CatalogFilterState = {
  categories: string[];
  brands: string[];
  volumes: string[];
  minPrice: string;
  maxPrice: string;
  inStock: boolean;
  onSale: boolean;
};

export const EMPTY_FILTERS: CatalogFilterState = {
  categories: [],
  brands: [],
  volumes: [],
  minPrice: "",
  maxPrice: "",
  inStock: false,
  onSale: false,
};

function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * Painel de filtros da vitrine.
 * Os valores disponíveis (categorias, marcas, volumes, faixa de preço) vêm
 * SEMPRE do catálogo real — nunca de uma lista fixa inventada.
 */
export function CatalogFilters({
  state,
  onChange,
  categories,
  brands,
  volumes,
  priceRange,
  onClear,
}: {
  state: CatalogFilterState;
  onChange: (state: CatalogFilterState) => void;
  categories: Array<{ id: string; name: string; slug: string; productCount?: number }>;
  brands: Array<{ id: string; name: string; slug: string; productCount?: number }>;
  volumes: string[];
  priceRange: { min: number | null; max: number | null };
  onClear: () => void;
}) {
  const hasAny =
    state.categories.length > 0 ||
    state.brands.length > 0 ||
    state.volumes.length > 0 ||
    state.minPrice !== "" ||
    state.maxPrice !== "" ||
    state.inStock ||
    state.onSale;

  return (
    <aside className="filters" aria-label="Filtros">
      <div className="row row-between">
        <strong>Filtros</strong>
        {hasAny ? (
          <button type="button" className="btn btn--link btn--sm" onClick={onClear}>
            Limpar
          </button>
        ) : null}
      </div>

      {categories.length > 0 ? (
        <fieldset className="filters__group">
          <legend className="filters__legend">Categoria</legend>
          <div className="filters__options">
            {categories.map((category) => (
              <Checkbox
                key={category.id}
                label={
                  <span className="row row-between" style={{ width: "100%" }}>
                    <span>{category.name}</span>
                    {category.productCount !== undefined ? <span className="text-xs text-subtle">{category.productCount}</span> : null}
                  </span>
                }
                checked={state.categories.includes(category.slug)}
                onChange={() => onChange({ ...state, categories: toggleValue(state.categories, category.slug) })}
              />
            ))}
          </div>
        </fieldset>
      ) : null}

      {brands.length > 0 ? (
        <fieldset className="filters__group">
          <legend className="filters__legend">Marca</legend>
          <div className="filters__options">
            {brands.map((brand) => (
              <Checkbox
                key={brand.id}
                label={brand.name}
                checked={state.brands.includes(brand.slug)}
                onChange={() => onChange({ ...state, brands: toggleValue(state.brands, brand.slug) })}
              />
            ))}
          </div>
        </fieldset>
      ) : null}

      {volumes.length > 0 ? (
        <fieldset className="filters__group">
          <legend className="filters__legend">Volume</legend>
          <div className="filters__options">
            {volumes.map((volume) => (
              <Checkbox
                key={volume}
                label={volume}
                checked={state.volumes.includes(volume)}
                onChange={() => onChange({ ...state, volumes: toggleValue(state.volumes, volume) })}
              />
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset className="filters__group">
        <legend className="filters__legend">Preço</legend>
        <div className="price-range">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder={priceRange.min !== null ? String(Math.floor(priceRange.min)) : "Mín."}
            value={state.minPrice}
            onChange={(event) => onChange({ ...state, minPrice: event.target.value })}
            aria-label="Preço mínimo"
          />
          <span className="text-subtle">—</span>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder={priceRange.max !== null ? String(Math.ceil(priceRange.max)) : "Máx."}
            value={state.maxPrice}
            onChange={(event) => onChange({ ...state, maxPrice: event.target.value })}
            aria-label="Preço máximo"
          />
        </div>
        {priceRange.min !== null && priceRange.max !== null ? (
          <p className="field__hint">
            Faixa atual: {formatCurrency(priceRange.min)} – {formatCurrency(priceRange.max)}
          </p>
        ) : null}
      </fieldset>

      <fieldset className="filters__group">
        <legend className="filters__legend">Disponibilidade</legend>
        <Checkbox
          label="Somente produtos em estoque"
          checked={state.inStock}
          onChange={(event) => onChange({ ...state, inStock: event.target.checked })}
        />
        <Checkbox
          label="Somente em promoção"
          checked={state.onSale}
          onChange={(event) => onChange({ ...state, onSale: event.target.checked })}
        />
      </fieldset>
    </aside>
  );
}

/** Chips dos filtros ativos (removíveis individualmente). */
export function ActiveFilters({
  state,
  onChange,
  categories,
  brands,
}: {
  state: CatalogFilterState;
  onChange: (state: CatalogFilterState) => void;
  categories: Array<{ name: string; slug: string }>;
  brands: Array<{ name: string; slug: string }>;
}) {
  const chips: Array<{ key: string; label: string; remove: () => void }> = [];

  for (const slug of state.categories) {
    const name = categories.find((category) => category.slug === slug)?.name ?? slug;
    chips.push({ key: `c-${slug}`, label: name, remove: () => onChange({ ...state, categories: state.categories.filter((s) => s !== slug) }) });
  }
  for (const slug of state.brands) {
    const name = brands.find((brand) => brand.slug === slug)?.name ?? slug;
    chips.push({ key: `b-${slug}`, label: name, remove: () => onChange({ ...state, brands: state.brands.filter((s) => s !== slug) }) });
  }
  for (const volume of state.volumes) {
    chips.push({ key: `v-${volume}`, label: volume, remove: () => onChange({ ...state, volumes: state.volumes.filter((s) => s !== volume) }) });
  }
  if (state.minPrice || state.maxPrice) {
    chips.push({
      key: "price",
      label: `${state.minPrice ? formatCurrency(Number(state.minPrice)) : "—"} a ${state.maxPrice ? formatCurrency(Number(state.maxPrice)) : "—"}`,
      remove: () => onChange({ ...state, minPrice: "", maxPrice: "" }),
    });
  }
  if (state.inStock) chips.push({ key: "stock", label: "Em estoque", remove: () => onChange({ ...state, inStock: false }) });
  if (state.onSale) chips.push({ key: "sale", label: "Em promoção", remove: () => onChange({ ...state, onSale: false }) });

  if (chips.length === 0) return null;

  return (
    <div className="active-filters">
      {chips.map((chip) => (
        <Badge key={chip.key} tone="accent">
          {chip.label}
          <button type="button" onClick={chip.remove} aria-label={`Remover filtro ${chip.label}`} style={{ marginLeft: 4, display: "inline-flex" }}>
            <Icon name="close" size={12} />
          </button>
        </Badge>
      ))}
    </div>
  );
}

/** Botão que abre os filtros em drawer no mobile. */
export function FiltersButton({ onClick, count }: { onClick: () => void; count: number }) {
  return (
    <Button variant="ghost" size="sm" icon="filter" onClick={onClick} className="hide-desktop">
      Filtros {count > 0 ? <Badge tone="accent">{count}</Badge> : null}
    </Button>
  );
}
