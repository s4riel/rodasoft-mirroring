-- A customer without a discount carries no value (decision #5, HU-VEN-37). HU-VEN-00 already checks that the value is not
-- negative and that a percent is at most 100.
ALTER TABLE "customers" ADD CONSTRAINT "customers_discount_none_check" CHECK ("discount_type" <> 'NONE' OR "discount_value" = 0);

-- Searching a customer by its document number at the POS (HU-VEN-05).
CREATE INDEX "customers_company_id_document_number_idx" ON "customers"("company_id", "document_number");
