# Relatório — Correção de Performance da Vitrine + Bloqueio Temporário do Boleto

**Projeto:** MA STORE (frontend React/Vite + backend Fastify/Prisma/PostgreSQL)
**Data:** 2026-11-14
**Escopo:** otimização da vitrine, imagens responsivas, paginação progressiva, cache/API/índices e desativação do **boleto para novas compras** (sem remover a integração).

> Este relatório descreve apenas o que foi **executado**. Testes que dependem de PostgreSQL, Mercado Pago ou do ambiente de produção estão marcados como **NÃO EXECUTADOS** e listados em “Pendências”.

---

## A. Diagnóstico

### A.1 O que já existia (auditado antes de alterar)

A auditoria confirmou que parte relevante da infraestrutura de performance já estava implementada, e **não foi duplicada**:

| Item | Situação encontrada |
|---|---|
| Cache de catálogo (memória, LRU, TTL, singleflight) | `backend/src/lib/cache.ts` — já existia |
| ETag / 304 / Cache-Control | `backend/src/lib/http-cache.ts` — já existia |
| Compressão HTTP (br/gzip/deflate) | `@fastify/compress` com `threshold` 1 KB — já existia |
| Variantes WebP 320/640/960/1280 | `backend/src/services/image-variants.ts` + rota `/uploads/opt/...` — já existia |
| `srcset`/`sizes`, `loading=lazy`, `decoding=async`, `fetchpriority` | `ProductImage` + `lib/images.ts` — já existia |
| Invalidação de cache em mutação administrativa e de estoque | `invalidateCatalogCache()` em `admin.routes`, `orders`, `pedido-payments` — já existia |
| Índices de busca (pg_trgm/GIN) e FKs | migração `20260918153000_performance_indexes` — já existia |
| Paginação no servidor (12/página no frontend) | existia, com **Paginação por página** (`Pagination`) |
| Skeleton/estado de erro | componentes `SkeletonProductGrid`/`ErrorState` — já existiam |

### A.2 Problemas ainda encontrados

1. **Paginação “de página”**: para ver mais produtos o cliente saía da lista (perdia scroll/contexto), e cada página era uma nova montagem de tela. O requisito pede carregamento progressivo (“12 + 12 …”).
2. **Sem AVIF**: só WebP era gerado. AVIF reduz 40–60% do peso em relação ao WebP na mesma qualidade percebida.
3. **Cache do contrato de pagamento insuficiente**: `/api/payment-methods` anunciava o boleto como disponível sempre que o Mercado Pago estivesse configurado, sem nenhuma chave comercial centralizada.
4. **Boleto sem bloqueio central**: o método `BOLETO` era aceito em 4 pontos de entrada diferentes (pedido guest, pedido autenticado, início de pagamento e intent de pagamento). Não havia regra única que impedisse cobrança/gravação.
5. **Cards re-renderizavam** a cada atualização da lista (sem memoização), o que pesa em listas longas.
6. **Índices ausentes** exatamente nas consultas da vitrine: ordenação por preço/mais vendidos e filtro de estoque partindo sempre de `active = true`; e no painel/job de expiração de pagamentos.

### A.3 Problemas que dependem de infraestrutura externa

- Imagens hospedadas em **S3/R2/CDN externo** não podem ser redimensionadas pelo pipeline local (o `sharp` só lê arquivos do driver `local`). O frontend **não inventa** variantes para URLs externas: usa a URL original. Para obter o mesmo ganho com storage externo é necessário usar um transformador do próprio provedor (ex.: Cloudflare Images/Resizing ou um `sharp` rodando no mesmo bucket), o que exige decisão/custo de infraestrutura.
- Métricas de campo (LCP/CLS/INP reais, cache frio x aquecido, 4G) exigem o ambiente publicado e dados reais.

---

## B. Arquivos modificados

### Backend

