-- ════════════════════════════════════════════════════════════════
-- Portal file provenance, immutable approved artwork, archive rules,
-- verified decision makers  (Codex CP01, CP02, CP03-db, CP05, CP06)
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK: restores the 20260916 state and re-opens every hole below:
--   drop policy "client-docs referenced-object delete guard" on storage.objects;
--   drop policy "client-docs referenced-object update guard" on storage.objects;
--   drop policy "client-docs customer read" on storage.objects;      -- then recreate the
--     20260915000200 version (portal/% branch + unconditioned reference branches)
--   drop policy "client-docs customer upload" on storage.objects;    -- recreate with name like <client>/%
--   drop policy "deal_documents customer upload" on public.deal_documents;  -- recreate without file/project checks
--   drop policy "client_artwork customer insert" on public.client_artwork;  -- recreate without file/project checks
--   create policy "client_artwork customer update" on public.client_artwork for update to authenticated
--     using (client_id = public.current_customer_client_id()) with check (client_id = public.current_customer_client_id());
--   drop policy "client_artwork customer read" ...; recreate without the project-archive predicate
--   drop trigger trg_client_artwork_identity on public.client_artwork; drop function public.gl_guard_artwork_identity();
--   alter table public.client_artwork drop column supersedes_id;
--   alter table public.artwork_reviews drop column artwork_file_path;
--   restore gl_guard_artwork_review_transition() and gl_stamp_entitlement_event() from 20260915000000 / 20260914090100
--   notify pgrst, 'reload schema';
--
-- ── CP01. A customer could point a document at a file they may not read ─────
-- The customer INSERT policies on deal_documents and client_artwork checked
-- only client_id. file_path was whatever the caller sent, client_visible too.
-- The storage read policy then trusted any visible deal_documents row, and any
-- client_artwork row, as permission to read the object named by file_path. So
-- a customer who knew another client's object path — or a staff document or a
-- formula file under formula/ — inserted one row and could list and sign it.
-- Codex reproduced 0 -> 1 visible objects for another client's hidden file.
--
-- Fix: customer-authored rows may only reference objects in the customer's own
-- upload namespace, <client_id>/portal/, which is also the only place a
-- customer may upload. Referencing your own upload grants nothing new. Staff
-- rows are unaffected: staff choose staff paths.
--
-- The blanket "<client>/portal/% is readable" storage branch is removed. A
-- customer reads an object only through a row that is itself visible to them —
-- which is what makes archive and unpublish reach the file (CP05).
--
-- ── CP02. Approval did not bind to what was approved ────────────────────────
-- The decision ledger was append-only, but client_artwork was not: a customer
-- could change file_path after approval and the portal showed the new file as
-- approved. Now: customers have no UPDATE on client_artwork at all (the UI never
-- used it), and once an artwork has any decision its file identity (file_path,
-- file_type, client_id) is immutable for staff too. A revision is a new row,
-- optionally linked through supersedes_id, and starts unreviewed. Each decision
-- records the file it decided on (artwork_file_path), and storage refuses to
-- delete or overwrite an object that reviewed artwork references. Decisions on
-- one artwork are serialised with a row lock so concurrent staff decisions
-- cannot both pass the transition check against the same previous state.
--
-- ── CP03 (database half). A downloaded formula file could be deleted ────────
-- The staff delete handler removed the storage object before the row, and the
-- row delete then failed on the download log's ON DELETE RESTRICT, leaving a
-- record with no file. Storage now refuses to delete or overwrite any object a
-- formula_documents row references, so that ordering cannot destroy a logged
-- file whatever the client does. The handler change is in formula-docs.js;
-- the correction path is in 20260917090100.
--
-- ── CP05. Archive was an RPC filter, and customers could reassign ───────────
-- gl_portal_artwork() hid artwork on archived projects, but the base table
-- returned it, and the customer UPDATE policy let the owner set project_id=null
-- to bring it back. The base-table read policy and the storage branch now apply
-- the same project-archive predicate, and customers can no longer update rows.
--
-- ── CP06. The decision maker was whatever the caller said ───────────────────
-- decided_by and the entitlement ledger's actor were caller-supplied; a staff
-- member could record a decision under a colleague's id. Both are now stamped
-- from auth.uid(). A write with no signed-in user is refused: both columns are
-- NOT NULL references to profiles, and there is no truthful identity to record.
-- ════════════════════════════════════════════════════════════════

