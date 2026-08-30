-- ============================================================
-- deals.outreach_status — 2026-05-25
--
-- Tracks whether a lead in the pipeline has been contacted by
-- email (outside the CRM), and whether they responded.
--
-- Values:
--   NULL         = no outreach logged yet
--   'sent'       = email sent, awaiting reply
--   'replied'    = lead replied (positive or otherwise)
--   'no_response'= no reply after follow-up; cold lead
--
-- Staff can update their own deals' outreach status.
-- Idempotent — safe to re-run.
-- ============================================================

alter table public.deals
  add column if not exists outreach_status text
    check (outreach_status is null
        or outreach_status in ('sent','replied','no_response')),
  add column if not exists outreach_at timestamptz;

-- Auto-stamp outreach_at when status is first set to 'sent'
create or replace function public.deals_outreach_stamp()
returns trigger language plpgsql security definer as $$
begin
  if new.outreach_status = 'sent' and old.outreach_status is distinct from 'sent' then
    new.outreach_at = now();
  end if;
  return new;
end;$$;

drop trigger if exists trg_deals_outreach_stamp on public.deals;
create trigger trg_deals_outreach_stamp
  before update on public.deals
  for each row execute function public.deals_outreach_stamp();

notify pgrst, 'reload schema';
