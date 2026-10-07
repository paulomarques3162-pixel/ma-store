import { env } from "../../env.js";

/**
 * Status de configuracao do Mercado Pago.
 *
 * REGRA: `PAYMENT_PROVIDER=mercadopago` sozinho NAO significa pagamento
 * funcional. Só consideramos habilitado quando o provider foi escolhido E as
 * tres credenciais existem. Nunca devolvemos o valor de um segredo — apenas o
 * nome da variavel ausente.
 */
export type MercadoPagoStatus = {
  provider: string;
  /** Provider escolhido E credenciais completas. */
  enabled: boolean;
  configured: boolean;
  environment: "sandbox" | "production";
  /** Public Key pode ir ao frontend; Access Token e Webhook Secret nunca. */
  publicKey: string | null;
  missing: string[];
};

export function getMercadoPagoStatus(): MercadoPagoStatus {
  const missing: string[] = [];
  if (!env.MERCADOPAGO_ACCESS_TOKEN.trim()) missing.push("MERCADOPAGO_ACCESS_TOKEN");
  if (!env.MERCADOPAGO_PUBLIC_KEY.trim()) missing.push("MERCADOPAGO_PUBLIC_KEY");
  if (!env.MERCADOPAGO_WEBHOOK_SECRET.trim()) missing.push("MERCADOPAGO_WEBHOOK_SECRET");

  const configured = missing.length === 0;
  const provider = (env.PAYMENT_PROVIDER || "mock").trim().toLowerCase();

  return {
    provider,
    enabled: provider === "mercadopago" && configured,
    configured,
    environment: env.PAYMENT_ENV,
    publicKey: env.MERCADOPAGO_PUBLIC_KEY.trim() || null,
    missing,
  };
}

/** URL publica do webhook, usada como `notification_url` no gateway. */
export function mercadopagoNotificationUrl(): string | null {
  const base = env.PUBLIC_API_URL.trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/api/payments/webhooks/mercadopago`;
}
