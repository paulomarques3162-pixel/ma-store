import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Icon, Input, Select } from "@/components/ui";
import { AdminFilterBar, AdminPageHeader, AdminTable, RowActions, type AdminColumn } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { api, errorMessage } from "@/lib/api";
import { ORDER_STATUSES_PT } from "@/lib/constants";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { GuestPedido, PaginationMeta } from "@/types/api";

type AdminPedidoRow = Omit<GuestPedido, "id"> & { id: string };

type PedidosResponse = {
  success: boolean;
  pedidos: GuestPedido[];
  meta: PaginationMeta;
  statuses: string[];
};

/**
 * Pedidos Guest no painel.
 *
 * O layout segue o kit administrativo existente. Cada pedido tem um dropdown
 * com EXATAMENTE os cinco status oficiais. Ao escolher "Entregue", o servidor
 * (e a UI) exige "recebido_por".
 */
export default function AdminPedidosPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    applySeo({ title: "Pedidos", noindex: true, canonicalPath: "/admin/pedidos" });
  }, []);

  const query = useQuery({
    queryKey: ["admin", "pedidos", { search, status, page }],
    queryFn: () =>
      api.get<PedidosResponse>("/admin/pedidos", {
        query: { search: search || undefined, status: status || undefined, page, perPage: 20 },
      }),
    placeholderData: (previous) => previous,
  });

  const updateStatus = useMutation({
    mutationFn: (input: { id: string; status_atual: string; recebido_por?: string }) =>
      api.patch(`/admin/pedidos/${input.id}`, {
        status_atual: input.status_atual,
        recebido_por: input.recebido_por,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "pedidos"] });
      toast.success("Status atualizado");
    },
    onError: (error) => toast.error("Não foi possível alterar o status", errorMessage(error)),
  });

  const handleStatusChange = (pedidoId: string, nextStatus: string) => {
    if (nextStatus === "Entregue") {
      const recebidoPor = window.prompt("Quem recebeu o pedido? (obrigatório)")?.trim();
      if (!recebidoPor) {
        toast.warning("Informe quem recebeu o pedido para marcar como Entregue.");
        return;
      }
      updateStatus.mutate({ id: pedidoId, status_atual: nextStatus, recebido_por: recebidoPor });
      return;
    }
    updateStatus.mutate({ id: pedidoId, status_atual: nextStatus });
  };

  const rows: AdminPedidoRow[] = (query.data?.pedidos ?? []).map((pedido) => ({
    ...pedido,
    id: String(pedido.id),
  }));
  const meta = query.data?.meta;

  const columns: Array<AdminColumn<AdminPedidoRow>> = [
    {
      key: "order",
      header: "Pedido",
      render: (pedido) => (
        <div>
          <Link to={`/admin/pedidos/${pedido.id}`} className="text-sm text-strong">
            #{pedido.id}
          </Link>
          <div className="text-xs text-muted">{formatDateTime(pedido.criado_em)}</div>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Cliente",
      render: (pedido) => (
        <div style={{ minWidth: 0 }}>
          <div className="text-sm clamp-1">{pedido.cliente_nome}</div>
          <div className="text-xs text-muted clamp-1">WhatsApp {pedido.cliente_whatsapp}</div>
        </div>
      ),
    },
    {
      key: "shipping",
      header: "Entrega",
      hideOnMobile: true,
      render: (pedido) => (
        <div>
          <div className="text-sm">{pedido.frete_escolhido_nome ?? "—"}</div>
          <div className="text-xs text-muted">
            {pedido.frete_escolhido_valor ? formatCurrency(pedido.frete_escolhido_valor) : "Grátis"}
          </div>
        </div>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      render: (pedido) => <span className="tabular text-strong">{formatCurrency(pedido.total)}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (pedido) => (
        <Select
          value={pedido.status_atual}
          onChange={(event) => handleStatusChange(pedido.id, event.target.value)}
          options={ORDER_STATUSES_PT.map((entry) => ({ value: entry, label: entry }))}
          aria-label={`Status do pedido #${pedido.id}`}
        />
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (pedido) => (
        <RowActions>
          <Link to={`/admin/pedidos/${pedido.id}`} className="btn btn--ghost btn--sm">
            <Icon name="eye" size={15} /> Detalhes
          </Link>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <AdminPageHeader
        title="Pedidos"
        subtitle="Pedidos do Guest Checkout, com rastreamento público por token."
        actions={
          <Button variant="ghost" icon="refresh" onClick={() => void query.refetch()}>
            Atualizar
          </Button>
        }
      />

      <AdminFilterBar
        onSubmit={() => {
          setPage(1);
          void query.refetch();
        }}
      >
        <Input
          label="Buscar"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Nome, WhatsApp ou token"
        />
        <Select
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          options={[{ value: "", label: "Todos" }, ...ORDER_STATUSES_PT.map((entry) => ({ value: entry, label: entry }))]}
        />
        <Button type="submit" icon="search">
          Filtrar
        </Button>
      </AdminFilterBar>

      <AdminTable<AdminPedidoRow>
        columns={columns}
        rows={rows}
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyTitle="Nenhum pedido encontrado"
        emptyText="Os pedidos criados no checkout aparecerão aqui."
        meta={meta}
        onPageChange={setPage}
      />
    </>
  );
}
