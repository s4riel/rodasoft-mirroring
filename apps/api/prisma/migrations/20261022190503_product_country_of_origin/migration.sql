-- AlterTable
ALTER TABLE "products" ADD COLUMN     "country_id" UUID;

-- CreateIndex
CREATE INDEX "products_company_id_country_id_idx" ON "products"("company_id", "country_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: existing products inherit the industry of their brand
UPDATE "products" p SET "country_id" = b."country_id" FROM "brands" b WHERE b."id" = p."brand_id";
