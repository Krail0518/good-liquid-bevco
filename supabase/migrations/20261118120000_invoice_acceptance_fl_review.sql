-- ════════════════════════════════════════════════════════════════
-- Invoice Acceptance wording: revisions from a Florida-law review
-- ════════════════════════════════════════════════════════════════
-- Replaces the starting draft seeded by 20261117180000 with wording that
-- closes the gaps found reviewing it against Florida law (2026-11-17). It
-- is still a draft for attorney review, not legal advice.
--
--   1  Claim window split: visible defects 5 business days after pickup;
--      hidden defects (re-fermentation shows up weeks later) 5 business days
--      after discovery, no later than 90 days. A flat 5-day deemed
--      acceptance risked being "manifestly unreasonable" for latent defects
--      (Fla. Stat. 671.102, 672.607(3)(a)).
--   2  Microorganisms limited to those present in the formula or in
--      Customer-supplied/specified ingredients, so it cannot be read as
--      excusing contamination at Good Liquid (clear-and-unequivocal rule,
--      Charles Poe Masonry, 374 So. 2d 487).
--   3  NEW: conspicuous warranty disclaimer naming merchantability and
--      fitness (Fla. Stat. 672.316); Good Liquid's only warranty is specs
--      + cGMP, as in Manufacturing Agreement section 12.
--   5  Remedy labeled sole and exclusive, with a refund fallback
--      (672.719(1)(b), (2)); gross negligence / willful misconduct carved
--      out (Merrill Stevens Dry Dock v. Alvarez).
--   6  Indemnity defense procedure + product liability insurance naming
--      Good Liquid (Manufacturing Agreement section 14).
--   8  NEW: Florida law, Manatee County venue, mutual prevailing-party fees
--      (Fla. Stat. 57.105(7)), matching the NDA and Manufacturing Agreement.
--   9  Master agreement controls only where it conflicts; customer
--      purchase-order terms do not apply.
--
-- Placeholders and the [[SIGNATURES]] block are unchanged, so the CRM and
-- the agreement-sign edge function need no change. Agreements already
-- issued keep the exact text they were signed with (agreements.body).
--
-- GUARDED: the UPDATE only fires if the template still holds the original
-- seeded text (md5 c419402a9777f43226a5914cae545b0b). If an admin has
-- edited it in Agreement Templates, nothing is overwritten.
--
-- ROLLBACK:
--   Re-apply the template body from 20261117180000_invoice_acceptance_signing.sql
--   with: update public.agreement_templates set body = <that text>
--         where kind = 'invoice_acceptance';
--   No schema change; nothing else depends on the wording.

set search_path = public, extensions;

update public.agreement_templates
set title = 'Invoice Acceptance and Product Responsibility',
    body = $tpl$# INVOICE ACCEPTANCE AND PRODUCT RESPONSIBILITY

Invoice {{invoice_number}} dated {{invoice_date}}, issued by {{gl_legal_name}} ("Good Liquid") to {{client_legal_name}} ("Customer").

## Invoice Summary

{{invoice_lines}}

Total: {{invoice_total}}
Payment terms: {{payment_terms}}

## Kill Step for This Run

{{kill_step}}

## Terms

By signing below, Customer accepts this invoice and agrees to the following.

1. Acceptance of work. The products on this invoice were made to Customer's formula, specifications and instructions, and Customer accepts the quantities, services and prices shown. Customer will inspect the products when they are made available for pickup.
(a) Visible defects. A claim of a defect that a reasonable inspection would reveal (for example fill level, seams, dents, labeling, or carbonation as filled) must be made in writing, with photos and lot codes, within five (5) business days after the products are made available for pickup.
(b) Hidden defects. A claim of a defect that a reasonable inspection would not reveal must be made in writing, with photos, lot codes and the storage history of the affected products, within five (5) business days after Customer discovers it, and in no event later than ninety (90) days after the products are made available for pickup.
Products not claimed within these periods are accepted as conforming. Before responding to a claim, Good Liquid may examine the affected products and its retained production samples.

2. Formula and shelf stability are Customer's responsibility. Customer alone is responsible for its formula and ingredients and for the shelf stability of the finished product as designed, including its microbial stability, pH, residual sugar, preservative system and target carbonation. Good Liquid is not responsible for containers that swell, bulge, leak, re-ferment, over-pressurize or burst because of (a) the formula or its design; (b) yeast, live cultures or other microorganisms present in the formula or in ingredients or materials supplied or specified by Customer; (c) insufficient preservation in the formula; or (d) Customer's decision not to use a kill step, such as pasteurization, that Good Liquid offered or recommended.

