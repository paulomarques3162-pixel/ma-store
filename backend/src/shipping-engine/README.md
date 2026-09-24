# Shipping Engine (módulo isolado)

Motor de cálculo de frete **universal e agnóstico** embutido no backend da MA STORE,
mas sem dependência de Fastify, Prisma, Correios ou de qualquer loja. Pode ser
reutilizado por qualquer projeto.

> **Status:** implementação completa (1.0.0) — domínio, contrato + factory,
> providers (Correios, estáticos, mock), cache, resiliência, pricing engine,
> prazo, multi-loja, observabilidade, rotas HTTP `/api/v1/shipping`, SDK e
> widget de frontend. Coberto por 68 testes unitários do módulo.

## Estrutura

```text
src/shipping-engine/
├── index.ts                      # API pública do módulo
├── domain/                       # regras e tipos canônicos (puro, sem I/O)
│   ├── brand.ts                  # branded types
│   ├── errors.ts                 # ShippingError + códigos padronizados
│   ├── money.ts                  # Money (moeda explícita) + arredondamento
│   ├── postal-code.ts            # normalização/validação de CEP
│   ├── weight.ts                 # Grams (unidade canônica)
│   ├── dimensions.ts             # Centimeters + peso cúbico
│   ├── package.ts                # PackageInput -> NormalizedPackage + resumo
│   ├── service-catalog.ts        # catálogo normalizado de serviços
│   └── types.ts                  # ShippingQuoteRequest / ShippingQuote / Health
│   ├── cache.ts                # cache com TTL + chave determinística (hash)
│   ├── resilience.ts           # timeout, retry com backoff, circuit breaker
│   ├── pricing-engine.ts       # taxa, subsídio, frete grátis
│   ├── deadline.ts             # prazo em dias úteis -> data estimada
│   ├── config.ts               # config multi-loja (por storeId)
│   ├── observability.ts        # métricas (sem segredos)
│   ├── quote.service.ts        # orquestra provedores em paralelo
│   └── provider-registry.ts    # monta a factory a partir do ambiente
├── providers/
│   ├── shipping-provider.ts    # interface ShippingProvider (contrato)
│   ├── provider-factory.ts     # factory (get/getAll/getEnabled)
│   ├── correios/               # client (token+preço+prazo), mapper, provider
│   ├── static/                 # retirada / entrega local (config da loja)
│   └── mock/                   # MockShippingProvider (testes, sem I/O)
├── http/                       # schemas Zod, rotas Fastify, OpenAPI
├── sdk/                        # ShippingClient universal (fetch)
└── application/, domain/, ...
```

## Conceitos

- **Unidades canônicas:** peso em **gramas**, dimensões em **cm**, dinheiro com
  **moeda explícita**. O motor converte para o que cada provedor pedir.
- **`ShippingProvider`:** contrato único (`getQuotes` + `healthCheck` +
  `capabilities`). A API nunca referencia uma classe concreta.
- **`ShippingProviderFactory`:** registra provedores e seleciona por id,
  por lista de habilitados (`getEnabled`) ou por allowlist de loja.
- **Erros padronizados:** `INVALID_POSTAL_CODE`, `INVALID_WEIGHT`,
  `INVALID_DIMENSIONS`, `INVALID_REQUEST`, `PROVIDER_TIMEOUT`,
  `PROVIDER_UNAVAILABLE`, `PROVIDER_AUTH_ERROR`, `SERVICE_UNAVAILABLE`,
  `NO_QUOTES_AVAILABLE`, `RATE_LIMITED` — cada um com status HTTP e flag
  `retryable`.
- **Catálogo de serviços:** nada de `if (service === "PAC")`. Serviços são
  descritores `{ provider, code, name, type }`.

## Uso (Etapa 0)

```ts
import {
  createShippingProviderFactory,
  MockShippingProvider,
} from "./shipping-engine/index.js";

const factory = createShippingProviderFactory([
  new MockShippingProvider({ id: "mock" }),
]);

const provider = factory.get("mock");
const quotes = await provider.getQuotes({
  storeId: "loja-123",
  origin: { postalCode: "01310-100" },
  destination: { postalCode: "20040-020" },
  packages: [{ weightGrams: 1000, heightCm: 10, widthCm: 20, lengthCm: 30 }],
  services: ["PAC", "SEDEX"],
});
```

## Como adicionar um provedor novo

1. Implementar `ShippingProvider` (ex.: `correios/correios.provider.ts`).
2. Registrar na factory: `factory.register(new CorreiosProvider(...))`.
3. Nada mais no checkout/loja precisa mudar.

## Endpoints HTTP

Montados em `/api/v1/shipping` (ver `docs/SHIPPING-ENGINE.md`): `POST /quotes`,
`POST /validate`, `POST /providers/:provider/test`, `GET /providers`,
`GET /services`, `GET /health`, `GET /providers/:provider/health`,
`GET /openapi.json`. As rotas legadas `/api/shipping` continuam ativas.
