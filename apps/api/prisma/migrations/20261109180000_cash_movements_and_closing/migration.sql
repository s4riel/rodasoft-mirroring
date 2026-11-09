-- HU-VEN-22 and HU-VEN-23: cash movements with a concept, status and receipt; the closing of a shift with its count and the
-- declared QR, card and transfer totals. Existing movements stay POSTED, so the expected cash of old shifts does not change.

-- CreateEnum
CREATE TYPE "CashMovementStatus" AS ENUM ('PENDING', 'POSTED', 'REJECTED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "ApprovalType" ADD VALUE 'CASH_EXPENSE';

-- AlterTable
ALTER TABLE "cash_movements" ADD COLUMN     "concept" TEXT,
ADD COLUMN     "idempotency_key" TEXT,
ADD COLUMN     "receipt_key" TEXT,
ADD COLUMN     "status" "CashMovementStatus" NOT NULL DEFAULT 'POSTED';

-- AlterTable
ALTER TABLE "cash_shifts" ADD COLUMN     "closing_comment" TEXT;

-- CreateTable
CREATE TABLE "cash_shift_method_totals" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "system_amount" DECIMAL(14,2) NOT NULL,
    "declared_amount" DECIMAL(14,2) NOT NULL,
    "difference_amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "cash_shift_method_totals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_shift_method_totals_company_id_idx" ON "cash_shift_method_totals"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_shift_method_totals_shift_id_method_key" ON "cash_shift_method_totals"("shift_id", "method");

-- CreateIndex
CREATE INDEX "cash_movements_company_id_shift_id_status_idx" ON "cash_movements"("company_id", "shift_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_company_id_idempotency_key_key" ON "cash_movements"("company_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "cash_shift_method_totals" ADD CONSTRAINT "cash_shift_method_totals_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_shift_method_totals" ADD CONSTRAINT "cash_shift_method_totals_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "cash_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Money and counts are never negative; a movement always has a positive amount (its type says the direction).
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_closing_float_nonnegative" CHECK ("closing_float" IS NULL OR "closing_float" >= 0);
ALTER TABLE "cash_shifts" ADD CONSTRAINT "cash_shifts_counted_amount_nonnegative" CHECK ("counted_amount" IS NULL OR "counted_amount" >= 0);
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_denomination_positive" CHECK ("denomination" > 0);
ALTER TABLE "cash_counts" ADD CONSTRAINT "cash_counts_quantity_nonnegative" CHECK ("quantity" >= 0);
ALTER TABLE "cash_shift_method_totals" ADD CONSTRAINT "cash_shift_method_totals_declared_nonnegative" CHECK ("declared_amount" >= 0);
ALTER TABLE "cash_shift_method_totals" ADD CONSTRAINT "cash_shift_method_totals_system_nonnegative" CHECK ("system_amount" >= 0);
