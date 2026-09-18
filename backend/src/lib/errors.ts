/**
 * Erros de aplicacao.
 *
 * Regra: o cliente recebe SEMPRE uma mensagem amigavel e um `requestId`.
 * Stack trace e detalhe tecnico ficam apenas no log do servidor / admin.
 */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "BUSINESS_RULE"
  | "INSUFFICIENT_STOCK"
  | "COUPON_INVALID"
  | "PAYMENT_ERROR"
  | "INTERNAL_ERROR";

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  BUSINESS_RULE: 400,
  INSUFFICIENT_STOCK: 409,
  COUPON_INVALID: 422,
  PAYMENT_ERROR: 402,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;
  /** Mensagem tecnica registrada no log, nunca enviada ao cliente. */
  readonly technical?: string;

  constructor(
    code: ErrorCode,
    message: string,
    options: { details?: unknown; technical?: string } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
    this.details = options.details;
    this.technical = options.technical;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError("BUSINESS_RULE", message, { details });
export const unauthorized = (message = "Voce precisa entrar para continuar.") =>
  new AppError("UNAUTHENTICATED", message);
export const forbidden = (message = "Voce nao tem permissao para esta acao.") =>
  new AppError("FORBIDDEN", message);
export const notFound = (message = "Registro nao encontrado.") =>
  new AppError("NOT_FOUND", message);
export const conflict = (message: string, details?: unknown) =>
  new AppError("CONFLICT", message, { details });
export const validationError = (message: string, details?: unknown) =>
  new AppError("VALIDATION_ERROR", message, { details });
export const insufficientStock = (message: string, details?: unknown) =>
  new AppError("INSUFFICIENT_STOCK", message, { details });
export const couponInvalid = (message: string, details?: unknown) =>
  new AppError("COUPON_INVALID", message, { details });
export const paymentError = (message: string, details?: unknown) =>
  new AppError("PAYMENT_ERROR", message, { details });
