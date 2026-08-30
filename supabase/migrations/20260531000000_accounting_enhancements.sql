-- ============================================================
-- Accounting Enhancements Migration
-- Created: 2026-05-31
-- ============================================================
-- HOW TO RUN:
-- Option 1: Supabase dashboard → SQL editor → paste and run
-- Option 2: supabase db push (if using local dev)
-- Option 3: supabase migration run --linked
-- ============================================================

-- ------------------------------------------------------------
-- 1. ADD COLUMNS to existing tables
-- ------------------------------------------------------------

-- Add po_number to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS po_number TEXT;

-- Add void fields to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_credit_memo BOOLEAN DEFAULT false;

-- Add credit_limit to clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(12,2);

-- ------------------------------------------------------------
-- 2. CREATE TABLE invoice_payments
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invoice_payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number TEXT NOT NULL REFERENCES invoices(invoice_number) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('Check','Wire transfer','ACH','Cash','Stripe','Other')),
  paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
  reference TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- RLS
ALTER TABLE invoice_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read" ON invoice_payments FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Staff insert" ON invoice_payments FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Staff update" ON invoice_payments FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Staff delete" ON invoice_payments FOR DELETE USING (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- 3. CREATE TABLE recurring_invoices
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS recurring_invoices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('weekly','monthly','quarterly','annually')),
  start_date DATE NOT NULL,
  end_date DATE,
  payment_terms TEXT DEFAULT 'Net 30',
  notes TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active','paused','cancelled')),
  next_run DATE NOT NULL,
  last_run DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE recurring_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff all" ON recurring_invoices FOR ALL USING (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- 4. CREATE TABLE expenses
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS expenses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  category TEXT NOT NULL DEFAULT 'Other',
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  client_id TEXT,
  production_run_id UUID,
  notes TEXT,
  receipt_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff all" ON expenses FOR ALL USING (auth.role() = 'authenticated');

-- ------------------------------------------------------------
-- 5. RECURRING INVOICE GENERATOR (run via pg_cron daily at 8 AM ET)
-- ------------------------------------------------------------

-- SELECT cron.schedule('generate-recurring-invoices', '0 12 * * *', $$
--   INSERT INTO invoices (invoice_number, client_id, amount, status, date, due_date, payment_terms, notes, line_items)
--   SELECT
--     'GL-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('invoice_seq')::text, 3, '0'),
--     ri.client_id,
--     ri.amount,
--     'pending',
--     CURRENT_DATE,
--     CASE ri.payment_terms
--       WHEN 'Net 30' THEN CURRENT_DATE + 30
--       WHEN 'Net 15' THEN CURRENT_DATE + 15
--       ELSE CURRENT_DATE
--     END,
--     ri.payment_terms,
--     ri.description || ' (auto-generated)',
--     jsonb_build_array(jsonb_build_object('desc', ri.description, 'qty', 1, 'unitPrice', ri.amount, 'total', ri.amount, 'unit', ''))
--   FROM recurring_invoices ri
--   WHERE ri.status = 'active'
--     AND ri.next_run <= CURRENT_DATE
--     AND (ri.end_date IS NULL OR ri.end_date >= CURRENT_DATE);
--   -- Update next_run dates after generation
--   UPDATE recurring_invoices SET
--     last_run = CURRENT_DATE,
--     next_run = CASE frequency
--       WHEN 'weekly' THEN next_run + 7
--       WHEN 'monthly' THEN next_run + interval '1 month'
--       WHEN 'quarterly' THEN next_run + interval '3 months'
--       WHEN 'annually' THEN next_run + interval '1 year'
--     END
--   WHERE status = 'active' AND next_run <= CURRENT_DATE;
-- $$);
