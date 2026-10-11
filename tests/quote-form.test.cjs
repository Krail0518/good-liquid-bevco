/*
 * quote-form.test.cjs — the public "Request a quote" form tells the truth.
 *
 * From 2026-08-28 every submission failed server-side (submit_quote_request
 * raised 42501) while the page showed "Sent!" because Formspree had accepted
 * an email copy. Formspree is gone; "Sent" now means the lead was saved.
 *
 * Fills in the real form on the page and clicks the real button, with the
 * Supabase RPC stubbed (no network), and checks:
 *   - success → the "Sent!" message, and the RPC got the full payload
 *   - a server refusal → the server's message, never "Sent!"
 *   - an unexpected error → "did not go through" + the direct address
 *   - nothing is ever posted to formspree.io
 *
 *   NODE_PATH=/tmp/pw/node_modules node tests/quote-form.test.cjs
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = process.env.REPO_ROOT || path.resolve(__dirname, '..');
const PORT = Number(process.env.QUOTE_FORM_PORT || 8795);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

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

const failures = [];
function check(name, ok, detail) {
  if (ok) console.log(`  PASS: ${name}`);
  else { console.log(`  FAIL: ${name}${detail ? ' — ' + detail : ''}`); failures.push(name); }
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const formspreeHits = [];
  page.on('request', (r) => { if (/formspree\.io/i.test(r.url())) formspreeHits.push(r.url()); });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);

    // outcome: 'ok' | 'refused' | 'boom'
    const run = async (outcome) => {
      await page.evaluate((outcome) => {
        window.__rpcCalls = [];
        const rpc = async (fn, args) => {
          window.__rpcCalls.push({ fn, args });
          if (outcome === 'ok') return { data: '11111111-1111-1111-1111-111111111111', error: null };
          if (outcome === 'refused') return { data: null, error: { message: 'We already have your request — Mike will be in touch shortly.' } };
          return { data: null, error: { message: 'Not authorized to send quote decks', code: '42501' } };
        };
        window.supa = Object.assign({}, window.supa || {}, { rpc });
        try { supa = window.supa; } catch (e) { /* not a global binding */ }
        const ok = document.getElementById('form-ok'); if (ok) ok.style.display = 'none';
        const err = document.getElementById('form-err'); if (err) { err.style.display = 'none'; err.textContent = ''; }
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.value = v; };
        set('qf-brand', 'Test Brand'); set('qf-name', 'Test Person'); set('qf-email', 'test.person@example.com');
        set('qf-phone', '(555) 555-0100'); set('qf-details', 'We want a pilot run of a sparkling tea.');
        document.querySelectorAll('#qf-service-group input, #qf-product-group input').forEach((cb) => { cb.checked = false; });
        document.getElementById('svc-can').checked = true;
        const pt = document.querySelector('#qf-product-group input[type="checkbox"]:not([value="Other"])');
        if (pt) pt.checked = true;
        const btn = document.querySelector('[data-gl-action="submitContactForm"]');
        btn.disabled = false; btn.textContent = 'Send inquiry →';
      }, outcome);
      page.once('dialog', (d) => d.dismiss());
      await page.click('[data-gl-action="submitContactForm"]');
      await page.waitForTimeout(600);
      return page.evaluate(() => {
        const vis = (id) => { const e = document.getElementById(id); return !!e && getComputedStyle(e).display !== 'none'; };
        return {
          sent: vis('form-ok'),
          errShown: vis('form-err'),
          errText: (document.getElementById('form-err') || {}).textContent || '',
          calls: window.__rpcCalls.map((c) => ({ fn: c.fn, keys: Object.keys((c.args && c.args.p) || {}).sort() })),
        };
      });
    };

    const ok = await run('ok');
    check('success: shows "Sent!"', ok.sent && !ok.errShown, JSON.stringify(ok));
    check('success: called submit_quote_request with the full form',
      ok.calls.length === 1 && ok.calls[0].fn === 'submit_quote_request' &&
      ['brand_name', 'contact_name', 'email', 'phone', 'details', 'service', 'product_type'].every((k) => ok.calls[0].keys.includes(k)),
      JSON.stringify(ok.calls));

    const refused = await run('refused');
    check('server refusal: shows the server\'s message, not "Sent!"', !refused.sent && refused.errShown && /already have your request/.test(refused.errText), JSON.stringify(refused));

    const boom = await run('boom');
    check('unexpected error: "did not go through" + direct address, not "Sent!"', !boom.sent && boom.errShown && /did not go through/.test(boom.errText) && /Mike@GoodLiquid\.com/i.test(boom.errText), JSON.stringify(boom));

    check('nothing is sent to Formspree', formspreeHits.length === 0, formspreeHits.join(', '));
  } finally {
    await browser.close();
    server.close();
  }
  if (failures.length) { console.log(`\n${failures.length} failure(s)`); process.exit(1); }
  console.log('\nall passed');
}

main().catch((e) => { console.error(e); process.exit(1); });
