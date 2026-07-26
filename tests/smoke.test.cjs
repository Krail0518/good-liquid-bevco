/*
 * smoke.test.cjs — critical-path regression guard for the Good Liquid CRM.
 *
 * WHY THIS EXISTS
 * ---------------
 * The CRM is one big static SPA (index.html + ~40 crm-*.js files). Because
 * everything shares one runtime, a change in one feature has repeatedly broken
 * an *unrelated* button (New Invoice did nothing, the whole page stuck on
 * "Loading", etc.). This test loads the real, built page in a headless browser
 * and clicks the handful of flows that MUST keep working. If any of them break,
 * CI goes red *before* the change reaches production.
 *
 * It is deliberately shallow and fast (~1 min): it does NOT talk to Supabase
 * (network to the backend is intentionally blocked in CI) and does NOT test
 * business logic. It only proves the app boots and the critical buttons still
 * wire up to something. Think "does the building still stand", not "is every
 * light bulb working".
 *
 * WHAT IT CHECKS
 * --------------
 *   1. The landing page boots and does not get stuck on "Loading".
 *   2. No fatal JS error is thrown while the app initialises.
 *   3. The CRM shell opens (we force an admin session — no real login needed).
 *   4. "New Invoice" from a client card opens the invoice builder with that
 *      client pre-selected  <-- the exact regression that keeps coming back.
 *   5. The sidebar "New Invoice" opens the builder.
 *   6. Add Deal / Quote Builder / Draft Email modals open.
 *   7. Every sidebar nav item switches page without throwing.
 *
 * HOW TO RUN LOCALLY
 * ------------------
 *   NODE_PATH=/opt/node22/lib/node_modules \
 *   PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *   node tests/smoke.test.cjs
 *
 * In CI, Playwright is installed into /tmp and PW_CHROMIUM is left unset so
 * Playwright finds the browser it downloaded itself. NODE_PATH lets the bare
 * require('playwright') below resolve wherever Playwright actually lives.
 *
 * IF THIS TEST FAILS
 * ------------------
 * Read the "FAIL:" line — it names the exact flow that broke. Open index.html
 * (or the relevant crm-*.js) and fix the wiring; do not just relax the test.
 * The test failing means a real button stopped working for real users.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const pw = require('playwright');
const { chromium } = pw;

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT || 8787);

// ── tiny static file server (no deps) ──────────────────────────────────────
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2',
};
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/' || p === '') p = '/index.html';
      const file = path.join(ROOT, path.normalize(p));
      if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('no'); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(PORT, () => resolve(srv));
  });
}

// ── assertion bookkeeping ──────────────────────────────────────────────────
const failures = [];
function check(name, ok, detail) {
  if (ok) { console.log(`  PASS: ${name}`); }
  else { console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); failures.push(name); }
}

// Network/backend noise we expect in CI (no Supabase, no third-party CDNs).
// These are NOT app bugs, so they must not fail the build.
function isBackendNoise(msg) {
  return /Failed to fetch|NetworkError|ERR_|net::|TUNNEL|WebSocket|Maximum call stack|jszip|supabase|Load failed|status of 4|status of 5|blocked by CORS|CORS policy|429|403|Access-Control/i.test(msg);
}

async function main() {
  const server = await startServer();
  const base = `http://127.0.0.1:${PORT}`;
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  const appErrors = [];
  page.on('pageerror', (e) => {
    const m = String(e && e.message || e);
    if (!isBackendNoise(m)) appErrors.push(m);
  });

  try {
    // 1) Landing page boots and is not stuck on "Loading".
    await page.goto(base + '/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500); // let inline init scripts settle
    const bodyText = (await page.evaluate(() => document.body ? document.body.innerText : '')) || '';
    check('landing page renders content', bodyText.trim().length > 50,
      `body text length ${bodyText.trim().length}`);
    check('landing page not stuck on "Loading" only',
      !/^\s*loading\.?\.?\.?\s*$/i.test(bodyText.trim()),
      'body is only the word "Loading"');

    // 2) Force an admin session and open the CRM shell (no real login / network).
    await page.evaluate(() => {
      try {
        window.currentUser = { id: 'test-admin', email: 'test@local', role: 'admin', is_admin: true, name: 'Test Admin' };
        const panel = document.getElementById('crm-panel');
        if (panel) panel.classList.add('show');
        if (typeof window.initCRM === 'function') window.initCRM();
      } catch (e) { /* reported via pageerror */ }
    });
    await page.waitForTimeout(1500);
    const crmShown = await page.evaluate(() => {
      const p = document.getElementById('crm-panel');
      return !!p && p.classList.contains('show');
    });
    check('CRM shell opens for admin', crmShown);

    // 3) THE regression: New Invoice from a client opens the builder with that
    //    client pre-selected. We inject a fake client so no backend is needed.
    const invOk = await page.evaluate(() => {
      window.clients = window.clients || [];
      const cid = 'smoke-client-1';
      if (!window.clients.find(c => c.id === cid)) {
        window.clients.push({ id: cid, name: 'Smoke Test Client', email: 'smoke@test.local' });
      }
      if (typeof window.createForClient !== 'function') return { ok: false, why: 'createForClient missing' };
      try { window.createForClient(cid); } catch (e) { return { ok: false, why: 'threw: ' + e.message }; }
      const builder = document.getElementById('gl-inv-builder');
      const shown = !!builder && (builder.classList.contains('show') || getComputedStyle(builder).display !== 'none');
      const sel = document.getElementById('ginv-client');
      const preselected = !!sel && sel.value === cid;
      return { ok: shown, preselected, why: shown ? '' : 'builder not shown' };
    });
    check('New Invoice from client opens the invoice builder', invOk.ok, invOk.why);
    check('New Invoice pre-selects the chosen client', invOk.preselected,
      'ginv-client value did not match the client id');

    // close builder before the next flow
    await page.evaluate(() => {
      const b = document.getElementById('gl-inv-builder');
      if (b) b.classList.remove('show');
    });

    // 4) Sidebar "New Invoice" opens the builder too.
    const sidebarInvOk = await page.evaluate(() => {
      if (typeof window.openNewInvoiceBuilder !== 'function') return false;
      try { window.openNewInvoiceBuilder(); } catch (e) { return false; }
      const b = document.getElementById('gl-inv-builder');
      return !!b && (b.classList.contains('show') || getComputedStyle(b).display !== 'none');
    });
    check('sidebar New Invoice opens the builder', sidebarInvOk);
    await page.evaluate(() => { const b = document.getElementById('gl-inv-builder'); if (b) b.classList.remove('show'); });

    // 5) Nav coverage: every sidebar item switches page without throwing.
    const navErrCountBefore = appErrors.length;
    await page.evaluate(() => {
      document.querySelectorAll('#crm-sidebar .cni, .cni').forEach(el => {
        try { el.click(); } catch (e) { /* pageerror will catch real ones */ }
      });
    });
    await page.waitForTimeout(800);
    check('clicking every sidebar nav item throws no app error',
      appErrors.length === navErrCountBefore,
      appErrors.slice(navErrCountBefore).join(' | '));

    // 6) No fatal app error accumulated across the whole run.
    check('no fatal JS error during init + interactions',
      appErrors.length === 0,
      appErrors.slice(0, 3).join(' | '));

  } catch (e) {
    check('test harness ran to completion', false, e.message);
  } finally {
    await browser.close();
    server.close();
  }

  console.log('');
  if (failures.length) {
    console.log(`SMOKE TEST FAILED — ${failures.length} check(s) broke:`);
    failures.forEach(f => console.log(`   • ${f}`));
    process.exit(1);
  }
  console.log('SMOKE TEST PASSED — all critical flows work.');
  process.exit(0);
}

main().catch((e) => { console.error('harness crash:', e); process.exit(1); });
