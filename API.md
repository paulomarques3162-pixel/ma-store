# MA STORE — API REST

Base URL local: `http://localhost:3333`
Prefixo global: **`/api`**

---

## Convenções

### Sucesso

```json
{ "data": { "...": "..." } }
```

Listagens paginadas acrescentam `meta`:

```json
{
  "data": [],
  "meta": { "page": 1, "perPage": 20, "total": 0, "totalPages": 0, "hasNext": false, "hasPrev": false }
}
```

### Erro

Toda falha responde no mesmo formato — **nunca** com stack trace:

```json
{
  "error": {
    "code": "INSUFFICIENT_STOCK",
    "message": "Estoque insuficiente para Perfume X. Disponivel: 2.",
    "details": { "available": 2 },
    "requestId": "883d47237cd44d02"
  }
}
```

Guarde o `requestId`: ele aparece nos logs do servidor e permite rastrear o incidente.

### Códigos de erro

| Código | HTTP | Quando acontece |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Payload/query inválidos (Zod) |
| `UNAUTHENTICATED` | 401 | Sem token, token inválido/expirado |
| `FORBIDDEN` | 403 | Sem permissão (ex.: cliente em rota de admin) |
| `NOT_FOUND` | 404 | Registro inexistente |
| `CONFLICT` | 409 | Duplicidade (e-mail, SKU, cupom) |
| `INSUFFICIENT_STOCK` | 409 | Estoque insuficiente na compra |
| `RATE_LIMITED` | 429 | Limite de requisições excedido |
| `BUSINESS_RULE` | 400 | Regra de negócio violada (transição inválida, carrinho vazio) |
| `COUPON_INVALID` | 422 | Cupom inválido/inativo/expirado/sem elegibilidade |
| `PAYMENT_ERROR` | 402 | Falha no processamento do pagamento |
| `INTERNAL_ERROR` | 500 | Erro inesperado (logado com `requestId`) |

### Autenticação

```http
Authorization: Bearer <accessToken>
```

- `accessToken`: JWT HS256, TTL padrão **15 min**, claims `sub`, `role`, `sid`.
- `refreshToken`: valor opaco (não é JWT), guardado **somente como hash SHA-256** no banco, TTL padrão **30 dias**, rotacionado a cada uso.

### Idempotência

`POST /api/orders` aceita o header `X-Idempotency-Key`. Repetir a mesma chave devolve o **mesmo pedido** em vez de criar outro — protege contra duplo clique.

---

## 1. Saúde e metadados

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/api/health` | — | API, banco, versão, ambiente, timestamp |
| GET | `/api` | — | Nome e versão da API |

`GET /api/health` **nunca** expõe host do banco, variáveis de ambiente ou credenciais.

---

## 2. Autenticação — `/api/auth`

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/register` | — | Cadastro (cliente). Retorna usuário + tokens |
| POST | `/login` | — | Login. Retorna usuário + tokens |
| POST | `/refresh` | — | Rotaciona o refresh token |
| POST | `/logout` | opcional | Revoga a sessão |
| GET | `/me` | ✅ | Perfil do usuário autenticado |
| PATCH | `/me` | ✅ | Atualiza nome/telefone |
| POST | `/change-password` | ✅ | Troca de senha (exige a atual) |
| POST | `/forgot-password` | — | Inicia recuperação (resposta sempre genérica) |
| POST | `/reset-password` | — | Redefine via token |
| GET | `/sessions` | ✅ | Sessões ativas (sem expor tokens) |

**Cadastro**

```json
{
  "name": "Maria Silva",
  "email": "maria@exemplo.com",
  "phone": "11999999999",
  "password": "MinhaSenha1",
  "confirmPassword": "MinhaSenha1",
  "acceptTerms": true
}
```

Regras: e-mail normalizado para minúsculas, senha com ≥ 8 caracteres contendo letra e número, `acceptTerms` obrigatório, e-mail único.

**Login** — após 5 tentativas falhas a conta é bloqueada por 15 minutos (`failedLoginCount` + `lockedUntil`). A mensagem de erro é sempre "E-mail ou senha incorretos", sem revelar se o e-mail existe.

