import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  Icon,
  LoadingBlock,
  ProductImage,
  type BadgeTone,
} from "@/components/ui";
import { api } from "@/lib/api";
import { applySeo } from "@/lib/seo";
import { formatCurrency, formatDateTime, paymentMethodLabel } from "@/lib/format";
import { forgetGuestOrder, listGuestOrderTokens } from "@/lib/guestOrders";
import type { GuestPedido } from "@/types/api";

type TrackingResponse = { success: boolean; pedido: GuestPedido; pixQrCode: string | null };

const TERMINAL_PAYMENT_STATUSES = ["Pago", "Recusado", "Cancelado", "Expirado", "Reembolsado"];

const PAYMENT_TONE: Record<string, BadgeTone> = {
  Pago: "success",
  Pendente: "warning",
  "Aguardando Pagamento": "warning",
  Recusado: "danger",
  Cancelado: "danger",
  Expirado: "neutral",
  Reembolsado: "info",
  Divergente: "danger",
  Falha: "danger",
};

/**
 * "Minhas compras" — histórico de pedidos do próprio navegador (Guest Checkout).
 *
 * A loja não exige conta: guardamos localmente apenas os TOKENS dos pedidos
 * deste navegador e buscamos cada um no servidor. Assim o cliente acompanha
 * suas compras sem login e sem expor dados de terceiros.
 */
