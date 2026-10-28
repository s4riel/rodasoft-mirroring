-- Links made before approval existed (HU-INV-13, decision #34) count as approved when they were created,
-- so switching `inventory.equivalences.requireApproval` on later does not turn them all into pending.
UPDATE "equivalences" SET "approved_at" = "created_at", "approved_by_id" = "created_by_id" WHERE "approved_at" IS NULL;