**Proteção extra:** rotas de autenticação têm limite próprio (`AUTH_RATE_LIMIT_MAX`, padrão 10/min).

**Em desenvolvimento/teste**, `forgot-password` devolve `devToken` para permitir testar o fluxo sem SMTP. Em produção esse campo é sempre `null` (o envio é por e-mail).

---

## 3. Endereços — `/api/users`

| Método | Rota | Descrição |
|---|---|---|
| GET | `/me/addresses` | Lista (padrão primeiro) |
| POST | `/me/addresses` | Cria (primeiro vira padrão automaticamente) |
| PATCH | `/me/addresses/:id` | Atualiza |
| DELETE | `/me/addresses/:id` | Remove |
| POST | `/me/addresses/:id/default` | Define como padrão |

O primeiro endereço cadastrado torna-se padrão automaticamente. Endereços de outros usuários retornam `404`.

---

## 4. Catálogo

### Produtos — `/api/products`

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/` | — | Lista com busca, filtros, ordenação e paginação |
| GET | `/facets` | — | Volumes e faixa de preço **reais** do catálogo |
| GET | `/:slug` | — | Detalhe público |
| GET | `/:slug/related` | — | Relacionados da mesma categoria |
| GET | `/:slug/reviews` | — | Avaliações aprovadas + média |
| GET | `/:slug/availability` | — | Disponibilidade atual |
| GET | `/id/:id` | 🛡️ admin | Detalhe completo (inclui inativos) |

**Query de listagem**

| Parâmetro | Exemplo | Observação |
|---|---|---|
| `search` | `Perfume Árabe` | Busca em nome, SKU, descrição, marca e categoria (índice GIN/trigram) |
| `category` | `perfumes-arabes` | Slug da categoria |
| `brand` | `minha-marca` | Slug da marca |
| `minPrice` / `maxPrice` | `100` / `500` | Faixa de preço |
| `volume` | `100ml` | Volume |
| `inStock` | `true` | Somente com estoque |
| `onSale` | `true` | Somente com preço comparativo |
| `launch` / `featured` / `bestSeller` | `true` | Selos |
| `sort` | `price_asc` | `relevance`, `price_asc`, `price_desc`, `newest`, `oldest`, `name_asc`, `best_sellers` |
| `page` / `perPage` | `1` / `20` | `perPage` máximo: 100 |

A resposta **nunca** inclui `costPrice` (custo) nem campos internos.

### Categorias — `/api/categories`

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Categorias ativas com contagem de produtos |
| GET | `/:slug` | Detalhe + subcategorias |

### Marcas — `/api/brands`

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Marcas ativas com contagem de produtos |

---

## 5. Carrinho — `/api/cart` (requer login)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Carrinho com itens e resumo calculado no servidor |
| POST | `/items` | Adiciona `{ productId, quantity }` |
| PATCH | `/items/:itemId` | Atualiza quantidade (`0` remove) |
| DELETE | `/items/:itemId` | Remove um item |
| DELETE | `/` | Esvazia |

O estoque é validado na inclusão **e** novamente no checkout.

---

## 6. Favoritos — `/api/favorites` (requer login)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista favoritos |
| GET | `/ids` | Somente os IDs (para pintar corações na vitrine sem N+1) |
| POST | `/:productId` | Favorita |
| DELETE | `/:productId` | Remove |

---

## 7. Cupons — `/api/coupons` (requer login)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/validate` | Valida o cupom contra o carrinho atual |

```json
{ "code": "PROMO10", "shippingCost": 19.9 }
```

Validação em ordem, sempre no backend: existe → ativo → dentro da vigência → limite total → limite por usuário → valor mínimo → produto/categoria participa → `allowCoupon` do produto → cálculo do desconto (limitado ao subtotal elegível).

---

## 8. Frete — `/api/shipping`

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| GET | `/methods` | — | Modalidades ativas |
| GET | `/ufs` | — | Lista de UFs |
| POST | `/cep` | — | `{ cep }` → `{ cep, uf }` |
| POST | `/quote` | ✅ | Cota pelo carrinho real + CEP |
| POST | `/select` | ✅ | Valor de uma modalidade específica |

