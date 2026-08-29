/*
 * calendar-xss.test.cjs — stored-XSS regression guard for the day-event panel.
 *
 * WHY THIS EXISTS
 * ---------------
 * cal_events rows for tours are written from the PUBLIC tour-booking form:
 * booking-confirm accepts booker_name / notes from an anonymous caller, and
 * booking-approve writes them into the event as `Meeting: ${booker_name}` plus
 * a notes block. src/modules/pipeline/calendar.js used to concatenate ev.title and ev.notes into
 * innerHTML, so a stranger could book a tour whose name contained an <img
 * onerror> payload and get script execution in a staff session the next time
 * any staff member clicked that day — the origin holding the staff JWT.
 * CLAUDE.md rule 5 records the same shape happening once already via the
 * public quote form.
 *
 * Every other calendar renderer escapes (index.html renderCal / renderCalList,
 * src/modules/pipeline/scheduling.js). This file was the one gap, which is what made it easy to
 * miss — so the guard is a test rather than a comment.
 *
 * Run:  NODE_PATH=<playwright>/node_modules node tests/calendar-xss.test.cjs
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const CALENDAR_JS = path.join(__dirname, '..', 'src/modules/pipeline/calendar.js');

/* Payloads a booker could put in booker_name or the tour questionnaire notes.
   Each sets window.__xss if the browser ever parses it as markup. */
const PAYLOADS = [
  '<img src=x onerror="window.__xss=1">',
  '<script>window.__xss=1<\/script>',
  '"><svg/onload="window.__xss=1">',
  "<iframe srcdoc='<script>parent.__xss=1<\/script>'></iframe>",
];

/*
 * The harness carries NO payload. Interpolating one into an inline <script>
 * cannot be done safely here: JSON.stringify does not escape "</script>", so a
 * payload containing it terminates the harness's own script tag early and the
 * page silently fails to render — which is exactly what the first CI run of
 * this file hit. Payloads are handed to the page as page.evaluate arguments
 * instead, so they never transit an HTML parser on the way in.
 */
const HARNESS = (calendarSrc) => `<!doctype html>
<html><body>
  <div id="cal-event-modal">
    <div class="modal-box"><div class="modal-title">x&nbsp;</div></div>
  </div>
  <script>
    window.__xss = 0;
    // index.html declares calEvents as a top-level let; src/modules/pipeline/calendar.js reads it
    // through a typeof guard, so a plain global reproduces the real lookup.
    var calEvents = [];
    window.openCalEventModal = function(){};   // the base impl src/modules/pipeline/calendar.js wraps
  <\/script>
  <script>${calendarSrc}<\/script>
</body></html>`;

/* Load one event carrying the payload, open the panel, and report what happened. */
async function render(page, calendarSrc, title, notes) {
  await page.setContent(HARNESS(calendarSrc));
  return page.evaluate(([t, n]) => {
    window.__xss = 0;
    window.__threw = null;
    calEvents.length = 0;
    calEvents.push({ id: 'evt-1', date: '2026-09-01', type: 'tour', time: '10:00', title: t, notes: n });
    try { window.openCalEventModal('general', '2026-09-01'); }
    catch (e) { window.__threw = String(e); }
    const p = document.querySelector('#gl-cal-day-panel');
    return {
      xss: window.__xss,
      threw: window.__threw,
      injected: !!document.querySelector('#gl-cal-day-panel img, #gl-cal-day-panel svg, #gl-cal-day-panel iframe, #gl-cal-day-panel script'),
      text: p ? p.textContent : '',
      rendered: !!p,
    };
  }, [title, notes]);
}

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
    let r = await render(page, calendarSrc, 'Meeting: ' + payload, 'ordinary note');
    // Render FIRST: if the panel never appeared, "no script ran" is vacuous.
    check('title: panel actually rendered — ' + label, r.rendered && !r.threw,
      r.threw || 'no #gl-cal-day-panel in the document');
    check('title: no script executed', !r.xss);
    check('title: no element injected', !r.injected);
    check('title: payload displayed as literal text', r.text.includes(payload),
      'panel text was: ' + JSON.stringify(r.text.slice(0, 140)));

    // 2. payload in the event NOTES (the tour questionnaire free-text field)
    r = await render(page, calendarSrc, 'Meeting: Acme Beverages', payload);
    check('notes: panel actually rendered', r.rendered && !r.threw,
      r.threw || 'no #gl-cal-day-panel in the document');
    check('notes: no script executed', !r.xss);
    check('notes: no element injected', !r.injected);
    check('notes: payload displayed as literal text', r.text.includes(payload),
      'panel text was: ' + JSON.stringify(r.text.slice(0, 140)));
  }

  // The panel must still do its actual job.
  const benign = await render(page, calendarSrc, 'Meeting: Acme Beverages', 'Bring samples');
  const hasDelete = await page.evaluate(() =>
    !!Array.from(document.querySelectorAll('#gl-cal-day-panel button'))
      .find(b => b.textContent.includes('Delete')));
  console.log('');
  check('benign event still renders its title', benign.text.includes('Acme Beverages'));
  check('benign event still renders its notes', benign.text.includes('Bring samples'));
  check('delete button still present', hasDelete);
  check('event count header still rendered', benign.text.includes('1 event on this day'));

  await browser.close();
  console.log('\n' + (failures === 0 ? 'ALL PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
