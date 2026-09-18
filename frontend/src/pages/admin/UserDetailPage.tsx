import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, Card, ErrorState, Icon, LoadingBlock } from "@/components/ui";
import { AdminPageHeader } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { ORDER_STATUS, USER_STATUS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatCurrency, formatDateTime, initials, maskCep } from "@/lib/format";
import type { AdminUserDetail, Order } from "@/types/api";

/**
 * Detalhe do usuário.
 *
 * Reforço explícito da regra do projeto: a senha NUNCA é exibida. O que existe
 * é o botão "iniciar redefinição", que gera um link para o próprio cliente.
 */
export default function AdminUserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [devToken, setDevToken] = useState<string | null>(null);

  const user = useQuery({
    queryKey: queryKeys.adminUser(id ?? ""),
    queryFn: () => api.get<AdminUserDetail>(`/admin/users/${id}`),
    enabled: Boolean(id),
  });

  const orders = useQuery({
    queryKey: [...queryKeys.adminUser(id ?? ""), "orders"] as const,
    queryFn: () => api.list<Order[]>(`/admin/users/${id}/orders`, { query: { perPage: 10 } }),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!user.data) return;
    applySeo({ title: user.data.name, noindex: true, canonicalPath: `/admin/usuarios/${id}` });
  }, [user.data, id]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: queryKeys.adminUser(id ?? "") });

  const changeStatus = useMutation({
    mutationFn: (status: "ACTIVE" | "BLOCKED") => api.patch(`/admin/users/${id}/status`, { status }),
    onSuccess: () => {
      invalidate();
      toast.success("Status atualizado");
    },
    onError: (error) => toast.error("Não foi possível alterar", errorMessage(error)),
  });

  const resetPassword = useMutation({
    mutationFn: () => api.post<{ message: string; devToken: string | null }>(`/admin/users/${id}/reset-password`),
    onSuccess: (result) => {
      invalidate();
      setDevToken(result.devToken);
      toast.success("Redefinição iniciada", result.message);
    },
    onError: (error) => toast.error("Não foi possível iniciar a redefinição", errorMessage(error)),
  });

  const revokeSessions = useMutation({
    mutationFn: () => api.post<{ revoked: number }>(`/admin/users/${id}/sessions/revoke`),
    onSuccess: (result) => {
      invalidate();
      toast.success("Sessões encerradas", `${result.revoked} sessão(ões) revogada(s).`);
    },
    onError: (error) => toast.error("Não foi possível revogar", errorMessage(error)),
  });

  if (user.isLoading) return <LoadingBlock label="Carregando usuário…" />;

  if (user.error || !user.data) {
    return (
      <ErrorState
        title="Usuário não encontrado"
        message={errorMessage(user.error)}
        requestId={errorRequestId(user.error)}
        onRetry={() => void user.refetch()}
      />
    );
  }

  const data = user.data;

  return (
    <div>
      <AdminPageHeader
        title={data.name}
        subtitle={data.email}
        actions={
          <>
            <Link to="/admin/usuarios" className="btn btn--ghost">
              <Icon name="arrowLeft" size={16} /> Voltar
            </Link>
            {data.status === "BLOCKED" ? (
              <Button icon="unlock" onClick={() => changeStatus.mutate("ACTIVE")} loading={changeStatus.isPending}>
                Desbloquear
              </Button>
            ) : (
              <Button variant="ghost" icon="lock" onClick={() => changeStatus.mutate("BLOCKED")} loading={changeStatus.isPending}>
                Bloquear
              </Button>
            )}
          </>
        }
      />

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", alignItems: "start" }}>
        <div className="stack stack-5">
          <Card className="stack stack-4">
            <div className="row row-4">
              <span className="empty-state__icon" style={{ margin: 0, background: "var(--color-accent-soft)" }}>
                {initials(data.name)}
              </span>
              <div>
                <p className="text-strong">{data.name}</p>
                <p className="text-sm text-muted">{data.email}</p>
              </div>
            </div>

            <div className="spec-list">
              <div className="spec-list__row">
                <span className="spec-list__label">Telefone</span>
                <span className="spec-list__value">{data.phone ?? "—"}</span>
              </div>
              <div className="spec-list__row">
                <span className="spec-list__label">Status</span>
                <span className="spec-list__value">
                  <Badge tone={USER_STATUS[data.status].tone}>{USER_STATUS[data.status].label}</Badge>
                </span>
              </div>
              <div className="spec-list__row">
                <span className="spec-list__label">Perfil</span>
                <span className="spec-list__value">{data.role === "ADMIN" ? "Administrador" : "Cliente"}</span>
              </div>
              <div className="spec-list__row">
                <span className="spec-list__label">Cadastro</span>
                <span className="spec-list__value">{formatDateTime(data.createdAt)}</span>
              </div>
              <div className="spec-list__row">
                <span className="spec-list__label">Último acesso</span>
                <span className="spec-list__value">{data.lastLoginAt ? formatDateTime(data.lastLoginAt) : "Nunca acessou"}</span>
              </div>
              <div className="spec-list__row">
                <span className="spec-list__label">Pedidos</span>
                <span className="spec-list__value">{data._count.orders}</span>
              </div>
              <div className="spec-list__row">
                <span className="spec-list__label">Total gasto</span>
                <span className="spec-list__value">{formatCurrency(data.totalSpent)}</span>
              </div>
              {data.isDemo ? (
                <div className="spec-list__row">
                  <span className="spec-list__label">Marcação</span>
                  <span className="spec-list__value">
                    <Badge tone="warning">Conta de demonstração</Badge>
                  </span>
                </div>
              ) : null}
            </div>

            <Alert tone="info" title="A senha nunca é exibida">
              Nem o painel nem qualquer pessoa da equipe consegue ver a senha do cliente. Use a redefinição para
              ajudá-lo a recuperar o acesso.
            </Alert>

            <div className="row row-2 row-wrap">
              <Button icon="refresh" onClick={() => resetPassword.mutate()} loading={resetPassword.isPending}>
                Iniciar redefinição de senha
              </Button>
              <Button variant="ghost" icon="logout" onClick={() => revokeSessions.mutate()} loading={revokeSessions.isPending}>
                Encerrar sessões ({data.activeSessions.length})
              </Button>
            </div>

            {devToken ? (
              <Alert tone="warning" title="Link de redefinição gerado (ambiente de desenvolvimento)">
                Em produção o link é enviado por e-mail. Em desenvolvimento, use este token:
                <code
                  style={{
                    display: "block",
                    marginTop: 8,
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--text-xs)",
                    background: "#fff",
                    padding: "8px 10px",
                    borderRadius: 6,
                    overflowWrap: "anywhere",
                  }}
                >
                  {devToken}
                </code>
              </Alert>
            ) : null}
          </Card>

          <Card padded={false}>
            <div className="card__header">
              <h3 className="card__title">Endereços</h3>
            </div>
            <div style={{ padding: "var(--space-5)" }}>
              {data.addresses.length === 0 ? (
                <p className="text-sm text-muted">Nenhum endereço cadastrado.</p>
              ) : (
                <div className="stack stack-3">
                  {data.addresses.map((address) => (
                    <div key={address.id} className="text-sm text-muted">
                      {address.label ? <strong>{address.label} • </strong> : null}
                      {address.street}, {address.number}
                      {address.complement ? ` — ${address.complement}` : ""}
                      <br />
                      {address.district}, {address.city}/{address.state} • CEP {maskCep(address.cep)}
                      {address.isDefault ? " • padrão" : ""}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="stack stack-5">
          <Card padded={false}>
            <div className="card__header">
              <h3 className="card__title">Pedidos recentes</h3>
            </div>
            <div style={{ padding: "var(--space-5)" }}>
              {(orders.data?.data ?? []).length === 0 ? (
                <p className="text-sm text-muted">Este cliente ainda não fez pedidos.</p>
              ) : (
                <div className="stack stack-3">
                  {(orders.data?.data ?? []).map((order) => (
                    <Link key={order.id} to={`/admin/pedidos/${order.id}`} className="row row-between">
                      <span className="text-sm">{order.number}</span>
                      <span className="row row-2">
                        <Badge tone={ORDER_STATUS[order.status].tone}>{ORDER_STATUS[order.status].label}</Badge>
                        <span className="text-sm tabular">{formatCurrency(order.total)}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card padded={false}>
            <div className="card__header">
              <h3 className="card__title">Sessões ativas</h3>
            </div>
            <div style={{ padding: "var(--space-5)" }}>
              {data.activeSessions.length === 0 ? (
                <p className="text-sm text-muted">Nenhuma sessão ativa.</p>
              ) : (
                <div className="stack stack-3">
                  {data.activeSessions.map((session) => (
                    <div key={session.id} className="text-xs text-muted">
                      <div className="truncate">{session.userAgent ?? "Dispositivo desconhecido"}</div>
                      <div>
                        IP {session.ip ?? "—"} • início {formatDateTime(session.createdAt)} • expira {formatDateTime(session.expiresAt)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-subtle mt-3">
                Por segurança, tokens de sessão nunca são exibidos — apenas metadados.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
