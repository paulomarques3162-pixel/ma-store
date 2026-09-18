import { useEffect } from "react";
import { Breadcrumbs, Button, EmptyState, ErrorState, SkeletonProductGrid } from "@/components/ui";
import { ProductGrid } from "@/components/product/ProductCard";
import { useFavorites } from "@/hooks";
import { EMPTY_MESSAGES } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { errorMessage, errorRequestId } from "@/lib/api";

export default function FavoritesPage() {
  const favorites = useFavorites();

  useEffect(() => {
    applySeo({ title: "Favoritos", noindex: true, canonicalPath: "/favoritos" });
  }, []);

  const products = (favorites.data ?? []).map((favorite) => favorite.product);

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Favoritos" }]} />

      <div className="page-header">
        <div>
          <h1 className="page-header__title">Favoritos</h1>
          <p className="page-header__subtitle">Os produtos que você marcou para acompanhar.</p>
        </div>
      </div>

      {favorites.isLoading ? (
        <SkeletonProductGrid count={4} />
      ) : favorites.error ? (
        <ErrorState
          message={errorMessage(favorites.error)}
          requestId={errorRequestId(favorites.error)}
          onRetry={() => void favorites.refetch()}
        />
      ) : products.length === 0 ? (
        <EmptyState
          icon="heart"
          title={EMPTY_MESSAGES.favorites.title}
          text={EMPTY_MESSAGES.favorites.text}
          action={
            <Button onClick={() => window.location.assign("/produtos")} icon="grid">
              Ver produtos
            </Button>
          }
        />
      ) : (
        <ProductGrid products={products} />
      )}

      <div style={{ height: "var(--space-12)" }} />
    </div>
  );
}
