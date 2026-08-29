/*
 * time-tracking.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: glTimeEntriesBackfill, loadTimeEntries, openTimeTracker, closeTimeTracker, toggleTimer, resumeTimerDisplay, renderTimeTracker, deleteTimeEntry
 */
/* ═══════════════════════════════════════════
   TIME TRACKING PER JOB
   Source of truth is the public.time_entries table in Supabase
   (see 20260523_time_entries_table.sql). One row per timer
   session; ended_at = NULL means "still running" and a partial
   unique index enforces one running timer per user across devices.
   timeEntries / activeTimer kept as in-memory caches refreshed
   from the DB on every modal open so the timer + log stay in sync.
═══════════════════════════════════════════ */
let timeEntries = [];      // populated from public.time_entries on modal open
let activeTimer = null;    // mirror of the running row (ended_at IS NULL) if any
let timerInterval = null;
// Activity-type backfill: legacy localStorage timer entries didn't
// distinguish activity types beyond a free-text field. Fine to leave.

// One-shot migration of any legacy gl_time_entries + gl_active_timer
// blobs into the new table. Marks itself done in localStorage so it
// runs at most once per device.
async function glTimeEntriesBackfill(){
  try {
    if(localStorage.getItem('gl_time_entries_migrated') === '1') return;
    if(!window.supa || !window.currentUser) return; // try again later
    const userId = window.currentUser.id;
    if(!userId) return;
    const legacyEntriesBlob = localStorage.getItem('gl_time_entries');
    const legacyActiveBlob  = localStorage.getItem('gl_active_timer');
    if(!legacyEntriesBlob && !legacyActiveBlob){ localStorage.setItem('gl_time_entries_migrated','1'); return; }
    let legacyEntries = [];
    try { legacyEntries = JSON.parse(legacyEntriesBlob || '[]') || []; } catch(_e){}
    let legacyActive = null;
    try { legacyActive = JSON.parse(legacyActiveBlob || 'null'); } catch(_e){}
    const rows = [];
    // Push completed entries first. We don't have exact start/end
    // timestamps in localStorage — only a localized date string + a
    // seconds count — so place them at noon on that date and let the
    // duration math fill in the rest.
    legacyEntries.forEach(e => {
      const seconds = Number(e.seconds) || 0;
      let started;
      if(e.date){
        const d = new Date(e.date + ' 12:00:00');
        if(!isNaN(d.getTime())) started = d;
      }
      if(!started) started = new Date();
      const ended = new Date(started.getTime() + seconds*1000);
      rows.push({
        user_id:     userId,
        client_id:   /^[0-9a-f-]{36}$/i.test(e.clientId||'') ? e.clientId : null,
        client_name: e.clientName || null,
        activity:    e.activity || null,
        notes:       e.notes || null,
        started_at:  started.toISOString(),
        ended_at:    ended.toISOString(),
        seconds:     seconds,
        hours:       Number(e.hours) || (seconds/3600)
      });
    });
    // The active timer (if any) becomes a live row with ended_at=NULL.
    if(legacyActive && legacyActive.startMs){
      rows.push({
        user_id:     userId,
        client_id:   /^[0-9a-f-]{36}$/i.test(legacyActive.clientId||'') ? legacyActive.clientId : null,
        client_name: (clients.find(c => c.id === legacyActive.clientId)||{}).name || null,
        activity:    legacyActive.activity || null,
        notes:       legacyActive.notes || null,
        started_at:  new Date(legacyActive.startMs).toISOString(),
        ended_at:    null,
        seconds:     null,
        hours:       null
      });
    }
    if(!rows.length){ localStorage.setItem('gl_time_entries_migrated','1'); return; }
    const r = await window.supa.from('time_entries').insert(rows);
    if(r.error){
      console.warn('[GL] time_entries backfill failed; will retry on next load:', r.error.message);
      return;
    }
    localStorage.setItem('gl_time_entries_migrated','1');
    if(typeof addNotification === 'function'){
      addNotification('⏱️ Time entries migrated', rows.length + ' entr' + (rows.length===1?'y':'ies') + ' moved from device storage to the cloud.', 'success');
    }
  } catch(e){ console.warn('[GL] time_entries backfill threw', e); }
}

