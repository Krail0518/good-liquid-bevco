-- ============================================================
-- Permissions audit log — who toggled whose access, and when
-- ============================================================
-- Trigger on user_permissions writes records every change to
-- permissions_audit. Read by admins to track accountability for
-- access changes.
--
-- Idempotent. Safe to re-run.
-- ============================================================

create table if not exists public.permissions_audit (
  id              bigserial primary key,
  actor_id        uuid,                  -- the admin who made the change
  target_user_id  uuid not null,         -- the user whose access changed
  component_id    text not null,
  action          text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_value       boolean,               -- null for INSERT
  new_value       boolean,               -- null for DELETE
  created_at      timestamptz not null default now()
);
create index if not exists idx_perm_audit_target on public.permissions_audit(target_user_id, created_at desc);
create index if not exists idx_perm_audit_recent on public.permissions_audit(created_at desc);

alter table public.permissions_audit enable row level security;
drop policy if exists "perm_audit admin read" on public.permissions_audit;
create policy "perm_audit admin read" on public.permissions_audit
  for select to authenticated using (public.is_admin_user());
-- Inserts come from the trigger, not from app code — no insert policy needed.

create or replace function public.log_user_permission_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.permissions_audit (actor_id, target_user_id, component_id, action, old_value, new_value)
    values (coalesce(new.updated_by, auth.uid()), new.user_id, new.component_id, 'INSERT', null, new.granted);
    return new;
  elsif tg_op = 'UPDATE' then
    if new.granted is distinct from old.granted then
      insert into public.permissions_audit (actor_id, target_user_id, component_id, action, old_value, new_value)
      values (coalesce(new.updated_by, auth.uid()), new.user_id, new.component_id, 'UPDATE', old.granted, new.granted);
    end if;
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.permissions_audit (actor_id, target_user_id, component_id, action, old_value, new_value)
    values (auth.uid(), old.user_id, old.component_id, 'DELETE', old.granted, null);
    return old;
  end if;
  return null;
end
$$;

drop trigger if exists trg_user_permissions_audit on public.user_permissions;
create trigger trg_user_permissions_audit
  after insert or update or delete on public.user_permissions
  for each row execute function public.log_user_permission_change();

notify pgrst, 'reload schema';
