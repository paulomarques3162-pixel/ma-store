import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, ConfirmDialog, Icon, Input, Select } from "@/components/ui";
import { AdminPageHeader, AdminTable, RowActions, type AdminColumn } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { USER_STATUS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatCurrency, formatDateTime, initials } from "@/lib/format";
import type { AdminUser } from "@/types/api";

/** Gestão de usuários — o painel NUNCA exibe senha. */
export default function AdminUsersPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [page, setPage] = useState(1);
  const [blockTarget, setBlockTarget] = useState<AdminUser | null>(null);

  useEffect(() => {
    applySeo({ title: "Usuários", noindex: true, canonicalPath: "/admin/usuarios" });
  }, []);

  const users = useQuery({
    queryKey: queryKeys.adminUsers({ search, statusFilter, roleFilter, page }),
    queryFn: () =>
      api.list<AdminUser[]>("/admin/users", {
        query: {
          search: search || undefined,
          status: statusFilter || undefined,
          role: roleFilter || undefined,
          page,
          perPage: 20,
        },
      }),
    placeholderData: (previous) => previous,
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "ACTIVE" | "BLOCKED" }) =>
      api.patch(`/admin/users/${id}/status`, { status }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
      setBlockTarget(null);
      toast.success(variables.status === "BLOCKED" ? "Usuário bloqueado" : "Usuário desbloqueado", "As sessões ativas foram revogadas.");
    },
    onError: (error) => toast.error("Não foi possível alterar o status", errorMessage(error)),
  });

  const columns: Array<AdminColumn<AdminUser>> = [
    {
      key: "user",
      header: "Usuário",
      render: (user) => (
        <div className="row row-3">
          <span
            className="empty-state__icon"
            style={{ width: 38, height: 38, fontSize: "var(--text-xs)", fontWeight: 600, background: "var(--color-accent-soft)" }}
          >
            {initials(user.name)}
          </span>
          <div style={{ minWidth: 0 }}>
            <Link to={`/admin/usuarios/${user.id}`} className="text-sm text-strong clamp-1">
              {user.name}
            </Link>
            <div className="text-xs text-muted clamp-1">{user.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: "phone",
      header: "Telefone",
      hideOnMobile: true,
      render: (user) => <span className="text-sm text-muted">{user.phone ?? "—"}</span>,
    },
    {
      key: "orders",
      header: "Pedidos",
      align: "right",
      render: (user) => <span className="text-sm">{user.ordersCount}</span>,
    },
    {
      key: "spent",
      header: "Total gasto",
      align: "right",
      render: (user) => <span className="text-sm text-strong tabular">{formatCurrency(user.totalSpent)}</span>,
    },
    {
      key: "role",
      header: "Perfil",
      render: (user) => <Badge tone={user.role === "ADMIN" ? "accent" : "neutral"}>{user.role === "ADMIN" ? "Administrador" : "Cliente"}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      render: (user) => <Badge tone={USER_STATUS[user.status].tone}>{USER_STATUS[user.status].label}</Badge>,
    },
    {
      key: "lastLogin",
      header: "Último acesso",
      hideOnMobile: true,
      render: (user) => (
        <span className="text-xs text-muted">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "Nunca acessou"}</span>
      ),
    },
    {
      key: "actions",
      header: "Ações",
      align: "right",
      render: (user) => (
        <RowActions>
          <Link to={`/admin/usuarios/${user.id}`} className="btn btn--ghost btn--sm">
            <Icon name="eye" size={15} /> Ver
          </Link>
          {user.status === "BLOCKED" ? (
            <Button size="sm" variant="ghost" icon="unlock" onClick={() => changeStatus.mutate({ id: user.id, status: "ACTIVE" })}>
              Desbloquear
            </Button>
          ) : (
            <Button size="sm" variant="ghost" icon="lock" onClick={() => setBlockTarget(user)}>
              Bloquear
            </Button>
          )}
        </RowActions>
      ),
    },
  ];

  return (
    <div>
      <AdminPageHeader
        title="Usuários"
        subtitle={`${users.data?.meta?.total ?? 0} contas cadastradas`}
        actions={
          <Button variant="ghost" icon="refresh" onClick={() => void users.refetch()}>
            Atualizar
          </Button>
        }
      />

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
          placeholder="Nome, e-mail ou telefone"
          icon="search"
        />
        <Select
          label="Status"
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value);
            setPage(1);
          }}
          placeholder="Todos"
          options={Object.entries(USER_STATUS).map(([value, config]) => ({ value, label: config.label }))}
        />
        <Select
          label="Perfil"
          value={roleFilter}
          onChange={(event) => {
            setRoleFilter(event.target.value);
            setPage(1);
          }}
          placeholder="Todos"
          options={[
            { value: "CLIENT", label: "Clientes" },
            { value: "ADMIN", label: "Administradores" },
          ]}
        />
        <Button type="submit" variant="ghost" icon="filter">
          Filtrar
        </Button>
      </form>

      <AdminTable
        columns={columns}
        rows={users.data?.data ?? []}
        loading={users.isLoading}
        error={users.error}
        requestId={errorRequestId(users.error)}
        onRetry={() => void users.refetch()}
        meta={users.data?.meta}
        onPageChange={setPage}
        emptyTitle="Nenhum usuário encontrado"
        emptyText="Ajuste os filtros para ver outras contas."
        emptyIcon="users"
      />

      <ConfirmDialog
        open={Boolean(blockTarget)}
        title="Bloquear usuário"
        message={`"${blockTarget?.name}" não conseguirá entrar e todas as sessões ativas serão encerradas imediatamente.`}
        confirmLabel="Bloquear"
        onConfirm={() => blockTarget && changeStatus.mutate({ id: blockTarget.id, status: "BLOCKED" })}
        onCancel={() => setBlockTarget(null)}
      />
    </div>
  );
}
