import { isShippingError, noQuotesAvailable, providerUnavailable } from "../domain/errors.js";
import type { ShippingErrorCode } from "../domain/errors.js";
import { normalizePackages, summarizePackages } from "../domain/package.js";
import { normalizePostalCode } from "../domain/postal-code.js";
import { normalizeProviderId } from "../domain/service-catalog.js";
import type { ShippingQuote, ShippingQuoteRequest } from "../domain/types.js";
import type { ShippingProviderFactory } from "../providers/provider-factory.js";
import type { ShippingProvider } from "../providers/shipping-provider.js";
import { buildCacheKey, configFingerprint, type ShippingCache } from "./cache.js";
import {
  createStoreShippingConfig,
  type StoreShippingConfig,
  type StoreShippingConfigRepository,
} from "./config.js";
import { estimateDeliveryDate } from "./deadline.js";
import { NullShippingMetrics, type ShippingMetricsSink } from "./observability.js";
import { applyStorePricing } from "./pricing-engine.js";
import {
  DEFAULT_RESILIENCE_POLICY,
  executeWithResilience,
  type CircuitBreaker,
  type ResiliencePolicy,
} from "./resilience.js";

export type QuoteServiceDependencies = {
  providers: ShippingProviderFactory;
  configRepository?: StoreShippingConfigRepository;
  cache?: ShippingCache;
  breaker?: CircuitBreaker;
  metrics?: ShippingMetricsSink;
  policy?: ResiliencePolicy;
  cacheTtlMs?: number;
  holidays?: readonly string[];
  clock?: () => Date;
};

export type ShippingQuoteError = { provider: string; code: ShippingErrorCode; message: string };

export type ShippingQuoteMeta = {
  cacheHit: boolean;
  totalLatencyMs: number;
  providerLatencyMs: Record<string, number>;
  providers: string[];
  origin: string;
  destination: string;
  packageCount: number;
  totalBilledWeightGrams: number;
};

export type ShippingQuoteResult = {
  success: boolean;
  quotes: ShippingQuote[];
  warnings: string[];
  errors: ShippingQuoteError[];
  meta: ShippingQuoteMeta;
};

export type ProviderSummary = {
  id: string;
  name: string;
  enabled: boolean;
  capabilities: ShippingProvider["capabilities"];
  services: number;
};

export type ValidatedRequest = {
  storeId: string;
  origin: string;
  destination: string;
  packages: ReturnType<typeof normalizePackages>;
  totalBilledWeightGrams: number;
  declaredValue: number | null;
  orderValue: number | null;
  services: string[];
};

export type ServiceSummary = {
  provider: string;
  code: string;
  name: string;
  type: string;
  description?: string;
};

const DEFAULT_CACHE_TTL_MS = 60_000;

/**
 * Orquestra a cotação: seleciona provedores habilitados, consulta em PARALELO
 * com timeout/retry/circuit breaker, usa cache, aplica as regras de preço da
 * loja e devolve a resposta normalizada. Falha de um provedor não derruba o
 * resultado dos demais.
 */
export class ShippingQuoteService {
  private readonly metrics: ShippingMetricsSink;
  private readonly policy: ResiliencePolicy;
  private readonly cacheTtlMs: number;
  private readonly clock: () => Date;

  constructor(private readonly deps: QuoteServiceDependencies) {
    this.metrics = deps.metrics ?? new NullShippingMetrics();
    this.policy = deps.policy ?? DEFAULT_RESILIENCE_POLICY;
    this.cacheTtlMs = deps.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.clock = deps.clock ?? (() => new Date());
  }

  private async loadConfig(storeId: string): Promise<StoreShippingConfig> {
    const fromRepo = this.deps.configRepository ? await this.deps.configRepository.get(storeId) : null;
    return fromRepo ?? createStoreShippingConfig({ storeId });
  }

  private selectionFor(config: StoreShippingConfig): Map<string, Set<string> | null> {
    const selection = new Map<string, Set<string> | null>();
    for (const entry of config.providers) {
      const services = entry.services && entry.services.length > 0
        ? new Set(entry.services.map((service) => service.trim().toLowerCase()))
        : null;
      selection.set(normalizeProviderId(entry.provider), services);
    }
    return selection;
  }

