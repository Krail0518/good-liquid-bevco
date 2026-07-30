-- is_staff_user(): an active staff profile wins over a stray customer link.
--
-- The original definition said "staff = any authenticated user NOT in
-- customer_users". Testing the portal invite flow on your own address links
-- your auth user into customer_users — and instantly the OWNER stops counting
-- as staff for every table this function guards (email_log, email_schedule,
-- clients, invoices, email_templates, audit_log, facilities, nps_responses,
-- inspector_tokens): reads return empty, writes are rejected, all silently.
-- Observed in production as "correspondence shows nothing under any lead"
-- and the CRM failing to log an email it had just successfully sent.
--
-- This is the SQL twin of the requireStaff() fix in
-- supabase/functions/_shared/auth.ts (an active profile authorizes the
-- caller regardless of a leftover customer link). A genuine portal customer
-- has no profiles row, so their access is unchanged; an authenticated user
-- with neither a profile nor a customer link keeps counting as staff, which
-- preserves the original function's semantics for that edge case.
create or replace function public.is_staff_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and (
       exists (
         select 1 from public.profiles
         where id = auth.uid() and coalesce(status, 'active') <> 'inactive'
       )
       or not exists (
         select 1 from public.customer_users
         where auth_user_id = auth.uid() and active = true
       )
     );
$$;

grant execute on function public.is_staff_user() to authenticated;
