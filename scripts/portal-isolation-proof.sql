-- portal-isolation-proof.sql — the LIVE half of the portal v2 tenant checks.
--
-- WHY THIS EXISTS
-- ---------------
-- tests/portal-tenant-isolation.test.cjs reads migration text and proves the
-- guards are DEFINED. It cannot prove the database BEHAVES. Both halves are
-- required and neither substitutes for the other (tests/payment-ledger.test.cjs).
--
-- It exists in this shape because the portal-v2 design got column visibility
-- wrong twice, and both wrong answers would have passed a static review:
--   * v1 omitted internal_note from the portal's SELECT. RLS is ROW-level.
--   * v2 used security_invoker views that omitted `actor`/`decided_by`, which
--     still requires the caller to hold SELECT on the base table.
-- Hence the probes below read the FORBIDDEN COLUMNS BY NAME, the way a curious
-- customer with the publishable key and a browser console would.
--
-- FIVE IDENTITIES: staff, the client's own active portal user, another
-- client's portal user, a DEACTIVATED portal user, and a self-registered
-- stranger.
--
-- HOW TO RUN
--   Supabase SQL editor or the Management API /database/query endpoint.
--   (The "Apply SQL file" workflow only runs files under supabase/migrations/.)
--
-- SAFETY
--   One DO block that ALWAYS raises at the end, so the transaction rolls back
--   whether it passes or fails. Nothing is written that survives.
--
--   TWO TRAPS this deliberately avoids, both documented in scripts/rls-probe.sql:
--     * target ids are captured as LITERALS before any role switch -- an
--       `insert ... select` that reads zero rows inserts zero rows and scores
--       as a pass when it is actually a blocked read.
--     * every write checks GET DIAGNOSTICS row_count rather than trusting the
--       absence of an exception.
--
--   Reading the raised message IS the result:
--     "PORTAL ISOLATION HOLDS"     — everything is as intended
--     "PORTAL ISOLATION VIOLATED"  — read the detail, something regressed

DO $outer$
DECLARE
  stranger     uuid := '00000000-0000-0000-0000-0000000000ff';
  staff_id     uuid;
  portal_uid   uuid;
  portal_cid   uuid;
  other_uid    uuid;
  dead_uid     uuid;
  proj_id      uuid;
  other_proj   uuid;
  n            int;
  problems     text := '';
  note         text := '';
