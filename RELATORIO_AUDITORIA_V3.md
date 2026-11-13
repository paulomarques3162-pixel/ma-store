# MA STORE — Auditoria técnica e correções (v3)

**Data:** 2026-11-13
**Escopo:** auditoria do código existente (frontend React/Vite, backend Fastify/Prisma/PostgreSQL, integração Mercado Pago), correções aplicadas diretamente no projeto e testes executáveis neste ambiente.

> Este relatório substitui as recomendações genéricas: tudo o que está em **B. Correções implementadas** foi alterado no código deste pacote. O que não pôde ser validado aqui está explicitamente listado em **F. Pendências** — nenhum resultado de teste foi inventado.

---

## A. Falhas encontradas

### A.1 Carregamento de produtos e imagens

| # | Falha | Arquivo de origem | Impacto |
|---|-------|-------------------|---------|
| 1 | A vitrine servia a **imagem original** do upload (foto de celular de 2–7 MB, até 6000 px) em cards de 260 px. Não existia geração de variantes, nem `srcset`/`sizes`. | `backend/src/services/storage.ts`, `frontend/src/components/ui/StoreValue.tsx` | Principal causa de lentidão em 4G: o navegador baixava megabytes por produto. |
| 2 | Nenhum derivativo WebP/AVIF era gerado; nenhum cache de variante. | `backend/src/services/` (inexistente) | Banda e CPU do celular desperdiçados; LCP alto. |
| 3 | `Cache-Control` existia, mas **sem `ETag`/`304`** e **sem cache de aplicação**: cada navegação repetia as mesmas consultas Prisma (produtos + count + facetas + categorias). | `backend/src/modules/catalog/product.routes.ts`, `category.routes.ts`, `brand.routes.ts` | Carga desnecessária no PostgreSQL com acessos simultâneos. |
| 4 | Não havia invalidação de cache após escrita administrativa (não havia cache a invalidar). | `backend/src/modules/admin/*` | Ao introduzir cache, o painel ficaria “atrasado” — corrigido junto. |
| 5 | `sharp` (quando adicionado) não estava marcado como `external` no bundler. | `backend/tsup.config.ts` | O build ESM quebraria o módulo nativo em produção. |

### A.2 Boleto / Mercado Pago

| # | Falha | Arquivo de origem | Impacto |
|---|-------|-------------------|---------|
| 6 | No fluxo autenticado (`POST /api/payments/orders/:orderId/intent`), o boleto era criado **sem `payer.address`** — campo obrigatório do `bolbradesco`. | `backend/src/modules/payments/payment.service.ts` | Gateway responde 400 e o cliente vê “dados inválidos”, sem explicação. |
| 7 | O mesmo fluxo só checava a **presença** do documento; não validava nome + sobrenome (exigidos pelo boleto) nem o **dígito verificador** do CPF/CNPJ. | `payment.service.ts`, `services/orders.ts`, `services/pedido-payments.ts` | Cobrança recusada, tentativa gravada como falha, mensagem genérica. |
| 8 | O fluxo autenticado usava e-mail **fictício** (`comprador@mastore.local`) quando o pedido não tinha e-mail. | `payment.service.ts` | Viola a regra de não inventar dados e é recusado pelo gateway. |
| 9 | O tipo do documento era fixado em `"CPF"` mesmo com 14 dígitos (CNPJ). | `services/pedido-payments.ts`, checkout/rastreio | `identification` inconsistente → recusa do gateway. |
| 10 | Nenhum vencimento era enviado ao gateway (`date_of_expiration`): a data impressa no boleto ficava a critério da conta. | `services/mercadopago/index.ts` | Divergência entre o vencimento exibido na loja e o do documento. |
| 11 | A tela de rastreio exibia a linha digitável sem botão de copiar, sem valor e sem instruções de pagamento. | `frontend/src/pages/TrackingPage.tsx` | UX incompleta para o comprador de boleto. |
| 12 | CPF validado no navegador apenas por quantidade de dígitos. | `frontend/src/pages/CheckoutPage.tsx`, `TrackingPage.tsx` | Cliente só descobria o erro depois de criar o pedido/cobrança. |

### A.3 Itens auditados e considerados corretos (sem alteração)

- Recalculo de preços/frete **no servidor** a partir de produtos e cotações persistidas (`orders.createGuestPedido`, `computePedidoAmount`) — o frontend não consegue alterar valores por manipulação de requisição.
- Idempotência de pedido (`pagamento_idempotency_key`, `frete_quote_id`), de cobrança (`X-Idempotency-Key`) e de webhook (`@@unique(provider, eventId)`).
- Webhook do Mercado Pago: assinatura `x-signature` (manifesto `id:…;request-id:…;ts:…`) e consulta do pagamento **real** no gateway antes de confirmar; valores divergentes viram `Divergente`.
- Seleção enxuta de produtos na listagem, paginação no banco, índices (incluindo `pg_trgm` para busca), compressão HTTP (brotli/gzip), code splitting por rota e lazy loading de imagens.
- Nenhum segredo no frontend; Access Token/Webhook Secret apenas no backend.

