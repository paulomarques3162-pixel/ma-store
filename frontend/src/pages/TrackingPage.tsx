import { useEffect, useState } from "react";
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
  LoadingBlock,
} from "@/components/ui";
import { api, errorMessage, errorRequestId } from "@/lib/api";
import { applySeo } from "@/lib/seo";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { GuestPedido } from "@/types/api";

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
    queryFn: () => api.get<{ success: boolean; pedido: GuestPedido; pixQrCode: string | null }>(`/rastreio/${token}`, { auth: false }),
    enabled: Boolean(token && token.length >= 10),
    retry: false,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const [copiado, setCopiado] = useState(false);

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

  const pedido = query.data?.pedido;

  const copiarPix = async () => {
    if (!pedido?.pagamento_payload) return;
    try {
      await navigator.clipboard.writeText(pedido.pagamento_payload);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* clipboard indisponível: o cliente pode selecionar o texto manualmente */
    }
  };

  if (!pedido) {
    return (
      <div className="container py-12">
        <EmptyState icon="package" title="Pedido não encontrado" text="Confira o link de rastreamento." />
      </div>
    );
  }

  const entregue = pedido.status_atual === "Entregue";

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
                <span className="summary-row__value">
                  {pedido.metodo_pagamento === "PIX" ? "PIX" : "Combinar com a loja"}
                </span>
              </div>
              <div className="summary-row">
                <span className="summary-row__label">Status</span>
                <span className="summary-row__value">{pedido.pagamento_status}</span>
              </div>

              {pedido.metodo_pagamento === "PIX" && pedido.pagamento_payload ? (
                <div className="stack stack-3" style={{ marginTop: "var(--space-4)" }}>
                  {query.data?.pixQrCode ? (
                    <img
                      src={query.data.pixQrCode}
                      alt="QR Code PIX"
                      width={220}
                      height={220}
                      style={{ background: "#fff", borderRadius: 8, padding: 8, alignSelf: "center" }}
                    />
                  ) : null}
                  <label className="field__label" htmlFor="pix-copia-cola">
                    PIX copia e cola
                  </label>
                  <textarea id="pix-copia-cola" className="textarea" readOnly value={pedido.pagamento_payload} rows={3} />
                  <Button size="sm" onClick={() => void copiarPix()} icon="copy">
                    {copiado ? "Copiado!" : "Copiar código PIX"}
                  </Button>
                  <Alert tone="info" title="Confirmação de pagamento">
                    A loja confirma o recebimento do PIX antes de atualizar o status do pedido. Este código não marca o
                    pedido como pago automaticamente.
                  </Alert>
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
                  <span className="tabular text-strong">
                    {formatCurrency(item.preco * item.quantidade)}
                  </span>
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

          <p className="text-xs text-muted">
            Guarde este link: ele é a sua credencial para acompanhar o pedido.
          </p>
        </Card>
      </div>

      <div style={{ height: "var(--space-12)" }} />
    </div>
  );
}
