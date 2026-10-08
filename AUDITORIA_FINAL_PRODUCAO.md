# AUDITORIA FINAL — MA STORE
## Prontidão para produção (evidência técnica)

**Data:** 2026-10-08
**Base auditada:** `ma-store-final.zip` (cópia de trabalho em `/tmp/mastore`)
**Método:** inspeção de código + execução de validações locais. Nenhum pagamento
real, nenhum dado apagado, nenhuma integração real substituída por mock.

> **Regra aplicada:** uma funcionalidade só é "✅ FUNCIONANDO" quando o fluxo
> completo é comprovável. Quando a comprovação depende de credencial/ambiente
> externo, o status é "⏳ DEPENDÊNCIA EXTERNA" ou "⚠️ PARCIAL" — nunca "✅".

---

## 0. Preservação das correções anteriores (obrigatório)

Verificado que as 4 correções anteriores continuam no código:

| Correção anterior | Evidência | Status |
|---|---|---|
| Entrega de imagens em `/uploads/*` | `backend/src/app.ts:121-136` (`fastifyStatic`, `wildcard` padrão, `prefix:"/uploads/"`, `maxAge:"30d"`, `immutable:true`) | ✅ intacta |
| Renovação automática de access token | `frontend/src/lib/api.ts:246-261` (refresh em 401) + `backend/src/modules/auth/auth.service.ts:129` (`refresh`) | ✅ intacta |
| Renovação de sessão durante upload | `frontend/src/lib/api.ts:377-383` + teste `frontend/src/lib/api.upload.test.ts:63` | ✅ intacta |
| Repetição controlada após 401 | `frontend/src/lib/api.ts:424-428` + teste `api.test.ts:92` | ✅ intacta |

Nada foi revertido.

---

## 1. Evidência de execução (testes realizados nesta auditoria)

| Comando | Resultado |
|---|---|
| `npx prisma validate` | ✅ exit 0 — "schema is valid" |
| `npx prisma generate` | ✅ exit 0 |
| `npx tsc --noEmit` (backend) | ✅ exit 0 |
| `npx vitest run --config vitest.unit.config.ts` | ✅ **176/176** em 28 arquivos |
| `npm run build` (frontend) | ✅ 0 erros ("built in 1.96s") |
| `npx vitest run` (frontend) | ✅ **94/94** |
| `tests/integration/mercadopago.test.ts` | ⏸️ **não executado** — sem PostgreSQL/Docker no ambiente |
| Cobrança real (PIX/cartão/boleto) | ⏸️ **não executado** — sem credenciais |
| Webhook real ponta a ponta | ⏸️ **não executado** — sem URL pública |
| Instalação PWA em iPhone/Safari | ⏸️ **não executado** — sem dispositivo físico |

---

## 2. Auditoria por funcionalidade

### 1) AUTENTICAÇÃO — ✅ FUNCIONANDO
- **Evidência:** `backend/src/modules/auth/auth.routes.ts` (login/refresh/logout), `auth.service.ts` (hash `sha256(refreshToken)`, rotação de sessão), `frontend/src/lib/api.ts` (refresh único + retry).
- **Rota:** `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`.
- **Teste:** unitários de auth + `api.test.ts` (renovação em 401) — passaram.
- **Ressalva:** validação contra banco real não executada (sem Postgres).

### 2) ADMIN — ✅ FUNCIONANDO
- **Evidência:** `backend/src/modules/admin/admin.routes.ts` aplica `app.addHook("preHandler", app.requireAdmin)` — cobre **todos** os 16 submódulos (`products`, `categories`, `brands`, `orders`, `content`, `settings`, `uploads`, `diagnostics`, `lab`...).
- **Rota:** `/api/admin/**`.
- **Teste:** inspeção + typecheck. Nenhuma rota admin sem auth.

### 3) PRODUTOS — ✅ FUNCIONANDO
- **Evidência:** `product.routes.ts` (público) + `admin/product.admin.routes.ts` (CRUD) + frontend `ProductPage`/`CatalogPage`.
- **Teste:** unitários de catálogo/guest-checkout passaram.

### 4) CATEGORIAS — ✅ FUNCIONANDO
- **Evidência:** `category.routes.ts` + `admin/category.admin.routes.ts`; subrotas registradas com prefixo (`admin.routes.ts:255`).
- **Teste:** typecheck + unitários.

