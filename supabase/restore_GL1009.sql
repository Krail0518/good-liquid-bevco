-- ============================================================
-- Restore invoice GL-1009 (Ceres 14, $2,750.00)
-- Reconstructed from the exported PDF (GL-1009.pdf, 2026-06-22)
-- Run this once in the Supabase SQL editor.
-- ============================================================

DO $$
DECLARE
  v_client_id uuid;
BEGIN
  -- Look up Ceres 14's client ID
  SELECT id INTO v_client_id
  FROM public.clients
  WHERE name ILIKE '%Ceres 14%'
  LIMIT 1;

  IF v_client_id IS NULL THEN
    RAISE EXCEPTION 'Client "Ceres 14" not found — check the clients table spelling.';
  END IF;

  -- Guard: don't double-insert if the invoice already exists
  IF EXISTS (SELECT 1 FROM public.invoices WHERE invoice_number = 'GL-1009') THEN
    RAISE NOTICE 'GL-1009 already exists — no action taken.';
    RETURN;
  END IF;

  INSERT INTO public.invoices (
    invoice_number,
    client_id,
    client_name,
    service,
    amount,
    invoice_date,
    due_date,
    payment_terms,
    status,
    line_items,
    notes
  ) VALUES (
    'GL-1009',
    v_client_id,
    'Ceres 14',
    'Production Hours / CIP & Sanitation',
    2750.00,
    '2026-06-05',
    '2026-06-05',
    'Due on receipt',
    'overdue',
    '[
      {"desc":"Production Hours - Production labor — Drain tank package kratom in pails, make r/o water, cip all lab equipment","qty":5,"unitPrice":125,"total":625},
      {"desc":"Custom - 6/8/26 santize lab equipment","qty":1,"unitPrice":125,"total":125},
      {"desc":"Custom - 6/9/26 santize / cip lab equipment","qty":2,"unitPrice":125,"total":250},
      {"desc":"Custom - 6/15/26 santize / cip lab equipment","qty":2,"unitPrice":125,"total":250},
      {"desc":"Custom - 6/18/296 Cip new pipeline / cip tank / work on kava develpment","qty":7,"unitPrice":125,"total":875},
      {"desc":"Custom - 6/19/26 Deep Clean Lab equipment after Kava run","qty":5,"unitPrice":125,"total":625}
    ]'::jsonb,
    NULL
  );

  RAISE NOTICE 'GL-1009 restored for client_id: %', v_client_id;
END $$;
