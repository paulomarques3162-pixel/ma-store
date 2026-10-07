-- =============================================================================
-- MA STORE - Enquadramento (focal point) das imagens de produto
-- Migration incremental e IDEMPOTENTE: nao remove nem altera dados existentes.
-- =============================================================================

ALTER TABLE "product_images"
  ADD COLUMN IF NOT EXISTS "focal_point" VARCHAR(30) NOT NULL DEFAULT 'center';
