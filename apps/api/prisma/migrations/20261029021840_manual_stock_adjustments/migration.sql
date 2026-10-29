-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StockAdjustmentItemKind" ADD VALUE 'IN';
ALTER TYPE "StockAdjustmentItemKind" ADD VALUE 'OUT';
ALTER TYPE "StockAdjustmentItemKind" ADD VALUE 'COUNT';

-- AlterTable
ALTER TABLE "stock_adjustment_items" ADD COLUMN     "entered_quantity" INTEGER;

-- AlterTable
ALTER TABLE "stock_adjustments" ADD COLUMN     "note" TEXT;