Se **nenhum item** do carrinho exigir frete (`hasShipping: false`), a resposta traz `required: false` e `options: []` — o sistema **não inventa** um valor de frete.

---

## 9. Pedidos — `/api/orders` (requer login)

| Método | Rota | Descrição |
|---|---|---|
| POST | `/` | **Checkout** (cria o pedido) |
| GET | `/summary` | Contadores do cliente |
| GET | `/` | Lista com paginação (`?status=PAID`) |
| GET | `/:id` | Detalhe completo (id ou número `MA-…`) |
| GET | `/:id/receipt` | Comprovante (imprimível/PDF) |
| POST | `/:id/cancel` | Cancela (somente antes do pagamento) |

**Checkout**

```http
POST /api/orders
Authorization: Bearer <token>
X-Idempotency-Key: 7f1c-...
Content-Type: application/json

{
  "addressId": "ckx...",           // OU "address": { cep, street, number, district, city, state }
  "shippingMethodId": "ckx...",
  "couponCode": "PROMO10",
  "paymentMethod": "PIX",           // PIX | CREDIT_CARD | BOLETO | MANUAL
  "notes": "Entregar após 18h"
}
```

Numa **única transação** o backend: revalida carrinho, preços e estoque → reserva estoque de forma atômica (`UPDATE … WHERE stock >= qty`) → valida frete e cupom → gera o número (`MA-AAAA-000123`) → grava pedido, itens (com snapshots), histórico, pagamento e uso do cupom → limpa o carrinho → notifica cliente e administração.

**Status possíveis:** `AWAITING_PAYMENT`, `PAYMENT_REVIEW`, `PAID`, `PREPARING`, `SHIPPED`, `DELIVERED`, `CANCELED`, `REFUNDED`.

Transições válidas:

```
AWAITING_PAYMENT ─┬─> PAYMENT_REVIEW ─> PAID ─┬─> PREPARING ─> SHIPPED ─> DELIVERED ─> REFUNDED
                  ├─> PAID                      ├─> CANCELED
                  └─> CANCELED                  └─> REFUNDED
```

Qualquer outra transição responde `400 BUSINESS_RULE`.

**Efeitos no estoque:** pedido criado → `stock -`, `reservedStock +`; pagamento aprovado → `reservedStock -`, `soldStock +`; cancelado → devolve para `stock`; reembolsado → devolve para `stock`.

---

## 10. Pagamentos — `/api/payments`

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/orders/:orderId/intent` | ✅ | Cria/reaproveita a intenção (`{ method }`) |
| GET | `/:id` | ✅ | Status do pagamento + tentativas |
| POST | `/:id/simulate` | ✅ | **Somente sandbox**: `APPROVED` \| `DECLINED` \| `CANCELED` \| `EXPIRED` |
| POST | `/webhooks/:provider` | assinatura | Webhook do gateway |

- `PAYMENT_ENV=sandbox` bloqueia `simulate` quando `production`.
- **Nenhum dado completo de cartão** é armazenado — somente `providerRef` e metadados não sensíveis.
- Efeitos no pedido são **idempotentes**: repetir o mesmo resultado devolve `alreadyProcessed: true`.

**Webhook**

```http
POST /api/payments/webhooks/mock
X-Webhook-Signature: sha256=<hmac_sha256_do_corpo_cru>
Content-Type: application/json

{ "eventId": "evt_123", "eventType": "payment.approved",
  "providerRef": "sbx_abc", "outcome": "APPROVED", "amount": 120.0 }
```

O corpo cru é preservado por um *content type parser* encapsulado só neste plugin, para validar o HMAC. A assinatura é conferida em tempo constante. O par `(provider, eventId)` é único no banco → **o mesmo evento nunca é processado duas vezes**. Assinatura inválida é registrada como `INVALID_SIGNATURE` e o pagamento **não** muda.

---

## 11. Mensagens — `/api/messages` (requer login)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/conversations` | Conversas do cliente |
| GET | `/unread` | Contadores (cliente/admin) |
| POST | `/conversations` | Abre conversa (`{ subject, orderId?, message }`) |
| GET | `/conversations/:id` | Conversa (marca como lida) |
| POST | `/conversations/:id/messages` | Envia mensagem |

