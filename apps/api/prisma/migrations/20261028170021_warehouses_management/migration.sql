-- AlterTable
ALTER TABLE "warehouses" ADD COLUMN "location_note" TEXT;

-- Keep the oldest active main of each branch, so the unique index below can be created on existing data.
UPDATE "warehouses" w
SET "is_main" = false
WHERE w."is_main" AND w."status" = 'ACTIVE' AND EXISTS (
    SELECT 1 FROM "warehouses" o
    WHERE o."company_id" = w."company_id" AND o."branch_id" = w."branch_id"
      AND o."is_main" AND o."status" = 'ACTIVE'
      AND (o."created_at", o."id") < (w."created_at", w."id")
);

-- Exactly one active main warehouse per branch (HU-INV-17). Prisma cannot express partial indexes.
CREATE UNIQUE INDEX "warehouses_one_main_per_branch" ON "warehouses" ("company_id", "branch_id") WHERE "is_main" AND "status" = 'ACTIVE';
