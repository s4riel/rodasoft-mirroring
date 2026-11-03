-- Quantities are positive and amounts are never negative on the remaining sales tables (HU-VEN-00 review).
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "sales_order_items" ADD CONSTRAINT "sales_order_items_quantity_check" CHECK ("quantity" > 0 AND "reserved_quantity" >= 0 AND "dispatched_quantity" >= 0);
ALTER TABLE "dispatch_items" ADD CONSTRAINT "dispatch_items_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "sale_return_items" ADD CONSTRAINT "sale_return_items_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_amount_check" CHECK ("amount" >= 0);
ALTER TABLE "pos_checkout_payments" ADD CONSTRAINT "pos_checkout_payments_amount_check" CHECK ("amount" >= 0);