// Refresh in-memory cache from the DB. Called on every modal open
// + after every mutation so the UI never drifts from the source of
// truth.
async function loadTimeEntries(){
  if(!window.supa || !window.currentUser){ timeEntries = []; activeTimer = null; return; }
  await glTimeEntriesBackfill();
  const r = await window.supa.from('time_entries')
    .select('id, client_id, client_name, activity, notes, started_at, ended_at, seconds, hours')
    .eq('user_id', window.currentUser.id)
    .order('started_at', { ascending: false })
    .limit(200);
  if(r.error){ console.warn('[GL] loadTimeEntries failed', r.error.message); timeEntries = []; activeTimer = null; return; }
  const all = r.data || [];
  // Split: the row with ended_at == null is the live timer; everything
  // else is a completed entry. Keep the shape the legacy renderer
  // expects so we don't have to rewrite every read site.
  activeTimer = null;
  timeEntries = [];
  all.forEach(row => {
    if(row.ended_at === null){
      activeTimer = {
        id:        row.id,
        startMs:   new Date(row.started_at).getTime(),
        clientId:  row.client_id,
        activity:  row.activity,
        notes:     row.notes
      };
    } else {
      const seconds = row.seconds != null ? row.seconds : Math.floor((new Date(row.ended_at)-new Date(row.started_at))/1000);
      timeEntries.push({
        id:         row.id,
        clientId:   row.client_id,
        clientName: row.client_name || ((clients.find(c => c.id === row.client_id)||{}).name) || 'General',
        activity:   row.activity,
        notes:      row.notes,
        seconds:    seconds,
        hours:      row.hours != null ? Number(row.hours).toFixed(2) : (seconds/3600).toFixed(2),
        date:       new Date(row.started_at).toLocaleDateString()
      });
    }
  });
}

