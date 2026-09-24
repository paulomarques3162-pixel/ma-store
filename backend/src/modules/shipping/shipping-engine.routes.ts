import type { FastifyInstance } from "fastify";
import { env } from "../../env.js";
import {
  CircuitBreaker,
  CorreiosProvider,
  InMemoryShippingCache,
  InMemoryShippingMetrics,
  InMemoryStoreShippingConfigRepository,
  MockShippingProvider,
  ShippingQuoteService,
  StaticShippingProvider,
  correiosConfigFromEnv,
  createEngineProviderFactory,
  createStoreShippingConfig,
  registerShippingEngineRoutes,
  type StaticShippingProvider as StaticProvider,
} from "../../shipping-engine/index.js";

/** Monta o serviço do motor a partir do ambiente (sem acoplar ao Fastify). */
export function createShippingEngineService(): ShippingQuoteService {
  const correios = new CorreiosProvider(
    correiosConfigFromEnv({
      CORREIOS_ENABLED: "true",
      CORREIOS_ENVIRONMENT: env.CORREIOS_ENVIRONMENT,
      CORREIOS_API_URL: env.CORREIOS_API_URL,
      CORREIOS_TOKEN: env.CORREIOS_TOKEN,
      CORREIOS_USERNAME: env.CORREIOS_USERNAME,
      CORREIOS_PASSWORD: env.CORREIOS_PASSWORD,
      CORREIOS_CONTRATO: env.CORREIOS_CONTRATO,
      CORREIOS_CARTAO: env.CORREIOS_CARTAO,
      CORREIOS_DR: env.CORREIOS_DR,
      CORREIOS_ORIGEM_CEP: env.CORREIOS_ORIGEM_CEP,
      CORREIOS_PAC_CODE: env.CORREIOS_PAC_CODE,
      CORREIOS_SEDEX_CODE: env.CORREIOS_SEDEX_CODE,
      CORREIOS_TIMEOUT_MS: String(env.CORREIOS_TIMEOUT_MS),
    }),
  );

  const staticProviders: StaticProvider[] = [
    new StaticShippingProvider({
      id: "retirada",
      name: env.RETIRADA_NOME,
      enabled: env.RETIRADA_ATIVA,
      services: [
        {
          code: "RETIRADA",
          name: env.RETIRADA_NOME,
          description: "Retirada na loja (sem custo).",
          type: "PICKUP",
          price: 0,
          deliveryDays: 0,
        },
      ],
    }),
  ];

  if (env.FLEX_CEP_PREFIX.trim()) {
    staticProviders.push(
      new StaticShippingProvider({
        id: "local-delivery",
        name: env.FLEX_NOME,
        enabled: true,
        postalCodePrefixes: [env.FLEX_CEP_PREFIX.trim()],
        services: [
          {
            code: "MOTOBOY",
            name: env.FLEX_NOME,
            description: "Entrega local (motoboy).",
            type: "LOCAL",
            price: env.FLEX_VALOR,
            deliveryDays: 1,
          },
        ],
      }),
    );
  }

  const factory = createEngineProviderFactory({
    correios,
    staticProviders,
    ...(env.SHIPPING_ENGINE_MOCK ? { mock: new MockShippingProvider() } : {}),
  });

  const originPostalCode = (env.SHIPPING_ORIGIN_CEP || env.CORREIOS_ORIGEM_CEP || "").replace(/\D/g, "") || null;
  const freeAbove = env.SHIPPING_FREE_ABOVE ? Number(env.SHIPPING_FREE_ABOVE) : null;

  const configRepository = new InMemoryStoreShippingConfigRepository([
    createStoreShippingConfig({
      storeId: env.SHIPPING_DEFAULT_STORE_ID,
      originPostalCode,
      providers: [], // vazio = todos os provedores habilitados
      freeShipping:
        freeAbove && Number.isFinite(freeAbove) && freeAbove > 0
          ? { enabled: true, minimumOrderValue: freeAbove }
          : { enabled: false, minimumOrderValue: null },
    }),
  ]);

  return new ShippingQuoteService({
    providers: factory,
    configRepository,
    cache: new InMemoryShippingCache(),
    breaker: new CircuitBreaker(),
    metrics: new InMemoryShippingMetrics(),
    cacheTtlMs: env.SHIPPING_CACHE_TTL_MS,
    policy: {
      timeoutMs: env.SHIPPING_TIMEOUT_MS,
      maxAttempts: env.SHIPPING_RETRY_MAX_ATTEMPTS,
      baseDelayMs: 200,
      maxDelayMs: 2_000,
    },
  });
}

/**
 * Plugin do Shipping Engine (novo contrato), montado em `/api/v1/shipping`.
 * As rotas legadas `/api/shipping` continuam intactas.
 */
export async function shippingEngineRoutes(app: FastifyInstance): Promise<void> {
  const service = createShippingEngineService();
  await registerShippingEngineRoutes(app, { service });
}
