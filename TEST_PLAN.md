# Good Liquid CRM — Manual Test Plan

Walk this top-to-bottom. For each step, if what you see doesn't match the **Expect**, paste the step number + what actually happened back to me. I'll fix in one PR.

Time estimate: 30–45 min if everything works; longer with failures.

**Prereqs:** the latest `fix/inspector-email-step1-and-applicability-banner` PR is merged and Vercel has redeployed. Test in an incognito window so cached state doesn't mask bugs.

---

## A. Compliance — the section where bugs keep surfacing

### A1. Compliance Tasks page
1. Sidebar → **🧾 Compliance Tasks** → confirm page loads with three tabs (Today / Open / Library) and a hold-tag banner if any open holds exist.
   - **Expect:** Today tab is selected by default. Task cards visible if any production runs are scheduled for today.
2. Click **⚙ Applicability** button → modal opens.
3. Uncheck "🧼 CIP cycle" → click Save → modal closes.
   - **Expect:** Purple banner appears above the task list: "🙈 Applicability filter active — hiding 1 task type (N cards hidden today)". Any CIP task card on today's list disappears.
4. Click **Show all** button on the banner.
   - **Expect:** Banner disappears. Hidden CIP cards reappear.

### A2. Inspector Link
1. On the same Compliance page → click **🔒 Inspector link** button (admin only).
   - **Expect:** Single modal opens with 5 fields: Inspector name, Inspector email, Agency, Hours, Purpose.
2. Fill: name="Test Inspector", email="your-own-email@example.com", hours=1, leave rest blank → click **🔒 Generate & email link**.
   - **Expect:** Step 2 renders. Green box "✓ Link generated for Test Inspector". Green "📧 Link emailed to your-own-email@example.com". Access URL textarea with `?inspector=...`. Copy button + Done button.
3. Check your inbox.
   - **Expect:** Email arrives within ~30s from `noreply@mail.goodliquidbevco.com` with the link.
4. Click the link in the email in an incognito window.
   - **Expect:** Red banner at top "🔒 INSPECTOR MODE — read-only view for Test Inspector ... expires...". You can browse compliance pages. Inputs/buttons are visibly disabled.
5. ⚠ **Known security gap to flag:** open DevTools on the inspector window → try editing a value. The CSS-based read-only is bypassable. Don't actually break anything; just confirm you can edit. This is logged as a backlog item (server-side RLS gating would be the real fix).

### A3. CIP / Sanitation Log page
1. Sidebar → **🧼 CIP / Sanitation Log**.
   - **Expect:** Hint banner explaining it shows GMP-SAN-002 records. Table with prior cycles you've logged. Each row shows: When, Equipment, Steps done (e.g. "9/9 steps"), Chemicals, Operator, PAA ppm, Result badge (PASS / FAIL / DRAFT / PENDING).
2. Click any row.
   - **Expect:** Detail modal opens with header card (equipment, cycle start, operator/PCQI, status) and a 9-row step table with ☑/☐ checkboxes, time/temp, reading, P/F per step. Deviation note in red callout if any.
3. Click **+ Log Cycle** → fill the 9-step form → click **Save draft**.
   - **Expect:** Modal closes. New row appears in the table with badge "DRAFT" (yellow). Subtitle shows "N drafts awaiting PCQI sign-off."
4. Click that draft row → confirm the saved data renders correctly.
5. Log a second cycle → click **✓ Save & sign as PCQI** this time.
   - **Expect:** Row appears with badge "PASS" (green).

### A4. Each individual compliance form
For each of these, just open it via Compliance Tasks → Forms Library → click the card → modal opens → fill required fields → Save draft → check Open Logs tab for the row:

- GMP-INSP-001 Pre-op Sanitation
- GMP-LAB-001 Label Verification
- GMP-ALL-001 Allergen Changeover Swab
- FSP-PC-001 HTST Pasteurization — **confirm the new "Cold-side / outlet temperature (°F)" field is present**
- FSP-PC-002 Hot Fill
- FSP-PC-003 UV Treatment
- FSP-PC-004 Can Seam
- FSP-PC-005 Fermentation
- GMP-SAN-002 CIP Monitoring (you already tested via the CIP page)
- FSP-SAN-001 Listeria Swab

**Expect for each:** Modal opens, Save draft works, draft appears in Open Logs tab.

### A5. Hold Tags page
1. Sidebar → **🚫 Hold Tags**.
   - **Expect:** List of any open holds. Click + Add Hold Tag → modal → fill → save.
2. Click an existing hold → disposition modal → mark "Released" → confirm status updates.

### A6. Audit Log
1. Sidebar → **📜 Audit Log** (admin only).
   - **Expect:** Last ~200 events from `audit_log` table. Filter input narrows by action/target/actor.

