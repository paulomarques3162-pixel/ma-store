/**
 * Fonte unica da verdade para os status de pedido (Guest Checkout).
 *
 * REGRA: nunca espalhar strings de status pelo codigo. API, painel,
 * validacao e timeline publica consomem SEMPRE esta constante.
 *
 * `Aguardando Negociação` e um estado PRE-PAGAMENTO usado quando o cliente
 * escolhe "Combinar entrega/retirada com a loja": o pedido existe, mas o frete
 * ainda nao tem valor. Ele nao entra na timeline dos pedidos normais (para nao
 * alterar o historico) — so aparece quando o pedido foi criado nesse modo.
 */
export const NEGOTIATION_ORDER_STATUS = "Aguardando Negociação" as const;

export const ORDER_STATUSES = [
  "Aguardando Pagamento",
  "Empacotando Produto",
  "Pronto para Envio",
  "Saiu para Entrega",
  "Entregue",
] as const;

/** Status que o ADMIN pode atribuir (inclui a negociacao de frete). */
export const ADMIN_ORDER_STATUSES = [NEGOTIATION_ORDER_STATUS, ...ORDER_STATUSES] as const;

export type OrderStatusPt = (typeof ORDER_STATUSES)[number];
export type AdminOrderStatus = (typeof ADMIN_ORDER_STATUSES)[number];

export const INITIAL_ORDER_STATUS: OrderStatusPt = "Aguardando Pagamento";
export const DELIVERED_ORDER_STATUS: OrderStatusPt = "Entregue";

export function isOrderStatus(value: unknown): value is OrderStatusPt {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

export function isAdminOrderStatus(value: unknown): value is AdminOrderStatus {
  return (
    value === NEGOTIATION_ORDER_STATUS ||
    (typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value))
  );
}

/** Indice do status na timeline. Retorna 0 para status desconhecido (nunca quebra a pagina). */
export function orderStatusIndex(status: string, negotiated = false): number {
  const steps: readonly string[] = negotiated ? [NEGOTIATION_ORDER_STATUS, ...ORDER_STATUSES] : ORDER_STATUSES;
  const index = steps.indexOf(status);
  return index < 0 ? 0 : index;
}

export type OrderTimelineStep = {
  status: AdminOrderStatus;
  /** Etapa ja concluida. */
  done: boolean;
  /** Etapa atual. */
  current: boolean;
  /** Etapa ainda nao alcancada. */
  future: boolean;
};

/**
 * Monta a timeline. Para pedidos normais sao os 5 estados de sempre; para
 * pedidos com frete a combinar, inclui "Aguardando Negociacao" como 1a etapa.
 * Um status desconhecido NAO quebra a pagina: assume a primeira etapa.
 */
export function buildOrderTimeline(current: string, negotiated = false): OrderTimelineStep[] {
  const steps: AdminOrderStatus[] = negotiated
    ? [NEGOTIATION_ORDER_STATUS, ...ORDER_STATUSES]
    : [...ORDER_STATUSES];
  const index = orderStatusIndex(current, negotiated);
  return steps.map((status, position) => ({
    status,
    done: position < index,
    current: position === index,
    future: position > index,
  }));
}
