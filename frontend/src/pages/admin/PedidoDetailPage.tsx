import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Icon, Input, LoadingBlock, Select } from "@/components/ui";
import { AdminPageHeader } from "@/components/admin/kit";
import { useToast } from "@/hooks";
import { applySeo } from "@/lib/seo";
import { api, errorMessage } from "@/lib/api";
import { ORDER_STATUSES_PT } from "@/lib/constants";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { GuestPedido } from "@/types/api";

type PedidoResponse = { success: boolean; pedido: GuestPedido };

/** Detalhe do pedido Guest + controle de status. */
export default function AdminPedidoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["admin", "pedido", id],
    queryFn: () => api.get<PedidoResponse>(`/admin/pedidos/${id}`),
    enabled: Boolean(id),
  });

  const pedido = query.data?.pedido;
  const [status, setStatus] = useState<string>("");
  const [recebidoPor, setRecebidoPor] = useState("");

  useEffect(() => {
    if (pedido) {
      setStatus(pedido.status_atual);
      setRecebidoPor(pedido.recebido_por ?? "");
    }
  }, [pedido]);

  useEffect(() => {
    applySeo({ title: `Pedido #${id ?? ""}`, noindex: true, canonicalPath: `/admin/pedidos/${id ?? ""}` });
  }, [id]);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/admin/pedidos/${id}`, {
        status_atual: status,
        recebido_por: status === "Entregue" ? recebidoPor.trim() : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "pedido", id] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "pedidos"] });
      toast.success("Pedido atualizado");
    },
    onError: (error) => toast.error("Não foi possível salvar", errorMessage(error)),
  });

  if (query.isLoading) return <LoadingBlock label="Carregando pedido…" />;

  if (query.error || !pedido) {
    return (
      <Alert tone="danger" title="Pedido não encontrado">
        {query.error ? errorMessage(query.error) : "Verifique o identificador."}
      </Alert>
    );
  }

  const entregue = status === "Entregue";

  return (
    <>
      <AdminPageHeader
        title={`Pedido #${pedido.id}`}
        subtitle={`Criado em ${formatDateTime(pedido.criado_em)}`}
        actions={
          <Link to="/admin/pedidos" className="btn btn--ghost btn--sm">
            <Icon name="arrowLeft" size={15} /> Voltar
          </Link>
        }
      />

      <div className="stack stack-5" style={{ maxWidth: 880 }}>
        <Card>
          <h3 className="text-lg mb-3">Controle de status</h3>
          <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "var(--space-4)" }}>
            <Select
              label="Status do pedido"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              options={ORDER_STATUSES_PT.map((entry) => ({ value: entry, label: entry }))}
            />
            {entregue ? (
              <Input
                label="Recebido por (obrigatório)"
                value={recebidoPor}
                onChange={(event) => setRecebidoPor(event.target.value)}
                placeholder="Ex.: Porteiro Marcos"
                required
              />
            ) : null}
          </div>

          {entregue && recebidoPor.trim().length < 2 ? (
            <Alert tone="warning">Informe quem recebeu o pedido para salvar como "Entregue".</Alert>
          ) : null}

          <div className="mt-4">
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={entregue && recebidoPor.trim().length < 2}
              icon="check"
            >
              Salvar status
            </Button>
          </div>
        </Card>

        <Card>
          <h3 className="text-lg mb-3">Timeline</h3>
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
          {pedido.data_entrega ? (
            <p className="text-sm text-muted mt-3">
              Entregue em {formatDateTime(pedido.data_entrega)}
              {pedido.recebido_por ? ` — Recebido por: ${pedido.recebido_por}` : ""}
            </p>
          ) : null}
        </Card>

        <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "var(--space-4)" }}>
          <Card>
            <h3 className="text-lg mb-3">Cliente</h3>
            <p className="text-sm text-strong">{pedido.cliente_nome}</p>
            <p className="text-sm text-muted">WhatsApp {pedido.cliente_whatsapp}</p>
            {pedido.endereco_completo ? (
              <p className="text-sm text-muted mt-3">
                {pedido.endereco_completo.logradouro}, {pedido.endereco_completo.numero}
                {pedido.endereco_completo.complemento ? ` — ${pedido.endereco_completo.complemento}` : ""}
                <br />
                {pedido.endereco_completo.bairro}, {pedido.endereco_completo.cidade}/{pedido.endereco_completo.uf}
                <br />
                CEP {pedido.endereco_completo.cep}
              </p>
            ) : null}
          </Card>

          <Card>
            <h3 className="text-lg mb-3">Entrega</h3>
            <p className="text-sm">{pedido.frete_escolhido_nome ?? "—"}</p>
            <p className="text-sm text-muted">{pedido.frete_escolhido_prazo ?? ""}</p>
            <p className="text-sm text-muted">
              {pedido.frete_escolhido_valor ? formatCurrency(pedido.frete_escolhido_valor) : "Grátis"}
            </p>
          </Card>
        </div>

        <Card>
          <h3 className="text-lg mb-3">Itens</h3>
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
          <div className="summary-row mt-3">
            <span className="summary-row__label">Produtos</span>
            <span className="summary-row__value">{formatCurrency(pedido.subtotal)}</span>
          </div>
          <div className="summary-row summary-row--total">
            <span className="summary-row__label">Total</span>
            <span className="summary-row__value">{formatCurrency(pedido.total)}</span>
          </div>
        </Card>
      </div>
    </>
  );
}
