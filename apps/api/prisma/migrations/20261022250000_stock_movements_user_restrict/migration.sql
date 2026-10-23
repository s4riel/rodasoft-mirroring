-- A user with movements cannot be hard-deleted: SET NULL would UPDATE history rows, which the immutability trigger rejects.
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_user_id_fkey";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
