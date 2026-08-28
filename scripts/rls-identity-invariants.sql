-- rls-identity-invariants.sql — assert RLS behaves correctly for all THREE
-- identities, not just anon.
--
-- WHY THIS EXISTS
-- ---------------
-- scripts/security-invariants.sh probes production from the outside using only
-- the publishable key, which covers exactly one identity. CLAUDE.md asks for
-- three: active staff, portal customer limited to their own client, and a
-- self-registered stranger.
--
-- Both holes found by the independent audit of 2026-08-28 were invisible to an
-- anon-only probe, because both required an authenticated session:
--   * canning_rates / bottling_rates carried a permissive
--     "FOR ALL TO authenticated USING(true)" alongside a staff-only policy.
--     Permissive policies OR together, so the staff policy constrained nothing
--     and every authenticated identity could rewrite the global price ladder.
--   * gl_send_quote_decks was SECURITY DEFINER, EXECUTE-able by authenticated,
--     read a Vault secret and posted it via pg_net, with no authorization check.
--
-- HOW TO RUN
--   Supabase SQL editor, or the Management API /database/query endpoint, or:
--     gh workflow run "Apply SQL file" -f file=scripts/rls-identity-invariants.sql
--   (that workflow only runs files under supabase/migrations/, so use the SQL
--    editor or the Management API for this one)
--
-- SAFETY
--   Everything runs inside a single DO block that ALWAYS raises at the end, so
--   the transaction is rolled back whether it passes or fails. It writes
--   nothing. The UPDATEs are no-ops by construction (`set col = col`) and exist
--   only to count how many rows each identity is permitted to touch.
--
--   Reading the raised message IS the result:
--     "IDENTITY INVARIANTS HOLD" — everything is as intended
--     "IDENTITY INVARIANT VIOLATED" — read the detail, something regressed

DO $outer$
DECLARE
  stranger    uuid := '00000000-0000-0000-0000-0000000000ff';  -- no profile, no portal link
  staff_id    uuid;
  portal_uid  uuid;
  n_stranger  int  := -1;
  n_portal    int  := -1;
  n_staff     int  := -1;
  sel_public  int  := -1;
  qd_stranger text := 'not attempted';
  problems    text := '';
BEGIN
  select id into staff_id
    from public.profiles
   where coalesce(status,'active') <> 'inactive' and role = 'admin'
   limit 1;
  select auth_user_id into portal_uid
    from public.customer_users
   where auth_user_id is not null
   limit 1;

  if staff_id is null then
    RAISE EXCEPTION 'cannot run: no active admin profile found to test the staff identity';
  end if;

  set local role authenticated;

  -- ── Identity 1: self-registered stranger ────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', stranger::text, 'role','authenticated')::text, true);

  begin
    with u as (update public.canning_rates set price_per_can = price_per_can returning 1)
    select count(*) into n_stranger from u;
  exception when insufficient_privilege then n_stranger := 0;
  end;

  -- Public read of the price ladder is intended — the quote builder and the
  -- marketing site both rely on it. Assert it still works, so a lockdown that
  -- goes too far is caught here rather than by a customer.
  begin
    select count(*) into sel_public from public.canning_rates;
  exception when insufficient_privilege then sel_public := 0;
  end;

  begin
    perform public.gl_send_quote_decks('00000000-0000-0000-0000-000000000001'::uuid);
    qd_stranger := 'ALLOWED';
  exception
    when insufficient_privilege then qd_stranger := 'refused';
    when others then qd_stranger := 'refused(' || SQLSTATE || ')';
  end;

  -- ── Identity 2: portal customer ─────────────────────────────────────
  if portal_uid is not null then
    perform set_config('request.jwt.claims',
      json_build_object('sub', portal_uid::text, 'role','authenticated')::text, true);
    begin
      with u as (update public.canning_rates set price_per_can = price_per_can returning 1)
      select count(*) into n_portal from u;
    exception when insufficient_privilege then n_portal := 0;
    end;
  else
    n_portal := 0;   -- no portal account exists to test with
  end if;

  -- ── Identity 3: active staff ────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', staff_id::text, 'role','authenticated')::text, true);
  begin
    with u as (update public.canning_rates set price_per_can = price_per_can returning 1)
    select count(*) into n_staff from u;
  exception when insufficient_privilege then n_staff := 0;
  end;

  reset role;

  -- ── Verdict ─────────────────────────────────────────────────────────
  if n_stranger <> 0 then
    problems := problems || format('  FAIL stranger updated %s pricing rows (want 0)%s', n_stranger, chr(10));
  end if;
  if n_portal <> 0 then
    problems := problems || format('  FAIL portal customer updated %s pricing rows (want 0)%s', n_portal, chr(10));
  end if;
  if n_staff <= 0 then
    problems := problems || format('  FAIL active staff updated %s pricing rows (want >0) — a lockdown went too far%s', n_staff, chr(10));
  end if;
  if sel_public <= 0 then
    problems := problems || format('  FAIL public SELECT on canning_rates returned %s rows (want >0) — the quote builder is broken%s', sel_public, chr(10));
  end if;
  if qd_stranger <> 'refused' then
    problems := problems || format('  FAIL gl_send_quote_decks for a non-staff identity: %s (want refused)%s', qd_stranger, chr(10));
  end if;

  if problems = '' then
    RAISE EXCEPTION E'IDENTITY INVARIANTS HOLD\n  stranger update=0, portal update=0, staff update=%, public select=%, quote_decks=refused\n  (this exception is how the transaction is rolled back — nothing was written)',
      n_staff, sel_public;
  else
    RAISE EXCEPTION E'IDENTITY INVARIANT VIOLATED\n%', problems;
  end if;
END
$outer$;
