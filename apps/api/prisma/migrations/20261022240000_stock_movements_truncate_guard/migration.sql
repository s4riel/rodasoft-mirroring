-- TRUNCATE skips row-level triggers, so the immutable history needs a statement-level guard too
CREATE TRIGGER "stock_movements_no_truncate"
BEFORE TRUNCATE ON "stock_movements"
FOR EACH STATEMENT EXECUTE FUNCTION "stock_movements_reject_change"();
