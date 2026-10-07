# Integração Mercado Pago — MA STORE

Pagamento online **real** (PIX, cartão de crédito e boleto) via Mercado Pago,
mantendo a opção manual **"Combinar com a loja (WhatsApp)"**.

> **Regra de ouro:** `PAYMENT_PROVIDER=mercadopago` **não** significa pagamento
> funcional. Só consideramos habilitado quando as **três** credenciais existem.
> Sem elas, os meios online ficam indisponíveis — nunca criamos cobrança falsa,
> QR Code fictício ou marcamos pedido como pago sem confirmação real.

## 1. Variáveis de ambiente

| Variável | Visibilidade | Descrição |
| --- | --- | --- |
| `PAYMENT_PROVIDER` | — | `mock` (padrão) ou `mercadopago` |
| `PAYMENT_ENV` | — | `sandbox` ou `production` |
| `MERCADOPAGO_ACCESS_TOKEN` | **PRIVADO (backend)** | Token de acesso da conta |
| `MERCADOPAGO_PUBLIC_KEY` | Pública | Usada pelo SDK no navegador (tokenização) |
| `MERCADOPAGO_WEBHOOK_SECRET` | **PRIVADO (backend)** | Assinatura do webhook (≠ `WEBHOOK_SECRET`) |
| `PUBLIC_API_URL` | Pública | URL do backend, usada como `notification_url` |

O `MERCADOPAGO_ACCESS_TOKEN` e o `MERCADOPAGO_WEBHOOK_SECRET` **nunca** chegam ao
frontend e **nunca** são gravados nos logs. Em produção (`NODE_ENV=production` e
`PAYMENT_ENV=production`) com provider `mercadopago` e credenciais ausentes, a
aplicação **não sobe** (fail fast).

## 2. Arquitetura

```
backend/src/services/mercadopago/
├── config.ts       # status de configuração (sem expor segredos)
├── client.ts       # cliente oficial (Access Token só aqui)
├── status-map.ts   # mapeamento CENTRALIZADO de status
├── signature.ts    # validação da assinatura x-signature (HMAC-SHA256)
├── errors.ts       # normalização de erros segura
└── index.ts        # PIX / cartão / boleto / consulta de pagamento

backend/src/services/pedido-payments.ts  # orquestra o pedido Guest + estoque
```

Nenhum outro módulo chama o SDK diretamente.

## 3. Fluxo PIX

1. Cliente escolhe PIX e finaliza o pedido (`POST /api/pedidos`).
2. O servidor **recalcula** preços/frete, cria o pedido (estoque reservado) e
   grava a referência externa (`token_rastreio_unico`).
3. O backend cria a cobrança PIX no Mercado Pago (com `X-Idempotency-Key`).
4. A resposta real (`qr_code`, `qr_code_base64`, `ticket_url`) é gravada no pedido.
5. A página de rastreio mostra o QR, o **copia e cola** e o botão copiar.
6. O status inicial é **Pendente**. Só vira **Pago** após o webhook.

## 4. Fluxo cartão

1. O SDK oficial (`@mercadopago/sdk-js`) tokeniza o cartão **no navegador**.
2. O frontend envia **somente o token** (+ `payment_method_id`, `issuer_id`,
   `installments`, `payer`).
3. O backend cria o pagamento no gateway. **Nunca** recebe número/CVV.
4. Aprovado → pedido **Pago** + estoque confirmado. Recusado → **Recusado**, com
   opção de nova tentativa (nova `X-Idempotency-Key`, sem duplicar cobrança).

## 5. Fluxo boleto

Requer `CPF/CNPJ` do pagador. Se a conta não tiver boleto habilitado, o gateway
recusa e a loja informa **"Boleto indisponível para este pagamento."** — sem
simulação. Quando emitido, mostra link, linha digitável e vencimento.

## 6. Webhook

`POST /api/payments/webhooks/mercadopago` (público, mas **nunca** sem validação):

1. Valida a assinatura `x-signature`/`x-request-id`/`data.id` com o
   `MERCADOPAGO_WEBHOOK_SECRET`.
2. Registra o evento em `webhook_events` (único por `provider + eventId`).
3. **Consulta o pagamento real** no gateway (não confia no corpo recebido).
4. Confere o **valor** contra o total do pedido.
5. Atualiza pagamento, pedido e estoque — de forma idempotente.

Assinatura inválida → registrada como `INVALID_SIGNATURE` e **não processada**.

## 7. Idempotência

- `Order.idempotencyKey` (fluxo autenticado) e `Pedido.pagamento_idempotency_key`
  (Guest) são únicos: duplo clique não cria dois pedidos.
- `webhook_events (provider, eventId)` é único: o mesmo evento não é processado
  duas vezes.
- As transições de status (Pendente → Pago, etc.) protegem os efeitos de estoque.

## 8. Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/api/payment-methods` | Meios disponíveis + Public Key (público) |
| POST | `/api/pedidos` | Cria pedido Guest e cobra no gateway |
| POST | `/api/pedidos/:token/pagamento` | Retenta/regenera PIX/boleto/cartão |
| GET | `/api/rastreio/:token` | Status do pedido/pagamento (polling) |
| POST | `/api/payments/orders/:orderId/intent` | Intenção (pedidos autenticados) |
| POST | `/api/payments/webhooks/mercadopago` | Webhook do Mercado Pago |

## 9. Como validar

```bash
cd backend
npm run prisma:generate
npm run typecheck
npm run test:unit:fast      # testes puros (sem banco)
npm test                    # suite completa (exige PostgreSQL de teste)

cd ../frontend
npm run build
npm test
```

Teste ponta a ponta real exige credenciais do Mercado Pago em `sandbox`:

1. Configure as credenciais e `PAYMENT_PROVIDER=mercadopago`.
2. Use os **cartões de teste** oficiais do Mercado Pago.
3. Para receber o webhook em desenvolvimento, exponha o backend
   (ex.: túnel) e defina `PUBLIC_API_URL`.
