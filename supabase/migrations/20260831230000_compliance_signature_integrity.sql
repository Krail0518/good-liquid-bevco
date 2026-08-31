-- Compliance signatures and hold dispositions become immutable in the database.
--
-- Auditor item C. Their list was: "Required fields, hold fail-closed, signature
-- immutability, exact photo association, complete exports." This migration
-- addresses signature immutability and hold disposition; the rest is noted at
-- the end.
--
-- WHAT WAS TRUE BEFORE, reproduced against staging on 2026-08-31. `hold_tags`
-- and `compliance_records` carried exactly one trigger each -- set_updated_at --
-- and nothing else. Every one of these was ALLOWED:
--
--   S1  re-sign an already signed record, as a different person
--   S2  alter the DATA of a signed record          <- sign one thing, change it after
--   S3  backdate a signature by 30 days
--   S4  co-sign as the SAME person who signed first  <- defeats dual-PCQI entirely
--   S5  sign a record whose status is still 'draft'
--
-- These are FDA records. S2 and S4 are the serious ones: a signature that does
-- not bind the content it signed is not a signature, and a dual-signature
-- control that one person can satisfy alone is not a control.
--
-- WHY IN THE DATABASE
-- The same reason as the payment ledger. Client-side checks hold only for
-- callers who use the client. The compliance UI is one caller; the Supabase
-- REST API is another, and every staff session holds a token for it.
--
-- ROLLBACK:
--   drop trigger if exists compliance_records_signature_integrity on public.compliance_records;
--   drop function if exists public.gl_guard_compliance_signature();
--   drop trigger if exists hold_tags_disposition_integrity on public.hold_tags;
--   drop function if exists public.gl_guard_hold_disposition();
--   Reverting restores mutable signatures. Nothing is lost; nothing is protected.

set search_path = public, extensions;

-- ─────────────────────────────────────────── compliance record signatures

create or replace function public.gl_guard_compliance_signature()
returns trigger
language plpgsql
set search_path = public, extensions
as $sig$
begin
  -- A signature, once made, is the record. None of it may change afterwards --
  -- not the signer, not the time, not the printed name, not the meaning.
  if old.signed_at is not null then
    if new.signed_by        is distinct from old.signed_by
       or new.signed_at        is distinct from old.signed_at
       or new.signature_name   is distinct from old.signature_name
       or new.signature_meaning is distinct from old.signature_meaning then
      raise exception
        'record % is already signed by % at %; a signature cannot be changed. Void it and create a new record.',
        old.id, coalesce(old.signature_name, old.signed_by::text), old.signed_at
        using errcode = '42501';
    end if;

    -- S2, the serious one. A signature that does not bind the content it
    -- signed is decoration. Correcting a signed record means a new record.
    --
    -- But `data` carries two different things: the attested CONTENT, and
    -- record-keeping metadata the app writes afterwards. Four live workflows
    -- stamp retired_at, archived_at, locked_at and locked_reason into it --
    -- retiring a form, archiving a batch, and locking records when an invoice
    -- is marked paid. Blocking the whole blob would break all four, and a
    -- control that stops routine work gets removed rather than obeyed.
    --
    -- So: strip the lifecycle keys from both sides and require the REST to be
    -- identical. What was signed cannot change; what happened to the record
    -- afterwards can be recorded.
    if (old.data - ARRAY['retired_at','archived_at','locked_at','locked_reason'])
       is distinct from
       (new.data - ARRAY['retired_at','archived_at','locked_at','locked_reason']) then
      raise exception
        'the attested content of signed record % cannot be altered. Create a corrected record instead.',
        old.id
        using errcode = '42501';
    end if;

    -- The deviation flag and its narrative are part of what was attested to.
    if new.has_deviation is distinct from old.has_deviation
       or new.deviation_notes is distinct from old.deviation_notes then
      raise exception
        'the deviation findings on signed record % cannot be altered', old.id
        using errcode = '42501';
    end if;
  end if;

  -- A signature cannot be applied to an incomplete record.
  if new.signed_at is not null and old.signed_at is null
     and new.status = 'draft' then
    raise exception
      'record % is a draft and cannot be signed', new.id
      using errcode = '42501';
  end if;

  -- No backdating and no post-dating, on the way in.
  if new.signed_at is not null and old.signed_at is null
     and (new.signed_at < now() - interval '1 hour' or new.signed_at > now() + interval '1 hour') then
    raise exception
      'signed_at on % must be the time of signing, not %', new.id, new.signed_at
      using errcode = '42501';
  end if;

  -- Dual PCQI means two people. One person satisfying both halves is the
  -- failure mode the control exists to prevent.
  if new.second_signed_by is not null
     and new.second_signed_by = coalesce(new.signed_by, old.signed_by) then
    raise exception
      'the second signature on % must be a different person from the first', new.id
      using errcode = '42501';
  end if;

  -- And the co-signature is equally final once made.
  if old.second_signed_at is not null
     and (new.second_signed_by is distinct from old.second_signed_by
          or new.second_signed_at is distinct from old.second_signed_at
          or new.second_signature_name is distinct from old.second_signature_name) then
    raise exception
      'the second signature on % cannot be changed', old.id
      using errcode = '42501';
  end if;

  return new;
