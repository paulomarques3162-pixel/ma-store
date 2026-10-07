-- Push notifications (Web Push) — migration ADITIVA.
-- Cria APENAS uma tabela nova. Nenhum dado existente é lido, alterado ou removido.
-- Idempotente: pode ser reaplicada sem erro caso já exista.

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id"         TEXT NOT NULL,
  "endpoint"   TEXT NOT NULL,
  "p256dh"     TEXT NOT NULL,
  "auth"       TEXT NOT NULL,
  "userAgent"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key"
  ON "push_subscriptions"("endpoint");
