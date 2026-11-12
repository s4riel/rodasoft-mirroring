-- HU-VEN-24, HU-VEN-25 and HU-VEN-26: a printed number for every cash shift (the shift history lists them) and the source and
-- reason of each price change.

-- CreateEnum
CREATE TYPE "PriceChangeSource" AS ENUM ('MANUAL', 'PRODUCT_FORM', 'IMPORT', 'BULK');

-- AlterTable
ALTER TABLE "price_changes" ADD COLUMN     "reason" TEXT,
ADD COLUMN     "source" "PriceChangeSource" NOT NULL DEFAULT 'MANUAL';

-- AlterTable: added nullable, backfilled below, then made required
ALTER TABLE "cash_shifts" ADD COLUMN     "number" TEXT;

-- Existing shifts get their number per company in opening order (`T-0001`, at least four digits).
UPDATE "cash_shifts" AS s
SET "number" = 'T-' || lpad(n.rn::text, GREATEST(4, length(n.rn::text)), '0')
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "company_id" ORDER BY "opened_at", "id") AS rn
  FROM "cash_shifts"
) AS n
WHERE n."id" = s."id";

-- The sequence continues after the last backfilled number.
INSERT INTO "document_sequences" ("id", "company_id", "key", "last")
SELECT gen_random_uuid(), "company_id", 'CASH_SHIFT', count(*)
FROM "cash_shifts"
GROUP BY "company_id"
ON CONFLICT ("company_id", "key") DO UPDATE SET "last" = EXCLUDED."last";

ALTER TABLE "cash_shifts" ALTER COLUMN "number" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "cash_shifts_company_id_number_key" ON "cash_shifts"("company_id", "number");

-- CreateIndex
CREATE INDEX "cash_shifts_company_id_status_closed_at_idx" ON "cash_shifts"("company_id", "status", "closed_at" DESC);

-- A price is never negative and a change always changes something.
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_new_price_nonnegative" CHECK ("new_price" >= 0);
ALTER TABLE "price_changes" ADD CONSTRAINT "price_changes_price_differs" CHECK ("old_price" <> "new_price");
