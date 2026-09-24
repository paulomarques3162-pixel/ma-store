# Shipping Engine — API universal de frete

Motor de cotação **agnóstico de transportadora**, isolado em
`backend/src/shipping-engine/`, exposto em **`/api/v1/shipping`** ao lado das rotas
legadas `/api/shipping`. Qualquer loja consome a mesma resposta normalizada sem
conhecer a implementação interna dos Correios.

## Endpoints

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/v1/shipping/quotes` | Calcula cotações |
| POST | `/api/v1/shipping/validate` | Valida a requisição sem consultar provedores |
| POST | `/api/v1/shipping/providers/:provider/test` | Testa conexão (ex.: `correios`) |
| GET | `/api/v1/shipping/providers` | Lista provedores e capacidades |
| GET | `/api/v1/shipping/services` | Lista serviços do catálogo |
| GET | `/api/v1/shipping/health` | Health-check geral |
| GET | `/api/v1/shipping/providers/:provider/health` | Health-check do provedor |
| GET | `/api/v1/shipping/openapi.json` | Contrato OpenAPI 3.0 |

### Requisição

```json
{
  "storeId": "loja-123",
  "origin": { "postalCode": "01310100" },
  "destination": { "postalCode": "20040020" },
  "packages": [{ "weightGrams": 1000, "heightCm": 10, "widthCm": 20, "lengthCm": 30, "quantity": 1 }],
  "declaredValue": 199.9,
  "orderValue": 250,
  "services": ["PAC", "SEDEX"]
}
```

### Resposta (normalizada, igual para qualquer provedor)

```json
{
  "success": true,
  "data": {
    "quotes": [
      {
        "carrier": "correios",
        "serviceCode": "04510",
        "serviceName": "PAC",
        "type": "STANDARD",
        "price": 25.9,
        "basePrice": 25.9,
        "currency": "BRL",
        "deliveryDays": 7,
        "estimatedDeliveryDate": "2026-10-02",
        "available": true,
        "appliedRules": []
      }
    ],
    "warnings": [],
    "errors": [],
    "meta": { "cacheHit": false, "totalLatencyMs": 812, "providers": ["correios"], "origin": "01310100", "destination": "20040020" }
  }
}
```

### Erros

```json
{ "success": false, "error": { "code": "INVALID_POSTAL_CODE", "message": "CEP inválido. Informe 8 dígitos." } }
```

Códigos: `INVALID_POSTAL_CODE`, `INVALID_WEIGHT`, `INVALID_DIMENSIONS`,
`INVALID_REQUEST`, `PROVIDER_TIMEOUT`, `PROVIDER_UNAVAILABLE`, `PROVIDER_AUTH_ERROR`,
`SERVICE_UNAVAILABLE`, `NO_QUOTES_AVAILABLE`, `RATE_LIMITED`.

## Arquitetura em camadas

- **domain/** — regras puras: CEP, peso (gramas), dimensões, peso cúbico/taxado,
  catálogo de serviços, erros, tipos canônicos.
- **providers/** — `ShippingProvider` (contrato), `ShippingProviderFactory`,
  `CorreiosProvider`, `StaticShippingProvider` (retirada/entrega local) e
  `MockShippingProvider` (testes).
- **application/** — `ShippingQuoteService` (orquestra em paralelo), cache,
  resiliência (timeout/retry/circuit breaker), pricing engine (taxa/subsídio/
  frete grátis), prazo em dias úteis, config multi-loja e métricas.
- **http/** — schemas Zod, rotas Fastify e OpenAPI.
- **sdk/** — `ShippingClient` universal (fetch), para React/Next/Vite/Vue/Angular.

## Correios (API oficial atual)

- **Token:** `POST {base}/token/v1/autentica|autentica/contrato|autentica/cartaopostagem`
  (Basic com usuário Meu Correios + senha/código). Bearer com cache/expiração.
  Também aceita token pré-gerado (`CORREIOS_TOKEN`).
- **Preço:** `GET {base}/preco/v1/nacional/{coProduto}` com **peso em GRAMAS**
  (`psObjeto`), `tpObjeto=2` e medidas obrigatórias (`comprimento/largura/altura`).
- **Prazo:** `POST {base}/prazo/v3/nacional`.
- **Ambientes:** produção `https://api.correios.com.br`, homologação
  `https://apihom.correios.com.br` (`CORREIOS_ENVIRONMENT`).
- **Pré-requisitos:** contrato ativo + cartão de postagem + serviços **38202**
  (Preços) e **38210** (Prazos) + conta PJ Meu Correios/CWS.

## Configuração (variáveis)

```
SHIPPING_ENGINE_ENABLED=true
SHIPPING_ENGINE_MOCK=false
SHIPPING_DEFAULT_STORE_ID=default
SHIPPING_CACHE_TTL_MS=60000
SHIPPING_TIMEOUT_MS=8000
SHIPPING_RETRY_MAX_ATTEMPTS=2
CORREIOS_TOKEN= / CORREIOS_USERNAME= / CORREIOS_PASSWORD= / CORREIOS_CARTAO=
CORREIOS_CONTRATO= / CORREIOS_DR= / CORREIOS_ORIGEM_CEP=
CORREIOS_PAC_CODE=04510 / CORREIOS_SEDEX_CODE=04014
CORREIOS_ENVIRONMENT=production / CORREIOS_TIMEOUT_MS=8000
```

Credenciais **nunca** ficam em código, banco ou frontend — apenas env/secret manager.

## Multi-loja

Cada loja tem sua config (`StoreShippingConfigRepository`): CEP de origem,
provedores/serviços habilitados, taxa/subsídio, frete grátis e regiões. As tabelas
aditivas `store_shipping_configs`, `shipping_provider_configs`, `shipping_rules`
e `shipping_quote_cache` (migration `20260924130000_shipping_engine`) estão prontas
para persistir isso; a seleção por loja garante que credenciais de um tenant nunca
sejam usadas por outro.

## Como adicionar um provedor novo

1. Implementar `ShippingProvider` (ex.: `MelhorEnvioProvider`).
2. Registrar em `createEngineProviderFactory`.
3. Nada muda no checkout nem nos demais provedores.
