-- AlterTable
ALTER TABLE "cash_shifts" ADD COLUMN     "closing_float" DECIMAL(14,2);

-- A cashier cannot hold open shifts on two registers at once (HU-VEN-01).
CREATE UNIQUE INDEX "cash_shifts_one_open_per_user" ON "cash_shifts" ("company_id", "opened_by_id") WHERE "status" = 'OPEN';
