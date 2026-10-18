-- ════════════════════════════════════════════════════════════════
-- Product intake: remap stored answers to the new option wording
-- ════════════════════════════════════════════════════════════════
-- intake-questions.js was brought in line with the PROJECT QUESTIONNAIRE
-- emailed to leads. Field keys are unchanged; some option strings changed.
-- This rewrites existing answers so selects and checkboxes still prefill.
-- Data only. No policy or grant changes.
--
-- ROLLBACK: not reversible (old wording discarded); values remain readable.

-- Single value selects
update public.product_intake set answers = answers || jsonb_build_object('format',
  case answers->>'format' when '16oz can' then '16oz standard can' else answers->>'format' end)
where answers ? 'format';

update public.product_intake set answers = answers || jsonb_build_object('target_volume',
  case answers->>'target_volume'
    when '200–339 cases'     then '200 to 499 cases'
    when '340–500 cases'     then '200 to 499 cases'
    when '501–999 cases'     then '500 to 999 cases'
    when '1,000–2,499 cases' then '1,000 to 2,499 cases'
    when '2,500–4,999 cases' then '2,500 cases or more'
    when '5,000+ cases'      then '2,500 cases or more'
    else answers->>'target_volume' end)
where answers ? 'target_volume';

update public.product_intake set answers = answers || jsonb_build_object('timeline',
  case answers->>'timeline'
    when '1–3 months' then '1 to 3 months'
    when '3–6 months' then '3 to 6 months'
    else answers->>'timeline' end)
where answers ? 'timeline';

update public.product_intake set answers = answers || jsonb_build_object('formula_status',
  case answers->>'formula_status'
    when 'I have a finished, tested formula'  then 'Finished commercial formula, ready to scale'
    when 'I have a draft — needs refinement'  then 'Working recipe that needs development'
    when 'I need R&D from scratch'            then 'Need formulation from scratch'
    else answers->>'formula_status' end)
where answers ? 'formula_status';

update public.product_intake set answers = answers || jsonb_build_object('label_type',
  case answers->>'label_type'
    when 'Shrink sleeve'            then 'Shrink sleeves'
    when 'Pre-printed can'          then 'Printed cans'
    when 'Pressure-sensitive label' then 'Bottle labels'
    when 'None yet'                 then 'Not decided yet'
    else answers->>'label_type' end)
where answers ? 'label_type';

update public.product_intake set answers = answers || jsonb_build_object('artwork_status',
  case answers->>'artwork_status' when 'Print-ready artwork' then 'Print ready artwork' else answers->>'artwork_status' end)
where answers ? 'artwork_status';

update public.product_intake set answers = answers || jsonb_build_object('ph_known',
  case answers->>'ph_known' when '4.6 or above (low-acid)' then '4.6 or above (low acid)' else answers->>'ph_known' end)
where answers ? 'ph_known';

update public.product_intake set answers = answers || jsonb_build_object('shelf_stability',
  case answers->>'shelf_stability'
    when 'Shelf-stable / ambient'    then 'Shelf stable / ambient'
    when 'Refrigerated / cold-chain' then 'Refrigerated / cold chain'
    else answers->>'shelf_stability' end)
where answers ? 'shelf_stability';

-- Multiselects
update public.product_intake p set answers = p.answers || jsonb_build_object('secondary_packaging',
  coalesce((select jsonb_agg(distinct m) from (
     select case v when 'PakTech handles' then '4 pack carriers (PakTech)'
                   when 'None / not sure' then 'Not sure yet' end as m
     from jsonb_array_elements_text(p.answers->'secondary_packaging') v) x where m is not null), '[]'::jsonb))
where jsonb_typeof(p.answers->'secondary_packaging') = 'array';

update public.product_intake p set answers = p.answers || jsonb_build_object('certifications',
  coalesce((select jsonb_agg(distinct m) from (
     select case v when 'Gluten-free' then 'Gluten free'
                   when 'Non-GMO'     then 'Non GMO'
                   when 'Organic'     then null
                   when 'Kosher'      then null
                   else v end as m
     from jsonb_array_elements_text(p.answers->'certifications') v) x where m is not null), '[]'::jsonb))
where jsonb_typeof(p.answers->'certifications') = 'array';
