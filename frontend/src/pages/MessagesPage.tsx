import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Alert,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  Icon,
  Input,
  LoadingBlock,
  Modal,
  Skeleton,
} from "@/components/ui";
import {
  useConversation,
  useConversations,
  useCreateConversation,
  useSendMessage,
  useToast,
} from "@/hooks";
import { EMPTY_MESSAGES } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { errorMessage } from "@/lib/api";
import { formatCurrency, formatDateTime, formatRelative } from "@/lib/format";

/**
 * Central de mensagens do cliente.
 * Se a conversa foi aberta a partir de um pedido (`?pedido=`), vinculamos.
 */
export default function MessagesPage() {
  const [params, setParams] = useSearchParams();
  const conversationId = params.get("c") ?? undefined;
  const orderId = params.get("pedido") ?? undefined;
  const toast = useToast();

  const conversations = useConversations();
  const [newOpen, setNewOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [firstMessage, setFirstMessage] = useState("");
  const createConversation = useCreateConversation();

  useEffect(() => {
    applySeo({ title: "Mensagens", noindex: true, canonicalPath: "/mensagens" });
  }, []);

  // Abre o modal de nova conversa automaticamente quando vem de um pedido.
  useEffect(() => {
    if (orderId && !conversationId) {
      setNewOpen(true);
      setSubject("Dúvida sobre o pedido");
    }
  }, [orderId, conversationId]);

  const items = conversations.data ?? [];
  const activeId = conversationId ?? items[0]?.id;

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Mensagens" }]} />

      <div className="page-header">
        <div>
          <h1 className="page-header__title">Mensagens</h1>
          <p className="page-header__subtitle">Fale com a loja sobre produtos, pedidos e entrega.</p>
        </div>
        <Button icon="plus" onClick={() => setNewOpen(true)}>
          Nova conversa
        </Button>
      </div>

      <div className="messages-layout">
        {/* --------------------------------------------------------- LISTA */}
        <div className="conversation-list">
          {conversations.isLoading ? (
            <>
              <Skeleton height={64} radius={12} />
              <Skeleton height={64} radius={12} />
            </>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted p-4 text-center">Nenhuma conversa ainda.</p>
          ) : (
            items.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={["conversation-item", conversation.id === activeId ? "conversation-item--active" : ""].filter(Boolean).join(" ")}
                onClick={() => setParams({ c: conversation.id })}
              >
                <span className="conversation-item__head">
                  <span className="conversation-item__subject truncate">
                    {conversation.subject ?? "Atendimento"}
                  </span>
                  <span className="conversation-item__time">{formatRelative(conversation.lastMessageAt)}</span>
                </span>
                <span className="conversation-item__preview truncate">
                  {conversation.lastMessage?.body ?? "Sem mensagens"}
                </span>
                <span className="row row-2">
                  {conversation.order ? <span className="badge">Pedido {conversation.order.number}</span> : null}
                  {conversation.unreadForClient > 0 ? <span className="badge badge--accent">{conversation.unreadForClient} nova(s)</span> : null}
                </span>
              </button>
            ))
          )}
        </div>

        {/* ------------------------------------------------------ CONVERSA */}
        {activeId ? (
          <ChatPanel conversationId={activeId} />
        ) : (
          <Card>
            <EmptyState
              icon="messages"
              title={EMPTY_MESSAGES.messages.title}
              text={EMPTY_MESSAGES.messages.text}
              action={<Button onClick={() => setNewOpen(true)}>Iniciar conversa</Button>}
            />
          </Card>
        )}
      </div>

      {/* ------------------------------------------------- NOVA CONVERSA */}
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Nova conversa"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>
              Cancelar
            </Button>
            <Button
              loading={createConversation.isPending}
              disabled={firstMessage.trim().length === 0}
              onClick={() =>
                createConversation.mutate(
                  {
                    subject: subject.trim() || undefined,
                    message: firstMessage.trim(),
                    orderId,
                  },
                  {
                    onSuccess: (created) => {
                      setNewOpen(false);
                      setFirstMessage("");
                      setSubject("");
                      setParams({ c: created.id });
                      toast.success("Conversa iniciada", "A loja vai responder por aqui.");
                    },
                    onError: (error) => toast.error("Não foi possível iniciar a conversa", errorMessage(error)),
                  },
                )
              }
            >
              Enviar mensagem
            </Button>
          </>
        }
      >
        <div className="stack stack-4">
          <Input
            label="Assunto"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Ex.: Dúvida sobre entrega"
            hint="Opcional"
          />
          <div className="field">
            <label className="field__label" htmlFor="first-message">
              Mensagem<span className="req">*</span>
            </label>
            <textarea
              id="first-message"
              className="textarea"
              value={firstMessage}
              onChange={(event) => setFirstMessage(event.target.value)}
              placeholder="Escreva sua dúvida ou solicitação"
              maxLength={4000}
              required
            />
          </div>
          {orderId ? (
            <Alert tone="info">Esta conversa ficará vinculada ao pedido selecionado.</Alert>
          ) : null}
        </div>
      </Modal>

      <div style={{ height: "var(--space-8)" }} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Painel da conversa                                                          */
