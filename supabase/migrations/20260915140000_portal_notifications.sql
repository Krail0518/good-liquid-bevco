-- ════════════════════════════════════════════════════════════════
-- Client portal v2 — phase 4a: tell the client when something needs them
-- ════════════════════════════════════════════════════════════════
-- The portal only works if someone thinks to log in. Everything phases 1-3
-- built — a milestone waiting on the client, a document published, artwork
-- approved — is invisible until they do.
--
-- A DEAD SWITCH, FIRST. customer_users.notify_run_stage_changes has existed
-- since the portal shipped, and the account-settings page offers it in plain
-- words: "get an email each time my run advances between kanban stages". No
-- sender has ever read that column. A preference that promises mail and sends
-- none is worse than no preference; this implements what the checkbox says.
--
-- WHAT THIS DOES NOT BUILD. No new sender, no new cron, no new edge function.
-- email_schedule + the email-scheduler function already claim rows atomically,
-- send via Mailgun and log to email_log. These triggers enqueue into that, and
-- the mail goes out on the existing 15-minute tick.
--
-- TWO PREFERENCES, because they are two different promises:
--   notify_run_stage_changes  — production runs advancing (the existing text)
--   notify_project_updates    — the portal-v2 events (new, defaults on)
--
-- WHAT IS DELIBERATELY NOT SENT: nothing about a formula beyond its name, no
-- ingredient or process detail, and nothing at all for an archived project. A
-- notification is a nudge to come and look, never a copy of the thing.
--
-- ROLLBACK:
--   drop trigger if exists trg_notify_milestone on public.project_milestones;
--   drop trigger if exists trg_notify_document on public.deal_documents;
--   drop trigger if exists trg_notify_artwork_decision on public.artwork_reviews;
--   drop trigger if exists trg_notify_run_stage on public.production_runs;
--   drop function if exists public.gl_notify_milestone();
--   drop function if exists public.gl_notify_document();
--   drop function if exists public.gl_notify_artwork_decision();
--   drop function if exists public.gl_notify_run_stage();
--   drop function if exists public.gl_enqueue_portal_email(uuid, text, text, text);
--   drop function if exists public.portal_update_my_notify_project(boolean);
--   alter table public.customer_users drop column if exists notify_project_updates;
--   Reverting stops the emails. Nothing queued is lost — rows already in
--   email_schedule still send — and the portal itself is unaffected.

set search_path = public, extensions;

alter table public.customer_users
  add column if not exists notify_project_updates boolean not null default true;

-- ────────────────────────────────────────────────────────────────
-- One place that decides who gets told
-- ────────────────────────────────────────────────────────────────
-- SECURITY DEFINER because the triggers below fire for whoever happened to make
-- the change — staff in the CRM, or the service role in a background job — and
-- email_schedule is staff-only. Centralising it also means the tenant rule is
-- written once: recipients are the ACTIVE portal users of THAT client and
-- nobody else.
--
-- p_pref selects which promise is being honoured. An unknown value sends
-- nothing rather than defaulting to "send", so a typo goes quiet instead of
-- mailing people who opted out.
create or replace function public.gl_enqueue_portal_email(
  p_client_id uuid, p_pref text, p_subject text, p_body text)
returns int
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_count int := 0;
  r record;
begin
  if p_client_id is null or coalesce(p_subject,'') = '' then return 0; end if;
  if p_pref not in ('project','run_stage') then return 0; end if;

  for r in
    select cu.email
      from public.customer_users cu
     where cu.client_id = p_client_id
       and cu.active = true
       and coalesce(nullif(cu.email,''), null) is not null
       and case p_pref
             when 'project'   then cu.notify_project_updates
             when 'run_stage' then cu.notify_run_stage_changes
           end is true
  loop
    -- Don't queue the same message to the same person twice in an hour. Staff
    -- editing several milestones in a row should not produce a pile of mail.
    if not exists (
      select 1 from public.email_schedule e
       where e.to_email = r.email
         and e.subject = p_subject
         and e.status = 'pending'
         and e.created_at > now() - interval '1 hour'
    ) then
      insert into public.email_schedule (to_email, subject, body, send_at, status)
      values (r.email, p_subject, p_body, now(), 'pending');
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end
$fn$;

