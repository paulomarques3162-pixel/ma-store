-- =============================================================================
-- Indices da vitrine / pagamentos (migracao ADITIVA e nao destrutiva)
-- -----------------------------------------------------------------------------
-- Justificativa (consultas reais da loja):
--   * listagem publica sempre filtra `active = true` e ordena por preco,
--     "mais vendidos" ou data;
--   * o filtro "somente em estoque" adiciona `stock > 0`;
--   * as facetas fazem DISTINCT em `volume` de produtos ativos;
--   * o painel lista pedidos por status ordenando por data;
--   * o job de expiracao busca `pagamentoStatus = 'Pendente'` + vencimento.
-- Nenhum dado e alterado: apenas indices (CREATE INDEX IF NOT EXISTS).
-- =============================================================================

CREATE INDEX IF NOT EXISTS "products_active_price_idx"
  ON "products" ("active", "price");

CREATE INDEX IF NOT EXISTS "products_active_soldStock_createdAt_idx"
  ON "products" ("active", "soldStock", "createdAt");

CREATE INDEX IF NOT EXISTS "products_active_volume_idx"
  ON "products" ("active", "volume");

CREATE INDEX IF NOT EXISTS "products_active_stock_idx"
  ON "products" ("active", "stock");

CREATE INDEX IF NOT EXISTS "pedidos_statusAtual_criadoEm_idx"
  ON "pedidos" ("statusAtual", "criadoEm");

CREATE INDEX IF NOT EXISTS "pedidos_pagamentoStatus_pagamentoExpiraEm_idx"
  ON "pedidos" ("pagamentoStatus", "pagamentoExpiraEm");
