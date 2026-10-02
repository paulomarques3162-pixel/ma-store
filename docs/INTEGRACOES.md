# Integrações — Frete e Pagamentos

**SANDBOX ≠ PRODUÇÃO.** Nada aqui é confirmado sem chamada real ao provedor/transportadora.

## Status em uma tela (ADMIN)
`GET /api/admin/diagnostics/integrations` mostra o que está configurado e o que falta,
sem expor segredos:
- **shipping.correios** — `configured`, `hasToken`, `hasOriginCep`, códigos PAC/SEDEX;
- **shipping.jetlog / pegaki** — `configured`, `hasApi`, `hasFixedValue`;
- **retirada / localDelivery** — ativo, prefixo de CEP e valor;
- **pix** — `enabled`, `configured`, `missing[]`;
- **payment** — provedor, ambiente, sandbox, webhook configurado.

## Correios (PAC/SEDEX) — variáveis
```
CORREIOS_TOKEN=            # obrigatório para cotação real
CORREIOS_ORIGEM_CEP=       # CEP de despacho
CORREIOS_API_URL=https://api.correios.com.br
CORREIOS_PAC_CODE=04510
CORREIOS_SEDEX_CODE=04014
CORREIOS_CONTRATO=
CORREIOS_DR=
```
Sem token/CEP de origem, PAC/SEDEX **não são ofertados** (não inventamos preço/prazo).
O cliente paga direto aos Correios; o valor **não** entra no total da loja.

## Jetlog
```
JETLOG_API_URL= JETLOG_API_TOKEN=      # cotação real, se existir API
JETLOG_VALOR= JETLOG_PRAZO= JETLOG_NOME=  # alternativa: valor fixo configurado
```
Sem nada configurado → não aparece ("não configurado").

## Pegaki
```
PEGAKI_API_URL= PEGAKI_API_TOKEN= PEGAKI_VALOR= PEGAKI_PRAZO= PEGAKI_NOME=
```
Sem configuração explícita → não aparece. Não simulamos integração.

## Retirada + entrega local (Motoboy)
```
RETIRADA_ATIVA=true RETIRADA_NOME= RETIRADA_PRAZO=
FLEX_CEP_PREFIX=1363 FLEX_VALOR=10 FLEX_PRAZO= FLEX_NOME=Motoboy — Pirassununga
```
Retirada = R$ 0,00. Motoboy só aparece para CEP elegível.

## PIX (BR Code estático)
A chave é configurada **no painel Admin → Configurações** (chaves privadas
`payment.pixKey`, `payment.pixHolder`, `payment.pixCity`, `payment.pixEnabled`).
O backend gera o **copia e cola/QR (padrão EMV do Banco Central)** com valor e txid
do pedido. O dinheiro cai direto na conta do recebedor.

> **Confirmação:** o pedido permanece `Aguardando Pagamento` / `Pendente` até a loja
> confirmar o recebimento (app do banco) ou um webhook do banco/provedor. **Abrir o QR
> nunca marca como pago.**
- Preview de teste (ADMIN): `POST /api/admin/diagnostics/pix/preview` (não cria cobrança).

## Cartão / boleto
Exigem um provedor de pagamento real (credenciais `PAYMENT_PROVIDER_*`). Sem provedor,
**não aparecem** no checkout. Nunca armazenamos número de cartão nem CVV.

## Webhooks
`POST /api/payments/webhooks/:provider` valida assinatura HMAC (`WEBHOOK_SECRET`),
usa `WebhookEvent` (`@@unique([provider,eventId])`) para idempotência e só então
atualiza o pagamento. Um POST do cliente não confirma pagamento.

## Como testar de verdade
1. **Frete real:** configure `CORREIOS_TOKEN` + `CORREIOS_ORIGEM_CEP` e faça
   `POST /api/shipping` com um CEP real. Sucesso = PAC/SEDEX com valor/prazo reais.
2. **PIX real:** preencha a chave no Admin e finalize um pedido com PIX; confira o
   copia e cola num app de banco (faça um PIX de valor real se for testar de fato) e
   confirme o recebimento manualmente.
3. **Cartão:** só após configurar um provedor com credenciais reais.
4. **Entrega local/retirada:** teste com CEP `1363x` (motoboy) e sem CEP (retirada).
