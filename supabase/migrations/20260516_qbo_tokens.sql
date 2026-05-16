-- ============================================================
-- qbo_tokens — single-row store for QuickBooks Online OAuth tokens
-- ============================================================
-- Used by the QBO edge functions (qbo-callback / qbo-disconnect /
-- qbo-push-invoice). Always has exactly one row (id = 1).
--
-- Only the service role key (used by edge functions) should ever
-- touch this table. Authenticated end-users have NO access.
-- ============================================================

create table if not exists public.qbo_tokens (
  id              integer primary key check (id = 1),
  access_token    text not null,
  refresh_token   text not null,
  realm_id        text not null,
  expires_at      timestamptz not null,
  updated_at      timestamptz not null default now()
);

alter table public.qbo_tokens enable row level security;
-- No policies: only service-role calls (from edge functions) can read/write.
-- Bypassing RLS is the intended behavior for this table.
