/*
 * correspondence.js — extracted from crm-index-core.js (GL-037).
 *
 * VERBATIM move: the code below is byte-for-byte what was in the core, so
 * this diff is a relocation and nothing else.
 *
 * Loads AFTER crm-index-core.js and must stay a CLASSIC script — no defer,
 * async or type="module". Its top-level declarations become window
 * properties, which is how the inline on* handlers in index.html resolve
 * them. A module-scoped version would leave those handlers dead with no
 * error to show for it.
 *
 * Declares: glCorrEsc, glCorrWhen, glRenderCorrespondence, glShowEmailFull, ddpNudgeLead, glSyncGmail, glAutoSyncDue, glSyncCorrPanel, glAutoSyncContact, glWireCorrSync, glDedupeEmailRows, glCorrTime, glNoReplyFor, glLoadOutreachIndex, glOutreachBadge, glBusinessHoursSince, glSlaBadge, glSnoozeLead, glMarkLeadHandled, glCleanDomain, glLoadEmailLog, ddpLoadCorrespondence, editDealDetail, closeDealDetail, saveDealDetail, deleteDeal
 */
/* ═══════════════════════════════════════════
   SHARED CORRESPONDENCE RENDERING
   One renderer for all three email-thread panels (lead / Deal Details,
   lead email composer, client detail). They used to each build their own
   copy of this markup, which is how they drifted apart — fix it here and
   every panel gets the fix.
═══════════════════════════════════════════ */

// Rows are stashed per panel so the "open full email" popup can look one up
// by index without re-querying Supabase.
window.__glCorrRows = {};

function glCorrEsc(s){
  return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  });
}

function glCorrWhen(row){
  try {
    return new Date(row.sent_at || row.created_at)
      .toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  } catch(e){ return ''; }
}

// Builds the scrollable thread list. Each entry is clickable and opens the
// full stored message in a popup — the inline preview is deliberately clamped
// to two lines so a long email can't push the rest of the panel off screen.
function glRenderCorrespondence(key, rows){
  window.__glCorrRows[key] = rows || [];
  var inboundLabel = key === 'cde' ? '← FROM CLIENT' : '← FROM LEAD';
  var list = (rows || []).map(function(row, i){
    var inb = row.direction === 'inbound';
    var lbl = inb
      ? '<span style="font-size:10px;letter-spacing:1px;color:#6b9fff">' + inboundLabel + '</span>'
      : '<span style="font-size:10px;letter-spacing:1px;color:var(--muted)">→ SENT</span>';
    return '<div onclick="glShowEmailFull(\'' + key + '\',' + i + ')" title="Click to read the full message" ' +
        'style="background:' + (inb?'rgba(26,111,255,.07)':'rgba(255,255,255,.02)') + ';border:1px solid ' +
        (inb?'rgba(26,111,255,.25)':'rgba(255,255,255,.06)') + ';border-radius:6px;padding:8px 10px;cursor:pointer">' +
      '<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:3px">' + lbl +
        '<span style="font-size:10px;color:rgba(154,167,189,.6)">' + glCorrEsc(glCorrWhen(row)) + '</span></div>' +
      '<div style="font-size:12px;color:#fff;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
        glCorrEsc(row.subject || '(no subject)') + '</div>' +
      (row.body_preview
        ? '<div style="font-size:11px;color:#9aa7bd;line-height:1.4;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' +
            glCorrEsc(row.body_preview) + '</div>'
        : '') +
    '</div>';
  }).join('');
  // Fixed max height + overflow so a long thread scrolls inside the panel
  // instead of being cut off by it.
  return '<div style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;' +
    '-webkit-overflow-scrolling:touch;padding-right:2px">' + list + '</div>';
}

