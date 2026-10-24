-- AlterTable
ALTER TABLE "products" ADD COLUMN     "deactivated_at" TIMESTAMPTZ(3),
ADD COLUMN     "deactivated_by_id" UUID;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_deactivated_by_id_fkey" FOREIGN KEY ("deactivated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
