-- HU-VEN-15: approving the cancellation of a sale puts its goods back in the warehouse with a movement of their own, so
-- the kardex tells a cancelled sale apart from a customer return.

-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'SALE_CANCELLATION';