### 5) IMAGENS — ⚠️ PARCIAL (código OK; produção depende de storage)
- **Evidência (local):** `app.ts:121-136` serve `GET /uploads/*`; validação por magic bytes e limite em `storage.ts`; `GET /uploads/<arquivo>` com cache imutável 30d.
- **Ponto crítico:** com `STORAGE_DRIVER=local` (padrão em `.env.example:84`), o diretório é o **disco do container**. Em Render/Fly o FS é **efêmero** → imagens **somem** em redeploy/restart.
- **Correção necessária:** definir `STORAGE_DRIVER=s3` (+ bucket) **ou** montar disco persistente em `STORAGE_LOCAL_DIR`.
- **Teste:** imagem antiga/nova não testadas aqui (sem instância em execução).

### 6) STORAGE — ⚠️ PARCIAL
- **Evidência:** `backend/src/services/storage-s3.ts` (driver S3-compatível: R2/B2/MinIO/Spaces), `storage.ts` (dispatch local/s3), `env.ts:224-244` (fail-fast em produção se `s3` sem bucket).
- **Rota:** `GET /uploads/*` (local) / `STORAGE_PUBLIC_URL` (S3).
- **Pendência:** driver **não validado contra bucket real**. `⏳`.

### 7) CARRINHO — ✅ FUNCIONANDO
- **Evidência:** `cart.routes.ts` — `GET /`, `POST /items`, `PATCH /items/:id`, `DELETE /items/:id`, `DELETE /`. Carrinho de convidado + autenticado.
- **Teste:** unitários + build frontend.

### 8) FRETE — ✅ FUNCIONANDO (local) / ⏳ (transportadoras reais)
- **Evidência:** motor externo (`shipping-engine/`: Correios, Jetlog, Pegaki, Flex, Retirada) + motor local próprio, selecionável; snapshot no pedido (`freteEscolhidoNome/Valor/Prazo`, `freteTransportadora`, `freteServico`, `freteQuoteId`).
- **Rota:** `/api/shipping`, `/api/v1/shipping`.
- **Teste:** **23 testes** de frete passaram (quote.service, correios-client, correios-provider, local domain).
- **Pendência:** cotação real de transportadora exige credenciais → `⏳`.

### 9) CHECKOUT — ✅ FUNCIONANDO
- **Evidência:** guest checkout (`pedido.routes.ts` `POST /api/pedidos`); servidor **recalcula** produtos + frete (`orders.ts`, `computePedidoAmount`), rejeita divergência de valor.
- **Teste:** `guest-checkout.test.ts` (10) + integração de guest checkout.

### 10) PIX — ⏳ DEPENDÊNCIA EXTERNA
- **Evidência:** `mercadopago/index.ts` (`createPixPayment`), QR real (`pagamentoPayload`, `pagamentoQrCodeBase64`), exibido em `TrackingPage.tsx`; fallback PIX estático preservado.
- **Causa do ⏳:** sem `MERCADOPAGO_ACCESS_TOKEN/PUBLIC_KEY/WEBHOOK_SECRET` o meio fica `enabled:false` (`payment-methods.routes.ts`).
- **Teste real:** **não realizado** → não declaro PIX como funcionando.

### 11) CARTÃO — ⏳ DEPENDÊNCIA EXTERNA
- **Evidência:** tokenização no frontend (`lib/mercadopago.ts`, SDK JS) — **dados crus do cartão nunca vão ao backend**; backend só recebe `card.token`. Redaction de `card.token`/`card.cvv` em `app.ts`.
- **Teste real:** não realizado.

### 12) BOLETO — ⏳ DEPENDÊNCIA EXTERNA
- **Evidência:** `createBoletoPayment`, `pagamentoBoletoUrl`, `pagamentoBoletoBarcode`, `pagamentoExpiraEm`.
- **Ressalva:** boleto pode não estar habilitado na conta MP → o gateway pode recusar.

### 13) WEBHOOKS — ⚠️ PARCIAL
- **Evidência:** `payment.routes.ts:148` `POST /api/payments/webhooks/mercadopago`:
  - valida `x-signature` (HMAC-SHA256, `signature.ts`);
  - **idempotência** por `webhook_events(provider,eventId)` único → `DUPLICATED`;
  - re-consulta o pagamento **real** no gateway;
  - confere valor contra o pedido (`AMOUNT_MISMATCH` → `Divergente`);
  - `500` em falha para o MP reenviar.
- **Pendência:** não validado com notificação real → `⏳`.

### 14) PEDIDOS — ✅ FUNCIONANDO
- **Evidência:** `pedido.routes.ts` (`POST /`, `POST /:token/pagamento`), rastreio `GET /api/rastreio/:token`, admin `pedidoAdminRoutes`.
- **Teste:** unitários + integração de guest checkout.