### A7. SMS critical-failure phone
1. Find the **SMS critical-failure** setting (admin → 🤖 toolbar → 📱 SMS Alerts or wherever it lives).
2. Open `glSetSmsAlertPhone` (it's a prompt). Enter `8135550100` (just 10 digits, no country code).
   - **Expect:** Confirmation alert says "Compliance SMS alerts will go to **+18135550100**" (auto-prefixed).
3. Open it again — should show `8135550100` as the previous value (stripped of `+1` for cleaner editing).

---

## B. Core CRM

### B1. Dashboard
- KPI tiles populate? Revenue chart renders? Activity feed shows recent items?

### B2. Clients
1. Click any client row → detail overlay opens with billed-to-date + recent invoices + buttons (Edit Client / AI Summary / Invite Portal Login / Allergen Decl).
2. Click **✏️ Edit Client** → giant modal opens.
3. Scroll through — confirm sections render: Brand name, EIN/Website, MAIN POINT OF CONTACT (with the "📱 SMS overdue reminders" checkbox), ADDITIONAL EMAILS, STREET ADDRESS, billing/shipping, RECEIVING/LOGISTICS, PREFERRED COMMUNICATION, SERVICE/STATUS, PAYMENT TERMS, HOW DID YOU FIND US, PRODUCT TYPES, COI/W9/Tax/PA Letter file fields, **💵 PRICING OVERRIDES** (yellow panel with + Add rate button), NOTES.
4. Click **+ Add rate** → modal opens with Service dropdown, Format, Rate, Notes, Effective from/until.
5. Save the modal. Confirm rate appears in the list above. Click Remove on it → confirm it disappears.
6. Save the Edit Client modal. Reopen it → confirm everything persisted.

### B3. New Invoice
1. Sidebar → **➕ New Invoice** → builder opens.
2. Pick a client.
   - **Expect:** If that client has a pricing override, a yellow "💵 N custom rates applied" badge appears next to "NEW INVOICE" title.
3. Add a Canning line → 150 cases → confirm per-can/per-case rate matches override (if any) or the public tier ladder (if not).
4. Add an R&D line, save invoice as draft. Open it. Click **📧 Send Invoice** → composer opens with To prefilled. Don't actually send unless you want to.

### B4. Email Activity
1. Open any sent invoice → **📊 Activity** button.
   - **Expect:** Timeline of Sent → Delivered → Opened → Clicked per send, with timestamps. Open/click counts.

### B5. Customer Requests inbox
1. Sidebar → **📩 Customer Requests** (if a request exists).
2. Click one → status modal opens → change to In progress → save.
   - **Expect:** Status pill changes, banner count updates if it was on "New".

### B6. Users & Permissions
1. Sidebar → **🔑 Users & permissions** (admin only).
2. Click your own row → matrix opens with ROLE block + new **NOTIFICATIONS** block + presets bar + 3 permission tables.
3. Uncheck "📨 Send Daily Digest email at 7am" → confirm green "Notification preference saved" toast. Reload page, reopen — confirm checkbox stayed off.

---

## C. Customer Portal (different code path entirely)

Open `?portal=1` URL (or your dedicated portal URL) in incognito. Sign in as a portal customer.

### C1. Dashboard
1. Confirm sections render: KPI tiles, invoices with PDF/View buttons, Production Runs (now shows date range like "Sep 4 → Sep 6 · Lot L26140-A"), Sample Shipments with carrier tracking links, Formulas, **📎 COAs & DOCUMENTS** section with ⬇ Download buttons, Allergen Declarations.
2. Click ⬇ Download on a lot document → confirm file opens in new tab.

### C2. Account Settings
1. Click **Account settings** (top-right).
2. Confirm sections render: CONTACT INFO, BILLING ADDRESS, SHIPPING ADDRESS, DELIVERY PREFERENCES, **NOTIFICATIONS** (violet panel with "🏭 Production stage emails" checkbox), TEAMMATES (with role pills if any), CHANGE PASSWORD.
3. Uncheck the production stage emails checkbox → click Save changes → confirm modal closes with green "Account updated" message.
4. Reopen Account Settings → confirm the checkbox stayed off.

### C3. Customer Requests (portal-side submission)
1. Click any quick-action tile (Sample Request / Formula Change / Production Schedule / Billing Question).
2. Fill subject + body → submit.
   - **Expect:** Success message, modal closes after ~1.5s.
3. (Sign in as staff in another browser) → confirm the request appears on the Customer Requests inbox.

### C4. TEAMMATES (owner only)
1. As an owner-role portal customer, enter email + display name → click + Invite.
   - **Expect:** Success message, new teammate appears in list with role "MEMBER" badge.

---

## What to send back

When done, send me:

1. **List of step numbers that failed** (e.g. "A2 step 3 — no email arrived")
2. **For each failure: what you actually saw**
3. **Any browser console errors** (DevTools → Console tab → screenshot anything red)

I'll bundle all fixes into one PR.

---

## What I found in the deep-trace agents (parallel work)

The agents flagged a mix of false positives and real bugs. Real ones I'm fixing or already fixed:

| Issue | Status |
|---|---|
| `notify_run_stage_changes` column migration was orphaned (never merged from a stale branch) | ✅ migration restored in this PR — safe to re-apply since it's `add column if not exists` |
| Inspector mode read-only is CSS-only — bypassable via DevTools | ⚠️ documented; needs server-side RLS check (separate PR, larger) |
| `email_log` / `email_schedule` RLS uses `for all to authenticated using (true)` — a portal customer with DevTools could potentially read all email metadata | ⚠️ documented; needs RLS lockdown migration (separate PR) |

The agents also flagged some things they got wrong (SMS opt-in not implemented, CIP writes to wrong table, etc.) — I cross-verified those against the live code and they're already done. Don't worry about those.
