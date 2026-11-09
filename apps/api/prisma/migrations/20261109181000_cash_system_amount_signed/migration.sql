-- The system cash of a shift can be negative when refunds of earlier sales leave more than the drawer holds; closing must still record it.
ALTER TABLE "cash_shift_method_totals" DROP CONSTRAINT "cash_shift_method_totals_system_nonnegative";
