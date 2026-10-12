/*
 * click-every-button.test.cjs — click every visible control in the CRM, the
 * customer portal, the public site and the token pages, in a local harness
 * that cannot reach production.
 *
 * WHY THIS EXISTS
 * ---------------
 * smoke.test.cjs guards a handful of critical paths and full-sweep.cjs calls
 * the modal openers by name. Neither presses the buttons a person actually
 * sees, so a control whose handler throws, names an action nobody registered,
 * or opens a modal that cannot be closed again goes unnoticed until someone
 * reports it. This test finds every visible clickable on every page and
 * presses it, one at a time, from a fresh page state.
 *
 * NOTHING REACHES PRODUCTION
 * --------------------------
 *   - /supabase.min.js is replaced with a stub client (STUB_LIB below). Every
 *     query resolves against fixture rows generated from the column lists in
 *     supabase/migrations, so pages render real-looking content.
 *   - Every request to *.supabase.co (the token pages call PostgREST and edge
 *     functions with raw fetch) is answered by restRouter() below.
 *   - Every other non-local request is aborted. Chromium is also started with
 *     a host-resolver rule that resolves nothing but 127.0.0.1, so a request
 *     the router misses fails instead of leaving the machine.
 *   - Native confirm()/prompt() are DISMISSED, never accepted.
 *
 * WHAT IS RECORDED PER CLICK
 * --------------------------
 *   - uncaught page errors (pageerror) and console errors, classified with the
 *     same ALWAYS_APP_BUG rule smoke.test.cjs uses
 *   - "[gl-actions]" dead-control reports (data-gl-action with no handler)
 *   - whether an overlay opened and whether Escape or its close control
 *     closed it again
 *   - local links that 404
 *
 * RUN
 *   NODE_PATH=/tmp/pw/node_modules REPO_ROOT=$PWD node tests/click-every-button.test.cjs
 * Env:
 *   CLICK_VIEWPORTS=desktop,phone   which viewports (default both)
 *   CLICK_WORKERS=4                 parallel browser pages
 *   CLICK_DEPTH=2                   2 = also click the controls inside each
 *                                   overlay a page control opens (once per overlay)
 *   CLICK_ONLY=crm,portal,public,pages,features   restrict the suites
 *   CLICK_REPORT=path.json          write the full per-click log
 *
 * A failure that is not in KNOWN_FAILURES fails the run. Known failures are
 * real bugs that have been read in the source and are listed with their cause;
 * they print as KNOWN and do not fail the run, so this can gate CI while those
 * are fixed. Remove an entry when its bug is fixed — the run then reports it
 * as FIXED so the list cannot rot.
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = Number(process.env.CLICK_PORT || 8797);
const BASE = `http://127.0.0.1:${PORT}`;
const WORKERS = Math.max(1, Number(process.env.CLICK_WORKERS || 4));
const DEPTH = Number(process.env.CLICK_DEPTH || 2);
const ONLY = (process.env.CLICK_ONLY || 'crm,portal,public,pages,features').split(',').map(s => s.trim());
const VIEWPORTS = {
  desktop: { width: 1280, height: 900 },
  phone: { width: 390, height: 844 },
};
const WANT_VP = (process.env.CLICK_VIEWPORTS || 'desktop,phone').split(',').map(s => s.trim()).filter(v => VIEWPORTS[v]);

// ─────────────────────────────────────────────────────────────────────────────
// Error classification — identical to smoke.test.cjs / full-sweep.cjs.
// tests/test-integrity.test.cjs pins those two; keep this one the same.
// ─────────────────────────────────────────────────────────────────────────────
const ALWAYS_APP_BUG =
  /Maximum call stack|is not a function|is not defined|Cannot read propert|Cannot access |Cannot set propert|undefined is not|null is not|Unexpected token|Assignment to constant/i;
function isBackendNoise(msg) {
  if (ALWAYS_APP_BUG.test(msg)) return false;
  return /Failed to fetch|NetworkError|ERR_|net::|TUNNEL|WebSocket|jszip|supabase|Load failed|status of 4|status of 5|blocked by CORS|CORS policy|429|403|Access-Control/i.test(msg);
}

// ─────────────────────────────────────────────────────────────────────────────
// Known failures: real bugs, verified in the source. See the header.
// Each matcher is tested against "<suite> | <page> | <control> | <error>".
// ─────────────────────────────────────────────────────────────────────────────
const KNOWN_FAILURES = [
  { suite: 'features', match: /adjustInventory|Inventory: (\+10|−10)|rendered a missing value: "NaN (cans|trays)"/,
    why: 'crm-index-core.js:4961-4962 pass the delta as data-gl-arg2="10"/"-10"; the dispatcher hands it over as a STRING, and adjustInventory (crm-index-core.js:4969-4972) does item.qty + delta: 2400 + "10" = "240010" and 2400 + "-10" = "2400-10" -> Math.max gives NaN. "+" writes qty 240010, "−" writes NaN (null) to inventory.qty.' },
  { suite: 'features', match: /deleteClient|delete confirmation names the client|Permanently delete "\[object HTMLButtonElement\]"/,
    why: 'crm-index-core.js:905 renders the Delete button with data-gl-el, so the dispatcher passes the BUTTON as deleteClient(cid, cname)\'s second argument (crm-index-core.js:918); data-cname is never read. The prompt says Permanently delete "[object HTMLButtonElement]" and only typing that literal string deletes. Same function reassigns window.clients (line 954), which breaks the bridge to the core array.' },
  { suite: 'features', match: /invoice detail shows the \$0\.025 unit price/,
    why: 'crm-index-core.js:1516 — viewInvoice() formats Unit Price with maximumFractionDigits:2, so $0.025 shows as $0.03. #474 fixed the email, PDF, public link and quote PDF but not the in-CRM invoice detail.' },
  { suite: 'features', match: /Telegram-only send reports "✓ Sent" without "\(check secrets\)"/,
    why: 'src/modules/pipeline/attention.js:366 reads d.whatsappSent; attention-digest now returns telegramSent (supabase/functions/attention-digest/index.ts:199) since WhatsApp was removed (#486). A Telegram-only send says "(check secrets)".' },
  { suite: 'features', match: /Email activity marks the inbound reply as received/,
    why: 'src/services/email.js:390-404 — glOpenEmailActivity() ignores email_log.direction: an inbound reply renders as "→ <our address>" with a Sent/Delivered/Opened timeline, as if we sent it.' },
  { suite: 'features', match: /auto-login refuses an account with no staff profile/,
    why: 'src/shared/crm-extras.js:1844-1873 — autoLoginIfPossible() (the "remember this computer" path) defaults a missing profile to role "sales" and only refuses status "inactive". checkPw in auth.js fails closed; this path does not. Signup is open, so any self-registered account with gl_remember=1 gets the staff shell (RLS still refuses the data).' },
  { suite: 'features', match: /billing hides DRAFT invoices from the customer/,
    why: 'src/modules/customers/portal-customer.js:275 selects every invoice for the client with no status filter, and policy "invoices customer self" (20260518000004) allows it, so unsent draft invoices are listed in the customer portal with PDF/View. Needs a product decision; if drafts should be private, filter here AND in the policy.' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Static server
// ─────────────────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.xml': 'application/xml',
  '.txt': 'text/plain', '.pdf': 'application/pdf',
};
const notFound = new Set();
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
      if (p === '/' || p === '') p = '/index.html';
      let file = path.join(ROOT, path.normalize(p));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return; }
      // Vercel serves /foo for /foo.html (cleanUrls) and /dir/ for /dir/index.html.
      const tryFiles = [file, file + '.html', path.join(file, 'index.html')];
      const hit = tryFiles.find(f => { try { return fs.statSync(f).isFile(); } catch (e) { return false; } });
      if (!hit) { notFound.add(p); res.writeHead(404); res.end('not found'); return; }
      fs.readFile(hit, (err, buf) => {
        if (err) { res.writeHead(500); res.end('err'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(hit)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(PORT, '127.0.0.1', () => resolve(srv));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures: generated from the migrations' column lists, then overridden with
// hand-written rows for the tables whose shape the UI depends on.
// ─────────────────────────────────────────────────────────────────────────────
function readSchema() {
  const dir = path.join(ROOT, 'supabase', 'migrations');
  const S = {};
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/--[^\n]*/g, '');
    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_0-9]+)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
    let m;
    while ((m = re.exec(sql))) {
      const t = m[1].toLowerCase(); S[t] = S[t] || {};
      for (const line of m[2].split('\n')) {
        const mm = /^\s*"?([a-z_0-9]+)"?\s+([a-z]+(?:\s+precision)?(?:\[\])?)/i.exec(line);
        if (!mm) continue;
        const c = mm[1].toLowerCase();
        if (/^(constraint|primary|unique|check|foreign|exclude)$/.test(c)) continue;
        S[t][c] = mm[2].toLowerCase();
      }
    }
    const re2 = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?([a-z_0-9]+)"?([\s\S]*?);/gi;
    while ((m = re2.exec(sql))) {
      const t = m[1].toLowerCase();
      const re3 = /add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_0-9]+)"?\s+([a-z]+(?:\[\])?)/gi;
      let a;
      while ((a = re3.exec(m[2]))) { S[t] = S[t] || {}; S[t][a[1].toLowerCase()] = a[2].toLowerCase(); }
    }
  }
  return S;
}

const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const IDS = {
  admin: uuid(1), sales: uuid(2), customer: uuid(3), stranger: uuid(4),
  c1: uuid(101), c2: uuid(102), c3: uuid(103),
  d1: uuid(201), d2: uuid(202), d3: uuid(203), d4: uuid(204), d5: uuid(205),
  q1: uuid(301), q2: uuid(302),
  proj1: uuid(401),
  agr1: uuid(501),
  cu1: uuid(601),
};
const CLIENTS = [IDS.c1, IDS.c2, IDS.c3];
const CLIENT_NAMES = ['Acme Sparkling Co', 'Brightwater Teas', 'Citrus Grove Beverage'];
const CLIENT_EMAILS = ['ann@acme-sparkling.test', 'ben@brightwater.test', 'cara@citrusgrove.test'];
const DAY = 86400000;
const iso = (dd) => new Date(Date.now() + dd * DAY).toISOString();
const ymd = (dd) => iso(dd).slice(0, 10);

function genValue(table, col, type, i, seq) {
  const t = String(type || 'text');
  if (col === 'id') return /int|serial/.test(t) ? seq : uuid(9000 + seq);
  if (col === 'client_id') return CLIENTS[i % 3];
  if (col === 'deal_id') return [IDS.d1, IDS.d2, IDS.d3][i % 3];
  if (col === 'project_id') return IDS.proj1;
  if (/^(user_id|created_by|uploaded_by|assigned_to|owner_id|sent_by|completed_by|resolved_by|invited_by|auth_user_id|actor_id)$/.test(col)) return t === 'uuid' ? IDS.admin : 'Test Admin';
  if (/_id$/.test(col)) return t === 'uuid' ? uuid(8000 + seq) : (/int/.test(t) ? seq : 'ref-' + seq);
  if (/email/.test(col)) return /emails$/.test(col) ? [] : CLIENT_EMAILS[i % 3];
  if (t === 'boolean') return /^(active|is_active|enabled|in_daily|default_on)$/.test(col);
  if (/\[\]$/.test(t)) return [];
  if (t === 'jsonb' || t === 'json') return /(items|lines|tiers|addons|inclusions|fields|answers_list|steps|rows|entries|checklist|ingredients|allergens|tags|services|materials|photos|attachments|history|events|log)$/.test(col) ? [] : {};
  if (t === 'date') return ymd(i * 3 - 2);
  if (/timestamp/.test(t)) return iso(-(i + 1));
  if (/time/.test(t)) return '09:' + String(i * 15).padStart(2, '0');
  if (/int|numeric|real|double|decimal|serial|money/.test(t)) {
    if (/pct|percent|rate|prob/.test(col)) return 10;
    return 100 * (i + 1);
  }
  if (col === 'status') return 'open';
  if (col === 'client_name' || col === 'company' || col === 'brand_name') return CLIENT_NAMES[i % 3];
  if (/(^|_)name$/.test(col)) return ['Ann Avery', 'Ben Brooks', 'Cara Cole'][i % 3];
  if (/phone/.test(col)) return '555-010' + i;
  if (/^(title|subject|label|run_name|product|product_name)$/.test(col)) return `${table.replace(/_/g, ' ')} ${i + 1}`;
  if (/url|path/.test(col)) return `${table}/${i + 1}/file.pdf`;
  if (/color/.test(col)) return '#1a6fff';
  if (/token/.test(col)) return 'tok' + 'a'.repeat(40) + seq;
  return `${col.replace(/_/g, ' ')} ${i + 1}`;
}

