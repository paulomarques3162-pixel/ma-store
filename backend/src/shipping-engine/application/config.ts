import { postalCodeDigits } from "../domain/postal-code.js";

/** Ajuste de preço aplicado pela loja sobre o valor do provedor. */
export type PriceAdjustment = { type: "fixed" | "percent"; value: number };

export type StorePricingRules = {
  /** Taxa adicional da loja. */
  fee?: PriceAdjustment;
  /** Subsídio da loja (reduz o valor). */
  subsidy?: PriceAdjustment;
};

export type FreeShippingRule = {
  enabled: boolean;
  minimumOrderValue?: number | null;
  /** Serviços elegíveis (vazio = todos). */
  services?: string[];
  /** Prefixos de CEP elegíveis (vazio = todos). */
  regionPrefixes?: string[];
};

export type StoreShippingProviderSelection = {
  provider: string;
  /** Serviços habilitados deste provedor (vazio = todos). */
  services?: string[];
};

/**
 * Configuração de frete de UMA loja (tenant).
 * Credenciais NUNCA ficam aqui: cada provedor recebe as suas no próprio config.
 */
export type StoreShippingConfig = {
  storeId: string;
  originPostalCode: string | null;
  providers: StoreShippingProviderSelection[];
  pricing: StorePricingRules;
  freeShipping: FreeShippingRule;
  declaredValueEnabled: boolean;
  /** Ordem de apresentação dos provedores (opcional). */
  presentationOrder?: string[];
};

export const DEFAULT_STORE_SHIPPING_CONFIG: Omit<StoreShippingConfig, "storeId"> = {
  originPostalCode: null,
  providers: [],
  pricing: {},
  freeShipping: { enabled: false, minimumOrderValue: null },
  declaredValueEnabled: true,
};

export function createStoreShippingConfig(
  input: Partial<StoreShippingConfig> & { storeId: string },
): StoreShippingConfig {
  return {
    storeId: input.storeId,
    originPostalCode: input.originPostalCode ?? null,
    providers: input.providers ?? [],
    pricing: input.pricing ?? {},
    freeShipping: input.freeShipping ?? { enabled: false, minimumOrderValue: null },
    declaredValueEnabled: input.declaredValueEnabled ?? true,
    ...(input.presentationOrder ? { presentationOrder: input.presentationOrder } : {}),
  };
}

export interface StoreShippingConfigRepository {
  get(storeId: string): Promise<StoreShippingConfig | null>;
}

/** Repositório em memória — usado em dev/testes e como fallback de ambiente. */
export class InMemoryStoreShippingConfigRepository implements StoreShippingConfigRepository {
  private readonly configs = new Map<string, StoreShippingConfig>();

  constructor(configs: readonly StoreShippingConfig[] = []) {
    for (const config of configs) this.set(config);
  }

  set(config: StoreShippingConfig): this {
    this.configs.set(config.storeId.trim(), config);
    return this;
  }

  async get(storeId: string): Promise<StoreShippingConfig | null> {
    return this.configs.get(storeId.trim()) ?? null;
  }
}

/** Extrai a região (prefixo de CEP) usada por regras de frete grátis. */
export function shippingRegion(postalCode: string, length = 5): string {
  return postalCodeDigits(postalCode).slice(0, length);
}
