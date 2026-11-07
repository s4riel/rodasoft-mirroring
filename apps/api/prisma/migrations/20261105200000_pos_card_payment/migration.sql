-- HU-VEN-10: card payment. The terminal's decline reason is kept on the payment, and the authorization code of an approved
-- card goes in the existing `reference` column.

-- CreateEnum
CREATE TYPE "PaymentDeclineReason" AS ENUM ('INSUFFICIENT_FUNDS', 'CARD_DECLINED', 'TERMINAL_ERROR', 'OTHER');

-- AlterTable
ALTER TABLE "pos_checkout_payments" ADD COLUMN "decline_reason" "PaymentDeclineReason";

-- a card payment always has the provider's reference and charges a real amount
ALTER TABLE "pos_checkout_payments" ADD CONSTRAINT "pos_checkout_payments_card_check"
  CHECK ("method" <> 'CARD' OR ("provider_ref" IS NOT NULL AND "amount" > 0));

-- a confirmed card carries the authorization code of the voucher
ALTER TABLE "pos_checkout_payments" ADD CONSTRAINT "pos_checkout_payments_card_confirmed_check"
  CHECK ("method" <> 'CARD' OR "status" <> 'CONFIRMED' OR "reference" IS NOT NULL);

-- only a declined card payment has a decline reason
ALTER TABLE "pos_checkout_payments" ADD CONSTRAINT "pos_checkout_payments_decline_reason_check"
  CHECK ("decline_reason" IS NULL OR ("method" = 'CARD' AND "status" = 'DECLINED'));

ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_card_amount_check"
  CHECK ("method" <> 'CARD' OR "amount" > 0);

-- a checkout holds a single live card payment, waiting (PENDING) or paid (CONFIRMED). Declined and cancelled attempts stay as
-- history, so the cashier can retry. A card and a QR never live together: the services check that under the cart row lock.
CREATE UNIQUE INDEX "pos_checkout_payments_one_live_card"
  ON "pos_checkout_payments" ("checkout_id")
  WHERE "method" = 'CARD' AND "status" IN ('PENDING', 'CONFIRMED');
