-- CreateEnum
CREATE TYPE "StockAdjustmentStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "StockAdjustmentSource" AS ENUM ('MANUAL', 'TRANSFER');

-- CreateEnum
CREATE TYPE "StockAdjustmentItemKind" AS ENUM ('SHORTAGE', 'SURPLUS', 'MANUAL');

-- AlterTable
ALTER TABLE "transfer_items" ADD COLUMN     "surplus_quantity" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "transfers" ADD COLUMN     "received_at" TIMESTAMPTZ(3),
ADD COLUMN     "received_by_id" UUID;

-- CreateTable
CREATE TABLE "transfer_receipts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "received_by_id" UUID,
    "note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_receipt_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "transfer_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "transfer_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "StockAdjustmentStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "source" "StockAdjustmentSource" NOT NULL,
    "transfer_id" UUID,
    "warehouse_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "total_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_adjustment_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "adjustment_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "kind" "StockAdjustmentItemKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(14,4),

    CONSTRAINT "stock_adjustment_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transfer_receipts_company_id_transfer_id_idx" ON "transfer_receipts"("company_id", "transfer_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_receipt_items_receipt_id_transfer_item_id_key" ON "transfer_receipt_items"("receipt_id", "transfer_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_transfer_id_key" ON "stock_adjustments"("transfer_id");

-- CreateIndex
CREATE INDEX "stock_adjustments_company_id_status_created_at_idx" ON "stock_adjustments"("company_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustments_company_id_number_key" ON "stock_adjustments"("company_id", "number");

-- CreateIndex
CREATE INDEX "stock_adjustment_items_company_id_product_id_idx" ON "stock_adjustment_items"("company_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_adjustment_items_adjustment_id_product_id_key" ON "stock_adjustment_items"("adjustment_id", "product_id");

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipts" ADD CONSTRAINT "transfer_receipts_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipt_items" ADD CONSTRAINT "transfer_receipt_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipt_items" ADD CONSTRAINT "transfer_receipt_items_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "transfer_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_receipt_items" ADD CONSTRAINT "transfer_receipt_items_transfer_item_id_fkey" FOREIGN KEY ("transfer_item_id") REFERENCES "transfer_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_adjustment_id_fkey" FOREIGN KEY ("adjustment_id") REFERENCES "stock_adjustments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_adjustment_items" ADD CONSTRAINT "stock_adjustment_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
