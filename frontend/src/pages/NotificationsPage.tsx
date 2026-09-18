import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Breadcrumbs, Button, Card, EmptyState, Icon, LoadingBlock, Skeleton } from "@/components/ui";
import { useNotifications, useToast } from "@/hooks";
import { EMPTY_MESSAGES } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatRelative } from "@/lib/format";
import type { Notification } from "@/types/api";

const ICONS: Record<string, "package" | "creditCard" | "message" | "star" | "bell" | "truck" | "xCircle"> = {
  ORDER_CREATED: "package",
  PAYMENT_APPROVED: "creditCard",
  PAYMENT_DECLINED: "creditCard",
  ORDER_SHIPPED: "truck",
  ORDER_DELIVERED: "package",
  ORDER_CANCELED: "xCircle",
  NEW_MESSAGE: "message",
  NEW_FEEDBACK: "star",
  LOW_STOCK: "bell",
  COUPON: "bell",
  SYSTEM: "bell",
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const notifications = useNotifications();

  useEffect(() => {
    applySeo({ title: "Notificações", noindex: true, canonicalPath: "/notificacoes" });
  }, []);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.notificationsUnread });
  };

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: invalidate,
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post("/notifications/read-all"),
    onSuccess: () => {
      invalidate();
      toast.success("Todas as notificações foram marcadas como lidas");
    },
  });

  const items = notifications.data?.data ?? [];

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Notificações" }]} />

      <div className="page-header">
        <div>
          <h1 className="page-header__title">Notificações</h1>
          <p className="page-header__subtitle">Avisos sobre pedidos, pagamentos e mensagens.</p>
        </div>
        {items.some((item) => !item.readAt) ? (
          <Button variant="ghost" size="sm" icon="check" onClick={() => markAllRead.mutate()} loading={markAllRead.isPending}>
            Marcar todas como lidas
          </Button>
        ) : null}
      </div>

      {notifications.isLoading ? (
        <LoadingBlock label="Carregando notificações…" size="md" />
      ) : items.length === 0 ? (
        <EmptyState icon="bell" title={EMPTY_MESSAGES.notifications.title} text={EMPTY_MESSAGES.notifications.text} />
      ) : (
        <div className="stack stack-3">
          {items.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onRead={() => markRead.mutate(notification.id)}
              onOpen={() => {
                if (!notification.readAt) markRead.mutate(notification.id);
                if (notification.link) navigate(notification.link);
              }}
            />
          ))}
        </div>
      )}

      <div style={{ height: "var(--space-12)" }} />
    </div>
  );
}

function NotificationRow({
  notification,
  onRead,
  onOpen,
}: {
  notification: Notification;
  onRead: () => void;
  onOpen: () => void;
}) {
  const icon = ICONS[notification.type] ?? "bell";

  return (
    <Card
      padded={false}
      className={notification.readAt ? "" : "card--raised"}
      as="article"
    >
      <div className="row row-4" style={{ padding: "var(--space-4)" }}>
        <span
          className="empty-state__icon"
          style={{ width: 42, height: 42, background: notification.readAt ? "var(--color-surface-2)" : "var(--color-accent-soft)" }}
        >
          <Icon name={icon} size={19} />
        </span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row row-between row-wrap">
            <p className="text-sm text-strong">{notification.title}</p>
            <span className="text-xs text-subtle">{formatRelative(notification.createdAt)}</span>
          </div>
          {notification.body ? <p className="text-sm text-muted mt-1">{notification.body}</p> : null}

          <div className="row row-2 mt-2">
            {notification.link ? (
              <Button size="sm" variant="ghost" onClick={onOpen} iconRight="arrowRight">
                Abrir
              </Button>
            ) : null}
            {!notification.readAt ? (
              <Button size="sm" variant="ghost" onClick={onRead} icon="check">
                Marcar como lida
              </Button>
            ) : null}
          </div>
        </div>

        {!notification.readAt ? <span className="badge badge--accent">Nova</span> : null}
      </div>
    </Card>
  );
}

export { Skeleton };
