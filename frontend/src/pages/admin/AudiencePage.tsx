import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Card, EmptyState, LoadingBlock, Select, StatCard, Badge } from "@/components/ui";
import { AdminPageHeader } from "@/components/admin/kit";
import { applySeo } from "@/lib/seo";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

type AnalyticsSummary = {
  range: { from: string; to: string };
  totals: {
    pageViews: number;
    productViews: number;
    addToCart: number;
    beginCheckout: number;
    sessions: number;
    uniqueVisitors: number;
    orders: number;
    paidOrders: number;
  };
  conversion: {
    visitToOrder: number | null;
    visitToPaid: number | null;
    checkoutToOrder: number | null;
    denominators: { uniqueVisitors: number; beginCheckout: number };
  };
  byType: Array<{ type: string; count: number }>;
  byDevice: Array<{ device: string; count: number }>;
  topProducts: Array<{ productId: string; name: string | null; views: number }>;
  topPages: Array<{ path: string; views: number }>;
  referrers: Array<{ host: string; count: number }>;
  series: Array<{ day: string; pageViews: number; orders: number; paidOrders: number }>;
};

const PERIODS = [
  { value: "7", label: "Últimos 7 dias" },
  { value: "30", label: "Últimos 30 dias" },
  { value: "90", label: "Últimos 90 dias" },
];

const EVENT_LABELS: Record<string, string> = {
  PAGE_VIEW: "Páginas vistas",
  PRODUCT_VIEW: "Produtos vistos",
  ADD_TO_CART: "Adições ao carrinho",
  BEGIN_CHECKOUT: "Inícios de checkout",
  SEARCH: "Buscas",
  ORDER_CREATED: "Pedidos criados",
  PAYMENT_CONFIRMED: "Pagamentos confirmados",
};

const pct = (value: number | null) => (value === null ? "—" : `${value}%`);

/**
 * Painel de audiência.
 *
 * Os números são agregações REAIS dos eventos coletados desde a implantação —
 * nada é inventado nem reconstruído retroativamente. A coleta é anônima e
 * minimizada (sem IP/dados pessoais).
 */
