-- ════════════════════════════════════════════════════════════════
-- Invoice acceptance e-signature, signed together with the
-- Contract Manufacturing Agreement in one "signing packet"
-- ════════════════════════════════════════════════════════════════
-- After the exploding-cans dispute Mike wants every customer to sign each
-- invoice, accepting it and the product-responsibility terms that sit under
-- it (formula / shelf stability is the customer's, the kill step they chose,
-- risk passes at pickup, liability capped at the manufacturing charges). A
-- customer who has never signed the Contract Manufacturing Agreement signs
-- it in the same sitting: one email, one page, one signature.
--
-- This reuses the agreement e-sign system (agreements / agreement_signers /
-- agreement-sign edge function / sign.html) rather than building a second
-- one, so the invoice acceptance gets the same audit trail: consent text,
-- typed signature, timestamps, IP, user agent, SHA-256 of the exact text,
-- signed PDF with a certificate page filed in deal_documents.
--
-- Changes:
--   agreements.kind / agreement_templates.kind  + 'invoice_acceptance'
--   agreements.invoice_id   the invoice an acceptance belongs to
--   agreements.packet_id    groups agreements sent and signed together.
--                           The emailed token sits on ONE signer row of the
--                           packet; the edge function finds the rest by
--                           packet_id. No new table, no new policy.
--   agreement_templates     seeds the 'invoice_acceptance' template (a
--                           STARTING DRAFT — attorney review before relying
--                           on it, same as the NDA and manufacturing drafts).
--
-- Access is unchanged: agreements, agreement_signers and agreement_templates
-- stay active-admin-only ("<table> admin all" + restrictive "gl tenant
-- guard", migrations 20261007120000 / 20261007140000). No policy is added or
-- altered here, so portal customers and self-registered strangers still get
-- nothing from these tables. Customers see only the final signed PDF, which
-- the edge function files in deal_documents with client_visible = true for
-- their own client_id (existing portal policies).
--
-- ROLLBACK:
--   delete from public.agreements where kind = 'invoice_acceptance';
--   delete from public.agreement_templates where kind = 'invoice_acceptance';
--   alter table public.agreements drop column if exists packet_id;
--   alter table public.agreements drop column if exists invoice_id;
--   alter table public.agreements drop constraint if exists agreements_kind_check;
--   alter table public.agreements add constraint agreements_kind_check
--     check (kind in ('nda', 'manufacturing'));
--   alter table public.agreement_templates drop constraint if exists agreement_templates_kind_check;
--   alter table public.agreement_templates add constraint agreement_templates_kind_check
--     check (kind in ('nda', 'manufacturing'));
--   Reverting deletes the invoice-acceptance log rows (signer rows cascade).
--   Signed PDFs stay in deal_documents / client-docs storage.

set search_path = public, extensions;

alter table public.agreements drop constraint if exists agreements_kind_check;
alter table public.agreements add constraint agreements_kind_check
  check (kind in ('nda', 'manufacturing', 'invoice_acceptance'));

alter table public.agreement_templates drop constraint if exists agreement_templates_kind_check;
alter table public.agreement_templates add constraint agreement_templates_kind_check
  check (kind in ('nda', 'manufacturing', 'invoice_acceptance'));

alter table public.agreements
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null;
alter table public.agreements
  add column if not exists packet_id uuid;

-- An invoice acceptance must name its invoice and its client: the customer
-- is accepting a specific invoice, and the signed copy is filed to them.
alter table public.agreements drop constraint if exists agreements_invoice_acceptance_links;
alter table public.agreements add constraint agreements_invoice_acceptance_links
  check (kind <> 'invoice_acceptance' or (invoice_id is not null and client_id is not null));

create index if not exists agreements_invoice_idx on public.agreements(invoice_id);
create index if not exists agreements_packet_idx  on public.agreements(packet_id);

-- Starting draft. ON CONFLICT DO NOTHING: re-running never overwrites
-- wording an admin has since edited in Agreement Templates.
insert into public.agreement_templates (kind, title, body) values
('invoice_acceptance', 'Invoice Acceptance and Product Responsibility', $tpl$# INVOICE ACCEPTANCE AND PRODUCT RESPONSIBILITY

Invoice {{invoice_number}} dated {{invoice_date}}, issued by {{gl_legal_name}} ("Good Liquid") to {{client_legal_name}} ("Customer").

## Invoice Summary

{{invoice_lines}}

Total: {{invoice_total}}
Payment terms: {{payment_terms}}

## Kill Step for This Run

{{kill_step}}

## Terms

By signing below, Customer accepts this invoice and agrees to the following.

1. Acceptance of work. The products on this invoice were made to Customer's formula, specifications and instructions. Customer accepts the quantities, services and prices shown. Any claim of a production defect (fill level, seam, carbonation as filled, labeling) must be made in writing, with photos and lot codes, within five (5) business days after the products are made available for pickup. After that, the products are accepted as conforming.

2. Formula and shelf stability are Customer's responsibility. Customer alone is responsible for its formula, its ingredients and the shelf stability of the finished product, including microbial stability, pH, residual sugar, the preservative system and target carbonation. Good Liquid does not warrant shelf life. Good Liquid is not responsible for containers that swell, bulge, leak, re-ferment, over-pressurize or burst because of the formula, its ingredients, live cultures or yeast, insufficient preservation, or Customer's decision not to use a kill step, such as pasteurization, that Good Liquid offered or recommended.

3. After pickup. Title and risk of loss pass to Customer when the products are made available for pickup (Ex Works, Good Liquid's facility). Good Liquid is not responsible for damage caused by storage, transport, heat or freezing, or handling after that point.

4. Limitation of liability. For any claim relating to this invoice, Good Liquid's total liability is limited to re-running or crediting the manufacturing charges for the affected units on this invoice, at Good Liquid's option. Good Liquid is not liable for ingredients or packaging supplied by Customer, lost product, lost profits, recalls, retailer chargebacks, cleanup, or any other indirect or consequential damages.

5. Indemnity. Customer will defend and hold Good Liquid harmless from third-party claims, including claims of injury or property damage from a container that fails, arising from Customer's formula, ingredients or labels, or from the handling, storage or sale of the products after pickup, except to the extent caused by Good Liquid's failure to follow the agreed specifications.

6. Payment. Payment is due under the payment terms shown above. Past-due balances accrue interest at 1.5% per month or the maximum rate allowed by law, whichever is less, and Good Liquid may hold finished product until this invoice is paid.

7. Master agreement. If Customer and Good Liquid have signed a Contract Manufacturing Agreement, that agreement controls and these terms add to it.

## Signature

[[SIGNATURES]]$tpl$)
on conflict (kind) do nothing;

notify pgrst, 'reload schema';
