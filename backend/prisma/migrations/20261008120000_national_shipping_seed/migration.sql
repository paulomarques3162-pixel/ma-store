-- Tabela nacional de frete pre-cadastrada — migration ADITIVA.
--
-- Nenhuma migration antiga e alterada e nenhum dado existente e removido.
-- As colunas abaixo apenas marcam quais zonas/faixas vieram da tabela inicial
-- (`seed_key`) e se o CEP de origem ainda e provisorio. O conteudo comercial e
-- inserido pelo instalador idempotente em `src/shipping-local/bootstrap`.

-- 1) Zonas: marcador da tabela inicial (NULL = zona do administrador).
ALTER TABLE "shipping_zones" ADD COLUMN IF NOT EXISTS "seed_key" VARCHAR(80);
CREATE UNIQUE INDEX IF NOT EXISTS "shipping_zones_seed_key_key" ON "shipping_zones"("seed_key");

-- 2) Faixas de peso: marcador da tabela inicial (NULL = faixa do administrador).
ALTER TABLE "shipping_weight_rules" ADD COLUMN IF NOT EXISTS "seed_key" VARCHAR(120);
CREATE UNIQUE INDEX IF NOT EXISTS "shipping_weight_rules_seed_key_key" ON "shipping_weight_rules"("seed_key");

-- 3) Configuracoes: CEP de origem provisorio (tabela inicial, ainda nao confirmado).
ALTER TABLE "shipping_settings"
  ADD COLUMN IF NOT EXISTS "origin_zip_code_provisional" BOOLEAN NOT NULL DEFAULT false;
