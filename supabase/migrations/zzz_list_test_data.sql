-- READ-ONLY. Lists candidate test records so we can see exactly what exists
-- before deleting anything. Run via Apply-SQL; the response body prints the rows.
-- zzz_ prefix keeps it out of ordered migration runs; deleted after use.
select json_agg(t order by t.created_at desc) as rows from (
  select 'client'::text as kind, c.id::text as id, c.name, c.email, c.status,
         c.onboarding_status, c.created_at::text as created_at
    from public.clients c
   where c.created_at > now() - interval '3 days'
      or c.name ilike '%test%' or c.name ilike '%delete me%' or c.status = 'onboarding'
  union all
  select 'onboarding'::text, o.id::text, cl.name, o.contact_email, o.status,
         null, o.created_at::text
    from public.onboarding o left join public.clients cl on cl.id = o.client_id
  union all
  select 'customer_user'::text, cu.id::text, cu.display_name, cu.email,
         cu.active::text, null, cu.created_at::text
    from public.customer_users cu
   where cu.created_at > now() - interval '3 days'
      or cu.email ilike '%test%' or cu.email ilike '%onboard%'
) t;
