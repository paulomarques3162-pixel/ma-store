import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Breadcrumbs,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  Input,
  LoadingBlock,
  Select,
} from "@/components/ui";
import { api, errorMessage, errorRequestId } from "@/lib/api";
import { applySeo } from "@/lib/seo";
import {
  formatCurrency,
  formatDateTime,
  maskCardNumber,
  maskExpiry,
  onlyDigits,
  paymentMethodLabel,
} from "@/lib/format";
import { tokenizeCard } from "@/lib/mercadopago";
import type { GuestPedido } from "@/types/api";

type PaymentMethodOption = {
  id: "PIX" | "CREDIT_CARD" | "BOLETO" | "COMBINAR";
  label: string;
  enabled: boolean;
  configured: boolean;
  gateway: string | null;
  note: string | null;
};

type PaymentMethodsResponse = {
  provider: string;
  environment: string;
  onlinePaymentsEnabled: boolean;
  publicKey: string | null;
  methods: PaymentMethodOption[];
};

const TERMINAL_PAYMENT_STATUSES = ["Pago", "Recusado", "Cancelado", "Expirado", "Reembolsado"];
const RETRY_PAYMENT_STATUSES = ["Recusado", "Cancelado", "Expirado", "Falha", "Divergente"];

/**
 * Rastreamento publico do pedido.
 *
 * O token da URL e a unica credencial — nenhum login e exigido.
 */
