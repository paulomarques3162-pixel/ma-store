-- =============================================================================
-- Indices de performance (regra #36 / #75 do projeto)
-- -----------------------------------------------------------------------------
-- A busca da vitrine usa ILIKE (contains + mode insensitive) em nome, SKU e
-- descricao curta. Sem indice, isso vira um full scan conforme o catalogo
-- cresce. pg_trgm + GIN resolve isso com busca por similaridade de trigramas.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Busca de produtos por nome / SKU / descricao
CREATE INDEX IF NOT EXISTS "products_name_trgm_idx"
  ON "products" USING gin ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_sku_trgm_idx"
  ON "products" USING gin ("sku" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_short_description_trgm_idx"
  ON "products" USING gin ("shortDescription" gin_trgm_ops);

-- Filtros combinados da vitrine (categoria + ativo + ordenacao por data)
CREATE INDEX IF NOT EXISTS "products_category_active_created_idx"
  ON "products" ("categoryId", "active", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "products_brand_active_created_idx"
  ON "products" ("brandId", "active", "createdAt" DESC);

-- Vitrine de ofertas (produtos com preco comparativo real)
CREATE INDEX IF NOT EXISTS "products_on_sale_idx"
  ON "products" ("active", "comparePrice")
  WHERE "comparePrice" IS NOT NULL;

-- Consultas administrativas
CREATE INDEX IF NOT EXISTS "orders_status_created_idx"
  ON "orders" ("status", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "orders_user_created_idx"
  ON "orders" ("userId", "createdAt" DESC);

-- Central de mensagens: conversas por ultima mensagem
CREATE INDEX IF NOT EXISTS "conversations_last_message_idx"
  ON "conversations" ("lastMessageAt" DESC);

CREATE INDEX IF NOT EXISTS "messages_conversation_created_idx"
  ON "messages" ("conversationId", "createdAt" ASC);

-- Auditoria e laboratorio
CREATE INDEX IF NOT EXISTS "admin_audit_logs_entity_created_idx"
  ON "admin_audit_logs" ("entity", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "test_results_run_status_idx"
  ON "test_results" ("runId", "status");

-- Sessoes ativas
CREATE INDEX IF NOT EXISTS "sessions_user_expires_idx"
  ON "sessions" ("userId", "expiresAt");

-- Busca de usuarios no painel
CREATE INDEX IF NOT EXISTS "users_name_trgm_idx"
  ON "users" USING gin ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "users_email_trgm_idx"
  ON "users" USING gin ("email" gin_trgm_ops);

-- Notificacoes nao lidas (badge)
CREATE INDEX IF NOT EXISTS "notifications_unread_idx"
  ON "notifications" ("userId")
  WHERE "readAt" IS NULL;

-- Estoque baixo (dashboard)
CREATE INDEX IF NOT EXISTS "products_low_stock_idx"
  ON "products" ("stock")
  WHERE "active" = true AND "minStock" > 0;
