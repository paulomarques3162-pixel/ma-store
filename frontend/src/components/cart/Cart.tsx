import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Icon, Input, ProductImage, QuantitySelector } from "@/components/ui";
import type { Cart } from "@/types/api";
import { formatCurrency } from "@/lib/format";

/** Linha do carrinho com quantidade e remoção. */
export function CartLine({
  item,
  onUpdate,
  onRemove,
  busy,
}: {
  item: Cart["items"][number];
  onUpdate: (quantity: number) => void;
  onRemove: () => void;
  busy?: boolean;
}) {
  return (
    <article className="cart-line">
      <Link to={`/produto/${item.product.slug}`} className="cart-line__media" aria-label={item.product.name}>
        <ProductImage src={item.product.images[0]?.url} alt={item.product.name} aspectRatio="1 / 1" />
      </Link>

      <div className="cart-line__info">
        {item.product.brand?.name ? <span className="product-card__brand">{item.product.brand.name}</span> : null}
        <Link to={`/produto/${item.product.slug}`} className="cart-line__name">
          {item.product.name}
        </Link>
        <span className="text-xs text-muted">
          {formatCurrency(item.unitPrice)}
          {item.product.volume ? ` • ${item.product.volume}` : ""}
        </span>

        {!item.available ? (
          <Alert tone="warning">
            Estoque insuficiente para esta quantidade. Disponível: {item.stock} unidade(s).
          </Alert>
        ) : null}

        <div className="cart-line__actions">
          <QuantitySelector
            value={item.quantity}
            onChange={onUpdate}
            max={item.stock}
            disabled={busy}
            label={`Quantidade de ${item.product.name}`}
          />
          <button type="button" className="btn btn--link btn--sm" onClick={onRemove} disabled={busy}>
            <Icon name="trash" size={14} /> Remover
          </button>
        </div>
      </div>

      <div className="cart-line__price">
        <span className="text-xs text-muted">Subtotal</span>
        <span className="text-strong tabular">{formatCurrency(item.lineTotal)}</span>
      </div>
    </article>
  );
}

/** Resumo de valores do carrinho/checkout. */
export function CartSummary({
  subtotal,
  discount,
  shipping,
  shippingLabel,
  shippingPending,
  total,
  couponCode,
  children,
}: {
  subtotal: number;
  discount?: number;
  shipping?: number | null;
  shippingLabel?: string;
  shippingPending?: boolean;
  total: number;
  couponCode?: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="stack stack-3">
      <div className="summary-row">
        <span className="summary-row__label">Subtotal</span>
        <span className="summary-row__value">{formatCurrency(subtotal)}</span>
      </div>

      {discount !== undefined && discount > 0 ? (
        <div className="summary-row summary-row--discount">
          <span className="summary-row__label">
            Desconto {couponCode ? <span className="badge badge--accent" style={{ marginLeft: 6 }}>{couponCode}</span> : null}
          </span>
          <span className="summary-row__value">− {formatCurrency(discount)}</span>
        </div>
      ) : null}

      <div className="summary-row">
        <span className="summary-row__label">{shippingLabel ?? "Frete"}</span>
        <span className="summary-row__value">
          {shippingPending ? (
            <span className="text-muted text-xs">informe o CEP</span>
          ) : shipping === null || shipping === undefined ? (
            <span className="text-muted text-xs">a calcular</span>
          ) : shipping === 0 ? (
            "Grátis"
          ) : (
            formatCurrency(shipping)
          )}
        </span>
      </div>

      <div className="summary-row summary-row--total">
        <span className="summary-row__label">Total</span>
        <span className="summary-row__value">{formatCurrency(total)}</span>
      </div>

      {children}
    </div>
  );
}

/** Aplicação de cupom — a validação é SEMPRE feita no backend. */
export function CouponForm({
  onApply,
  onRemove,
  appliedCode,
  appliedDiscount,
  loading,
}: {
  onApply: (code: string) => void;
  onRemove?: () => void;
  appliedCode?: string | null;
  appliedDiscount?: number;
  loading?: boolean;
}) {
  const [code, setCode] = useState("");

  if (appliedCode) {
    return (
      <div className="alert alert--success">
        <span className="alert__icon">
          <Icon name="checkCircle" size={18} />
        </span>
        <div className="row row-between" style={{ width: "100%", gap: "var(--space-3)" }}>
          <div>
            <p className="alert__title">Cupom {appliedCode} aplicado</p>
            {appliedDiscount ? <p className="text-xs">Desconto de {formatCurrency(appliedDiscount)}</p> : null}
          </div>
          {onRemove ? (
            <button type="button" className="btn btn--link btn--sm" onClick={onRemove}>
              Remover
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <form
      className="row row-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (code.trim()) onApply(code.trim());
      }}
    >
      <Input
        value={code}
        onChange={(event) => setCode(event.target.value)}
        placeholder="Código do cupom"
        aria-label="Código do cupom"
        autoComplete="off"
      />
      <Button type="submit" variant="ghost" loading={loading} disabled={!code.trim()}>
        Aplicar
      </Button>
    </form>
  );
}
