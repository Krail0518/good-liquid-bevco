-- ============================================================
-- Schema-gap pack #2 — second round of UI/schema reconciliation
-- ============================================================
-- After PR #78 cleared 10/13 affected tables, three constraints
-- remained:
--   - content_calendar.channel NOT NULL (UI sends platform, not channel)
--   - deals.client_name NOT NULL (UI uses co for company name; client may
--     be set later in the deal lifecycle)
--   - referrals.status CHECK constraint (allowed 'paid' but rejected
--     'pending', 'won', 'lost' — the values the UI actually sets)
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- content_calendar: channel is optional; UI populates platform instead.
alter table public.content_calendar alter column channel drop not null;

-- deals: client_name optional at creation; deal can exist before being
-- attached to a client record.
alter table public.deals alter column client_name drop not null;

-- referrals: replace the status CHECK constraint with one that matches
-- the UI's actual lifecycle: pending → won/lost, won → paid.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'referrals_status_check') then
    alter table public.referrals drop constraint referrals_status_check;
  end if;
end $$;
alter table public.referrals
  add constraint referrals_status_check
  check (status in ('pending','won','lost','paid'));

notify pgrst, 'reload schema';
