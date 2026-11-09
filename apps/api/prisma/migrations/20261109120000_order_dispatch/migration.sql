-- HU-VEN-20: dispatching an order invoices what was dispatched. That sale is born from the order, not from a POS checkout,
-- and it is not paid at a register, so it has neither a checkout nor a cash shift.
CREATE TYPE "SaleOrigin" AS ENUM ('POS', 'ORDER');

ALTER TABLE "sales"
  ADD COLUMN "origin" "SaleOrigin" NOT NULL DEFAULT 'POS',
  ALTER COLUMN "checkout_id" DROP NOT NULL,
  ALTER COLUMN "shift_id" DROP NOT NULL;

-- a POS sale always has its checkout and its shift; only a sale born from an order may go without them
ALTER TABLE "sales" ADD CONSTRAINT "sales_pos_origin_ck"
  CHECK ("origin" <> 'POS' OR ("checkout_id" IS NOT NULL AND "shift_id" IS NOT NULL));

-- the idempotency key of the request, and one sale per dispatch
ALTER TABLE "dispatches" ADD COLUMN "idempotency_key" TEXT;
CREATE UNIQUE INDEX "dispatches_sale_id_key" ON "dispatches"("sale_id");
CREATE UNIQUE INDEX "dispatches_company_id_idempotency_key_key" ON "dispatches"("company_id", "idempotency_key");
CREATE INDEX "dispatch_items_company_id_order_item_id_idx" ON "dispatch_items"("company_id", "order_item_id");

-- what is dispatched was reserved, and what is reserved was ordered
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_dispatch_within_reserve_ck"
  CHECK ("dispatched_quantity" <= "reserved_quantity" AND "reserved_quantity" <= "quantity");
