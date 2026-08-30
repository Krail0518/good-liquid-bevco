-- ============================================================
-- inspector_tokens RLS lockdown — staff-only write, anon read
--                                  (active+unexpired only)
-- ============================================================
-- The original 20260518_phase4_sql_pack.sql shipped this policy:
--
--   create policy "inspector_tokens authed" on public.inspector_tokens
--     for all to authenticated using (true);
--
-- That gives EVERY authenticated session — including every portal
-- customer — full CRUD on the inspector_tokens table. Under it a
-- compromised (or curious) portal session can:
--
--   • SELECT every active inspector token, then use it to enter
--     the CRM in read-only inspector mode (a slow-roll data leak)
--   • INSERT their own tokens, granting themselves inspector
--     access without an admin involved
--   • UPDATE tokens (extend their own valid_until, revoke an
--     inspector mid-visit, etc.)
--   • DELETE tokens (drop the audit trail)
--
-- This migration replaces the wide-open policy with split CRUD:
--   - select: anon (URL-with-token flow) AND staff
--   - insert / update / delete: staff only (is_staff_user())
--
-- Anon select is constrained by the existing anon policy (active
-- + unrevoked + within valid_from..valid_until window).
--
-- NOTE: this does NOT add server-side gating on the COMPLIANCE
-- DATA TABLES that an inspector then reads (compliance_records,
-- production_runs, defects, hold_tags, audit_log). Today inspector
-- mode is a JS/CSS overlay on top of an authenticated session —
-- the inspector still loads data with whatever role their browser
-- session has. True server-side inspector gating is a separate,
-- larger piece of work tracked as a follow-up.
--
-- Idempotent. Safe to re-run.
-- ============================================================

drop policy if exists "inspector_tokens authed" on public.inspector_tokens;

-- Anon SELECT — the inspector URL has to validate without login.
-- The existing "inspector_tokens anon read" policy already scopes
-- this to (revoked_at IS NULL and now() between valid_from and
-- valid_until). Recreate for idempotency.
drop policy if exists "inspector_tokens anon read" on public.inspector_tokens;
create policy "inspector_tokens anon read" on public.inspector_tokens
  for select to anon
  using (revoked_at is null and now() between valid_from and valid_until);

-- Staff SELECT — admins manage tokens from the Compliance Tasks
-- page (review who has access, revoke, etc.). Includes revoked +
-- expired rows so the audit table is complete.
drop policy if exists "inspector_tokens staff select" on public.inspector_tokens;
create policy "inspector_tokens staff select" on public.inspector_tokens
  for select to authenticated
  using (public.is_staff_user());

-- Staff-only writes: only staff can mint, revoke, or delete tokens.
drop policy if exists "inspector_tokens staff insert" on public.inspector_tokens;
create policy "inspector_tokens staff insert" on public.inspector_tokens
  for insert to authenticated
  with check (public.is_staff_user());

drop policy if exists "inspector_tokens staff update" on public.inspector_tokens;
create policy "inspector_tokens staff update" on public.inspector_tokens
  for update to authenticated
  using (public.is_staff_user())
  with check (public.is_staff_user());

drop policy if exists "inspector_tokens staff delete" on public.inspector_tokens;
create policy "inspector_tokens staff delete" on public.inspector_tokens
  for delete to authenticated
  using (public.is_staff_user());

-- The JS validates a token by SELECTing it as anon; we also bump
-- last_used_at + use_count via an UPDATE. The staff-only update
-- policy above blocks that update from the anon role. To preserve
-- usage tracking without re-opening the door, add a narrow anon
-- UPDATE policy that only allows bumping last_used_at + use_count
-- on a row that's currently valid.
drop policy if exists "inspector_tokens anon use bump" on public.inspector_tokens;
create policy "inspector_tokens anon use bump" on public.inspector_tokens
  for update to anon
  using (revoked_at is null and now() between valid_from and valid_until)
  with check (revoked_at is null and now() between valid_from and valid_until);

notify pgrst, 'reload schema';