---

## 12. Notificações — `/api/notifications` (requer login)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista (`?onlyUnread=true`). Header `X-Unread-Count` |
| GET | `/unread-count` | Somente o contador |
| POST | `/:id/read` | Marca uma como lida |
| POST | `/read-all` | Marca todas |
| DELETE | `/:id` | Remove |

---

## 13. Avaliações e feedback

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| POST | `/api/products/:productId/reviews` | ✅ | Avaliar (**exige pedido entregue** contendo o produto) |
| GET | `/api/reviews/mine` | ✅ | Minhas avaliações |
| GET | `/api/reviews/pending` | ✅ | Produtos comprados e ainda não avaliados |
| POST | `/api/feedback` | ✅ | Feedback (`PRODUCT` \| `DELIVERY` \| `EXPERIENCE`) |
| GET | `/api/feedback/mine` | ✅ | Meus feedbacks |

Avaliações entram como `PENDING` e só aparecem no site após moderação. Isso impede depoimento inventado.

---

## 14. Conteúdo (CMS público)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/content` | Todos os valores **públicos** + dicionário `key → value` (pode conter `null`) |
| GET | `/api/content/:key` | Uma chave pública |
| GET | `/api/banners?position=hero` | Banners ativos e vigentes |
| GET | `/api/theme` | Tema publicado (ou `published: false`) |

> `null` significa "o administrador ainda não preencheu". O frontend deve exibir placeholder, **nunca** um dado inventado.

---

## 15. Painel administrativo — `/api/admin` (requer `role = ADMIN`)

Todas as rotas abaixo passam pelo hook `requireAdmin`. Toda escrita gera registro em `admin_audit_logs` com administrador, ação, entidade, `before`/`after`, IP e `requestId`.

### Visão geral e observabilidade

| Método | Rota | Descrição |
|---|---|---|
| GET | `/dashboard` | Pedidos, receita, clientes, catálogo, moderação, série de vendas (30 dias), top produtos |
| GET | `/audit-logs` | Auditoria (`?entity=`, `?action=`, `?adminId=`) |
| GET | `/logs` | Eventos de webhook + falhas do laboratório |

### Produtos — `/admin/products`

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista admin (`?includeInactive=true`, `?lowStock=true`) |
| GET | `/:id` | Detalhe completo (inclui custo) |
| POST | `/` | Cria (imagens inclusas) |
| PATCH | `/:id` | Atualiza (slug regenerado quando o nome muda) |
| PATCH | `/:id/stock` | Ajusta estoque (**bloqueia** valor abaixo do reservado) |
| POST | `/:id/duplicate` | Duplica (cópia nasce inativa, estoque 0) |
| DELETE | `/:id` | Desativa. `?hard=true` exclui de verdade (bloqueado se já vendido) |

### Categorias / Marcas

| Método | Rota | Descrição |
|---|---|---|
| GET/POST | `/admin/categories` | Lista / cria |
| PATCH | `/admin/categories/:id` | Atualiza |
| POST | `/admin/categories/reorder` | Reordena |
| DELETE | `/admin/categories/:id` | Exclui; se tiver produtos/subcategorias, **desativa** |
| GET/POST | `/admin/brands` | Lista / cria |
| PATCH/DELETE | `/admin/brands/:id` | Atualiza / exclui (ou desativa) |

### Pedidos — `/admin/orders`

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista com filtros (status, período, busca, pagamento) + `statusCounts` |
| GET | `/pending-count` | Contador para o badge 🔔 |
| GET | `/:id` | Detalhe com histórico, tentativas de pagamento e envio |
| GET | `/:id/receipt` | Comprovante |
| PATCH | `/:id/status` | Muda status (`{ status, note?, trackingCode?, carrier? }`) |
| POST | `/:id/cancel` | Cancela |

### Usuários — `/admin/users`

