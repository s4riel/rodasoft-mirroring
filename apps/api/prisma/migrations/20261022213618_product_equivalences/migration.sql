-- CreateTable
CREATE TABLE "equivalences" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "product_a_id" UUID NOT NULL,
    "product_b_id" UUID NOT NULL,
    "created_by_id" UUID,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "equivalences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "equivalences_company_id_product_b_id_idx" ON "equivalences"("company_id", "product_b_id");

-- CreateIndex
CREATE UNIQUE INDEX "equivalences_company_id_product_a_id_product_b_id_key" ON "equivalences"("company_id", "product_a_id", "product_b_id");

-- AddForeignKey
ALTER TABLE "equivalences" ADD CONSTRAINT "equivalences_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equivalences" ADD CONSTRAINT "equivalences_product_a_id_fkey" FOREIGN KEY ("product_a_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equivalences" ADD CONSTRAINT "equivalences_product_b_id_fkey" FOREIGN KEY ("product_b_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equivalences" ADD CONSTRAINT "equivalences_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equivalences" ADD CONSTRAINT "equivalences_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Canonical pair order: forbids a self-link and a duplicate stored in reverse order (the service normalizes the pair)
ALTER TABLE "equivalences" ADD CONSTRAINT "equivalences_pair_order_check" CHECK ("product_a_id" < "product_b_id");
