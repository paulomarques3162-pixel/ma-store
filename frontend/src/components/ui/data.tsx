import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
import { discountPercent, formatCurrency, formatNumber } from "@/lib/format";

/* ========================================================================== */
/* Card                                                                        */
/* ========================================================================== */

export function Card({
  children,
  className,
  padded = true,
  raised,
  as: Tag = "div",
  id,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  raised?: boolean;
  as?: "div" | "section" | "article";
  /** Usado por ancoras (ex.: #comprovante). */
  id?: string;
}) {
  return (
    <Tag id={id} className={["card", padded ? "card--padded" : "", raised ? "card--raised" : "", className ?? ""].filter(Boolean).join(" ")}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, action, subtitle }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card__header">
      <div>
        <h3 className="card__title">{title}</h3>
        {subtitle ? <p className="text-sm text-muted mt-1">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

/* ========================================================================== */
/* Badge                                                                       */
/* ========================================================================== */

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "solid";

export function Badge({ children, tone = "neutral", icon }: { children: ReactNode; tone?: BadgeTone; icon?: IconName }) {
  return (
    <span className={["badge", tone !== "neutral" ? `badge--${tone}` : ""].filter(Boolean).join(" ")}>
      {icon ? <Icon name={icon} size={12} /> : null}
      {children}
    </span>
  );
}

/* ========================================================================== */
/* Paginação                                                                   */
/* ========================================================================== */

/** Gera a lista de páginas com reticências (1 … 4 5 6 … 20). */
function pageItems(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const items: Array<number | "ellipsis"> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  if (start > 2) items.push("ellipsis");
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < total - 1) items.push("ellipsis");
  items.push(total);

  return items;
}

export function Pagination({
  page,
  totalPages,
  onChange,
  totalItems,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  totalItems?: number;
}) {
  if (totalPages <= 1) return null;

  return (
    <nav className="pagination" aria-label="Paginação">
      <button
        type="button"
        className="pagination__btn"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        aria-label="Página anterior"
      >
        <Icon name="chevronLeft" size={16} />
      </button>

      {pageItems(page, totalPages).map((item, index) =>
        item === "ellipsis" ? (
          <span key={`e${index}`} className="pagination__ellipsis" aria-hidden="true">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            className={["pagination__btn", item === page ? "pagination__btn--active" : ""].filter(Boolean).join(" ")}
            onClick={() => onChange(item)}
            aria-current={item === page ? "page" : undefined}
          >
            {item}
          </button>
        ),
      )}

      <button
        type="button"
        className="pagination__btn"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        aria-label="Próxima página"
      >
        <Icon name="chevronRight" size={16} />
      </button>

      {totalItems !== undefined ? (
        <span className="text-xs text-subtle" style={{ width: "100%", textAlign: "center" }}>
          {formatNumber(totalItems)} {totalItems === 1 ? "item" : "itens"}
        </span>
      ) : null}
    </nav>
  );
}

/* ========================================================================== */
/* Tabs                                                                        */
/* ========================================================================== */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: Array<{ value: T; label: string; badge?: number | string }>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          className={["tab", value === tab.value ? "tab--active" : ""].filter(Boolean).join(" ")}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge !== 0 ? <span className="badge badge--accent" style={{ marginLeft: 8 }}>{tab.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ========================================================================== */
/* Accordion                                                                   */
/* ========================================================================== */

export function Accordion({ items }: { items: Array<{ id: string; title: string; content: ReactNode }> }) {
  return (
    <div className="accordion">
      {items.map((item, index) => (
        <details key={item.id} className="accordion__item" open={index === 0}>
          <summary className="accordion__trigger">
            <span>{item.title}</span>
            <Icon name="chevronDown" size={18} />
          </summary>
          <div className="accordion__panel">{item.content}</div>
        </details>
      ))}
    </div>
  );
}

/* ========================================================================== */
/* Avaliação por estrelas                                                      */
/* ========================================================================== */

export function Rating({ value, size = "md", showValue = false }: { value: number; size?: "md" | "lg"; showValue?: boolean }) {
  const rounded = Math.round(value);
  return (
    <span className={["rating", size === "lg" ? "rating--lg" : ""].filter(Boolean).join(" ")} aria-label={`Nota ${value.toFixed(1)} de 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          className={["rating__star", star <= rounded ? "" : "rating__star--empty"].filter(Boolean).join(" ")}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2Z" />
        </svg>
      ))}
      {showValue ? <span className="rating__value">{value.toFixed(1)}</span> : null}
    </span>
  );
}

/** Seletor de nota usado no formulário de avaliação. */
export function StarPicker({ value, onChange, label = "Sua nota" }: { value: number; onChange: (value: number) => void; label?: string }) {
  return (
    <div className="star-picker" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} de 5`}
          className={star <= value ? "is-active" : ""}
          onClick={() => onChange(star)}
        >
          <svg width={26} height={26} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14l-5-4.87 6.91-1.01L12 2Z" />
          </svg>
        </button>
      ))}
    </div>
  );
}

