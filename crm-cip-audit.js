/* ============================================================
   CIP / SANITATION LOG (compliance)
   FDA-defensible record of every cleaning cycle between runs.
   Captures: date/time, line, cleaning method (CIP / manual / both),
   chemicals used + concentration, water temp, contact time, operator,
   verification (ATP swab result), pass/fail, notes. Linked to the
   run that ran before and after if known.
   ============================================================ */
(function(){
  function esc(v){ return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  window.glCipLogs = window.glCipLogs || [];

  var METHODS = ['CIP (closed-loop)','Manual scrub','CIP + manual'];
  var CHEMICALS = ['Caustic (NaOH)','Acid (phosphoric)','Sanitizer (peracetic)','Sanitizer (chlorine)','Sanitizer (quat)','Other'];

  // Maps a compliance_records row (form_code='GMP-SAN-002' — the canonical
  // 9-step CIP form) into the row shape this page's render() expects.
  // Schema reminder (per saveRecord at line 15526):
  //   row.data       — jsonb form payload (NOT row.form_data!)
  //   row.status     — 'draft' | 'complete' | 'signed' (NOT row.complete/signed)
  //   row.signed_by  — uuid of PCQI who signed
  //   row.signature_name — display name captured at signing time
  function mapComplianceCipRow(row){
    var fd = (row && row.data) || {};
    var steps = Array.isArray(fd.steps) ? fd.steps : [];
    var doneSteps = steps.filter(function(s){ return s && s.done; });
    var chemicals = [];
    doneSteps.forEach(function(s){
      if(s.chem && s.chem !== '—' && s.chem !== 'Potable water' && chemicals.indexOf(s.chem) < 0){
        chemicals.push(s.chem);
      }
    });
    // PAA reading lives on the sanitize steps (8/9 — PAA strip ppm).
    var paa = doneSteps.find(function(s){ return s && s.n >= 8 && s.reading; });
    // Status decoding:
    //   has_deviation → FAIL (critical limit was missed)
    //   status='signed'   → PASS (PCQI signed off)
    //   status='complete' → PASS (operator completed all required fields)
    //   status='draft'    → DRAFT (logged but not finalized)
    //   anything else     → PENDING (defensive default)
    var result;
    if(row.has_deviation) result = 'fail';
    else if(row.status === 'signed' || row.status === 'complete') result = 'pass';
    else if(row.status === 'draft') result = 'draft';
    else result = 'pending';
    return {
      id: row.id,
      cycle_at: fd.cycle_start || row.recorded_at || row.record_date,
      line_area: fd.equipment || row.product_name || '—',
      method: 'CIP (9-step) — ' + doneSteps.length + '/9 steps',
      chemicals: chemicals,
      water_temp_f: null,
      contact_min: null,
      operator: fd.operator || row.signature_name || '',
      atp_reading: paa ? paa.reading : '',
      result: result,
      status: row.status,
      notes: row.deviation_notes || fd.deviation_notes || '',
      _source: 'compliance_records',
      _form_code: row.form_code,
      _raw: row
    };
  }
  async function loadFromSupabase(){
    if(!window.supa) return null;
    try {
      var r = await window.supa.from('compliance_records')
        .select('*').eq('form_code','GMP-SAN-002')
        .order('recorded_at',{ascending:false})
        .limit(200);
      if(r && r.error){ console.warn('[GL cip] load error:', r.error.message); return null; }
      if(r && Array.isArray(r.data)) return r.data.map(mapComplianceCipRow);
    } catch(e){ console.warn('[GL cip] load threw', e); }
    return null;
  }
  function loadLocal(){ try { return JSON.parse(localStorage.getItem('gl_cip_logs') || '[]'); } catch(e){ return []; } }
  function saveLocal(){ localStorage.setItem('gl_cip_logs', JSON.stringify(window.glCipLogs)); }

  async function refresh(){
    var rows = await loadFromSupabase();
    var local = loadLocal();
    if(rows === null){
      // DB unreachable or threw — show whatever's in localStorage.
      window.glCipLogs = local;
    } else if(rows.length === 0 && local.length > 0){
      // DB returned 0 but localStorage has cycles — probably means a save
      // got rejected (likely RLS) and the operator's work is sitting in
      // localStorage only. Merge so we still show their entries instead
      // of silently wiping them, and surface the gap to the admin.
      window.glCipLogs = local;
      console.warn('[GL cip] DB returned 0 rows but localStorage has ' + local.length + ' — DB save likely rejected. Check RLS on public.cip_logs.');
    } else {
      window.glCipLogs = rows;
    }
    render();
  }

  function render(){
    var host = document.getElementById('cip-body');
    if(!host) return;
    var sub = document.getElementById('cip-sub');
    var rows = window.glCipLogs || [];
    var fails  = rows.filter(function(r){ return r.result === 'fail';  }).length;
    var drafts = rows.filter(function(r){ return r.result === 'draft'; }).length;
    var subBits = [rows.length + ' cycle' + (rows.length === 1 ? '' : 's') + ' logged'];
    if(fails)  subBits.push(fails  + ' fail'  + (fails  === 1 ? '' : 's')  + ' on record');
    if(drafts) subBits.push(drafts + ' draft' + (drafts === 1 ? '' : 's') + ' awaiting PCQI sign-off');
    if(sub) sub.textContent = subBits.join(' · ');

    if(!rows.length){
      host.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No cycles logged yet. Click "+ Log Cycle" above to open the canonical 9-step FDA form. FDA-required between every run.</div>';
      return;
    }
    var hint = '<div style="font-size:11px;color:var(--muted);padding:8px 14px 12px;line-height:1.5">Showing canonical 9-step CIP records (form <code>GMP-SAN-002</code>). Click any row to see the full step-by-step detail.</div>';
    var RES_COLOR = { pass:'#5fcf9e', fail:'#ff8579', draft:'#f5c842', pending:'#9aa7bd' };
    host.innerHTML = hint + '<table class="ctbl"><thead><tr><th>When</th><th>Equipment</th><th>Steps done</th><th>Chemicals</th><th>Operator</th><th>PAA ppm</th><th>Result</th></tr></thead><tbody>' +
      rows.map(function(r){
        var when = r.cycle_at ? new Date(r.cycle_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '—';
        var resColor = RES_COLOR[r.result] || '#9aa7bd';
        var resLabel = (r.result || 'pending').toUpperCase();
        return '<tr style="cursor:pointer" onclick="window.glOpenCipDetail(\'' + esc(r.id) + '\')">' +
          '<td style="padding:11px;color:var(--white);font-weight:600">' + when + '</td>' +
          '<td style="padding:11px;color:var(--muted)">' + esc(r.line_area || '—') + '</td>' +
          '<td style="padding:11px;color:var(--muted);font-size:11px">' + esc(r.method || '—') + '</td>' +
          '<td style="padding:11px;color:var(--muted);font-size:11px">' + esc((r.chemicals||[]).join(', ') || '—') + '</td>' +
          '<td style="padding:11px;color:var(--muted)">' + esc(r.operator || '—') + '</td>' +
          '<td style="padding:11px;color:var(--muted);font-family:var(--ff-mono);font-size:11px">' + esc(r.atp_reading || '—') + '</td>' +
          '<td style="padding:11px;color:' + resColor + ';font-weight:700">' + resLabel + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  // Read-only detail viewer for a CIP cycle. Shows all 9 steps with their
  // checkbox state, actual minutes, temp, reading, and pass/fail. Opens on
  // row click. Source is the cached glCipLogs entry (carries the raw
  // compliance_records row on _raw).
  window.glOpenCipDetail = function(id){
    var row = (window.glCipLogs || []).find(function(x){ return x.id === id; });
    if(!row){ alert('Cycle not found in current view.'); return; }
    var raw = row._raw || {};
    var fd  = raw.data || {};
    var steps = Array.isArray(fd.steps) ? fd.steps : [];
    var prior = document.getElementById('gl-cip-detail'); if(prior) prior.remove();
    var RES_COLOR = { pass:'#5fcf9e', fail:'#ff8579', draft:'#f5c842', pending:'#9aa7bd' };
    var resColor = RES_COLOR[row.result] || '#9aa7bd';
    var STEP_DEFS = [
      { n:1, name:'Pre-Rinse',                  hot:true,  expect:'Visual — runs clear' },
      { n:2, name:'PBW Wash',                   hot:true,  expect:'1 oz/gal · 30 min · ≥160°F' },
      { n:3, name:'Intermediate Rinse #1',      hot:true,  expect:'Conductivity <50 µS/cm' },
      { n:4, name:'Caustic Wash (NaOH)',        hot:true,  expect:'1.5% · 30 min · ≥160°F' },
      { n:5, name:'Intermediate Rinse #2',      hot:true,  expect:'Conductivity <50 µS/cm' },
      { n:6, name:'Acid Wash',                  hot:true,  expect:'1 oz/gal · 30 min · ≥160°F' },
      { n:7, name:'Final Rinse',                hot:true,  expect:'pH + conductivity to baseline' },
      { n:8, name:'POST-CIP PAA Sanitize',      hot:false, expect:'100–300 ppm · 20 min · DO NOT RINSE' },
      { n:9, name:'PRE-USE PAA (at run time)',  hot:false, expect:'100–300 ppm · 20 min · DO NOT RINSE' }
    ];
    function stepRow(def){
      var s = steps.find(function(x){ return x && x.n === def.n; }) || {};
      var done = !!s.done;
      var pf = (s.pf || '').toLowerCase();
      var pfColor = pf === 'pass' ? '#5fcf9e' : pf === 'fail' ? '#ff8579' : '#9aa7bd';
      var pfLabel = pf ? pf.toUpperCase() : (done ? '—' : 'skipped');
      var tempBit = def.hot && s.temp_f ? ' · ' + s.temp_f + '°F' : '';
      var minBit  = s.actual_min ? s.actual_min + ' min' : '—';
      return '<tr style="border-top:1px solid rgba(255,255,255,.05);' + (done?'':'opacity:.5') + '">' +
        '<td style="padding:8px;color:' + (done?'#5fcf9e':'#6b87ad') + ';font-weight:700;width:38px;text-align:center">' + (done ? '☑' : '☐') + '</td>' +
        '<td style="padding:8px;color:#fff;font-weight:600;width:30px">' + def.n + '</td>' +
        '<td style="padding:8px;color:#fff">' + esc(def.name) + '<div style="font-size:10px;color:#6b87ad;margin-top:2px">' + esc(def.expect) + '</div></td>' +
        '<td style="padding:8px;color:#9aa7bd;font-size:11px;text-align:right;white-space:nowrap">' + minBit + tempBit + '</td>' +
        '<td style="padding:8px;color:#9aa7bd;font-family:var(--ff-mono);font-size:11px">' + esc(s.reading || '—') + '</td>' +
        '<td style="padding:8px;color:' + pfColor + ';font-weight:700;font-size:11px;text-align:right;white-space:nowrap">' + pfLabel + '</td>' +
      '</tr>';
    }
    var when = row.cycle_at ? new Date(row.cycle_at).toLocaleString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : '—';
    var headerBits = [];
    headerBits.push('<div><div style="font-size:10px;letter-spacing:1.5px;color:#6b87ad">EQUIPMENT</div><div style="color:#fff;font-weight:700">' + esc(row.line_area || '—') + '</div></div>');
    headerBits.push('<div><div style="font-size:10px;letter-spacing:1.5px;color:#6b87ad">CYCLE START</div><div style="color:#fff;font-weight:700">' + esc(when) + '</div></div>');
    headerBits.push('<div><div style="font-size:10px;letter-spacing:1.5px;color:#6b87ad">OPERATOR / PCQI</div><div style="color:#fff;font-weight:700">' + esc(row.operator || '(unsigned)') + '</div></div>');
    headerBits.push('<div><div style="font-size:10px;letter-spacing:1.5px;color:#6b87ad">STATUS</div><div style="color:' + resColor + ';font-weight:700">' + (row.result||'').toUpperCase() + ' · ' + (row.status||'') + '</div></div>');
    var devNote = row.notes ? '<div style="margin-top:14px;padding:12px;background:rgba(231,76,60,.08);border:1px solid rgba(231,76,60,.3);border-radius:8px;color:#ff8579;font-size:12px"><b>Deviation note:</b><br>' + esc(row.notes) + '</div>' : '';
    var ov = document.createElement('div');
    ov.id = 'gl-cip-detail';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.92);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.25);border-radius:14px;padding:24px;width:100%;max-width:760px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">' +
          '<div><div style="font-family:var(--ff-disp);font-size:16px;letter-spacing:2px;color:var(--teal)">🧼 CIP CYCLE DETAIL</div><div style="font-size:11px;color:#6b87ad;margin-top:2px">Form GMP-SAN-002 · Record id ' + esc(String(row.id).slice(0,8)) + '</div></div>' +
          '<button id="gl-cipd-close" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:14px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:14px;font-size:12px">' + headerBits.join('') + '</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="font-size:10px;letter-spacing:1px;color:#6b87ad;text-align:left;border-bottom:1px solid rgba(255,255,255,.08)">' +
          '<th style="padding:6px;text-align:center">DONE</th><th style="padding:6px">#</th><th style="padding:6px">STEP</th><th style="padding:6px;text-align:right">TIME/TEMP</th><th style="padding:6px">READING</th><th style="padding:6px;text-align:right">P/F</th>' +
        '</tr></thead><tbody>' + STEP_DEFS.map(stepRow).join('') + '</tbody></table>' +
        devNote +
        '<div style="display:flex;justify-content:flex-end;margin-top:18px">' +
          '<button id="gl-cipd-done" class="cbtn">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-cipd-close').onclick = function(){ ov.remove(); };
    ov.querySelector('#gl-cipd-done').onclick  = function(){ ov.remove(); };
  };

  // glOpenAddCip is set to glOpenCipForm (the live 9-step FDA form) at the
  // bottom of the compliance-forms IIFE. No stub needed here.

  function watch(){
    var pg = document.getElementById('cpg-cip');
    if(!pg){ setTimeout(watch, 600); return; }
    new MutationObserver(function(){ if(pg.classList.contains('act')) refresh(); }).observe(pg, { attributes:true, attributeFilter:['class'] });
  }
  if(document.readyState !== 'loading') watch();
  else document.addEventListener('DOMContentLoaded', watch);

  console.log('[GL] CIP / sanitation log loaded');
}());

/* ============================================================
   AUDIT LOG VIEWER (admin-only)
   Shows the audit_log table contents — every glAudit() call that has
   been written throughout the app. Filterable, last 200 events.
   The nav item is hidden until login; revealed for admin only by
   the existing loginUser flow (matches users/customers admin-only items).
   ============================================================ */
(function(){
  function esc(v){ return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  window.glAuditRows = window.glAuditRows || [];

  async function refresh(){
    if(!window.supa){ render([]); return; }
    try {
      var r = await window.supa.from('audit_log').select('*').order('created_at',{ascending:false}).limit(200);
      if(r && r.data) window.glAuditRows = r.data;
    } catch(e){ console.warn('[GL] audit fetch failed', e); }
    render(window.glAuditRows);
  }

  function render(rows){
    var host = document.getElementById('audit-body');
    if(!host) return;
    var sub = document.getElementById('audit-sub');
    if(sub) sub.textContent = rows.length + ' event' + (rows.length === 1 ? '' : 's') + ' shown (most recent first)';
    if(!rows.length){
      host.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No audit events yet. Actions like creating clients, deleting invoices, editing formulas all write here automatically.</div>';
      return;
    }
    host.innerHTML = '<table class="ctbl"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>' +
      rows.map(function(r){
        var when = r.created_at ? new Date(r.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '—';
        var details = r.details ? '<code style="font-family:var(--ff-mono);font-size:11px;color:var(--muted);max-width:240px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(JSON.stringify(r.details)) + '</code>' : '<span style="color:rgba(255,255,255,.2)">—</span>';
        return '<tr>' +
          '<td style="padding:11px;color:var(--muted);font-size:11px;white-space:nowrap">' + when + '</td>' +
          '<td style="padding:11px;color:var(--white);font-size:12px">' + esc(r.actor_email || r.actor || 'system') + '</td>' +
          '<td style="padding:11px;color:var(--teal);font-family:var(--ff-mono);font-size:11px">' + esc(r.action) + '</td>' +
          '<td style="padding:11px;color:var(--muted);font-size:12px">' + esc(r.target || '—') + '</td>' +
          '<td style="padding:11px">' + details + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  function watch(){
    var pg = document.getElementById('cpg-audit');
    if(!pg){ setTimeout(watch, 600); return; }
    new MutationObserver(function(){ if(pg.classList.contains('act')) refresh(); }).observe(pg, { attributes:true, attributeFilter:['class'] });
    // Filter input
    var f = document.getElementById('audit-filter');
    if(f) f.addEventListener('input', function(){
      var q = f.value.toLowerCase();
      if(!q){ render(window.glAuditRows||[]); return; }
      var filtered = (window.glAuditRows||[]).filter(function(r){
        return (r.action || '').toLowerCase().includes(q) ||
               (r.target || '').toLowerCase().includes(q) ||
               (r.actor  || '').toLowerCase().includes(q);
      });
      render(filtered);
    });
    // Reveal sidebar entry for admins.
    setInterval(function(){
      var navItem = document.getElementById('nav-audit');
      if(navItem && window.currentUser && window.currentUser.role === 'admin'){
        navItem.style.display = 'flex';
      }
    }, 1500);
  }
  if(document.readyState !== 'loading') watch();
  else document.addEventListener('DOMContentLoaded', watch);

  console.log('[GL] audit log viewer loaded');
}());
