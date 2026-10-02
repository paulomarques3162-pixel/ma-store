import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, EmptyState, Icon, LoadingBlock, StatCard } from "@/components/ui";
import { AdminPageHeader } from "@/components/admin/kit";
import { useNotifications, useToast } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatRelative } from "@/lib/format";

/** Notificações do administrador (novos pedidos, mensagens, feedbacks, estoque). */
export default function AdminNotificationsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const notifications = useNotifications();

  useEffect(() => {
    applySeo({ title: "Notificações", noindex: true, canonicalPath: "/admin/notificacoes" });
  }, []);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.setQueryData(queryKeys.notificationsUnread, { unread: 0 });
  };

  const markRead = useMutation({ mutationFn: (id: string) => api.post(`/notifications/${id}/read`), onSuccess: invalidate });
  const markAllRead = useMutation({
    mutationFn: () => api.post("/notifications/read-all"),
    onSuccess: () => {
      invalidate();
      toast.success("Todas as notificações foram marcadas como lidas");
    },
  });

  const items = notifications.data?.data ?? [];
  const unread = items.filter((item) => !item.readAt);

  return (
    <div>
      <AdminPageHeader
        title="Notificações"
        subtitle="Avisos operacionais da loja."
        actions={
          unread.length > 0 ? (
            <Button variant="ghost" icon="check" onClick={() => markAllRead.mutate()} loading={markAllRead.isPending}>
              Marcar todas como lidas
            </Button>
          ) : undefined
        }
      />

      <div className="admin-stats mb-6">
        <StatCard label="Não lidas" value={unread.length} icon="bell" tone={unread.length > 0 ? "warning" : undefined} />
        <StatCard label="Total" value={items.length} icon="clipboard" />
      </div>

      {notifications.isLoading ? (
        <LoadingBlock label="Carregando notificações…" size="md" />
      ) : items.length === 0 ? (
        <EmptyState
          icon="bell"
          title="Nenhuma notificação"
          text="Você será avisado quando um pedido, mensagem, feedback ou alerta de estoque acontecer."
        />
      ) : (
        <div className="stack stack-3">
          {items.map((notification) => (
            <Card key={notification.id} padded={false}>
              <div className="row row-4" style={{ padding: "var(--space-4)" }}>
                <span
                  className="empty-state__icon"
                  style={{
                    width: 42,
                    height: 42,
                    background: notification.readAt ? "var(--color-surface-2)" : "var(--color-accent-soft)",
                  }}
                >
                  <Icon
                    name={
                      notification.type === "ORDER_CREATED"
                        ? "package"
                        : notification.type === "NEW_MESSAGE"
                          ? "messages"
                          : notification.type === "NEW_FEEDBACK"
                            ? "star"
                            : notification.type === "LOW_STOCK"
                              ? "alertTriangle"
                              : "bell"
                    }
                    size={19}
                  />
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row row-between row-wrap">
                    <p className="text-sm text-strong">{notification.title}</p>
                    <span className="text-xs text-subtle">{formatRelative(notification.createdAt)}</span>
                  </div>
                  {notification.body ? <p className="text-sm text-muted mt-1">{notification.body}</p> : null}

                  <div className="row row-2 mt-2 row-wrap">
                    {notification.link ? (
                      <Button size="sm" variant="ghost" onClick={() => navigate(notification.link!)} iconRight="arrowRight">
                        Abrir
                      </Button>
                    ) : null}
                    {!notification.readAt ? (
                      <Button size="sm" variant="ghost" onClick={() => markRead.mutate(notification.id)} icon="check">
                        Marcar como lida
                      </Button>
                    ) : null}
                  </div>
                </div>

                {!notification.readAt ? <Badge tone="accent">Nova</Badge> : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