-- ---------------------------------------------------------------- storage

-- Whether any client-docs reference row points at this object, regardless of
-- the caller's visibility of that row. Answers only for the caller's own upload
-- namespace, so it cannot be used to probe other clients' paths.
create or replace function public.gl_storage_object_referenced(p_name text)
returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  select case
    when public.current_customer_client_id() is null
      or p_name not like public.current_customer_client_id()::text || '/portal/%' then true
    else exists (select 1 from public.deal_documents d where d.file_path = p_name)
      or exists (select 1 from public.client_artwork a where a.file_path = p_name)
      or exists (select 1 from public.lot_documents l where l.file_path = p_name)
  end
$$;
revoke all on function public.gl_storage_object_referenced(text) from public, anon;
grant execute on function public.gl_storage_object_referenced(text) to authenticated;

drop policy if exists "client-docs customer upload" on storage.objects;
create policy "client-docs customer upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'client-docs'
    and public.current_customer_client_id() is not null
    and name like public.current_customer_client_id()::text || '/portal/%'
  );

drop policy if exists "client-docs customer read" on storage.objects;
create policy "client-docs customer read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-docs'
    and public.current_customer_client_id() is not null
    and (
      exists (
        select 1 from public.deal_documents d
         where d.file_path = objects.name
           and d.client_id = public.current_customer_client_id()
           and d.client_visible = true
           and (d.project_id is null or exists (
                 select 1 from public.projects p
                  where p.id = d.project_id
                    and p.client_id = public.current_customer_client_id()
                    and p.archived_at is null)))
      or exists (
        select 1 from public.client_artwork a
         where a.file_path = objects.name
           and a.client_id = public.current_customer_client_id()
           and a.archived_at is null
           and (a.project_id is null or exists (
                 select 1 from public.projects p
                  where p.id = a.project_id
                    and p.client_id = public.current_customer_client_id()
                    and p.archived_at is null)))
      or exists (
        select 1 from public.lot_documents l
         where l.file_path = objects.name
           and l.client_id = public.current_customer_client_id())
      -- The uploader's own file in their upload namespace, until a row refers to
      -- it. From then on that row's visibility governs, so hiding or archiving
      -- the row hides the file. The reference test is SECURITY DEFINER: a
      -- hidden row is invisible to the caller, and must still count.
      or (    objects.name like public.current_customer_client_id()::text || '/portal/%'
          and objects.owner_id = auth.uid()::text
          and not public.gl_storage_object_referenced(objects.name))
    )
  );

-- Files that are part of a record cannot be deleted or replaced by any client
-- role, staff included. The service role (RLS-exempt) remains the break-glass.
create or replace function public.gl_storage_object_is_record(p_name text)
returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $$
  -- Non-staff get "protected" without a lookup: they hold no storage delete or
  -- update policy anyway, and this must not become a path-existence oracle.
  select case when not public.is_gl_staff() then true else
         exists (select 1 from public.formula_documents f where f.file_path = p_name)
      or exists (select 1 from public.client_artwork a
                  where a.file_path = p_name
                    and exists (select 1 from public.artwork_reviews r where r.artwork_id = a.id))
  end
$$;
revoke all on function public.gl_storage_object_is_record(text) from public, anon;
grant execute on function public.gl_storage_object_is_record(text) to authenticated;

drop policy if exists "client-docs referenced-object delete guard" on storage.objects;
create policy "client-docs referenced-object delete guard" on storage.objects
  as restrictive for delete to authenticated
  using (bucket_id <> 'client-docs' or not public.gl_storage_object_is_record(name));

drop policy if exists "client-docs referenced-object update guard" on storage.objects;
create policy "client-docs referenced-object update guard" on storage.objects
  as restrictive for update to authenticated
  using (bucket_id <> 'client-docs' or not public.gl_storage_object_is_record(name));

-- ---------------------------------------------------------------- deal_documents

drop policy if exists "deal_documents customer upload" on public.deal_documents;
create policy "deal_documents customer upload" on public.deal_documents
  for insert to authenticated
  with check (
    deal_id is null
    and client_id is not null
    and client_id = public.current_customer_client_id()
    and file_path is not null
    and file_path like public.current_customer_client_id()::text || '/portal/%'
    and (project_id is null or exists (
          select 1 from public.projects p
           where p.id = deal_documents.project_id
             and p.client_id = public.current_customer_client_id()
             and p.archived_at is null))
  );