---

## B. Correções implementadas

### B.1 Imagens — pipeline não destrutivo com WebP + `srcset`

**Novos arquivos**

- `backend/src/services/image-variants.ts` — gera variantes WebP **320/640/960/1280 px** com `sharp`, `withoutEnlargement` (nunca amplia), qualidade 82, `failOn: "none"`; cache em `uploads/.cache/<largura>/<arquivo>.webp`; `singleflight` para não processar a mesma imagem duas vezes; nunca lança (falha → original).
- `backend/src/modules/media/image.routes.ts` — `GET /uploads/opt/<largura>/<arquivo>`; valida largura e nome (bloqueia path traversal), responde `image/webp` com `Cache-Control: public, max-age=31536000, immutable`, 404 quando não aplicável.

**Alterações**

- `backend/src/services/storage.ts` — aquece as variantes no upload (best-effort) e remove as variantes ao apagar a imagem. **O arquivo original jamais é alterado, comprimido ou substituído.**
- `backend/src/app.ts` — registra a rota de variantes após o `@fastify/static` (rota mais específica tem prioridade).
- `backend/tsup.config.ts` — `sharp` como `external` (binário nativo).
- `backend/package.json` / `package-lock.json` — dependência `sharp`.
- `frontend/src/lib/images.ts` — `buildImageSrcSet()` (apenas uploads locais; CDN externo mantém a URL original) e presets `IMAGE_SIZES`.
- `frontend/src/components/ui/StoreValue.tsx` — `ProductImage` aceita `sizes` e emite `srcSet`; fallback para o placeholder preservado.
- `frontend/src/components/product/ProductCard.tsx`, `Catalog.tsx` — `sizes` reais do layout (card e galeria).

**Efeito:** em telas pequenas o navegador escolhe 320/640 px em WebP em vez da foto original. GIF animado é preservado (não convertido).

### B.2 Catálogo — cache de aplicação, `singleflight` e `ETag`

**Novos arquivos**

- `backend/src/lib/cache.ts` — cache TTL (20–60 s) com LRU limitado (300 entradas), `singleflight` e invalidação por prefixo.
- `backend/src/lib/http-cache.ts` — `sendCached()`: serializa uma vez (`Decimal` → `number`), calcula `ETag` fraco, responde **304** para `If-None-Match` correspondente e envia `Cache-Control` público.

**Alterações**

- `product.routes.ts` — `/`, `/facets`, `/:slug`, `/:slug/related` com cache + ETag (chave inclui todos os filtros, página e ordenação).
- `category.routes.ts`, `brand.routes.ts` — cache + ETag.
- `admin.routes.ts` — hook `onResponse`: qualquer escrita administrativa bem-sucedida invalida o catálogo na hora.
- `services/orders.ts` e `services/pedido-payments.ts` — reserva/confirmação/liberação de estoque também invalida, para o card não mostrar quantidade desatualizada.

**Segurança:** o cache é exclusivo de leitura pública (produtos ativos, categorias, marcas, facetas). Pedidos, clientes, tokens e qualquer dado por usuário continuam sem cache.

### B.3 Boleto — contrato completo com o Mercado Pago

- **Novo** `backend/src/lib/documents.ts` — validação de CPF/CNPJ por dígito verificador (módulo 11), rejeita sequências repetidas, normaliza máscara e identifica o tipo.
- **Novo** `backend/src/services/mercadopago/payer.ts` — extrai o endereço do pagador do snapshot do pedido (aceita os dois formatos históricos, nunca inventa endereço) e divide o nome completo em nome/sobrenome.
- `services/mercadopago/index.ts` — `createBoletoPayment` envia `date_of_expiration` (`formatMercadoPagoDate`, ISO com `-03:00`) e mantém `payer.address`; resposta segue mapeando `external_resource_url` (link do boleto) e `transaction_details.barcode.content` (linha digitável).
- `services/mercadopago/config.ts` — `boletoExpirationDate()` com `BOLETO_EXPIRES_DAYS` (1–30, padrão 3).
- `env.ts` + `.env.example` — nova variável documentada.
- `modules/payments/payment.service.ts` — valida nome + sobrenome, CPF/CNPJ (dígito), endereço completo; deriva o tipo do documento; **recusa e-mail fictício** (422 com mensagem clara); envia vencimento.
- `services/pedido-payments.ts`, `services/orders.ts` — validação por dígito verificador e `date_of_expiration`.
- `frontend/src/lib/documents.ts` (novo) — mesma validação no navegador.
- `CheckoutPage.tsx` / `TrackingPage.tsx` — documento validado antes de enviar, tipo derivado (CPF/CNPJ), mensagem de erro no campo.
- `TrackingPage.tsx` — boleto agora mostra **link, linha digitável com botão de copiar, valor, vencimento e instruções**; nada de “sucesso” quando o link não existe (mensagem de indisponibilidade + nova tentativa).

