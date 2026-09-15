-- ════════════════════════════════════════════════════════════════
-- Client portal v2 (5/5) — document visibility and tenant consistency
-- ════════════════════════════════════════════════════════════════
-- deal_documents had no visibility column, so EVERY document attached to a
-- client was already showing in their portal. This adds an explicit flag,
-- attaches documents and artwork to projects, and -- the part that is not
-- optional -- makes it impossible to attach Client A's document to Client B's
-- project.
--
-- TENANT CONSISTENCY, DECLARATIVELY.
-- A composite foreign key (project_id, client_id) -> projects (id, client_id)
-- rather than a trigger: it is checked on both sides, by every write path, and
-- cannot be bypassed by a direct API call the staff UI never sees.
--
-- The accompanying CHECK is required, not belt-and-braces. Both
-- deal_documents.client_id and client_artwork.client_id are NULLABLE (verified
-- 2026-09-14), and a composite FK defaults to MATCH SIMPLE, which skips
-- enforcement entirely when ANY column of the key is null -- so setting
-- project_id while leaving client_id null would slip straight past it.
-- MATCH FULL is not the alternative: it would reject the legacy rows, which
-- legitimately have a client_id and no project_id. Together the two constraints
-- say: a row may have no project; if it has one, it must have a client, and
-- that pair must exist on projects.
--
-- LEGACY ROWS keep project_id null. There is no project to point them at and
-- inventing one would be fabrication. Unassigned rows fall back to client-level
-- scoping and are unaffected by project archival -- they were never in a
-- project. A follow-up migration may set NOT NULL once the 37 legacy rows are
-- assigned or archived.
--
-- BACKFILL -- classified by type, not blanket-true. 30 rows, all uploaded by
-- Mike Krail, all portal-visible before this migration:
--
--   visible:  NDA (10)                      -- the client signed it
--             Label / Artwork (9)           -- the client supplied it
--             Process Authority Letter (5)  -- a deliverable they paid for
--   internal: Formula (4)                   -- may contain the formulation
--             Other (2)                     -- not classifiable by type
--
-- SIX DOCUMENTS VISIBLE TODAY WILL DISAPPEAR FROM THE PORTAL. Recorded here by
-- id so each can be reviewed and republished individually:
--
--   b5253bbd-1645-4dc5-a565-8a50b7aba672  Formula  "Formula"  Patizan Energy  2026-08-06
--   3602334b-70c4-4423-8909-e2e86787cb32  Formula  "Formula"  Patizan Energy  2026-08-06
--   840ea7b1-ea2e-4700-bdd8-6b593a6f581a  Formula  "Formula"  Oriign LLC      2026-08-13
--   75662f74-6cb8-4379-8d9b-68283d99b79f  Formula  "Formula"  Oriign LLC      2026-08-13
--   d6f74dfc-5798-4041-b88f-0daebbeb7743  Other    "Non-circumvention agreement."  Atlas canning  2026-08-21
--   ff1dac61-d095-424a-8b50-12fbb4279926  Other    "Pre-Paid Canning Agreement"    Atlas canning  2026-08-21
--
-- NOTE FOR REVIEW: the two "Other" rows are, by their names, agreements Atlas
-- canning is itself a party to -- the same category as the NDAs that stay
-- visible. They are hidden here because the approved rule classifies by
-- doc_type and "Other" carries no guarantee. Recommend republishing both after
-- a look. The four Formula rows should stay hidden: the portal's Formula tab
-- deliberately shows status only, and a formula sheet is the one thing a
-- competing brand must never obtain.
--
-- ROLLBACK:
--   drop trigger if exists trg_deal_documents_audit on public.deal_documents;
--   drop trigger if exists trg_client_artwork_project_audit on public.client_artwork;
--   drop function if exists public.gl_audit_document_visibility();
--   drop function if exists public.gl_audit_artwork_project();
--   drop policy if exists "deal_documents customer read" on public.deal_documents;
--   create policy "deal_documents customer read" on public.deal_documents
--     for select to authenticated using (client_id = public.current_customer_client_id());
--   alter table public.deal_documents
--     drop constraint if exists deal_documents_project_tenant,
--     drop constraint if exists deal_documents_project_needs_client,
--     drop column if exists project_id, drop column if exists client_visible;
--   alter table public.client_artwork
--     drop constraint if exists client_artwork_project_tenant,
--     drop constraint if exists client_artwork_project_needs_client,
--     drop column if exists project_id;
--   Reverting restores the previous behaviour exactly: every deal_documents row
--   becomes portal-visible again, including the six above.

set search_path = public, extensions;

-- ────────────────────────────────────────────────────────────────
-- Columns and tenant constraints
-- ────────────────────────────────────────────────────────────────
alter table public.deal_documents
  add column if not exists client_visible boolean not null default false,
  add column if not exists project_id uuid;

