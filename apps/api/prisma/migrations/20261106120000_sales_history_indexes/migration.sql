-- HU-VEN-12: indexes for the sales history. The unfiltered list reads newest first per company, and a cashier's own list
-- also filters by the creator.

-- CreateIndex
CREATE INDEX "sales_company_id_created_at_idx" ON "sales"("company_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sales_company_id_created_by_id_created_at_idx" ON "sales"("company_id", "created_by_id", "created_at" DESC);
