# Correções: imagens, performance e notificação de novo produto

Data: 2026-10-07 · Base: `ma-store-v5-push-desktop-perf`
Método: **ANÁLISE → DIAGNÓSTICO → IMPLEMENTAÇÃO → TESTES → AUDITORIA → REGRESSÕES → VALIDAÇÃO**

Nenhum módulo foi recriado, nenhuma funcionalidade removida e nenhuma
funcionalidade real foi convertida em mock.

---

## 1. Problemas encontrados

### Imagens

| # | Achado | Gravidade |
|---|---|---|
| I1 | O upload, a gravação em disco e a rota `GET /uploads/*` **já estavam corretos** (`@fastify/static` com `wildcard` padrão, URL relativa `/uploads/x.png` no banco, `resolveImageUrl()` centralizado). Nenhum 404 foi reproduzido. | — |
| I2 | `/uploads/*` era servido com **`Cache-Control: public, max-age=0`** → o navegador **revalidava toda imagem a cada navegação** (requisições inúteis e "piscada" na galeria). | real (performance) |
| I3 | `fetchPriority` (camelCase) no `<img>` **não é reconhecido pelo React 18** e registrava **erro no console a cada imagem renderizada**. | real (console) |

> O diagnóstico honesto: o defeito histórico de imagem (`http://localhost:3333/...`
> gravado no banco) **já havia sido corrigido** nesta base. O que restava eram
> duas falhas reais de cache/console — corrigidas e medidas abaixo.

### Performance

| # | Achado | Gravidade |
|---|---|---|
| P1 | **A API não tinha compressão HTTP.** `GET /api/products?perPage=20` respondia **14.356 bytes sem `Content-Encoding`**. | real (crítico em 3G/4G) |
| P2 | A Home dispara **8 requisições** e trafegava **23.776 bytes** sem compressão. | real |
| P3 | Imagens sem cache (I2). | real |

**Auditado e considerado correto (nenhuma mudança feita):** code splitting por rota
(`React.lazy` + chunks por página, admin nunca entra no bundle da loja), lazy
loading/`decoding=async`/`aspect-ratio` nas imagens, `preconnect` ao domínio da
API, `select` explícito no Prisma, ausência de N+1 (`Promise.all` + `count`),
paginação com teto, `staleTime` do React Query, Service Worker (navegação
network-first, assets stale-while-revalidate, API pública com TTL de 5 min,
nunca cacheia dado pessoal). Não aumentei cache nem adicionei índices sem
justificativa — o prompt proíbe os dois.

### Notificações

| # | Achado | Gravidade |
|---|---|---|
| N1 | O push **disparava** em produto criado ativo e em inativo→ativado, e **removia** inscrição expirada (404/410). Isso já funcionava. | — |
| N2 | **Não havia trava persistente de idempotência.** A decisão dependia só de ler `active` antes de gravar: duplo clique, retry de rede ou **duas ativações simultâneas** faziam duas requisições lerem `active=false` e **enviar dois avisos**. | real (corrida) |
| N3 | Não existia registro de "este produto já foi anunciado" — impossível auditar ou impedir reenvio. | real |
| N4 | `POST /api/push/subscribe` é público e **escreve no banco**, sem limite próprio além do global. | real (abuso) |

---

## 2. Correções realizadas

| Arquivo | Mudança | Motivo |
|---|---|---|
| `backend/src/app.ts` | `@fastify/compress` (brotli/gzip, `threshold: 1024`) | P1, P2 |
| `backend/src/app.ts` | `@fastify/static` com `cacheControl`, `maxAge: "30d"`, `immutable` | I2 |
| `backend/prisma/schema.prisma` | `Product.notifiedAt DateTime?` | N2, N3 |
| `backend/prisma/migrations/20261006120000_product_notified_at/` | `ADD COLUMN IF NOT EXISTS` (aditiva) | N2, N3 |
| `backend/src/services/push.ts` | `claimProductNotification()` — `UPDATE ... WHERE notifiedAt IS NULL` | N2, N3 |
| `backend/src/modules/admin/product.admin.routes.ts` | reivindicação **aguardada** antes de responder; envio continua *fire-and-forget* | N2 |
| `backend/src/modules/push/push.routes.ts` | rate limit dedicado 20/min nas rotas de escrita | N4 |
| `frontend/src/components/ui/StoreValue.tsx` | `fetchpriority` minúsculo via spread tipado | I3 |
| `frontend/src/pages/HomePage.tsx` | idem para o banner do hero | I3 |
| `backend/scripts/perf-check.ts` + `npm run perf:check` | medição reproduzível antes/depois | evidência |
| `docs/IMAGENS.md`, `docs/PERFORMANCE.md`, `docs/PUSH-NOTIFICATIONS.md`, `docs/TESTING.md`, `README.md` | documentação afetada | honestidade |