export default function TrackingPage() {
  const { token } = useParams<{ token: string }>();

  useEffect(() => {
    applySeo({ title: "Rastrear pedido", noindex: true, canonicalPath: `/rastreio/${token ?? ""}` });
  }, [token]);

  const query = useQuery({
    queryKey: ["tracking", token],
    queryFn: () =>
      api.get<{ success: boolean; pedido: GuestPedido; pixQrCode: string | null }>(`/rastreio/${token}`, { auth: false }),
    enabled: Boolean(token && token.length >= 10),
    retry: false,
    // Atualiza automaticamente enquanto o pagamento nao estiver resolvido.
    refetchInterval: (queryResult) => {
      const status = queryResult.state.data?.pedido?.pagamento_status;
      if (status && TERMINAL_PAYMENT_STATUSES.includes(status)) return false;
      return 15_000;
    },
    refetchOnWindowFocus: true,
  });

  const paymentMethods = useQuery({
    queryKey: ["payment-methods"],
    queryFn: () => api.get<PaymentMethodsResponse>("/payment-methods", { auth: false }),
    staleTime: 5 * 60_000,
  });

  const [copiado, setCopiado] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [retryMetodo, setRetryMetodo] = useState<"PIX" | "CREDIT_CARD" | "BOLETO">("PIX");
  const [cpf, setCpf] = useState("");
  const [card, setCard] = useState({ number: "", name: "", expiry: "", cvv: "", installments: 1 });

  const onlineMethods = useMemo(
    () => (paymentMethods.data?.methods ?? []).filter((method) => method.id !== "COMBINAR" && method.enabled),
    [paymentMethods.data],
  );

  const pedido = query.data?.pedido;

  useEffect(() => {
    const first = onlineMethods[0];
    if (first && first.id !== "COMBINAR") setRetryMetodo(first.id as "PIX" | "CREDIT_CARD" | "BOLETO");
  }, [onlineMethods]);

  if (!token || token.length < 10) {
    return (
      <div className="container py-12">
        <EmptyState
          icon="search"
          title="Link de rastreamento inválido"
          text="Verifique se o endereço foi copiado por completo."
          action={
            <Link to="/" className="btn btn--primary">
              Voltar à loja
            </Link>
          }
        />
      </div>
    );
  }

  if (query.isLoading) return <LoadingBlock label="Buscando seu pedido…" />;

  if (query.error) {
    return (
      <div className="container py-8">
        <ErrorState
          message={errorMessage(query.error)}
          requestId={errorRequestId(query.error)}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  if (!pedido) {
    return (
      <div className="container py-12">
        <EmptyState icon="package" title="Pedido não encontrado" text="Confira o link de rastreamento." />
      </div>
    );
  }

  const copiarPix = async () => {
    if (!pedido.pagamento_payload) return;
    try {
      await navigator.clipboard.writeText(pedido.pagamento_payload);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* clipboard indisponível: o cliente pode selecionar o texto manualmente */
    }
  };

  const retryPayment = async () => {
    if (paying) return;
    setRetryError(null);
    setPaying(true);
    try {
      let cardPayload: { token: string; paymentMethodId?: string; issuerId?: string; installments?: number } | undefined;
      if (retryMetodo === "CREDIT_CARD") {
        const publicKey = paymentMethods.data?.publicKey;
        if (!publicKey) throw new Error("Pagamento por cartão indisponível no momento.");
        const [month, year] = card.expiry.split("/");
        const tokenized = await tokenizeCard(publicKey, {
          cardNumber: card.number,
          cardholderName: card.name.trim(),
          cardExpirationMonth: (month ?? "").trim(),
          cardExpirationYear: (year ?? "").trim(),
          securityCode: card.cvv.trim(),
          identificationType: "CPF",
          identificationNumber: onlyDigits(cpf),
        });
        cardPayload = {
          token: tokenized.id,
          paymentMethodId: tokenized.paymentMethodId,
          issuerId: tokenized.issuerId,
          installments: card.installments,
        };
      }

      const payer =
        retryMetodo === "PIX" ? undefined : { docType: "CPF" as const, docNumber: onlyDigits(cpf) };
      const idempotencyKey =
        globalThis.crypto?.randomUUID?.() ?? `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      await api.post(
        `/pedidos/${token}/pagamento`,
        { metodo: retryMetodo, card: cardPayload, payer, idempotencyKey },
        { auth: false },
      );
      await query.refetch();
    } catch (error) {
      setRetryError(errorMessage(error));
    } finally {
      setPaying(false);
    }
  };

  const entregue = pedido.status_atual === "Entregue";
  const pago = pedido.pagamento_status === "Pago";
  const needsRetry = RETRY_PAYMENT_STATUSES.includes(pedido.pagamento_status);
  const pixQrCode = query.data?.pixQrCode ?? null;
  const pixBase64 = pedido.pagamento_qr_code_base64 ? `data:image/png;base64,${pedido.pagamento_qr_code_base64}` : null;
  const pixImage = pixBase64 ?? pixQrCode;

  return (
    <div className="container">
      <Breadcrumbs items={[{ label: "Início", to: "/" }, { label: "Rastrear pedido" }]} />

      <div className="page-header">
        <div>
          <h1 className="page-header__title">Pedido #{pedido.id}</h1>
          <p className="page-header__subtitle">
            Feito em {formatDateTime(pedido.criado_em)} • {pedido.cliente_nome}
          </p>
        </div>
        <span className="badge badge--accent">{pedido.status_atual}</span>
      </div>

      <div className="cart-layout">
        <div className="stack stack-5">
          <Card>
            <h2 className="text-lg mb-4">Acompanhe seu pedido</h2>

            <div className="checkout-steps" role="list" aria-label="Etapas do pedido">
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

            {entregue ? (
              <Alert tone="success" title="Pedido entregue">
                Entregue em {pedido.data_entrega ? formatDateTime(pedido.data_entrega) : "data não registrada"}
                {pedido.recebido_por ? ` — Recebido por: ${pedido.recebido_por}` : ""}.
              </Alert>
            ) : (
              <p className="text-sm text-muted mt-4">
                Status atual: <strong>{pedido.status_atual}</strong>. Esta página é atualizada automaticamente.
              </p>
            )}
          </Card>

          {pedido.metodo_pagamento ? (
            <Card>
              <h2 className="text-lg mb-4">Pagamento</h2>
              <div className="summary-row">
                <span className="summary-row__label">Forma</span>
                <span className="summary-row__value">{paymentMethodLabel(pedido.metodo_pagamento)}</span>
              </div>
              <div className="summary-row">
                <span className="summary-row__label">Status</span>
                <span className="summary-row__value">{pedido.pagamento_status}</span>
              </div>

              {pedido.pagamento_erro ? (
                <Alert tone="warning" title="Não foi possível gerar a cobrança">
                  {pedido.pagamento_erro}
                </Alert>
              ) : null}

              {pago ? (
                <Alert tone="success" title="Pagamento aprovado!">
                  Recebemos a confirmação do Mercado Pago
                  {pedido.pago_em ? ` em ${formatDateTime(pedido.pago_em)}` : ""}. Seu pedido já entrou em
                  processamento.
                </Alert>
              ) : null}

              {pedido.metodo_pagamento === "PIX" && pedido.pagamento_payload ? (
                <div className="stack stack-3" style={{ marginTop: "var(--space-4)" }}>
                  {pixImage ? (
                    <img
                      src={pixImage}
                      alt="QR Code PIX"
                      width={220}
                      height={220}
                      style={{ background: "#fff", borderRadius: 8, padding: 8, alignSelf: "center", maxWidth: "100%" }}
                    />
                  ) : null}
                  <label className="field__label" htmlFor="pix-copia-cola">
                    PIX copia e cola
                  </label>
                  <textarea id="pix-copia-cola" className="textarea" readOnly value={pedido.pagamento_payload} rows={3} />
                  <Button size="sm" onClick={() => void copiarPix()} icon="copy">
                    {copiado ? "Código PIX copiado!" : "Copiar código PIX"}
                  </Button>
                  {!pago ? (
                    <Alert tone="info" title="Aguardando pagamento">
                      Pague com o QR Code ou o copia e cola acima. A confirmação é automática pelo Mercado Pago — esta
                      página atualiza sozinha.
                    </Alert>
                  ) : null}
                </div>
              ) : null}

              {pedido.metodo_pagamento === "BOLETO" ? (
                <div className="stack stack-3" style={{ marginTop: "var(--space-4)" }}>
                  {pedido.pagamento_boleto_url ? (
                    <a
                      className="btn btn--primary"
                      href={pedido.pagamento_boleto_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir boleto
                    </a>
                  ) : (
                    <Alert tone="warning" title="Boleto indisponível para este pagamento.">
                      Não foi possível emitir o boleto. Escolha outra forma de pagamento.
                    </Alert>
                  )}
                  {pedido.pagamento_boleto_barcode ? (
                    <>
                      <label className="field__label" htmlFor="boleto-linha">
                        Linha digitável
                      </label>
                      <textarea id="boleto-linha" className="textarea" readOnly value={pedido.pagamento_boleto_barcode} rows={2} />
                    </>
                  ) : null}
                  {pedido.pagamento_expira_em ? (
                    <p className="text-sm text-muted">
                      Vencimento: <strong>{formatDateTime(pedido.pagamento_expira_em)}</strong>
                    </p>
                  ) : null}
                </div>
              ) : null}

              {needsRetry && onlineMethods.length > 0 ? (
                <div className="stack stack-3" style={{ marginTop: "var(--space-4)" }}>
                  <Alert tone="warning" title="Pagamento não concluído">
                    {pedido.pagamento_status === "Recusado"
                      ? "O pagamento foi recusado. Você pode tentar novamente sem criar outra cobrança indevida."
                      : "Gere um novo pagamento para concluir a compra."}
                  </Alert>
                  {retryError ? <Alert tone="danger">{retryError}</Alert> : null}
                  <Select
                    label="Forma de pagamento"
                    value={retryMetodo}
                    onChange={(event) => setRetryMetodo(event.target.value as "PIX" | "CREDIT_CARD" | "BOLETO")}
                    options={onlineMethods.map((method) => ({ value: method.id, label: method.label }))}
                  />

                  {retryMetodo === "CREDIT_CARD" ? (
                    <div className="stack stack-3">
                      <Input
                        label="Número do cartão"
                        value={card.number}
                        onChange={(event) => setCard({ ...card, number: maskCardNumber(event.target.value) })}
                        placeholder="0000 0000 0000 0000"
                        inputMode="numeric"
                      />
                      <Input
                        label="Nome impresso no cartão"
                        value={card.name}
                        onChange={(event) => setCard({ ...card, name: event.target.value })}
                      />
                      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "var(--space-4)" }}>
                        <Input
                          label="Validade"
                          value={card.expiry}
                          onChange={(event) => setCard({ ...card, expiry: maskExpiry(event.target.value) })}
                          placeholder="MM/AA"
                          inputMode="numeric"
                        />
                        <Input
                          label="CVV"
                          value={card.cvv}
                          onChange={(event) => setCard({ ...card, cvv: onlyDigits(event.target.value).slice(0, 4) })}
                          placeholder="123"
                          inputMode="numeric"
                        />
                        <Input
                          label="CPF do titular"
                          value={cpf}
                          onChange={(event) => setCpf(event.target.value)}
                          placeholder="000.000.000-00"
                          inputMode="numeric"
                        />
                      </div>
                      <Select
                        label="Parcelas"
                        value={String(card.installments)}
                        onChange={(event) => setCard({ ...card, installments: Number(event.target.value) })}
                        options={Array.from({ length: 6 }, (_, index) => index + 1).map((n) => ({
                          value: String(n),
                          label: `${n}x de ${formatCurrency(pedido.total / n)}${n === 1 ? " (à vista)" : " sem juros"}`,
                        }))}
                      />
                    </div>
                  ) : null}

                  {retryMetodo === "BOLETO" ? (
                    <Input
                      label="CPF/CNPJ do pagador"
                      value={cpf}
                      onChange={(event) => setCpf(event.target.value)}
                      placeholder="000.000.000-00"
                      inputMode="numeric"
                      hint="Obrigatório para emitir o boleto."
                    />
                  ) : null}

                  <Button onClick={() => void retryPayment()} loading={paying} iconRight="check">
                    Gerar pagamento
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}

          <Card>
            <h2 className="text-lg mb-4">Itens do pedido</h2>
            <div className="stack stack-2">
              {pedido.produtos_carrinho.map((item) => (
                <div key={item.id} className="row row-between text-sm">
                  <span>
                    {item.quantidade}x {item.nome}
                  </span>
                  <span className="tabular text-strong">{formatCurrency(item.preco * item.quantidade)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card className="summary-card">
          <h2 className="text-lg">Entrega</h2>

          {pedido.endereco_completo ? (
            <p className="text-sm text-muted">
              {pedido.endereco_completo.logradouro}, {pedido.endereco_completo.numero}
              {pedido.endereco_completo.complemento ? ` — ${pedido.endereco_completo.complemento}` : ""}
              <br />
              {pedido.endereco_completo.bairro}, {pedido.endereco_completo.cidade}/{pedido.endereco_completo.uf}
              <br />
              CEP {pedido.endereco_completo.cep}
            </p>
          ) : null}

          <div className="summary-row">
            <span className="summary-row__label">Modalidade</span>
            <span className="summary-row__value">{pedido.frete_escolhido_nome ?? "—"}</span>
          </div>
          {pedido.frete_transportadora ? (
            <div className="summary-row">
              <span className="summary-row__label">Transportadora</span>
              <span className="summary-row__value">{pedido.frete_transportadora}</span>
            </div>
          ) : null}
          {pedido.frete_servico ? (
            <div className="summary-row">
              <span className="summary-row__label">Serviço</span>
              <span className="summary-row__value">{pedido.frete_servico}</span>
            </div>
          ) : null}
          <div className="summary-row">
            <span className="summary-row__label">Prazo</span>
            <span className="summary-row__value">{pedido.frete_escolhido_prazo ?? "—"}</span>
          </div>
          <div className="summary-row">
            <span className="summary-row__label">Frete</span>
            <span className="summary-row__value">
              {pedido.frete_escolhido_valor === null || pedido.frete_escolhido_valor === 0
                ? "Grátis"
                : formatCurrency(pedido.frete_escolhido_valor)}
            </span>
          </div>

          <div className="summary-row">
            <span className="summary-row__label">Produtos</span>
            <span className="summary-row__value">{formatCurrency(pedido.subtotal)}</span>
          </div>
          <div className="summary-row summary-row--total">
            <span className="summary-row__label">Total</span>
            <span className="summary-row__value">{formatCurrency(pedido.total)}</span>
          </div>

          <p className="text-xs text-muted">Guarde este link: ele é a sua credencial para acompanhar o pedido.</p>
        </Card>
      </div>

      <div style={{ height: "var(--space-12)" }} />
    </div>
  );
}
