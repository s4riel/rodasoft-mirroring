-- HU-FAC-11, 12, 13, 18, 19, 20: credit notes that can be issued, and the VAT purchases book.
-- 1. credit_notes gets the fiscal data of an issue attempt, its reason and the VAT it adjusts; return_id becomes optional
--    (a price-adjustment note has no return).
-- 2. credit_note_items: what each note takes back of each invoiced line, back-filled from the return lines.
-- 3. credit_note_documents: the XML of an issued note.
-- 4. purchase_book_entries: the purchases book, written by the purchasing module later.

-- 1. credit_notes
ALTER TABLE "credit_notes"
  ADD COLUMN "branch_id" UUID,
  ADD COLUMN "point_of_sale_id" UUID,
  ADD COLUMN "vat_adjusted" DECIMAL(14,2),
  ADD COLUMN "reason_code" INTEGER,
  ADD COLUMN "cuf" TEXT,
  ADD COLUMN "issued_at" TIMESTAMPTZ(3),
  ADD COLUMN "siat_reception_code" TEXT,
  ADD COLUMN "rejection_code" INTEGER,
  ADD COLUMN "rejection_message" TEXT,
  ADD COLUMN "last_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_error" TEXT;

-- back-fill: branch and point of sale of the invoice (a null point of sale stays null and fails the first send with
-- POINT_OF_SALE_MISSING, as invoices do); the reason of the return mapped to the provisional SIN catalogue
-- (`creditNoteReasonCode` in libs/domain); 13 % of the total, half up
UPDATE "credit_notes" n
SET "branch_id" = i."branch_id", "point_of_sale_id" = i."point_of_sale_id"
FROM "invoices" i
WHERE i."id" = n."invoice_id";

UPDATE "credit_notes" n
SET "reason_code" = CASE r."reason"
    WHEN 'FACTORY_DEFECT' THEN 2
    WHEN 'WRONG_PRODUCT' THEN 3
    WHEN 'CUSTOMER_CHANGED_MIND' THEN 1
    ELSE 5
  END
FROM "sale_returns" r
WHERE r."id" = n."return_id";

UPDATE "credit_notes" SET "reason_code" = 5 WHERE "reason_code" IS NULL;
UPDATE "credit_notes" SET "vat_adjusted" = ROUND("total" * 0.13, 2);

ALTER TABLE "credit_notes"
  ALTER COLUMN "branch_id" SET NOT NULL,
  ALTER COLUMN "vat_adjusted" SET NOT NULL,
  ALTER COLUMN "reason_code" SET NOT NULL,
  ALTER COLUMN "return_id" DROP NOT NULL;

ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_point_of_sale_id_fkey" FOREIGN KEY ("point_of_sale_id") REFERENCES "siat_points_of_sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_total_check" CHECK ("total" >= 0);
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_vat_adjusted_check" CHECK ("vat_adjusted" >= 0);

CREATE UNIQUE INDEX "credit_notes_company_id_point_of_sale_id_number_key" ON "credit_notes"("company_id", "point_of_sale_id", "number");
CREATE INDEX "credit_notes_company_id_created_at_idx" ON "credit_notes"("company_id", "created_at" DESC);
CREATE INDEX "credit_notes_company_id_issued_at_idx" ON "credit_notes"("company_id", "issued_at");

-- 2. credit_note_items
CREATE TABLE "credit_note_items" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "credit_note_id" UUID NOT NULL,
  "sale_item_id" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_price" DECIMAL(14,2) NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "credit_note_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credit_note_items_quantity_check" CHECK ("quantity" >= 0),
  CONSTRAINT "credit_note_items_amount_check" CHECK ("amount" > 0)
);
CREATE INDEX "credit_note_items_company_id_credit_note_id_idx" ON "credit_note_items"("company_id", "credit_note_id");
CREATE INDEX "credit_note_items_company_id_sale_item_id_idx" ON "credit_note_items"("company_id", "sale_item_id");
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "credit_note_items" ADD CONSTRAINT "credit_note_items_sale_item_id_fkey" FOREIGN KEY ("sale_item_id") REFERENCES "sale_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- back-fill: one item per return line that refunds money (a line refunded with 0 credits nothing)
INSERT INTO "credit_note_items" ("id", "company_id", "credit_note_id", "sale_item_id", "description", "quantity", "unit_price", "amount")
SELECT gen_random_uuid(), n."company_id", n."id", ri."sale_item_id", p."name", ri."quantity", si."unit_price", ri."refund_amount"
FROM "credit_notes" n
JOIN "sale_return_items" ri ON ri."return_id" = n."return_id"
JOIN "sale_items" si ON si."id" = ri."sale_item_id"
JOIN "products" p ON p."id" = si."product_id"
WHERE ri."refund_amount" > 0;

-- 3. credit_note_documents
CREATE TABLE "credit_note_documents" (
  "credit_note_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "signed_xml" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_note_documents_pkey" PRIMARY KEY ("credit_note_id")
);
ALTER TABLE "credit_note_documents" ADD CONSTRAINT "credit_note_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "credit_note_documents" ADD CONSTRAINT "credit_note_documents_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4. purchase_book_entries
CREATE TYPE "PurchaseBookStatus" AS ENUM ('VALID', 'OBSERVED');

CREATE TABLE "purchase_book_entries" (
  "id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "period" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "supplier_nit" TEXT NOT NULL,
  "supplier_name" TEXT NOT NULL,
  "authorization_code" TEXT NOT NULL,
  "invoice_number" TEXT NOT NULL,
  "total" DECIMAL(14,2) NOT NULL,
  "vat_credit" DECIMAL(14,2) NOT NULL,
  "status" "PurchaseBookStatus" NOT NULL DEFAULT 'VALID',
  "observation" TEXT,
  "nit_verified_at" TIMESTAMPTZ(3),
  "source" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "purchase_book_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_book_entries_total_check" CHECK ("total" >= 0),
  CONSTRAINT "purchase_book_entries_vat_credit_check" CHECK ("vat_credit" >= 0),
  CONSTRAINT "purchase_book_entries_period_check" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
CREATE INDEX "purchase_book_entries_company_id_period_idx" ON "purchase_book_entries"("company_id", "period");
ALTER TABLE "purchase_book_entries" ADD CONSTRAINT "purchase_book_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