revoke all on function public.gl_enqueue_portal_email(uuid, text, text, text)
  from authenticated, public, anon;

-- ────────────────────────────────────────────────────────────────
-- The events worth an email
-- ────────────────────────────────────────────────────────────────
-- Milestones: only "we need something from you", and a note written FOR the
-- client. Not every completion — thirteen stages of "done" is how people learn
-- to filter you into a folder.
create or replace function public.gl_notify_milestone()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_client uuid; v_project text; v_link text := 'https://goodliquidbevco.com/?portal=1';
begin
  select p.client_id, p.name into v_client, v_project
    from public.projects p
   where p.id = new.project_id and p.archived_at is null;
  if v_client is null then return new; end if;

  if new.status = 'awaiting_client' and old.status is distinct from 'awaiting_client' then
    perform public.gl_enqueue_portal_email(
      v_client, 'project',
      'Action needed: ' || v_project,
      'Hello,' || chr(10) || chr(10) ||
      'We need something from you on ' || v_project || ' to keep moving: ' || new.label ||
      case when new.round > 1 then ' (round ' || new.round || ')' else '' end || '.' ||
      case when coalesce(new.client_note,'') <> '' then chr(10) || chr(10) || new.client_note else '' end ||
      case when new.target_date is not null then chr(10) || chr(10) || 'Target date: ' || new.target_date else '' end ||
      chr(10) || chr(10) || 'You can see where the project stands here:' || chr(10) || v_link ||
      chr(10) || chr(10) || 'Good Liquid Bev Co');
  elsif coalesce(new.client_note,'') <> '' and new.client_note is distinct from old.client_note then
    perform public.gl_enqueue_portal_email(
      v_client, 'project',
      'Update on ' || v_project,
      'Hello,' || chr(10) || chr(10) ||
      'There is an update on ' || v_project || ' — ' || new.label || ':' || chr(10) || chr(10) ||
      new.client_note ||
      chr(10) || chr(10) || 'The full picture is in your portal:' || chr(10) || v_link ||
      chr(10) || chr(10) || 'Good Liquid Bev Co');
  end if;

  return new;
end
$fn$;

revoke all on function public.gl_notify_milestone() from authenticated, public, anon;

create trigger trg_notify_milestone
  after update on public.project_milestones
  for each row execute function public.gl_notify_milestone();

-- A document becoming visible is the whole point of the publish button.
create or replace function public.gl_notify_document()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if new.client_visible = true and old.client_visible is distinct from true
     and new.client_id is not null then
    perform public.gl_enqueue_portal_email(
      new.client_id, 'project',
      'A new document is available',
      'Hello,' || chr(10) || chr(10) ||
      'We have added a document to your account: ' || new.name ||
      case when coalesce(new.doc_type,'') <> '' then ' (' || new.doc_type || ')' else '' end || '.' ||
      chr(10) || chr(10) || 'You can view and download it here:' || chr(10) ||
      'https://goodliquidbevco.com/?portal=1' ||
      chr(10) || chr(10) || 'Good Liquid Bev Co');
  end if;
  return new;
end
$fn$;

revoke all on function public.gl_notify_document() from authenticated, public, anon;

create trigger trg_notify_document
  after update on public.deal_documents
  for each row execute function public.gl_notify_document();

