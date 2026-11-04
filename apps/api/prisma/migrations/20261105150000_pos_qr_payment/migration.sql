-- HU-VEN-08: QR payment. The QR payload and its deadline are kept on the payment row.
ALTER TABLE "pos_checkout_payments" ADD COLUMN "qr_payload" TEXT;
ALTER TABLE "pos_checkout_payments" ADD COLUMN "expires_at" TIMESTAMPTZ(3);

-- a QR payment always has the provider's reference and a deadline
ALTER TABLE "pos_checkout_payments" ADD CONSTRAINT "pos_checkout_payments_qr_check"
  CHECK ("method" <> 'QR' OR ("provider_ref" IS NOT NULL AND "qr_payload" IS NOT NULL AND "expires_at" IS NOT NULL));

-- only QR payments carry a payload or a deadline
ALTER TABLE "pos_checkout_payments" ADD CONSTRAINT "pos_checkout_payments_qr_only_check"
  CHECK ("method" = 'QR' OR ("qr_payload" IS NULL AND "expires_at" IS NULL));

-- a checkout waits for a single QR at a time
CREATE UNIQUE INDEX "pos_checkout_payments_one_pending_qr"
  ON "pos_checkout_payments" ("checkout_id")
  WHERE "method" = 'QR' AND "status" = 'PENDING';