### Como a idempotência funciona

```sql
UPDATE "products" SET "notifiedAt" = now()
 WHERE "id" = $1 AND "notifiedAt" IS NULL;   -- só 1 requisição altera 1 linha
```

Só quem altera 1 linha envia. O carimbo é gravado **antes** do envio
(política *at-most-once*), então queda no meio do envio não gera reenvio em
massa. Editar preço/descrição/imagem/estoque/categoria não passa por esse
caminho — nenhum aviso.

---

## 3. Imagens

**Causa do problema de imagem:** na base anterior o banco gravava a URL absoluta
com o host do servidor (`http://localhost:3333/uploads/...`), que deixava de
existir em produção. Nesta base o upload já grava **caminho relativo**
(`/uploads/<arquivo>`) e o frontend resolve a origem em um único lugar
(`src/lib/images.ts → resolveImageUrl`), que também reescreve host de loopback
para a origem real da API. **Confirmei que o fluxo funciona de ponta a ponta**
(testes abaixo) e corrigi o que faltava: **cache imutável** e **erro de console
do React**.

**Compatibilidade de formatos preservada:** JPEG, PNG, WEBP, GIF e AVIF —
validados por *magic bytes* (não pelo MIME enviado), com limite de tamanho
(`UPLOAD_MAX_MB`, padrão 5 MB) e de dimensões (100–6000 px).

**Fallback:** `ProductImage` troca para `/placeholder-product.svg` no `onError`,
registra o aviso apenas em desenvolvimento e **ignora erro no próprio
placeholder** (sem loop infinito). O fallback não "conserta" a URL — é proteção
de UX.

---

## 4. Performance

Medido com `npm run perf:check` (mesma máquina, mesmo catálogo de 42 produtos
ativos — 8 destaques, 8 lançamentos, 8 ofertas, 8 mais vendidos). A única
diferença entre ANTES e DEPOIS é a camada de compressão: o JSON descomprimido é
**idêntico byte a byte** (há teste garantindo).

```text
ANTES
  tempo (listagem /api/products?perPage=20) ... 132 ms
  requests (Home) ............................. 8
  bundle (frontend, JS inicial) ............... 304.958 bytes (index+react+query)
  imagem (/uploads/x.png) ..................... Cache-Control: public, max-age=0
  API (listagem) .............................. 14.356 bytes, sem Content-Encoding
  API (Home, 8 requisições) ................... 23.776 bytes

DEPOIS
  tempo (listagem /api/products?perPage=20) ... 22 ms
  requests (Home) ............................. 8 (iguais — nenhuma duplicata removida
                                                porque não havia duplicata)
  bundle (frontend, JS inicial) ............... 304.978 bytes (+20 bytes)
  imagem (/uploads/x.png) ..................... public, max-age=2592000, immutable
                                                -> 0 requisições por 30 dias
  API (listagem) .............................. 1.520 bytes (br/gzip)   -89,4%
  API (Home, 8 requisições) ................... 4.318 bytes (br/gzip)   -81,8%
```

- **Ganho real:** o cliente baixa **~90% menos bytes** de JSON. Em 3G (~400 kbps),
  a listagem passa de ~290 ms só de transferência para ~30 ms.
- **Bundle praticamente inalterado** (+20 bytes): o code splitting por rota já
  era eficiente; não inventei ganho onde não havia.
- **Compressão segura:** só acima de 1 KB (respostas pequenas ficariam maiores);
  imagens/ZIP ignorados pela biblioteca (recomprimir só gastaria CPU).
- **Cache imutável seguro:** cada upload tem nome único (`<timestamp>-<hash>.<ext>`);
  trocar a foto gera URL nova.

---

## 5. Notificações

- **Quando dispara:** produto criado já **ativo**, ou produto que passa de
  **inativo → ativo**. Nada mais.
