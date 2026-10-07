-- ════════════════════════════════════════════════════════════════
-- Agreements: admin-editable templates + a log of generated agreements
-- ════════════════════════════════════════════════════════════════
-- Mike asked for a way to generate an NDA and a manufacturing agreement
-- for new and existing clients from inside the CRM, auto-filled from the
-- deal / client record.
--
--   agreement_templates  one row per agreement kind ('nda', 'manufacturing').
--                        The body is plain text with {{placeholders}} and
--                        "#"/"##" headings; the browser fills and renders it.
--                        Seeded below with STARTING DRAFTS that must be
--                        reviewed by an attorney before real use.
--   agreements           every agreement generated: who it is for (deal
--                        and/or client), the final text exactly as issued,
--                        the filled-in values, status (draft / sent /
--                        signed / void), the saved PDF (deal_documents row)
--                        and the Dropbox Sign request id.
--
-- Access: active ADMINS only, both tables. The generator is an admin tool
-- (it issues contracts in Good Liquid's name); viewers, warehouse staff,
-- portal customers and self-registered strangers get nothing. Policies:
--   permissive  "<table> admin all"  is_gl_staff() and is_admin_user()
--   restrictive "gl tenant guard"    is_gl_staff()   (house pattern,
--                                    20260807020000_tenant_isolation_guard)
-- No policy mentions current_customer_client_id(): customers never read
-- these rows. The PDF itself is filed in deal_documents (internal by
-- default, client_visible = false) through the existing staff policies.
--
-- ROLLBACK:
--   drop table if exists public.agreements;
--   drop table if exists public.agreement_templates;
--   Reverting deletes the template text and the agreement log. Saved PDFs
--   stay in deal_documents / client-docs storage; nothing else references
--   these tables.

set search_path = public, extensions;

create table if not exists public.agreement_templates (
  kind        text primary key check (kind in ('nda', 'manufacturing')),
  title       text not null,
  body        text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);

create table if not exists public.agreements (
  id                    uuid primary key default gen_random_uuid(),
  kind                  text not null check (kind in ('nda', 'manufacturing')),
  title                 text not null,
  client_id             uuid references public.clients(id) on delete set null,
  deal_id               uuid references public.deals(id)   on delete set null,
  party_name            text not null,
  body                  text not null,
  fields                jsonb not null default '{}'::jsonb,
  status                text not null default 'draft'
                          check (status in ('draft', 'sent', 'signed', 'void')),
  document_id           uuid references public.deal_documents(id) on delete set null,
  signed_document_id    uuid references public.deal_documents(id) on delete set null,
  signature_request_id  text,
  sent_to               text,
  sent_at               timestamptz,
  signed_at             timestamptz,
  created_by            uuid references auth.users(id) on delete set null,
  created_by_name       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint agreements_has_party check (client_id is not null or deal_id is not null)
);

create index if not exists agreements_client_idx on public.agreements(client_id);
create index if not exists agreements_deal_idx   on public.agreements(deal_id);

alter table public.agreement_templates enable row level security;
alter table public.agreements          enable row level security;

revoke all on public.agreement_templates from anon, public;
revoke all on public.agreements          from anon, public;
grant select, insert, update, delete on public.agreement_templates to authenticated;
grant select, insert, update, delete on public.agreements          to authenticated;

drop policy if exists "agreement_templates admin all" on public.agreement_templates;
create policy "agreement_templates admin all" on public.agreement_templates
  for all to authenticated
  using (public.is_gl_staff() and public.is_admin_user())
  with check (public.is_gl_staff() and public.is_admin_user());

drop policy if exists "gl tenant guard" on public.agreement_templates;
create policy "gl tenant guard" on public.agreement_templates
  as restrictive to authenticated
  using (public.is_gl_staff()) with check (public.is_gl_staff());

drop policy if exists "agreements admin all" on public.agreements;
create policy "agreements admin all" on public.agreements
  for all to authenticated
  using (public.is_gl_staff() and public.is_admin_user())
  with check (public.is_gl_staff() and public.is_admin_user());

drop policy if exists "gl tenant guard" on public.agreements;
create policy "gl tenant guard" on public.agreements
  as restrictive to authenticated
  using (public.is_gl_staff()) with check (public.is_gl_staff());

-- Stamp updated_at on every change (and who changed a template).
create or replace function public.gl_agreements_touch()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.updated_at := now();
  if tg_table_name = 'agreement_templates' then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_agreement_templates_touch on public.agreement_templates;
create trigger trg_agreement_templates_touch before update on public.agreement_templates
  for each row execute function public.gl_agreements_touch();

drop trigger if exists trg_agreements_touch on public.agreements;
create trigger trg_agreements_touch before update on public.agreements
  for each row execute function public.gl_agreements_touch();

-- Starting drafts. ON CONFLICT DO NOTHING: re-running never overwrites
-- wording an admin has since edited.
insert into public.agreement_templates (kind, title, body) values
('nda', 'Mutual Nondisclosure Agreement', $tpl$# MUTUAL NONDISCLOSURE AGREEMENT

This Mutual Nondisclosure Agreement (the "Agreement") is entered into as of {{effective_date}} (the "Effective Date") by and between {{gl_legal_name}}, with its principal place of business at {{gl_address}} ("Good Liquid"), and {{client_legal_name}}, with its principal place of business at {{client_address}} ("Company"). Good Liquid and Company are each a "Party" and together the "Parties."

## Purpose

The Parties wish to evaluate and, if they choose, carry out a business relationship in which Good Liquid may formulate, manufacture, fill, package or otherwise produce beverage products for Company (the "Purpose"). In doing so, each Party may disclose Confidential Information to the other. Each Party may act as both a "Disclosing Party" and a "Receiving Party" under this Agreement.

## 1. Confidential Information

"Confidential Information" means all non-public information disclosed by a Disclosing Party to the Receiving Party, in any form, whether before or after the Effective Date, that is marked or identified as confidential or that a reasonable person would understand to be confidential given its nature and the circumstances of disclosure. Confidential Information includes, without limitation: formulas, recipes, ingredient lists and ratios, specifications, process parameters, production methods, batch records, test results, supplier and vendor information, costs and pricing, quotes, business and marketing plans, brand concepts, label artwork and packaging designs before public release, customer information, and the terms of any proposal or agreement between the Parties.

## 2. Exclusions

Confidential Information does not include information that the Receiving Party can show by written records: (a) is or becomes publicly available through no fault of the Receiving Party; (b) was lawfully known to the Receiving Party before disclosure without a duty of confidentiality; (c) is lawfully received from a third party without a duty of confidentiality; or (d) is independently developed by the Receiving Party without use of or reference to the Disclosing Party's Confidential Information.

## 3. Obligations of the Receiving Party

The Receiving Party will: (a) use the Disclosing Party's Confidential Information only for the Purpose; (b) not disclose it to anyone other than its employees, contractors, and professional advisors who need to know it for the Purpose and who are bound by confidentiality obligations at least as protective as this Agreement; (c) protect it using at least the same degree of care it uses for its own confidential information of a similar nature, and no less than reasonable care; and (d) not reverse engineer, analyze the composition of, or attempt to derive the formula of any product, sample, or material provided by the Disclosing Party, except as needed to carry out the Purpose with the Disclosing Party's written consent. The Receiving Party is responsible for any breach of this Agreement by persons to whom it discloses Confidential Information.

## 4. Required Disclosure

If the Receiving Party is required by law, regulation, subpoena, or court order to disclose Confidential Information, it may do so only to the extent required, and, where legally permitted, will give the Disclosing Party prompt written notice and reasonable cooperation so the Disclosing Party may seek a protective order or other remedy.

## 5. Ownership; No License

All Confidential Information remains the property of the Disclosing Party. Without limiting the foregoing, Company's product formulas, brand names, trademarks, and label artwork remain Company's property, and Good Liquid's manufacturing processes, methods, know-how, and pricing remain Good Liquid's property. Nothing in this Agreement grants any license or other right in any Confidential Information, patent, trademark, copyright, or trade secret, except the limited right to use Confidential Information for the Purpose.

## 6. Return or Destruction

Within ten (10) days after the Disclosing Party's written request, the Receiving Party will return or destroy the Disclosing Party's Confidential Information in its possession and, on request, confirm in writing that it has done so. The Receiving Party may keep copies required by law or regulation (including food safety and production records) or stored in routine backup systems, provided they remain subject to this Agreement.

## 7. Term

This Agreement governs disclosures made during the two (2) years following the Effective Date, unless either Party ends it earlier by written notice. The Receiving Party's obligations for Confidential Information disclosed during the term continue for three (3) years after the term ends, except that obligations for any trade secret (including product formulas) continue for as long as the information remains a trade secret under applicable law.

## 8. No Obligation; No Warranty

Neither Party is obligated by this Agreement to enter into any further agreement or transaction. All Confidential Information is provided "AS IS," without any warranty as to its accuracy or completeness.

## 9. Remedies

Unauthorized use or disclosure of Confidential Information may cause irreparable harm for which money damages would be inadequate. The Disclosing Party is entitled to seek injunctive relief, without posting a bond, in addition to any other remedies available at law or in equity. In any action to enforce this Agreement, the prevailing Party is entitled to recover its reasonable attorneys' fees and costs.

## 10. Governing Law and Venue

This Agreement is governed by the laws of the State of Florida, without regard to its conflict of law rules. Each Party consents to the exclusive jurisdiction and venue of the state and federal courts located in or serving Manatee County, Florida.

## 11. General

This Agreement is the entire agreement of the Parties about its subject matter and supersedes all prior understandings about it. It may be amended or waived only in a writing signed by both Parties. Neither Party may assign it without the other Party's written consent, except to a successor of all or substantially all of its business. If any provision is held unenforceable, the remaining provisions remain in effect. This Agreement may be signed in counterparts and by electronic signature, each of which is an original and all of which together are one agreement.

## Signatures

[[SIGNATURES]]$tpl$),
('manufacturing', 'Contract Manufacturing Agreement', $tpl$# CONTRACT MANUFACTURING AGREEMENT

This Contract Manufacturing Agreement (the "Agreement") is entered into as of {{effective_date}} (the "Effective Date") by and between {{gl_legal_name}}, with its principal place of business at {{gl_address}} ("Good Liquid"), and {{client_legal_name}}, with its principal place of business at {{client_address}} ("Company"). Good Liquid and Company are each a "Party" and together the "Parties."

## Background

Good Liquid operates a beverage manufacturing facility providing formulation, canning, bottling, keg filling, and related packaging services. Company wishes to engage Good Liquid to manufacture and package beverage products sold under Company's brand, on the terms below.

## 1. Definitions

"Products" means the beverage products Good Liquid manufactures for Company under a Quote and Purchase Order. "Quote" means a written price quote issued by Good Liquid and accepted by Company. "Purchase Order" means Company's written order for a production run that references an accepted Quote. "Specifications" means the formula, ingredient and packaging specifications, quality parameters, and labeling for a Product, as provided or approved in writing by Company. "Company Materials" means ingredients, packaging, labels, and other materials Company supplies or directs Good Liquid to use.

## 2. Orders

Company will place orders by Purchase Order. A Purchase Order is binding only when Good Liquid accepts it in writing (including by email). Each production run is subject to the minimum order quantity, format, and lead time stated in the applicable Quote. Changes to an accepted Purchase Order require Good Liquid's written agreement and may change price and schedule.

## 3. Pricing and Payment

Pricing for each production run is as stated in the Quote that applies to that run; no prices are fixed by this Agreement itself. A Quote is valid for the period stated on it. Good Liquid may require a deposit before scheduling or purchasing materials, as stated in the Quote. Invoices are due under the payment terms stated on the invoice. Overdue amounts accrue interest at the lesser of 1.5% per month or the maximum rate allowed by law, and Good Liquid may suspend production or withhold finished Products while any amount is overdue. Prices exclude taxes, freight, and storage unless the Quote says otherwise.

## 4. Materials

Company Materials must be delivered to Good Liquid's facility at Company's cost and risk, in time for the scheduled run, conforming to the Specifications, and with certificates of analysis or other documentation Good Liquid reasonably requests. Good Liquid is not responsible for delays, defects, or losses caused by late, insufficient, or non-conforming Company Materials. Materials Good Liquid procures for Company are billed as stated in the Quote. Normal production loss and overage of materials are expected and are not chargeable to Good Liquid, within the allowance stated in the Quote or, if none is stated, within industry-standard allowances.

## 5. Specifications and Regulatory Responsibilities

Company is responsible for its formula and Specifications, product safety of the formula as designed, all label content and claims, and compliance of its labels, marketing, and Products as designed with applicable law, including FDA labeling requirements. Company is responsible for obtaining any process authority letter, scheduled process filing, or other approval required for its Products, unless the Quote expressly includes it. Good Liquid will manufacture Products in accordance with the Specifications and applicable current good manufacturing practice requirements (21 C.F.R. Part 117) and will maintain batch records for each run.

## 6. Production and Scheduling

Good Liquid will schedule a production run after it has accepted the Purchase Order, received any required deposit, and received all Company Materials. Scheduled dates are good-faith estimates. If Company cancels or reschedules a run fewer than ten (10) business days before its scheduled date, Company will pay any rescheduling or cancellation fee stated in the Quote and the cost of materials purchased for the run.

## 7. Quality and Acceptance

Good Liquid will retain production samples for each run for a reasonable period. Company may inspect Products and must notify Good Liquid in writing of any claimed non-conformity within ten (10) business days after the Products are made available for pickup or delivered, with reasonable supporting detail; otherwise the Products are deemed accepted. If Products fail to conform to the Specifications because of Good Liquid's failure to follow the Specifications or applicable manufacturing practices, Good Liquid will, at its option, re-manufacture the non-conforming Products (using replacement materials supplied by Company where the original materials were Company Materials) or credit the manufacturing charges paid for them. This is Company's exclusive remedy for non-conforming Products.

## 8. Delivery, Title, Risk, and Storage

Unless the Quote states otherwise, Products are delivered EXW (Ex Works) Good Liquid's facility. Title and risk of loss pass to Company when the Products are made available for pickup. Company will collect finished Products within the period stated in the Quote; after that, storage is charged at Good Liquid's then-current storage rates, and Good Liquid is not responsible for loss of quality from extended storage.

## 9. Intellectual Property

Company owns its formulas, brand names, trademarks, label artwork, and other intellectual property it provides ("Company IP"), and grants Good Liquid a limited, non-exclusive license to use Company IP solely to manufacture Products for Company. Good Liquid owns its manufacturing processes, equipment settings, methods, and know-how, including improvements developed in providing services ("Good Liquid IP"). If Good Liquid develops a formula for Company under a separate research and development agreement, ownership of that formula is governed by that agreement.

## 10. Confidentiality

The Parties' Mutual Nondisclosure Agreement, if any, applies to all information exchanged under this Agreement. If there is none, each Party will keep the other's non-public information confidential, use it only to perform this Agreement, and protect it with at least reasonable care, during the term and for three (3) years afterward (and for trade secrets, for as long as they remain trade secrets).

## 11. Recalls

Each Party will promptly notify the other of any information suggesting a Product may need to be recalled or withdrawn, and the Parties will cooperate in good faith on any recall. Company decides whether to conduct a recall of its Products. Recall costs are borne by the Party whose breach of this Agreement, negligence, or Specifications caused the recall, and shared in proportion to fault where both contributed.

## 12. Warranties

Good Liquid warrants that Products, when made available to Company, will have been manufactured in accordance with the Specifications and applicable current good manufacturing practice requirements. Company warrants that (a) its formula and Specifications, when followed, produce Products that are safe and lawful to sell; (b) its labels and claims comply with applicable law; (c) Company Materials conform to the Specifications; and (d) Company IP does not infringe any third party's rights. EXCEPT AS STATED IN THIS SECTION, NEITHER PARTY MAKES ANY WARRANTY, EXPRESS OR IMPLIED, INCLUDING ANY WARRANTY OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.

## 13. Indemnification

Each Party will defend, indemnify, and hold harmless the other Party and its officers, employees, and agents from third-party claims, losses, and expenses (including reasonable attorneys' fees) to the extent arising from the indemnifying Party's breach of this Agreement, negligence, or willful misconduct. Company will also indemnify Good Liquid for third-party claims arising from Company's formula, Specifications, labels, marketing, Company Materials, or Company IP, except to the extent caused by Good Liquid's failure to follow the Specifications.

## 14. Insurance

Each Party will maintain, during the term and for two (2) years afterward, commercial general liability insurance including products and completed operations coverage, with limits of at least USD 1,000,000 per occurrence and USD 2,000,000 in the aggregate. Company will name Good Liquid as an additional insured on its policy and provide a certificate of insurance on request.

## 15. Limitation of Liability

NEITHER PARTY IS LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR LOST PROFITS, ARISING FROM THIS AGREEMENT. EXCEPT FOR ITS INDEMNIFICATION OBLIGATIONS, GOOD LIQUID'S TOTAL LIABILITY ARISING FROM ANY PRODUCTION RUN WILL NOT EXCEED THE MANUFACTURING CHARGES PAID BY COMPANY FOR THAT RUN.

## 16. Term and Termination

This Agreement begins on the Effective Date and continues for {{term_years}} year(s), then renews automatically for successive one (1) year terms unless either Party gives written notice of non-renewal at least sixty (60) days before the end of the current term. Either Party may terminate this Agreement for convenience on sixty (60) days' written notice, or immediately by written notice if the other Party materially breaches this Agreement and fails to cure the breach within thirty (30) days after written notice. Termination does not affect accepted Purchase Orders unless both Parties agree, and Company will pay for all Products manufactured, work in progress, and materials purchased for Company. After all amounts due are paid, Good Liquid will make remaining Company Materials available for pickup at Company's cost. Sections 9 through 15, 17, and 18, and any payment obligations, survive termination.

## 17. Force Majeure

Neither Party is liable for delay or failure to perform (other than payment obligations) caused by events beyond its reasonable control, including natural disasters, severe weather, fire, flood, power or utility failure, labor disputes, supply chain disruption, epidemic, or government action, provided it notifies the other Party promptly and resumes performance as soon as reasonably possible.

## 18. Governing Law and Disputes

This Agreement is governed by the laws of the State of Florida, without regard to its conflict of law rules. Each Party consents to the exclusive jurisdiction and venue of the state and federal courts located in or serving Manatee County, Florida. In any action arising from this Agreement, the prevailing Party is entitled to recover its reasonable attorneys' fees and costs.

## 19. General

The Parties are independent contractors. This Agreement, together with accepted Quotes and Purchase Orders, is the entire agreement of the Parties about its subject matter. If there is a conflict, this Agreement controls over a Quote, and a Quote controls over a Purchase Order, unless the later document expressly states that it overrides a specific section of this Agreement and is signed by both Parties. Pre-printed terms on Purchase Orders or other Company forms do not apply. This Agreement may be amended or waived only in a writing signed by both Parties. Neither Party may assign it without the other Party's written consent, except to a successor of all or substantially all of its business. Notices must be in writing and sent to the addresses above (or as updated by notice), by courier, certified mail, or email with confirmation of receipt. If any provision is held unenforceable, the remaining provisions remain in effect. This Agreement may be signed in counterparts and by electronic signature, each of which is an original and all of which together are one agreement.

## Signatures

[[SIGNATURES]]$tpl$)
on conflict (kind) do nothing;

notify pgrst, 'reload schema';
