import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Card, EmptyState, Icon, Input, LoadingBlock, Select } from "@/components/ui";
import { AdminPageHeader } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { CONVERSATION_STATUS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatCurrency, formatDateTime, formatRelative } from "@/lib/format";
import type { Conversation, Message } from "@/types/api";

type AdminConversation = Conversation & {
  user: { id: string; name: string; email: string };
  order: { number: string } | null;
};

/** Central de atendimento (help desk) do painel. */
export default function AdminMessagesPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    applySeo({ title: "Mensagens", noindex: true, canonicalPath: "/admin/mensagens" });
  }, []);

  const conversations = useQuery({
    queryKey: queryKeys.adminConversations({ search, status, page }),
    queryFn: () =>
      api.list<AdminConversation[]>("/admin/conversations", {
        query: { search: search || undefined, status: status || undefined, page, perPage: 20 },
      }),
    placeholderData: (previous) => previous,
  });

  const items = conversations.data?.data ?? [];
  const currentId = activeId ?? items[0]?.id ?? null;

  const conversation = useQuery({
    queryKey: queryKeys.adminConversation(currentId ?? ""),
    queryFn: () => api.get<AdminConversation & { messages: Message[] }>(`/admin/conversations/${currentId}`),
    enabled: Boolean(currentId),
    refetchInterval: 30_000,
  });

  const setConversationStatus = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: "OPEN" | "ARCHIVED" | "RESOLVED" }) =>
      api.patch(`/admin/conversations/${id}/status`, { status: nextStatus }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "conversations"] });
      toast.success("Status da conversa atualizado");
    },
    onError: (error) => toast.error("Não foi possível alterar", errorMessage(error)),
  });

  return (
    <div>
      <AdminPageHeader
        title="Mensagens"
        subtitle="Responda os clientes e acompanhe o histórico de cada conversa."
        actions={
          <Button variant="ghost" icon="refresh" onClick={() => void conversations.refetch()}>
            Atualizar
          </Button>
        }
      />

      <form className="admin-filters" onSubmit={(event) => event.preventDefault()}>
        <Input
          label="Buscar"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Cliente, e-mail ou assunto"
          icon="search"
        />
        <Select
          label="Status"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          placeholder="Todos"
          options={Object.entries(CONVERSATION_STATUS).map(([value, config]) => ({ value, label: config.label }))}
        />
      </form>

      <div className="messages-layout">
        <div className="conversation-list">
          {conversations.isLoading ? (
            <LoadingBlock size="md" label="Carregando…" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted p-4 text-center">Nenhuma conversa encontrada.</p>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={["conversation-item", item.id === currentId ? "conversation-item--active" : ""].filter(Boolean).join(" ")}
                onClick={() => setActiveId(item.id)}
              >
                <span className="conversation-item__head">
                  <span className="conversation-item__subject truncate">{item.user?.name ?? "Cliente"}</span>
                  <span className="conversation-item__time">{formatRelative(item.lastMessageAt)}</span>
                </span>
                <span className="conversation-item__preview truncate">
                  {item.lastMessage?.body ?? item.subject ?? "Sem mensagens"}
                </span>
                <span className="row row-2 row-wrap">
                  <Badge tone={CONVERSATION_STATUS[item.status].tone}>{CONVERSATION_STATUS[item.status].label}</Badge>
                  {item.order ? <span className="badge">Pedido {item.order.number}</span> : null}
                  {item.unreadForAdmin > 0 ? <span className="badge badge--danger">{item.unreadForAdmin} não lida(s)</span> : null}
                </span>
              </button>
            ))
          )}
        </div>

        {currentId ? (
          <AdminChatPanel
            conversationId={currentId}
            data={conversation.data}
            loading={conversation.isLoading}
            error={conversation.error}
            onRetry={() => void conversation.refetch()}
            onChangeStatus={(nextStatus) => setConversationStatus.mutate({ id: currentId, nextStatus })}
          />
        ) : (
          <Card>
            <EmptyState icon="messages" title="Nenhuma conversa selecionada" text="Escolha uma conversa na lista ao lado." />
          </Card>
        )}
      </div>
    </div>
  );
}

function AdminChatPanel({
  conversationId,
  data,
  loading,
  error,
  onRetry,
  onChangeStatus,
}: {
  conversationId: string;
  data?: AdminConversation & { messages: Message[] };
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onChangeStatus: (status: "OPEN" | "ARCHIVED" | "RESOLVED") => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");

  const send = useMutation({
    mutationFn: () => api.post<Message>(`/admin/conversations/${conversationId}/messages`, { body }),
    onSuccess: () => {
      setBody("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminConversation(conversationId) });
      void queryClient.invalidateQueries({ queryKey: ["admin", "conversations"] });
    },
    onError: (mutationError) => toast.error("Não foi possível enviar", errorMessage(mutationError)),
  });

  if (loading) return <Card><LoadingBlock label="Carregando conversa…" size="md" /></Card>;

  if (error || !data) {
    return (
      <Card>
        <p className="text-sm" style={{ color: "var(--color-danger)" }}>
          {errorMessage(error)}
          {errorRequestId(error) ? ` (código ${errorRequestId(error)})` : ""}
        </p>
        <Button variant="ghost" size="sm" className="mt-2" onClick={onRetry}>
          Tentar novamente
        </Button>
      </Card>
    );
  }

  return (
    <div className="chat-panel">
      <header className="chat-panel__header">
        <div>
          <p className="text-strong">{data.user?.name}</p>
          <p className="text-xs text-muted">{data.user?.email}</p>
          {data.order ? (
            <Link to="/admin/pedidos" className="text-xs text-muted">
              Pedido {data.order.number}
              {"total" in data.order && typeof data.order.total === "number" ? ` • ${formatCurrency(data.order.total)}` : ""}
            </Link>
          ) : null}
        </div>

        <div className="row row-2">
          <Select
            aria-label="Status da conversa"
            value={data.status}
            onChange={(event) => onChangeStatus(event.target.value as "OPEN" | "ARCHIVED" | "RESOLVED")}
            options={Object.entries(CONVERSATION_STATUS).map(([value, config]) => ({ value, label: config.label }))}
            style={{ minHeight: 34, fontSize: "var(--text-xs)", width: 150 }}
          />
        </div>
      </header>

      <div className="chat-panel__body">
        {data.messages.map((message) => (
          <div
            key={message.id}
            className={[
              "message-bubble",
              message.senderRole === "ADMIN" ? "message-bubble--mine" : message.senderRole === "SYSTEM" ? "message-bubble--system" : "message-bubble--theirs",
            ].join(" ")}
          >
            <div className="message-bubble__text">{message.body}</div>
            <span className="message-bubble__meta">
              {message.senderRole === "ADMIN" ? (message.authorName ?? "Atendimento") : data.user?.name}
              {" • "}
              {formatDateTime(message.createdAt)}
            </span>
          </div>
        ))}
      </div>

      <div className="chat-panel__footer">
        <textarea
          className="textarea"
          style={{ minHeight: 46, maxHeight: 140 }}
          value={body}
          placeholder="Escreva a resposta…"
          aria-label="Resposta ao cliente"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (body.trim()) send.mutate();
            }
          }}
        />
        <Button onClick={() => body.trim() && send.mutate()} loading={send.isPending} disabled={!body.trim()} icon="send">
          Responder
        </Button>
      </div>

      <div style={{ padding: "var(--space-2) var(--space-4)", borderTop: "1px solid var(--color-border)" }}>
        <span className="text-xs text-subtle">
          <Icon name="info" size={12} /> A resposta notifica o cliente automaticamente.
        </span>
      </div>
    </div>
  );
}