**Estados:** o mapeamento central (`status-map.ts`) já cobre `pending`, `in_process`, `authorized`, `approved`, `rejected`, `cancelled/canceled`, `expired`, `refunded`, `charged_back`; o pedido só é considerado pago após consulta real ao gateway (webhook). Nenhuma mudança necessária.

---

## C. Desempenho — medições reais deste ambiente

### C.1 Imagens (medido com o próprio pipeline, imagem 3000×3000 JPEG)

| Recurso | Peso | Redução |
|---|---:|---:|
| Original (JPEG 3000 px) | **6.756.396 B (6,76 MB)** | — |
| Variante 320 px (WebP) | **11.168 B (10,9 KB)** | −99,8% |
| Variante 640 px (WebP) | **72.418 B (70,7 KB)** | −98,9% |
| Variante 960 px (WebP) | 365.548 B (357 KB) | −94,6% |
| Variante 1280 px (WebP) | 837.058 B (817 KB) | −87,6% |

O card da vitrine no celular usa `sizes="(max-width: 480px) 45vw, …"` → na prática baixa **320/640 px**. O original continua intacto e disponível (admin, download).

### C.2 API / banco

- Antes: cada requisição executava `findMany` + `count` (e, em facetas/categorias, mais 2–3 consultas).
- Depois: uma execução por chave a cada 20–60 s; requisições concorrentes para a mesma chave executam **uma única** consulta (testado com 3 chamadas simultâneas → 1 execução).
- Revalidação barata: cliente com `ETag` recebe **304 sem corpo**.
- Payload da listagem já era enxuto (sem `description`/metadados) — mantido.

> Tempo de resposta da API e Lighthouse **não** foram medidos aqui: este sandbox não possui PostgreSQL (ver F). As reduções acima são de bytes e de número de consultas, medidas diretamente.

---

## D. Mercado Pago

- **Integração corrigida?** Sim, no que depende do código: contrato de boleto completo (endereço, nome/sobrenome, CPF/CNPJ validado, vencimento), e-mail real obrigatório, tipo de documento correto, resposta mapeada para link/linha digitável.
- **Emissão testada de ponta a ponta?** **Não.** Não há credenciais nem conta Mercado Pago neste ambiente. O que foi testado: o **body exato** enviado à API de Payments (spy no cliente do SDK), o mapeamento da resposta e as validações locais (275 testes unitários).
- **Webhook funcionando?** A validação de assinatura, idempotência e consulta real já estavam implementadas e cobertas por testes existentes; não foi alterado. Só é possível confirmar com URL pública + credenciais reais.
- **Configurações externas pendentes:** conta Mercado Pago habilitada para **boleto** (`bolbradesco`), credenciais de produção (`APP_USR-…`), `MERCADOPAGO_WEBHOOK_SECRET` e `PUBLIC_API_URL` pública apontando para `/api/payments/webhooks/mercadopago`.

---

## E. Testes executados

| Suíte | Resultado |
|---|---|
| Backend — unitários (`vitest --config vitest.unit.config.ts`) | **40 arquivos, 275 testes, todos passando** |
| Frontend — unitários/componentes (`vitest run`) | **16 arquivos, 109 testes, todos passando** |
| Backend — `tsc --noEmit` | **0 erros** |
| Frontend — `tsc --noEmit` | **0 erros** |
| Backend — `npm run build` (tsup) | **sucesso** |
| Frontend — `npm run build` (tsc + vite) | **sucesso** |
| Smoke de rotas (Fastify `app.inject`, sem banco) | `/uploads/opt/640/<arquivo>` → **200 `image/webp`**; `/uploads/teste.jpg` → **200 `image/jpeg`**; largura inválida/arquivo inexistente → **404** |

Novos testes adicionados nesta rodada:

- `backend/tests/unit/documents.test.ts` — CPF/CNPJ (válidos, inválidos, repetidos, tipo).
- `backend/tests/unit/cache.test.ts` — TTL, singleflight, invalidação por prefixo.
- `backend/tests/unit/http-cache.test.ts` — `ETag`, `304`, chave estável por filtros.
- `backend/tests/unit/image-variants.test.ts` — WebP real, `withoutEnlargement`, original intacto, path traversal, GIF.
- `backend/tests/unit/mercadopago-boleto-request.test.ts` — body real do boleto (`bolbradesco`, `address`, `date_of_expiration -03:00`) e mapeamento da resposta.
- `backend/tests/unit/mercadopago-boleto.test.ts` (estendido) — data do gateway, snapshot de endereço, nome/sobrenome.
- `frontend/src/lib/documents.test.ts` e `frontend/src/lib/images.test.ts` (estendido) — validação e `srcset`.

