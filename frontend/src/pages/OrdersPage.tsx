import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Pagination,
  Skeleton,
  Tabs,
} from "@/components/ui";
import { ProductImage } from "@/components/ui";
import { EMPTY_MESSAGES, ORDER_STATUS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { Order, OrderStatus } from "@/types/api";

type Filter = "all" | "open" | "paid" | "done" | "canceled";

const FILTERS: Array<{ id: Filter; label: string; statuses?: OrderStatus[] }> = [
  { id: "all", label: "Todos" },
  { id: "open", label: "Em andamento", statuses: ["AWAITING_PAYMENT", "PAYMENT_REVIEW"] },
  { id: "paid", label: "Pagos", statuses: ["PAID", "PREPARING"] },
  { id: "done", label: "Entregues", statuses: ["SHIPPED", "DELIVERED"] },
  { id: "canceled", label: "Cancelados", statuses: ["CANCELED", "REFUNDED"] },
];

export default function OrdersPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);

  useEffect(() => {
    applySeo({ title: "Meus pedidos", noindex: true, canonicalPath: "/meus-pedidos" });
  }, []);

  const orders = useQuery({
    queryKey: queryKeys.orders({ page, filter }),
    queryFn: () => api.list<Order[]>("/orders", { query: { page, perPage: 10 } }),
    placeholderData: (previous) => previous,
  });

  const summary = useQuery({
    queryKey: queryKeys.orderSummary,
    queryFn: () => api.get<{ inProgress: number; totalOrders: number; totalSpent: number }>("/orders/summary"),
  });

  const activeFilter = FILTERS.find((item) => item.id === filter);
  const items = (orders.data?.data ?? []).filter((order) =>
    activeFilter?.statuses ? activeFilter.statuses.includes(order.status) : true,
  );

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Meus pedidos" }]} />

      <div className="page-header">
        <div>
          <h1 className="page-header__title">Meus pedidos</h1>
          <p className="page-header__subtitle">Acompanhe o status e o histórico de cada compra.</p>
        </div>
      </div>

      {summary.data ? (
        <div className="admin-stats mb-6">
          <div className="stat-card">
            <span className="stat-card__label">Pedidos</span>
            <span className="stat-card__value">{summary.data.totalOrders}</span>
          </div>
          <div className="stat-card">
            <span className="stat-card__label">Em andamento</span>
            <span className="stat-card__value">{summary.data.inProgress}</span>
          </div>
          <div className="stat-card">
            <span className="stat-card__label">Total comprado</span>
            <span className="stat-card__value">{formatCurrency(summary.data.totalSpent)}</span>
          </div>
        </div>
      ) : null}

      <Tabs ariaLabel="Filtrar pedidos" tabs={FILTERS.map((item) => ({ value: item.id, label: item.label }))} value={filter} onChange={setFilter} />

      <div className="mt-6 stack stack-4">
        {orders.isLoading ? (
          <>
            <Skeleton height={140} radius={16} />
            <Skeleton height={140} radius={16} />
          </>
        ) : orders.error ? (
          <ErrorState
            message={errorMessage(orders.error)}
            requestId={errorRequestId(orders.error)}
            onRetry={() => void orders.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon="package"
            title={EMPTY_MESSAGES.orders.title}
            text={EMPTY_MESSAGES.orders.text}
            action={
              <Button onClick={() => window.location.assign("/produtos")} icon="grid">
                Ver produtos
              </Button>
            }
          />
        ) : (
          items.map((order) => <OrderCard key={order.id} order={order} />)
        )}
      </div>

      {orders.data?.meta ? (
        <Pagination page={orders.data.meta.page} totalPages={orders.data.meta.totalPages} onChange={setPage} />
      ) : null}

      <div style={{ height: "var(--space-8)" }} />
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const status = ORDER_STATUS[order.status];

  return (
    <Card className="order-card">
      <div className="order-card__head">
        <div>
          <div className="order-card__number">
            <Icon name="receipt" size={14} /> {order.number}
          </div>
          <div className="order-card__meta">{formatDateTime(order.createdAt)}</div>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="order-card__foot">
        <div>
          <span className="text-xs text-muted">Total</span>
          <div className="text-lg text-strong tabular">{formatCurrency(order.total)}</div>
        </div>

        <div className="row row-2 row-wrap">
          <Link to={`/meus-pedidos/${order.id}`} className="btn btn--ghost btn--sm">
            Ver detalhes
          </Link>
          <Link to={`/meus-pedidos/${order.id}#comprovante`} className="btn btn--ghost btn--sm">
            <Icon name="print" size={15} /> Comprovante
          </Link>
          <Link to="/mensagens" className="btn btn--ghost btn--sm">
            <Icon name="message" size={15} /> Falar com a loja
          </Link>
        </div>
      </div>
    </Card>
  );
}

export { ProductImage };