-- ---------------------------------------------------------------- client_artwork

alter table public.client_artwork
  add column if not exists supersedes_id uuid references public.client_artwork(id) on delete restrict;

drop policy if exists "client_artwork customer insert" on public.client_artwork;
create policy "client_artwork customer insert" on public.client_artwork
  for insert to authenticated
  with check (
    client_id = public.current_customer_client_id()
    and file_path is not null
    and file_path like public.current_customer_client_id()::text || '/portal/%'
    and archived_at is null
    and (project_id is null or exists (
          select 1 from public.projects p
           where p.id = client_artwork.project_id
             and p.client_id = public.current_customer_client_id()
             and p.archived_at is null))
  );

-- Customers never update artwork. Reassignment and archive are staff acts.
drop policy if exists "client_artwork customer update" on public.client_artwork;

drop policy if exists "client_artwork customer read" on public.client_artwork;
create policy "client_artwork customer read" on public.client_artwork
  for select to authenticated
  using (
    client_id = public.current_customer_client_id()
    and archived_at is null
    and (project_id is null or exists (
          select 1 from public.projects p
           where p.id = client_artwork.project_id
             and p.client_id = public.current_customer_client_id()
             and p.archived_at is null))
  );

create or replace function public.gl_guard_artwork_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_parent_client uuid;
begin
  if tg_op = 'INSERT' then
    if new.supersedes_id is not null then
      select a.client_id into v_parent_client from public.client_artwork a where a.id = new.supersedes_id;
      if v_parent_client is distinct from new.client_id then
        raise exception 'a revision must belong to the same client as the artwork it replaces'
          using errcode = '42501';
      end if;
    end if;
    return new;
  end if;

  if not public.is_gl_staff() then
    raise exception 'only staff can change artwork after upload; upload a new revision instead'
      using errcode = '42501';
  end if;

  if new.client_id is distinct from old.client_id then
    raise exception 'artwork cannot move between clients' using errcode = '42501';
  end if;

  if new.supersedes_id is distinct from old.supersedes_id then
    raise exception 'the revision link is fixed at upload' using errcode = '42501';
  end if;

  if (new.file_path is distinct from old.file_path or new.file_type is distinct from old.file_type)
     and exists (select 1 from public.artwork_reviews r where r.artwork_id = old.id) then
    raise exception
      'artwork % has review decisions, so its file is part of the record and cannot be replaced; upload a new revision',
      old.id using errcode = '42501';
  end if;

  return new;
end
$$;
revoke all on function public.gl_guard_artwork_identity() from public, anon, authenticated;

drop trigger if exists trg_client_artwork_identity on public.client_artwork;
create trigger trg_client_artwork_identity
  before insert or update on public.client_artwork
  for each row execute function public.gl_guard_artwork_identity();

-- ---------------------------------------------------------------- artwork_reviews

alter table public.artwork_reviews add column if not exists artwork_file_path text;

create or replace function public.gl_guard_artwork_review_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_prev text;
  v_ok   boolean;
  v_file text;
begin
  new.decided_at := now();

  -- CP06: the decision maker is the verified session, never the payload.
  if auth.uid() is null then
    raise exception 'an artwork decision must be made by a signed-in staff member'
      using errcode = '42501';
  end if;
  new.decided_by := auth.uid();

  -- CP02: serialise decisions on one artwork, and bind this decision to the
  -- exact file it was made on.
  select a.file_path into v_file
    from public.client_artwork a
   where a.id = new.artwork_id
   for update;
  new.artwork_file_path := v_file;

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
$function$;

-- ---------------------------------------------------------------- entitlement actor

create or replace function public.gl_stamp_entitlement_event()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $function$
begin
  new.at := now();
  -- CP06: the actor is the verified session. The quote trigger runs inside the
  -- accepting staff member's request, so auth.uid() is that person there too.
  if auth.uid() is null then
    raise exception 'an entitlement change must be made by a signed-in staff member'
      using errcode = '42501';
  end if;
  new.actor := auth.uid();
  return new;
end
$function$;

notify pgrst, 'reload schema';