end
$sig$;

drop trigger if exists compliance_records_signature_integrity on public.compliance_records;
create trigger compliance_records_signature_integrity
  before update on public.compliance_records
  for each row execute function public.gl_guard_compliance_signature();

-- ───────────────────────────────────────────────── hold tag dispositions

-- A hold is a decision to stop product moving. Releasing it is a decision to
-- let it move. Both belong on the record permanently.
create or replace function public.gl_guard_hold_disposition()
returns trigger
language plpgsql
set search_path = public, extensions
as $hold$
begin
  if old.disposition_date is not null then
    if new.disposition                  is distinct from old.disposition
       or new.disposition_authorized_by   is distinct from old.disposition_authorized_by
       or new.disposition_authorized_name is distinct from old.disposition_authorized_name
       or new.disposition_date            is distinct from old.disposition_date then
      raise exception
        'hold % was already dispositioned as "%" by % on %; that decision cannot be rewritten.',
        old.tag_number, old.disposition,
        coalesce(old.disposition_authorized_name, old.disposition_authorized_by::text),
        old.disposition_date
        using errcode = '42501';
    end if;

    -- Re-opening a closed hold silently would hide that product was released.
    if old.status is distinct from new.status and old.status <> 'open' and new.status = 'open' then
      raise exception
        'hold % has been dispositioned and cannot be re-opened. Raise a new hold.',
        old.tag_number
        using errcode = '42501';
    end if;
  end if;

  -- A disposition must say who authorised it. "Released" with nobody's name on
  -- it is the exact record an inspector asks about.
  if new.disposition is not null and new.disposition is distinct from old.disposition
     and coalesce(new.disposition_authorized_by::text, new.disposition_authorized_name, '') = '' then
    raise exception
      'disposition of hold % must record who authorised it', new.tag_number
      using errcode = '42501';
  end if;

  return new;
end
$hold$;

drop trigger if exists hold_tags_disposition_integrity on public.hold_tags;
create trigger hold_tags_disposition_integrity
  before update on public.hold_tags
  for each row execute function public.gl_guard_hold_disposition();

-- ─────────────────────────────────────────────────────────── not covered
--
-- Deliberately out of scope here, and named rather than implied:
--
--   * REQUIRED FIELDS per form. Which fields a given GMP form must carry before
--     it can be signed lives in the form definitions in the client, not in the
--     schema. Enforcing it in the database means encoding 30-odd form shapes in
--     SQL; that is a real piece of work and belongs in its own change.
--   * PHOTO ASSOCIATION under concurrent uploads. The audit's GL-022. Fixing it
--     means creating the row first and uploading to an id-scoped path, which
--     changes the upload flow.
--   * EXPORT COMPLETENESS and pagination. The audit's GL-031, partly addressed
--     when CSV formula-injection was fixed.
--   * RECENT REAUTHENTICATION before signing. Requires an auth flow decision by
--     the owner (how recent is recent), not a schema rule.
--
-- What this migration does establish is that once a signature or a disposition
-- exists, it cannot be altered by anyone through any path.
