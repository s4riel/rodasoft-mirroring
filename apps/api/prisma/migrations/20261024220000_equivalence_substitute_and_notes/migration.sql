-- HU-INV-13 (Figma IN-15c): the link form classifies a link as a substitute and keeps the observed differences as text.
-- Incompatible measurements are now refused instead of confirmed, so the "acknowledged" flag is dropped.
ALTER TABLE "equivalences" DROP COLUMN "incompatible_acknowledged";
ALTER TABLE "equivalences" ADD COLUMN "substitute" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "equivalences" ADD COLUMN "notes" VARCHAR(500);
