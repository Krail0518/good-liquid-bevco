-- lead_followups: at most one PENDING draft per recipient, enforced by the
-- database rather than by application code.
--
-- ROLLBACK:
--   drop index if exists public.lead_followups_one_ready_per_email;
--   drop index if exists public.lead_followups_one_ready_per_deal;
--   -- The dismissed-duplicate backfill is not reversed by dropping the
--   -- indexes. To undo it, note the timestamp this migration ran and:
--   --   update public.lead_followups set status='ready', decided_at=null
--   --    where status='dismissed' and decided_at = '<that timestamp>';
--
-- WHY
-- The lead-automations edge function already tried to avoid stacking drafts:
-- it reads the deal_ids that currently have a 'ready' row and skips those
-- leads. That read's error was never checked, so a failed lookup was
-- indistinguishable from an empty queue and the run drafted the whole list
-- again. It worked on roughly 700 hourly runs and failed on two of them
-- (2026-09-08 21:00 and 2026-09-10 02:00), leaving three stacked drafts per
-- lead. On 2026-09-10 the queue was worked through by hand and eight leads
-- received the same nudge twice, about ninety seconds apart.
--
-- That is the lesson already written at the top of CLAUDE.md, in the read
-- direction: an unchecked result reports success while nothing was actually
-- read. A guard that lives only in application code fails open and fails
-- silently. A unique index cannot — Postgres refuses the second insert
-- whatever the caller believed.
--
-- The edge function is fixed alongside this (it now checks the error and
-- refuses to draft when it cannot see the queue), but these indexes are what
-- make the invariant true regardless of which caller writes the row,
-- including one nobody has written yet.


-- ── 1. Collapse the duplicates that already exist ───────────────────────────
-- Keep the NEWEST pending draft per recipient and dismiss the older ones.
-- Newest wins because its wording and its "no reply in N days" line are
-- current. Dismissed rather than deleted: that is the queue's own vocabulary
-- for "not going out", and the history stays readable.
with ranked as (
  select id,
         row_number() over (
           partition by lower(to_email)
           order by created_at desc, id desc
         ) as rn
    from public.lead_followups
   where status = 'ready'
     and to_email is not null
)
update public.lead_followups f
   set status = 'dismissed',
       decided_at = coalesce(f.decided_at, now())
  from ranked r
 where f.id = r.id
   and r.rn > 1;

-- Same collapse keyed on the deal, which catches any pending row whose
-- to_email is null — the pass above cannot see those.
with ranked as (
  select id,
         row_number() over (
           partition by deal_id
           order by created_at desc, id desc
         ) as rn
    from public.lead_followups
   where status = 'ready'
     and deal_id is not null
)
update public.lead_followups f
   set status = 'dismissed',
       decided_at = coalesce(f.decided_at, now())
  from ranked r
 where f.id = r.id
   and r.rn > 1;

-- ── 2. Make it impossible to stack another one ──────────────────────────────
-- Partial indexes, so they constrain only the pending rows. A lead can have
-- any number of 'sent' and 'dismissed' rows over time — that is the history —
-- but never two waiting to go out.
--
-- Keyed on the address as well as the deal. The address is what the recipient
-- actually experiences, and one contact can hold two open deals, which would
-- otherwise slip two nudges past a deal-only constraint.
create unique index if not exists lead_followups_one_ready_per_email
    on public.lead_followups (lower(to_email))
 where status = 'ready' and to_email is not null;

create unique index if not exists lead_followups_one_ready_per_deal
    on public.lead_followups (deal_id)
 where status = 'ready' and deal_id is not null;