3. Warranty. Good Liquid's only warranty is that the products on this invoice were manufactured in accordance with Customer's written specifications and current good manufacturing practice requirements (21 C.F.R. Part 117). EXCEPT FOR THAT WARRANTY, GOOD LIQUID MAKES NO WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING ANY IMPLIED WARRANTY OF MERCHANTABILITY OR OF FITNESS FOR A PARTICULAR PURPOSE, AND GOOD LIQUID DOES NOT WARRANT THE SHELF LIFE OF ANY PRODUCT.

4. After pickup. Title and risk of loss pass to Customer when the products are made available for pickup (Ex Works, Good Liquid's facility). Good Liquid is not responsible for damage caused by storage, transport, heat or freezing, or handling after that point.

5. Sole and exclusive remedy; limitation of liability. IF PRODUCTS ON THIS INVOICE DO NOT CONFORM TO THE WARRANTY IN SECTION 3, CUSTOMER'S SOLE AND EXCLUSIVE REMEDY, AND GOOD LIQUID'S ONLY OBLIGATION, IS, AT GOOD LIQUID'S OPTION, TO RE-RUN THE AFFECTED UNITS (USING REPLACEMENT INGREDIENTS AND MATERIALS SUPPLIED BY CUSTOMER WHERE THE ORIGINALS WERE SUPPLIED BY CUSTOMER) OR TO CREDIT OR REFUND THE MANUFACTURING CHARGES FOR THOSE UNITS. IF A RE-RUN IS NOT PRACTICAL, GOOD LIQUID WILL REFUND THOSE CHARGES. GOOD LIQUID'S TOTAL LIABILITY FOR ANY CLAIM RELATING TO THIS INVOICE WILL NOT EXCEED THE MANUFACTURING CHARGES ON THIS INVOICE FOR THE AFFECTED UNITS. GOOD LIQUID IS NOT LIABLE FOR INGREDIENTS OR PACKAGING SUPPLIED BY CUSTOMER, LOST PRODUCT, LOST PROFITS, RECALLS, RETAILER CHARGEBACKS, CLEANUP, OR ANY OTHER INDIRECT, INCIDENTAL OR CONSEQUENTIAL DAMAGES. These limits do not apply to the extent a loss is caused by Good Liquid's gross negligence or willful misconduct.

6. Indemnity and insurance. Customer will defend, indemnify and hold harmless Good Liquid and its owners, employees and agents from third-party claims, losses and expenses, including reasonable attorneys' fees and claims of injury or property damage from a container that fails, to the extent arising from Customer's formula, ingredients or materials, labels or claims, or from the handling, storage, distribution or sale of the products after pickup, except to the extent caused by Good Liquid's failure to follow Customer's written specifications or current good manufacturing practice. Good Liquid will notify Customer promptly of any such claim. Customer will control the defense with counsel reasonably acceptable to Good Liquid and will not settle a claim in a way that admits fault by Good Liquid without Good Liquid's written consent; Good Liquid may take part with its own counsel at its own cost. Customer will maintain commercial general liability insurance, including products and completed operations coverage, with limits of at least USD 1,000,000 per occurrence, naming Good Liquid as an additional insured, and will provide a certificate of insurance on request.

7. Payment. Payment is due under the payment terms shown above. Past-due balances accrue interest at 1.5% per month or the maximum rate allowed by law, whichever is less, and Good Liquid may hold finished product until this invoice is paid.

8. Governing law, venue and fees. These terms are governed by the laws of the State of Florida, without regard to its conflict of law rules. Each party consents to the exclusive jurisdiction and venue of the state and federal courts located in or serving Manatee County, Florida. In any action arising from this invoice or these terms, the prevailing party is entitled to recover its reasonable attorneys' fees and costs.

9. Master agreement. If Customer and Good Liquid have signed a Contract Manufacturing Agreement, that agreement controls where it conflicts with these terms, and these terms otherwise add to it. Terms in Customer's purchase orders or other forms do not apply.

## Signature

[[SIGNATURES]]$tpl$
where kind = 'invoice_acceptance'
  and md5(body) = 'c419402a9777f43226a5914cae545b0b';

notify pgrst, 'reload schema';
