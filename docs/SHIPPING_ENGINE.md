# SHIPPING ENGINE PRÓPRIO — MA STORE (v2)

Motor de frete **próprio**, por regras cadastradas no PostgreSQL. **Não depende da
API oficial dos Correios**, não raspa sites e não consulta APIs externas.

> Documento do motor **local** (`backend/src/shipping-local`).
> O motor por **provedores** (Correios/Jetlog/Pegaki) segue em
> [`SHIPPING-ENGINE.md`](./SHIPPING-ENGINE.md). Os dois coexistem.

---

## 1. Arquitetura

```
Cliente (React)                         Backend (Fastify + Prisma)
──────────────                          ──────────────────────────
CEP + itens ──▶ POST /api/shipping/quote ──▶ Shipping Service
                                                │
        ┌──────────────────┬──────────────────┼──────────────────┐
        ▼                  ▼                  ▼                  ▼
 ShippingSettings   ShippingZone      ShippingMethod    ShippingWeightRule
   (geral)          (faixa CEP)       (modalidade)      (zona+método+peso)
        │                  │                  │                  │
        └──────────────────┴────────┬─────────┴──────────────────┘
                                    ▼
                          ShippingCepException   (exceções)
                                    ▼
                             PostgreSQL + ShippingQuote/ShippingQuoteOption
```

- **Domínio puro** (`domain/*`): CEP, peso/volume, zona e regra — sem banco.
- **Aplicação** (`application/*`): cotação, cache, repositório Prisma, regras
  administrativas e validação da cotação no checkout.
- **HTTP** (`http/*`): handler público + rotas administrativas.
- O **backend é a única fonte de verdade**: peso, subtotal, zona, modalidade,
  regra, exceção, preço e prazo vêm do banco. Nada do navegador é aceito.

---

## 2. Banco (PostgreSQL / Prisma)

Migrations:
- `20260924130000_shipping_engine` (motor por provedores — pré-existente)
- `20260925120000_local_shipping_engine` (zonas/regras/config v1)
- `20260926120000_shipping_engine_v2` (modalidades + exceções + cotações)

| Tabela | Papel | Campos principais |
| --- | --- | --- |
| `shipping_settings` | Config geral (linha única `id="default"`) | `enabled`, `origin_zip_code`, `package_padding_grams`, `default_handling_days`, `default_delivery_days`, `free_shipping_enabled`, `free_shipping_minimum_order_value`, `show_estimate_disclaimer`, `config_version` |
| `shipping_methods` | Modalidades | `name`, `code` (único, ex.: `ECONOMIC`), `description`, `active`, `priority`, `position` |
| `shipping_zones` | Regiões / faixas de CEP | `name`, `state`, `zip_code_from`, `zip_code_to`, `active`, `priority` |
| `shipping_weight_rules` | Zona + modalidade + faixa de peso | `zone_id`, `shipping_method_id`, `min_weight_grams`, `max_weight_grams`, `price`, `delivery_days`, `active` |
| `shipping_cep_exceptions` | Exceções de CEP | `cep`, `shipping_method_id`, `price_override`, `delivery_days_override`, `active` |
| `shipping_quotes` | Cotação persistida | `session_id`, `cep`, `subtotal`, `total_weight_grams`, `zone_id`, `expires_at`, `used_at` |
| `shipping_quote_options` | Opções da cotação | `quote_id`, `shipping_method_id`, `code`, `name`, `price`, `delivery_days`, `zone_id`, `rule_id` |

Nos produtos: `weightGrams` (gramas) e `heightCm`/`widthCm`/`lengthCm` (cm,
opcionais). No pedido guest (`pedidos`): `frete_metodo_id`, `frete_metodo_codigo`,
`frete_quote_id` (único), `frete_prazo_dias`, `frete_zona_id`, `frete_regra_id`,
`frete_estimado`, `frete_prazo_min_dias`, `frete_prazo_max_dias`,
`frete_escolhido_*`.

Índices: `shipping_methods(code)` único, `(active, priority)`;
`shipping_zones(active, zip_code_from, zip_code_to)`;
`shipping_weight_rules(zone_id, shipping_method_id, active, min/max)`;
`shipping_cep_exceptions(cep, shipping_method_id)` único; `shipping_quotes(expires_at)`.

---

## 3. Fluxo da cotação