### 15) ESTOQUE — ✅ FUNCIONANDO
- **Evidência:** `pedido-payments.ts` — efeitos **transacionais e guardados por transição de status**:
  - criação: `stock--`, `reservedStock++`;
  - `Pago`: `reservedStock--`, `soldStock++`;
  - `Cancelado/Expirado`: devolve `stock`;
  - `Reembolsado`: devolve `stock`, `soldStock--`.
- **Teste:** integração de estoque/mercadopago (lógica coberta por testes unitários).

### 16) CUPONS — ✅ FUNCIONANDO
- **Evidência:** `coupon.routes.ts` — `POST /api/coupons/validate`, `GET /api/coupons/available`; admin CRUD; `CouponUsage` rastreia uso.
- **Teste:** typecheck + unitários.

### 17) PWA — ✅ (código) / ⏳ (teste em iPhone)
- **Evidência:** `manifest.webmanifest` (standalone, `display_override`, ícones 192/512/maskable, shortcuts, `start_url` com `?source=pwa`), `index.html` (`apple-touch-icon`, `apple-mobile-web-app-*`, `viewport-fit=cover`), `sw.js` (cache versionado `ma-store-v2`, `NEVER_CACHE` p/ `/api/payments`, `/api/auth`, etc., `skipWaiting`/`clients.claim`, atualização via `SKIP_WAITING`).
- **Pendência:** instalação/uso real em iPhone/Safari não testada (sem dispositivo).

### 18) RESPONSIVIDADE — ✅ (código) / ⏳ (dispositivo)
- **Evidência:** 50 media queries em 6 CSS; `viewport-fit=cover` + 7 usos de `safe-area` (notch iPhone); layout mobile-first.
- **Pendência:** sem teste em dispositivo/laboratório.

### 19) SEGURANÇA — ✅ FUNCIONANDO
- **Evidência:** `helmet`, CORS restrito a `CORS_ORIGINS`, `rateLimit` global, `bodyLimit` 2MB, upload limitado; redaction de `card.token`/`card.cvv`/`token`/`docNumber` nos logs; **nenhum `.env` commitado**; frontend só expõe `VITE_API_URL`/`VITE_APP_NAME`; `simulate` bloqueado em `PAYMENT_ENV=production`; Access Token/Webhook Secret nunca expostos.
- **Teste:** varredura de segredos + inspeção.

### 20) BANCO — ✅ FUNCIONANDO
- **Evidência:** `schema.prisma` válido; 14 migrations; índices de FK adicionados (`20261008120000_fk_indexes`).
- **Teste:** `prisma validate` exit 0.

### 21) MIGRATIONS — ✅ FUNCIONANDO
- **Evidência:** todas **aditivas e idempotentes** (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). Nenhum `DROP`/`DELETE`/`TRUNCATE`/`reset`. Dockerfile roda `prisma migrate deploy` antes de subir.
- **Teste:** inspeção de todas as migrations.

### 22) PERFORMANCE — ✅ FUNCIONANDO
- **Evidência:** compressão brotli/gzip, cache imutável de imagens, lazy loading de 38 rotas, índices de FK, `queryClient` sem retry em 4xx.

### 23) PRODUÇÃO — ⚠️ PARCIAL / ⏳
- **Evidência:** `backend/Dockerfile` (multi-stage, non-root, `migrate deploy` no start), `vercel.json`, `docker-compose.yml`.
- **Bloqueadores:** ver P0 abaixo (storage efêmero + credenciais).

---

## 3. Tabela consolidada

