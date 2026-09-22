import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Alert,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  LoadingBlock,
  Skeleton,
} from "@/components/ui";
import { CartLine, CartSummary, CouponForm } from "@/components/cart/Cart";
import {
  useCart,
  useClearCart,
  useRemoveCartItem,
  useUpdateCartItem,
  useValidateCoupon,
  useToast,
} from "@/hooks";
import { EMPTY_MESSAGES } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { errorMessage, errorRequestId } from "@/lib/api";

export default function CartPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const { data: cart, isLoading, error, refetch } = useCart();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();
  const clearCart = useClearCart();
  const validateCoupon = useValidateCoupon();

  const [coupon, setCoupon] = useState<{ code: string; discount: number; shippingDiscount: number } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);

  useEffect(() => {
    applySeo({ title: "Carrinho", noindex: true, canonicalPath: "/carrinho" });
  }, []);

  if (isLoading) return <LoadingBlock label="Carregando carrinho…" />;

  if (error) {
    return (
      <div className="container py-8">
        <ErrorState
          message={errorMessage(error)}
          requestId={errorRequestId(error)}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  const items = cart?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="container">
        <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Carrinho" }]} />
        <EmptyState
          icon="cart"
          title={EMPTY_MESSAGES.cart.title}
          text={EMPTY_MESSAGES.cart.text}
          action={
            <Button onClick={() => navigate("/produtos")} icon="grid">
              Ver produtos
            </Button>
          }
        />
      </div>
    );
  }

  const subtotal = cart?.summary.subtotal ?? 0;
  const discount = coupon?.discount ?? 0;
  const total = Math.max(0, subtotal - discount);

  const applyCoupon = (code: string) => {
    setCouponError(null);
    validateCoupon.mutate(
      { code },
      {
        onSuccess: (result) => {
          setCoupon({ code: result.code, discount: result.discount, shippingDiscount: result.shippingDiscount });
          toast.success("Cupom aplicado", `Desconto de ${result.discount.toFixed(2)}`);
        },
        onError: (mutationError) => {
          setCoupon(null);
          setCouponError(errorMessage(mutationError));
        },
      },
    );
  };

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Carrinho" }]} />

      <div className="page-header">
        <div>
          <h1 className="page-header__title">Meu carrinho</h1>
          <p className="page-header__subtitle">
            {cart?.summary.totalItems} {cart?.summary.totalItems === 1 ? "item" : "itens"}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon="trash"
          onClick={() =>
            clearCart.mutate(undefined, {
              onSuccess: () => toast.success("Carrinho esvaziado"),
              onError: (mutationError) => toast.error("Não foi possível limpar", errorMessage(mutationError)),
            })
          }
          loading={clearCart.isPending}
        >
          Esvaziar carrinho
        </Button>
      </div>

      <div className="cart-layout">
        <div className="cart-lines">
          {cart?.summary.hasIssues ? (
            <Alert tone="warning" title="Atenção aos itens">
              Há produtos sem estoque suficiente. Ajuste a quantidade para continuar.
            </Alert>
          ) : null}

          {items.map((item) => (
            <CartLine
              key={item.id}
              item={item}
              busy={updateItem.isPending || removeItem.isPending}
              onUpdate={(quantity) =>
                updateItem.mutate(
                  { itemId: item.id, quantity },
                  { onError: (mutationError) => toast.error("Não foi possível atualizar", errorMessage(mutationError)) },
                )
              }
              onRemove={() =>
                removeItem.mutate(item.id, {
                  onSuccess: () => toast.success("Item removido"),
                  onError: (mutationError) => toast.error("Não foi possível remover", errorMessage(mutationError)),
                })
              }
            />
          ))}

          <Link to="/produtos" className="btn btn--ghost">
            <Icon name="arrowLeft" size={16} /> Continuar comprando
          </Link>
        </div>

        <Card className="summary-card">
          <h2 className="text-lg">Resumo</h2>

          <CouponForm
            onApply={applyCoupon}
            onRemove={() => {
              setCoupon(null);
              setCouponError(null);
            }}
            appliedCode={coupon?.code}
            appliedDiscount={coupon?.discount}
            loading={validateCoupon.isPending}
          />

          {couponError ? <Alert tone="danger">{couponError}</Alert> : null}

          <CartSummary
            subtotal={subtotal}
            discount={discount}
            shipping={null}
            shippingLabel="Frete"
            shippingPending={false}
            total={total}
            couponCode={coupon?.code}
          />

          <p className="text-xs text-muted">
            O frete é calculado no checkout, de acordo com o seu CEP e as modalidades ativas da loja.
          </p>

          <Button
            block
            size="lg"
            iconRight="arrowRight"
            disabled={cart?.summary.hasIssues}
            onClick={() => navigate("/checkout", { state: { couponCode: coupon?.code } })}
          >
            Ir para o checkout
          </Button>
        </Card>
      </div>

      <div style={{ height: "var(--space-12)" }} />
    </div>
  );
}

export { Skeleton };
