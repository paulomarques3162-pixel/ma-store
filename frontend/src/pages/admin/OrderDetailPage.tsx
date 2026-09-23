import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  Icon,
  Input,
  LoadingBlock,
  ProductImage,
  Select,
} from "@/components/ui";
import { AdminPageHeader } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { ORDER_STATUS, PAYMENT_METHOD, PAYMENT_STATUS } from "@/lib/constants";
import { applySeo } from "@/lib/seo";
import { api, errorMessage, errorRequestId } from "@/lib/api";
import { queryKeys } from "@/lib/queryClient";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { Order, OrderStatus } from "@/types/api";

type AdminOrder = Order & {
  user: { id: string; name: string; email: string; phone: string | null; createdAt: string };
  statusHistory: Array<{ id: string; toStatus: OrderStatus; note: string | null; createdAt: string; changedBy: { name: string; email: string } | null }>;
  payments: Array<{ id: string; method: string; status: keyof typeof PAYMENT_STATUS; amount: number; provider: string; providerRef: string | null; createdAt: string; approvedAt: string | null; attempts: Array<{ status: string; errorMessage: string | null; createdAt: string }> }>;
};

/** Detalhe do pedido no painel: status, pagamento, envio e comprovante. */
export default function AdminOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [nextStatus, setNextStatus] = useState<OrderStatus | "">("");
  const [note, setNote] = useState("");
  const [trackingCode, setTrackingCode] = useState("");
  const [carrier, setCarrier] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);

  const order = useQuery({
    queryKey: queryKeys.adminOrder(id ?? ""),
    queryFn: () => api.get<AdminOrder>(`/admin/orders/${id}`),
    enabled: Boolean(id),
  });

  const receipt = useQuery({
    queryKey: [...queryKeys.adminOrder(id ?? ""), "receipt"] as const,
    queryFn: () => api.get<AdminOrder & { customer: { name: string; email: string } }>(`/admin/orders/${id}/receipt`),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!order.data) return;
    applySeo({ title: `Pedido ${order.data.number}`, noindex: true, canonicalPath: `/admin/orders/${id}` });
    setTrackingCode(order.data.shipment?.trackingCode ?? "");
    setCarrier(order.data.shipment?.carrier ?? "");
  }, [order.data, id]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminOrder(id ?? "") });
    void queryClient.invalidateQueries({ queryKey: ["admin", "orders"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminDashboard });
  };

  const updateStatus = useMutation({
    mutationFn: (payload: { status: OrderStatus; note?: string; trackingCode?: string; carrier?: string }) =>
      api.patch(`/admin/orders/${id}/status`, payload),
    onSuccess: () => {
      invalidate();
      setNextStatus("");
      setNote("");
      toast.success("Status atualizado", "O cliente foi notificado automaticamente.");
    },
    onError: (error) => toast.error("NÃ£o foi possÃ­vel alterar o status", errorMessage(error)),
  });

  const cancelOrder = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/orders/${id}/cancel`, { note: reason }),
    onSuccess: () => {
      invalidate();
      setConfirmCancel(false);
      toast.success("Pedido cancelado", "O estoque foi devolvido.");
    },
    onError: (error) => toast.error("NÃ£o foi possÃ­vel cancelar", errorMessage(error)),
  });

  const expirePayments = useMutation({
    mutationFn: () => api.post<{ expired: number }>("/admin/payments/expire-stale"),
    onSuccess: (result) => {
      invalidate();
      toast.success("Pagamentos vencidos processados", `${result.expired} pagamento(s) expirado(s).`);
    },
    onError: (error) => toast.error("NÃ£o foi possÃ­vel processar", errorMessage(error)),
  });

  if (order.isLoading) return <LoadingBlock label="Carregando pedidoâ€¦" />;

  if (order.error || !order.data) {
    return (
      <ErrorState
        title="Pedido nÃ£o encontrado"
        message={errorMessage(order.error)}
        requestId={errorRequestId(order.error)}
        onRetry={() => void order.refetch()}
      />
    );
  }

  const data = order.data;
  const canCancel = !["CANCELED", "REFUNDED", "DELIVERED"].includes(data.status);

  return (
    <div>
      <AdminPageHeader
        title={`Pedido ${data.number}`}
        subtitle={`Criado em ${formatDateTime(data.createdAt)} â€¢ ${data.user?.name ?? ""}`}
        actions={
          <>
            <Link to="/admin/pedidos" className="btn btn--ghost">
              <Icon name="arrowLeft" size={16} /> Voltar
            </Link>
            <Badge tone={ORDER_STATUS[data.status].tone}>{ORDER_STATUS[data.status].label}</Badge>
          </>
        }
      />

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", alignItems: "start" }}>
        <div className="stack stack-5">
          {/* ------------------------------------------------------- ITENS */}
          <Card padded={false}>
            <div className="card__header">
              <h3 className="card__title">Itens</h3>
              <span className="text-sm text-muted">{data.items?.length ?? 0} item(ns)</span>
            </div>
            <div style={{ padding: "var(--space-5)" }}>
              <div className="stack stack-4">
                {(data.items ?? []).map((item) => (
                  <div key={item.id} className="row row-3">
                    <span style={{ width: 48, height: 48, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: "var(--color-surface-2)" }}>
                      <ProductImage src={item.imageSnapshot} alt={item.nameSnapshot} aspectRatio="1 / 1" />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="text-sm text-strong clamp-1">{item.nameSnapshot}</div>
                      <div className="text-xs text-muted">
                        SKU {item.skuSnapshot} â€¢ {item.quantity}x {formatCurrency(item.unitPrice)}
                      </div>
                    </div>
                    <span className="text-sm tabular">{formatCurrency(item.total)}</span>
                  </div>
                ))}
              </div>

              <div className="mt-6 stack stack-2" style={{ borderTop: "1px solid var(--color-border)", paddingTop: "var(--space-4)" }}>
                <div className="summary-row">
                  <span className="summary-row__label">Subtotal</span>
                  <span className="summary-row__value">{formatCurrency(data.subtotal)}</span>
                </div>
                {data.discount > 0 ? (
                  <div className="summary-row summary-row--discount">
                    <span className="summary-row__label">Desconto {data.couponCode ? `(${data.couponCode})` : ""}</span>
                    <span className="summary-row__value">âˆ’ {formatCurrency(data.discount)}</span>
                  </div>
                ) : null}
                <div className="summary-row">
                  <span className="summary-row__label">Frete</span>
                  <span className="summary-row__value">
                    {data.shippingCost === 0 ? "GrÃ¡tis" : formatCurrency(data.shippingCost)}
                  </span>
                </div>
                <div className="summary-row summary-row--total">
                  <span className="summary-row__label">Total</span>
                  <span className="summary-row__value">{formatCurrency(data.total)}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* ---------------------------------------------------- HISTÃ“RICO */}
          <Card padded={false}>
            <div className="card__header">
              <h3 className="card__title">HistÃ³rico de status</h3>
            </div>
            <div style={{ padding: "var(--space-5)" }}>
              <div className="timeline">
                {data.statusHistory?.map((entry) => (
                  <div key={entry.id} className="timeline__item">
                    <div className="timeline__marker">
                      <span className="timeline__dot timeline__dot--done" />
                      <span className="timeline__line" />
                    </div>
                    <div className="timeline__body">
                      <p className="timeline__title">{ORDER_STATUS[entry.toStatus].label}</p>
                      <p className="timeline__time">
                        {formatDateTime(entry.createdAt)}
                        {entry.changedBy ? ` â€¢ por ${entry.changedBy.name}` : " â€¢ pelo sistema"}
                      </p>
                      {entry.note ? <p className="timeline__note">{entry.note}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* ---------------------------------------------------- PAGAMENTO */}
          <Card padded={false}>
            <div className="card__header">
              <h3 className="card__title">Pagamentos</h3>
              <Button size="sm" variant="ghost" icon="refresh" onClick={() => expirePayments.mutate()} loading={expirePayments.isPending}>
                Expirar vencidos
              </Button>
            </div>
            <div style={{ padding: "var(--space-5)" }}>
              {(data.payments ?? []).length === 0 ? (
                <p className="text-sm text-muted">Nenhum pagamento registrado.</p>
              ) : (
                <div className="stack stack-4">
                  {(data.payments ?? []).map((payment) => (
                    <div key={payment.id} className="stack stack-2">
                      <div className="row row-between row-wrap">
                        <div>
                          <div className="text-sm text-strong">
                            {PAYMENT_METHOD[payment.method as keyof typeof PAYMENT_METHOD] ?? payment.method}
                          </div>
                          <div className="text-xs text-muted">
                            {payment.provider} â€¢ ref {payment.providerRef ?? "â€”"} â€¢ {formatDateTime(payment.createdAt)}
                          </div>
                        </div>
                        <div className="row row-3">
                          <Badge tone={PAYMENT_STATUS[payment.status].tone}>{PAYMENT_STATUS[payment.status].label}</Badge>
                          <span className="text-sm tabular">{formatCurrency(payment.amount)}</span>
                        </div>
                      </div>

                      {(payment.attempts ?? []).length > 0 ? (
                        <div className="stack stack-1" style={{ paddingLeft: "var(--space-3)", borderLeft: "2px solid var(--color-border)" }}>
                          {(payment.attempts ?? []).map((attempt, index) => (
                            <div key={index} className="text-xs text-muted">
                              {formatDateTime(attempt.createdAt)} â€¢ {attempt.status}
                              {attempt.errorMessage ? ` â€¢ ${attempt.errorMessage}` : ""}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="stack stack-5">
          {/* ------------------------------------------------ MUDAR STATUS */}
          <Card className="stack stack-4">
            <h3 className="card__title">Alterar status</h3>

            <Select
              label="Novo status"
              value={nextStatus}
              onChange={(event) => setNextStatus(event.target.value as OrderStatus)}
              placeholder="Selecione o novo status"
              options={Object.entries(ORDER_STATUS).map(([value, config]) => ({ value, label: config.label }))}
            />

            <Input
              label="ObservaÃ§Ã£o"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Ex.: pagamento confirmado manualmente"
              hint="Aparece no histÃ³rico e na notificaÃ§Ã£o do cliente."
            />

            {nextStatus === "SHIPPED" ? (
              <>
                <Input
                  label="CÃ³digo de rastreio"
                  value={trackingCode}
                  onChange={(event) => setTrackingCode(event.target.value)}
                  placeholder="Ex.: BR123456789"
                />
                <Input
                  label="Transportadora"
                  value={carrier}
                  onChange={(event) => setCarrier(event.target.value)}
                  placeholder="Ex.: Correios"
                />
              </>
            ) : null}

            <Button
              block
              loading={updateStatus.isPending}
              disabled={!nextStatus || nextStatus === data.status}
              onClick={() =>
                nextStatus &&
                updateStatus.mutate({
                  status: nextStatus,
                  note: note || undefined,
                  trackingCode: trackingCode || undefined,
                  carrier: carrier || undefined,
                })
              }
              icon="check"
            >
              Salvar status
            </Button>

            <Alert tone="info">
              TransiÃ§Ãµes invÃ¡lidas sÃ£o bloqueadas pelo sistema e o cliente Ã© notificado em cada mudanÃ§a.
            </Alert>

            {canCancel ? (
              <Button variant="ghost" block icon="xCircle" onClick={() => setConfirmCancel(true)}>
                Cancelar pedido
              </Button>
            ) : null}
          </Card>

          {/* ------------------------------------------------------ CLIENTE */}
          <Card className="stack stack-3">
            <h3 className="card__title">Cliente</h3>
            <div className="text-sm">
              <Link to={`/admin/usuarios/${data.user?.id}`} className="text-strong">
                {data.user?.name}
              </Link>
              <p className="text-muted">{data.user?.email}</p>
              {data.user?.phone ? <p className="text-muted">{data.user.phone}</p> : null}
            </div>
            <div className="row row-2">
              <Link to="/admin/mensagens" className="btn btn--ghost btn--sm">
                <Icon name="message" size={15} /> Enviar mensagem
              </Link>
            </div>
          </Card>

          {/* ------------------------------------------------------ ENTREGA */}
          <Card className="stack stack-3">
            <h3 className="card__title">Entrega</h3>
            {data.shippingAddress ? (
              <p className="text-sm text-muted">
                {String(data.shippingAddress["street"] ?? "")}, {String(data.shippingAddress["number"] ?? "")}
                {data.shippingAddress["complement"] ? ` â€” ${String(data.shippingAddress["complement"])}` : ""}
                <br />
                {String(data.shippingAddress["district"] ?? "")}, {String(data.shippingAddress["city"] ?? "")}/
                {String(data.shippingAddress["state"] ?? "")}
                <br />
                CEP {String(data.shippingAddress["cep"] ?? "")}
              </p>
            ) : (
              <p className="text-sm text-muted">EndereÃ§o nÃ£o informado.</p>
            )}

            <div className="spec-list">
              <div className="spec-list__row">
                <span className="spec-list__label">MÃ©todo</span>
                <span className="spec-list__value">
                  {PAYMENT_METHOD[data.paymentMethod as keyof typeof PAYMENT_METHOD] ?? "â€”"}
                </span>
              </div>
              {data.shipment?.shippingMethod?.name ? (
                <div className="spec-list__row">
                  <span className="spec-list__label">Frete</span>
                  <span className="spec-list__value">{data.shipment.shippingMethod.name}</span>
                </div>
              ) : null}
              {data.shipment?.trackingCode ? (
                <div className="spec-list__row">
                  <span className="spec-list__label">Rastreio</span>
                  <span className="spec-list__value">{data.shipment.trackingCode}</span>
                </div>
              ) : null}
            </div>
          </Card>

          {/* -------------------------------------------------- COMPROVANTE */}
          <Card className="stack stack-3 print-area">
            <div className="row row-between no-print">
              <h3 className="card__title">Comprovante</h3>
              <Button size="sm" variant="ghost" icon="print" onClick={() => window.print()}>
                Imprimir
              </Button>
            </div>
            {receipt.data ? (
              <div className="text-sm text-muted">
                <p className="text-strong">{receipt.data.number}</p>
                <p>{formatDateTime(receipt.data.createdAt)}</p>
                <p>{receipt.data.customer?.name}</p>
                <p>{formatCurrency(receipt.data.total)}</p>
              </div>
            ) : (
              <p className="text-sm text-muted">Carregandoâ€¦</p>
            )}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        title="Cancelar pedido"
        message="O estoque serÃ¡ devolvido e o cliente notificado. Se o pedido jÃ¡ foi pago, o valor precisa ser reembolsado pelo meio de pagamento."
        confirmLabel="Cancelar pedido"
        loading={cancelOrder.isPending}
        onConfirm={() => cancelOrder.mutate("Cancelado pelo painel administrativo.")}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}

