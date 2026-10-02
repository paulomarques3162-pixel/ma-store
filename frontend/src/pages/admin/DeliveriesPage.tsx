import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, Input, Modal, Select, Tabs } from "@/components/ui";
import { AdminPageHeader, AdminTable, RowActions, type AdminColumn } from "@/components/admin/kit";
import { DeliveryStatusBadge, DELIVERY_STATUS_LABEL } from "@/components/delivery";
import { useToast } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatDateTime } from "@/lib/format";
import type {
  DeliveryListItem,
  DeliveryReport,
  DeliveryReportRow,
  DeliveryStatus,
  Driver,
  PendingAssignmentPedido,
} from "@/types/api";

type Tab = "list" | "assign" | "report";

/** Datas padrão do relatório: últimos 30 dias. */
function defaultPeriod(): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

/** Admin → Entregas: acompanhar entregas e atribuir pedidos aos entregadores. */
export default function AdminDeliveriesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("list");
  const [status, setStatus] = useState<DeliveryStatus | "">("");
  const [assignTarget, setAssignTarget] = useState<PendingAssignmentPedido | null>(null);
  const [selectedDriver, setSelectedDriver] = useState("");
  const initialPeriod = useMemo(defaultPeriod, []);
  const [from, setFrom] = useState(initialPeriod.from);
  const [to, setTo] = useState(initialPeriod.to);

  useEffect(() => {
    applySeo({ title: "Entregas", noindex: true, canonicalPath: "/admin/entregas" });
  }, []);

  const deliveries = useQuery({
    queryKey: queryKeys.adminDeliveries({ status }),
    queryFn: () =>
      api.get<{ deliveries: DeliveryListItem[] }>("/admin/delivery", { query: status ? { status } : undefined }),
  });

  const pending = useQuery({
    queryKey: queryKeys.adminDeliveryPending,
    queryFn: () => api.get<{ pedidos: PendingAssignmentPedido[] }>("/admin/delivery/pending"),
    enabled: tab === "assign",
  });

  const drivers = useQuery({
    queryKey: queryKeys.adminDrivers,
    queryFn: () => api.get<{ drivers: Driver[] }>("/admin/drivers"),
  });

  const activeDrivers = (drivers.data?.drivers ?? []).filter((driver) => driver.status === "ACTIVE");

  const report = useQuery({
    queryKey: queryKeys.adminDeliveryReport({ from, to }),
    queryFn: () => api.get<DeliveryReport>("/admin/delivery/report", { query: { from, to } }),
    enabled: tab === "report",
  });

  const reportRows = useMemo<Array<DeliveryReportRow & { id: string }>>(
    () => (report.data?.rows ?? []).map((row) => ({ ...row, id: row.driverId ?? "unassigned" })),
    [report.data],
  );

  const assign = useMutation({
    mutationFn: () =>
      api.post("/admin/delivery/assign", { pedidoId: assignTarget?.id, driverId: selectedDriver }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "deliveries"] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "delivery"] });
      setAssignTarget(null);
      setSelectedDriver("");
      toast.success("Entrega atribuída");
    },
    onError: (error) => toast.error("Não foi possível atribuir", errorMessage(error)),
  });

  const columns: Array<AdminColumn<DeliveryListItem>> = [
    { key: "order", header: "Pedido", render: (item) => <span className="text-sm text-strong">#{item.orderNumber}</span> },
    { key: "cliente", header: "Cliente", render: (item) => <span className="text-sm text-muted">{item.clienteNome}</span> },
    { key: "driver", header: "Entregador", render: (item) => <span className="text-sm text-muted">{item.driver?.name ?? "—"}</span> },
    { key: "status", header: "Status", render: (item) => <DeliveryStatusBadge status={item.status} /> },
    { key: "date", header: "Data", hideOnMobile: true, render: (item) => <span className="text-xs text-muted">{formatDateTime(item.createdAt)}</span> },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (item) => (
        <RowActions>
          <Link to={`/admin/entregas/${item.id}`} className="btn btn--ghost btn--sm">
            Ver
          </Link>
        </RowActions>
      ),
    },
  ];

  const reportColumns: Array<AdminColumn<DeliveryReportRow & { id: string }>> = [
    { key: "driver", header: "Entregador", render: (row) => <span className="text-sm text-strong">{row.driverName}</span> },
    { key: "total", header: "Total", align: "right", render: (row) => <span className="text-sm tabular">{row.total}</span> },
    {
      key: "delivered",
      header: "Concluídas",
      align: "right",
      render: (row) => <Badge tone="success">{row.delivered}</Badge>,
    },
    {
      key: "failed",
      header: "Falhas",
      align: "right",
      render: (row) => <Badge tone={row.failed > 0 ? "danger" : "neutral"}>{row.failed}</Badge>,
    },
    {
      key: "inProgress",
      header: "Em andamento",
      align: "right",
      hideOnMobile: true,
      render: (row) => <span className="text-sm tabular">{row.inProgress}</span>,
    },
    {
      key: "rate",
      header: "Taxa de sucesso",
      align: "right",
      hideOnMobile: true,
      render: (row) => <span className="text-sm tabular">{row.successRate}%</span>,
    },
  ];

  return (
    <div>
      <AdminPageHeader title="Entregas" subtitle="Acompanhe as entregas e atribua pedidos aos entregadores." />

      <Tabs
        ariaLabel="Seções de entregas"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "list", label: "Entregas", badge: deliveries.data?.deliveries.length },
          { value: "assign", label: "Atribuir pedido", badge: pending.data?.pedidos.length },
          { value: "report", label: "Relatório" },
        ]}
      />

      <div className="mt-5">
        {tab === "list" ? (
          <Card className="stack stack-4">
            <Select
              label="Filtrar por status"
              value={status}
              onChange={(event) => setStatus(event.target.value as DeliveryStatus | "")}
              options={[
                { value: "", label: "Todas" },
                ...(Object.keys(DELIVERY_STATUS_LABEL) as DeliveryStatus[]).map((value) => ({
                  value,
                  label: DELIVERY_STATUS_LABEL[value],
                })),
              ]}
            />
            <AdminTable
              columns={columns}
              rows={deliveries.data?.deliveries ?? []}
              loading={deliveries.isLoading}
              error={deliveries.error}
              requestId={errorRequestId(deliveries.error)}
              onRetry={() => void deliveries.refetch()}
              emptyTitle="Nenhuma entrega"
              emptyText="Atribua um pedido a um entregador para começar."
              emptyIcon="truck"
            />
          </Card>
        ) : tab === "assign" ? (
          <Card className="stack stack-4">
            {activeDrivers.length === 0 ? (
              <Alert tone="warning" title="Nenhum entregador ativo">
                Cadastre e ative um entregador em <strong>Entregadores</strong> antes de atribuir pedidos.
              </Alert>
            ) : null}

            {(pending.data?.pedidos ?? []).length === 0 ? (
              <Alert tone="info">Nenhum pedido pronto para envio aguardando atribuição.</Alert>
            ) : (
              <div className="stack stack-3">
                {(pending.data?.pedidos ?? []).map((pedido) => {
                  const endereco = (pedido.enderecoCompleto ?? {}) as Record<string, string>;
                  return (
                    <div key={pedido.id} className="row row-between row-wrap card" style={{ padding: "var(--space-3)", gap: "var(--space-2)" }}>
                      <div className="stack stack-1">
                        <span className="text-sm text-strong">#{pedido.id} — {pedido.clienteNome}</span>
                        <span className="text-xs text-muted">
                          {endereco.logradouro ?? ""}, {endereco.numero ?? ""} • {endereco.bairro ?? ""} • {endereco.cidade ?? ""}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        icon="truck"
                        onClick={() => {
                          setAssignTarget(pedido);
                          setSelectedDriver(activeDrivers[0]?.id ?? "");
                        }}
                      >
                        Atribuir
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        ) : (
          <Card className="stack stack-4">
            <div className="grid grid-2">
              <Input
                label="De"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
              <Input
                label="Até"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </div>

            {report.data ? (
              <div className="grid grid-2">
                <SummaryItem label="Total no período" value={report.data.totals.total} />
                <SummaryItem label="Concluídas" value={report.data.totals.delivered} tone="success" />
                <SummaryItem label="Falhas" value={report.data.totals.failed} tone="danger" />
                <SummaryItem label="Em andamento" value={report.data.totals.inProgress} />
              </div>
            ) : null}

            <AdminTable
              columns={reportColumns}
              rows={reportRows}
              loading={report.isLoading}
              error={report.error}
              requestId={errorRequestId(report.error)}
              onRetry={() => void report.refetch()}
              emptyTitle="Sem dados no período"
              emptyText="Nenhuma entrega registrada para o período selecionado."
              emptyIcon="chart"
            />
          </Card>
        )}
      </div>

      <Modal
        open={Boolean(assignTarget)}
        onClose={() => setAssignTarget(null)}
        title={`Atribuir pedido #${assignTarget?.id ?? ""}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssignTarget(null)}>
              Cancelar
            </Button>
            <Button loading={assign.isPending} disabled={!selectedDriver} onClick={() => assign.mutate()}>
              Atribuir entrega
            </Button>
          </>
        }
      >
        <Select
          label="Entregador"
          value={selectedDriver}
          onChange={(event) => setSelectedDriver(event.target.value)}
          options={activeDrivers.map((driver) => ({ value: driver.id, label: `${driver.name}${driver.phone ? ` — ${driver.phone}` : ""}` }))}
          placeholder="Selecione o entregador"
          required
        />
      </Modal>
    </div>
  );
}

function SummaryItem({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" }) {
  return (
    <div className="card" style={{ padding: "var(--space-3)" }}>
      <p className="text-xs text-muted">{label}</p>
      {tone ? <Badge tone={tone}>{value}</Badge> : <span className="text-2xl text-strong">{value}</span>}
    </div>
  );
}
