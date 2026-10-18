-- Juros e encargos configuráveis pelo administrador (por produto + padrão).
-- Migração ADITIVA e não destrutiva: cria uma tabela nova e adiciona colunas
-- anuláveis em `pedidos`. Nenhum dado existente é alterado ou removido.

-- CreateTable
CREATE TABLE "interest_rules" (
    "id" TEXT NOT NULL,
    "product_id" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "type" VARCHAR(30) NOT NULL DEFAULT 'PERCENT_MONTHLY',
    "rate" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "payer" VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER',
    "max_installments" INTEGER NOT NULL DEFAULT 1,
    "min_installment_value" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "interest_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "interest_rules_product_id_key" ON "interest_rules"("product_id");

-- AddForeignKey
ALTER TABLE "interest_rules" ADD CONSTRAINT "interest_rules_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: snapshot imutável dos juros aplicados no pedido
ALTER TABLE "pedidos" ADD COLUMN "juros_total" DECIMAL(10,2);
ALTER TABLE "pedidos" ADD COLUMN "parcelas" INTEGER;
ALTER TABLE "pedidos" ADD COLUMN "juros_detalhe" JSONB;