// Popup showing one message in full, scrollable. Sits above the client detail
// overlay (z 650) and the deal panel so it's never hidden behind them.
function glShowEmailFull(key, i){
  var rows = window.__glCorrRows[key] || [];
  var row = rows[i];
  if(!row) return;
  var prev = document.getElementById('gl-email-full');
  if(prev) prev.remove();
  var inb = row.direction === 'inbound';
  var who = inb ? ('From: ' + glCorrEsc(row.from_email || 'client'))
                : ('To: '   + glCorrEsc(row.to_email   || ''));
  var ov = document.createElement('div');
  ov.id = 'gl-email-full';
  ov.style.cssText = 'position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.95);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px';
  ov.innerHTML =
    '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;width:100%;max-width:620px;max-height:85vh;display:flex;flex-direction:column;padding:22px 24px;color:#fff">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:10px">' +
        '<div style="font-size:11px;letter-spacing:1.5px;color:' + (inb?'#6b9fff':'var(--teal)') + '">' +
          (inb ? '← RECEIVED' : '→ SENT') + '</div>' +
        '<button onclick="document.getElementById(\'gl-email-full\').remove()" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;line-height:1">&#x2715;</button>' +
      '</div>' +
      '<div style="font-size:16px;font-weight:700;line-height:1.35;margin-bottom:6px">' + glCorrEsc(row.subject || '(no subject)') + '</div>' +
      '<div style="font-size:11px;color:var(--muted);margin-bottom:14px">' + who + ' &middot; ' + glCorrEsc(glCorrWhen(row)) + '</div>' +
      '<div style="flex:1;overflow-y:auto;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:14px;font-size:13px;line-height:1.7;white-space:pre-wrap;color:#e8eef7">' +
        (row.body_preview ? glCorrEsc(row.body_preview) : '<span style="color:var(--muted);font-style:italic">No message text was stored for this email.</span>') +
      '</div>' +
      '<div style="font-size:10px;color:rgba(154,167,189,.55);margin-top:10px;line-height:1.5">' +
        'Shows the new message only — the quoted thread below a reply is not stored. ' +
        'Hit \u{1F504} Sync if an older entry still looks cluttered.' +
      '</div>' +
    '</div>';
  ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
}
window.glShowEmailFull = glShowEmailFull;

// Opens the Email Lead composer for the currently-selected deal and pre-fills
// a friendly follow-up nudge. Wired to the "✍️ Draft nudge" button in the
// Deal Details correspondence panel.
function ddpNudgeLead(){
  if(typeof openLeadEmailComposer !== 'function') return;
  var d = (deals[currentDealStage]||[])[currentDealIdx];
  openLeadEmailComposer();
  setTimeout(function(){
    var subjEl = document.getElementById('gl-lem-subject');
    var bodyEl = document.getElementById('gl-lem-body');
    if(!subjEl || !bodyEl || !d) return;
    var firstName = (d.contactName || '').split(' ')[0] || 'there';
    subjEl.value = 'Following up — Good Liquid Bev Co' + (d.co ? ' × ' + d.co : '');
    bodyEl.value =
      'Hi ' + firstName + ',\n\n' +
      'Just circling back on my last note — I know things get busy! I wanted to make sure it reached you and see if you’re still exploring co-packing for ' + (d.co || 'your brand') + '.\n\n' +
      'If now’s a good time, I’d be happy to set up a quick 20-minute call or a tour of our Palmetto facility. And if the timing isn’t right, just let me know and I’ll check back down the road.\n\n' +
      'Best,\nMike\nGood Liquid Bev Co\n(803) 493-5065';
    bodyEl.focus();
  }, 250);
}
window.ddpNudgeLead = ddpNudgeLead;

