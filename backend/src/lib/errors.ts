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
  | "INTERNAL_ERROR"
  // Shipping Engine proprio (codigos padronizados exigidos pelo projeto).
  | "INVALID_ZIP_CODE"
  | "SHIPPING_NOT_CONFIGURED"
  | "SHIPPING_ZONE_NOT_FOUND"
  | "SHIPPING_RULE_NOT_FOUND"
  | "PRODUCT_WEIGHT_MISSING"
  | "PRODUCT_DIMENSIONS_MISSING"
  | "INVALID_QUANTITY"
  | "SHIPPING_ENGINE_DISABLED"
  | "SHIPPING_CONFLICT"
  | "SHIPPING_QUOTE_NOT_FOUND"
  | "SHIPPING_QUOTE_EXPIRED"
  | "SHIPPING_QUOTE_INVALID"
  // Modulo de entrega / motoboy.
  | "DELIVERY_NOT_FOUND"
  | "NOT_AUTHORIZED"
  | "DELIVERY_ALREADY_COMPLETED"
  | "INVALID_STATUS"
  | "RECIPIENT_NAME_REQUIRED"
  | "PROOF_REQUIRED"
  | "FAILURE_REASON_REQUIRED"
  | "DRIVER_NOT_FOUND"
  | "INVALID_DRIVER";

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
  // 422: o pedido e valido, mas falta configuracao/dado para cotar.
  INVALID_ZIP_CODE: 422,
  SHIPPING_NOT_CONFIGURED: 422,
  SHIPPING_ZONE_NOT_FOUND: 422,
  SHIPPING_RULE_NOT_FOUND: 422,
  PRODUCT_WEIGHT_MISSING: 422,
  PRODUCT_DIMENSIONS_MISSING: 422,
  INVALID_QUANTITY: 422,
  SHIPPING_ENGINE_DISABLED: 409,
  SHIPPING_CONFLICT: 409,
  SHIPPING_QUOTE_NOT_FOUND: 422,
  SHIPPING_QUOTE_EXPIRED: 409,
  SHIPPING_QUOTE_INVALID: 409,
  DELIVERY_NOT_FOUND: 404,
  NOT_AUTHORIZED: 403,
  DELIVERY_ALREADY_COMPLETED: 409,
  INVALID_STATUS: 409,
  RECIPIENT_NAME_REQUIRED: 422,
  PROOF_REQUIRED: 422,
  FAILURE_REASON_REQUIRED: 422,
  DRIVER_NOT_FOUND: 404,
  INVALID_DRIVER: 422,
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

/** Erro do modulo de entrega, com codigo padronizado. */
export const deliveryError = (
  code: Extract<
    ErrorCode,
    | "DELIVERY_NOT_FOUND"
    | "NOT_AUTHORIZED"
    | "DELIVERY_ALREADY_COMPLETED"
    | "INVALID_STATUS"
    | "RECIPIENT_NAME_REQUIRED"
    | "PROOF_REQUIRED"
    | "FAILURE_REASON_REQUIRED"
    | "DRIVER_NOT_FOUND"
    | "INVALID_DRIVER"
  >,
  message: string,
  details?: unknown,
) => new AppError(code, message, { details });

/** Erro do Shipping Engine proprio, com codigo padronizado. */
export const shippingError = (
  code: Extract<
    ErrorCode,
    | "INVALID_ZIP_CODE"
    | "SHIPPING_NOT_CONFIGURED"
    | "SHIPPING_ZONE_NOT_FOUND"
    | "SHIPPING_RULE_NOT_FOUND"
    | "PRODUCT_WEIGHT_MISSING"
    | "PRODUCT_DIMENSIONS_MISSING"
    | "INVALID_QUANTITY"
    | "SHIPPING_ENGINE_DISABLED"
    | "SHIPPING_CONFLICT"
    | "SHIPPING_QUOTE_NOT_FOUND"
    | "SHIPPING_QUOTE_EXPIRED"
    | "SHIPPING_QUOTE_INVALID"
  >,
  message: string,
  details?: unknown,
) => new AppError(code, message, { details });
