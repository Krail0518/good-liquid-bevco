-- ════════════════════════════════════════════════════════════════
-- Client portal v2 — phase 2: the artwork decision ledger
-- ════════════════════════════════════════════════════════════════
-- Artwork is the one two-way surface in the portal, and the direction is the
-- reverse of everything else: the CLIENT uploads the label, GOOD LIQUID
-- approves it, and then it goes to the printer. An approval authorises a print
-- run, so it is a commercial decision, not a UI state.
--
-- THE HOLE THIS CLOSES.
-- client_artwork has carried a `status` column since 20260731020000, checked
-- against ('submitted','in_review','approved','rejected'), alongside a policy
-- "client_artwork customer update" with USING/WITH CHECK
-- (client_id = current_customer_client_id()) and NO COLUMN RESTRICTION. While
-- nothing read `status` as authorisation that was inert. The moment it means
-- "approved for print", a portal customer can PATCH status='approved' from the
-- browser console and authorise their own print run.
--
-- That is the CLAUDE.md incident in a new costume: a policy that was correct
-- under an assumption ("status is the client's own label") that this feature
-- silently expires.
--
-- WHY THE CACHE IS REMOVED RATHER THAN GUARDED.
-- An earlier draft kept `status` and synchronised it from the ledger, guarded by
-- current_setting('gl.artwork_sync'). A GUC is caller-settable and is not an
-- authorization boundary. With no second copy of the state there is nothing to
-- desynchronise and nothing to protect, so the column goes.
--
-- Safe as a data operation: all 7 existing rows are 'submitted', which in the
-- new model is exactly "uploaded, no decision yet" -- i.e. NO ledger row. No
-- backfill, no mapping. 'rejected' is retired; it was never written.
--
-- THE STATE MACHINE. `submitted` is not a decision, it is the absence of one.
--
--   (no review) "Submitted" --> in_review | changes_requested | approved
--   in_review               --> changes_requested | approved
--   changes_requested       --> in_review | approved
--   approved                --> sent_to_printer | changes_requested
--   sent_to_printer         --> terminal, nothing follows
--
-- A client answering `changes_requested` uploads a NEW client_artwork row; that
-- row starts fresh and the old one keeps its history.
--
-- ORDERING IS `seq`, NOT `decided_at`. Two decisions inside the same
-- millisecond still sort deterministically, so "current" is
-- `order by seq desc limit 1` and never `order by decided_at`. decided_at is
-- overwritten on insert -- not range-checked -- because there is no legitimate
-- reason for a caller to name it.
--
-- NO client_id COLUMN on the ledger. Authorization derives through artwork_id,
-- so there is no second copy of the tenant key to disagree with the first and
-- no UI-supplied value to trust.
--
-- CUSTOMERS HOLD NO POLICY ON artwork_reviews. RLS is row-level: a customer who
-- could SELECT here could ask for `decided_by`. Their reads go through
-- gl_portal_artwork(), whose return type has no decided_by, no seq, no
-- profiles id.
--
-- ROLLBACK:
--   drop function if exists public.gl_portal_artwork(uuid);
--   drop trigger if exists trg_artwork_reviews_transition on public.artwork_reviews;
--   drop trigger if exists trg_artwork_reviews_append_only on public.artwork_reviews;
--   drop trigger if exists trg_artwork_reviews_audit on public.artwork_reviews;
--   drop function if exists public.gl_guard_artwork_review_transition();
--   drop function if exists public.gl_guard_artwork_review_append_only();
--   drop function if exists public.gl_audit_artwork_decision();
--   drop table if exists public.artwork_reviews;
--   alter table public.client_artwork drop column if exists archived_at;
--   alter table public.client_artwork add column status text not null default 'submitted'
--     check (status in ('submitted','in_review','approved','rejected'));
--   drop policy if exists "client_artwork customer delete" on public.client_artwork;
--   create policy "client_artwork customer delete" on public.client_artwork
--     for delete to authenticated using (client_id = public.current_customer_client_id());
--   drop policy if exists "client_artwork customer read" on public.client_artwork;
--   create policy "client_artwork customer read" on public.client_artwork
--     for select to authenticated using (client_id = public.current_customer_client_id());
--   Reverting restores the writable status column AND the unrestricted customer
--   update policy over it -- i.e. it reopens the self-approval hole described
--   above. Every recorded decision is lost with the table. Do not revert without
--   replacing the protection.

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────
-- The ledger
-- ────────────────────────────────────────────────────────────────
create table public.artwork_reviews (
  seq         bigint generated always as identity primary key,
  id          uuid not null unique default gen_random_uuid(),
  artwork_id  uuid not null references public.client_artwork(id) on delete restrict,
  decision    text not null
                check (decision in ('in_review','changes_requested','approved','sent_to_printer')),
  client_note text,
  decided_by  uuid not null references public.profiles(id),
  decided_at  timestamptz not null default now()
);

create index artwork_reviews_current_idx on public.artwork_reviews (artwork_id, seq desc);

alter table public.artwork_reviews enable row level security;
revoke all on public.artwork_reviews from anon, public;
-- No update, no delete: append-only in the grant as well as the trigger. Two
-- layers, neither relied on alone.
grant select, insert on public.artwork_reviews to authenticated;

create policy "artwork_reviews staff all" on public.artwork_reviews
  for all to authenticated
  using (public.is_gl_staff())
  with check (public.is_gl_staff());

create policy "gl tenant guard" on public.artwork_reviews
  as restrictive to authenticated
  using (public.is_gl_staff())
  with check (public.is_gl_staff());

