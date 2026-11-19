-- CreateEnum
CREATE TYPE "VatPeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'FILED');

-- CreateEnum
CREATE TYPE "SiatCatalog" AS ENUM ('ACTIVITY', 'LEGEND', 'PRODUCT_SERVICE', 'UNIT_OF_MEASURE', 'CANCELLATION_REASON', 'CREDIT_NOTE_REASON', 'POINT_OF_SALE_TYPE');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "activity_code" TEXT,
ADD COLUMN     "legend" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "sin_activity_code" TEXT,
ADD COLUMN     "sin_product_code" TEXT,
ADD COLUMN     "sin_unit_code" INTEGER;

-- AlterTable
ALTER TABLE "siat_points_of_sale" ADD COLUMN     "deactivated_at" TIMESTAMPTZ(3),
ADD COLUMN     "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "type_code" INTEGER;

-- AlterTable
ALTER TABLE "siat_settings" ADD COLUMN     "default_product_code" TEXT,
ADD COLUMN     "main_activity_code" TEXT,
ADD COLUMN     "production_enabled_at" TIMESTAMPTZ(3),
ADD COLUMN     "production_enabled_by_id" UUID,
ADD COLUMN     "signature_file_name" TEXT,
ADD COLUMN     "signature_uploaded_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "vat_periods" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "status" "VatPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,
    "filed_at" TIMESTAMPTZ(3),
    "filed_by_id" UUID,
    "reopened_at" TIMESTAMPTZ(3),
    "reopened_by_id" UUID,
    "reopen_reason" TEXT,
    "sales_total" DECIMAL(14,2),
    "fiscal_debit" DECIMAL(14,2),
    "purchases_total" DECIMAL(14,2),
    "vat_credit" DECIMAL(14,2),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "vat_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "siat_catalog_entries" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "catalog" "SiatCatalog" NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "activity_code" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "synced_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "siat_catalog_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "siat_catalog_syncs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "catalog" "SiatCatalog" NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL,
    "entry_count" INTEGER NOT NULL,

    CONSTRAINT "siat_catalog_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vat_periods_company_id_period_key" ON "vat_periods"("company_id", "period");

-- CreateIndex
CREATE INDEX "siat_catalog_entries_company_id_catalog_idx" ON "siat_catalog_entries"("company_id", "catalog");

-- CreateIndex
CREATE UNIQUE INDEX "siat_catalog_entries_company_id_catalog_activity_code_code_key" ON "siat_catalog_entries"("company_id", "catalog", "activity_code", "code");

-- CreateIndex
CREATE UNIQUE INDEX "siat_catalog_syncs_company_id_catalog_key" ON "siat_catalog_syncs"("company_id", "catalog");

-- CreateIndex
CREATE INDEX "products_company_id_sin_product_code_idx" ON "products"("company_id", "sin_product_code");

-- AddForeignKey
ALTER TABLE "vat_periods" ADD CONSTRAINT "vat_periods_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "siat_catalog_entries" ADD CONSTRAINT "siat_catalog_entries_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "siat_catalog_syncs" ADD CONSTRAINT "siat_catalog_syncs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A VAT period is a La Paz month: `YYYY-MM`.
ALTER TABLE "vat_periods" ADD CONSTRAINT "vat_periods_period_format" CHECK ("period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');

-- A period that carries a snapshot has been closed at some point.
ALTER TABLE "vat_periods" ADD CONSTRAINT "vat_periods_closed_has_snapshot" CHECK ("status" = 'OPEN' OR ("closed_at" IS NOT NULL AND "sales_total" IS NOT NULL));

-- Invoices already issued keep printing the legend they were issued with (the default one), so a reprint never changes.
UPDATE "invoices"
SET "legend" = 'Ley N° 453: Tienes derecho a recibir información sobre las características y contenidos de los servicios que utilices.'
WHERE "issued_at" IS NOT NULL;