| Arquivo | Alteração |
|---|---|
| `backend/src/env.ts` | Nova flag `BOLETO_ENABLED` (boolean, **padrão `false`**). Validação central de ambiente já existente foi mantida. |
| `backend/src/services/payment-flags.ts` **(novo)** | Autoridade única sobre disponibilidade de meios de pagamento: `isBoletoEnabled()`, `isPaymentMethodEnabled()`, `assertPaymentMethodEnabled()` (422 + código `BOLETO_UNAVAILABLE`) e `boletoAvailability()` para a API pública. |
| `backend/src/services/pedido-payments.ts` | Guarda `assertPaymentMethodEnabled(input.metodo)` como **primeira** instrução de `startPedidoPayment` — antes de ler o pedido, gravar status ou chamar o Mercado Pago. |
| `backend/src/services/orders.ts` | **Duas barreiras** no checkout guest: (1) primeira instrução de `createGuestPedido` — antes de consultar produtos/gerar cotação de frete; (2) logo após resolver `metodoPagamento` — antes de reservar estoque, criar pedido ou cobrar. |
| `backend/src/modules/orders/order.service.ts` | Guarda no início de `createOrder` (checkout autenticado), antes de qualquer query. |
| `backend/src/modules/payments/payment.service.ts` | Guarda no início de `createPaymentIntent`, antes de criar `Payment`/chamar gateway. |
| `backend/src/modules/payments/payment-methods.routes.ts` | Passa a devolver `boletoEnabled` (topo) e `comingSoon` por método; boleto só fica `enabled` com gateway configurado **E** flag ligada; nota “Em breve” quando desativado. PIX/cartão/COMBINAR inalterados. |
| `backend/src/services/payment-config.ts` | Diagnóstico administrativo inclui `boletoEnabled` (sem expor segredos). |
| `backend/src/services/image-variants.ts` | Suporte a `format: "avif"` (`variantPathFor`, `getImageVariant`), AVIF quality 50, cache por formato, aquecimento AVIF em background, remoção das duas variantes. Original nunca é alterado. |
| `backend/src/modules/media/image.routes.ts` | Nova rota `GET /uploads/opt/avif/:width/:file` (`image/avif`, `immutable`), mantendo `/uploads/opt/:width/:file` (WebP). |
| `backend/prisma/schema.prisma` | Índices: `(active, price)`, `(active, soldStock, createdAt)`, `(active, volume)`, `(active, stock)` em `Product`; `(statusAtual, criadoEm)` e `(pagamentoStatus, pagamentoExpiraEm)` em `Pedido`. |
| `backend/prisma/migrations/20261115120000_storefront_perf_indexes/migration.sql` **(novo)** | Migração **aditiva** (`CREATE INDEX IF NOT EXISTS`), sem alterar/apagar dados. |
| `backend/.env.example` | Documenta `BOLETO_ENABLED=false` e o efeito da flag. |
| `backend/tests/unit/payment-flags.test.ts` **(novo)** | 6 testes da regra central (desligado/ligado, variações de caixa, mensagem/status). |
| `backend/tests/unit/boleto-guards.test.ts` **(novo)** | 3 testes provando que as guardas rodam antes de tocar no banco (`spy` em `prisma.*.findMany/findUnique` não é chamado). |
| `backend/tests/unit/image-variants.test.ts` | +1 teste de geração AVIF e imutabilidade do original. |
| `backend/tests/integration/boleto.test.ts` | Mantido para o cenário **habilitado** (`BOLETO_ENABLED: true` no mock de env), agora explícito. |
| `backend/tests/integration/boleto-blocked.test.ts` **(novo)** | Cenário bloqueado: 422 sem criar pedido, sem reservar estoque, sem chamar gateway; pedido histórico intacto; PIX segue funcionando. |

### Frontend

