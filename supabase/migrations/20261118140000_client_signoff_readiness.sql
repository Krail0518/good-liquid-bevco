-- ════════════════════════════════════════════════════════════════
-- gl_client_signoff_readiness(client_id): is a client's paperwork signed?
-- ════════════════════════════════════════════════════════════════
-- Mike's practice (2026-11-17, after the Florida-law review): a customer
-- signs the Contract Manufacturing Agreement at onboarding, and signs off
-- (✍️ Customer sign-off) on the deposit invoice BEFORE a run is scheduled.
-- The CRM warns at scheduling time when either is missing.
--
-- Scheduling is done by sales staff too, but agreements / agreement_signers
-- are ADMIN-only (20261007120000), so the browser cannot read them for a
-- sales user. This function returns only status + dates + an invoice number
-- for one client, never agreement text, signer details or signing tokens.
--
-- Access:
--   - SECURITY DEFINER (reads the admin-only tables), search_path pinned.
--   - Returns NULL unless public.is_gl_staff(): portal customers and
--     self-registered strangers get nothing, even for their own client.
--   - EXECUTE revoked from public and anon; granted to authenticated only
--     (the is_gl_staff() check inside is the real gate).
--
-- ROLLBACK:
--   drop function if exists public.gl_client_signoff_readiness(uuid);
--   Nothing else depends on it; the CRM treats a missing function as
--   "unknown" and shows no warning.

set search_path = public, extensions;

create or replace function public.gl_client_signoff_readiness(p_client_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_mfg jsonb;
  v_acc jsonb;
begin
  if not public.is_gl_staff() then
    return null;
  end if;
  if p_client_id is null then
    return null;
  end if;

  -- Manufacturing Agreement: a signed one wins; otherwise the latest live one.
  select jsonb_build_object('status', a.status, 'signed_at', a.signed_at, 'sent_at', a.sent_at)
    into v_mfg
    from public.agreements a
   where a.client_id = p_client_id
     and a.kind = 'manufacturing'
     and a.status <> 'void'
   order by (a.status = 'signed') desc, a.created_at desc
   limit 1;

  -- Latest invoice sign-off that actually went out (drafts and voids skipped).
  select jsonb_build_object('status', a.status, 'signed_at', a.signed_at, 'sent_at', a.sent_at,
                            'invoice_number', i.invoice_number)
    into v_acc
    from public.agreements a
    left join public.invoices i on i.id = a.invoice_id
   where a.client_id = p_client_id
     and a.kind = 'invoice_acceptance'
     and a.status in ('sent', 'signed', 'declined')
   order by a.created_at desc
   limit 1;

  return jsonb_build_object('manufacturing', v_mfg, 'invoice_signoff', v_acc);
end;
$fn$;

revoke all on function public.gl_client_signoff_readiness(uuid) from public;
revoke all on function public.gl_client_signoff_readiness(uuid) from anon;
grant execute on function public.gl_client_signoff_readiness(uuid) to authenticated;

notify pgrst, 'reload schema';
