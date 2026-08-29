-- GL-SEC-04 and GL-SEC-05, from the independent security audit of 2026-08-28.
--
-- ROLLBACK:
--   create policy "canning_rates authed all" on public.canning_rates
--     for all to authenticated using (true) with check (true);
--   create policy "bottling_rates authed all" on public.bottling_rates
--     for all to authenticated using (true) with check (true);
--   (and re-apply the previous gl_send_quote_decks body)
--   Do NOT roll these back during a normal release — they are security
--   controls, not behaviour changes.
--
-- ── GL-SEC-04: global pricing writable by any authenticated identity ──
--
-- canning_rates and bottling_rates each carried BOTH:
--     "<table> authed all"   FOR ALL TO authenticated USING(true) WITH CHECK(true)
--     "<table> staff write"  FOR ALL TO authenticated USING(is_staff_user())
--
-- The staff policy is PERMISSIVE, so it ORs with the blanket one rather than
-- constraining it. The intent was staff-only writes; the effect was that every
-- authenticated identity — including every portal customer — could INSERT,
-- UPDATE or DELETE the global canning and bottling price ladders that the
-- quote builder reads.
--
-- Both tables were on the deliberate exclusion list in
-- 20260807020000_tenant_isolation_guard.sql alongside capacity, case_studies
-- and resources. 20260828221639 fixed those three and did not revisit these
-- two — found by independent audit, not by this repo's own sweep.
--
-- Grants tightened too: authenticated held TRUNCATE, TRIGGER and REFERENCES,
-- and anon held TRUNCATE, TRIGGER and REFERENCES with no SELECT among them.
-- TRUNCATE is not subject to RLS, so no policy covered it. Not reachable
-- through PostgREST, which does not expose TRUNCATE, but it has no reason to
-- exist.

drop policy if exists "canning_rates authed all"  on public.canning_rates;
drop policy if exists "bottling_rates authed all" on public.bottling_rates;

revoke all on public.canning_rates  from anon, authenticated;
revoke all on public.bottling_rates from anon, authenticated;
grant select                          on public.canning_rates, public.bottling_rates to anon;
grant select, insert, update, delete  on public.canning_rates, public.bottling_rates to authenticated;

-- ── GL-SEC-05: unguarded SECURITY DEFINER quote-deck dispatcher ──────
--
-- gl_send_quote_decks is SECURITY DEFINER, EXECUTE-able by `authenticated`,
-- reads gl_notify_secret out of Vault and posts it to an Edge Function via
-- pg_net — with no authorization check of any kind. Any authenticated
-- identity, including a portal customer, could trigger a secret-bearing
-- outbound request for an arbitrary deal_id.
--
-- Present impact is bounded only because the target quote-decks function is
-- not deployed. That is a deployment accident, not a control, and it becomes
-- HIGH the moment the endpoint ships.
--
-- The staff check goes at the top, before the Vault read and before pg_net.
--
-- The outer `exception when others then return` in the original body would
-- have swallowed the authorization error and returned silently, so the handler
-- now re-raises insufficient_privilege specifically. A caller that is not
-- allowed to do this should be told, not quietly ignored — silent refusal is
-- how the unchecked-write class of bug in this codebase stayed invisible.

create or replace function public.gl_send_quote_decks(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_secret text;
begin
  -- Authorization FIRST: before the Vault read, before any pg_net enqueue.
  if not public.is_staff_user() then
    raise exception 'Not authorized to send quote decks'
      using errcode = '42501';
  end if;

  if p_deal_id is null then return; end if;

  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets
     where name = 'gl_notify_secret'
     limit 1;
  exception when others then
    v_secret := '';
  end;

  if coalesce(v_secret, '') = '' then return; end if;

  perform net.http_post(
    url     := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/quote-decks',
    body    := jsonb_build_object('deal_id', p_deal_id, 'secret', v_secret),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 30000
  );
exception
  -- Let an authorization refusal reach the caller; keep the original
  -- best-effort behaviour for transport failures.
  when insufficient_privilege then raise;
  when others then return;
end $function$;

revoke all on function public.gl_send_quote_decks(uuid) from public, anon;
grant execute on function public.gl_send_quote_decks(uuid) to authenticated, service_role;

-- ── Follow-up on 20260828223520 ──────────────────────────────────────
-- That migration revoked gl_purge_expired_qbo_states from anon and
-- authenticated but not from PUBLIC, so the routine ACL still showed `=X`
-- (PUBLIC holds EXECUTE). It only deletes expired rows, so the impact is
-- small, but a default-PUBLIC grant on a SECURITY DEFINER function is exactly
-- the shape worth removing. Caught by the same independent audit.
revoke all on function public.gl_purge_expired_qbo_states() from public, anon, authenticated;
grant execute on function public.gl_purge_expired_qbo_states() to service_role;
