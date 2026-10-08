# RELATÓRIO DE AUDITORIA E CORREÇÕES — MA STORE (auditoria completa)

**Base:** `ma-store-fixes-imagens-perf-push_88eb49d6.zip`
**Escopo:** pagamentos reais (Mercado Pago), checkout, imagens/storage, frete,
PWA/push, segurança, observabilidade e robustez.

> Este projeto já passou por rodadas anteriores de auditoria (imagens, sync, PWA,
> push, performance). O relatório abaixo reflete o estado **atual**, após a
> implementação do Mercado Pago e do storage de objetos.

## Legenda de status

- **IMPLEMENTADO** — código presente.
- **TESTADO** — verificado por build/teste executado.
- **CONFIGURADO** — depende de variáveis de ambiente/segredos.
- **AGUARDANDO CREDENCIAL / TESTE EXTERNO** — não foi possível validar aqui.
- **JÁ EXISTIA** — já estava pronto antes desta rodada.

---

## 1. Arquivos alterados

**Nesta rodada (storage + abstração de provider + observabilidade)**
- `backend/src/env.ts` — variáveis S3 e fail-fast de storage.
- `backend/src/services/storage.ts` — dispatch local/s3 + `deleteUpload`.
- `backend/src/services/uploads-cleanup.ts` — usa `deleteUpload`.
- `backend/src/services/mercadopago/index.ts` — exporta `BaseCreateArgs`.
- `backend/src/services/pedido-payments.ts` — passa a usar `PaymentProvider`.
- `backend/src/modules/payments/payment.routes.ts` — webhook via provider.
- `backend/src/app.ts` — redaction de token de cartão/pagador nos logs.
- `backend/.env.example` — variáveis de storage S3.

**Rodada anterior (pagamentos)**
- `backend/src/services/mercadopago/*`, `backend/src/services/pedido-payments.ts`,
  `backend/src/modules/payments/payment.{routes,service}.ts`,
  `backend/src/modules/payments/payment-methods.routes.ts`,
  `backend/src/modules/pedidos/pedido.routes.ts`,
  `backend/src/modules/rastreio/tracking.routes.ts`,
  `backend/src/services/orders.ts`, `backend/src/lib/validation.ts`,
  `backend/prisma/schema.prisma`.
- Frontend: `CheckoutPage.tsx`, `TrackingPage.tsx`, `admin/PedidoDetailPage.tsx`,
  `lib/format.ts`, `lib/mercadopago.ts`, `types/api.ts`.

## 2. Arquivos criados

- `backend/src/services/mercadopago/{config,client,status-map,signature,errors,index}.ts`
- `backend/src/services/payments/provider.ts` — **abstração `PaymentProvider`**
- `backend/src/services/storage-s3.ts` — **driver de objetos (S3)**
- `backend/tests/unit/mercadopago.test.ts`
- `backend/tests/unit/storage-s3.test.ts`
- `backend/tests/integration/mercadopago.test.ts`
- `backend/vitest.unit.config.ts`
- `frontend/src/lib/mercadopago.ts`
- `docs/MERCADOPAGO.md`, `docs/STORAGE.md`
- `RELATORIO_MERCADOPAGO.md`, `RELATORIO_AUDITORIA_COMPLETA.md`

## 3. Migrations

`20261007120000_mercadopago` — **aditiva e idempotente** (`ADD COLUMN IF NOT
EXISTS`). Campos de pagamento no pedido (`pagamento_provider`,
`pagamento_provider_ref`, `pagamento_provider_status`, `pagamento_metodo_detalhe`,
`pagamento_qr_code_base64`, `pagamento_boleto_url`, `pagamento_boleto_barcode`,
`pagamento_idempotency_key` único, `pago_em`) + índice em `payments.providerRef`.
Sem `DROP`/`DELETE`/`TRUNCATE`/`reset`.

## 4. Endpoints

