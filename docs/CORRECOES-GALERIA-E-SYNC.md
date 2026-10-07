# MA STORE — Correções desta entrega

Data: 2026-10-05 · Base: `ma-store-v3-galeria-exclusao`

Escopo desta rodada: **imagens (prioridade alta)**, **sincronização admin → loja** e
**instalação do PWA no iPhone**. Tudo incremental, sem reset de banco, sem remover
dados, sem mocks e com testes automatizados.

---

## 1. Imagens — causa raiz das fotos que "somem" (corrigido)

### Diagnóstico

O fluxo de upload/armazenamento estava correto (URL relativa `/uploads/<arquivo>`,
validação por magic bytes, rota estática com `wildcard: true`). O problema estava na
**remoção**: o backend apagava o arquivo físico sem verificar se ele ainda era usado
em outro lugar.

Cenários reais que quebravam a loja:

1. **Produto duplicado** — `POST /admin/products/:id/duplicate` copia as URLs das
   imagens. Ao remover a foto do produto original, o arquivo era apagado e a cópia
   ficava com imagem 404.
2. **Biblioteca de imagens** — o admin reusa a mesma imagem em vários produtos; ao
   removê-la de um, os outros quebravam.
3. **Banners / categorias / marcas / snapshot de pedido** também guardam URLs de
   upload (`banners.image_url`, `categories.image_url`, `brands.logo_url`,
   `order_items.image_snapshot`). Nenhum era considerado antes de apagar o arquivo.
4. O próprio formulário promete ao admin: *"O arquivo continua salvo na biblioteca e
   pode ser reutilizado em outros produtos."* — a promessa não era cumprida.

### Correção

Novo serviço `backend/src/services/uploads-cleanup.ts`:

- `countUploadReferences(url)` conta referências em `product_images`,
  `order_items.image_snapshot`, `categories.image_url`, `brands.logo_url` e
  `banners.image_url`.
- `deleteUploadIfUnreferenced(url)` só apaga o arquivo quando **nenhuma** referência
  existe. Caso contrário, preserva.

`product.admin.routes.ts` passou a usar essa função no **PATCH** (troca de galeria) e
no **hard delete** de produto. O comportamento agora é: *arquivo só morre quando
ninguém mais aponta para ele.*

### Testes

`backend/tests/integration/admin-image-cleanup.test.ts` (5 testes, Postgres real):
duplicado preserva arquivo; última referência apaga; hard delete preserva
compartilhado; banner/categoria preservam; snapshot de pedido preserva.

---

## 2. Sincronização admin → loja (corrigido)

### Diagnóstico

As mutações administrativas invalidavam apenas as chaves do **admin**
(`["admin","products"]`, `adminDashboard`…). O SPA usa React Query com
`staleTime` de 30 s e `refetchOnWindowFocus: false`, então a **loja pública
continuava servindo o cache antigo** depois de criar/editar/excluir produto ou
alterar estoque/preço/imagem — a sensação de "salvei e não subiu".

### Correção

Novo helper `invalidateStorefront()` em `frontend/src/lib/queryClient.ts`, que
invalida as chaves públicas (`products`, `product`, `catalog`, `categories`,
`brands`, `content`, `banners`, `theme`, `search`). Aplicado em:

- `ProductFormPage` (criar/editar produto);
- `ProductsPage` (ativar/desativar, duplicar, estoque, excluir).

O service worker já era `network-first` para a API pública, então a borda não era o
gargalo; o gargalo era o cache em memória do React Query.

### Testes

`frontend/src/lib/queryClient.test.ts` (2 testes) garante que as chaves públicas são
invalidadas e que caches privados/admin **não** são tocados.

---

## 3. PWA no iPhone (corrigido)

### Diagnóstico

O `InstallPrompt` só escutava `beforeinstallprompt`, que **o Safari do iPhone nunca
dispara**. Resultado: usuário de iPhone não recebia nenhuma orientação de instalação.
O `manifest`, o `apple-touch-icon` (180×180) e os ícones (192/512/maskable) já estavam
corretos.

### Correção

`InstallPrompt` agora detecta iOS + Safari + ainda não instalado (standalone) e
mostra o passo a passo real:

1. Toque em **Compartilhar**;
2. Escolha **"Adicionar à Tela de Início"**;
3. Confirme.

Regras respeitadas: aparece **só** no Safari do iPhone/iPad (não no Chrome iOS, que
não oferece o recurso), não aparece se já estiver instalado, não bloqueia a navegação,
e a dispensa fica salva (`localStorage`). Ícone `share` adicionado ao conjunto de
ícones e estilos do bloco em `pages.css`.

### Testes

`frontend/src/components/layout/InstallPrompt.test.tsx` (4 testes): mostra no Safari
iOS; não mostra em standalone; não mostra no Chrome iOS; respeita a dispensa.

---

## 4. Resultado dos testes (execução local real)

- Backend: **38 arquivos, 343 testes** — todos passando (PostgreSQL 15 real).
- Frontend: **12 arquivos, 74 testes** — todos passando (jsdom).
- `npm run typecheck` (backend e frontend): sem erros.
- `npm run build` (backend tsup e frontend vite): sucesso.

---

## 5. O que NÃO foi alterado (e por quê)

Nada de banco foi resetado, apagado ou migrado. Nenhum dado/registro de imagem foi
removido. As correções são somente de código.

Itens do prompt que dependem de acesso/credenciais que esta auditoria não possui e
por isso **não foram declarados como corrigidos**:

- **Push notifications** — não existe implementação no código. Requer: chave VAPID
  (privada só no backend), dependência `web-push`, tabela `push_subscriptions`
  (migration incremental) e handlers no service worker. Precisa das chaves e de
  aprovação para a migration.