/* ========================================================================== */
/* Preço                                                                       */
/* ========================================================================== */

/**
 * Preço com comparativo e parcelamento.
 * O texto de parcelamento SÓ aparece quando a loja configurou os limites no
 * painel — nunca inventamos uma condição comercial.
 */
export function Price({
  price,
  comparePrice,
  installments,
  size = "md",
}: {
  price: number;
  comparePrice?: number | null;
  installments?: string | null;
  size?: "md" | "lg";
}) {
  const off = discountPercent(price, comparePrice);

  return (
    <div className="price" style={size === "lg" ? { gap: 4 } : undefined}>
      <div className="price__labels">
        {comparePrice && off ? (
          <>
            <span className="price__from">{formatCurrency(comparePrice)}</span>
            <Badge tone="accent">{off}% off</Badge>
          </>
        ) : null}
      </div>
      <span className={["price__value", off ? "price__value--promo" : ""].filter(Boolean).join(" ")}>
        {formatCurrency(price)}
      </span>
      {installments ? <span className="price__installments">{installments}</span> : null}
    </div>
  );
}

/* ========================================================================== */
/* Estatísticas (admin)                                                        */
/* ========================================================================== */

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: IconName;
  tone?: "success" | "warning" | "danger";
}) {
  return (
    <div className="stat-card">
      <div className="row row-between">
        <span className="stat-card__label">{label}</span>
        {icon ? (
          <span className="stat-card__icon" style={tone ? { color: `var(--color-${tone})` } : undefined}>
            <Icon name={icon} size={20} />
          </span>
        ) : null}
      </div>
      <span className="stat-card__value">{value}</span>
      {hint ? <span className="stat-card__hint">{hint}</span> : null}
    </div>
  );
}

/**
 * Gráfico de barras simples em CSS puro.
 * Recebe SOMENTE dados reais vindos da API (nunca séries inventadas).
 */
export function BarChart({ data, valueLabel }: { data: Array<{ label: string; value: number }>; valueLabel?: (value: number) => string }) {
  if (data.length === 0) {
    return <p className="text-sm text-muted">Sem dados no período.</p>;
  }

  const max = Math.max(...data.map((item) => item.value), 1);

  return (
    <div>
      <div className="chart-bars" role="img" aria-label="Gráfico de barras">
        {data.map((item, index) => (
          <div
            key={`${item.label}-${index}`}
            className="chart-bars__bar"
            style={{ height: `${Math.max(3, (item.value / max) * 100)}%` }}
            title={`${item.label}: ${valueLabel ? valueLabel(item.value) : item.value}`}
          />
        ))}
      </div>
      <div className="chart-axis">
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}

export function Progress({ value, max = 100, label }: { value: number; max?: number; label?: string }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
      <div className="progress__bar" style={{ width: `${percent}%` }} />
    </div>
  );
}
