-- HU-VEN-09: mixed payment. A QR can now cover only part of the total, next to the cash that pays the rest.

-- a QR charges a real amount (a zero-total sale is paid in cash or not at all)
ALTER TABLE "pos_checkout_payments" ADD CONSTRAINT "pos_checkout_payments_qr_amount_check"
  CHECK ("method" <> 'QR' OR "amount" > 0);
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_qr_amount_check"
  CHECK ("method" <> 'QR' OR "amount" > 0);

-- one line per method: a checkout holds a single live QR, waiting (PENDING) or paid (CONFIRMED). Cancelled and declined ones
-- stay as history. This replaces the HU-VEN-08 index, which only covered PENDING.
DROP INDEX "pos_checkout_payments_one_pending_qr";
CREATE UNIQUE INDEX "pos_checkout_payments_one_live_qr"
  ON "pos_checkout_payments" ("checkout_id")
  WHERE "method" = 'QR' AND "status" IN ('PENDING', 'CONFIRMED');
