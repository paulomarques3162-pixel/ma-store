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
- `20261008120000_national_shipping_seed` (marcadores `seed_key` + CEP de origem provisório)

| Tabela | Papel | Campos principais |
| --- | --- | --- |
| `shipping_settings` | Config geral (linha única `id="default"`) | `enabled`, `origin_zip_code`, `origin_zip_code_provisional`, `package_padding_grams`, `default_handling_days`, `default_delivery_days`, `free_shipping_enabled`, `free_shipping_minimum_order_value`, `show_estimate_disclaimer`, `config_version` |
| `shipping_methods` | Modalidades | `name`, `code` (único, ex.: `ECONOMIC`), `description`, `active`, `priority`, `position` |
| `shipping_zones` | Regiões / faixas de CEP | `name`, `state`, `zip_code_from`, `zip_code_to`, `active`, `priority`, `seed_key` |
| `shipping_weight_rules` | Zona + modalidade + faixa de peso | `zone_id`, `shipping_method_id`, `min_weight_grams`, `max_weight_grams`, `price`, `delivery_days`, `active`, `seed_key` |
| `shipping_cep_exceptions` | Exceções de CEP | `cep`, `shipping_method_id`, `price_override`, `delivery_days_override`, `active` |
| `shipping_quotes` | Cotação persistida | `session_id`, `cep`, `subtotal`, `total_weight_grams`, `zone_id`, `expires_at`, `used_at` |
| `shipping_quote_options` | Opções da cotação | `quote_id`, `shipping_method_id`, `code`, `name`, `price`, `delivery_days`, `zone_id`, `rule_id` |

Nos produtos: `weightGrams` (gramas) e `heightCm`/`widthCm`/`lengthCm` (cm,
opcionais). No pedido guest (`pedidos`): `frete_metodo_id`, `frete_metodo_codigo`,
`frete_quote_id` (único), `frete_prazo_dias`, `frete_zona_id`, `frete_regra_id`,
`frete_estimado`, `frete_prazo_min_dias`, `frete_prazo_max_dias`,
`frete_escolhido_*`.

Índices: `shipping_methods(code)` único, `(active, priority)`;
`shipping_zones(active, zip_code_from, zip_code_to)`; `shipping_zones(seed_key)` único;
`shipping_weight_rules(zone_id, shipping_method_id, active, min/max)`;
`shipping_weight_rules(seed_key)` único;
`shipping_cep_exceptions(cep, shipping_method_id)` único; `shipping_quotes(expires_at)`.

---

## 2.1 Tabela nacional pré-cadastrada (instalação automática)

O motor próprio **já vem configurado** para o Brasil inteiro. Não é preciso
cadastrar estados, faixas de CEP, preços ou prazos para o cálculo básico
funcionar.

### O que é instalado

| Item | Quantidade |
| --- | --- |
| Modalidades | 3 (`ECONOMIC`, `STANDARD`, `EXPRESS`) |
| Zonas / faixas de CEP | 35 (cobrem as **26 UFs + DF**) |
| Regras de peso | 630 (35 zonas × 3 modalidades × 6 faixas) |
| Faixas de peso | 0–300 g, 301–1 kg, 1–3 kg, 3–5 kg, 5–10 kg, 10–30 kg |

- **São Paulo** é dividida em capital, região metropolitana, litoral e interior
  (faixas de CEP não sobrepostas):
  - Capital: `01000-000–05999-999` e `08000-000–08499-999`;
  - Grande São Paulo: `06000-000–07999-999` e `08500-000–09999-999`;
  - Litoral (Baixada Santista/Vale do Ribeira): `11000-000–11999-999`;
  - Interior: `12000-000–19999-999`.
- Os demais estados usam uma faixa (ou faixas) contíguas por UF; `AM`, `DF`,
  `GO` e `RO` têm mais de uma faixa porque seus CEPs não são contíguos.
- As faixas são validadas contra **sobreposição e lacunas**: as únicas
  interrupções permitidas são trechos sem CEP atribuído (`00000-000–00999-999`,
  `10000-000–10999-999`, `78900-000–78999-999`).

### Critério dos preços e prazos

- Fonte única: `backend/src/shipping-local/bootstrap/national-table.ts`.
- Preços são **estimativas comerciais iniciais da MA STORE** — **não** são
  tarifas oficiais de transportadora nem custo real de envio.
- A base é a modalidade `ECONOMIC` por região × faixa de peso (9 regiões:
  SP capital/metro/litoral/interior, Sudeste, Sul, Centro-Oeste, Nordeste,
  Norte). `STANDARD` = base × 1,35 e `EXPRESS` = base × 1,90.
