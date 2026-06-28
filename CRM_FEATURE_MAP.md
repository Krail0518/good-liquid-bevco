# Good Liquid Bev Co — CRM Feature Map

> **Purpose:** Source of truth for every page, button, system, and admin gate in the CRM.
> Before making ANY UI change, read the relevant section(s) here first.
> Last audited: 2026-06-28.

---

## HOW TO USE THIS DOCUMENT

- **Adding a button?** Find the page in Section 1. Check Section 6 (admin gates) and Section 4 (invoice detail) if relevant.
- **Touching navigation?** Read Section 2 (top bar) and Section 3 (sidebar) in full before changing anything.
- **Adding a new IIFE or JS system?** Read Section 5 and Section 9 to understand what global state already exists.
- **Touching an edge function?** Read Section 7 first.
- **Not sure if something is admin-only?** Section 6 has the complete list.

---

## 1. CRM PAGES — COMPLETE INVENTORY

### Main Pages (All Roles)

| Page ID | Sidebar ID | Title | Role | Header Buttons |
|---------|-----------|-------|------|----------------|
| `cpg-dashboard` | (no id; always visible) | DASHBOARD | All | `+ New Invoice` (primary) |
| `cpg-clients` | `nav-clients` | CLIENTS | Admin/Sales | (none in header) |
| `cpg-pipeline` | `nav-pipeline` | PIPELINE | Admin/Sales | (none in header) |
| `cpg-invoices` | `nav-invoices` | INVOICES | Admin/Sales | `+ New Invoice` (primary) |
| `cpg-newinv` | (no sidebar item; nav via button) | CREATE INVOICE | Admin/Sales | (form only) |
| `cpg-referrals` | `nav-referrals` | REFERRALS | Admin/Sales | `+ Log referral` (primary) |
| `cpg-referrers` | `nav-referrers` | REFERRERS | Admin/Sales | `+ Add referrer` (primary) |
| `cpg-activity` | `nav-activity` | ACTIVITY FEED | All | (filter pills only) |

### Operations Pages

| Page ID | Sidebar ID | Title | Role | Header Buttons |
|---------|-----------|-------|------|----------------|
| `cpg-production-runs` | `nav-production-runs` | PRODUCTION RUNS | Admin/Sales | `+ Add Run` (primary) |
| `cpg-samples` | `nav-samples` | SAMPLE SHIPMENTS | Admin/Sales | `+ Log Shipment` (primary) |
| `cpg-formulas` | `nav-formulas` | FORMULA VAULT | Admin/Sales | `+ New Formula` (primary) |
| `cpg-yield` | `nav-yield` | YIELD TRACKER | Admin/Sales | `+ Log Completion` (primary) |
| `cpg-content` | `nav-content` | CONTENT CALENDAR | Admin/Sales | `+ New Post` (primary) |
| `cpg-defects` | `nav-defects` | DEFECTS / NCRs | Admin/Sales | `+ Log Defect` (primary) |
| `cpg-vendors` | `nav-vendors` | VENDORS | Admin/Sales | `+ Add Vendor` (primary) |

### Calendars

| Page ID | Sidebar ID | Title | Role | Header Buttons |
|---------|-----------|-------|------|----------------|
| `cpg-calendar` | `nav-calendar` | GENERAL CALENDAR | Admin/Sales | `+ Add Event` (primary) |
| `cpg-production-cal` | `nav-production-cal` | PRODUCTION SCHEDULE | Admin/Sales | `🤖 AI Optimize`, `+ Add Production Run` (primary) |

### Compliance & Quality

| Page ID | Sidebar ID | Title | Role | Header Buttons |
|---------|-----------|-------|------|----------------|
| `cpg-compliance` | `nav-compliance` | COMPLIANCE | Admin/Sales | (none) |
| `cpg-cip` | `nav-cip` | CIP / SANITATION LOG | Admin/Sales | `+ Log Cycle` (primary) |
| `cpg-holds` | `nav-holds` | HOLD TAGS | Admin/Sales | `+ New Hold Tag` (primary) |
| `cpg-audit` | `nav-audit` | AUDIT LOG | **Admin only** (hidden) | Filter input |

### Tools & Admin

