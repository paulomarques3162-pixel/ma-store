import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
import { stockLabel } from "@/lib/format";
import { useContent } from "@/hooks";
import { PLACEHOLDER } from "@/lib/format";

/**
 * Exibição de um valor vindo do CMS.
 *
 * REGRA DO PROJETO: o sistema NUNCA inventa dado da loja. Se o administrador
 * ainda não preencheu a chave, mostramos um placeholder explícito (com estilo
 * discreto) em vez de um valor fictício.
 */
export function StoreValue({
  k,
  fallback,
  className,
  as: Tag = "span",
  placeholderStyle = true,
}: {
  k: string;
  /** Texto exibido quando o CMS ainda não tem valor. `null` = não renderiza nada. */
  fallback?: string | null;
  className?: string;
  as?: "span" | "p" | "div" | "strong";
  placeholderStyle?: boolean;
}) {
  const { get } = useContent();
  const value = get(k);

  if (value) {
    return <Tag className={className}>{value}</Tag>;
  }

  if (fallback === null || fallback === undefined) return null;

  return (
    <Tag className={[className, placeholderStyle ? "placeholder-value" : ""].filter(Boolean).join(" ")}>
      {fallback || PLACEHOLDER}
    </Tag>
  );
}

/** Bloco de aviso usado quando uma página depende de conteúdo não cadastrado. */
export function ContentPlaceholder({
  title = "Conteúdo ainda não cadastrado",
  text,
  icon = "fileText",
}: {
  title?: string;
  text?: string;
  icon?: IconName;
}) {
  return (
    <div className="content-placeholder">
      <span className="content-placeholder__icon">
        <Icon name={icon} size={20} />
      </span>
      <div>
        <strong>{title}</strong>
        {text ? <p className="mt-1">{text}</p> : null}
      </div>
    </div>
  );
}

/**
 * Imagem de produto com placeholder elegante.
 * Se o produto não tiver imagem cadastrada, usamos o SVG neutro do projeto.
 */
export function ProductImage({
  src,
  alt,
  className,
  loading = "lazy",
  aspectRatio,
}: {
  src?: string | null;
  alt: string;
  className?: string;
  loading?: "lazy" | "eager";
  aspectRatio?: string;
}) {
  const source = src && src.trim().length > 0 ? src : "/placeholder-product.svg";
  const isPlaceholder = source === "/placeholder-product.svg";

  return (
    <img
      src={source}
      alt={isPlaceholder ? `${alt} (imagem não cadastrada)` : alt}
      className={className}
      loading={loading}
      decoding="async"
      style={aspectRatio ? { aspectRatio, objectFit: "cover" } : undefined}
      onError={(event) => {
        // Uma URL quebrada não deve mostrar ícone de imagem quebrada.
        const img = event.currentTarget;
        if (img.src.endsWith("/placeholder-product.svg")) return;
        img.src = "/placeholder-product.svg";
      }}
    />
  );
}

/** Indicador de disponibilidade com severidade correta. */
export function StockIndicator({ stock, minStock = 0 }: { stock: number; minStock?: number }) {
  const { text, className } = stockLabel(stock, minStock);
  return (
    <span className={`product-card__stock ${className}`}>
      <Icon name={stock > 0 ? "checkCircle" : "xCircle"} size={13} /> {text}
    </span>
  );
}

/** Selo de indisponibilidade usado na página do produto. */
export function UnavailableNotice({ children }: { children?: ReactNode }) {
  return (
    <div className="alert alert--warning">
      <span className="alert__icon">
        <Icon name="alertTriangle" size={18} />
      </span>
      <div>{children ?? "Este produto está indisponível no momento."}</div>
    </div>
  );
}
