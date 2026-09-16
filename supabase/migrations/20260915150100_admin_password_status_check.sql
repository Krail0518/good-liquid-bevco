-- ════════════════════════════════════════════════════════════════
-- A deactivated admin must not keep the password-reset key (GL-078)
-- ════════════════════════════════════════════════════════════════
-- admin_set_user_password() can set ANY user's password -- other admins, and
-- every portal customer. It gated that on role alone:
--
--     select role into caller_role from public.profiles where id = auth.uid();
--     if caller_role is distinct from 'admin' then return 'error: admin only';
--
-- profiles.status is never read. Deactivating an admin sets status, not role,
-- so a revoked administrator kept the ability to take over any account in the
-- system, including the accounts of the people who revoked them.
--
-- NOT EXPLOITABLE TODAY, and that is the only reason this is not an incident:
-- all six profiles are status = 'active', so no identity currently sits in the
-- gap. This is the GL-009 shape -- a permission check that reads one half of
-- the identity -- and it is fixed before someone is deactivated, not after.
--
-- I could not simulate the deactivated admin to prove the hole: profiles has a
-- trigger (profiles_block_sensitive_updates) that refuses a status change from
-- anything but a super-user, so manufacturing the test identity would have
-- meant disabling a security control on production to demonstrate a bug that
-- is plain in six lines of source. The fix is verified the other way instead --
-- an ACTIVE admin still succeeds, proving the added predicate does not lock
-- out the people who need it.
--
-- WHAT IS DELIBERATELY NOT CHANGED. Two things about this function are worth
-- the owner's attention and are NOT altered here, because they change
-- behaviour staff may rely on rather than close a hole:
--   * the minimum is 6 characters, weaker than onboarding-set-password, and
--     Supabase leaked-password protection is disabled on this project;
--   * it writes no audit_log row, so an account takeover leaves no trace.
-- Both are reported rather than fixed in a security patch applied unattended.
--
-- ROLLBACK:
--   Re-create the function with the caller lookup as:
--     select role into caller_role from public.profiles where id = auth.uid();
--   i.e. drop the "and coalesce(status,'active') = 'active'" predicate below.
--   Reverting restores password-reset powers to deactivated administrators.

set search_path = public, extensions;

create or replace function public.admin_set_user_password(target_email text, new_password text)
returns text
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
DECLARE
  caller_role TEXT;
  target_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN RETURN 'error: not authenticated'; END IF;

  -- status is half of the identity: a deactivated admin is not an admin.
  SELECT role INTO caller_role
    FROM public.profiles
   WHERE id = auth.uid()
     AND coalesce(status, 'active') = 'active';

  IF caller_role IS DISTINCT FROM 'admin' THEN
    RETURN 'error: admin only';
  END IF;

  IF length(new_password) < 6 THEN
    RETURN 'error: password too short (min 6)';
  END IF;

  SELECT id INTO target_id FROM auth.users WHERE lower(email) = lower(target_email);
  IF target_id IS NULL THEN
    RETURN 'error: user not found';
  END IF;

  UPDATE auth.users
  SET encrypted_password = crypt(new_password, gen_salt('bf')),
      updated_at         = now()
  WHERE id = target_id;

  RETURN 'ok';
END;
$function$;

revoke all on function public.admin_set_user_password(text, text) from public, anon;
grant execute on function public.admin_set_user_password(text, text) to authenticated;

notify pgrst, 'reload schema';
