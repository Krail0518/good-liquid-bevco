-- ─────────────────────────────────────────────────────────────────────────
-- Prerequisite Programs (PRPs) for the GMP / HACCP foundation.
--
-- These are the periodic support programs an SQF / HACCP system rests on:
-- calibration, pest control, chemical & SDS control, glass & brittle-plastic
-- control, water potability, and customer complaints. Like the daily GMP
-- forms they are stored as gmp_templates and their entries are ordinary
-- compliance_records (form_code + data jsonb + e-signature + deviation flags).
--
-- The one difference: in_daily = false, so they DON'T appear on the "log
-- today" fan-out. Each opens its own single-form entry from the GMP hub's
-- "Prerequisite Programs" tiles. Field types the UI understands:
--   text, textarea, number, time, date, select, check, passfail.
-- deviation_if marks the value that raises a deviation / CAPA.
-- ─────────────────────────────────────────────────────────────────────────

insert into public.gmp_templates (form_code, title, category, frequency, in_daily, sort_order, fields, help) values
('GMP-CAL-001', 'Calibration Verification', 'calibration', 'monthly', false, 110,
 '[{"key":"instrument","label":"Instrument / device","type":"text","required":true},
   {"key":"instrument_id","label":"Instrument ID / serial","type":"text"},
   {"key":"reference","label":"Reference standard used","type":"text","required":true},
   {"key":"as_found","label":"As-found reading","type":"number"},
   {"key":"as_left","label":"As-left reading","type":"number"},
   {"key":"tolerance_ok","label":"Within tolerance","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"next_due","label":"Next calibration due","type":"date"},
   {"key":"performed_by","label":"Performed by","type":"text"},
   {"key":"notes","label":"Adjustment / notes","type":"textarea"}]'::jsonb,
 'Verify thermometers, scales, pH meters, timers, etc. against a traceable standard on schedule. Out-of-tolerance means assess affected product back to the last good check and open a CAPA.'),

('GMP-PEST-001', 'Pest Control Inspection', 'pest', 'weekly', false, 120,
 '[{"key":"inspector","label":"Inspection by","type":"select","options":["In-house","PCO / contractor"],"required":true},
   {"key":"pco_name","label":"PCO / technician name","type":"text"},
   {"key":"devices_checked","label":"Devices checked (qty)","type":"number"},
   {"key":"devices_serviced","label":"Devices serviced / replaced (qty)","type":"number"},
   {"key":"exterior_ok","label":"Exterior / perimeter OK (no harborage)","type":"passfail","deviation_if":"fail"},
   {"key":"no_activity","label":"Devices intact & no pest activity","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"corrective_action","label":"Corrective action if activity found","type":"textarea"},
   {"key":"notes","label":"Notes","type":"textarea"}]'::jsonb,
 'Check bait stations, insect light traps and rodent devices on the pest map. Any activity or a compromised device is a deviation — act and record the corrective action.'),

('GMP-CHEM-001', 'Chemical & SDS Control', 'chemical', 'as_needed', false, 130,
 '[{"key":"chemical_name","label":"Chemical / product name","type":"text","required":true},
   {"key":"use","label":"Use","type":"select","options":["Sanitizer","Cleaner","Food-grade lubricant","Pest control","Lab reagent","Other"],"required":true},
   {"key":"approved_food_safe","label":"Approved for food-plant use","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"sds_on_file","label":"Current SDS on file","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"stored_segregated","label":"Stored & segregated correctly (locked, away from food/packaging)","type":"passfail","deviation_if":"fail"},
   {"key":"concentration","label":"Use concentration (e.g. ppm)","type":"text"},
   {"key":"lot","label":"Lot / receipt","type":"text"},
   {"key":"notes","label":"Notes","type":"textarea"}]'::jsonb,
 'Add or review any chemical on site. Every chemical needs a current SDS, must be approved for food-plant use, and must be stored segregated from food and packaging.'),

