-- portal-isolation-proof.sql — the LIVE half of the portal v2 tenant checks.
--
-- WHY THIS EXISTS
-- ---------------
-- tests/portal-tenant-isolation.test.cjs reads migration text and proves the
-- guards are DEFINED. It cannot prove the database BEHAVES. Both halves are
-- required and neither substitutes for the other.
--
-- REWRITTEN 2026-09-17 (Codex CP10). The previous version did not compile —
-- it contained `UPDATE ... LIMIT 1`, and an exception handler cannot catch a
-- compile error in its own block — so it had never produced a result. It also
-- let missing identities skip checks and still print success, and asked
-- has_function_privilege('public', ...) as though PUBLIC were a login role.
--
-- WHAT IT PROVES, as one assertion per line in the raised message:
--   identities   staff, own customer, another client's customer, a deactivated
--                customer, an authenticated stranger, and anonymous
--   CP01         a customer cannot reference another client's hidden object,
--                a formula object, or a staff path; a legitimate upload is
--                readable; hiding the row hides the file
--   CP02         a customer cannot change artwork; staff cannot swap a reviewed
--                file; decisions record the file they were made on; storage
--                refuses to delete or overwrite a reviewed file
--   CP03         a downloaded formula document cannot be deleted; supersede
--                keeps it and its log, the correction attaches beside it
--   CP05         archived-project artwork is invisible through the RPC, the base
--                table and storage; the customer cannot reassign it
--   CP06         decided_by and actor are stamped from the session; no session
--                means no write
--   CP07         an accepted quote's services, project and status are locked;
--                acceptance on an archived project is refused
--   CP08         no email for a document on an archived project; the send-time
--                check blocks after hiding, opt-out, deactivation and archive
--   plus         raw formula fields, internal notes and ledger identities are
--                unreadable to customers; ledgers are append-only; the
--                composite tenant FK holds; a legacy null-project document
--                stays visible; trigger-only functions are not executable by
--                PUBLIC, anon or authenticated.
--
-- FIXTURES are created inside the transaction and discarded with it. The script
-- needs, from the live database: one active staff profile, and portal users on
-- TWO different clients. If either is missing the result is INCOMPLETE — never
-- a pass. The deactivated identity is made by deactivating the second client's
-- user inside the transaction.
--
-- HOW TO RUN
--   Supabase SQL editor, the Management API /database/query endpoint, or the
--   Supabase MCP execute_sql. One DO block that ALWAYS raises, so nothing it
--   writes survives. Read the raised message:
--     "PORTAL ISOLATION PROOF: PASS"        every assertion held
--     "PORTAL ISOLATION PROOF: FAIL"        read the FAIL lines
--     "PORTAL ISOLATION PROOF: INCOMPLETE"  a required fixture was missing

DO $proof$
DECLARE
  -- identities
  v_staff uuid; v_cust_a uuid; v_client_a uuid; v_cust_b uuid; v_client_b uuid;
  v_cu_a uuid;
  c_stranger constant uuid := '00000000-0000-4000-8000-00000000fade';
  -- fixtures
  v_proj_a uuid; v_proj_a_arch uuid; v_proj_b uuid;
  v_doc_hidden_b uuid; c_hidden_b_obj text;
  v_legacy_doc uuid; c_legacy_obj text;
  c_up_doc text; c_up_art text;
  v_doc_up uuid; v_art_up uuid; v_art_staff uuid; v_art_arch uuid;
  v_formula uuid; v_fdoc uuid; v_q uuid; v_q2 uuid; v_doc_arch uuid; v_doc_act uuid; v_sched uuid;
  -- scratch
  n int; n2 int; v text; ok boolean;
  lines text := ''; passes int := 0; fails int := 0; incomplete text := '';
