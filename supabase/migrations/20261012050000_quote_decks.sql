-- ════════════════════════════════════════════════════════════════
-- Quote decks: email the capabilities and pricing deck to new website leads
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   drop policy if exists "sales-decks admin writes (insert)" on storage.objects;
--   drop policy if exists "sales-decks admin writes (update)" on storage.objects;
--   drop policy if exists "sales-decks admin writes (delete)" on storage.objects;
--   drop policy if exists "sales_decks admin insert" on public.sales_decks;
--   drop policy if exists "sales_decks admin update" on public.sales_decks;
--   drop index if exists public.sales_decks_one_auto_send;
--   alter table public.sales_decks drop column if exists auto_send;
--   alter table public.deals drop column if exists deck_sent_at;
--   then re-create gl_dispatch_quote_decks from
--   20261012000000_fix_public_quote_form.sql. (Without the quote-decks edge
--   function the dispatch is a harmless no-op either way; rolling back only
--   the function is enough to stop deck emails.)
--
-- WHAT WAS THERE
-- submit_quote_request (the public website form) already calls
-- gl_dispatch_quote_decks(deal) for every new or repeat request, which POSTs
-- to /functions/v1/quote-decks. That function was never built, and the POST
-- carried only a Content-Type header, so the functions gateway (verify_jwt)
-- would have refused it before it reached any code.
--
-- WHAT THIS CHANGES
--   1. sales_decks.auto_send: which deck the quote-decks function may email to
--      a prospect. Off by default; on ONLY for good_liquid_capabilities.
--      lotus_nutra_pricing is ANOTHER CLIENT'S confidential pricing and is
--      explicitly set false. A partial unique index allows at most one
--      auto-send deck, so turning a second one on can never silently double
--      what prospects receive. The edge function also refuses any deck whose
--      key or label says "confidential" or names an existing client, so a
--      mistaken toggle still sends nothing.
--   2. deals.deck_sent_at: once per prospect. The edge function CLAIMS a deal
--      with `update ... set deck_sent_at = now() where deck_sent_at is null`
--      before it sends, so two concurrent dispatches (a double-submit) cannot
--      both send; it clears the claim again if the send fails. Chosen over
--      email_log alone because email_log is written AFTER the send and has no
--      atomic claim, and because the deal row is where staff look. email_log
--      (template_name 'sales_deck') is still written for every send and is
--      checked as well, so the same email address is not sent the deck again
--      from a later deal.
--   3. Who may change decks: the CRM screen is admin-only, so the database is
--      too. RESTRICTIVE policies (CLAUDE.md rule 3: constrain, don't rewrite)
--      limit sales_decks INSERT/UPDATE and writes to the sales-decks storage
--      bucket to active admins. Before this, any non-viewer staff login could
--      replace the PDF that goes to every prospect. Reads are unchanged
--      (staff), and portal customers and strangers still get nothing: the
--      permissive policies they would need do not exist.
--   4. gl_dispatch_quote_decks sends the publishable (anon) key as the
--      Authorization bearer, the same shape as every notify trigger
--      (trigger_notify_new_deals in 20261012000000), so the gateway lets it
--      through. The real authorization is the Vault-held gl_notify_secret in
--      the body, checked by the function. It stays service_role-only
--      (callable from SECURITY DEFINER code such as submit_quote_request) and
--      best effort: a deck problem never loses a lead. It now also skips the
--      HTTP call outright for a deal that already has its deck.
--
-- Rate limits (rule 7): submit_quote_request throttles 3/hour per email and
-- 15 per 10 minutes site-wide; the deck goes once per deal and once per email
-- address; and the edge function caps itself at 30 deck emails an hour.

-- ── 1. auto_send ─────────────────────────────────────────────────
alter table public.sales_decks add column if not exists auto_send boolean not null default false;

update public.sales_decks set auto_send = false where key <> 'good_liquid_capabilities' and auto_send;
update public.sales_decks set auto_send = true  where key =  'good_liquid_capabilities' and not auto_send;

create unique index if not exists sales_decks_one_auto_send
  on public.sales_decks (auto_send) where auto_send;

comment on column public.sales_decks.auto_send is
  'Emailed automatically (quote-decks edge function) to every new website quote request, once per prospect. At most one row; admin-only. Never set on a deck that belongs to or names a client.';

-- ── 2. deck_sent_at ──────────────────────────────────────────────
alter table public.deals add column if not exists deck_sent_at timestamptz;

comment on column public.deals.deck_sent_at is
  'When the quote-decks function emailed this prospect the sales deck. Set as a claim before sending and cleared if the send fails.';

-- ── 3. admin-only writes ─────────────────────────────────────────
drop policy if exists "sales_decks admin insert" on public.sales_decks;
create policy "sales_decks admin insert" on public.sales_decks
  as restrictive for insert to authenticated
  with check (public.is_gl_staff() and public.is_admin_user());

drop policy if exists "sales_decks admin update" on public.sales_decks;
create policy "sales_decks admin update" on public.sales_decks
  as restrictive for update to authenticated
  using (public.is_gl_staff() and public.is_admin_user())
  with check (public.is_gl_staff() and public.is_admin_user());

drop policy if exists "sales-decks admin writes (insert)" on storage.objects;
create policy "sales-decks admin writes (insert)" on storage.objects
  as restrictive for insert to authenticated
  with check (bucket_id <> 'sales-decks' or (public.is_gl_staff() and public.is_admin_user()));

drop policy if exists "sales-decks admin writes (update)" on storage.objects;
create policy "sales-decks admin writes (update)" on storage.objects
  as restrictive for update to authenticated
  using (bucket_id <> 'sales-decks' or (public.is_gl_staff() and public.is_admin_user()))
  with check (bucket_id <> 'sales-decks' or (public.is_gl_staff() and public.is_admin_user()));

drop policy if exists "sales-decks admin writes (delete)" on storage.objects;
create policy "sales-decks admin writes (delete)" on storage.objects
  as restrictive for delete to authenticated
  using (bucket_id <> 'sales-decks' or (public.is_gl_staff() and public.is_admin_user()));

-- ── 4. the dispatch ──────────────────────────────────────────────
create or replace function public.gl_dispatch_quote_decks(p_deal_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret  text;
  v_headers constant jsonb := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE'
  );
begin
  if p_deal_id is null then return; end if;
  -- Already has its deck: nothing to send, so do not spend an HTTP call.
  if exists (select 1 from public.deals where id = p_deal_id and deck_sent_at is not null) then
    return;
  end if;
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'gl_notify_secret' limit 1;
  exception when others then
    v_secret := '';
  end;
  if coalesce(v_secret, '') = '' then return; end if;
  perform net.http_post(
    url     := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/quote-decks',
    body    := jsonb_build_object('deal_id', p_deal_id, 'secret', v_secret),
    headers := v_headers,
    timeout_milliseconds := 30000
  );
exception when others then
  return;  -- best effort: a deck problem must never lose the lead
end;
$$;
revoke all on function public.gl_dispatch_quote_decks(uuid) from public, anon, authenticated;
grant execute on function public.gl_dispatch_quote_decks(uuid) to service_role;