  validate(request: ShippingQuoteRequest): ValidatedRequest {
    if (!request || typeof request !== "object") {
      throw noQuotesAvailable("Requisição de cotação inválida.");
    }
    const origin = normalizePostalCode(request.origin?.postalCode ?? "");
    const destination = normalizePostalCode(request.destination?.postalCode ?? "");
    const packages = normalizePackages(request.packages);

    return {
      storeId: String(request.storeId ?? "").trim(),
      origin,
      destination,
      packages,
      totalBilledWeightGrams: summarizePackages(packages).totalBilledWeightGrams,
      declaredValue: typeof request.declaredValue === "number" ? request.declaredValue : null,
      orderValue: typeof request.orderValue === "number" ? request.orderValue : null,
      services: (request.services ?? []).map((service) => service.trim()).filter(Boolean),
    };
  }

  async quote(request: ShippingQuoteRequest): Promise<ShippingQuoteResult> {
    const startedAt = this.clock().getTime();
    const normalized = this.validate(request);
    const config = await this.loadConfig(normalized.storeId);

    const selection = this.selectionFor(config);
    const allowedProviders = config.providers.length > 0 ? config.providers.map((entry) => entry.provider) : undefined;
    const providers = this.deps.providers.getEnabled(allowedProviders);

    const warnings: string[] = [];
    const errors: ShippingQuoteError[] = [];
    const providerLatencyMs: Record<string, number> = {};
    const quotes: ShippingQuote[] = [];
    let cacheHit = false;

    const lookup = {
      ...request,
      origin: { postalCode: normalized.origin },
      destination: { postalCode: normalized.destination },
    };

    const configFp = configFingerprint({
      pricing: config.pricing,
      freeShipping: config.freeShipping,
      declaredValueEnabled: config.declaredValueEnabled,
    });

    const results = await Promise.all(
      providers.map(async (provider) => {
        const providerStartedAt = this.clock().getTime();
        const serviceFilter = selection.get(normalizeProviderId(provider.id)) ?? null;
        const cacheKey = buildCacheKey({
          storeId: normalized.storeId,
          provider: provider.id,
          request: lookup,
          configFingerprint: configFp,
        });

        try {
          let providerQuotes = this.deps.cache?.get(cacheKey);
          let hit = providerQuotes !== undefined;

          if (!providerQuotes) {
            providerQuotes = await executeWithResilience(
              () => provider.getQuotes(lookup),
              this.policy,
              { breaker: this.deps.breaker, key: normalizeProviderId(provider.id) },
            );
            if (providerQuotes.length > 0) {
              this.deps.cache?.set(cacheKey, providerQuotes, this.cacheTtlMs);
            }
          }

          const priced = providerQuotes
            .filter((quote) => this.matchService(quote, serviceFilter, normalized.services))
            .map((quote) => this.price(quote, config, normalized, provider.id));

          return { providerId: normalizeProviderId(provider.id), quotes: priced, hit, durationMs: this.clock().getTime() - providerStartedAt };
        } catch (error) {
          const code: ShippingErrorCode = isShippingError(error) ? error.code : "PROVIDER_UNAVAILABLE";
          const message = error instanceof Error ? error.message : "Falha ao consultar o provedor de frete.";
          return {
            providerId: normalizeProviderId(provider.id),
            quotes: [] as ShippingQuote[],
            hit: false,
            durationMs: this.clock().getTime() - providerStartedAt,
            error: { provider: normalizeProviderId(provider.id), code, message } as ShippingQuoteError,
          };
        }
      }),
    );

    for (const result of results) {
      providerLatencyMs[result.providerId] = result.durationMs;
      quotes.push(...result.quotes);
      if (result.hit) cacheHit = true;
      if (result.error) {
        errors.push(result.error);
        warnings.push(`${result.error.provider}: ${result.error.message}`);
      }
      this.metrics.record({
        provider: result.providerId,
        success: !result.error,
        durationMs: result.durationMs,
        cacheHit: result.hit,
        ...(result.error ? { errorType: result.error.code } : {}),
        timestamp: this.clock().toISOString(),
      });
    }

    quotes.sort((a, b) => a.price - b.price || a.deliveryDays - b.deliveryDays);

    return {
      success: quotes.length > 0,
      quotes,
      warnings,
      errors,
      meta: {
        cacheHit,
        totalLatencyMs: this.clock().getTime() - startedAt,
        providerLatencyMs,
        providers: providers.map((provider) => normalizeProviderId(provider.id)),
        origin: normalized.origin,
        destination: normalized.destination,
        packageCount: normalized.packages.length,
        totalBilledWeightGrams: normalized.totalBilledWeightGrams,
      },
    };
  }

