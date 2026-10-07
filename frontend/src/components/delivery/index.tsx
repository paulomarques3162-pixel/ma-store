import { Link } from "react-router-dom";
import { Badge, Icon } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { DeliveryListItem, DeliveryStatus } from "@/types/api";

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  PENDING: "Pendente",
  ASSIGNED: "Atribuída",
  OUT_FOR_DELIVERY: "Em rota",
  DELIVERED: "Entregue",
  FAILED: "Não entregue",
  CANCELLED: "Cancelada",
};

const TONE: Record<DeliveryStatus, "neutral" | "accent" | "success" | "danger" | "warning" | "info"> = {
  PENDING: "neutral",
  ASSIGNED: "info",
  OUT_FOR_DELIVERY: "accent",
  DELIVERED: "success",
  FAILED: "danger",
  CANCELLED: "neutral",
};

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  return <Badge tone={TONE[status]}>{DELIVERY_STATUS_LABEL[status]}</Badge>;
}

export function DeliveryCard({ delivery, to }: { delivery: DeliveryListItem; to?: string }) {
  return (
    <Link
      to={to ?? `/motoboy/entregas/${delivery.id}`}
      className="card"
      style={{ display: "block", padding: "var(--space-4)" }}
    >
      <div className="row row-between row-wrap" style={{ gap: "var(--space-2)", alignItems: "center" }}>
        <span className="text-sm text-strong" style={{ fontWeight: 600 }}>
          #{delivery.orderNumber}
        </span>
        <DeliveryStatusBadge status={delivery.status} />
      </div>

      <div className="stack stack-1 mt-2">
        <span className="text-sm text-strong">{delivery.clienteNome}</span>
        <span className="text-sm text-muted">
          <Icon name="mapPin" size={14} /> {delivery.endereco || "Endereço não informado"}
        </span>
        {delivery.bairro || delivery.cidade ? (
          <span className="text-xs text-muted">
            {[delivery.bairro, delivery.cidade].filter(Boolean).join(" • ")}
            {delivery.cep ? ` • CEP ${delivery.cep}` : ""}
          </span>
        ) : null}
        {delivery.observacoes ? <span className="text-xs text-muted">Obs.: {delivery.observacoes}</span> : null}
        <span className="text-xs text-muted">Criada em {formatDateTime(delivery.createdAt)}</span>
      </div>

      <div className="row row-2 mt-3" style={{ justifyContent: "flex-end" }}>
        <span className="btn btn--ghost btn--sm">
          <Icon name="arrowRight" size={16} /> Ver entrega
        </span>
      </div>
    </Link>
  );
}
