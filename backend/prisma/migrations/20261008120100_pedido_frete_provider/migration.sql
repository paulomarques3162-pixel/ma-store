-- =============================================================================
-- MA STORE - Snapshot de transportadora/servico no pedido Guest
-- -----------------------------------------------------------------------------
-- Migration ADITIVA e IDEMPOTENTE. Preserva o historico: o pedido passa a
-- guardar QUAL transportadora/provedor e QUAL servico foram escolhidos, alem do
-- nome/valor/prazo que ja existiam.
--
-- Nao altera valores historicos e nao remove dados.
-- =============================================================================

ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "frete_transportadora" VARCHAR(120);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "frete_servico" VARCHAR(160);