-- Artwork: the two decisions a client has to act on. 'in_review' is us picking
-- it up and 'sent_to_printer' is us finishing — neither asks anything of them.
create or replace function public.gl_notify_artwork_decision()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_client uuid; v_sku text;
begin
  if new.decision not in ('approved','changes_requested') then return new; end if;

  select a.client_id, a.sku_name into v_client, v_sku
    from public.client_artwork a
   where a.id = new.artwork_id and a.archived_at is null;
  if v_client is null then return new; end if;

  if new.decision = 'approved' then
    perform public.gl_enqueue_portal_email(
      v_client, 'project',
      'Artwork approved: ' || v_sku,
      'Hello,' || chr(10) || chr(10) ||
      'Your artwork for ' || v_sku || ' is approved.' ||
      case when coalesce(new.client_note,'') <> '' then chr(10) || chr(10) || new.client_note else '' end ||
      chr(10) || chr(10) || 'https://goodliquidbevco.com/?portal=1' ||
      chr(10) || chr(10) || 'Good Liquid Bev Co');
  else
    perform public.gl_enqueue_portal_email(
      v_client, 'project',
      'Changes requested: ' || v_sku,
      'Hello,' || chr(10) || chr(10) ||
      'We have asked for changes to the artwork for ' || v_sku || '.' ||
      case when coalesce(new.client_note,'') <> '' then chr(10) || chr(10) || new.client_note else '' end ||
      chr(10) || chr(10) || 'Upload the revised artwork in your portal:' || chr(10) ||
      'https://goodliquidbevco.com/?portal=1' ||
      chr(10) || chr(10) || 'Good Liquid Bev Co');
  end if;

  return new;
end
$fn$;

revoke all on function public.gl_notify_artwork_decision() from authenticated, public, anon;

create trigger trg_notify_artwork_decision
  after insert on public.artwork_reviews
  for each row execute function public.gl_notify_artwork_decision();

-- The promise the checkbox has been making since the portal shipped.
-- production_runs.client_id is TEXT while customer_users.client_id is uuid —
-- the known inconsistency in this schema, hence the explicit cast.
create or replace function public.gl_notify_run_stage()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_client uuid;
begin
  if new.stage is not distinct from old.stage then return new; end if;
  begin
    v_client := new.client_id::uuid;
  exception when others then
    return new;   -- a non-uuid client_id is legacy data, not a recipient
  end;
  if v_client is null then return new; end if;

  perform public.gl_enqueue_portal_email(
    v_client, 'run_stage',
    'Production update: ' || coalesce(new.run_name, 'your run'),
    'Hello,' || chr(10) || chr(10) ||
    coalesce(new.run_name, 'Your run') || ' has moved to ' || new.stage || '.' ||
    case when coalesce(new.lot_number,'') <> '' then chr(10) || 'Lot: ' || new.lot_number else '' end ||
    chr(10) || chr(10) || 'Track it in your portal:' || chr(10) ||
    'https://goodliquidbevco.com/?portal=1' ||
    chr(10) || chr(10) || 'Good Liquid Bev Co' ||
    chr(10) || chr(10) ||
    'To stop these, untick "Production stage emails" in your portal account settings.');

  return new;
end
$fn$;

revoke all on function public.gl_notify_run_stage() from authenticated, public, anon;

create trigger trg_notify_run_stage
  after update on public.production_runs
  for each row execute function public.gl_notify_run_stage();

-- ────────────────────────────────────────────────────────────────
-- The customer's own switch for the new preference
-- ────────────────────────────────────────────────────────────────
-- A separate RPC rather than a second argument on portal_update_my_notify:
-- adding a defaulted parameter to the existing function would leave two
-- overloads and make the one-argument call ambiguous.
create or replace function public.portal_update_my_notify_project(p_notify_project_updates boolean)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare v_n int;
begin
  update public.customer_users
     set notify_project_updates = coalesce(p_notify_project_updates, true)
   where auth_user_id = auth.uid() and active = true;
  get diagnostics v_n = row_count;
  return v_n > 0;
end
$fn$;

revoke all on function public.portal_update_my_notify_project(boolean) from public, anon;
grant execute on function public.portal_update_my_notify_project(boolean) to authenticated;

notify pgrst, 'reload schema';
