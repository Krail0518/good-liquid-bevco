-- ============================================================
-- Production quotes table
-- Stores quotes generated from the admin quote builder.
-- tiers / addons are JSONB so the schema stays flexible as
-- the price deck evolves.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.quotes (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id     uuid        REFERENCES public.clients(id)  ON DELETE SET NULL,
  deal_id       uuid        REFERENCES public.deals(id)    ON DELETE SET NULL,
  quote_number  text        NOT NULL UNIQUE,
  quote_date    date        NOT NULL DEFAULT CURRENT_DATE,
  valid_days    int         NOT NULL DEFAULT 30,
  product_type  text        NOT NULL CHECK (product_type IN ('canning','bottling','keg')),
  package_format text       NOT NULL,
  status        text        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','sent','accepted','declined')),
  tiers         jsonb       NOT NULL DEFAULT '[]',
  addons        jsonb       NOT NULL DEFAULT '[]',
  inclusions    text[]      NOT NULL DEFAULT '{}',
  notes         text,
  pdf_html      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quotes_client_id_idx  ON public.quotes(client_id);
CREATE INDEX IF NOT EXISTS quotes_deal_id_idx    ON public.quotes(deal_id);
CREATE INDEX IF NOT EXISTS quotes_status_idx     ON public.quotes(status);
CREATE INDEX IF NOT EXISTS quotes_quote_date_idx ON public.quotes(quote_date DESC);

-- Auto-bump updated_at
CREATE OR REPLACE FUNCTION public.set_quotes_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_quotes_updated_at ON public.quotes;
CREATE TRIGGER trg_quotes_updated_at
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.set_quotes_updated_at();

-- Admin read/write; no customer portal access
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "quotes_admin_all" ON public.quotes
  USING     (auth.role() = 'authenticated')
  WITH CHECK(auth.role() = 'authenticated');
