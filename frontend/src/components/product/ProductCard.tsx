import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Badge, Button, Icon, ProductImage, StockIndicator } from "@/components/ui";
import { useAddToCart, useFavoriteIds, useToggleFavorite, useToast } from "@/hooks";
import { useAuthStore } from "@/stores/auth";
import { useUiStore } from "@/stores/ui";
import { CONTENT_KEYS } from "@/lib/constants";
import { errorMessage } from "@/lib/api";
import { discountPercent, formatCurrency, formatInstallments } from "@/lib/format";
import { useContent } from "@/hooks";
import type { Product } from "@/types/api";

/** Lê a configuração de parcelamento da loja (pode não existir). */
function useInstallmentConfig() {
  const { get } = useContent();
  const rawMax = get(CONTENT_KEYS.maxInstallments);
  const rawMin = get(CONTENT_KEYS.installmentMinValue);

  const maxInstallments = rawMax ? Number(rawMax) : null;
  const minInstallmentValue = rawMin ? Number(rawMin) : null;

  return {
    maxInstallments: Number.isFinite(maxInstallments) ? maxInstallments : null,
    minInstallmentValue: Number.isFinite(minInstallmentValue) ? minInstallmentValue : null,
  };
}

/**
 * Card de produto da vitrine.
 *
 * Regras aplicadas:
 *  - sem imagem cadastrada -> placeholder elegante (nunca foto inventada);
 *  - sem estoque -> botão desabilitado com rótulo "Produto indisponível";
 *  - parcelamento só aparece se a loja tiver configurado;
 *  - favoritar exige sessão (leva ao login quando não há).
 */
export function ProductCard({ product, priority = false }: { product: Product; priority?: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const status = useAuthStore((s) => s.status);
  const openCartDrawer = useUiStore((s) => s.openCartDrawer);
  const { ids: favoriteIds } = useFavoriteIds();
  const toggleFavorite = useToggleFavorite();
  const addToCart = useAddToCart();
  const { maxInstallments, minInstallmentValue } = useInstallmentConfig();

  const [busy, setBusy] = useState(false);
  const isAuthenticated = status === "authenticated";
  const isFavorite = favoriteIds.has(product.id);
  const available = product.stock > 0;
  const off = discountPercent(product.price, product.comparePrice);
  const installments = formatInstallments(product.price, maxInstallments, minInstallmentValue);

  const handleAddToCart = () => {
    if (!available || busy) return;

    if (!isAuthenticated) {
      navigate("/login", { state: { from: `/produto/${product.slug}` } });
      return;
    }

    setBusy(true);
    addToCart.mutate(
      { productId: product.id, quantity: 1 },
      {
        onSuccess: () => {
          toast.success("Adicionado ao carrinho", product.name);
          openCartDrawer();
        },
        onError: (error) => toast.error("Não foi possível adicionar", errorMessage(error)),
        onSettled: () => setBusy(false),
      },
    );
  };

  const handleFavorite = () => {
    if (!isAuthenticated) {
      navigate("/login", { state: { from: `/produto/${product.slug}` } });
      return;
    }
    toggleFavorite.mutate(
      { productId: product.id, favorite: !isFavorite },
      {
        onSuccess: () =>
          toast.success(isFavorite ? "Removido dos favoritos" : "Adicionado aos favoritos", product.name),
        onError: (error) => toast.error("Não foi possível atualizar", errorMessage(error)),
      },
    );
  };

  return (
    <article className={["product-card", available ? "" : "product-card--unavailable"].filter(Boolean).join(" ")}>
      <Link to={`/produto/${product.slug}`} className="product-card__media" aria-label={product.name}>
        <ProductImage
          src={product.images[0]?.url}
          alt={product.name}
          loading={priority ? "eager" : "lazy"}
          aspectRatio="1 / 1"
        />

        <span className="product-card__badges">
          {off ? <Badge tone="accent">{off}% off</Badge> : null}
          {product.isLaunch ? <Badge tone="info">Lançamento</Badge> : null}
          {product.isBestSeller ? <Badge tone="success">Mais vendido</Badge> : null}
          {!available ? <Badge tone="danger">Indisponível</Badge> : null}
        </span>
      </Link>

      <button
        type="button"
        className={["product-card__favorite", isFavorite ? "product-card__favorite--on" : ""].filter(Boolean).join(" ")}
        onClick={handleFavorite}
        aria-label={isFavorite ? `Remover ${product.name} dos favoritos` : `Adicionar ${product.name} aos favoritos`}
        aria-pressed={isFavorite}
      >
        <Icon name={isFavorite ? "starFilled" : "heart"} size={17} filled={isFavorite} />
      </button>

      <div className="product-card__body">
        {product.brand?.name ? <span className="product-card__brand">{product.brand.name}</span> : null}

        <Link to={`/produto/${product.slug}`} className="product-card__name clamp-2">
          {product.name}
        </Link>

        {product.volume ? <span className="product-card__meta">{product.volume}</span> : null}

        <div className="product-card__price-row">
          <div className="price">
            {product.comparePrice && off ? (
              <div className="price__labels">
                <span className="price__from">{formatCurrency(product.comparePrice)}</span>
              </div>
            ) : null}
            <span className={["price__value", off ? "price__value--promo" : ""].filter(Boolean).join(" ")}>
              {formatCurrency(product.price)}
            </span>
            {installments ? <span className="price__installments">{installments}</span> : null}
          </div>
        </div>

        <StockIndicator stock={product.stock} minStock={product.minStock ?? 0} />

        <div className="product-card__actions">
          <Button
            variant={available ? "primary" : "subtle"}
            size="sm"
            onClick={handleAddToCart}
            disabled={!available}
            loading={busy}
            icon={available ? "cart" : "xCircle"}
          >
            {available ? "Comprar" : "Produto indisponível"}
          </Button>
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ products, priorityCount = 4 }: { products: Product[]; priorityCount?: number }) {
  return (
    <div className="product-grid">
      {products.map((product, index) => (
        <ProductCard key={product.id} product={product} priority={index < priorityCount} />
      ))}
    </div>
  );
}
