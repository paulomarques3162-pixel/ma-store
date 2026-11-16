-- Recuperador de imagens: estado, historico e fila persistente.
-- Apenas ADITIVO: nenhuma coluna/registro existente e removido ou reescrito.

-- CreateEnum
CREATE TYPE "ImageRecoveryStatus" AS ENUM (
  'PENDING', 'AVAILABLE', 'RECOVERABLE', 'REDIRECT', 'INVALID_URL', 'NOT_FOUND',
  'SERVER_UNAVAILABLE', 'INVALID_CONTENT', 'ACCESS_BLOCKED', 'CONNECTION_ERROR',
  'PENDING_CONFIRMATION', 'RECOVERED', 'CLOUDINARY', 'UNAVAILABLE'
);
CREATE TYPE "ImageAssetType" AS ENUM ('PRODUCT_IMAGE', 'BANNER', 'CATEGORY', 'BRAND');
CREATE TYPE "ImageRecoveryResult" AS ENUM (
  'AVAILABLE', 'RECOVERABLE', 'REDIRECT', 'INVALID_URL', 'NOT_FOUND',
  'SERVER_UNAVAILABLE', 'INVALID_CONTENT', 'ACCESS_BLOCKED', 'CONNECTION_ERROR',
  'RECOVERED', 'FAILED', 'CONFIRMED', 'KEPT_ORIGINAL'
);
CREATE TYPE "ImageRecoveryJobStatus" AS ENUM ('PENDING', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELED');
CREATE TYPE "ImageRecoveryJobItemStatus" AS ENUM ('PENDING', 'PROCESSING', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'RECOVERED', 'SKIPPED', 'FAILED');

-- AlterTable: rastreabilidade na tabela de imagens de produto (aditivo).
ALTER TABLE "product_images"
  ADD COLUMN "original_url" TEXT,
  ADD COLUMN "storage_provider" VARCHAR(30),
  ADD COLUMN "public_id" VARCHAR(300),
  ADD COLUMN "format" VARCHAR(20),
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER,
  ADD COLUMN "size_bytes" INTEGER,
  ADD COLUMN "recovery_status" "ImageRecoveryStatus",
  ADD COLUMN "recovery_checked_at" TIMESTAMP(3);

CREATE INDEX "product_images_recovery_status_idx" ON "product_images"("recovery_status");

-- CreateTable
CREATE TABLE "image_recovery_assets" (
  "id" TEXT NOT NULL,
  "asset_type" "ImageAssetType" NOT NULL,
  "asset_id" TEXT NOT NULL,
  "product_id" TEXT,
  "label" VARCHAR(200) NOT NULL,
  "field" VARCHAR(30) NOT NULL DEFAULT 'url',
  "current_url" TEXT NOT NULL,
  "original_url" TEXT,
  "status" "ImageRecoveryStatus" NOT NULL DEFAULT 'PENDING',
  "http_status" INTEGER,
  "content_type" VARCHAR(160),
  "format" VARCHAR(20),
  "width" INTEGER,
  "height" INTEGER,
  "size_bytes" INTEGER,
  "final_url" TEXT,
  "redirected" BOOLEAN NOT NULL DEFAULT false,
  "new_url" TEXT,
  "public_id" VARCHAR(300),
  "storage_provider" VARCHAR(30),
  "failure_reason" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_checked_at" TIMESTAMP(3),
  "next_check_at" TIMESTAMP(3),
  "recovered_at" TIMESTAMP(3),
  "last_admin_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "image_recovery_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "image_recovery_assets_asset_type_asset_id_field_key"
  ON "image_recovery_assets"("asset_type", "asset_id", "field");
CREATE INDEX "image_recovery_assets_status_idx" ON "image_recovery_assets"("status");
CREATE INDEX "image_recovery_assets_product_id_idx" ON "image_recovery_assets"("product_id");
CREATE INDEX "image_recovery_assets_asset_type_idx" ON "image_recovery_assets"("asset_type");
CREATE INDEX "image_recovery_assets_current_url_idx" ON "image_recovery_assets"("current_url");

CREATE TABLE "image_recovery_logs" (
  "id" TEXT NOT NULL,
  "asset_type" "ImageAssetType" NOT NULL,
  "asset_id" TEXT NOT NULL,
  "product_id" TEXT,
  "product_name" VARCHAR(200),
  "original_url" TEXT NOT NULL,
  "new_url" TEXT,
  "result" "ImageRecoveryResult" NOT NULL,
  "reason" TEXT,
  "admin_id" TEXT,
  "job_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "image_recovery_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "image_recovery_logs_created_at_idx" ON "image_recovery_logs"("created_at");
CREATE INDEX "image_recovery_logs_asset_id_idx" ON "image_recovery_logs"("asset_id");
CREATE INDEX "image_recovery_logs_result_idx" ON "image_recovery_logs"("result");

CREATE TABLE "image_recovery_jobs" (
  "id" TEXT NOT NULL,
  "status" "ImageRecoveryJobStatus" NOT NULL DEFAULT 'PENDING',
  "filter" VARCHAR(40),
  "search" VARCHAR(120),
  "concurrency" INTEGER NOT NULL DEFAULT 3,
  "auto_confirm" BOOLEAN NOT NULL DEFAULT false,
  "total" INTEGER NOT NULL DEFAULT 0,
  "processed" INTEGER NOT NULL DEFAULT 0,
  "succeeded" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "admin_id" TEXT,
  "error" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "heartbeat_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "image_recovery_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "image_recovery_jobs_status_created_at_idx" ON "image_recovery_jobs"("status", "created_at");

CREATE TABLE "image_recovery_job_items" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "asset_id" TEXT,
  "label" VARCHAR(200) NOT NULL,
  "original_url" TEXT NOT NULL,
  "status" "ImageRecoveryJobItemStatus" NOT NULL DEFAULT 'PENDING',
  "result" VARCHAR(40),
  "message" TEXT,
  "new_url" TEXT,
  "public_id" VARCHAR(300),
  "processed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "image_recovery_job_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "image_recovery_job_items_job_id_asset_id_key"
  ON "image_recovery_job_items"("job_id", "asset_id");
CREATE INDEX "image_recovery_job_items_job_id_status_idx"
  ON "image_recovery_job_items"("job_id", "status");

ALTER TABLE "image_recovery_job_items"
  ADD CONSTRAINT "image_recovery_job_items_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "image_recovery_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
