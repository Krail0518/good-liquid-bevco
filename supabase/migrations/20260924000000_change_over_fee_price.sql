-- Change-over fee as an editable price (GL-132)
--
-- The quote builder and the invoice add-on panel both read their rates from
-- pricing_settings, which is what lets Mike change a price without a code
-- change. A new add-on therefore needs a row here, not a number in the source,
-- or the $100 would be the one rate in the CRM he cannot edit himself.
--
-- 'Canning add-ons' alongside nitrogen (10) and pasteurization (20); 25 puts it
-- after those two on the Prices screen.
--
-- Unlike every other add-on, this one does not scale with cans, cases or
-- pallets — it is charged per changeover, so the quote adds it once per tier
-- and the invoice row's quantity can be edited when a run has more than one.
--
-- ROLLBACK: delete from public.pricing_settings where key = 'change_over_fee';

insert into public.pricing_settings (key, category, label, unit, value, sort_order)
values ('change_over_fee', 'Canning add-ons', 'Change Over Fee', 'per changeover', 100, 25)
on conflict (key) do nothing;