| Page ID | Sidebar ID | Title | Role | Header Buttons |
|---------|-----------|-------|------|----------------|
| `cpg-tasks` | `nav-tasks` | TASKS | Admin/Sales | `+ Add Task` (primary) |
| `cpg-documents` | `nav-documents` | DOCUMENTS | Admin/Sales | `+ Upload Document` (primary) |
| `cpg-inventory` | `nav-inventory` | INVENTORY | Admin/Sales | `+ Add Item` (primary) |
| `cpg-announcements` | `nav-announcements` | ANNOUNCEMENTS | Admin/Sales | `+ Post` (primary) |
| `cpg-customers` | `nav-customers` | CUSTOMER LOGINS | **Admin only** (hidden) | `📧 Send Onboarding Email` (primary) |
| `cpg-users` | (no sidebar item — accessed via top bar `#top-btn-users`) | USERS & PERMISSIONS | **Admin only** | `+ Invite user` (primary); Backup button injected by fix.js into `.cph` |

### Special Pages (Open via function, not sidebar nav)

- **Time Tracker** — `nav-time-tracker` → `openTimeTracker()`
- **Reports** — `nav-reports` → `openReports()` (teal highlight)
- **AI Settings** — `nav-ai-settings` → `openAISettings()` (teal highlight)

---

## 2. TOP BAR — COMPLETE ELEMENT INVENTORY

**Container:** `#crm-top` (52px height, dark theme)

### Left
- **Brand logo + name** (`.crm-brand`) — "Good Liquid" + "CRM" badge; not clickable

### Center
- Empty spacer

### Right (`.crm-top-actions`)
1. **💬 Chat** (`#crm-chat-btn`) — toggles CRM chat sidebar; all users
2. **🔔 Bell** (`#notif-bell`) — opens `#notif-panel`; badge `#notif-badge` shows unread count; all users

### User Section (`.crm-usr`)
3. **Avatar + Name** (`.crm-av`, `.crm-user-name`) — initials, name, role badge (gold=Admin, blue=Sales)
4. **🔑 Users & permissions** (`#top-btn-users`) — **ADMIN ONLY** — `cNav('users',null)`; shown by login check
5. **💾 Backup all data** (`#top-btn-backup`) — **ADMIN ONLY** — `window.glExportEverything()`; shown by same login check
6. **📨 Send digest** (`#top-btn-digest`) — **ADMIN ONLY** — `runDailyDigestNow()`; shown by same login check
6. **🔑 Password** — `openChangePwModal()`; all users
7. **Sign out** — `logoutCRM()`; all users

**Critical:** Items 4–6 have `display:none` in HTML. They are revealed by the admin login check in **fix.js line 281** (`window.loginUser`), NOT by the `data-gl-perm` permission scanner and NOT by the version of loginUser in index.html (that version is overridden by fix.js and never runs). If you add more admin-only top bar buttons, follow the same pattern: give them an `id`, set `display:none` in HTML, and add the reveal inside the `if(u.role==='admin')` block at **fix.js line 281**.

---

## 3. SIDEBAR NAVIGATION — COMPLETE INVENTORY

**Container:** `#crm-sidebar` (192px width)

Items hidden by default (admin-only) use `style="display:none"` and are shown by the `if(u.role==='admin')` block in index.html at login.

