-- ════════════════════════════════════════════════════════════════
-- Client portal v2 — phase 3: publishing a document against a formula version
-- ════════════════════════════════════════════════════════════════
-- The Formula tab shows STATUS ONLY, deliberately: name, version, stage, and
-- the version timeline. 20260914090300 made public.formulas staff-only after
-- finding that three permissive USING (true) policies let any portal customer
-- read ingredients and notes directly.
--
-- Phase 3 adds the one exception the owner asked for: staff may attach a
-- document to a SPECIFIC formula version and publish it to that client, one
-- file at a time. Nothing is visible by default; publishing is always an
-- explicit act.
--
-- THE PUBLISH BUTTON IS THE SECURITY BOUNDARY, not this schema. A published
-- spec sheet or COA can contain the formulation itself, and the clients here
-- are competing beverage brands. So the act is deliberate, confirmed by name in
-- the UI, and recorded in audit_log by a trigger rather than a client-side call.
--
-- CUSTOMERS HOLD NO POLICY ON formula_documents. This is not an oversight and
-- not symmetry for its own sake: a customer with SELECT here could request
-- ?select=file_path, mint their own signed URL from the storage API, and
-- download the file without ever touching the function that writes the access
-- log. The log would then be quietly incomplete, which is worse than no log —
-- it would be a record everyone trusted and nobody could rely on.
--
-- So the portal gets two things and neither of them is a path:
--   * gl_portal_formula_documents() — what exists, published only, NO file_path
--   * the portal-formula-doc edge function — the only way to obtain bytes, and
--     it writes the download row before it returns a URL
--
-- VERSIONING. Multiple documents per formula version are normal — a spec sheet
-- AND a COA against v3 — so the key is (formula_id, version, doc_kind) with a
-- constrained kind, NOT the display name. A name is editable free text and an
-- editable column makes a poor key.
--
-- formulas.client_id is TEXT while every other client_id is uuid. That known
-- inconsistency is why ownership is asked of gl_can_read_formula() rather than
-- compared here.
--
-- ROLLBACK:
--   drop function if exists public.gl_portal_formula_documents();
--   drop trigger if exists trg_formula_documents_audit on public.formula_documents;
--   drop function if exists public.gl_audit_formula_document();
--   drop table if exists public.formula_document_downloads;
--   drop table if exists public.formula_documents;
--   Reverting removes every published formula document and the record of who
--   downloaded what. Nothing else reads these tables; the Formula tab falls back
--   to status only, which is what it showed before this migration.

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────
-- formula_documents
-- ────────────────────────────────────────────────────────────────
create table public.formula_documents (
  id           uuid primary key default gen_random_uuid(),
  formula_id   uuid not null references public.formulas(id) on delete restrict,
  version      int  not null check (version >= 1),
  doc_kind     text not null check (doc_kind in ('spec_sheet','coa','process','other')),
  name         text not null,
  file_path    text not null,
  file_type    text,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id),
  published_at timestamptz,
  published_by uuid references public.profiles(id),
  constraint formula_documents_kind_uniq unique (formula_id, version, doc_kind)
);

create index formula_documents_formula_idx on public.formula_documents (formula_id, version);
create index formula_documents_published_idx on public.formula_documents (published_at)
  where published_at is not null;

alter table public.formula_documents enable row level security;
revoke all on public.formula_documents from anon, public;
grant select, insert, update, delete on public.formula_documents to authenticated;

create policy "formula_documents staff all" on public.formula_documents
  for all to authenticated
  using (public.is_gl_staff())
  with check (public.is_gl_staff());

create policy "gl tenant guard" on public.formula_documents
  as restrictive to authenticated
  using (public.is_gl_staff())
  with check (public.is_gl_staff());

-- ────────────────────────────────────────────────────────────────
-- formula_document_downloads — the access log
-- ────────────────────────────────────────────────────────────────
-- No client role may write here. The edge function writes as service_role
-- BEFORE it returns a URL, so a browser that fetches the file and then declines
-- to report it cannot produce a gap.
create table public.formula_document_downloads (
  seq                 bigint generated always as identity primary key,
  formula_document_id uuid not null references public.formula_documents(id) on delete restrict,
  customer_user_id    uuid not null references public.customer_users(id) on delete restrict,
  at                  timestamptz not null default now(),
  ip                  inet
);

create index formula_document_downloads_doc_idx
  on public.formula_document_downloads (formula_document_id, seq desc);

alter table public.formula_document_downloads enable row level security;
revoke all on public.formula_document_downloads from anon, public;
-- SELECT only: staff read the log, nobody writes it but the service role.
grant select on public.formula_document_downloads to authenticated;

create policy "formula_document_downloads staff read" on public.formula_document_downloads
  for select to authenticated
  using (public.is_gl_staff());

create policy "gl tenant guard" on public.formula_document_downloads
  as restrictive to authenticated
  using (public.is_gl_staff())
  with check (public.is_gl_staff());

-- ────────────────────────────────────────────────────────────────
-- Audit
-- ────────────────────────────────────────────────────────────────
create or replace function public.gl_audit_formula_document()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_source text := case when auth.uid() is null then 'system' else 'user' end;
begin
  if (TG_OP = 'INSERT' and new.published_at is not null)
     or (TG_OP = 'UPDATE' and new.published_at is distinct from old.published_at) then
    insert into public.audit_log (actor_id, actor_email, action, target, details)
    values (auth.uid(), public.gl_audit_actor_email(),
            case when new.published_at is null
                 then 'formula_document_unpublished' else 'formula_document_published' end,
            new.id::text,
            jsonb_build_object('source', v_source, 'db_role', current_user,
                               'formula_id', new.formula_id, 'version', new.version,
                               'doc_kind', new.doc_kind, 'name', new.name));
  end if;
  return new;
end
$fn$;

revoke all on function public.gl_audit_formula_document() from authenticated, public, anon;

create trigger trg_formula_documents_audit
  after insert or update on public.formula_documents
  for each row execute function public.gl_audit_formula_document();

-- ────────────────────────────────────────────────────────────────
-- The customer-facing listing — deliberately without file_path
-- ────────────────────────────────────────────────────────────────
-- Returning file_path here would hand the browser everything it needs to mint
-- its own signed URL and bypass the download log entirely.
create or replace function public.gl_portal_formula_documents()
returns table (id uuid, formula_id uuid, formula_name text, version int,
               doc_kind text, name text, file_type text, published_at timestamptz)
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select d.id, d.formula_id, f.name, d.version, d.doc_kind, d.name, d.file_type, d.published_at
    from public.formula_documents d
    join public.formulas f on f.id = d.formula_id
   where d.published_at is not null
     and public.gl_can_read_formula(d.formula_id)
   order by d.published_at desc;
$fn$;

revoke all on function public.gl_portal_formula_documents() from public, anon;
grant execute on function public.gl_portal_formula_documents() to authenticated;

notify pgrst, 'reload schema';
