import type { PaymentStatus } from "@prisma/client";

/**
 * Mapeamento CENTRALIZADO dos status do Mercado Pago para o dominio interno.
 *
 * Nenhuma string de status do gateway pode ficar espalhada pelo projeto: tudo
 * passa por aqui. Referencia oficial:
 * https://www.mercadopago.com.br/developers/pt/reference/payments/_payments_id/get
 */
export const MERCADOPAGO_STATUS_TO_PAYMENT: Record<string, PaymentStatus> = {
  pending: "PENDING",
  in_process: "PENDING",
  authorized: "PENDING",
  approved: "APPROVED",
  rejected: "DECLINED",
  cancelled: "CANCELED",
  canceled: "CANCELED",
  expired: "EXPIRED",
  refunded: "REFUNDED",
  charged_back: "REFUNDED",
};

/** Normaliza um status bruto do gateway para o enum interno. */
export function mapMercadoPagoStatus(status: string | null | undefined): PaymentStatus {
  const key = (status ?? "").trim().toLowerCase();
  return MERCADOPAGO_STATUS_TO_PAYMENT[key] ?? "PENDING";
}

/** Status finais: nao voltam atras e interrompem o polling do frontend. */
export const TERMINAL_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "APPROVED",
  "DECLINED",
  "CANCELED",
  "EXPIRED",
  "REFUNDED",
];

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return TERMINAL_PAYMENT_STATUSES.includes(status);
}

/** Rotulo amigavel exibido no pedido Guest. */
export function mapPedidoPaymentLabel(status: PaymentStatus): string {
  switch (status) {
    case "APPROVED":
      return "Pago";
    case "DECLINED":
      return "Recusado";
    case "CANCELED":
      return "Cancelado";
    case "EXPIRED":
      return "Expirado";
    case "REFUNDED":
      return "Reembolsado";
    default:
      return "Pendente";
  }
}

/** Metodos aceitos pelo gateway, mapeados para o enum interno. */
export function mapPaymentMethodToPrisma(method: "PIX" | "CREDIT_CARD" | "BOLETO"): "PIX" | "CREDIT_CARD" | "BOLETO" {
  return method;
}