- Prazos são em **dias úteis**, por região e modalidade, e **já incluem 1 dia
  útil de preparação**. Por isso o motor **não soma** `default_handling_days`
  de novo. O checkout exibe o prazo **máximo** (estimativa conservadora); o
  mínimo/máximo ficam gravados em `estimated_min/max_business_days`.
- **Frete grátis** inicial: habilitado acima de **R$ 199,00** (política
  comercial, editável). O limite é nacional — o motor não tem limite por região.
- **Valor mínimo de frete**: a tabela já começa em R$ 14,90 (faixa mais leve,
  SP capital); não há taxa mínima separada.
- **Produtos adicionais**: o peso de todos os itens é somado, então itens extras
  podem mudar a faixa de peso e o preço (comportamento por faixa, não por item).
- **CEP de origem**: `01001-000` (São Paulo/SP) marcado como **provisório**
  (`origin_zip_code_provisional = true`). É só referência de distância — o
  cálculo é por faixa de CEP de destino. Confirme o CEP real no painel para
  limpar o aviso.

### Como é instalada (idempotente)

1. **Boot da API** (`src/index.ts`): se `SHIPPING_NATIONAL_TABLE=true` (padrão),
   o instalador roda após conectar ao banco. Uma falha não impede o servidor de
   subir (é registrada no log).
2. **Script manual**: `npm run shipping:national [-- --force]`.
3. **Seed de produção**: `npm run seed:production [-- --force]`.

O instalador cria **somente o que falta** (marcadores `seed_key` únicos) e
**nunca altera** uma zona/faixa/preço já existente — edições do administrador
são preservadas. Se o banco já tiver **zonas cadastradas pelo administrador**
(`seed_key = null`), a instalação é **abortada** por padrão para não misturar
as duas tabelas (use `--force` apenas conscientemente).

### Limitações declaradas

- Prazos e preços são estimativas; podem variar por embalagem, cubagem e
  condições de transporte. Não são confirmações de transportadora.
- Acima de **30 kg** não há faixa cadastrada → `SHIPPING_RULE_NOT_FOUND`
  (a loja deve tratar manualmente).
- O frete grátis é nacional e global (não por região).
- CEPs sem CEP atribuído e CEPs fora da cobertura retornam
  `SHIPPING_ZONE_NOT_FOUND` — nunca um preço inventado.

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
| `npm run seed:production` | Instala a **tabela nacional pré-cadastrada** (26 UFs + DF). Idempotente; preserva edições; aborta se houver zonas do administrador (use `--force`). |
| `npm run shipping:national` | Instala/verifica a tabela nacional (mesmo comportamento do seed de produção). |

---

## 10. Testes

```bash
cd backend && npx vitest run tests/unit/shipping-local tests/integration/local-shipping.test.ts tests/integration/national-shipping.test.ts
cd frontend && npx vitest run src/pages/checkout-shipping.test.tsx
```

Cobrem: CEP (válido/inválido/fora), peso (um/vários/zero), zona, modalidade
ativa/sem regra, faixas (dentro/limite/sobrepostas/inexistentes), frete grátis
(abaixo/no limite/acima), exceção de CEP, cotação (válida/expirada/inexistente/
de outra sessão), segurança (preço/peso do cliente), pedido (snapshot, duplo
clique, regra alterada).

A suíte da **tabela nacional** (`national-table.test.ts`,
`install.service.test.ts`, `national-shipping.test.ts`) cobre: cobertura das 27
UFs sem sobreposição/lacuna, limites das faixas de CEP, capital/metropolitana/
litoral/interior de SP, preço por região e por peso, prazos por região, frete
grátis, CEP inválido/sem cobertura, produto sem peso, instalação idempotente,
reinstalação sem duplicar, preservação de preço editado e não mistura com zonas
do administrador.

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

## Primeiros passos (a tabela já vem pronta)

1. Confirme o **CEP de origem** real em Admin → Frete (motor próprio) →
   Configurações (hoje está provisório: `01001-000`).
2. Cadastre o **peso em gramas** de cada produto (obrigatório para cotar).
3. Revise, se quiser, **preços e prazos** das regiões no painel — as faixas da
   tabela inicial aparecem com o selo **“Tabela inicial”**.
4. Valide no **Simulador** e finalize uma compra de teste.

Não é necessário cadastrar estados, faixas de CEP, preços ou prazos para o
cálculo básico funcionar.
