-- ROLLBACK: drop index if exists public.clients_name_unique_ci;
-- ════════════════════════════════════════════════════════════════
-- One client per brand name
-- ════════════════════════════════════════════════════════════════
-- Production held KEWE Energy three times, The Other Matcha twice and
-- Oriign LLC twice, merged by hand on 2026-10-04. Each copy had its own
-- onboarding link, so customers received links to records that were
-- later deleted.
--
-- The app now checks before creating a client (#443 pipeline conversion,
-- #444 Add Client and the Onboarding Wizard), but a check in the browser
-- cannot stop two people adding the same brand at the same moment, or a
-- future code path that skips it. This index can.
--
-- Matching is case-insensitive and ignores outer spaces, the same rule as
-- window.glFindDuplicateClient, so "KEWE Energy" and " kewe energy " are
-- one brand. Email is deliberately NOT unique: one owner can run two
-- brands from one address.
--
-- Checked before applying: no duplicate or blank names in production.
-- The only functions that write clients (gl_onboarding_submit,
-- update_customer_account) never set name, so a customer's onboarding
-- submission cannot trip this; only a staff rename to a taken name can,
-- and Edit Client reports the error.
--
-- No policy, grant or function ACL changes.

create unique index if not exists clients_name_unique_ci
  on public.clients (lower(btrim(name)));