/* -------------------------------------------------------------------------- */

function ChatPanel({ conversationId }: { conversationId: string }) {
  const { data: conversation, isLoading, error, refetch } = useConversation(conversationId);
  const sendMessage = useSendMessage(conversationId);
  const toast = useToast();
  const [body, setBody] = useState("");
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Rola para a última mensagem quando o conteúdo muda.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [conversation?.messages?.length]);

  const submit = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    sendMessage.mutate(trimmed, {
      onSuccess: () => setBody(""),
      onError: (mutationError) => toast.error("Não foi possível enviar", errorMessage(mutationError)),
    });
  };

  if (isLoading) return <Card><LoadingBlock label="Carregando conversa…" size="md" /></Card>;

  if (error || !conversation) {
    return (
      <Card>
        <Alert tone="danger" title="Não foi possível abrir a conversa">
          {errorMessage(error)}
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </Alert>
      </Card>
    );
  }

  return (
    <div className="chat-panel">
      <header className="chat-panel__header">
        <div>
          <p className="text-strong">{conversation.subject ?? "Atendimento"}</p>
          {conversation.order ? (
            <p className="text-xs text-muted">
              Pedido {conversation.order.number}
              {conversation.order.total !== undefined ? ` • ${formatCurrency(conversation.order.total)}` : ""}
            </p>
          ) : null}
        </div>
        <span className="badge">{conversation.status === "OPEN" ? "Em atendimento" : conversation.status === "RESOLVED" ? "Resolvida" : "Arquivada"}</span>
      </header>

      <div className="chat-panel__body" ref={bodyRef}>
        {(conversation.messages ?? []).map((message) => (
          <div
            key={message.id}
            className={[
              "message-bubble",
              message.senderRole === "CLIENT" ? "message-bubble--mine" : message.senderRole === "SYSTEM" ? "message-bubble--system" : "message-bubble--theirs",
            ].join(" ")}
          >
            <div className="message-bubble__text">{message.body}</div>
            <span className="message-bubble__meta">
              {message.senderRole === "ADMIN" ? (message.authorName ?? "Atendimento") : message.senderRole === "SYSTEM" ? "Sistema" : "Você"}
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
          placeholder="Escreva sua mensagem…"
          aria-label="Escreva sua mensagem"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Button onClick={submit} loading={sendMessage.isPending} disabled={!body.trim()} icon="send" aria-label="Enviar mensagem">
          Enviar
        </Button>
      </div>

      <div className="row row-2 px-4 py-2" style={{ padding: "var(--space-2) var(--space-4)", borderTop: "1px solid var(--color-border)" }}>
        <Icon name="info" size={14} />
        <span className="text-xs text-subtle">Enter envia • Shift + Enter quebra linha</span>
      </div>
    </div>
  );
}
