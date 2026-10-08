import type { PaymentStatus } from "@prisma/client";
import { getPaymentClient } from "./client.js";
import { mercadopagoNotificationUrl } from "./config.js";
import { mapMercadoPagoStatus } from "./status-map.js";

/**
 * Adapter do Mercado Pago — camada UNICA de integracao.
 *
 * Centraliza criacao de PIX, cartao e boleto, consulta de pagamento e leitura
 * da resposta do gateway. Nenhum outro modulo chama o SDK diretamente.
 *
 * REGRA DE SEGURANCA: nunca recebemos nem armazenamos numero de cartao, CVV ou
 * codigo de seguranca. O frontend tokeniza o cartao e envia apenas o token.
 */

export type MercadoPagoPayer = {
  email: string;
  firstName?: string;
  lastName?: string;
  docType?: "CPF" | "CNPJ";
  docNumber?: string;
};

export type MercadoPagoPaymentResult = {
  id: string;
  status: PaymentStatus;
  mpStatus: string;
  statusDetail: string | null;
  amount: number;
  paymentMethodId: string | null;
  externalReference: string | null;
  pix: { qrCode: string | null; qrCodeBase64: string | null; ticketUrl: string | null } | null;
  boleto: { url: string | null; barcode: string | null; expiresAt: Date | null } | null;
  raw: unknown;
};

type MpApiResponse = {
  id?: number | string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  payment_method_id?: string | null;
  external_reference?: string | null;
  date_of_expiration?: string | null;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string | null;
      qr_code_base64?: string | null;
      ticket_url?: string | null;
    };
  };
  transaction_details?: {
    external_resource_url?: string | null;
    barcode?: { content?: string | null };
  };
};

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildPayer(payer: MercadoPagoPayer) {
  const identification =
    payer.docType && payer.docNumber
      ? { type: payer.docType, number: payer.docNumber.replace(/\D/g, "") }
      : undefined;
  return {
    email: payer.email,
    ...(payer.firstName ? { first_name: payer.firstName } : {}),
    ...(payer.lastName ? { last_name: payer.lastName } : {}),
    ...(identification ? { identification } : {}),
  };
}

function toResult(response: MpApiResponse): MercadoPagoPaymentResult {
  const transactionData = response.point_of_interaction?.transaction_data ?? null;
  const barcode = response.transaction_details?.barcode?.content ?? null;
  const boletoUrl = response.transaction_details?.external_resource_url ?? null;

  return {
    id: String(response.id ?? ""),
    status: mapMercadoPagoStatus(response.status),
    mpStatus: response.status ?? "unknown",
    statusDetail: response.status_detail ?? null,
    amount: typeof response.transaction_amount === "number" ? response.transaction_amount : 0,
    paymentMethodId: response.payment_method_id ?? null,
    externalReference: response.external_reference ?? null,
    pix: transactionData
      ? {
          qrCode: transactionData.qr_code ?? null,
          qrCodeBase64: transactionData.qr_code_base64 ?? null,
          ticketUrl: transactionData.ticket_url ?? null,
        }
      : null,
    boleto:
      boletoUrl || barcode || response.date_of_expiration
        ? {
            url: boletoUrl,
            barcode,
            expiresAt: response.date_of_expiration ? new Date(response.date_of_expiration) : null,
          }
        : null,
    raw: response,
  };
}

export type BaseCreateArgs = {
  amount: number;
  description: string;
  externalReference: string;
  idempotencyKey: string;
  payer: MercadoPagoPayer;
  notificationUrl?: string | null;
};

/** Cria uma cobranca PIX real e devolve QR Code + copia e cola do gateway. */
export async function createPixPayment(args: BaseCreateArgs): Promise<MercadoPagoPaymentResult> {
  const payment = getPaymentClient();
  const response = (await payment.create({
    body: {
      transaction_amount: money(args.amount),
      description: args.description,
      payment_method_id: "pix",
      external_reference: args.externalReference,
      payer: buildPayer(args.payer),
      ...(args.notificationUrl ? { notification_url: args.notificationUrl } : {}),
    },
    requestOptions: { idempotencyKey: args.idempotencyKey },
  })) as MpApiResponse;

  return toResult(response);
}

/** Cria uma cobranca por boleto real. Exige documento do pagador. */
export async function createBoletoPayment(args: BaseCreateArgs): Promise<MercadoPagoPaymentResult> {
  const payment = getPaymentClient();
  const response = (await payment.create({
    body: {
      transaction_amount: money(args.amount),
      description: args.description,
      payment_method_id: "bolbradesco",
      external_reference: args.externalReference,
      payer: buildPayer(args.payer),
      ...(args.notificationUrl ? { notification_url: args.notificationUrl } : {}),
    },
    requestOptions: { idempotencyKey: args.idempotencyKey },
  })) as MpApiResponse;

  return toResult(response);
}

export type CreateCardArgs = BaseCreateArgs & {
  /** Token gerado pelo SDK no navegador. Nunca e o numero do cartao. */
  token: string;
  paymentMethodId?: string;
  issuerId?: string;
  installments?: number;
};

/** Cria uma cobranca por cartao usando SOMENTE o token do Mercado Pago. */
export async function createCardPayment(args: CreateCardArgs): Promise<MercadoPagoPaymentResult> {
  const payment = getPaymentClient();
  const response = (await payment.create({
    body: {
      transaction_amount: money(args.amount),
      description: args.description,
      token: args.token,
      installments: args.installments && args.installments > 0 ? args.installments : 1,
      ...(args.paymentMethodId ? { payment_method_id: args.paymentMethodId } : {}),
      ...(args.issuerId ? { issuer_id: Number(args.issuerId) } : {}),
      external_reference: args.externalReference,
      payer: buildPayer(args.payer),
      ...(args.notificationUrl ? { notification_url: args.notificationUrl } : {}),
    },
    requestOptions: { idempotencyKey: args.idempotencyKey },
  })) as MpApiResponse;

  return toResult(response);
}

/** Consulta o estado REAL do pagamento no gateway (fonte da verdade). */
export async function getMercadoPagoPayment(paymentId: string): Promise<MercadoPagoPaymentResult> {
  const payment = getPaymentClient();
  const response = (await payment.get({ id: paymentId })) as MpApiResponse;
  return toResult(response);
}

/** URL de notificacao configurada (pode ser null quando nao ha PUBLIC_API_URL). */
export function notificationUrl(): string | null {
  return mercadopagoNotificationUrl();
}