| Section | Label | ID | onclick | Admin-only |
|---------|-------|-----|---------|------------|
| **MAIN** | 📊 Dashboard | (none) | `cNav('dashboard',this)` | No |
| | 👥 Clients | (none) | `cNav('clients',this)` | No |
| | 📋 Pipeline | (none) | `cNav('pipeline',this)` | No |
| **BILLING** | 🧾 Invoices | (none) | `cNav('invoices',this)` | No |
| | ➕ New Invoice | (none) | `cNav('newinv',this)` | No |
| **REFERRALS** | 🤝 Referrals | `nav-referrals` | `cNav('referrals',this)` | No |
| | 👤 Referrers | `nav-referrers` | `cNav('referrers',this)` | No |
| **OTHER** | 📡 Activity | `nav-activity` | `cNav('activity',this)` | No |
| **OPERATIONS** | 🏭 Production Runs | `nav-production-runs` | `cNav('production-runs',this)` | No |
| | 📦 Sample Shipments | `nav-samples` | `cNav('samples',this)` | No |
| **CALENDARS** | 📅 General Calendar | `nav-calendar` | `cNav('calendar',this)` | No |
| | 🏭 Production Schedule | `nav-production-cal` | `cNav('production-cal',this)` | No |
| **OPERATIONS PRO** | 🧪 Formula Vault | `nav-formulas` | `cNav('formulas',this)` | No |
| | 📈 Yield Tracker | `nav-yield` | `cNav('yield',this)` | No |
| **MARKETING** | 🗓️ Content Calendar | `nav-content` | `cNav('content',this)` | No |
| **COMPLIANCE** | 📋 Compliance Tasks | `nav-compliance` | `cNav('compliance',this)` | No |
| | 🧼 CIP / Sanitation Log | `nav-cip` | `cNav('cip',this)` | No |
| | 🚫 Hold Tags | `nav-holds` | `cNav('holds',this)` | No |
| | 📜 Audit Log | `nav-audit` | `cNav('audit',this)` | **YES** (hidden) |
| **QUALITY & SUPPLY** | ⚠️ Defects / NCRs | `nav-defects` | `cNav('defects',this)` | No |
| | 🏭 Vendors | `nav-vendors` | `cNav('vendors',this)` | No |
| **TOOLS** | ✅ Tasks | `nav-tasks` | `cNav('tasks',this)` | No |
| | 📁 Documents | `nav-documents` | `cNav('documents',this)` | No |
| | 📦 Inventory | `nav-inventory` | `cNav('inventory',this)` | No |
| | 📣 Announcements | `nav-announcements` | `cNav('announcements',this)` | No |
| | ⏱️ Time Tracker | `nav-time-tracker` | `openTimeTracker()` | No |
| | 🌐 Customer Logins | `nav-customers` | `cNav('customers',this)` | **YES** (hidden) |
| | 📊 Reports | `nav-reports` | `openReports()` | No (teal) |
| | 🤖 AI Settings | `nav-ai-settings` | `openAISettings()` | No (teal) |

**Note:** There is NO `nav-users` sidebar item. The Users & Permissions page is accessed exclusively via the `#top-btn-users` button in the top bar (admin only). Do NOT add a sidebar nav item for it — the user wants it in the top bar only.

---

## 4. INVOICE DETAIL TOOLBAR — COMPLETE BUTTON INVENTORY

**Container:** `#inv-detail` overlay

### Native HTML Buttons (always present, in order)

| # | Text | Class | onclick | Notes |
|---|------|-------|---------|-------|
| 1 | ← Back | `.cbtn` | `closeDetail()` | Returns to invoice list |
| 2 | ✓ Mark paid | `.cbtn.grn` | `markStatus('paid')` | Green |
| 3 | ⚠ Mark overdue | `.cbtn.amber` | `markStatus('overdue')` | Amber |
| 4 | ✉ AI Follow-Up | `.cbtn` | `openFollowUpModal()` | Opens email composer |
| 5 | 📧 Send Invoice | `.cbtn` | `openSendInvoiceModal(currentInvId)` | Email modal with PDF attach |
| 6 | ✏️ Edit | `.cbtn` | `window.openEditInvoice(currentInvId)` | Re-opens invoice builder |
| 7 | ⬇ PDF | `.cbtn` | `downloadInvoicePDF(currentInvId)` | Browser print dialog |
| 8 | 🤖 AI Email | `.cbtn` | `aiDraftEmail(...)` | Generates professional email |

### Conditionally Injected Buttons (fix.js IIFEs)

| Button | CSS class | Condition | Action | Admin-only |
|--------|-----------|-----------|--------|------------|
| Void | `.gl-void-btn` | Status = pending | Marks invoice void | Yes |
| Record Payment | `.gl-pay-btn` | Invoice open | Opens payment entry modal | Yes |
| Collect | `.gl-collect-btn` | Stripe enabled | Opens Stripe Checkout | Yes |
| Delete | (two-step IIFE) | Admin | Removes invoice; 2-step confirm | Yes |
| Push to QB | (QBO IIFE) | QBO connected | Sends to QuickBooks Online | Yes |
| Request Signature | (Dropbox Sign IIFE) | Dropbox Sign enabled | Sends signature request | No |

**Important:** Injected buttons use DOM-presence class guards. Before injecting, each function checks `btnRow.querySelector('.gl-xxx-btn')`. If the class is already in the DOM, injection is skipped — this prevents duplicates regardless of MutationObserver timing.

---

## 5. GLOBAL SYSTEMS (fix.js IIFEs) — KEY INVENTORY

### Authentication & Session
- Login/logout, session state, `window.currentUser`, `window.loginUser(u)`, `window.glSignOut()`
- On admin login: shows `nav-audit`, `nav-customers`, `#top-btn-users`, `#top-btn-digest`