1. **CEP** validado e normalizado (`01001-000` → `01001000`); 8 dígitos.
2. **Itens** validados (produto existe, ativo, quantidade > 0).
3. **Produtos** lidos do banco (nunca `peso`/`preço` do frontend).
4. **Peso** = Σ `weightGrams × quantidade` + `package_padding_grams`.
   Produto sem peso → `PRODUCT_WEIGHT_MISSING` (nunca assumimos 1 kg).
5. **Subtotal** recalculado com os preços oficiais do banco.
6. **Zona**: `zip_code_from <= CEP <= zip_code_to AND active`.
7. **Modalidades** ativas, ordenadas por `priority` (desempate `position`).
8. **Regra de peso** por `(zona + modalidade)` que contém o peso.
9. **Exceção de CEP**: sobrescreve preço e/ou prazo da modalidade.
10. **Frete grátis**: se `free_shipping_enabled` e `subtotal >= mínimo`, preço 0.
11. **Cotação** persistida (`ShippingQuote` + opções) com `expires_at`.
12. Resposta com **todas** as opções + `quoteId` + `expiresAt`.

> Sem configuração → `SHIPPING_NOT_CONFIGURED` (“O frete ainda não está
> configurado para este destino.”). Nunca devolvemos preço fictício.

---

## 4. Endpoint público

### `POST /api/shipping/quote`

```json
{ "cep": "01001000", "sessionId": "sess-...", "items": [{ "productId": "ID", "quantity": 2 }] }
```

`destinationZipCode` também é aceito (compatibilidade).

Resposta (200):

```json
{
  "data": {
    "success": true,
    "quoteId": "qt_abc123",
    "expiresAt": "2026-09-27T15:00:00.000Z",
    "normalizedZipCode": "01001000",
    "zone": { "id": "...", "name": "Capital SP" },
    "weightGrams": 1100,
    "subtotal": 200,
    "isFreeShipping": false,
    "requiresShipping": true,
    "isEstimate": true,
    "disclaimer": "Valor e prazo estimados...",
    "currency": "BRL",
    "options": [
      { "methodId": "m1", "code": "EXPRESS", "name": "Frete Expresso", "description": "Entrega mais rapida", "price": 34.9, "deliveryDays": 2, "zoneId": "z1", "ruleId": "r1" }
    ]
  }
}
```

### `GET /api/shipping/engine/status`

Status público (sem segredos): `{ enabled, configured, activeZones, activeWeightRules, activeMethods, freeShippingEnabled }`.

### Erros padronizados

| Código | HTTP | Quando |
| --- | --- | --- |
| `INVALID_ZIP_CODE` | 422 | CEP inválido |
| `SHIPPING_ENGINE_DISABLED` | 409 | motor desligado |
| `SHIPPING_NOT_CONFIGURED` | 422 | sem zonas/modalidades |
| `SHIPPING_ZONE_NOT_FOUND` | 422 | CEP fora das faixas |
| `SHIPPING_RULE_NOT_FOUND` | 422 | sem faixa de peso aplicável |
| `PRODUCT_WEIGHT_MISSING` | 422 | produto sem peso |
| `INVALID_QUANTITY` | 422 | quantidade inválida |
| `SHIPPING_CONFLICT` | 409 | sobreposição de zona/faixa/código |
| `SHIPPING_QUOTE_NOT_FOUND` | 422 | `quoteId` inexistente |
| `SHIPPING_QUOTE_EXPIRED` | 409 | cotação expirada ou carrinho alterado |
| `SHIPPING_QUOTE_INVALID` | 409 | cotação de outra sessão, já usada ou modalidade inativa |

---

## 5. Segurança no fechamento do pedido

O frontend envia `{ frete: { quoteId, methodId }, sessionId, produtos }` — **nunca
o preço**. O backend (`resolveQuoteSelection`):

1. busca a cotação; 2. rejeita se não existe; 3. rejeita se expirou; 4. rejeita se
já foi usada; 5. rejeita se pertence a outra sessão; 6. **recalcula** subtotal e
peso no servidor e rejeita se divergirem da cotação; 7. confere que a modalidade
está entre as opções; 8. confere que a modalidade continua ativa; e só então usa
`price`/`deliveryDays` **gravados na cotação**.

A cotação é marcada como usada dentro da transação do pedido. A coluna
`pedidos.frete_quote_id` é **única**, o que garante **idempotência** (duplo clique
devolve o mesmo pedido) e impede reutilização da cotação.

