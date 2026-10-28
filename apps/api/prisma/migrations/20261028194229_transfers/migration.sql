-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "origin_warehouse_id" UUID NOT NULL,
    "destination_warehouse_id" UUID NOT NULL,
    "note" VARCHAR(500),
    "total_pieces" INTEGER NOT NULL DEFAULT 0,
    "total_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "sent_by_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_items" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "received_quantity" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(14,4),

    CONSTRAINT "transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transfers_company_id_status_created_at_idx" ON "transfers"("company_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "transfers_company_id_origin_warehouse_id_idx" ON "transfers"("company_id", "origin_warehouse_id");

-- CreateIndex
CREATE INDEX "transfers_company_id_destination_warehouse_id_idx" ON "transfers"("company_id", "destination_warehouse_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfers_company_id_number_key" ON "transfers"("company_id", "number");

-- CreateIndex
CREATE INDEX "transfer_items_company_id_product_id_idx" ON "transfer_items"("company_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "transfer_items_transfer_id_product_id_key" ON "transfer_items"("transfer_id", "product_id");

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_origin_warehouse_id_fkey" FOREIGN KEY ("origin_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_destination_warehouse_id_fkey" FOREIGN KEY ("destination_warehouse_id") REFERENCES "warehouses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_items" ADD CONSTRAINT "transfer_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
