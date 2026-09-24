-- Shipping Engine — configuração multi-loja (ADITIVA).
-- Nenhuma tabela/coluna existente é alterada ou removida.
-- Segredos NÃO são armazenados aqui: credenciais vêm de env/secret manager.

CREATE TABLE IF NOT EXISTS "store_shipping_configs" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "origin_postal_code" TEXT,
    "enabled_providers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled_services" JSONB,
    "pricing" JSONB,
    "free_shipping" JSONB,
    "declared_value_enabled" BOOLEAN NOT NULL DEFAULT true,
    "presentation_order" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "store_shipping_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "store_shipping_configs_store_id_key" ON "store_shipping_configs"("store_id");

CREATE TABLE IF NOT EXISTS "shipping_provider_configs" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipping_provider_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "shipping_provider_configs_store_id_provider_key" ON "shipping_provider_configs"("store_id", "provider");
CREATE INDEX IF NOT EXISTS "shipping_provider_configs_store_id_idx" ON "shipping_provider_configs"("store_id");

CREATE TABLE IF NOT EXISTS "shipping_rules" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipping_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "shipping_rules_store_id_active_idx" ON "shipping_rules"("store_id", "active");

CREATE TABLE IF NOT EXISTS "shipping_quote_cache" (
    "id" TEXT NOT NULL,
    "cache_key" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipping_quote_cache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "shipping_quote_cache_cache_key_key" ON "shipping_quote_cache"("cache_key");
CREATE INDEX IF NOT EXISTS "shipping_quote_cache_expires_at_idx" ON "shipping_quote_cache"("expires_at");
