# Notificações Push (Web Push / PWA) — MA STORE

Sistema real de notificações, sem simulação. O aviso é enviado quando um
**produto novo é publicado** (criado já ativo ou ativado depois).

---

## 1. Ativar (uma vez)

### 1.1 Gerar as chaves VAPID

```bash
cd backend
npm run vapid:generate
```

O comando imprime três linhas. **A chave privada é secreta.**

### 1.2 Configurar no backend (Render → Environment)

```
VAPID_PUBLIC_KEY=<chave pública gerada>
VAPID_PRIVATE_KEY=<chave privada gerada>
VAPID_SUBJECT=mailto:contato@seudominio.com
```

- A chave **pública** pode ser exposta (a API a devolve em `GET /api/push/public-key`).
- A chave **privada** fica **somente** no backend. Nunca a coloque no frontend/Vercel.
- Sem essas variáveis o push fica **desativado** e a loja continua funcionando normal.

### 1.3 Banco de dados

A migration `20261005120000_push_subscriptions` é **aditiva** (cria apenas a
tabela `push_subscriptions`) e roda sozinha no deploy (`prisma migrate deploy`).
Nenhum dado existente é tocado.

---

## 2. Como funciona

1. O usuário entra na loja normalmente.
2. Um cartão discreto (acima do rodapé) pergunta se ele quer receber novidades —
   com explicação antes de qualquer pedido nativo.
3. Só ao clicar em **Ativar** o navegador pede a permissão.
4. A inscrição (endpoint + chaves) é gravada no backend.
5. Ao publicar um produto, o backend envia o push para todas as inscrições.
   Inscrições expiradas (404/410) são removidas automaticamente.

### Idempotência: um produto publicado gera **no máximo um** aviso

A decisão de notificar **não** depende do frontend não repetir a requisição.
Dois cliques rápidos, um retry de rede ou duas ativações simultâneas fazem duas
requisições lerem `active = false` antes de qualquer uma gravar `active = true`
— e ambas disparariam o push.

A trava é **persistente e atômica**, no banco:

```sql
-- products.notifiedAt (migration 20261006120000_product_notified_at)
UPDATE "products" SET "notifiedAt" = now()
 WHERE "id" = $1 AND "notifiedAt" IS NULL;
```

Só a requisição que alterar **1 linha** envia o push; as demais são ignoradas.
O carimbo é gravado **antes** do envio, então uma queda no meio do envio não
gera reenvio em massa (política *at-most-once*, correta para um aviso de novidade).

| Situação | Aviso? |
|---|---|
| Produto criado já **ativo** | ✅ uma vez |
| Produto criado **inativo** | ❌ |
| Inativo → **ativado** depois | ✅ uma vez |
| Editado (preço, nome, imagem, estoque, categoria) | ❌ |
| Salvo duas vezes / duplo clique | ❌ (já reivindicado) |
| Duas ativações **simultâneas** | ✅ uma vez só |
| Desativado e reativado | ❌ (não é novidade) |
| Retry da criação (mesmo SKU) | ❌ (409, um produto só) |
| VAPID não configurado | ❌ — loja e publicação funcionam normalmente |

### Regras respeitadas

- **Nunca** pedimos permissão sem o clique do usuário.
- Se ele recusar (no aviso ou no navegador), **não insistimos**.
- No **iPhone**, o push só funciona com o app **instalado** na Tela de Início
  (iOS 16.4+). Por isso, antes de instalar, o convite de push não aparece — o
  convite de instalação aparece primeiro.
- Push exige **HTTPS** (produção já é HTTPS).

---

## 3. Arquivos

**Backend**

- `prisma/schema.prisma` — models `PushSubscription` e `Product.notifiedAt`.
- `prisma/migrations/20261005120000_push_subscriptions/migration.sql`.
- `prisma/migrations/20261006120000_product_notified_at/migration.sql` —
  aditiva (`ADD COLUMN IF NOT EXISTS`), nenhum dado existente é tocado.
- `src/services/push.ts` — inscrição, envio e limpeza de inscrições expiradas.
- `src/modules/push/push.routes.ts` — `GET /api/push/public-key`,
  `POST /api/push/subscribe`, `POST /api/push/unsubscribe` (públicos).
- `src/modules/admin/product.admin.routes.ts` — dispara o aviso ao publicar.
- `scripts/generate-vapid-keys.mjs` — gera as chaves.

**Frontend**

- `src/lib/push.ts` — inscrição/cancelamento no navegador.
- `src/components/layout/PushOptIn.tsx` — consentimento (aparece acima do rodapé).
- `public/sw.js` — handlers `push` e `notificationclick`.

---

## 4. Testar

1. Configure as chaves e faça deploy do backend e do frontend.
2. Abra a loja em um navegador compatível (Chrome/Edge/Android; no iPhone, instale
   antes o app na Tela de Início).
3. Aceite o convite de notificações.
4. No painel, crie um produto **ativo** (ou ative um existente).
5. A notificação deve chegar e, ao clicar, abrir a página do produto.

Testes automatizados (sem chamada de rede real ao serviço de push):

```bash
cd backend && npx vitest run tests/integration/push.test.ts
cd backend && npx vitest run tests/integration/push-disabled.test.ts
cd frontend && npx vitest run src/components/layout/PushOptIn.test.tsx
```

`push.test.ts` cobre: criação ativa, criação inativa, ativação posterior,
edição comum sem aviso, dupla ativação, ativações simultâneas (corrida), retry
de criação, marca persistida e desativação/reativação. `push-disabled.test.ts`
cobre o caminho **sem VAPID** (produto criado, nada enviado).