| Método | Rota | Status |
| --- | --- | --- |
| GET | `/api/payment-methods` | IMPLEMENTADO (4 meios + Public Key) |
| POST | `/api/pedidos` | IMPLEMENTADO (cobra no gateway) |
| POST | `/api/pedidos/:token/pagamento` | IMPLEMENTADO (retentativa) |
| GET | `/api/rastreio/:token` | IMPLEMENTADO (QR real) |
| POST | `/api/payments/orders/:orderId/intent` | IMPLEMENTADO (cartão + gateway) |
| POST | `/api/payments/webhooks/mercadopago` | IMPLEMENTADO (assinatura + idempotência) |
| POST | `/api/payments/webhooks/:provider` | JÁ EXISTIA (mock/sandbox) |
| POST | `/api/payments/:id/simulate` | JÁ EXISTIA (somente sandbox) |

## 5. Variáveis de ambiente

Pagamento: `PAYMENT_PROVIDER`, `PAYMENT_ENV`, `MERCADOPAGO_ACCESS_TOKEN`,
`MERCADOPAGO_PUBLIC_KEY`, `MERCADOPAGO_WEBHOOK_SECRET`, `PUBLIC_API_URL`.
Storage: `STORAGE_DRIVER`, `STORAGE_LOCAL_DIR`, `STORAGE_S3_BUCKET`,
`STORAGE_S3_REGION`, `STORAGE_S3_ENDPOINT`, `STORAGE_S3_ACCESS_KEY_ID`,
`STORAGE_S3_SECRET_ACCESS_KEY`, `STORAGE_S3_FORCE_PATH_STYLE`,
`STORAGE_S3_PREFIX`, `STORAGE_PUBLIC_URL`.
Push/frete já documentados em `docs/DEPLOY.md` e `.env.example`.

## 6. Fluxo PIX

PIX é criado no Mercado Pago; o backend grava `qr_code` (copia e cola) e
`qr_code_base64`. O status inicial é **Pendente** e só vira **Pago** via webhook
confirmado. O frontend mostra o QR (base64) e o copia e cola reais.

## 7. Fluxo cartão

Tokenização no navegador pelo SDK oficial (`@mercadopago/sdk-js`); o backend
recebe **somente o token** + `payment_method_id`/`issuer_id`/`installments`/`payer`.
Nunca recebe número, validade ou CVV. Aprovado → Pago; recusado → Recusado com
retentativa.

## 8. Fluxo boleto

Exige CPF/CNPJ. Se a conta não habilitar boleto, o gateway recusa e a loja informa
indisponibilidade real (sem simulação). Emitido → link, linha digitável e
vencimento.

## 9. Fluxo webhook

Valida `x-signature` (HMAC-SHA256), registra em `webhook_events`
(`provider+eventId` único), **consulta o pagamento real** no gateway, confere o
valor e só então atualiza pedido/estoque. Assinatura inválida não é processada.

## 10. Fluxo de idempotência

Chaves únicas no pedido, `X-Idempotency-Key` nas chamadas ao gateway,
`webhook_events` único e transições de status protegendo o estoque.

## 11. Como o checkout recalcula preços

O servidor recalcula `subtotal + frete − desconto` a partir do snapshot do pedido
(`produtos_carrinho` + `frete_escolhido_valor`) antes de cobrar; o valor do
frontend é ignorado.

## 12. Como o backend recalcula frete

O frete é resolvido no servidor pelo motor ativo (engine Correios **ou** motor
local), a partir do CEP/itens/sessão. O cliente envia apenas a modalidade
escolhida (`quoteId`/`methodId`); valores nunca vêm do cliente.

## 13. Como o frontend não confia no valor

O frontend nunca envia o total; apenas itens, endereço, modalidade e dados de
pagamento. Exibe o total devolvido pelo servidor.

## 14. Como dados sensíveis foram protegidos

Access Token e Webhook Secret só no backend; nenhum dado de cartão é armazenado;
redaction de logs ampliada (`req.body.card.token`, `req.body.token`,
`req.body.payer.docNumber`); CORS restrito; webhook server-to-server.

