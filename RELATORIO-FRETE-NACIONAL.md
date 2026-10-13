# RELATÓRIO — Tabela Nacional de Frete Pré-cadastrada (MA STORE)

**Data:** 2026-10-13
**Escopo:** motor próprio de frete (`backend/src/shipping-local`), já existente, passou a
ser entregue **pré-configurado** para o Brasil inteiro (26 estados + DF), sem
cadastro manual. Nenhuma funcionalidade existente foi removida e a loja não foi
reconstruída.

---

## 1. O que foi entregue

- Tabela inicial **instalada automaticamente** (boot da API, script e seed).
- **35 zonas / faixas de CEP** cobrindo as 27 UFs, com São Paulo dividida em
  capital, região metropolitana, litoral e interior.
- **3 modalidades** (`ECONOMIC`, `STANDARD`, `EXPRESS`).
- **630 regras de peso** (35 zonas × 3 modalidades × 6 faixas de 0 a 30 kg).
- Preços por região e faixa de peso; prazos em dias úteis por região/modalidade.
- Frete grátis inicial acima de **R$ 199,00** (política comercial documentada).
- CEP de origem provisório (`01001-000` — São Paulo/SP) **claramente sinalizado**.
- Instalação **idempotente** e **não destrutiva**: nunca duplica e nunca
  sobrescreve edições do administrador.

---

## 2. Arquivos modificados / adicionados

### Novos
| Arquivo | Papel |
| --- | --- |
| `backend/src/shipping-local/bootstrap/national-table.ts` | Fonte única declarativa: zonas, modalidades, faixas, preços, prazos e validação. |
| `backend/src/shipping-local/bootstrap/install.service.ts` | Instalador idempotente (puro, testável por injeção). |
| `backend/src/shipping-local/bootstrap/prisma-store.ts` | Persistência Prisma do instalador. |
| `backend/prisma/migrations/20261008120000_national_shipping_seed/migration.sql` | Colunas `seed_key` (zonas/regras) e `origin_zip_code_provisional`. |
| `backend/scripts/install-national-shipping.ts` | Script manual (`npm run shipping:national`). |
| `backend/tests/unit/shipping-local/national-table.test.ts` | Testes da tabela (cobertura, faixas, preços, prazos). |
| `backend/tests/unit/shipping-local/install.service.test.ts` | Testes do instalador (idempotência, preservação). |
| `backend/tests/integration/national-shipping.test.ts` | Testes de instalação + cotação ponta a ponta (PostgreSQL). |

### Modificados
| Arquivo | Alteração |
| --- | --- |
| `backend/prisma/schema.prisma` | `seed_key` em `ShippingZone`/`ShippingWeightRule`; `origin_zip_code_provisional` em `ShippingSettings`. |
| `backend/prisma/seed-production.ts` | Passa a instalar a tabela nacional (idempotente). |
| `backend/package.json` | Script `shipping:national`. |
| `backend/.env.example` | Variável `SHIPPING_NATIONAL_TABLE` (padrão `true`). |
| `backend/src/env.ts` | Leitura de `SHIPPING_NATIONAL_TABLE`. |
| `backend/src/index.ts` | Instalação automática no boot (falha não derruba o servidor). |
| `backend/src/shipping-local/index.ts` | Exporta o módulo de bootstrap. |
| `backend/src/shipping-local/domain/types.ts` | Campos `seedKey` / `originZipCodeProvisional`. |
| `backend/src/shipping-local/application/prisma.repository.ts` | Mapeia os novos campos. |
| `backend/src/shipping-local/application/admin.service.ts` | Expõe/limpa o aviso de CEP provisório; mantém edições. |
| `backend/src/shipping-local/http/handlers.ts` | Status público informa `originZipCodeProvisional`. |
| `frontend/src/types/api.ts` | Tipos dos novos campos. |
| `frontend/src/pages/admin/ShippingEnginePage.tsx` | Selo “Tabela inicial” e aviso de CEP provisório. |
| `docs/SHIPPING_ENGINE.md` | Documentação da tabela, critérios, instalação e limitações. |
| `backend/tests/unit/shipping-local/domain.test.ts` | Ajuste dos fixtures. |
| `backend/tests/unit/shipping-local/quote.service.test.ts` | Ajuste dos fixtures. |

---

## 3. Estrutura da tabela inicial

### Zonas (35) — cobertura sem sobreposição e sem lacunas
- **SP** — Capital (`01000-000–05999-999`, `08000-000–08499-999`),
  Grande São Paulo (`06000-000–07999-999`, `08500-000–09999-999`),
  Litoral (`11000-000–11999-999`), Interior (`12000-000–19999-999`).
