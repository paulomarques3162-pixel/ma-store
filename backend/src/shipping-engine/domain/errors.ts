/**
 * Erros padronizados do Shipping Engine.
 *
 * Regra: o cliente recebe sempre `{ code, message }` amigável — stack trace
 * nunca é exposta. O motor usa códigos estáveis para que lojas possam tratar
 * cada situação sem conhecer a implementação do provedor.
 */

export const SHIPPING_ERROR_CODES = [
  "INVALID_POSTAL_CODE",
  "INVALID_WEIGHT",
  "INVALID_DIMENSIONS",
  "INVALID_REQUEST",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_AUTH_ERROR",
  "SERVICE_UNAVAILABLE",
  "NO_QUOTES_AVAILABLE",
  "RATE_LIMITED",
] as const;

export type ShippingErrorCode = (typeof SHIPPING_ERROR_CODES)[number];

/** Erros transitórios de infraestrutura — podem ser repetidos com backoff. */
const RETRYABLE_CODES: ReadonlySet<ShippingErrorCode> = new Set([
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "SERVICE_UNAVAILABLE",
  "RATE_LIMITED",
]);

const HTTP_STATUS_BY_CODE: Record<ShippingErrorCode, number> = {
  INVALID_POSTAL_CODE: 422,
  INVALID_WEIGHT: 422,
  INVALID_DIMENSIONS: 422,
  INVALID_REQUEST: 400,
  PROVIDER_TIMEOUT: 504,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_AUTH_ERROR: 502,
  SERVICE_UNAVAILABLE: 503,
  NO_QUOTES_AVAILABLE: 404,
  RATE_LIMITED: 429,
};

export type ShippingErrorOptions = {
  details?: unknown;
  /** Mensagem técnica para log/observabilidade (nunca enviada ao cliente). */
  technical?: string;
  /** Força o comportamento de retry, sobrepondo o padrão do código. */
  retryable?: boolean;
};

export class ShippingError extends Error {
  readonly code: ShippingErrorCode;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly details?: unknown;
  readonly technical?: string;

  constructor(code: ShippingErrorCode, message: string, options: ShippingErrorOptions = {}) {
    super(message);
    this.name = "ShippingError";
    this.code = code;
    this.httpStatus = HTTP_STATUS_BY_CODE[code];
    this.retryable = options.retryable ?? RETRYABLE_CODES.has(code);
    this.details = options.details;
    this.technical = options.technical;
  }
}

export function isShippingError(value: unknown): value is ShippingError {
  return value instanceof ShippingError;
}

export function invalidPostalCode(message = "CEP inválido. Informe 8 dígitos.", options?: ShippingErrorOptions): ShippingError {
  return new ShippingError("INVALID_POSTAL_CODE", message, options);
}

export function invalidWeight(message = "Peso inválido para o cálculo de frete.", options?: ShippingErrorOptions): ShippingError {
  return new ShippingError("INVALID_WEIGHT", message, options);
}

export function invalidDimensions(message = "Dimensões inválidas para o cálculo de frete.", options?: ShippingErrorOptions): ShippingError {
  return new ShippingError("INVALID_DIMENSIONS", message, options);
}

export function invalidRequest(message = "Requisição de frete inválida.", options?: ShippingErrorOptions): ShippingError {
  return new ShippingError("INVALID_REQUEST", message, options);
}

export function providerTimeout(message = "O provedor de frete demorou para responder.", options?: ShippingErrorOptions): ShippingError {
  return new ShippingError("PROVIDER_TIMEOUT", message, options);
}

export function providerUnavailable(message = "O provedor de frete está indisponível.", options?: ShippingErrorOptions): ShippingError {
  return new ShippingError("PROVIDER_UNAVAILABLE", message, options);
}

export function providerAuthError(message = "Falha de autenticação com o provedor de frete.", options?: ShippingErrorOptions): ShippingError {
  return new ShippingError("PROVIDER_AUTH_ERROR", message, options);
}

export function serviceUnavailable(message = "Serviço de frete indisponível.", options?: ShippingErrorOptions): ShippingError {
  return new ShippingError("SERVICE_UNAVAILABLE", message, options);
}

export function noQuotesAvailable(message = "Nenhuma modalidade disponível para este CEP.", options?: ShippingErrorOptions): ShippingError {
  return new ShippingError("NO_QUOTES_AVAILABLE", message, options);
}

export function rateLimited(message = "Muitas consultas de frete em sequência. Tente novamente.", options?: ShippingErrorOptions): ShippingError {
  return new ShippingError("RATE_LIMITED", message, options);
}