function buildFixtures() {
  const S = readSchema();
  const F = {};
  let seq = 1;
  for (const [table, cols] of Object.entries(S)) {
    F[table] = [0, 1, 2].map(i => {
      const row = {};
      for (const [c, t] of Object.entries(cols)) row[c] = genValue(table, c, t, i, seq);
      seq++;
      return row;
    });
  }
  const now = iso(0);
  F.profiles = [
    { id: IDS.admin, email: 'staff@test.local', name: 'Test Admin', role: 'admin', status: 'active', is_super_user: true, initials: 'TA', color: '#1a6fff', tc: '#fff', notify_daily_digest: true },
    { id: IDS.sales, email: 'sales@test.local', name: 'Sam Sales', role: 'sales', status: 'active', is_super_user: false, initials: 'SS', color: '#0F6E56', tc: '#fff' },
  ];
  F.clients = CLIENTS.map((id, i) => ({
    id, name: CLIENT_NAMES[i], legal_name: CLIENT_NAMES[i] + ' LLC', email: CLIENT_EMAILS[i], phone: '803555010' + i,
    contact_name: ['Ann Avery', 'Ben Brooks', 'Cara Cole'][i], contact_type: 'Owner', additional_emails: [],
    street: '1 Main St', city: 'Palmetto', state: 'FL', zip: '34221', service: 'Co-pack', status: ['active', 'active', 'lead'][i],
    payment_terms: 'Net 30', notes: 'Fixture client ' + (i + 1), initials: CLIENT_NAMES[i].slice(0, 2).toUpperCase(),
    color: '#1a3a6e', tc: '#9FE1CB', total_billed: 12000 * (i + 1), created_at: iso(-30 * (i + 1)), product_types: ['Sparkling water'], comm_prefs: ['email'],
  }));
  F.invoices = [
    ['GL-1041', 0, 'draft', 2400, 0, 10], ['GL-1042', 0, 'pending', 5280, 0, 20], ['GL-1043', 1, 'paid', 1800, 1800, -40],
    ['GL-1044', 1, 'overdue', 3600, 0, -12], ['GL-1045', 2, 'partial', 9000, 4000, 5],
  ].map(([num, ci, status, amount, paid, due], k) => ({
    id: uuid(700 + k), invoice_number: num, client_id: CLIENTS[ci], client_name: CLIENT_NAMES[ci], service: 'Canning',
    amount, paid_amount: paid, status, invoice_date: ymd(-20 + k), due_date: ymd(due), payment_terms: 'Net 30',
    notes: '', share_token: 'share' + 'b'.repeat(30) + k, created_at: iso(-20 + k),
    line_items: [{ desc: '12oz Standard canning (24-count case)', qty: 200, unit: 'case', unitPrice: 12, total: 2400 }, { desc: 'Pasteurization', qty: 4800, unit: 'can', unitPrice: 0.025, total: 120 }],
  }));
  F.invoice_payments = [{ id: uuid(750), invoice_number: 'GL-1045', amount: 4000, method: 'check', paid_at: iso(-3), reference: '1001', provider: 'manual', event_kind: 'payment' }];
  const stages = ['Prospecting', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost'];
  F.deals = [IDS.d1, IDS.d2, IDS.d3, IDS.d4, IDS.d5].map((id, i) => ({
    id, name: CLIENT_NAMES[i % 3] + ' — Quote Request', client_name: CLIENT_NAMES[i % 3], stage: stages[i], value: 15000 * (i + 1), probability: 20 + 15 * i,
    contact_name: ['Ann Avery', 'Ben Brooks', 'Cara Cole'][i % 3], email: CLIENT_EMAILS[i % 3], phone: '8035550100', city: 'Tampa', state: 'FL',
    service: 'Canning', product_type: 'Sparkling water', volume: '500 cases', timeline: '1-3 months', notes: 'Fixture deal ' + (i + 1),
    created_at: iso(-14 - i), stage_entered_at: iso(-12 - i), lead_source: 'Website',
  }));
  F.referrers = [{ id: uuid(801), name: 'Rita Referrer', email: 'rita@ref.test', phone: '555', relationship: 'Broker', default_rate: 5, initials: 'RR' }];
  F.referrals = [{ id: uuid(811), referrer_id: uuid(801), client_name: CLIENT_NAMES[0], deal_value: 20000, commission_rate: 5, commission_amount: 1000, status: 'won', created_at: iso(-9) }];
  // Shape taken from what the quote builder itself saves.
  const QPKG = { nitrogenOn: true, nitrogenPerCan: 0.03, pasteurOn: false, pasteurPerCan: 0.05, tray24On: true, tray24PerCase: 0.5, tray12On: false, tray12PerCase: 0.5, trayWrapOn: false, trayWrapPerCase: 0, paktech4On: false, paktech4PerCan: 0, paktech6On: false, paktech6PerCan: 0, proper4On: false, proper4PerCan: 0, proper6On: false, proper6PerCan: 0, canBlankOn: false, canBlankPerCan: 0, canShrinkOn: false, canShrinkPerCan: 0, canPrintedOn: false, canPrintedPerCan: 0, palletOn: true, palletEach: 12, palletWrapOn: true, palletWrapEach: 8, casesPerPallet: 80, changeOverOn: false, changeOverFee: 100 };
  const qtier = (cases) => ({ cases, cans: cases * 24, fillPerCan: 0.43, nitrogenPerCan: 0.03, trayPerCan: 0.03 });
  const qrow = (id, num, cid, did, status, cases, daysAgo) => ({
    id, client_id: cid, deal_id: did, quote_number: num, quote_date: ymd(-daysAgo), valid_days: 30, product_type: 'canning', package_format: '12oz Standard',
    status, sent_at: status === 'sent' ? iso(-daysAgo) : null, sent_to: status === 'sent' ? CLIENT_EMAILS[0] : null,
    tiers: [qtier(cases)], addons: [{ id: '__pkg__', pkg: QPKG }], inclusions: [], services: [], notes: '', custom_lines: [],
    sections: [{ productType: 'canning', format: '12oz Standard', tiers: [qtier(cases)], pkg: QPKG, bpkg: {}, lines: [] }],
    client_name: cid ? CLIENT_NAMES[0] : 'Walk-in Brand', client_email: cid ? CLIENT_EMAILS[0] : 'walkin@brand.test', pdf_html: '<p>Quote ' + num + '</p>', created_at: iso(-daysAgo),
  });
  F.quotes = [qrow(IDS.q1, 'Q-1001', IDS.c1, IDS.d1, 'sent', 500, 4), qrow(IDS.q2, 'Q-1002', null, null, 'draft', 200, 1)];
  F.email_log = [
    { id: uuid(901), to_email: CLIENT_EMAILS[0], from_email: 'mike@goodliquid.test', direction: 'outbound', subject: 'Your quote Q-1001', body_preview: 'Hi Ann, attached is your quote.', status: 'delivered', sent_at: iso(-4), delivered_at: iso(-4), created_at: iso(-4), client_id: IDS.c1, invoice_number: null, open_count: 1, click_count: 0, first_opened_at: iso(-3) },
    { id: uuid(902), to_email: 'mike@goodliquid.test', from_email: CLIENT_EMAILS[0], direction: 'inbound', subject: 'Re: Your quote Q-1001', body_preview: 'Thanks Mike, looks good. Can we start in May?', status: 'received', sent_at: iso(-2), created_at: iso(-2), client_id: IDS.c1, invoice_number: null, open_count: 0, click_count: 0 },
    { id: uuid(903), to_email: CLIENT_EMAILS[1], from_email: 'mike@goodliquid.test', direction: 'outbound', subject: 'Invoice GL-1044', body_preview: 'Invoice attached.', status: 'sent', sent_at: iso(-10), created_at: iso(-10), client_id: IDS.c2, invoice_number: 'GL-1044', open_count: 0, click_count: 0 },
  ];
  F.customer_users = [{ id: IDS.cu1, auth_user_id: IDS.customer, client_id: IDS.c1, email: CLIENT_EMAILS[0], display_name: 'Ann Avery', active: true, role: 'owner', notify_run_stage_changes: true, notify_project_updates: true, invited_at: iso(-20), last_login: iso(-1), created_at: iso(-20) }];
  F.customer_requests = [
    { id: uuid(951), client_id: IDS.c1, submitted_by: IDS.customer, kind: 'sample', subject: 'Samples please', body: 'Two cases of the lemon SKU.', status: 'open', created_at: iso(-1) },
    { id: uuid(952), client_id: IDS.c2, submitted_by: uuid(9), kind: 'question', subject: 'Lead time?', body: 'How long for 500 cases?', status: 'resolved', resolved_at: iso(-1), resolution_notes: 'Answered by phone', created_at: iso(-5) },
  ];
  F.canning_rates = [
    { id: 1, format: '12oz-standard', format_label: '12oz Standard', min_cases: 0, price_per_can: 0.5 },
    { id: 2, format: '12oz-standard', format_label: '12oz Standard', min_cases: 500, price_per_can: 0.45 },
    { id: 3, format: '12oz-sleek', format_label: '12oz Sleek', min_cases: 0, price_per_can: 0.55 },
  ];
  F.bottling_rates = [{ id: 1, format: '750ml', format_label: '750ml Bottle', min_units: 0, price_per_unit: 1.1 }];
  F.projects = [{ id: IDS.proj1, client_id: IDS.c1, name: 'Lemon Sparkling launch', product_name: 'Lemon Sparkling', status: 'active', project_manager: 'Test Admin', started_on: ymd(-30), target_date: ymd(30), created_at: iso(-30), archived_at: null }];
  F.agreements = [{ id: IDS.agr1, kind: 'nda', title: 'Mutual NDA — Acme Sparkling Co', client_id: IDS.c1, deal_id: null, party_name: CLIENT_NAMES[0], body: '# Mutual NDA\n\nTerms.', fields: {}, status: 'draft', created_by: IDS.admin, created_by_name: 'Test Admin', created_at: iso(-2), updated_at: iso(-2) }];
  F.agreement_signers = [];
  F.agreement_templates = [
    { kind: 'nda', title: 'Mutual NDA', body: [
      '# Mutual Non-Disclosure Agreement', 'Between {{gl_legal_name}} and {{client_legal_name}}, effective {{effective_date}}.',
      '## 1. Confidential information', 'Each party keeps the other party\'s information confidential.', '[[SIGNATURES]]'].join('\n\n') },
    { kind: 'manufacturing', title: 'Contract Manufacturing Agreement', body: [
      '# Contract Manufacturing Agreement', 'Between {{gl_legal_name}} and {{client_legal_name}} for {{term_years}} years from {{effective_date}}.', '[[SIGNATURES]]'].join('\n\n') },
  ];
  F.gmp_documents = [
    { id: uuid(1501), doc_code: 'GMP-SOP-SUP', title: 'GMP SOP Supplement', category: 'sop', description: 'Supplementary GMP SOPs.', file_url: '/docs/GMP-SOP-Supplement.docx', file_type: 'docx', rev: 'A', active: true, sort_order: 1 },
    { id: uuid(1502), doc_code: 'GMP-REG', title: 'GMP Registers', category: 'register', description: 'Blank register workbook.', file_url: '/docs/GMP-Registers.xlsx', file_type: 'xlsx', rev: 'A', active: true, sort_order: 2 },
  ];
  F.cal_events = [
    { id: uuid(1601), event_type: 'meeting', title: 'Acme kickoff call', event_date: ymd(1), event_time: '14:30', notes: 'Zoom', remind: '1d', client_id: IDS.c1, created_at: iso(-2) },
    { id: uuid(1602), event_type: 'production', title: 'Lemon Sparkling run', event_date: ymd(3), event_time: '08:00', notes: '', client_id: IDS.c1, format: '12oz Standard', qty: '400', due_date: ymd(10), prod_status: 'scheduled', created_at: iso(-2) },
    { id: uuid(1603), event_type: 'tour', title: 'Facility tour — Visit Co', event_date: ymd(5), event_time: '', notes: 'All-day hold', created_at: iso(-1) },
  ];
  F.inventory = [
    { id: uuid(1701), name: '12oz Standard cans', qty: 2400, unit: 'cans', low_at: 1000, created_at: iso(-9) },
    { id: uuid(1702), name: '24-count case trays', qty: 120, unit: 'trays', low_at: 150, created_at: iso(-9) },
  ];
  F.app_settings = [];
  F.user_permissions = [];
  F.permission_components = [];
  F.notifications = [];
  F.error_log = [];
  F.attention_snoozes = [];
  return F;
}

// ─────────────────────────────────────────────────────────────────────────────
// The stub supabase-js. Runs in the page. Served in place of /supabase.min.js.
// ─────────────────────────────────────────────────────────────────────────────
function STUB_LIB(FIX, CFG) {
  /* eslint-disable */
  var calls = window.__stubCalls = [];
  var cfg = window.__STUB_CFG = CFG || {};
  var IDS = cfg.ids;
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function user(kind) {
    if (kind === 'staff') return { id: IDS.admin, email: 'staff@test.local' };
    if (kind === 'customer') return { id: IDS.customer, email: 'ann@acme-sparkling.test' };
    if (kind === 'stranger') return { id: IDS.stranger, email: 'stranger@test.local' };
    return null;
  }
  var session = cfg.session ? { access_token: 'stub-access-token', refresh_token: 'stub', user: user(cfg.session), expires_at: Math.floor(Date.now() / 1000) + 3600 } : null;
  var listeners = [];
  function emit(ev) { listeners.slice().forEach(function (cb) { try { cb(ev, session); } catch (e) { setTimeout(function () { throw e; }); } }); }
  var RPC = {
    gl_next_invoice_number: 'GL-1050', gl_next_quote_number: 'Q-1050',
    gl_record_manual_payment: { ok: true }, gl_reverse_one_payment: { ok: true }, gl_reverse_invoice_payments: { ok: true },
    gl_portal_formula_status: [], gl_portal_formula_documents: [], gl_portal_entitlements: [], gl_portal_artwork: [],
    portal_touch_my_last_login: null, gl_cron_health: [], link_customer_user_by_email: { ok: true },
    submit_quote_request: '11111111-1111-4111-8111-111111111111',
    gl_onboarding_create: { ok: true, id: 'ob1', token: 'abcdef0123456789abcdef0123456789abcdef01' },
    update_customer_account: { ok: true }, portal_update_my_notify: { ok: true }, portal_update_my_notify_project: { ok: true },
    portal_invite_teammate: { ok: true }, portal_remove_teammate: { ok: true },
  };
  var FN = {
    'attention-digest': { items: 3, counts: { 'your-move': 1, overdue: 1, cold: 1, new: 0 }, telegramSent: true, emailSent: false },
    'ai-proxy': { ok: true, text: 'Subject: Hello\n\nA drafted message.', content: [{ type: 'text', text: 'A drafted message.' }] },
    'agreement-sign': { ok: true, sent_to: 'ann@acme-sparkling.test', signers: [] },
    'gmail-sync': { ok: true, inserted: 0, skipped: 0 },
  };
  function matchFilters(rows, filters) {
    return rows.filter(function (r) {
      return filters.every(function (f) {
        if (!(f.col in r)) return true;
        var v = r[f.col];
        if (f.op === 'eq') return String(v) === String(f.val);
        if (f.op === 'neq') return String(v) !== String(f.val);
        if (f.op === 'in') return (f.val || []).map(String).indexOf(String(v)) >= 0;
        if (f.op === 'is') return f.val === null ? v == null : v === f.val;
        return true;
      });
    });
  }
  function builder(table, isRpc, rpcData) {
    var st = { table: table, op: 'select', filters: [], payload: null, single: null, head: false, count: null, wantRows: false };
    var b = {};
    var passthru = ['gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'or', 'and', 'not', 'order', 'limit', 'range', 'match', 'filter', 'textSearch', 'overlaps', 'contains', 'containedBy', 'returns', 'abortSignal', 'onConflict', 'csv', 'throwOnError', 'explain', 'rangeGt', 'rangeLt', 'likeAllOf', 'ilikeAnyOf'];
    passthru.forEach(function (m) { b[m] = function () { return b; }; });
    b.select = function (cols, opts) { if (st.op === 'select') { opts = opts || {}; st.head = !!opts.head; st.count = opts.count || null; } else st.wantRows = true; return b; };
    b.insert = function (p) { st.op = 'insert'; st.payload = p; return b; };
    b.upsert = function (p) { st.op = 'upsert'; st.payload = p; return b; };
    b.update = function (p) { st.op = 'update'; st.payload = p; return b; };
    b.delete = function () { st.op = 'delete'; return b; };
    b.eq = function (c, v) { st.filters.push({ op: 'eq', col: c, val: v }); return b; };
    b.neq = function (c, v) { st.filters.push({ op: 'neq', col: c, val: v }); return b; };
    b.in = function (c, v) { st.filters.push({ op: 'in', col: c, val: v }); return b; };
    b.is = function (c, v) { st.filters.push({ op: 'is', col: c, val: v }); return b; };
    b.single = function () { st.single = 'single'; return b; };
    b.maybeSingle = function () { st.single = 'maybe'; return b; };
    function result() {
      if (isRpc) {
        calls.push({ kind: 'rpc', name: table });
        var fail = cfg.failRpc && cfg.failRpc[table];
        if (fail) return { data: null, error: fail };
        return { data: rpcData === undefined ? null : clone(rpcData), error: null };
      }
      calls.push({ kind: st.op, table: table, filters: st.filters.length, payload: st.op === 'select' ? undefined : clone(st.payload == null ? null : st.payload) });
      if (cfg.failWrites && st.op !== 'select') return { data: null, error: { message: 'stub: write refused', code: '42501' } };
      // An in-memory table for the life of the page: inserts persist, updates
      // and deletes change the stored rows, so a save-then-edit round trip
      // behaves the way it does against PostgREST.
      var store = FIX[table] || (FIX[table] = []);
      var data;
      if (st.op === 'select') {
        data = clone(matchFilters(store, st.filters));
      } else if (st.op === 'insert' || st.op === 'upsert') {
        var rows = Array.isArray(st.payload) ? st.payload : [st.payload];
        data = rows.map(function (r, i) { return Object.assign({ id: (r && r.id) || ('00000000-0000-4000-9000-' + String((Date.now() + i) % 1e12).padStart(12, '0')), created_at: new Date().toISOString() }, clone(r)); });
        data.forEach(function (r) {
          var at = store.findIndex(function (x) { return x.id === r.id; });
          if (at >= 0) store[at] = Object.assign(store[at], r); else store.push(r);
        });
        data = clone(data);
      } else {
        var hit = matchFilters(store, st.filters);
        if (st.op === 'update') hit.forEach(function (r) { Object.assign(r, clone(st.payload)); });
        else FIX[table] = store.filter(function (r) { return hit.indexOf(r) < 0; });
        data = clone(hit);
      }
      var count = Array.isArray(data) ? data.length : null;
      if (st.single) {
        if (!data.length && st.single === 'single') return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }, count: 0 };
        return { data: data[0] || null, error: null, count: count };
      }
      if (st.op !== 'select' && !st.wantRows) return { data: null, error: null, count: count, status: 204 };
      if (st.head) return { data: null, error: null, count: count };
      return { data: data, error: null, count: count, status: 200 };
    }
    b.then = function (res, rej) { return Promise.resolve().then(result).then(res, rej); };
    b.catch = function (f) { return b.then(null, f); };
    b.finally = function (f) { return b.then(function (v) { f(); return v; }, function (e) { f(); throw e; }); };
    return b;
  }
  function storageBucket(name) {
    var ok = function (d) { calls.push({ kind: 'storage', bucket: name }); return Promise.resolve({ data: d, error: null }); };
    return {
      upload: function (p) { return ok({ path: p }); }, remove: function () { return ok([]); }, list: function () { return ok([]); },
      download: function () { return ok(new Blob(['stub'])); },
      createSignedUrl: function () { return ok({ signedUrl: '/__stub_signed_url' }); },
      createSignedUrls: function (ps) { return ok((ps || []).map(function () { return { signedUrl: '/__stub_signed_url' }; })); },
      getPublicUrl: function (p) { return { data: { publicUrl: '/__stub_public/' + p } }; },
    };
  }
  function channel() {
    var ch = { on: function () { return ch; }, subscribe: function () { return ch; }, unsubscribe: function () { return Promise.resolve('ok'); }, send: function () { return Promise.resolve('ok'); } };
    return ch;
  }
  function createClient() {
    return {
      from: function (t) { return builder(t, false); },
      rpc: function (name) { return builder(name, true, Object.prototype.hasOwnProperty.call(RPC, name) ? RPC[name] : null); },
      functions: {
        invoke: function (name, opts) {
          calls.push({ kind: 'invoke', name: name, body: opts && opts.body });
          if (cfg.failFn && cfg.failFn[name]) return Promise.resolve({ data: null, error: { message: cfg.failFn[name] } });
          return Promise.resolve({ data: clone(FN[name] || { ok: true }), error: null });
        },
      },
      auth: {
        getSession: function () { return Promise.resolve({ data: { session: session }, error: null }); },
        getUser: function () { return Promise.resolve({ data: { user: session && session.user }, error: null }); },
        refreshSession: function () { return Promise.resolve({ data: { session: session }, error: null }); },
        signInWithPassword: function (o) {
          calls.push({ kind: 'auth', name: 'signInWithPassword' });
          var kind = cfg.loginAs || 'staff';
          session = { access_token: 'stub-access-token', user: user(kind) };
          setTimeout(function () { emit('SIGNED_IN'); }, 0);
          return Promise.resolve({ data: { user: session.user, session: session }, error: null });
        },
        signOut: function () { session = null; setTimeout(function () { emit('SIGNED_OUT'); }, 0); return Promise.resolve({ error: null }); },
        onAuthStateChange: function (cb) { listeners.push(cb); return { data: { subscription: { unsubscribe: function () { listeners = listeners.filter(function (x) { return x !== cb; }); } } } }; },
        resetPasswordForEmail: function () { calls.push({ kind: 'auth', name: 'resetPasswordForEmail' }); return Promise.resolve({ data: {}, error: null }); },
        signUp: function () { calls.push({ kind: 'auth', name: 'signUp' }); return Promise.resolve({ data: { user: { id: '00000000-0000-4000-8000-000000009999' } }, error: null }); },
        updateUser: function () { calls.push({ kind: 'auth', name: 'updateUser' }); return Promise.resolve({ data: { user: session && session.user }, error: null }); },
        exchangeCodeForSession: function () { return Promise.resolve({ data: { session: session }, error: null }); },
        mfa: {
          listFactors: function () { return Promise.resolve({ data: { all: [], totp: [] }, error: null }); },
          getAuthenticatorAssuranceLevel: function () { return Promise.resolve({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }); },
          enroll: function () { return Promise.resolve({ data: { id: 'f1', totp: { qr_code: '', secret: 'X', uri: '' } }, error: null }); },
          challenge: function () { return Promise.resolve({ data: { id: 'ch1' }, error: null }); },
          verify: function () { return Promise.resolve({ data: {}, error: null }); },
          unenroll: function () { return Promise.resolve({ data: {}, error: null }); },
        },
      },
      storage: { from: storageBucket },
      channel: channel, removeChannel: function () { return Promise.resolve('ok'); }, removeAllChannels: function () { return Promise.resolve([]); }, getChannels: function () { return []; },
    };
  }
  window.supabase = { createClient: createClient };
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw-fetch REST/edge router for *.supabase.co (token pages, invite, etc.)
// ─────────────────────────────────────────────────────────────────────────────
const SIGN_TOKEN = 'S'.repeat(48);
const AUDITOR_TOKEN = 'validtoken0123456789abcdef0123456789abcd';
function restRouter(url, method, cfg) {
  const u = new URL(url);
  const p = u.pathname;
  const json = (body, status) => ({ status: status || 200, body: JSON.stringify(body) });
  const fail = cfg.restFail || {};
  // Edge functions
  let m = /^\/functions\/v1\/([a-z0-9-]+)/.exec(p);
  if (m) {
    const fn = m[1];
    if (fail[fn]) return json(fail[fn].body, fail[fn].status);
    if (fn === 'agreement-sign') {
      return json({ ok: true, title: 'Mutual NDA', parties: { good_liquid: 'Good Liquid Bev Co', company: 'Acme Sparkling Co' }, signer: { name: 'Ann Avery', email: 'ann@acme-sparkling.test' }, consent_text: 'I agree to sign electronically.', body: '# Mutual NDA\n\n## 1. Terms\n\nBoth parties agree.', complete: false });
    }
    if (fn === 'booking-approve') return json({ ok: true, booking: { date: 'Mon, Oct 13', time: '10:00 AM', tz: 'ET', name: 'Pat Visitor', company: 'Visit Co', email: 'pat@visit.test', notes: 'Tour' }, message: 'Done.' });
    if (fn === 'booking-availability') return json({ ok: true, slots: [{ time: '09:00', available: true }, { time: '10:00', available: true }, { time: '11:00', available: false }] });
    if (fn === 'booking-confirm') return json({ ok: true });
    if (fn === 'onboarding-set-password') return json({ ok: true, email: 'ann@acme-sparkling.test' });
    if (fn === 'invite-staff-user') return json({ ok: true, userId: uuid(77) });
    return json({ ok: true });
  }
  m = /^\/rest\/v1\/rpc\/([a-z0-9_]+)/.exec(p);
  if (m) {
    const fn = m[1];
    if (fail[fn]) return json(fail[fn].body, fail[fn].status);
    if (fn === 'gl_onboarding_get') return json({ ok: true, submitted: false, client_name: 'Acme Sparkling Co', email: 'ann@acme-sparkling.test', prefill: { contact_name: 'Ann Avery', phone: '8035550100', city: 'Palmetto', state: 'FL' } });
    if (fn === 'gl_onboarding_intake_get') return json({ answers: {} });
    if (fn === 'gl_onboarding_submit') return json({ ok: true });
    if (fn === 'get_page_blocked_slots') return json([]);
    return json({ ok: true });
  }
  m = /^\/rest\/v1\/([a-z0-9_]+)/.exec(p);
  if (m) {
    const t = m[1];
    if (method !== 'GET') return json([]);
    if (t === 'booking_pages') return json([{ id: uuid(1201), slug: 'tour', title: 'Facility Tour', description: 'See the line.', duration: 60, timezone: 'America/New_York', avail_days: [1, 2, 3, 4, 5], start_time: '09:00', end_time: '16:00', buffer_after: 0, is_active: true }]);
    if (t === 'inspector_tokens') {
      const tok = decodeURIComponent((/token=eq\.([^&]+)/.exec(u.search) || [])[1] || '');
      return json(tok === AUDITOR_TOKEN ? [{ inspector: 'Jane Auditor', agency: 'SQF', purpose: 'Annual audit', valid_until: iso(3), revoked_at: null }] : []);
    }
    if (t === 'gmp_templates') return json([{ form_code: 'GMP-PREOP-001', title: 'Pre-Op Sanitation', category: 'sanitation' }]);
    if (t === 'gmp_documents') return json([{ doc_code: 'GMP-SOP', title: 'GMP SOP', category: 'sop', description: 'SOP', file_url: '/docs/GMP-SOP-Supplement.docx', file_type: 'docx', rev: 'A' }]);
    if (t === 'compliance_records') return json([{ form_code: 'GMP-PREOP-001', record_date: ymd(-1), status: 'signed', has_deviation: true, signature_name: 'Op A', deviation_notes: 'Swab', corrective_action: 'Recleaned', data: { line: 'Line 1', result: 'fail' } }]);
    if (t === 'vendors') return json([{ name: 'Crown Closures', category: 'packaging', approval_status: 'approved', food_safety_cert: 'SQF', cert_expires: ymd(90), risk_level: 'low', materials: 'Can ends' }]);
    if (t === 'defects') return json([{ reported_at: ymd(-3), run_ref: 'B-1', category: 'seam', severity: 'high', status: 'open', owner: 'Op A', description: 'Seam', ncr_number: 'NCR-1' }]);
    return json([]);
  }
  if (/^\/auth\/v1\//.test(p)) return json({ error: 'stub auth' }, 400);
  if (/^\/storage\/v1\//.test(p)) return json({});
  return json({}, 404);
}


// ─────────────────────────────────────────────────────────────────────────────
// In-page helper: overlay detection, control enumeration, mutation counter.
// ─────────────────────────────────────────────────────────────────────────────
function CT_HELPER() {
  var ct = window.__ct = { mut: 0, layerSeq: 0 };
  function startObs() {
    try { new MutationObserver(function (ms) { ct.mut += ms.length; }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true }); }
    catch (e) { setTimeout(startObs, 20); }
  }
  startObs();
  ct.isVis = function (el) {
    if (!el || !el.isConnected) return false;
    var cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    return !!(el.offsetParent || cs.position === 'fixed' || el.tagName === 'BODY');
  };
  // An overlay = a visible, fixed/absolute element covering >= 25% of the viewport.
  ct.layers = function () {
    var cands = new Set();
    Array.prototype.forEach.call(document.body.children, function (e) { cands.add(e); });
    var panel = document.getElementById('crm-panel');
    if (panel) Array.prototype.forEach.call(panel.children, function (e) { cands.add(e); });
    document.querySelectorAll('.modal-ov, [id$="-modal"], [id$="-overlay"], [id$="-ov"], [id*="detail"], [id*="builder"], [id*="drawer"], [role="dialog"]').forEach(function (e) { cands.add(e); });
    var vw = innerWidth, vh = innerHeight, out = [];
    cands.forEach(function (el) {
      if (el.id === 'crm-panel' || el.id === 'customer-portal' || el.id === 'gl-cp') return;
      var cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') return;
      if (!ct.isVis(el)) return;
      var r = el.getBoundingClientRect();
      var w = Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)), h = Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
      if (w * h < 0.25 * vw * vh) return;
      if (!el.dataset.ctLayer) el.dataset.ctLayer = 'L' + (++ct.layerSeq);
      out.push(el);
    });
    return out;
  };
  ct.layerInfo = function (el) {
    var h = el.querySelector('h1,h2,h3,.cpt,[class*="title"]');
    var t = ((h && h.innerText) || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50);
    return { tag: el.dataset.ctLayer, id: el.id || '', title: t, key: el.id || t.slice(0, 30) };
  };
  ct.layerKeys = function () { return ct.layers().map(function (l) { return l.dataset.ctLayer; }); };
  ct.labelOf = function (el) {
    var t = el.getAttribute('aria-label') || el.getAttribute('title') || (el.innerText || el.textContent || '').trim() || el.value || el.name || el.id || '';
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio')) {
      var lab = el.closest('label') || (el.id && document.querySelector('label[for="' + el.id + '"]'));
      t = 'checkbox: ' + ((lab && lab.innerText.trim()) || el.id || el.name || '');
    }
    return String(t).replace(/\s+/g, ' ').slice(0, 60);
  };
  var SEL = 'button, [data-gl-action], a[href], [role="button"], [role="tab"], [onclick], input[type="checkbox"], input[type="radio"], summary, .pill, .tab, [class*="tab-btn"]';
  function sigOf(el) {
    var action = el.getAttribute('data-gl-action') || '';
    var args = [1, 2, 3].map(function (j) { return el.getAttribute('data-gl-arg' + j) || ''; }).join(',');
    return [el.tagName, action, args, (el.getAttribute('onclick') || '').slice(0, 50), el.tagName === 'A' ? (el.getAttribute('href') || '') : '', el.id || '', ct.labelOf(el)].join('|');
  }
  function eligible(el) {
    if (!ct.isVis(el) || el.disabled) return false;
    var on = el.getAttribute('data-gl-on');
    var isBox = el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio');
    if (on && on !== 'click' && on !== 'change' && !isBox) return false;
    if (el.tagName === 'INPUT' && !isBox) return false;
    if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return false;
    return true;
  }
  ct.sigOf = sigOf;
  // Candidates: anything that looks clickable by markup, plus the topmost
  // element of any cursor:pointer region (rows, cards and day cells wired with
  // addEventListener carry no attribute to find them by).
  function candidates(scope) {
    var out = [], all = scope.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el.matches(SEL)) { out.push(el); continue; }
      if (el.closest('svg') || el.tagName === 'OPTION') continue;
      var cs = getComputedStyle(el);
      if (cs.cursor !== 'pointer') continue;
      var p = el.parentElement;
      if (p && getComputedStyle(p).cursor === 'pointer') continue;
      if (el.closest(SEL)) continue;
      out.push(el);
    }
    return out;
  }
  ct.controls = function (scope) {
    if (!scope) return [];
    var seen = new Map(), out = [];
    candidates(scope).forEach(function (el) {
      if (!eligible(el)) return;
      var sig = sigOf(el);
      var n = seen.get(sig) || 0; seen.set(sig, n + 1);
      out.push({ sig: sig, n: n, tag: el.tagName, action: el.getAttribute('data-gl-action') || '', onclick: (el.getAttribute('onclick') || '').slice(0, 50), href: el.tagName === 'A' ? (el.getAttribute('href') || '') : '', id: el.id || '', label: ct.labelOf(el) });
    });
    return out;
  };
  ct.find = function (scope, sig, n) {
    if (!scope) return null;
    var els = candidates(scope), k = 0;
    for (var i = 0; i < els.length; i++) {
      if (!eligible(els[i])) continue;
      if (sigOf(els[i]) === sig) { if (k === n) return els[i]; k++; }
    }
    return null;
  };
  // Text a template produced from a missing value: "undefined", "NaN",
  // "[object HTMLButtonElement]". Returns the visible lines that contain it.
  ct.garbage = function () {
    var t = (document.body && document.body.innerText) || '';
    return t.split('\n').filter(function (l) { return /\[object [A-Z]|\bNaN\b|\bundefined\b/.test(l); }).map(function (l) { return l.trim().slice(0, 120); });
  };
  ct.closeIn = function (layer) {
    var cands = Array.prototype.slice.call(layer.querySelectorAll('button, [role="button"], a, span, div, [data-gl-close]'));
    var pick = cands.find(function (e) { return e.hasAttribute('data-gl-close') && ct.isVis(e); }) ||
      cands.find(function (e) {
        if (!ct.isVis(e) || e.children.length > 1) return false;
        var t = (e.innerText || '').trim();
        return /^(✕|×|✖|x|X|✖️)(\s*close)?$/i.test(t) || /close/i.test(e.getAttribute('aria-label') || '') || /^(close|cancel|done|dismiss)$/i.test(t) || /^← back\b/i.test(t);
      });
    if (pick) { pick.click(); return ct.labelOf(pick) || 'x'; }
    return '';
  };
}

