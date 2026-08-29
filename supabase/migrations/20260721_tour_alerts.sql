-- ── Tour booking availability + pipeline deal SMS alerts ──────────────────────
-- 2026-07-21
-- Changes:
--   1. Update booking_pages to Mon–Fri 10am–2pm availability
--   2. Enable pg_net extension (HTTP calls from DB triggers)
--   3. Store GL_NOTIFY_SECRET in vault for trigger use
--   4. DB triggers on deals + contact_submissions → notify-deal edge function

-- 1. Monday-Friday only, tours 10:00–14:00
UPDATE booking_pages
SET
  avail_days = ARRAY[1, 2, 3, 4, 5],
  start_time = '10:00',
  end_time   = '14:00'
WHERE is_active = true;

-- 2. Enable pg_net (already on in most Supabase projects; idempotent)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 3. Store shared secret in vault (idempotent)
--
-- AMENDED 2026-08-29 (GL-013). This block originally passed the literal
-- 'gl-notify-2026-abc123' as the secret value. That string was committed to
-- this repository, so it was never a secret at all -- anyone with read access
-- to the repo held the credential that authenticated the database's triggers
-- to the notify-deal edge function.
--
-- Production no longer uses it: 20260730002000_rotate_notify_secret.sql
-- replaced the value with a generated 64-character one on 2026-07-30, and the
-- live secret was confirmed not to equal the literal before this amendment.
-- Amending the file matters anyway, because migrations are replayed. A fresh
-- environment, or anyone running this file alone, would otherwise re-create
-- the published credential and run on it until the later rotation happened to
-- follow.
--
-- Generated in-database, exactly as the rotation migration does, so the value
-- never exists outside Postgres. The guard below and the SECRET facts in
-- scripts/db-drift-snapshot.sql make a regression here fail loudly.
DO $
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'gl_notify_secret') THEN
    PERFORM vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'gl_notify_secret',
      'notify-deal shared secret. Generated in-db; never exported.'
    );
  END IF;
END $;

-- Refuse to leave the published literal in place, however it got there.
DO $
BEGIN
  IF EXISTS (
    SELECT 1 FROM vault.decrypted_secrets
     WHERE name = 'gl_notify_secret'
       AND decrypted_secret = 'gl-notify-2026-abc123'
  ) THEN
    RAISE EXCEPTION 'gl_notify_secret is the literal published in git history; rotate it (see 20260730002000_rotate_notify_secret.sql)';
  END IF;
END $;

-- 4. Trigger: new deal added to pipeline
CREATE OR REPLACE FUNCTION trigger_notify_new_deal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'gl_notify_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := '';
  END;

  IF v_secret IS NOT NULL AND v_secret <> '' THEN
    PERFORM net.http_post(
      url     := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/notify-deal',
      body    := jsonb_build_object(
        'event',  'new_deal',
        'secret', v_secret,
        'data',   jsonb_build_object(
          'name',    COALESCE(NEW.name, ''),
          'company', COALESCE(NEW.client_name, ''),
          'stage',   COALESCE(NEW.stage, 'Prospecting'),
          'service', COALESCE(NEW.service, '')
        )
      ),
      headers := '{"Content-Type":"application/json"}'::jsonb
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;  -- never block the insert
END;
$$;

DROP TRIGGER IF EXISTS on_deal_insert ON deals;
CREATE TRIGGER on_deal_insert
  AFTER INSERT ON deals
  FOR EACH ROW
  EXECUTE FUNCTION trigger_notify_new_deal();

-- 5. Trigger: public quote request submitted
CREATE OR REPLACE FUNCTION trigger_notify_new_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'gl_notify_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := '';
  END;

  IF v_secret IS NOT NULL AND v_secret <> '' THEN
    PERFORM net.http_post(
      url     := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/notify-deal',
      body    := jsonb_build_object(
        'event',  'new_quote',
        'secret', v_secret,
        'data',   jsonb_build_object(
          'name',    COALESCE(NEW.contact_name, ''),
          'company', COALESCE(NEW.brand_name, ''),
          'email',   COALESCE(NEW.email, ''),
          'phone',   COALESCE(NEW.phone, ''),
          'service', COALESCE(NEW.service, '')
        )
      ),
      headers := '{"Content-Type":"application/json"}'::jsonb
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_quote_insert ON contact_submissions;
CREATE TRIGGER on_quote_insert
  AFTER INSERT ON contact_submissions
  FOR EACH ROW
  EXECUTE FUNCTION trigger_notify_new_quote();