// Pulls email history in from Gmail via the gmail-sync edge function, so the
// correspondence panels can be refreshed from inside the app — no Supabase
// dashboard trip needed. Invoked through supa.functions.invoke so the signed-in
// staff JWT is sent (the function rejects anyone who isn't staff).
//
// Pass an address to sync just that contact (fast); omit it for a full sweep.
// Returns true when the sync succeeded so callers can reload their panel.
async function glSyncGmail(email, opts){
  opts = opts || {};
  if(!window.supa){ if(typeof addNotification==='function') addNotification('Sync unavailable','Not connected to the server.','warning'); return null; }
  var body = email ? { email: email, days: opts.days || 90, max: opts.max || 200 }
                   : { days: opts.days || 90, max: opts.max || 400 };
  try {
    var r = await window.supa.functions.invoke('gmail-sync', { body: body });
    // A failed invoke puts the reason in r.error; the function itself reports
    // trouble as { ok:false, error } with a 4xx/5xx.
    var errMsg = (r && r.error && (r.error.message || String(r.error))) ||
                 (r && r.data && r.data.ok === false && r.data.error) || '';
    if(errMsg){
      var friendly = /readonly|403/i.test(errMsg)
        ? 'Gmail read access isn’t enabled yet — see GMAIL_SYNC_SETUP.md (steps 1–3).'
        : errMsg;
      console.error('[GL] gmail-sync failed', errMsg);
      if(!opts.silent && typeof addNotification==='function') addNotification('Email sync failed', friendly, 'warning');
      glSyncGmail.lastError = friendly;
      return null;
    }
    var d = (r && r.data) || {};
    // New mail means the pipeline badges are stale; force a reload next render.
    if(typeof renderKanban === 'function') renderKanban._outreachAt = 0;
    var msg = (d.inserted || 0) + ' new, ' + (d.skipped || 0) + ' already logged';
    // Say when existing entries were filled out, otherwise a sync that only
    // repaired truncated bodies looks like it did nothing.
    if(d.upgraded) msg += ', ' + d.upgraded + ' filled out in full';
    // Background/automatic syncs stay quiet unless they actually found something,
    // so the notification bell isn't full of "0 new" every 15 minutes.
    var announce = !opts.silent || (d.inserted || 0) > 0;
    if(announce && typeof addNotification==='function') addNotification('📧 Email sync complete', msg, 'success');
    // Return the payload so callers can show the real counts. Truthy on
    // success, null on failure, so existing truthiness checks still work.
    return d;
  } catch(e){
    console.error('[GL] gmail-sync threw', e);
    glSyncGmail.lastError = String(e && e.message || e);
    if(!opts.silent && typeof addNotification==='function') addNotification('Email sync failed', glSyncGmail.lastError, 'warning');
    return null;
  }
}
window.glSyncGmail = glSyncGmail;

// Throttle for automatic syncing: returns true at most once per `minutes` for a
// given key, and records the attempt. Keeps the background sync from firing on
// every render (and stops the panel reload below from looping).
function glAutoSyncDue(key, minutes){
  try {
    var k = 'gl_sync_' + key;
    var last = parseFloat(localStorage.getItem(k) || '0');
    if(Date.now() - last < minutes * 60000) return false;
    localStorage.setItem(k, String(Date.now()));
    return true;
  } catch(e){ return true; }  // private mode / no storage: just allow it
}
window.glAutoSyncDue = glAutoSyncDue;

// AUTOMATIC EMAIL SYNC
// Keeps correspondence current without anyone pressing a button: a small recent
// sweep shortly after the CRM opens, then every 15 minutes while the tab is
// open. Deliberately narrow (last 3 days, capped) so it stays cheap; the manual
// button remains for a deep backfill. Silent unless it actually files something.
(function glAutoSyncBoot(){
  function tick(){
    if(!window.currentUser || !window.supa) return;      // only for signed-in staff
    if(document.hidden) return;                          // don't work in a background tab
    // Belt-and-braces for scheduled email: pg_cron fires email-scheduler every
    // 15 minutes server-side, but if that plumbing ever breaks again (it has,
    // silently, for hours) this ping keeps due follow-ups going out whenever
    // the CRM is open. The function accepts a staff JWT precisely for this.
    if(glAutoSyncDue('sched', 20)){
      try { supa.functions.invoke('email-scheduler', { body: {} }).catch(function(){}); } catch(e){}
    }
    if(!glAutoSyncDue('recent', 15)) return;
    glSyncGmail(null, { days: 3, max: 120, silent: true });
  }
  setTimeout(tick, 8000);
  setInterval(tick, 15 * 60000);
})();