// Stand-ins for the CDN libraries the page loads lazily (jsPDF, JSZip,
// html2canvas, Chart.js). The CDN is blocked here, so without these every PDF,
// ZIP and chart path would fail for a reason that says nothing about the app.
// They do no real work: a PDF is a 9-byte blob.
function LIB_STUBS() {
  function fakeDoc() {
    var doc;
    var fixed = {
      internal: { pageSize: { getWidth: function () { return 612; }, getHeight: function () { return 792; }, width: 612, height: 792 }, getNumberOfPages: function () { return 1; }, scaleFactor: 1 },
      splitTextToSize: function (t) { return String(t == null ? '' : t).split('\n'); },
      getNumberOfPages: function () { return 1; }, getTextWidth: function () { return 40; }, getStringUnitWidth: function () { return 1; },
      getFontSize: function () { return 10; }, getLineHeight: function () { return 12; }, getCurrentPageInfo: function () { return { pageNumber: 1 }; },
      output: function (type) { var b = new Blob(['%PDF-stub'], { type: 'application/pdf' }); if (type === 'blob') return b; if (type === 'arraybuffer') return new ArrayBuffer(9); if (type === 'bloburl' || type === 'bloburi') return URL.createObjectURL(b); if (/datauri/.test(type || '')) return 'data:application/pdf;base64,JVBERi1zdHVi'; return '%PDF-stub'; },
      save: function () { return doc; }, lastAutoTable: { finalY: 120 },
    };
    doc = new Proxy(fixed, { get: function (t, k) { if (k in t) return t[k]; if (k === 'then') return undefined; return function () { return doc; }; } });
    return doc;
  }
  function JsPDF() { return fakeDoc(); }
  JsPDF.API = {};
  window.jspdf = { jsPDF: JsPDF };
  window.jsPDF = JsPDF;
  function JSZip() { var z = { files: {}, file: function (n, d) { z.files[n] = d; return z; }, folder: function () { return z; }, generateAsync: function () { return Promise.resolve(new Blob(['zip'], { type: 'application/zip' })); } }; return z; }
  window.JSZip = JSZip;
  window.html2canvas = function () { var c = document.createElement('canvas'); c.width = 10; c.height = 10; return Promise.resolve(c); };
  function Chart() { return { destroy: function () {}, update: function () {}, resize: function () {}, data: { datasets: [], labels: [] }, options: {} }; }
  Chart.register = function () {}; Chart.defaults = { font: {}, plugins: { legend: { labels: {} }, tooltip: {} }, scale: { grid: {} }, color: '' };
  window.Chart = Chart;
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser session plumbing
// ─────────────────────────────────────────────────────────────────────────────
const FIXTURES = buildFixtures();
const results = { clicks: [], failures: [], notes: [], coverage: {}, external: new Set() };

function stubSource(cfg) {
  return '(' + STUB_LIB.toString() + ')(' + JSON.stringify(FIXTURES) + ',' + JSON.stringify(Object.assign({ ids: IDS }, cfg || {})) + ');';
}

async function newSession(browser, vpName, cfg) {
  const ctx = await browser.newContext({ viewport: VIEWPORTS[vpName], serviceWorkers: 'block', isMobile: vpName === 'phone', hasTouch: vpName === 'phone' });
  const sess = { ctx, vp: vpName, cfg: cfg || {}, errors: [], consoleErrors: [], dialogs: [], popups: 0, restCalls: [] };
  await ctx.addInitScript(CT_HELPER);
  await ctx.addInitScript(LIB_STUBS);
  await ctx.route('**/*', async (route) => {
    const url = route.request().url();
    let u; try { u = new URL(url); } catch (e) { return route.abort(); }
    if (u.protocol === 'data:' || u.protocol === 'blob:') return route.continue();
    if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') {
      if (u.pathname === '/supabase.min.js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: stubSource(sess.cfg) });
      if (u.pathname === '/__stub_signed_url' || u.pathname.startsWith('/__stub_public/')) return route.fulfill({ status: 200, contentType: 'text/plain', body: 'stub file' });
      return route.continue();
    }
    if (/\.supabase\.co$/.test(u.hostname)) {
      sess.restCalls.push(route.request().method() + ' ' + u.pathname);
      const r = restRouter(url, route.request().method(), sess.cfg);
      return route.fulfill({ status: r.status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: r.body });
    }
    results.external.add(u.hostname);
    return route.abort();
  });
  ctx.on('page', (p) => { if (sess.page && p !== sess.page) { sess.popups++; setTimeout(() => p.close().catch(() => {}), 1500); } });
  const page = await ctx.newPage();
  sess.page = page;
  page.on('pageerror', (e) => sess.errors.push(String((e && e.message) || e)));
  page.on('console', (m) => { if (m.type() === 'error') sess.consoleErrors.push(m.text()); });
  page.on('dialog', (d) => { sess.dialogs.push(d.type() + ': ' + d.message().slice(0, 120)); (d.type() === 'beforeunload' ? d.accept() : d.dismiss()).catch(() => {}); });
  return sess;
}

const settle = (page, ms) => page.waitForTimeout(ms);

async function crmBoot(sess) {
  const page = sess.page;
  await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => typeof window.openAdmin === 'function' && typeof window.checkPw === 'function' && !!window.__ct, null, { timeout: 15000 });
  await settle(page, 500);
  await page.evaluate(() => { try { localStorage.removeItem('gl_remember'); } catch (e) {} window.openAdmin(); });
  await page.waitForSelector('#pw-ov.show', { timeout: 8000 });
  await page.fill('#pw-email', 'staff@test.local');
  await page.fill('#pw-input', 'harness-only-not-a-password');
  await page.click('.pw-btn');
  await page.waitForSelector('#crm-panel.show', { timeout: 10000 });
  await settle(page, 1800);
  await crmSnapshot(sess);
}

