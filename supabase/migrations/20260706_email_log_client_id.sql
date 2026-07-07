-- Add client_id to email_log so emails can be queried per client.
-- Nullable + no FK constraint so existing rows are unaffected and
-- the column can be backfilled later if needed.
ALTER TABLE email_log
  ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS email_log_client_id_idx ON email_log(client_id);
