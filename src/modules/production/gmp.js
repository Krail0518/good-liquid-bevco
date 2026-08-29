/* ============================================================
   gmp.js — Daily GMP logging with "type once, fan out"
   ============================================================
   A self-contained module (no logic in index.html, nothing in localStorage —
   every entry is a row in Postgres). Form/register definitions live in the DB
   table gmp_templates; each logged entry is a compliance_records row (the
   existing generic form store: form_code + data jsonb + e-signature +
   deviation fields). Entries written from one screen share a batch_id.

   THE FAN-OUT: the operator types the shared header (date, shift, line, run,
   operator) ONCE at the top; each form's specifics once; on save the module
   writes one compliance_records row per form, each merging the shared header,
   all sharing a batch_id — so every register shows its own slice while the
   common data was entered a single time.

   Exposes:
     window.glRenderGMPHub()      — fills the #cpg-gmp page with the hub
     window.glOpenDailyGMP()      — the combo "log today" entry screen
     window.glOpenGMPRegister(c)  — read a single register (form_code)
     window.glOpenGMPDeviations() — every flagged deviation across GMP forms
   ============================================================ */
(function(){
  'use strict';

  function sb(){ return window.supa || null; }
  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"]/g, function(c){
      return { '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c];
    });
  }
  function todayISO(){ try { return new Date().toISOString().slice(0,10); } catch(e){ return ''; } }
  function overlay(id){
    var prior = document.getElementById(id); if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = id;
    ov.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.95);backdrop-filter:blur(14px);display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto');
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    document.body.appendChild(ov);
    return ov;
  }

  // ── Hub: static launcher tiles rendered into the #cpg-gmp page ──
  var REGISTERS = [
    { code:'GMP-PREOP-001',   icon:'🧼', label:'Pre-Op Sanitation' },
    { code:'GMP-HYGIENE-001', icon:'🧑‍🔧', label:'GMP & Hygiene' },
    { code:'GMP-CCP-PAST-001',icon:'🌡️', label:'CCP — Pasteurizer' },
    { code:'GMP-SEAM-001',    icon:'🥫', label:'Double-Seam' },
    { code:'GMP-LABEL-001',   icon:'🏷️', label:'Label Reconciliation' },
    { code:'GMP-RECV-001',    icon:'📦', label:'Receiving' }
  ];

  // Prerequisite programs (PRPs). These are periodic registers, NOT part of the
  // daily "log today" fan-out (in_daily = false), so each opens its own single
  // form. They round out the SQF/HACCP foundation: calibration, pest, chemical
  // control, glass & brittle plastic, water potability, and customer complaints.
  var PRP_REGISTERS = [
    { code:'GMP-CAL-001',   icon:'📏', label:'Calibration' },
    { code:'GMP-PEST-001',  icon:'🐜', label:'Pest Control' },
    { code:'GMP-CHEM-001',  icon:'🧪', label:'Chemical & SDS' },
    { code:'GMP-GLASS-001', icon:'🔦', label:'Glass & Brittle Plastic' },
    { code:'GMP-WATER-001', icon:'💧', label:'Water Potability' },
    { code:'GMP-COMPL-001', icon:'📣', label:'Complaint Log' }
  ];

  window.glRenderGMPHub = function glRenderGMPHub(){
    var host = document.getElementById('cpg-gmp');
    if(!host) return;
    var tile = function(onclick, icon, label, sub, accent){
      return '<button onclick="'+onclick+'" style="text-align:left;background:#142238;border:1px solid rgba(0,229,192,.18);border-radius:12px;padding:16px 18px;cursor:pointer;color:#eef4ff;display:flex;flex-direction:column;gap:4px">' +
        '<span style="font-size:22px">'+icon+'</span>' +
        '<span style="font-weight:700;font-size:14px;color:'+(accent||'#eef4ff')+'">'+label+'</span>' +
        '<span style="font-size:11.5px;color:#9aa7bd;line-height:1.4">'+sub+'</span></button>';
    };
    host.innerHTML =
      '<div style="max-width:1000px;margin:0 auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:24px;letter-spacing:2px;color:var(--teal)">🧾 DAILY GMP</div>' +
          '<button onclick="window.glOpenDailyGMP()" style="padding:12px 20px;background:linear-gradient(135deg,#00e5c0,#00c4a7);color:#04231d;border:none;border-radius:9px;font-weight:800;font-size:14px;cursor:pointer">➕ Log today’s GMP</button>' +
        '</div>' +
        '<div style="font-size:12.5px;color:var(--muted);margin-bottom:18px;line-height:1.6">Enter the shared details (date, shift, line, run, operator) once — they fan out to every register below. Deviations flag automatically and show under “Open deviations”.</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-bottom:16px">' +
          tile('window.glOpenDailyGMP()','➕','Log today’s GMP','One entry, fans out to all registers','#00e5c0') +
          tile('window.glOpenGMPDeviations()','⚠️','Open deviations','Anything that failed a check, needs action','#f5c842') +
          tile('window.glGenerateAuditorLink()','🔒','Auditor access','Read-only login link for an auditor','#f5c842') +
          tile('window.glOpenGMPDocuments()','📄','Documents','SOPs, registers & regulatory guides','#00e5c0') +
          REGISTERS.map(function(r){ return tile("window.glOpenGMPRegister('"+r.code+"')", r.icon, r.label, 'View / add records'); }).join('') +
        '</div>' +
        '<div style="font-family:var(--ff-disp);font-size:15px;letter-spacing:1.5px;color:var(--teal);margin:20px 0 4px">🛡️ PREREQUISITE PROGRAMS</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:12px;line-height:1.6">The periodic foundation programs behind the daily GMP forms — calibration, pest control, chemical &amp; SDS, glass &amp; brittle plastic, water potability, and complaints. Each opens its own record.</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px">' +
          PRP_REGISTERS.map(function(r){ return tile("window.glOpenGMPRegister('"+r.code+"')", r.icon, r.label, 'View / add records'); }).join('') +
        '</div>' +
      '</div>';
  };

  // ── Load active templates (DB is the source of truth) ──
  async function loadTemplates(dailyOnly){
    var q = sb().from('gmp_templates').select('*').eq('active', true).order('sort_order', { ascending: true });
    if(dailyOnly) q = q.eq('in_daily', true);
    var r = await q;
    if(r.error) throw r.error;
    return r.data || [];
  }

  // ── Render one field control from its template def ──
  function fieldControl(formCode, f){
    var id = 'gmpf-' + formCode + '-' + f.key;
    var base = 'width:100%;padding:9px 10px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px;font-family:var(--ff-body)';
    var lab = '<label style="display:block;font-size:11px;letter-spacing:.4px;color:#9aa7bd;margin:10px 0 4px">'+esc(f.label)+(f.required?' <span style="color:#f5c842">*</span>':'')+'</label>';
    if(f.type === 'textarea') return lab + '<textarea id="'+id+'" data-key="'+esc(f.key)+'" style="'+base+';min-height:52px;resize:vertical"></textarea>';
    if(f.type === 'number')   return lab + '<input id="'+id+'" data-key="'+esc(f.key)+'" type="number" step="any" style="'+base+'">';
    if(f.type === 'time')     return lab + '<input id="'+id+'" data-key="'+esc(f.key)+'" type="time" style="'+base+'">';
    if(f.type === 'date')     return lab + '<input id="'+id+'" data-key="'+esc(f.key)+'" type="date" style="'+base+'">';
    if(f.type === 'check')    return '<label style="display:flex;align-items:center;gap:8px;margin:12px 0;font-size:13px;color:#dfe7f1;cursor:pointer"><input id="'+id+'" data-key="'+esc(f.key)+'" type="checkbox" style="width:16px;height:16px;accent-color:#00e5c0"> '+esc(f.label)+'</label>';
    if(f.type === 'passfail') return lab + '<select id="'+id+'" data-key="'+esc(f.key)+'" data-passfail="1" style="'+base+'"><option value="">—</option><option value="pass">Pass</option><option value="fail">Fail</option><option value="na">N/A</option></select>';
    if(f.type === 'select'){
      var opts = ['<option value="">—</option>'].concat((f.options||[]).map(function(o){ return '<option value="'+esc(o)+'">'+esc(o)+'</option>'; })).join('');
      return lab + '<select id="'+id+'" data-key="'+esc(f.key)+'" style="'+base+'">'+opts+'</select>';
    }
    return lab + '<input id="'+id+'" data-key="'+esc(f.key)+'" type="text" style="'+base+'">';
  }

  // Pull a form section's values out of the DOM.
  function collectSection(sectionEl){
    var out = {};
    sectionEl.querySelectorAll('[data-key]').forEach(function(el){
      var k = el.getAttribute('data-key');
      var v = el.type === 'checkbox' ? !!el.checked : (el.value || '').trim();
      if(v !== '' && v !== false) out[k] = v;
    });
    return out;
  }
  // A section counts as "filled in" if it has any value beyond blanks.
  function sectionHasData(vals){ return Object.keys(vals).length > 0; }
  // Deviation if any field whose def has deviation_if matches its value.
  function sectionDeviation(tpl, vals){
    var hit = [];
    (tpl.fields||[]).forEach(function(f){
      if(f.deviation_if && String(vals[f.key]||'').toLowerCase() === String(f.deviation_if).toLowerCase()) hit.push(f.label);
    });
    return hit;
  }

  // ── The combo "log today" screen ──
  window.glOpenDailyGMP = async function glOpenDailyGMP(onlyCode){
    if(!sb()){ alert('Supabase not ready.'); return; }
    var ov = overlay('gl-gmp-daily');
    ov.innerHTML = '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:22px;width:100%;max-width:720px;color:#fff"><div style="color:#9aa7bd">Loading forms…</div></div>';
    var tpls;
    try {
      if(onlyCode){
        // Single-form entry (a prerequisite program or any non-daily register).
        var r1 = await sb().from('gmp_templates').select('*').eq('active', true).eq('form_code', onlyCode);
        if(r1.error) throw r1.error;
        tpls = r1.data || [];
      } else {
        tpls = await loadTemplates(true);
      }
    }
    catch(e){ ov.querySelector('div').innerHTML = '<div style="color:#ff8579">Could not load GMP forms: '+esc(e.message||e)+'</div>'; return; }
    if(onlyCode && !tpls.length){ ov.querySelector('div').innerHTML = '<div style="color:#ff8579">Form '+esc(onlyCode)+' is not set up yet.</div>'; return; }

    var uname = (window.currentUser && (window.currentUser.name || window.currentUser.email)) || '';
    var singleTitle = onlyCode && tpls[0] ? tpls[0].title : '';
    var sections = tpls.map(function(t){
      return '<details class="gl-gmp-sec"'+(onlyCode?' open':'')+' data-code="'+esc(t.form_code)+'" style="border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:0 14px;margin-bottom:10px;background:rgba(255,255,255,.02)">' +
          '<summary style="cursor:pointer;padding:12px 0;font-weight:700;font-size:13.5px;color:#eef4ff;list-style:none">'+esc(t.title)+'</summary>' +
          (t.help?'<div style="font-size:11.5px;color:#9aa7bd;margin-bottom:6px;line-height:1.5">'+esc(t.help)+'</div>':'') +
          '<div class="gl-gmp-fields">'+(t.fields||[]).map(function(f){ return fieldControl(t.form_code, f); }).join('')+'</div>' +
          '<div style="height:12px"></div>' +
        '</details>';
    }).join('');

    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:22px;width:100%;max-width:720px;color:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">'+(onlyCode?('🛡️ '+esc(singleTitle.toUpperCase())):'🧾 LOG TODAY’S GMP')+'</div>' +
          '<button onclick="document.getElementById(\'gl-gmp-daily\').remove()" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer">✕</button></div>' +
        '<div style="font-size:12px;color:#9aa7bd;margin-bottom:14px;line-height:1.5">'+(onlyCode?'Shared details (date, operator, line) are recorded with this entry.':'Shared details are typed once and copied into every form you fill in below.')+'</div>' +
        '<div style="background:rgba(0,229,192,.05);border:1px solid rgba(0,229,192,.18);border-radius:10px;padding:12px 14px;margin-bottom:14px">' +
          '<div style="font-size:10.5px;letter-spacing:1.5px;color:var(--teal);margin-bottom:8px">SHARED — ENTERED ONCE</div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px">' +
            '<div><label style="font-size:11px;color:#9aa7bd">Date</label><input id="gmp-h-date" type="date" value="'+todayISO()+'" style="width:100%;padding:9px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px"></div>' +
            '<div><label style="font-size:11px;color:#9aa7bd">Shift</label><select id="gmp-h-shift" style="width:100%;padding:9px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px"><option>Day</option><option>Swing</option><option>Night</option></select></div>' +
            '<div><label style="font-size:11px;color:#9aa7bd">Line / area</label><input id="gmp-h-line" placeholder="Line 1" style="width:100%;padding:9px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px"></div>' +
            '<div><label style="font-size:11px;color:#9aa7bd">Run / batch #</label><input id="gmp-h-run" placeholder="optional" style="width:100%;padding:9px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px"></div>' +
            '<div><label style="font-size:11px;color:#9aa7bd">Operator</label><input id="gmp-h-operator" value="'+esc(uname)+'" style="width:100%;padding:9px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px"></div>' +
          '</div>' +
        '</div>' +
        sections +
        '<div id="gmp-daily-msg" style="display:none;font-size:12.5px;margin:10px 0;padding:9px 12px;border-radius:8px"></div>' +
        '<div style="display:flex;gap:10px;margin-top:8px">' +
          '<button id="gmp-save-draft" style="flex:1;padding:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#dfe7f1;font-size:13px;cursor:pointer">Save (draft)</button>' +
          '<button id="gmp-save-sign" style="flex:1;padding:12px;background:rgba(0,229,192,.14);border:1px solid rgba(0,229,192,.35);border-radius:8px;color:var(--teal);font-weight:700;font-size:13px;cursor:pointer">✍️ Sign &amp; save</button>' +
        '</div>' +
      '</div>';

    ov.querySelector('#gmp-save-draft').addEventListener('click', function(){ saveDaily(ov, tpls, false); });
    ov.querySelector('#gmp-save-sign').addEventListener('click', function(){ saveDaily(ov, tpls, true); });
  };

  async function saveDaily(ov, tpls, sign){
    var msg = ov.querySelector('#gmp-daily-msg');
    var show = function(color, text){ msg.style.display='block'; msg.style.color=color; msg.style.background='rgba(255,255,255,.04)'; msg.textContent=text; };
    var shared = {
      date:     ov.querySelector('#gmp-h-date').value || todayISO(),
      shift:    ov.querySelector('#gmp-h-shift').value,
      line:     (ov.querySelector('#gmp-h-line').value||'').trim(),
      run:      (ov.querySelector('#gmp-h-run').value||'').trim(),
      operator: (ov.querySelector('#gmp-h-operator').value||'').trim()
    };
    if(!shared.operator){ show('#ff8579','Enter the operator name (top of the form).'); return; }

    // Gather every filled-in section; validate required fields on those.
    var byCode = {}; tpls.forEach(function(t){ byCode[t.form_code]=t; });
    var rows = [], anyDeviation = false, missing = null;
    ov.querySelectorAll('.gl-gmp-sec').forEach(function(secEl){
      var code = secEl.getAttribute('data-code');
      var tpl = byCode[code]; if(!tpl) return;
      var vals = collectSection(secEl);
      if(!sectionHasData(vals)) return;   // skip forms left blank
      // required check (only for a section the operator started)
      (tpl.fields||[]).forEach(function(f){ if(f.required && (vals[f.key]===undefined || vals[f.key]==='')) missing = tpl.title + ' — ' + f.label; });
      var devs = sectionDeviation(tpl, vals);
      if(devs.length) anyDeviation = true;
      rows.push({ tpl: tpl, vals: vals, devs: devs });
    });

    if(!rows.length){ show('#f5c842','Fill in at least one form before saving.'); return; }
    if(missing){ show('#ff8579','Please complete required field: ' + missing); return; }

    // One batch id ties the fan-out siblings together.
    var batchId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : ('b'+Date.now()+Math.random().toString(36).slice(2));
    var uid = (window.currentUser && window.currentUser.id) || null;
    var nowIso = new Date().toISOString();
    var runId = null;
    // If a run/batch # matches a known production run id, link it.
    // (Best-effort; a free-text batch is fine too and stays in data.)

    var payload = rows.map(function(r){
      var devNote = r.devs.length ? ('Deviation: ' + r.devs.join('; ')) : null;
      return {
        form_code: r.tpl.form_code,
        record_date: shared.date,
        recorded_at: nowIso,
        // Fan-out: the shared header is merged into every form's data.
        data: Object.assign({ _shared: shared, line: shared.line, run: shared.run, shift: shared.shift, operator: shared.operator }, r.vals),
        status: sign ? 'signed' : 'complete',
        completed_by: uid, completed_at: nowIso,
        signed_by: sign ? uid : null, signed_at: sign ? nowIso : null,
        signature_name: sign ? shared.operator : null,
        signature_meaning: sign ? 'Performed and verified this GMP check' : null,
        batch_id: batchId, run_id: runId,
        has_deviation: r.devs.length > 0,
        deviation_notes: devNote
      };
    });

    var btnSign = ov.querySelector('#gmp-save-sign'), btnDraft = ov.querySelector('#gmp-save-draft');
    btnSign.disabled = btnDraft.disabled = true;
    show('#9aa7bd','Saving '+payload.length+' record'+(payload.length===1?'':'s')+'…');
    try {
      var r = await sb().from('compliance_records').insert(payload).select('id');
      if(r.error) throw r.error;
      var note = '✓ Saved '+payload.length+' record'+(payload.length===1?'':'s')+' from one entry' + (anyDeviation ? ' — ⚠ deviation flagged (see Open deviations).' : '.');
      show(anyDeviation ? '#f5c842' : '#5fcf9e', note);
      if(typeof window.glAudit === 'function') window.glAudit('gmp_logged', batchId, { forms: payload.length, deviation: anyDeviation });
      setTimeout(function(){ ov.remove(); }, 1400);
    } catch(e){
      btnSign.disabled = btnDraft.disabled = false;
      show('#ff8579','Save failed: ' + (e.message || e));
    }
  }

  // ── Read a single register ──
  window.glOpenGMPRegister = async function glOpenGMPRegister(code){
    if(!sb()){ alert('Supabase not ready.'); return; }
    var ov = overlay('gl-gmp-reg');
    ov.innerHTML = '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:22px;width:100%;max-width:880px;color:#fff"><div style="color:#9aa7bd">Loading…</div></div>';
    try {
      var tRes = await sb().from('gmp_templates').select('*').eq('form_code', code).maybeSingle();
      var tpl = tRes.data || { title: code, fields: [] };
      var rRes = await sb().from('compliance_records').select('*').eq('form_code', code).order('recorded_at', { ascending: false }).limit(200);
      if(rRes.error) throw rRes.error;
      var recs = rRes.data || [];
      var cols = (tpl.fields||[]).slice(0, 6);
      var head = '<tr style="text-align:left;color:#9aa7bd;font-size:11px"><th style="padding:6px 8px">Date</th><th style="padding:6px 8px">Line/Run</th><th style="padding:6px 8px">By</th>' +
        cols.map(function(f){ return '<th style="padding:6px 8px">'+esc(f.label)+'</th>'; }).join('') +
        '<th style="padding:6px 8px">Dev</th><th style="padding:6px 8px">Status</th></tr>';
      var body = recs.map(function(rec){
        var d = rec.data || {};
        var cells = cols.map(function(f){ var v = d[f.key]; return '<td style="padding:6px 8px;color:#dfe7f1">'+esc(v==null?'':String(v))+'</td>'; }).join('');
        return '<tr style="border-top:1px solid rgba(255,255,255,.06);font-size:12px">' +
          '<td style="padding:6px 8px;color:#dfe7f1">'+esc(rec.record_date||'')+'</td>' +
          '<td style="padding:6px 8px;color:#9aa7bd">'+esc((d.line||'')+(d.run?(' / '+d.run):''))+'</td>' +
          '<td style="padding:6px 8px;color:#9aa7bd">'+esc(d.operator||'')+'</td>' + cells +
          '<td style="padding:6px 8px">'+(rec.has_deviation?'<span style="color:#ff8579">⚠</span>':'')+'</td>' +
          '<td style="padding:6px 8px;color:'+(rec.status==='signed'?'#5fcf9e':'#9aa7bd')+'">'+esc(rec.status||'')+'</td></tr>';
      }).join('');
      ov.innerHTML =
        '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:22px;width:100%;max-width:880px;color:#fff">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
            '<div style="font-family:var(--ff-disp);font-size:17px;letter-spacing:1.5px;color:var(--teal)">'+esc(tpl.title)+'</div>' +
            '<div><button onclick="window.glOpenDailyGMP('+(tpl.in_daily===false?("'"+esc(code)+"'"):'')+')" style="padding:8px 14px;background:rgba(0,229,192,.12);color:var(--teal);border:1px solid rgba(0,229,192,.3);border-radius:7px;cursor:pointer;font-size:12px;margin-right:8px">➕ New entry</button>' +
            '<button onclick="document.getElementById(\'gl-gmp-reg\').remove()" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button></div></div>' +
          (recs.length ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse">'+head+body+'</table></div>'
                       : '<div style="color:#9aa7bd;padding:20px 0">No records yet. Click ➕ New entry to log one.</div>') +
        '</div>';
    } catch(e){
      ov.querySelector('div').innerHTML = '<div style="color:#ff8579">Could not load: '+esc(e.message||e)+'</div>';
    }
  };

  // ── Raise an NCR / CAPA (defects row) straight from a flagged deviation ──
  // Turns a compliance_records deviation into one row in the NCR/CAPA log so
  // corrective action can be tracked. Returns the inserted id, or null.
  window.glRaiseNCRFromDeviation = async function glRaiseNCRFromDeviation(rec){
    if(!sb()){ alert('Supabase not ready.'); return null; }
    rec = rec || {};
    var d = rec.data || {};
    var row = {
      reported_at: new Date().toISOString(),
      run_ref: (d.run || d.line) || rec.form_code,
      category: rec.form_code,
      severity: 'high',
      status: 'open',
      owner: d.operator || '',
      description: rec.deviation_notes || 'GMP deviation',
      source: 'gmp_deviation',
      source_record_id: rec.id,
      ncr_number: 'NCR-' + String(Date.now()).slice(-6)
    };
    try {
      var r = await sb().from('defects').insert([row]).select('id');
      if(r.error) throw r.error;
      if(typeof window.glAudit === 'function') window.glAudit('ncr_raised_from_deviation', rec.form_code, { record: rec.id });
      return (r.data && r.data[0] && r.data[0].id) || null;
    } catch(e){
      alert('Could not raise NCR: ' + (e.message || e));
      return null;
    }
  };

  // ── Every open deviation across GMP forms ──
  window.glOpenGMPDeviations = async function glOpenGMPDeviations(){
    if(!sb()){ alert('Supabase not ready.'); return; }
    var ov = overlay('gl-gmp-dev');
    ov.innerHTML = '<div style="background:#142238;border:1px solid rgba(245,200,66,.25);border-radius:16px;padding:22px;width:100%;max-width:820px;color:#fff"><div style="color:#9aa7bd">Loading…</div></div>';
    try {
      var codes = REGISTERS.concat(PRP_REGISTERS).map(function(r){ return r.code; });
      var rRes = await sb().from('compliance_records').select('*').in('form_code', codes).eq('has_deviation', true).order('recorded_at', { ascending: false }).limit(200);
      if(rRes.error) throw rRes.error;
      var recs = rRes.data || [];
      window.__glDevRecs = recs;   // keep records reachable for the delegated button handler
      var rows = recs.map(function(rec, i){
        var d = rec.data || {};
        return '<div style="border:1px solid rgba(245,200,66,.25);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:rgba(245,200,66,.05)">' +
          '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div style="font-weight:700;font-size:13px;color:#f5c842">'+esc(rec.form_code)+' — '+esc(rec.record_date||'')+'</div>' +
          '<div style="font-size:11px;color:#9aa7bd">'+esc((d.line||'')+(d.run?(' / '+d.run):''))+' · '+esc(d.operator||'')+'</div></div>' +
          '<div style="font-size:12.5px;color:#eef4ff;margin-top:6px">'+esc(rec.deviation_notes||'Deviation flagged')+'</div>' +
          (rec.corrective_action?'<div style="font-size:12px;color:#5fcf9e;margin-top:4px">Corrective action: '+esc(rec.corrective_action)+'</div>':'') +
          '<div style="margin-top:10px"><button class="gl-dev-ncr" data-idx="'+i+'" style="padding:8px 14px;background:rgba(0,229,192,.12);color:var(--teal);border:1px solid rgba(0,229,192,.3);border-radius:7px;cursor:pointer;font-size:12px">⤴ Raise NCR</button></div>' +
          '</div>';
      }).join('');
      ov.innerHTML =
        '<div style="background:#142238;border:1px solid rgba(245,200,66,.25);border-radius:16px;padding:22px;width:100%;max-width:820px;color:#fff">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div style="font-family:var(--ff-disp);font-size:17px;letter-spacing:1.5px;color:#f5c842">⚠️ OPEN DEVIATIONS</div>' +
          '<button onclick="document.getElementById(\'gl-gmp-dev\').remove()" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button></div>' +
          (recs.length ? rows : '<div style="color:#5fcf9e;padding:16px 0">✓ No deviations flagged. Clean board.</div>') +
        '</div>';
      // Delegated handler: each ⤴ Raise NCR button looks up its rec by index.
      ov.addEventListener('click', async function(ev){
        var btn = ev.target && ev.target.closest ? ev.target.closest('.gl-dev-ncr') : null;
        if(!btn || btn.disabled) return;
        var idx = parseInt(btn.getAttribute('data-idx'), 10);
        var list = window.__glDevRecs || [];
        var rec = list[idx];
        if(!rec) return;
        btn.disabled = true; btn.textContent = 'Raising…';
        var id = await window.glRaiseNCRFromDeviation(rec);
        if(id){ btn.textContent = '✓ NCR raised'; }
        else { btn.disabled = false; btn.textContent = '⤴ Raise NCR'; }
      });
    } catch(e){
      ov.querySelector('div').innerHTML = '<div style="color:#ff8579">Could not load: '+esc(e.message||e)+'</div>';
    }
  };

  // ── Mint a read-only auditor login link (auditor.html?token=…) ──
  // Writes one inspector_tokens row (staff-only insert RLS). The token then
  // gates the standalone auditor portal via is_valid_inspector_token — no CRM
  // login, no write access. Parallels glGenerateInspectorLink but targets the
  // dedicated auditor page and stays inside the GMP module.
  window.glGenerateAuditorLink = function glGenerateAuditorLink(){
    if(!sb()){ alert('Supabase not ready.'); return; }
    var ov = overlay('gl-gmp-auditor');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(245,200,66,.3);border-radius:16px;padding:22px;width:100%;max-width:520px;color:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:17px;letter-spacing:1.5px;color:#f5c842">🔒 AUDITOR ACCESS LINK</div>' +
          '<button onclick="document.getElementById(\'gl-gmp-auditor\').remove()" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#9aa7bd;margin-bottom:14px;line-height:1.5">A read-only login for an auditor to review your GMP registers, deviations, and records. No CRM account, nothing can be changed.</div>' +
        '<div id="gmp-aud-step1">' +
          '<label style="display:block;font-size:11px;color:#9aa7bd;margin:8px 0 4px">Auditor name <span style="color:#f5c842">*</span></label>' +
          '<input id="gmp-aud-name" placeholder="e.g. Jane Smith" style="width:100%;padding:10px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">' +
            '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Agency / firm</label><input id="gmp-aud-agency" placeholder="SQF / FDA / customer" style="width:100%;padding:10px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px"></div>' +
            '<div><label style="display:block;font-size:11px;color:#9aa7bd;margin:0 0 4px">Valid for (hours)</label><input id="gmp-aud-hours" type="number" min="1" max="720" value="72" style="width:100%;padding:10px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px"></div>' +
          '</div>' +
          '<label style="display:block;font-size:11px;color:#9aa7bd;margin:8px 0 4px">Purpose <span style="opacity:.6">(optional)</span></label>' +
          '<input id="gmp-aud-purpose" placeholder="Annual audit / mock recall / etc." style="width:100%;padding:10px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px">' +
          '<div id="gmp-aud-err" style="display:none;color:#ff8579;font-size:12px;margin-top:8px"></div>' +
          '<div style="display:flex;gap:10px;margin-top:14px">' +
            '<button onclick="document.getElementById(\'gl-gmp-auditor\').remove()" style="flex:1;padding:11px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#dfe7f1;font-size:13px;cursor:pointer">Cancel</button>' +
            '<button id="gmp-aud-gen" style="flex:1;padding:11px;background:rgba(245,200,66,.16);border:1px solid rgba(245,200,66,.4);border-radius:8px;color:#f5c842;font-weight:700;font-size:13px;cursor:pointer">🔒 Generate link</button>' +
          '</div>' +
        '</div>' +
        '<div id="gmp-aud-step2" style="display:none"></div>' +
      '</div>';

    ov.querySelector('#gmp-aud-gen').addEventListener('click', async function(){
      var btn = this;
      var name    = (ov.querySelector('#gmp-aud-name').value||'').trim();
      var agency  = (ov.querySelector('#gmp-aud-agency').value||'').trim();
      var purpose = (ov.querySelector('#gmp-aud-purpose').value||'').trim();
      var hours   = parseInt(ov.querySelector('#gmp-aud-hours').value, 10) || 72;
      var err = ov.querySelector('#gmp-aud-err');
      err.style.display = 'none';
      if(!name){ err.textContent='Auditor name is required.'; err.style.display='block'; return; }
      if(hours < 1 || hours > 720){ err.textContent='Valid hours must be 1–720 (max 30 days).'; err.style.display='block'; return; }
      btn.disabled = true; btn.textContent = 'Generating…';
      var token = (window.crypto && crypto.randomUUID)
        ? (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g,'')
        : ('t'+Date.now()+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2));
      var validUntil = new Date(Date.now() + hours*3600*1000).toISOString();
      var uid = (window.currentUser && window.currentUser.id) || null;
      var row = { token: token, inspector: name, agency: agency || null, purpose: purpose || null, valid_until: validUntil, created_by: uid };
      try {
        var r = await sb().from('inspector_tokens').insert(row).select('id').single();
        if(r.error) throw r.error;
      } catch(e){
        err.textContent = 'Save failed: ' + (e.message || e); err.style.display='block';
        btn.disabled = false; btn.textContent = '🔒 Generate link';
        return;
      }
      var link = window.location.origin + '/auditor.html?token=' + token;
      var expires = new Date(validUntil).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
      if(typeof window.glAudit === 'function') window.glAudit('auditor_link_generated', name, { agency: agency, hours: hours, expires: validUntil });
      ov.querySelector('#gmp-aud-step1').style.display = 'none';
      var s2 = ov.querySelector('#gmp-aud-step2');
      s2.style.display = 'block';
      s2.innerHTML =
        '<div style="font-size:12.5px;color:#5fcf9e;margin-bottom:8px">✓ Link created for <b>'+esc(name)+'</b> — valid through '+esc(expires)+'.</div>' +
        '<div style="display:flex;gap:8px;align-items:stretch">' +
          '<input id="gmp-aud-link" readonly value="'+esc(link)+'" style="flex:1;padding:10px;background:#0a1628;border:1px solid rgba(245,200,66,.3);border-radius:7px;color:#f5c842;font-size:12px">' +
          '<button id="gmp-aud-copy" style="padding:10px 14px;background:rgba(245,200,66,.16);border:1px solid rgba(245,200,66,.4);border-radius:7px;color:#f5c842;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap">Copy</button>' +
        '</div>' +
        '<div style="font-size:11px;color:#9aa7bd;margin-top:10px;line-height:1.5">Send this link to the auditor. It opens a read-only portal — they can view every register, deviation, and record, but cannot edit, sign, or delete anything. Revoke or expire access anytime from Compliance → inspector tokens.</div>' +
        '<div style="text-align:right;margin-top:12px"><button onclick="document.getElementById(\'gl-gmp-auditor\').remove()" style="padding:10px 16px;background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.3);border-radius:8px;color:var(--teal);font-weight:700;font-size:13px;cursor:pointer">Done</button></div>';
      var linkEl = s2.querySelector('#gmp-aud-link');
      s2.querySelector('#gmp-aud-copy').addEventListener('click', function(){
        linkEl.select();
        var done = function(){ this.textContent='✓ Copied'; }.bind(this);
        try { if(navigator.clipboard && navigator.clipboard.writeText){ navigator.clipboard.writeText(link).then(done, function(){ document.execCommand('copy'); done.call(this); }.bind(this)); } else { document.execCommand('copy'); done.call(this); } }
        catch(e){ try{ document.execCommand('copy'); done.call(this); }catch(_){} }
      });
    });
  };

  // ── Documents library — SOPs, registers & regulatory guides ──
  // Reads active rows from gmp_documents (read-only listing) and offers each
  // as a direct download. Mirrors the overlay style of glOpenGMPRegister.
  window.glOpenGMPDocuments = async function glOpenGMPDocuments(){
    if(!sb()){ alert('Supabase not ready.'); return; }
    var ov = overlay('gl-gmp-docs');
    ov.innerHTML = '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:22px;width:100%;max-width:760px;color:#fff"><div style="color:#9aa7bd">Loading…</div></div>';
    var res = await sb().from('gmp_documents').select('*').eq('active', true).order('sort_order', { ascending: true });
    if(res.error){
      ov.querySelector('div').innerHTML = '<div style="color:#ff8579">Could not load documents: '+esc(res.error.message||res.error)+'</div>';
      return;
    }
    var docs = res.data || [];
    var rows = docs.map(function(row){
      var ft = String(row.file_type||'').toUpperCase();
      return '<div style="border:1px solid rgba(0,229,192,.14);border-radius:10px;padding:14px 16px;margin-bottom:10px;background:rgba(255,255,255,.02)">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">' +
            '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">' +
              '<span style="font-weight:700;font-size:14px;color:#eef4ff">'+esc(row.title)+'</span>' +
              (row.category ? '<span style="font-size:10.5px;letter-spacing:.5px;color:var(--teal);background:rgba(0,229,192,.1);border:1px solid rgba(0,229,192,.25);border-radius:20px;padding:2px 9px">'+esc(row.category)+'</span>' : '') +
            '</div>' +
            '<a class="gl-doc-dl" href="'+esc(row.file_url)+'" download style="white-space:nowrap;padding:8px 14px;background:rgba(0,229,192,.14);border:1px solid rgba(0,229,192,.35);border-radius:7px;color:var(--teal);font-weight:700;font-size:12px;text-decoration:none">⬇ Download '+esc(ft)+'</a>' +
          '</div>' +
          (row.description ? '<div style="font-size:12px;color:#9aa7bd;margin-top:8px;line-height:1.5">'+esc(row.description)+'</div>' : '') +
        '</div>';
    }).join('');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:22px;width:100%;max-width:760px;color:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
          '<div style="font-family:var(--ff-disp);font-size:17px;letter-spacing:1.5px;color:var(--teal)">📄 DOCUMENTS</div>' +
          '<button onclick="document.getElementById(\'gl-gmp-docs\').remove()" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        (docs.length ? rows : '<div style="color:#9aa7bd;padding:20px 0">No documents posted yet.</div>') +
      '</div>';
  };

  // Render the hub into its page container once the DOM is ready.
  function boot(){ try { if(document.getElementById('cpg-gmp')) window.glRenderGMPHub(); } catch(e){} }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  // Re-render if the page node appears later (SPA builds it after login).
  try {
    var mo = new MutationObserver(function(){ var h = document.getElementById('cpg-gmp'); if(h && !h.getAttribute('data-gmp-ready')){ h.setAttribute('data-gmp-ready','1'); window.glRenderGMPHub(); } });
    mo.observe(document.documentElement, { childList:true, subtree:true });
  } catch(e){}

  console.log('[GL] GMP logging module loaded');
}());