alter table public.deal_documents
  add constraint deal_documents_project_tenant
    foreign key (project_id, client_id)
    references public.projects (id, client_id) on delete restrict,
  add constraint deal_documents_project_needs_client
    check (project_id is null or client_id is not null);

alter table public.client_artwork
  add column if not exists project_id uuid;

alter table public.client_artwork
  add constraint client_artwork_project_tenant
    foreign key (project_id, client_id)
    references public.projects (id, client_id) on delete restrict,
  add constraint client_artwork_project_needs_client
    check (project_id is null or client_id is not null);

create index deal_documents_project_idx on public.deal_documents (project_id)
  where project_id is not null;
create index client_artwork_project_idx on public.client_artwork (project_id)
  where project_id is not null;

-- ────────────────────────────────────────────────────────────────
-- Classified backfill
-- ────────────────────────────────────────────────────────────────
update public.deal_documents
   set client_visible = true
 where doc_type in ('NDA', 'Label / Artwork', 'Process Authority Letter');

-- The six that lose visibility get an audit row each, source = 'system',
-- so the change is discoverable from the audit trail and not only from this
-- migration's header.
insert into public.audit_log (actor_id, actor_email, action, target, details)
select null, 'migration:20260914090400', 'document_visibility_changed', d.id::text,
       jsonb_build_object('source', 'system', 'db_role', current_user,
                          'doc_type', d.doc_type, 'name', d.name,
                          'client_id', d.client_id,
                          'from', true, 'to', false,
                          'reason', 'classified internal by doc_type; review and republish if intended')
  from public.deal_documents d
 where d.doc_type in ('Formula', 'Other');

-- ────────────────────────────────────────────────────────────────
-- Customer read policy
-- ────────────────────────────────────────────────────────────────
-- client_visible is ANDed OUTSIDE the branch OR, so it governs assigned and
-- unassigned rows alike. There is no path where an unassigned document skips
-- the flag. Staff bypass both via the leading OR. A deactivated customer
-- resolves current_customer_client_id() to null, both branches evaluate to
-- NULL, and the policy denies.
drop policy if exists "deal_documents customer read" on public.deal_documents;

create policy "deal_documents customer read" on public.deal_documents
  for select to authenticated
  using (
    public.is_gl_staff()
    OR (
      client_visible = true
      AND (
            ( deal_documents.project_id is null
              AND deal_documents.client_id = public.current_customer_client_id() )
         OR ( deal_documents.project_id is not null
              AND exists ( select 1 from public.projects p
                           where p.id = deal_documents.project_id
                             and p.client_id = public.current_customer_client_id()
                             and p.archived_at is null ) )
          )
    )
  );

-- ────────────────────────────────────────────────────────────────
-- Audit
-- ────────────────────────────────────────────────────────────────
create or replace function public.gl_audit_document_visibility()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
declare
  v_source text := case when auth.uid() is null then 'system' else 'user' end;
begin
  if new.client_visible is distinct from old.client_visible then
    insert into public.audit_log (actor_id, actor_email, action, target, details)
    values (auth.uid(), public.gl_audit_actor_email(),
            'document_visibility_changed', new.id::text,
            jsonb_build_object('source', v_source, 'db_role', current_user,
                               'doc_type', new.doc_type, 'client_id', new.client_id,
                               'from', old.client_visible, 'to', new.client_visible));
  end if;

  if new.project_id is distinct from old.project_id then
    insert into public.audit_log (actor_id, actor_email, action, target, details)
    values (auth.uid(), public.gl_audit_actor_email(),
            'document_project_reassigned', new.id::text,
            jsonb_build_object('source', v_source, 'db_role', current_user,
                               'from', old.project_id, 'to', new.project_id));
  end if;

  return new;
end
$fn$;

revoke all on function public.gl_audit_document_visibility() from public, anon;

create trigger trg_deal_documents_audit
  after update on public.deal_documents
  for each row execute function public.gl_audit_document_visibility();

create or replace function public.gl_audit_artwork_project()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, pg_temp
as $fn$
begin
  if new.project_id is distinct from old.project_id then
    insert into public.audit_log (actor_id, actor_email, action, target, details)
    values (auth.uid(), public.gl_audit_actor_email(),
            'artwork_project_reassigned', new.id::text,
            jsonb_build_object(
              'source', case when auth.uid() is null then 'system' else 'user' end,
              'db_role', current_user,
              'from', old.project_id, 'to', new.project_id));
  end if;
  return new;
end
$fn$;

revoke all on function public.gl_audit_artwork_project() from public, anon;

create trigger trg_client_artwork_project_audit
  after update on public.client_artwork
  for each row execute function public.gl_audit_artwork_project();

notify pgrst, 'reload schema';
