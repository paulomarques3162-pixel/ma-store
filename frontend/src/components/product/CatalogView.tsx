import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Button,
  Drawer,
  EmptyState,
  Select,
  SkeletonProductGrid,
  ErrorState,
} from "@/components/ui";
import {
  ActiveFilters,
  CatalogFilters,
  EMPTY_FILTERS,
  type CatalogFilterState,
} from "@/components/product/Catalog";
import { ProductGrid } from "@/components/product/ProductCard";
import { useBrands, useCategories, useFacets, useProductsInfinite } from "@/hooks";
import { SORT_OPTIONS } from "@/lib/constants";
import type { Product } from "@/types/api";
import { errorMessage, errorRequestId } from "@/lib/api";

/**
 * Vitrine reutilizável (produtos, categoria e busca).
 *
 * - Filtros, ordenação e página vivem na URL: o usuário pode compartilhar o
 *   link e voltar pelo histórico do navegador.
 * - Os filtros disponíveis vêm do catálogo real (categorias, marcas, volumes,
 *   faixa de preço) — nada de lista fixa inventada.
 * - Uma única requisição por mudança de filtro (sem chamadas duplicadas).
 * - Carregamento PROGRESSIVO: 12 produtos por vez; "Carregar mais" anexa a
 *   próxima página sem perder filtros, ordenação nem a posição do scroll.
 */
