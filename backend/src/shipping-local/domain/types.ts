/** Tipos do Shipping Engine proprio (regras locais). */

export type ShippingSettingsRecord = {
  enabled: boolean;
  originZipCode: string | null;
  packagePaddingGrams: number | null;
  defaultHandlingDays: number | null;
  defaultDeliveryDays: number | null;
  freeShippingEnabled: boolean;
  freeShippingMinimumOrderValue: number | null;
  showEstimateDisclaimer: boolean;
  configVersion: number;
};

export type ShippingZoneRecord = {
  id: string;
  name: string;
  description: string | null;
  state: string | null;
  zipCodeFrom: number;
  zipCodeTo: number;
  active: boolean;
  priority: number;
};

export type ShippingMethodRecord = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  active: boolean;
  /** Prioridade: maior = considerada/exibida antes. */
  priority: number;
  /** Ordem legada (usada como desempate). */
  position: number;
};

export type ShippingWeightRuleRecord = {
  id: string;
  zoneId: string;
  shippingMethodId: string | null;
  minWeightGrams: number;
  maxWeightGrams: number;
  price: number;
  deliveryDays: number | null;
  estimatedMinBusinessDays: number | null;
  estimatedMaxBusinessDays: number | null;
  active: boolean;
  priority: number;
};

export type ShippingCepExceptionRecord = {
  id: string;
  cep: string;
  shippingMethodId: string;
  priceOverride: number | null;
  deliveryDaysOverride: number | null;
  active: boolean;
};

export type ProductLogistics = {
  id: string;
  name: string;
  active: boolean;
  price: number;
  /** Peso unitario em gramas. `null`/0 => nao configurado. */
  weightGrams: number | null;
  heightCm: number | null;
  widthCm: number | null;
  lengthCm: number | null;
  /** Marcado como "possui frete: nao" no cadastro. */
  hasShipping: boolean;
  /** Versao logistica: muda quando o produto e atualizado (invalida cache). */
  updatedAt: string;
};

export type QuoteItemInput = { productId: string; quantity: number };

export type LocalQuoteInput = {
  /** CEP de destino (aceita "01001000" e "01001-000"). */
  cep?: string;
  items: QuoteItemInput[];
  /** Sessao opaca do visitante (opcional, vincula a cotacao). */
  sessionId?: string | null;
  /** Se true, aceita produtos sem peso (apenas para diagnostico/simulador). */
  allowMissingWeight?: boolean;
};

/** Opcao de frete devolvida ao cliente. */
export type LocalQuoteOption = {
  methodId: string;
  code: string | null;
  name: string;
  description: string | null;
  price: number;
  deliveryDays: number | null;
  zoneId: string | null;
  ruleId: string | null;
};

export type LocalQuoteResult = {
  success: true;
  available: true;
  quoteId: string;
  expiresAt: string;
  normalizedZipCode: string;
  zone: { id: string; name: string } | null;
  weightGrams: number;
  subtotal: number;
  isFreeShipping: boolean;
  requiresShipping: boolean;
  isEstimate: true;
  disclaimer: string;
  currency: "BRL";
  options: LocalQuoteOption[];
};

export type CreateQuoteInput = {
  sessionId: string | null;
  cep: string;
  subtotal: number;
  totalWeightGrams: number;
  zoneId: string | null;
  expiresAt: Date;
  options: LocalQuoteOption[];
};

/** Repositorio: permite testar o motor sem banco (dependency injection). */
export interface LocalShippingRepository {
  getSettings(): Promise<ShippingSettingsRecord>;
  /** Total de zonas ativas (para diferenciar "sem configuracao" de "sem cobertura"). */
  countActiveZones(): Promise<number>;
  findActiveZonesByZip(zipCodeInt: number): Promise<ShippingZoneRecord[]>;
  findWeightRules(zoneId: string): Promise<ShippingWeightRuleRecord[]>;
  findActiveMethods(): Promise<ShippingMethodRecord[]>;
  findCepExceptions(cep: string): Promise<ShippingCepExceptionRecord[]>;
  findProducts(ids: string[]): Promise<ProductLogistics[]>;
  createQuote(input: CreateQuoteInput): Promise<{ quoteId: string; expiresAt: string }>;
}
