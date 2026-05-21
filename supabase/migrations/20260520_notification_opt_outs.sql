-- ============================================================
-- Notification opt-out RPC (portal customer self-update)
-- ============================================================
-- The customer_users RLS is "self read" + "staff write" — a portal
-- customer cannot directly UPDATE their own row. To let them toggle
-- their own `notify_run_stage_changes` flag from the portal Account
-- Settings modal, we expose a tightly-scoped SECURITY DEFINER RPC
-- that only flips that one column on the caller's own row.
--
-- Staff-side Daily Digest opt-out (`profiles.notify_daily_digest`)
-- uses a different path: the Users & Permissions admin page writes
-- to profiles directly (staff have full profiles update privileges).
--
-- Idempotent. Safe to re-run.
-- ============================================================

create or replace function public.portal_update_my_notify(
  p_notify_run_stage_changes boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_found  int;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_notify_run_stage_changes is null then
    return jsonb_build_object('ok', false, 'error', 'missing_flag');
  end if;
  update public.customer_users
     set notify_run_stage_changes = p_notify_run_stage_changes
   where auth_user_id = v_caller
     and active = true;
  get diagnostics v_found = row_count;
  if v_found = 0 then
    return jsonb_build_object('ok', false, 'error', 'not_a_portal_user');
  end if;
  return jsonb_build_object('ok', true, 'notify_run_stage_changes', p_notify_run_stage_changes);
end
$$;
grant execute on function public.portal_update_my_notify(boolean) to authenticated;

notify pgrst, 'reload schema';
