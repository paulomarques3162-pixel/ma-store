import { paymentError, validationError } from "../../lib/errors.js";
import { getMercadoPagoStatus } from "./config.js";

/** Garante que o gateway esta configurado antes de tentar cobrar. */
export function assertMercadoPagoReady(): void {
  const status = getMercadoPagoStatus();
  if (status.provider !== "mercadopago") {
    throw validationError("O provedor de pagamento online nao esta ativo nesta loja.");
  }
  // Bloqueio de ambiente tem precedencia: a credencial existe, mas nao pode ser
  // usada neste ambiente (ex.: token de producao em sandbox).
  if (status.blocked) {
    throw validationError(
      `Pagamento online indisponivel: ${status.blockedReason ?? "configuracao do Mercado Pago inconsistente com o ambiente."}`,
    );
  }
  if (!status.configured) {
    throw validationError(
      `Pagamento online indisponivel: faltam as credenciais ${status.missing.join(", ")} no servidor.`,
    );
  }
}

/**
 * Remove dados sensiveis de um texto tecnico antes de logar:
 * credenciais do Mercado Pago, CPF/CNPJ e CEP. Defesa em profundidade — mesmo
 * que o SDK ecoe algum dado, ele nao chega aos logs.
 */
function redactSensitive(value: string): string {
  return value
    .replace(/\b(APP_USR|TEST)-[A-Za-z0-9._-]+/g, "$1-[REDACTED]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF_REDACTED]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[CNPJ_REDACTED]")
    .replace(/\b\d{5}-?\d{3}\b/g, "[CEP_REDACTED]");
}

type MercadoPagoCause = { code?: string; description?: string };
type MercadoPagoErrorLike = {
  message?: string;
  error?: string;
  status?: number;
  statusCode?: number;
  cause?: unknown;
  id?: string | number;
  api_response?: { status?: number; id?: string | number; message?: string };
};

export type NormalizedMercadoPagoError = {
  /** Mensagem segura para o cliente (sem stack trace nem segredo). */
  message: string;
  /** Detalhe tecnico (SANITIZADO) apenas para log/auditoria. */
  technical: string;
  httpStatus: number | null;
  causeCodes: string[];
  /** Identificador de correlacao do gateway, quando disponivel. */
  requestId: string | null;
};

/**
 * Converte um erro do SDK/HTTP do Mercado Pago numa resposta SEGURA.
 *
 * Diferencia configuracao ausente, autenticacao invalida, dados invalidos,
 * indisponibilidade e timeout. Nunca devolve o corpo bruto com dados sensiveis.
 */
export function normalizeMercadoPagoError(error: unknown): NormalizedMercadoPagoError {
  const err = (error ?? {}) as MercadoPagoErrorLike;
  const causes: MercadoPagoCause[] = Array.isArray(err.cause) ? (err.cause as MercadoPagoCause[]) : [];
  const causeCodes = causes.map((cause) => cause?.code ?? "").filter(Boolean);
  const causeText = causes
    .map((cause) => [cause?.code, cause?.description].filter(Boolean).join(": "))
    .filter(Boolean)
    .join(" | ");
  const httpStatus = err.status ?? err.statusCode ?? err.api_response?.status ?? null;
  const requestId = err.api_response?.id !== undefined ? String(err.api_response.id) : err.id !== undefined ? String(err.id) : null;
  // Preserva codigos e descricao tecnica da rejeicao, SEM dados sensiveis.
  const technical = redactSensitive(
    [err.error, err.message, causeText].filter(Boolean).join(" | ").slice(0, 800),
  );

  const isTimeout = /timeout|ETIMEDOUT|ECONNABORTED/i.test(technical);
  const isNetwork = /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|socket hang up/i.test(technical);

  if (isTimeout) {
    return {
      message: "O Mercado Pago demorou para responder. Tente novamente em instantes.",
      technical,
      httpStatus,
      causeCodes,
      requestId,
    };
  }
  if (isNetwork) {
    return {
      message: "Nao foi possivel falar com o Mercado Pago agora. Tente novamente em instantes.",
      technical,
      httpStatus,
      causeCodes,
      requestId,
    };
  }
  if (httpStatus === 401 || httpStatus === 403) {
    return {
      message: "Falha de autenticacao com o Mercado Pago. Verifique as credenciais configuradas.",
      technical,
      httpStatus,
      causeCodes,
      requestId,
    };
  }
  if (httpStatus === 400 || httpStatus === 422) {
    return {
      message: "Os dados enviados ao Mercado Pago sao invalidos. Revise as informacoes e tente novamente.",
      technical,
      httpStatus,
      causeCodes,
      requestId,
    };
  }
  if (httpStatus !== null && httpStatus >= 500) {
    return {
      message: "O Mercado Pago esta indisponivel no momento. Tente novamente em instantes.",
      technical,
      httpStatus,
      causeCodes,
      requestId,
    };
  }

  return {
    message: "Nao foi possivel processar o pagamento. Tente novamente ou escolha outra forma de pagamento.",
    technical,
    httpStatus,
    causeCodes,
    requestId,
  };
}

/** Converte o erro normalizado em AppError (PAYMENT_ERROR). */
export function toPaymentAppError(error: unknown) {
  const normalized = normalizeMercadoPagoError(error);
  return paymentError(normalized.message, {
    // `technical` fica no erro (sanitizado) para o log do handler registrar o
    // motivo REAL da rejeicao do gateway (codigo, descricao e request id).
    technical: [normalized.technical, normalized.requestId ? `requestId: ${normalized.requestId}` : null]
      .filter(Boolean)
      .join(" | "),
  });
}
