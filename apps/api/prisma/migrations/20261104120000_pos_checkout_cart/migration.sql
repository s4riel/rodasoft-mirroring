-- One line per product in a cart: adding the product again raises the quantity of its line (HU-VEN-02).
CREATE UNIQUE INDEX "pos_checkout_items_checkout_product_key" ON "pos_checkout_items"("checkout_id", "product_id");

-- A cashier has a single sale in progress: two quick "Agregar" clicks cannot create two carts (HU-VEN-02).
CREATE UNIQUE INDEX "pos_checkouts_one_open_per_cashier" ON "pos_checkouts" ("company_id", "cashier_id") WHERE "status" = 'OPEN';
