-- HU-VEN-07/11: a cash payment records the change given back. Only CASH may have change (`sale_payments` already has the same CHECK).
ALTER TABLE "pos_checkout_payments" ADD COLUMN "change" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "pos_checkout_payments" ADD CONSTRAINT "pos_checkout_payments_change_check"
  CHECK ("change" >= 0 AND ("change" = 0 OR "method" = 'CASH'));
