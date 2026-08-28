/*
 * calendar-xss.test.cjs — stored-XSS regression guard for the day-event panel.
 *
 * WHY THIS EXISTS
 * ---------------
 * cal_events rows for tours are written from the PUBLIC tour-booking form:
 * booking-confirm accepts booker_name / notes from an anonymous caller, and
 * booking-approve writes them into the event as `Meeting: ${booker_name}` plus
 * a notes block. crm-calendar.js used to concatenate ev.title and ev.notes into
 * innerHTML, so a stranger could book a tour whose name contained an <img
 * onerror> payload and get script execution in a staff session the next time
 * any staff member clicked that day — the origin holding the staff JWT.
 * CLAUDE.md rule 5 records the same shape happening once already via the
 * public quote form.
 *
 * Every other calendar renderer escapes (index.html renderCal / renderCalList,
 * crm-scheduling.js). This file was the one gap, which is what made it easy to
 * miss — so the guard is a test rather than a comment.
 *
 * Run:  NODE_PATH=<playwright>/node_modules node tests/calendar-xss.test.cjs
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const CALENDAR_JS = path.join(__dirname, '..', 'crm-calendar.js');

/* Payloads a booker could put in booker_name or the tour questionnaire notes.
   Each sets window.__xss if the browser ever parses it as markup. */
const PAYLOADS = [
  '<img src=x onerror="window.__xss=1">',
  '<script>window.__xss=1<\/script>',
  '"><svg/onload="window.__xss=1">',
  "<iframe srcdoc='<script>parent.__xss=1<\/script>'></iframe>",
];

const HARNESS = (calendarSrc, title, notes) => `<!doctype html>
<html><body>
  <div id="cal-event-modal">
    <div class="modal-box"><div class="modal-title">x&nbsp;</div></div>
  </div>
  <script>
    window.__xss = 0;
    // index.html declares calEvents as a top-level let; crm-calendar.js reads it
    // through a typeof guard, so a plain global reproduces the real lookup.
    var calEvents = [{
      id: 'evt-1', date: '2026-09-01', type: 'tour',
      time: '10:00',
      title: ${JSON.stringify(title)},
      notes: ${JSON.stringify(notes)}
    }];
    window.openCalEventModal = function(){};   // the base impl crm-calendar.js wraps
  <\/script>
  <script>${calendarSrc}<\/script>
  <script>
    try { window.openCalEventModal('general', '2026-09-01'); }
    catch (e) { window.__threw = String(e); }
  <\/script>
</body></html>`;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log('  PASS  ' + name);
  else { console.log('  FAIL  ' + name + (detail ? '\n          ' + detail : '')); failures++; }
}

(async () => {
  const calendarSrc = fs.readFileSync(CALENDAR_JS, 'utf8');
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();

  console.log('calendar day-panel — stored XSS from the public booking form\n');

  for (const payload of PAYLOADS) {
    const label = payload.length > 42 ? payload.slice(0, 39) + '...' : payload;

    // 1. payload in the event TITLE (booking-approve writes `Meeting: <name>`)
    await page.setContent(HARNESS(calendarSrc, 'Meeting: ' + payload, 'ordinary note'));
    let fired = await page.evaluate(() => window.__xss);
    let threw = await page.evaluate(() => window.__threw || null);
    let injected = await page.evaluate(() =>
      !!document.querySelector('#gl-cal-day-panel img, #gl-cal-day-panel svg, #gl-cal-day-panel iframe, #gl-cal-day-panel script'));
    let shown = await page.evaluate(() => {
      const p = document.querySelector('#gl-cal-day-panel');
      return p ? p.textContent : '';
    });

    check('title: no script executed — ' + label, !fired);
    check('title: no element injected', !injected);
    check('title: panel rendered without throwing', !threw, threw || '');
    check('title: payload displayed as literal text', shown.includes(payload),
      'panel text was: ' + JSON.stringify(shown.slice(0, 120)));

    // 2. payload in the event NOTES (the tour questionnaire free-text field)
    await page.setContent(HARNESS(calendarSrc, 'Meeting: Acme Beverages', payload));
    fired = await page.evaluate(() => window.__xss);
    injected = await page.evaluate(() =>
      !!document.querySelector('#gl-cal-day-panel img, #gl-cal-day-panel svg, #gl-cal-day-panel iframe, #gl-cal-day-panel script'));
    shown = await page.evaluate(() => {
      const p = document.querySelector('#gl-cal-day-panel');
      return p ? p.textContent : '';
    });

    check('notes: no script executed — ' + label, !fired);
    check('notes: no element injected', !injected);
    check('notes: payload displayed as literal text', shown.includes(payload),
      'panel text was: ' + JSON.stringify(shown.slice(0, 120)));
  }

  // The panel must still do its actual job.
  await page.setContent(HARNESS(calendarSrc, 'Meeting: Acme Beverages', 'Bring samples'));
  const text = await page.evaluate(() => {
    const p = document.querySelector('#gl-cal-day-panel');
    return p ? p.textContent : '';
  });
  const hasDelete = await page.evaluate(() =>
    !!Array.from(document.querySelectorAll('#gl-cal-day-panel button'))
      .find(b => b.textContent.includes('Delete')));
  console.log('');
  check('benign event still renders its title', text.includes('Acme Beverages'));
  check('benign event still renders its notes', text.includes('Bring samples'));
  check('delete button still present', hasDelete);
  check('event count header still rendered', text.includes('1 event on this day'));

  await browser.close();
  console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
