-- ════════════════════════════════════════════════════════════════
-- An artwork revision stays in its original's project (GL-123)
-- Independent review 2026-09-17, finding R5.
-- ════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   Re-run the gl_guard_artwork_identity body from
--   20260917090000_portal_file_provenance.sql, then
--   notify pgrst, 'reload schema';
--   No table or row changes.
--
-- WHAT WAS WRONG. "Upload revised artwork" inserted the new row with the
-- project of whatever screen it was on. The staff view has no project, so a
-- staff revision of project artwork landed in "unassigned"; in the portal,
-- revising unassigned artwork while a project was open filed the revision
-- under that project. artwork.js now takes the parent's project. This makes
-- the database hold the same rule for any caller, so a direct API insert
-- cannot break the revision chain's project either.
--
-- THE RULE. On INSERT with supersedes_id set, the new row's project_id must be
-- the parent's (both null counts as equal). Reassigning a whole chain remains a
-- staff UPDATE on each row, which this does not touch; a revision simply
-- cannot start life somewhere else.
--
-- Production today: 0 rows with supersedes_id, so nothing existing violates it.

create or replace function public.gl_guard_artwork_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $function$
declare
  v_parent_client  uuid;
  v_parent_project uuid;
begin
  if tg_op = 'INSERT' then
    if new.supersedes_id is not null then
      select a.client_id, a.project_id into v_parent_client, v_parent_project
        from public.client_artwork a where a.id = new.supersedes_id;
      if v_parent_client is distinct from new.client_id then
        raise exception 'a revision must belong to the same client as the artwork it replaces'
          using errcode = '42501';
      end if;
      -- GL-123
      if new.project_id is distinct from v_parent_project then
        raise exception 'a revision stays in the same project as the artwork it replaces'
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
$function$;

revoke all on function public.gl_guard_artwork_identity() from public, anon, authenticated;

notify pgrst, 'reload schema';
