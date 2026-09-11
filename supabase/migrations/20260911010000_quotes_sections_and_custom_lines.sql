-- quotes: hold more than one format, and free-text lines.
--
-- ROLLBACK:
--   alter table public.quotes drop column if exists sections;
--   alter table public.quotes drop column if exists custom_lines;
--
-- WHY
-- A quote was one product type and one package format, enforced by the
-- NOT NULL product_type / package_format columns and the CHECK on the former.
-- Quoting 12oz and 16oz cans for the same brand, or cans alongside bottles,
-- meant separate quotes with separate numbers for what is one conversation.
-- There was also nowhere to put a charge the standard price deck does not
-- model, so anything unusual was written by hand outside the system.
--
-- sections     — one entry per format: product type, format, volume tiers,
--                packaging config, and that format's own custom lines.
-- custom_lines — free-text lines that apply to the whole quote.
--
-- ADDITIVE ON PURPOSE. product_type and package_format stay, populated from
-- sections[0], because the quote history list, the deal panel and every quote
-- already saved read them. Nothing downstream has to learn about sections to
-- keep working, and a one-format quote is byte-for-byte what it was before.
-- Older rows keep an empty sections array and are read as single-format, which
-- is exactly what they are.

alter table public.quotes
  add column if not exists sections     jsonb not null default '[]'::jsonb,
  add column if not exists custom_lines jsonb not null default '[]'::jsonb;

comment on column public.quotes.sections is
  'One entry per quoted format: {productType, format, tiers[], pkg{}, bpkg{}, lines[], inclusions[]}. Empty means a single-format quote described by product_type/package_format.';
comment on column public.quotes.custom_lines is
  'Free-text quote-wide lines: {desc, qty, unit, rate}. Per-format lines live in sections[].lines.';
