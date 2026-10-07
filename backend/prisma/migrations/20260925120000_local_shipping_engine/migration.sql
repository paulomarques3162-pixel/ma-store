-- Shipping Engine PROPRIO — migration ADITIVA (nada existente e removido).
--
-- Nenhum dado comercial (preco, CEP, prazo, transportadora) e cadastrado aqui.
-- A tabela comercial real sera cadastrada pelo administrador no painel.

-- 1) Dados logisticos opcionais no produto (peso ja existia em weightGrams).
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "heightCm" INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "widthCm"  INTEGER;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "lengthCm" INTEGER;

-- 2) Snapshot do frete no pedido (historico preservado mesmo se a regra mudar).
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "frete_zona_id"       VARCHAR(40);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "frete_regra_id"      VARCHAR(40);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "frete_estimado"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "frete_prazo_min_dias" INTEGER;
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "frete_prazo_max_dias" INTEGER;

-- 3) Zonas / faixas de CEP.
CREATE TABLE IF NOT EXISTS "shipping_zones" (
    "id"            TEXT NOT NULL,
    "name"          VARCHAR(120) NOT NULL,
    "description"   VARCHAR(300),
    "zip_code_from" INTEGER NOT NULL,
    "zip_code_to"   INTEGER NOT NULL,
    "active"        BOOLEAN NOT NULL DEFAULT true,
    "priority"      INTEGER NOT NULL DEFAULT 0,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipping_zones_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "shipping_zones_active_idx" ON "shipping_zones"("active");
CREATE INDEX IF NOT EXISTS "shipping_zones_zip_code_from_idx" ON "shipping_zones"("zip_code_from");
CREATE INDEX IF NOT EXISTS "shipping_zones_zip_code_to_idx" ON "shipping_zones"("zip_code_to");
CREATE INDEX IF NOT EXISTS "shipping_zones_active_zip_code_from_zip_code_to_idx" ON "shipping_zones"("active", "zip_code_from", "zip_code_to");

-- 4) Faixas de peso por zona.
CREATE TABLE IF NOT EXISTS "shipping_weight_rules" (
    "id"                           TEXT NOT NULL,
    "zone_id"                      TEXT NOT NULL,
    "min_weight_grams"             INTEGER NOT NULL,
    "max_weight_grams"             INTEGER NOT NULL,
    "price"                        DECIMAL(10,2) NOT NULL,
    "estimated_min_business_days"  INTEGER,
    "estimated_max_business_days"  INTEGER,
    "priority"                     INTEGER NOT NULL DEFAULT 0,
    "active"                       BOOLEAN NOT NULL DEFAULT true,
    "created_at"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipping_weight_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "shipping_weight_rules_zone_id_idx" ON "shipping_weight_rules"("zone_id");
CREATE INDEX IF NOT EXISTS "shipping_weight_rules_active_idx" ON "shipping_weight_rules"("active");
CREATE INDEX IF NOT EXISTS "shipping_weight_rules_zone_id_active_min_weight_grams_max_weight_grams_idx" ON "shipping_weight_rules"("zone_id", "active", "min_weight_grams", "max_weight_grams");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'shipping_weight_rules_zone_id_fkey'
  ) THEN
    ALTER TABLE "shipping_weight_rules"
      ADD CONSTRAINT "shipping_weight_rules_zone_id_fkey"
      FOREIGN KEY ("zone_id") REFERENCES "shipping_zones"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 5) Configuracoes gerais (linha unica: id = 'default').
CREATE TABLE IF NOT EXISTS "shipping_settings" (
    "id"                                TEXT NOT NULL DEFAULT 'default',
    "enabled"                           BOOLEAN NOT NULL DEFAULT false,
    "origin_zip_code"                   VARCHAR(8),
    "package_padding_grams"             INTEGER,
    "default_handling_days"             INTEGER,
    "free_shipping_enabled"             BOOLEAN NOT NULL DEFAULT false,
    "free_shipping_minimum_order_value" DECIMAL(10,2),
    "show_estimate_disclaimer"          BOOLEAN NOT NULL DEFAULT true,
    "config_version"                    INTEGER NOT NULL DEFAULT 1,
    "created_at"                        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipping_settings_pkey" PRIMARY KEY ("id")
);