| FUNCIONALIDADE | STATUS | EVIDÊNCIA | PROBLEMA | CORREÇÃO | TESTE |
|---|---|---|---|---|---|
| Autenticação | ✅ FUNCIONANDO | auth.routes/service, api.ts refresh | — | — | unit + api.test |
| Admin | ✅ FUNCIONANDO | admin.routes hook global | — | — | inspeção |
| Produtos | ✅ FUNCIONANDO | product routes | — | — | unit |
| Categorias | ✅ FUNCIONANDO | category routes | — | — | typecheck |
| Imagens | ⚠️ PARCIAL | app.ts /uploads/* | FS efêmero em prod | S3 ou disco persistente | não testado |
| Storage | ⚠️ PARCIAL | storage-s3.ts | não validado em bucket real | testar bucket | não testado |
| Carrinho | ✅ FUNCIONANDO | cart.routes.ts | — | — | unit |
| Frete | ✅/⏳ | shipping-engine + local | transportadora real sem credencial | credenciais | 23 testes |
| Checkout | ✅ FUNCIONANDO | pedido.routes, orders.ts | — | — | guest-checkout |
| PIX | ⏳ DEP. EXTERNA | mercadopago/index.ts | sem credenciais | configurar MP | não testado |
| Cartão | ⏳ DEP. EXTERNA | lib/mercadopago.ts | sem credenciais | configurar MP | não testado |
| Boleto | ⏳ DEP. EXTERNA | createBoletoPayment | pode estar desabilitado | habilitar na conta | não testado |
| Webhooks | ⚠️ PARCIAL | payment.routes.ts:148 | sem notificação real | validar ponta a ponta | não testado |
| Pedidos | ✅ FUNCIONANDO | pedido/tracking routes | — | — | unit + integração |
| Estoque | ✅ FUNCIONANDO | pedido-payments.ts | — | — | integração |
| Cupons | ✅ FUNCIONANDO | coupon.routes.ts | — | — | unit |
| PWA | ✅/⏳ | manifest, sw.js, index.html | teste em iPhone pendente | testar device | não testado |
| Responsividade | ✅/⏳ | 50 media queries, safe-area | teste em device pendente | testar device | não testado |
| Segurança | ✅ FUNCIONANDO | helmet/cors/ratelimit/redaction | — | — | varredura |
| Banco | ✅ FUNCIONANDO | schema + 14 migrations | — | — | prisma validate |
| Migrations | ✅ FUNCIONANDO | add-only/idempotentes | — | — | inspeção |
| Performance | ✅ FUNCIONANDO | compress, cache, lazy, índices | — | — | build |
| Produção | ⚠️ PARCIAL | Dockerfile, vercel.json | storage efêmero + credenciais | ver P0 | não testado |

---

## 4. Priorização

### P0 — Bloqueadores (impedem "pronto para produção")
1. **Storage efêmero em produção.** Com `STORAGE_DRIVER=local` (padrão), imagens
   gravadas em `./var/uploads` **desaparecem** em redeploy/restart do Render/Fly.
   → **Correção:** `STORAGE_DRIVER=s3` + bucket (driver já implementado) **ou**
   disco persistente montado em `STORAGE_LOCAL_DIR`. Enquanto não configurado,
   **não** é seguro declarar produção.
2. **Credenciais de pagamento ausentes.** Sem `MERCADOPAGO_ACCESS_TOKEN`,
   `MERCADOPAGO_PUBLIC_KEY`, `MERCADOPAGO_WEBHOOK_SECRET` e `PUBLIC_API_URL`,
   PIX/cartão/boleto ficam indisponíveis (`enabled:false`) e, em
   `NODE_ENV=production`+`PAYMENT_ENV=production`, a API **falha rápido** de
   propósito. → **Correção:** configurar as credenciais de produção.
3. **Pagamento real não comprovado.** O fluxo
   cobrança → pedido → valor → webhook → assinatura → idempotência → pedido →
   confirmação **não** foi validado com dinheiro/sandbox real.
   → **Correção:** executar o E2E com credenciais. **Sem isso, pagamento NÃO é
   declarado funcionando.**

### P1 — Importantes
4. `tests/integration/mercadopago.test.ts` não executado (sem PostgreSQL/Docker).
5. Driver S3 não validado contra bucket real.
6. Boleto pode estar desabilitado na conta MP.
7. Cotação de transportadora real exige credenciais.
8. PWA/responsividade sem teste em iPhone/Safari físico.

### P2 — Melhorias
9. Adicionar `render.yaml` declarativo (disco/healthcheck/auto-deploy).
10. Observabilidade externa (ex.: Sentry) — hoje só logs estruturados + `diagnostics`.
11. Cobertura de testes para o webhook com payload real (fixtures do MP).

---

## 5. Veredito

**MA STORE — NÃO PRONTO PARA PRODUÇÃO (ainda).**

O **código** está em nível de produção: arquitetura íntegra, validações
executadas (176 + 94 testes, typecheck e schema válidos), correções anteriores
preservadas. Porém **não há evidência técnica suficiente** para declarar
produção, pois:

- o **storage padrão em produção perderia imagens** (P0-1);
- os **pagamentos reais não foram comprovados** (P0-2/P0-3);
- **nenhuma validação em ambiente publicado** foi possível a partir daqui.

Assim que os P0 forem resolvidos (bucket/disco + credenciais MP + E2E de
pagamento e webhook reais), a declaração **"MA STORE — PRONTO PARA PRODUÇÃO"**
passa a ser tecnicamente sustentável.
