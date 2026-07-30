-- READ-ONLY verification that the onboarding test data is gone and the records
-- we intended to keep remain. Deleted after use.
select json_build_object(
  'test_clients_remaining', (select count(*) from public.clients where name = 'Test Onboarding — delete me'),
  'test_onboarding_rows',   (select count(*) from public.onboarding o join public.clients c on c.id=o.client_id where c.name = 'Test Onboarding — delete me'),
  'mike_goodliquid_as_customer', (select count(*) from public.customer_users where lower(email) = 'mike@goodliquid.com'),
  'test_house_account_kept', (select count(*) from public.clients where name = 'Test house account'),
  'mike_goodliquid_profile_kept', (select count(*) from public.profiles where lower(email) = 'mike@goodliquid.com')
) as result;