## 15. Como o upload de imagem valida arquivos

Validação por **magic bytes** (`detectImageMime`), allowlist de MIME, limite de
tamanho (`UPLOAD_MAX_MB`) e dimensões (100–6000px). Rejeita conteúdo que não é
imagem mesmo com extensão/MIME falsos.

## 16. Como imagens são armazenadas

`saveUpload` escolhe o driver por `STORAGE_DRIVER`: `local` (disco) ou **`s3`**
(objetos S3-compatível: AWS S3/R2/B2/MinIO/Spaces) — **novo nesta rodada**. A URL
gravada é portátil. Em produção com `s3` sem bucket, a app **não sobe**.

## 17. Como o sistema se comporta sem gateway

`PAYMENT_PROVIDER=mercadopago` sem credenciais → meios online **indisponíveis**
com mensagem clara; `COMBINAR (WhatsApp)` continua funcionando. Em produção com
provider `mercadopago` e credenciais ausentes → **fail fast**.

## 18. Como o sistema se comporta sem banco

O backend não inicia sem `DATABASE_URL` (Prisma). Health/diagnóstico reportam o
estado; nada é gravado em memória como fonte de verdade.

## 19. Como o sistema se comporta sem storage

Sem S3 configurado, o driver local continua sendo o padrão; se o disco for
efêmero, as imagens somem no redeploy (por isso o fail-fast em produção com `s3`
mal configurado). A validação de imagem é independente do driver.

## 20. Como o sistema se comporta sem Web Push

Push já é opcional (JÁ EXISTIA): sem VAPID o recurso fica desabilitado e o app
segue funcionando; as inscrições são idempotentes.

## 21. Como o sistema se comporta sem API de frete

O motor local de frete é preservado e selecionável; retirada na loja também. Sem
provedor externo configurado, a loja continua operando com o motor local/retirada.

## 22. Testes executados

| Comando | Escopo |
| --- | --- |
| `npx prisma validate` | schema |
| `npx tsc --noEmit` | backend (inclui testes) |
| `npx vitest run --config vitest.unit.config.ts` | unitários sem banco |
| `npm run build` | frontend |
| `npm test` | frontend |

## 23. Resultados

- `prisma validate`: **válido**.
- `tsc --noEmit`: **sem erros**.
- Unitários backend: **176/176** (28 arquivos).
- Frontend: **build OK** e **91/91** testes.
- `tests/integration/mercadopago.test.ts`: **escrito e typechecked**, **não
  executado** (sem PostgreSQL/Docker no ambiente).

## 24. Riscos e pendências

- **Credenciais** do Mercado Pago e bucket S3 — **AGUARDANDO CREDENCIAL**.
- **Teste externo real** de PIX/cartão/boleto em sandbox e webhook ponta a ponta —
  **AGUARDANDO TESTE EXTERNO**.
- **Bucket S3** — driver implementado, **não testado contra bucket real**.
- **Boleto** pode não estar habilitado na conta.
- Não há fallback **automático** externo→local no frete: o motor local é um modo
  selecionável (comportamento atual preservado).

## 25. Instruções de configuração

1. **Pagamento:** defina `PAYMENT_PROVIDER=mercadopago`, `PAYMENT_ENV`,
   `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_PUBLIC_KEY`,
   `MERCADOPAGO_WEBHOOK_SECRET`, `PUBLIC_API_URL`; cadastre o webhook
   `POST {PUBLIC_API_URL}/api/payments/webhooks/mercadopago`.
2. **Storage:** defina `STORAGE_DRIVER=s3` + bucket/região/credenciais e
   `STORAGE_PUBLIC_URL`; ou mantenha `local` com disco persistente.
3. **Push:** configure VAPID (ver `docs/DEPLOY.md`).
4. **Frete:** configure Correios/engine ou use o motor local/retirada.
5. **Validação:** `npm run test:unit:fast` (rápido) e `npm test` (com banco).
