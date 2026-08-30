-- ============================================================
-- Inspector mode — server-side RLS gating for compliance data
-- ============================================================
-- The original inspector_tokens flow (20260518_phase4_sql_pack.sql)
-- only validated the token. The CRM applied a CSS overlay to make
-- the UI look read-only, but the inspector still loaded data
-- using whatever role their browser carried. If they arrived
-- anonymous (the documented flow — clicking the emailed URL with
-- no login), every compliance table's `to authenticated` policy
-- denied them, so the page rendered EMPTY.
--
-- This migration:
--   1. Adds public.is_valid_inspector_token(text) — a SECURITY
--      DEFINER function that returns true iff the passed token
--      exists in inspector_tokens with revoked_at IS NULL and
--      now() between valid_from and valid_until.
--   2. Adds anon SELECT policies on the six core compliance
--      tables that consult the function against the
--      X-Inspector-Token request header. The JS supabase-js
--      client (see fix.js change in the same PR) injects that
--      header when ?inspector=TOKEN is in the URL.
--   3. Side-effect tracking: an UPDATE-bump on inspector_tokens
--      use_count + last_used_at fires from the JS via the narrow
--      anon update policy added in 20260523_inspector_tokens_rls_lockdown.sql.
--
-- Writes remain locked: the new policies are SELECT-only. Even
-- if an inspector somehow forges a header or finds a valid token,
-- they cannot INSERT/UPDATE/DELETE any compliance row.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── (1) Validator function ────────────────────────────────────
create or replace function public.is_valid_inspector_token(p_token text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.inspector_tokens
    where token = p_token
      and revoked_at is null
      and now() between valid_from and valid_until
  );
$$;

comment on function public.is_valid_inspector_token(text) is
  'Returns true if the passed inspector token is currently valid (exists, not revoked, within valid_from..valid_until window). Used by RLS policies on compliance tables that grant anon read when ?inspector=TOKEN is present.';

-- A helper that grabs the token from the current request headers.
-- PostgREST exposes request headers via current_setting('request.headers', true).
-- The header is matched case-insensitively by PostgREST and lowered for the
-- JSON key, so we look up "x-inspector-token".
create or replace function public.current_inspector_token()
returns text
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.headers', true)::jsonb ->> 'x-inspector-token',
      ''
    ),
    ''
  );
$$;

comment on function public.current_inspector_token() is
  'Returns the X-Inspector-Token request header from the current PostgREST request, or NULL if absent.';

-- ── (2) Anon SELECT policies on each compliance table ─────────
-- compliance_records: FDA-defensible record store
drop policy if exists "compliance_records inspector read" on public.compliance_records;
create policy "compliance_records inspector read" on public.compliance_records
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

-- production_runs: lot history + traceability
drop policy if exists "production_runs inspector read" on public.production_runs;
create policy "production_runs inspector read" on public.production_runs
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

-- defects: NCR log (off-spec, contamination suspicions, etc.)
drop policy if exists "defects inspector read" on public.defects;
create policy "defects inspector read" on public.defects
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

-- hold_tags: DO NOT SHIP product locks
drop policy if exists "hold_tags inspector read" on public.hold_tags;
create policy "hold_tags inspector read" on public.hold_tags
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

-- audit_log: who did what, when (PCQI trail)
drop policy if exists "audit_log inspector read" on public.audit_log;
create policy "audit_log inspector read" on public.audit_log
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

-- cip_logs: cleaning cycle records
drop policy if exists "cip_logs inspector read" on public.cip_logs;
create policy "cip_logs inspector read" on public.cip_logs
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

notify pgrst, 'reload schema';
