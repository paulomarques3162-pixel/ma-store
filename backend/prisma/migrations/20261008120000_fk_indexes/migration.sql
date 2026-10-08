-- =============================================================================
-- MA STORE - Indices para chaves estrangeiras usadas em consultas frequentes
-- -----------------------------------------------------------------------------
-- Migration ADITIVA e IDEMPOTENTE. Apenas cria indices (CREATE INDEX IF NOT
-- EXISTS). Nao altera colunas, nao remove dados e nao recria tabelas.
--
-- Motivacao: no PostgreSQL o Prisma NAO cria indice automatico para o campo
-- escalar de uma relacao. Consultas por produto (mais vendidos), por pedido
-- (avaliacoes/feedbacks) e por usuario (cupons/favoritos) ficavam com scan
-- sequencial conforme as tabelas crescem.
-- =============================================================================

CREATE INDEX IF NOT EXISTS "order_items_productId_idx" ON "order_items"("productId");
CREATE INDEX IF NOT EXISTS "favorites_productId_idx" ON "favorites"("productId");
CREATE INDEX IF NOT EXISTS "cart_items_productId_idx" ON "cart_items"("productId");
CREATE INDEX IF NOT EXISTS "coupon_usages_userId_idx" ON "coupon_usages"("userId");
CREATE INDEX IF NOT EXISTS "conversations_orderId_idx" ON "conversations"("orderId");
CREATE INDEX IF NOT EXISTS "reviews_userId_idx" ON "reviews"("userId");
CREATE INDEX IF NOT EXISTS "reviews_orderId_idx" ON "reviews"("orderId");
CREATE INDEX IF NOT EXISTS "feedbacks_userId_idx" ON "feedbacks"("userId");
CREATE INDEX IF NOT EXISTS "feedbacks_orderId_idx" ON "feedbacks"("orderId");