async function crmSnapshot(sess) {
  await sess.page.evaluate(() => {
    const panel = document.getElementById('crm-panel') || document.body;
    const snap = { kids: new Set(document.body.children), panelKids: new Set(panel.children), state: [] };
    document.querySelectorAll('[id]').forEach((el) => {
      if (!/modal|overlay|-ov$|panel|detail|builder|drawer|popup|sidebar|menu|notif/i.test(el.id)) return;
      snap.state.push([el, el.className, el.style.cssText]);
    });
    snap.layers = new Set(window.__ct.layers());
    window.__ctSnap = snap;
  });
}

async function crmReset(sess) {
  return sess.page.evaluate(() => {
    const s = window.__ctSnap; if (!s || !window.__ct) return false;
    [...document.body.children].forEach((el) => { if (!s.kids.has(el)) el.remove(); });
    const panel = document.getElementById('crm-panel');
    if (panel) [...panel.children].forEach((el) => { if (!s.panelKids.has(el)) el.remove(); });
    s.state.forEach(([el, cls, css]) => { if (el.isConnected) { el.className = cls; el.style.cssText = css; } });
    const base = s.layers || new Set();
    window.__ct.layers().forEach((l) => { if (!base.has(l) && !s.kids.has(l) && !s.panelKids.has(l)) l.remove(); else if (!base.has(l)) l.style.display = 'none'; });
    document.body.style.overflow = 'hidden';
    return !!(panel && panel.classList.contains('show') && window.currentUser);
  }).catch(() => false);
}