async function openTimeTracker() {
  // Refresh from DB before showing the modal so multi-device state
  // stays consistent (start a timer on your laptop, open the modal
  // on your phone, and it shows the timer running).
  await loadTimeEntries();
  const existing = document.getElementById('time-tracker-modal');
  if(existing) { existing.classList.add('show'); renderTimeTracker(); if(activeTimer) resumeTimerDisplay(); return; }

  const modal = document.createElement('div');
  modal.id = 'time-tracker-modal';
  modal.className = 'modal-ov show';
  modal.innerHTML = `
    <div class="modal-box" style="width:560px;max-height:80vh;overflow-y:auto">
      <div class="modal-title">⏱️ Time Tracking <span class="modal-close" data-gl-action="closeTimeTracker">✕</span></div>

      <div style="background:rgba(0,229,192,.06);border:1px solid rgba(0,229,192,.18);border-radius:12px;padding:18px;margin-bottom:18px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          <div class="frow">
            <div class="flbl">Client / Job</div>
            <select class="fsel" id="tt-client">
              <option value="">Select client…</option>
              ${clients.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="frow">
            <div class="flbl">Activity type</div>
            <select class="fsel" id="tt-activity">
              <option>Production Run</option>
              <option>R&D / Formulation</option>
              <option>Consulting</option>
              <option>Admin / Scheduling</option>
              <option>Sales / Client Comms</option>
            </select>
          </div>
        </div>
        <div class="frow"><div class="flbl">Notes</div><input class="finp" id="tt-notes" placeholder="What are you working on?"></div>
        <div style="display:flex;align-items:center;gap:12px;margin-top:12px">
          <div id="tt-display" style="font-family:var(--ff-disp);font-size:36px;letter-spacing:4px;color:var(--teal);min-width:120px">00:00:00</div>
          <button id="tt-start-btn" data-gl-action="toggleTimer" style="flex:1;padding:12px;background:var(--teal);color:var(--ink);border:none;border-radius:8px;font-weight:800;font-size:14px;cursor:pointer">▶ Start</button>
        </div>
      </div>

      <div>
        <div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:12px">RECENT TIME LOG</div>
        <div id="tt-log"></div>
        <div style="margin-top:12px;padding:12px;background:rgba(0,229,192,.06);border:1px solid rgba(0,229,192,.12);border-radius:8px" id="tt-summary"></div>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if(e.target === modal) closeTimeTracker(); });
  (document.getElementById('crm-panel')||document.body).appendChild(modal);
  renderTimeTracker();
  // If a timer was already running (started on this or another device),
  // restore the button state + tick.
  if(activeTimer){
    const btn = document.getElementById('tt-start-btn');
    if(btn){ btn.textContent = '⏹ Stop & Save'; btn.style.background = '#e74c3c'; }
    // Pre-fill the form so the user can see what's running.
    const cs = document.getElementById('tt-client'); if(cs && activeTimer.clientId) cs.value = activeTimer.clientId;
    const as = document.getElementById('tt-activity'); if(as && activeTimer.activity) as.value = activeTimer.activity;
    const ns = document.getElementById('tt-notes'); if(ns && activeTimer.notes) ns.value = activeTimer.notes;
    resumeTimerDisplay();
  }
}

function closeTimeTracker() {
  const m = document.getElementById('time-tracker-modal');
  if(m) m.classList.remove('show');
}

async function toggleTimer() {
  if(!window.supa || !window.currentUser){ alert('Cloud sync unavailable — try reloading.'); return; }
  if(activeTimer) {
    // Stop: update the existing running row with ended_at + duration.
    const endMs = Date.now();
    const elapsed = Math.floor((endMs - activeTimer.startMs) / 1000);
    const r = await window.supa.from('time_entries').update({
      ended_at: new Date(endMs).toISOString(),
      seconds:  elapsed,
      hours:    Number((elapsed/3600).toFixed(2))
    }).eq('id', activeTimer.id);
    if(r.error){ alert('Stop timer failed: ' + r.error.message); return; }
    clearInterval(timerInterval); timerInterval = null;
    document.getElementById('tt-start-btn').textContent = '▶ Start';
    document.getElementById('tt-start-btn').style.background = 'var(--teal)';
    document.getElementById('tt-display').textContent = '00:00:00';
    await loadTimeEntries();
    renderTimeTracker();
    if(typeof glAudit === 'function') glAudit('time_entry_stopped', activeTimer.clientId || null, { seconds: elapsed });
    addNotification('⏱️ Time logged', (elapsed/3600).toFixed(2) + ' hours recorded', 'success');
  } else {
    // Start: INSERT a row with ended_at=null. The partial unique index
    // on (user_id) where ended_at is null guards against double-starts
    // across devices — if one's already running it'll come back 409.
    const clientId = document.getElementById('tt-client')?.value || null;
    const activity = document.getElementById('tt-activity')?.value || null;
    const notes    = document.getElementById('tt-notes')?.value || null;
    const client   = clients.find(c => c.id === clientId);
    const startISO = new Date().toISOString();
    const r = await window.supa.from('time_entries').insert([{
      user_id:     window.currentUser.id,
      client_id:   /^[0-9a-f-]{36}$/i.test(clientId||'') ? clientId : null,
      client_name: client ? client.name : null,
      activity:    activity,
      notes:       notes,
      started_at:  startISO
    }]).select('id').single();
    if(r.error){
      if(/unique|duplicate/i.test(r.error.message||'')){
        alert('A timer is already running for your account on another device. Open the modal there to stop it first.');
      } else {
        alert('Start timer failed: ' + r.error.message);
      }
      return;
    }
    activeTimer = { id: r.data.id, startMs: new Date(startISO).getTime(), clientId, activity, notes };
    document.getElementById('tt-start-btn').textContent = '⏹ Stop & Save';
    document.getElementById('tt-start-btn').style.background = '#e74c3c';
    resumeTimerDisplay();
    if(typeof glAudit === 'function') glAudit('time_entry_started', clientId, { activity: activity });
  }
}

function resumeTimerDisplay() {
  if(!activeTimer) return;
  // Defensive: clear any previously-running tick before starting a new one.
  // Open/close cycles of the time-tracker modal used to stack overlapping
  // setInterval handles, each running until the next tick found no #tt-display.
  if(timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  timerInterval = setInterval(() => {
    const el = document.getElementById('tt-display');
    if(!el) { clearInterval(timerInterval); return; }
    const elapsed = Math.floor((Date.now() - activeTimer.startMs) / 1000);
    const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
    const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
    const s = (elapsed % 60).toString().padStart(2, '0');
    el.textContent = `${h}:${m}:${s}`;
  }, 1000);
}

function renderTimeTracker() {
  const log = document.getElementById('tt-log');
  const summary = document.getElementById('tt-summary');
  if(!log) return;

  if(!timeEntries.length) {
    log.innerHTML = '<div style="color:var(--muted);font-size:13px">No time logged yet.</div>';
  } else {
    log.innerHTML = timeEntries.slice(0, 10).map(e =>
      `<div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05)">
        <div style="font-family:var(--ff-disp);font-size:18px;color:var(--teal);min-width:60px">${e.hours}h</div>
        <div style="flex:1">
          <div style="font-size:12px;font-weight:600;color:var(--white)">${esc(e.clientName)} — ${esc(e.activity)}</div>
          <div style="font-size:10px;color:var(--muted)">${esc(e.date)} ${e.notes ? '· ' + esc(e.notes) : ''}</div>
        </div>
        <button class="cbtn red" style="font-size:10px;padding:2px 7px" data-gl-action="deleteTimeEntry" data-gl-arg1="${esc(e.id)}">✕</button>
      </div>`
    ).join('');
  }

  if(summary) {
    const totalHours = timeEntries.reduce((s, e) => s + parseFloat(e.hours), 0);
    const byClient = {};
    timeEntries.forEach(e => { byClient[e.clientName] = (byClient[e.clientName] || 0) + parseFloat(e.hours); });
    const topClient = Object.entries(byClient).sort((a,b) => b[1]-a[1])[0];
    summary.innerHTML = `
      <div style="display:flex;gap:20px">
        <div><div style="font-size:10px;color:var(--muted);letter-spacing:1px">TOTAL HOURS</div><div style="font-family:var(--ff-disp);font-size:22px;color:var(--teal)">${totalHours.toFixed(1)}</div></div>
        <div><div style="font-size:10px;color:var(--muted);letter-spacing:1px">TOP CLIENT</div><div style="font-family:var(--ff-disp);font-size:16px;color:var(--white)">${esc(topClient ? topClient[0] : 'N/A')}</div></div>
        <div><div style="font-size:10px;color:var(--muted);letter-spacing:1px">ENTRIES</div><div style="font-family:var(--ff-disp);font-size:22px;color:var(--white)">${timeEntries.length}</div></div>
      </div>`;
  }
}

async function deleteTimeEntry(id) {
  if(!window.supa){ alert('Cloud sync unavailable — try reloading.'); return; }
  if(!confirm('Delete this time entry?')) return;
  const res = await glCheckedDelete(sb => sb.from('time_entries').delete().eq('id', id).select('id'));
  if(!res.ok){ alert('Delete failed — the time entry has NOT been deleted: ' + res.reason); return; }
  await loadTimeEntries();
  renderTimeTracker();
  if(typeof glAudit === 'function') glAudit('time_entry_deleted', null, { entry_id: id });
}