BEGIN
  -- ── fixtures from the live database, captured before any role switch ─────
  select p.id into v_staff from public.profiles p
   where coalesce(p.status,'active') <> 'inactive' and p.role = 'admin' limit 1;
  select cu.auth_user_id, cu.client_id, cu.id into v_cust_a, v_client_a, v_cu_a
    from public.customer_users cu join public.clients c on c.id = cu.client_id
   where cu.active and cu.auth_user_id is not null
   order by (c.name ilike 'ZZ Portal QA%') desc limit 1;
  select cu.auth_user_id, cu.client_id into v_cust_b, v_client_b
    from public.customer_users cu
   where cu.active and cu.auth_user_id is not null and cu.client_id <> v_client_a limit 1;

  if v_staff is null then incomplete := incomplete || ' no active admin profile;'; end if;
  if v_cust_a is null then incomplete := incomplete || ' no active portal user;'; end if;
  if v_cust_b is null then incomplete := incomplete || ' no active portal user on a second client;'; end if;
  if incomplete <> '' then
    RAISE EXCEPTION 'PORTAL ISOLATION PROOF: INCOMPLETE —%', incomplete;
  end if;

  -- Controlled fixtures, created as the table owner.
  perform set_config('storage.allow_delete_query', 'true', true);   -- as the Storage API does; RLS still applies
  insert into public.projects (client_id, name) values (v_client_a, 'zz proof A') returning id into v_proj_a;
  insert into public.projects (client_id, name) values (v_client_a, 'zz proof A archived') returning id into v_proj_a_arch;
  insert into public.projects (client_id, name) values (v_client_b, 'zz proof B') returning id into v_proj_b;
  c_hidden_b_obj := v_client_b::text || '/docs/zz-proof-hidden.pdf';
  insert into storage.objects (bucket_id, name, owner_id) values ('client-docs', c_hidden_b_obj, v_staff::text);
  insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible)
  values (v_client_b, 'Formula', 'zz proof hidden B', c_hidden_b_obj, false) returning id into v_doc_hidden_b;
  c_legacy_obj := v_client_a::text || '/docs/zz-proof-legacy.pdf';
  insert into storage.objects (bucket_id, name, owner_id) values ('client-docs', c_legacy_obj, v_staff::text);
  insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible, project_id)
  values (v_client_a, 'NDA', 'zz proof legacy', c_legacy_obj, true, null) returning id into v_legacy_doc;
  insert into public.formulas (name, client_id, status, ingredients) values ('zz proof formula', v_client_a::text, 'active', 'secret') returning id into v_formula;
  insert into storage.objects (bucket_id, name, owner_id) values ('client-docs', 'formula/' || v_formula || '/zz-proof.pdf', v_staff::text);
  update public.projects set archived_at = now() where id = v_proj_a_arch;

  -- ════════════════════════════ own customer (A) ════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust_a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- sensitive fields and staff-only tables
  select count(*) into n from public.formulas; ok := n = 0;
  select count(*) into n2 from public.gl_internal_notes; ok := ok and n2 = 0;
  select count(*) into n2 from public.project_entitlement_events; ok := ok and n2 = 0;
  select count(*) into n2 from public.artwork_reviews; ok := ok and n2 = 0;
  reset role;
  if ok then passes := passes + 1; lines := lines || E'\n  PASS  customer reads 0 formulas, internal notes, entitlement or artwork ledger rows';
  else fails := fails + 1; lines := lines || E'\n  FAIL  customer can read formulas / internal notes / ledger identities'; end if;

  -- CP01: alias to another client's hidden object, a formula object, a staff path
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := true;
  begin insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible) values (v_client_a, 'Other', 'alias', c_hidden_b_obj, true); ok := false; exception when others then null; end;
  begin insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible) values (v_client_a, 'Other', 'alias', 'formula/' || v_formula || '/zz-proof.pdf', true); ok := false; exception when others then null; end;
  begin insert into public.client_artwork (client_id, sku_name, file_path) values (v_client_a, 'alias', v_client_a::text || '/docs/zz-proof-staff.pdf'); ok := false; exception when others then null; end;
  select count(*) into n from storage.objects where name in (c_hidden_b_obj, 'formula/' || v_formula || '/zz-proof.pdf');
  reset role;
  if ok and n = 0 then passes := passes + 1; lines := lines || E'\n  PASS  CP01 customer cannot register other-client, formula or staff-path references (0 objects readable)';
  else fails := fails + 1; lines := lines || E'\n  FAIL  CP01 alias accepted or object readable (' || n || ')'; end if;

  -- CP01 positive: legitimate upload, register, read back; hide hides the file
  c_up_doc := v_client_a::text || '/portal/zz-proof-upload.pdf';
  c_up_art := v_client_a::text || '/portal/artwork/zz-proof-art.png';
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner_id) values ('client-docs', c_up_doc, v_cust_a::text), ('client-docs', c_up_art, v_cust_a::text);
  insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible, project_id)
  values (v_client_a, 'NDA', 'zz proof upload', c_up_doc, true, v_proj_a) returning id into v_doc_up;
  insert into public.client_artwork (client_id, sku_name, file_path, project_id)
  values (v_client_a, 'zz proof SKU', c_up_art, v_proj_a) returning id into v_art_up;
  select count(*) into n from storage.objects where name in (c_up_doc, c_up_art);
  select count(*) into n2 from storage.objects where name = c_legacy_obj;
  reset role;
  if n = 2 then passes := passes + 1; lines := lines || E'\n  PASS  CP01 legitimate customer upload registers and reads back (2/2)';
  else fails := fails + 1; lines := lines || E'\n  FAIL  CP01 legitimate upload not readable (' || n || '/2)'; end if;
  if n2 = 1 then passes := passes + 1; lines := lines || E'\n  PASS  legacy null-project published document stays readable';
  else fails := fails + 1; lines := lines || E'\n  FAIL  legacy null-project document not readable'; end if;

  update public.deal_documents set client_visible = false where id = v_doc_up;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from storage.objects where name = c_up_doc;
  reset role;
  update public.deal_documents set client_visible = true where id = v_doc_up;
  if n = 0 then passes := passes + 1; lines := lines || E'\n  PASS  CP01 unpublishing a document removes its file from the customer';
  else fails := fails + 1; lines := lines || E'\n  FAIL  CP01 hidden document''s file still readable'; end if;

  -- CP02 / CP06: staff decision with a spoofed decided_by; customer and staff file swaps
  insert into public.client_artwork (client_id, sku_name, file_path, project_id)
  values (v_client_a, 'zz proof staff SKU', v_client_a::text || '/artwork/zz-proof-staff.png', v_proj_a) returning id into v_art_staff;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.artwork_reviews (artwork_id, decision, decided_by) values (v_art_up, 'approved', v_cust_a);
  select decided_by, artwork_file_path into v_q, v from public.artwork_reviews where artwork_id = v_art_up order by seq desc limit 1;
  ok := v_q = v_staff and v = c_up_art;
  begin update public.client_artwork set file_path = v_client_a::text || '/portal/zz-swap.png' where id = v_art_up; ok := false; exception when others then null; end;
  delete from storage.objects where name = c_up_art;  get diagnostics n = row_count;
  update storage.objects set metadata = '{"x":1}' where name = c_up_art; get diagnostics n2 = row_count;
  reset role;
  if ok and n = 0 and n2 = 0 then passes := passes + 1; lines := lines || E'\n  PASS  CP02/CP06 decision stamped with the session and bound to its file; staff cannot swap, delete or overwrite it';
  else fails := fails + 1; lines := lines || E'\n  FAIL  CP02/CP06 attribution, binding or file protection (delete ' || n || ', overwrite ' || n2 || ')'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  update public.client_artwork set file_path = v_client_a::text || '/portal/zz-swap.png', project_id = null where id = v_art_up;
  get diagnostics n = row_count;
  select state || '|' || file_path into v from public.gl_portal_artwork() where artwork_id = v_art_up;
  reset role;
  if n = 0 and v = 'approved|' || c_up_art then passes := passes + 1; lines := lines || E'\n  PASS  CP02 customer cannot change approved artwork (0 rows); portal shows the approved file';
  else fails := fails + 1; lines := lines || E'\n  FAIL  CP02 customer changed artwork (' || n || ' rows) or portal shows ' || coalesce(v,'nothing'); end if;

  -- CP05: archived project, all three surfaces, and reassignment attempt
  insert into public.client_artwork (client_id, sku_name, file_path, project_id)
  values (v_client_a, 'zz proof archived SKU', v_client_a::text || '/portal/artwork/zz-proof-arch.png', v_proj_a_arch) returning id into v_art_arch;
  insert into storage.objects (bucket_id, name, owner_id) values ('client-docs', v_client_a::text || '/portal/artwork/zz-proof-arch.png', v_cust_a::text);
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.gl_portal_artwork() where artwork_id = v_art_arch;
  select count(*) into n2 from public.client_artwork where id = v_art_arch; n := n + n2;
  select count(*) into n2 from storage.objects where name = v_client_a::text || '/portal/artwork/zz-proof-arch.png'; n := n + n2;
  update public.client_artwork set project_id = null where id = v_art_arch; get diagnostics n2 = row_count;
  reset role;
  if n = 0 and n2 = 0 then passes := passes + 1; lines := lines || E'\n  PASS  CP05 archived-project artwork hidden via RPC, table and storage; customer cannot reassign';
  else fails := fails + 1; lines := lines || E'\n  FAIL  CP05 archived artwork visible (' || n || ') or reassigned (' || n2 || ')'; end if;

  -- CP06: no session, no ledger writes
  perform set_config('request.jwt.claims', '', true);
  ok := true;
  begin insert into public.project_entitlement_events (project_id, service_key, action, actor) values (v_proj_a, 'renders', 'grant', v_staff); ok := false; exception when others then null; end;
  begin insert into public.artwork_reviews (artwork_id, decision, decided_by) values (v_art_staff, 'in_review', v_staff); ok := false; exception when others then null; end;
  if ok then passes := passes + 1; lines := lines || E'\n  PASS  CP06 no signed-in user: entitlement and decision writes refused';
  else fails := fails + 1; lines := lines || E'\n  FAIL  CP06 a ledger accepted a write with no session'; end if;

  -- immutable history (a real row in each ledger first, so a refusal is not vacuous)
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.project_entitlement_events (project_id, service_key, action, actor) values (v_proj_a, 'packaging_artwork', 'grant', v_staff);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  ok := true;
  begin update public.artwork_reviews set decision = 'sent_to_printer' where artwork_id = v_art_up; ok := false; exception when others then null; end;
  begin delete from public.artwork_reviews where artwork_id = v_art_up; ok := false; exception when others then null; end;
  begin delete from public.project_entitlement_events where project_id = v_proj_a; get diagnostics n = row_count; if n > 0 then ok := false; end if; exception when others then null; end;
  if ok then passes := passes + 1; lines := lines || E'\n  PASS  artwork and entitlement ledgers refuse update and delete, even as owner';
  else fails := fails + 1; lines := lines || E'\n  FAIL  a ledger accepted an update or delete'; end if;

  -- tenant foreign key
  begin
    update public.deal_documents set project_id = v_proj_b where id = v_legacy_doc;
    fails := fails + 1; lines := lines || E'\n  FAIL  a client A document joined client B''s project';
  exception when foreign_key_violation then
    passes := passes + 1; lines := lines || E'\n  PASS  composite tenant FK refuses A''s document on B''s project';
  end;

  -- CP03: downloaded formula document
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.formula_documents (formula_id, version, doc_kind, name, file_path, published_at)
  values (v_formula, 1, 'coa', 'zz proof coa', 'formula/' || v_formula || '/zz-proof.pdf', now()) returning id into v_fdoc;
  reset role;
  insert into public.formula_document_downloads (formula_document_id, customer_user_id) values (v_fdoc, v_cu_a);
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := true;
  begin delete from public.formula_documents where id = v_fdoc; ok := false; exception when others then null; end;
  delete from storage.objects where name = 'formula/' || v_formula || '/zz-proof.pdf'; get diagnostics n = row_count;
  update public.formula_documents set superseded_at = now() where id = v_fdoc;
  insert into public.formula_documents (formula_id, version, doc_kind, name, file_path) values (v_formula, 1, 'coa', 'zz proof coa corrected', 'formula/' || v_formula || '/zz-proof-2.pdf');
  begin update public.formula_documents set published_at = now() where id = v_fdoc; ok := false; exception when others then null; end;
  reset role;
  select count(*) into n2 from public.formula_document_downloads where formula_document_id = v_fdoc;
  if ok and n = 0 and n2 = 1 then passes := passes + 1; lines := lines || E'\n  PASS  CP03 downloaded document and its file cannot be deleted; supersede + correction works; log kept';
  else fails := fails + 1; lines := lines || E'\n  FAIL  CP03 (file delete rows ' || n || ', log rows ' || n2 || ')'; end if;

  -- CP07: accepted quote lock
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into public.quotes (client_id, quote_number, quote_date, valid_days, product_type, package_format, status, tiers, addons, inclusions, project_id, services)
  values (v_client_a, 'ZZ-PROOF-Q', current_date, 30, 'canning', 'proof', 'draft', '[]', '[]', '{}', v_proj_a, array['renders']) returning id into v_q;
  update public.quotes set status = 'accepted' where id = v_q;
  select count(*) into n from public.project_entitlement_events where project_id = v_proj_a and service_key = 'renders' and action = 'grant';
  ok := n = 1;
  begin update public.quotes set services = array['renders','market_analytics'] where id = v_q; ok := false; exception when others then null; end;
  begin update public.quotes set project_id = null where id = v_q; ok := false; exception when others then null; end;
  begin update public.quotes set status = 'declined' where id = v_q; ok := false; exception when others then null; end;
  insert into public.quotes (client_id, quote_number, quote_date, valid_days, product_type, package_format, status, tiers, addons, inclusions, project_id, services)
  values (v_client_a, 'ZZ-PROOF-Q2', current_date, 30, 'canning', 'proof', 'draft', '[]', '[]', '{}', v_proj_a_arch, array['renders']) returning id into v_q2;
  begin update public.quotes set status = 'accepted' where id = v_q2; ok := false; exception when others then null; end;
  reset role;
  if ok then passes := passes + 1; lines := lines || E'\n  PASS  CP07 acceptance grants once; accepted quote locked; archived-project acceptance refused';
  else fails := fails + 1; lines := lines || E'\n  FAIL  CP07 grants ' || n || ' or a locked field changed'; end if;

  -- CP08: archived-project document email, and send-time revalidation
  select count(*) into n from public.email_schedule;
  insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible, project_id)
  values (v_client_a, 'Other', 'zz proof archived doc', v_client_a::text || '/docs/zz-a.pdf', false, v_proj_a_arch) returning id into v_doc_arch;
  update public.deal_documents set client_visible = true where id = v_doc_arch;
  select count(*) into n2 from public.email_schedule;
  ok := n2 = n;
  insert into public.deal_documents (client_id, doc_type, name, file_path, client_visible, project_id)
  values (v_client_a, 'Other', 'zz proof active doc', v_client_a::text || '/docs/zz-b.pdf', false, v_proj_a) returning id into v_doc_act;
  update public.customer_users set notify_project_updates = true where id = v_cu_a;
  update public.deal_documents set client_visible = true where id = v_doc_act;
  -- The queue de-duplicates identical subjects to one recipient within an hour,
  -- so the pending "new document" email may announce an earlier fixture document.
  -- Test the send-time check against whichever document the queued email names.
  select e.id, (e.portal_event->>'ref')::uuid into v_sched, v_doc_act
    from public.email_schedule e
   where e.portal_event->>'kind' = 'document' and e.portal_event->>'client_id' = v_client_a::text and e.status = 'pending'
   order by e.created_at desc limit 1;
  ok := ok and v_sched is not null and public.gl_portal_email_block_reason(v_sched) is null;
  update public.deal_documents set client_visible = false where id = v_doc_act;
  ok := ok and public.gl_portal_email_block_reason(v_sched) is not null;
  update public.deal_documents set client_visible = true where id = v_doc_act;
  update public.customer_users set notify_project_updates = false where id = v_cu_a;
  ok := ok and public.gl_portal_email_block_reason(v_sched) is not null;
  update public.customer_users set notify_project_updates = true, active = false where id = v_cu_a;
  ok := ok and public.gl_portal_email_block_reason(v_sched) is not null;
  update public.customer_users set active = true where id = v_cu_a;
  update public.projects set archived_at = now() where id = v_proj_a;
  ok := ok and public.gl_portal_email_block_reason(v_sched) is not null;
  update public.projects set archived_at = null where id = v_proj_a;
  if ok then passes := passes + 1; lines := lines || E'\n  PASS  CP08 no email for archived-project documents; send-time check blocks after hide, opt-out, deactivation, archive';
  else fails := fails + 1; lines := lines || E'\n  FAIL  CP08 notification visibility'; end if;

  -- ════════════════════════════ other client (B) ════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_cust_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.projects where id in (v_proj_a, v_proj_a_arch);
  select count(*) into n2 from public.deal_documents where client_id = v_client_a; n := n + n2;
  select count(*) into n2 from storage.objects where name in (c_up_doc, c_legacy_obj); n := n + n2;
  select count(*) into n2 from public.gl_portal_artwork() where artwork_id in (v_art_up, v_art_staff); n := n + n2;
  reset role;
  if n = 0 then passes := passes + 1; lines := lines || E'\n  PASS  another client reads 0 of client A''s projects, documents, files and artwork';
  else fails := fails + 1; lines := lines || E'\n  FAIL  another client read ' || n || ' of client A''s rows'; end if;

  -- ════════════════════════════ deactivated, stranger, anonymous ════════════
  update public.customer_users set active = false where auth_user_id = v_cust_b;
  foreach v in array array[v_cust_b::text, c_stranger::text] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into n from public.projects;
    select count(*) into n2 from public.deal_documents; n := n + n2;
    select count(*) into n2 from storage.objects where bucket_id = 'client-docs'; n := n + n2;
    select count(*) into n2 from public.gl_portal_artwork(); n := n + n2;
    select count(*) into n2 from public.gl_portal_entitlements(); n := n + n2;
    reset role;
    if n = 0 then passes := passes + 1; lines := lines || E'\n  PASS  ' || case when v = v_cust_b::text then 'deactivated customer' else 'authenticated stranger' end || ' reads 0 portal rows, files or RPC results';
    else fails := fails + 1; lines := lines || E'\n  FAIL  ' || case when v = v_cust_b::text then 'deactivated customer' else 'authenticated stranger' end || ' read ' || n || ' rows'; end if;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  n := 0;
  begin select count(*) into n2 from public.projects; n := n + n2; exception when insufficient_privilege then null; end;
  begin select count(*) into n2 from public.deal_documents; n := n + n2; exception when insufficient_privilege then null; end;
  begin select count(*) into n2 from storage.objects where bucket_id = 'client-docs'; n := n + n2; exception when insufficient_privilege then null; end;
  ok := true;
  begin perform public.gl_portal_artwork(); ok := false; exception when insufficient_privilege then null; end;
  reset role;
  if n = 0 and ok then passes := passes + 1; lines := lines || E'\n  PASS  anonymous caller reads 0 rows and cannot execute portal RPCs';
  else fails := fails + 1; lines := lines || E'\n  FAIL  anonymous read ' || n || ' rows or executed a portal RPC'; end if;

  -- ════════════════════════════ privileges ══════════════════════════════════
  -- PUBLIC is not a role you can ask has_function_privilege about; it is the
  -- grantee 0 entry in the ACL, and a NULL ACL means the default grant to PUBLIC.
  select string_agg(p.proname, ', ') into v
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname = any (array['gl_audit_actor_email','gl_audit_milestone','gl_audit_entitlement',
       'gl_audit_document_visibility','gl_audit_artwork_project','gl_stamp_project_milestones',
       'gl_guard_entitlement_append_only','gl_guard_artwork_identity','gl_guard_formula_document_supersede',
       'gl_guard_accepted_quote','gl_enqueue_portal_email','gl_portal_email_block_reason',
       'gl_quote_grant_entitlements','gl_notify_document','gl_notify_artwork_decision','gl_notify_milestone'])
     and ( p.proacl is null
        or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
        or has_function_privilege('anon', p.oid, 'EXECUTE')
        or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v is null then passes := passes + 1; lines := lines || E'\n  PASS  trigger-only and queue functions: no EXECUTE for PUBLIC, anon or authenticated';
  else fails := fails + 1; lines := lines || E'\n  FAIL  executable by an untrusted role: ' || v; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_cust_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ok := true;
  begin perform public.gl_portal_email_block_reason(v_sched); ok := false; exception when insufficient_privilege then null; end;
  begin perform public.gl_enqueue_portal_email(v_client_a, 'project', 'x', 'y', null); ok := false; exception when insufficient_privilege then null; end;
  reset role;
  if ok then passes := passes + 1; lines := lines || E'\n  PASS  a customer cannot call the email queue or its send-time check directly';
  else fails := fails + 1; lines := lines || E'\n  FAIL  a customer invoked an email queue function'; end if;

  -- ── result (always raises: every fixture above is rolled back) ─────────────
  if fails = 0 then
    RAISE EXCEPTION E'PORTAL ISOLATION PROOF: PASS — % assertions, 0 failed (all fixtures rolled back)%', passes, lines;
  else
    RAISE EXCEPTION E'PORTAL ISOLATION PROOF: FAIL — % failed of % %', fails, passes + fails, lines;
  end if;
END
$proof$;