- **Demais UFs** — uma ou mais faixas contíguas (`AM`, `DF`, `GO` e `RO` têm
  faixas separadas porque seus CEPs não são contíguos).
- Lacunas permitidas: apenas trechos **sem CEP atribuído**
  (`00000-000–00999-999`, `10000-000–10999-999`, `78900-000–78999-999`).

### Faixas de peso
`0–300 g · 301 g–1 kg · 1–3 kg · 3–5 kg · 5–10 kg · 10–30 kg`
(acima de 30 kg não há faixa → `SHIPPING_RULE_NOT_FOUND`, tratado à parte).

### Regiões de preço (9)
SP capital, SP metropolitana, SP litoral, SP interior, Sudeste, Sul,
Centro-Oeste, Nordeste, Norte.

---

## 4. Critérios de estimativa (preços e prazos)

- **Preços** são **estimativas comerciais iniciais da MA STORE** — **não** são
  tarifas oficiais de transportadora nem custo real de envio.
- Base = modalidade `ECONOMIC` por região × faixa de peso.
  `STANDARD` = base × **1,35**; `EXPRESS` = base × **1,90** (regra central).
- **Prazos** em **dias úteis**, por região e modalidade, e **já incluem 1 dia
  útil de preparação**. O motor **não soma** `default_handling_days` de novo
  (evita contar a preparação duas vezes). O checkout exibe o prazo **máximo**
  (conservador); mínimo/máximo ficam gravados na regra.
- **Frete grátis**: acima de **R$ 199,00** (política inicial, editável; limite
  nacional — o motor não tem limite por região).
- **Produtos adicionais**: o peso de todos os itens é somado; itens extras podem
  mudar a faixa de peso e o preço.
- **Valor mínimo de frete**: a tabela já começa em **R$ 14,90**; não há taxa
  mínima separada.

---

## 5. Instalação (sem configuração manual)

1. **Boot** (`SHIPPING_NATIONAL_TABLE=true`, padrão) — roda após conectar ao banco.
2. `npm run shipping:national [-- --force]`
3. `npm run seed:production [-- --force]`

Regras de segurança:
- cria **somente o que falta** (marcadores `seed_key` únicos);
- **nunca altera** zona/faixa/preço já existente (edições preservadas);
- se houver **zonas do administrador** (`seed_key = null`), **aborta** por
  padrão para não misturar as duas tabelas (use `--force` conscientemente).

---

## 6. Resultados dos testes (executados de verdade)

Ambiente: Node 24, PostgreSQL 15, banco de teste dedicado.

| Suíte | Resultado |
| --- | --- |
| Backend — unitários (inclui tabela nacional + instalador) | **209/209 passaram** |
| Backend — integração do frete (`local-shipping` + `national-shipping`) | **35/35 passaram** |
| Backend — suíte completa | **418/425 passaram** |
| Frontend — testes | **94/94 passaram** |
| Frontend — build (`tsc -b && vite build`) | **OK** |
| Backend — `tsc --noEmit` | **OK** |

Cobertura dos testes da tabela nacional: cobertura das 27 UFs, ausência de
sobreposição/lacuna, limites de faixa de CEP, capital/metropolitana/litoral/
interior de SP, preço por região e por peso, prazos por região, frete grátis,
CEP inválido/sem cobertura, produto sem peso, instalação idempotente,
reinstalação sem duplicar, preservação de preço editado e não mistura com zonas
do administrador.

### Falhas pré-existentes (não relacionadas)
As **7 falhas** em `tests/integration/mercadopago.test.ts` **já existiam antes
desta tarefa** (confirmado executando a suíte contra o projeto original, sem as
minhas alterações). Nenhuma delas toca o motor de frete.

---

## 7. Limitações declaradas

- Preços/prazos são estimativas; podem variar por embalagem, cubagem e
  condições de transporte — não são confirmações de transportadora.
- Acima de **30 kg** não há faixa cadastrada.
- O frete grátis é **nacional e global** (não por região).
- O CEP de origem (`01001-000`) é **provisório** e só serve de referência de
  distância; o cálculo é por faixa de CEP de destino.
- CEPs inválidos → `INVALID_ZIP_CODE`; CEPs sem cobertura → `SHIPPING_ZONE_NOT_FOUND`
  (nunca preço inventado).

---

## 8. O que ainda depende de você (mínimo indispensável)

1. **Confirmar o CEP de origem real** da loja em *Admin → Frete (motor próprio)
   → Configurações*.
2. **Cadastrar o peso (gramas) de cada produto** — sem peso o motor responde
   `PRODUCT_WEIGHT_MISSING` (comportamento intencional, nunca assume 1 kg).
3. Opcional: revisar preços/prazos das regiões no painel (as faixas iniciais
   aparecem com o selo **“Tabela inicial”**).
