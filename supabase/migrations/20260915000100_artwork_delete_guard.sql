-- ════════════════════════════════════════════════════════════════
-- Client portal v2 — phase 2 fix: the delete guard has to be able to see
-- ════════════════════════════════════════════════════════════════
-- 20260915000000 gave client_artwork this customer delete policy:
--
--   using (client_id = current_customer_client_id()
--          and archived_at is null
--          and not exists (select 1 from public.artwork_reviews r
--                           where r.artwork_id = client_artwork.id))
--
-- The intent was "a client may withdraw their own upload only while nobody has
-- ruled on it". The clause never fired. A policy's subquery is evaluated AS THE
-- CALLER, and customers hold no policy on artwork_reviews -- deliberately, so
-- they cannot read decided_by. So the subquery returned zero rows for every
-- customer, `not exists` was always true, and the policy permitted the delete.
--
-- Found by probing it rather than reading it: the delete reached the foreign key
-- and failed with 23503 instead of being filtered out. The data was never at
-- risk -- artwork_reviews.artwork_id is ON DELETE RESTRICT, and that is what
-- actually refused -- but the customer got a raw constraint error instead of a
-- clean refusal, and a guard that reads as a check while doing nothing is worse
-- than no guard at all: the next person to touch this would trust it.
--
-- This is the same shape as gl_can_read_formula in 20260914090300, and the fix
-- is the same: a SECURITY DEFINER helper that answers one boolean about an id
-- the caller already holds, and discloses nothing else.
--
-- ROLLBACK:
--   drop policy if exists "client_artwork customer delete" on public.client_artwork;
--   create policy "client_artwork customer delete" on public.client_artwork
--     for delete to authenticated
--     using (client_id = public.current_customer_client_id()
--            and archived_at is null
--            and not exists (select 1 from public.artwork_reviews r
--                             where r.artwork_id = client_artwork.id));
--   drop function if exists public.gl_artwork_has_decision(uuid);
--   Reverting restores the ineffective clause. The ON DELETE RESTRICT foreign
--   key still protects the record either way; what is lost is the clean refusal.

set search_path = public, extensions;

create or replace function public.gl_artwork_has_decision(p_artwork_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, pg_temp
as $fn$
  select exists (
    select 1 from public.artwork_reviews r where r.artwork_id = p_artwork_id
  );
$fn$;

revoke all on function public.gl_artwork_has_decision(uuid) from public, anon;
grant execute on function public.gl_artwork_has_decision(uuid) to authenticated;

drop policy if exists "client_artwork customer delete" on public.client_artwork;
create policy "client_artwork customer delete" on public.client_artwork
  for delete to authenticated
  using (
    client_id = public.current_customer_client_id()
    and archived_at is null
    and not public.gl_artwork_has_decision(id)
  );

notify pgrst, 'reload schema';
