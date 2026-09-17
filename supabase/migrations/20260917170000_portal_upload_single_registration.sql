-- ════════════════════════════════════════════════════════════════
-- A customer upload is registered once, by its uploader (GL-121)
-- Independent review 2026-09-17, finding R3.
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   drop trigger if exists gl_claim_customer_upload on public.deal_documents;
--   drop trigger if exists gl_claim_customer_upload on public.client_artwork;
--   drop function if exists public.gl_claim_customer_upload();
--   notify pgrst, 'reload schema';
--   No table or row changes, so rollback loses no data — but it reopens R3.
--
-- WHAT WAS WRONG. Storage lets a customer read a client-docs object when ANY
-- visible, non-archived row in deal_documents or client_artwork names it
-- (policy "client-docs customer read"). The customer INSERT policies on both
-- tables accepted any file_path inside the client's own <client>/portal/
-- namespace. Nothing tied a registration to a specific upload, so:
--   staff hide a customer's document (client_visible=false), or archive their
--   artwork → the customer inserts a NEW deal_documents row naming the same
--   path, visible, project_id null → the storage read is true again.
-- The same worked across tables and around an archived project, and did not
-- require the object to be the caller's own upload. It could not cross
-- tenants: every branch is pinned to the caller's own <client>/portal/.
--
-- THE RULE. For a non-staff caller, a new row in either table must name an
-- object that
--   1. exists in client-docs and was uploaded by this user (owner_id), and
--   2. is not already registered by any row in deal_documents, client_artwork
--      or lot_documents — every table the storage read policy trusts.
-- The file's first registration is its only one, so staff hiding or archiving
-- that row is final. A legitimate upload is unaffected: the portal uploads a
-- fresh, uniquely named object and registers it once. A revision is a new file.
-- Staff are not restricted (staff legitimately reference one object from two
-- tables — two such rows exist today — and staff publication stays explicit).
--
-- WHY A TRIGGER AND NOT ONLY THE POLICY. A WITH CHECK can test "not referenced",
-- but two inserts of the same path in parallel would both pass it, leaving two
-- visible aliases for staff to find and hide separately. The trigger takes a
-- transaction advisory lock on the path first; the second insert waits, then
-- (READ COMMITTED, fresh snapshot per statement) sees the first and is refused.
--
-- SECURITY DEFINER because customers cannot see other rows that reference a
-- path (that is the point of hiding them) nor storage owner metadata. Returns
-- nothing to the caller but an allow or a 42501.

create or replace function public.gl_claim_customer_upload()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  -- Scope: exactly the callers RLS scopes. PostgREST runs an end-user request
  -- under SET ROLE authenticated/anon; the service role (edge functions),
  -- migrations and the table owner are not end users and are not restricted
  -- here, just as RLS does not restrict them. Inside this SECURITY DEFINER
  -- function current_user is the owner, so the request's role is read from the
  -- `role` setting, which SET ROLE maintains.
  if coalesce(current_setting('role', true), 'none') not in ('authenticated', 'anon') then
    return new;
  end if;
  if public.is_gl_staff() then
    return new;
  end if;

  if new.file_path is null then
    raise exception 'a customer upload must name its file' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('gl-customer-upload:' || new.file_path, 0));

  if not exists (
    select 1 from storage.objects o
     where o.bucket_id = 'client-docs'
       and o.name = new.file_path
       and o.owner_id = auth.uid()::text
  ) then
    raise exception 'you can only attach a file you uploaded yourself'
      using errcode = '42501';
  end if;

  if exists (select 1 from public.deal_documents d where d.file_path = new.file_path)
     or exists (select 1 from public.client_artwork a where a.file_path = new.file_path)
     or exists (select 1 from public.lot_documents l where l.file_path = new.file_path) then
    raise exception 'this file is already attached to a record; upload it again as a new file'
      using errcode = '42501';
  end if;

  return new;
end
$$;

revoke all on function public.gl_claim_customer_upload() from public, anon, authenticated;

drop trigger if exists gl_claim_customer_upload on public.deal_documents;
create trigger gl_claim_customer_upload
  before insert on public.deal_documents
  for each row execute function public.gl_claim_customer_upload();

drop trigger if exists gl_claim_customer_upload on public.client_artwork;
create trigger gl_claim_customer_upload
  before insert on public.client_artwork
  for each row execute function public.gl_claim_customer_upload();

notify pgrst, 'reload schema';
