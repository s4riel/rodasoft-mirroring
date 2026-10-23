-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE_RECEIPT', 'SALE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'INITIAL', 'RETURN');

-- DropForeignKey
ALTER TABLE "stock_thresholds" DROP CONSTRAINT "stock_thresholds_branch_id_fkey";

-- DropIndex
DROP INDEX "stock_thresholds_company_id_branch_id_idx";

-- DropIndex
DROP INDEX "stock_thresholds_product_id_branch_id_key";

-- AlterTable: thresholds move from branch to warehouse. Each branch's thresholds land on its main warehouse
-- (the first one by code when none is main); rows of a branch without warehouses are dropped.
ALTER TABLE "stock_thresholds" ADD COLUMN "warehouse_id" UUID;

UPDATE "stock_thresholds" st
SET "warehouse_id" = (
    SELECT w."id" FROM "warehouses" w
    WHERE w."branch_id" = st."branch_id"
    ORDER BY w."is_main" DESC, w."code" ASC
    LIMIT 1
);

DELETE FROM "stock_thresholds" WHERE "warehouse_id" IS NULL;

ALTER TABLE "stock_thresholds" ALTER COLUMN "warehouse_id" SET NOT NULL;
ALTER TABLE "stock_thresholds" DROP COLUMN "branch_id";

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "unit_cost" DECIMAL(14,4),
    "reason" TEXT,
    "ref_type" TEXT,
    "ref_id" UUID,
    "ref_number" TEXT,
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_movements_company_id_product_id_created_at_idx" ON "stock_movements"("company_id", "product_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "stock_movements_company_id_warehouse_id_product_id_created__idx" ON "stock_movements"("company_id", "warehouse_id", "product_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_thresholds_company_id_warehouse_id_idx" ON "stock_thresholds"("company_id", "warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_thresholds_product_id_warehouse_id_key" ON "stock_thresholds"("product_id", "warehouse_id");

-- AddForeignKey
ALTER TABLE "stock_thresholds" ADD CONSTRAINT "stock_thresholds_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Immutable history (design-notes rule 3): corrections are new movements, never edits or deletes
CREATE OR REPLACE FUNCTION "stock_movements_reject_change"() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'stock_movements is immutable: corrections are new movements';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "stock_movements_immutable"
BEFORE UPDATE OR DELETE ON "stock_movements"
FOR EACH ROW EXECUTE FUNCTION "stock_movements_reject_change"();
