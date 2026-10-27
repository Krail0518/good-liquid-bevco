-- ════════════════════════════════════════════════════════════════
-- Job intake: one spec sheet per production job, with the formula attached
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   drop trigger if exists on_job_intakes_insert_notify on public.job_intakes;
--   drop function if exists public.trigger_notify_job_intake();
--   drop table if exists public.job_intakes;
--   notify pgrst, 'reload schema';
--   Dropping the table loses every submitted intake; export it first.
--
-- WHY
-- Atlas Canning sends jobs with the spec scattered across emails and texts
-- (end customer, carbonation, can size, lid color, tray format, PakTechs ...).
-- Mike asked for one form that is filled out for every job, with the formula
-- connected to it and an email to him on every submission.
--
-- WHAT
--   public.job_intakes   one row per job. job_no is a server generated,
--                        sequential number (JOB 1001, 1002 ...) nobody can
--                        set or reuse. A formula is required: either a
--                        deal_documents file (uploaded with the intake or
--                        already on file) or a Formula Vault record (staff).
--   trigger              every insert emails/Telegrams Mike through
--                        notify-deal ('job_intake'), at most 10 per client per
--                        hour (CLAUDE.md rule 7).
--
-- PERMISSIONS (CLAUDE.md rules 1 and 3; every policy is scoped)
--   staff (is_gl_staff)      full access
--   portal customer          read their own client's intakes; insert one for
--                            their own client, as themselves, status
--                            'submitted', no staff notes, no Vault formula,
--                            and only a formula document their own client can
--                            already read. No update, no delete.
--   self registered stranger nothing (no policy matches, plus the restrictive
--                            tenant guard)
--   anon                     no grants at all
-- Restrictive guards mirror deal_documents: tenant guard, viewer read only,
-- warehouse role excluded.

