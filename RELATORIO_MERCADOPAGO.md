# RELATÓRIO — Integração REAL com Mercado Pago (MA STORE)

**Data:** 2026-10-07
**Base:** `ma-store-fixes-imagens-perf-push_88eb49d6.zip`
**Escopo:** substituir o pagamento mock/PIX estático por integração real com
Mercado Pago (PIX, cartão, boleto), preservando a opção manual "Combinar com a
loja (WhatsApp)" e o restante do sistema.

---

## 0. Status por item (não declarar concluído sem teste)

| Item | Status |
| --- | --- |
| Adapter Mercado Pago (PIX/cartão/boleto/consulta) | **IMPLEMENTADO** |
| Webhook + validação de assinatura | **IMPLEMENTADO** + **TESTADO (unitário)** |
| Idempotência (pedido + webhook) | **IMPLEMENTADO** + **TESTADO (unitário/integração escrito)** |
| Checkout com PIX/cartão/boleto/WhatsApp | **IMPLEMENTADO** + **BUILD OK** |
| Migration aditiva | **IMPLEMENTADO** + `prisma validate` OK |
| Typecheck backend/frontend | **TESTADO (passou)** |
| Testes unitários (173) | **TESTADO (passou)** |
| Build frontend + 91 testes | **TESTADO (passou)** |
| Teste de integração com PostgreSQL | **ESCRITO — não executado neste ambiente** (sem PostgreSQL/Docker) |
| Cobrança real no gateway | **AGUARDANDO CREDENCIAL** + **AGUARDANDO TESTE EXTERNO** |

> Nada foi marcado como "pago" sem confirmação do gateway. Não há mock misturado
> ao fluxo de produção: `PAYMENT_PROVIDER=mock` continua existindo apenas para
> desenvolvimento/testes automatizados.

---

## 1. Arquivos alterados

**Backend**
- `backend/src/env.ts` — novas credenciais do Mercado Pago e validação fail-fast.
- `backend/prisma/schema.prisma` — campos aditivos em `Pedido`; índice em `Payment.providerRef`.
- `backend/src/lib/validation.ts` — `pagamento` (PIX/CREDIT_CARD/BOLETO/COMBINAR) + `pedidoPaymentSchema`.
- `backend/src/modules/payments/payment.routes.ts` — webhook real `/webhooks/mercadopago` + intent com cartão.
- `backend/src/modules/payments/payment.service.ts` — provider Mercado Pago no fluxo autenticado.
- `backend/src/modules/payments/payment-methods.routes.ts` — lista PIX/cartão/boleto/WhatsApp + Public Key.
- `backend/src/modules/pedidos/pedido.routes.ts` — QR base64 + retentativa de pagamento.
- `backend/src/modules/rastreio/tracking.routes.ts` — QR real do gateway.
- `backend/src/services/orders.ts` — cria a cobrança real e persiste a referência.
- `backend/package.json` — dependência `mercadopago@^3.6.1` + script `test:unit:fast`.
- `backend/.env.example`, `.env.example` — documentação das variáveis.
- `backend/package-lock.json` — lockfile atualizado.

**Frontend**
- `frontend/src/pages/CheckoutPage.tsx` — seleção de meio de pagamento + formulário de cartão tokenizado.
- `frontend/src/pages/TrackingPage.tsx` — QR PIX, copia e cola, boleto, status e nova tentativa.
- `frontend/src/pages/admin/PedidoDetailPage.tsx` — bloco de pagamento (provedor/referência).
- `frontend/src/lib/format.ts` + `format.test.ts` — máscaras de cartão e rótulos.
- `frontend/src/types/api.ts` — campos de pagamento do pedido Guest.
- `frontend/package.json` — dependência `@mercadopago/sdk-js@^0.0.3`.
- `frontend/package-lock.json` — lockfile atualizado.

## 2. Arquivos criados

- `backend/src/services/mercadopago/config.ts`
- `backend/src/services/mercadopago/client.ts`
- `backend/src/services/mercadopago/status-map.ts`
- `backend/src/services/mercadopago/signature.ts`
- `backend/src/services/mercadopago/errors.ts`
- `backend/src/services/mercadopago/index.ts`
- `backend/src/services/pedido-payments.ts`
- `backend/tests/unit/mercadopago.test.ts`
- `backend/tests/integration/mercadopago.test.ts`
- `backend/vitest.unit.config.ts`
- `frontend/src/lib/mercadopago.ts`
- `docs/MERCADOPAGO.md`
- `RELATORIO_MERCADOPAGO.md`, `CORRECOES_MERCADOPAGO.diff`

## 3. Migrations

`backend/prisma/migrations/20261007120000_mercadopago/migration.sql` — **aditiva e
idempotente** (`ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`). Não
remove colunas, não apaga dados, não usa `migrate reset`.

