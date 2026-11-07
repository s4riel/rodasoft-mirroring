-- HU-VEN-19: an order keeps the totals of the quote it was born from, and its lines their amounts and order.
ALTER TABLE "sales_orders"
  ADD COLUMN "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "discount_type" "CustomerDiscountType" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "discount_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "discount_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "rounding_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "cancelled_at" TIMESTAMPTZ(3);
ALTER TABLE "sales_orders" ALTER COLUMN "subtotal" DROP DEFAULT, ALTER COLUMN "total" DROP DEFAULT;

ALTER TABLE "sales_order_items"
  ADD COLUMN "line_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sales_order_items" ALTER COLUMN "line_total" DROP DEFAULT;

CREATE INDEX "sales_orders_company_id_quote_id_idx" ON "sales_orders"("company_id", "quote_id");

-- rows left negative by hand are put right first, so the constraint can be added
UPDATE "stock_levels" SET "reserved" = 0 WHERE "reserved" < 0;
-- a reservation never goes negative (it may exceed the stock only when negative stock is allowed)
ALTER TABLE "stock_levels" ADD CONSTRAINT "stock_levels_reserved_non_negative" CHECK ("reserved" >= 0);
