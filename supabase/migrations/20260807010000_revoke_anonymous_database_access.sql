-- ════════════════════════════════════════════════════════════════
-- CRITICAL: revoke anonymous (public-internet) access to business data
-- ════════════════════════════════════════════════════════════════
-- Found by the 2026-08-06 full audit. Fourteen tables carried a policy
-- named `anon_all` — FOR ALL TO anon USING (true) WITH CHECK (true) —
-- backed by SELECT/INSERT/UPDATE/DELETE grants to the `anon` role. The
-- publishable key that ships in the page source is all an attacker
-- needed, so ANY internet user could read the entire client roster,
-- every invoice, and the whole sales pipeline — and could equally
-- update or delete all of it.
--
-- These policies were never in this repo (grep finds nothing): they were
-- applied out-of-band via the dashboard, which is why the earlier
-- hardening passes (20260523, 20260725) never removed them. They also
-- silently defeated the inspector-token and invoice-share-token designs,
-- since anon already had unconditional access.
--
-- Staff access is unaffected: every one of these tables has its own
-- `authenticated` policies (…staff select / authed all / super delete).
--
-- THREE legitimate anonymous paths are preserved deliberately:
--   1. public quote form  → INSERT into deals            (index.html)
--   2. public NPS survey  → INSERT into nps_responses
--   3. FDA inspector links → SELECT via is_valid_inspector_token()
--      on defects, formulas, production_runs, vendors, yield_logs
-- The public invoice link (?invoice_view=) needs NO anon table access:
-- it goes through the get_shared_invoice() SECURITY DEFINER RPC.
--
-- ROLLBACK (only if a public flow breaks — re-opens the hole):
--   create policy "anon_all" on public.<table> for all to anon
--     using (true) with check (true);
--   grant select, insert, update, delete on public.<table> to anon;

-- ── 1. Drop the blanket anon policies ──────────────────────────────
drop policy if exists "anon_all" on public.clients;
drop policy if exists "anon_all" on public.content_calendar;
drop policy if exists "anon_all" on public.deals;
drop policy if exists "anon_all" on public.defects;
drop policy if exists "anon_all" on public.formulas;
drop policy if exists "anon_all" on public.invoices;
drop policy if exists "anon_all" on public.nps_responses;
drop policy if exists "anon_all" on public.production_runs;
drop policy if exists "anon_all" on public.referrals;
drop policy if exists "anon_all" on public.referrers;
drop policy if exists "anon_all" on public.sample_shipments;
drop policy if exists "anon_all" on public.trade_shows;
drop policy if exists "anon_all" on public.vendors;
drop policy if exists "anon_all" on public.yield_logs;

-- Anonymous writes to the public capacity badge (staff are authenticated).
drop policy if exists "anon write" on public.capacity;
revoke insert, update, delete on public.capacity from anon;

-- Rate cards: "Auth write" was FOR ALL TO public USING (true) with no
-- with_check — i.e. anyone, including anon, could rewrite pricing.
drop policy if exists "Auth write" on public.bottling_rates;
drop policy if exists "Auth write" on public.canning_rates;
create policy "bottling_rates staff write" on public.bottling_rates
  for all to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "canning_rates staff write" on public.canning_rates
  for all to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
revoke insert, update, delete on public.bottling_rates from anon;
revoke insert, update, delete on public.canning_rates from anon;

-- ── 2. Revoke the table grants that backed the policies ────────────
revoke all on public.clients          from anon;
revoke all on public.content_calendar from anon;
revoke all on public.deals            from anon;
revoke all on public.defects          from anon;
revoke all on public.formulas         from anon;
revoke all on public.invoices         from anon;
revoke all on public.nps_responses    from anon;
revoke all on public.production_runs  from anon;
revoke all on public.referrals        from anon;
revoke all on public.referrers        from anon;
revoke all on public.sample_shipments from anon;
revoke all on public.trade_shows      from anon;
revoke all on public.vendors          from anon;
revoke all on public.yield_logs       from anon;

-- ── 3. Restore ONLY the legitimate anonymous paths ─────────────────
-- (a) Public "Request a Quote" form creates a Prospecting deal.
drop policy if exists "deals anon insert public quote" on public.deals;
create policy "deals anon insert public quote" on public.deals
  for insert to anon with check (true);
grant insert on public.deals to anon;

-- (b) Public NPS survey (policy "nps insert public" already exists).
grant insert on public.nps_responses to anon;

-- (c) FDA inspector share links — the existing
--     `… inspector read` policies gate on is_valid_inspector_token();
--     they need the SELECT grant to be reachable at all.
grant select on public.defects         to anon;
grant select on public.formulas        to anon;
grant select on public.production_runs to anon;
grant select on public.vendors         to anon;
grant select on public.yield_logs      to anon;

notify pgrst, 'reload schema';
