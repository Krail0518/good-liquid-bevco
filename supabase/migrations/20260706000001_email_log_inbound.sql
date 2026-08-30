-- ============================================================
-- Add inbound email support to email_log.
-- direction: 'outbound' (default, all existing rows) or 'inbound' (client replies)
-- from_email: sender address for inbound rows; NULL on outbound rows.
-- client_id was already added in 20260706_email_log_client_id.sql.
-- ============================================================

ALTER TABLE public.email_log
  ADD COLUMN IF NOT EXISTS direction  text NOT NULL DEFAULT 'outbound'
    CHECK (direction IN ('outbound', 'inbound')),
  ADD COLUMN IF NOT EXISTS from_email text;

CREATE INDEX IF NOT EXISTS idx_email_log_direction  ON public.email_log(direction);
CREATE INDEX IF NOT EXISTS idx_email_log_from_email ON public.email_log(from_email);