// Click handler for the 🔄 Sync button in a correspondence panel header:
// syncs just this contact, then reloads whichever panel asked for it.
async function glSyncCorrPanel(btn, email, panel, id){
  if(!btn) return;
  var orig = btn.textContent;
  btn.disabled = true; btn.textContent = '🔄 Syncing…';
  var ok = await glSyncGmail(email);
  btn.disabled = false; btn.textContent = orig;
  if(!ok) return;
  if(panel === 'cde'){
    var c = (window.clients||[]).find(function(x){ return x.id === id; });
    if(c) cdeLoadCorrespondence(c);
  } else if(panel === 'ddp'){
    var d = (deals[currentDealStage]||[])[currentDealIdx];
    if(d) ddpLoadCorrespondence(d);
  }
}
window.glSyncCorrPanel = glSyncCorrPanel;

// Opening a client or lead quietly refreshes just that contact's mail in the
// background, so the thread is current the moment you look at it — no button.
// Throttled per contact, and the panel is only re-rendered if something new
// was actually filed (which also stops a render -> sync -> render loop).
function glAutoSyncContact(email, panel, id){
  if(!email || !window.supa || !window.currentUser) return;
  if(!glAutoSyncDue('c_' + String(email).toLowerCase(), 15)) return;
  glSyncGmail(email, { days: 90, max: 100, silent: true }).then(function(res){
    if(!res || !(res.inserted > 0)) return;
    if(panel === 'cde'){
      var c = (window.clients||[]).find(function(x){ return x.id === id; });
      // Only refresh if the user is still looking at this client.
      if(c && document.getElementById('client-detail-overlay')) cdeLoadCorrespondence(c);
    } else if(panel === 'ddp'){
      var d = (deals[currentDealStage]||[])[currentDealIdx];
      if(d && d.email === email) ddpLoadCorrespondence(d);
    }
  });
}
window.glAutoSyncContact = glAutoSyncContact;

// Attaches the Sync handler to a freshly-rendered correspondence panel. Values
// are captured in this closure rather than written into an HTML attribute, so
// an address containing a quote can never break the button.
function glWireCorrSync(box, email, panel, id){
  if(!box) return;
  var btn = box.querySelector('.gl-corr-sync');
  if(!btn) return;
  btn.addEventListener('click', function(){ glSyncCorrPanel(btn, email, panel, id); });
}
window.glWireCorrSync = glWireCorrSync;

