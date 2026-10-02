import { normalizePostalCode, postalCodeDigits } from "../../domain/postal-code.js";
import { roundMoney } from "../../domain/money.js";
import type { ShippingServiceDescriptor, ShippingServiceType } from "../../domain/service-catalog.js";
import type {
  ShippingProviderCapabilities,
  ShippingProviderHealth,
  ShippingQuote,
  ShippingQuoteRequest,
} from "../../domain/types.js";
import type { ShippingProvider } from "../shipping-provider.js";

export type StaticServiceConfig = {
  code: string;
  name: string;
  description?: string;
  type: ShippingServiceType;
  price: number;
  deliveryDays: number;
  maxDeliveryDays?: number;
};

export type StaticProviderConfig = {
  id: string;
  name: string;
  enabled: boolean;
  services: readonly StaticServiceConfig[];
  /** Quando informado, só atende CEPs que começam com um destes prefixos. */
  postalCodePrefixes?: readonly string[];
};

/**
 * Provedor estático — para modalidades sem cotação externa (retirada na loja,
 * entrega local/motoboy, valor combinado). Preço e prazo vêm da CONFIGURAÇÃO
 * da loja, nunca inventados pelo código.
 */
export class StaticShippingProvider implements ShippingProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ShippingProviderCapabilities = {
    quotes: true,
    tracking: false,
    labels: false,
    declaredValue: false,
    environments: ["sandbox", "production"],
  };

  constructor(private readonly config: StaticProviderConfig) {
    this.id = config.id;
    this.name = config.name;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  listServices(): ShippingServiceDescriptor[] {
    return this.config.services.map((service) => ({
      provider: this.id,
      code: service.code,
      name: service.name,
      type: service.type,
      ...(service.description ? { description: service.description } : {}),
    }));
  }

  async getQuotes(request: ShippingQuoteRequest): Promise<ShippingQuote[]> {
    if (!this.config.enabled) return [];

    const destination = normalizePostalCode(request.destination?.postalCode ?? "");
    const prefixes = this.config.postalCodePrefixes ?? [];
    if (prefixes.length > 0 && !prefixes.some((prefix) => postalCodeDigits(destination).startsWith(prefix))) {
      return [];
    }

    const wanted = new Set(
      (request.services ?? []).map((service) => service.trim().toLowerCase()).filter(Boolean),
    );
    const origin = postalCodeDigits(request.origin?.postalCode ?? "");

    return this.config.services
      .filter(
        (service) =>
          wanted.size === 0 ||
          wanted.has(service.code.toLowerCase()) ||
          wanted.has(service.name.toLowerCase()),
      )
      .map((service) => ({
        carrier: this.id,
        serviceCode: service.code,
        serviceName: service.name,
        serviceDescription: service.description ?? null,
        type: service.type,
        price: roundMoney(service.price),
        currency: request.currency ?? "BRL",
        deliveryDays: service.deliveryDays,
        maxDeliveryDays: service.maxDeliveryDays ?? service.deliveryDays,
        estimatedDeliveryDate: null,
        available: true,
        basePrice: roundMoney(service.price),
        appliedRules: [],
        origin: { postalCode: origin },
        destination: { postalCode: destination },
        warnings: [],
        trace: [{ step: "static.quote", detail: service.code }],
      }));
  }

  async healthCheck(): Promise<ShippingProviderHealth> {
    return {
      provider: this.id,
      status: this.config.enabled ? "healthy" : "not_configured",
      environment: "production",
    };
  }
}