- **Quem recebe:** todas as inscrições ativas em `push_subscriptions`. A
  inscrição só existe depois de o usuário clicar em "Ativar" e o navegador
  conceder a permissão (nunca pedimos permissão sem ação do usuário).
- **Consentimento:** 100% do navegador (Guest Checkout, sem conta). Recusou →
  não insistimos; `unsubscribe` remove a inscrição.
- **Inscrições expiradas:** resposta `404`/`410` do serviço de push → a inscrição
  é **removida** do banco. Outros erros são contados e **nunca** derrubam a
  publicação do produto (o envio é *fire-and-forget*).
- **Duplicidade:** trava persistente e atômica (`notifiedAt`), conforme a seção 2.
- **VAPID:** chaves **somente no backend**; a pública é exposta em
  `GET /api/push/public-key`. Sem chaves, `enabled: false`, a loja e a criação de
  produto funcionam normalmente e **nada é simulado**.
- **Clique:** o Service Worker reutiliza uma janela já aberta e navega para
  `/produto/<slug>`; sem janela aberta, abre uma.

---

## 6. Testes executados

| Suíte | Resultado |
|---|---|
| `backend` — `tsc --noEmit` | ✅ sem erros |
| `backend` — `npm run build` | ✅ ESM OK |
| `backend` — `npm test` | ✅ **364/364** em 43 arquivos (era 351) |
| `frontend` — `tsc --noEmit` | ✅ sem erros |
| `frontend` — `npm test` | ✅ **91/91** em 14 arquivos (era 83) |
| `frontend` — `vite build` | ✅ code splitting por rota |
| `prisma validate` / `migrate deploy` / `generate` | ✅ (dev e test) |

### Novos testes

- `tests/e2e/product-image-e2e.test.ts` — **HTTP real** (servidor em porta real):
  upload multipart → arquivo no disco → `GET /uploads/*` 200 + `image/png` +
  bytes PNG reais + cache imutável → URL persistida no produto (relativa) →
  catálogo público devolve → página do produto devolve → **refresh** → segunda
  imagem + **substituição da capa** (as duas continuam acessíveis).
- `tests/integration/http-performance.test.ts` — compressão brotli/gzip com
  conteúdo idêntico, ganho ≥ 50%, limiar de 1 KB, texto puro sem `Accept-Encoding`.
- `tests/integration/push.test.ts` (ampliado) — edição comum **não** avisa;
  dupla ativação avisa 1 vez; **duas ativações simultâneas** avisam 1 vez; retry
  de criação (409) avisa 1 vez; `notifiedAt` persistido; reativar **não** reavisa.
- `tests/integration/push-disabled.test.ts` — sem VAPID: produto criado, nada enviado.
- `tests/integration/push-rate-limit.test.ts` — 20 aceitas, 5 bloqueadas (429).
- `tests/integration/admin-uploads-http.test.ts` (ampliado) — imagem servida com
  `immutable`, **sem** recompressão.
- `frontend/src/components/ui/ProductImage.test.tsx` — placeholder, fallback de
  URL quebrada, **sem loop**, `javascript:` recusado, LCP e enquadramento.

---

## 7. Pendências (dependem de configuração externa)

1. **VAPID** — o push está implementado e testado, mas só envia com
   `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` no backend. **Sem elas o push fica
   desligado** (a loja funciona). Não declarei "push 100% funcional em produção"
   porque a entrega real depende dessas chaves no ambiente do Render.
2. **HTTPS + domínio** — Web Push exige HTTPS. No iPhone, exige o PWA instalado
   na Tela de Início (iOS 16.4+).
3. **Storage externo** — o driver `local` grava no disco do processo. Em
   container/serverless (Render sem disco persistente) **arquivos podem
   desaparecer em restart/deploy**. A API já emite `warn` no boot quando
   `APP_ENV=production` e `STORAGE_DRIVER=local`. Para persistência real é
   preciso implementar um driver S3/Cloudinary com a mesma interface de
   `saveUpload` — **não inventei credenciais nem serviço**.
4. **`VITE_API_URL`** — precisa ser absoluta em produção (a API já avisa no
   console quando não é). Sem isso o frontend não resolve `/uploads`.
5. **Migration** — `prisma migrate deploy` roda no deploy; não foi aplicada em
   nenhum banco de produção a partir daqui.