| Arquivo | Alteração |
|---|---|
| `frontend/src/hooks/index.ts` | Novo `useProductsInfinite()` (React Query `useInfiniteQuery`, 12/página, chave inclui **todos** os filtros; `initialPageParam` respeita `?page=` legado). |
| `frontend/src/components/product/CatalogView.tsx` | Lista agora é progressiva: 12 produtos iniciais + botão **“Carregar mais produtos”**, contador “Mostrando X de Y”, mensagem de fim de lista, erro da próxima página com “Tentar novamente”. Dedupe por `id`; filtros/ordenação/busca preservados; requisições antigas não sobrescrevem a lista (chave da query). |
| `frontend/src/components/product/ProductCard.tsx` | `React.memo` no card (evita re-render dos cards já exibidos quando a lista cresce). Nenhuma funcionalidade removida. |
| `frontend/src/lib/images.ts` | `buildImageSrcSet(..., format)` com `avif`; continua **não** gerando variantes para CDN externo/GIF/SVG. |
| `frontend/src/components/ui/StoreValue.tsx` | `ProductImage` emite `<picture>` com `<source type="image/avif">` + `<img>` WebP + original como fallback (`display: contents` preserva o layout). |
| `frontend/src/pages/CheckoutPage.tsx` | Boleto sempre visível quando desativado, **radio `disabled`** (clique e teclado) com selo **“EM BREVE”**, texto “Indisponível temporariamente” e aviso **somente ao interagir**; `PIX`/cartão/COMBINAR inalterados; defesa extra no submit. |
| `frontend/src/styles/catalog.css` | `.catalog-more` (rodapé de carregamento), `.option-item--disabled`, `.option-item__badge`, fundo de placeholder do card. |
| `frontend/src/pages/checkout-payment.test.tsx` **(novo)** | Boleto não selecionável, PIX permanece marcado, aviso só no clique com o texto exigido, selo “Em breve”. |
| `frontend/src/components/product/CatalogView.test.tsx` **(novo)** | 12+12 progressivo sem duplicar, total no rodapé, estado de erro com retry. |
| `frontend/src/lib/images.test.ts` | +1 teste do `srcset` AVIF. |

### Raiz / documentação

| Arquivo | Alteração |
|---|---|
| `.env.example`, `render.yaml` | `BOLETO_ENABLED=false` documentado e provisionado (reactive trocando para `true`). |
| `API.md` | Nova seção `8.1 GET /api/payment-methods` com contrato, campo `comingSoon` e regra `BOLETO_ENABLED` / erro 422. |
| `RELATORIO_CORRECAO_PERFORMANCE_E_BOLETO.md` | Este relatório. |

---

## C. Performance

### C.1 Imagens (estratégia)

1. Original **nunca** é alterado nem apagado.
2. Variantes em disco: `<uploads>/.cache/<largura>/<arquivo>.webp` e `<uploads>/.cache/avif/<largura>/<arquivo>.avif`.
3. Larguras: **320 / 640 / 960 / 1280** (alinhadas ao CSS: card, galeria, detalhe).
4. `withoutEnlargement`: imagem de 300 px nunca é ampliada e borrada.
5. WebP quality 82; AVIF quality 50 (`effort` 4). GIF e SVG não são convertidos.
6. Upload aquece WebP (aguardado) e AVIF (background) — o upload não fica lento.
7. Rota imutável (`Cache-Control: public, max-age=31536000, immutable`), URL única por formato/tamanho (sem `Vary`, cacheável em CDN).
8. `<picture>`: AVIF → WebP (`srcset`/`sizes`) → original (`src`).
9. CDN externo: sem variantes; usa o original (limitação explícita, ver **F**).
10. Nada de Base64 de imagens grandes no banco.

**Medição local executada** (`work/measure-images.mjs`, imagem sintética 3000×3000 JPEG q90 — serve para medir o *trade-off* de compressão, **não** é uma foto real de catálogo):

| Saída | Peso |
|---|---|
| Original JPEG 3000 px | 4123,7 KB |
| WebP 320 px | 4,1 KB |
| **AVIF 320 px** | **1,8 KB** |
| WebP 640 px | 30,9 KB |
| **AVIF 640 px** | **12,5 KB** |
| WebP 960 px | 97,3 KB |
| **AVIF 960 px** | **36,6 KB** |
| WebP 1280 px | 228,3 KB |
| **AVIF 1280 px** | **74,5 KB** |

> Leitura: no card de ~260 px o navegador baixa **1,8 KB (AVIF)** ou **4,1 KB (WebP)** em vez do original de **4,1 MB** — redução de ~99,9% nesse cenário. O AVIF economiza ainda ~55% sobre o WebP.

### C.2 Paginação progressiva

