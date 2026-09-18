# Arquitetura — MA STORE

## Visão geral

```
┌────────────────────┐      HTTPS/JSON      ┌──────────────────────────────┐
│  Frontend (fase 2) │ ───────────────────► │  API Fastify (Node + TS)     │
│  React + Vite PWA  │ ◄─────────────────── │  /api/*                      │
│  Vercel            │                      │  Render                      │
└────────────────────┘                      └───────────┬──────────────────┘
                                                        │ Prisma
                                                        ▼
                                            ┌──────────────────────────────┐
                                            │  PostgreSQL 15 (Render)      │
                                            └──────────────────────────────┘
                                                        ▲
                                            webhook assinado (HMAC)
                                            gateway de pagamento
```

### Camadas

| Camada | Responsabilidade |
|---|---|
| `src/modules/*/*.routes.ts` | HTTP: parsing, validação (Zod), autorização, formatação de resposta |
| `src/modules/*/*.service.ts` | Regras de negócio, transações, cálculos |
| `src/lib/*` | Utilitários puros (crypto, senha, erros, serialização, auditoria, tokens) |
| `src/plugins/*` | Autenticação/autorização e tratamento global de erros |
| `prisma/schema.prisma` | Modelo de dados, índices e integridade referencial |

A separação é intencional: rotas não contêm regra de negócio crítica (preço, estoque, cupom, frete, total), e serviços não conhecem o objeto `request`.

---

## Modelo de dados

30 modelos, 13 enums, 100% das relações com `onDelete` explícito.

```
User ─┬─ Session                    Product ─┬─ ProductImage
      ├─ PasswordResetToken                  ├─ CartItem
      ├─ Address                             ├─ OrderItem
      ├─ Cart ─ CartItem                     ├─ Review
      ├─ Order ─┬─ OrderItem                 ├─ Favorite
      │         ├─ OrderStatusHistory        └─ CouponProduct
      │         ├─ Payment ─ PaymentAttempt
      │         ├─ Shipment ─ ShippingMethod
      │         ├─ CouponUsage
      │         ├─ Conversation ─ Message
      │         ├─ Review
      │         └─ Feedback
      ├─ Favorite
      ├─ Notification
      ├─ AdminAuditLog
      └─ TestRun ─ TestResult

Category ─┬─ Category (árvore)   Coupon ─┬─ CouponProduct
          └─ Product                     ├─ CouponCategory
Brand ─── Product                       └─ CouponUsage
SiteContent · SiteTheme · Banner · WebhookEvent · Sequence
```

### Decisões de modelagem

**Snapshots no pedido.** `OrderItem` guarda `nameSnapshot`, `skuSnapshot`, `imageSnapshot` e `unitPrice`; `Order.shippingAddress` e `Order.customerSnapshot` são JSON. Se o produto mudar de nome, preço ou se o endereço for editado depois, o pedido continua mostrando exatamente o que foi comprado. O comprovante é historicamente correto.

**Estoque em três números.** `stock` (disponível), `reservedStock` (em pedidos não pagos), `soldStock` (vendido). Permite saber o que está comprometido sem perder a referência do que já saiu.

**Idempotência em dois lugares.** `Order.idempotencyKey` (único) impede pedido duplicado por duplo clique; `WebhookEvent @@unique([provider, eventId])` impede processamento duplicado de webhook.

**Conteúdo por chave/valor.** `SiteContent` evita `ALTER TABLE` a cada texto novo. `isPublic` separa o que pode ir para o cliente do que é interno (chave PIX, razão social).

**Tema com rascunho e publicado.** `SiteTheme.isDraft` / `isActive` / `publishedAt` permitem editar sem afetar o site no ar.

**`isDemo` em tudo que é semeado.** Torna impossível confundir dado de demonstração com dado real — inclusive em consulta direta ao banco.

### Índices

Além dos índices automáticos (unique, FKs), a migration `20260918153000_performance_indexes` cria:

- **GIN + `pg_trgm`** em `products.name`, `products.sku`, `products.shortDescription`, `users.name`, `users.email` → a busca com `ILIKE` deixa de fazer *sequential scan*.
- Compostos para a vitrine: `(categoryId, active, createdAt DESC)`, `(brandId, active, createdAt DESC)`.
- Parciais: produtos em oferta (`WHERE comparePrice IS NOT NULL`), estoque baixo, notificações não lidas.
- Administrativos: `orders(status, createdAt DESC)`, `orders(userId, createdAt DESC)`, auditoria, resultados de teste, sessões.

---

## Fluxo de checkout (o caminho crítico)