create table if not exists public.job_intakes (
  id                 uuid primary key default gen_random_uuid(),
  job_no             bigint generated always as identity (start with 1001) unique,
  client_id          uuid not null references public.clients(id) on delete restrict,
  submitted_by       uuid default auth.uid(),
  submitted_via      text not null default 'portal' check (submitted_via in ('portal','staff')),

  end_customer       text not null check (char_length(end_customer) between 1 and 200),
  product_name       text not null check (char_length(product_name) between 1 and 200),
  job_type           text not null default 'new' check (job_type in ('new','repeat')),
  cases              integer not null check (cases between 1 and 1000000),
  can_size           text not null check (can_size in ('12oz_standard','12oz_sleek','16oz_standard')),
  can_decoration     text not null check (can_decoration in ('printed','sleeved','brite')),
  carbonation        text not null check (carbonation in ('still','carbonated')),
  co2_volumes        numeric(3,2) check (co2_volumes is null or (co2_volumes > 0 and co2_volumes <= 5)),
  lid_color          text not null check (char_length(lid_color) between 1 and 60),
  tray_format        integer not null check (tray_format in (12, 24)),
  shrink_wrap        boolean not null,
  paktech            text not null default 'none' check (paktech in ('none','4','6')),
  paktech_color      text check (paktech_color is null or char_length(paktech_color) <= 60),
  flash_pasteurize   boolean not null default false,
  preservative       text check (preservative is null or char_length(preservative) <= 200),
  pa_letter_on_file  boolean,
  ph_target          text check (ph_target is null or char_length(ph_target) <= 40),
  brix_target        text check (brix_target is null or char_length(brix_target) <= 40),
  client_supplies    text[] not null default '{}'
                     check (client_supplies <@ array['cans','lids','trays','paktechs','ingredients']::text[]),
  date_code          text check (date_code is null or char_length(date_code) <= 200),
  cases_per_pallet   integer check (cases_per_pallet is null or cases_per_pallet between 1 and 1000),
  fg_disposition     text check (fg_disposition is null or fg_disposition in ('pickup','ship','warehouse')),
  needed_by          date,
  notes              text check (notes is null or char_length(notes) <= 4000),

  formula_doc_id     uuid references public.deal_documents(id) on delete set null,
  formula_id         uuid references public.formulas(id) on delete set null,

  status             text not null default 'submitted'
                     check (status in ('submitted','reviewed','scheduled','completed','cancelled')),
  staff_notes        text check (staff_notes is null or char_length(staff_notes) <= 4000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- Carbonated jobs must say how many volumes; still jobs carry none.
  constraint job_intakes_co2_matches check (
    (carbonation = 'carbonated' and co2_volumes is not null)
    or (carbonation = 'still' and co2_volumes is null)
  ),
  -- A PakTech color only means something when there are PakTechs.
  constraint job_intakes_paktech_color check (paktech <> 'none' or paktech_color is null)
);

-- The formula is required when the job is submitted. It is enforced here
-- rather than as a table constraint so that a formula document deleted later
-- (on delete set null) does not make the historical row invalid.
create or replace function public.gl_job_intake_requires_formula()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.formula_doc_id is null and new.formula_id is null then
    raise exception 'a job intake needs its formula attached' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists gl_job_intake_requires_formula on public.job_intakes;
create trigger gl_job_intake_requires_formula
  before insert on public.job_intakes
  for each row execute function public.gl_job_intake_requires_formula();

create index if not exists idx_job_intakes_client on public.job_intakes (client_id, created_at desc);
create index if not exists idx_job_intakes_status on public.job_intakes (status, created_at desc);

drop trigger if exists trg_job_intakes_updated_at on public.job_intakes;
create trigger trg_job_intakes_updated_at
  before update on public.job_intakes
  for each row execute function public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────
alter table public.job_intakes enable row level security;

revoke all on table public.job_intakes from public, anon, authenticated;
grant select, insert, update, delete on table public.job_intakes to authenticated;
grant all on table public.job_intakes to service_role;

drop policy if exists "job_intakes staff all" on public.job_intakes;
create policy "job_intakes staff all" on public.job_intakes
  for all to authenticated
  using (public.is_gl_staff())
  with check (public.is_gl_staff());

drop policy if exists "job_intakes customer read" on public.job_intakes;
create policy "job_intakes customer read" on public.job_intakes
  for select to authenticated
  using (client_id = public.current_customer_client_id());

-- The formula document subquery runs under the customer's own RLS on
-- deal_documents, so it can only name a document they can already read.
drop policy if exists "job_intakes customer insert" on public.job_intakes;
create policy "job_intakes customer insert" on public.job_intakes
  for insert to authenticated
  with check (
    client_id = public.current_customer_client_id()
    and submitted_by = auth.uid()
    and submitted_via = 'portal'
    and status = 'submitted'
    and staff_notes is null
    and formula_id is null
    and formula_doc_id is not null
    and exists (
      select 1 from public.deal_documents d
       where d.id = job_intakes.formula_doc_id
         and d.client_id = job_intakes.client_id
    )
  );

drop policy if exists "gl tenant guard" on public.job_intakes;
create policy "gl tenant guard" on public.job_intakes
  as restrictive for all to authenticated
  using (public.is_gl_staff() or client_id = public.current_customer_client_id())
  with check (public.is_gl_staff() or client_id = public.current_customer_client_id());

drop policy if exists "gl viewer no insert" on public.job_intakes;
create policy "gl viewer no insert" on public.job_intakes
  as restrictive for insert to authenticated
  with check (not public.gl_is_viewer());

drop policy if exists "gl viewer no update" on public.job_intakes;
create policy "gl viewer no update" on public.job_intakes
  as restrictive for update to authenticated
  using (not public.gl_is_viewer()) with check (not public.gl_is_viewer());

drop policy if exists "gl viewer no delete" on public.job_intakes;
create policy "gl viewer no delete" on public.job_intakes
  as restrictive for delete to authenticated
  using (not public.gl_is_viewer());

drop policy if exists "gl warehouse guard" on public.job_intakes;
create policy "gl warehouse guard" on public.job_intakes
  as restrictive for all to authenticated
  using (not public.gl_is_warehouse()) with check (not public.gl_is_warehouse());

-- ── Alert Mike on every new job ──────────────────────────────────
create or replace function public.trigger_notify_job_intake()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_secret  text;
  v_recent  integer;
  v_client  text;
  v_formula text;
  v_url     constant text := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/notify-deal';
  -- The publishable (anon) key, same as every other notify trigger; the
  -- Vault secret in the body is what authorizes the call.
  v_headers constant jsonb := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE'
  );
