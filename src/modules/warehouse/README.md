# warehouse — Warehouse Storage (CONRI Services)

Tracks every pallet Good Liquid stores at CONRI Services, the 3PL behind the
Palmetto facility, and produces the paperwork for each move. Sidebar:
**Operations → 🏬 Warehouse Storage** (admin and sales). Code: `warehouse.js`.
Schema: `supabase/migrations/20260930120000_warehouse_storage.sql`.

## Workflow

1. **SKU master.** Add each client SKU once (UPC/SKU, description, pack, units
   per case, default cases/weight/height per pallet, finished good or empty
   cans). Add lots and **QA release** them here. Then **Export CSV for CONRI**
   and send it to Paul. The export stamps each SKU as sent; a SKU CONRI has
   never received cannot be scheduled in. Editing a SKU's UPC, description or
   units per case clears the stamp, so it gets sent again.
2. **New transfer.** Pick the type and client. It starts as a draft with a
   number `GL-TR-YYYYMMDD-NN` (counting per transfer date).
   - **Quick build** (moves to CONRI): pick SKU + lot, pallet count and cases
     per pallet; the system creates the pallet records with tags `GL-P-000123`.
   - **Pick existing pallets** (pull backs, outbound, or leftovers): sorted
     FEFO.
3. **✏️ Edit** to set the time agreed with CONRI, then **✉ Scheduling email**
   (opens your mail app, addressed to CONRI) and **📅 Mark scheduled**.
4. **🖨️ Print paperwork**: page 1 is the Transfer Packing List, then one
   landscape pallet label per pallet with a Code 128 barcode of the tag.
5. When the load arrives, **✓ Complete**: pallets and cases received, who
   received it, condition, exceptions, and the signed packing list (upload now
   or later). Completing moves every pallet and writes the movement log.
6. **Outbound orders**: enter a client release, the pallets per SKU, and the
   pickup details. Allocation is FEFO (earliest best by, then first received)
   and creates an outbound pickup transfer. Send the order email, then **Mark
   shipped** with the BOL number.
7. **Reconciliation**: upload CONRI's inventory CSV; it is matched by SKU and
   lot against what we show at CONRI, and differences are highlighted. Nothing
   is saved.

The **dashboard** shows stock at CONRI by client, SKU and lot; empties in
storage with days held (red past 2 days); finished lots under 90 days to best
by (yellow); and upcoming transfers and pickups.

## Tables

| Table | Holds |
|---|---|
| `wh_skus` | SKU master per client (FK `clients`); `last_exported_at` = last sent to CONRI |
| `wh_lots` | Lots per SKU: production date, best by, `qa_status` hold/released |
| `wh_pallets` | One row per pallet: tag, SKU, lot, cases, weight, height, `location` (good_liquid / conri / shipped), `status`, `current_transfer_id`, `received_at_conri`, `expected_pull_date` |
| `wh_transfers` | Each move: number, type, status, schedule, carrier, receipt fields, `signed_doc_path` |
| `wh_transfer_lines` | Which pallets are on which transfer, in order |
| `wh_movements` | Append-only history of every pallet location/status change |
| `wh_outbound_orders` | Client releases, linked to their outbound pickup transfer, with BOL |

Signed packing lists are in the private `warehouse-docs` storage bucket and
open through short-lived signed URLs.

## Rules the database enforces (triggers, not just the page)

- Transfers go draft → scheduled → completed (or cancelled). Nothing skips
  scheduling. Completed and cancelled transfers are frozen, except for the
  signed document, notes and CONRI's confirmation number.
- Finished goods on QA hold cannot be added to, scheduled on, or completed on a
  transfer to CONRI. The check runs again at completion in case a lot was put
  back on hold.
- A SKU never exported to CONRI cannot be scheduled into CONRI.
- A pallet is on at most one open transfer, and all pallets on a transfer
  belong to its client.
- Completing a transfer moves its pallets in the same statement.
- `wh_movements` is written only by trigger; nobody can insert, edit or delete
  rows by hand.
- Nothing is deletable except pallet lines on a draft. A pallet made in error
  is voided (only while it is at Good Liquid and on no transfer).

## Access

Staff only at the database (`is_gl_staff()` plus the restrictive tenant guard).
Portal customers and self-registered users see zero rows; anon has no grant.
The page is open to the **admin** and **sales** roles: `loginUser` in
`src/services/auth.js` reveals the link for both, and `'warehouse'` is in the
sales page list in `src/services/permissions-service.js`.
It is also a checkbox on **Users & Permissions** (`page.warehouse`, on by
default): untick it to take the page and its sidebar link away from one sales
user. Admins are never limited by the checkboxes. The **warehouse**
and **viewer** roles do not see the link and the nav guard refuses the page.
Giving the `warehouse` role this page needs a decision first: that role is
blocked from `clients` at the database (`20260817000000_warehouse_rls_guard.sql`),
so it could not read client names here.

## Assumptions

- Pallet footprint in the scheduling email is a standard 48 x 40 in pallet.
- CONRI's CSV "Case Pack" column carries units per case (the pack wording is in
  Description). Change `skuCsv()` if CONRI's WMS wants something else.
- Emails open in the user's mail app (`mailto:`) rather than sending from the
  CRM, so nothing goes to CONRI without a person pressing send.
