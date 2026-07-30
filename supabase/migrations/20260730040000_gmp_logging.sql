-- Daily GMP logging: "type once → fan out to every linked register".
--
-- DESIGN
--   Registers/forms are defined in DB (gmp_templates), never hardcoded in the
--   app. A "session" (one day / one run) is entered on one screen: shared header
--   fields (date, shift, line, run, operator) are typed once, each active form's
--   specifics once, and on save the app writes one compliance_records row per
--   form — all sharing a batch_id and the shared header — so each register shows
--   its slice but the operator entered the common data a single time.
--
--   compliance_records already carries form_code + data(jsonb) + e-signature +
--   deviation fields, so GMP entries are just compliance_records with a GMP
--   form_code. This migration adds the template registry, the batch grouping
--   column, a couple of read helpers, and extends inspector (auditor) read
--   access to the templates.
--
--   Nothing here is app-specific SQL beyond the standard patterns; all logging
--   data lives in Postgres (compliance_records), no client-side storage.

-- 1) Group siblings written from one session, and remember which template.
alter table public.compliance_records add column if not exists batch_id uuid;
create index if not exists idx_compliance_records_batch on public.compliance_records(batch_id);
create index if not exists idx_compliance_records_formcode_date on public.compliance_records(form_code, record_date desc);

-- 2) Form / register definitions.
create table if not exists public.gmp_templates (
  form_code   text primary key,          -- e.g. GMP-PREOP-001
  title       text not null,             -- "Pre-Operational Sanitation Verification"
  category    text not null,             -- sanitation|hygiene|ccp|seam|label|receiving|glass|other
  frequency   text not null default 'daily',  -- daily|per_run|weekly|monthly|annual|as_needed
  in_daily    boolean not null default true,  -- show on the Daily GMP combo screen
  fields      jsonb not null default '[]'::jsonb, -- [{key,label,type,required,options,unit,deviation_if}]
  help        text,
  sort_order  integer not null default 100,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

alter table public.gmp_templates enable row level security;

drop policy if exists "gmp_templates staff all" on public.gmp_templates;
create policy "gmp_templates staff all" on public.gmp_templates
  for all to authenticated
  using (public.is_staff_user()) with check (public.is_staff_user());

-- Auditor (inspector token) read access to the definitions, matching the
-- existing inspector read policies on compliance_records/production_runs/etc.
drop policy if exists "gmp_templates inspector read" on public.gmp_templates;
create policy "gmp_templates inspector read" on public.gmp_templates
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

-- 3) Seed the core daily forms (idempotent). Field types the UI understands:
--    text, textarea, number, time, select, check, passfail. deviation_if marks
--    the value that should raise a deviation/CAPA (e.g. result = 'fail').
insert into public.gmp_templates (form_code, title, category, frequency, in_daily, sort_order, fields, help) values
('GMP-PREOP-001', 'Pre-Operational Sanitation Verification', 'sanitation', 'per_run', true, 10,
 '[{"key":"area","label":"Line / area","type":"text","required":true},
   {"key":"method","label":"Verification method","type":"select","options":["Visual","ATP","Both"],"required":true},
   {"key":"atp_rlu","label":"ATP reading (RLU)","type":"number"},
   {"key":"result","label":"Result","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"notes","label":"Notes","type":"textarea"}]'::jsonb,
 'Complete before startup. A fail must be re-cleaned and re-verified before production.'),
('GMP-HYGIENE-001', 'Daily GMP & Personnel Hygiene Check', 'hygiene', 'daily', true, 20,
 '[{"key":"garments","label":"Garments / hairnets / beard nets OK","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"jewelry","label":"No jewelry / bare-hand policy OK","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"handwashing","label":"Handwashing stations stocked & used","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"illness","label":"Illness / injury reporting checked","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"visitors","label":"Visitors logged & GMP-briefed","type":"passfail","required":true},
   {"key":"notes","label":"Notes / follow-ups","type":"textarea"}]'::jsonb,
 'Observe the floor at startup. Any fail gets an on-the-spot correction plus a CAPA if systemic.'),
('GMP-CCP-PAST-001', 'CCP Monitoring — Flash Pasteurizer', 'ccp', 'per_run', true, 30,
 '[{"key":"product","label":"Product / batch","type":"text","required":true},
   {"key":"thermometer_id","label":"Thermometer ID","type":"text","required":true},
   {"key":"temp_f","label":"Outlet temp (°F)","type":"number","required":true},
   {"key":"critical_limit_f","label":"Critical limit (°F)","type":"number","required":true},
   {"key":"flow_ok","label":"Flow / diversion alarm OK","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"within_limit","label":"Within critical limit","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"notes","label":"Corrective action if any","type":"textarea"}]'::jsonb,
 'Record at startup and at set intervals. Out-of-limit = hold affected product and open a CAPA.'),
('GMP-SEAM-001', 'Double-Seam Inspection', 'seam', 'per_run', true, 40,
 '[{"key":"seamer_id","label":"Seamer / head","type":"text","required":true},
   {"key":"product","label":"Product / lot","type":"text","required":true},
   {"key":"visual_ok","label":"Visual seam OK (no cutovers, droops, vees)","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"teardown_done","label":"Teardown / micrometer done","type":"check"},
   {"key":"body_hook","label":"Body hook (in)","type":"number"},
   {"key":"cover_hook","label":"Cover hook (in)","type":"number"},
   {"key":"overlap","label":"Overlap (in)","type":"number"},
   {"key":"tightness","label":"Tightness rating OK","type":"passfail","deviation_if":"fail"},
   {"key":"notes","label":"Notes","type":"textarea"}]'::jsonb,
 'Startup + at interval per seamer. A failing seam holds product back to the last good check.'),
('GMP-LABEL-001', 'Label / Artwork Reconciliation', 'label', 'per_run', true, 50,
 '[{"key":"product","label":"Product / brand","type":"text","required":true},
   {"key":"lot","label":"Lot / date code","type":"text","required":true},
   {"key":"artwork_approved","label":"Artwork/label version approved on file","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"received","label":"Labels/sleeves received (qty)","type":"number"},
   {"key":"applied","label":"Applied / good units (qty)","type":"number"},
   {"key":"scrapped","label":"Damaged / scrapped (qty)","type":"number"},
   {"key":"reconciled","label":"Reconciles (received = applied + scrapped + returned)","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"notes","label":"Variance explanation","type":"textarea"}]'::jsonb,
 'End of run. A reconciliation gap can mean mislabeled product in the field — investigate before release.'),
('GMP-RECV-001', 'Receiving Inspection', 'receiving', 'as_needed', true, 60,
 '[{"key":"supplier","label":"Supplier","type":"text","required":true},
   {"key":"material","label":"Material / PO","type":"text","required":true},
   {"key":"lot","label":"Supplier lot","type":"text"},
   {"key":"condition_ok","label":"Condition OK (no damage/pests/tamper)","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"temp_ok","label":"Temp OK (if applicable)","type":"passfail"},
   {"key":"coa_received","label":"COA received (if required)","type":"check"},
   {"key":"seal_ok","label":"Seal intact / matches paperwork","type":"passfail","deviation_if":"fail"},
   {"key":"accepted","label":"Accepted","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"notes","label":"Notes","type":"textarea"}]'::jsonb,
 'Every inbound ingredient/packaging delivery. Rejected loads go on the CAPA log.')
on conflict (form_code) do nothing;

notify pgrst, 'reload schema';
