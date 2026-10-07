import { ShippingError, invalidRequest } from "../../domain/errors.js";
import type { ShippingErrorCode } from "../../domain/errors.js";
import { roundMoney } from "../../domain/money.js";
import { normalizePackages, summarizePackages } from "../../domain/package.js";
import { normalizePostalCode } from "../../domain/postal-code.js";
import type { ShippingServiceDescriptor, ShippingServiceType } from "../../domain/service-catalog.js";
import type {
  ShippingProviderHealth,
  ShippingQuote,
  ShippingQuoteRequest,
} from "../../domain/types.js";
import { gramsToKilograms } from "../../domain/weight.js";
import type { ShippingProvider } from "../shipping-provider.js";

export type MockServiceConfig = {
  code: string;
  name: string;
  type: ShippingServiceType;
  basePrice: number;
  pricePerKg: number;
  deliveryDays: number;
  maxExtraDays: number;
};

/**
 * Serviços do provedor mock. Valores são DELIBERADAMENTE fictícios e servem
 * apenas a testes/homologação — nunca são usados como preço real de loja.
 */
export const DEFAULT_MOCK_SERVICES: readonly MockServiceConfig[] = [
  { code: "MOCK-STD", name: "Mock Padrão", type: "STANDARD", basePrice: 20, pricePerKg: 5, deliveryDays: 7, maxExtraDays: 2 },
  { code: "MOCK-EXP", name: "Mock Expresso", type: "EXPRESS", basePrice: 35, pricePerKg: 8, deliveryDays: 3, maxExtraDays: 1 },
];

export type MockShippingProviderOptions = {
  id?: string;
  name?: string;
  services?: readonly MockServiceConfig[];
  enabled?: boolean;
  /** Latência simulada por chamada (ms). */
  latencyMs?: number;
  /** Quando definido, `getQuotes` lança esse erro e `healthCheck` fica unavailable. */
  failWith?: ShippingErrorCode | null;
  failMessage?: string;
};

/**
 * Provedor mock — determinístico e sem I/O real.
 *
 * Existe para que a API, o cache e a camada de resiliência possam ser testados
 * sem credenciais nem rede. NÃO é registrado automaticamente em produção.
 */
export class MockShippingProvider implements ShippingProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities = {
    quotes: true,
    tracking: false,
    labels: false,
    declaredValue: true,
    environments: ["sandbox", "production"] as Array<"sandbox" | "production">,
  };

  private readonly services: readonly MockServiceConfig[];
  private readonly enabled: boolean;
  private readonly latencyMs: number;
  private readonly failWith: ShippingErrorCode | null;
  private readonly failMessage: string;

  constructor(options: MockShippingProviderOptions = {}) {
    this.id = (options.id ?? "mock").trim().toLowerCase();
    this.name = options.name ?? "Mock (teste)";
    this.services = options.services ?? DEFAULT_MOCK_SERVICES;
    this.enabled = options.enabled !== false;
    this.latencyMs = Math.max(0, options.latencyMs ?? 0);
    this.failWith = options.failWith ?? null;
    this.failMessage = options.failMessage ?? "Falha simulada do provedor mock.";
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  listServices(): ShippingServiceDescriptor[] {
    return this.services.map((service) => ({
      provider: this.id,
      code: service.code,
      name: service.name,
      type: service.type,
    }));
  }

  async getQuotes(request: ShippingQuoteRequest): Promise<ShippingQuote[]> {
    await this.simulateLatency();

    if (this.failWith) {
      throw new ShippingError(this.failWith, this.failMessage, { technical: "mock.failWith" });
    }
    if (!request || typeof request !== "object") {
      throw invalidRequest("Requisição de cotação inválida.");
    }

    const origin = normalizePostalCode(request.origin?.postalCode ?? "");
    const destination = normalizePostalCode(request.destination?.postalCode ?? "");
    const packages = normalizePackages(request.packages);
    const summary = summarizePackages(packages);
    const billedKilograms = gramsToKilograms(summary.totalBilledWeightGrams);

    const wanted = (request.services ?? [])
      .map((service) => service.trim().toLowerCase())
      .filter((service) => service.length > 0);

    const selected = this.services.filter(
      (service) =>
        wanted.length === 0 ||
        wanted.includes(service.code.toLowerCase()) ||
        wanted.includes(service.name.toLowerCase()),
    );

    return selected.map((service) =>
      this.buildQuote(service, { origin, destination, billedKilograms, currency: request.currency ?? "BRL" }),
    );
  }

  async healthCheck(): Promise<ShippingProviderHealth> {
    await this.simulateLatency();

    if (this.failWith) {
      return { provider: this.id, status: "unavailable", message: this.failMessage };
    }
    if (!this.enabled) {
      return { provider: this.id, status: "not_configured", message: "Provedor mock desabilitado." };
    }
    return { provider: this.id, status: "healthy", environment: "sandbox" };
  }

  private buildQuote(
    service: MockServiceConfig,
    context: {
      origin: string;
      destination: string;
      billedKilograms: number;
      currency: string;
    },
  ): ShippingQuote {
    const price = roundMoney(service.basePrice + service.pricePerKg * context.billedKilograms);

    return {
      carrier: this.id,
      serviceCode: service.code,
      serviceName: service.name,
      serviceDescription: "Cotação simulada para testes (não é preço real).",
      type: service.type,
      price,
      currency: context.currency,
      deliveryDays: service.deliveryDays,
      maxDeliveryDays: service.deliveryDays + service.maxExtraDays,
      estimatedDeliveryDate: null,
      available: true,
      origin: { postalCode: context.origin },
      destination: { postalCode: context.destination },
      warnings: [],
      trace: [
        { step: "mock.getQuotes", detail: `serviço ${service.code}` },
        { step: "mock.weight", detail: `${context.billedKilograms.toFixed(3)} kg taxado` },
      ],
    };
  }

  private simulateLatency(): Promise<void> {
    if (this.latencyMs <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, this.latencyMs));
  }
}
