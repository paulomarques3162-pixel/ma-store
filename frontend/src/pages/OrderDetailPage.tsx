import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Icon,
  LoadingBlock,
  StoreValue,
} from "@/components/ui";
import { ProductImage } from "@/components/ui";
import { useToast } from "@/hooks";
import { CONTENT_KEYS, ORDER_STATUS, ORDER_STATUS_FLOW, PAYMENT_METHOD, PAYMENT_STATUS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { Order, Receipt } from "@/types/api";

/**
 * Detalhe do pedido + comprovante.
 *
 * O comprovante usa os dados IMUTÁVEIS do pedido (snapshots), então o que foi
 * comprado continua correto mesmo se o produto mudar depois.
 */
export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [openingPayment, setOpeningPayment] = useState(false);

  const order = useQuery({
    queryKey: queryKeys.order(id ?? ""),
    queryFn: () => api.get<Order>(`/orders/${id}`),
    enabled: Boolean(id),
  });

  const receipt = useQuery({
    queryKey: queryKeys.receipt(id ?? ""),
    queryFn: () => api.get<Receipt>(`/orders/${id}/receipt`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!order.data) return;
    applySeo({
      title: `Pedido ${order.data.number}`,
      noindex: true,
      canonicalPath: `/meus-pedidos/${order.data.id}`,
    });
  }, [order.data]);

  const cancelOrder = useMutation({
    mutationFn: (reason: string) => api.post(`/orders/${id}/cancel`, { reason }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.order(id ?? "") });
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      setConfirmCancel(false);
      toast.success("Pedido cancelado", "O estoque foi devolvido automaticamente.");
    },
    onError: (error) => toast.error("Não foi possível cancelar", errorMessage(error)),
  });

  /** Cria/reaproveita a intenção de pagamento e mostra as instruções. */
  const openPayment = () => {
    if (!order.data) return;
    setOpeningPayment(true);
    api
      .post<{ paymentId: string; method: string; instructions: string | null; sandbox: boolean }>(
        `/payments/orders/${order.data.id}/intent`,
        { method: order.data.paymentMethod ?? "MANUAL" },
      )
      .then((intent) => {
        if (intent.sandbox) {
          toast.info(
            "Ambiente de testes",
            intent.instructions ?? "Pagamentos de teste não geram cobrança real.",
          );
        } else {
          toast.info("Pagamento iniciado", "Siga as instruções enviadas pela loja.");
        }
        void queryClient.invalidateQueries({ queryKey: queryKeys.order(order.data!.id) });
      })
      .catch((error) => toast.error("Não foi possível iniciar o pagamento", errorMessage(error)))
      .finally(() => setOpeningPayment(false));
  };

  if (order.isLoading) return <LoadingBlock label="Carregando pedido…" />;

  if (order.error || !order.data) {
    return (
      <div className="container py-8">
        <ErrorState
          title="Pedido não encontrado"
          message={errorMessage(order.error) || "Este pedido pode não pertencer à sua conta."}
          requestId={errorRequestId(order.error)}
          onRetry={() => void order.refetch()}
        />
        <div className="text-center">
          <Link to="/meus-pedidos" className="btn btn--ghost">
            Voltar aos meus pedidos
          </Link>
        </div>
      </div>
    );
  }

  const data = order.data;
  const status = ORDER_STATUS[data.status];
  const canCancel = data.status === "AWAITING_PAYMENT" || data.status === "PAYMENT_REVIEW";
  const needsPayment = data.status === "AWAITING_PAYMENT";
  const currentIndex = ORDER_STATUS_FLOW.indexOf(data.status);

  return (
    <div className="container">
      <Breadcrumbs
        items={[
          { label: "Início", to: "/" },
          { label: "Meus pedidos", to: "/meus-pedidos" },
          { label: data.number },
        ]}
      />

      <div className="page-header">
        <div>
          <h1 className="page-header__title">Pedido {data.number}</h1>
          <p className="page-header__subtitle">Criado em {formatDateTime(data.createdAt)}</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="cart-layout">
        <div className="stack stack-5">
          {needsPayment ? (
            <Alert tone="warning" title="Aguardando pagamento">
              Seu pedido foi registrado e o estoque está reservado. Conclua o pagamento para que ele seja preparado.
            </Alert>
          ) : null}

          {/* ------------------------------------------------ STATUS/HISTÓRICO */}
          <Card>
            <h2 className="text-lg mb-4">Acompanhamento</h2>
            <div className="timeline">
              {ORDER_STATUS_FLOW.map((step, index) => {
                const isDone = currentIndex >= index;
                const isCurrent = currentIndex === index;
                return (
                  <div key={step} className="timeline__item">
                    <div className="timeline__marker">
                      <span
                        className={["timeline__dot", isDone ? "timeline__dot--done" : "", isCurrent ? "timeline__dot--current" : ""]
                          .filter(Boolean)
                          .join(" ")}
                      />
                      <span className="timeline__line" />
                    </div>
                    <div className="timeline__body">
                      <p className="timeline__title">{ORDER_STATUS[step].label}</p>
                      <p className="timeline__time">{ORDER_STATUS[step].description}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {data.status === "CANCELED" || data.status === "REFUNDED" ? (
              <Alert tone={data.status === "CANCELED" ? "danger" : "info"} title={ORDER_STATUS[data.status].label}>
                {ORDER_STATUS[data.status].description}
              </Alert>
            ) : null}

            {data.statusHistory && data.statusHistory.length > 0 ? (
              <div className="mt-6">
                <h3 className="field__label">Histórico</h3>
                <div className="stack stack-2 mt-2">
                  {data.statusHistory.map((entry) => (
                    <div key={entry.id} className="row row-between text-sm">
                      <span>
                        {ORDER_STATUS[entry.toStatus].label}
                        {entry.note ? ` — ${entry.note}` : ""}
                      </span>
                      <span className="text-xs text-subtle">{formatDateTime(entry.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          {/* ---------------------------------------------------------- ITENS */}
          <Card>
            <h2 className="text-lg mb-4">Itens do pedido</h2>
            <div className="stack stack-4">
              {(data.items ?? []).map((item) => (
                <div key={item.id} className="row row-3">
                  <span style={{ width: 56, flexShrink: 0, borderRadius: 8, overflow: "hidden", background: "var(--color-surface-2)" }}>
                    <ProductImage src={item.imageSnapshot} alt={item.nameSnapshot} aspectRatio="1 / 1" />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p className="text-sm text-strong clamp-2">{item.nameSnapshot}</p>
                    <p className="text-xs text-muted">
                      SKU {item.skuSnapshot} • {item.quantity}x {formatCurrency(item.unitPrice)}
                    </p>
                  </div>
                  <span className="text-sm text-strong tabular">{formatCurrency(item.total)}</span>
                </div>
              ))}
            </div>
          </Card>

          {/* --------------------------------------------------- ENVIO/RASTREIO */}
          {data.shipment ? (
            <Card>
              <h2 className="text-lg mb-4">Entrega</h2>
              <div className="spec-list">
                {data.shipment.shippingMethod?.name ? (
                  <div className="spec-list__row">
                    <span className="spec-list__label">Modalidade</span>
                    <span className="spec-list__value">{data.shipment.shippingMethod.name}</span>
                  </div>
                ) : null}
                {data.shipment.carrier ? (
                  <div className="spec-list__row">
                    <span className="spec-list__label">Transportadora</span>
                    <span className="spec-list__value">{data.shipment.carrier}</span>
                  </div>
                ) : null}
                {data.shipment.trackingCode ? (
                  <div className="spec-list__row">
                    <span className="spec-list__label">Código de rastreio</span>
                    <span className="spec-list__value">{data.shipment.trackingCode}</span>
                  </div>
                ) : null}
                {data.shipment.shippedAt ? (
                  <div className="spec-list__row">
                    <span className="spec-list__label">Enviado em</span>
                    <span className="spec-list__value">{formatDateTime(data.shipment.shippedAt)}</span>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}

          {/* ---------------------------------------------------- COMPROVANTE */}
          <Card id="comprovante" className="print-area">
            <div className="row row-between row-wrap no-print">
              <h2 className="text-lg">Comprovante</h2>
              <div className="row row-2">
                <Button size="sm" variant="ghost" icon="print" onClick={() => window.print()}>
                  Imprimir
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="download"
                  onClick={() => {
                    toast.info("Salvar como PDF", "Na janela de impressão escolha “Salvar como PDF”.");
                    window.setTimeout(() => window.print(), 400);
                  }}
                >
                  Gerar PDF
                </Button>
              </div>
            </div>

            {receipt.data ? (
              <div className="mt-4">
                <div className="receipt__section">
                  <p className="receipt__section-title">Dados do pedido</p>
                  <div className="receipt__grid">
                    <div>
                      <p className="receipt__label">Número</p>
                      <p className="receipt__value">{receipt.data.number}</p>
                    </div>
                    <div>
                      <p className="receipt__label">Data</p>
                      <p className="receipt__value">{formatDateTime(receipt.data.createdAt)}</p>
                    </div>
                    <div>
                      <p className="receipt__label">Status</p>
                      <p className="receipt__value">{ORDER_STATUS[receipt.data.status].label}</p>
                    </div>
                    <div>
                      <p className="receipt__label">Cliente</p>
                      <p className="receipt__value">{receipt.data.customer.name}</p>
                    </div>
                  </div>
                </div>

                <div className="receipt__section">
                  <p className="receipt__section-title">Entrega</p>
                  <p className="text-sm">
                    {receipt.data.shippingAddress["street"]}, {receipt.data.shippingAddress["number"]}
                    {receipt.data.shippingAddress["complement"] ? ` — ${receipt.data.shippingAddress["complement"]}` : ""}
                    <br />
                    {receipt.data.shippingAddress["district"]}, {receipt.data.shippingAddress["city"]}/
                    {receipt.data.shippingAddress["state"]}
                    <br />
                    CEP {receipt.data.shippingAddress["cep"]}
                  </p>
                </div>

                <div className="receipt__section">
                  <p className="receipt__section-title">Pagamento</p>
                  <p className="text-sm">
                    {receipt.data.paymentMethod ? PAYMENT_METHOD[receipt.data.paymentMethod] : "Não informado"}
                  </p>
                  {receipt.data.payments.map((payment, index) => (
                    <p key={index} className="text-xs text-muted">
                      {PAYMENT_STATUS[payment.status].label} • {formatCurrency(payment.amount)} •{" "}
                      {formatDateTime(payment.createdAt)}
                    </p>
                  ))}
                </div>

                <div className="receipt__totals">
                  <div className="summary-row">
                    <span className="summary-row__label">Subtotal</span>
                    <span className="summary-row__value">{formatCurrency(receipt.data.subtotal)}</span>
                  </div>
                  {receipt.data.discount > 0 ? (
                    <div className="summary-row summary-row--discount">
                      <span className="summary-row__label">
                        Desconto {receipt.data.couponCode ? `(${receipt.data.couponCode})` : ""}
                      </span>
                      <span className="summary-row__value">− {formatCurrency(receipt.data.discount)}</span>
                    </div>
                  ) : null}
                  <div className="summary-row">
                    <span className="summary-row__label">Frete</span>
                    <span className="summary-row__value">
                      {receipt.data.shippingCost === 0 ? "Grátis" : formatCurrency(receipt.data.shippingCost)}
                    </span>
                  </div>
                  <div className="summary-row summary-row--total">
                    <span className="summary-row__label">Total</span>
                    <span className="summary-row__value">{formatCurrency(receipt.data.total)}</span>
                  </div>
                </div>

                <p className="text-xs text-subtle mt-6">
                  Emitido pela loja <StoreValue k={CONTENT_KEYS.storeName} fallback="MA STORE" />. Este documento não é
                  nota fiscal.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted mt-4">Carregando comprovante…</p>
            )}
          </Card>
        </div>

        {/* ------------------------------------------------------- AÇÕES */}
        <Card className="summary-card">
          <h2 className="text-lg">Resumo</h2>

          <div className="stack stack-2">
            <div className="summary-row">
              <span className="summary-row__label">Subtotal</span>
              <span className="summary-row__value">{formatCurrency(data.subtotal)}</span>
            </div>
            {data.discount > 0 ? (
              <div className="summary-row summary-row--discount">
                <span className="summary-row__label">Desconto {data.couponCode ? `(${data.couponCode})` : ""}</span>
                <span className="summary-row__value">− {formatCurrency(data.discount)}</span>
              </div>
            ) : null}
            <div className="summary-row">
              <span className="summary-row__label">Frete</span>
              <span className="summary-row__value">
                {data.shippingCost === 0 ? "Grátis" : formatCurrency(data.shippingCost)}
              </span>
            </div>
            <div className="summary-row summary-row--total">
              <span className="summary-row__label">Total</span>
              <span className="summary-row__value">{formatCurrency(data.total)}</span>
            </div>
          </div>

          <div className="stack stack-2">
            {needsPayment ? (
              <Button block icon="creditCard" onClick={openPayment} loading={openingPayment}>
                Concluir pagamento
              </Button>
            ) : null}

            <Link to="/mensagens" className="btn btn--ghost btn--block">
              <Icon name="message" size={16} /> Falar sobre este pedido
            </Link>

            {canCancel ? (
              <Button variant="ghost" block icon="xCircle" onClick={() => setConfirmCancel(true)}>
                Cancelar pedido
              </Button>
            ) : null}
          </div>

          <Alert tone="info">
            Precisa de ajuda com este pedido? A loja responde pela central de mensagens.
          </Alert>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar pedido"
        message="O pedido será cancelado e o estoque reservado será devolvido. Esta ação não pode ser desfeita."
        confirmLabel="Cancelar pedido"
        cancelLabel="Manter pedido"
        loading={cancelOrder.isPending}
        onConfirm={() => cancelOrder.mutate("Cancelado pelo cliente na página do pedido.")}
        onCancel={() => setConfirmCancel(false)}
      />

      <div style={{ height: "var(--space-12)" }} />
    </div>
  );
}

export { formatCurrency };