  async listProviders(): Promise<ProviderSummary[]> {
    return this.deps.providers.getAll().map((provider) => ({
      id: normalizeProviderId(provider.id),
      name: provider.name,
      enabled: provider.isEnabled ? provider.isEnabled() : true,
      capabilities: provider.capabilities,
      services: provider.listServices?.().length ?? 0,
    }));
  }

  async listServices(): Promise<ServiceSummary[]> {
    return this.deps.providers
      .getAll()
      .flatMap((provider) => provider.listServices?.() ?? [])
      .map((service) => ({
        provider: normalizeProviderId(service.provider),
        code: service.code,
        name: service.name,
        type: service.type,
        ...(service.description ? { description: service.description } : {}),
      }));
  }

  async health(): Promise<{ status: "ok" | "degraded"; providers: Record<string, string> }> {
    const providers = this.deps.providers.getAll();
    const checks = await Promise.all(
      providers.map(async (provider) => {
        try {
          const health = await provider.healthCheck();
          return { id: normalizeProviderId(provider.id), status: health.status };
        } catch {
          return { id: normalizeProviderId(provider.id), status: "unavailable" as const };
        }
      }),
    );

    const statuses: Record<string, string> = {};
    for (const check of checks) statuses[check.id] = check.status;
    const ok = checks.some((check) => check.status === "healthy");
    return { status: ok ? "ok" : "degraded", providers: statuses };
  }

  async providerHealth(providerId: string): Promise<Awaited<ReturnType<ShippingProvider["healthCheck"]>>> {
    const provider = this.deps.providers.get(providerId);
    return provider.healthCheck();
  }

  async providerTest(providerId: string): Promise<{
    provider: string;
    connected: boolean;
    status: string;
    latencyMs: number | null;
    environment: string | null;
    availableServices: Array<{ code: string; name: string; type: string }>;
  }> {
    const provider = this.deps.providers.get(providerId);
    const health = await provider.healthCheck();
    const services = provider.listServices?.() ?? [];
    return {
      provider: normalizeProviderId(provider.id),
      connected: health.status === "healthy",
      status: health.status,
      latencyMs: health.latencyMs ?? null,
      environment: health.environment ?? null,
      availableServices: services.map((service) => ({ code: service.code, name: service.name, type: service.type })),
    };
  }

  private matchService(quote: ShippingQuote, filter: Set<string> | null, requested: string[]): boolean {
    const code = quote.serviceCode.toLowerCase();
    const name = quote.serviceName.toLowerCase();
    if (filter && !filter.has(code) && !filter.has(name)) return false;
    if (requested.length > 0) {
      const wanted = requested.map((service) => service.toLowerCase());
      if (!wanted.includes(code) && !wanted.includes(name)) return false;
    }
    return true;
  }

  private price(
    quote: ShippingQuote,
    config: StoreShippingConfig,
    normalized: ValidatedRequest,
    providerId: string,
  ): ShippingQuote {
    const basePrice = quote.basePrice ?? quote.price;
    const outcome = applyStorePricing(
      basePrice,
      config,
      { serviceCode: quote.serviceCode, serviceName: quote.serviceName },
      { orderValue: normalized.orderValue, destinationPostalCode: normalized.destination },
    );

    return {
      ...quote,
      carrier: providerId,
      price: outcome.price,
      basePrice,
      appliedRules: outcome.appliedRules,
      estimatedDeliveryDate:
        quote.estimatedDeliveryDate ?? estimateDeliveryDate(quote.deliveryDays, { from: this.clock(), holidays: this.deps.holidays ?? [] }),
    };
  }
}

export { providerUnavailable };