| Método | Rota | Descrição |
|---|---|---|
| GET | `/` | Lista com nº de pedidos e total gasto |
| GET | `/:id` | Detalhe (**sempre** `passwordVisible: false`) |
| GET | `/:id/orders` | Pedidos do usuário |
| PATCH | `/:id/status` | Bloqueia/desbloqueia (bloquear revoga todas as sessões) |
| POST | `/:id/reset-password` | **Inicia** a recuperação (nunca revela a senha) |
| GET | `/:id/sessions` | Sessões ativas (sem tokens) |
| POST | `/:id/sessions/revoke` | Revoga todas |

### Cupons, frete, mensagens, moderação, conteúdo

| Método | Rota | Descrição |
|---|---|---|
| GET/POST | `/admin/coupons` | Lista / cria (com produtos e categorias elegíveis) |
| GET/PATCH | `/admin/coupons/:id` | Detalhe / atualiza |
| POST | `/admin/coupons/:id/toggle` | Ativa/desativa |
| DELETE | `/admin/coupons/:id` | Exclui (ou desativa se já usado) |
| GET/POST | `/admin/shipping` | Modalidades de frete |
| PATCH/DELETE | `/admin/shipping/:id` | Atualiza / exclui (ou desativa) |
| POST | `/admin/shipping/reorder` | Reordena |
| GET | `/admin/conversations` | Central de atendimento (`?status=`, `?search=`) |
| GET | `/admin/conversations/:id` | Conversa (marca como lida) |
| POST | `/admin/conversations/:id/messages` | Responde (notifica o cliente) |
| PATCH | `/admin/conversations/:id/status` | `OPEN` \| `ARCHIVED` \| `RESOLVED` |
| GET | `/admin/reviews` | Moderação de avaliações |
| PATCH/DELETE | `/admin/reviews/:id` | Aprova/rejeita / exclui |
| GET | `/admin/feedbacks` | Feedbacks |
| PATCH/DELETE | `/admin/feedbacks/:id` | Modera / exclui |
| GET | `/admin/payments` | Pagamentos + resumo por status + ambiente |
| POST | `/admin/payments/expire-stale` | Expira pagamentos pendentes vencidos |
| GET | `/admin/webhooks` | Eventos de webhook recebidos |
| GET | `/admin/content` | Todo o conteúdo (inclusive privado) — cria as chaves vazias |
| PUT | `/admin/content` | Salva em lote `{ entries: [{ key, value }] }` |
| DELETE | `/admin/content/:id` | Remove uma chave |
| GET | `/admin/settings` | Configurações agrupadas (loja, redes, pagamento, frete, políticas) |
| GET/POST | `/admin/banners` | Banners |
| PATCH/DELETE | `/admin/banners/:id` | Atualiza / exclui |
| POST | `/admin/banners/reorder` | Reordena |
| GET | `/admin/theme` | Rascunho, publicado e histórico |
| POST | `/admin/theme` | Cria rascunho |
| PATCH | `/admin/theme/:id` | Edita rascunho (**bloqueado** no tema publicado) |
| POST | `/admin/theme/:id/publish` | Publica |
| POST | `/admin/theme/:id/draft` | Duplica para novo rascunho |
| DELETE | `/admin/theme/:id` | Exclui rascunho |

---

## 16. Laboratório de testes — `/api/admin/lab` (requer ADMIN)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/checklists` | Categorias de verificação disponíveis |
| GET | `/runs` | Execuções anteriores com resumo |
| GET | `/runs/:id` | Resultado completo (stack trace oculto em produção) |
| POST | `/run` | **Executa a suíte completa** |

A suíte cria dados marcados como `[TESTE]`/`isDemo`, executa verificações reais contra a API e o banco, grava tudo em `test_runs`/`test_results` e **remove os dados criados** ao final. São 45 verificações cobrindo infra, banco, autenticação, segurança, catálogo, carrinho, cupom, frete, pedido, concorrência, pagamento, admin, mensagens, notificações, avaliações, CMS e performance.

---

## 17. Rate limiting

| Escopo | Padrão | Variável |
|---|---|---|
| Global | 120 req/min por IP | `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` |
| Autenticação | 10 req/min por IP | `AUTH_RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_WINDOW` |

Resposta: `429 RATE_LIMITED` com `requestId`.