-- ────────────────────────────────────────────────────────────────
-- Append-only, server-stamped, and the transition must be legal
-- ────────────────────────────────────────────────────────────────
create or replace function public.gl_guard_artwork_review_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $fn$
begin
  raise exception
    'artwork decision % is immutable; record a new decision instead', coalesce(old.seq, 0)
    using errcode = '42501';
end
$fn$;

create trigger trg_artwork_reviews_append_only
  before update or delete on public.artwork_reviews
  for each row execute function public.gl_guard_artwork_review_append_only();

create or replace function public.gl_guard_artwork_review_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_prev text;
  v_ok   boolean;
begin
  -- The timestamp is ours, always. A supplied value is discarded rather than
  -- validated: no caller has a legitimate reason to name it.
  new.decided_at := now();

  select r.decision into v_prev
    from public.artwork_reviews r
   where r.artwork_id = new.artwork_id
   order by r.seq desc
   limit 1;

  v_ok := case coalesce(v_prev, 'submitted')
            when 'submitted'         then new.decision in ('in_review','changes_requested','approved')
            when 'in_review'         then new.decision in ('changes_requested','approved')
            when 'changes_requested' then new.decision in ('in_review','approved')
            when 'approved'          then new.decision in ('sent_to_printer','changes_requested')
            when 'sent_to_printer'   then false
            else false
          end;

  if not v_ok then
    raise exception
      'artwork % cannot go from % to %; sent_to_printer is terminal and a client answers changes_requested by uploading new artwork',
      new.artwork_id, coalesce(v_prev, 'submitted'), new.decision
      using errcode = '42501';
  end if;

  return new;
end
$fn$;

create trigger trg_artwork_reviews_transition
  before insert on public.artwork_reviews
  for each row execute function public.gl_guard_artwork_review_transition();

create or replace function public.gl_audit_artwork_decision()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
begin
  insert into public.audit_log (actor_id, actor_email, action, target, details)
  values (auth.uid(), public.gl_audit_actor_email(),
          'artwork_decision', new.artwork_id::text,
          jsonb_build_object(
            'source', case when auth.uid() is null then 'system' else 'user' end,
            'db_role', current_user,
            'decision', new.decision,
            'seq', new.seq));
  return new;
end
$fn$;

create trigger trg_artwork_reviews_audit
  after insert on public.artwork_reviews
  for each row execute function public.gl_audit_artwork_decision();

-- ────────────────────────────────────────────────────────────────
-- client_artwork: drop the cache, add soft delete, narrow the customer's reach
-- ────────────────────────────────────────────────────────────────
alter table public.client_artwork add column if not exists archived_at timestamptz;

-- The second source of truth goes. Nothing reads it as authorization yet, which
-- is precisely why now is the time.
alter table public.client_artwork drop column if exists status;

-- A client may withdraw their own upload only while nobody has ruled on it.
-- Once a decision exists the row is part of the record -- and the ON DELETE
-- RESTRICT foreign key from artwork_reviews enforces that even if this policy
-- were wrong. Archived rows are also out of reach.
drop policy if exists "client_artwork customer delete" on public.client_artwork;
create policy "client_artwork customer delete" on public.client_artwork
  for delete to authenticated
  using (
    client_id = public.current_customer_client_id()
    and archived_at is null
    and not exists (select 1 from public.artwork_reviews r where r.artwork_id = client_artwork.id)
  );

-- An archived upload is gone from the portal by the same rule an archived
-- project is.
drop policy if exists "client_artwork customer read" on public.client_artwork;
create policy "client_artwork customer read" on public.client_artwork
  for select to authenticated
  using (
    client_id = public.current_customer_client_id()
    and archived_at is null
  );

-- ────────────────────────────────────────────────────────────────
-- The only customer-facing artwork read
-- ────────────────────────────────────────────────────────────────
-- No decided_by, no seq, no profiles id in the return type. "Submitted" is
-- synthesised from the absence of a decision rather than stored anywhere.
create or replace function public.gl_portal_artwork(p_project_id uuid default null)
returns table (artwork_id uuid, project_id uuid, sku_name text, description text,
               file_path text, file_type text, created_at timestamptz,
               state text, decided_at timestamptz, client_note text)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select a.id, a.project_id, a.sku_name, a.description,
         a.file_path, a.file_type, a.created_at,
         coalesce(r.decision, 'submitted'), r.decided_at, r.client_note
  from public.client_artwork a
  left join lateral (
    select x.decision, x.decided_at, x.client_note
      from public.artwork_reviews x
     where x.artwork_id = a.id
     order by x.seq desc
     limit 1
  ) r on true
  where public.current_customer_client_id() is not null
    and a.client_id = public.current_customer_client_id()
    and a.archived_at is null
    and (p_project_id is null or a.project_id = p_project_id)
    and (a.project_id is null or exists (
          select 1 from public.projects p
           where p.id = a.project_id and p.archived_at is null))
  order by a.created_at desc;
$fn$;

revoke all on function public.gl_portal_artwork(uuid) from public, anon;
grant execute on function public.gl_portal_artwork(uuid) to authenticated;

-- Trigger functions are reached only by their triggers. `revoke ... from
-- public, anon` is not enough on Supabase: default privileges also grant
-- EXECUTE to authenticated (lint 0029, and the reason 20260914090500 exists).
revoke all on function public.gl_guard_artwork_review_append_only()  from authenticated, public, anon;
revoke all on function public.gl_guard_artwork_review_transition()   from authenticated, public, anon;
revoke all on function public.gl_audit_artwork_decision()            from authenticated, public, anon;

notify pgrst, 'reload schema';
