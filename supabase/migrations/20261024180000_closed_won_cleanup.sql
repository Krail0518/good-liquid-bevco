-- ════════════════════════════════════════════════════════════════
-- Closed Won cleanup (owner approved, Oct 24 2026)
-- ════════════════════════════════════════════════════════════════
-- Data only, no schema or permission changes. Idempotent: every statement
-- is guarded so re-running it changes nothing.
--
-- 1. Four deals marked Closed Won that never committed go back to Prospecting
--    (Peak Week, King Boss, Old Ranch Tea, Dirty Pop), with a note saying why.
-- 2. AXON, Nergy 1 and Oryn Nutrition are active formulation clients already
--    onboarded through the formulation team, so they get a client record and a
--    linked deal, and NO CRM onboarding row (so no onboarding email is sent).
--    Their questionnaire and documents carry over with the deal.
--
-- ROLLBACK:
--   update public.deals set stage = 'Closed Won' where id in
--     ('4d4c94f4-ee9c-4586-a6fa-4c3c937fe2f2','5a0cd8d3-bca8-4f37-941a-cf16527d9245',
--      'cba5d83d-8c26-419c-bd49-f055183d6d3b','78da6dcc-1e36-45b5-9f10-3040f81f0c4a');
--   update public.deals set client_id = null where id in
--     ('a558b11d-be13-40e9-a829-84734a326d70','711850c5-19d7-4654-9e99-3362f7fb3be3',
--      'efa62206-f9d0-4921-9f46-11a7ec88e479');
--   delete from public.clients where notes like 'Created Oct 24 2026 from Closed Won deal%';

-- 1) Back to Prospecting
update public.deals
   set stage = 'Prospecting', stage_entered_at = now(), closed_at = null, updated_at = now(),
       notes = coalesce(notes || E'\n', '') || 'Oct 24 2026: moved back from Closed Won to Prospecting. ' ||
         case id
           when '4d4c94f4-ee9c-4586-a6fa-4c3c937fe2f2' then 'No reply to 4 follow ups (Sep 2 to Sep 21); never committed.'
           when '5a0cd8d3-bca8-4f37-941a-cf16527d9245' then 'Kyle paused Sep 22 after a death in the family; will reach back out.'
           when 'cba5d83d-8c26-419c-bd49-f055183d6d3b' then 'NDA and formulation call in Aug; no reply since our Sep 2 NDA follow up.'
           when '78da6dcc-1e36-45b5-9f10-3040f81f0c4a' then 'Pricing calls in July; no commitment or activity since.'
         end
 where id in ('4d4c94f4-ee9c-4586-a6fa-4c3c937fe2f2','5a0cd8d3-bca8-4f37-941a-cf16527d9245',
              'cba5d83d-8c26-419c-bd49-f055183d6d3b','78da6dcc-1e36-45b5-9f10-3040f81f0c4a')
   and stage = 'Closed Won' and client_id is null;

-- 2) Client records for clients onboarded through the formulation team
with src as (
  select d.id as deal_id, d.client_name as cname, d.contact_name, d.email, d.phone, d.city, d.state,
         d.service, d.lead_source,
         upper(left(regexp_replace(d.client_name, '[^A-Za-z0-9 ]', '', 'g'), 1) ||
               coalesce(left(split_part(regexp_replace(d.client_name, '[^A-Za-z0-9 ]', '', 'g'), ' ', 2), 1), '')) as ini
    from public.deals d
   where d.id in ('a558b11d-be13-40e9-a829-84734a326d70','711850c5-19d7-4654-9e99-3362f7fb3be3',
                  'efa62206-f9d0-4921-9f46-11a7ec88e479')
     and d.client_id is null
     and not exists (select 1 from public.clients c where lower(c.email) = lower(d.email))
)
insert into public.clients (name, contact_name, email, phone, city, state, service, status, lead_source, notes, initials)
select cname, contact_name, email, phone, city, state, service, 'active', lead_source,
       'Created Oct 24 2026 from Closed Won deal. Onboarded through the formulation team (Chris), so no CRM onboarding email was sent.',
       case when ini = '' then 'GL' else ini end
  from src;

-- Link the deals (the deals.client_id trigger also carries product_intake over)
update public.deals d
   set client_id = c.id, closed_at = coalesce(d.closed_at, now()), updated_at = now()
  from public.clients c
 where d.id in ('a558b11d-be13-40e9-a829-84734a326d70','711850c5-19d7-4654-9e99-3362f7fb3be3',
                'efa62206-f9d0-4921-9f46-11a7ec88e479')
   and d.client_id is null
   and lower(c.email) = lower(d.email);

update public.product_intake pi
   set client_id = d.client_id, updated_at = now()
  from public.deals d
 where pi.deal_id = d.id and pi.client_id is null and d.client_id is not null
   and d.id in ('a558b11d-be13-40e9-a829-84734a326d70','711850c5-19d7-4654-9e99-3362f7fb3be3',
                'efa62206-f9d0-4921-9f46-11a7ec88e479');

update public.deal_documents dd
   set client_id = d.client_id
  from public.deals d
 where dd.deal_id = d.id and dd.client_id is null and d.client_id is not null
   and d.id in ('a558b11d-be13-40e9-a829-84734a326d70','711850c5-19d7-4654-9e99-3362f7fb3be3',
                'efa62206-f9d0-4921-9f46-11a7ec88e479');

-- Record a Process Authority letter on the client if one came over
update public.clients c
   set pa_letter_file_path = x.file_path, pa_letter_on_file = true
  from (select distinct on (dd.client_id) dd.client_id, dd.file_path
          from public.deal_documents dd
         where dd.deal_id in ('a558b11d-be13-40e9-a829-84734a326d70','711850c5-19d7-4654-9e99-3362f7fb3be3',
                              'efa62206-f9d0-4921-9f46-11a7ec88e479')
           and dd.doc_type = 'Process Authority Letter' and dd.file_path is not null and dd.client_id is not null
         order by dd.client_id, dd.created_at desc) x
 where c.id = x.client_id and coalesce(c.pa_letter_on_file, false) = false;
