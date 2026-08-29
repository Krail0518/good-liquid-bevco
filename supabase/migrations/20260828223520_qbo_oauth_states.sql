-- Server-side store for QuickBooks OAuth CSRF state.
--
-- ROLLBACK:
--   drop table if exists public.qbo_oauth_states;
--   (then redeploy the previous qbo-connect / qbo-callback, which ignore it)
--
-- WHY
-- ---
-- qbo-connect generated a state value and returned it:
--
--     const state = crypto.randomUUID() + '.' + btoa(origin || '').replace(/=/g, '');
--
-- with the comment "CSRF state — opaque random + the caller origin so the
-- callback can verify". The callback never verified anything: it read
-- `state` from the query string and used it for nothing. The value was
-- generated, sent to Intuit, echoed back, and dropped.
--
-- So the OAuth flow had no CSRF protection at all. qbo-callback holds
-- SUPABASE_SERVICE_ROLE_KEY and writes qbo_tokens, and Intuit will redirect
-- anyone who completes an authorization. A stranger who ran the flow against
-- their own QuickBooks company could have the callback overwrite the stored
-- tokens and realm_id — silently repointing the CRM's accounting integration
-- at a company they control. Invoices pushed afterwards go to them.
--
-- The callback cannot require a staff session: it is a top-level browser
-- redirect from Intuit and carries no Authorization header. The state IS the
-- credential, which is why it has to be stored and checked rather than merely
-- generated.
--
-- Single-use and short-lived: consumed on first successful callback, so a
-- replayed redirect finds nothing.

create table if not exists public.qbo_oauth_states (
  state       text primary key,
  created_by  uuid references auth.users(id) on delete set null,
  origin      text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '15 minutes')
);

comment on table public.qbo_oauth_states is
  'Pending Intuit OAuth CSRF states. Written by qbo-connect, consumed once by qbo-callback. Service-role only.';

create index if not exists qbo_oauth_states_expires_idx
  on public.qbo_oauth_states (expires_at);

-- Only the edge functions touch this, and they use the service role, which
-- bypasses RLS. Enabling it with no policy means no anon or authenticated
-- caller can read or write pending states — a readable state table would hand
-- an attacker the very value this exists to protect.
alter table public.qbo_oauth_states enable row level security;

revoke all on public.qbo_oauth_states from anon, authenticated;

-- Housekeeping: drop anything already past its window. Safe to call at any
-- time; qbo-connect calls it opportunistically so the table cannot grow
-- without bound from abandoned connect attempts.
create or replace function public.gl_purge_expired_qbo_states()
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.qbo_oauth_states where expires_at < now();
$$;

revoke all on function public.gl_purge_expired_qbo_states() from anon, authenticated;
