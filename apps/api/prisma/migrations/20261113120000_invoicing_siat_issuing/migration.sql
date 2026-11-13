-- HU-FAC-01…10: SIAT issuing without contingency.
-- 1. InvoiceStatus loses CONTINGENCY and OBSERVED (the enum is recreated; the migration aborts if a row still uses them).
-- 2. Invoice gets the fiscal data of an issue attempt; the signed XML lives in invoice_documents.
-- 3. A NIT exception is an approval type; SiatSettings keeps the last connection check.

-- 1. enum
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoices WHERE status::text IN ('CONTINGENCY', 'OBSERVED'))
     OR EXISTS (SELECT 1 FROM credit_notes WHERE status::text IN ('CONTINGENCY', 'OBSERVED')) THEN
    RAISE EXCEPTION 'invoices or credit notes still use CONTINGENCY or OBSERVED: resolve them before this migration';
  END IF;
END $$;

ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'SENDING', 'VALID', 'REJECTED', 'CANCELLATION_PENDING', 'CANCELLED');

ALTER TABLE "invoices" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "invoices" ALTER COLUMN "status" TYPE "InvoiceStatus" USING "status"::text::"InvoiceStatus";
ALTER TABLE "invoices" ALTER COLUMN "status" SET DEFAULT 'PENDING';

ALTER TABLE "credit_notes" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "credit_notes" ALTER COLUMN "status" TYPE "InvoiceStatus" USING "status"::text::"InvoiceStatus";
ALTER TABLE "credit_notes" ALTER COLUMN "status" SET DEFAULT 'PENDING';

DROP TYPE "InvoiceStatus_old";

-- 2. invoices
ALTER TABLE "invoices"
  ADD COLUMN "branch_id" UUID,
  ADD COLUMN "point_of_sale_id" UUID,
  ADD COLUMN "customer_complement" TEXT,
  ADD COLUMN "cuf" TEXT,
  ADD COLUMN "issued_at" TIMESTAMPTZ(3),
  ADD COLUMN "siat_reception_code" TEXT,
  ADD COLUMN "rejection_code" INTEGER,
  ADD COLUMN "rejection_message" TEXT,
  ADD COLUMN "last_attempt_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_error" TEXT,
  ADD COLUMN "nit_verified_at" TIMESTAMPTZ(3),
  ADD COLUMN "nit_exception" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "cancellation_reason_code" INTEGER,
  ADD COLUMN "cancelled_at" TIMESTAMPTZ(3);

-- back-fill: the branch of the sale; the point of sale of its register, else the lowest-code one of the branch
UPDATE "invoices" i SET "branch_id" = s."branch_id" FROM "sales" s WHERE s."id" = i."sale_id";

UPDATE "invoices" i SET "point_of_sale_id" = r."point_of_sale_id"
FROM "sales" s
JOIN "cash_shifts" cs ON cs."id" = s."shift_id"
JOIN "cash_registers" r ON r."id" = cs."register_id"
WHERE s."id" = i."sale_id";

UPDATE "invoices" i SET "point_of_sale_id" = (
  SELECT p."id" FROM "siat_points_of_sale" p WHERE p."branch_id" = i."branch_id" ORDER BY p."code" LIMIT 1
) WHERE i."point_of_sale_id" IS NULL;

ALTER TABLE "invoices" ALTER COLUMN "branch_id" SET NOT NULL;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_point_of_sale_id_fkey" FOREIGN KEY ("point_of_sale_id") REFERENCES "siat_points_of_sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "invoices_company_id_point_of_sale_id_number_key" ON "invoices"("company_id", "point_of_sale_id", "number");
CREATE INDEX "invoices_company_id_created_at_idx" ON "invoices"("company_id", "created_at" DESC);
CREATE INDEX "invoices_company_id_issued_at_idx" ON "invoices"("company_id", "issued_at");

CREATE TABLE "invoice_documents" (
  "invoice_id" UUID NOT NULL,
  "company_id" UUID NOT NULL,
  "signed_xml" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "invoice_documents_pkey" PRIMARY KEY ("invoice_id")
);
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "invoice_documents" ADD CONSTRAINT "invoice_documents_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. approvals and SIAT connection
ALTER TYPE "ApprovalType" ADD VALUE 'NIT_EXCEPTION';

CREATE TYPE "SiatConnectionStatus" AS ENUM ('UNKNOWN', 'ONLINE', 'OFFLINE');
ALTER TABLE "siat_settings"
  ADD COLUMN "connection_status" "SiatConnectionStatus" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "connection_checked_at" TIMESTAMPTZ(3),
  ADD COLUMN "connection_changed_at" TIMESTAMPTZ(3);

-- 4. what the simulated SIN accepted and cancelled (shared by the API and the worker; development only)
CREATE TABLE "simulated_siat_records" (
  "cuf" TEXT NOT NULL,
  "company_id" UUID NOT NULL,
  "reception_code" TEXT NOT NULL,
  "cancelled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "simulated_siat_records_pkey" PRIMARY KEY ("cuf")
);
CREATE INDEX "simulated_siat_records_company_id_idx" ON "simulated_siat_records"("company_id");
ALTER TABLE "simulated_siat_records" ADD CONSTRAINT "simulated_siat_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
