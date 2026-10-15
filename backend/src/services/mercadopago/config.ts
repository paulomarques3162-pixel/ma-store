import { env } from "../../env.js";
import {
  resolveMercadoPagoCredentials,
  type MercadoPagoEnvironment,
  type MercadoPagoTokenKind,
} from "./credentials.js";

/**
 * Status de configuracao do Mercado Pago.
 *
 * REGRA: `PAYMENT_PROVIDER=mercadopago` sozinho NAO significa pagamento
 * funcional. So consideramos habilitado quando o provider foi escolhido, as tres
 * credenciais existem E o FORMATO delas corresponde ao ambiente. Nunca
 * devolvemos o valor de um segredo — apenas o nome da variavel ausente e o tipo
 * do token (teste/producao).
 */
export type MercadoPagoStatus = {
  provider: string;
  /** Provider escolhido E credenciais completas E sem bloqueio de ambiente. */
  enabled: boolean;
  configured: boolean;
  environment: MercadoPagoEnvironment;
  /** Public Key pode ir ao frontend; Access Token e Webhook Secret nunca. */
  publicKey: string | null;
  missing: string[];
  /** Formato do Access Token ativo, sem revelar o valor. */
  tokenKind: MercadoPagoTokenKind;
  /** `true` quando a credencial existe mas nao corresponde ao ambiente. */
  blocked: boolean;
  /** Motivo seguro (sem segredos) do bloqueio, ou `null`. */
  blockedReason: string | null;
};

function resolve() {
  return resolveMercadoPagoCredentials({
    paymentEnv: env.PAYMENT_ENV,
    production: {
      accessToken: env.MERCADOPAGO_ACCESS_TOKEN,
      publicKey: env.MERCADOPAGO_PUBLIC_KEY,
      webhookSecret: env.MERCADOPAGO_WEBHOOK_SECRET,
    },
    sandbox: {
      accessToken: env.MERCADOPAGO_SANDBOX_ACCESS_TOKEN,
      publicKey: env.MERCADOPAGO_SANDBOX_PUBLIC_KEY,
      webhookSecret: env.MERCADOPAGO_SANDBOX_WEBHOOK_SECRET,
    },
  });
}

export function getMercadoPagoStatus(): MercadoPagoStatus {
  const provider = (env.PAYMENT_PROVIDER || "mock").trim().toLowerCase();
  const resolved = resolve();

  return {
    provider,
    enabled: provider === "mercadopago" && resolved.configured && !resolved.blocked,
    configured: resolved.configured,
    environment: resolved.environment,
    // A Public Key so e exposta quando a configuracao esta valida para o ambiente.
    publicKey: !resolved.blocked && resolved.publicKey ? resolved.publicKey : null,
    missing: resolved.missing,
    tokenKind: resolved.tokenKind,
    blocked: resolved.blocked,
    blockedReason: resolved.blockedReason,
  };
}

/**
 * Access Token ATIVO do ambiente selecionado.
 *
 * Lanca (mensagem segura, sem valor) quando a credencial esta ausente ou
 * bloqueada. Usado exclusivamente pelo cliente do gateway.
 */
export function getActiveAccessToken(): string {
  const resolved = resolve();
  if (resolved.blocked) {
    throw new Error(resolved.blockedReason ?? "Configuracao do Mercado Pago inconsistente com o ambiente.");
  }
  if (!resolved.accessToken) {
    throw new Error(`Credencial do Mercado Pago ausente: ${resolved.missing.join(", ")}.`);
  }
  return resolved.accessToken;
}

/** Webhook Secret ATIVO do ambiente selecionado (pode ser vazio). */
export function getActiveWebhookSecret(): string {
  return resolve().webhookSecret;
}

/** URL publica do webhook, usada como `notification_url` no gateway. */
export function mercadopagoNotificationUrl(): string | null {
  const base = env.PUBLIC_API_URL.trim().replace(/\/+$/, "");
  if (!base) return null;
  return `${base}/api/payments/webhooks/mercadopago`;
}
