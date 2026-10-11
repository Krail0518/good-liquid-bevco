-- ════════════════════════════════════════════════════════════════
-- email_log: emails Mike sent stored as received; synced duplicates
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   Rows are moved, not destroyed. To restore them:
--     insert into public.email_log
--     select (jsonb_populate_record(null::public.email_log, row_data)).*
--       from public.email_log_removed;
--   The relabelling (direction/from_email/client_id) is not reversed; the
--   old values were wrong (a test client on @goodliquid.com, see below).
--   drop table public.email_log_removed;   -- once nothing needs restoring
--
-- An internal test client ("ZZ Portal QA") has an @goodliquid.com address.
-- gmail-sync matched senders against client addresses and domains, so every
-- email Mike sent looked like it came FROM a client: 525 sent emails were
-- stored as inbound, 450 of them under the test client, and 184 internal
-- emails (alerts and digests to Mike's own address) were pulled into the
-- CRM's correspondence. The same mislabel defeated gmail-sync's duplicate
-- check (it compares the contact address), so 63 emails the CRM had already
-- logged were stored a second time. gmail-sync now decides direction from
-- Gmail's SENT label and never treats Good Liquid's own domains as contacts.
--
-- This migration:
--   1. relabels those 525 rows outbound and re-files each under the client
--      its recipient belongs to (exact address, then company domain, never a
--      free-mail domain), or none for a lead;
--   2. moves the 184 internal ones out of email_log;
--   3. moves the 63 synced duplicates out, copying their client onto the
--      CRM-logged row they duplicate when that row had none.
-- Removed rows go to email_log_removed, which has RLS on and no policies:
-- readable only by postgres/service_role, never by staff or customers.

create table if not exists public.email_log_removed (
  id          uuid primary key,
  row_data    jsonb not null,
  reason      text not null,
  removed_at  timestamptz not null default now()
);
alter table public.email_log_removed enable row level security;
revoke all on public.email_log_removed from anon, authenticated;

-- 1. Relabel and re-file.
with addr as (
  select lower(trim(c.email)) as a, c.id as cid from public.clients c where coalesce(c.email, '') <> ''
  union all
  select lower(trim(x)), c.id from public.clients c,
    jsonb_array_elements_text(case when jsonb_typeof(c.additional_emails) = 'array' then c.additional_emails else '[]'::jsonb end) x
  union all
  select lower(trim(d.email)), d.client_id from public.deals d where coalesce(d.email, '') <> ''
),
addr_ok as (
  select a, cid from addr
   where cid is not null and a !~* '@(goodliquid\.com|goodliquidbevco\.com)$'
),
free(d) as (values ('gmail.com'),('googlemail.com'),('yahoo.com'),('ymail.com'),('yahoo.co.uk'),('hotmail.com'),
  ('outlook.com'),('live.com'),('msn.com'),('aol.com'),('icloud.com'),('me.com'),('mac.com'),('proton.me'),
  ('protonmail.com'),('gmx.com'),('zoho.com'),('mail.com'),('comcast.net'),('verizon.net'),('att.net'),('sbcglobal.net')),
bad as (
  select e.id, lower(trim(e.to_email)) as to_l
    from public.email_log e
   where e.direction = 'inbound'
     and lower(coalesce(e.from_email, '')) ~ '@(goodliquid\.com|goodliquidbevco\.com)$'
)
update public.email_log e
   set direction  = 'outbound',
       from_email = null,
       client_id  = coalesce(
         (select cid from addr_ok where a = b.to_l limit 1),
         (select cid from addr_ok
           where split_part(a, '@', 2) = split_part(b.to_l, '@', 2)
             and split_part(b.to_l, '@', 2) not in (select d from free)
           limit 1))
  from bad b
 where e.id = b.id;

-- 2. Internal mail (to Good Liquid's own addresses) synced only because of
--    the bug: move out.
with gone as (
  delete from public.email_log e
   where e.direction = 'outbound'
     and coalesce(e.mailgun_id ~ '^[0-9a-f]{16}$', false)
     and lower(coalesce(e.to_email, '')) ~ '@(goodliquid\.com|goodliquidbevco\.com)$'
  returning e.*
)
insert into public.email_log_removed (id, row_data, reason)
select g.id, to_jsonb(g), 'internal email synced by the test-client bug' from gone g
on conflict (id) do nothing;

-- 3. Synced copies of emails the CRM already logged.
create temporary table _dups on commit drop as
with v as (
  select e.id, e.client_id, lower(trim(e.to_email)) as to_l,
         lower(regexp_replace(e.subject, '^\s*((re|fw|fwd)\s*:\s*)+', '', 'i')) as subj,
         coalesce(e.sent_at, e.created_at) as at,
         coalesce(e.mailgun_id ~ '^[0-9a-f]{16}$', false) as from_sync
    from public.email_log e
   where e.direction = 'outbound'
)
select s.id as dup_id, k.id as keep_id, s.client_id as dup_client
  from v s
  join v k on s.from_sync and not k.from_sync
          and s.to_l = k.to_l and s.subj = k.subj
          and abs(extract(epoch from (s.at - k.at))) <= 600;

update public.email_log e
   set client_id = d.dup_client
  from (select distinct on (keep_id) keep_id, dup_client from _dups where dup_client is not null) d
 where e.id = d.keep_id and e.client_id is null;

with gone as (
  delete from public.email_log e
   where e.id in (select dup_id from _dups)
  returning e.*
)
insert into public.email_log_removed (id, row_data, reason)
select g.id, to_jsonb(g), 'duplicate of an email the CRM already logged' from gone g
on conflict (id) do nothing;
