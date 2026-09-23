import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  BarChart,
  Button,
  Card,
  ErrorState,
  Icon,
  LoadingBlock,
  StatCard,
} from "@/components/ui";
import { ORDER_STATUS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatCurrency, formatCurrencyCompact, formatDateTime, formatNumber } from "@/lib/format";
import type { DashboardData } from "@/types/api";

/**
 * Dashboard do painel.
 * Todos os nÃºmeros vÃªm de `GET /api/admin/dashboard` â€” nenhuma mÃ©trica Ã©
 * calculada ou estimada no frontend.
 */
export default function DashboardPage() {
  const dashboard = useQuery({
    queryKey: queryKeys.adminDashboard,
    queryFn: () => api.get<DashboardData>("/admin/dashboard"),
    refetchInterval: 120_000,
  });

  useEffect(() => {
    applySeo({ title: "Dashboard", noindex: true, canonicalPath: "/admin/dashboard" });
  }, []);

  if (dashboard.isLoading) return <LoadingBlock label="Carregando indicadoresâ€¦" />;

  if (dashboard.error || !dashboard.data) {
    return (
      <ErrorState
        title="NÃ£o foi possÃ­vel carregar o dashboard"
        message={errorMessage(dashboard.error)}
        requestId={errorRequestId(dashboard.error)}
        onRetry={() => void dashboard.refetch()}
      />
    );
  }

  const data = dashboard.data;
  const salesSeries = data.chart.salesByDay.map((point) => ({
    label: new Date(point.day).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
    value: point.revenue,
  }));

  return (
    <div className="stack stack-6">
      {/* ------------------------------------------------------- INDICADORES */}
      <div className="admin-stats">
        <StatCard
          label="Pedidos hoje"
          value={formatNumber(data.orders.today)}
          hint={`${data.orders.pending} aguardando aÃ§Ã£o`}
          icon="package"
          tone={data.orders.pending > 0 ? "warning" : undefined}
        />
        <StatCard
          label="Faturamento do mÃªs"
          value={formatCurrency(data.revenue.month)}
          hint={`Total histÃ³rico: ${formatCurrency(data.revenue.total)}`}
          icon="trendingUp"
          tone="success"
        />
        <StatCard
          label="Pedidos no mÃªs"
          value={formatNumber(data.orders.month)}
          hint={`${data.customers.newThisMonth} novos clientes`}
          icon="chart"
        />
        <StatCard
          label="Clientes"
          value={formatNumber(data.customers.total)}
          hint="Contas de cliente cadastradas"
          icon="users"
        />
      </div>

      <div className="admin-stats">
        <StatCard
          label="Produtos ativos"
          value={formatNumber(data.catalog.active)}
          hint={`${data.catalog.outOfStock} sem estoque`}
          icon="boxes"
        />
        <StatCard
          label="Mensagens nÃ£o lidas"
          value={formatNumber(data.messages.conversationsWithUnread)}
          hint="Conversas aguardando resposta"
          icon="messages"
          tone={data.messages.conversationsWithUnread > 0 ? "warning" : undefined}
        />
        <StatCard
          label="Aguardando moderaÃ§Ã£o"
          value={formatNumber(data.moderation.pendingReviews + data.moderation.pendingFeedback)}
          hint={`${data.moderation.pendingReviews} avaliaÃ§Ãµes â€¢ ${data.moderation.pendingFeedback} feedbacks`}
          icon="star"
          tone={data.moderation.pendingReviews + data.moderation.pendingFeedback > 0 ? "warning" : undefined}
        />
        <StatCard label="Cupons ativos" value={formatNumber(data.coupons.active)} icon="percent" />
      </div>

      {/* ----------------------------------------------------------- GRÃFICO */}
      <Card>
        <div className="row row-between row-wrap mb-4">
          <div>
            <h3 className="card__title">Vendas dos Ãºltimos 30 dias</h3>
            <p className="text-sm text-muted">Somente pedidos com pagamento confirmado.</p>
          </div>
          <Badge tone="accent">
            {formatCurrencyCompact(salesSeries.reduce((total, point) => total + point.value, 0))} no perÃ­odo
          </Badge>
        </div>

        {salesSeries.length > 0 ? (
          <BarChart data={salesSeries} valueLabel={(value) => formatCurrency(value)} />
        ) : (
          <p className="text-sm text-muted">
            Ainda nÃ£o hÃ¡ vendas confirmadas no perÃ­odo. O grÃ¡fico Ã© alimentado por pedidos reais.
          </p>
        )}
      </Card>

      {/* ------------------------------------------------ PEDIDOS RECENTES */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        <Card padded={false}>
          <div className="card__header">
            <h3 className="card__title">Pedidos recentes</h3>
            <Link to="/admin/pedidos" className="btn btn--link btn--sm">
              Ver todos
            </Link>
          </div>
          <div style={{ padding: "var(--space-3)" }}>
            {data.recentOrders.length === 0 ? (
              <p className="text-sm text-muted p-4">Nenhum pedido recebido ainda.</p>
            ) : (
              <div className="stack stack-1">
                {data.recentOrders.map((order) => (
                  <Link
                    key={order.id}
                    to={`/admin/orders/${order.id}`}
                    className="conversation-item"
                    style={{ display: "block" }}
                  >
                    <span className="conversation-item__head">
                      <span className="conversation-item__subject">{order.number}</span>
                      <Badge tone={ORDER_STATUS[order.status].tone}>{ORDER_STATUS[order.status].label}</Badge>
                    </span>
                    <span className="conversation-item__preview">
                      {order.user.name} â€¢ {formatCurrency(order.total)}
                    </span>
                    <span className="conversation-item__time">{formatDateTime(order.createdAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card padded={false}>
          <div className="card__header">
            <h3 className="card__title">Estoque baixo</h3>
            <Link to="/admin/produtos" className="btn btn--link btn--sm">
              Gerenciar
            </Link>
          </div>
          <div style={{ padding: "var(--space-3)" }}>
            {data.catalog.lowStockList.length === 0 ? (
              <p className="text-sm text-muted p-4">
                Nenhum produto abaixo do estoque mÃ­nimo. Defina o estoque mÃ­nimo dos produtos para receber este alerta.
              </p>
            ) : (
              <div className="stack stack-1">
                {data.catalog.lowStockList.map((product) => (
                  <Link
                    key={product.id}
                    to={`/admin/produtos/${product.id}`}
                    className="conversation-item"
                    style={{ display: "block" }}
                  >
                    <span className="conversation-item__head">
                      <span className="conversation-item__subject truncate">{product.name}</span>
                      <Badge tone="danger">{product.stock} un.</Badge>
                    </span>
                    <span className="conversation-item__preview">
                      SKU {product.sku} â€¢ mÃ­nimo {product.minStock}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* -------------------------------------------------- TOP PRODUTOS */}
      <Card padded={false}>
        <div className="card__header">
          <h3 className="card__title">Produtos mais vendidos</h3>
        </div>
        <div style={{ padding: "var(--space-5)" }}>
          {data.topProducts.length === 0 ? (
            <p className="text-sm text-muted">
              Ainda nÃ£o hÃ¡ vendas registradas. Esta lista usa o histÃ³rico real de pedidos.
            </p>
          ) : (
            <div className="stack stack-3">
              {data.topProducts.map((product, index) => (
                <div key={product.name} className="row row-between row-wrap">
                  <div className="row row-3">
                    <span className="badge">{index + 1}Âº</span>
                    <span className="text-sm">{product.name}</span>
                  </div>
                  <span className="text-sm text-muted">
                    {formatNumber(product.quantity)} vendidos â€¢ {formatCurrency(product.revenue)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* --------------------------------------------------- ATALHOS */}
      <Card>
        <h3 className="card__title mb-4">AÃ§Ãµes rÃ¡pidas</h3>
        <div className="row row-3 row-wrap">
          <Link to="/admin/produtos/novo" className="btn btn--ghost">
            <Icon name="plus" size={16} /> Novo produto
          </Link>
          <Link to="/admin/pedidos" className="btn btn--ghost">
            <Icon name="package" size={16} /> Pedidos
          </Link>
          <Link to="/admin/cupons" className="btn btn--ghost">
            <Icon name="percent" size={16} /> Cupons
          </Link>
          <Link to="/admin/testes" className="btn btn--ghost">
            <Icon name="flask" size={16} /> Rodar laboratÃ³rio
          </Link>
          <Button variant="ghost" icon="refresh" onClick={() => void dashboard.refetch()}>
            Atualizar dados
          </Button>
        </div>
      </Card>
    </div>
  );
}