// Resilient email_log loader shared by the lead (Deal Details), lead composer,
// and client correspondence panels. Older databases may not have run the
// inbound-email migration (the `direction` / `from_email` columns), which made
// the strict column-list + OR-filter query fail outright ("Could not load
// correspondence"). This selects `*` (so a missing column can't break the
// SELECT) and, if the two-direction OR filter errors, falls back to matching
// on `to_email` alone — the always-present core column — so outbound history
// still shows. Returns { rows, error }.
// Collapses rows that are the SAME message logged twice — one written by the
// CRM when it sent the mail, one pulled back out of Gmail by gmail-sync. The
// sync now avoids creating these, but rows logged before that fix are already
// in the table, so we also merge them on the way out: same subject (ignoring a
// Re:/Fwd: prefix), same side of the conversation, within ten minutes.
//
// Doing it here rather than deleting rows means no destructive cleanup is
// needed, and the counts, nudge logic and thread all agree because every panel
// reads through this one loader.
function glDedupeEmailRows(rows){
  var norm = function(v){
    return String(v == null ? '' : v).replace(/^\s*(re|fwd|fw)\s*:\s*/gi, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  };
  var when = function(x){ return Date.parse(x && (x.sent_at || x.created_at) || '') || 0; };
  var kept = [];
  (rows || []).forEach(function(row){
    var rSub = norm(row.subject);
    var rIn  = row.direction === 'inbound';
    var rAt  = when(row);
    var dupOf = null;
    for(var i = 0; i < kept.length; i++){
      var k = kept[i];
      if(norm(k.subject) !== rSub) continue;
      if((k.direction === 'inbound') !== rIn) continue;   // a reply is NOT a duplicate
      if(Math.abs(when(k) - rAt) > 10 * 60000) continue;
      dupOf = i; break;
    }
    if(dupOf === null){ kept.push(row); return; }
    // Same message twice: keep whichever copy has more of the body, since the
    // CRM stores the full text while Gmail only gives a short snippet.
    var a = kept[dupOf], aLen = (a.body_preview || '').length, bLen = (row.body_preview || '').length;
    if(bLen > aLen) kept[dupOf] = row;
  });
  // Order by when the email was actually SENT, newest first. Ordering by
  // created_at (row insert time) put the thread out of sequence, because the
  // Gmail sync files a reply long after the CRM logged the messages either side
  // of it. That also made the nudge below pick the wrong "last email".
  kept.sort(function(a, b){ return glCorrTime(b) - glCorrTime(a); });
  return kept;
}

// Timestamp for ordering / nudge maths: the send time, falling back to when the
// row was created for older rows that never had one.
function glCorrTime(row){
  var t = Date.parse((row && (row.sent_at || row.created_at)) || '');
  return Number.isFinite(t) ? t : 0;
}
window.glCorrTime = glCorrTime;

// Shared "they haven't replied" check for the lead and client panels — one
// implementation so the two can't drift apart.
// Returns { days } when the newest OUTBOUND email has had no inbound reply
// after it for 3+ days, otherwise null.
function glNoReplyFor(rows){
  var outs = (rows || []).filter(function(x){ return x.direction !== 'inbound'; });
  if(!outs.length) return null;
  // Newest by send time, not by position in the array.
  var lastOutAt = Math.max.apply(null, outs.map(glCorrTime));
  if(!lastOutAt) return null;
  var replied = (rows || []).some(function(x){
    return x.direction === 'inbound' && glCorrTime(x) > lastOutAt;
  });
  if(replied) return null;
  var days = Math.floor((Date.now() - lastOutAt) / 86400000);
  return days >= 3 ? { days: days } : null;
}
window.glNoReplyFor = glNoReplyFor;

// OUTREACH INDEX (for the pipeline board)
// One query builds a per-contact summary of email_log, so a kanban card can
// show follow-up state at a glance without a query per card (32 deals would
// otherwise mean 32 round trips on every render).
window.GL_OUTREACH = window.GL_OUTREACH || {};
async function glLoadOutreachIndex(){
  if(!window.supa) return false;
  var r = await window.supa.from('email_log')
    .select('to_email, from_email, direction, sent_at, created_at')
    .order('created_at', { ascending: false }).limit(2000);
  if(r.error){ console.warn('[GL] outreach index failed', r.error); return false; }
  var idx = {};
  (r.data || []).forEach(function(row){
    var inbound = row.direction === 'inbound';
    var raw = String((inbound ? row.from_email : row.to_email) || '');
    var t = glCorrTime(row);
    // to_email may hold several recipients; index the contact under each.
    raw.split(/[,;]/).forEach(function(part){
      var a = part.trim().replace(/^[^<]*</, '').replace(/>.*$/, '').toLowerCase();
      if(!a || a.indexOf('@') < 0) return;
      var e = idx[a] || (idx[a] = { lastOut: 0, lastIn: 0, outTimes: [] });
      if(inbound){ if(t > e.lastIn) e.lastIn = t; }
      else { if(t > e.lastOut) e.lastOut = t; e.outTimes.push(t); }
    });
  });
  // How many emails we have sent since their most recent reply.
  Object.keys(idx).forEach(function(a){
    var e = idx[a];
    e.sinceReply = e.outTimes.filter(function(t){ return t > e.lastIn; }).length;
  });
  window.GL_OUTREACH = idx;
  return true;
}
window.glLoadOutreachIndex = glLoadOutreachIndex;

// Compact kanban badge answering "where does this lead stand?" without opening
// it: whether they replied, whether we already nudged, and how long ago.
function glOutreachBadge(email){
  if(!email) return '';
  var e = (window.GL_OUTREACH || {})[String(email).trim().toLowerCase()];
  if(!e || !e.lastOut) return '';
  var pill = function(color, label){
    return '<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;' +
      'background:' + color + '22;color:' + color + ';border:1px solid ' + color + '55;white-space:nowrap">' +
      label + '</span>';
  };
  if(e.lastIn > e.lastOut) return pill('#1D9E75', '\u2713 replied');
  var days = Math.floor((Date.now() - e.lastOut) / 86400000);
  var ago = days <= 0 ? 'today' : (days === 1 ? '1d ago' : days + 'd ago');
  if(e.sinceReply >= 2){
    // First email plus at least one follow-up: they have been nudged.
    return pill('#c4a4f8', '\u270D\uFE0F nudged ' + ago + (e.sinceReply > 2 ? ' \u00D7' + e.sinceReply : ''));
  }
  return pill('#6b87ad', '\u2709\uFE0F sent ' + ago);
}
window.glOutreachBadge = glOutreachBadge;

// "Awaiting first reply" badge — the visual half of the SLA watchdog. Shows on a
// lead we have not yet replied to once more than one business day has passed,
// unless it's been snoozed or marked handled. Mirrors the server-side rule so
// the board and the WhatsApp alert agree on who is overdue.
function glBusinessHoursSince(iso){
  if(!iso) return 0;
  var start = new Date(iso).getTime(); if(!start) return 0;
  var now = Date.now(); if(now <= start) return 0;
  var hrs = 0, cur = new Date(start);
  // Cap the walk so a very old lead doesn't loop forever; 30 business days is
  // far past the 24-hour threshold we care about.
  var guard = 0;
  while(cur.getTime() < now && guard < 24*45){
    var dow = cur.getUTCDay();
    if(dow !== 0 && dow !== 6) hrs++;
    cur.setUTCHours(cur.getUTCHours()+1);
    guard++;
  }
  return hrs;
}
function glSlaBadge(d){
  if(!d) return '';
  if(d.handledAt) return '';
  if(d.snoozedUntil && new Date(d.snoozedUntil).getTime() > Date.now()) return '';
  if(d.firstResponseAt) return '';
  // If our outreach index shows we've emailed them, treat as replied-to.
  var e = d.email && (window.GL_OUTREACH || {})[String(d.email).split(/[,;]/)[0].trim().toLowerCase()];
  if(e && e.lastOut) return '';
  if(glBusinessHoursSince(d.createdAt) < 24) return '';
  var c = '#e74c3c';
  return '<span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:800;background:'+c+'22;color:'+c+';border:1px solid '+c+'66;white-space:nowrap">⚠️ awaiting reply</span>';
}
window.glSlaBadge = glSlaBadge;

// Snooze / mark-handled: the desk equivalents of the one-tap phone links. Both
// tell the lead-automations watchdog to stop nagging about this lead — snooze
// for a week, handled indefinitely. .select() so an RLS-silent write is caught.
async function glSnoozeLead(id){
  if(!id || !window.supa) return;
  var until = new Date(Date.now()+7*86400000).toISOString();
  try {
    var r = await window.supa.from('deals').update({snoozed_until:until}).eq('id',id).select('id');
    if(r.error || !r.data || !r.data.length){ if(typeof addNotification==='function') addNotification('Snooze failed','Could not save — try again.','warning'); return; }
    if(typeof addNotification==='function') addNotification('💤 Lead snoozed','No nudges for 7 days.','success');
    var d = (deals[currentDealStage]||[])[currentDealIdx]; if(d) d.snoozedUntil = until;
    if(typeof renderKanban==='function') renderKanban();
    if(typeof openDealDetail==='function' && currentDealStage!=null) openDealDetail(currentDealStage,currentDealIdx);
  } catch(e){}
}
async function glMarkLeadHandled(id){
  if(!id || !window.supa) return;
  var now = new Date().toISOString();
  try {
    var r = await window.supa.from('deals').update({handled_at:now}).eq('id',id).select('id');
    if(r.error || !r.data || !r.data.length){ if(typeof addNotification==='function') addNotification('Update failed','Could not save — try again.','warning'); return; }
    if(typeof addNotification==='function') addNotification('✓ Marked handled','Automations will leave it alone.','success');
    var d = (deals[currentDealStage]||[])[currentDealIdx]; if(d) d.handledAt = now;
    if(typeof renderKanban==='function') renderKanban();
    if(typeof openDealDetail==='function' && currentDealStage!=null) openDealDetail(currentDealStage,currentDealIdx);
  } catch(e){}
}
window.glSnoozeLead = glSnoozeLead;
window.glMarkLeadHandled = glMarkLeadHandled;
window.glDedupeEmailRows = glDedupeEmailRows;

// Free/consumer email providers — a lead's own address may be at one of these,
// but we must NEVER treat the domain as "their company" or we'd cross-wire every
// gmail lead's thread together.
var GL_FREE_EMAIL_DOMAINS = {
  'gmail.com':1,'googlemail.com':1,'yahoo.com':1,'ymail.com':1,'yahoo.co.uk':1,
  'hotmail.com':1,'outlook.com':1,'live.com':1,'msn.com':1,'aol.com':1,
  'icloud.com':1,'me.com':1,'mac.com':1,'proton.me':1,'protonmail.com':1,
  'gmx.com':1,'zoho.com':1,'mail.com':1,'comcast.net':1,'verizon.net':1,'att.net':1,'sbcglobal.net':1
};
function glCleanDomain(d){
  return String(d||'').toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0].split('?')[0].trim();
}

