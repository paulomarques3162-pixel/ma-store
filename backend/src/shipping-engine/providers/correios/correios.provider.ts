import { estimateDeliveryDate } from "../../application/deadline.js";
import { normalizePackages } from "../../domain/package.js";
import { normalizePostalCode } from "../../domain/postal-code.js";
import type {
  ShippingProviderCapabilities,
  ShippingProviderHealth,
  ShippingQuote,
  ShippingQuoteRequest,
} from "../../domain/types.js";
import type { ShippingServiceDescriptor } from "../../domain/service-catalog.js";
import type { ShippingProvider } from "../shipping-provider.js";
import { CorreiosClient, type FetchLike } from "./correios.client.js";
import { correiosConfigured, type CorreiosConfig } from "./correios.config.js";

/**
 * Provedor dos Correios (PAC/SEDEX) sobre a API oficial Preço + Prazo.
 *
 * - Não inventa preço nem prazo: o que a API não devolver não é ofertado.
 * - Múltiplos volumes: cota cada volume e SOMA o preço (prazo = o maior).
 * - Sem credenciais/CEP de origem, o provedor fica `not_configured` e não oferta.
 */
export class CorreiosProvider implements ShippingProvider {
  readonly id = "correios";
  readonly name = "Correios";
  readonly capabilities: ShippingProviderCapabilities = {
    quotes: true,
    tracking: true,
    labels: false,
    declaredValue: true,
    environments: ["sandbox", "production"],
  };

  private readonly client: CorreiosClient;

  constructor(
    private readonly config: CorreiosConfig,
    fetchImpl?: FetchLike,
    private readonly now: () => number = Date.now,
  ) {
    this.client = new CorreiosClient(config, fetchImpl as FetchLike, now);
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
    }));
  }

  isConfigured(): boolean {
    return correiosConfigured(this.config);
  }

  getConfig(): CorreiosConfig {
    return this.config;
  }

  async getQuotes(request: ShippingQuoteRequest): Promise<ShippingQuote[]> {
    if (!this.config.enabled) return [];
    if (!correiosConfigured(this.config)) return [];
    if (!request || typeof request !== "object") return [];

    const destination = normalizePostalCode(request.destination?.postalCode ?? "");
    const packages = normalizePackages(request.packages);
    const wanted = new Set(
      (request.services ?? []).map((service) => service.trim().toLowerCase()).filter(Boolean),
    );

    const services = this.config.services.filter(
      (service) =>
        wanted.size === 0 ||
        wanted.has(service.code.toLowerCase()) ||
        wanted.has(service.name.toLowerCase()) ||
        wanted.has(service.type.toLowerCase()),
    );

    const quotes: ShippingQuote[] = [];

    for (const service of services) {
      let price = 0;
      let maxDeliveryDays = 0;

      for (const pkg of packages) {
        const result = await this.client.getPrice({
          serviceCode: service.code,
          origin: this.config.originPostalCode,
          destination,
          weightGrams: pkg.billedWeightGrams,
          heightCm: pkg.heightCm,
          widthCm: pkg.widthCm,
          lengthCm: pkg.lengthCm,
          ...(typeof request.declaredValue === "number" ? { declaredValue: request.declaredValue } : {}),
        });
        price += result.price;
      }

      const deadline = await this.client.getDeadline({
        serviceCode: service.code,
        origin: this.config.originPostalCode,
        destination,
      });
      maxDeliveryDays = Math.max(maxDeliveryDays, deadline.maxDeliveryDays ?? deadline.deliveryDays);

      const roundedPrice = Math.round((price + Number.EPSILON) * 100) / 100;
      quotes.push({
        carrier: this.id,
        serviceCode: service.code,
        serviceName: service.name,
        serviceDescription: null,
        type: service.type,
        price: roundedPrice,
        currency: request.currency ?? "BRL",
        deliveryDays: deadline.deliveryDays,
        maxDeliveryDays,
        estimatedDeliveryDate: estimateDeliveryDate(deadline.deliveryDays, { from: new Date(this.now()) }),
        available: true,
        basePrice: roundedPrice,
        appliedRules: [],
        origin: { postalCode: this.config.originPostalCode },
        destination: { postalCode: destination },
        warnings: [],
        trace: [
          { step: "correios.price", detail: `${packages.length} volume(s)` },
          { step: "correios.deadline" },
        ],
      });
    }

    return quotes;
  }

  async healthCheck(): Promise<ShippingProviderHealth> {
    if (!this.config.enabled) {
      return { provider: this.id, status: "not_configured", message: "Provedor desabilitado." };
    }
    if (!correiosConfigured(this.config)) {
      return {
        provider: this.id,
        status: "not_configured",
        message: "Correios sem credenciais/CEP de origem configurados.",
      };
    }

    try {
      const { latencyMs } = await this.client.testConnection();
      return { provider: this.id, status: "healthy", latencyMs, environment: this.config.environment };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao consultar os Correios.";
      return { provider: this.id, status: "unavailable", environment: this.config.environment, message };
    }
  }
}
