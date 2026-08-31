-- Compliance signature and hold integrity — live proof.
--
-- Auditor item C. Run against any environment with
-- 20260831230000_compliance_signature_integrity.sql applied. Creates its own
-- fixtures, asserts, and ROLLS BACK, so it is safe against production.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/compliance-integrity-proof.sql
--
-- Every S and H assertion below was ALLOWED before that migration. These are
-- FDA records: a signature that does not bind the content it signed is
-- decoration, and a dual-signature control one person can satisfy alone is not
-- a control.

\set ON_ERROR_STOP on
begin;

create temporary table proof(at timestamptz, id text, assertion text, observed text, verdict text);

do $p$
declare rid uuid; did uuid; hid uuid;
begin
  insert into public.compliance_records
    (form_code, record_date, recorded_at, data, status, signed_by, signed_at, signature_name, signature_meaning, has_deviation)
  values ('PROOF-SIGNED', current_date, now(), '{"reading":"5ppm","operator":"Alice"}'::jsonb, 'signed',
          '11111111-1111-1111-1111-111111111111', now(), 'Alice', 'Reviewed', false)
  returning id into rid;

  insert into public.compliance_records
    (form_code, record_date, recorded_at, data, status, has_deviation)
  values ('PROOF-DRAFT', current_date, now(), '{}'::jsonb, 'draft', false)
  returning id into did;

  insert into public.hold_tags (tag_number, hold_date, product_name, lot_number, reason, status,
          disposition, disposition_authorized_by, disposition_authorized_name, disposition_date)
  values ('PROOF-HT', now(), 'Cola', 'L1', 'foreign matter', 'released',
          'released', '11111111-1111-1111-1111-111111111111', 'Alice', now())
  returning id into hid;

  -- ── signatures are final ────────────────────────────────────────────────
  begin update public.compliance_records set signature_name='Bob', signed_by='22222222-2222-2222-2222-222222222222' where id=rid;
    insert into proof values (clock_timestamp(),'S1','re-sign an already signed record as someone else','ALLOWED','FAIL');
  exception when insufficient_privilege then
    insert into proof values (clock_timestamp(),'S1','re-sign an already signed record as someone else','refused 42501','PASS'); end;

  begin update public.compliance_records set data = data || '{"reading":"0ppm"}'::jsonb where id=rid;
    insert into proof values (clock_timestamp(),'S2','alter the attested content of a signed record','ALLOWED','FAIL');
  exception when insufficient_privilege then
    insert into proof values (clock_timestamp(),'S2','alter the attested content of a signed record','refused 42501','PASS'); end;

  begin update public.compliance_records set signed_at = now() - interval '30 days' where id=rid;
    insert into proof values (clock_timestamp(),'S3','backdate a signature by 30 days','ALLOWED','FAIL');
  exception when insufficient_privilege then
    insert into proof values (clock_timestamp(),'S3','backdate a signature by 30 days','refused 42501','PASS'); end;

  begin update public.compliance_records set has_deviation=true, deviation_notes='rewritten' where id=rid;
    insert into proof values (clock_timestamp(),'S4','rewrite the deviation findings','ALLOWED','FAIL');
  exception when insufficient_privilege then
    insert into proof values (clock_timestamp(),'S4','rewrite the deviation findings','refused 42501','PASS'); end;

  -- ── dual PCQI means two people ──────────────────────────────────────────
  begin update public.compliance_records
       set second_signed_by='11111111-1111-1111-1111-111111111111', second_signed_at=now(), second_signature_name='Alice' where id=rid;
    insert into proof values (clock_timestamp(),'S5','co-sign as the SAME person who signed first','ALLOWED','FAIL');
  exception when insufficient_privilege then
    insert into proof values (clock_timestamp(),'S5','co-sign as the SAME person who signed first','refused 42501','PASS'); end;

  begin update public.compliance_records
       set second_signed_by='33333333-3333-3333-3333-333333333333', second_signed_at=now(), second_signature_name='Carol' where id=rid;
    insert into proof values (clock_timestamp(),'S6','co-sign as a DIFFERENT person (must work)','allowed','PASS');
  exception when others then
    insert into proof values (clock_timestamp(),'S6','co-sign as a different person','BLOCKED '||sqlerrm,'FAIL'); end;

  begin update public.compliance_records set second_signature_name='Dave' where id=rid;
    insert into proof values (clock_timestamp(),'S7','change an existing co-signature','ALLOWED','FAIL');
  exception when insufficient_privilege then
    insert into proof values (clock_timestamp(),'S7','change an existing co-signature','refused 42501','PASS'); end;

  -- ── a draft cannot be signed ────────────────────────────────────────────
  begin update public.compliance_records
       set signed_at=now(), signed_by='11111111-1111-1111-1111-111111111111', signature_name='Alice' where id=did;
    insert into proof values (clock_timestamp(),'S8','sign a record whose status is draft','ALLOWED','FAIL');
  exception when insufficient_privilege then
    insert into proof values (clock_timestamp(),'S8','sign a record whose status is draft','refused 42501','PASS'); end;

  -- ── the live workflows must keep working ────────────────────────────────
  -- `data` carries the attested content AND lifecycle metadata. Four real
  -- workflows stamp these keys onto signed records -- retiring a form,
  -- archiving a batch, locking records when an invoice is paid. A control that
  -- stops routine work gets removed rather than obeyed, so these are asserted
  -- as loudly as the refusals.
  begin update public.compliance_records set data = data || '{"locked_at":"x","locked_reason":"invoice paid"}'::jsonb where id=rid;
    insert into proof values (clock_timestamp(),'L1','lock a signed record','allowed','PASS');
  exception when others then insert into proof values (clock_timestamp(),'L1','lock a signed record','BLOCKED '||sqlerrm,'FAIL'); end;

  begin update public.compliance_records set data = data || '{"archived_at":"x"}'::jsonb where id=rid;
    insert into proof values (clock_timestamp(),'L2','archive a signed record','allowed','PASS');
  exception when others then insert into proof values (clock_timestamp(),'L2','archive a signed record','BLOCKED','FAIL'); end;

  begin update public.compliance_records set data = data || '{"retired_at":"x"}'::jsonb where id=rid;
    insert into proof values (clock_timestamp(),'L3','retire a signed record','allowed','PASS');
  exception when others then insert into proof values (clock_timestamp(),'L3','retire a signed record','BLOCKED','FAIL'); end;

  begin update public.compliance_records set notes='context added later' where id=rid;
    insert into proof values (clock_timestamp(),'L4','add notes to a signed record','allowed','PASS');
  exception when others then insert into proof values (clock_timestamp(),'L4','add notes to a signed record','BLOCKED','FAIL'); end;

  -- ── hold dispositions are final ─────────────────────────────────────────
  begin update public.hold_tags set disposition='disposed' where id=hid;
    insert into proof values (clock_timestamp(),'H1','rewrite a hold disposition','ALLOWED','FAIL');
  exception when insufficient_privilege then
    insert into proof values (clock_timestamp(),'H1','rewrite a hold disposition','refused 42501','PASS'); end;

  begin update public.hold_tags set status='open' where id=hid;
    insert into proof values (clock_timestamp(),'H2','re-open a dispositioned hold','ALLOWED','FAIL');
  exception when insufficient_privilege then
    insert into proof values (clock_timestamp(),'H2','re-open a dispositioned hold','refused 42501','PASS'); end;

  begin update public.hold_tags set notes='context' where id=hid;
    insert into proof values (clock_timestamp(),'H3','add notes to a dispositioned hold','allowed','PASS');
  exception when others then insert into proof values (clock_timestamp(),'H3','add notes to a dispositioned hold','BLOCKED','FAIL'); end;
end
$p$;

select verdict, id, assertion, observed from proof order by at;

do $verdict$
declare bad int;
begin
  select count(*) into bad from proof where verdict <> 'PASS';
  if bad > 0 then raise exception '% compliance-integrity assertion(s) FAILED', bad; end if;
  raise notice 'compliance integrity: all assertions passed';
end
$verdict$;

-- NOT COVERED, named rather than implied:
--   * required fields per form before signing -- the form shapes live in the
--     client, and encoding thirty of them in SQL is its own change
--   * photo association under concurrent uploads (the audit's GL-022)
--   * export completeness and pagination (the audit's GL-031)
--   * recent-reauthentication before signing -- an auth policy decision, not a
--     schema rule
--   * two live connections signing simultaneously -- the same environment
--     limits as the payment ledger: dblink requires a password this process
--     will not handle, and max_prepared_transactions is 0

rollback;
