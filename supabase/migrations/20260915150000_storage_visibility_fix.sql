-- ════════════════════════════════════════════════════════════════
-- client_visible governs the FILE, not just the row (GL-077)
-- ════════════════════════════════════════════════════════════════
-- Phase 1 added deal_documents.client_visible and hid six documents the owner
-- had not cleared for release. The portal honoured it: Atlas canning's two
-- "Other" documents vanished from their document list, as intended.
--
-- The files did not vanish. "client-docs customer read" admitted any object
-- whose NAME began with the caller's own client id:
--
--     name like current_customer_client_id()::text || '/%'
--
-- Staff upload client documents to <client_id>/docs/..., so both hidden
-- documents sat under exactly that prefix. A portal customer can LIST the
-- bucket — listing is governed by this same SELECT policy — enumerate every
-- object under their prefix, and sign a URL for any of them. Verified as
-- mehdy@atlascanning.com before writing this: the portal showed 0 documents
-- and storage returned both hidden files by name.
--
-- This is not a cross-tenant leak. Another client's objects were refused, and
-- still are. It is a VISIBILITY bypass inside the tenant, which is worse than
-- it sounds: client_visible is the only thing standing between a client and a
-- Formula document, and the whole point of the phase-1 classification was that
-- the six hidden documents stay hidden until the owner reads them.
--
-- THE SHAPE OF THE MISTAKE, because it is the one this codebase keeps making:
-- a rule was enforced in the place the UI reads (the table) and not in the
-- place the data actually lives (the object). Hiding a row is not hiding a
-- file, exactly as omitting a column from a view was not hiding a column.
--
-- WHAT REPLACES IT. Four explicit branches, each naming why that object is
-- readable, instead of one prefix that answers "because it is yours":
--
--   1. <client>/portal/%   — files the customer uploaded themselves. They
--                            already hold these; reading them back is not a
--                            disclosure, and the upload flow reads before the
--                            deal_documents row is visible.
--   2. deal_documents      — and client_visible must be true.
--   3. client_artwork      — their own, unarchived. Five live objects depend
--                            on this; without it artwork downloads break.
--   4. lot_documents       — unchanged, their own production lot paperwork.
--
-- The subqueries are evaluated AS THE CALLER, which is the trap that made
-- 20260915000100 necessary. Here it is correct and deliberate: customers hold
-- tenant-scoped SELECT policies on all three tables, so each subquery can only
-- match rows that caller may already read. The explicit client_id and
-- client_visible predicates are stated anyway rather than inherited, so the
-- policy means what it says if a permissive policy is ever added elsewhere.
--
-- objects.name is qualified in every subquery on purpose: deal_documents has
-- its own `name` column, and an unqualified `name` there binds to the INNER
-- relation, matching document titles against file paths and admitting nothing.
--
-- ONE OBJECT LOSES CUSTOMER ACCESS:
--   4744a07c-.../compliance/pa_letter_1785464515282.pdf  (PERICO)
-- It exists in no table, so no portal surface ever linked to it. If that
-- letter should reach the client, attach it as a deal_documents row and
-- publish it — that is the reviewable path.
--
-- ROLLBACK:
--   drop policy "client-docs customer read" on storage.objects;
--   create policy "client-docs customer read" on storage.objects
--     for select to authenticated
--     using (bucket_id = 'client-docs'
--            and public.current_customer_client_id() is not null
--            and (objects.name like (public.current_customer_client_id())::text || '/%'
--                 or exists (select 1 from public.deal_documents d
--                             where d.file_path = objects.name
--                               and d.client_id = public.current_customer_client_id())
--                 or exists (select 1 from public.lot_documents l
--                             where l.file_path = objects.name
--                               and l.client_id = public.current_customer_client_id())));
--   Reverting re-exposes every hidden document stored under a client prefix.

set search_path = public, extensions;

drop policy if exists "client-docs customer read" on storage.objects;

create policy "client-docs customer read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'client-docs'
    and public.current_customer_client_id() is not null
    and (
         objects.name like (public.current_customer_client_id())::text || '/portal/%'

      or exists (select 1 from public.deal_documents d
                  where d.file_path = objects.name
                    and d.client_id = public.current_customer_client_id()
                    and d.client_visible = true)

      or exists (select 1 from public.client_artwork a
                  where a.file_path = objects.name
                    and a.client_id = public.current_customer_client_id()
                    and a.archived_at is null)

      or exists (select 1 from public.lot_documents l
                  where l.file_path = objects.name
                    and l.client_id = public.current_customer_client_id())
    )
  );

notify pgrst, 'reload schema';
