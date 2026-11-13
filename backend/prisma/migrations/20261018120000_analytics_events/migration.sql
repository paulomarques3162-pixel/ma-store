-- Métricas de audiência (eventos anônimos e minimizados).
-- Migração ADITIVA e não destrutiva: cria uma tabela nova. Nenhum dado é
-- alterado ou removido. Sem IP e sem dados pessoais.
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "event_id" VARCHAR(64),
    "type" VARCHAR(40) NOT NULL,
    "path" VARCHAR(300),
    "product_id" VARCHAR(40),
    "session_id" VARCHAR(64),
    "device_type" VARCHAR(20),
    "referrer" VARCHAR(200),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "analytics_events_event_id_key" ON "analytics_events"("event_id");
CREATE INDEX "analytics_events_type_created_at_idx" ON "analytics_events"("type", "created_at");
CREATE INDEX "analytics_events_created_at_idx" ON "analytics_events"("created_at");
CREATE INDEX "analytics_events_product_id_idx" ON "analytics_events"("product_id");
CREATE INDEX "analytics_events_session_id_idx" ON "analytics_events"("session_id");
