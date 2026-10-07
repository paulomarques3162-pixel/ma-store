import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Pagination,
  SkeletonTable,
  type IconName,
} from "@/components/ui";
import type { PaginationMeta } from "@/types/api";

/**
 * Kit de telas administrativas.
 *
 * Concentra o padrão (cabeçalho, filtros, tabela, estados de carregamento/erro/
 * vazio e paginação) para que as 16 áreas do painel sejam consistentes e não
 * repitam código — e para garantir que nenhuma tela fique "sem estado".
 */

export function AdminPageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="row row-between row-wrap mb-6" style={{ gap: "var(--space-4)", alignItems: "flex-end" }}>
      <div>
        <h2 className="text-2xl">{title}</h2>
        {subtitle ? <p className="text-sm text-muted mt-1">{subtitle}</p> : null}
      </div>
      {actions ? <div className="row row-2 row-wrap">{actions}</div> : null}
    </div>
  );
}

export function AdminFilterBar({ children, onSubmit }: { children: ReactNode; onSubmit?: () => void }) {
  return (
    <form
      className="admin-filters"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.();
      }}
    >
      {children}
    </form>
  );
}

export type AdminColumn<T> = {
  key: string;
  header: string;
  /** Renderização da célula. */
  render: (row: T) => ReactNode;
  align?: "left" | "right";
  width?: number | string;
  /** Esconde a coluna no mobile (mantém a tabela legível). */
  hideOnMobile?: boolean;
};

export function AdminTable<T extends { id: string }>({
  columns,
  rows,
  loading,
  error,
  onRetry,
  requestId,
  emptyTitle,
  emptyText,
  emptyIcon = "box",
  emptyAction,
  meta,
  onPageChange,
}: {
  columns: Array<AdminColumn<T>>;
  rows: T[];
  loading: boolean;
  error?: unknown;
  onRetry?: () => void;
  requestId?: string | null;
  emptyTitle: string;
  emptyText: string;
  emptyIcon?: IconName;
  emptyAction?: ReactNode;
  meta?: PaginationMeta;
  onPageChange?: (page: number) => void;
}) {
  if (loading) return <SkeletonTable columns={columns.length} />;

  if (error) {
    return (
      <ErrorState
        message={error instanceof Error ? error.message : "Não foi possível carregar os dados."}
        requestId={requestId}
        onRetry={onRetry}
      />
    );
  }

  if (rows.length === 0) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} text={emptyText} action={emptyAction} />;
  }

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={[
                    column.align === "right" ? "table__num" : "",
                    column.hideOnMobile ? "hide-mobile" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={column.width ? { width: column.width } : undefined}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={[column.align === "right" ? "table__num" : "", column.hideOnMobile ? "hide-mobile" : ""]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {meta && onPageChange ? (
        <Pagination page={meta.page} totalPages={meta.totalPages} onChange={onPageChange} totalItems={meta.total} />
      ) : null}
    </>
  );
}

/** Linha de ações padrão das tabelas. */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="table__actions">{children}</div>;
}

/** Cartão de aviso quando uma integração/configuração ainda não existe. */
export function AdminNotice({
  tone = "info",
  title,
  children,
  action,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title: string;
  children?: ReactNode;
  action?: { label: string; to?: string; onClick?: () => void; icon?: IconName };
}) {
  return (
    <Alert tone={tone} title={title}>
      {children}
      {action ? (
        <div className="mt-2">
          {action.to ? (
            <Link to={action.to} className="btn btn--ghost btn--sm">
              {action.icon ? <Icon name={action.icon} size={15} /> : null} {action.label}
            </Link>
          ) : (
            <Button size="sm" variant="ghost" icon={action.icon} onClick={action.onClick}>
              {action.label}
            </Button>
          )}
        </div>
      ) : null}
    </Alert>
  );
}

/** Container padrão de bloco administrativo. */
export function AdminPanel({
  title,
  subtitle,
  action,
  children,
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card padded={false}>
      {title ? (
        <div className="card__header">
          <div>
            <h3 className="card__title">{title}</h3>
            {subtitle ? <p className="text-sm text-muted mt-1">{subtitle}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div style={{ padding: "var(--space-5)" }}>{children}</div>
    </Card>
  );
}
