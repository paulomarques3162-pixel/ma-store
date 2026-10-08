import {
  createBoletoPayment,
  createCardPayment,
  createPixPayment,
  getMercadoPagoPayment,
  notificationUrl,
  type BaseCreateArgs,
  type CreateCardArgs,
  type MercadoPagoPaymentResult,
} from "../mercadopago/index.js";
import { getMercadoPagoStatus } from "../mercadopago/config.js";
import { assertMercadoPagoReady } from "../mercadopago/errors.js";

/**
 * Abstracao de provedor de pagamento (PaymentProvider).
 *
 * O dominio (pedido-payments) NUNCA chama o SDK do gateway diretamente: ele
 * obtem o provider ativo por `getPaymentProvider()` e usa a interface. Trocar o
 * gateway no futuro significa implementar esta interface — sem espalhar
 * condicionais pelo checkout.
 *
 * IMPORTANTE: a interface usa apenas Pessoa Fisica (CPF) ou Juridica (CNPJ) do
 * pagador. O Mercado Pago e compativel com contas PF e PJ; nao ha dependencia de
 * tipo de conta para cobrar.
 */

export type PaymentMethodType = "PIX" | "CREDIT_CARD" | "BOLETO";

/** Resultado normalizado de um pagamento (independente do gateway). */
export type ProviderPayment = MercadoPagoPaymentResult;

export type WebhookOutcome =
  | { status: "PROCESSED"; changed: boolean; paymentStatus: string; pedidoId: number }
  | { status: "AMOUNT_MISMATCH"; expected: number; received: number }
  | { status: "IGNORED"; reason: string };

export interface PaymentProvider {
  /** Identificador do gateway (ex.: "mercadopago"). */
  readonly name: string;
  /** true somente quando o provider foi escolhido E esta configurado. */
  isEnabled(): boolean;
  createPix(input: BaseCreateArgs): Promise<ProviderPayment>;
  createBoleto(input: BaseCreateArgs): Promise<ProviderPayment>;
  createCardPayment(input: CreateCardArgs): Promise<ProviderPayment>;
  /** Consulta o estado REAL do pagamento no gateway (fonte da verdade). */
  getPaymentStatus(paymentId: string): Promise<ProviderPayment>;
  /** Processa uma notificacao ja validada e atualiza o pedido local. */
  handleWebhook(input: {
    paymentId: string;
    providerRef?: string | null;
    externalReference?: string | null;
  }): Promise<WebhookOutcome>;
}

const mercadoPagoProvider: PaymentProvider = {
  name: "mercadopago",
  isEnabled: () => getMercadoPagoStatus().enabled,
  createPix: createPixPayment,
  createBoleto: createBoletoPayment,
  createCardPayment,
  getPaymentStatus: getMercadoPagoPayment,
  async handleWebhook(input) {
    // Import dinamico: evita dependencia circular entre o provider e o dominio.
    const { processMercadoPagoNotification } = await import("../pedido-payments.js");
    return processMercadoPagoNotification(input) as Promise<WebhookOutcome>;
  },
};

/**
 * Retorna o provider de pagamento ativo, ou `null` quando nenhum esta
 * configurado. Nunca devolve um provider "meio configurado".
 */
export function getPaymentProvider(): PaymentProvider | null {
  const status = getMercadoPagoStatus();
  if (status.provider === "mercadopago" && status.enabled) return mercadoPagoProvider;
  return null;
}

/** Lanca erro claro quando nenhum provider esta configurado. */
export function requirePaymentProvider(): PaymentProvider {
  assertMercadoPagoReady();
  const provider = getPaymentProvider();
  if (!provider) throw new Error("Nenhum provedor de pagamento configurado.");
  return provider;
}

export { notificationUrl };
