/**
 * Fonte unica da verdade para os status de pedido (Guest Checkout).
 *
 * REGRA: nunca espalhar strings de status pelo codigo. API, painel,
 * validacao e timeline publica consomem SEMPRE esta constante.
 */
export const ORDER_STATUSES = [
  "Aguardando Pagamento",
  "Empacotando Produto",
  "Pronto para Envio",
  "Saiu para Entrega",
  "Entregue",
] as const;

export type OrderStatusPt = (typeof ORDER_STATUSES)[number];

export const INITIAL_ORDER_STATUS: OrderStatusPt = "Aguardando Pagamento";
export const DELIVERED_ORDER_STATUS: OrderStatusPt = "Entregue";

export function isOrderStatus(value: unknown): value is OrderStatusPt {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

/** Indice do status na timeline. Retorna 0 para status desconhecido (nunca quebra a pagina). */
export function orderStatusIndex(status: string): number {
  const index = (ORDER_STATUSES as readonly string[]).indexOf(status);
  return index < 0 ? 0 : index;
}

export type OrderTimelineStep = {
  status: OrderStatusPt;
  /** Etapa ja concluida. */
  done: boolean;
  /** Etapa atual. */
  current: boolean;
  /** Etapa ainda nao alcancada. */
  future: boolean;
};

/**
 * Monta a timeline dos cinco estados na ordem correta.
 * Um status desconhecido NAO quebra a pagina: assume a primeira etapa.
 */
export function buildOrderTimeline(current: string): OrderTimelineStep[] {
  const index = orderStatusIndex(current);
  return ORDER_STATUSES.map((status, position) => ({
    status,
    done: position < index,
    current: position === index,
    future: position > index,
  }));
}
