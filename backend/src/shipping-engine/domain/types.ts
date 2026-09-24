import type { ShippingServiceType } from "./service-catalog.js";
import type { Currency } from "./money.js";

/** Requisição canônica recebida pela API universal. */
export type ShippingQuoteRequest = {
  storeId: string;
  origin: { postalCode: string };
  destination: { postalCode: string };
  packages: Array<{
    weightGrams: number;
    heightCm: number;
    widthCm: number;
    lengthCm: number;
    quantity?: number;
  }>;
  declaredValue?: number;
  /** Valor do pedido — usado apenas pelas regras de frete grátis da loja. */
  orderValue?: number;
  /** Códigos/nomes de serviço desejados. Vazio = todos os habilitados. */
  services?: string[];
  currency?: Currency;
};

/** Passo de rastreabilidade do cálculo (nunca contém segredos). */
export type ShippingTraceStep = {
  step: string;
  detail?: string;
  durationMs?: number;
};

/** Cotação normalizada — o formato único que qualquer loja consome. */
export type ShippingQuote = {
  carrier: string;
  serviceCode: string;
  serviceName: string;
  serviceDescription?: string | null;
  type: ShippingServiceType;
  price: number;
  currency: Currency;
  deliveryDays: number;
  maxDeliveryDays?: number | null;
  estimatedDeliveryDate?: string | null;
  available: boolean;
  /** Preço devolvido pelo provedor, antes das regras da loja. */
  basePrice?: number;
  /** Regras de preço aplicadas (taxa, subsídio, frete grátis). */
  appliedRules?: string[];
  origin: { postalCode: string };
  destination: { postalCode: string };
  warnings: string[];
  trace: ShippingTraceStep[];
};

export type ShippingProviderHealthStatus =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "not_configured";

export type ShippingProviderHealth = {
  provider: string;
  status: ShippingProviderHealthStatus;
  latencyMs?: number;
  environment?: string;
  message?: string;
};

export type ShippingProviderCapabilities = {
  quotes: boolean;
  tracking: boolean;
  labels: boolean;
  declaredValue: boolean;
  environments: Array<"sandbox" | "production">;
};