**Snapshot**: o pedido grava modalidade (id/código/nome), preço, prazo, zona e
`quoteId`. Se o administrador mudar a tabela depois, pedidos antigos continuam
com os valores usados.

---

## 6. Endpoints administrativos (RBAC ADMIN)

Sob `/api/admin/shipping` — convivem com as rotas legadas de modalidade
(`/`, `/:id`, `/reorder`):

| Método | Rota |
| --- | --- |
| GET/PUT | `/settings` |
| GET/POST | `/methods`, PUT/DELETE `/methods/:id` |
| GET/POST | `/zones`, PUT/DELETE `/zones/:id` |
| GET/POST | `/rules`, PUT/DELETE `/rules/:id` |
| GET/POST | `/exceptions`, PUT/DELETE `/exceptions/:id` |
| POST | `/simulate` |

Validações: CEP inicial ≤ final; zonas ativas sem sobreposição; faixas de peso sem
sobreposição na mesma zona+modalidade; preço ≥ 0; prazos inteiros ≥ 0; código de
modalidade único. Cada escrita grava **auditoria** e invalida o cache.

---

## 7. Admin (interface)

`/admin/frete-engine` — **Admin → Frete (motor próprio)**, com abas:
**Configurações**, **Modalidades**, **Regiões/CEP**, **Regras de peso**,
**Exceções de CEP** e **Simulador** (mostra zona, peso e regras aplicadas).
Nenhum CSS/identidade visual foi alterado — apenas componentes existentes.

O cadastro de produto ganhou **Altura/Largura/Comprimento (cm)**.

---

## 8. Cache

Cache em memória por processo (`LocalShippingCache`, TTL 30s), sem Redis. A chave
inclui CEP, itens (produto + quantidade + `updatedAt`), subtotal e
`configVersion`. Toda alteração administrativa incrementa `configVersion`,
invalidando naturalmente as entradas antigas.

---

## 9. Seeds

| Comando | Conteúdo |
| --- | --- |
| `npm run seed:dev` | **Exemplos** de modalidades (Econômico/Padrão/Expresso/Super Expresso/Retirada), 8 zonas, faixas de peso com preços/prazos e 1 exceção de CEP. Aborta se `NODE_ENV=production`. |
| `npm run seed:test` | Igual ao `seed:dev` (ambiente de teste). |
| `npm run seed:production` | **Nenhum preço fictício**: apenas garante a linha de configuração neutra (`enabled=false`). Nunca sobrescreve configuração real. |

---

## 10. Testes

```bash
cd backend && npx vitest run tests/unit/shipping-local tests/integration/local-shipping.test.ts
cd frontend && npx vitest run src/pages/checkout-shipping.test.tsx
```

Cobrem: CEP (válido/inválido/fora), peso (um/vários/zero), zona, modalidade
ativa/sem regra, faixas (dentro/limite/sobrepostas/inexistentes), frete grátis
(abaixo/no limite/acima), exceção de CEP, cotação (válida/expirada/inexistente/
de outra sessão), segurança (preço/peso do cliente), pedido (snapshot, duplo
clique, regra alterada).

---

## Troubleshooting

| Sintoma | Ação |
| --- | --- |
| “frete ainda não está configurado” | ative o motor e cadastre zonas/modalidades/regras |
| “não há faixa de peso” | cadastre a faixa para a modalidade naquela zona |
| “produto sem peso configurado” | preencha `weightGrams` no produto |
| “cotação expirou / carrinho mudou” | recalcule o frete no checkout |
| conflito ao salvar | ajuste CEPs/faixas sobrepostas ou o código duplicado |

---

## Como cadastrar a primeira tabela real

1. **Configurações**: ativar o motor e informar os parâmetros.
2. **Modalidades**: criar ECONOMIC/STANDARD/EXPRESS/… com prioridade.
3. **Regiões/CEP**: criar as faixas de CEP (sem sobreposição).
4. **Regras de peso**: para cada zona+modalidade, faixas com preço e prazo.
5. **Exceções de CEP** (opcional): preço/prazo específicos por CEP.
6. **Produtos**: peso em gramas (obrigatório) e dimensões (opcional).
7. Validar no **Simulador** e finalizar uma compra de teste.

Em produção comece **sem preços fictícios** (`seed:production` neutro).