// Load the email thread for a lead/client. Matches the exact address AND anyone
// at the same COMPANY: a client often starts on one address and later writes
// from another at the same domain — matching only the exact address silently
// dropped half the thread (and left the brief blind to it). We match the
// company email domain (from the address and/or an optional website), plus a
// distinctive token from the company name, but never a free provider.
//   opts = { co: 'Company Name', domains: ['company.com', ...] }
async function glLoadEmailLog(email, opts){
  var sb = window.supa;
  if(!sb || !email) return { rows: [], error: null };
  opts = opts || {};
  var esc = function(s){ return String(s).replace(/%/g,'\\%').replace(/_/g,'\\_'); };
  // A lead's email field can hold several addresses ("a@x.com,b@x.com"); split
  // so each is matched on its own (and contributes its own company domain).
  var addrs = String(email).toLowerCase().split(/[,;]/).map(function(s){ return s.trim(); })
              .filter(function(s){ return s.indexOf('@') >= 0; });
  if(!addrs.length) return { rows: [], error: null };
  var conds = [];
  addrs.forEach(function(a){
    conds.push('to_email.ilike.%' + esc(a) + '%');
    conds.push('from_email.ilike.%' + esc(a) + '%');
  });

  var domains = [];
  var addDomain = function(d){
    d = glCleanDomain(d);
    if(d && d.indexOf('.') > 0 && !GL_FREE_EMAIL_DOMAINS[d] && domains.indexOf(d) < 0) domains.push(d);
  };
  addrs.forEach(function(a){ addDomain(a.split('@')[1] || ''); });
  (opts.domains || []).forEach(addDomain);
  domains.forEach(function(d){
    conds.push('to_email.ilike.%@' + esc(d) + '%');
    conds.push('from_email.ilike.%@' + esc(d) + '%');
  });

  // Company-name token → match against the domain part (catches the case where
  // the lead's on-file address is a personal gmail but they also write from the
  // company domain). Conservative: needs a distinctive 6+ char token.
  if(opts.co){
    var tok = String(opts.co).toLowerCase().replace(/[^a-z0-9]/g,'');
    ['llc','inc','corp','ltd','company','beverages','beverage','brands','brand','drinks','drink'].forEach(function(sfx){
      if(tok.length > sfx.length + 3 && tok.slice(-sfx.length) === sfx) tok = tok.slice(0, -sfx.length);
    });
    if(tok.length >= 6){
      conds.push('to_email.ilike.%@%' + esc(tok) + '%');
      conds.push('from_email.ilike.%@%' + esc(tok) + '%');
    }
  }

  var r = await sb.from('email_log').select('*')
    .or(conds.join(','))
    .order('created_at', { ascending: false }).limit(80);
  if(!r.error) return { rows: glDedupeEmailRows(r.data || []), error: null };
  console.warn('[GL] email_log OR query failed; retrying on to_email only', r.error);
  var r2 = await sb.from('email_log').select('*')
    .ilike('to_email', '%' + esc(addrs[0]) + '%')
    .order('created_at', { ascending: false }).limit(50);
  if(!r2.error) return { rows: glDedupeEmailRows(r2.data || []), error: null };
  console.error('[GL] email_log load failed', r2.error);
  return { rows: [], error: r2.error };
}
window.glLoadEmailLog = glLoadEmailLog;

