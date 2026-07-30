-- One-off cleanup of onboarding TEST data, by exact id (verified via the
-- read-only listing first). Deleted after use; zzz_ keeps it out of ordered runs.
--
--   * Removes the customer_users login created from Mike's own email during
--     onboarding testing (mike@goodliquid.com should be staff, not a customer).
--     Does NOT delete the auth.users login itself — that's Mike's real account.
--   * Removes the two "Test Onboarding — delete me" clients; the onboarding row
--     linked to them cascades via the on-delete-cascade FK.
--   * Leaves "Test house account" (a May lead) untouched.
do $$
declare n_cu int; n_ob int; n_cl int;
begin
  delete from public.customer_users
   where id = '67e0ed45-58d3-481c-bae6-e210b5e608c6';
  get diagnostics n_cu = row_count;

  -- Belt-and-suspenders: also unlink any other customer_users pointing at the
  -- test clients, in case a cascade FK isn't defined.
  delete from public.customer_users
   where client_id in ('c484ca91-ad44-4ea4-ac11-e9ea7d6c0597',
                       'bc1b4b54-03cb-44ca-8fb6-9dbcb5be2e2f');

  delete from public.onboarding
   where client_id in ('c484ca91-ad44-4ea4-ac11-e9ea7d6c0597',
                       'bc1b4b54-03cb-44ca-8fb6-9dbcb5be2e2f');
  get diagnostics n_ob = row_count;

  delete from public.clients
   where id in ('c484ca91-ad44-4ea4-ac11-e9ea7d6c0597',
               'bc1b4b54-03cb-44ca-8fb6-9dbcb5be2e2f')
     and name = 'Test Onboarding — delete me';   -- guard: never delete a mis-typed id
  get diagnostics n_cl = row_count;

  raise notice 'CLEANUP: customer_users=% onboarding=% clients=%', n_cu, n_ob, n_cl;
end $$;
