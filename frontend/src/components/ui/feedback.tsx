import type { CSSProperties, ReactNode } from "react";
import { Icon, type IconName } from "./Icons";
import { useUiStore } from "@/stores/ui";
import { ApiError } from "@/lib/api";

/* ========================================================================== */
/* Carregamento                                                                */
/* ========================================================================== */

export function Spinner({ size = "md", label = "Carregando" }: { size?: "sm" | "md" | "lg"; label?: string }) {
  return <span className={`spinner spinner--${size}`} role="status" aria-label={label} />;
}

export function LoadingBlock({ label = "Carregando…", size = "lg" }: { label?: string; size?: "sm" | "md" | "lg" }) {
  return (
    <div className="loading-block" role="status" aria-live="polite">
      <Spinner size={size} label={label} />
      <span>{label}</span>
    </div>
  );
}

/* ========================================================================== */
/* Skeletons                                                                   */
/* ========================================================================== */

export function Skeleton({ width, height = 16, radius, circle, className, style }: { width?: string | number; height?: number | string; radius?: number; circle?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <span
      className={["skeleton", circle ? "skeleton--circle" : "", className ?? ""].filter(Boolean).join(" ")}
      aria-hidden="true"
      style={{
        display: "block",
        width: width ?? "100%",
        height: circle ? (height ?? 40) : height,
        borderRadius: circle ? "50%" : radius,
        ...style,
      }}
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={["skeleton-group", className ?? ""].filter(Boolean).join(" ")} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} height={12} width={index === lines - 1 ? "65%" : "100%"} />
      ))}
    </div>
  );
}

/** Skeleton no formato exato do card de produto (evita salto de layout). */
export function SkeletonProductCard() {
  return (
    <div className="product-card" aria-hidden="true">
      <Skeleton className="skeleton--card" height={0} style={{ aspectRatio: "1 / 1" }} />
      <div className="product-card__body">
        <Skeleton height={10} width="40%" />
        <Skeleton height={14} />
        <Skeleton height={14} width="70%" />
        <Skeleton height={20} width="55%" style={{ marginTop: 8 }} />
        <Skeleton height={38} radius={10} style={{ marginTop: 12 }} />
      </div>
    </div>
  );
}

export function SkeletonProductGrid({ count = 8 }: { count?: number }) {
  return (
    <div className="product-grid" aria-busy="true" aria-label="Carregando produtos">
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonProductCard key={index} />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="table-wrap" aria-busy="true" aria-label="Carregando dados">
      <table className="table">
        <thead>
          <tr>
            {Array.from({ length: columns }).map((_, index) => (
              <th key={index}>
                <Skeleton height={10} width="70%" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rowIndex) => (
            <tr key={rowIndex}>
              {Array.from({ length: columns }).map((_, colIndex) => (
                <td key={colIndex}>
                  <Skeleton height={12} width={colIndex === 0 ? "80%" : "55%"} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ========================================================================== */
/* Estados                                                                     */
/* ========================================================================== */

export function EmptyState({
  icon = "box",
  title,
  text,
  action,
}: {
  icon?: IconName;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon">
        <Icon name={icon} size={30} />
      </span>
      <h3 className="empty-state__title">{title}</h3>
      {text ? <p className="empty-state__text">{text}</p> : null}
      {action}
    </div>
  );
}

/**
 * Estado de erro amigável.
 * Mostra o `requestId` para suporte — nunca stack trace.
 */
export function ErrorState({
  title = "Não foi possível carregar",
  message,
  requestId,
  onRetry,
}: {
  title?: string;
  message: string;
  requestId?: string | null;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state" role="alert">
      <Icon name="alertTriangle" size={30} />
      <div>
        <p className="error-state__title">{title}</p>
        <p className="error-state__text">{message}</p>
      </div>
      {requestId ? <span className="error-state__id">Código: {requestId}</span> : null}
      {onRetry ? (
        <button type="button" className="btn btn--ghost btn--sm" onClick={onRetry}>
          <Icon name="refresh" size={16} /> Tentar novamente
        </button>
      ) : null}
    </div>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
  icon,
}: {
  tone?: "info" | "success" | "warning" | "danger";
  title?: string;
  children?: ReactNode;
  icon?: IconName;
}) {
  const defaultIcon: IconName = tone === "success" ? "checkCircle" : tone === "danger" ? "alertCircle" : tone === "warning" ? "alertTriangle" : "info";
  return (
    <div className={`alert alert--${tone}`} role={tone === "danger" ? "alert" : undefined}>
      <span className="alert__icon">
        <Icon name={icon ?? defaultIcon} size={18} />
      </span>
      <div>
        {title ? <p className="alert__title">{title}</p> : null}
        {children}
      </div>
    </div>
  );
}

/**
 * Renderiza o estado correto de uma query:
 *  - carregando -> skeleton customizado;
 *  - erro -> ErrorState com requestId;
 *  - vazio -> EmptyState;
 *  - sucesso -> conteúdo.
 */
export function AsyncBoundary({
  isLoading,
  error,
  isEmpty,
  skeleton,
  empty,
  onRetry,
  children,
}: {
  isLoading: boolean;
  error: unknown;
  isEmpty?: boolean;
  skeleton: ReactNode;
  empty?: ReactNode;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (isLoading) return <>{skeleton}</>;

  if (error) {
    const apiError = error instanceof ApiError ? error : null;
    return (
      <ErrorState
        message={apiError?.message ?? "Não foi possível carregar as informações. Tente novamente."}
        requestId={apiError?.requestId ?? null}
        onRetry={onRetry}
      />
    );
  }

  if (isEmpty && empty) return <>{empty}</>;

  return <>{children}</>;
}

/* ========================================================================== */
/* Toasts                                                                      */
/* ========================================================================== */

const TOAST_ICON: Record<string, IconName> = {
  success: "checkCircle",
  error: "xCircle",
  warning: "alertTriangle",
  info: "info",
};

/** Região de toasts (montada uma única vez no App). */
export function ToastRegion() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);

  return (
    <div className="toast-region" role="region" aria-live="polite" aria-label="Notificações">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.tone}`} role={toast.tone === "error" ? "alert" : "status"}>
          <span className="toast__icon">
            <Icon name={TOAST_ICON[toast.tone] ?? "info"} size={18} />
          </span>
          <div className="toast__content">
            <p className="toast__title">{toast.title}</p>
            {toast.message ? <p className="toast__message">{toast.message}</p> : null}
          </div>
          <button type="button" className="toast__close" onClick={() => dismiss(toast.id)} aria-label="Fechar aviso">
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
