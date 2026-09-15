-- quotes: a quote becomes a list of line items with a total.
--
-- ROLLBACK:
--   alter table public.quotes drop column if exists line_items;
--   alter table public.quotes drop column if exists total;
--
-- WHY
-- A quote priced a table of VOLUME TIERS: 200 cases against 500 against 1,000,
-- one row each, and the customer picked one. Every row was an alternative, so
-- nothing ever summed and the document had no total on it at all.
--
-- That shape cannot express the ordinary case of two SKUs. Asked to quote two
-- products at 230 cases each, the only way to say it was two identical rows,
-- which reads as the same option printed twice and still does not add up. The
-- invoice side has always been a list of lines with a total, and that is the
-- shape a customer can actually follow: description, quantity, unit price,
-- amount, total.
--
-- line_items — [{desc, qty, unit, unitPrice, amount}], in document order.
-- total      — the sum of those amounts, stored so a saved quote never has to
--              be re-derived to be displayed, and never disagrees with the PDF.
--
-- MONEY IS ROUNDED PER LINE AND SUMMED AS INTEGER CENTS in the builder before
-- it reaches here. numeric(12,2) keeps it that way in the database. The invoice
-- table stores a plain numeric and a real invoice carried 5341.599999999999 as
-- its total; a quote should not inherit that.
--
-- ADDITIVE. product_type and package_format stay and still describe the rate
-- card the lines were generated from, because the quote history list and the
-- deal panel read them. sections and custom_lines from the previous shape are
-- left in place so quotes already saved still render.

alter table public.quotes
  add column if not exists line_items jsonb         not null default '[]'::jsonb,
  add column if not exists total      numeric(12,2) not null default 0;

comment on column public.quotes.line_items is
  'The quote document, in order: [{desc, qty, unit, unitPrice, amount}]. amount is qty * unitPrice rounded to the cent.';
comment on column public.quotes.total is
  'Sum of line_items[].amount, added as integer cents. Never re-derived for display, so it cannot disagree with the saved PDF.';