export function CatalogView({
  title,
  subtitle,
  lockedCategory,
  initialSearch = "",
  header,
}: {
  title: string;
  subtitle?: string;
  /** Quando a categoria vem da rota, o filtro de categoria é fixado. */
  lockedCategory?: string;
  initialSearch?: string;
  header?: React.ReactNode;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data: categories } = useCategories();
  const { data: brands } = useBrands();
  const { data: facets } = useFacets();

  const search = initialSearch || searchParams.get("q") || "";
  const sort = searchParams.get("sort") ?? "newest";
  const page = Number(searchParams.get("page") ?? "1") || 1;

  const [state, setState] = useState<CatalogFilterState>(() => ({
    ...EMPTY_FILTERS,
    categories: lockedCategory ? [lockedCategory] : searchParams.get("cat")?.split(",").filter(Boolean) ?? [],
    brands: searchParams.get("brand")?.split(",").filter(Boolean) ?? [],
    volumes: searchParams.get("volume")?.split(",").filter(Boolean) ?? [],
    minPrice: searchParams.get("min") ?? "",
    maxPrice: searchParams.get("max") ?? "",
    inStock: searchParams.get("inStock") === "true",
    onSale: searchParams.get("onSale") === "true",
  }));

  // Sincroniza os filtros com a URL (sem recarregar a página).
  useEffect(() => {
    const next = new URLSearchParams(searchParams);

    const setOrDelete = (key: string, value: string | undefined) => {
      if (value) next.set(key, value);
      else next.delete(key);
    };

    setOrDelete("cat", lockedCategory ? undefined : state.categories.join(",") || undefined);
    setOrDelete("brand", state.brands.join(",") || undefined);
    setOrDelete("volume", state.volumes.join(",") || undefined);
    setOrDelete("min", state.minPrice || undefined);
    setOrDelete("max", state.maxPrice || undefined);
    setOrDelete("inStock", state.inStock ? "true" : undefined);
    setOrDelete("onSale", state.onSale ? "true" : undefined);

    if (next.toString() !== searchParams.toString()) {
      next.delete("page");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, lockedCategory]);

  // Busca combinada: a API aceita um único `category`/`brand`, então quando há
  // mais de um selecionado filtramos no cliente sobre o resultado paginado.
  const primaryCategory = lockedCategory ?? state.categories[0];
  const primaryBrand = state.brands[0];

  const query = useProductsInfinite(
    {
      search: search || undefined,
      category: primaryCategory,
      brand: primaryBrand,
      volume: state.volumes[0],
      minPrice: state.minPrice ? Number(state.minPrice) : undefined,
      maxPrice: state.maxPrice ? Number(state.maxPrice) : undefined,
      inStock: state.inStock || undefined,
      onSale: state.onSale || undefined,
      sort,
    },
    page,
  );

  // Produtos de TODAS as páginas já carregadas, sem duplicatas. A dedupe por
  // id protege contra um produto que mude de página entre duas requisições
  // (ex.: alteração de estoque/preço feita pelo admin no meio da navegação).
  const loadedProducts = useMemo(() => {
    const pages = query.data?.pages ?? [];
    const seen = new Set<string>();
    const items: Product[] = [];
    for (const pageResult of pages) {
      for (const product of pageResult.data ?? []) {
        if (seen.has(product.id)) continue;
        seen.add(product.id);
        items.push(product);
      }
    }
    return items;
  }, [query.data]);

  // Filtros adicionais (2ª categoria/marca/volume) aplicados localmente.
  const products = useMemo(() => {
    const items = loadedProducts;
    return items.filter((product) => {
      if (!lockedCategory && state.categories.length > 1) {
        if (!product.category || !state.categories.includes(product.category.slug)) return false;
      }
      if (state.brands.length > 1) {
        if (!product.brand || !state.brands.includes(product.brand.slug)) return false;
      }
      if (state.volumes.length > 1) {
        if (!product.volume || !state.volumes.includes(product.volume)) return false;
      }
      return true;
    });
  }, [loadedProducts, state, lockedCategory]);

  // Erro ao anexar a próxima página (a lista já carregada permanece na tela).
  // Derivado ANTES do JSX para não colidir com o narrowing do estado da query.
  const nextPageFailed: boolean = query.isFetchNextPageError;
  const nextPageError: unknown = query.error;

  const firstMeta = query.data?.pages[0]?.meta;
  const lastMeta = query.data?.pages[query.data.pages.length - 1]?.meta;
  const meta = lastMeta ?? firstMeta;
  const activeFilterCount =
    state.categories.length + state.brands.length + state.volumes.length + (state.minPrice || state.maxPrice ? 1 : 0) + (state.inStock ? 1 : 0) + (state.onSale ? 1 : 0);

  /**
   * Carrega a próxima página anexando ao final da lista (sem trocar de tela e
   * sem empilhar entradas no histórico do navegador).
   *
   * O React Query garante que apenas a consulta ATUAL vale: se o usuário mudar
   * de filtro/ordenação no meio do carregamento, a resposta antiga é
   * descartada pela chave da consulta — ela nunca sobrescreve a lista nova.
   */
  const loadMore = async () => {
    await query.fetchNextPage();
  };

  const updateSort = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value === "newest") next.delete("sort");
    else next.set("sort", value);
    next.delete("page");
    setSearchParams(next);
  };

  const filtersPanel = (
    <CatalogFilters
      state={state}
      onChange={(next) => {
        setState(next);
        setFiltersOpen(false);
      }}
      categories={categories ?? []}
      brands={brands ?? []}
      volumes={facets?.volumes ?? []}
      priceRange={{ min: facets?.priceMin ?? null, max: facets?.priceMax ?? null }}
      onClear={() => setState({ ...EMPTY_FILTERS, categories: lockedCategory ? [lockedCategory] : [] })}
    />
  );

  return (
    <div className="container">
      <div className="page-header">
        <div>
          <h1 className="page-header__title">{title}</h1>
          {subtitle ? <p className="page-header__subtitle">{subtitle}</p> : null}
        </div>
        {header}
      </div>

      <div className="catalog-layout">
        <div className="filters--desktop">{filtersPanel}</div>

        <div>
          <div className="toolbar">
            <span className="toolbar__count">
              {meta ? `${meta.total} ${meta.total === 1 ? "produto" : "produtos"}` : "Carregando…"}
            </span>

            <div className="toolbar__actions">
              <Button variant="ghost" size="sm" icon="filter" onClick={() => setFiltersOpen(true)} className="hide-desktop">
                Filtros {activeFilterCount > 0 ? `(${activeFilterCount})` : ""}
              </Button>

              <Select
                aria-label="Ordenar por"
                value={sort}
                onChange={(event) => updateSort(event.target.value)}
                options={SORT_OPTIONS.map((option) => ({ value: option.value, label: `Ordenar: ${option.label}` }))}
              />
            </div>
          </div>

          <ActiveFilters state={state} onChange={setState} categories={categories ?? []} brands={brands ?? []} />

          {query.isLoading ? (
            <SkeletonProductGrid count={12} />
          ) : query.isError ? (
            <ErrorState
              message={errorMessage(query.error)}
              requestId={errorRequestId(query.error)}
              onRetry={() => void query.refetch()}
            />
          ) : products.length === 0 ? (
            <EmptyState
              icon="search"
              title="Nenhum produto encontrado"
              text="Tente ajustar a busca ou remover alguns filtros."
              action={
                <Button
                  variant="ghost"
                  onClick={() => setState({ ...EMPTY_FILTERS, categories: lockedCategory ? [lockedCategory] : [] })}
                >
                  Limpar filtros
                </Button>
              }
            />
          ) : (
            <>
              <ProductGrid products={products} priorityCount={4} />

              <div className="catalog-more">
                {query.hasNextPage ? (
                  <>
                    <Button
                      variant="ghost"
                      onClick={() => void loadMore()}
                      loading={query.isFetchingNextPage}
                      icon="chevronDown"
                    >
                      Carregar mais produtos
                    </Button>
                    {meta ? (
                      <p className="catalog-more__hint">
                        Mostrando {products.length} de {meta.total} produtos
                      </p>
                    ) : null}
                  </>
                ) : meta ? (
                  <p className="catalog-more__hint">
                    {meta.total === 0
                      ? "Nenhum produto para exibir."
                      : `Você viu todos os ${meta.total} ${meta.total === 1 ? "produto" : "produtos"}.`}
                  </p>
                ) : null}

                {nextPageFailed ? (
                  <div className="mt-2">
                    <ErrorState
                      message={errorMessage(nextPageError)}
                      onRetry={() => void loadMore()}
                    />
                  </div>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      <Drawer open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Filtros" side="left" footer={<Button block onClick={() => setFiltersOpen(false)}>Aplicar</Button>}>
        {filtersPanel}
      </Drawer>
    </div>
  );
}
