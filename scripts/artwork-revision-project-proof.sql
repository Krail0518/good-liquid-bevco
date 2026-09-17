-- Artwork revision keeps its project — live proof (GL-123, independent review R5).
--
-- tests/artwork.test.cjs drives the real screen and checks what it sends. This
-- checks what the database accepts from ANY caller, staff or customer.
-- Rolled back.
--
--   supabase db query --linked -f scripts/artwork-revision-project-proof.sql

begin;

create temporary table proof(seq serial, assertion text, observed text, verdict text);
-- Results are recorded while acting as the signed-in caller.
grant insert, select on proof to authenticated;
grant usage on sequence proof_seq_seq to authenticated;

do $proof$
declare
  v_staff uuid; v_cust uuid; v_client uuid;
  v_p1 uuid; v_p2 uuid; v_art uuid; v_legacy uuid; v_rev uuid;
  ok boolean; err text; v_proj uuid;
begin
  select p.id into v_staff from public.profiles p where coalesce(p.status,'active') <> 'inactive' and p.role = 'admin' limit 1;
  select cu.auth_user_id, cu.client_id into v_cust, v_client
    from public.customer_users cu join public.clients c on c.id = cu.client_id
   where cu.active and cu.auth_user_id is not null
     and not exists (select 1 from public.profiles pr where pr.id = cu.auth_user_id)
   order by (c.name ilike 'ZZ Portal QA%') desc limit 1;
  if v_staff is null or v_cust is null then
    insert into proof(assertion, observed, verdict) values ('fixtures present', 'missing staff or portal user', 'INCOMPLETE');
    return;
  end if;

  insert into public.projects (client_id, name) values (v_client, 'zz rev proof 1') returning id into v_p1;
  insert into public.projects (client_id, name) values (v_client, 'zz rev proof 2') returning id into v_p2;
  insert into public.client_artwork (client_id, sku_name, file_path, project_id)
    values (v_client, 'zz rev parent', v_client::text || '/artwork/zz-rev-parent.png', v_p1) returning id into v_art;
  insert into public.client_artwork (client_id, sku_name, file_path, project_id)
    values (v_client, 'zz rev legacy', v_client::text || '/artwork/zz-rev-legacy.png', null) returning id into v_legacy;

  -- ── staff ────────────────────────────────────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ok := false;
  begin insert into public.client_artwork (client_id, sku_name, file_path, project_id, supersedes_id)
          values (v_client, 'staff rev, no project', v_client::text || '/artwork/zz-rev-a.png', null, v_art);
  exception when insufficient_privilege then ok := true; end;
  insert into proof(assertion, observed, verdict) values
    ('R5 staff: a revision of project-1 artwork with NO project (the reviewer''s case) is refused',
     case when ok then 'refused' else 'accepted' end, case when ok then 'PASS' else 'FAIL' end);

  ok := false;
  begin insert into public.client_artwork (client_id, sku_name, file_path, project_id, supersedes_id)
          values (v_client, 'staff rev, other project', v_client::text || '/artwork/zz-rev-b.png', v_p2, v_art);
  exception when insufficient_privilege then ok := true; end;
  insert into proof(assertion, observed, verdict) values
    ('R5 staff: a revision filed under a different project is refused',
     case when ok then 'refused' else 'accepted' end, case when ok then 'PASS' else 'FAIL' end);

  ok := true;
  begin insert into public.client_artwork (client_id, sku_name, file_path, project_id, supersedes_id)
          values (v_client, 'staff rev, same project', v_client::text || '/artwork/zz-rev-c.png', v_p1, v_art)
          returning id, project_id into v_rev, v_proj;
  exception when others then ok := false; err := sqlerrm; end;
  insert into proof(assertion, observed, verdict) values
    ('R5 staff: a revision in the same project is accepted and keeps its link',
     case when ok then 'accepted, project ' || (v_proj = v_p1) else err end,
     case when ok and v_proj = v_p1 then 'PASS' else 'FAIL' end);

  ok := false;
  begin insert into public.client_artwork (client_id, sku_name, file_path, project_id, supersedes_id)
          values (v_client, 'legacy rev into project', v_client::text || '/artwork/zz-rev-d.png', v_p1, v_legacy);
  exception when insufficient_privilege then ok := true; end;
  insert into proof(assertion, observed, verdict) values
    ('R5: revising unassigned artwork cannot file the revision under an open project',
     case when ok then 'refused' else 'accepted' end, case when ok then 'PASS' else 'FAIL' end);

  ok := true;
  begin insert into public.client_artwork (client_id, sku_name, file_path, project_id, supersedes_id)
          values (v_client, 'legacy rev stays unassigned', v_client::text || '/artwork/zz-rev-e.png', null, v_legacy);
  exception when others then ok := false; err := sqlerrm; end;
  reset role;
  insert into proof(assertion, observed, verdict) values
    ('R5: a revision of unassigned artwork that stays unassigned is accepted',
     case when ok then 'accepted' else err end, case when ok then 'PASS' else 'FAIL' end);

  -- ── customer, through the portal path (their own upload) ─────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id) values
    ('client-docs', v_client::text || '/portal/artwork/zz-rev-cust-1.png', v_cust::text),
    ('client-docs', v_client::text || '/portal/artwork/zz-rev-cust-2.png', v_cust::text);

  ok := false;
  begin insert into public.client_artwork (client_id, sku_name, file_path, project_id, supersedes_id)
          values (v_client, 'cust rev wrong project', v_client::text || '/portal/artwork/zz-rev-cust-1.png', v_p2, v_art);
  exception when insufficient_privilege then ok := true; end;
  insert into proof(assertion, observed, verdict) values
    ('R5 customer: a direct API revision into another project is refused',
     case when ok then 'refused' else 'accepted' end, case when ok then 'PASS' else 'FAIL' end);

  ok := true;
  begin insert into public.client_artwork (client_id, sku_name, file_path, project_id, supersedes_id)
          values (v_client, 'cust rev same project', v_client::text || '/portal/artwork/zz-rev-cust-2.png', v_p1, v_art);
  exception when others then ok := false; err := sqlerrm; end;
  reset role;
  insert into proof(assertion, observed, verdict) values
    ('R5 customer: a revision of their project artwork, in that project, is accepted',
     case when ok then 'accepted' else err end, case when ok then 'PASS' else 'FAIL' end);
end
$proof$;

select seq, verdict, assertion, observed from proof order by seq;

-- Nothing is kept.
rollback;
