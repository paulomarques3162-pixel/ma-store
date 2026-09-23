import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Icon, Input, Select, StatCard } from "@/components/ui";
import { AdminPageHeader, AdminTable, RowActions, type AdminColumn } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { ORDER_STATUS, PAYMENT_METHOD } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api, envelopeExtras, errorMessage, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { Order, OrderStatus, PaymentStatus } from "@/types/api";

type AdminOrderRow = Order & {
  user: { id: string; name: string; email: string; phone: string | null };
  _count: { items: number };
  payments: Array<{ status: PaymentStatus }>;
};

/** Lista de pedidos com filtros, contadores e mudanÃ§a rÃ¡pida de status. */
export default function AdminOrdersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    applySeo({ title: "Pedidos", noindex: true, canonicalPath: "/admin/pedidos" });
  }, []);

  const orders = useQuery({
    queryKey: queryKeys.adminOrders({ search, status, paymentMethod, page }),
    queryFn: () =>
      api.list<AdminOrderRow[]>("/admin/orders", {
        query: {
          search: search || undefined,
          status: status || undefined,
          paymentMethod: paymentMethod || undefined,
          page,
          perPage: 20,
        },
      }),
    placeholderData: (previous) => previous,
  });

  // Contadores por status: campo extra devolvido no envelope do endpoint.
  const statusCounts = envelopeExtras(orders.data?.data).statusCounts as Record<string, number> | undefined ?? {};

  const updateStatus = useMutation({
    mutationFn: ({ id, nextStatus, note }: { id: string; nextStatus: OrderStatus; note?: string }) =>
      api.patch(`/admin/orders/${id}/status`, { status: nextStatus, note }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "orders"] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminOrder(variables.id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminDashboard });
      toast.success("Status atualizado", `Pedido agora estÃ¡ em "${ORDER_STATUS[variables.nextStatus].label}".`);
    },
    onError: (error) => toast.error("NÃ£o foi possÃ­vel alterar o status", errorMessage(error)),
  });

  const rows = orders.data?.data ?? [];
  const meta = orders.data?.meta;

  const columns: Array<AdminColumn<AdminOrderRow>> = [
    {
      key: "order",
      header: "Pedido",
      render: (order) => (
        <div>
          <Link to={`/admin/orders/${order.id}`} className="text-sm text-strong">
            {order.number}
          </Link>
          <div className="text-xs text-muted">{formatDateTime(order.createdAt)}</div>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Cliente",
      render: (order) => (
        <div style={{ minWidth: 0 }}>
          <div className="text-sm clamp-1">{order.user?.name ?? "â€”"}</div>
          <div className="text-xs text-muted clamp-1">{order.user?.email ?? ""}</div>
        </div>
      ),
    },
    {
      key: "items",
      header: "Itens",
      align: "right",
      hideOnMobile: true,
      render: (order) => <span className="text-sm text-muted">{order._count?.items ?? 0}</span>,
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      render: (order) => <span className="text-sm text-strong tabular">{formatCurrency(order.total)}</span>,
    },
    {
      key: "payment",
      header: "Pagamento",
      hideOnMobile: true,
      render: (order) => (
        <div>
          <div className="text-sm text-muted">{order.paymentMethod ? PAYMENT_METHOD[order.paymentMethod] : "â€”"}</div>
          {order.couponCode ? <div className="text-xs text-subtle">Cupom {order.couponCode}</div> : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (order) => <Badge tone={ORDER_STATUS[order.status].tone}>{ORDER_STATUS[order.status].label}</Badge>,
    },
    {
      key: "actions",
      header: "AÃ§Ãµes",
      align: "right",
      render: (order) => (
        <RowActions>
          <Select
            aria-label={`Alterar status do pedido ${order.number}`}
            value={order.status}
            onChange={(event) => updateStatus.mutate({ id: order.id, nextStatus: event.target.value as OrderStatus, note: "Alterado pelo painel" })}
            options={Object.entries(ORDER_STATUS).map(([value, config]) => ({ value, label: config.label }))}
            style={{ minHeight: 34, width: 190, fontSize: "var(--text-xs)" }}
          />
          <Link to={`/admin/orders/${order.id}`} className="btn btn--ghost btn--sm">
            <Icon name="eye" size={15} /> Abrir
          </Link>
        </RowActions>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Pedidos"
        subtitle="Todos os pedidos recebidos pela loja."
        actions={
          <Button variant="ghost" icon="refresh" onClick={() => void orders.refetch()}>
            Atualizar
          </Button>
        }
      />

      <div className="admin-stats mb-5">
        {(["AWAITING_PAYMENT", "PAID", "PREPARING", "SHIPPED"] as OrderStatus[]).map((key) => (
          <StatCard
            key={key}
            label={ORDER_STATUS[key].label}
            value={statusCounts[key] ?? 0}
            icon={key === "AWAITING_PAYMENT" ? "clock" : key === "PAID" ? "checkCircle" : key === "PREPARING" ? "boxes" : "truck"}
          />
        ))}
      </div>

      <form
        className="admin-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
        }}
      >
        <Input
          label="Buscar"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="NÃºmero do pedido, nome ou e-mail"
          icon="search"
        />
        <Select
          label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as OrderStatus | "");
            setPage(1);
          }}
          placeholder="Todos os status"
          options={Object.entries(ORDER_STATUS).map(([value, config]) => ({ value, label: config.label }))}
        />
        <Select
          label="Pagamento"
          value={paymentMethod}
          onChange={(event) => {
            setPaymentMethod(event.target.value);
            setPage(1);
          }}
          placeholder="Todos"
          options={Object.entries(PAYMENT_METHOD).map(([value, label]) => ({ value, label }))}
        />
        <Button type="submit" variant="ghost" icon="filter">
          Filtrar
        </Button>
      </form>

      <AdminTable
        columns={columns}
        rows={rows}
        loading={orders.isLoading}
        error={orders.error}
        requestId={errorRequestId(orders.error)}
        onRetry={() => void orders.refetch()}
        meta={meta}
        onPageChange={setPage}
        emptyTitle="Nenhum pedido encontrado"
        emptyText="Quando um cliente finalizar uma compra, o pedido aparece aqui."
        emptyIcon="package"
      />
    </div>
  );
}

export { api };

