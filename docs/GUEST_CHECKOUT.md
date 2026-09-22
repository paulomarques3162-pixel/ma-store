# Guest Checkout + Frete + Rastreamento — Resumo técnico

Implementação do fluxo **Carrinho → Guest Checkout → Frete → Pedido (Neon/PostgreSQL) → Administração → Rastreamento Público**, preservando a interface existente.

## Regras de entrega implementadas

| Modalidade | Regra | Custo | Observação |
|---|---|---|---|
| **Retirar na loja** | sempre disponível | Grátis | `RETIRADA_*` |
| **Motoboy — Pirassununga** | CEP de destino na faixa configurada | R$ 10,00 | `FLEX_CEP_PREFIX` (padrão `1363`) — só aparece quando elegível |
| **Correios PAC / SEDEX** | peso real + 100 g de embalagem | calculado | cliente paga direto aos Correios; valor não entra no total da loja |
| **Jetlog** | valor fixo configurado ou API | configurável | `JETLOG_VALOR` / `JETLOG_API_URL` |
| **Pegaki** | ponto de retirada | configurável | adapter preparado, sem simulação falsa |

Peso: `soma(peso_unitario × quantidade) + 0,100 kg` (`SHIPPING_WEIGHT_MARGIN_KG`).

## Arquivos criados

**Backend**
- `prisma/migrations/20260922120000_pedidos_guest_checkout/migration.sql` — migration idempotente da tabela `pedidos`
- `src/lib/order-status.ts` — `ORDER_STATUSES` + timeline
- `src/lib/validation.ts` — Zod (CEP, UF, WhatsApp, pedido, cotação)
- `src/services/shipping/{types,weight,retirada,flex,correios,jetlog,pegaki,index}.ts` — motor de frete
- `src/services/orders.ts` — criação/busca/atualização de pedidos (transação + token)
- `src/modules/pedidos/pedido.routes.ts` — `POST /api/pedidos`
- `src/modules/rastreio/tracking.routes.ts` — `GET /api/rastreio/:token`
- `src/modules/admin/pedido.admin.routes.ts` — admin de pedidos
- `tests/unit/guest-checkout.test.ts` — 10 testes unitários

**Frontend**
- `src/stores/cart.ts` — carrinho de visitante (localStorage)
- `src/pages/TrackingPage.tsx` — `/rastreio/:token`
- `src/pages/admin/PedidosPage.tsx` — lista de pedidos
- `src/pages/admin/PedidoDetailPage.tsx` — detalhe + controle de status

## Arquivos modificados
- `prisma/schema.prisma` — model `Pedido` mapeado para `pedidos`
- `src/env.ts`, `.env.example`, `backend/.env.example` — variáveis de frete
- `src/app.ts` — registro das rotas
- `src/modules/shipping/shipping.routes.ts` — `POST /api/shipping`
- `frontend/src/hooks/index.ts` — carrinho unificado (servidor/visitante)
- `frontend/src/components/product/ProductCard.tsx`, `src/pages/ProductPage.tsx` — adicionar sem login
- `frontend/src/pages/CartPage.tsx`, `src/components/layout/CartDrawer.tsx` — sem exigência de conta
- `frontend/src/pages/CheckoutPage.tsx` — reescrito como Guest Checkout
- `frontend/src/App.tsx`, `src/types/api.ts`, `src/lib/constants.ts`, `src/pages/store-pages.test.tsx`

## APIs
| Método | Rota | Acesso |
|---|---|---|
| POST | `/api/shipping` | público |
| POST | `/api/pedidos` | público |
| GET | `/api/rastreio/:token` | público |
| GET | `/api/admin/pedidos` | ADMIN |
| GET | `/api/admin/pedidos/:id` | ADMIN |
| PATCH | `/api/admin/pedidos/:id` | ADMIN |

## Segurança
- Token de rastreio criptograficamente seguro (32 bytes `base64url`), nunca derivado do ID.
- `id`, `token` e `status` nunca são aceitos do cliente.
- Preços/pesos/frete recalculados no servidor a partir do catálogo.
- Queries parametrizadas (Prisma), validação Zod, autenticação administrativa.
- Sem segredos no código; tudo via environment.

## Regra "Entregue"
`PATCH /api/admin/pedidos/:id` exige `recebido_por` quando `status_atual = "Entregue"` e grava `data_entrega = now()`.
Ao sair de "Entregue", `recebido_por` e `data_entrega` são limpos de forma consistente.

## Testes executados
- Backend: `tsc --noEmit` OK, `tsup` build OK, 10 testes unitários OK.
- Frontend: `tsc` OK, `vite build` OK, 55 testes OK.
- Runtime do motor de frete validado (peso 0,8 kg; motoboy elegível em `1363x`; timeline dos 5 status).

## Depende de credenciais externas
- **Correios**: `CORREIOS_TOKEN` + `CORREIOS_ORIGEM_CEP` (sem eles, PAC/SEDEX não aparecem).
- **Jetlog**: `JETLOG_API_URL`+`JETLOG_API_TOKEN` ou `JETLOG_VALOR`.
- **Pegaki**: `PEGAKI_API_URL`+`PEGAKI_API_TOKEN` ou `PEGAKI_VALOR`.
