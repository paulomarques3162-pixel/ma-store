/**
 * Formatação e utilidades de apresentação.
 * Regra: nunca inventar dado. Quando o valor é nulo, devolvemos um
 * placeholder explícito em vez de um valor fictício.
 */

export const PLACEHOLDER = "Não configurado";
export const EMPTY_VALUE = "—";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const BRL_COMPACT = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCurrency(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return EMPTY_VALUE;
  const numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return EMPTY_VALUE;
  return BRL.format(numeric);
}

export function formatCurrencyCompact(value: number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  return BRL_COMPACT.format(value);
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return EMPTY_VALUE;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;

  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60000);

  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d`;
  return formatDate(date);
}

/** Máscara de CEP (00000-000) para digitação. */
export function maskCep(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

/** Máscara de telefone brasileiro (fixo e celular). */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Iniciais para avatar. */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

/** Percentual de desconto entre preço comparativo e preço atual. */
export function discountPercent(price: number, comparePrice: number | null | undefined): number | null {
  if (!comparePrice || comparePrice <= price) return null;
  return Math.round(((comparePrice - price) / comparePrice) * 100);
}

/**
 * Texto de parcelamento — só é exibido quando a loja configurou
 * `payment.maxInstallments` / `payment.installmentMinValue` no painel.
 */
export function formatInstallments(
  total: number,
  maxInstallments: number | null | undefined,
  minInstallmentValue: number | null | undefined,
): string | null {
  if (!maxInstallments || maxInstallments < 2) return null;
  const minValue = minInstallmentValue && minInstallmentValue > 0 ? minInstallmentValue : 0;

  let count = maxInstallments;
  if (minValue > 0) {
    while (count > 2 && total / count < minValue) count -= 1;
    if (total / count < minValue) return null;
  }

  const value = total / count;
  return `${count}x de ${formatCurrency(value)}`;
}

/** Rótulo de estoque com a severidade correta. */
export function stockLabel(stock: number, minStock = 0): { text: string; className: string } {
  if (stock <= 0) return { text: "Produto indisponível", className: "stock-out" };
  if (minStock > 0 && stock <= minStock) return { text: `Últimas ${stock} unidades`, className: "stock-low" };
  if (stock <= 3) return { text: `Últimas ${stock} unidades`, className: "stock-low" };
  return { text: "Disponível", className: "stock-in" };
}

/** Nome do arquivo sugerido para o comprovante do pedido. */
export function receiptFileName(orderNumber: string): string {
  return `comprovante-${orderNumber.replace(/[^\w-]/g, "")}.pdf`;
}

export function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
