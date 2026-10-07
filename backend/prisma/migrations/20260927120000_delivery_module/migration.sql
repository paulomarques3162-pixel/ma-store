-- Modulo de entrega / motoboy — migration ADITIVA.
-- Nenhum dado existente e removido e nenhuma migration antiga e alterada.

-- 1) Novo papel DELIVERY_PERSON.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DELIVERY_PERSON';

-- 2) Enums do modulo de entrega.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeliveryStatus') THEN
    CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeliveryFailureReason') THEN
    CREATE TYPE "DeliveryFailureReason" AS ENUM (
      'CLIENTE_AUSENTE', 'ENDERECO_NAO_LOCALIZADO', 'RECUSA_DO_RECEBEDOR',
      'AREA_INACESSIVEL', 'PROBLEMA_DE_ACESSO', 'OUTRO'
    );
  END IF;
END $$;

-- 3) Entregas (1:1 com pedidos).
CREATE TABLE IF NOT EXISTS "deliveries" (
    "id"                       TEXT NOT NULL,
    "pedido_id"                INTEGER NOT NULL,
    "driver_id"                TEXT,
    "status"                   "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "assigned_at"              TIMESTAMP(3),
    "started_at"               TIMESTAMP(3),
    "delivered_at"             TIMESTAMP(3),
    "recipient_name"           VARCHAR(160),
    "recipient_document_last4" VARCHAR(4),
    "proof_photo_url"          VARCHAR(500),
    "latitude"                 DECIMAL(10,7),
    "longitude"                DECIMAL(10,7),
    "location_accuracy"        DECIMAL(10,2),
    "notes"                    VARCHAR(500),
    "failure_reason"           "DeliveryFailureReason",
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "deliveries_pedido_id_key" ON "deliveries"("pedido_id");
CREATE INDEX IF NOT EXISTS "deliveries_driver_id_status_idx" ON "deliveries"("driver_id", "status");
CREATE INDEX IF NOT EXISTS "deliveries_status_idx" ON "deliveries"("status");
CREATE INDEX IF NOT EXISTS "deliveries_created_at_idx" ON "deliveries"("created_at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deliveries_pedido_id_fkey') THEN
    ALTER TABLE "deliveries"
      ADD CONSTRAINT "deliveries_pedido_id_fkey"
      FOREIGN KEY ("pedido_id") REFERENCES "pedidos"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deliveries_driver_id_fkey') THEN
    ALTER TABLE "deliveries"
      ADD CONSTRAINT "deliveries_driver_id_fkey"
      FOREIGN KEY ("driver_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- 4) Historico de eventos da entrega.
CREATE TABLE IF NOT EXISTS "delivery_events" (
    "id"                TEXT NOT NULL,
    "delivery_id"       TEXT NOT NULL,
    "status"            "DeliveryStatus" NOT NULL,
    "latitude"          DECIMAL(10,7),
    "longitude"         DECIMAL(10,7),
    "location_accuracy" DECIMAL(10,2),
    "notes"             VARCHAR(500),
    "failure_reason"    "DeliveryFailureReason",
    "created_by"        TEXT,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "delivery_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "delivery_events_delivery_id_idx" ON "delivery_events"("delivery_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_events_delivery_id_fkey') THEN
    ALTER TABLE "delivery_events"
      ADD CONSTRAINT "delivery_events_delivery_id_fkey"
      FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