('GMP-GLASS-001', 'Glass & Brittle Plastic Audit', 'glass', 'weekly', false, 140,
 '[{"key":"area","label":"Area / line audited","type":"text","required":true},
   {"key":"register_current","label":"Glass & brittle-plastic register current","type":"passfail","deviation_if":"fail"},
   {"key":"all_intact","label":"All listed items present & intact (no cracks/chips)","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"breakage","label":"Breakage this period","type":"select","options":["None","Contained (no product exposure)","Product / line exposed"],"deviation_if":"Product / line exposed"},
   {"key":"action_taken","label":"Action taken on breakage","type":"textarea"},
   {"key":"notes","label":"Notes","type":"textarea"}]'::jsonb,
 'Audit glass and hard/brittle plastic (lights, gauges, sight glasses, guards) against the register. A break with product exposure holds affected product and opens a CAPA.'),

('GMP-WATER-001', 'Water Potability', 'water', 'annual', false, 150,
 '[{"key":"source","label":"Water source","type":"select","options":["Municipal","Well","Both"],"required":true},
   {"key":"test_type","label":"Test performed","type":"select","options":["Microbial (coliform / E. coli)","Chemical","Both"],"required":true},
   {"key":"lab","label":"Testing lab","type":"text"},
   {"key":"coliform_absent","label":"Coliform / E. coli absent","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"residual_cl","label":"Residual chlorine (ppm)","type":"number"},
   {"key":"result_ok","label":"Result meets potable standard","type":"passfail","required":true,"deviation_if":"fail"},
   {"key":"report_on_file","label":"Lab report on file","type":"check"},
   {"key":"next_due","label":"Next test due","type":"date"},
   {"key":"notes","label":"Notes","type":"textarea"}]'::jsonb,
 'Confirm process/ingredient water is potable — annual (or per your schedule) microbial and chemical testing. A non-potable result is a food-safety deviation; assess exposed product.'),

('GMP-COMPL-001', 'Customer Complaint Log', 'complaint', 'as_needed', false, 160,
 '[{"key":"complaint_date","label":"Date received","type":"date","required":true},
   {"key":"customer","label":"Customer / complainant","type":"text","required":true},
   {"key":"product","label":"Product / brand","type":"text"},
   {"key":"lot","label":"Lot / date code","type":"text"},
   {"key":"category","label":"Complaint category","type":"select","options":["Foreign material","Off-taste / odor","Packaging / seal","Illness / injury","Labeling / allergen","Other"],"required":true},
   {"key":"food_safety","label":"Food-safety complaint","type":"select","options":["No","Yes"],"required":true,"deviation_if":"Yes"},
   {"key":"description","label":"Description","type":"textarea","required":true},
   {"key":"investigation","label":"Investigation / root cause","type":"textarea"},
   {"key":"corrective_action","label":"Corrective action / response","type":"textarea"},
   {"key":"ncr_number","label":"NCR # (if raised)","type":"text"}]'::jsonb,
 'Log every customer complaint. A food-safety complaint (foreign material, illness, allergen) flags a deviation — investigate, respond, and raise an NCR.')
on conflict (form_code) do nothing;

-- Scheduler task definitions for the periodic PRPs (idempotent per form_code).
insert into public.gmp_task_defs (title, task_type, frequency, due_time, weekday, form_code, category, sort_order)
select v.title, v.task_type, v.frequency, v.due_time, v.weekday, v.form_code, v.category, v.sort_order
from (values
  ('Pest control inspection', 'pest', 'weekly', null::time, 1, 'GMP-PEST-001', 'pest', 120),
  ('Glass & brittle-plastic audit', 'glass', 'weekly', null::time, 1, 'GMP-GLASS-001', 'glass', 140),
  ('Calibration verification', 'calibration', 'monthly', null::time, null::integer, 'GMP-CAL-001', 'calibration', 110),
  ('Water potability test', 'water', 'annual', null::time, null::integer, 'GMP-WATER-001', 'water', 150)
) as v(title, task_type, frequency, due_time, weekday, form_code, category, sort_order)
where not exists (
  select 1 from public.gmp_task_defs d where d.form_code = v.form_code
);

notify pgrst, 'reload schema';