begin
  begin
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'gl_notify_secret' limit 1;
  exception when others then
    v_secret := '';
  end;
  if v_secret is null or v_secret = '' then
    return null;
  end if;

  -- Rule 7: past 10 intakes from one client in an hour, stop alerting one by
  -- one. The rows are kept; the CRM list still shows every one.
  select count(*) into v_recent
    from public.job_intakes
   where client_id = new.client_id
     and created_at > now() - interval '1 hour';
  if v_recent > 10 then
    return null;
  end if;

  select name into v_client from public.clients where id = new.client_id;
  if new.formula_doc_id is not null then
    select coalesce(name, 'formula document') into v_formula
      from public.deal_documents where id = new.formula_doc_id;
  elsif new.formula_id is not null then
    select coalesce(name, 'Formula Vault record') || ' (Formula Vault)' into v_formula
      from public.formulas where id = new.formula_id;
  end if;

  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object(
      'event',  'job_intake',
      'secret', v_secret,
      'data',   jsonb_build_object(
        'job_no',          new.job_no::text,
        'client',          coalesce(v_client, ''),
        'via',             new.submitted_via,
        'end_customer',    left(new.end_customer, 200),
        'product',         left(new.product_name, 200),
        'job_type',        new.job_type,
        'cases',           new.cases::text,
        'can_size',        new.can_size,
        'can_decoration',  new.can_decoration,
        'carbonation',     new.carbonation,
        'co2_volumes',     coalesce(new.co2_volumes::text, ''),
        'lid_color',       left(new.lid_color, 60),
        'tray_format',     new.tray_format::text,
        'shrink_wrap',     case when new.shrink_wrap then 'yes' else 'no' end,
        'paktech',         new.paktech,
        'paktech_color',   coalesce(left(new.paktech_color, 60), ''),
        'flash_pasteurize',case when new.flash_pasteurize then 'yes' else 'no' end,
        'preservative',    coalesce(left(new.preservative, 200), ''),
        'pa_letter',       case when new.pa_letter_on_file is null then '' when new.pa_letter_on_file then 'yes' else 'no' end,
        'ph_target',       coalesce(new.ph_target, ''),
        'brix_target',     coalesce(new.brix_target, ''),
        'client_supplies', array_to_string(new.client_supplies, ', '),
        'date_code',       coalesce(left(new.date_code, 200), ''),
        'cases_per_pallet',coalesce(new.cases_per_pallet::text, ''),
        'fg_disposition',  coalesce(new.fg_disposition, ''),
        'needed_by',       coalesce(new.needed_by::text, ''),
        'formula',         coalesce(left(v_formula, 200), ''),
        'notes',           coalesce(left(new.notes, 1500), '')
      )
    ),
    headers := v_headers
  );
  return null;
exception when others then
  return null;  -- never block the job from saving
end;
$$;

revoke all on function public.trigger_notify_job_intake() from public, anon, authenticated;
grant execute on function public.trigger_notify_job_intake() to service_role;
revoke all on function public.gl_job_intake_requires_formula() from public, anon;

drop trigger if exists on_job_intakes_insert_notify on public.job_intakes;
create trigger on_job_intakes_insert_notify
  after insert on public.job_intakes
  for each row
  execute function public.trigger_notify_job_intake();

notify pgrst, 'reload schema';
