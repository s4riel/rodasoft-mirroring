-- HU-VEN-21: returns of a sale. Nothing wrote sale_returns before, so the new NOT NULL columns and the enum swap need no backfill.

-- CreateEnum
CREATE TYPE "SaleReturnStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReturnItemCondition" AS ENUM ('RESTOCK', 'SCRAP');

-- AlterEnum
BEGIN;
CREATE TYPE "RefundMethod_new" AS ENUM ('CASH', 'STORE_CREDIT', 'TRANSFER');
ALTER TABLE "sale_returns" ALTER COLUMN "refund_method" TYPE "RefundMethod_new" USING ("refund_method"::text::"RefundMethod_new");
ALTER TYPE "RefundMethod" RENAME TO "RefundMethod_old";
ALTER TYPE "RefundMethod_new" RENAME TO "RefundMethod";
DROP TYPE "public"."RefundMethod_old";
COMMIT;

-- AlterTable
ALTER TABLE "sale_return_items" ADD COLUMN     "condition" "ReturnItemCondition" NOT NULL,
ADD COLUMN     "refund_amount" DECIMAL(14,2) NOT NULL;

-- AlterTable
ALTER TABLE "sale_returns" DROP COLUMN "credit_note_invoice_id",
ADD COLUMN     "approved_at" TIMESTAMPTZ(3),
ADD COLUMN     "comment" TEXT,
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "reason" TEXT NOT NULL,
ADD COLUMN     "refund_reference" TEXT,
ADD COLUMN     "register_id" UUID,
ADD COLUMN     "shift_id" UUID,
ADD COLUMN     "status" "SaleReturnStatus" NOT NULL DEFAULT 'APPROVED';

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "number" INTEGER,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "total" DECIMAL(14,2) NOT NULL,
    "customer_tax_name" TEXT NOT NULL,
    "customer_document_type" INTEGER NOT NULL,
    "customer_document_number" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_return_id_key" ON "credit_notes"("return_id");

-- CreateIndex
CREATE INDEX "credit_notes_company_id_status_idx" ON "credit_notes"("company_id", "status");

-- CreateIndex
CREATE INDEX "credit_notes_company_id_invoice_id_idx" ON "credit_notes"("company_id", "invoice_id");

-- CreateIndex
CREATE INDEX "sale_return_items_company_id_sale_item_id_idx" ON "sale_return_items"("company_id", "sale_item_id");

-- CreateIndex
CREATE INDEX "sale_returns_company_id_status_created_at_idx" ON "sale_returns"("company_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sale_returns_company_id_idempotency_key_key" ON "sale_returns"("company_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "sale_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- a return moves at least one piece and never gives back a negative amount
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_quantity_ck" CHECK ("quantity" > 0);
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_refund_amount_ck" CHECK ("refund_amount" >= 0);
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_total_ck" CHECK ("total" >= 0);
