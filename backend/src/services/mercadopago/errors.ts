import { paymentError, validationError } from "../../lib/errors.js";
import { getMercadoPagoStatus } from "./config.js";

/** Garante que o gateway esta configurado antes de tentar cobrar. */
export function assertMercadoPagoReady(): void {
  const status = getMercadoPagoStatus();
  if (status.provider !== "mercadopago") {
    throw validationError("O provedor de pagamento online nao esta ativo nesta loja.");
  }
  if (!status.configured) {
    throw validationError(
      `Pagamento online indisponivel: faltam as credenciais ${status.missing.join(", ")} no servidor.`,
    );
  }
}

type MercadoPagoCause = { code?: string; description?: string };
type MercadoPagoErrorLike = {
  message?: string;
  error?: string;
  status?: number;
  statusCode?: number;
  cause?: unknown;
  api_response?: { status?: number };
};

export type MercadoPagoErrorContext = {
  /** Meio de pagamento que estava sendo criado (melhora a mensagem ao cliente). */
  method?: "PIX" | "CREDIT_CARD" | "BOLETO";
};

export type NormalizedMercadoPagoError = {
  /** Mensagem segura para o cliente (sem stack trace nem segredo). */
  message: string;
  /** Detalhe tecnico apenas para log/auditoria. */
  technical: string;
  httpStatus: number | null;
  causeCodes: string[];
};

/**
 * Converte um erro do SDK/HTTP do Mercado Pago numa resposta SEGURA.
 *
 * Diferencia configuracao ausente, autenticacao invalida, dados invalidos,
 * indisponibilidade e timeout. Nunca devolve o corpo bruto com dados sensiveis.
 */
export function normalizeMercadoPagoError(
  error: unknown,
  context: MercadoPagoErrorContext = {},
): NormalizedMercadoPagoError {
  const err = (error ?? {}) as MercadoPagoErrorLike;
  const causes: MercadoPagoCause[] = Array.isArray(err.cause) ? (err.cause as MercadoPagoCause[]) : [];
  const causeCodes = causes.map((cause) => cause?.code ?? "").filter(Boolean);
  const causeText = causes
    .map((cause) => [cause?.code, cause?.description].filter(Boolean).join(": "))
    .filter(Boolean)
    .join(" | ");
  const httpStatus = err.status ?? err.statusCode ?? err.api_response?.status ?? null;
  const technical = [err.error, err.message, causeText].filter(Boolean).join(" | ").slice(0, 800);

  const isTimeout = /timeout|ETIMEDOUT|ECONNABORTED/i.test(technical);
  const isNetwork = /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|socket hang up/i.test(technical);

  if (isTimeout) {
    return {
      message: "O Mercado Pago demorou para responder. Tente novamente em instantes.",
      technical,
      httpStatus,
      causeCodes,
    };
  }
  if (isNetwork) {
    return {
      message: "Nao foi possivel falar com o Mercado Pago agora. Tente novamente em instantes.",
      technical,
      httpStatus,
      causeCodes,
    };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      message: "Falha de autenticacao com o Mercado Pago. Verifique as credenciais configuradas.",
      technical,
      httpStatus,
      causeCodes,
    };
  }
  // Meio de pagamento indisponivel para a conta/ambiente. O Mercado Pago sinaliza
  // isso com 400/404 e texto de "payment method" — traduzimos para uma mensagem
  // clara em vez do genérico "dados invalidos". Nao inventamos: so quando o
  // proprio gateway indica que o metodo nao esta disponivel.
  const methodUnavailable =
    /payment[_ ]method|not available|not found|no disponible|no encontrado|invalid_payment_method/i.test(
      technical,
    );
  if (
    context.method === "BOLETO" &&
    (httpStatus === 400 || httpStatus === 404 || httpStatus === 422) &&
    methodUnavailable
  ) {
    return {
      message: "Boleto indisponivel para esta conta. Escolha outra forma de pagamento.",
      technical,
      httpStatus,
      causeCodes,
    };
  }
  if (httpStatus === 400 || httpStatus === 422) {
    return {
      message: "Os dados enviados ao Mercado Pago sao invalidos. Revise as informacoes e tente novamente.",
      technical,
      httpStatus,
      causeCodes,
    };
  }
  if (httpStatus !== null && httpStatus >= 500) {
    return {
      message: "O Mercado Pago esta indisponivel no momento. Tente novamente em instantes.",
      technical,
      httpStatus,
      causeCodes,
    };
  }

  return {
    message: "Nao foi possivel processar o pagamento. Tente novamente ou escolha outra forma de pagamento.",
    technical,
    httpStatus,
    causeCodes,
  };
}

/** Converte o erro normalizado em AppError (PAYMENT_ERROR). */
export function toPaymentAppError(error: unknown, context: MercadoPagoErrorContext = {}) {
  const normalized = normalizeMercadoPagoError(error, context);
  return paymentError(normalized.message, { technical: normalized.technical });
}