export default function MyOrdersPage() {
  const [version, setVersion] = useState(0);
  const tokens = useMemo(() => listGuestOrderTokens(), [version]);

  useEffect(() => {
    applySeo({ title: "Minhas compras", noindex: true, canonicalPath: "/minhas-compras" });
  }, []);

  const results = useQueries({
    queries: tokens.map((token) => ({
      queryKey: ["guest-order", token],
      queryFn: () => api.get<TrackingResponse>(`/rastreio/${token}`, { auth: false }),
      retry: false,
      staleTime: 30_000,
      refetchInterval: (query: { state: { data?: TrackingResponse } }) => {
        const status = query.state.data?.pedido?.pagamento_status;
        if (status && TERMINAL_PAYMENT_STATUSES.includes(status)) return false;
        return 20_000;
      },
    })),
  });

  const isLoading = results.some((result) => result.isLoading);
  const orders = results
    .map((result) => result.data?.pedido)
    .filter((pedido): pedido is GuestPedido => Boolean(pedido));
  const failedTokens = results
    .map((result, index) => (result.isError ? tokens[index] : null))
    .filter((token): token is string => Boolean(token));

  const remove = (token: string) => {
    forgetGuestOrder(token);
    setVersion((current) => current + 1);
  };

  return (
    <div className="container py-8">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Minhas compras" }]} />

      <div className="section-header">
        <div>
          <h1 className="section-header__title">Minhas compras</h1>
          <p className="text-sm text-muted">
            Pedidos feitos neste navegador. Guardamos apenas o código de acompanhamento — seus dados ficam no servidor da loja.
          </p>
        </div>
        <Link to="/rastreio" className="btn btn--ghost btn--sm">
          <Icon name="search" size={15} /> Buscar por código
        </Link>
      </div>

      {isLoading && orders.length === 0 ? <LoadingBlock label="Carregando suas compras…" /> : null}

      {!isLoading && tokens.length === 0 ? (
        <EmptyState
          icon="package"
          title="Você ainda não tem compras neste navegador"
          text="Quando você finalizar um pedido, ele aparece aqui para acompanhamento. Se já comprou e tem o código, consulte pelo rastreio."
          action={
            <div className="row row-2">
              <Link to="/produtos" className="btn btn--primary">
                Ver produtos
              </Link>
              <Link to="/rastreio" className="btn btn--ghost">
                Tenho um código
              </Link>
            </div>
          }
        />
      ) : null}

      {failedTokens.length > 0 ? (
        <Alert tone="warning" title="Alguns pedidos não puderam ser carregados">
          O código pode ter sido removido do servidor ou o link está incorreto. Você pode remover estas entradas do histórico.
        </Alert>
      ) : null}

      <div className="stack stack-5 mt-6">
        {orders.map((pedido) => {
          const pago = pedido.pagamento_status === "Pago";
          return (
            <Card key={pedido.token_rastreio_unico} padded={false}>
              <div className="card__header">
                <div>
                  <h2 className="card__title">Pedido #{pedido.id}</h2>
                  <p className="text-xs text-muted">Feito em {formatDateTime(pedido.criado_em)}</p>
                </div>
                <div className="row row-2">
                  <Badge tone={PAYMENT_TONE[pedido.pagamento_status] ?? "neutral"}>{pedido.pagamento_status}</Badge>
                  <Badge tone="info">{pedido.status_atual}</Badge>
                </div>
              </div>

              <div style={{ padding: "var(--space-5)" }}>
                <div className="stack stack-4">
                  {pedido.produtos_carrinho.map((item) => (
                    <div key={item.id} className="row row-3">
                      <span
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 8,
                          overflow: "hidden",
                          flexShrink: 0,
                          background: "var(--color-surface-2)",
                        }}
                      >
                        <ProductImage src={item.imagem ?? null} alt={item.nome} aspectRatio="1 / 1" />
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="text-sm text-strong clamp-1">{item.nome}</div>
                        <div className="text-xs text-muted">
                          {item.quantidade}x {formatCurrency(item.preco)}
                        </div>
                      </div>
                      <span className="text-sm tabular">{formatCurrency(item.preco * item.quantidade)}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-6 stack stack-2" style={{ borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-4)" }}>
                  <div className="summary-row">
                    <span className="summary-row__label">Produtos</span>
                    <span className="summary-row__value">{formatCurrency(pedido.subtotal)}</span>
                  </div>
                  <div className="summary-row">
                    <span className="summary-row__label">
                      {pedido.frete_escolhido_nome ?? "Entrega"}
                      {pedido.frete_escolhido_prazo ? ` · ${pedido.frete_escolhido_prazo}` : ""}
                    </span>
                    <span className="summary-row__value">
                      {pedido.frete_escolhido_valor ? formatCurrency(pedido.frete_escolhido_valor) : "Grátis"}
                    </span>
                  </div>
                  <div className="summary-row summary-row--total">
                    <span className="summary-row__label">Total</span>
                    <span className="summary-row__value">{formatCurrency(pedido.total)}</span>
                  </div>
                </div>

                <div className="mt-5 stack stack-2">
                  <div className="summary-row">
                    <span className="summary-row__label">Pagamento</span>
                    <span className="summary-row__value">{paymentMethodLabel(pedido.metodo_pagamento)}</span>
                  </div>
                  {pago && pedido.pago_em ? (
                    <div className="summary-row">
                      <span className="summary-row__label">Confirmado em</span>
                      <span className="summary-row__value">{formatDateTime(pedido.pago_em)}</span>
                    </div>
                  ) : null}
                  {pedido.data_entrega ? (
                    <div className="summary-row">
                      <span className="summary-row__label">Entregue em</span>
                      <span className="summary-row__value">
                        {formatDateTime(pedido.data_entrega)}
                        {pedido.recebido_por ? ` · ${pedido.recebido_por}` : ""}
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Linha do tempo real do pedido */}
                <div className="checkout-steps mt-5" role="list" aria-label="Etapas do pedido">
                  {pedido.timeline.map((entry) => (
                    <div
                      key={entry.status}
                      role="listitem"
                      className={[
                        "checkout-step",
                        entry.current ? "checkout-step--active" : "",
                        entry.done ? "checkout-step--done" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      aria-current={entry.current ? "step" : undefined}
                    >
                      <span className="checkout-step__num">
                        {entry.done ? <Icon name="check" size={12} /> : entry.current ? "•" : ""}
                      </span>
                      {entry.status}
                    </div>
                  ))}
                </div>

                <div className="row row-2 mt-5" style={{ justifyContent: "flex-end" }}>
                  <Button variant="ghost" size="sm" icon="xCircle" onClick={() => remove(pedido.token_rastreio_unico)}>
                    Remover do histórico
                  </Button>
                  <Link to={`/rastreio/${pedido.token_rastreio_unico}`} className="btn btn--primary btn--sm">
                    {pago ? "Acompanhar pedido" : "Ver pagamento"}
                  </Link>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {tokens.length > 0 && orders.length > 0 ? (
        <p className="text-xs text-muted mt-6">
          O histórico é salvo apenas neste navegador. Ao limpar os dados do navegador, ele é apagado — seus pedidos continuam
          na loja pelo código de rastreio.
        </p>
      ) : null}
    </div>
  );
}