**Não executados:** `tests/integration` e `tests/e2e` (exigem PostgreSQL). Comando, quando houver banco de teste:

```bash
cd backend
export TEST_DATABASE_URL="postgresql://usuario:senha@host:5432/mastore_test?schema=public"
npx prisma migrate deploy && npm run seed:test
npm test          # integração + e2e
```

---

## F. Pendências (somente externas)

1. **Banco de teste** para rodar integração/e2e (não existe PostgreSQL neste ambiente).
2. **Credenciais Mercado Pago de produção** (`APP_USR-…`) e **boleto habilitado** na conta; sem isso o meio “Boleto” continua indisponível no checkout (por design, não é simulado).
3. **`PUBLIC_API_URL` público** (HTTPS) para o Mercado Pago alcançar o webhook, e `MERCADOPAGO_WEBHOOK_SECRET` correspondente.
4. **Lighthouse / Core Web Vitals** em navegador real, com catálogo e rede reais (aqui só foi possível medir bytes e consultas).
5. **S3/CDN** (opcional): as variantes WebP são geradas apenas no driver `local`. Com `STORAGE_DRIVER=s3` a loja continua servindo a URL original do bucket (sem quebra); para otimizar em S3 é necessário um CDN de imagens ou Lambda de transformação.
6. **Push/PWA em iPhone físico** e comportamento de CDN/proxy implantado — não verificáveis neste sandbox.

---

## G. Entrega — instalação, execução e configuração

### Requisitos

- Node.js ≥ 20.11
- PostgreSQL 14+ (produção: Neon/Render)

### Backend

```bash
cd backend
cp .env.example .env          # preencha DATABASE_URL, JWT_SECRET, WEBHOOK_SECRET
npm ci
npx prisma generate
npx prisma migrate deploy     # nenhuma migration nova nesta rodada (sem mudança de schema)
npm run seed:dev              # opcional, apenas desenvolvimento
npm run dev                   # API em http://localhost:3333
```

Variáveis novas/relacionadas:

```env
BOLETO_EXPIRES_DAYS=3         # vencimento do boleto (1–30)
PAYMENT_PROVIDER=mercadopago
PAYMENT_ENV=production        # ou sandbox
MERCADOPAGO_ACCESS_TOKEN=     # PRIVADO — nunca no frontend/Git
MERCADOPAGO_PUBLIC_KEY=
MERCADOPAGO_WEBHOOK_SECRET=
PUBLIC_API_URL=https://sua-api.exemplo.com
```

> `sharp` é dependência nativa. No Docker (Alpine) o `npm ci` já instala o binário musl correto; no `tsup` ele fica como `external`.

### Frontend

```bash
cd frontend
npm ci
VITE_API_URL=https://sua-api.exemplo.com/api npm run build
```

### Verificações rápidas

```bash
cd backend  && npx tsc --noEmit && npx vitest run --config vitest.unit.config.ts
cd frontend && npx tsc --noEmit && npx vitest run && npm run build
```

### Conteúdo do ZIP

Projeto completo com a estrutura original (`backend/`, `frontend/`, `docker/`, `docs/`, `prisma/`, scripts e testes), **sem** `node_modules`, `dist` e `.git`. Este relatório está na raiz como `RELATORIO_AUDITORIA_V3.md`.

---

## Resumo executivo

| Critério de conclusão | Situação |
|---|---|
| Vitrine carrega com desempenho otimizado | ✅ cache + `ETag`/304 + payload enxuto (medições em C) |
| Imagens carregadas eficientemente | ✅ WebP 320/640/960/1280 + `srcset` (6,76 MB → 70,7 KB em 640 px) |
| Consultas ao banco otimizadas | ✅ cache com coalescência; índices já existentes |
| Checkout validando dados | ✅ CPF/CNPJ por dígito no servidor e no cliente; preço/frete recalculados |
| Fluxo de boleto com API real | ✅ contrato completo implementado; **emissão real pendente de credenciais** |
| Estados de pagamento sincronizados | ✅ mapeamento central + confirmação via webhook/consulta real |
| Webhooks tratados | ✅ assinatura + idempotência (já existente, coberto por testes) |
| Funcionalidades existentes preservadas | ✅ nenhuma rota/feature removida; suítes passando |
| Testes de regressão | ✅ 275 backend + 109 frontend (unitários); integração/e2e dependem de banco |
| Relatório final disponível | ✅ este documento |
