-- Portal upload aliasing — live behavioural proof (GL-121, independent review R3).
--
-- The finding: a customer could re-expose a file staff had hidden or archived
-- by registering a NEW row that names the same storage path. This runs the
-- reviewer's acceptance test against the live database as a real portal
-- customer, and rolls everything back.
--
--   supabase db query --linked -f scripts/portal-upload-alias-proof.sql
--
-- "Readable" means storage.objects SELECT under the customer's session, which
-- is what listing, signed-URL creation and download all go through.
--
-- Not covered here: two aliases inserted in parallel sessions. The trigger
-- serialises them on a per-path advisory lock; one transaction cannot show it.

begin;

create temporary table proof(seq serial, assertion text, observed text, verdict text);

do $proof$
declare
  v_staff uuid; v_cust uuid; v_client uuid;
  c_stranger constant uuid := '00000000-0000-4000-8000-00000000beef';
  v_proj uuid; v_proj2 uuid;
  p_doc text; p_art text; p_doc2 text; p_foreign text; p_rev text; p_art3 text;
  v_doc uuid; v_art uuid; v_doc2 uuid; v_art3 uuid;
  n int; ok boolean; err text;
begin
  select p.id into v_staff from public.profiles p where coalesce(p.status,'active') <> 'inactive' and p.role = 'admin' limit 1;
  select cu.auth_user_id, cu.client_id into v_cust, v_client
    from public.customer_users cu join public.clients c on c.id = cu.client_id
   where cu.active and cu.auth_user_id is not null
     and not exists (select 1 from public.profiles pr where pr.id = cu.auth_user_id)
   order by (c.name ilike 'ZZ Portal QA%') desc limit 1;
  if v_staff is null or v_cust is null then
    insert into proof(assertion, observed, verdict) values ('fixtures present', 'staff ' || coalesce(v_staff::text,'none') || ', customer ' || coalesce(v_cust::text,'none'), 'INCOMPLETE');
    return;
  end if;

  insert into public.projects (client_id, name) values (v_client, 'zz alias proof') returning id into v_proj;
  insert into public.projects (client_id, name) values (v_client, 'zz alias proof 2') returning id into v_proj2;
  p_doc     := v_client::text || '/portal/zz-alias-doc.pdf';
  p_art     := v_client::text || '/portal/artwork/zz-alias-art.png';
  p_doc2    := v_client::text || '/portal/zz-alias-doc2.pdf';
  p_foreign := v_client::text || '/portal/zz-alias-not-mine.pdf';
  p_rev     := v_client::text || '/portal/artwork/zz-alias-rev.png';
  p_art3    := v_client::text || '/portal/artwork/zz-alias-art3.png';
  -- One object uploaded by someone else into the same client's portal folder.
  insert into storage.objects (bucket_id, name, owner_id) values ('client-docs', p_foreign, v_staff::text);

  -- ─────────────────────────── legitimate uploads work ───────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id) values
    ('client-docs', p_doc, v_cust::text), ('client-docs', p_art, v_cust::text),
    ('client-docs', p_doc2, v_cust::text), ('client-docs', p_rev, v_cust::text), ('client-docs', p_art3, v_cust::text);
  insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible, project_id)
    values (v_client, 'Other', 'zz alias doc', p_doc, true, null) returning id into v_doc;
  insert into public.client_artwork (client_id, sku_name, file_path, project_id)
    values (v_client, 'zz alias SKU', p_art, v_proj) returning id into v_art;
  insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible, project_id)
    values (v_client, 'Other', 'zz alias doc2', p_doc2, true, v_proj2) returning id into v_doc2;
  insert into public.client_artwork (client_id, sku_name, file_path, project_id)
    values (v_client, 'zz alias SKU 3', p_art3, v_proj) returning id into v_art3;
  select count(*) into n from storage.objects where name in (p_doc, p_art, p_doc2, p_art3);
  reset role;
  insert into proof(assertion, observed, verdict) values
    ('a customer registers their own fresh uploads (document, artwork, in and out of a project) and can read them',
     n || '/4 readable', case when n = 4 then 'PASS' else 'FAIL' end);

  -- ───────────── staff hide the document, archive the artwork and a project ────
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.deal_documents set client_visible = false where id = v_doc;
  update public.client_artwork set archived_at = now() where id = v_art;
  update public.projects set archived_at = now() where id = v_proj2;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from storage.objects where name in (p_doc, p_art, p_doc2);
  reset role;
  insert into proof(assertion, observed, verdict) values
    ('after hide / artwork archive / project archive the customer cannot read any of the three files',
     n || ' readable', case when n = 0 then 'PASS' else 'FAIL' end);

  -- ─────────────────────────────── the aliases ───────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;

  ok := true; err := '';
  begin insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible, project_id)
          values (v_client, 'Other', 'alias', p_doc, true, null); ok := false; err := err || ' doc→doc(null) accepted;';
  exception when insufficient_privilege then null; end;
  begin insert into public.client_artwork (client_id, sku_name, file_path, project_id)
          values (v_client, 'alias', p_doc, null); ok := false; err := err || ' doc→artwork(null) accepted;';
  exception when insufficient_privilege then null; end;
  begin insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible, project_id)
          values (v_client, 'Other', 'alias', p_art, true, null); ok := false; err := err || ' art→doc(null) accepted;';
  exception when insufficient_privilege then null; end;
  begin insert into public.client_artwork (client_id, sku_name, file_path, project_id)
          values (v_client, 'alias', p_art, null); ok := false; err := err || ' art→artwork(null) accepted;';
  exception when insufficient_privilege then null; end;
  begin insert into public.client_artwork (client_id, sku_name, file_path, project_id)
          values (v_client, 'alias', p_art, v_proj); ok := false; err := err || ' art→artwork(active project) accepted;';
  exception when insufficient_privilege then null; end;
  begin insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible, project_id)
          values (v_client, 'Other', 'alias', p_doc2, true, null); ok := false; err := err || ' archived-project doc→doc(null) accepted;';
  exception when insufficient_privilege then null; end;
  begin insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible, project_id)
          values (v_client, 'Other', 'alias', p_doc2, true, v_proj); ok := false; err := err || ' archived-project doc→doc(active project) accepted;';
  exception when insufficient_privilege then null; end;
  select count(*) into n from storage.objects where name in (p_doc, p_art, p_doc2);
  reset role;
  insert into proof(assertion, observed, verdict) values
    ('R3: every alias — both tables, null and active project — is refused, and the files stay unreadable',
     case when ok then '7/7 refused' else err end || ', ' || n || ' readable',
     case when ok and n = 0 then 'PASS' else 'FAIL' end);

  -- ───────────────────── an object the customer did not upload ───────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible)
          values (v_client, 'Other', 'not mine', p_foreign, true);
  exception when insufficient_privilege then ok := true; end;
  select count(*) into n from storage.objects where name = p_foreign;
  reset role;
  insert into proof(assertion, observed, verdict) values
    ('R3: registering an object someone else uploaded into the client folder is refused',
     case when ok then 'refused' else 'accepted' end || ', ' || n || ' readable',
     case when ok and n = 0 then 'PASS' else 'FAIL' end);

  -- ──────────────────────────── revisions still work ─────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := true;
  begin insert into public.client_artwork (client_id, sku_name, file_path, project_id, supersedes_id)
          values (v_client, 'zz alias SKU 3 rev', p_rev, v_proj, v_art3);
  exception when others then ok := false; err := sqlerrm; end;
  select count(*) into n from storage.objects where name = p_rev;
  reset role;
  insert into proof(assertion, observed, verdict) values
    ('a revision uploaded as a new file registers and reads back', case when ok then 'accepted' else err end || ', ' || n || ' readable',
     case when ok and n = 1 then 'PASS' else 'FAIL' end);

  -- ───────────────────── staff and the system are not restricted ──────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := true;
  begin insert into public.client_artwork (client_id, sku_name, file_path) values (v_client, 'staff second reference', p_art3);
  exception when others then ok := false; err := sqlerrm; end;
  reset role;
  insert into proof(assertion, observed, verdict) values
    ('staff may still reference an already-registered file from a second table (explicit staff publication)',
     case when ok then 'accepted' else err end, case when ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', '', true);
  ok := true;
  begin insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible) values (v_client, 'Other', 'system write', p_art3, false);
  exception when others then ok := false; err := sqlerrm; end;
  insert into proof(assertion, observed, verdict) values
    ('service/owner writes (no end-user role) are not restricted', case when ok then 'accepted' else err end,
     case when ok then 'PASS' else 'FAIL' end);

  -- ───────────────────────────── authenticated stranger ──────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', c_stranger, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := false;
  begin insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible)
          values (v_client, 'Other', 'stranger', p_art3, true);
  exception when others then ok := true; end;
  select count(*) into n from storage.objects where name in (p_doc, p_art, p_doc2, p_art3, p_rev);
  reset role;
  insert into proof(assertion, observed, verdict) values
    ('an authenticated stranger can register nothing and read nothing', case when ok then 'refused' else 'accepted' end || ', ' || n || ' readable',
     case when ok and n = 0 then 'PASS' else 'FAIL' end);

  -- ─────────────────────────────── privileges ────────────────────────────────
  insert into proof(assertion, observed, verdict)
  select 'the trigger function is not callable by clients',
         'public/anon/authenticated execute = ' || has_function_privilege('anon', 'public.gl_claim_customer_upload()', 'execute')
           || '/' || has_function_privilege('authenticated', 'public.gl_claim_customer_upload()', 'execute'),
         case when not has_function_privilege('anon', 'public.gl_claim_customer_upload()', 'execute')
               and not has_function_privilege('authenticated', 'public.gl_claim_customer_upload()', 'execute') then 'PASS' else 'FAIL' end;
end
$proof$;

select seq, verdict, assertion, observed from proof order by seq;

-- Nothing is kept. Safe to run anywhere, including production.
rollback;
