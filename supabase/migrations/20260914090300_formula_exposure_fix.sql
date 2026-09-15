-- ════════════════════════════════════════════════════════════════
-- Client portal v2 (4/5) — close the formulas exposure
-- ════════════════════════════════════════════════════════════════
-- FINDING, verified against production 2026-09-14.
--
-- public.formulas carries THREE permissive USING (true) policies for the
-- authenticated role -- "authed all", "formulas authed", "formulas authed all".
-- The only thing scoping a portal customer is the RESTRICTIVE gl tenant guard,
-- which limits them to their own client's rows -- ALL COLUMNS, ALL STATUSES.
--
-- So a logged-in portal customer can today run:
--
--     GET /rest/v1/formulas?select=ingredients,notes
--
-- and read every formula belonging to their client, drafts included. The
-- .neq('status','draft') filter at portal-customer.js:280 is cosmetic: it
-- filters the UI, not the API.
--
-- The table currently holds 0 rows, so nothing has leaked. The first formula
-- anyone creates is exposed. Our clients are competing beverage brands and a
-- formulation is the most valuable thing in this database, so this ships
-- whether or not the rest of the portal work lands.
--
-- FIX. Customers lose direct access to public.formulas entirely -- the tenant
-- guard becomes staff-only -- and the portal reads a security definer RPC whose
-- RETURN TYPE has no ingredients, no notes, no allergens. There is no column to
-- ask for. Per CLAUDE.md rule 3 the legacy permissive policies are constrained
-- rather than rewritten.
--
-- A view was rejected: a view in the public schema runs as its owner and
-- silently bypasses the base table's RLS, and a security_invoker view would
-- require the customer to keep SELECT on formulas, which is the thing being
-- removed.
--
-- ROLLBACK:
--   drop function if exists public.gl_portal_formula_status();
--   drop function if exists public.gl_can_read_formula(uuid);
--   drop policy if exists "gl tenant guard" on public.formulas;
--   create policy "gl tenant guard" on public.formulas as restrictive to authenticated
--     using (public.is_gl_staff()
--            or client_id = (public.current_customer_client_id())::text);
--   Reverting RESTORES THE EXPOSURE described above: every portal customer
--   regains column-level access to their client's formulations, drafts
--   included. Do not revert without replacing the protection.

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────
-- formulas becomes staff-only
-- ────────────────────────────────────────────────────────────────
drop policy if exists "gl tenant guard" on public.formulas;

create policy "gl tenant guard" on public.formulas
  as restrictive to authenticated
  using (public.is_gl_staff());

-- ────────────────────────────────────────────────────────────────
-- Authorization helper: returns a boolean, never a tenant id
-- ────────────────────────────────────────────────────────────────
-- Used by formula_documents in phase 3. It answers "may I read this formula?"
-- and nothing else -- an earlier draft returned the owning client_id, which
-- turns an access check into an ownership oracle for any id a caller can guess.
-- The active-customer test lives inside: a deactivated customer resolves
-- current_customer_client_id() to null and the exists() is false.
create or replace function public.gl_can_read_formula(p_formula_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select exists (
    select 1 from public.formulas f
    where f.id = p_formula_id
      and public.current_customer_client_id() is not null
      and f.client_id = public.current_customer_client_id()::text
  );
$fn$;

revoke all on function public.gl_can_read_formula(uuid) from public, anon;
grant execute on function public.gl_can_read_formula(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────
-- The only customer-facing formula read
-- ────────────────────────────────────────────────────────────────
-- Status and version history. The client sees that the formula is moving and
-- which round it is on; they never see what is in it. Note formulas.client_id
-- is text while every other client_id is uuid -- a known inconsistency in this
-- schema, hence the explicit cast rather than a silent coercion.
create or replace function public.gl_portal_formula_status()
returns table (id uuid, name text, version int, status text, updated_at timestamptz)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select f.id, f.name, f.version, f.status, f.updated_at
  from public.formulas f
  where public.current_customer_client_id() is not null
    and f.client_id = public.current_customer_client_id()::text
    and f.status <> 'draft'
  order by f.updated_at desc;
$fn$;

revoke all on function public.gl_portal_formula_status() from public, anon;
grant execute on function public.gl_portal_formula_status() to authenticated;

notify pgrst, 'reload schema';