Novos campos em `pedidos`: `pagamento_provider`, `pagamento_provider_ref`,
`pagamento_provider_status`, `pagamento_metodo_detalhe`,
`pagamento_qr_code_base64`, `pagamento_boleto_url`, `pagamento_boleto_barcode`,
`pagamento_idempotency_key` (único), `pago_em`. Índice em `payments.providerRef`.

## 4. Endpoints

| Método | Rota | Situação |
| --- | --- | --- |
| GET | `/api/payment-methods` | Alterado (4 meios + Public Key) |
| POST | `/api/pedidos` | Alterado (cobra no gateway) |
| POST | `/api/pedidos/:token/pagamento` | **Novo** (retentativa/regeneração) |
| GET | `/api/rastreio/:token` | Alterado (QR real) |
| POST | `/api/payments/orders/:orderId/intent` | Alterado (cartão + gateway) |
| POST | `/api/payments/webhooks/mercadopago` | **Novo** |
| POST | `/api/payments/webhooks/:provider` | Preservado (sandbox/mock) |
| POST | `/api/payments/:id/simulate` | Preservado (apenas sandbox) |

## 5. Variáveis de ambiente necessárias

`PAYMENT_PROVIDER=mercadopago`, `PAYMENT_ENV`, `MERCADOPAGO_ACCESS_TOKEN`,
`MERCADOPAGO_PUBLIC_KEY`, `MERCADOPAGO_WEBHOOK_SECRET`, `PUBLIC_API_URL`
(além de `WEBHOOK_SECRET` e `PAYMENT_EXPIRES_MINUTES`, já existentes).

## 6–8. Fluxos PIX / cartão / boleto

Detalhados em `docs/MERCADOPAGO.md`. Resumo: o servidor **sempre recalcula** o
valor (`subtotal + frete − desconto`) antes de cobrar; PIX grava `qr_code` e
`qr_code_base64` reais; cartão recebe **apenas o token**; boleto exige CPF/CNPJ e
informa indisponibilidade real quando a conta não o habilita.

## 9. Webhook

Valida `x-signature` (HMAC-SHA256 sobre `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`),
registra em `webhook_events` (único por `provider+eventId`), **consulta o
pagamento real** no gateway, confere o valor e só então atualiza pedido/estoque.
Assinatura inválida não é processada.

## 10. Idempotência

- `Order.idempotencyKey` e `Pedido.pagamento_idempotency_key` únicos.
- `X-Idempotency-Key` em todas as chamadas ao Mercado Pago.
- `webhook_events (provider, eventId)` único.
- Transições de status protegem os efeitos de estoque (reserva → venda / liberação).

## 11. Segurança

- Access Token e Webhook Secret **nunca** vão ao frontend nem aos logs (o logger
  já tem `redact`; não logamos o token em nenhum ponto).
- Nenhum dado bruto de cartão é recebido/armazenado (só o token).
- Valor recalculado no backend; pagamento de valor divergente é recusado.
- `CORS` restrito às origens configuradas; webhook é server-to-server.

## 12–13. Testes executados e resultados

| Comando | Resultado |
| --- | --- |
| `npx prisma validate` (schema) | ✅ válido |
| `npx tsc --noEmit` (backend, inclui testes) | ✅ sem erros |
| `npx vitest run --config vitest.unit.config.ts` | ✅ **173 testes / 27 arquivos** |
| `npm run build` (frontend) | ✅ build OK |
| `npm test` (frontend) | ✅ **91 testes / 14 arquivos** |

Novos testes: `tests/unit/mercadopago.test.ts` (assinatura válida/inválida,
mapeamento de status, erros, configuração) e
`tests/integration/mercadopago.test.ts` (PIX, valor, webhook válido/inválido,
duplicado, valor divergente, recusa, duplo clique) — **escrito e typechecked**,
mas **não executado** aqui por ausência de PostgreSQL/Docker no ambiente.

## 14. O que foi realmente validado

- Schema Prisma válido; migration aditiva; `prisma generate` OK.
- Backend compila e a aplicação sobe com todas as rotas registradas (`app.ready()`).
- Testes unitários e de frontend passam; build de produção do frontend OK.
- Lógica de assinatura do webhook e mapeamento de status verificados por teste.

## 15. O que ainda depende de configuração externa

- **Credenciais reais** do Mercado Pago (Access Token/Public Key/Webhook Secret).
- **Teste externo real** de PIX/cartão/boleto em sandbox com os cartões de teste.
- **URL pública do backend** acessível pelo Mercado Pago (`PUBLIC_API_URL`) para
  receber o webhook.
- Habilitar **boleto** na conta, caso ainda não esteja.

## 16. Regressão

Nenhuma funcionalidade existente foi removida. O fluxo `mock` continua disponível
para desenvolvimento/testes; `/simulate` continua restrito a sandbox; catálogo,
carrinho, frete, rastreamento, admin e WhatsApp permanecem intactos. A suite de
frontend (incluindo o checkout) e os 173 testes unitários passaram.