// Click the CRM nav item (by signature) and return the scope selector: the
// overlay it opened, or the active page.
async function crmEnter(sess, nav) {
  return sess.page.evaluate(async (nav) => {
    const ct = window.__ct;
    const el = ct.find(document.getElementById('crm-panel'), nav.sig, nav.n);
    if (!el) return { err: 'nav item not found: ' + nav.label };
    const before = new Set(ct.layerKeys());
    el.click();
    await new Promise((r) => setTimeout(r, 700));
    const fresh = ct.layers().filter((l) => !before.has(l.dataset.ctLayer));
    if (fresh.length) { const L = fresh[fresh.length - 1]; return { scope: '[data-ct-layer="' + L.dataset.ctLayer + '"]', layer: ct.layerInfo(L) }; }
    const act = document.querySelector('.cpg.act');
    return { scope: act ? '#' + act.id : '#crm-body', page: act ? act.id : '' };
  }, nav).catch((e) => ({ err: String(e.message || e) }));
}

// Open an overlay from inside a scope (for depth-2) and return its scope.
async function openFrom(sess, scopeSel, opener) {
  return sess.page.evaluate(async ({ scopeSel, opener }) => {
    const ct = window.__ct;
    const el = ct.find(document.querySelector(scopeSel), opener.sig, opener.n);
    if (!el) return { err: 'opener not found' };
    const before = new Set(ct.layerKeys());
    el.click();
    await new Promise((r) => setTimeout(r, 600));
    const fresh = ct.layers().filter((l) => !before.has(l.dataset.ctLayer));
    if (!fresh.length) return { err: 'overlay did not reopen' };
    const L = fresh[fresh.length - 1];
    return { scope: '[data-ct-layer="' + L.dataset.ctLayer + '"]', layer: ct.layerInfo(L) };
  }, { scopeSel, opener }).catch((e) => ({ err: String(e.message || e) }));
}

async function listControls(sess, scopeSel) {
  return sess.page.evaluate((s) => window.__ct.controls(document.querySelector(s)), scopeSel).catch(() => []);
}

// Click one control inside the scope, observe, and try to close what it opened.
async function clickOne(sess, scopeSel, c) {
  const page = sess.page;
  const e0 = sess.errors.length, c0 = sess.consoleErrors.length, d0 = sess.dialogs.length, p0 = sess.popups, r0 = sess.restCalls.length;
  const url0 = page.url();
  let pre;
  try {
    pre = await page.evaluate(({ scopeSel, c }) => {
      const ct = window.__ct;
      const el = ct.find(document.querySelector(scopeSel), c.sig, c.n);
      if (!el) return { missing: true };
      try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
      window.__ctBefore = ct.layerKeys(); window.__ctCalls0 = (window.__stubCalls || []).length; window.__ctMut0 = ct.mut; window.__ctGarb0 = ct.garbage();
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
      const covered = !!top && top !== el && !el.contains(top) && !top.contains(el) && !(top.closest && top.closest('label') && top.closest('label').contains(el));
      el.click();
      return { covered, coveredBy: covered ? (top.id ? '#' + top.id : top.tagName + '.' + String(top.className).split(' ')[0]) : '' };
    }, { scopeSel, c });
  } catch (e) { pre = { evalErr: String(e.message || e).slice(0, 200) }; }
  if (pre.missing) return { missing: true, label: c.label };
  await settle(page, 380);
  let post = null;
  try {
    post = await page.evaluate(() => {
      const ct = window.__ct; if (!ct || !window.__ctBefore) return null;
      const before = new Set(window.__ctBefore);
      const fresh = ct.layers().filter((l) => !before.has(l.dataset.ctLayer)).map(ct.layerInfo);
      const panel = document.getElementById('crm-panel');
      const g0 = new Set(window.__ctGarb0 || []);
      return { garbage: ct.garbage().filter((l) => !g0.has(l)).slice(0, 3), fresh, mut: ct.mut - window.__ctMut0, calls: (window.__stubCalls || []).slice(window.__ctCalls0 || 0).map((x) => x.kind + ':' + (x.name || x.table)), crmShown: !!(panel && panel.classList.contains('show')) };
    });
  } catch (e) { post = null; }
  const rec = { label: c.label, action: c.action, onclick: c.onclick, href: c.href, sig: c.sig, covered: !!pre.covered, coveredBy: pre.coveredBy };
  if (!post || page.url() !== url0) {
    rec.navigated = page.url(); rec.needReboot = true;
  } else {
    rec.mut = post.mut; rec.calls = post.calls; rec.crmShown = post.crmShown; if (post.garbage.length) rec.garbage = post.garbage;
    if (post.fresh.length) {
      rec.opened = post.fresh.map((f) => f.key); rec.openedLayers = post.fresh;
      await page.keyboard.press('Escape').catch(() => {});
      await settle(page, 200);
      const visible = (tags) => page.evaluate((tags) => tags.filter((t) => { const el = document.querySelector('[data-ct-layer="' + t + '"]'); return el && window.__ct.isVis(el); }), tags).catch(() => []);
      let still = await visible(post.fresh.map((f) => f.tag));
      if (!still.length) rec.closedBy = 'Escape';
      else {
        const via = await page.evaluate((t) => { const el = document.querySelector('[data-ct-layer="' + t + '"]'); return el ? window.__ct.closeIn(el) : ''; }, still[still.length - 1]).catch(() => '');
        await settle(page, 250);
        still = await visible(post.fresh.map((f) => f.tag));
        if (still.length) rec.notClosable = true; else rec.closedBy = 'close control "' + via + '"';
      }
    }
  }
  rec.pageErrors = sess.errors.slice(e0);
  rec.consoleErrors = sess.consoleErrors.slice(c0);
  rec.dialogs = sess.dialogs.slice(d0);
  rec.popups = sess.popups - p0;
  rec.rest = sess.restCalls.slice(r0);
  if (pre.evalErr) rec.evalErr = pre.evalErr;
  return rec;
}