```
POST /api/orders
  │
  ├─ idempotencyKey já existe? ──► devolve o pedido existente (reused: true)
  │
  ├─ carrega carrinho + revalida produto ativo e estoque
  ├─ resolve endereço (da conta do usuário ou informado)
  │
  └─ TRANSAÇÃO (timeout 20s, ReadCommitted)
       ├─ 1. reserva estoque item a item:
       │      UPDATE products
       │         SET stock = stock - $qty, reservedStock = reservedStock + $qty
       │       WHERE id = $id AND active = true AND stock >= $qty
       │      ── 0 linhas afetadas ⇒ 409 INSUFFICIENT_STOCK
       ├─ 2. resolve o frete (modalidade ativa + região + freeAbove)
       ├─ 3. revalida o cupom (regras + limite por usuário) e calcula o desconto
       ├─ 4. gera o número via sequência atômica (INSERT … ON CONFLICT … RETURNING)
       ├─ 5. grava Order + OrderItems (snapshots) + histórico + Payment PENDING
       ├─ 6. grava Shipment e CouponUsage, incrementa coupon.usesCount
       ├─ 7. limpa o carrinho
       └─ 8. notifica o cliente e todos os administradores ativos
```

**Por que a reserva é feita em SQL cru?** Porque `WHERE stock >= $qty` faz o *banco* arbitrar a corrida. Duas requisições simultâneas para o último item: apenas um `UPDATE` afeta 1 linha; o outro afeta 0 e recebe `409`. O estoque nunca fica negativo — comportamento coberto por teste automatizado e pelo laboratório (`concorrencia`).

---

## Fluxo de pagamento

```
POST /api/payments/orders/:id/intent   → cria/reaproveita Payment (PENDING, providerRef)
POST /api/payments/:id/simulate        → sandbox: APPROVED|DECLINED|CANCELED|EXPIRED
POST /api/payments/webhooks/:provider  → produção: assinatura HMAC + idempotência

applyPaymentResult()  (idempotente)
  ├─ já está em estado final? → alreadyProcessed: true, nada muda
  ├─ Payment → novo status + PaymentAttempt (payload, duração, erro)
  └─ APPROVED → updateOrderStatus(PAID)
                 ├─ reservedStock - , soldStock +
                 ├─ paidAt + OrderStatusHistory
                 └─ notifica o cliente
```

O webhook usa um *content type parser* encapsulado ao plugin de pagamentos para preservar o corpo cru (necessário para o HMAC). A comparação da assinatura é feita em tempo constante (`timingSafeEqual`). Um evento com assinatura inválida é **registrado** como `INVALID_SIGNATURE` e o pagamento não é tocado.

---

## Segurança em profundidade

| Camada | Controle |
|---|---|
| Transporte | HTTPS (responsabilidade da plataforma; `trustProxy` habilitado) |
| Cabeçalhos | Helmet |
| CORS | Lista explícita de origens (`CORS_ORIGINS`) |
| Entrada | Zod em todo body/query/params |
| Autenticação | JWT HS256 curto + refresh opaco com rotação e revogação |
| Senhas | bcrypt custo 12; política mínima; nunca retornadas |
| Brute force | `failedLoginCount` + `lockedUntil` + rate limit dedicado |
| Autorização | `preHandler` por rota (`authenticate`, `requireAdmin`) |
| Banco | Prisma com queries parametrizadas (sem SQL injection) |
| XSS | API JSON puro; nenhum HTML renderizado pelo backend |
| Segredos | Somente em variáveis de ambiente; `redact` no logger |
| Auditoria | Toda escrita administrativa com `before`/`after`, IP e `requestId` |
| Erros | Mensagem amigável + `requestId`; stack trace só no log/admin em dev |

Detalhes em [`SECURITY.md`](SECURITY.md).

---

## Performance

- **Sem N+1**: listagens usam `select` explícito e agregações (`groupBy`, `count`, `aggregate`) em paralelo com `Promise.all`.
- **Paginação sempre**: teto de 100 itens por página.
- **Cache HTTP** (`Cache-Control` público com `stale-while-revalidate`) apenas em conteúdo de vitrine (produtos, categorias, marcas, banners, tema). Dados críticos (preço no checkout, estoque, cupom, pagamento) **nunca** são cacheados.
- **`select` mínimo**: a API pública não devolve `costPrice` nem colunas internas.
- **Compressão e limites**: `bodyLimit` de 2 MB; respostas JSON enxutas.
- **Índices** cobrindo busca, filtros, dashboards e auditoria.

Números medidos em [`PERFORMANCE.md`](PERFORMANCE.md).

---

## Tratamento de erros

Um único handler global traduz tudo:

| Origem | Vira |
|---|---|
| `AppError` (negócio) | status do código + mensagem amigável + `requestId` |
| `ZodError` | `422 VALIDATION_ERROR` com a lista de campos |
| Rate limit | `429 RATE_LIMITED` |
| Prisma `P2002` / `P2025` | `409 CONFLICT` / `404 NOT_FOUND` |
| Qualquer outro | `500 INTERNAL_ERROR` + log técnico com stack |

O cliente **nunca** recebe stack trace. O `requestId` (gerado por requisição) liga a resposta ao log correspondente.

---

## Observabilidade

- Logs estruturados (Pino) com `reqId` do Fastify.
- Redação automática de `authorization`, `cookie`, `password`, campos de cartão.
- `GET /api/health` reporta API, banco (com latência), versão e ambiente — sem expor infraestrutura.
- `admin_audit_logs` para trilha administrativa.
- `webhook_events` para trilha de integração.
- `test_runs` / `test_results` para trilha de qualidade.