BEGIN
  -- ── Identities, captured BEFORE any role switch ──────────────────────────
  select id into staff_id from public.profiles
   where coalesce(status,'active') <> 'inactive' limit 1;

  select cu.auth_user_id, cu.client_id into portal_uid, portal_cid
    from public.customer_users cu
   where cu.auth_user_id is not null and cu.active = true limit 1;

  select cu.auth_user_id into other_uid
    from public.customer_users cu
   where cu.auth_user_id is not null and cu.active = true
     and cu.client_id is distinct from portal_cid limit 1;

  select cu.auth_user_id into dead_uid
    from public.customer_users cu
   where cu.auth_user_id is not null and cu.active = false limit 1;

  if staff_id is null then
    RAISE EXCEPTION 'cannot run: no active profile to test the staff identity';
  end if;
  if portal_uid is null then
    RAISE EXCEPTION 'cannot run: no active customer_users row to test the portal identity';
  end if;

  select p.id into proj_id from public.projects p
   where p.client_id = portal_cid and p.archived_at is null limit 1;
  select p.id into other_proj from public.projects p
   where p.client_id is distinct from portal_cid limit 1;

  if proj_id is null then
    note := note || E'\n  NOTE: no project exists for the probe client yet -- project-scoped checks were skipped.';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 1. THE CUSTOMER CANNOT READ INTERNAL COLUMNS BY NAME
  -- ═══════════════════════════════════════════════════════════════════════
  BEGIN
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', portal_uid, 'role', 'authenticated')::text, true);

    select count(*) into n from public.gl_internal_notes;
    if n <> 0 then
      problems := problems || E'\n  gl_internal_notes: customer read ' || n || ' row(s); expected 0';
    end if;

    select count(*) into n from public.project_entitlement_events;
    if n <> 0 then
      problems := problems || E'\n  project_entitlement_events.actor: customer read ' || n || ' row(s); expected 0';
    end if;

    -- The exposure closed by 20260914090300. Naming the column is the point.
    select count(*) into n from public.formulas;
    if n <> 0 then
      problems := problems || E'\n  formulas: customer read ' || n || ' row(s) -- ingredients are reachable again';
    end if;
  EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
    null;  -- denial is the expected outcome
  END;
  reset role;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 2. THE RPCs RETURN THE CALLER'S OWN DATA
  -- ═══════════════════════════════════════════════════════════════════════
  BEGIN
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', portal_uid, 'role', 'authenticated')::text, true);

    select count(*) into n from public.gl_portal_formula_status();
    -- Not an assertion on the count: the client may legitimately have none.
    note := note || E'\n  gl_portal_formula_status() returned ' || n || ' row(s) for the probe customer.';

    select count(*) into n from public.gl_portal_entitlements();
    note := note || E'\n  gl_portal_entitlements() returned ' || n || ' row(s) for the probe customer.';
  EXCEPTION WHEN others THEN
    problems := problems || E'\n  portal RPCs raised for a legitimate customer: ' || SQLERRM;
  END;
  reset role;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 3. ANOTHER CLIENT'S CUSTOMER SEES NOTHING OF THIS CLIENT
  -- ═══════════════════════════════════════════════════════════════════════
  if other_uid is not null and proj_id is not null then
    BEGIN
      set local role authenticated;
      perform set_config('request.jwt.claims',
        json_build_object('sub', other_uid, 'role', 'authenticated')::text, true);

      select count(*) into n from public.projects where id = proj_id;
      if n <> 0 then
        problems := problems || E'\n  projects: another client read this client''s project';
      end if;

      select count(*) into n from public.project_milestones where project_id = proj_id;
      if n <> 0 then
        problems := problems || E'\n  project_milestones: another client read ' || n || ' milestone(s)';
      end if;
    EXCEPTION WHEN insufficient_privilege THEN
      null;
    END;
    reset role;
  else
    note := note || E'\n  NOTE: no second active portal client -- cross-tenant check skipped.';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 4. A DEACTIVATED CUSTOMER SEES NOTHING
  -- ═══════════════════════════════════════════════════════════════════════
  if dead_uid is not null then
    BEGIN
      set local role authenticated;
      perform set_config('request.jwt.claims',
        json_build_object('sub', dead_uid, 'role', 'authenticated')::text, true);

      select count(*) into n from public.projects;
      if n <> 0 then
        problems := problems || E'\n  projects: a DEACTIVATED customer read ' || n || ' row(s)';
      end if;
      select count(*) into n from public.project_milestones;
      if n <> 0 then
        problems := problems || E'\n  project_milestones: a DEACTIVATED customer read ' || n || ' row(s)';
      end if;
    EXCEPTION WHEN insufficient_privilege THEN
      null;
    END;
    reset role;
  else
    note := note || E'\n  NOTE: no deactivated customer_users row -- that identity was not exercised.';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 5. A SELF-REGISTERED STRANGER SEES NOTHING
  -- ═══════════════════════════════════════════════════════════════════════
  BEGIN
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', stranger, 'role', 'authenticated')::text, true);

    select count(*) into n from public.projects;
    if n <> 0 then problems := problems || E'\n  projects: a STRANGER read ' || n || ' row(s)'; end if;
    select count(*) into n from public.project_milestones;
    if n <> 0 then problems := problems || E'\n  project_milestones: a STRANGER read ' || n || ' row(s)'; end if;
    select count(*) into n from public.gl_internal_notes;
    if n <> 0 then problems := problems || E'\n  gl_internal_notes: a STRANGER read ' || n || ' row(s)'; end if;
    select count(*) into n from public.project_entitlement_events;
    if n <> 0 then problems := problems || E'\n  project_entitlement_events: a STRANGER read ' || n || ' row(s)'; end if;
    select count(*) into n from public.formulas;
    if n <> 0 then problems := problems || E'\n  formulas: a STRANGER read ' || n || ' row(s)'; end if;
  EXCEPTION WHEN insufficient_privilege THEN
    null;
  END;
  reset role;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 6. THE LEDGER IS APPEND-ONLY, EVEN FOR STAFF
  -- ═══════════════════════════════════════════════════════════════════════
  if proj_id is not null then
    BEGIN
      insert into public.project_entitlement_events (project_id, service_key, action, actor)
      values (proj_id, 'renders', 'grant', staff_id);
      GET DIAGNOSTICS n = ROW_COUNT;
      if n <> 1 then
        problems := problems || E'\n  entitlement insert wrote ' || n || ' row(s) as owner; expected 1';
      end if;

      BEGIN
        update public.project_entitlement_events set action = 'revoke'
         where project_id = proj_id;
        problems := problems || E'\n  entitlement ledger accepted an UPDATE -- it must be append-only';
      EXCEPTION WHEN insufficient_privilege THEN
        null;  -- correct
      END;

      BEGIN
        delete from public.project_entitlement_events where project_id = proj_id;
        problems := problems || E'\n  entitlement ledger accepted a DELETE -- history must survive';
      EXCEPTION WHEN insufficient_privilege THEN
        null;  -- correct
      END;
    EXCEPTION WHEN others THEN
      problems := problems || E'\n  entitlement append-only probe errored: ' || SQLERRM;
    END;
  end if;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 7. TENANT CONSISTENCY: A's DOCUMENT CANNOT JOIN B's PROJECT
  -- ═══════════════════════════════════════════════════════════════════════
  -- Run as owner, i.e. with MORE authority than staff have. If the constraint
  -- holds here it holds for every caller, because it is a foreign key rather
  -- than a policy.
  if other_proj is not null then
    BEGIN
      update public.deal_documents
         set project_id = other_proj
       where client_id = portal_cid
       limit 1;
      problems := problems || E'\n  deal_documents accepted a cross-tenant project_id -- the composite FK is not holding';
    EXCEPTION
      WHEN foreign_key_violation THEN null;   -- correct
      WHEN syntax_error THEN
        -- UPDATE ... LIMIT is not valid Postgres; retry the honest way.
        BEGIN
          update public.deal_documents
             set project_id = other_proj
           where id = (select id from public.deal_documents
                        where client_id = portal_cid limit 1);
          problems := problems || E'\n  deal_documents accepted a cross-tenant project_id';
        EXCEPTION WHEN foreign_key_violation THEN null;
        END;
      WHEN others THEN
        problems := problems || E'\n  cross-tenant document probe errored: ' || SQLERRM;
    END;
  else
    note := note || E'\n  NOTE: only one client has a project -- the cross-tenant FK check was skipped.';
  end if;

  -- ═══════════════════════════════════════════════════════════════════════
  -- 8. TRIGGER-ONLY FUNCTIONS ARE NOT CALLABLE BY ANY UNTRUSTED ROLE
  -- ═══════════════════════════════════════════════════════════════════════
  -- `revoke ... from public, anon` is not sufficient on Supabase: the project's
  -- default privileges grant EXECUTE to `authenticated` separately, so a
  -- SECURITY DEFINER trigger function stays reachable at /rest/v1/rpc/<fn>
  -- until authenticated is revoked explicitly. Supabase lint 0029 caught all
  -- six of these. A trigger does not need EXECUTE to fire, so the correct
  -- privilege for every one of them is none at all.
  DECLARE
    fn text;
    trigger_only text[] := array[
      'gl_audit_actor_email','gl_audit_milestone','gl_audit_entitlement',
      'gl_audit_document_visibility','gl_audit_artwork_project',
      'gl_stamp_project_milestones','gl_guard_entitlement_append_only',
      'gl_stamp_entitlement_event'];
    portal_rpcs text[] := array[
      'gl_portal_entitlements','gl_portal_formula_status','gl_can_read_formula'];
  BEGIN
    foreach fn in array trigger_only loop
      perform 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = fn
         and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE')
           or has_function_privilege('public', p.oid, 'EXECUTE'));
      if found then
        problems := problems || E'\n  ' || fn || '() is EXECUTE-able by an untrusted role';
      end if;
    end loop;

    -- ...and the three that the portal genuinely calls must keep theirs, so a
    -- blanket revoke cannot silently break the customer surface.
    foreach fn in array portal_rpcs loop
      perform 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
       where ns.nspname = 'public' and p.proname = fn
         and has_function_privilege('authenticated', p.oid, 'EXECUTE');
      if not found then
        problems := problems || E'\n  ' || fn || '() lost EXECUTE -- the portal cannot read it';
      end if;
    end loop;

    note := note || E'\n  8 trigger-only functions locked; 3 portal RPCs still callable';
  END;

  -- Direct invocation, as a real portal customer rather than by privilege
  -- lookup: the API-shaped version of the same question.
  BEGIN
    set local role authenticated;
    perform set_config('request.jwt.claims',
      json_build_object('sub', portal_uid, 'role', 'authenticated')::text, true);
    BEGIN
      perform public.gl_audit_actor_email();
      problems := problems || E'\n  a customer INVOKED gl_audit_actor_email()';
    EXCEPTION WHEN insufficient_privilege THEN null;
    END;
    BEGIN
      perform public.gl_stamp_project_milestones();
      problems := problems || E'\n  a customer INVOKED gl_stamp_project_milestones()';
    EXCEPTION WHEN insufficient_privilege THEN null;
      WHEN others THEN
        problems := problems || E'\n  gl_stamp_project_milestones() reachable, raised: ' || SQLERRM;
    END;
  END;
  reset role;

  -- ── Result ───────────────────────────────────────────────────────────────
  if problems = '' then
    RAISE EXCEPTION E'PORTAL ISOLATION HOLDS (transaction rolled back)%', note;
  else
    RAISE EXCEPTION E'PORTAL ISOLATION VIOLATED:%\n---%', problems, note;
  end if;
END
$outer$;
