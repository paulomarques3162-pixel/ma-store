-- Shipping Engine v2 — cotacao multi-modalidade, excecoes de CEP e snapshot.
-- Migration ADITIVA: nenhum dado existente e removido e nenhuma migration
-- antiga e alterada. O motor v1 continua funcionando com os campos anteriores.

-- 1) Configuracoes: prazo padrao.
ALTER TABLE "shipping_settings" ADD COLUMN IF NOT EXISTS "default_delivery_days" INTEGER;

-- 2) Zonas: UF (informativa).
ALTER TABLE "shipping_zones" ADD COLUMN IF NOT EXISTS "state" VARCHAR(2);

-- 3) Modalidades: codigo estavel + prioridade do motor proprio.
ALTER TABLE "shipping_methods" ADD COLUMN IF NOT EXISTS "code" VARCHAR(40);
ALTER TABLE "shipping_methods" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "shipping_methods_code_key" ON "shipping_methods"("code");
CREATE INDEX IF NOT EXISTS "shipping_methods_active_priority_idx" ON "shipping_methods"("active", "priority");

-- 4) Regras de peso: vinculo com a modalidade + prazo unico.
ALTER TABLE "shipping_weight_rules" ADD COLUMN IF NOT EXISTS "shipping_method_id" TEXT;
ALTER TABLE "shipping_weight_rules" ADD COLUMN IF NOT EXISTS "delivery_days" INTEGER;
CREATE INDEX IF NOT EXISTS "shipping_weight_rules_shipping_method_id_idx" ON "shipping_weight_rules"("shipping_method_id");
CREATE INDEX IF NOT EXISTS "shipping_weight_rules_zone_method_active_idx" ON "shipping_weight_rules"("zone_id", "shipping_method_id", "active");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipping_weight_rules_shipping_method_id_fkey') THEN
    ALTER TABLE "shipping_weight_rules"
      ADD CONSTRAINT "shipping_weight_rules_shipping_method_id_fkey"
      FOREIGN KEY ("shipping_method_id") REFERENCES "shipping_methods"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 5) Excecoes de CEP por modalidade.
CREATE TABLE IF NOT EXISTS "shipping_cep_exceptions" (
    "id"                    TEXT NOT NULL,
    "cep"                   VARCHAR(8) NOT NULL,
    "shipping_method_id"    TEXT NOT NULL,
    "price_override"        DECIMAL(10,2),
    "delivery_days_override" INTEGER,
    "active"                BOOLEAN NOT NULL DEFAULT true,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipping_cep_exceptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "shipping_cep_exceptions_cep_shipping_method_id_key" ON "shipping_cep_exceptions"("cep", "shipping_method_id");
CREATE INDEX IF NOT EXISTS "shipping_cep_exceptions_cep_idx" ON "shipping_cep_exceptions"("cep");
CREATE INDEX IF NOT EXISTS "shipping_cep_exceptions_active_idx" ON "shipping_cep_exceptions"("active");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipping_cep_exceptions_shipping_method_id_fkey') THEN
    ALTER TABLE "shipping_cep_exceptions"
      ADD CONSTRAINT "shipping_cep_exceptions_shipping_method_id_fkey"
      FOREIGN KEY ("shipping_method_id") REFERENCES "shipping_methods"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 6) Cotacoes persistidas (seguranca: o pedido usa o preco gravado aqui).
CREATE TABLE IF NOT EXISTS "shipping_quotes" (
    "id"                 TEXT NOT NULL,
    "session_id"         VARCHAR(120),
    "cep"                VARCHAR(8) NOT NULL,
    "subtotal"           DECIMAL(10,2) NOT NULL,
    "total_weight_grams" INTEGER NOT NULL,
    "zone_id"            TEXT,
    "expires_at"         TIMESTAMP(3) NOT NULL,
    "used_at"            TIMESTAMP(3),
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipping_quotes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "shipping_quotes_expires_at_idx" ON "shipping_quotes"("expires_at");
CREATE INDEX IF NOT EXISTS "shipping_quotes_session_id_idx" ON "shipping_quotes"("session_id");

CREATE TABLE IF NOT EXISTS "shipping_quote_options" (
    "id"                 TEXT NOT NULL,
    "quote_id"           TEXT NOT NULL,
    "shipping_method_id" TEXT NOT NULL,
    "code"               VARCHAR(40),
    "name"               VARCHAR(160) NOT NULL,
    "description"        VARCHAR(300),
    "price"              DECIMAL(10,2) NOT NULL,
    "delivery_days"      INTEGER,
    "zone_id"            TEXT,
    "rule_id"            TEXT,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipping_quote_options_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "shipping_quote_options_quote_id_idx" ON "shipping_quote_options"("quote_id");
CREATE INDEX IF NOT EXISTS "shipping_quote_options_shipping_method_id_idx" ON "shipping_quote_options"("shipping_method_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'shipping_quote_options_quote_id_fkey') THEN
    ALTER TABLE "shipping_quote_options"
      ADD CONSTRAINT "shipping_quote_options_quote_id_fkey"
      FOREIGN KEY ("quote_id") REFERENCES "shipping_quotes"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 7) Snapshot do frete no pedido guest.
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "frete_metodo_id" VARCHAR(40);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "frete_metodo_codigo" VARCHAR(40);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "frete_quote_id" VARCHAR(40);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "frete_prazo_dias" INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS "pedidos_frete_quote_id_key" ON "pedidos"("frete_quote_id");
