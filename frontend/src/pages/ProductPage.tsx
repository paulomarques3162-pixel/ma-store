import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Breadcrumbs,
  Button,
  Card,
  ErrorState,
  Icon,
  LoadingBlock,
  ProductImage,
  QuantitySelector,
  Rating,
  Skeleton,
  StockIndicator,
  UnavailableNotice,
} from "@/components/ui";
import { ProductGallery } from "@/components/product/Catalog";
import { ProductGrid } from "@/components/product/ProductCard";
import {
  useAddToCart,
  useContent,
  useProduct,
  useProductReviews,
  useRelatedProducts,
  useToast,
} from "@/hooks";
import { useUiStore } from "@/stores/ui";
import { productToGuestSnapshot } from "@/stores/cart";
import { CONTENT_KEYS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { buildProductShare, shareOrCopy } from "@/lib/share";
import { errorMessage, errorRequestId } from "@/lib/api";
import { formatCurrency, formatDate, formatInstallments } from "@/lib/format";

export default function ProductPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const openCartDrawer = useUiStore((s) => s.openCartDrawer);

  const { data: product, isLoading, error, refetch } = useProduct(slug);
  const { data: related } = useRelatedProducts(slug);
  const { data: reviews } = useProductReviews(slug);
  const addToCart = useAddToCart();
  const { get } = useContent();

  const [quantity, setQuantity] = useState(1);
  const [adding, setAdding] = useState(false);

  const maxInstallments = Number(get(CONTENT_KEYS.maxInstallments) ?? 0) || null;
  const minInstallment = Number(get(CONTENT_KEYS.installmentMinValue) ?? 0) || null;

  useEffect(() => {
    if (!product) return;

    // Dados estruturados SOMENTE com informação real do produto.
    const jsonLd: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.name,
      sku: product.sku,
      description: product.shortDescription ?? product.description ?? undefined,
      brand: product.brand?.name ? { "@type": "Brand", name: product.brand.name } : undefined,
      offers: {
        "@type": "Offer",
        price: product.price,
        priceCurrency: "BRL",
        availability: product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      },
    };

    // AggregateRating só é enviado quando existem avaliações reais.
    if (reviews && reviews.total > 0) {
      jsonLd.aggregateRating = { "@type": "AggregateRating", ratingValue: reviews.average, reviewCount: reviews.total };
    }

    applySeo({
      title: product.metaTitle ?? product.name,
      description: product.metaDescription ?? product.shortDescription ?? null,
      image: product.images[0]?.url ?? null,
      canonicalPath: `/produto/${product.slug}`,
      type: "product",
      jsonLd,
    });
  }, [product, reviews]);

  useEffect(() => {
    setQuantity(1);
  }, [slug]);

  if (isLoading) return <LoadingBlock label="Carregando produto…" />;

  if (error || !product) {
    return (
      <div className="container py-8">
        <ErrorState
          title="Produto não encontrado"
          message={errorMessage(error) || "Este produto pode ter sido removido ou desativado."}
          requestId={errorRequestId(error)}
          onRetry={() => void refetch()}
        />
        <div className="text-center">
          <Link to="/produtos" className="btn btn--ghost">
            Ver todos os produtos
          </Link>
        </div>
      </div>
    );
  }

  const available = product.stock > 0;
  const installments = formatInstallments(product.price, maxInstallments, minInstallment);

  const handleAddToCart = () => {
    if (!available) return;

    // Guest Checkout: adicionar ao carrinho NAO exige conta.
    setAdding(true);
    addToCart.mutate(
      { productId: product.id, quantity, product: productToGuestSnapshot(product) },
      {
        onSuccess: () => {
          toast.success("Adicionado ao carrinho", `${quantity}x ${product.name}`);
          openCartDrawer();
        },
        onError: (mutationError) => toast.error("Não foi possível adicionar", errorMessage(mutationError)),
        onSettled: () => setAdding(false),
      },
    );
  };

  const handleBuyNow = () => {
    if (!available) return;
    setAdding(true);
    addToCart.mutate(
      { productId: product.id, quantity, product: productToGuestSnapshot(product) },
      {
        onSuccess: () => navigate("/checkout"),
        onError: (mutationError) => {
          toast.error("Não foi possível continuar", errorMessage(mutationError));
          setAdding(false);
        },
      },
    );
  };

  const share = async () => {
    const result = await shareOrCopy(buildProductShare(product));
    if (result === "copied") toast.success("Link copiado!", "Cole onde quiser para compartilhar o produto.");
    else if (result === "failed") toast.error("Não foi possível compartilhar", "Copie o endereço do navegador.");
  };

  return (
    <div className="container">
      <Breadcrumbs
        items={[
          { label: "Início", to: "/" },
          { label: "Produtos", to: "/produtos" },
          ...(product.category ? [{ label: product.category.name, to: `/categoria/${product.category.slug}` }] : []),
          { label: product.name },
        ]}
      />

      <div className="product-detail">
        <ProductGallery images={product.images} name={product.name} />

        <div className="product-info">
          {product.brand?.name ? <span className="product-card__brand">{product.brand.name}</span> : null}

          <h1 className="product-info__title">{product.name}</h1>

          {reviews && reviews.total > 0 ? (
            <div className="row row-3">
              <Rating value={reviews.average} showValue />
              <span className="text-sm text-muted">
                {reviews.total} {reviews.total === 1 ? "avaliação" : "avaliações"}
              </span>
            </div>
          ) : null}

          <div className="product-info__meta">
            {product.volume ? <span>Volume: {product.volume}</span> : null}
            <span>SKU: {product.sku}</span>
            {product.category ? <span>Categoria: {product.category.name}</span> : null}
          </div>

          <div className="product-info__price">
            {product.comparePrice && product.comparePrice > product.price ? (
              <span className="price__from">{formatCurrency(product.comparePrice)}</span>
            ) : null}
            <span className="price__value">{formatCurrency(product.price)}</span>
            {installments ? <span className="price__installments">{installments}</span> : null}
            <StockIndicator stock={product.stock} minStock={product.minStock ?? 0} />
          </div>

          {!available ? <UnavailableNotice /> : null}

          {product.shortDescription ? <p className="text-muted">{product.shortDescription}</p> : null}

          {available ? (
            <div className="stack stack-3">
              <div className="row row-3 row-wrap">
                <QuantitySelector value={quantity} onChange={setQuantity} max={product.stock} disabled={adding} />
                <Button size="lg" onClick={handleAddToCart} loading={adding} icon="cart" style={{ flex: 1 }}>
                  Adicionar ao carrinho
                </Button>
              </div>
              <Button size="lg" variant="accent" block onClick={handleBuyNow} loading={adding} iconRight="arrowRight">
                Comprar agora
              </Button>
            </div>
          ) : (
            <Alert tone="warning" title="Produto indisponível">
              Este item está sem estoque no momento. Fale com o atendimento para saber sobre a reposição.
            </Alert>
          )}

          <div className="row row-3 row-wrap">
            <Button variant="ghost" size="sm" onClick={() => void share()} icon="link">
              Compartilhar
            </Button>
            <Link to="/rastreio" className="btn btn--ghost btn--sm">
              <Icon name="package" size={16} /> Acompanhar pedido
            </Link>
          </div>

          <div className="spec-list">
            <div className="spec-list__row">
              <span className="spec-list__label">Disponibilidade</span>
              <span className="spec-list__value">{available ? `${product.stock} em estoque` : "Indisponível"}</span>
            </div>
            {product.volume ? (
              <div className="spec-list__row">
                <span className="spec-list__label">Volume</span>
                <span className="spec-list__value">{product.volume}</span>
              </div>
            ) : null}
            <div className="spec-list__row">
              <span className="spec-list__label">Frete</span>
              <span className="spec-list__value">{product.hasShipping ? "Calculado no checkout" : "Não se aplica"}</span>
            </div>
            <div className="spec-list__row">
              <span className="spec-list__label">Cupom</span>
              <span className="spec-list__value">{product.allowCoupon ? "Aceita cupom" : "Não aceita cupom"}</span>
            </div>
          </div>

          {product.description ? (
            <Card>
              <h2 className="text-lg mb-4">Descrição</h2>
              <p className="product-info__description">{product.description}</p>
            </Card>
          ) : null}
        </div>
      </div>

      {/* ------------------------------------------------------- AVALIAÇÕES */}
      <section className="mt-12">
        <div className="section-header">
          <h2 className="section-header__title">Avaliações</h2>
        </div>

        {reviews && reviews.total > 0 ? (
          <Card>
            {reviews.items.map((review) => (
              <article key={review.id} className="review-item">
                <div className="review-item__head">
                  <div className="row row-3">
                    <Rating value={review.rating} />
                    <span className="review-item__author">{review.author}</span>
                  </div>
                  <span className="review-item__date">{formatDate(review.createdAt)}</span>
                </div>
                {review.title ? <strong>{review.title}</strong> : null}
                {review.comment ? <p className="review-item__comment">{review.comment}</p> : null}
              </article>
            ))}
          </Card>
        ) : (
          <Card>
            <p className="text-muted">
              Este produto ainda não tem avaliações publicadas. Só quem comprou pode avaliar, e as avaliações passam
              por moderação antes de aparecer aqui.
            </p>
          </Card>
        )}
      </section>

      {/* ------------------------------------------------------ RELACIONADOS */}
      {related && related.length > 0 ? (
        <section className="mt-12">
          <div className="section-header">
            <h2 className="section-header__title">Você também pode gostar</h2>
          </div>
          <ProductGrid products={related.slice(0, 5)} />
        </section>
      ) : null}

      <div style={{ height: "var(--space-12)" }} />
    </div>
  );
}

export { Skeleton, ProductImage };