- **Auditoria ao vivo** (console, Network, logs do Render, service worker real,
  instalação em iPhone físico) — depende do ambiente publicado.
- **Desktop/UX, performance e simplificação do admin** — exigem validação visual
  contra a loja publicada; não foram alterados sem evidência de defeito.
- **Armazenamento** — se o Render não tiver disco persistente, arquivos do driver
  `local` somem em restart/deploy. Isso é infraestrutura (S3/Cloudinary), não código.

---

## 6. Próximos passos recomendados (em ordem)

1. Publicar estas correções e validar no ambiente real (imagem compartilhada entre
   dois produtos deve continuar aparecendo após remover de um deles).
2. Migrar uploads para storage de objetos se o Render for efêmero.

---

# RODADA 2 — Push, desktop/tablet, performance e admin

Data: 2026-10-05 · Base: `ma-store-v4-galeria-sync-pwa`

Escopo pedido: push notifications, auditoria visual desktop/tablet, performance
(code splitting, imagens, fontes) e simplificação do painel administrativo.

## 7. Notificações Push (implementadas de verdade)

Web Push real, sem simulação. Ver `docs/PUSH-NOTIFICATIONS.md`.

- Backend: `web-push` + model `PushSubscription` + migration **aditiva**
  (`20261005120000_push_subscriptions`, cria apenas uma tabela) + rotas públicas
  `GET /api/push/public-key`, `POST /api/push/subscribe`, `POST /api/push/unsubscribe`.
- O aviso é enviado ao **publicar** um produto (criado ativo ou ativado depois),
  via `src/services/push.ts`. Inscrições expiradas (404/410) são removidas.
- Frontend: consentimento em `PushOptIn` (só pede permissão após o clique; respeita
  recusa; some quando o backend não tem chaves) + handlers `push`/`notificationclick`
  no service worker.
- **Chaves VAPID:** o dono gera com `npm run vapid:generate` e configura no Render.
  A privada fica **somente** no backend; sem chaves o push fica desativado e a loja
  funciona normalmente. Nenhum segredo foi colocado no código.
- No iPhone o push exige o app **instalado** (iOS 16.4+); por isso o convite de push
  só aparece depois de instalar (o convite de instalação aparece primeiro).

Testes: `backend/tests/integration/push.test.ts` (8) e
`frontend/src/components/layout/PushOptIn.test.tsx` (7).

## 8. Auditoria visual desktop/tablet (Chromium real)

Rodamos o app real (backend + build de produção + `tests/browser/local-server.mjs`)
no Chromium headless e medimos **8 páginas × 9 larguras (320→1920 px)** com
screenshots: **0 overflow horizontal, 0 botões sem rótulo, 0 imagens sem alt,
0 campos sem label, 0 erros de console/rede**. Também auditamos página de produto e
painel admin (dashboard, lista e formulário) com login real.

### Defeitos encontrados e corrigidos

1. **Aviso de instalação PWA aparecia no desktop** e cobria os cards (o texto fala de
   "tela inicial do celular"). Agora só aparece em dispositivos de toque
   (`pointer: coarse`) ou iPhone. No mobile, o conteúdo ganha folga para o aviso não
   cobrir botões (`body.has-install-prompt .app-main`).
2. **Miniaturas da galeria do produto não passavam por `resolveImageUrl`** — em
   produção o caminho relativo `/uploads/...` apontaria para a Vercel e a imagem
   quebraria. Corrigido em `Catalog.tsx`.
3. **Dashboard do admin no tablet** caía em 3 colunas por `auto-fit`, deixando um
   card órfão em cada grupo de 4. Agora a grade é 1 → 2 → 4 colunas (mobile/tablet/
   desktop), sem card órfão nem espaçamento irregular.

## 9. Performance

- **Preconnect/DNS-prefetch ao domínio da API** injetado no boot (`main.tsx`), usando
  `API_ORIGIN` — evita uma rodada de rede antes do primeiro fetch em produção.
- **Prioridade de imagem (LCP):** `fetchPriority="high"` na imagem principal do
  produto, no banner do hero e nas primeiras capas da vitrine (`ProductImage` ganhou
  a prop `fetchPriority`).
- **Code splitting**: já existente e mantido (rotas em `React.lazy`, chunks `react` e
  `query` separados).
- **Fontes**: o projeto **não** carrega fontes externas (stacks `Inter`/`Cormorant`
  caem para sistema/Georgia). Não adicionamos Google Fonts de propósito — evitar
  requisição bloqueante. Nenhuma mudança necessária.
- **Cache**: o service worker é `network-first` para a API pública; o gargalo de
  "dado velho" era o React Query, já resolvido na Rodada 1 com `invalidateStorefront`.

## 10. Simplificação do painel administrativo

O painel já era agrupado (Visão geral / Catálogo / Vendas / Entregas /
Relacionamento / Site / Sistema) e a auditoria não encontrou estrutura quebrada.
A melhoria concreta foi a grade de indicadores do dashboard (item 8.3), que removeu
o card órfão e o espaçamento irregular no tablet/desktop. Nada de navegação foi
removido para não quebrar fluxos existentes.

## 11. Resultado dos testes (rodada 2, execução local real)

- Backend: **39 arquivos / 351 testes** passando (PostgreSQL 15 real).
- Frontend: **13 arquivos / 82 testes** passando.
- `typecheck` e `build` (backend e frontend) sem erros.
- Auditoria de navegador: 8 páginas × 9 larguras sem overflow/erros (seção 8).
