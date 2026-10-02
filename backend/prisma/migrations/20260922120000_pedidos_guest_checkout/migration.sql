-- =============================================================================
-- MA STORE - Guest Checkout: tabela `pedidos`
-- -----------------------------------------------------------------------------
-- Migration SEGURA e IDEMPOTENTE:
--   * nao derruba nem apaga dados existentes;
--   * cria a tabela apenas se nao existir;
--   * adiciona colunas ausentes (ALTER TABLE ... IF NOT EXISTS);
--   * recria indices de forma idempotente.
-- Compatibilidade: PostgreSQL 14+ (Neon).
-- =============================================================================

CREATE TABLE IF NOT EXISTS "pedidos" (
    "id" SERIAL PRIMARY KEY,
    "token_rastreio_unico" VARCHAR(255) NOT NULL UNIQUE,
    "cliente_nome" VARCHAR(255) NOT NULL,
    "cliente_whatsapp" VARCHAR(50) NOT NULL,
    "cliente_email" VARCHAR(255),
    "endereco_completo" JSONB NOT NULL,
    "produtos_carrinho" JSONB NOT NULL,
    "frete_escolhido_nome" VARCHAR(255),
    "frete_escolhido_valor" NUMERIC(10,2),
    "frete_escolhido_prazo" VARCHAR(255),
    "status_atual" VARCHAR(100) NOT NULL DEFAULT 'Aguardando Pagamento',
    "recebido_por" VARCHAR(255),
    "data_entrega" TIMESTAMP,
    "criado_em" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Colunas ausentes em bases que ja possuam uma tabela `pedidos` parcial.
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "token_rastreio_unico" VARCHAR(255);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "cliente_nome" VARCHAR(255);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "cliente_whatsapp" VARCHAR(50);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "cliente_email" VARCHAR(255);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "endereco_completo" JSONB;
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "produtos_carrinho" JSONB;
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "frete_escolhido_nome" VARCHAR(255);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "frete_escolhido_valor" NUMERIC(10,2);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "frete_escolhido_prazo" VARCHAR(255);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "frete_pago_direto" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "status_atual" VARCHAR(100) NOT NULL DEFAULT 'Aguardando Pagamento';
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "recebido_por" VARCHAR(255);
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "data_entrega" TIMESTAMP;
ALTER TABLE "pedidos" ADD COLUMN IF NOT EXISTS "criado_em" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "idx_pedidos_token_rastreio"
    ON "pedidos"("token_rastreio_unico");

CREATE INDEX IF NOT EXISTS "idx_pedidos_status"
    ON "pedidos"("status_atual");

CREATE INDEX IF NOT EXISTS "idx_pedidos_criado_em"
    ON "pedidos"("criado_em");