export default function AudiencePage() {
  const [days, setDays] = useState("30");

  useEffect(() => {
    applySeo({ title: "Audiência", noindex: true, canonicalPath: "/admin/audiencia" });
  }, []);

  const query = useQuery({
    queryKey: ["admin", "analytics", days],
    queryFn: () => api.get<AnalyticsSummary>("/admin/analytics", { query: { days: Number(days) } }),
    placeholderData: (previous) => previous,
  });

  const data = query.data;
  const maxSeries = Math.max(1, ...(data?.series ?? []).map((entry) => entry.pageViews));

  return (
    <div>
      <AdminPageHeader
        title="Audiência"
        subtitle="Visitas, produtos mais acessados, funil e conversão — coletados de forma anônima."
      />

      <div className="admin-filters mb-5">
        <Select
          label="Período"
          value={days}
          onChange={(event) => setDays(event.target.value)}
          options={PERIODS}
        />
      </div>

      {query.isLoading && !data ? <LoadingBlock label="Carregando métricas…" /> : null}

      {data ? (
        <>
          <div className="admin-stats mb-5">
            <StatCard label="Páginas vistas" value={data.totals.pageViews} icon="chart" />
            <StatCard label="Visitantes únicos" value={data.totals.uniqueVisitors} hint="sessões distintas" icon="users" />
            <StatCard label="Produtos vistos" value={data.totals.productViews} icon="boxes" />
            <StatCard label="Pedidos" value={data.totals.orders} hint={`${data.totals.paidOrders} pagos`} icon="package" />
          </div>

          <div className="admin-stats mb-5">
            <StatCard label="Adições ao carrinho" value={data.totals.addToCart} icon="cart" />
            <StatCard label="Inícios de checkout" value={data.totals.beginCheckout} icon="creditCard" />
            <StatCard
              label="Conversão visita → pedido"
              value={pct(data.conversion.visitToOrder)}
              hint={`${data.totals.orders} pedido(s) / ${data.conversion.denominators.uniqueVisitors} visitante(s)`}
              icon="checkCircle"
            />
            <StatCard
              label="Conversão checkout → pedido"
              value={pct(data.conversion.checkoutToOrder)}
              hint={`${data.totals.orders} pedido(s) / ${data.conversion.denominators.beginCheckout} checkout(s)`}
              icon="checkCircle"
            />
          </div>

          {data.totals.pageViews === 0 ? (
            <EmptyState
              icon="chart"
              title="Ainda sem dados de audiência"
              text="A coleta começa após a implantação desta versão. Períodos anteriores não podem ser reconstruídos."
            />
          ) : (
            <div className="stack stack-5">
              <Card>
                <h3 className="card__title mb-4">Páginas vistas por dia</h3>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 160 }} role="img" aria-label="Páginas vistas por dia">
                  {data.series.map((entry) => (
                    <div
                      key={entry.day}
                      title={`${entry.day}: ${entry.pageViews} página(s), ${entry.orders} pedido(s)`}
                      style={{
                        flex: 1,
                        minWidth: 4,
                        height: `${Math.max(4, (entry.pageViews / maxSeries) * 100)}%`,
                        background: "var(--color-accent, #EBB248)",
                        borderRadius: 3,
                      }}
                    />
                  ))}
                </div>
              </Card>

              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
                <Card>
                  <h3 className="card__title mb-4">Produtos mais vistos</h3>
                  {data.topProducts.length === 0 ? (
                    <p className="text-sm text-muted">Sem visualizações de produto no período.</p>
                  ) : (
                    <div className="stack stack-2">
                      {data.topProducts.map((entry) => (
                        <div key={entry.productId} className="row row-between text-sm">
                          <span className="clamp-1">{entry.name ?? entry.productId}</span>
                          <Badge tone="info">{entry.views}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card>
                  <h3 className="card__title mb-4">Páginas mais acessadas</h3>
                  {data.topPages.length === 0 ? (
                    <p className="text-sm text-muted">Sem páginas no período.</p>
                  ) : (
                    <div className="stack stack-2">
                      {data.topPages.map((entry) => (
                        <div key={entry.path} className="row row-between text-sm">
                          <span className="clamp-1">{entry.path}</span>
                          <Badge tone="neutral">{entry.views}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card>
                  <h3 className="card__title mb-4">Dispositivos</h3>
                  {data.byDevice.length === 0 ? (
                    <p className="text-sm text-muted">Sem dados de dispositivo.</p>
                  ) : (
                    <div className="stack stack-2">
                      {data.byDevice.map((entry) => (
                        <div key={entry.device} className="row row-between text-sm">
                          <span style={{ textTransform: "capitalize" }}>{entry.device}</span>
                          <Badge tone="neutral">{entry.count}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>

                <Card>
                  <h3 className="card__title mb-4">Origem do tráfego</h3>
                  {data.referrers.length === 0 ? (
                    <p className="text-sm text-muted">Sem referências externas no período.</p>
                  ) : (
                    <div className="stack stack-2">
                      {data.referrers.map((entry) => (
                        <div key={entry.host} className="row row-between text-sm">
                          <span className="clamp-1">{entry.host}</span>
                          <Badge tone="neutral">{entry.count}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <Card>
                <h3 className="card__title mb-4">Eventos no período</h3>
                <div className="stack stack-2">
                  {data.byType.map((entry) => (
                    <div key={entry.type} className="row row-between text-sm">
                      <span>{EVENT_LABELS[entry.type] ?? entry.type}</span>
                      <span className="tabular">{entry.count}</span>
                    </div>
                  ))}
                </div>
              </Card>

              <Alert tone="info" title="Privacidade dos dados">
                Coletamos apenas eventos anônimos (sem IP, e-mail ou dados pessoais). Sessões são identificadores opacos e os
                dados podem ser expurgados por retenção. Números anteriores à coleta não existem.
              </Alert>
            </div>
          )}

          <p className="text-xs text-muted mt-5">
            Período exibido: {formatDateTime(data.range.from)} — {formatDateTime(data.range.to)}.
          </p>
        </>
      ) : null}
    </div>
  );
}