async function ddpLoadCorrespondence(d){
  var box = document.getElementById('ddp-corr');
  if(!box) return;
  if(!d || !d.email){
    box.innerHTML = '<div style="font-size:11px;color:var(--muted)">Add an email address to this lead to track correspondence.</div>';
    return;
  }
  if(!window.supa){ box.innerHTML = ''; return; }
  box.innerHTML = '<div style="font-size:11px;color:var(--muted)">Loading correspondence…</div>';
  var _res = await glLoadEmailLog(d.email, { co: d.co });
  if(_res.error){ box.innerHTML = '<div style="font-size:11px;color:#ff8579">Could not load correspondence.</div>'; return; }
  var rows = _res.rows;

  var header = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
      '<span style="font-size:10px;letter-spacing:2px;color:var(--teal)">📧 CORRESPONDENCE' + (rows.length ? ' (' + rows.length + ')' : '') + '</span>' +
      '<span style="display:flex;gap:6px">' +
        // Wired with addEventListener below, not an inline onclick: embedding an
        // email address in an HTML attribute is a quoting trap (a stray quote
        // silently truncates the attribute and kills the handler).
        '<button class="gl-corr-sync" title="Pull the latest email in from Gmail" style="font-size:11px;padding:4px 10px;background:rgba(255,255,255,.05);color:var(--muted);border:1px solid rgba(255,255,255,.12);border-radius:6px;cursor:pointer">🔄 Sync</button>' +
        '<button onclick="openLeadEmailComposer()" style="font-size:11px;padding:4px 12px;background:rgba(26,111,255,.15);color:#6b9fff;border:1px solid rgba(26,111,255,.35);border-radius:6px;cursor:pointer">✉️ New email</button>' +
      '</span>' +
    '</div>';

  // Draft-nudge is ALWAYS available — Mike decides when to reach out. The amber
  // "no reply in N days" note only appears when we're genuinely waiting on them.
  var stale = glNoReplyFor(rows);
  var nudgeNote = stale
    ? '<span style="font-size:12px;color:#f5c842;line-height:1.4">⏰ No reply in ' + stale.days + ' days.</span>'
    : '<span style="font-size:12px;color:var(--muted);line-height:1.4">Draft a follow-up whenever you like.</span>';
  var nudge = '<div style="background:' + (stale ? 'rgba(245,200,66,.08)' : 'rgba(255,255,255,.03)') + ';border:1px solid ' + (stale ? 'rgba(245,200,66,.3)' : 'rgba(255,255,255,.1)') + ';border-radius:8px;padding:10px 12px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
      nudgeNote +
      '<button onclick="ddpNudgeLead()" style="font-size:12px;white-space:nowrap;padding:5px 13px;background:rgba(245,200,66,.18);color:#f5c842;border:1px solid rgba(245,200,66,.45);border-radius:6px;cursor:pointer;font-weight:700">✍️ Draft nudge</button>' +
    '</div>';

  if(!rows.length){
    box.innerHTML = header + nudge + '<div style="font-size:11px;color:var(--muted)">No emails logged for this lead yet. Use 🔄 Sync to pull history in from Gmail.</div>';
    glWireCorrSync(box, d.email, 'ddp');
    glAutoSyncContact(d.email, 'ddp');
    return;
  }

  box.innerHTML = header + nudge + glRenderCorrespondence('ddp', rows);
  glWireCorrSync(box, d.email, 'ddp');
  glAutoSyncContact(d.email, 'ddp');
}