function classify(rec) {
  const bugs = [];
  for (const m of rec.pageErrors || []) if (ALWAYS_APP_BUG.test(m) || !isBackendNoise(m)) bugs.push('pageerror: ' + m.slice(0, 300));
  for (const g of rec.garbage || []) bugs.push('rendered a missing value: "' + g + '"');
  for (const d of rec.dialogs || []) if (/\[object [A-Z]|\bNaN\b|\bundefined\b/.test(d)) bugs.push('dialog shows a missing value: "' + d.replace(/\s+/g, ' ').slice(0, 120) + '"');
  for (const m of rec.consoleErrors || []) {
    if (/\[gl-actions\]/.test(m)) bugs.push('dead control: ' + m.slice(0, 200));
    else if (ALWAYS_APP_BUG.test(m)) bugs.push('console: ' + m.slice(0, 300));
  }
  return bugs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Targets: a page/overlay whose controls get clicked one by one.
// ─────────────────────────────────────────────────────────────────────────────
const CAP_PER_SCOPE = Number(process.env.CLICK_CAP || 160);
const exploredOverlays = new Set();
const queue = [];

function isPlainLink(c) {
  return c.tag === 'A' && c.href && !/^#|^javascript:/i.test(c.href) && !c.action && !c.onclick;
}

function checkLocalLink(href) {
  return new Promise((resolve) => {
    let u; try { u = new URL(href, BASE + '/'); } catch (e) { return resolve({ status: 0 }); }
    if (u.origin !== BASE) return resolve({ external: u.protocol + '//' + u.host });
    http.get(BASE + u.pathname, (res) => { res.resume(); resolve({ status: res.statusCode }); }).on('error', () => resolve({ status: 0 }));
  });
}

async function crmNavList(sess) {
  return sess.page.evaluate(() => {
    const ct = window.__ct, seen = new Map();
    return [...document.querySelectorAll('#crm-panel .cni')].map((el) => {
      const sig = ct.sigOf(el); const n = seen.get(sig) || 0; seen.set(sig, n + 1);
      return { sig, n, label: (el.textContent || '').trim().replace(/\s+/g, ' '), shown: getComputedStyle(el).display !== 'none' };
    });
  });
}

async function crmEnterNav(sess, nav) {
  return sess.page.evaluate(async (nav) => {
    const ct = window.__ct;
    const all = [...document.querySelectorAll('#crm-panel .cni')].filter((e) => ct.sigOf(e) === nav.sig);
    const el = all[nav.n];
    if (!el) return { err: 'nav item not found: ' + nav.label };
    const before = new Set(ct.layerKeys());
    el.click();
    await new Promise((r) => setTimeout(r, 750));
    const fresh = ct.layers().filter((l) => !before.has(l.dataset.ctLayer));
    if (fresh.length) { const L = fresh[fresh.length - 1]; return { scope: '[data-ct-layer="' + L.dataset.ctLayer + '"]', layer: ct.layerInfo(L) }; }
    const act = document.querySelector('.cpg.act');
    // Phone: close the slide-out menu the nav click came from, if it stayed open.
    return { scope: act ? '#' + act.id : '#crm-body', page: act ? act.id : '' };
  }, nav).catch((e) => ({ err: String(e.message || e) }));
}

function crmTargets(vp, navs) {
  const base = {
    suite: 'crm', vp, cfg: {},
    boot: crmBoot,
    reset: crmReset,
  };
  const out = navs.map((nav) => Object.assign({}, base, {
    page: 'nav: ' + nav.label,
    enter: (sess) => crmEnterNav(sess, nav),
  }));
  out.push(Object.assign({}, base, { page: 'top bar', enter: async () => ({ scope: '#crm-top' }) }));
  out.push(Object.assign({}, base, {
    page: 'bottom nav',
    enter: (sess) => sess.page.evaluate(() => {
      const b = document.querySelector('.crm-bnav-item');
      const c = b && b.parentElement;
      if (!c || !window.__ct.isVis(c)) return { err: 'no visible bottom nav', skip: true };
      c.setAttribute('data-ct-scope', 'bnav');
      return { scope: '[data-ct-scope="bnav"]' };
    }),
  }));
  out.push(Object.assign({}, base, {
    page: 'Users & Permissions',
    enter: (sess) => sess.page.evaluate(async () => {
      window.cNav('users', null); await new Promise((r) => setTimeout(r, 700));
      const act = document.querySelector('.cpg.act'); return act ? { scope: '#' + act.id, page: act.id } : { err: 'users page did not activate' };
    }),
  }));
  return out;
}

function portalTarget(vp) {
  return {
    suite: 'portal', vp, page: 'customer portal dashboard', cfg: { session: 'customer' }, freshPerClick: true,
    boot: async (sess) => {
      await sess.page.goto(BASE + '/?portal=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sess.page.waitForFunction(() => { const c = document.getElementById('gl-cp'); return c && !/^\s*Loading/.test(c.innerText) && c.innerText.length > 80; }, null, { timeout: 12000 });
      await settle(sess.page, 800);
    },
    enter: async () => ({ scope: '#gl-cp' }),
  };
}

function portalLoginTarget(vp) {
  return {
    suite: 'portal', vp, page: 'customer portal login (signed out)', cfg: {}, freshPerClick: true,
    boot: async (sess) => {
      await sess.page.goto(BASE + '/?portal=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sess.page.waitForFunction(() => { const c = document.getElementById('gl-cp'); return c && !/^\s*Loading/.test(c.innerText); }, null, { timeout: 12000 });
      await settle(sess.page, 500);
    },
    enter: async () => ({ scope: '#gl-cp' }),
  };
}

function publicTarget(vp) {
  return {
    suite: 'public', vp, page: 'marketing site', cfg: {},
    boot: async (sess) => {
      await sess.page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sess.page.waitForFunction(() => !!window.__ct && typeof window.openAdmin === 'function', null, { timeout: 15000 });
      await settle(sess.page, 1200);
      await sess.page.evaluate(() => { window.__ctSnap = { kids: new Set(document.body.children), state: [...document.querySelectorAll('[id]')].filter((e) => /modal|overlay|-ov$|menu|nav|drawer|popup/i.test(e.id)).map((e) => [e, e.className, e.style.cssText]) }; });
    },
    reset: (sess) => sess.page.evaluate(() => {
      const s = window.__ctSnap; if (!s || !window.__ct) return false;
      [...document.body.children].forEach((el) => { if (!s.kids.has(el)) el.remove(); });
      s.state.forEach(([el, cls, css]) => { if (el.isConnected) { el.className = cls; el.style.cssText = css; } });
      const crm = document.getElementById('crm-panel');
      if (crm && crm.classList.contains('show')) return false;
      document.body.style.overflow = '';
      window.scrollTo(0, 0);
      return true;
    }).catch(() => false),
    enter: async () => ({ scope: 'body' }),
  };
}

function tokenPageTargets(vp) {
  const mk = (page, url, ready) => ({
    suite: 'pages', vp, page, cfg: {}, freshPerClick: true,
    boot: async (sess) => {
      await sess.page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (ready) await sess.page.waitForFunction(ready, null, { timeout: 10000 }).catch(() => {});
      await settle(sess.page, 700);
    },
    enter: async () => ({ scope: 'body' }),
  });
  return [
    mk('onboard.html (valid token)', '/onboard.html?token=onb' + 'a'.repeat(40), () => !document.getElementById('form').classList.contains('hidden')),
    mk('onboard.html (no token)', '/onboard.html'),
    mk('book.html', '/book.html?u=tour', () => document.getElementById('main-content').classList.contains('show')),
    mk('sign.html', '/sign.html?t=' + SIGN_TOKEN, () => !document.getElementById('main').classList.contains('hidden')),
    mk('approve.html', '/approve.html?b=' + uuid(1301) + '&t=approvetoken', () => !!document.getElementById('btn-approve')),
    mk('auditor.html (valid token)', '/auditor.html?token=' + AUDITOR_TOKEN, () => !document.getElementById('dash').classList.contains('hidden')),
    mk('auditor.html (no token)', '/auditor.html'),
    mk('reset.html', '/reset.html'),
  ];
}

function overlayTarget(parent, opener, layer) {
  return Object.assign({}, parent, {
    page: parent.page + ' ▸ ' + (layer.id ? '#' + layer.id : '"' + layer.title + '"') + ' (via "' + opener.label + '")',
    isOverlay: true,
    enter: async (sess) => {
      const p = await parent.enter(sess);
      if (p.err) return p;
      return openFrom(sess, p.scope, opener);
    },
  });
}

function record(t, rec) {
  const key = t.suite + ' | ' + t.page;
  const row = Object.assign({ suite: t.suite, vp: t.vp, page: t.page }, rec);
  results.clicks.push(row);
  const cov = results.coverage[t.vp + ' | ' + key] = results.coverage[t.vp + ' | ' + key] || { suite: t.suite, vp: t.vp, page: t.page, controls: 0, clicked: 0, missing: 0, links: 0 };
  if (rec.missing) cov.missing++; else if (rec.link) cov.links++; else cov.clicked++;
  for (const b of classify(rec)) results.failures.push({ suite: t.suite, vp: t.vp, page: t.page, control: rec.label, action: rec.action || rec.onclick || '', error: b });
  if (rec.notClosable) results.failures.push({ suite: t.suite, vp: t.vp, page: t.page, control: rec.label, action: rec.action || '', error: 'overlay opened but neither Escape nor its close control closed it: ' + (rec.opened || []).join(', '), soft: true });
  if (rec.link && rec.link.status && rec.link.status >= 400) results.failures.push({ suite: t.suite, vp: t.vp, page: t.page, control: rec.label, action: rec.href, error: 'link target ' + rec.href + ' returns HTTP ' + rec.link.status });
}

async function crawlTarget(browser, t) {
  let sess = await newSession(browser, t.vp, t.cfg);
  const boot = async () => {
    try { await t.boot(sess); return true; } catch (e) {
      // A dead session (crash, closed page) gets one fresh context.
      try { await sess.ctx.close(); } catch (_) {}
      sess = await newSession(browser, t.vp, t.cfg);
      try { await t.boot(sess); return true; } catch (e2) { return 'boot failed: ' + String(e2.message || e2).split('\n')[0]; }
    }
  };
  try {
    const b = await boot();
    if (b !== true) { results.failures.push({ suite: t.suite, vp: t.vp, page: t.page, control: '(boot)', error: b, harness: true }); return; }
    const covKey = t.vp + ' | ' + t.suite + ' | ' + t.page;
    let ent = await t.enter(sess);
    if (ent.err) {
      if (ent.skip) { results.notes.push(t.vp + ' | ' + t.page + ': ' + ent.err); return; }
      results.failures.push({ suite: t.suite, vp: t.vp, page: t.page, control: '(open page)', error: ent.err, soft: !!t.isOverlay });
      return;
    }
    const pre = sess.errors.length;
    const controls = (await listControls(sess, ent.scope)).slice(0, CAP_PER_SCOPE);
    results.coverage[covKey] = results.coverage[covKey] || { suite: t.suite, vp: t.vp, page: t.page, controls: 0, clicked: 0, missing: 0, links: 0 };
    results.coverage[covKey].controls = controls.length;
    if (sess.errors.length > pre || sess.errors.length) {
      // errors raised just by booting/entering the page
      const rec = { label: '(load ' + t.page + ')', pageErrors: sess.errors.slice(0), consoleErrors: sess.consoleErrors.slice(0) };
      for (const bb of classify(rec)) results.failures.push({ suite: t.suite, vp: t.vp, page: t.page, control: '(page load / navigation)', error: bb });
    }
    let dirty = false, first = true;
    for (const c of controls) {
      if (isPlainLink(c)) {
        const link = await checkLocalLink(c.href);
        if (link.external) results.notes.push('external link (not followed): ' + c.href + ' on ' + t.page);
        record(t, { label: c.label, href: c.href, link });
        continue;
      }
      if (!first) {
        let ok = false;
        if (!t.freshPerClick && !dirty) ok = await t.reset(sess);
        if (!ok) { const b2 = await boot(); if (b2 !== true) { record(t, { label: c.label, missing: true }); continue; } }
        ent = await t.enter(sess);
        if (ent.err) { const b3 = await boot(); if (b3 === true) ent = await t.enter(sess); }
        if (ent.err) { record(t, { label: c.label, missing: true, why: ent.err }); continue; }
      }
      first = false;
      let rec = await clickOne(sess, ent.scope, c);
      if (rec.missing && !t.freshPerClick) {
        // An earlier click changed in-memory state (moved a deal, paid an
        // invoice, paged the calendar). Start again from a fresh page load.
        const b4 = await boot();
        if (b4 === true) { ent = await t.enter(sess); if (!ent.err) rec = await clickOne(sess, ent.scope, c); }
      }
      dirty = !!rec.needReboot || rec.crmShown === false || (rec.calls || []).some((k) => !/^(select|storage):/.test(k));
      record(t, rec);
      if (DEPTH >= 2 && !t.isOverlay && rec.openedLayers) {
        for (const L of rec.openedLayers) {
          const k = t.suite + '|' + t.vp + '|' + L.key;
          if (exploredOverlays.has(k)) continue;
          exploredOverlays.add(k);
          queue.push(overlayTarget(t, c, L));
        }
      }
    }
  } finally {
    try { await sess.ctx.close(); } catch (e) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature checks (today's changes) — explicit assertions, not just clicks.
// ─────────────────────────────────────────────────────────────────────────────
const featureChecks = [];
function fcheck(name, ok, detail) { featureChecks.push({ name, ok: !!ok, detail: detail || '' }); }

async function runFeatures(browser, vp) {
  const only = process.env.CLICK_FEATURE ? new RegExp(process.env.CLICK_FEATURE, 'i') : null;
  for (const [name, fn, opts] of FEATURES) {
    if (only && !only.test(name)) continue;
    const kind = opts && opts.boot;
    const cfg = kind === 'customer' ? { session: 'customer' } : kind === 'stranger' ? { session: 'stranger' } : {};
    const sess = await newSession(browser, vp, cfg);
    try {
      await bootFor(sess, kind);
      const e0 = sess.errors.length;
      await fn(sess, (n, ok, d) => fcheck(vp + ' | ' + name + ': ' + n, ok, d));
      const errs = sess.errors.slice(e0).filter((m) => ALWAYS_APP_BUG.test(m) || !isBackendNoise(m));
      fcheck(vp + ' | ' + name + ': no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    } catch (e) {
      fcheck(vp + ' | ' + name + ': ran to completion', false, String(e.message || e).split('\n')[0]);
    } finally { try { await sess.ctx.close(); } catch (e) {} }
  }
}

// Each feature: [name, async (sess, check) => {}, opts]. Runs on a fresh admin
// session unless opts.boot says otherwise. Driven through the real controls.
const stubCalls = (p) => p.evaluate(() => (window.__stubCalls || []).map((c) => ({ kind: c.kind, name: c.name || c.table, payload: c.payload, body: c.body })));
const callsSince = async (p, n) => (await stubCalls(p)).slice(n);
const clickText = (p, scopeSel, re) => p.evaluate(({ scopeSel, src, flags }) => {
  const re = new RegExp(src, flags);
  const scope = document.querySelector(scopeSel) || document;
  const el = [...scope.querySelectorAll('button, [data-gl-action], a, [role="button"], .cni')].find((e) => window.__ct.isVis(e) && re.test((e.innerText || e.textContent || '').trim()));
  if (!el) return false;
  el.click(); return (el.innerText || el.textContent || '').trim().slice(0, 60);
}, { scopeSel, src: re.source, flags: re.flags });
const navTo = (p, label) => p.evaluate((label) => {
  const n = [...document.querySelectorAll('#crm-panel .cni')].find((e) => (e.textContent || '').includes(label));
  if (n) n.click(); return !!n;
}, label);

const FEATURES = [
  ['Invoice builder', async (sess, check) => {
    const p = sess.page;
    check('sidebar "New Invoice" exists', await navTo(p, 'New Invoice'));
    await settle(p, 700);
    check('builder opens', await p.evaluate(() => { const b = document.getElementById('gl-inv-builder'); return !!b && b.classList.contains('show'); }));
    await p.selectOption('#ginv-client', IDS.c1);
    const n0 = (await stubCalls(p)).length;
    const added = await p.evaluate(() => { const b = document.querySelector('#gl-inv-builder [data-gl-action="glAddLine"][data-gl-arg1="canning"]'); if (b) b.click(); return !!b; });
    check('"+ Canning" line button exists', added);
    await settle(p, 400);
    const id = await p.evaluate(() => { const c = document.querySelector('#gl-inv-body [id$="-cases"]'); return c ? c.closest('[data-gl-total]').id : null; });
    check('a canning line was added', !!id);
    if (!id) return;
    const rateCalls = (await callsSince(p, n0)).filter((c) => /canning_rates|bottling_rates/.test(c.name));
    const snap = () => p.evaluate((id) => {
      const qty = (key) => { const a = document.querySelector('#gl-inv-body [data-gl-addon="' + key + '"] [id$="-qty"]'); return a ? Number(a.value) : null; };
      const row = document.getElementById(id);
      return {
        cases: Number(document.getElementById(id + '-cases').value), cans: (document.getElementById(id + '-cans') || {}).textContent || '',
        pcase: Number((document.getElementById(id + '-pcase') || {}).value), total: Number(row.getAttribute('data-gl-total')),
        tray: (document.getElementById(id + '-tray') || {}).value, tray12: qty('tray12'), tray24: qty('tray24'), nitrogen: qty('nitrogen'), pallet: qty('pallet'),
        trayBox12: !!(document.querySelector('#gl-inv-addons input[data-addon="tray12"]') || {}).checked,
      };
    }, id);
    await p.fill(`#${id}-cases`, '200'); await p.press(`#${id}-cases`, 'Tab'); await settle(p, 200);
    const s24 = await snap();
    check('rates come from the canning_rates table ($0.50/can → $12.00 a 24-count case)', s24.pcase === 12, JSON.stringify(s24) + ' rate reads: ' + rateCalls.length);
    check('200 cases of 24 = 4,800 cans', /4,800/.test(s24.cans), s24.cans);
    check('tray picker offers 12 and 24', await p.evaluate((id) => { const s = document.getElementById(id + '-tray'); return !!s && [...s.options].map((o) => o.value).sort().join() === '12,24'; }, id));
    await p.selectOption(`#${id}-tray`, '12'); await settle(p, 250);
    const s12 = await snap();
    check('12-count tray keeps the cans and doubles the cases', s12.cases === 400 && /4,800/.test(s12.cans), JSON.stringify(s12));
    check('12-count tray ticks the 12-count tray charge', s12.tray12 === 400 && s12.trayBox12, JSON.stringify(s12));
    await p.click('#gl-inv-addons input[data-addon="nitrogen"]');
    await p.click('#gl-inv-addons input[data-addon="pallet"]');
    await p.fill('#gl-inv-addons-cpp', '208'); await p.press('#gl-inv-addons-cpp', 'Tab'); await settle(p, 250);
    const sAdd = await snap();
    check('nitrogen add-on follows the cans (4,800)', sAdd.nitrogen === 4800, JSON.stringify(sAdd));
    check('pallets: 400 cases at 208 a pallet = 2', sAdd.pallet === 2, JSON.stringify(sAdd));
    // Unit price below a cent on a per-can add-on.
    const setRate = await p.evaluate(() => {
      const row = document.querySelector('#gl-inv-body [data-gl-addon="nitrogen"]');
      const inp = row && [...row.querySelectorAll('input')].find((i) => /price|rate|pcan|unit/i.test(i.id) && !/qty/.test(i.id));
      if (!inp) return { ok: false, ids: row ? [...row.querySelectorAll('input')].map((i) => i.id) : [] };
      inp.value = '0.0275'; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, id: inp.id };
    });
    check('per-can add-on price is editable', setRate.ok, JSON.stringify(setRate));
    const n1 = (await stubCalls(p)).length;
    await p.click('#gl-inv-builder [data-gl-action="glSaveInvoice"]');
    await settle(p, 1200);
    const writes = (await callsSince(p, n1)).filter((c) => c.kind === 'insert' && c.name === 'invoices');
    check('Save writes one invoice row', writes.length === 1, 'insert calls: ' + writes.length);
    if (writes.length) {
      const row = Array.isArray(writes[0].payload) ? writes[0].payload[0] : writes[0].payload;
      const li = row.line_items || [];
      const nit = li.find((l) => /nitrogen/i.test(l.desc || ''));
      check('saved line items include canning, 12-count tray, nitrogen and pallets', li.length >= 4 && li.some((l) => /12-count/i.test(l.desc || '')) && !!nit && li.some((l) => /pallet/i.test(l.desc || '')), JSON.stringify(li.map((l) => l.desc)));
      check('a 4-decimal unit price is saved unrounded (0.0275)', !!nit && Number(nit.unitPrice) === 0.0275, JSON.stringify(nit));
      check('saved amount is cents-rounded and positive', row.amount > 0 && Math.round(row.amount * 100) === row.amount * 100, String(row.amount));
      check('saved invoice uses the allocated number', /^GL-/.test(row.invoice_number || ''), row.invoice_number);
    }
    check('builder closes after a successful save', await p.evaluate(() => !document.getElementById('gl-inv-builder').classList.contains('show')));
    // In-CRM invoice detail must show the sub-cent unit price too.
    await navTo(p, 'Invoices'); await settle(p, 600);
    const opened = await p.evaluate(() => { const r = [...document.querySelectorAll('#cpg-invoices tr, #cpg-invoices [data-gl-action]')].find((e) => /GL-1041/.test(e.textContent || '') && /viewInvoice/.test(e.getAttribute('data-gl-action') || e.getAttribute('onclick') || '')); if (r) { r.click(); return true; } if (window.viewInvoice) { window.viewInvoice('GL-1041'); return 'fn'; } return false; });
    await settle(p, 500);
    const detail = await p.evaluate(() => (document.getElementById('inv-detail') || {}).innerText || '');
    check('invoice detail opens for GL-1041', !!opened && /GL-1041/.test(detail), 'opened=' + opened);
    check('invoice detail shows the $0.025 unit price (not $0.03)', /\$0\.025/.test(detail), (detail.match(/Pasteurization[^\n]*\n?[^\n]*/) || [''])[0].replace(/\s+/g, ' ').slice(0, 120));
  }],

  ['Quote builder', async (sess, check) => {
    const p = sess.page;
    await navTo(p, 'Pipeline'); await settle(p, 600);
    const opened = await clickText(p, '#cpg-pipeline', /Quote Builder/);
    check('Pipeline "📋 Quote Builder" button exists', !!opened);
    await settle(p, 700);
    check('quote builder opens', await p.evaluate(() => !!document.getElementById('gl-qb-tray') || !!document.getElementById('gl-qb-save')));
    // Choose canning + a client, so the tray picker and the invoice path apply.
    await p.evaluate(() => { const t = document.getElementById('gl-qb-type'); if (t) { t.value = 'canning'; t.dispatchEvent(new Event('change', { bubbles: true })); } });
    await settle(p, 300);
    const picked = await p.evaluate((cid) => {
      const list = document.getElementById('gl-qb-clients-list');
      const nm = document.getElementById('gl-qb-client-name');
      if (nm) { nm.value = 'Acme Sparkling Co'; nm.dispatchEvent(new Event('input', { bubbles: true })); nm.dispatchEvent(new Event('change', { bubbles: true })); }
      return { list: !!list, name: !!nm };
    }, IDS.c1);
    await settle(p, 300);
    const cans = () => p.evaluate(() => [...document.querySelectorAll('[data-tier-field="cans"]')].map((i) => Number(i.value)));
    const cases = () => p.evaluate(() => [...document.querySelectorAll('[data-tier-field="cases"]')].map((i) => Number(i.value)));
    const tw = await p.evaluate(() => { const w = document.getElementById('gl-qb-tray-wrap'); return !!w && getComputedStyle(w).display !== 'none'; });
    check('CASE TRAY picker shows for canning', tw);
    await p.click('#gl-qb-add-tier'); await settle(p, 300);
    const before = { cans: await cans(), cases: await cases() };
    check('"+ tier" adds a volume tier', before.cases.length >= 1, JSON.stringify(before));
    await p.selectOption('#gl-qb-tray', '12'); await settle(p, 300);
    const after = { cans: await cans(), cases: await cases(), t12: await p.evaluate(() => !!(document.getElementById('gl-qb-tray12-on') || {}).checked), t24: await p.evaluate(() => !!(document.getElementById('gl-qb-tray24-on') || {}).checked) };
    check('12-count tray keeps cans, doubles cases, ticks the 12-count charge only', JSON.stringify(after.cans) === JSON.stringify(before.cans) && after.cases.every((c, i) => c === before.cases[i] * 2) && after.t12 && !after.t24, JSON.stringify({ before, after }));
    const addon0 = await p.evaluate(() => ['gl-qb-pasteur-on', 'gl-qb-paktech4-on'].map((id) => !!(document.getElementById(id) || {}).checked));
    await p.click('#gl-qb-pasteur-on'); await p.click('#gl-qb-paktech4-on'); await settle(p, 250);
    const addon1 = await p.evaluate(() => ['gl-qb-pasteur-on', 'gl-qb-paktech4-on'].map((id) => !!(document.getElementById(id) || {}).checked));
    check('add-on checkboxes toggle (pasteurization, PakTech 4-pack)', addon1[0] === !addon0[0] && addon1[1] === !addon0[1], JSON.stringify({ addon0, addon1 }));
    const n0 = (await stubCalls(p)).length;
    await p.click('#gl-qb-save'); await settle(p, 800);
    const ins = (await callsSince(p, n0)).filter((c) => c.kind === 'insert' && c.name === 'quotes');
    const st = await p.evaluate(() => (document.getElementById('gl-qb-status') || {}).textContent || '');
    const qp = ins[0] && (Array.isArray(ins[0].payload) ? ins[0].payload[0] : ins[0].payload);
    check('Save writes the quote and says so', ins.length === 1 && /Saved/i.test(st), 'inserts=' + ins.length + ' status="' + st + '" client picker=' + JSON.stringify(picked));
    check('saved quote carries the 12-count tray and the ticked add-ons', !!qp && qp.sections && qp.sections[0].pkg.tray12On === true && qp.sections[0].pkg.tray24On === false && qp.sections[0].pkg.pasteurOn === true, qp ? JSON.stringify(qp.sections && qp.sections[0].pkg).slice(0, 200) : 'no payload');
    // Builder's own "🧾 Create invoice": saves then opens the invoice builder.
    const nI = (await stubCalls(p)).length;
    await p.click('#gl-qb-invoice'); await settle(p, 900);
    const fromBuilder = await p.evaluate(() => { const b = document.getElementById('gl-inv-builder'); return { shown: !!b && b.classList.contains('show'), client: (document.getElementById('ginv-client') || {}).value, lines: document.querySelectorAll('#gl-inv-body [data-gl-total]').length, status: (document.getElementById('gl-qb-status') || {}).textContent || '' }; });
    check('builder "Invoice" button opens the invoice builder with the quote lines for its client', fromBuilder.shown && fromBuilder.client === IDS.c1 && fromBuilder.lines > 0, JSON.stringify(fromBuilder) + ' dialogs: ' + sess.dialogs.slice(-2).join(' | '));
    await p.evaluate(() => { const b = document.getElementById('gl-inv-builder'); if (b) b.classList.remove('show'); });
    // Create invoice from the saved quote list: Q-1001 is linked to Acme.
    await p.evaluate(() => { document.querySelectorAll('[id^="gl-qb"]').forEach((e) => { if (getComputedStyle(e).position === 'fixed') e.remove(); }); });
    const openedList = await clickText(p, '#cpg-pipeline', /Quotes$/);
    await settle(p, 800);
    check('"🗂 Quotes" list opens', !!openedList && await p.evaluate(() => !!document.getElementById('gl-ql-modal')));
    const inv = await p.evaluate(() => {
      const m = document.getElementById('gl-ql-modal'); if (!m) return 'no list';
      const row = [...m.querySelectorAll('*')].filter((e) => /Q-1001/.test(e.textContent || '') && e.querySelector && [...e.querySelectorAll('button')].some((b) => /Invoice/.test(b.textContent))).pop();
      if (!row) return 'no Q-1001 row with an Invoice button';
      [...row.querySelectorAll('button')].find((b) => /Invoice/.test(b.textContent)).click(); return 'clicked';
    });
    await settle(p, 900);
    const b = await p.evaluate(() => { const b = document.getElementById('gl-inv-builder'); return { shown: !!b && b.classList.contains('show'), client: (document.getElementById('ginv-client') || {}).value, lines: document.querySelectorAll('#gl-inv-body [data-gl-total]').length }; });
    check('"🧾 Invoice" on a linked quote opens the invoice builder for its client with lines', inv === 'clicked' && b.shown && b.client === IDS.c1 && b.lines > 0, inv + ' ' + JSON.stringify(b));
  }],

  ['Needs Attention: send to my phone', async (sess, check) => {
    const p = sess.page;
    await navTo(p, 'Pipeline'); await settle(p, 500);
    const btn = await clickText(p, '#crm-panel', /Needs Attention/);
    check('🔥 Needs Attention button exists', !!btn);
    await settle(p, 900);
    const has = await p.evaluate(() => !!document.querySelector('#gl-at-send'));
    check('board has "📲 Send to my phone"', has);
    if (!has) return;
    const n0 = (await stubCalls(p)).length;
    await p.click('#gl-at-send'); await settle(p, 500);
    const inv = (await callsSince(p, n0)).filter((c) => c.kind === 'invoke');
    check('it calls the attention-digest function', inv.length === 1 && inv[0].name === 'attention-digest', JSON.stringify(inv.map((c) => c.name)));
    const txt = await p.evaluate(() => document.getElementById('gl-at-send').textContent);
    // Stub reply: telegramSent:true, emailSent:false — the alert went out.
    check('a Telegram-only send reports "✓ Sent" without "(check secrets)"', /Sent/.test(txt) && !/check secrets/.test(txt), 'button says "' + txt + '"');
  }],

  ['Agreements: send for signature', async (sess, check) => {
    const p = sess.page;
    await navTo(p, 'Clients'); await settle(p, 700);
    const opened = await p.evaluate(() => { const b = [...document.querySelectorAll('#cpg-clients [data-gl-action="glAgreementsForClient"]')][0]; if (b) { b.click(); return true; } return false; });
    check('Clients row has a 📄 Agreements button', opened);
    await settle(p, 800);
    const fields = await p.evaluate(() => [...document.querySelectorAll('[data-agr-field]')].map((i) => i.getAttribute('data-agr-field')));
    check('agreement form renders its fields', fields.length >= 8, fields.join(','));
    await p.evaluate(() => {
      const vals = { client_legal_name: 'Acme Sparkling Co LLC', client_address: '1 Main St, Palmetto FL', client_signer_name: 'Ann Avery', client_signer_title: 'CEO', client_signer_email: 'ann@acme-sparkling.test', effective_date: '2026-10-11', gl_legal_name: 'Good Liquid Bev Co LLC', gl_address: '2 Plant Rd', gl_signer_name: 'Test Admin', gl_signer_title: 'Owner', term_years: '2' };
      document.querySelectorAll('[data-agr-field]').forEach((i) => { const k = i.getAttribute('data-agr-field'); if (vals[k] && !i.value) { i.value = vals[k]; i.dispatchEvent(new Event('input', { bubbles: true })); } });
    });
    check('"Generate draft →" works', !!await clickText(p, 'body', /^Generate draft/));
    await settle(p, 400);
    const n0 = (await stubCalls(p)).length;
    check('"✍️ Send for e-signature" button exists', !!await clickText(p, 'body', /Send for e-signature/));
    await settle(p, 1200);
    const calls = await callsSince(p, n0);
    const sign = calls.filter((c) => c.kind === 'invoke' && c.name === 'agreement-sign');
    check('send saves the PDF + agreement row, then calls agreement-sign with action "send"', calls.some((c) => c.kind === 'storage') && calls.some((c) => c.kind === 'insert' && c.name === 'agreements') && sign.length === 1 && sign[0].body && sign[0].body.action === 'send', JSON.stringify(calls.filter((c) => c.kind !== 'select').map((c) => c.kind + ':' + c.name)));
    const status = await p.evaluate(() => document.body.innerText.match(/Signing link emailed to [^\n.]+|sending failed[^\n]*|PDF failed[^\n]*/i));
    check('UI confirms the signing link was emailed', !!status && /emailed to ann@/.test(status[0]), status ? status[0] : 'no status line');
  }],

  ['Email correspondence direction', async (sess, check) => {
    const p = sess.page;
    await navTo(p, 'Clients'); await settle(p, 700);
    await p.evaluate((cid) => window.viewClientEnhanced(cid), IDS.c1);
    await settle(p, 1200);
    const txt = await p.evaluate(() => (document.getElementById('client-detail-overlay') || document.body).innerText);
    check('client correspondence lists the inbound reply as FROM CLIENT', /FROM CLIENT[\s\S]{0,80}Re: Your quote Q-1001|Re: Your quote Q-1001[\s\S]{0,80}FROM CLIENT/.test(txt), (txt.match(/[^\n]*Q-1001[^\n]*/g) || []).join(' / ').slice(0, 200));
    check('client correspondence shows the outbound email as sent', /(SENT|→)[\s\S]{0,80}Your quote Q-1001/.test(txt));
    await p.evaluate(() => { const o = document.getElementById('client-detail-overlay'); if (o) o.remove(); });
    // Email activity (Invoices → 📊 Activity): every email_log row.
    await navTo(p, 'Invoices'); await settle(p, 700);
    const act = await clickText(p, '#cpg-invoices', /^📊 Activity$/);
    await settle(p, 700);
    const rows = await p.evaluate(() => { const m = document.getElementById('gl-email-activity'); return m ? m.innerText : ''; });
    check('Email activity opens from Invoices', !!act && rows.length > 0);
    const lines = rows.split('\n').map((l) => l.trim()).filter(Boolean);
    const at = lines.findIndex((l) => l === 'Re: Your quote Q-1001');
    const inboundLine = at >= 0 ? lines.slice(at, at + 5).join(' | ') : '(inbound row not listed)';
    check('Email activity marks the inbound reply as received from the client (not "→ our address")', /←|from|received|inbound/i.test(inboundLine) && !/→ mike@goodliquid/.test(inboundLine), inboundLine.slice(0, 160));
  }],

  ['Clients: delete', async (sess, check) => {
    const p = sess.page;
    await navTo(p, 'Clients'); await settle(p, 700);
    const d0 = sess.dialogs.length;
    const clicked = await p.evaluate(() => { const b = document.querySelector('#cpg-clients [data-gl-action="deleteClient"]'); if (b) b.click(); return !!b; });
    check('owner sees a Delete button on client rows', clicked);
    await settle(p, 600);
    const d = sess.dialogs.slice(d0).join(' | ');
    check('the delete confirmation names the client (it asks you to type the name)', /Acme Sparkling Co|Brightwater Teas|Citrus Grove/.test(d) && !/\[object /.test(d), d.replace(/\s+/g, ' ').slice(0, 120));
  }],

  ['Inventory: +10 / −10', async (sess, check) => {
    const p = sess.page;
    await navTo(p, 'Inventory'); await settle(p, 700);
    const n0 = (await stubCalls(p)).length;
    const plus = await p.evaluate(() => { const b = document.querySelector('#cpg-inventory [data-gl-action="adjustInventory"][data-gl-arg2="10"]'); if (b) b.click(); return !!b; });
    await settle(p, 500);
    const up1 = (await callsSince(p, n0)).filter((c) => c.kind === 'update' && c.name === 'inventory').map((c) => c.payload && c.payload.qty);
    check('Inventory: +10 on 2,400 cans writes 2410', plus && up1.length === 1 && up1[0] === 2410, 'wrote qty=' + JSON.stringify(up1));
    const n1 = (await stubCalls(p)).length;
    await p.evaluate(() => { const b = [...document.querySelectorAll('#cpg-inventory [data-gl-action="adjustInventory"][data-gl-arg2="-10"]')].pop(); if (b) b.click(); });
    await settle(p, 500);
    const up2 = (await callsSince(p, n1)).filter((c) => c.kind === 'update' && c.name === 'inventory').map((c) => c.payload && c.payload.qty);
    check('Inventory: −10 on 120 trays writes 110', up2.length === 1 && up2[0] === 110, 'wrote qty=' + JSON.stringify(up2));
  }],

  ['Public quote form', async (sess, check) => {
    const p = sess.page;
    const fill = () => p.evaluate(() => {
      const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
      set('qf-brand', 'Harness Brand'); set('qf-name', 'Pat Tester'); set('qf-email', 'pat.tester@example.test');
      set('qf-phone', '(555) 555-0100'); set('qf-details', 'A pilot run of a sparkling tea, 200 cases.');
      document.querySelectorAll('#qf-service-group input, #qf-product-group input').forEach((cb) => { cb.checked = false; });
      const s = document.querySelector('#qf-service-group input'); if (s) s.checked = true;
      const pt = document.querySelector('#qf-product-group input[type="checkbox"]:not([value="Other"])'); if (pt) pt.checked = true;
      const b = document.querySelector('[data-gl-action="submitContactForm"]'); if (b) { b.disabled = false; b.textContent = 'Send inquiry →'; }
      ['form-ok', 'form-err'].forEach((id) => { const e = document.getElementById(id); if (e) e.style.display = 'none'; });
    });
    const vis = (id) => p.evaluate((id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; }, id);
    // empty submit → validation, no RPC
    const n0 = (await stubCalls(p)).length;
    await p.click('[data-gl-action="submitContactForm"]'); await settle(p, 400);
    check('empty submit shows the validation list and calls nothing', await vis('form-err') && !(await callsSince(p, n0)).some((c) => c.kind === 'rpc'));
    await fill();
    const n1 = (await stubCalls(p)).length;
    await p.click('[data-gl-action="submitContactForm"]'); await settle(p, 700);
    const rpc = (await callsSince(p, n1)).filter((c) => c.kind === 'rpc');
    check('valid submit calls submit_quote_request once and shows "sent"', rpc.length === 1 && rpc[0].name === 'submit_quote_request' && await vis('form-ok'), JSON.stringify(rpc.map((c) => c.name)));
    // error path: the server refuses
    await p.evaluate(() => { window.__STUB_CFG.failRpc = { submit_quote_request: { message: 'We already have your request — Mike will be in touch shortly.' } }; });
    await fill();
    await p.click('[data-gl-action="submitContactForm"]'); await settle(p, 700);
    const errText = await p.evaluate(() => (document.getElementById('form-err') || {}).textContent || '');
    check('refused submit shows the server message and not "sent"', await vis('form-err') && !(await vis('form-ok')) && /already have your request/.test(errText), errText.slice(0, 120));
  }, { boot: 'public' }],

  ['Self-registered stranger + "remember me"', async (sess, check) => {
    // Supabase signup is open. A stranger with a session and no profiles row
    // must not get the staff CRM on any login path.
    const p = sess.page;
    await p.evaluate(() => { try { localStorage.setItem('gl_remember', '1'); } catch (e) {} window.openAdmin(); });
    await settle(p, 1500);
    const r = await p.evaluate(() => ({ crm: !!document.getElementById('crm-panel') && document.getElementById('crm-panel').classList.contains('show'), role: window.currentUser && window.currentUser.role }));
    check('auto-login refuses an account with no staff profile', !r.crm, JSON.stringify(r));
  }, { boot: 'stranger' }],

  ['Customer portal', async (sess, check) => {
    const p = sess.page;
    const txt = await p.evaluate(() => document.getElementById('gl-cp').innerText);
    check('dashboard greets the customer', /Acme/.test(txt), txt.slice(0, 120));
    const tab = await p.evaluate(() => { const t = [...document.querySelectorAll('#gl-cp *')].find((e) => e.children.length === 0 && /^billing$/i.test((e.textContent || '').trim())); if (!t) return false; (t.closest('[data-gl-action],button,[role=tab]') || t).click(); return true; });
    check('BILLING tab exists', tab);
    await settle(p, 600);
    const bill = await p.evaluate(() => document.getElementById('gl-cp').innerText);
    const nums = bill.match(/GL-\d+/g) || [];
    check('billing lists only this client\'s invoices (the query is scoped to client_id)', nums.includes('GL-1042') && !nums.some((n) => ['GL-1043', 'GL-1044', 'GL-1045'].includes(n)), nums.join(','));
    check('billing hides DRAFT invoices from the customer', !nums.includes('GL-1041'), 'GL-1041 is a draft; shown: ' + nums.join(','));
  }, { boot: 'customer' }],
];

async function bootFor(sess, kind) {
  const p = sess.page;
  if (!kind) return crmBoot(sess);
  if (kind === 'public' || kind === 'stranger') {
    await p.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForFunction(() => !!window.__ct && typeof window.openAdmin === 'function', null, { timeout: 15000 });
    await settle(p, 800);
    return;
  }
  if (kind === 'customer') {
    await p.goto(BASE + '/?portal=1', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForFunction(() => { const c = document.getElementById('gl-cp'); return c && !/^\s*Loading/.test(c.innerText) && c.innerText.length > 80; }, null, { timeout: 12000 });
    await settle(p, 800);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  const server = await startServer();
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    // Belt and braces: even a request the router misses cannot resolve a host.
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
  });
  try {
    for (const vp of WANT_VP) {
      if (ONLY.includes('crm')) {
        const s = await newSession(browser, vp, {});
        let navs = [];
        try { await crmBoot(s); navs = await crmNavList(s); } catch (e) {
          results.failures.push({ suite: 'crm', vp, page: '(login)', control: 'Sign in', error: 'CRM did not open: ' + String(e.message || e).split('\n')[0] });
        }
        await s.ctx.close();
        const hidden = navs.filter((n) => !n.shown).map((n) => n.label);
        if (hidden.length) results.notes.push(vp + ' | sidebar items hidden for admin (still clicked): ' + hidden.join(', '));
        queue.push(...crmTargets(vp, navs));
      }
      if (ONLY.includes('portal')) queue.push(portalTarget(vp), portalLoginTarget(vp));
      if (ONLY.includes('public')) queue.push(publicTarget(vp));
      if (ONLY.includes('pages')) queue.push(...tokenPageTargets(vp));
    }
    let done = 0;
    const worker = async () => {
      while (queue.length) {
        const t = queue.shift();
        const ts = Date.now();
        try { await crawlTarget(browser, t); }
        catch (e) { results.failures.push({ suite: t.suite, vp: t.vp, page: t.page, control: '(crawler)', error: 'harness: ' + String(e.message || e).split('\n')[0], harness: true }); }
        done++;
        if (process.env.CLICK_VERBOSE) console.log(`  [${done}, ${queue.length} queued] ${t.vp} ${t.suite} ${t.page} (${((Date.now() - ts) / 1000).toFixed(1)}s)`);
      }
    };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    if (ONLY.includes('features')) for (const vp of WANT_VP) await runFeatures(browser, vp);
  } finally {
    await browser.close();
    server.close();
  }
  report(t0);
}

function report(t0) {
  const cov = Object.values(results.coverage);
  const pages = new Set(cov.map((c) => c.vp + '|' + c.suite + '|' + c.page.split(' ▸ ')[0]));
  const overlays = cov.filter((c) => / ▸ /.test(c.page)).length;
  const clicked = cov.reduce((a, c) => a + c.clicked, 0);
  const links = cov.reduce((a, c) => a + c.links, 0);
  const missing = cov.reduce((a, c) => a + c.missing, 0);
  console.log('');
  console.log('COVERAGE');
  for (const vp of WANT_VP) {
    const mine = cov.filter((c) => c.vp === vp);
    console.log(`  ${vp}: ${new Set(mine.filter((c) => !/ ▸ /.test(c.page)).map((c) => c.suite + c.page)).size} pages, ${mine.filter((c) => / ▸ /.test(c.page)).length} overlays, ` +
      `${mine.reduce((a, c) => a + c.clicked, 0)} controls clicked, ${mine.reduce((a, c) => a + c.links, 0)} links checked, ${mine.reduce((a, c) => a + c.missing, 0)} not re-found after reset`);
  }
  if (process.env.CLICK_VERBOSE) for (const c of cov.sort((a, b) => (a.vp + a.page).localeCompare(b.vp + b.page))) console.log(`    ${c.vp.padEnd(7)} ${c.suite.padEnd(6)} ${String(c.clicked).padStart(4)} clicked ${String(c.controls).padStart(4)} found  ${c.page}`);
  console.log(`  total: ${pages.size} page/viewport pairs, ${overlays} overlays, ${clicked} clicks, ${links} links, ${missing} missing`);
  console.log(`  blocked external hosts: ${[...results.external].sort().join(', ') || 'none'}`);

  // Dedupe failures by (suite, page-root, control, error) across viewports.
  const keyOf = (f) => [f.suite, f.control, f.error.replace(/\d{4,}/g, 'N')].join(' | ');
  const groups = new Map();
  for (const f of results.failures) {
    const k = keyOf(f);
    if (!groups.has(k)) groups.set(k, Object.assign({}, f, { where: new Set() }));
    groups.get(k).where.add(f.vp + ': ' + f.page);
  }
  const known = [], unknown = [], soft = [], harness = [];
  for (const g of groups.values()) {
    const line = `${g.suite} | ${[...g.where].join(' ; ')} | ${g.control} | ${g.error}`;
    const kf = KNOWN_FAILURES.find((k) => k.match.test(line));
    if (kf) { kf.seen = true; known.push([line, kf.why]); }
    else if (g.harness) harness.push(line);
    else if (g.soft) soft.push(line);
    else unknown.push(line);
  }
  const fails = featureChecks.filter((f) => !f.ok);
  for (const f of featureChecks) {
    if (f.ok) continue;
    const line = 'feature | ' + f.name + ' | ' + f.detail;
    const kf = KNOWN_FAILURES.find((k) => k.match.test(line));
    if (kf) { kf.seen = true; known.push([line, kf.why]); } else unknown.push(line);
  }
  console.log('');
  console.log(`FEATURE CHECKS: ${featureChecks.length - fails.length}/${featureChecks.length} passed`);
  for (const f of featureChecks) console.log(`  ${f.ok ? 'PASS' : 'FAIL'}  ${f.name}${f.ok || !f.detail ? '' : '  — ' + f.detail}`);
  console.log('');
  if (soft.length) { console.log(`WARNINGS (${soft.length}) — overlays that did not close on Escape or ✕, pages that did not open:`); soft.forEach((l) => console.log('  WARN  ' + l)); console.log(''); }
  if (harness.length) { console.log(`HARNESS PROBLEMS (${harness.length}):`); harness.forEach((l) => console.log('  HARN  ' + l)); console.log(''); }
  if (known.length) { console.log(`KNOWN FAILURES (${known.length}) — real bugs, listed in KNOWN_FAILURES:`); known.forEach(([l, why]) => console.log('  KNOWN ' + l + '\n        cause: ' + why)); console.log(''); }
  const fixed = KNOWN_FAILURES.filter((k) => !k.seen && (!k.viewport || WANT_VP.includes(k.viewport)) && (!k.suite || ONLY.includes(k.suite)));
  if (fixed.length) { console.log('FIXED? Known failures that did not occur this run — remove them from KNOWN_FAILURES:'); fixed.forEach((k) => console.log('  FIXED ' + k.match + ' — ' + k.why)); console.log(''); }
  if (unknown.length) { console.log(`FAILURES (${unknown.length}):`); unknown.forEach((l) => console.log('  FAIL  ' + l)); console.log(''); }
  if (results.notes.length && process.env.CLICK_VERBOSE) { console.log('NOTES:'); [...new Set(results.notes)].forEach((n) => console.log('  ' + n)); }
  if (process.env.CLICK_REPORT) {
    fs.writeFileSync(process.env.CLICK_REPORT, JSON.stringify({ coverage: cov, failures: results.failures, featureChecks, notes: [...new Set(results.notes)], clicks: results.clicks, external: [...results.external] }, null, 1));
    console.log('full log: ' + process.env.CLICK_REPORT);
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (unknown.length) { console.log(`CLICK TEST FAILED — ${unknown.length} unexpected failure(s).`); process.exit(1); }
  console.log('CLICK TEST PASSED' + (known.length ? ` (with ${known.length} known failure(s) still open)` : '') + '.');
  process.exit(0);
}

if (require.main === module) main().catch((e) => { console.error('harness crash:', e); process.exit(1); });
module.exports = { newSession, crmBoot, bootFor, startServer, settle, IDS, FIXTURES, chromium, BASE };
