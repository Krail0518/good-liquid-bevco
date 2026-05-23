-- ============================================================
-- Lock permission_components + user_permissions writes to super
-- ============================================================
-- The permissions audit found: any admin (not just super) could
-- grant themselves any UI permission via DevTools:
--
--   await supa.from('user_permissions').upsert([{
--     user_id: <my id>, component_id: 'action.client.delete', granted: true
--   }])
--
-- The destructive RLS policies on clients/profiles/invoices/etc.
-- now gate on is_super_user(), so this escalation can't actually
-- DELETE anything — but it could expose UI sections that Mike
-- wanted scoped to a subset of admins (e.g. AI Settings, Customer
-- Logins management, Reports).
--
-- This migration tightens the perm-matrix tables so ONLY the super
-- user can grant/revoke permissions or change which components
-- default-on. Reads stay scoped as before (self for user_permissions,
-- anyone authed for permission_components — needed by the JS to
-- render the toggle UI).
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── permission_components: read open, write super-only ──
drop policy if exists "perm_components read" on public.permission_components;
create policy "perm_components read" on public.permission_components
  for select to authenticated using (true);

drop policy if exists "perm_components admin write" on public.permission_components;
drop policy if exists "perm_components super write" on public.permission_components;
create policy "perm_components super write" on public.permission_components
  for all to authenticated
  using (public.is_super_user())
  with check (public.is_super_user());

-- ── user_permissions: self-read, super-write ──
drop policy if exists "user_perms read self" on public.user_permissions;
create policy "user_perms read self" on public.user_permissions
  for select to authenticated
  using (user_id = auth.uid() or public.is_super_user());

drop policy if exists "user_perms admin all" on public.user_permissions;
drop policy if exists "user_perms super all" on public.user_permissions;
create policy "user_perms super all" on public.user_permissions
  for all to authenticated
  using (public.is_super_user())
  with check (public.is_super_user());

-- ── permissions_audit: super-only read (audit trail of who
--    granted/revoked what — sensitive). Inserts come from a
--    trigger via SECURITY DEFINER which bypasses RLS by design. ──
drop policy if exists "perm_audit admin read" on public.permissions_audit;
drop policy if exists "perm_audit super read" on public.permissions_audit;
create policy "perm_audit super read" on public.permissions_audit
  for select to authenticated
  using (public.is_super_user());

notify pgrst, 'reload schema';
