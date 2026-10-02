-- =============================================================================
-- MA STORE - Campos de pagamento no pedido Guest (PIX estatico / manual)
-- Migration incremental e IDEMPOTENTE. Nao altera nem apaga dados existentes.
-- =============================================================================

ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "metodo_pagamento" VARCHAR(30);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "pagamento_status" VARCHAR(30) NOT NULL DEFAULT 'Pendente';
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "pagamento_payload" TEXT;
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "pagamento_expira_em" TIMESTAMP;

CREATE INDEX IF NOT EXISTS "idx_pedidos_pagamento_status" ON "pedidos"("pagamento_status");
