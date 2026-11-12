-- HU-VEN-34: a credit payment always carries its due date and no other payment does.
-- Existing rows: no CREDIT payment could be created before this story, and due_date was never written.
ALTER TABLE sale_payments
  ADD CONSTRAINT sale_payments_credit_due_date_check CHECK ((method = 'CREDIT') = (due_date IS NOT NULL));
