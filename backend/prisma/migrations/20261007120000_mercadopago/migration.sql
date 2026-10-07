-- =============================================================================
-- MA STORE - Integracao REAL com Mercado Pago (PIX / cartao / boleto)
-- -----------------------------------------------------------------------------
-- Migration ADITIVA e IDEMPOTENTE. Nao remove colunas, nao apaga dados e nao
-- reseta nada. Segura para rodar em banco Neon com dados de producao.
--
-- Nenhum dado sensivel de cartao e armazenado: guardamos apenas a referencia
-- externa do gateway, o status do provedor e os dados publicos do PIX/boleto.
-- =============================================================================

-- --- pedidos: referencia e status do provedor --------------------------------
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "pagamento_provider" VARCHAR(30);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "pagamento_provider_ref" VARCHAR(120);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "pagamento_provider_status" VARCHAR(40);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "pagamento_metodo_detalhe" VARCHAR(60);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "pagamento_qr_code_base64" TEXT;
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "pagamento_boleto_url" VARCHAR(1000);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "pagamento_boleto_barcode" VARCHAR(120);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "pagamento_idempotency_key" VARCHAR(120);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "pago_em" TIMESTAMP;

-- Idempotencia: a mesma chave de tentativa nunca gera duas cobrancas.
CREATE UNIQUE INDEX IF NOT EXISTS "pedidos_pagamento_idempotency_key_key"
  ON "pedidos"("pagamento_idempotency_key");

-- Correlacao do webhook: localiza o pedido pela referencia externa do gateway.
CREATE INDEX IF NOT EXISTS "pedidos_pagamento_provider_ref_idx"
  ON "pedidos"("pagamento_provider_ref");

-- --- payments: correlacao do webhook no fluxo de pedidos autenticados --------
CREATE INDEX IF NOT EXISTS "payments_provider_ref_idx"
  ON "payments"("providerRef");
