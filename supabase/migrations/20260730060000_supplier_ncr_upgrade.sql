-- ============================================================
-- Phase 2 — Approved Supplier program + NCR/CAPA close-out
-- ============================================================
-- Two moves in one migration, both additive to existing tables:
--
--   1. Elevate the flat vendor list (public.vendors) into an SQF
--      Approved-Supplier program: each supplier now carries an
--      approval status, who approved it and when, the next review
--      date, the materials it supplies, its food-safety certificate
--      + expiry, and a risk level. Columns are intentionally left
--      free-text (no enum/CHECK constraints) so the program can
--      evolve without schema churn.
--
--   2. Add CAPA close-out fields to the NCR/defects log
--      (public.defects): a formal NCR number, the preventive action,
--      a due date, and verification (who signed the fix off, when).
--      `source` + `source_record_id` let a defect/NCR be traced back
--      to the record that spawned it (e.g. a failed GMP form).
--
-- It also exposes the approved-supplier list to the read-only
-- auditor portal by adding an anon inspector-read policy on
-- public.vendors, mirroring the existing "defects inspector read"
-- policy verbatim (public.is_valid_inspector_token(
-- public.current_inspector_token())). Existing staff policies are
-- untouched; defects already has its inspector-read policy so none
-- is added there.
--
-- Idempotent. Safe to re-run.
-- ============================================================

-- ── (1) Approved-Supplier program columns on vendors ──────────
alter table public.vendors add column if not exists approval_status text default 'pending';
alter table public.vendors add column if not exists approved_by text;
alter table public.vendors add column if not exists approval_date date;
alter table public.vendors add column if not exists next_review date;
alter table public.vendors add column if not exists materials text;
alter table public.vendors add column if not exists food_safety_cert text;
alter table public.vendors add column if not exists cert_expires date;
alter table public.vendors add column if not exists risk_level text;

create index if not exists idx_vendors_approval on public.vendors(approval_status);

-- ── (2) CAPA close-out fields on the NCR/defects log ──────────
alter table public.defects add column if not exists ncr_number text;
alter table public.defects add column if not exists preventive_action text;
alter table public.defects add column if not exists due_date date;
alter table public.defects add column if not exists verified_by text;
alter table public.defects add column if not exists verified_at timestamptz;
alter table public.defects add column if not exists source text;
alter table public.defects add column if not exists source_record_id uuid;

create index if not exists idx_defects_source on public.defects(source_record_id);

-- ── (3) Auditor (inspector token) read access to vendors ──────
-- Lets the read-only auditor portal list approved suppliers.
-- Mirrors the existing "defects inspector read" policy verbatim.
drop policy if exists "vendors inspector read" on public.vendors;
create policy "vendors inspector read" on public.vendors
  for select to anon
  using (public.is_valid_inspector_token(public.current_inspector_token()));

notify pgrst, 'reload schema';