### Permission System
- `window.glCan(permId)` — check component permission
- `window.can(page)` — check page access
- Admins bypass all checks automatically
- `data-gl-perm` attribute gates element visibility
- Scans DOM via `scanAndHide()` — only reliable at page-load, NOT for elements added after login

### Invoice Management (Core)
- `window.INV` — current invoice being edited
- `window.invoices` — all invoices (live cache)
- `window.saveInvoice(status)`, `window.deleteInvoice(id, opts)`
- Two-step delete IIFE uses `replaceChild` to avoid event listener conflicts

### Audit Logging
- `window.glAudit(action, target, details)` — logs to `audit_log` table
- All admin destructive actions must call this before executing

### PDF Generation
- `ensureJsPdf()` — lazy-loads jsPDF from CDN on first call
- `window.downloadInvoicePDF(id)` — browser print dialog
- `generateInvoicePdf()` — native-text PDF (~10-20KB)

### Data Export (Admin)
- `window.glExportEverything()` — full DB dump via JSZip
- JSZip is pre-warmed at IIFE init time (not on click) to avoid first-click delay
- No `confirm()` dialog — starts immediately with a progress overlay

### Daily Digest
- `runDailyDigestNow()` — manually triggers `daily-digest` edge function
- Auto-runs via cron at 7am UTC

### MutationObserver Watchers
- Multiple IIFEs observe `.crm-panel` for DOM changes
- Trigger `setTimeout(runInjectors, 300)` on any mutation
- Guards with dataset flags AND DOM-presence class checks (`.gl-void-btn`, `.gl-pay-btn`, `.gl-collect-btn`)
- **Risk:** If you change `.crm-panel` structure, these observers may fire unexpectedly

---

## 6. ADMIN-ONLY FEATURES — COMPLETE LIST

### How Admin Gating Works

Three mechanisms, used in combination:

1. **HTML `display:none` + login check** — element starts hidden; `if(u.role==='admin')` block in **fix.js line 281** (the active `loginUser`) shows it at login. The version of this check in index.html is dead code — fix.js overrides `window.loginUser` entirely.
2. **`data-gl-perm` attribute** — `scanAndHide()` in permission system reveals/hides at page load. Has timing issues — do not rely on it for elements that must be visible immediately after login.
3. **Inline JS role check** — function body checks `currentUser.role !== 'admin'` before executing.

**For new admin-only elements:** Use mechanism 1. Give the element an `id`, set `display:none` in HTML, add the reveal to fix.js line 281 inside the `if(u.role==='admin')` block.

### How Per-User Permission Gating Works (non-admin users)

1. On login, `loginUser()` shows the CRM panel and starts polling for `perms.loaded`
2. Concurrently, `onAuthStateChange('SIGNED_IN')` fires `loadPermissions()` — fetches `permission_components` and `user_permissions` tables from Supabase (3–4 DB calls, ~300–800ms)
3. When `perms.loaded` becomes true, the polling loop in `loginUser` calls `applyGating()` immediately
4. `applyGating()` hides nav items the user can't access, then checks if the current active page is forbidden — if so, redirects to the first permitted page
5. `cNavGuard` wraps `window.cNav` to block direct navigation to forbidden pages
6. Per-checkbox changes call `glTogglePerm()` → upserts to `user_permissions` table → takes effect next login for that user

**Key constraint:** Permission changes take effect on the target user's NEXT login, not immediately. The `perms.userPerms` cache is loaded once at login.

**`glCan(componentId)` logic:** checks `user_permissions` row for this user → falls back to `permission_components.default_on` → if component doesn't exist in table, returns `true` (fail-open).

**Preset Apply button:** uses `window.glPresets` (same object as `ROLE_PRESETS`) — if this is undefined, the dropdown is empty and Apply does nothing. Both are set together at declaration: `var ROLE_PRESETS = window.glPresets = {...}`.

### Admin-Only Navigation

| Element | Mechanism | Reveals |
|---------|-----------|---------|
| `nav-audit` sidebar item | Login check | Audit Log page |
| `nav-customers` sidebar item | Login check | Customer Logins page |
| `#top-btn-users` top bar button | Login check | Users & Permissions page |
| `#top-btn-digest` top bar button | Login check | Manual digest trigger |

### Admin-Only Pages

- **Audit Log** (`cpg-audit`) — last 200 recorded actions, searchable
- **Customer Logins** (`cpg-customers`) — portal access management, onboarding emails
- **Users & Permissions** (`cpg-users`) — invite, remove, role change, per-user permission toggles; Backup all data button

