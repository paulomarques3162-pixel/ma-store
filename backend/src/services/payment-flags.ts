import { env } from "../env.js";
import { validationError } from "../lib/errors.js";

/**
 * Disponibilidade COMERCIAL dos meios de pagamento (feature flags).
 *
 * Por que existe: o boleto precisa ficar TEMPORARIAMENTE indisponivel para
 * novas compras, sem remover a integracao, sem apagar historicos e sem que
 * qualquer requisicao direta (Postman/curl/frontend manipulado) consiga burlar
 * a regra. A decisao vive no BACKEND (unica autoridade) e o frontend apenas
 * reflete o estado devolvido por `GET /api/payment-methods`.
 *
 * Regra central (usada por TODAS as rotas que podem gerar cobranca):
 *   - `assertPaymentMethodEnabled` e chamado ANTES de criar pedido, gravar
 *     pagamento ou acionar o Mercado Pago;
 *   - a tentativa com BOLETO responde HTTP 422 com mensagem clara;
 *   - pedidos antigos, boletos ja emitidos, webhooks e consultas de rastreio
 *     NAO passam por aqui — nada historico e alterado.
 *
 * Reativacao futura: basta definir `BOLETO_ENABLED=true` no ambiente. Nenhuma
 * migracao, nenhuma alteracao de codigo e nenhum deploy de frontend e
 * necessario: a UI le o estado real da API.
 */

/** Codigo estavel devolvido em `error.details.code` (o front pode traduzir). */
export const BOLETO_UNAVAILABLE_CODE = "BOLETO_UNAVAILABLE";

/** Mensagem exigida pela regra de negocio (frontend e backend usam o mesmo texto). */
export const BOLETO_UNAVAILABLE_MESSAGE =
  "Pagamento por boleto temporariamente indisponível. Escolha PIX ou cartão.";

export type PaymentMethodId = "PIX" | "CREDIT_CARD" | "BOLETO" | "COMBINAR" | "MANUAL";

/** Normaliza o metodo recebido (aceita variacoes de caixa/espaco). */
export function normalizePaymentMethod(method: unknown): string {
  return String(method ?? "")
    .trim()
    .toUpperCase();
}

/** `true` somente quando o boleto foi explicitamente habilitado no ambiente. */
export function isBoletoEnabled(): boolean {
  return env.BOLETO_ENABLED === true;
}

/** Estado de cada metodo para exibicao no checkout (nunca expoe segredo). */
export function isPaymentMethodEnabled(method: unknown): boolean {
  return normalizePaymentMethod(method) !== "BOLETO" || isBoletoEnabled();
}

/**
 * Guarda central. Lanca 422 (VALIDATION_ERROR) quando o metodo esta desativado.
 * Nao grava nada, nao chama o gateway — a requisicao morre aqui.
 */
export function assertPaymentMethodEnabled(method: unknown): void {
  if (isPaymentMethodEnabled(method)) return;
  throw validationError(BOLETO_UNAVAILABLE_MESSAGE, {
    code: BOLETO_UNAVAILABLE_CODE,
    paymentMethod: "BOLETO",
    retryWith: ["PIX", "CREDIT_CARD", "COMBINAR"],
  });
}

/** Bloco publico de disponibilidade do boleto (usado por /payment-methods). */
export function boletoAvailability() {
  const enabled = isBoletoEnabled();
  return {
    enabled,
    /** O boleto continua VISIVEL no checkout, apenas nao selecionavel. */
    comingSoon: !enabled,
    label: "Boleto bancário",
    note: enabled
      ? null
      : "Indisponível temporariamente. Em breve você poderá pagar suas compras por boleto bancário.",
  } as const;
}