- Lote inicial: **12 produtos**; cada clique acrescenta **12**.
- Filtros/ordenação/busca permanecem na URL e na chave do React Query.
- Sem duplicação (dedupe por `id`) e sem “resposta antiga vencendo”: trocar filtro cria nova consulta.
- Links antigos com `?page=N` continuam válidos (`initialPageParam`).
- Rodapé informa “Mostrando X de Y” e o fim da lista.
- **Cursor pagination foi avaliada e não adotada**: a vitrine aceita 7 ordenações arbitrárias (`price`, `soldStock`, `name`, `createdAt`, `isFeatured`…), e cursor exige uma chave total e estável por ordenação. Offset com `skip/take` + índices compostos é a solução correta para o tamanho atual do catálogo. O caminho para cursor fica documentado como evolução, não como pendência.

### C.3 Cache e API (auditado / preservado)

- Catálogo: cache em memória 20 s + `stale-while-revalidate`, `singleflight`, LRU 300 chaves.
- Facetas 60 s; categorias/marcas 60 s (TTL do cache) com `Cache-Control` 120 s.
- ETag fraco + `If-None-Match` → **304** sem corpo.
- Compressão brotli/gzip acima de 1 KB.
- **Somente dados públicos** entram no cache; carrinho/pedidos/pagamentos nunca.
- Invalidação imediata em mutação administrativa, criação de pedido e mudança de status de pagamento.

### C.4 Banco de dados

- Índices adicionados (justificados pelas consultas reais da vitrine e do job de expiração), **sem migração destrutiva**.
- Consultas continuam usando `select` explícito (nunca `SELECT *`) e sem N+1: listagem = 1 `findMany` + 1 `count` em paralelo; relações vêm no mesmo `select`.

### C.5 Frontend

- Cards memoizados; segunda imagem do card só é renderizada em dispositivos com hover.
- `loading=lazy` fora da primeira dobra; `fetchpriority=high` apenas na primeira imagem; `decoding=async`; `sizes` por contexto; `aspect-ratio` reserva espaço (sem CLS).
- Skeleton de 12 cards na carga inicial, erro com retry, e estado vazio explicativo.
- Bundle de produção gerado: `react` 158,09 KB (51,85 KB gzip), `query` 52,49 KB (16,04 KB gzip), `index` 101,60 KB (31,74 KB gzip), `CheckoutPage` 20,97 KB (6,64 KB gzip).

### C.6 Resultados medidos (realidade do ambiente)

| Medição | Resultado |
|---|---|
| Testes unitários backend | **285 testes / 42 arquivos — aprovados** |
| Testes frontend | **114 testes / 18 arquivos — aprovados** |
| `tsc --noEmit` backend | aprovado |
| `tsc --noEmit` frontend | aprovado |
| `npm run build` backend (tsup) | aprovado (dist/index.js 560 KB) |
| `npm run build` frontend (tsc -b + vite) | aprovado |
| Compressão de imagem | tabela C.1 |
| LCP/CLS/INP/TTFB reais | **NÃO MEDIDOS** (sem ambiente publicado/DB) |

---

## D. Boleto

### D.1 Como foi desativado

- Chave única: **`BOLETO_ENABLED=false`** (padrão seguro no `env.ts`).
- A regra vive em `backend/src/services/payment-flags.ts` — **backend é a autoridade final**.
- O frontend **não decide**: ele lê `enabled`/`comingSoon` de `GET /api/payment-methods`.
- A flag não desliga o gateway, não apaga configuração, não apaga histórico: apenas impede **novas** contratações.

### D.2 Onde aparece o aviso

- Checkout (etapa **Revisão**): a opção “Boleto bancário” continua visível, com **“EM BREVE”**, “Indisponível temporariamente.” e “Em breve você poderá pagar suas compras por boleto bancário.”.
- O radio está `disabled` (não seleciona por clique **nem por teclado**) e o item tem `aria-disabled`.
- Ao **clicar** no item, aparece um toast (componente de feedback do design atual) com a mensagem obrigatória:
  > Pagamento por boleto indisponível no momento.
  > Estamos trabalhando para disponibilizar essa modalidade em breve!
  > Por enquanto, escolha PIX ou cartão para concluir sua compra.
