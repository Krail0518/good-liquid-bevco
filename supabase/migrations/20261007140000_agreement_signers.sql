-- ════════════════════════════════════════════════════════════════
-- Built-in e-signatures for agreements
-- ════════════════════════════════════════════════════════════════
-- Mike does not use Dropbox Sign, so agreements are signed inside the CRM:
-- the client gets an emailed link to /sign.html, reads the agreement, agrees
-- to sign electronically and types their name; Good Liquid counter-signs the
-- same way. When everyone has signed, the agreement-sign edge function builds
-- the signed PDF (with a signature certificate page), files it in
-- deal_documents and marks the agreement signed.
--
-- agreement_signers   one row per signer per agreement, in signing order.
--   token_hash        SHA-256 of the link token. The token itself is only
--                     ever in the email; a database read cannot recover a
--                     working link. Cleared once the signer is done.
--   audit columns     sent/viewed/consented/signed timestamps, typed
--                     signature, IP and user agent, and the SHA-256 of the
--                     exact agreement text they signed: the ESIGN / Florida
--                     UETA record of consent, intent and attribution.
--
-- Access: active admins may read and manage rows (the CRM shows signer
-- progress). The public signing page never touches this table directly; it
-- calls the agreement-sign edge function, which uses the service role and
-- checks the token itself. No anon / customer policy exists.
--
-- Also: agreements.status gains 'declined'.
--
-- ROLLBACK:
--   drop table if exists public.agreement_signers;
--   alter table public.agreements drop constraint if exists agreements_status_check;
--   alter table public.agreements add constraint agreements_status_check
--     check (status in ('draft', 'sent', 'signed', 'void'));
--   (update any 'declined' rows to 'void' first.) Reverting loses the
--   signing audit trail; signed PDFs stay in deal_documents.

set search_path = public, extensions;

alter table public.agreements drop constraint if exists agreements_status_check;
alter table public.agreements add constraint agreements_status_check
  check (status in ('draft', 'sent', 'signed', 'declined', 'void'));

create table if not exists public.agreement_signers (
  id                uuid primary key default gen_random_uuid(),
  agreement_id      uuid not null references public.agreements(id) on delete cascade,
  role              text not null check (role in ('client', 'gl')),
  sign_order        int  not null default 1,
  name              text not null,
  email             text not null,
  title             text,
  status            text not null default 'waiting'
                      check (status in ('waiting', 'sent', 'viewed', 'signed', 'declined')),
  token_hash        text unique,
  token_expires_at  timestamptz,
  sent_at           timestamptz,
  viewed_at         timestamptz,
  consented_at      timestamptz,
  signed_at         timestamptz,
  typed_signature   text,
  signed_ip         text,
  signed_user_agent text,
  document_sha256   text,
  decline_reason    text,
  created_at        timestamptz not null default now(),
  unique (agreement_id, role)
);

create index if not exists agreement_signers_agreement_idx on public.agreement_signers(agreement_id);

alter table public.agreement_signers enable row level security;
revoke all on public.agreement_signers from anon, public;
grant select, insert, update, delete on public.agreement_signers to authenticated;

drop policy if exists "agreement_signers admin all" on public.agreement_signers;
create policy "agreement_signers admin all" on public.agreement_signers
  for all to authenticated
  using (public.is_gl_staff() and public.is_admin_user())
  with check (public.is_gl_staff() and public.is_admin_user());

drop policy if exists "gl tenant guard" on public.agreement_signers;
create policy "gl tenant guard" on public.agreement_signers
  as restrictive to authenticated
  using (public.is_gl_staff()) with check (public.is_gl_staff());

notify pgrst, 'reload schema';