### Admin-Only Invoice Actions (Injected)

- Delete Invoice (two-step confirm)
- Void Invoice
- Record Payment
- Collect (Stripe Checkout)

### Admin-Only Functions (inline role check)

| Function | Permission ID | What it does |
|----------|--------------|--------------|
| `glExportEverything()` | `action.export.bulk` | Full data export (ZIP) |
| `glExportInvoicesCsv()` | `action.export.csv` | Invoice CSV export |
| `markStatus('paid')` | `action.invoice.mark_paid` | Mark invoice paid |
| `deleteClient()` | `action.client.delete` | Remove a client |
| `deleteDeal()` | `action.deal.delete` | Remove a deal |
| `deleteInvoice()` | `action.invoice.delete` | Remove an invoice |
| `removeUser()` | (super-user only) | Delete user + purge auth record |
| `glTogglePerm()` | (admin only) | Toggle per-user permission |

---

## 7. EDGE FUNCTIONS — COMPLETE CATALOG

**Base URL:** `https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/<name>`

**Deploy script:** `supabase/deploy-functions.sh` — run `bash supabase/deploy-functions.sh` after any function change

| Function | Purpose | Caller | Required Secrets | Notes |
|----------|---------|--------|-----------------|-------|
| `invite-staff-user` | Sends invite email; retries if email "already registered" by purging stale auth record | `openInviteModal()` → fetch | Auto-provided by Supabase | Smart re-invite logic for previously removed users |
| `delete-staff-user` | Hard-deletes auth.users record + profiles row | `removeUser()` → fetch | Auto-provided by Supabase | Requires caller to be super-user |
| `stripe-checkout-session` | Generates Stripe Checkout URL | `openStripeCheckout()` | `STRIPE_SECRET_KEY` | Test mode uses `sk_test_` key |
| `send-sms` | Sends SMS via Twilio | `sendSMS()` | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | |
| `dropbox-sign` | Sends e-signature request | `requestSignature()` | `HELLOSIGN_API_KEY`, `HELLOSIGN_TEST_MODE` | |
| `qbo-connect` | Returns QuickBooks OAuth URL | `openQBOAuth()` | `INTUIT_CLIENT_ID`, `INTUIT_CLIENT_SECRET`, `INTUIT_REDIRECT_URI`, `INTUIT_ENV` | |
| `qbo-callback` | Stores QBO OAuth tokens (no-verify-jwt) | Intuit redirect | Same as above | Stores in `qbo_tokens` table |
| `qbo-disconnect` | Revokes QBO token | `disconnectQBO()` | Same as above | Clears `qbo_tokens` |
| `qbo-push-invoice` | Pushes invoice to QuickBooks | `pushToQBO()` | Same + stored tokens | |
| `daily-digest` | Sends daily summary email | Cron (7am UTC) + `runDailyDigestNow()` | Mailgun secrets | Sends to all opted-in users |
| `mailgun-send` | Wrapper for Mailgun API | Other functions | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM_EMAIL` | |
| `mailgun-webhook` | Receives Mailgun bounces/opens (no-verify-jwt) | Mailgun → Supabase | None | Updates `contacts` table |

---

## 8. SUPABASE TABLES

**Project ref:** `ufjkeqmxwuyhbqyugcgg`

### Core Tables

| Table | Key Fields | Notes |
|-------|-----------|-------|
| `profiles` | id, email, role, name, initials, color, tc, status, is_super_user, notify_daily_digest | Role: admin/sales/viewer |
| `clients` | id, name, email, phone, contact_name, notes, rate_overrides (JSONB) | |
| `invoices` | id, invoice_number (GL-XXXX), client_id, amount, status, line_items (JSONB), stripe_payment_link, qbo_id | status: draft/pending/paid/overdue/void |
| `referrals` | id, referrer_id, client_name, deal_value, commission_rate, commission_amount, status | status: lead/presented/won/paid/lost |
| `referrers` | id, name, email, phone, default_rate | |
| `activity_feed` | id, user_id, action_type, target, details (JSONB), timestamp | action_type: call/email/deal/invoice/note/ref |
| `audit_log` | id, action, target, details (JSONB), user_id, timestamp | Admin-only view |
| `qbo_tokens` | id=1, access_token, refresh_token, realm_id, expires_at | Single row; never sent to client |
| `permissions` | user_id, permission_id, enabled | Per-user permission overrides |

### Operations Tables

`production_runs` · `sample_shipments` · `formulas` · `yield_logs` · `calendar_events` · `content_calendar` · `cip_logs` · `compliance_tasks` · `compliance_records` · `hold_tags` · `defects` · `vendors` · `inventory` · `tasks` · `documents` · `announcements` · `time_entries` · `notifications` · `contacts` · `email_templates` · `app_settings`

### Compliance / Regulatory Tables

`inspector_tokens` · `facilities` · `client_allergen_declarations` (see migration `20260518_phase4_sql_pack.sql`)

---

## 9. KEY GLOBAL VARIABLES & WINDOW FUNCTIONS

### State Variables

| Variable | Type | Purpose |
|----------|------|---------|
| `window.currentUser` | Object | Logged-in user: `{id, email, role, name, is_super_user}` |
| `window.users` | Array | All team members |
| `window.clients` | Array | All clients (cached) |
| `window.invoices` | Array | All invoices (live cache — single source of truth) |
| `window.supa` | Supabase Client | Authenticated DB connection |
| `window.INV` | Object | Invoice being edited; cleared on save |
| `window.currentInvId` | String | Invoice currently open in detail view |
| `window.GL_APP_SETTINGS` | Object | Feature flags from `app_settings` table |

### Core Functions

| Function | What it does |
|----------|-------------|
| `cNav(page, el)` | Navigate to page; update `.act` class on sidebar item |
| `loginUser(u)` | Set current user; show admin elements; load all data |
| `glSignOut()` | Clear session; return to login |
| `glAudit(action, target, details)` | Log action to `audit_log` table |
| `glCan(permId)` | Returns boolean; check component permission for current user |
| `can(page)` | Returns boolean; check page access for current user |
| `glIsSuperUser()` | Returns boolean; true only for Mike |
| `toast(msg, type)` | Show ephemeral toast notification |
| `saveInvoice(status)` | Persist `window.INV` to Supabase + update `window.invoices` array |
| `deleteInvoice(id, opts)` | Remove from Supabase + `window.invoices`; logs audit |
| `glExportEverything()` | Export all tables as ZIP; no confirm dialog — starts immediately |
| `runDailyDigestNow()` | Call `daily-digest` edge function manually |
| `removeUser(id)` | Call `delete-staff-user` edge function; hard-deletes auth record |
| `openInviteModal()` | Open user invite form |

---

## 10. CHANGE SAFETY CHECKLIST

Before making any change, confirm:

- [ ] I have read the relevant section(s) of this document
- [ ] I know exactly which HTML element(s) I am adding/removing/modifying
- [ ] I know whether the element is admin-only and how it is gated
- [ ] If touching navigation: I have confirmed where the page is accessed from (sidebar vs. top bar) and am not moving it
- [ ] If adding a new button: I know what page it lives on and whether it injects into the DOM or is native HTML
- [ ] If touching a IIFE: I have checked for MutationObserver side effects
- [ ] If touching an edge function: I have updated `deploy-functions.sh` if needed and know which secrets are required
- [ ] I will describe what I am about to change and get confirmation before writing code if the intent is ambiguous

---

## 11. KNOWN ARCHITECTURAL CONSTRAINTS

1. **No `nav-users` in sidebar.** Users & Permissions is accessed via `#top-btn-users` in the top bar. Do not add it to the sidebar.
2. **`data-gl-perm` is unreliable for login-time visibility.** The permission scanner runs asynchronously and may not fire before the user sees the top bar. Use the explicit `if(u.role==='admin')` login check instead for anything that must appear immediately.
3. **`window.invoices` is the single source of truth.** Never reset or reassign it from a non-invoice context.
4. **JSZip must be pre-warmed.** `ensureJsZip()` is called at IIFE init time. Do not move it inside a click handler.
5. **Two-step delete uses `replaceChild`.** The original delete button is preserved as `_armed.orig` for restore. Do not replace the entire toolbar when the two-step state is armed.
6. **Chrome suppresses `confirm()`.** Never use `confirm()` for gating a user action. Use a custom two-step UI pattern instead (see the delete IIFE for reference).
7. **Re-inviting a removed user.** `invite-staff-user` edge function automatically purges the stale `auth.users` record if the profile shows `status = 'inactive'`. No manual SQL cleanup needed.
8. **Drag-drop kanban.** The HTML structure for the production runs kanban exists but JS drag logic is not yet implemented. Don't break the column structure.