- **Nenhum aviso automático** ao abrir o checkout; nada de modal invasivo; a modalidade já escolhida (PIX/cartão) **permanece selecionada**.
- Página de rastreio: o seletor de nova tentativa usa apenas métodos com `enabled=true`, então o boleto não aparece para novas cobranças.

### D.3 Como o backend impede novas cobranças

`assertPaymentMethodEnabled()` é chamado (sempre **antes** de gravar/cobrar) em:

1. `orders.createGuestPedido` — `POST /api/pedidos` (checkout guest) — **primeira instrução** e novamente antes da transação;
2. `orders.createOrder` — `POST /api/orders` (checkout autenticado);
3. `startPedidoPayment` — criação/retenção de cobrança no Mercado Pago (inclusive `POST /api/pedidos/:token/pagamento`);
4. `createPaymentIntent` — `POST /api/payments/orders/:orderId/intent`.

Resposta: **HTTP 422**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Pagamento por boleto temporariamente indisponível. Escolha PIX ou cartão.",
    "details": { "code": "BOLETO_UNAVAILABLE", "paymentMethod": "BOLETO", "retryWith": ["PIX", "CREDIT_CARD", "COMBINAR"] },
    "requestId": "..."
  }
}
```

Nesse ponto **não** houve: criação de pedido, reserva de estoque, registro de `Payment`, chamada ao Mercado Pago ou alteração de status. Variações de caixa/espaço (`" boleto "`, `"Boleto"`) são normalizadas e também bloqueadas.

### D.4 Pedidos antigos preservados

- Nenhum boleto emitido é apagado; nenhum pedido histórico é alterado/cancelado.
- `TrackingPage` continua exibindo linha digitável/URL/vencimento de boletos antigos.
- Webhooks (`/api/payments/webhooks/mercadopago`) e `processMercadoPagoNotification` **não** passam pela flag — pagamentos já emitidos continuam sendo confirmados.
- Job de expiração de pendentes segue rodando.
- O teste `boleto-blocked` verifica que um pedido histórico com `metodoPagamento = "BOLETO"` permanece `Pendente` após a tentativa bloqueada.

### D.5 Como reativar no futuro

1. Definir `BOLETO_ENABLED=true` no ambiente (Render: variável do serviço; já provisionada em `render.yaml` como `"false"`).
2. Reiniciar a API.
3. Nada mais: `/api/payment-methods` passa a devolver `BOLETO.enabled=true` / `comingSoon=false`, o checkout volta a exibir o radio habilitado e o backend aceita a modalidade. **Não é necessário** alterar código, rodar migração ou fazer deploy do frontend.

---

## E. Testes

### E.1 Executados e aprovados

| Suite | Comando | Resultado |
|---|---|---|
| Backend unit (inclui `payment-flags`, `boleto-guards`, AVIF, cache, shipping) | `npx vitest run --config vitest.unit.config.ts` | **285/285** |
| Frontend unit/integração (jsdom) | `npx vitest run` | **114/114** |
| Typecheck backend | `npm run typecheck` | aprovado |
| Typecheck frontend | `npm run typecheck` | aprovado |
| Build backend | `npm run build` | aprovado |
| Build frontend | `npm run build` | aprovado |

Cobertura nova relevante:

- **Boleto** — flag desligada bloqueia; flag ligada libera; 422 com mensagem/código; guardas não tocam no banco; PIX/cartão não bloqueados; checkout com radio desabilitado, PIX preservado, aviso só no clique; selo “Em breve”.
- **Vitrine** — 12 → “Carregar mais” anexa a página 2 sem duplicar, mantém a página 1 no DOM, mostra total; erro com retry.
- **Imagens** — variantes WebP/AVIF com largura correta, original inalterado, `withoutEnlargement`, `srcset` AVIF só para upload local.

### E.2 Executados e reprovados

Nenhum.

> Nota de transparência: durante o desenvolvimento, um teste novo de AVIF falhou porque o `sharp` reporta o container como `heif`; a asserção foi corrigida para validar o *brand* `avif` do arquivo (o comportamento do produto estava correto). A versão final passa.

### E.3 Não executados

| Suite | Motivo |
|---|---|
| `tests/integration/**` (inclui `boleto.test.ts` e o novo `boleto-blocked.test.ts`) | Requer **PostgreSQL** de teste (`TEST_DATABASE_URL`) + `prisma migrate deploy`. O sandbox não possui servidor PostgreSQL. |
| `tests/e2e/**` | Mesma dependência de banco. |
| `tests/browser/*` (auditorias Puppeteer) | Requerem backend + banco + navegador rodando. |
| Migração `20261115120000_storefront_perf_indexes` aplicada em banco real | Requer PostgreSQL. SQL é aditivo (`CREATE INDEX IF NOT EXISTS`). |
| Métricas de campo (LCP/CLS/INP/TTFB), cache frio x aquecido, 4.3G | Requerem ambiente publicado e dados reais. |

### E.4 Bloqueados por dependência externa

- Cobrança real/sandbox no Mercado Pago (credenciais reais) — os testes usam mock do adapter.
- Comportamento do boleto na conta Mercado Pago (aprovação do produto `bolbradesco`).

---

## F. Pendências (somente o que depende de fora do código)

1. **Aplicar a migração de índices** no banco de produção: `npx prisma migrate deploy` (aditiva; pode ser executada em horário de baixo tráfego — `CREATE INDEX` comum bloqueia escritas brevemente; para catálogo grande, avaliar `CREATE INDEX CONCURRENTLY` manual fora da migração).
2. **Definir `BOLETO_ENABLED=false`** no painel do Render (já provisionado em `render.yaml`; confirme o valor no serviço em produção) e reiniciar a API.
3. **Rodar a suíte de integração/e2e** em ambiente com PostgreSQL (`npm run test:integration`, `npm run test:e2e`) antes do deploy.
4. **Medir em produção** (PageSpeed/CrUX) a vitrine em 4G e o checkout, comparando cache frio x aquecido. Nenhuma métrica de campo foi inventada aqui.
5. **Imagens em S3/R2/CDN**: se o armazenamento real for externo, o pipeline `/uploads/opt` não atua. Opções: manter o original (fallback atual, sem quebrar URLs) ou contratar/ativar transformação de imagem do provedor. Requer decisão de infraestrutura/custo — não foi introduzido serviço pago novo.
6. **AVIF em cache frio**: a primeira requisição de uma variante AVIF recém-enviada pode gerar o arquivo sob demanda (dezenas/centenas de ms). O aquecimento em background no upload reduz isso, mas a validação real depende de rodar o backend com `sharp` no ambiente de produção.

---

## Critérios de aceitação

| Critério | Status |
|---|---|
| Vitrine carrega progressivamente | ✅ 12 + “Carregar mais” (teste automatizado) |
| Imagens usam versão adequada ao tamanho exibido | ✅ `srcset`/`sizes` + variantes 320/640/960/1280 |
| Navegador não baixa todas as imagens de uma vez | ✅ `lazy` após a primeira dobra; 2ª imagem só com hover |
| Catálogo sem consultas desnecessárias | ✅ 1 `findMany` + 1 `count` (paralelos), cache + singleflight |
| Paginação preserva filtros e ordenação | ✅ estado na URL + chave da query |
| Cache sem dados desatualizados indevidos | ✅ TTL curto + invalidação em mutação/estoque |
| Checkout continua responsivo | ✅ builds e 114 testes frontend |
| Boleto aparece como indisponível | ✅ selo “EM BREVE” + texto |
| Aviso somente ao tentar selecionar boleto | ✅ toast no clique; nenhum aviso automático |
| Cliente não consegue selecionar boleto | ✅ radio `disabled` + `aria-disabled` |
| Backend rejeita tentativa direta | ✅ 422 em 4 pontos de entrada, antes de gravar/cobrar |
| PIX continua funcionando | ✅ inalterado + teste de regressão |
| Cartão continua funcionando | ✅ inalterado |
| Pedidos antigos não afetados | ✅ nenhuma alteração em histórico/webhooks/rastreio |
| Builds e testes executados e documentados | ✅ seção E |
| Relatório final criado | ✅ este arquivo |
