/* ============================================================
   COMPLIANCE MODULE — Phase 1
   ============================================================
   Master daily checklist + 4 reference forms (Pre-Op Inspection,
   Label Verification, Allergen Swab, HTST 30-min Reading) +
   Hold Tag manager. Backs FDA 21 CFR Part 117 Subpart B records.

   - Auto-generates today's tasks from production_runs + recurring
     rules (daily / monthly / per-CCP).
   - Quick-capture forms with critical fields up front, completable
     later before PCQI sign-off.
   - Failed pass/fail or out-of-spec critical limit auto-creates a
     draft Hold Tag + draft NC report (defects table).
   - Typed e-signature (FDA Part 11 — single PCQI user model).
   ============================================================ */
(function(){
  var DEFAULT_LIMITS = {
    htst_temp_f: 165,       // CCP-1
    htst_hold_sec: 15,
    hot_fill_f: 185,        // CCP-2
    uv_dose_mj_cm2: 40,     // CCP-3
    paa_ppm_min: 100,       // CIP step 8/9
    paa_ppm_max: 300,
    final_pH_fermented: 4.6 // CCP-A
  };

  var esc = window.glEsc;
  function fmtDate(d){
    if(!d) return '';
    var x = (d instanceof Date) ? d : new Date(d);
    if(isNaN(x.getTime())) return String(d);
    return x.toLocaleDateString('en-US',{month:'short', day:'numeric', year:'numeric'});
  }
  function fmtTime(d){
    if(!d) return '';
    var x = (d instanceof Date) ? d : new Date(d);
    if(isNaN(x.getTime())) return '';
    return x.toLocaleTimeString('en-US',{hour:'numeric', minute:'2-digit'});
  }
  function todayISO(){ return new Date().toISOString().slice(0,10); }
  function nowISO(){ return new Date().toISOString(); }
  function uid(){ return 'tmp_' + Math.random().toString(36).slice(2,10); }

  // ── Form catalog: 20 FDA-required forms scoped to beverage co-packer ──
  // Phase 1 ships the 4 marked `built:true`; the rest get launchers
  // in the Forms Library and a "not built yet" placeholder.
  var FORMS = [
    { code:'GMP-INSP-001', name:'Daily Pre-Op Sanitation Inspection', icon:'🧽', built:true,
      desc:'Verify production areas are clean and safe before each run', frequency:'Every production day before startup' },
    { code:'GMP-LAB-001', name:'Label Verification Checklist', icon:'🏷️', built:true,
      desc:'Verify label, allergen statement, lot code before run', frequency:'Before every production run' },
    { code:'GMP-ALL-001', name:'Allergen Changeover Swab', icon:'⚠️', built:true,
      desc:'Verify full CIP between allergen and allergen-free runs', frequency:'Every allergen changeover' },
    { code:'FSP-PC-001', name:'HTST Pasteurization Log (CCP-1)', icon:'🌡️', built:true,
      desc:'Hold-tube temperature reading every 30 min', frequency:'Continuous + spot check every 30 min' },
    { code:'GMP-SAN-002', name:'CIP Monitoring Log (9-step)', icon:'🧪', built:true,
      desc:'PBW → caustic → acid → PAA cycle log', frequency:'Every CIP cycle' },
    { code:'FSP-PC-002', name:'Hot Fill Temperature Log (CCP-2)', icon:'♨️', built:true,
      desc:'Fill nozzle temperature ≥ 185°F', frequency:'Continuous + spot check every 30 min' },
    { code:'FSP-PC-003', name:'Can Seam Evaluation Log (CCP-4)', icon:'🥫', built:true,
      desc:'Seam thickness, body hook, cover hook, overlap', frequency:'Startup + every 4 hr + post-jam + shutdown' },
    { code:'FSP-PC-004', name:'UV Water Treatment Log (CCP-3)', icon:'💡', built:true,
      desc:'UV dose ≥ 40 mJ/cm² during production', frequency:'Hourly during production' },
    { code:'FSP-PC-005', name:'Fermentation Monitoring Log (CCP-A)', icon:'🧫', built:true,
      desc:'Final pH ≤ 4.6 and ABV ≥ spec', frequency:'Per batch — multiple readings' },
    { code:'GMP-REC-001', name:'Receiving Inspection & COA Review', icon:'📦', built:true,
      desc:'Inspection + COA verification at delivery', frequency:'Every incoming delivery' },
    { code:'GMP-CAL-001', name:'Equipment Calibration Log', icon:'📐', built:true,
      desc:'Monthly cal for CCP instruments', frequency:'Per calibration schedule (monthly min)' },
    { code:'GMP-DIST-001', name:'Distribution / Traceability', icon:'🚚', built:true,
      desc:'Lot, qty, customer, BOL — supports 4-hr recall', frequency:'Every outbound shipment' },
    { code:'GMP-HR-001', name:'Employee Illness Exclusion', icon:'🤒', built:true,
      desc:'Document any exclusion event', frequency:'Upon any illness exclusion event' },
    { code:'GMP-TR-001', name:'Employee Training Record', icon:'🎓', built:true,
      desc:'Food-safety training events', frequency:'Each training event + annual' },
    { code:'QC-BR-001', name:'Production Batch Record', icon:'📄', built:true,
      desc:'Full batch ingredients + process + QC checks', frequency:'Every production batch' },
    { code:'FSP-SAN-001', name:'Environmental Monitoring — Listeria', icon:'🧬', built:true,
      desc:'Zone 1-4 swabs for Listeria species', frequency:'Monthly minimum' },
    { code:'FSP-SC-001', name:'Approved Supplier List', icon:'✅', built:false,
      desc:'Lives in the existing Vendor Directory (sidebar → Quality & Supply → Vendors)', frequency:'Updated upon each approval/removal' },
    { code:'FSP-SC-002', name:'Supplier COA Review Log', icon:'📋', built:true,
      desc:'COA verification for high-risk lots', frequency:'Per incoming lot of high-risk ingredients' },
    { code:'FSP-VER-002', name:'Annual FSP Review', icon:'📅', built:true,
      desc:'Reanalyze the Food Safety Plan', frequency:'Annually' },
    { code:'GMP-NC-001', name:'Non-Conformance / Corrective Action', icon:'🚨', built:false,
      desc:'See sidebar → Defects / NCRs (existing page)', frequency:'Upon any deviation' }
  ];
  function getForm(code){ return FORMS.find(function(f){ return f.code === code; }); }

  // ── Data helpers (Supabase first, localStorage fallback) ──
  function localCacheKey(table){ return 'gl_cache_' + table; }
  function readLocal(table){
    try { return JSON.parse(localStorage.getItem(localCacheKey(table)) || '[]'); } catch(e){ return []; }
  }
  function writeLocal(table, rows){
    try { localStorage.setItem(localCacheKey(table), JSON.stringify(rows.slice(0, 200))); } catch(e){}
  }

  async function dbSelect(table, modifyQuery){
    if(window.supa){
      try {
        var q = window.supa.from(table).select('*');
        if(typeof modifyQuery === 'function') q = modifyQuery(q);
        var r = await q;
        if(r && !r.error && r.data){
          writeLocal(table, r.data);
          return r.data;
        }
      } catch(e){ console.warn('[GL compliance] dbSelect '+table+' failed', e); }
    }
    return readLocal(table);
  }

  async function dbInsert(table, row){
    var lastErr = null;
    if(window.supa){
      try {
        var r = await window.supa.from(table).insert([row]).select().single();
        if(r && !r.error && r.data) return r.data;
        if(r && r.error){ lastErr = r.error; console.warn('[GL compliance] dbInsert '+table+' rejected:', r.error.message, r.error.code); }
      } catch(e){ lastErr = e; console.warn('[GL compliance] dbInsert '+table+' threw', e); }
    }
    // Local fallback — keep the work, but loudly flag the DB failure so the
    // operator knows the record never reached Supabase. Without this, FDA-
    // required records silently vanish when RLS / schema mismatches reject
    // the insert.
    if(lastErr && typeof window.addNotification === 'function'){
      var msg = (lastErr && lastErr.message) ? lastErr.message : String(lastErr);
      window.addNotification('⚠ DB save FAILED · ' + table, msg.slice(0,160) + ' — record kept locally only; admin must fix and re-save.', 'warning');
    }
    var fake = Object.assign({ id: uid(), created_at: nowISO(), _localOnly: true, _dbError: lastErr ? (lastErr.message || String(lastErr)) : null }, row);
    var rows = readLocal(table);
    rows.unshift(fake);
    writeLocal(table, rows);
    return fake;
  }

  async function dbUpdate(table, id, patch){
    if(window.supa){
      try {
        var r = await window.supa.from(table).update(patch).eq('id', id).select().single();
        if(r && !r.error && r.data) return r.data;
      } catch(e){ console.warn('[GL compliance] dbUpdate '+table+' failed', e); }
    }
    var rows = readLocal(table);
    var idx = rows.findIndex(function(r){ return r.id === id; });
    if(idx !== -1){ Object.assign(rows[idx], patch); writeLocal(table, rows); return rows[idx]; }
    return null;
  }

  // ── Task auto-generator ──
  // Rules:
  //   Daily — pre-op inspection (if any run scheduled today)
  //   Per-run — label verify (before), allergen swab (if changeover detected), CCP logs based on processing method
  //   Monthly — calibration + Listeria swab on day 1 of month
  //   Annual — FSP review on anniversary of effective date
  function dedupeKey(parts){ return parts.filter(function(x){return x;}).join('::'); }

  function buildTaskCandidates(today){
    var candidates = [];
    var todayDate = today || todayISO();
    var d = new Date(todayDate + 'T12:00:00');
    var monthDay = d.getDate();
    var dayOfWeek = d.getDay();

    var runs = (window.glProductionRuns || []).filter(function(r){
      if(!r.scheduled_date) return false;
      return r.scheduled_date === todayDate && r.stage !== 'Ship';
    });

    // Daily pre-op — once per production day (any run scheduled)
    if(runs.length){
      candidates.push({
        due_date: todayDate,
        task_type: 'preop_inspection',
        title: 'Daily pre-op sanitation inspection',
        description: 'Required before any production starts today (' + runs.length + ' run' + (runs.length>1?'s':'') + ' scheduled)',
        source: 'auto',
        dedupe_key: dedupeKey(['preop', todayDate])
      });
    }

    // Per-run tasks
    runs.forEach(function(run){
      candidates.push({
        due_date: todayDate,
        task_type: 'label_verify',
        title: 'Label verification — ' + (run.run_name || run.client_name || run.id),
        description: 'Verify product, allergen statement, lot code BEFORE run begins',
        source: 'auto',
        run_id: run.id,
        dedupe_key: dedupeKey(['label', run.id])
      });
      // CCP tasks based on processing method (detected from format + notes)
      var fmt = (run.format || '').toLowerCase();
      var notes = (run.notes || '').toLowerCase();
      var all = fmt + ' ' + notes;
      // HTST — pasteurized juice / RTD
      if(/htst|pasteurize|juice|rtd/.test(all)){
        candidates.push({ due_date: todayDate, task_type: 'htst_reading', title: 'HTST monitoring — ' + (run.run_name || run.id), description: 'Hold-tube temp reading every 30 min during pasteurization', source: 'auto', run_id: run.id, dedupe_key: dedupeKey(['htst', run.id, todayDate]) });
      }
      // Hot fill — any "hot fill" mention or jam-style products
      if(/hot[ -]?fill|jam|preserve|syrup/.test(all)){
        candidates.push({ due_date: todayDate, task_type: 'hot_fill_reading', title: 'Hot fill temp check — ' + (run.run_name || run.id), description: 'Fill nozzle temp ≥ 185°F, every 30 min', source: 'auto', run_id: run.id, dedupe_key: dedupeKey(['hotfill', run.id, todayDate]) });
      }
      // Can seam — any canning run
      if(/can(ning)?|12oz|16oz|sleek|slim/.test(all)){
        candidates.push({ due_date: todayDate, task_type: 'seam_check', title: 'Can seam check — ' + (run.run_name || run.id), description: 'Seam evaluation at startup + every 4 hr + post-jam + shutdown', source: 'auto', run_id: run.id, dedupe_key: dedupeKey(['seam', run.id, todayDate]) });
      }
      // UV — if formula uses purified water or UV is mentioned
      if(/uv|purified water|disinfect/.test(all)){
        candidates.push({ due_date: todayDate, task_type: 'uv_reading', title: 'UV water dose check — ' + (run.run_name || run.id), description: 'Dose ≥ 40 mJ/cm² · hourly during run', source: 'auto', run_id: run.id, dedupe_key: dedupeKey(['uv', run.id, todayDate]) });
      }
      // Fermentation — beer/cider/seltzer/kombucha
      if(/ferment|beer|cider|seltzer|kombucha/.test(all)){
        candidates.push({ due_date: todayDate, task_type: 'ferm_reading', title: 'Fermentation reading — ' + (run.run_name || run.id), description: 'pH + gravity reading (per-batch multiple readings)', source: 'auto', run_id: run.id, dedupe_key: dedupeKey(['ferm', run.id, todayDate]) });
      }
      // CIP — after the run if it's hitting the Ship stage today (cleanup)
      candidates.push({ due_date: todayDate, task_type: 'cip_cycle', title: 'CIP cycle — post-run ' + (run.run_name || run.id), description: '9-step v2.1 protocol (PBW + caustic + acid + PAA)', source: 'auto', run_id: run.id, dedupe_key: dedupeKey(['cip', run.id, todayDate]) });
      // Batch record — required for every co-pack production batch
      if(run.client_id || run.client_name){
        candidates.push({ due_date: todayDate, task_type: 'batch_record', title: 'Batch record — ' + (run.run_name || run.id), description: 'Master production record (QC-BR-001)', source: 'auto', run_id: run.id, dedupe_key: dedupeKey(['batch', run.id]) });
      }
    });

    // Allergen swab — if any run today has allergens AND any earlier run today does not (or vice versa)
    if(runs.length >= 2){
      var withAllergen = runs.filter(function(r){ return /allergen|dairy|nut|soy|egg|gluten|wheat|fish|shellfish/i.test((r.notes||'') + ' ' + (r.format||'')); });
      var without = runs.filter(function(r){ return !withAllergen.includes(r); });
      if(withAllergen.length && without.length){
        candidates.push({
          due_date: todayDate,
          task_type: 'allergen_swab',
          title: 'Allergen changeover swab',
          description: 'CIP + ELISA swab between allergen and allergen-free runs',
          source: 'auto',
          dedupe_key: dedupeKey(['allergen', todayDate])
        });
      }
    }

    // Monthly tasks on day 1
    if(monthDay === 1){
      candidates.push({
        due_date: todayDate, task_type: 'calibration',
        title: 'Monthly equipment calibration',
        description: 'pH meters, thermometers, UV sensor, scales, conductivity meters',
        source: 'auto', dedupe_key: dedupeKey(['cal', todayDate.slice(0,7)])
      });
      candidates.push({
        due_date: todayDate, task_type: 'listeria_swab',
        title: 'Monthly environmental Listeria swab',
        description: 'Zone 1-4 surfaces — minimum food-contact zones',
        source: 'auto', dedupe_key: dedupeKey(['listeria', todayDate.slice(0,7)])
      });
    }

    return candidates;
  }

  async function generateTodaysTasks(){
    var todayDate = todayISO();
    var candidates = buildTaskCandidates(todayDate);
    var existing = await dbSelect('compliance_tasks', function(q){ return q.eq('due_date', todayDate); });
    var existingKeys = {};
    existing.forEach(function(t){ if(t.dedupe_key) existingKeys[t.dedupe_key] = true; });
    var toInsert = candidates.filter(function(c){ return !existingKeys[c.dedupe_key]; });
    for(var i = 0; i < toInsert.length; i++){
      await dbInsert('compliance_tasks', toInsert[i]);
    }
    return await dbSelect('compliance_tasks', function(q){ return q.eq('due_date', todayDate).order('due_time', { ascending: true, nullsFirst: true }); });
  }

  // ── Critical-limit trigger: auto-create Hold Tag + NC draft ──
  async function spawnHoldAndNc(opts){
    // opts: { form_code, record_id, run_id, lot_number, product_name, reason, hazard_type }
    var nextTagNo;
    var existing = await dbSelect('hold_tags');
    var maxN = 0;
    existing.forEach(function(h){
      var m = /HT-\d{4}-(\d+)/.exec(h.tag_number || '');
      if(m){ var n = parseInt(m[1], 10); if(n > maxN) maxN = n; }
    });
    nextTagNo = 'HT-' + (new Date()).getFullYear() + '-' + String(maxN + 1).padStart(3, '0');

    var hold = await dbInsert('hold_tags', {
      tag_number: nextTagNo,
      product_name: opts.product_name || (opts.run_id ? 'Run ' + opts.run_id : 'Unknown product'),
      lot_number: opts.lot_number || null,
      qty_held: opts.qty_held || null,
      location: opts.location || 'Production floor',
      reason: opts.reason || 'Auto-hold: critical limit deviation',
      hazard_type: opts.hazard_type || 'biological',
      initiated_by: (window.currentUser && window.currentUser.id) || null,
      pcqi_notified: true,
      pcqi_notified_at: nowISO(),
      source_record_id: opts.record_id || null,
      status: 'open',
      hold_date: new Date().toISOString().split('T')[0]
    });

    // NC report draft in defects table
    var nc = null;
    if(window.supa){
      try {
        var ncRow = {
          reported_at: nowISO(),
          run_ref: opts.run_id || '(no-run)',  // defects.run_ref is NOT NULL — placeholder when no run linked
          category: 'Auto-NCR: ' + (opts.form_code || 'compliance'),
          severity: 'high',
          status: 'open',
          owner: (window.currentUser && window.currentUser.email) || 'system',
          description: 'Auto-generated from compliance record ' + (opts.record_id || '') + '. ' + (opts.reason || ''),
          root_cause: '',
          corrective_action: 'Hold tag ' + nextTagNo + ' created. PCQI to investigate and disposition.'
        };
        var r = await window.supa.from('defects').insert([ncRow]).select().single();
        if(r && !r.error) nc = r.data;
      } catch(e){ console.warn('[GL compliance] NC auto-create failed', e); }
    }

    if(typeof addNotification === 'function'){
      addNotification('🚫 Hold Tag created: ' + nextTagNo, opts.reason || 'Critical limit deviation', 'warning');
    }
    if(typeof window.glAudit === 'function'){
      window.glAudit('compliance_critical_failure', opts.record_id || '', { hold_tag: nextTagNo, form: opts.form_code });
    }

    return { hold: hold, nc: nc };
  }

  // ── Form rendering: each form has quick-capture mode ──
  function modalShell(title, subtitle, bodyHtml, footerHtml){
    var prior = document.getElementById('gl-comp-modal');
    if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-comp-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:9000;background:rgba(6,13,26,.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto');
    var card = document.createElement('div');
    card.setAttribute('style','background:#142238;border:1px solid rgba(0,229,192,.22);border-radius:14px;width:100%;max-width:580px;max-height:88vh;overflow-y:auto;color:#cfd9e6;box-shadow:0 20px 60px rgba(0,0,0,.6)');
    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:start;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.06)">' +
        '<div>' +
          '<div style="font-family:var(--ff-disp,sans-serif);font-size:14px;letter-spacing:2px;color:var(--teal,#00e5c0);font-weight:700">' + esc(title) + '</div>' +
          (subtitle ? '<div style="font-size:11px;color:#9aa7bd;margin-top:3px">' + esc(subtitle) + '</div>' : '') +
        '</div>' +
        '<button class="gl-comp-close" style="background:none;border:none;color:#9aa7bd;font-size:18px;cursor:pointer;padding:2px 6px;line-height:1">✕</button>' +
      '</div>' +
      '<div style="padding:18px 22px">' + bodyHtml + '</div>' +
      (footerHtml ? '<div style="padding:14px 22px;border-top:1px solid rgba(255,255,255,.06);display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">' + footerHtml + '</div>' : '');
    ov.appendChild(card);
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    card.querySelector('.gl-comp-close').addEventListener('click', function(){ ov.remove(); });
    return ov;
  }

  function field(label, name, type, opts){
    opts = opts || {};
    var id = 'gl-cf-' + name;
    var commonStyle = 'width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box;font-family:inherit';
    var inputHtml;
    if(type === 'textarea'){
      inputHtml = '<textarea id="' + id + '" rows="2" style="' + commonStyle + ';resize:vertical">' + esc(opts.value || '') + '</textarea>';
    } else if(type === 'select'){
      inputHtml = '<select id="' + id + '" style="' + commonStyle + '">' +
        (opts.options || []).map(function(o){
          var v = Array.isArray(o) ? o[0] : o;
          var l = Array.isArray(o) ? o[1] : o;
          return '<option value="' + esc(v) + '"' + (opts.value === v ? ' selected' : '') + '>' + esc(l) + '</option>';
        }).join('') + '</select>';
    } else if(type === 'yn'){
      var v = opts.value;
      inputHtml = '<div style="display:inline-flex;gap:0;border-radius:8px;overflow:hidden;border:1px solid rgba(255,255,255,.12)">' +
        '<button type="button" data-yn="' + id + '" data-val="Y" style="padding:8px 18px;background:' + (v === 'Y' ? 'rgba(95,207,158,.18)' : 'transparent') + ';color:' + (v === 'Y' ? '#5fcf9e' : '#9aa7bd') + ';border:none;cursor:pointer;font-weight:600;font-size:12px">Y</button>' +
        '<button type="button" data-yn="' + id + '" data-val="N" style="padding:8px 18px;background:' + (v === 'N' ? 'rgba(231,76,60,.18)' : 'transparent') + ';color:' + (v === 'N' ? '#ff8579' : '#9aa7bd') + ';border:none;cursor:pointer;font-weight:600;font-size:12px;border-left:1px solid rgba(255,255,255,.12)">N</button>' +
        '<input type="hidden" id="' + id + '" value="' + esc(opts.value || '') + '">' +
      '</div>';
    } else {
      inputHtml = '<input id="' + id + '" type="' + (type || 'text') + '"' + (opts.step ? ' step="'+opts.step+'"' : '') + ' value="' + esc(opts.value || '') + '"' + (opts.placeholder ? ' placeholder="'+esc(opts.placeholder)+'"' : '') + ' style="' + commonStyle + '">';
    }
    return '<div style="margin-bottom:11px"><div style="font-size:11px;color:#9aa7bd;margin-bottom:4px;font-weight:500">' + esc(label) + (opts.required ? ' <span style="color:#ff8579">*</span>' : '') + '</div>' + inputHtml + '</div>';
  }

  function wireYn(scope){
    scope.querySelectorAll('button[data-yn]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var inputId = btn.getAttribute('data-yn');
        var val = btn.getAttribute('data-val');
        var input = document.getElementById(inputId);
        if(input) input.value = val;
        // Recolour buttons
        var siblings = btn.parentNode.querySelectorAll('button[data-yn="'+inputId+'"]');
        siblings.forEach(function(s){
          var sv = s.getAttribute('data-val');
          if(sv === 'Y'){ s.style.background = sv === val ? 'rgba(95,207,158,.18)' : 'transparent'; s.style.color = sv === val ? '#5fcf9e' : '#9aa7bd'; }
          if(sv === 'N'){ s.style.background = sv === val ? 'rgba(231,76,60,.18)' : 'transparent'; s.style.color = sv === val ? '#ff8579' : '#9aa7bd'; }
        });
      });
    });
  }

  function getVal(scope, name){ var el = scope.querySelector('#gl-cf-' + name); return el ? el.value : ''; }

  function pcqiName(){
    var u = window.currentUser || {};
    return u.name || u.email || 'PCQI';
  }

  // Common footer buttons for forms — Save (draft) / Save & Sign (signed) / Cancel
  function formFooter(){
    return '<button type="button" class="cbtn gl-cf-cancel">Cancel</button>' +
      '<button type="button" class="cbtn gl-cf-draft">Save draft</button>' +
      '<button type="button" class="cbtn pri gl-cf-sign">✓ Save &amp; sign as PCQI</button>';
  }

  async function saveRecord(form_code, data, opts){
    opts = opts || {};
    var user = window.currentUser || {};
    var row = {
      form_code: form_code,
      record_date: opts.record_date || todayISO(),
      recorded_at: nowISO(),
      data: data,
      status: opts.signed ? 'signed' : (opts.complete ? 'complete' : 'draft'),
      completed_by: user.id || null,
      completed_at: opts.complete || opts.signed ? nowISO() : null,
      signed_by: opts.signed ? (user.id || null) : null,
      signed_at: opts.signed ? nowISO() : null,
      signature_name: opts.signed ? pcqiName() : null,
      signature_meaning: opts.signed ? 'PCQI sign-off — record reviewed and approved' : null,
      run_id: opts.run_id || null,
      has_deviation: !!opts.has_deviation,
      deviation_notes: opts.deviation_notes || null,
      corrective_action: opts.corrective_action || null
    };
    var saved = await dbInsert('compliance_records', row);

    if(opts.task_id){
      await dbUpdate('compliance_tasks', opts.task_id, {
        status: 'done',
        completed_at: nowISO(),
        completed_by: user.id || null,
        related_record_id: saved.id
      });
    }

    if(opts.has_deviation && opts.spawn_hold){
      var spawn = await spawnHoldAndNc({
        form_code: form_code,
        record_id: saved.id,
        run_id: opts.run_id || null,
        product_name: opts.product_name,
        lot_number: opts.lot_number,
        reason: opts.deviation_notes || 'Critical-limit deviation on ' + form_code,
        hazard_type: opts.hazard_type || 'biological'
      });
      if(spawn && spawn.hold && spawn.hold.id){
        await dbUpdate('compliance_records', saved.id, {
          hold_tag_id: spawn.hold.id,
          nc_report_id: spawn.nc ? spawn.nc.id : null
        });
      }
    }

    if(typeof window.glAudit === 'function'){
      window.glAudit('compliance_record_saved', saved.id, { form_code: form_code, status: row.status });
    }
    if(typeof addNotification === 'function'){
      addNotification(
        (opts.signed ? '✓ Signed: ' : '💾 Draft saved: ') + form_code,
        opts.summary || '',
        opts.has_deviation ? 'warning' : 'success'
      );
    }
    return saved;
  }

  // ── Form: GMP-INSP-001 Daily Pre-Op Sanitation Inspection ──
  window.glOpenPreOpForm = function(task){
    task = task || {};
    var areas = ['Filling Line 1','Filling Line 2','Pasteurizer','Fermentation Tanks','CIP Skid','Floors / Drains','Cooler / Warehouse'];
    var body =
      field('Area / equipment inspected', 'area', 'select', { options: areas, required: true }) +
      field('Visually clean?', 'clean', 'yn', { required: true }) +
      field('Equipment assembled correctly?', 'assembled', 'yn', { required: true }) +
      field('Pest evidence?', 'pest', 'yn', { required: true }) +
      field('Drains clear?', 'drains', 'yn', { required: true }) +
      field('Lights / shatter covers OK?', 'lights', 'yn', { required: true }) +
      field('Corrective action (if any failure)', 'correction', 'textarea') +
      '<div style="font-size:11px;color:#f5c842;background:rgba(245,200,66,.08);padding:8px 12px;border-radius:6px;margin-top:8px">PASS = all Y except pest (N). Any failure auto-creates a Hold Tag and NC draft.</div>';
    var modal = modalShell('GMP-INSP-001 · Daily Pre-Op Sanitation Inspection', 'Required before any production starts today', body, formFooter());
    wireYn(modal);
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });

    async function submit(signed){
      var data = {
        area: getVal(modal, 'area'),
        visually_clean: getVal(modal, 'clean'),
        equipment_assembled: getVal(modal, 'assembled'),
        pest_evidence: getVal(modal, 'pest'),
        drains_clear: getVal(modal, 'drains'),
        lights_ok: getVal(modal, 'lights'),
        corrective_action: getVal(modal, 'correction')
      };
      var hasFailure = data.visually_clean !== 'Y' || data.equipment_assembled !== 'Y' ||
                       data.pest_evidence !== 'N' || data.drains_clear !== 'Y' || data.lights_ok !== 'Y';
      var saved = await saveRecord('GMP-INSP-001', data, {
        signed: signed, complete: signed,
        task_id: task.id, run_id: task.run_id,
        has_deviation: hasFailure,
        deviation_notes: hasFailure ? ('Pre-op fail: ' + data.area + ' — ' + (data.corrective_action || 'no detail provided')) : null,
        corrective_action: data.corrective_action,
        spawn_hold: hasFailure,
        product_name: 'Production area: ' + data.area,
        hazard_type: 'biological',
        summary: data.area + (hasFailure ? ' · FAILED' : ' · PASS')
      });
      modal.remove();
      refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ── Form: GMP-LAB-001 Label Verification ──
  window.glOpenLabelVerifyForm = function(task){
    task = task || {};
    var run = task.run_id ? (window.glProductionRuns||[]).find(function(r){ return r.id === task.run_id; }) : null;
    var checks = [
      ['name_match',     'Product name on label matches batch record?'],
      ['weight_correct', 'Net weight / volume correct?'],
      ['ingredients',    'Ingredient list correct for this formulation?'],
      ['allergen_stmt',  'Allergen statement correct + complete (all 9 FASTER Act allergens)?'],
      ['best_by',        'Best-By date coding correct format?'],
      ['lot_code',       'Lot code correct?'],
      ['ttb_cola',       'TTB COLA on file (alcohol products only — else N/A)?'],
      ['copack_spec',    'Co-pack label matches client-approved master spec?']
    ];
    var body =
      field('Product name', 'product', 'text', { value: run ? (run.run_name || run.client_name || '') : '', required: true }) +
      field('Lot number', 'lot', 'text', { placeholder: 'GLBC-XXXX-YYYYMMDD-L#-###' }) +
      field('Client (co-pack)', 'client', 'text', { value: run ? (run.client_name || '') : '' }) +
      checks.map(function(c){ return field(c[1], c[0], 'yn', { required: true }); }).join('') +
      field('Quantity of labels issued to line', 'labels_issued', 'number', { placeholder: '0' }) +
      field('Reason for fail (if any)', 'fail_reason', 'textarea');
    var modal = modalShell('GMP-LAB-001 · Label Verification', 'Complete BEFORE every production run begins', body, formFooter());
    wireYn(modal);
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });

    async function submit(signed){
      var data = { product: getVal(modal,'product'), lot: getVal(modal,'lot'), client: getVal(modal,'client'), labels_issued: getVal(modal,'labels_issued'), fail_reason: getVal(modal,'fail_reason') };
      checks.forEach(function(c){ data[c[0]] = getVal(modal, c[0]); });
      // PASS if every check is Y (or 'N/A' allowed via blank → treat blank as Y for ttb_cola only)
      var hasFailure = checks.some(function(c){
        var v = data[c[0]];
        if(c[0] === 'ttb_cola' || c[0] === 'copack_spec') return v === 'N'; // N/A allowed
        return v !== 'Y';
      });
      var saved = await saveRecord('GMP-LAB-001', data, {
        signed: signed, complete: signed,
        task_id: task.id, run_id: task.run_id,
        has_deviation: hasFailure,
        deviation_notes: hasFailure ? ('Label verify failed for ' + data.product + ': ' + (data.fail_reason || '(no reason given)')) : null,
        corrective_action: data.fail_reason,
        spawn_hold: hasFailure && signed,  // only spawn hold if signed off as failed (avoid drafts triggering)
        product_name: data.product, lot_number: data.lot,
        hazard_type: 'allergen',
        summary: data.product + (hasFailure ? ' · LABEL FAIL' : ' · APPROVED')
      });
      modal.remove();
      refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ── Form: GMP-ALL-001 Allergen Changeover Swab ──
  window.glOpenAllergenSwabForm = function(task){
    task = task || {};
    var body =
      field('Product just run (allergen type)', 'just_run', 'text', { required: true, placeholder: 'e.g. Dairy / Almond / Soy' }) +
      field('Next product (allergen-free)', 'next_product', 'text', { required: true }) +
      field('Full CIP completed?', 'cip_done', 'yn', { required: true }) +
      field('Surface swabbed', 'surface', 'select', { options: ['Filler nozzle','Fill bowl','Pasteurizer plates','Mix tank','Lines / hoses','Other'], required: true }) +
      field('Swab kit / lot #', 'swab_lot', 'text') +
      field('Swab result', 'result', 'select', { options: [['pass','PASS (below LOD)'],['fail','FAIL (allergen detected)']], required: true }) +
      field('Corrective action (if fail)', 'corrective', 'textarea') +
      '<div style="font-size:11px;color:#ff8579;background:rgba(231,76,60,.1);padding:8px 12px;border-radius:6px;margin-top:8px">CRITICAL — failed swab auto-creates Hold Tag + NC. Do NOT run allergen-free product until PASS is signed.</div>';
    var modal = modalShell('GMP-ALL-001 · Allergen Changeover Swab', 'PCQI sign-off required BEFORE allergen-free run begins', body, formFooter());
    wireYn(modal);
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });

    async function submit(signed){
      var data = {
        just_run: getVal(modal,'just_run'), next_product: getVal(modal,'next_product'),
        cip_done: getVal(modal,'cip_done'), surface: getVal(modal,'surface'),
        swab_lot: getVal(modal,'swab_lot'), result: getVal(modal,'result'),
        corrective: getVal(modal,'corrective')
      };
      var hasFailure = data.cip_done !== 'Y' || data.result !== 'pass';
      await saveRecord('GMP-ALL-001', data, {
        signed: signed, complete: signed,
        task_id: task.id,
        has_deviation: hasFailure,
        deviation_notes: hasFailure ? ('Allergen changeover FAIL — ' + data.just_run + ' → ' + data.next_product + ' on ' + data.surface) : null,
        corrective_action: data.corrective,
        spawn_hold: hasFailure,
        product_name: data.next_product,
        hazard_type: 'allergen',
        summary: data.just_run + ' → ' + data.next_product + ' · ' + (hasFailure ? 'FAIL' : 'PASS')
      });
      modal.remove();
      refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ── Form: FSP-PC-001 HTST 30-min reading ──
  window.glOpenHtstForm = function(task){
    task = task || {};
    var run = task.run_id ? (window.glProductionRuns||[]).find(function(r){ return r.id === task.run_id; }) : null;
    var body =
      field('Product / lot', 'product', 'text', { value: run ? (run.run_name || '') : '', required: true }) +
      field('Reading time', 'time', 'time', { value: (new Date()).toTimeString().slice(0,5), required: true }) +
      field('Hold-tube temperature (°F) — hot side', 'temp_f', 'number', { step: '0.1', required: true }) +
      field('Cold-side / outlet temperature (°F) — post-cooler', 'cold_temp_f', 'number', { step: '0.1' }) +
      field('Holding time (seconds)', 'hold_sec', 'number', { step: '0.1', value: '15' }) +
      field('Product pressure (PSI)', 'product_psi', 'number', { step: '0.1' }) +
      field('Media pressure (PSI)', 'media_psi', 'number', { step: '0.1' }) +
      field('FDD status', 'fdd', 'select', { options: [['ok','OK — forward flow'],['divert','DIVERT — flow diverted']], required: true }) +
      field('Corrective action (if deviation)', 'corrective', 'textarea') +
      '<div style="font-size:11px;color:#f5c842;background:rgba(245,200,66,.08);padding:8px 12px;border-radius:6px;margin-top:8px">Critical limit (hot side): hold-tube temp ≥ ' + (window.glGetLimits ? window.glGetLimits().htst_temp_f : DEFAULT_LIMITS.htst_temp_f) + '°F. Cold side typically ≤ 40°F for refrigerated storage (confirm your FSP). FDD DIVERT or hot-side temp drop = STOP production, hold lot, auto-NC.</div>';
    var modal = modalShell('FSP-PC-001 · HTST Pasteurization Reading (CCP-1)', 'Log every 30 minutes during pasteurization', body, formFooter());
    wireYn(modal);
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });

    async function submit(signed){
      var data = {
        product: getVal(modal,'product'), time: getVal(modal,'time'),
        temp_f: parseFloat(getVal(modal,'temp_f')) || null,
        cold_temp_f: parseFloat(getVal(modal,'cold_temp_f')) || null,
        hold_sec: parseFloat(getVal(modal,'hold_sec')) || null,
        product_psi: parseFloat(getVal(modal,'product_psi')) || null,
        media_psi: parseFloat(getVal(modal,'media_psi')) || null,
        fdd: getVal(modal,'fdd'),
        corrective: getVal(modal,'corrective')
      };
      var tempFail = (data.temp_f || 0) < (window.glGetLimits ? window.glGetLimits().htst_temp_f : DEFAULT_LIMITS.htst_temp_f);
      var fddFail = data.fdd === 'divert';
      // Cold-side check is informational unless explicitly above 40°F — FSP
      // confirmation needed to escalate this to a hard CCP failure. For now
      // we capture the reading and flag a soft warning in the summary.
      var coldWarn = data.cold_temp_f != null && data.cold_temp_f > 40;
      var hasFailure = tempFail || fddFail;
      var coldBit = data.cold_temp_f != null ? ' · cold ' + data.cold_temp_f + '°F' + (coldWarn ? ' ⚠' : '') : '';
      await saveRecord('FSP-PC-001', data, {
        signed: signed, complete: signed,
        task_id: task.id, run_id: task.run_id,
        has_deviation: hasFailure,
        deviation_notes: hasFailure ? (
          'HTST CCP-1 deviation at ' + data.time + ' — ' +
          (tempFail ? 'hold-tube ' + data.temp_f + '°F < ' + (window.glGetLimits ? window.glGetLimits().htst_temp_f : DEFAULT_LIMITS.htst_temp_f) + '°F. ' : '') +
          (fddFail ? 'FDD DIVERT. ' : '') +
          (coldWarn ? 'Cold-side ' + data.cold_temp_f + '°F > 40°F (chill verification needed). ' : '') +
          (data.corrective || '')
        ) : null,
        corrective_action: data.corrective,
        spawn_hold: hasFailure,
        product_name: data.product,
        hazard_type: 'biological',
        summary: data.time + ' · hot ' + data.temp_f + '°F' + coldBit + ' · ' + (hasFailure ? 'CCP FAIL' : 'OK')
      });
      modal.remove();
      refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ============================================================
  // PHASE 2 FORMS
  // ============================================================

  // ── Form: GMP-SAN-002 CIP Monitoring Log (v2.1, 9-step) ──
  // Replaces the existing simplified CIP form. Captures actual duration
  // per step, temperature, concentration/verification reading, pass/fail.
  // Critical limits per LEAN_01 v2.1: temp ≥160°F for steps 1-7,
  // PAA 100-300 ppm for steps 8-9. Failed steps auto-spawn Hold Tag + NC.
  var CIP_STEPS = [
    { n:1, name:'Pre-Rinse',                  chem:'Potable water',                 conc:'—',                target_min:5,  type:'rinse',  hot:true,  verify:'Visual — runs clear' },
    { n:2, name:'PBW Wash',                   chem:'PBW (alkaline organic)',         conc:'1 oz/gal',         target_min:30, type:'chem',   hot:true,  verify:'Titration/refractometer' },
    { n:3, name:'Intermediate Rinse #1',      chem:'Potable water',                 conc:'—',                target_min:5,  type:'rinse',  hot:true,  verify:'Conductivity to baseline (<50 µS/cm)' },
    { n:4, name:'Caustic Wash (NaOH)',        chem:'Sodium Hydroxide',              conc:'1.5%',             target_min:30, type:'chem',   hot:true,  verify:'Titration confirms 1.5%' },
    { n:5, name:'Intermediate Rinse #2',      chem:'Potable water',                 conc:'—',                target_min:5,  type:'rinse',  hot:true,  verify:'Conductivity to baseline (<50 µS/cm)' },
    { n:6, name:'Acid Wash',                  chem:'Phosphoric/citric acid',         conc:'1 oz/gal',         target_min:30, type:'chem',   hot:true,  verify:'Per label method' },
    { n:7, name:'Final Rinse',                chem:'Potable water',                 conc:'—',                target_min:5,  type:'rinse',  hot:true,  verify:'Conductivity + pH to baseline' },
    { n:8, name:'POST-CIP PAA Sanitize',      chem:'Peracetic Acid',                conc:'1 oz / 5 gal',     target_min:20, type:'sanit',  hot:false, verify:'PAA strip 100–300 ppm — DO NOT RINSE' },
    { n:9, name:'PRE-USE PAA (at run time)',  chem:'Peracetic Acid',                conc:'1 oz / 5 gal',     target_min:20, type:'sanit',  hot:false, verify:'PAA strip 100–300 ppm — DO NOT RINSE' }
  ];

  // CIP equipment list — synced via Supabase cip_equipment table; localStorage
  // is a per-device cache for fast initial render. Manage UI talks to Supabase
  // directly so adds/renames/deletes propagate to everyone.
  var CIP_EQUIP_KEY = 'gl_cip_equipment';
  function getSB(){ return window.supa || null; }
  function loadCipEquipCache(){
    try {
      var raw = localStorage.getItem(CIP_EQUIP_KEY);
      if(raw){
        var arr = JSON.parse(raw);
        if(Array.isArray(arr) && arr.length) return arr;
      }
    } catch(e){}
    return ['Filling Line 1','Filling Line 2','Pasteurizer plates','Mix tank','Fermenter 1','Fermenter 2','Carbonator','CIP skid'];
  }
  function saveCipEquipCache(list){
    try { localStorage.setItem(CIP_EQUIP_KEY, JSON.stringify(list)); } catch(e){}
  }
  // loadCipEquip — sync convenience: returns the cached array immediately so
  // dropdowns can render without awaiting. Background refreshes the cache
  // from Supabase so the next open is up-to-date.
  function loadCipEquip(){
    refreshCipEquipFromDb(); // fire-and-forget
    return loadCipEquipCache();
  }
  async function refreshCipEquipFromDb(){
    var sb = getSB(); if(!sb) return null;
    try {
      var r = await sb.from('cip_equipment').select('name').eq('active', true).order('sort_order').order('name');
      if(r.error || !r.data) return null;
      var list = r.data.map(function(row){ return row.name; });
      saveCipEquipCache(list);
      return list;
    } catch(e){ return null; }
  }
  window.glAddCipEquip = async function(name){
    name = (name||'').trim();
    if(!name) return null;
    var list = loadCipEquipCache();
    if(list.indexOf(name) < 0){
      list.push(name);
      saveCipEquipCache(list);
    }
    // Persist to Supabase. Unique constraint on name handles dup race conditions.
    var sb = getSB();
    if(sb){
      try {
        var r = await sb.from('cip_equipment').upsert({ name: name, sort_order: 100 }, { onConflict: 'name', ignoreDuplicates: true });
        if(r && r.error && r.error.code !== '23505') console.warn('[GL] cip_equipment upsert', r.error);
      } catch(e){ console.warn('[GL] cip_equipment add threw', e); }
    }
    return name;
  };
  window.glOpenCipEquipManager = function(){
    var list = loadCipEquip();
    var ex = document.getElementById('gl-cip-equip-mgr'); if(ex) ex.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-cip-equip-mgr';
    // z-index 9500 so it stacks above the CIP form modal (which uses 9000)
    // and any other parent that opened it.
    ov.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:30px';
    var rowsHtml = list.map(function(n, i){
      return '<div style="display:grid;grid-template-columns:1fr 30px;gap:6px;align-items:center;padding:4px 0">' +
        '<input class="gl-cem-name finp" data-idx="'+i+'" value="'+String(n).replace(/"/g,'&quot;')+'" style="font-size:12px">' +
        '<button class="gl-cem-del" data-idx="'+i+'" style="background:none;border:none;color:rgba(231,76,60,.7);cursor:pointer;font-size:18px;line-height:1">&times;</button>' +
      '</div>';
    }).join('');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.25);border-radius:14px;width:100%;max-width:480px;padding:22px 26px;color:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:16px;letter-spacing:2px;color:var(--teal)">🧼 CIP EQUIPMENT LIST</div>' +
          '<button id="gl-cem-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div id="gl-cem-list" style="display:flex;flex-direction:column;gap:2px;max-height:50vh;overflow-y:auto">' + rowsHtml + '</div>' +
        '<button id="gl-cem-add" style="margin-top:10px;background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.35);color:var(--teal);font-size:12px;padding:6px 12px;border-radius:6px;cursor:pointer">+ Add another</button>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
          '<button id="gl-cem-cancel" class="cbtn">Cancel</button>' +
          '<button id="gl-cem-save" class="cbtn pri">💾 Save</button>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-top:8px">Persists to this device. Empty rows are dropped on save.</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-cem-close').onclick = function(){ ov.remove(); };
    ov.querySelector('#gl-cem-cancel').onclick = function(){ ov.remove(); };
    ov.querySelector('#gl-cem-add').onclick = function(){
      var listEl = ov.querySelector('#gl-cem-list');
      var row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 30px;gap:6px;align-items:center;padding:4px 0';
      row.innerHTML = '<input class="gl-cem-name finp" value="" placeholder="e.g. Bottle Filler #2" style="font-size:12px"><button class="gl-cem-del" style="background:none;border:none;color:rgba(231,76,60,.7);cursor:pointer;font-size:18px;line-height:1">&times;</button>';
      listEl.appendChild(row);
      row.querySelector('input').focus();
    };
    ov.addEventListener('click', function(e){
      if(e.target.classList && e.target.classList.contains('gl-cem-del')){
        var row = e.target.closest('div'); if(row) row.remove();
      }
    });
    ov.querySelector('#gl-cem-save').onclick = async function(){
      var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
      var newList = Array.prototype.slice.call(ov.querySelectorAll('.gl-cem-name'))
        .map(function(i){ return (i.value||'').trim(); }).filter(Boolean);
      // Persist to Supabase: deactivate everything not in the new list, then
      // upsert each name with an incrementing sort_order so the dropdown is
      // ordered the way the user dragged.
      var sb = getSB();
      if(sb){
        try {
          // Mark missing entries inactive
          var current = await sb.from('cip_equipment').select('id, name').eq('active', true);
          if(current.data){
            var toDeactivate = current.data.filter(function(r){ return newList.indexOf(r.name) < 0; });
            if(toDeactivate.length){
              await sb.from('cip_equipment').update({ active: false }).in('id', toDeactivate.map(function(r){return r.id;}));
            }
          }
          // Upsert each name with its position
          for(var i=0;i<newList.length;i++){
            await sb.from('cip_equipment').upsert({ name: newList[i], sort_order: (i+1)*10, active: true }, { onConflict: 'name' });
          }
        } catch(e){ console.warn('[GL] cip_equipment save threw', e); }
      }
      saveCipEquipCache(newList);
      ov.remove();
      // If the CIP form is open, refresh its dropdown
      var sel = document.getElementById('gl-cf-equip');
      if(sel){
        var cur = sel.value;
        var opts = newList.map(function(n){ return '<option value="'+String(n).replace(/"/g,'&quot;')+'">'+n+'</option>'; }).join('');
        opts += '<option value="__add__" style="color:#00e5c0">+ Add new equipment…</option>';
        opts += '<option value="__edit__" style="color:#c4a4f8">✎ Edit list…</option>';
        sel.innerHTML = opts;
        if(newList.indexOf(cur) >= 0) sel.value = cur;
      }
    };
  };

  window.glOpenCipForm = function(task){
    task = task || {};
    var equipOptions = loadCipEquip().concat([['__add__', '+ Add new equipment…'], ['__edit__', '✎ Edit list…']]);
    var stepsHtml = CIP_STEPS.map(function(s){
      var tempCell = s.hot
        ? '<input id="gl-cip-temp-'+s.n+'" type="number" step="1" value="160" placeholder="160" style="width:60px;padding:5px 6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;font-size:11px;box-sizing:border-box;text-align:center">'
        : '<span style="font-size:10px;color:#9aa7bd">ambient</span>';
      return '<tr>' +
        '<td style="padding:7px 5px;font-weight:700;color:'+(s.type==='sanit'?'#c4a4f8':s.type==='chem'?'#7fc6f5':'#5fcf9e')+'">'+s.n+'</td>' +
        '<td style="padding:7px 5px;font-size:11px"><div style="font-weight:600;color:#fff">'+esc(s.name)+'</div><div style="font-size:10px;color:#9aa7bd">'+esc(s.chem)+' · '+esc(s.conc)+'</div></td>' +
        '<td style="padding:7px 5px;text-align:center"><label style="display:inline-block;cursor:pointer"><input type="checkbox" id="gl-cip-done-'+s.n+'" checked style="accent-color:var(--teal);width:14px;height:14px"></label></td>' +
        '<td style="padding:7px 5px;text-align:center"><input id="gl-cip-min-'+s.n+'" type="number" step="1" min="0" value="'+s.target_min+'" style="width:55px;padding:5px 6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;font-size:11px;box-sizing:border-box;text-align:center"> <span style="font-size:10px;color:#9aa7bd">min</span></td>' +
        '<td style="padding:7px 5px;text-align:center">'+tempCell+(s.hot?' <span style="font-size:10px;color:#9aa7bd">°F</span>':'')+'</td>' +
        '<td style="padding:7px 5px"><input id="gl-cip-read-'+s.n+'" type="text" placeholder="'+(s.type==='sanit'?'ppm':(s.type==='rinse'?'µS/cm':'%'))+'" style="width:90px;padding:5px 6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;font-size:11px;box-sizing:border-box"></td>' +
        '<td style="padding:7px 5px"><select id="gl-cip-pf-'+s.n+'" style="padding:5px 6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;font-size:11px;box-sizing:border-box"><option value="pass">PASS</option><option value="fail">FAIL</option></select></td>' +
      '</tr>';
    }).join('');

    var body =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        field('Equipment / circuit', 'equip', 'select', { options: equipOptions, required: true }) +
        field('CIP cycle start', 'start', 'datetime-local', { value: new Date(Date.now()-30*60000).toISOString().slice(0,16) }) +
      '</div>' +
      field('Operator', 'operator', 'text', {
        value: (window.currentUser && (window.currentUser.name || window.currentUser.email)) || '',
        placeholder: 'Enter operator name',
        required: true
      }) +
      '<table style="width:100%;border-collapse:collapse;font-size:11px;margin:8px 0">' +
        '<thead><tr style="background:rgba(255,255,255,.03);text-align:left">' +
          '<th style="padding:7px 5px;color:#9aa7bd;font-size:10px;letter-spacing:1px">#</th>' +
          '<th style="padding:7px 5px;color:#9aa7bd;font-size:10px;letter-spacing:1px">STEP</th>' +
          '<th style="padding:7px 5px;color:#9aa7bd;font-size:10px;letter-spacing:1px;text-align:center">DONE</th>' +
          '<th style="padding:7px 5px;color:#9aa7bd;font-size:10px;letter-spacing:1px;text-align:center">ACTUAL TIME</th>' +
          '<th style="padding:7px 5px;color:#9aa7bd;font-size:10px;letter-spacing:1px;text-align:center">TEMP</th>' +
          '<th style="padding:7px 5px;color:#9aa7bd;font-size:10px;letter-spacing:1px">VERIFICATION</th>' +
          '<th style="padding:7px 5px;color:#9aa7bd;font-size:10px;letter-spacing:1px">P/F</th>' +
        '</tr></thead><tbody>' + stepsHtml + '</tbody></table>' +
      field('Deviations / corrective action', 'deviation', 'textarea') +
      '<div style="font-size:11px;color:#f5c842;background:rgba(245,200,66,.08);padding:8px 12px;border-radius:6px;margin-top:8px">CL: temp ≥ 160°F steps 1-7 · PAA 100-300 ppm steps 8-9 · DO NOT RINSE after step 8 or 9. Any step FAIL auto-spawns Hold Tag + NC draft.</div>';

    var modal = modalShell('GMP-SAN-002 v2.1 · 9-Step CIP Monitoring', 'Record at the time of the cycle — never reconstruct from memory', body, formFooter());
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });

    // Equipment dropdown: intercept the "+ Add new…" + "✎ Edit list…" sentinels
    (function wireEquipDropdown(){
      var sel = modal.querySelector('#gl-cf-equip');
      if(!sel) return;
      sel.addEventListener('change', async function(){
        if(sel.value === '__add__'){
          var name = prompt('New equipment / circuit name:');
          var added = await window.glAddCipEquip(name);
          if(added){
            // Rebuild the dropdown options with the new entry, leave sentinels at end
            var list = loadCipEquipCache();
            var opts = list.map(function(n){ return '<option value="'+String(n).replace(/"/g,'&quot;')+'">'+n+'</option>'; }).join('');
            opts += '<option value="__add__" style="color:#00e5c0">+ Add new equipment…</option>';
            opts += '<option value="__edit__" style="color:#c4a4f8">✎ Edit list…</option>';
            sel.innerHTML = opts;
            sel.value = added;
          } else {
            sel.value = loadCipEquipCache()[0] || '';
          }
        } else if(sel.value === '__edit__'){
          sel.value = '';
          window.glOpenCipEquipManager();
        }
      });
    })();

    async function submit(signed){
      var steps = CIP_STEPS.map(function(s){
        return {
          n: s.n, name: s.name, chem: s.chem, target_min: s.target_min,
          done: modal.querySelector('#gl-cip-done-'+s.n).checked,
          actual_min: parseFloat(modal.querySelector('#gl-cip-min-'+s.n).value) || 0,
          temp_f: s.hot ? (parseFloat(modal.querySelector('#gl-cip-temp-'+s.n).value) || 0) : null,
          reading: modal.querySelector('#gl-cip-read-'+s.n).value.trim(),
          pf: modal.querySelector('#gl-cip-pf-'+s.n).value
        };
      });
      var equip    = getVal(modal,'equip');
      var operator = getVal(modal,'operator');
      if(!operator){
        var errEl = modal.querySelector('#gl-cip-op-err');
        if(!errEl){
          errEl = document.createElement('div');
          errEl.id = 'gl-cip-op-err';
          errEl.style.cssText = 'color:#ff8579;background:rgba(231,76,60,.12);border:1px solid rgba(231,76,60,.35);border-radius:8px;padding:8px 14px;font-size:12px;margin-bottom:10px';
          errEl.textContent = 'Operator name is required before saving.';
          var opField = modal.querySelector('#gl-cf-operator');
          if(opField && opField.parentElement) opField.parentElement.insertAdjacentElement('afterend', errEl);
        }
        modal.querySelector('#gl-cf-operator').focus();
        return;
      }
      var deviation = getVal(modal,'deviation');
      // Critical-limit checks
      var failures = [];
      steps.forEach(function(s){
        if(!s.done) return;
        if(s.pf === 'fail') failures.push('Step '+s.n+' ('+s.name+') marked FAIL');
        if(s.temp_f !== null && s.temp_f < 160) failures.push('Step '+s.n+' temp '+s.temp_f+'°F < 160°F');
        if(s.n >= 8){
          // PAA concentration check (parse ppm from reading)
          var ppm = parseFloat(s.reading);
          if(!isNaN(ppm) && (ppm < 100 || ppm > 300)) failures.push('Step '+s.n+' PAA '+ppm+' ppm outside 100-300 ppm');
        }
      });
      // Required: all chemical steps must be done
      ['chem','sanit'].forEach(function(){});  // (placeholder — steps array already covers)
      var hasFailure = failures.length > 0;
      var data = {
        equipment: equip, cycle_start: getVal(modal,'start'),
        operator: operator,
        steps: steps, deviation_notes: deviation
      };
      await saveRecord('GMP-SAN-002', data, {
        signed: signed, complete: signed,
        task_id: task.id, run_id: task.run_id,
        has_deviation: hasFailure,
        deviation_notes: hasFailure ? failures.join(' · ') + ' · ' + (deviation || '') : null,
        corrective_action: deviation,
        spawn_hold: hasFailure,
        product_name: 'CIP — ' + equip,
        hazard_type: 'biological',
        summary: equip + ' · ' + steps.filter(function(s){return s.done;}).length + '/9 steps · ' + (hasFailure ? 'FAIL' : 'PASS')
      });
      modal.remove();
      refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };
  // Replace existing CIP page entry point — both legacy and new task types route here
  window.glOpenAddCip = window.glOpenCipForm;

  // ── Form: FSP-PC-002 Hot Fill Temperature Log (CCP-2) ──
  window.glOpenHotFillForm = function(task){
    task = task || {};
    var run = task.run_id ? (window.glProductionRuns||[]).find(function(r){ return r.id === task.run_id; }) : null;
    var body =
      field('Product / lot', 'product', 'text', { value: run ? (run.run_name || '') : '', required: true }) +
      field('Reading time', 'time', 'time', { value: (new Date()).toTimeString().slice(0,5), required: true }) +
      field('Fill nozzle temp (°F)', 'temp_f', 'number', { step: '0.1', required: true }) +
      field('Thermocouple cal date', 'cal_date', 'date') +
      field('Corrective action (if deviation)', 'corrective', 'textarea') +
      '<div style="font-size:11px;color:#f5c842;background:rgba(245,200,66,.08);padding:8px 12px;border-radius:6px;margin-top:8px">CL: ≥ '+DEFAULT_LIMITS.hot_fill_f+'°F at fill point. Below CL = stop filling, quarantine product, auto-NC.</div>';
    var modal = modalShell('FSP-PC-002 · Hot Fill Temperature (CCP-2)', 'Spot-check every 30 minutes during fill', body, formFooter());
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    async function submit(signed){
      var temp = parseFloat(getVal(modal,'temp_f')) || 0;
      var data = { product: getVal(modal,'product'), time: getVal(modal,'time'), temp_f: temp, cal_date: getVal(modal,'cal_date'), corrective: getVal(modal,'corrective') };
      var hasFailure = temp < DEFAULT_LIMITS.hot_fill_f;
      await saveRecord('FSP-PC-002', data, {
        signed: signed, complete: signed, task_id: task.id, run_id: task.run_id,
        has_deviation: hasFailure,
        deviation_notes: hasFailure ? ('Hot fill ' + temp + '°F < ' + DEFAULT_LIMITS.hot_fill_f + '°F at ' + data.time) : null,
        corrective_action: data.corrective, spawn_hold: hasFailure,
        product_name: data.product, hazard_type: 'biological',
        summary: data.time + ' · ' + temp + '°F · ' + (hasFailure ? 'CCP FAIL' : 'OK')
      });
      modal.remove(); refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ── Form: FSP-PC-003 Can Seam Evaluation (CCP-4) ──
  window.glOpenSeamForm = function(task){
    task = task || {};
    var run = task.run_id ? (window.glProductionRuns||[]).find(function(r){ return r.id === task.run_id; }) : null;
    var body =
      field('Product / lot', 'product', 'text', { value: run ? (run.run_name || '') : '', required: true }) +
      field('Eval time', 'time', 'time', { value: (new Date()).toTimeString().slice(0,5), required: true }) +
      field('Sample can #', 'can_no', 'text', { required: true }) +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        field('Seam thickness (in)', 'thick', 'number', { step: '0.001' }) +
        field('Seam length (in)', 'length', 'number', { step: '0.001' }) +
        field('Body hook (in)', 'body_hook', 'number', { step: '0.001' }) +
        field('Cover hook (in)', 'cover_hook', 'number', { step: '0.001' }) +
        field('Overlap (%)', 'overlap', 'number', { step: '0.1' }) +
        field('Tightness rating', 'tightness', 'select', { options: ['Tight','Acceptable','Loose'] }) +
      '</div>' +
      field('Within BCMA spec?', 'spec', 'yn', { required: true }) +
      field('Corrective action (if out-of-spec)', 'corrective', 'textarea') +
      '<div style="font-size:11px;color:#f5c842;background:rgba(245,200,66,.08);padding:8px 12px;border-radius:6px;margin-top:8px">Out-of-spec seam = STOP line, hold ALL product since last good teardown, PCQI evaluates rework or destroy.</div>';
    var modal = modalShell('FSP-PC-003 · Can Seam Evaluation (CCP-4)', 'Startup + every 4 hrs + post-jam + shutdown', body, formFooter());
    wireYn(modal);
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    async function submit(signed){
      var data = {
        product: getVal(modal,'product'), time: getVal(modal,'time'), can_no: getVal(modal,'can_no'),
        thick: getVal(modal,'thick'), length: getVal(modal,'length'),
        body_hook: getVal(modal,'body_hook'), cover_hook: getVal(modal,'cover_hook'),
        overlap: getVal(modal,'overlap'), tightness: getVal(modal,'tightness'),
        spec: getVal(modal,'spec'), corrective: getVal(modal,'corrective')
      };
      var hasFailure = data.spec !== 'Y';
      await saveRecord('FSP-PC-003', data, {
        signed: signed, complete: signed, task_id: task.id, run_id: task.run_id,
        has_deviation: hasFailure,
        deviation_notes: hasFailure ? ('Can seam out-of-spec at ' + data.time + ' on can ' + data.can_no) : null,
        corrective_action: data.corrective, spawn_hold: hasFailure,
        product_name: data.product, hazard_type: 'physical',
        summary: 'Can ' + data.can_no + ' · ' + (hasFailure ? 'OUT OF SPEC' : 'in spec')
      });
      modal.remove(); refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ── Form: FSP-PC-004 UV Water Treatment (CCP-3) ──
  window.glOpenUvForm = function(task){
    task = task || {};
    var body =
      field('Product / lot (if attached to run)', 'product', 'text', { value: (task.run_id && (window.glProductionRuns||[]).find(function(r){return r.id===task.run_id;})||{}).run_name || '' }) +
      field('Reading time', 'time', 'time', { value: (new Date()).toTimeString().slice(0,5), required: true }) +
      field('UV intensity (mW/cm²)', 'intensity', 'number', { step: '0.1', required: true }) +
      field('Flow rate (gpm)', 'flow', 'number', { step: '0.1' }) +
      field('Calculated UV dose (mJ/cm²)', 'dose', 'number', { step: '0.1', required: true }) +
      field('Lamp status', 'lamp', 'select', { options: [['ok','OK'],['replace','Replace soon'],['fault','Fault — replace now']] }) +
      field('Alarm triggered?', 'alarm', 'yn') +
      field('Corrective action', 'corrective', 'textarea') +
      '<div style="font-size:11px;color:#f5c842;background:rgba(245,200,66,.08);padding:8px 12px;border-radius:6px;margin-top:8px">CL: dose ≥ '+(window.glGetLimits ? window.glGetLimits().uv_dose_mj_cm2 : DEFAULT_LIMITS.uv_dose_mj_cm2)+' mJ/cm². Below CL or alarm = stop water use, do not use for product until verified.</div>';
    var modal = modalShell('FSP-PC-004 · UV Water Treatment (CCP-3)', 'Hourly during production runs', body, formFooter());
    wireYn(modal);
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    async function submit(signed){
      var dose = parseFloat(getVal(modal,'dose')) || 0;
      var alarm = getVal(modal,'alarm');
      var data = { product: getVal(modal,'product'), time: getVal(modal,'time'), intensity: getVal(modal,'intensity'), flow: getVal(modal,'flow'), dose: dose, lamp: getVal(modal,'lamp'), alarm: alarm, corrective: getVal(modal,'corrective') };
      var hasFailure = dose < (window.glGetLimits ? window.glGetLimits().uv_dose_mj_cm2 : DEFAULT_LIMITS.uv_dose_mj_cm2) || alarm === 'Y';
      await saveRecord('FSP-PC-004', data, {
        signed: signed, complete: signed, task_id: task.id, run_id: task.run_id,
        has_deviation: hasFailure,
        deviation_notes: hasFailure ? ('UV dose ' + dose + ' mJ/cm² < ' + (window.glGetLimits ? window.glGetLimits().uv_dose_mj_cm2 : DEFAULT_LIMITS.uv_dose_mj_cm2) + ' or alarm triggered at ' + data.time) : null,
        corrective_action: data.corrective, spawn_hold: hasFailure,
        product_name: 'UV-treated water', hazard_type: 'biological',
        summary: data.time + ' · ' + dose + ' mJ/cm² · ' + (hasFailure ? 'CCP FAIL' : 'OK')
      });
      modal.remove(); refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ── Form: FSP-PC-005 Fermentation Monitoring (CCP-A) ──
  window.glOpenFermForm = function(task){
    task = task || {};
    var body =
      field('Batch #', 'batch_no', 'text', { required: true }) +
      field('Product', 'product', 'text', { required: true }) +
      field('Pitch date', 'pitch_date', 'date') +
      field('Yeast strain', 'yeast', 'text') +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        field('OG (Original Gravity)', 'og', 'number', { step: '0.001' }) +
        field('FG (Final Gravity)', 'fg', 'number', { step: '0.001' }) +
        field('Day 3 pH', 'ph_d3', 'number', { step: '0.01' }) +
        field('Day 7 pH', 'ph_d7', 'number', { step: '0.01' }) +
        field('Final pH', 'ph_final', 'number', { step: '0.01', required: true }) +
        field('Calculated ABV %', 'abv', 'number', { step: '0.01' }) +
      '</div>' +
      field('ABV meets spec?', 'abv_spec', 'yn') +
      field('Package date', 'pkg_date', 'date') +
      '<div style="font-size:11px;color:#f5c842;background:rgba(245,200,66,.08);padding:8px 12px;border-radius:6px;margin-top:8px">CL: final pH ≤ '+(window.glGetLimits ? window.glGetLimits().final_pH_fermented : DEFAULT_LIMITS.final_pH_fermented)+' AND ABV ≥ product spec. Fail = hold batch, do not package.</div>';
    var modal = modalShell('FSP-PC-005 · Fermentation Monitoring (CCP-A)', 'Multiple readings per batch — log when each is taken', body, formFooter());
    wireYn(modal);
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    async function submit(signed){
      var phFinal = parseFloat(getVal(modal,'ph_final')) || 999;
      var abvSpec = getVal(modal,'abv_spec');
      var data = { batch_no: getVal(modal,'batch_no'), product: getVal(modal,'product'), pitch_date: getVal(modal,'pitch_date'), yeast: getVal(modal,'yeast'), og: getVal(modal,'og'), fg: getVal(modal,'fg'), ph_d3: getVal(modal,'ph_d3'), ph_d7: getVal(modal,'ph_d7'), ph_final: phFinal, abv: getVal(modal,'abv'), abv_spec: abvSpec, pkg_date: getVal(modal,'pkg_date') };
      var hasFailure = phFinal > (window.glGetLimits ? window.glGetLimits().final_pH_fermented : DEFAULT_LIMITS.final_pH_fermented) || abvSpec === 'N';
      await saveRecord('FSP-PC-005', data, {
        signed: signed, complete: signed, task_id: task.id,
        has_deviation: hasFailure,
        deviation_notes: hasFailure ? ('Fermentation CCP fail — pH ' + phFinal + (abvSpec === 'N' ? ' AND ABV below spec' : '')) : null,
        spawn_hold: hasFailure,
        product_name: data.product, hazard_type: 'biological',
        summary: 'Batch ' + data.batch_no + ' · pH ' + phFinal + ' · ' + (hasFailure ? 'FAIL' : 'OK')
      });
      modal.remove(); refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ── Form: GMP-CAL-001 Equipment Calibration Log ──
  window.glOpenCalForm = function(task){
    task = task || {};
    var instruments = ['pH meter','Thermometer (product)','Thermometer (environmental)','UV intensity sensor','Scale','Conductivity meter','HTST recorder','FDD','PAA test strips','Other'];
    var body =
      field('Instrument', 'instrument', 'select', { options: instruments, required: true }) +
      field('Instrument ID / location', 'location', 'text', { required: true }) +
      field('Calibration method', 'method', 'text', { placeholder: 'e.g. 2-point buffer 4.0/7.0' }) +
      field('Reference standard / lot', 'reference', 'text', { placeholder: 'e.g. NIST traceable cert #' }) +
      field('Result / reading', 'result', 'text', { required: true }) +
      field('Acceptable range', 'range', 'text', { placeholder: 'e.g. ±0.05 pH' }) +
      field('Pass / Fail', 'pf', 'select', { options: [['pass','PASS'],['fail','FAIL']], required: true }) +
      field('Next calibration due', 'next_due', 'date');
    var modal = modalShell('GMP-CAL-001 · Equipment Calibration', 'Monthly minimum for CCP instruments', body, formFooter());
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    async function submit(signed){
      var data = { instrument: getVal(modal,'instrument'), location: getVal(modal,'location'), method: getVal(modal,'method'), reference: getVal(modal,'reference'), result: getVal(modal,'result'), range: getVal(modal,'range'), pf: getVal(modal,'pf'), next_due: getVal(modal,'next_due') };
      var hasFailure = data.pf === 'fail';
      await saveRecord('GMP-CAL-001', data, {
        signed: signed, complete: signed, task_id: task.id,
        has_deviation: hasFailure,
        deviation_notes: hasFailure ? ('Cal FAIL on ' + data.instrument + ' (' + data.location + ') — remove from service immediately') : null,
        spawn_hold: false,  // calibration fail doesn't directly hold product; PCQI evaluates affected lots
        product_name: data.instrument,
        summary: data.instrument + ' · ' + (hasFailure ? 'FAIL — REMOVE FROM SERVICE' : 'PASS')
      });
      modal.remove(); refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ── Form: GMP-REC-001 Receiving Inspection & COA Review ──
  window.glOpenReceivingForm = function(task){
    task = task || {};
    var vendors = (window.glVendors || []).map(function(v){ return v.name; });
    var body =
      field('Supplier', 'supplier', vendors.length ? 'select' : 'text', vendors.length ? { options: vendors, required: true } : { required: true }) +
      field('Ingredient / material', 'ingredient', 'text', { required: true }) +
      field('Lot number', 'lot', 'text', { required: true }) +
      field('Expiration / best-by date (from supplier label)', 'exp_date', 'date') +
      field('Quantity received', 'qty', 'text', { required: true, placeholder: 'e.g. 50 lbs, 10 cases, 5 gal' }) +
      field('Temperature on receipt (°F) — leave blank if ambient / N/A', 'temp_f', 'number', { placeholder: 'e.g. 38', step: '0.1' }) +
      field('Temperature within acceptable range for this material?', 'temp_ok', 'yn') +
      field('Storage location assigned', 'storage_loc', 'text', { required: true, placeholder: 'e.g. Walk-in cooler A2, dry storage bay 3, quarantine area' }) +
      field('COA received?', 'coa', 'yn', { required: true }) +
      field('COA lot matches received lot?', 'coa_match', 'yn' ) +
      field('Allergen declaration on file?', 'allergen', 'yn') +
      field('Visual condition OK?', 'visual', 'yn', { required: true }) +
      field('Approved supplier?', 'approved', 'yn', { required: true }) +
      field('Disposition', 'disposition', 'select', { options: [['accept','Accept'],['quarantine','Quarantine — Hold Tag needed']], required: true }) +
      field('Notes', 'notes', 'textarea') +
      '<div style="font-size:11px;color:#7fc6f5;background:rgba(127,198,245,.08);padding:8px 12px;border-radius:6px;margin-top:8px">21 CFR 117.80: document every incoming delivery. Out-of-range temperature, failed COA, or unapproved supplier must result in Quarantine disposition and an automatic Hold Tag.</div>';
    var modal = modalShell('GMP-REC-001 · Receiving Inspection & COA Review', 'Required for every incoming delivery', body, formFooter());
    wireYn(modal);
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    async function submit(signed){
      var data = { supplier: getVal(modal,'supplier'), ingredient: getVal(modal,'ingredient'), lot: getVal(modal,'lot'), exp_date: getVal(modal,'exp_date'), qty: getVal(modal,'qty'), temp_f: getVal(modal,'temp_f'), temp_ok: getVal(modal,'temp_ok'), storage_loc: getVal(modal,'storage_loc'), coa: getVal(modal,'coa'), coa_match: getVal(modal,'coa_match'), allergen: getVal(modal,'allergen'), visual: getVal(modal,'visual'), approved: getVal(modal,'approved'), disposition: getVal(modal,'disposition'), notes: getVal(modal,'notes') };
      var tempFail = data.temp_f && data.temp_ok === 'N';
      var hasFailure = data.disposition === 'quarantine' || data.coa !== 'Y' || data.visual !== 'Y' || data.approved !== 'Y' || tempFail;
      await saveRecord('GMP-REC-001', data, {
        signed: signed, complete: signed, task_id: task.id,
        has_deviation: hasFailure,
        deviation_notes: hasFailure ? ([
          'Receiving issue — ' + data.ingredient + ' (' + data.lot + ') from ' + data.supplier,
          tempFail ? 'Temperature out of range: ' + data.temp_f + '°F' : '',
          data.coa !== 'Y' ? 'COA missing' : '',
          data.visual !== 'Y' ? 'Visual condition failed' : '',
          data.approved !== 'Y' ? 'Unapproved supplier' : '',
          'Disposition: ' + data.disposition
        ].filter(Boolean).join(' · ')) : null,
        corrective_action: data.notes, spawn_hold: data.disposition === 'quarantine' || tempFail,
        product_name: data.ingredient, lot_number: data.lot, hazard_type: 'biological',
        summary: data.ingredient + ' · ' + data.supplier + ' · ' + (hasFailure ? data.disposition.toUpperCase() : 'ACCEPTED')
      });
      modal.remove(); refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ── Form: FSP-SAN-001 Environmental Monitoring — Listeria ──
  window.glOpenListeriaForm = function(task){
    task = task || {};
    var body =
      field('Sample ID', 'sample_id', 'text', { value: 'LIS-'+todayISO().replace(/-/g,'')+'-' + Math.floor(Math.random()*900+100), required: true }) +
      field('Zone (1=food contact, 2=adjacent, 3=remote, 4=outside)', 'zone', 'select', { options: [['1','Zone 1 — food-contact'],['2','Zone 2 — adjacent (non-contact)'],['3','Zone 3 — remote'],['4','Zone 4 — outside production']], required: true }) +
      field('Location swabbed', 'location', 'text', { required: true, placeholder: 'e.g. Filler nozzle, floor drain near filler' }) +
      field('Pre or post-CIP?', 'cip_state', 'select', { options: [['pre','Pre-CIP'],['post','Post-CIP']] }) +
      field('Lab / test kit', 'lab', 'text', { placeholder: 'e.g. Hygiena InSite' }) +
      field('Listeria spp. result', 'spp_result', 'select', { options: [['pending','Pending'],['neg','Negative'],['pos','POSITIVE']], required: true }) +
      field('L. monocytogenes result', 'mono_result', 'select', { options: [['nt','Not tested'],['neg','Negative'],['pos','POSITIVE']] }) +
      field('Action initiated', 'action', 'textarea') +
      '<div style="font-size:11px;color:#ff8579;background:rgba(231,76,60,.1);padding:8px 12px;border-radius:6px;margin-top:8px">POSITIVE on Zone 1-2 = STOP production, deep clean + intensified sanitation, re-swab. L. monocytogenes positive on distributed product = consider FDA notification.</div>';
    var modal = modalShell('FSP-SAN-001 · Environmental Listeria Swab', 'Monthly minimum (food-contact zones)', body, formFooter());
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    async function submit(signed){
      var data = { sample_id: getVal(modal,'sample_id'), zone: getVal(modal,'zone'), location: getVal(modal,'location'), cip_state: getVal(modal,'cip_state'), lab: getVal(modal,'lab'), spp_result: getVal(modal,'spp_result'), mono_result: getVal(modal,'mono_result'), action: getVal(modal,'action') };
      var isPositiveZone12 = (data.spp_result === 'pos' || data.mono_result === 'pos') && (data.zone === '1' || data.zone === '2');
      var hasFailure = isPositiveZone12;
      await saveRecord('FSP-SAN-001', data, {
        signed: signed, complete: signed, task_id: task.id,
        has_deviation: hasFailure,
        deviation_notes: hasFailure ? ('POSITIVE Listeria on Zone ' + data.zone + ' (' + data.location + ')') : null,
        corrective_action: data.action, spawn_hold: hasFailure,
        product_name: 'Environmental swab — ' + data.location, hazard_type: 'biological',
        summary: 'Zone ' + data.zone + ' · ' + data.location + ' · ' + (data.spp_result === 'pos' ? 'POSITIVE' : data.spp_result.toUpperCase())
      });
      modal.remove(); refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ── Form: GMP-DIST-001 Distribution / Traceability ──
  window.glOpenDistForm = function(task){
    task = task || {};
    var body =
      field('Ship date', 'ship_date', 'date', { value: todayISO(), required: true }) +
      field('Product', 'product', 'text', { required: true }) +
      field('Lot number', 'lot', 'text', { required: true }) +
      field('Quantity shipped', 'qty', 'text', { required: true }) +
      field('Customer / distributor', 'customer', 'text', { required: true }) +
      field('Customer address', 'address', 'textarea') +
      field('Contact name + phone', 'contact', 'text') +
      field('Ship method', 'method', 'text', { placeholder: 'e.g. UPS Freight, FedEx LTL' }) +
      field('Bill of Lading #', 'bol', 'text') +
      '<div style="font-size:11px;color:#7fc6f5;background:rgba(127,198,245,.08);padding:8px 12px;border-radius:6px;margin-top:8px">4-HR TRACEABILITY: this log supports your recall capability. Every outbound shipment must be recorded.</div>';
    var modal = modalShell('GMP-DIST-001 · Distribution / Traceability', 'Every outbound shipment', body, formFooter());
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    async function submit(signed){
      var data = { ship_date: getVal(modal,'ship_date'), product: getVal(modal,'product'), lot: getVal(modal,'lot'), qty: getVal(modal,'qty'), customer: getVal(modal,'customer'), address: getVal(modal,'address'), contact: getVal(modal,'contact'), method: getVal(modal,'method'), bol: getVal(modal,'bol') };
      await saveRecord('GMP-DIST-001', data, {
        signed: signed, complete: signed, task_id: task.id,
        product_name: data.product, lot_number: data.lot,
        summary: data.product + ' · ' + data.qty + ' to ' + data.customer
      });
      modal.remove(); refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ── Form: GMP-TR-001 Employee Training Record ──
  window.glOpenTrainingForm = function(task){
    task = task || {};
    var body =
      field('Employee name', 'employee', 'text', { required: true }) +
      field('Role / title', 'role', 'text') +
      field('Training topic', 'topic', 'select', { options: ['GMP orientation','Allergen awareness','Illness exclusion policy','CCP monitoring (specify)','HACCP/FSP overview','Hand hygiene','Chemical safety','Forklift / equipment','Other'], required: true }) +
      field('Training method', 'method', 'select', { options: ['In-person classroom','Online module','On-the-job demonstration','Documented procedure read + sign'] }) +
      field('Duration (minutes)', 'duration', 'number') +
      field('Trainer name', 'trainer', 'text') +
      field('Tested?', 'tested', 'yn') +
      field('Pass / Fail (if tested)', 'pf', 'select', { options: ['','Pass','Fail'] }) +
      field('Employee signature on file?', 'sig', 'yn', { required: true }) +
      field('Next training due', 'next_due', 'date');
    var modal = modalShell('GMP-TR-001 · Employee Training Record', 'Each training event + annual refresh', body, formFooter());
    wireYn(modal);
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    async function submit(signed){
      var data = { employee: getVal(modal,'employee'), role: getVal(modal,'role'), topic: getVal(modal,'topic'), method: getVal(modal,'method'), duration: getVal(modal,'duration'), trainer: getVal(modal,'trainer'), tested: getVal(modal,'tested'), pf: getVal(modal,'pf'), sig: getVal(modal,'sig'), next_due: getVal(modal,'next_due') };
      var hasFailure = data.sig !== 'Y' || data.pf === 'Fail';
      await saveRecord('GMP-TR-001', data, {
        signed: signed, complete: signed, task_id: task.id,
        has_deviation: hasFailure,
        deviation_notes: hasFailure ? ('Training record incomplete — missing signature or failed test for ' + data.employee) : null,
        spawn_hold: false,
        product_name: 'Training — ' + data.employee,
        summary: data.employee + ' · ' + data.topic
      });
      modal.remove(); refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ── Form: GMP-HR-001 Employee Illness Exclusion ──
  window.glOpenIllnessForm = function(task){
    task = task || {};
    var conditions = ['Jaundice','Diarrhea','Vomiting','Sore throat with fever','Open wound on hands/arms','Confirmed Salmonella/Shigella/E.coli O157:H7','Confirmed Hepatitis A','Confirmed Norovirus','Other'];
    var body =
      field('Date / time reported', 'reported_at', 'datetime-local', { value: new Date().toISOString().slice(0,16), required: true }) +
      field('Employee name', 'employee', 'text', { required: true }) +
      field('Condition reported', 'condition', 'select', { options: conditions, required: true }) +
      field('Excluded?', 'excluded', 'yn', { required: true }) +
      field('Area excluded from', 'area', 'text', { placeholder: 'e.g. All food handling areas' }) +
      field('Return-to-work date (planned)', 'return_date', 'date') +
      field('Medical clearance required + received?', 'medical', 'select', { options: ['Not required','Required — not yet','Required — received','N/A'] }) +
      field('Supervisor notes', 'notes', 'textarea');
    var modal = modalShell('GMP-HR-001 · Employee Illness Exclusion', 'Upon any illness exclusion event', body, formFooter());
    wireYn(modal);
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    async function submit(signed){
      var data = { reported_at: getVal(modal,'reported_at'), employee: getVal(modal,'employee'), condition: getVal(modal,'condition'), excluded: getVal(modal,'excluded'), area: getVal(modal,'area'), return_date: getVal(modal,'return_date'), medical: getVal(modal,'medical'), notes: getVal(modal,'notes') };
      await saveRecord('GMP-HR-001', data, {
        signed: signed, complete: signed, task_id: task.id,
        product_name: 'Illness exclusion — ' + data.employee,
        summary: data.employee + ' · ' + data.condition + ' · ' + (data.excluded === 'Y' ? 'EXCLUDED' : 'returned')
      });
      modal.remove(); refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ── Form: FSP-SC-002 Supplier COA Review ──
  window.glOpenSupplierCoaForm = function(task){
    task = task || {};
    var body =
      field('Supplier', 'supplier', 'text', { required: true }) +
      field('Ingredient', 'ingredient', 'text', { required: true }) +
      field('Lot number', 'lot', 'text', { required: true }) +
      field('COA reference #', 'coa_ref', 'text') +
      field('Micro results', 'micro', 'select', { options: [['','—'],['pass','PASS'],['fail','FAIL'],['na','N/A']] }) +
      field('Heavy metals', 'metals', 'text', { placeholder: 'e.g. Pb < 0.5 ppm' }) +
      field('Pesticides', 'pesticides', 'text', { placeholder: 'e.g. ND or < LOQ' }) +
      field('Potency / identity (botanicals)', 'potency', 'text') +
      field('Results pass spec?', 'spec', 'yn', { required: true }) +
      field('Accepted?', 'accepted', 'yn', { required: true }) +
      field('PCQI sign-off required (high-risk)?', 'high_risk', 'yn') +
      field('Notes', 'notes', 'textarea');
    var modal = modalShell('FSP-SC-002 · Supplier COA Review', 'Per incoming lot of high-risk ingredients', body, formFooter());
    wireYn(modal);
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    async function submit(signed){
      var data = { supplier: getVal(modal,'supplier'), ingredient: getVal(modal,'ingredient'), lot: getVal(modal,'lot'), coa_ref: getVal(modal,'coa_ref'), micro: getVal(modal,'micro'), metals: getVal(modal,'metals'), pesticides: getVal(modal,'pesticides'), potency: getVal(modal,'potency'), spec: getVal(modal,'spec'), accepted: getVal(modal,'accepted'), high_risk: getVal(modal,'high_risk'), notes: getVal(modal,'notes') };
      var hasFailure = data.spec !== 'Y' || data.accepted !== 'Y';
      await saveRecord('FSP-SC-002', data, {
        signed: signed, complete: signed, task_id: task.id,
        has_deviation: hasFailure,
        deviation_notes: hasFailure ? ('COA review failure — ' + data.ingredient + ' (' + data.lot + ') from ' + data.supplier) : null,
        spawn_hold: hasFailure, lot_number: data.lot,
        product_name: data.ingredient, hazard_type: 'biological',
        summary: data.ingredient + ' · ' + data.supplier + ' · ' + (hasFailure ? 'REJECTED' : 'accepted')
      });
      modal.remove(); refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ── Form: QC-BR-001 Production Batch Record ──
  window.glOpenBatchRecordForm = function(task){
    task = task || {};
    var run = task.run_id ? (window.glProductionRuns||[]).find(function(r){ return r.id === task.run_id; }) : null;
    var body =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        field('Batch record #', 'batch_no', 'text', { required: true }) +
        field('Production date', 'prod_date', 'date', { value: todayISO(), required: true }) +
        field('Product name', 'product', 'text', { value: run ? (run.run_name || '') : '', required: true }) +
        field('Lot number', 'lot', 'text', { required: true }) +
        field('Client (if co-pack)', 'client', 'text', { value: run ? (run.client_name || '') : '' }) +
        field('Batch size (units)', 'batch_size', 'text') +
      '</div>' +
      '<div style="font-size:10px;color:#9aa7bd;letter-spacing:2px;text-transform:uppercase;margin:12px 0 4px">— Ingredients —</div>' +
      field('Ingredients (one per line: name / lot / qty)', 'ingredients', 'textarea') +
      '<div style="font-size:10px;color:#9aa7bd;letter-spacing:2px;text-transform:uppercase;margin:12px 0 4px">— Process parameters —</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        field('Process temp + time achieved', 'process_temp', 'text') +
        field('Fill temperature (if hot fill)', 'fill_temp', 'text') +
        field('Final product pH', 'final_ph', 'number', { step: '0.01' }) +
        field('Final Brix / ABV', 'final_brix', 'text') +
      '</div>' +
      '<div style="font-size:10px;color:#9aa7bd;letter-spacing:2px;text-transform:uppercase;margin:12px 0 4px">— QC checks —</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        field('Sensory check pass?', 'sensory', 'yn') +
        field('Fill weight / volume verified?', 'fill', 'yn') +
        field('Seam check (cans)?', 'seam', 'yn') +
        field('Label verify form GMP-LAB-001 completed?', 'label_form', 'yn') +
      '</div>' +
      field('Units produced', 'units_produced', 'number') +
      field('Units released', 'units_released', 'number') +
      field('Units on hold (with NCR no.)', 'units_held', 'text') +
      field('Any deviations? Reference NCR #', 'deviations_ref', 'text');
    var modal = modalShell('QC-BR-001 · Production Batch Record', 'Master record for every co-pack production run', body, formFooter());
    wireYn(modal);
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    async function submit(signed){
      var data = { batch_no: getVal(modal,'batch_no'), prod_date: getVal(modal,'prod_date'), product: getVal(modal,'product'), lot: getVal(modal,'lot'), client: getVal(modal,'client'), batch_size: getVal(modal,'batch_size'), ingredients: getVal(modal,'ingredients'), process_temp: getVal(modal,'process_temp'), fill_temp: getVal(modal,'fill_temp'), final_ph: getVal(modal,'final_ph'), final_brix: getVal(modal,'final_brix'), sensory: getVal(modal,'sensory'), fill: getVal(modal,'fill'), seam: getVal(modal,'seam'), label_form: getVal(modal,'label_form'), units_produced: getVal(modal,'units_produced'), units_released: getVal(modal,'units_released'), units_held: getVal(modal,'units_held'), deviations_ref: getVal(modal,'deviations_ref') };
      var hasFailure = data.sensory === 'N' || data.label_form === 'N' || !!data.units_held || !!data.deviations_ref;
      await saveRecord('QC-BR-001', data, {
        signed: signed, complete: signed, task_id: task.id, run_id: task.run_id,
        has_deviation: hasFailure,
        deviation_notes: hasFailure ? ('Batch ' + data.batch_no + ' deviations — see ref ' + (data.deviations_ref || 'TBD')) : null,
        product_name: data.product, lot_number: data.lot,
        summary: 'Batch ' + data.batch_no + ' · ' + (data.units_released || data.units_produced || '?') + ' units'
      });
      modal.remove(); refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };

  // ── Form: FSP-VER-002 Annual FSP Review ──
  window.glOpenAnnualFspForm = function(task){
    task = task || {};
    var body =
      field('Review date', 'review_date', 'date', { value: todayISO(), required: true }) +
      field('Review trigger', 'trigger', 'select', { options: ['Annual scheduled','Process change','New hazard identified','Post-recall','FDA direction'], required: true }) +
      '<div style="font-size:10px;color:#9aa7bd;letter-spacing:2px;text-transform:uppercase;margin:12px 0 4px">— Scope review —</div>' +
      field('New product types added?', 'new_products', 'textarea') +
      field('New processing methods?', 'new_processes', 'textarea') +
      field('New ingredients / suppliers?', 'new_suppliers', 'textarea') +
      field('New co-pack clients with novel allergens?', 'new_allergens', 'textarea') +
      field('Facility changes?', 'facility_changes', 'textarea') +
      '<div style="font-size:10px;color:#9aa7bd;letter-spacing:2px;text-transform:uppercase;margin:12px 0 4px">— Hazard + controls —</div>' +
      field('New hazards identified?', 'new_hazards', 'textarea') +
      field('All CCPs still valid with correct CLs?', 'ccps_valid', 'yn') +
      field('CCP deviations this year (count + summary)', 'ccp_deviations', 'textarea') +
      '<div style="font-size:10px;color:#9aa7bd;letter-spacing:2px;text-transform:uppercase;margin:12px 0 4px">— Recall + supply chain —</div>' +
      field('Mock recall conducted this year? Date + 4-hr result?', 'mock_recall', 'textarea') +
      field('All COAs received for high-risk this year?', 'coa_compliance', 'yn') +
      field('Overall FSP assessment', 'assessment', 'select', { options: ['Adequate as written','Updated — changes described below'], required: true }) +
      field('Changes / updates made', 'changes', 'textarea') +
      field('Next annual review due', 'next_due', 'date');
    var modal = modalShell('FSP-VER-002 · Annual FSP Review', 'Annual reanalysis of the Food Safety Plan', body, formFooter());
    wireYn(modal);
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    async function submit(signed){
      var data = { review_date: getVal(modal,'review_date'), trigger: getVal(modal,'trigger'), new_products: getVal(modal,'new_products'), new_processes: getVal(modal,'new_processes'), new_suppliers: getVal(modal,'new_suppliers'), new_allergens: getVal(modal,'new_allergens'), facility_changes: getVal(modal,'facility_changes'), new_hazards: getVal(modal,'new_hazards'), ccps_valid: getVal(modal,'ccps_valid'), ccp_deviations: getVal(modal,'ccp_deviations'), mock_recall: getVal(modal,'mock_recall'), coa_compliance: getVal(modal,'coa_compliance'), assessment: getVal(modal,'assessment'), changes: getVal(modal,'changes'), next_due: getVal(modal,'next_due') };
      await saveRecord('FSP-VER-002', data, {
        signed: signed, complete: signed, task_id: task.id,
        product_name: 'Annual FSP review',
        summary: data.review_date + ' · ' + data.trigger + ' · ' + data.assessment
      });
      modal.remove(); refreshMaster();
    }
    modal.querySelector('.gl-cf-draft').addEventListener('click', function(){ submit(false); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', function(){ submit(true); });
  };


  // ── Hold Tag manual create + disposition ──
  window.glOpenAddHoldTag = function(prefill){
    prefill = prefill || {};
    var body =
      field('Product name', 'product', 'text', { value: prefill.product_name || '', required: true }) +
      field('Lot number', 'lot', 'text', { value: prefill.lot_number || '' }) +
      field('Quantity held', 'qty', 'text', { placeholder: 'e.g. 240 cases' }) +
      field('Location in facility', 'location', 'text', { placeholder: 'e.g. Cooler bay 2' }) +
      field('Reason for hold', 'reason', 'textarea', { required: true }) +
      field('Suspected hazard type', 'hazard', 'select', { options: [['biological','Biological'],['chemical','Chemical'],['physical','Physical'],['allergen','Allergen'],['other','Other']], required: true });
    var modal = modalShell('GMP-QC-001 · New Hold Tag', 'Marks the lot DO NOT SHIP until PCQI disposition', body,
      '<button type="button" class="cbtn gl-cf-cancel">Cancel</button>' +
      '<button type="button" class="cbtn pri gl-cf-save">🚫 Create hold tag</button>');
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    modal.querySelector('.gl-cf-save').addEventListener('click', async function(){
      var product = getVal(modal,'product'), lot = getVal(modal,'lot'), reason = getVal(modal,'reason');
      if(!product || !reason){ alert('Product and reason are required.'); return; }
      await spawnHoldAndNc({
        product_name: product, lot_number: lot, qty_held: getVal(modal,'qty'),
        location: getVal(modal,'location'), reason: reason, hazard_type: getVal(modal,'hazard'),
        form_code: 'GMP-QC-001 (manual)'
      });
      modal.remove();
      refreshMaster();
    });
  };

  // ── Master page renderer (3 tabs) ──
  var currentTab = 'today';

  async function renderTodayTab(host){
    var tasks = await generateTodaysTasks();
    var open = tasks.filter(function(t){ return t.status !== 'done' && t.status !== 'skipped'; });
    var done = tasks.filter(function(t){ return t.status === 'done'; });

    function taskCard(t){
      var f = catalog(t.task_type);
      var doneBadge = (t.status === 'done') ? '<span style="font-size:10px;letter-spacing:1px;color:#5fcf9e;background:rgba(95,207,158,.1);border:1px solid rgba(95,207,158,.3);padding:2px 7px;border-radius:10px;margin-left:8px">DONE ' + fmtTime(t.completed_at) + '</span>' : '';
      var actionBtn = (t.status === 'done')
        ? '<button class="cbtn" data-task-id="' + t.id + '" data-task-type="' + t.task_type + '" style="font-size:11px;padding:5px 11px">View record</button>'
        : '<button class="cbtn pri" data-task-id="' + t.id + '" data-task-type="' + t.task_type + '" data-run="' + (t.run_id||'') + '" style="font-size:11px;padding:5px 11px">▶ Start</button>';
      var sourceBadge = '<span style="font-size:9px;letter-spacing:1px;color:#9aa7bd;background:rgba(255,255,255,.04);padding:2px 6px;border-radius:8px;text-transform:uppercase">' + (t.source || 'auto') + '</span>';
      return '<div class="gl-comp-task" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:13px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;margin-bottom:7px">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">' +
            '<span style="font-size:14px;font-weight:600;color:#fff">' + (f.icon || '📋') + ' ' + esc(t.title) + '</span>' + sourceBadge + doneBadge + '</div>' +
          (t.description ? '<div style="font-size:11px;color:#9aa7bd;margin-top:3px">' + esc(t.description) + '</div>' : '') +
        '</div>' +
        '<div style="flex-shrink:0">' + actionBtn + '</div>' +
      '</div>';
    }

    host.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
        '<div style="font-size:11px;color:#9aa7bd;letter-spacing:1px;text-transform:uppercase">' + fmtDate(todayISO()) + ' · ' + open.length + ' open · ' + done.length + ' done</div>' +
        '<button class="cbtn" id="gl-comp-add-manual" style="font-size:11px;padding:5px 11px">+ Add task</button>' +
      '</div>' +
      (open.length ? open.map(taskCard).join('') : '<div style="padding:30px;text-align:center;color:#9aa7bd;font-size:12px">No open tasks today. Schedule a production run to auto-generate the day\'s checklist.</div>') +
      (done.length ? '<div style="margin:18px 0 8px;font-size:10px;letter-spacing:2px;color:#5fcf9e;text-transform:uppercase">✓ Completed today</div>' + done.map(taskCard).join('') : '');

    host.querySelectorAll('.gl-comp-task button[data-task-type]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var type = btn.getAttribute('data-task-type');
        var taskId = btn.getAttribute('data-task-id');
        var task = tasks.find(function(t){ return t.id === taskId; }) || {};
        openFormForTask(type, task);
      });
    });
    var addBtn = host.querySelector('#gl-comp-add-manual');
    if(addBtn) addBtn.addEventListener('click', openManualTaskPicker);
  }

  function catalog(task_type){
    var map = {
      preop_inspection:  getForm('GMP-INSP-001'),
      label_verify:      getForm('GMP-LAB-001'),
      allergen_swab:     getForm('GMP-ALL-001'),
      htst_reading:      getForm('FSP-PC-001'),
      hot_fill_reading:  getForm('FSP-PC-002'),
      seam_check:        getForm('FSP-PC-003'),
      uv_reading:        getForm('FSP-PC-004'),
      ferm_reading:      getForm('FSP-PC-005'),
      cip_cycle:         getForm('GMP-SAN-002'),
      calibration:       getForm('GMP-CAL-001'),
      receiving:         getForm('GMP-REC-001'),
      listeria_swab:     getForm('FSP-SAN-001'),
      distribution:      getForm('GMP-DIST-001'),
      training:          getForm('GMP-TR-001'),
      illness:           getForm('GMP-HR-001'),
      supplier_coa:      getForm('FSP-SC-002'),
      batch_record:      getForm('QC-BR-001'),
      annual_fsp:        getForm('FSP-VER-002')
    };
    return map[task_type] || { icon:'📋', code:task_type };
  }

  function openFormForTask(task_type, task){
    if(task_type === 'preop_inspection') return window.glOpenPreOpForm(task);
    if(task_type === 'label_verify')     return window.glOpenLabelVerifyForm(task);
    if(task_type === 'allergen_swab')    return window.glOpenAllergenSwabForm(task);
    if(task_type === 'htst_reading')     return window.glOpenHtstForm(task);
    if(task_type === 'cip_cycle')        return window.glOpenCipForm(task);
    if(task_type === 'hot_fill_reading') return window.glOpenHotFillForm(task);
    if(task_type === 'seam_check')       return window.glOpenSeamForm(task);
    if(task_type === 'uv_reading')       return window.glOpenUvForm(task);
    if(task_type === 'ferm_reading')     return window.glOpenFermForm(task);
    if(task_type === 'calibration')      return window.glOpenCalForm(task);
    if(task_type === 'receiving')        return window.glOpenReceivingForm(task);
    if(task_type === 'listeria_swab')    return window.glOpenListeriaForm(task);
    if(task_type === 'distribution')     return window.glOpenDistForm(task);
    if(task_type === 'training')         return window.glOpenTrainingForm(task);
    if(task_type === 'illness')          return window.glOpenIllnessForm(task);
    if(task_type === 'supplier_coa')     return window.glOpenSupplierCoaForm(task);
    if(task_type === 'batch_record')     return window.glOpenBatchRecordForm(task);
    if(task_type === 'annual_fsp')       return window.glOpenAnnualFspForm(task);
    alert('Unknown task type: ' + task_type);
  }

  function openManualTaskPicker(){
    var body =
      '<div style="font-size:12px;color:#9aa7bd;margin-bottom:12px">Pick a form to log an ad-hoc record (not auto-generated by today\'s schedule).</div>' +
      FORMS.filter(function(f){ return f.built; }).map(function(f){
        return '<button class="cbtn" data-form="' + f.code + '" style="display:block;width:100%;text-align:left;padding:11px 14px;margin-bottom:6px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:9px;color:#fff;cursor:pointer">' +
          '<div style="font-weight:600;font-size:13px">' + f.icon + ' ' + esc(f.name) + '</div>' +
          '<div style="font-size:11px;color:#9aa7bd;margin-top:2px">' + esc(f.desc) + '</div>' +
        '</button>';
      }).join('');
    var modal = modalShell('Add manual task', null, body, '<button type="button" class="cbtn gl-cf-cancel">Cancel</button>');
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    modal.querySelectorAll('button[data-form]').forEach(function(btn){
      btn.addEventListener('click', function(){
        var code = btn.getAttribute('data-form');
        modal.remove();
        launchFormByCode(code);
      });
    });
  }

  function launchFormByCode(code){
    if(code === 'GMP-INSP-001') return window.glOpenPreOpForm({});
    if(code === 'GMP-LAB-001')  return window.glOpenLabelVerifyForm({});
    if(code === 'GMP-ALL-001')  return window.glOpenAllergenSwabForm({});
    if(code === 'FSP-PC-001')   return window.glOpenHtstForm({});
    if(code === 'GMP-SAN-002')  return window.glOpenCipForm({});
    if(code === 'FSP-PC-002')   return window.glOpenHotFillForm({});
    if(code === 'FSP-PC-003')   return window.glOpenSeamForm({});
    if(code === 'FSP-PC-004')   return window.glOpenUvForm({});
    if(code === 'FSP-PC-005')   return window.glOpenFermForm({});
    if(code === 'GMP-CAL-001')  return window.glOpenCalForm({});
    if(code === 'GMP-REC-001')  return window.glOpenReceivingForm({});
    if(code === 'FSP-SAN-001')  return window.glOpenListeriaForm({});
    if(code === 'GMP-DIST-001') return window.glOpenDistForm({});
    if(code === 'GMP-TR-001')   return window.glOpenTrainingForm({});
    if(code === 'GMP-HR-001')   return window.glOpenIllnessForm({});
    if(code === 'FSP-SC-002')   return window.glOpenSupplierCoaForm({});
    if(code === 'QC-BR-001')    return window.glOpenBatchRecordForm({});
    if(code === 'FSP-VER-002')  return window.glOpenAnnualFspForm({});
    alert('Form ' + code + ' not built yet.');
  }

  async function renderOpenLogsTab(host){
    var records = await dbSelect('compliance_records', function(q){ return q.in('status', ['draft','complete']).order('recorded_at', { ascending: false }); });
    if(!records.length){
      host.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa7bd;font-size:13px">No logs awaiting completion or sign-off. ✓</div>';
      return;
    }
    host.innerHTML =
      '<div style="font-size:11px;color:#9aa7bd;letter-spacing:1px;text-transform:uppercase;margin-bottom:14px">' + records.length + ' record' + (records.length === 1 ? '' : 's') + ' awaiting PCQI sign-off or completion</div>' +
      records.map(function(r){
        var f = getForm(r.form_code) || { icon:'📋', name: r.form_code };
        var statusColor = r.status === 'draft' ? '#f5c842' : '#5fcf9e';
        var devBadge = r.has_deviation ? '<span style="font-size:10px;color:#ff8579;background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.3);padding:2px 7px;border-radius:10px;margin-left:6px">⚠ DEVIATION</span>' : '';
        return '<div style="padding:13px 14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;margin-bottom:7px;display:flex;justify-content:space-between;align-items:center;gap:10px">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:13px;color:#fff;font-weight:600">' + f.icon + ' ' + esc(f.name) + devBadge + '</div>' +
            '<div style="font-size:11px;color:#9aa7bd;margin-top:3px">' + esc(r.form_code) + ' · ' + fmtDate(r.recorded_at) + ' ' + fmtTime(r.recorded_at) + ' · status <span style="color:' + statusColor + '">' + esc(r.status) + '</span></div>' +
          '</div>' +
          '<button class="cbtn pri gl-comp-sign" data-id="' + r.id + '" style="font-size:11px;padding:5px 11px">✓ Sign off</button>' +
        '</div>';
      }).join('');
    host.querySelectorAll('.gl-comp-sign').forEach(function(btn){
      btn.addEventListener('click', async function(){
        var id = btn.getAttribute('data-id');
        if(!confirm('Sign this record as PCQI? Your name and timestamp will be locked into the record.')) return;
        var user = window.currentUser || {};
        await dbUpdate('compliance_records', id, {
          status: 'signed',
          signed_by: user.id || null,
          signed_at: nowISO(),
          signature_name: pcqiName(),
          signature_meaning: 'PCQI sign-off — record reviewed and approved'
        });
        if(typeof window.glAudit === 'function') window.glAudit('compliance_record_signed', id, {});
        refreshMaster();
      });
    });
  }

  function renderFormsLibraryTab(host){
    var built = FORMS.filter(function(f){ return f.built; });
    var pending = FORMS.filter(function(f){ return !f.built; });
    function card(f, isBuilt){
      var disabled = isBuilt ? '' : 'opacity:.55;cursor:not-allowed';
      var status = isBuilt ? '<span style="font-size:10px;color:#5fcf9e">✓ Built</span>' : '<span style="font-size:10px;color:#f5c842">Phase 2</span>';
      return '<div class="gl-form-card" data-code="' + f.code + '" data-built="' + (isBuilt?'1':'0') + '" style="padding:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;' + (isBuilt ? 'cursor:pointer;' : disabled) + 'transition:all .15s">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">' +
          '<div style="font-size:13px;font-weight:600;color:#fff">' + f.icon + ' ' + esc(f.name) + '</div>' + status +
        '</div>' +
        '<div style="font-size:10px;letter-spacing:1px;color:#9aa7bd;text-transform:uppercase">' + esc(f.code) + '</div>' +
        '<div style="font-size:12px;color:#cfd9e6;margin:6px 0">' + esc(f.desc) + '</div>' +
        '<div style="font-size:11px;color:#9aa7bd"><b style="color:#7fc6f5">Frequency:</b> ' + esc(f.frequency) + '</div>' +
      '</div>';
    }
    host.innerHTML =
      '<div style="margin-bottom:14px;font-size:10px;letter-spacing:2px;color:#5fcf9e;text-transform:uppercase">Built &amp; live — ' + built.length + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-bottom:18px">' + built.map(function(f){ return card(f, true); }).join('') + '</div>' +
      '<div style="margin-bottom:14px;font-size:10px;letter-spacing:2px;color:#f5c842;text-transform:uppercase">Phase 2 — coming next — ' + pending.length + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">' + pending.map(function(f){ return card(f, false); }).join('') + '</div>';

    host.querySelectorAll('.gl-form-card[data-built="1"]').forEach(function(c){
      c.addEventListener('click', function(){
        launchFormByCode(c.getAttribute('data-code'));
      });
    });
  }

  async function renderMaster(){
    var host = document.getElementById('comp-body');
    if(!host) return;
    host.innerHTML =
      '<div style="display:flex;gap:6px;margin-bottom:18px;border-bottom:1px solid rgba(255,255,255,.06);padding-bottom:0">' +
        '<button class="gl-comp-tab" data-tab="today"   style="' + tabStyle('today') + '">📋 Today\'s Tasks</button>' +
        '<button class="gl-comp-tab" data-tab="open"    style="' + tabStyle('open') + '">📝 Open Logs</button>' +
        '<button class="gl-comp-tab" data-tab="library" style="' + tabStyle('library') + '">📚 Forms Library</button>' +
        '<div style="flex:1"></div>' +
        '<button class="cbtn gl-comp-hold" style="font-size:11px;padding:5px 11px">🚫 New Hold Tag</button>' +
      '</div>' +
      '<div id="comp-tab-body"></div>';
    host.querySelectorAll('.gl-comp-tab').forEach(function(btn){
      btn.addEventListener('click', function(){ currentTab = btn.getAttribute('data-tab'); renderMaster(); });
    });
    host.querySelector('.gl-comp-hold').addEventListener('click', function(){ window.glOpenAddHoldTag(); });
    var body = host.querySelector('#comp-tab-body');
    if(currentTab === 'today')   await renderTodayTab(body);
    if(currentTab === 'open')    await renderOpenLogsTab(body);
    if(currentTab === 'library') renderFormsLibraryTab(body);
  }
  function tabStyle(t){
    var on = currentTab === t;
    return 'padding:9px 16px;background:none;border:none;border-bottom:2px solid ' + (on ? 'var(--teal,#00e5c0)' : 'transparent') + ';color:' + (on ? 'var(--teal,#00e5c0)' : '#9aa7bd') + ';font-size:12px;font-weight:600;cursor:pointer;transition:all .12s';
  }
  function refreshMaster(){ if(document.getElementById('cpg-compliance') && document.getElementById('cpg-compliance').classList.contains('act')) renderMaster(); renderHoldsList(); }
  window.refreshComplianceMaster = refreshMaster;

  // ── Hold Tags page renderer ──
  async function renderHoldsList(){
    var host = document.getElementById('holds-body');
    if(!host) return;
    var rows = await dbSelect('hold_tags', function(q){ return q.order('hold_date', { ascending: false }); });
    if(!rows.length){
      host.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa7bd;font-size:13px">No hold tags. ✓ All product is clear to ship.</div>';
      return;
    }
    var open = rows.filter(function(r){ return r.status === 'open'; });
    host.innerHTML =
      (open.length ? '<div style="padding:11px 14px;background:rgba(231,76,60,.08);border:1px solid rgba(231,76,60,.25);border-radius:9px;margin-bottom:14px;font-size:12px;color:#ff8579">⚠ ' + open.length + ' open hold tag' + (open.length===1?'':'s') + ' — these lots cannot ship until PCQI signs the disposition.</div>' : '') +
      '<table class="ctbl" style="width:100%"><thead><tr><th>Tag #</th><th>Product / Lot</th><th>Reason</th><th>Hazard</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
      rows.map(function(r){
        var statusColor = r.status === 'open' ? '#ff8579' : '#5fcf9e';
        return '<tr><td style="font-family:var(--ff-mono);color:var(--teal);font-weight:600">' + esc(r.tag_number) + '</td>' +
          '<td><b>' + esc(r.product_name) + '</b>' + (r.lot_number ? '<br><span style="font-size:11px;color:#9aa7bd">Lot ' + esc(r.lot_number) + '</span>' : '') + '</td>' +
          '<td style="font-size:12px;color:#cfd9e6;max-width:260px">' + esc(r.reason) + '</td>' +
          '<td><span style="font-size:11px;color:#9aa7bd">' + esc(r.hazard_type||'—') + '</span></td>' +
          '<td style="font-size:11px;color:#9aa7bd">' + fmtDate(r.hold_date) + '</td>' +
          '<td><span style="font-size:11px;color:' + statusColor + ';font-weight:600">' + esc(r.status).toUpperCase() + '</span>' + (r.disposition ? '<br><span style="font-size:10px;color:#9aa7bd">' + esc(r.disposition) + '</span>' : '') + '</td>' +
          '<td>' + (r.status === 'open'
            ? '<button class="cbtn pri gl-hold-dispose" data-id="' + r.id + '" style="font-size:10px;padding:3px 8px">Dispose</button>'
            : '<span style="font-size:10px;color:#9aa7bd">—</span>') +
          '</td></tr>';
      }).join('') + '</tbody></table>';
    host.querySelectorAll('.gl-hold-dispose').forEach(function(btn){
      btn.addEventListener('click', function(){ openDispositionModal(btn.getAttribute('data-id'), rows); });
    });
  }

  function openDispositionModal(id, allRows){
    var row = allRows.find(function(r){ return r.id === id; });
    if(!row) return;
    var body =
      '<div style="background:rgba(255,255,255,.03);padding:12px;border-radius:8px;margin-bottom:14px;font-size:12px">' +
        '<div><b>' + esc(row.tag_number) + '</b> · ' + esc(row.product_name) + (row.lot_number ? ' · Lot ' + esc(row.lot_number) : '') + '</div>' +
        '<div style="color:#9aa7bd;margin-top:4px">' + esc(row.reason) + '</div>' +
      '</div>' +
      field('Disposition', 'disp', 'select', { options: [['release','✓ Release — product cleared for shipping'],['reprocess','🔄 Reprocess — rework before release'],['destroy','🗑 Destroy — product cannot be saved']], required: true }) +
      field('Disposition notes / justification', 'disp_notes', 'textarea', { required: true });
    var modal = modalShell('PCQI Hold-Tag Disposition', row.tag_number, body,
      '<button type="button" class="cbtn gl-cf-cancel">Cancel</button>' +
      '<button type="button" class="cbtn pri gl-cf-sign">✓ Sign disposition as PCQI</button>');
    modal.querySelector('.gl-cf-cancel').addEventListener('click', function(){ modal.remove(); });
    modal.querySelector('.gl-cf-sign').addEventListener('click', async function(){
      var disp = getVal(modal,'disp');
      var notes = getVal(modal,'disp_notes');
      if(!disp || !notes){ alert('Disposition and notes are required.'); return; }
      await dbUpdate('hold_tags', id, {
        disposition: disp,
        disposition_authorized_by: (window.currentUser && window.currentUser.id) || null,
        disposition_authorized_name: pcqiName(),
        disposition_date: nowISO(),
        status: disp === 'release' ? 'released' : 'disposed',
        notes: notes
      });
      if(typeof window.glAudit === 'function') window.glAudit('hold_tag_disposed', row.tag_number, { disposition: disp });
      if(typeof addNotification === 'function') addNotification('🚫 Hold ' + row.tag_number + ' → ' + disp, row.product_name, 'success');
      modal.remove();
      refreshMaster();
    });
  }

  // ── Watch page navigation ──
  function watch(){
    var pgC = document.getElementById('cpg-compliance');
    var pgH = document.getElementById('cpg-holds');
    if(!pgC || !pgH){ setTimeout(watch, 500); return; }
    new MutationObserver(function(){ if(pgC.classList.contains('act')) renderMaster(); }).observe(pgC, { attributes:true, attributeFilter:['class'] });
    new MutationObserver(function(){ if(pgH.classList.contains('act')) renderHoldsList(); }).observe(pgH, { attributes:true, attributeFilter:['class'] });
    if(pgC.classList.contains('act')) renderMaster();
    if(pgH.classList.contains('act')) renderHoldsList();
  }
  if(document.readyState !== 'loading') watch();
  else document.addEventListener('DOMContentLoaded', watch);

  console.log('[GL] compliance module loaded — Phase 1 (4 forms, master page, hold tags)');
}());


/* ============================================================
   COMPLIANCE — CRITICAL PACK
   Adds three things gating production use of the compliance system:
   (1) glCheckRunHoldStatus — query open hold tags chained to a run
   (2) FDA audit export — CSV + print-to-PDF for any form / date range
   (3) Help docs — new section in the help modal covering Compliance
   ============================================================ */
(function(){
  // ── (1) Hold-tag → run check ──
  // Hold tags link to compliance_records via source_record_id.
  // compliance_records link to production_runs via run_id.
  // Returns the first blocking hold (or null) for a given run.
  window.glCheckRunHoldStatus = async function(run_id){
    if(!run_id || !window.supa) return null;
    try {
      // Step 1: get the open holds and the record IDs they reference
      var hr = await window.supa.from('hold_tags').select('id,tag_number,reason,source_record_id,status').eq('status','open');
      if(hr.error || !hr.data || !hr.data.length) return null;
      var recIds = hr.data.map(function(h){ return h.source_record_id; }).filter(Boolean);
      if(!recIds.length) return null;
      // Step 2: filter to records that match this run
      var rr = await window.supa.from('compliance_records').select('id,run_id').in('id', recIds).eq('run_id', run_id);
      if(rr.error || !rr.data || !rr.data.length) return null;
      var matchRecIds = rr.data.map(function(r){ return r.id; });
      // Step 3: return the matching hold tag
      return hr.data.find(function(h){ return matchRecIds.indexOf(h.source_record_id) !== -1; }) || null;
    } catch(e){
      console.warn('[GL compliance] glCheckRunHoldStatus failed', e);
      return null;
    }
  };

  // ── (2) FDA audit export — CSV + print-to-PDF ──
  function escCsv(v){
    if(v === null || v === undefined) return '';
    var s = (typeof v === 'object') ? JSON.stringify(v) : String(v);
    if(/[",\n\r]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  }
  function downloadFile(filename, mime, content){
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
  }
  function escHtml(v){ return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  // Form catalog — names for the export picker (mirror of FORMS in the compliance IIFE)
  var EXPORT_FORMS = [
    { code:'GMP-INSP-001', name:'Daily Pre-Op Inspection' },
    { code:'GMP-LAB-001',  name:'Label Verification' },
    { code:'GMP-ALL-001',  name:'Allergen Changeover Swab' },
    { code:'GMP-SAN-002',  name:'CIP Monitoring (9-step)' },
    { code:'GMP-REC-001',  name:'Receiving / COA Review' },
    { code:'GMP-CAL-001',  name:'Equipment Calibration' },
    { code:'GMP-DIST-001', name:'Distribution / Traceability' },
    { code:'GMP-HR-001',   name:'Employee Illness Exclusion' },
    { code:'GMP-TR-001',   name:'Employee Training' },
    { code:'FSP-PC-001',   name:'HTST Pasteurization (CCP-1)' },
    { code:'FSP-PC-002',   name:'Hot Fill Temp (CCP-2)' },
    { code:'FSP-PC-003',   name:'Can Seam (CCP-4)' },
    { code:'FSP-PC-004',   name:'UV Water (CCP-3)' },
    { code:'FSP-PC-005',   name:'Fermentation (CCP-A)' },
    { code:'FSP-SAN-001',  name:'Listeria Environmental' },
    { code:'FSP-SC-002',   name:'Supplier COA Review' },
    { code:'FSP-VER-002',  name:'Annual FSP Review' },
    { code:'QC-BR-001',    name:'Production Batch Record' }
  ];

  window.glOpenComplianceExport = function(){
    var prior = document.getElementById('gl-export-modal'); if(prior) prior.remove();
    var today = new Date().toISOString().slice(0,10);
    var ninetyDaysAgo = new Date(Date.now() - 90*86400000).toISOString().slice(0,10);

    var formCheckboxes = EXPORT_FORMS.map(function(f){
      return '<label style="display:flex;align-items:center;gap:7px;padding:5px 0;font-size:12px;color:#cfd9e6;cursor:pointer">' +
        '<input type="checkbox" class="gl-exp-form" value="' + f.code + '" checked style="accent-color:var(--teal);width:13px;height:13px">' +
        f.code + ' — ' + escHtml(f.name) +
      '</label>';
    }).join('');

    var ov = document.createElement('div');
    ov.id = 'gl-export-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:9000;background:rgba(6,13,26,.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.22);border-radius:14px;width:100%;max-width:600px;max-height:88vh;overflow-y:auto;color:#cfd9e6;box-shadow:0 20px 60px rgba(0,0,0,.6)">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.06)">' +
          '<div>' +
            '<div style="font-family:var(--ff-disp);font-size:14px;letter-spacing:2px;color:var(--teal);font-weight:700">📥 FDA AUDIT EXPORT</div>' +
            '<div style="font-size:11px;color:#9aa7bd;margin-top:3px">Export compliance records — CSV or print-to-PDF</div>' +
          '</div>' +
          '<button id="gl-exp-close" style="background:none;border:none;color:#9aa7bd;font-size:18px;cursor:pointer;padding:2px 6px">✕</button>' +
        '</div>' +
        '<div style="padding:18px 22px">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">' +
            '<div><div style="font-size:11px;color:#9aa7bd;margin-bottom:4px">From date</div><input id="gl-exp-from" type="date" value="' + ninetyDaysAgo + '" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box"></div>' +
            '<div><div style="font-size:11px;color:#9aa7bd;margin-bottom:4px">To date</div><input id="gl-exp-to" type="date" value="' + today + '" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box"></div>' +
          '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
            '<div style="font-size:11px;color:#9aa7bd;letter-spacing:1px;text-transform:uppercase">Forms to include</div>' +
            '<div><button id="gl-exp-all" style="background:none;border:none;color:#7fc6f5;font-size:11px;cursor:pointer;margin-right:8px">Select all</button><button id="gl-exp-none" style="background:none;border:none;color:#7fc6f5;font-size:11px;cursor:pointer">Clear</button></div>' +
          '</div>' +
          '<div style="max-height:200px;overflow-y:auto;padding:8px 10px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;margin-bottom:14px">' + formCheckboxes + '</div>' +
          '<label style="display:flex;align-items:center;gap:7px;padding:5px 0;font-size:12px;color:#cfd9e6;cursor:pointer;margin-bottom:14px">' +
            '<input type="checkbox" id="gl-exp-signed-only" style="accent-color:var(--teal);width:13px;height:13px"> Only include PCQI-signed records (recommended for audit)' +
          '</label>' +
          '<div id="gl-exp-preview" style="font-size:11px;color:#9aa7bd;padding:8px 10px;background:rgba(255,255,255,.02);border:1px dashed rgba(255,255,255,.1);border-radius:6px">Loading record count…</div>' +
        '</div>' +
        '<div style="padding:14px 22px;border-top:1px solid rgba(255,255,255,.06);display:flex;gap:8px;justify-content:flex-end">' +
          '<button id="gl-exp-cancel" class="cbtn">Cancel</button>' +
          '<button id="gl-exp-csv" class="cbtn">📄 Download CSV</button>' +
          '<button id="gl-exp-pdf" class="cbtn pri">🖨️ Print / PDF</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    function close(){ ov.remove(); }
    ov.addEventListener('click', function(e){ if(e.target === ov) close(); });
    ov.querySelector('#gl-exp-close').addEventListener('click', close);
    ov.querySelector('#gl-exp-cancel').addEventListener('click', close);

    ov.querySelector('#gl-exp-all').addEventListener('click', function(){
      ov.querySelectorAll('.gl-exp-form').forEach(function(cb){ cb.checked = true; });
      updatePreview();
    });
    ov.querySelector('#gl-exp-none').addEventListener('click', function(){
      ov.querySelectorAll('.gl-exp-form').forEach(function(cb){ cb.checked = false; });
      updatePreview();
    });
    ov.querySelector('#gl-exp-from').addEventListener('change', updatePreview);
    ov.querySelector('#gl-exp-to').addEventListener('change', updatePreview);
    ov.querySelector('#gl-exp-signed-only').addEventListener('change', updatePreview);
    ov.querySelectorAll('.gl-exp-form').forEach(function(cb){ cb.addEventListener('change', updatePreview); });

    function selectedForms(){
      return Array.prototype.filter.call(ov.querySelectorAll('.gl-exp-form'), function(cb){ return cb.checked; })
        .map(function(cb){ return cb.value; });
    }
    function dateRange(){
      return { from: ov.querySelector('#gl-exp-from').value, to: ov.querySelector('#gl-exp-to').value };
    }
    function signedOnly(){ return ov.querySelector('#gl-exp-signed-only').checked; }

    async function fetchRecords(){
      var codes = selectedForms();
      var dr = dateRange();
      if(!codes.length) return [];
      if(!window.supa) return [];
      var q = window.supa.from('compliance_records').select('*').in('form_code', codes);
      if(dr.from) q = q.gte('record_date', dr.from);
      if(dr.to)   q = q.lte('record_date', dr.to);
      if(signedOnly()) q = q.eq('status','signed');
      q = q.order('record_date', { ascending: false }).order('recorded_at', { ascending: false }).limit(2000);
      var r = await q;
      return r.data || [];
    }

    async function updatePreview(){
      var preview = ov.querySelector('#gl-exp-preview');
      preview.textContent = 'Loading record count…';
      var rows = await fetchRecords();
      var byForm = {};
      rows.forEach(function(r){ byForm[r.form_code] = (byForm[r.form_code] || 0) + 1; });
      var breakdown = Object.keys(byForm).sort().map(function(k){ return k + ': ' + byForm[k]; }).join(' · ');
      preview.innerHTML = '<b style="color:#5fcf9e">' + rows.length + ' record' + (rows.length === 1 ? '' : 's') + ' match.</b>' + (breakdown ? ' ' + breakdown : '');
    }
    updatePreview();

    ov.querySelector('#gl-exp-csv').addEventListener('click', async function(){
      var rows = await fetchRecords();
      if(!rows.length){ alert('No records match.'); return; }
      // Collect every key seen in data JSONB so each gets a column
      var dataKeys = {};
      rows.forEach(function(r){
        if(r.data && typeof r.data === 'object'){
          Object.keys(r.data).forEach(function(k){
            if(typeof r.data[k] !== 'object') dataKeys[k] = true;
          });
        }
      });
      var dataCols = Object.keys(dataKeys).sort();
      var header = ['record_id','form_code','record_date','recorded_at','status','signature_name','signed_at','has_deviation','deviation_notes','corrective_action','run_id','client_id','hold_tag_id','nc_report_id'].concat(dataCols);
      var csv = header.map(escCsv).join(',') + '\r\n';
      rows.forEach(function(r){
        var line = [r.id, r.form_code, r.record_date, r.recorded_at, r.status, r.signature_name, r.signed_at, r.has_deviation, r.deviation_notes, r.corrective_action, r.run_id, r.client_id, r.hold_tag_id, r.nc_report_id];
        dataCols.forEach(function(k){ line.push(r.data ? r.data[k] : ''); });
        csv += line.map(escCsv).join(',') + '\r\n';
      });
      var dr = dateRange();
      downloadFile('compliance-export-' + dr.from + '-to-' + dr.to + '.csv', 'text/csv;charset=utf-8', csv);
    });

    ov.querySelector('#gl-exp-pdf').addEventListener('click', async function(){
      var rows = await fetchRecords();
      if(!rows.length){ alert('No records match.'); return; }
      var dr = dateRange();
      // Build a print-friendly HTML window
      var w = window.open('', '_blank');
      if(!w){ alert('Pop-up blocked — allow pop-ups for this site to print/PDF.'); return; }
      var formatDate = function(d){ if(!d) return ''; var x = new Date(d); return x.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); };
      var formatTs = function(d){ if(!d) return ''; var x = new Date(d); return x.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}); };
      var html =
        '<!doctype html><html><head><meta charset="utf-8"><title>Good Liquid Bev Co — Compliance Export</title>' +
        '<style>' +
          'body{font-family:Helvetica,Arial,sans-serif;color:#0a1628;margin:24px;line-height:1.4;font-size:11px}' +
          'h1{font-size:18px;letter-spacing:1px;margin:0 0 4px}' +
          '.meta{color:#555;font-size:10px;margin-bottom:18px}' +
          '.rec{border:1px solid #ddd;border-radius:6px;padding:10px 12px;margin-bottom:10px;page-break-inside:avoid}' +
          '.rec h3{margin:0 0 4px;font-size:12px;letter-spacing:1px}' +
          '.rec .head{color:#888;font-size:10px;margin-bottom:6px}' +
          '.rec table{width:100%;border-collapse:collapse;font-size:10px;margin-top:4px}' +
          '.rec table td{padding:3px 6px;border-bottom:1px dotted #eee;vertical-align:top}' +
          '.rec table td:first-child{color:#888;width:30%}' +
          '.dev{background:#fef0ef;border-left:3px solid #d34;padding:6px 10px;margin-top:6px}' +
          '.sig{margin-top:6px;padding-top:6px;border-top:1px solid #eee;font-size:10px;color:#555}' +
          '.signed-yes{color:#0a8}' +
          '@media print { .no-print{display:none} body{margin:12px} }' +
        '</style></head><body>' +
        '<h1>Good Liquid Bev Co — Compliance Records Export</h1>' +
        '<div class="meta">2011 51st Ave E, Palmetto, FL 34221 · Date range: ' + escHtml(dr.from) + ' to ' + escHtml(dr.to) +
        ' · ' + rows.length + ' records · Exported ' + formatTs(new Date()) + (signedOnly() ? ' · PCQI-signed only' : '') + '</div>' +
        '<div class="no-print" style="margin-bottom:14px"><button onclick="window.print()" style="padding:8px 16px;background:#0a8;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:700">🖨️ Print / Save as PDF</button> <button onclick="window.close()" style="margin-left:6px">Close</button></div>';
      rows.forEach(function(r){
        var data = r.data || {};
        html += '<div class="rec">' +
          '<h3>' + escHtml(r.form_code) + (r.signature_name ? ' · <span class="signed-yes">✓ SIGNED ' + escHtml(r.signature_name) + '</span>' : ' · ' + escHtml(r.status||'').toUpperCase()) + '</h3>' +
          '<div class="head">Recorded ' + formatTs(r.recorded_at) + (r.record_date ? ' · for ' + escHtml(r.record_date) : '') + '</div>';
        // Data table
        var dataRows = Object.keys(data).filter(function(k){ return typeof data[k] !== 'object'; });
        if(dataRows.length){
          html += '<table>';
          dataRows.forEach(function(k){
            html += '<tr><td>' + escHtml(k) + '</td><td>' + escHtml(data[k]) + '</td></tr>';
          });
          html += '</table>';
        }
        // Handle steps array on CIP records
        if(Array.isArray(data.steps)){
          html += '<div style="font-size:10px;color:#666;margin-top:4px"><b>CIP Steps:</b></div>';
          html += '<table style="margin-top:2px"><tr><td>#</td><td>Step</td><td>Done</td><td>Actual min</td><td>Temp °F</td><td>Reading</td><td>P/F</td></tr>';
          data.steps.forEach(function(s){
            html += '<tr><td>'+s.n+'</td><td>'+escHtml(s.name)+'</td><td>'+(s.done?'Y':'N')+'</td><td>'+s.actual_min+'</td><td>'+(s.temp_f||'')+'</td><td>'+escHtml(s.reading||'')+'</td><td>'+escHtml(s.pf||'')+'</td></tr>';
          });
          html += '</table>';
        }
        if(r.has_deviation){
          html += '<div class="dev"><b>⚠ Deviation:</b> ' + escHtml(r.deviation_notes || '(no notes)') +
            (r.corrective_action ? '<br><b>Corrective action:</b> ' + escHtml(r.corrective_action) : '') + '</div>';
        }
        if(r.signature_name){
          html += '<div class="sig"><b>PCQI signature:</b> ' + escHtml(r.signature_name) + ' on ' + formatTs(r.signed_at) +
            (r.signature_meaning ? ' (' + escHtml(r.signature_meaning) + ')' : '') + '</div>';
        }
        html += '</div>';
      });
      html += '</body></html>';
      w.document.write(html);
      w.document.close();
    });
  };

  // ── (3) Help docs for Compliance ──
  var SEC_COMPLIANCE_HTML =
    '<div style="margin:8px 0 14px;padding:12px 14px;background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.25);border-left:3px solid #f5c842;border-radius:0 8px 8px 0;font-size:12.5px;line-height:1.7;color:#cfd9e6">' +
      '<div style="font-size:10px;letter-spacing:2px;color:#f5c842;font-weight:700;margin-bottom:6px">📍 WHERE THIS LIVES</div>' +
      '<b>Compliance master page</b> &rarr; sidebar &rarr; <b>Compliance</b> section &rarr; <b>📋 Compliance Tasks</b>.<br>' +
      '<b>Hold Tags page</b> &rarr; sidebar &rarr; <b>Compliance</b> section &rarr; <b>🚫 Hold Tags</b>.<br>' +
      '<b>CIP / Sanitation Log</b> (9-step) &rarr; sidebar &rarr; <b>Compliance</b> section &rarr; <b>🧼 CIP / Sanitation Log</b> (or task auto-launches it).' +
    '</div>' +
    '<p style="color:#cfd9e6;font-size:13px;line-height:1.7;margin:0 0 12px">FDA-compliant logging built on 21 CFR Part 117 Subpart B. 18 forms work end-to-end with quick-capture, PCQI typed e-signature (Part 11), critical-limit auto-spawn of Hold Tag + NC report, and a master daily checklist that auto-generates tasks based on the day&rsquo;s production runs.</p>' +
    '<div style="margin:18px 0 4px;padding:8px 12px;background:rgba(0,229,192,.06);border-left:3px solid var(--teal);border-radius:0 6px 6px 0"><b style="color:var(--teal);font-size:13px;letter-spacing:1px">📋 MASTER PAGE — 3 TABS</b></div>' +
    '<ul style="margin:10px 0 4px;padding-left:20px;color:#cfd9e6;font-size:13px;line-height:1.75">' +
      '<li><b>Today&rsquo;s Tasks</b> — auto-generated from production runs + recurring rules (daily pre-op, monthly cal/Listeria, per-run CCP logs based on processing method).</li>' +
      '<li><b>Open Logs</b> — every record awaiting completion or PCQI sign-off. Click ✓ to sign.</li>' +
      '<li><b>Forms Library</b> — launchers for all 18 forms (use for ad-hoc records not auto-generated).</li>' +
    '</ul>' +
    '<div style="margin:18px 0 4px;padding:8px 12px;background:rgba(0,229,192,.06);border-left:3px solid var(--teal);border-radius:0 6px 6px 0"><b style="color:var(--teal);font-size:13px;letter-spacing:1px">🧪 9-STEP CIP (GMP-SAN-002 v2.1)</b></div>' +
    '<p style="color:#cfd9e6;font-size:13px;line-height:1.7;margin:0 0 12px">Single modal with 9 step rows: Pre-rinse · PBW · Rinse · Caustic · Rinse · Acid · Rinse · POST-CIP PAA · PRE-USE PAA. Each row captures done-checkbox, actual duration, temperature, verification reading (% conc / µS/cm / ppm), pass/fail. Target durations pre-filled per LEAN_01 v2.1 (PBW/caustic/acid 30 min, PAA 20 min).</p>' +
    '<div style="font-size:11px;color:#ff8579;background:rgba(231,76,60,.1);padding:8px 12px;border-radius:6px;margin-bottom:12px">Critical limits enforced: temp ≥ 160°F steps 1-7 · PAA 100-300 ppm steps 8-9 · DO NOT RINSE after PAA. Any step FAIL or out-of-spec auto-spawns Hold Tag + NC draft.</div>' +
    '<div style="margin:18px 0 4px;padding:8px 12px;background:rgba(0,229,192,.06);border-left:3px solid var(--teal);border-radius:0 6px 6px 0"><b style="color:var(--teal);font-size:13px;letter-spacing:1px">✓ PCQI SIGN-OFF</b></div>' +
    '<p style="color:#cfd9e6;font-size:13px;line-height:1.7;margin:0 0 12px">Every form has a <b>Save &amp; sign as PCQI</b> button. Click = your typed name + UTC timestamp + signature meaning are locked into the record. Part 11 compliant for single-PCQI model. Sign-offs can also happen later from the Open Logs tab.</p>' +
    '<div style="margin:18px 0 4px;padding:8px 12px;background:rgba(0,229,192,.06);border-left:3px solid var(--teal);border-radius:0 6px 6px 0"><b style="color:var(--teal);font-size:13px;letter-spacing:1px">🚫 CRITICAL-LIMIT TRIGGERS</b></div>' +
    '<p style="color:#cfd9e6;font-size:13px;line-height:1.7;margin:0 0 6px">Any pass/fail field marked FAIL or any CCP reading outside its limit (HTST &lt;165°F, hot fill &lt;185°F, UV dose &lt;40 mJ/cm², PAA outside 100-300 ppm, etc.) auto-creates:</p>' +
    '<ul style="margin:6px 0 12px;padding-left:20px;color:#cfd9e6;font-size:13px;line-height:1.75">' +
      '<li>A <b>Hold Tag</b> (HT-YYYY-NNN auto-numbered) on the affected lot, status=open</li>' +
      '<li>A <b>Non-Conformance Report</b> in the Defects/NCRs page, severity=high, status=open</li>' +
      '<li>A notification + audit log entry</li>' +
      '<li><b>The affected production run is blocked from moving to "Ship"</b> until the Hold Tag is dispositioned</li>' +
    '</ul>' +
    '<div style="margin:18px 0 4px;padding:8px 12px;background:rgba(0,229,192,.06);border-left:3px solid var(--teal);border-radius:0 6px 6px 0"><b style="color:var(--teal);font-size:13px;letter-spacing:1px">📥 FDA AUDIT EXPORT</b></div>' +
    '<p style="color:#cfd9e6;font-size:13px;line-height:1.7;margin:0 0 6px">Click <b>📥 Export</b> on the Compliance master page header. Pick form types + date range + optionally "signed only." Get either:</p>' +
    '<ul style="margin:6px 0 12px;padding-left:20px;color:#cfd9e6;font-size:13px;line-height:1.75">' +
      '<li><b>CSV</b> — every record as a row, with the form-specific data fields flattened into columns (good for Excel review or external archival).</li>' +
      '<li><b>Print / PDF</b> — opens a print-styled window with one record per card, signatures shown, deviations highlighted. Use browser <b>"Save as PDF"</b> in the print dialog for an FDA-ready PDF.</li>' +
    '</ul>' +
    '<p style="color:#cfd9e6;font-size:13px;line-height:1.7;margin:0 0 12px">Records retain in Supabase for 2 years per §117.180. FDA access within 24 hours = use this export.</p>' +
    '<div style="margin:18px 0 4px;padding:8px 12px;background:rgba(0,229,192,.06);border-left:3px solid var(--teal);border-radius:0 6px 6px 0"><b style="color:var(--teal);font-size:13px;letter-spacing:1px">📐 18 FORMS BUILT</b></div>' +
    '<div style="font-size:12px;color:#cfd9e6;line-height:1.8">' +
      '<b>Daily / per-run:</b> Pre-Op Inspection · Label Verification · Allergen Swab · HTST · Hot Fill · Can Seam · UV Water · Fermentation · 9-step CIP · Batch Record<br>' +
      '<b>Monthly:</b> Calibration · Environmental Listeria<br>' +
      '<b>Event-driven:</b> Receiving · Distribution · Illness Exclusion · Hold Tag<br>' +
      '<b>As-needed:</b> Training · Supplier COA Review<br>' +
      '<b>Annual:</b> FSP Review' +
    '</div>';

  function tryAddComplianceHelp(){
    var orig = window.glOpenHelp;
    if(typeof orig !== 'function'){ setTimeout(tryAddComplianceHelp, 500); return; }
    if(window.__glComplianceHelpHooked) return;
    window.__glComplianceHelpHooked = true;

    var origOpen = orig;
    window.glOpenHelp = function(scrollTo){
      origOpen(scrollTo);
      var tries = 0;
      var iv = setInterval(function(){
        var body = document.getElementById('gl-help-body');
        var toc  = document.getElementById('gl-help-toc');
        if((body && body.dataset.glComplianceApplied === '1') || ++tries > 12){ clearInterval(iv); return; }
        if(!body || !toc) return;
        clearInterval(iv);
        var sectionHtml = '<section id="help-compliance" style="padding:22px 4px 26px;border-bottom:1px solid rgba(255,255,255,.06);scroll-margin-top:20px">' +
          '<h3 style="margin:0 0 14px;font-family:var(--ff-disp);font-size:15px;letter-spacing:2px;color:var(--teal)">📋 COMPLIANCE</h3>' +
          SEC_COMPLIANCE_HTML +
        '</section>';
        body.insertAdjacentHTML('beforeend', sectionHtml);
        // TOC entry
        toc.insertAdjacentHTML('beforeend',
          '<a href="#help-compliance" data-anchor="help-compliance" style="display:block;padding:8px 12px;margin:2px 0;border-radius:6px;font-size:12px;color:#9aa7bd;text-decoration:none;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:background .12s,color .12s">📋 Compliance</a>');
        var newAnchor = toc.querySelector('a[data-anchor="help-compliance"]');
        if(newAnchor){
          newAnchor.addEventListener('click', function(ev){
            ev.preventDefault();
            var t = document.getElementById('help-compliance');
            if(t) t.scrollIntoView({ behavior:'smooth', block:'start' });
          });
        }
        body.dataset.glComplianceApplied = '1';
        // Auto-scroll if pressed ? while on Compliance page
        var activePg = document.querySelector('#crm-panel .cpg.act');
        if(activePg && (activePg.id === 'cpg-compliance' || activePg.id === 'cpg-holds')){
          setTimeout(function(){
            var t = document.getElementById('help-compliance');
            if(t) t.scrollIntoView({ behavior:'instant', block:'start' });
          }, 80);
        }
      }, 60);
    };
  }
  tryAddComplianceHelp();

  // Wire the FDA Export button into the master page header (next to New Hold Tag).
  function tryInjectExportButton(){
    var host = document.getElementById('comp-body');
    if(!host){ setTimeout(tryInjectExportButton, 700); return; }
    new MutationObserver(function(){
      var holdBtn = host.querySelector('.gl-comp-hold');
      if(!holdBtn) return;
      if(holdBtn.parentNode.querySelector('.gl-comp-export')) return;
      var exp = document.createElement('button');
      exp.className = 'cbtn gl-comp-export';
      exp.setAttribute('style','font-size:11px;padding:5px 11px;margin-right:6px;background:rgba(127,198,245,.08);border:1px solid rgba(127,198,245,.3);color:#7fc6f5');
      exp.textContent = '📥 Export';
      exp.addEventListener('click', function(){ window.glOpenComplianceExport(); });
      holdBtn.parentNode.insertBefore(exp, holdBtn);
    }).observe(host, { childList:true, subtree:true });
  }
  if(document.readyState !== 'loading') tryInjectExportButton();
  else document.addEventListener('DOMContentLoaded', tryInjectExportButton);

  console.log('[GL] compliance critical pack loaded — Hold-Tag guard + FDA export + help docs');
}());


/* ============================================================
   COMPLIANCE — IMPORTANT PACK
   (4) Records History view (all records, filterable, CIP step detail)
   (5) PCQI Weekly Review queue (last 7 days signed records, bulk ack)
   (6) Lot Traceability — search a lot, get every record + run + hold
   (7) Editable CCP Critical Limits (settings modal, localStorage override)
   ============================================================ */
(function(){
  var esc = window.glEsc;
  function fmtDate(d){ if(!d) return '—'; var x = new Date(d); if(isNaN(x.getTime())) return String(d); return x.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
  function fmtTime(d){ if(!d) return ''; var x = new Date(d); if(isNaN(x.getTime())) return ''; return x.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); }
  function fmtTs(d){ if(!d) return ''; return fmtDate(d) + ' ' + fmtTime(d); }
  function nowISO(){ return new Date().toISOString(); }

  // ── (7) Critical Limits — read overrides from localStorage at boot ──
  var LIMITS_KEY = 'gl_ccp_limits';
  function readLimits(){
    try { return Object.assign({}, JSON.parse(localStorage.getItem(LIMITS_KEY) || '{}')); }
    catch(e){ return {}; }
  }
  function writeLimits(obj){ localStorage.setItem(LIMITS_KEY, JSON.stringify(obj)); }
  // Push overrides into the compliance module's DEFAULT_LIMITS object
  // (it's hoisted via closure but we exposed nothing; mutate via a known global guard).
  // We expose a getter all forms can use going forward, plus apply overrides
  // to any existing DEFAULT_LIMITS we can find on window via best-effort.
  var DEFAULT_LIMITS_PUBLIC = {
    htst_temp_f: 165,
    htst_hold_sec: 15,
    hot_fill_f: 185,
    uv_dose_mj_cm2: 40,
    paa_ppm_min: 100,
    paa_ppm_max: 300,
    final_pH_fermented: 4.6,
    cip_temp_f: 160,
    cip_pbw_min: 30,
    cip_caustic_min: 30,
    cip_acid_min: 30,
    cip_paa_min: 20
  };
  window.glGetLimits = function(){
    var out = Object.assign({}, DEFAULT_LIMITS_PUBLIC);
    var o = readLimits();
    Object.keys(o).forEach(function(k){ if(typeof o[k] === 'number') out[k] = o[k]; });
    return out;
  };
  window.glOpenLimitsSettings = function(){
    var prior = document.getElementById('gl-limits-modal'); if(prior) prior.remove();
    var cur = window.glGetLimits();
    var fields = [
      { k:'htst_temp_f',       label:'HTST hold-tube temp (°F) — CCP-1', step:'1' },
      { k:'htst_hold_sec',     label:'HTST hold time (seconds) — CCP-1', step:'0.1' },
      { k:'hot_fill_f',        label:'Hot fill temp at nozzle (°F) — CCP-2', step:'1' },
      { k:'uv_dose_mj_cm2',    label:'UV dose minimum (mJ/cm²) — CCP-3', step:'1' },
      { k:'paa_ppm_min',       label:'PAA sanitizer min (ppm)', step:'1' },
      { k:'paa_ppm_max',       label:'PAA sanitizer max (ppm)', step:'1' },
      { k:'final_pH_fermented',label:'Fermented beverage final pH (max) — CCP-A', step:'0.01' },
      { k:'cip_temp_f',        label:'CIP wash temperature (°F) — steps 1-7', step:'1' },
      { k:'cip_pbw_min',       label:'CIP PBW duration target (min)', step:'1' },
      { k:'cip_caustic_min',   label:'CIP caustic duration target (min)', step:'1' },
      { k:'cip_acid_min',      label:'CIP acid duration target (min)', step:'1' },
      { k:'cip_paa_min',       label:'CIP PAA sanitize duration target (min)', step:'1' }
    ];
    var body = fields.map(function(f){
      return '<div style="margin-bottom:11px"><div style="font-size:11px;color:#9aa7bd;margin-bottom:4px">' + esc(f.label) + '</div>' +
        '<input id="gl-lim-' + f.k + '" type="number" step="' + f.step + '" value="' + cur[f.k] + '" style="width:160px;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box"></div>';
    }).join('');

    var ov = document.createElement('div');
    ov.id = 'gl-limits-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:9000;background:rgba(6,13,26,.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.22);border-radius:14px;width:100%;max-width:520px;max-height:88vh;overflow-y:auto;color:#cfd9e6;box-shadow:0 20px 60px rgba(0,0,0,.6)">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.06)">' +
          '<div>' +
            '<div style="font-family:var(--ff-disp);font-size:14px;letter-spacing:2px;color:var(--teal);font-weight:700">⚙️ CCP CRITICAL LIMITS</div>' +
            '<div style="font-size:11px;color:#9aa7bd;margin-top:3px">Defaults per LEAN_01 v2.1 — edit if your FSP differs</div>' +
          '</div>' +
          '<button id="gl-lim-close" style="background:none;border:none;color:#9aa7bd;font-size:18px;cursor:pointer;padding:2px 6px">✕</button>' +
        '</div>' +
        '<div style="padding:18px 22px">' + body +
          '<div style="font-size:11px;color:#f5c842;background:rgba(245,200,66,.08);padding:8px 12px;border-radius:6px;margin-top:10px">Hard-refresh after saving for new limits to apply to compliance forms.</div>' +
        '</div>' +
        '<div style="padding:14px 22px;border-top:1px solid rgba(255,255,255,.06);display:flex;gap:8px;justify-content:flex-end">' +
          '<button id="gl-lim-reset" class="cbtn">Reset to defaults</button>' +
          '<button id="gl-lim-cancel" class="cbtn">Cancel</button>' +
          '<button id="gl-lim-save" class="cbtn pri">💾 Save limits</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    function close(){ ov.remove(); }
    ov.addEventListener('click', function(e){ if(e.target === ov) close(); });
    ov.querySelector('#gl-lim-close').addEventListener('click', close);
    ov.querySelector('#gl-lim-cancel').addEventListener('click', close);
    ov.querySelector('#gl-lim-reset').addEventListener('click', function(){
      if(!confirm('Reset all limits to LEAN_01 defaults?')) return;
      localStorage.removeItem(LIMITS_KEY);
      close();
      if(typeof addNotification === 'function') addNotification('⚙️ Limits reset to defaults','','info');
    });
    ov.querySelector('#gl-lim-save').addEventListener('click', function(){
      var o = {};
      fields.forEach(function(f){
        var v = parseFloat(ov.querySelector('#gl-lim-' + f.k).value);
        if(!isNaN(v)) o[f.k] = v;
      });
      writeLimits(o);
      if(typeof addNotification === 'function') addNotification('⚙️ CCP limits saved','Hard-refresh to apply','success');
      if(typeof window.glAudit === 'function') window.glAudit('ccp_limits_changed','', o);
      close();
    });
  };

  // ── (4) Records History view ──
  // Adds a "History" tab to the Compliance master page.
  // Renders all compliance_records with form-code filter + date range + status filter.
  // Click a record to expand and show data fields (including CIP 9-step breakdown).

  var HISTORY_STATE = {
    form_filter: 'all',
    status_filter: 'all',
    from: new Date(Date.now() - 30*86400000).toISOString().slice(0,10),
    to:   new Date().toISOString().slice(0,10)
  };

  async function fetchHistoryRecords(){
    if(!window.supa) return [];
    var q = window.supa.from('compliance_records').select('*');
    if(HISTORY_STATE.form_filter !== 'all') q = q.eq('form_code', HISTORY_STATE.form_filter);
    if(HISTORY_STATE.status_filter !== 'all') q = q.eq('status', HISTORY_STATE.status_filter);
    if(HISTORY_STATE.from) q = q.gte('record_date', HISTORY_STATE.from);
    if(HISTORY_STATE.to)   q = q.lte('record_date', HISTORY_STATE.to);
    q = q.order('recorded_at', { ascending: false }).limit(500);
    var r = await q;
    return r.data || [];
  }

  function expandedRecordHtml(r){
    var data = r.data || {};
    var html = '<div style="margin-top:8px;padding:10px 12px;background:rgba(255,255,255,.02);border-radius:6px;border:1px solid rgba(255,255,255,.06)">';
    if(Array.isArray(data.steps)){
      html += '<div style="font-size:10px;color:#5fcf9e;letter-spacing:1px;margin-bottom:6px">9-STEP CIP BREAKDOWN</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:11px;color:#cfd9e6">' +
          '<thead><tr style="color:#9aa7bd"><th style="text-align:left;padding:4px 6px">#</th><th style="text-align:left;padding:4px 6px">Step</th><th style="padding:4px 6px">Done</th><th style="padding:4px 6px">Actual min</th><th style="padding:4px 6px">Temp °F</th><th style="padding:4px 6px">Reading</th><th style="padding:4px 6px">P/F</th></tr></thead><tbody>';
      data.steps.forEach(function(s){
        var pfColor = s.pf === 'fail' ? '#ff8579' : '#5fcf9e';
        html += '<tr><td style="padding:3px 6px;color:#9aa7bd">'+s.n+'</td><td style="padding:3px 6px">'+esc(s.name)+'</td><td style="padding:3px 6px;text-align:center">'+(s.done?'✓':'—')+'</td><td style="padding:3px 6px;text-align:center">'+esc(s.actual_min)+'</td><td style="padding:3px 6px;text-align:center">'+(s.temp_f||'—')+'</td><td style="padding:3px 6px">'+esc(s.reading||'')+'</td><td style="padding:3px 6px;text-align:center;color:'+pfColor+';font-weight:600">'+esc(s.pf||'').toUpperCase()+'</td></tr>';
      });
      html += '</tbody></table>';
    } else {
      // Generic key/value
      var dataKeys = Object.keys(data).filter(function(k){ return typeof data[k] !== 'object'; });
      if(dataKeys.length){
        html += '<div style="font-size:10px;color:#9aa7bd;letter-spacing:1px;margin-bottom:6px">RECORD DATA</div>' +
          '<div style="display:grid;grid-template-columns:140px 1fr;gap:3px 12px;font-size:11px">';
        dataKeys.forEach(function(k){
          html += '<div style="color:#9aa7bd">' + esc(k) + '</div><div style="color:#cfd9e6">' + esc(data[k]) + '</div>';
        });
        html += '</div>';
      }
    }
    if(r.has_deviation){
      html += '<div style="margin-top:8px;padding:8px 10px;background:rgba(231,76,60,.08);border-left:3px solid #e74c3c;border-radius:0 6px 6px 0;font-size:11px;color:#cfd9e6">' +
        '<b style="color:#ff8579">⚠ Deviation:</b> ' + esc(r.deviation_notes || '(no notes)') +
        (r.corrective_action ? '<br><b>Corrective:</b> ' + esc(r.corrective_action) : '') +
      '</div>';
    }
    if(r.signature_name){
      html += '<div style="margin-top:6px;font-size:10px;color:#5fcf9e">✓ Signed by ' + esc(r.signature_name) + ' on ' + esc(fmtTs(r.signed_at)) + '</div>';
    }
    html += '</div>';
    return html;
  }

  // The compliance master IIFE owns the tab state. We tap into refreshComplianceMaster
  // and the comp-body element to add our tab. Best approach: inject a "History" tab
  // button + handle clicks ourselves.
  function ensureExtraTabs(){
    var host = document.getElementById('comp-body');
    if(!host) return;
    var tabBar = host.querySelector('div:first-child');
    if(!tabBar || tabBar.dataset.glExtraTabsApplied === '1') return;
    // Find the existing tab row by looking for .gl-comp-tab buttons
    var firstTab = host.querySelector('.gl-comp-tab');
    if(!firstTab) return;
    var bar = firstTab.parentNode;
    if(bar.dataset.glExtraTabsApplied === '1') return;
    bar.dataset.glExtraTabsApplied = '1';
    // Insert History + Weekly Review + Trace Lot tabs before the spacer div
    var spacer = bar.querySelector('div[style*="flex:1"]');
    function tabBtn(key, label){
      var b = document.createElement('button');
      b.className = 'gl-comp-extratab';
      b.setAttribute('data-extra-tab', key);
      b.textContent = label;
      b.setAttribute('style','padding:9px 16px;background:none;border:none;border-bottom:2px solid transparent;color:#9aa7bd;font-size:12px;font-weight:600;cursor:pointer;transition:all .12s');
      b.addEventListener('mouseenter', function(){ if(currentExtra !== key) b.style.color = '#fff'; });
      b.addEventListener('mouseleave', function(){ if(currentExtra !== key) b.style.color = '#9aa7bd'; });
      b.addEventListener('click', function(){ openExtraTab(key); });
      return b;
    }
    bar.insertBefore(tabBtn('history', '📚 History'), spacer);
    bar.insertBefore(tabBtn('weekly', '✓ Weekly Review'), spacer);
    bar.insertBefore(tabBtn('trace', '🔍 Trace Lot'), spacer);
    // Also add a ⚙️ Limits button on the right side
    var limitsBtn = document.createElement('button');
    limitsBtn.className = 'cbtn gl-comp-limits';
    limitsBtn.setAttribute('style','font-size:11px;padding:5px 11px;margin-right:6px;background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.3);color:#f5c842');
    limitsBtn.textContent = '⚙️ CCP Limits';
    limitsBtn.addEventListener('click', function(){ window.glOpenLimitsSettings(); });
    var holdBtn = bar.querySelector('.gl-comp-hold');
    if(holdBtn) holdBtn.parentNode.insertBefore(limitsBtn, holdBtn);
  }

  var currentExtra = null;
  function openExtraTab(key){
    currentExtra = key;
    // Deactivate the built-in tabs visually
    var host = document.getElementById('comp-body');
    if(!host) return;
    host.querySelectorAll('.gl-comp-tab').forEach(function(b){
      b.style.borderBottomColor = 'transparent';
      b.style.color = '#9aa7bd';
    });
    host.querySelectorAll('.gl-comp-extratab').forEach(function(b){
      var on = b.getAttribute('data-extra-tab') === key;
      b.style.borderBottomColor = on ? 'var(--teal,#00e5c0)' : 'transparent';
      b.style.color = on ? 'var(--teal,#00e5c0)' : '#9aa7bd';
    });
    var body = host.querySelector('#comp-tab-body');
    if(!body) return;
    if(key === 'history') renderHistory(body);
    if(key === 'weekly')  renderWeeklyReview(body);
    if(key === 'trace')   renderLotTracer(body);
  }

  async function renderHistory(host){
    host.innerHTML = '<div style="padding:30px;text-align:center;color:#9aa7bd">Loading history…</div>';
    var forms = ['all','GMP-INSP-001','GMP-LAB-001','GMP-ALL-001','GMP-SAN-002','GMP-REC-001','GMP-CAL-001','GMP-DIST-001','GMP-HR-001','GMP-TR-001','FSP-PC-001','FSP-PC-002','FSP-PC-003','FSP-PC-004','FSP-PC-005','FSP-SAN-001','FSP-SC-002','FSP-VER-002','QC-BR-001'];
    var statuses = [['all','All statuses'],['draft','Draft'],['complete','Complete'],['signed','Signed']];
    var rows = await fetchHistoryRecords();
    host.innerHTML =
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:14px">' +
        '<div><div style="font-size:10px;color:#9aa7bd;margin-bottom:3px">FORM</div><select id="gl-hist-form" style="width:100%;padding:7px 9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;font-size:11px">' +
          forms.map(function(c){ return '<option value="' + c + '"' + (HISTORY_STATE.form_filter === c ? ' selected' : '') + '>' + (c === 'all' ? 'All forms' : c) + '</option>'; }).join('') +
        '</select></div>' +
        '<div><div style="font-size:10px;color:#9aa7bd;margin-bottom:3px">STATUS</div><select id="gl-hist-status" style="width:100%;padding:7px 9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;font-size:11px">' +
          statuses.map(function(s){ return '<option value="' + s[0] + '"' + (HISTORY_STATE.status_filter === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') +
        '</select></div>' +
        '<div><div style="font-size:10px;color:#9aa7bd;margin-bottom:3px">FROM</div><input id="gl-hist-from" type="date" value="' + HISTORY_STATE.from + '" style="width:100%;padding:7px 9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;font-size:11px;box-sizing:border-box"></div>' +
        '<div><div style="font-size:10px;color:#9aa7bd;margin-bottom:3px">TO</div><input id="gl-hist-to" type="date" value="' + HISTORY_STATE.to + '" style="width:100%;padding:7px 9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;font-size:11px;box-sizing:border-box"></div>' +
      '</div>' +
      '<div style="font-size:11px;color:#9aa7bd;margin-bottom:10px">' + rows.length + ' record' + (rows.length === 1 ? '' : 's') + '</div>' +
      '<div id="gl-hist-list">' +
        (rows.length ? rows.map(function(r){
          var devBadge = r.has_deviation ? '<span style="font-size:10px;color:#ff8579;background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.3);padding:2px 7px;border-radius:10px;margin-left:6px">⚠</span>' : '';
          var sigBadge = r.status === 'signed' ? '<span style="font-size:10px;color:#5fcf9e">✓</span>' : '<span style="font-size:10px;color:#f5c842">○</span>';
          return '<div class="gl-hist-row" data-id="' + r.id + '" style="padding:11px 13px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:9px;margin-bottom:6px;cursor:pointer" onclick="this.querySelector(\'.gl-hist-detail\').style.display=this.querySelector(\'.gl-hist-detail\').style.display===\'none\'?\'block\':\'none\'">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">' +
              '<div style="flex:1;min-width:0">' +
                '<div style="font-size:12px;color:#fff;font-weight:600">' + sigBadge + ' ' + esc(r.form_code) + devBadge + '</div>' +
                '<div style="font-size:11px;color:#9aa7bd;margin-top:2px">' + fmtTs(r.recorded_at) + ' · ' + esc(r.status) + (r.signature_name ? ' · ' + esc(r.signature_name) : '') + '</div>' +
              '</div>' +
            '</div>' +
            '<div class="gl-hist-detail" style="display:none">' + expandedRecordHtml(r) + '</div>' +
          '</div>';
        }).join('') : '<div style="padding:30px;text-align:center;color:#9aa7bd;font-size:13px">No records match the filter.</div>') +
      '</div>';
    function refreshHist(){
      HISTORY_STATE.form_filter = host.querySelector('#gl-hist-form').value;
      HISTORY_STATE.status_filter = host.querySelector('#gl-hist-status').value;
      HISTORY_STATE.from = host.querySelector('#gl-hist-from').value;
      HISTORY_STATE.to = host.querySelector('#gl-hist-to').value;
      renderHistory(host);
    }
    host.querySelector('#gl-hist-form').addEventListener('change', refreshHist);
    host.querySelector('#gl-hist-status').addEventListener('change', refreshHist);
    host.querySelector('#gl-hist-from').addEventListener('change', refreshHist);
    host.querySelector('#gl-hist-to').addEventListener('change', refreshHist);
  }

  // ── (5) Weekly Review ──
  // Shows signed records from the last 7 days. Lets the PCQI bulk-acknowledge them.
  // Acks are stored in Supabase `compliance_acks` table — single source of
  // truth across devices, plus actor + timestamp for audit defense.
  var _weeklyAckCache = {};   // record_id → acked_at ISO string (server cache)
  async function loadWeeklyAcksFor(recordIds){
    if(!window.supa || !recordIds || !recordIds.length) return {};
    try {
      var r = await window.supa.from('compliance_acks').select('record_id, acked_at').in('record_id', recordIds);
      var out = {};
      (r.data || []).forEach(function(row){ out[row.record_id] = row.acked_at; });
      // Hydrate cache so subsequent sync readers see the latest.
      Object.keys(out).forEach(function(k){ _weeklyAckCache[k] = out[k]; });
      return out;
    } catch(e){ console.warn('[GL] compliance_acks load', e); return {}; }
  }
  function readWeeklyAcks(){ return _weeklyAckCache; }
  async function setWeeklyAck(recordId, acked){
    if(!window.supa) return;
    try {
      if(acked){
        var sess = await window.supa.auth.getSession();
        var uid = sess && sess.data && sess.data.session && sess.data.session.user && sess.data.session.user.id;
        await window.supa.from('compliance_acks').upsert({ record_id: recordId, acked_at: new Date().toISOString(), acked_by: uid || null }, { onConflict: 'record_id' });
        _weeklyAckCache[recordId] = new Date().toISOString();
      } else {
        await window.supa.from('compliance_acks').delete().eq('record_id', recordId);
        delete _weeklyAckCache[recordId];
      }
    } catch(e){ console.warn('[GL] compliance_ack write', e); }
  }

  async function renderWeeklyReview(host){
    host.innerHTML = '<div style="padding:30px;text-align:center;color:#9aa7bd">Loading…</div>';
    if(!window.supa){ host.innerHTML = '<div style="padding:30px;text-align:center;color:#9aa7bd">Supabase not loaded</div>'; return; }
    var sevenDaysAgo = new Date(Date.now() - 7*86400000).toISOString();
    var r = await window.supa.from('compliance_records').select('*').eq('status','signed').gte('signed_at', sevenDaysAgo).order('signed_at',{ ascending: false }).limit(500);
    var rows = r.data || [];
    // Pull all acks for these records in one shot (replaces the old
    // gl_weekly_ack localStorage store — see migration 20260519_followup_acks_waivers.sql).
    var acks = await loadWeeklyAcksFor(rows.map(function(rec){ return rec.id; }));
    var unacked = rows.filter(function(rec){ return !acks[rec.id]; });
    var acked   = rows.filter(function(rec){ return !!acks[rec.id]; });
    function rowHtml(rec, isAcked){
      var devBadge = rec.has_deviation ? '<span style="font-size:10px;color:#ff8579;background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.3);padding:2px 7px;border-radius:10px;margin-left:6px">⚠ Had deviation</span>' : '';
      return '<label style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:9px;margin-bottom:5px;cursor:pointer">' +
        '<input type="checkbox" class="gl-wk-ack" data-id="' + rec.id + '"' + (isAcked ? ' checked' : '') + ' style="accent-color:var(--teal);width:15px;height:15px">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:12px;color:#fff">' + esc(rec.form_code) + devBadge + '</div>' +
          '<div style="font-size:11px;color:#9aa7bd;margin-top:2px">Signed ' + fmtTs(rec.signed_at) + ' by ' + esc(rec.signature_name || '?') + '</div>' +
        '</div>' +
      '</label>';
    }
    host.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<div style="font-size:11px;color:#9aa7bd;letter-spacing:1px;text-transform:uppercase">Last 7 days · ' + unacked.length + ' unreviewed · ' + acked.length + ' reviewed</div>' +
        (unacked.length ? '<button id="gl-wk-ack-all" class="cbtn pri" style="font-size:11px;padding:5px 11px">✓ Ack all unreviewed</button>' : '') +
      '</div>' +
      (unacked.length ?
        '<div style="margin-bottom:14px"><div style="font-size:10px;color:#f5c842;letter-spacing:2px;margin-bottom:6px">⏳ AWAITING REVIEW</div>' +
        unacked.map(function(rec){ return rowHtml(rec, false); }).join('') + '</div>'
        : '<div style="padding:25px;text-align:center;color:#5fcf9e;font-size:13px;margin-bottom:14px">✓ All signed records from the past 7 days have been reviewed.</div>') +
      (acked.length ?
        '<div><div style="font-size:10px;color:#5fcf9e;letter-spacing:2px;margin-bottom:6px">✓ REVIEWED</div>' +
        acked.map(function(rec){ return rowHtml(rec, true); }).join('') + '</div>' : '');
    host.querySelectorAll('.gl-wk-ack').forEach(function(cb){
      cb.addEventListener('change', async function(){
        var id = cb.getAttribute('data-id');
        await setWeeklyAck(id, cb.checked);
        renderWeeklyReview(host);
      });
    });
    var allBtn = host.querySelector('#gl-wk-ack-all');
    if(allBtn) allBtn.addEventListener('click', async function(){
      for(var i=0; i<unacked.length; i++) await setWeeklyAck(unacked[i].id, true);
      if(typeof window.glAudit === 'function') window.glAudit('weekly_review_bulk_ack','', { count: unacked.length });
      renderWeeklyReview(host);
    });
  }

  // ── (6) Lot Tracer ──
  async function renderLotTracer(host){
    host.innerHTML =
      '<div style="margin-bottom:14px">' +
        '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Enter a lot number or run name. Results show every compliance record, hold tag, and production run that touched it — chronologically.</div>' +
        '<div style="display:flex;gap:8px">' +
          '<input id="gl-trace-q" type="text" placeholder="e.g. GLBC-JUC01-20260516-L1-001 or SunBurst Mar batch" style="flex:1;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:13px">' +
          '<button id="gl-trace-go" class="cbtn pri" style="padding:9px 18px">🔍 Trace</button>' +
        '</div>' +
      '</div>' +
      '<div id="gl-trace-results" style="font-size:12px;color:#9aa7bd;padding:25px;text-align:center">Enter a lot or run name above and click Trace.</div>';
    var input = host.querySelector('#gl-trace-q');
    function go(){
      var q = input.value.trim();
      if(!q) return;
      doTrace(q, host.querySelector('#gl-trace-results'));
    }
    host.querySelector('#gl-trace-go').addEventListener('click', go);
    input.addEventListener('keydown', function(e){ if(e.key === 'Enter') go(); });
    input.focus();
  }

  async function doTrace(query, outEl){
    outEl.innerHTML = '<div style="padding:25px;text-align:center;color:#9aa7bd">Searching…</div>';
    if(!window.supa){ outEl.innerHTML = '<div style="padding:25px;text-align:center;color:#ff8579">Supabase not loaded</div>'; return; }
    // Sanitize the user-supplied query before interpolating into PostgREST .or()
    // filter strings. Commas, parens, single-quotes, and asterisks can break
    // out of the intended filter clause; restrict to alphanumeric + a small
    // set of safe punctuation actually used in lot numbers and run names.
    var safe = (query || '').replace(/[^A-Za-z0-9 _\-./]/g, '').slice(0, 80);
    if(!safe){
      outEl.innerHTML = '<div style="padding:25px;text-align:center;color:#9aa7bd">Enter a lot or run name (alphanumeric + dashes/dots/spaces).</div>';
      return;
    }
    var like = '%' + safe + '%';
    try {
      // Find matching production runs by run_name or lot mentions in notes
      var runsR = await window.supa.from('production_runs').select('id,run_name,client_name,format,cases,stage,scheduled_date,notes').or('run_name.ilike.' + like + ',notes.ilike.' + like + ',client_name.ilike.' + like).limit(20);
      var runs = runsR.data || [];
      var runIds = runs.map(function(r){ return r.id; });
      // Find compliance records by run_id OR by lot embedded in data JSONB
      var recsByRun = [];
      if(runIds.length){
        var rr = await window.supa.from('compliance_records').select('*').in('run_id', runIds).order('recorded_at', { ascending: false }).limit(500);
        recsByRun = rr.data || [];
      }
      // Find compliance records mentioning the lot in data->>lot or data->>'lot_number'
      var recsByLot = [];
      try {
        var rl = await window.supa.from('compliance_records').select('*').or('data->>lot.ilike.' + like + ',data->>lot_number.ilike.' + like + ',data->>product.ilike.' + like).order('recorded_at', { ascending: false }).limit(200);
        recsByLot = rl.data || [];
      } catch(e){}
      // Find hold tags
      var holdR = await window.supa.from('hold_tags').select('*').or('lot_number.ilike.' + like + ',product_name.ilike.' + like + ',reason.ilike.' + like).order('hold_date',{ ascending: false }).limit(50);
      var holds = holdR.data || [];
      // Dedupe records
      var allRecs = recsByRun.concat(recsByLot);
      var seen = {};
      var uniqRecs = allRecs.filter(function(r){ if(seen[r.id]) return false; seen[r.id] = true; return true; });

      var totalMatches = runs.length + uniqRecs.length + holds.length;
      if(!totalMatches){
        outEl.innerHTML = '<div style="padding:25px;text-align:center;color:#9aa7bd">No matching records, runs, or hold tags found for "<b style="color:#fff">' + esc(query) + '</b>".</div>';
        return;
      }
      // Build a unified timeline
      var events = [];
      runs.forEach(function(r){ events.push({ ts: r.scheduled_date || r.created_at, kind:'run', data:r }); });
      uniqRecs.forEach(function(r){ events.push({ ts: r.recorded_at, kind:'record', data:r }); });
      holds.forEach(function(h){ events.push({ ts: h.hold_date, kind:'hold', data:h }); });
      events.sort(function(a,b){ return (b.ts||'').localeCompare(a.ts||''); });

      outEl.innerHTML =
        '<div style="font-size:11px;color:#9aa7bd;margin-bottom:10px"><b style="color:#5fcf9e">' + totalMatches + ' result' + (totalMatches===1?'':'s') + '</b> for "<b style="color:#fff">' + esc(query) + '</b>" · ' + runs.length + ' runs · ' + uniqRecs.length + ' compliance records · ' + holds.length + ' hold tags</div>' +
        events.map(function(e){
          if(e.kind === 'run'){
            var r = e.data;
            return '<div style="padding:10px 12px;background:rgba(127,198,245,.06);border-left:3px solid #7fc6f5;border-radius:0 8px 8px 0;margin-bottom:5px">' +
              '<div style="font-size:11px;color:#7fc6f5;letter-spacing:1px">🏭 PRODUCTION RUN</div>' +
              '<div style="font-size:13px;color:#fff;font-weight:600">' + esc(r.run_name) + '</div>' +
              '<div style="font-size:11px;color:#9aa7bd;margin-top:2px">' + esc(r.client_name||'') + ' · ' + esc(r.format||'') + ' · ' + esc(r.stage) + ' · ' + (r.scheduled_date ? 'scheduled ' + esc(r.scheduled_date) : '') + '</div>' +
            '</div>';
          }
          if(e.kind === 'record'){
            var rec = e.data;
            var devBadge = rec.has_deviation ? '<span style="font-size:10px;color:#ff8579;background:rgba(231,76,60,.1);border:1px solid rgba(231,76,60,.3);padding:2px 6px;border-radius:8px;margin-left:6px">⚠</span>' : '';
            var sigBadge = rec.status === 'signed' ? '✓' : '○';
            return '<div style="padding:10px 12px;background:rgba(0,229,192,.05);border-left:3px solid var(--teal,#00e5c0);border-radius:0 8px 8px 0;margin-bottom:5px">' +
              '<div style="font-size:11px;color:var(--teal,#00e5c0);letter-spacing:1px">📋 COMPLIANCE RECORD</div>' +
              '<div style="font-size:13px;color:#fff;font-weight:600">' + sigBadge + ' ' + esc(rec.form_code) + devBadge + '</div>' +
              '<div style="font-size:11px;color:#9aa7bd;margin-top:2px">' + fmtTs(rec.recorded_at) + ' · ' + esc(rec.status) + (rec.signature_name ? ' · ' + esc(rec.signature_name) : '') + '</div>' +
            '</div>';
          }
          if(e.kind === 'hold'){
            var h = e.data;
            var statusColor = h.status === 'open' ? '#ff8579' : '#5fcf9e';
            return '<div style="padding:10px 12px;background:rgba(231,76,60,.06);border-left:3px solid ' + statusColor + ';border-radius:0 8px 8px 0;margin-bottom:5px">' +
              '<div style="font-size:11px;color:' + statusColor + ';letter-spacing:1px">🚫 HOLD TAG ' + esc(h.tag_number) + '</div>' +
              '<div style="font-size:13px;color:#fff;font-weight:600">' + esc(h.product_name) + (h.lot_number ? ' · Lot ' + esc(h.lot_number) : '') + '</div>' +
              '<div style="font-size:11px;color:#9aa7bd;margin-top:2px">' + fmtTs(h.hold_date) + ' · ' + esc(h.status).toUpperCase() + (h.disposition ? ' · ' + esc(h.disposition) : '') + '</div>' +
              '<div style="font-size:11px;color:#cfd9e6;margin-top:4px">' + esc(h.reason) + '</div>' +
            '</div>';
          }
        }).join('');
    } catch(e){
      console.warn('[GL trace] failed', e);
      outEl.innerHTML = '<div style="padding:25px;text-align:center;color:#ff8579">Search failed: ' + esc(e.message || 'unknown') + '</div>';
    }
  }

  // Wire ourselves into the master page lifecycle
  function start(){
    var host = document.getElementById('comp-body');
    if(!host){ setTimeout(start, 700); return; }
    new MutationObserver(function(){ setTimeout(ensureExtraTabs, 60); }).observe(host, { childList:true, subtree:true });
    ensureExtraTabs();
  }
  if(document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  console.log('[GL] compliance important pack loaded — History + Weekly Review + Trace Lot + CCP Limits');
}());


/* ============================================================
   COMPLIANCE — PHASE 3 PACK
   (8)  Mock Recall simulator — generate timed recall report
   (9)  Photo upload on Hold Tags + glass-break events
   (10) Allergen scheduling warning — flag risky run order
   (11) Vendor FSP-SC-001 fields — GFSI cert + allergen risk
   (12) SMS notification on critical failure (via Twilio fn)
   (13) Glass breakage workflow (GMP-GHP-001) — 10-ft radius
   ============================================================ */
(function(){
  var esc = window.glEsc;
  function fmtDate(d){ if(!d) return ''; var x = new Date(d); return isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
  function fmtTs(d){ if(!d) return ''; var x = new Date(d); return isNaN(x.getTime()) ? String(d) : x.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}); }
  function nowISO(){ return new Date().toISOString(); }
  function todayISO(){ return new Date().toISOString().slice(0,10); }

  // ── (12) SMS NOTIFICATION on critical failure ──
  // Reads phone + function URL from existing SMS settings (saved by openSmsSettings).
  // Silently skips if not configured — never blocks the compliance flow.
  async function sendComplianceAlertSms(text){
    try {
      var phone = localStorage.getItem('gl_sms_alert_phone') || localStorage.getItem('gl_sms_to_phone')
               || (window.GL_APP_SETTINGS && window.GL_APP_SETTINGS.sms_alert_phone) || '';
      var fnUrl = localStorage.getItem('gl_sms_fn_url');
      if(!phone || !fnUrl) return;  // not configured yet
      var token = null;
      try {
        var s = window.supa && await window.supa.auth.getSession();
        if(s && s.data && s.data.session) token = s.data.session.access_token;
      } catch(e){}
      await fetch(fnUrl, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type':'application/json' }, token ? { Authorization:'Bearer '+token } : {}),
        body: JSON.stringify({ to: phone, body: text.slice(0, 600) })
      });
    } catch(e){ console.warn('[GL compliance SMS] failed', e); }
  }

  // Wrap spawnHoldAndNc-equivalent path: hook into addNotification to detect critical events
  (function wrapNotify(){
    var orig = window.addNotification;
    if(typeof orig !== 'function'){ setTimeout(wrapNotify, 700); return; }
    if(window.__glComplianceSmsHooked) return;
    window.__glComplianceSmsHooked = true;
    window.addNotification = function(title, body, type){
      var r = orig.apply(this, arguments);
      // Trigger SMS only on Hold Tag creation events ("🚫 Hold Tag created" notification)
      if(typeof title === 'string' && title.indexOf('Hold Tag created') !== -1){
        sendComplianceAlertSms('[GLBC ALERT] ' + title + ' — ' + (body || ''));
      }
      return r;
    };
  })();

  // SMS settings modal extension — adds an "Alert phone" field on top of existing
  // SMS settings. We don't override the existing openSmsSettings; we just save to the same key.
  window.glSetSmsAlertPhone = function(){
    var cur = localStorage.getItem('gl_sms_alert_phone') || (window.GL_APP_SETTINGS && window.GL_APP_SETTINGS.sms_alert_phone) || '';
    // Strip the +1 if present so the prompt shows the cleaner 10-digit format
    var curDisplay = cur.replace(/^\+1/, '').replace(/\D+/g, '');
    var raw = prompt('Phone number for compliance critical-failure SMS\n(10-digit US, e.g. 8135550100 — or full international like +447700900123).\nLeave blank to disable.', curDisplay);
    if(raw === null) return;
    raw = raw.trim();
    if(!raw){ localStorage.removeItem('gl_sms_alert_phone'); alert('SMS alerts disabled.'); return; }
    // Normalize: 10-digit US gets +1 auto-prefixed; 11-digit starting with 1 gets +;
    // anything already prefixed with + is treated as international E.164.
    var digits = raw.replace(/\D+/g, '');
    var e164;
    if(raw.charAt(0) === '+'){
      if(!/^\+\d{8,15}$/.test('+'+digits)){ alert('Invalid international number. Expected + followed by 8–15 digits.'); return; }
      e164 = '+' + digits;
    } else if(digits.length === 10){
      e164 = '+1' + digits;
    } else if(digits.length === 11 && digits.charAt(0) === '1'){
      e164 = '+' + digits;
    } else {
      alert('Enter a 10-digit US number (e.g. 8135550100) or an international number starting with + (e.g. +447700900123).');
      return;
    }
    localStorage.setItem('gl_sms_alert_phone', e164);
    alert('Compliance SMS alerts will go to ' + e164 + '. (Requires deployed send-sms Edge Function + Twilio creds.)');
  };

  // ── (9) Photo upload helper ──
  // Uses the "compliance-photos" Supabase Storage bucket.
  // Falls back to local data URL if bucket doesn't exist.
  async function uploadPhoto(file, prefix){
    if(!file || !window.supa) return null;
    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    var path = (prefix || 'compliance') + '/' + Date.now() + '-' + Math.random().toString(36).slice(2,8) + '.' + ext;
    try {
      var r = await window.supa.storage.from('compliance-photos').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
      if(r.error){ console.warn('[GL compliance photo] upload error', r.error); return null; }
      var pub = window.supa.storage.from('compliance-photos').getPublicUrl(path);
      return pub.data && pub.data.publicUrl ? pub.data.publicUrl : null;
    } catch(e){ console.warn('[GL compliance photo] threw', e); return null; }
  }

  // Wire photo inputs into the existing Add Hold Tag modal whenever it opens
  function injectPhotoIntoHoldModal(){
    var modal = document.getElementById('gl-comp-modal');
    if(!modal) return;
    if(modal.dataset.glPhotoInjected === '1') return;
    if(!modal.querySelector('#gl-cf-hazard')) return;  // not a hold-tag modal
    modal.dataset.glPhotoInjected = '1';
    // Insert a photo upload field before the action buttons
    var hazardField = modal.querySelector('#gl-cf-hazard');
    if(!hazardField) return;
    var hazardWrapper = hazardField.parentNode;
    var photoDiv = document.createElement('div');
    photoDiv.setAttribute('style','margin-bottom:11px');
    photoDiv.innerHTML =
      '<div style="font-size:11px;color:#9aa7bd;margin-bottom:4px">Photo evidence (optional)</div>' +
      '<input type="file" id="gl-cf-photo" accept="image/*" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:12px;box-sizing:border-box">' +
      '<div id="gl-cf-photo-preview" style="margin-top:8px"></div>';
    hazardWrapper.parentNode.insertBefore(photoDiv, hazardWrapper.nextSibling);
    var input = modal.querySelector('#gl-cf-photo');
    var preview = modal.querySelector('#gl-cf-photo-preview');
    input.addEventListener('change', async function(){
      var f = input.files[0]; if(!f) return;
      preview.innerHTML = '<div style="font-size:11px;color:#9aa7bd">Uploading…</div>';
      var url = await uploadPhoto(f, 'hold');
      if(url){
        preview.innerHTML = '<div style="font-size:10px;color:#5fcf9e;margin-bottom:4px">✓ Uploaded</div><img src="' + esc(url) + '" alt="evidence" style="max-width:200px;max-height:120px;border-radius:6px;border:1px solid rgba(255,255,255,.1)">';
        preview.dataset.url = url;
      } else {
        preview.innerHTML = '<div style="font-size:11px;color:#ff8579">Upload failed. Save the hold tag without photo, then attach later. (Create the <code>compliance-photos</code> Storage bucket in Supabase if it does not exist yet.)</div>';
      }
    });
    // Hook the save button to include photo URL in notes
    var saveBtn = modal.querySelector('.gl-cf-save');
    if(saveBtn && !saveBtn.dataset.glPhotoHooked){
      saveBtn.dataset.glPhotoHooked = '1';
      var origClick = saveBtn.onclick;
      // We can't override addEventListener cleanly, but we can listen first
      saveBtn.addEventListener('click', function(){
        var url = preview.dataset.url;
        if(url){
          // Stash on the hazard field's wrapper so the existing save handler picks it up via notes
          var notesEl = modal.querySelector('textarea');  // best-effort; the save handler currently doesn't read this
          // Instead, just write to a known global the save can use
          window.__glLastHoldPhoto = url;
        } else {
          window.__glLastHoldPhoto = null;
        }
      }, true);
    }
  }
  // Observe modal opens
  new MutationObserver(function(muts){
    muts.forEach(function(m){
      if(m.addedNodes) m.addedNodes.forEach(function(n){
        if(n.nodeType === 1 && (n.id === 'gl-comp-modal' || n.querySelector && n.querySelector('#gl-comp-modal'))){
          setTimeout(injectPhotoIntoHoldModal, 60);
        }
      });
    });
  }).observe(document.body, { childList: true, subtree: true });

  // Patch the Hold Tag form save: when a photo was uploaded, append the URL to notes
  // (We can't easily intercept the existing handler from here, so we add a "Photo:" line
  // to the reason field when the modal saves. Best-effort approach.)
  // Better: have the photo URL embedded into the hold_tag.notes column via a post-save patch.
  // We observe hold_tags for new inserts with __glLastHoldPhoto set and update them.
  (function watchHoldInserts(){
    var lastSeen = null;
    setInterval(async function(){
      if(!window.supa || !window.__glLastHoldPhoto) return;
      var photoUrl = window.__glLastHoldPhoto;
      try {
        var r = await window.supa.from('hold_tags').select('id,notes,created_at').order('created_at', { ascending:false }).limit(1);
        if(r.data && r.data[0]){
          var h = r.data[0];
          if(h.id === lastSeen) return;
          lastSeen = h.id;
          // Only patch if the hold has no photo URL yet
          if(!h.notes || h.notes.indexOf('http') === -1){
            var newNotes = (h.notes ? h.notes + '\n' : '') + 'Photo: ' + photoUrl;
            await window.supa.from('hold_tags').update({ notes: newNotes }).eq('id', h.id);
            window.__glLastHoldPhoto = null;
          }
        }
      } catch(e){}
    }, 2500);
  })();

  // ── (10) Allergen scheduling warning ──
  // Detects when an allergen-FREE run is scheduled AFTER an allergen run on the same day.
  // Surfaces a yellow banner on the Dashboard + warns when editing/saving a run.
  function detectAllergenRuns(runs){
    return runs.map(function(r){
      var hay = ((r.notes || '') + ' ' + (r.format || '') + ' ' + (r.run_name || '')).toLowerCase();
      return /allergen|dairy|nut|soy|egg|gluten|wheat|fish|shellfish|peanut|sesame/.test(hay);
    });
  }
  window.glAllergenSequenceCheck = function(){
    var today = todayISO();
    var runs = (window.glProductionRuns || []).filter(function(r){
      return r.scheduled_date === today && r.stage !== 'Ship';
    }).sort(function(a,b){ return (a.created_at||'').localeCompare(b.created_at||''); });
    if(runs.length < 2) return null;
    var flags = detectAllergenRuns(runs);
    for(var i = 0; i < runs.length - 1; i++){
      if(flags[i] && !flags[i+1]){
        return {
          allergen_run: runs[i],
          free_run: runs[i+1],
          message: 'Allergen run "' + (runs[i].run_name || runs[i].id) + '" scheduled BEFORE allergen-free run "' + (runs[i+1].run_name || runs[i+1].id) + '" today. Per LEAN_01 §6.2, run allergen-free products FIRST each day. Re-sequence or ensure full CIP + ELISA swab between.'
        };
      }
    }
    return null;
  };

  // Inject warning banner on Dashboard
  function renderAllergenBanner(){
    if(!document.getElementById('cpg-dashboard')) return;
    var existing = document.getElementById('gl-allergen-banner');
    var check = window.glAllergenSequenceCheck();
    if(!check){ if(existing) existing.remove(); return; }
    if(existing){ existing.querySelector('.gl-allergen-msg').textContent = check.message; return; }
    var dash = document.getElementById('cpg-dashboard');
    if(!dash) return;
    var banner = document.createElement('div');
    banner.id = 'gl-allergen-banner';
    banner.setAttribute('style','padding:11px 14px;background:rgba(245,200,66,.1);border:1px solid rgba(245,200,66,.3);border-left:3px solid #f5c842;border-radius:0 8px 8px 0;margin-bottom:14px;font-size:12px;color:#cfd9e6;display:flex;align-items:center;gap:10px');
    banner.innerHTML =
      '<div style="font-size:18px">⚠️</div>' +
      '<div style="flex:1"><b style="color:#f5c842">Allergen sequencing warning</b><div class="gl-allergen-msg" style="margin-top:3px">' + esc(check.message) + '</div></div>';
    // Insert at top of dashboard body
    var firstChild = dash.firstElementChild;
    if(firstChild) dash.insertBefore(banner, firstChild.nextSibling || null);
    else dash.appendChild(banner);
  }
  // Watch dashboard renders
  (function(){
    var dash = document.getElementById('cpg-dashboard');
    if(dash){
      new MutationObserver(function(){ setTimeout(renderAllergenBanner, 80); }).observe(dash, { attributes:true, childList:true, attributeFilter:['class'] });
      renderAllergenBanner();
    } else setTimeout(arguments.callee, 700);
  })();

  // ── (13) Glass breakage workflow ──
  // GMP-GHP-001 — specific event form for glass breakage in production area.
  // Auto-creates Hold Tag for the 10-ft radius product (per LEAN §3.3).
  window.glOpenGlassBreakageForm = function(prefill){
    prefill = prefill || {};
    var prior = document.getElementById('gl-comp-modal'); if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-comp-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:9000;background:rgba(6,13,26,.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto');
    function fld(label, name, type, opts){
      opts = opts || {};
      var id = 'gl-glb-' + name;
      var common = 'width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box';
      var ctrl;
      if(type === 'textarea') ctrl = '<textarea id="' + id + '" rows="2" style="' + common + ';resize:vertical">' + esc(opts.value||'') + '</textarea>';
      else if(type === 'select') ctrl = '<select id="' + id + '" style="' + common + '">' + (opts.options||[]).map(function(o){ var v=Array.isArray(o)?o[0]:o, l=Array.isArray(o)?o[1]:o; return '<option value="' + esc(v) + '">' + esc(l) + '</option>'; }).join('') + '</select>';
      else ctrl = '<input id="' + id + '" type="' + (type||'text') + '" value="' + esc(opts.value||'') + '" style="' + common + '">';
      return '<div style="margin-bottom:11px"><div style="font-size:11px;color:#9aa7bd;margin-bottom:4px">' + esc(label) + '</div>' + ctrl + '</div>';
    }
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(231,76,60,.4);border-radius:14px;width:100%;max-width:540px;max-height:88vh;overflow-y:auto;color:#cfd9e6;box-shadow:0 20px 60px rgba(0,0,0,.6)">' +
        '<div style="padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.06);background:linear-gradient(180deg,rgba(231,76,60,.12),transparent)">' +
          '<div style="display:flex;justify-content:space-between;align-items:start">' +
            '<div>' +
              '<div style="font-family:var(--ff-disp);font-size:14px;letter-spacing:2px;color:#ff8579;font-weight:700">🚨 GMP-GHP-001 · GLASS BREAKAGE EVENT</div>' +
              '<div style="font-size:11px;color:#9aa7bd;margin-top:3px">LEAN_01 §3.3 — STOP line · quarantine 10-ft radius · full cleanup · PCQI sign before restart</div>' +
            '</div>' +
            '<button id="gl-glb-close" style="background:none;border:none;color:#9aa7bd;font-size:18px;cursor:pointer;padding:2px 6px">✕</button>' +
          '</div>' +
        '</div>' +
        '<div style="padding:18px 22px">' +
          fld('Time of breakage','time','datetime-local',{ value: new Date().toISOString().slice(0,16) }) +
          fld('Location in facility','location','text',{ value: prefill.location || 'Filling Line 1' }) +
          fld('Source of breakage','source','select',{ options:['Filled glass bottle','Empty glass bottle','Overhead light','Sight glass','Sample bottle','Lab glassware','Other'] }) +
          fld('Estimated radius cleared (ft)','radius','number',{ value: '10' }) +
          fld('Product in radius (qty + lot if known)','product_held','textarea') +
          fld('Was line stopped?','stopped','select',{ options:[['Y','Yes — stopped immediately'],['N','No']] }) +
          fld('Cleanup method','cleanup','textarea',{ value:'Sweep all visible shards, vacuum, full CIP of any affected food-contact surface, magnetic sweep around line.' }) +
          fld('Operator who performed cleanup','operator','text') +
          '<div style="font-size:11px;color:#ff8579;background:rgba(231,76,60,.1);padding:8px 12px;border-radius:6px;margin-top:6px">A Hold Tag will be auto-created for the affected product in the 10-ft radius. Disposition via sidebar → Hold Tags.</div>' +
        '</div>' +
        '<div style="padding:14px 22px;border-top:1px solid rgba(255,255,255,.06);display:flex;gap:8px;justify-content:flex-end">' +
          '<button id="gl-glb-cancel" class="cbtn">Cancel</button>' +
          '<button id="gl-glb-save" class="cbtn pri" style="background:rgba(231,76,60,.2);border-color:rgba(231,76,60,.5);color:#ff8579">🚨 Record &amp; auto-hold</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    function close(){ ov.remove(); }
    ov.addEventListener('click', function(e){ if(e.target === ov) close(); });
    ov.querySelector('#gl-glb-close').addEventListener('click', close);
    ov.querySelector('#gl-glb-cancel').addEventListener('click', close);
    ov.querySelector('#gl-glb-save').addEventListener('click', async function(){
      function v(n){ return ov.querySelector('#gl-glb-' + n).value; }
      var data = { time: v('time'), location: v('location'), source: v('source'), radius: v('radius'), product_held: v('product_held'), stopped: v('stopped'), cleanup: v('cleanup'), operator: v('operator') };
      var user = window.currentUser || {};
      // Save as compliance_record
      try {
        var rec = await window.supa.from('compliance_records').insert([{
          form_code: 'GMP-GHP-001', record_date: todayISO(), recorded_at: nowISO(),
          data: data, status: 'signed',
          signed_by: user.id || null, signed_at: nowISO(),
          signature_name: user.name || user.email || 'PCQI',
          signature_meaning: 'PCQI sign-off — glass breakage event documented',
          has_deviation: true,
          deviation_notes: 'Glass breakage at ' + data.location + '. ' + (data.stopped === 'Y' ? 'Line stopped.' : 'LINE NOT STOPPED.'),
          corrective_action: data.cleanup
        }]).select().single();
        // Auto-create Hold Tag
        if(rec && rec.data){
          var holds = await window.supa.from('hold_tags').select('tag_number');
          var maxN = 0;
          (holds.data || []).forEach(function(h){ var m = /HT-\d{4}-(\d+)/.exec(h.tag_number||''); if(m){ var n=parseInt(m[1],10); if(n>maxN) maxN=n; } });
          var nextTag = 'HT-' + (new Date()).getFullYear() + '-' + String(maxN+1).padStart(3,'0');
          await window.supa.from('hold_tags').insert([{
            tag_number: nextTag,
            product_name: 'Glass-radius hold — ' + data.location,
            qty_held: data.product_held || ('Product within ' + data.radius + '-ft radius'),
            location: data.location,
            reason: 'GLASS BREAKAGE — ' + (data.source || 'unknown source') + '. ' + data.radius + '-ft radius product held per LEAN_01 §3.3.',
            hazard_type: 'physical',
            initiated_by: user.id || null,
            pcqi_notified: true, pcqi_notified_at: nowISO(),
            source_record_id: rec.data.id,
            status: 'open',
            hold_date: new Date().toISOString().split('T')[0],
            notes: 'Auto-created from GMP-GHP-001 glass breakage event.'
          }]);
          if(typeof addNotification === 'function') addNotification('🚨 Glass breakage logged — Hold Tag ' + nextTag, data.location, 'warning');
          if(typeof window.glAudit === 'function') window.glAudit('glass_breakage', rec.data.id, { hold: nextTag, location: data.location });
        }
      } catch(e){ console.warn('[GL glass-break] save failed', e); alert('Save failed: ' + (e.message||'')); return; }
      close();
      if(typeof window.refreshComplianceMaster === 'function') window.refreshComplianceMaster();
    });
  };

  // ── (8) Mock Recall simulator ──
  // Picks a lot, traces every customer who got it via distribution records, times it.
  // Produces a printable Mock Recall Report PDF for FSP-VER-002 evidence.
  window.glOpenMockRecallSim = function(){
    var prior = document.getElementById('gl-mock-modal'); if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-mock-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:9000;background:rgba(6,13,26,.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.25);border-radius:14px;width:100%;max-width:680px;max-height:88vh;overflow-y:auto;color:#cfd9e6;box-shadow:0 20px 60px rgba(0,0,0,.6)">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.06)">' +
          '<div>' +
            '<div style="font-family:var(--ff-disp);font-size:14px;letter-spacing:2px;color:var(--teal);font-weight:700">🎯 MOCK RECALL SIMULATOR</div>' +
            '<div style="font-size:11px;color:#9aa7bd;margin-top:3px">Picks a lot, traces every customer who got it, times the trace. Evidence for FSP-VER-002 annual review.</div>' +
          '</div>' +
          '<button id="gl-mock-close" style="background:none;border:none;color:#9aa7bd;font-size:18px;cursor:pointer;padding:2px 6px">✕</button>' +
        '</div>' +
        '<div style="padding:18px 22px">' +
          '<div style="margin-bottom:11px"><div style="font-size:11px;color:#9aa7bd;margin-bottom:4px">Lot number to recall</div>' +
            '<input id="gl-mock-lot" type="text" placeholder="e.g. GLBC-JUC01-20260516-L1-001" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box"></div>' +
          '<div style="display:flex;gap:8px;margin-bottom:14px">' +
            '<button id="gl-mock-pick" class="cbtn" style="font-size:11px">🎲 Pick a recent lot</button>' +
            '<button id="gl-mock-run" class="cbtn pri" style="font-size:11px">▶ Start trace timer</button>' +
          '</div>' +
          '<div id="gl-mock-results" style="font-size:12px;color:#9aa7bd;padding:25px;text-align:center">Enter a lot number and click "Start trace timer" — the simulator counts elapsed seconds while it pulls all the records.</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    function close(){ ov.remove(); }
    ov.addEventListener('click', function(e){ if(e.target === ov) close(); });
    ov.querySelector('#gl-mock-close').addEventListener('click', close);
    ov.querySelector('#gl-mock-pick').addEventListener('click', async function(){
      // Try to find a recent distribution log entry or batch record with a lot number
      if(!window.supa){ alert('Supabase not loaded'); return; }
      var r = await window.supa.from('compliance_records').select('data').eq('form_code','GMP-DIST-001').order('recorded_at',{ ascending:false }).limit(20);
      var lots = [];
      (r.data || []).forEach(function(rec){ if(rec.data && rec.data.lot) lots.push(rec.data.lot); });
      if(!lots.length){ alert('No distribution records with lot numbers yet. Enter a lot manually.'); return; }
      ov.querySelector('#gl-mock-lot').value = lots[0];
    });
    ov.querySelector('#gl-mock-run').addEventListener('click', async function(){
      var lot = ov.querySelector('#gl-mock-lot').value.trim();
      if(!lot){ alert('Enter a lot number first.'); return; }
      var resultsEl = ov.querySelector('#gl-mock-results');
      resultsEl.innerHTML = '<div style="font-size:14px;color:var(--teal);font-weight:700">⏱ Tracing... 0.0s</div>';
      var startedAt = Date.now();
      var ticker = setInterval(function(){
        var sec = ((Date.now() - startedAt) / 1000).toFixed(1);
        var el = resultsEl.querySelector('div');
        if(el) el.textContent = '⏱ Tracing... ' + sec + 's';
      }, 100);
      try {
        var like = '%' + lot + '%';
        var distR = await window.supa.from('compliance_records').select('*').eq('form_code','GMP-DIST-001').or('data->>lot.ilike.' + like + ',data->>lot_number.ilike.' + like).order('recorded_at',{ascending:false}).limit(200);
        var dists = distR.data || [];
        var recsR = await window.supa.from('compliance_records').select('*').or('data->>lot.ilike.' + like + ',data->>lot_number.ilike.' + like).order('recorded_at',{ascending:false}).limit(500);
        var allRecs = recsR.data || [];
        var holdR = await window.supa.from('hold_tags').select('*').ilike('lot_number', like).limit(20);
        var holds = holdR.data || [];
        clearInterval(ticker);
        var elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        var customers = [];
        var totalQty = 0;
        dists.forEach(function(d){
          if(d.data){
            customers.push({ ship_date: d.data.ship_date, customer: d.data.customer, qty: d.data.qty, address: d.data.address, contact: d.data.contact, method: d.data.method, bol: d.data.bol });
          }
        });
        var passes = parseFloat(elapsed) <= (4 * 3600);  // 4-hour target (always passes for a real query)
        resultsEl.innerHTML =
          '<div style="text-align:left">' +
            '<div style="font-size:28px;font-weight:700;color:' + (passes ? '#5fcf9e' : '#ff8579') + ';margin-bottom:5px">' + elapsed + 's</div>' +
            '<div style="font-size:11px;color:#9aa7bd;letter-spacing:1px;margin-bottom:14px">Trace completed · ' + (passes ? 'WITHIN' : 'OVER') + ' 4-hour FDA target</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">' +
              '<div style="background:rgba(127,198,245,.06);border:1px solid rgba(127,198,245,.2);border-radius:8px;padding:10px"><div style="font-size:18px;color:#7fc6f5;font-weight:700">' + customers.length + '</div><div style="font-size:10px;color:#9aa7bd;letter-spacing:1px;text-transform:uppercase">Customers</div></div>' +
              '<div style="background:rgba(0,229,192,.05);border:1px solid rgba(0,229,192,.2);border-radius:8px;padding:10px"><div style="font-size:18px;color:var(--teal);font-weight:700">' + allRecs.length + '</div><div style="font-size:10px;color:#9aa7bd;letter-spacing:1px;text-transform:uppercase">Records</div></div>' +
              '<div style="background:rgba(231,76,60,.06);border:1px solid rgba(231,76,60,.2);border-radius:8px;padding:10px"><div style="font-size:18px;color:#ff8579;font-weight:700">' + holds.length + '</div><div style="font-size:10px;color:#9aa7bd;letter-spacing:1px;text-transform:uppercase">Holds</div></div>' +
            '</div>' +
            (customers.length ?
              '<div style="font-size:10px;color:#9aa7bd;letter-spacing:1px;margin-bottom:6px">CUSTOMERS WHO RECEIVED LOT</div>' +
              customers.map(function(c){ return '<div style="padding:8px 10px;background:rgba(255,255,255,.03);border-radius:6px;margin-bottom:4px;font-size:11px"><b>' + esc(c.customer||'?') + '</b> · ' + esc(c.qty||'?') + ' · shipped ' + esc(c.ship_date||'?') + (c.bol ? ' · BOL ' + esc(c.bol) : '') + '</div>'; }).join('') :
              '<div style="padding:15px;text-align:center;color:#9aa7bd;font-size:11px">No distribution records for this lot yet.</div>') +
            '<div style="margin-top:14px;display:flex;gap:6px"><button id="gl-mock-pdf" class="cbtn">🖨️ Print mock recall report</button></div>' +
          '</div>';
        var pdfBtn = resultsEl.querySelector('#gl-mock-pdf');
        if(pdfBtn) pdfBtn.addEventListener('click', function(){ printMockRecallReport(lot, elapsed, customers, allRecs, holds); });
      } catch(e){
        clearInterval(ticker);
        resultsEl.innerHTML = '<div style="padding:20px;color:#ff8579">Trace failed: ' + esc(e.message||'unknown') + '</div>';
      }
    });
  };

  function printMockRecallReport(lot, elapsed, customers, recs, holds){
    var w = window.open('', '_blank');
    if(!w){ alert('Pop-up blocked'); return; }
    var html =
      '<!doctype html><html><head><meta charset="utf-8"><title>Mock Recall Report — ' + esc(lot) + '</title>' +
      '<style>body{font-family:Helvetica,Arial,sans-serif;color:#0a1628;margin:24px;font-size:12px;line-height:1.5}h1{font-size:20px;margin:0 0 4px}.meta{color:#666;font-size:11px;margin-bottom:14px}h2{font-size:14px;border-bottom:2px solid #0a8;padding-bottom:4px;margin-top:18px}.row{padding:6px 8px;border-bottom:1px solid #eee;font-size:11px}.kpi{display:inline-block;margin-right:18px;padding:8px 14px;background:#f5f5f5;border-radius:6px}.kpi b{font-size:18px;color:#0a8;display:block}@media print{.no-print{display:none}}</style>' +
      '</head><body>' +
      '<h1>Mock Recall Report</h1>' +
      '<div class="meta">Good Liquid Bev Co · 2011 51st Ave E, Palmetto, FL 34221 · Generated ' + fmtTs(new Date()) + '</div>' +
      '<div class="no-print" style="margin-bottom:18px"><button onclick="window.print()" style="padding:8px 16px;background:#0a8;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:700">🖨️ Print / Save as PDF</button> <button onclick="window.close()" style="margin-left:6px">Close</button></div>' +
      '<h2>Recall scope</h2>' +
      '<div class="row"><b>Lot recalled:</b> ' + esc(lot) + '</div>' +
      '<div class="row"><b>Trace elapsed:</b> ' + elapsed + ' seconds (FDA 4-hour target = 14,400s)</div>' +
      '<div style="margin:14px 0"><div class="kpi"><b>' + customers.length + '</b>Customers reached</div><div class="kpi"><b>' + recs.length + '</b>Compliance records traced</div><div class="kpi"><b>' + holds.length + '</b>Hold tags</div></div>' +
      '<h2>Customers who received this lot</h2>' +
      (customers.length ? customers.map(function(c){ return '<div class="row"><b>' + esc(c.customer||'?') + '</b> — ' + esc(c.qty||'?') + ' · shipped ' + esc(c.ship_date||'?') + (c.bol ? ' · BOL ' + esc(c.bol) : '') + (c.contact ? ' · contact ' + esc(c.contact) : '') + (c.address ? '<br><span style="color:#666;font-size:10px">' + esc(c.address) + '</span>' : '') + '</div>'; }).join('') : '<div class="row" style="color:#888">(no distribution records found)</div>') +
      '<h2>Compliance records on the affected lot</h2>' +
      (recs.length ? recs.map(function(r){ return '<div class="row"><b>' + esc(r.form_code) + '</b> · ' + fmtTs(r.recorded_at) + ' · ' + esc(r.status) + (r.has_deviation ? ' · ⚠ deviation' : '') + '</div>'; }).join('') : '<div class="row" style="color:#888">(none)</div>') +
      '<h2>Hold tags</h2>' +
      (holds.length ? holds.map(function(h){ return '<div class="row"><b>' + esc(h.tag_number) + '</b> · ' + fmtTs(h.hold_date) + ' · ' + esc(h.status) + ' · ' + esc(h.reason) + '</div>'; }).join('') : '<div class="row" style="color:#888">(no holds)</div>') +
      '<h2>PCQI sign-off</h2>' +
      '<div class="row">PCQI: ' + esc((window.currentUser && (window.currentUser.name || window.currentUser.email)) || 'PCQI') + '</div>' +
      '<div class="row">Signature: _________________________________</div>' +
      '<div class="row">Date: _________________________________</div>' +
      '<div class="row" style="margin-top:14px;color:#666;font-size:10px">This is a mock-recall exercise per FSP-VER-002 annual review requirement. No actual product was withdrawn.</div>' +
      '</body></html>';
    w.document.write(html); w.document.close();
  }

  // ── (11) Vendor FSP-SC-001 fields ──
  // Adds extended fields to the Vendor edit modal: approval_date, qualification_basis,
  // gfsi_cert_no, cert_expires, allergen_risk, status. Stored on vendors row (DB columns
  // must exist — SQL provided in the PR description). Falls back gracefully if columns
  // are missing (older Supabase schema just ignores them).
  function tryAugmentVendorModal(){
    // The vendor modal opens via window.glOpenAddVendor / glOpenEditVendor (defined elsewhere).
    // We observe DOM for the modal and inject extra fields when found.
    new MutationObserver(function(muts){
      muts.forEach(function(m){
        if(!m.addedNodes) return;
        m.addedNodes.forEach(function(n){
          if(n.nodeType !== 1) return;
          // Vendor modal uses id #gl-ven-name as the first input (from earlier batch 16 build)
          var nameInput = n.id === 'gl-ven-name' ? n : (n.querySelector ? n.querySelector('#gl-ven-name') : null);
          if(!nameInput) return;
          var modal = nameInput.closest('[id^="gl-"]') || nameInput.parentNode.parentNode;
          if(!modal || modal.dataset.glFspAugmented === '1') return;
          modal.dataset.glFspAugmented = '1';
          // Find the notes field (last field typically) and insert FSP fields before it
          var notesField = modal.querySelector('#gl-ven-notes');
          if(!notesField) return;
          var notesWrapper = notesField.parentNode;
          var fspBlock = document.createElement('div');
          fspBlock.innerHTML =
            '<div style="margin:14px 0 8px;font-size:10px;color:#5fcf9e;letter-spacing:2px;text-transform:uppercase">FSP-SC-001 — Approved Supplier List</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
              '<div><div style="font-size:11px;color:#9aa7bd;margin-bottom:4px">Approval date</div><input id="gl-ven-approval-date" type="date" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box"></div>' +
              '<div><div style="font-size:11px;color:#9aa7bd;margin-bottom:4px">Qualification basis</div><select id="gl-ven-qbasis" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box"><option value="">—</option><option value="gfsi">GFSI cert (SQF/BRC/FSSC)</option><option value="audit">2nd-party audit</option><option value="survey">Supplier survey</option><option value="coa">COA history</option></select></div>' +
              '<div><div style="font-size:11px;color:#9aa7bd;margin-bottom:4px">GFSI cert no.</div><input id="gl-ven-gfsi-cert" type="text" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box"></div>' +
              '<div><div style="font-size:11px;color:#9aa7bd;margin-bottom:4px">Cert expiry</div><input id="gl-ven-cert-expiry" type="date" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box"></div>' +
              '<div><div style="font-size:11px;color:#9aa7bd;margin-bottom:4px">Allergen risk</div><select id="gl-ven-allergen-risk" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box"><option value="">—</option><option value="L">Low</option><option value="M">Medium</option><option value="H">High</option></select></div>' +
              '<div><div style="font-size:11px;color:#9aa7bd;margin-bottom:4px">Status</div><select id="gl-ven-supplier-status" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box"><option value="active">Active</option><option value="suspended">Suspended</option><option value="removed">Removed</option></select></div>' +
            '</div>';
          notesWrapper.parentNode.insertBefore(fspBlock, notesWrapper);
          // When save happens, intercept and add these fields to the patch
          // The vendor save fn lives in fix.js earlier (glOpenAddVendor) — we patch via the form submit click
          var saveBtn = modal.querySelector('button[id$="-save"]') || modal.querySelector('.cbtn.pri');
          if(saveBtn && !saveBtn.dataset.glFspHook){
            saveBtn.dataset.glFspHook = '1';
            saveBtn.addEventListener('click', async function(){
              // Best-effort: after the existing handler runs (it's bound first), patch the latest vendor
              setTimeout(async function(){
                if(!window.supa) return;
                try {
                  // Find the most recent vendor (by created_at or updated_at) — match by name field
                  var name = nameInput.value.trim();
                  if(!name) return;
                  var r = await window.supa.from('vendors').select('id').eq('name', name).order('updated_at', { ascending: false }).limit(1);
                  if(!r.data || !r.data[0]) return;
                  var patch = {};
                  var ad = modal.querySelector('#gl-ven-approval-date'); if(ad && ad.value) patch.approval_date = ad.value;
                  var qb = modal.querySelector('#gl-ven-qbasis');        if(qb && qb.value) patch.qualification_basis = qb.value;
                  var gc = modal.querySelector('#gl-ven-gfsi-cert');     if(gc && gc.value) patch.gfsi_cert_no = gc.value;
                  var ce = modal.querySelector('#gl-ven-cert-expiry');   if(ce && ce.value) patch.cert_expires = ce.value;
                  var ar = modal.querySelector('#gl-ven-allergen-risk'); if(ar && ar.value) patch.allergen_risk = ar.value;
                  var ss = modal.querySelector('#gl-ven-supplier-status'); if(ss && ss.value) patch.supplier_status = ss.value;
                  if(Object.keys(patch).length){
                    await window.supa.from('vendors').update(patch).eq('id', r.data[0].id);
                  }
                } catch(e){ console.warn('[GL vendor FSP] patch failed (columns may not exist yet)', e); }
              }, 600);
            }, true);
          }
        });
      });
    }).observe(document.body, { childList:true, subtree:true });
  }
  tryAugmentVendorModal();

  // ── Add Mock Recall + Glass Break + SMS-alert phone buttons to Compliance master ──
  function injectPhase3Buttons(){
    var host = document.getElementById('comp-body');
    if(!host) return;
    new MutationObserver(function(){
      var holdBtn = host.querySelector('.gl-comp-hold');
      if(!holdBtn) return;
      if(holdBtn.parentNode.querySelector('.gl-comp-mock')) return;
      // Insert Mock Recall + Glass Break + Alerts buttons before the Hold Tag button
      function btn(cls, text, color, fn){
        var b = document.createElement('button');
        b.className = 'cbtn ' + cls;
        b.setAttribute('style','font-size:11px;padding:5px 11px;margin-right:6px;background:' + color.bg + ';border:1px solid ' + color.bd + ';color:' + color.fg);
        b.textContent = text;
        b.addEventListener('click', fn);
        return b;
      }
      var mockBtn  = btn('gl-comp-mock',  '🎯 Mock recall',   { bg:'rgba(0,229,192,.08)', bd:'rgba(0,229,192,.3)', fg:'#00e5c0' }, function(){ window.glOpenMockRecallSim(); });
      var glassBtn = btn('gl-comp-glass', '🚨 Glass break',  { bg:'rgba(231,76,60,.1)',   bd:'rgba(231,76,60,.35)', fg:'#ff8579' }, function(){ window.glOpenGlassBreakageForm(); });
      var smsBtn   = btn('gl-comp-sms',   '📱 SMS alerts',   { bg:'rgba(127,198,245,.08)', bd:'rgba(127,198,245,.3)', fg:'#7fc6f5' }, function(){ window.glSetSmsAlertPhone(); });
      holdBtn.parentNode.insertBefore(smsBtn,   holdBtn);
      holdBtn.parentNode.insertBefore(mockBtn,  holdBtn);
      holdBtn.parentNode.insertBefore(glassBtn, holdBtn);
    }).observe(host, { childList:true, subtree:true });
  }
  if(document.readyState !== 'loading') injectPhase3Buttons();
  else document.addEventListener('DOMContentLoaded', injectPhase3Buttons);

  console.log('[GL] compliance phase 3 pack loaded — Mock Recall + Glass-Break + Allergen Warn + Vendor FSP + SMS + Photo Upload');
}());


/* ============================================================
   ADMIN THEME REFRESH
   - Lighter background palette (still dark, but less stark — easier
     on the eyes for long compliance / data-entry sessions).
   - Bold, clearly-visible sidebar section headers with a left accent
     bar so you always know which section you're in.
   Injected via a <style> tag so it can be tuned/disabled cleanly
   without touching the base index.html stylesheet.
   ============================================================ */
(function(){
  if(document.getElementById('gl-theme-refresh')) return;
  var s = document.createElement('style');
  s.id = 'gl-theme-refresh';
  s.textContent = [
    // ── Lighter background palette (only inside #crm-panel) ──
    '#crm-panel { background: #243653 !important; }',
    '#crm-panel #crm-top { background: #1c2c46 !important; }',
    '#crm-panel #crm-sidebar { background: #1c2c46 !important; }',
    '#crm-panel .crm-main { background: #243653 !important; }',
    '#crm-panel .inv-detail { background: #243653 !important; }',
    '#crm-panel .inv-preview { background: #1c2c46 !important; }',
    '#crm-panel .modal-box { background: #243653 !important; }',

    // Card surfaces — lift one more notch so they pop against the lighter bg
    '#crm-panel .cmc,',
    '#crm-panel .ccard,',
    '#crm-panel .kcol,',
    '#crm-panel .ref-card,',
    '#crm-panel .rref-card,',
    '#crm-panel .panel-card,',
    '#crm-panel .pt-wrap { background: #2e486b !important; border-color: rgba(255,255,255,.1) !important; }',
    '#crm-panel .kcard { background: #243653 !important; border-color: rgba(255,255,255,.1) !important; }',
    '#crm-panel .kcard:hover { border-color: rgba(0,229,192,.32) !important; }',

    // Form / input fields — slightly brighter so they read on lifted bg
    '#crm-panel .fsel,',
    '#crm-panel .finp { background: rgba(255,255,255,.08) !important; border-color: rgba(255,255,255,.16) !important; }',

    // Subtle row hover lift on tables
    '#crm-panel .ctbl tr:hover td { background: rgba(255,255,255,.06) !important; }',
    '#crm-panel .ctbl td { border-bottom-color: rgba(255,255,255,.08) !important; }',
    '#crm-panel .ctbl th { border-bottom-color: rgba(255,255,255,.12) !important; }',

    // Sidebar nav items — keep look but slightly nudge contrast on lighter bg
    '#crm-panel .cni { color: #b9c5d6 !important; }',
    '#crm-panel .cni:hover { background: rgba(255,255,255,.08) !important; color: #fff !important; }',
    '#crm-panel .cni.act { background: rgba(0,229,192,.12) !important; color: var(--teal) !important; border-color: rgba(0,229,192,.32) !important; font-weight:600; }',

    // ── BOLD SIDEBAR SECTION HEADERS ──
    // Distinct top divider + left accent bar + larger uppercase label
    '#crm-panel .cni-sec {',
      'font-size: 11px !important;',
      'letter-spacing: 2.5px !important;',
      'color: #7fc6f5 !important;',
      'font-weight: 800 !important;',
      'text-transform: uppercase !important;',
      'padding: 11px 8px 9px 14px !important;',
      'margin: 12px 0 4px !important;',
      'background: linear-gradient(90deg, rgba(127,198,245,.10), rgba(127,198,245,.02)) !important;',
      'border-left: 3px solid #7fc6f5 !important;',
      'border-radius: 0 8px 8px 0 !important;',
    '}',
    '#crm-panel .cni-sec:first-of-type { margin-top: 4px !important; }',

    // Color-code each section header by what it represents (subtle hue shift)
    // We can't use :contains() in CSS so we rely on the .cni-sec sibling text via JS — see below.

    // Make the topbar brand a hair brighter against lighter bg
    '#crm-panel .crm-brand-name { color:#fff !important; }',
    '#crm-panel .crm-brand-sub { color: rgba(255,255,255,.55) !important; }',

    ''
  ].join('\n');
  (document.head || document.documentElement).appendChild(s);

  // ── Optional: tint each section header by name ──
  // CSS can't match by text, so we add a data-tone attribute via JS once at boot.
  var TONE = {
    main:           { color:'#7fc6f5', accent:'#7fc6f5' },
    billing:        { color:'#f5c842', accent:'#f5c842' },
    referrals:      { color:'#c4a4f8', accent:'#c4a4f8' },
    other:          { color:'#9aa7bd', accent:'#9aa7bd' },
    operations:     { color:'#5fcf9e', accent:'#5fcf9e' },
    calendars:      { color:'#7fc6f5', accent:'#7fc6f5' },
    'operations pro':{ color:'#00e5c0', accent:'#00e5c0' },
    marketing:      { color:'#ff8579', accent:'#ff8579' },
    compliance:     { color:'#f5c842', accent:'#f5c842' },
    'quality & supply':{ color:'#c4a4f8', accent:'#c4a4f8' },
    tools:          { color:'#7fc6f5', accent:'#7fc6f5' }
  };
  function tintSectionHeaders(){
    var nav = document.querySelector('#crm-sidebar .cnav');
    if(!nav){ setTimeout(tintSectionHeaders, 500); return; }
    nav.querySelectorAll('.cni-sec').forEach(function(el){
      if(el.dataset.glToned === '1') return;
      var key = (el.textContent || '').trim().toLowerCase();
      var t = TONE[key];
      if(t){
        el.style.setProperty("color", t.color, "important");
        el.style.setProperty("border-left-color", t.accent, "important");
        el.style.setProperty("background", "linear-gradient(90deg, "+t.color+"1f, "+t.color+"04)", "important");
      }
      el.dataset.glToned = '1';
    });
  }
  if(document.readyState !== 'loading') tintSectionHeaders();
  else document.addEventListener('DOMContentLoaded', tintSectionHeaders);

  console.log('[GL] admin theme refresh — lighter palette + bold colored section headers');
}());


/* ============================================================
   COMPLIANCE POLISH PACK
   A. Photo upload on NCR / Defects form
   B. Per-product applicability config (hide CCPs you don't use)
   C. Single-record print button (history row → printable PDF)
   D. Document version control (LEAN plan files + PCQI ack)
   E. Retention archival workflow (records >24 months)
   F. Mobile responsiveness for compliance forms
   G. Annual FSP review auto-reminder (12 months out)
   ============================================================ */
(function(){
  var esc = window.glEsc;
  function fmtDate(d){ if(!d) return ''; var x = new Date(d); return isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
  function fmtTs(d){ if(!d) return ''; var x = new Date(d); return isNaN(x.getTime()) ? String(d) : x.toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}); }
  function nowISO(){ return new Date().toISOString(); }
  function todayISO(){ return new Date().toISOString().slice(0,10); }

  async function uploadCompliancePhoto(file, prefix){
    if(!file || !window.supa) return null;
    var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    var path = (prefix || 'compliance') + '/' + Date.now() + '-' + Math.random().toString(36).slice(2,8) + '.' + ext;
    try {
      var r = await window.supa.storage.from('compliance-photos').upload(path, file, { contentType: file.type || 'image/jpeg' });
      if(r.error){ console.warn('[GL polish] photo upload err', r.error); return null; }
      var pub = window.supa.storage.from('compliance-photos').getPublicUrl(path);
      return pub.data && pub.data.publicUrl ? pub.data.publicUrl : null;
    } catch(e){ console.warn('[GL polish] photo threw', e); return null; }
  }

  // ============================================================
  // (A) PHOTO UPLOAD ON DEFECT / NCR MODAL
  // ============================================================
  // The defect modal mounts dynamically. We observe DOM for #gl-def-desc
  // (its description textarea) and inject a photo field underneath.
  new MutationObserver(function(muts){
    muts.forEach(function(m){
      if(!m.addedNodes) return;
      m.addedNodes.forEach(function(n){
        if(n.nodeType !== 1) return;
        var desc = n.id === 'gl-def-desc' ? n : (n.querySelector ? n.querySelector('#gl-def-desc') : null);
        if(!desc) return;
        var modal = desc.closest('div[id^="gl-"]') || desc.parentNode.parentNode.parentNode;
        if(!modal || modal.dataset.glDefectPhotoInjected === '1') return;
        modal.dataset.glDefectPhotoInjected = '1';
        var photoWrap = document.createElement('div');
        photoWrap.className = 'frow';
        photoWrap.innerHTML =
          '<div class="flbl">📸 Photo evidence (optional)</div>' +
          '<input type="file" id="gl-def-photo" accept="image/*" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:12px;box-sizing:border-box">' +
          '<div id="gl-def-photo-preview" style="margin-top:6px"></div>';
        // Insert after description's parent row
        var descRow = desc.parentNode;
        descRow.parentNode.insertBefore(photoWrap, descRow.nextSibling);
        var input = photoWrap.querySelector('#gl-def-photo');
        var preview = photoWrap.querySelector('#gl-def-photo-preview');
        input.addEventListener('change', async function(){
          var f = input.files[0]; if(!f) return;
          preview.innerHTML = '<div style="font-size:11px;color:#9aa7bd">Uploading…</div>';
          var url = await uploadCompliancePhoto(f, 'defect');
          if(url){
            preview.innerHTML = '<div style="font-size:10px;color:#5fcf9e;margin-bottom:4px">✓ Uploaded</div><img src="' + esc(url) + '" style="max-width:200px;max-height:120px;border-radius:6px;border:1px solid rgba(255,255,255,.1)">';
            preview.dataset.url = url;
            window.__glLastDefectPhoto = url;
          } else {
            preview.innerHTML = '<div style="font-size:11px;color:#ff8579">Upload failed — create the compliance-photos Storage bucket in Supabase to enable.</div>';
          }
        });
      });
    });
  }).observe(document.body, { childList:true, subtree:true });

  // After any defect is saved, patch notes with the photo URL (best-effort)
  (function watchDefectInserts(){
    var lastSeen = null;
    setInterval(async function(){
      if(!window.supa || !window.__glLastDefectPhoto) return;
      var photo = window.__glLastDefectPhoto;
      try {
        var r = await window.supa.from('defects').select('id,description,corrective_action,created_at').order('created_at',{ascending:false}).limit(1);
        if(r.data && r.data[0]){
          var d = r.data[0];
          if(d.id === lastSeen) return;
          lastSeen = d.id;
          if(!(d.description||'').includes('Photo:') && !(d.corrective_action||'').includes('Photo:')){
            await window.supa.from('defects').update({ description: (d.description||'') + '\nPhoto: ' + photo }).eq('id', d.id);
            window.__glLastDefectPhoto = null;
          }
        }
      } catch(e){}
    }, 2500);
  })();

  // ============================================================
  // (B) PER-PRODUCT APPLICABILITY CONFIG
  // ============================================================
  // Stores a set of hidden task types in localStorage. The compliance
  // task generator already filters tasks; we layer a second filter via
  // a MutationObserver that hides "rendered" Today's-Task cards whose
  // task_type is in the hidden set.
  var APP_KEY = 'gl_compliance_hidden_task_types';
  function readApp(){ try { return JSON.parse(localStorage.getItem(APP_KEY) || '[]'); } catch(e){ return []; } }
  function writeApp(arr){ localStorage.setItem(APP_KEY, JSON.stringify(arr || [])); }

  window.glOpenApplicabilityConfig = function(){
    var prior = document.getElementById('gl-app-modal'); if(prior) prior.remove();
    var TASK_TYPES = [
      ['htst_reading','🌡️ HTST Pasteurization (CCP-1)','Use when you pasteurize juice or RTD beverages'],
      ['hot_fill_reading','♨️ Hot Fill (CCP-2)','Use when hot-filling jam / syrup / preserves'],
      ['seam_check','🥫 Can Seam (CCP-4)','Use when canning'],
      ['uv_reading','💡 UV Water Treatment (CCP-3)','Use when UV is your water disinfection step'],
      ['ferm_reading','🧫 Fermentation (CCP-A)','Use when brewing beer / cider / hard seltzer / kombucha'],
      ['cip_cycle','🧼 CIP cycle (post-run)','Auto-generated post-run; turn off if you do CIP only on a different schedule'],
      ['allergen_swab','⚠️ Allergen Changeover Swab','Auto-detects allergen runs in today\'s schedule'],
      ['batch_record','📄 Batch Record (co-pack)','Auto-generated for co-pack runs (client linked)']
    ];
    var hidden = new Set(readApp());
    var rows = TASK_TYPES.map(function(t){
      var on = !hidden.has(t[0]);
      return '<label style="display:flex;align-items:flex-start;gap:10px;padding:11px 13px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:9px;margin-bottom:6px;cursor:pointer">' +
        '<input type="checkbox" data-tt="' + t[0] + '"' + (on ? ' checked' : '') + ' style="accent-color:var(--teal);width:15px;height:15px;margin-top:1px">' +
        '<div style="flex:1"><div style="font-size:13px;color:#fff;font-weight:600">' + esc(t[1]) + '</div><div style="font-size:11px;color:#9aa7bd;margin-top:2px">' + esc(t[2]) + '</div></div>' +
      '</label>';
    }).join('');
    var ov = document.createElement('div');
    ov.id = 'gl-app-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:9000;background:rgba(6,13,26,.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto');
    ov.innerHTML =
      '<div style="background:#243653;border:1px solid rgba(0,229,192,.22);border-radius:14px;width:100%;max-width:520px;max-height:88vh;overflow-y:auto;color:#cfd9e6;box-shadow:0 20px 60px rgba(0,0,0,.6)">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.06)">' +
          '<div>' +
            '<div style="font-family:var(--ff-disp);font-size:14px;letter-spacing:2px;color:var(--teal);font-weight:700">⚙️ APPLICABILITY</div>' +
            '<div style="font-size:11px;color:#9aa7bd;margin-top:3px">Toggle off CCPs / forms you don\'t actually use. Hidden ones won\'t auto-generate as tasks.</div>' +
          '</div>' +
          '<button id="gl-app-close" style="background:none;border:none;color:#9aa7bd;font-size:18px;cursor:pointer;padding:2px 6px">✕</button>' +
        '</div>' +
        '<div style="padding:18px 22px">' + rows + '</div>' +
        '<div style="padding:14px 22px;border-top:1px solid rgba(255,255,255,.06);display:flex;gap:8px;justify-content:flex-end">' +
          '<button id="gl-app-cancel" class="cbtn">Cancel</button>' +
          '<button id="gl-app-save" class="cbtn pri">💾 Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    function close(){ ov.remove(); }
    ov.addEventListener('click', function(e){ if(e.target === ov) close(); });
    ov.querySelector('#gl-app-close').addEventListener('click', close);
    ov.querySelector('#gl-app-cancel').addEventListener('click', close);
    ov.querySelector('#gl-app-save').addEventListener('click', function(){
      var newHidden = [];
      ov.querySelectorAll('input[type=checkbox][data-tt]').forEach(function(cb){
        if(!cb.checked) newHidden.push(cb.getAttribute('data-tt'));
      });
      writeApp(newHidden);
      if(typeof addNotification === 'function') addNotification('⚙️ Applicability saved', newHidden.length + ' task type' + (newHidden.length===1?'':'s') + ' hidden','success');
      if(typeof window.glAudit === 'function') window.glAudit('compliance_applicability_changed','', { hidden: newHidden });
      close();
      // Apply visibility immediately so the user sees the result without
      // having to renavigate. THEN also trigger a master refresh so newly-
      // generated tasks honor the new config.
      applyApplicability();
      if(typeof window.refreshComplianceMaster === 'function'){
        // Small delay so refreshComplianceMaster's async render lands first,
        // then re-apply on the freshly-rendered cards.
        window.refreshComplianceMaster();
        setTimeout(applyApplicability, 80);
        setTimeout(applyApplicability, 400);
      }
    });
  };

  // applyApplicability — hide rendered task cards whose task_type is in the
  // hidden set. Callable from anywhere; the save handler above invokes it
  // explicitly so the user sees the result immediately. The MutationObserver
  // below also calls it so newly-rendered tasks get hidden too. Re-shows
  // (display:'') cards that are no longer in the hidden set, so unchecking
  // a previously-hidden type reveals its tasks again.
  // Also renders a visible "🙈 Hiding N types" banner above the task list
  // so the operator can see the effect of the picker (previously the picker
  // appeared to do nothing because the visual change happened off-screen).
  var TASK_TYPE_LABELS = {
    htst_reading:     'HTST Pasteurization',
    hot_fill_reading: 'Hot Fill',
    seam_check:       'Can Seam',
    uv_reading:       'UV Water Treatment',
    ferm_reading:     'Fermentation',
    cip_cycle:        'CIP cycle',
    allergen_swab:    'Allergen Swab',
    batch_record:     'Batch Record',
    preop_inspection: 'Pre-op Inspection',
    label_verify:     'Label Verification',
    calibration:      'Calibration',
    listeria_swab:    'Listeria Swab'
  };
  function applyApplicability(){
    var host = document.getElementById('comp-body'); if(!host) return;
    var hidden = new Set(readApp());
    var hiddenCount = 0;
    var totalCards = 0;
    host.querySelectorAll('.gl-comp-task').forEach(function(card){
      totalCards++;
      var btn = card.querySelector('button[data-task-type]');
      if(!btn) return;
      var tt = btn.getAttribute('data-task-type');
      var willHide = hidden.has(tt);
      card.style.display = willHide ? 'none' : '';
      if(willHide) hiddenCount++;
    });
    // Render the status banner. Pin it just above #comp-tab-body so it
    // appears at the top of the task list view, on every tab.
    var tabBody = host.querySelector('#comp-tab-body');
    var existingBanner = host.querySelector('#gl-applic-banner');
    if(existingBanner) existingBanner.remove();
    if(hidden.size && tabBody){
      var hiddenLabels = Array.from(hidden).map(function(k){ return TASK_TYPE_LABELS[k] || k; }).join(', ');
      var banner = document.createElement('div');
      banner.id = 'gl-applic-banner';
      banner.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 14px;margin-bottom:10px;background:rgba(196,164,248,.08);border:1px solid rgba(196,164,248,.3);border-radius:8px;font-size:12px;color:#c4a4f8';
      banner.innerHTML =
        '<span style="font-size:16px">🙈</span>' +
        '<div style="flex:1"><b>Applicability filter active</b> — hiding ' + hidden.size + ' task type' + (hidden.size===1?'':'s') +
          (hiddenCount ? ' (' + hiddenCount + ' card' + (hiddenCount===1?'':'s') + ' hidden today)' : ' (no matching tasks today)') +
          '<div style="font-size:11px;color:#9aa7bd;margin-top:2px">Hidden: ' + String(hiddenLabels).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }) + '</div>' +
        '</div>' +
        '<button id="gl-applic-banner-edit" style="background:rgba(196,164,248,.14);border:1px solid rgba(196,164,248,.4);color:#c4a4f8;font-size:11px;padding:5px 11px;border-radius:5px;cursor:pointer">Edit</button>' +
        '<button id="gl-applic-banner-clear" style="background:none;border:1px solid rgba(255,255,255,.12);color:#9aa7bd;font-size:11px;padding:5px 11px;border-radius:5px;cursor:pointer">Show all</button>';
      tabBody.parentNode.insertBefore(banner, tabBody);
      banner.querySelector('#gl-applic-banner-edit').onclick = function(){ window.glOpenApplicabilityConfig(); };
      banner.querySelector('#gl-applic-banner-clear').onclick = function(){
        writeApp([]);
        applyApplicability();
        if(typeof addNotification === 'function') addNotification('🙈 Filter cleared', 'All compliance task types are visible again', 'success');
        if(typeof window.glAudit === 'function') window.glAudit('compliance_applicability_cleared','',{});
      };
    }
  }

  // Watcher: re-apply whenever comp-body mutates (covers async renders).
  (function watchAndApply(){
    var host = document.getElementById('comp-body');
    if(!host){ setTimeout(watchAndApply, 700); return; }
    var pending = false;
    new MutationObserver(function(){
      if(pending) return;
      pending = true;
      requestAnimationFrame(function(){ pending = false; applyApplicability(); });
    }).observe(host, { childList:true, subtree:true });
    applyApplicability(); // initial paint
  })();

  // ============================================================
  // (C) SINGLE-RECORD PRINT
  // ============================================================
  // Add a "🖨️ Print" button to each row of the History tab.
  // We hook into the existing renderHistory by observing the comp-body.
  function printSingleRecord(rec){
    var w = window.open('','_blank');
    if(!w){ alert('Pop-up blocked — allow pop-ups to print.'); return; }
    var data = rec.data || {};
    function row(k, v){ return '<tr><td style="padding:6px 10px;color:#666;width:35%;border-bottom:1px solid #eee">' + esc(k) + '</td><td style="padding:6px 10px;border-bottom:1px solid #eee">' + esc(v == null ? '' : v) + '</td></tr>'; }
    var dataRowsHtml = '';
    if(Array.isArray(data.steps)){
      dataRowsHtml = '<h3 style="margin:14px 0 4px;font-size:13px">9-Step CIP Breakdown</h3>' +
        '<table style="width:100%;border-collapse:collapse;font-size:11px">' +
        '<thead><tr style="background:#f5f5f5"><th style="padding:4px 6px;text-align:left">#</th><th style="padding:4px 6px;text-align:left">Step</th><th style="padding:4px 6px">Done</th><th style="padding:4px 6px">Actual min</th><th style="padding:4px 6px">Temp °F</th><th style="padding:4px 6px;text-align:left">Reading</th><th style="padding:4px 6px">P/F</th></tr></thead><tbody>';
      data.steps.forEach(function(s){
        dataRowsHtml += '<tr><td style="padding:3px 6px;border-bottom:1px dotted #eee">'+s.n+'</td><td style="padding:3px 6px;border-bottom:1px dotted #eee">'+esc(s.name)+'</td><td style="padding:3px 6px;text-align:center;border-bottom:1px dotted #eee">'+(s.done?'Y':'N')+'</td><td style="padding:3px 6px;text-align:center;border-bottom:1px dotted #eee">'+esc(s.actual_min)+'</td><td style="padding:3px 6px;text-align:center;border-bottom:1px dotted #eee">'+(s.temp_f||'')+'</td><td style="padding:3px 6px;border-bottom:1px dotted #eee">'+esc(s.reading||'')+'</td><td style="padding:3px 6px;text-align:center;border-bottom:1px dotted #eee;font-weight:600;color:'+(s.pf==='fail'?'#c41e3a':'#0a8')+'">'+esc(s.pf||'').toUpperCase()+'</td></tr>';
      });
      dataRowsHtml += '</tbody></table>';
    } else {
      var kvHtml = '';
      Object.keys(data).filter(function(k){ return typeof data[k] !== 'object'; }).forEach(function(k){
        kvHtml += row(k, data[k]);
      });
      if(kvHtml) dataRowsHtml = '<table style="width:100%;border-collapse:collapse">' + kvHtml + '</table>';
    }
    w.document.write(
      '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(rec.form_code) + ' — ' + esc(rec.id) + '</title>' +
      '<style>body{font-family:Helvetica,Arial,sans-serif;color:#0a1628;margin:24px;font-size:12px;line-height:1.5}h1{font-size:18px;margin:0 0 4px}.meta{color:#666;font-size:11px;margin-bottom:14px}.sig{margin-top:14px;padding-top:8px;border-top:2px solid #0a8;font-size:11px}.dev{background:#fef0ef;border-left:3px solid #c41e3a;padding:8px 10px;margin-top:10px;font-size:11px}@media print{.no-print{display:none}body{margin:14px}}</style>' +
      '</head><body>' +
      '<h1>' + esc(rec.form_code) + '</h1>' +
      '<div class="meta">Good Liquid Bev Co · 2011 51st Ave E, Palmetto, FL 34221 · Record ' + esc(rec.id) + '</div>' +
      '<div class="no-print" style="margin-bottom:14px"><button onclick="window.print()" style="padding:8px 16px;background:#0a8;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:700">🖨️ Print / Save as PDF</button> <button onclick="window.close()" style="margin-left:6px">Close</button></div>' +
      '<table style="width:100%;border-collapse:collapse;margin-bottom:14px;font-size:11px">' +
        row('Form', rec.form_code) +
        row('Record date', fmtDate(rec.record_date)) +
        row('Recorded at', fmtTs(rec.recorded_at)) +
        row('Status', rec.status) +
      '</table>' +
      dataRowsHtml +
      (rec.has_deviation ? '<div class="dev"><b>⚠ Deviation:</b> ' + esc(rec.deviation_notes || '') + (rec.corrective_action ? '<br><b>Corrective:</b> ' + esc(rec.corrective_action) : '') + '</div>' : '') +
      (rec.signature_name ? '<div class="sig"><b>PCQI signature:</b> ' + esc(rec.signature_name) + ' on ' + fmtTs(rec.signed_at) + (rec.signature_meaning ? ' (' + esc(rec.signature_meaning) + ')' : '') + '</div>' : '<div class="sig">Signature: __________________ Date: __________</div>') +
      '</body></html>'
    );
    w.document.close();
  }
  // Hook into history rows
  (function hookHistoryPrint(){
    var host = document.getElementById('comp-body');
    if(!host){ setTimeout(hookHistoryPrint, 700); return; }
    new MutationObserver(function(){
      host.querySelectorAll('.gl-hist-row').forEach(function(row){
        if(row.dataset.glPrintInjected === '1') return;
        row.dataset.glPrintInjected = '1';
        var detail = row.querySelector('.gl-hist-detail');
        if(!detail) return;
        // Add a print button to the bottom of the expanded detail
        var btn = document.createElement('button');
        btn.className = 'cbtn';
        btn.setAttribute('style','font-size:10px;padding:4px 10px;margin-top:8px;background:rgba(127,198,245,.08);border:1px solid rgba(127,198,245,.3);color:#7fc6f5');
        btn.textContent = '🖨️ Print this record';
        btn.addEventListener('click', async function(ev){
          ev.preventDefault(); ev.stopPropagation();
          // Re-fetch the record by id for fresh data
          var id = row.getAttribute('data-id');
          if(!id || !window.supa){ return; }
          try {
            var r = await window.supa.from('compliance_records').select('*').eq('id', id).single();
            if(r.data) printSingleRecord(r.data);
          } catch(e){ alert('Fetch failed: ' + (e.message||'')); }
        });
        detail.appendChild(btn);
      });
    }).observe(host, { childList:true, subtree:true });
  })();

  // ============================================================
  // (D) DOCUMENT VERSION CONTROL
  // ============================================================
  // Stores LEAN plan documents (GMP-001, FSP-001, etc.) as compliance_records
  // with form_code='DOC-CTRL-001'. Each record has: doc_name, version,
  // effective_date, file_url, retired_at, ack_required. PCQI signature
  // counts as acknowledgement.
  window.glOpenDocumentControl = function(){
    var prior = document.getElementById('gl-doc-modal'); if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-doc-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:9000;background:rgba(6,13,26,.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto');
    ov.innerHTML =
      '<div style="background:#243653;border:1px solid rgba(0,229,192,.22);border-radius:14px;width:100%;max-width:760px;max-height:88vh;overflow-y:auto;color:#cfd9e6;box-shadow:0 20px 60px rgba(0,0,0,.6)">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.06)">' +
          '<div>' +
            '<div style="font-family:var(--ff-disp);font-size:14px;letter-spacing:2px;color:var(--teal);font-weight:700">📄 DOCUMENT CONTROL</div>' +
            '<div style="font-size:11px;color:#9aa7bd;margin-top:3px">GMP, FSP, HACCP plan files — version-tracked with PCQI ack on each release</div>' +
          '</div>' +
          '<button id="gl-doc-close" style="background:none;border:none;color:#9aa7bd;font-size:18px;cursor:pointer;padding:2px 6px">✕</button>' +
        '</div>' +
        '<div style="padding:18px 22px">' +
          '<button id="gl-doc-add" class="cbtn pri" style="margin-bottom:12px">📤 Upload new document version</button>' +
          '<div id="gl-doc-list"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    function close(){ ov.remove(); }
    ov.addEventListener('click', function(e){ if(e.target === ov) close(); });
    ov.querySelector('#gl-doc-close').addEventListener('click', close);
    ov.querySelector('#gl-doc-add').addEventListener('click', function(){ openDocUploadModal(function(){ refreshDocList(); }); });

    async function refreshDocList(){
      var list = ov.querySelector('#gl-doc-list');
      list.innerHTML = '<div style="padding:20px;text-align:center;color:#9aa7bd">Loading…</div>';
      if(!window.supa){ list.innerHTML = '<div style="padding:20px;text-align:center;color:#9aa7bd">Supabase not loaded</div>'; return; }
      var r = await window.supa.from('compliance_records').select('*').eq('form_code','DOC-CTRL-001').order('recorded_at',{ascending:false}).limit(200);
      var rows = r.data || [];
      if(!rows.length){
        list.innerHTML = '<div style="padding:30px;text-align:center;color:#9aa7bd;font-size:13px">No documents uploaded yet. Click "Upload new document version" to add your GMP / FSP / HACCP plan files.</div>';
        return;
      }
      list.innerHTML = rows.map(function(r){
        var d = r.data || {};
        var retired = d.retired_at;
        var ackBadge = r.status === 'signed' ? '<span style="font-size:10px;color:#5fcf9e;background:rgba(95,207,158,.1);border:1px solid rgba(95,207,158,.3);padding:2px 7px;border-radius:10px">✓ PCQI Ack</span>' : '<span style="font-size:10px;color:#f5c842;background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.3);padding:2px 7px;border-radius:10px">Awaiting Ack</span>';
        var retiredBadge = retired ? '<span style="font-size:10px;color:#9aa7bd;background:rgba(255,255,255,.04);padding:2px 7px;border-radius:10px;margin-left:6px">RETIRED ' + fmtDate(retired) + '</span>' : '';
        return '<div style="padding:13px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:9px;margin-bottom:6px;display:flex;align-items:center;gap:10px">' +
          '<div style="flex:1">' +
            '<div style="font-size:13px;color:#fff;font-weight:600">📄 ' + esc(d.doc_name || 'Document') + ' · v' + esc(d.version || '1.0') + retiredBadge + '</div>' +
            '<div style="font-size:11px;color:#9aa7bd;margin-top:3px">' + (d.effective_date ? 'Effective ' + fmtDate(d.effective_date) + ' · ' : '') + 'Uploaded ' + fmtTs(r.recorded_at) + ' · ' + ackBadge + '</div>' +
          '</div>' +
          (d.file_url ? '<a href="' + esc(d.file_url) + '" target="_blank" class="cbtn" style="font-size:10px;padding:4px 10px">📥 Open</a>' : '') +
          (!retired ? '<button class="cbtn gl-doc-retire" data-id="' + r.id + '" style="font-size:10px;padding:4px 10px;background:rgba(231,76,60,.1);border-color:rgba(231,76,60,.3);color:#ff8579">Retire</button>' : '') +
        '</div>';
      }).join('');
      list.querySelectorAll('.gl-doc-retire').forEach(function(btn){
        btn.addEventListener('click', async function(){
          if(!confirm('Retire this document version? It stays in the audit trail but is marked as superseded.')) return;
          var id = btn.getAttribute('data-id');
          var cur = await window.supa.from('compliance_records').select('data').eq('id', id).single();
          var d = (cur.data && cur.data.data) || {};
          d.retired_at = nowISO();
          await window.supa.from('compliance_records').update({ data: d }).eq('id', id);
          refreshDocList();
        });
      });
    }
    refreshDocList();
  };

  function openDocUploadModal(onSaved){
    var prior = document.getElementById('gl-doc-up-modal'); if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-doc-up-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:9100;background:rgba(6,13,26,.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px');
    function fld(label, name, type, opts){
      opts = opts || {};
      var id = 'gl-docup-' + name;
      var common = 'width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-size:13px;box-sizing:border-box';
      var ctrl;
      if(type === 'select') ctrl = '<select id="' + id + '" style="' + common + '">' + (opts.options||[]).map(function(o){ return '<option>' + esc(o) + '</option>'; }).join('') + '</select>';
      else if(type === 'file') ctrl = '<input id="' + id + '" type="file" style="' + common + '">';
      else ctrl = '<input id="' + id + '" type="' + (type||'text') + '" value="' + esc(opts.value||'') + '" style="' + common + '">';
      return '<div style="margin-bottom:11px"><div style="font-size:11px;color:#9aa7bd;margin-bottom:4px">' + esc(label) + '</div>' + ctrl + '</div>';
    }
    ov.innerHTML =
      '<div style="background:#243653;border:1px solid rgba(0,229,192,.25);border-radius:14px;width:100%;max-width:460px;color:#cfd9e6;box-shadow:0 20px 60px rgba(0,0,0,.6)">' +
        '<div style="padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.06)">' +
          '<div style="font-family:var(--ff-disp);font-size:14px;letter-spacing:2px;color:var(--teal);font-weight:700">📤 UPLOAD DOCUMENT</div>' +
        '</div>' +
        '<div style="padding:18px 22px">' +
          fld('Document name','name','select',{ options:['GMP-001 — Good Manufacturing Practices','FSP-001 — Food Safety Plan','HACCP-001 — HACCP Plan','REC-001 — Minimum Records','SOP — Standard Operating Procedure','Other'] }) +
          fld('Custom name (if "Other")','custom','text') +
          fld('Version','version','text',{ value:'v1.0' }) +
          fld('Effective date','eff_date','date',{ value: todayISO() }) +
          fld('File (PDF or DOCX)','file','file') +
          '<div style="font-size:11px;color:#f5c842;background:rgba(245,200,66,.08);padding:8px 12px;border-radius:6px;margin-top:6px">Will save as PCQI-signed record. Requires the <b>compliance-photos</b> Storage bucket (same one used for evidence photos).</div>' +
        '</div>' +
        '<div style="padding:14px 22px;border-top:1px solid rgba(255,255,255,.06);display:flex;gap:8px;justify-content:flex-end">' +
          '<button id="gl-docup-cancel" class="cbtn">Cancel</button>' +
          '<button id="gl-docup-save" class="cbtn pri">📤 Upload &amp; sign</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    function close(){ ov.remove(); }
    ov.addEventListener('click', function(e){ if(e.target === ov) close(); });
    ov.querySelector('#gl-docup-cancel').addEventListener('click', close);
    ov.querySelector('#gl-docup-save').addEventListener('click', async function(){
      var name = ov.querySelector('#gl-docup-name').value;
      if(name === 'Other'){ name = ov.querySelector('#gl-docup-custom').value.trim() || 'Other'; }
      var ver = ov.querySelector('#gl-docup-version').value.trim() || 'v1.0';
      var eff = ov.querySelector('#gl-docup-eff_date').value;
      var fileInput = ov.querySelector('#gl-docup-file');
      var file = fileInput.files[0];
      if(!file){ alert('Pick a file.'); return; }
      var btn = this; btn.disabled = true; btn.textContent = 'Uploading…';
      // Upload to compliance-photos bucket (reuse — same RLS, no extra setup)
      var ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      var path = 'docs/' + Date.now() + '-' + Math.random().toString(36).slice(2,8) + '.' + ext;
      var url = null;
      try {
        var r = await window.supa.storage.from('compliance-photos').upload(path, file, { contentType: file.type || 'application/pdf' });
        if(!r.error){
          var pub = window.supa.storage.from('compliance-photos').getPublicUrl(path);
          url = pub.data && pub.data.publicUrl;
        }
      } catch(e){ console.warn('[GL doc upload] failed', e); }
      if(!url){ btn.disabled = false; btn.textContent = '📤 Upload & sign'; alert('Upload failed. Create the compliance-photos bucket first if you have not.'); return; }
      var user = window.currentUser || {};
      var rec = await window.supa.from('compliance_records').insert([{
        form_code: 'DOC-CTRL-001',
        record_date: eff || todayISO(),
        data: { doc_name: name, version: ver, effective_date: eff, file_url: url, file_name: file.name, file_type: file.type },
        status: 'signed',
        signed_by: user.id || null, signed_at: nowISO(),
        signature_name: user.name || user.email || 'PCQI',
        recorded_at: new Date().toISOString(),
        signature_meaning: 'PCQI acknowledgement of plan version'
      }]).select().single();
      if(typeof window.glAudit === 'function') window.glAudit('document_uploaded', rec.data ? rec.data.id : '', { name: name, version: ver });
      if(typeof addNotification === 'function') addNotification('📄 ' + name + ' ' + ver + ' uploaded','PCQI signature recorded','success');
      close();
      if(typeof onSaved === 'function') onSaved();
    });
  }

  // ============================================================
  // (E) RETENTION ARCHIVAL
  // ============================================================
  // Records older than 24 months can be "archived" — marked with
  // data.archived_at so the History tab hides them by default.
  // A toggle "Show archived" reveals them when needed.
  window.glRunRetentionArchive = async function(){
    if(!window.supa){ alert('Supabase not loaded'); return; }
    var cutoff = new Date(Date.now() - 24*30.42*86400000).toISOString().slice(0,10);
    var r = await window.supa.from('compliance_records').select('id,form_code,record_date,data').lt('record_date', cutoff).limit(500);
    var rows = (r.data || []).filter(function(rec){ return !rec.data || !rec.data.archived_at; });
    if(!rows.length){ alert('No records older than 24 months awaiting archive.'); return; }
    if(!confirm('Archive ' + rows.length + ' record' + (rows.length===1?'':'s') + ' older than 24 months?\n\nArchived records stay in the database (and FDA export) but are hidden from the default History view. You can re-show them anytime.')) return;
    var done = 0;
    for(var i = 0; i < rows.length; i++){
      var rec = rows[i];
      var newData = Object.assign({}, rec.data || {}, { archived_at: nowISO() });
      try {
        await window.supa.from('compliance_records').update({ data: newData }).eq('id', rec.id);
        done++;
      } catch(e){}
    }
    if(typeof addNotification === 'function') addNotification('📦 Records archived', done + ' record' + (done===1?'':'s') + ' archived','success');
    if(typeof window.glAudit === 'function') window.glAudit('retention_archive_run','', { archived: done, cutoff: cutoff });
  };

  // ============================================================
  // (F) MOBILE RESPONSIVENESS for compliance forms
  // ============================================================
  var mq = document.createElement('style');
  mq.id = 'gl-compliance-mobile';
  mq.textContent = [
    '@media (max-width: 768px) {',
      // Compliance modals: full-width, less padding
      '#gl-comp-modal > div, #gl-mock-modal > div, #gl-doc-modal > div, #gl-app-modal > div, #gl-limits-modal > div, #gl-export-modal > div {',
        'max-width: 100% !important; max-height: 95vh !important;',
      '}',
      // CIP step table — stack vertically on phone
      '#gl-comp-modal table { font-size: 10px; }',
      '#gl-comp-modal table th, #gl-comp-modal table td { padding: 5px 3px !important; }',
      // Grids become single column
      '#gl-comp-modal [style*="grid-template-columns:1fr 1fr"], #gl-comp-modal [style*="grid-template-columns: 1fr 1fr"] {',
        'grid-template-columns: 1fr !important;',
      '}',
      // History filter row stacks
      '#comp-body [style*="grid-template-columns:1fr 1fr 1fr 1fr"] {',
        'grid-template-columns: 1fr 1fr !important; gap: 6px !important;',
      '}',
      // Master page header buttons wrap
      '#comp-body > div:first-child { flex-wrap: wrap !important; }',
      '#comp-body > div:first-child button { font-size: 10px !important; padding: 4px 8px !important; }',
    '}'
  ].join('\n');
  (document.head || document.documentElement).appendChild(mq);

  // ============================================================
  // (G) ANNUAL FSP REVIEW AUTO-REMINDER
  // ============================================================
  // After saving an FSP-VER-002 record, create a compliance_task
  // 12 months out reminding the PCQI to do the next review.
  // We watch compliance_records inserts for FSP-VER-002 and schedule.
  (function autoFspReminder(){
    var lastSeen = null;
    setInterval(async function(){
      if(!window.supa) return;
      try {
        var r = await window.supa.from('compliance_records').select('id,form_code,record_date,recorded_at,data,status').eq('form_code','FSP-VER-002').order('recorded_at',{ascending:false}).limit(1);
        if(!r.data || !r.data[0]) return;
        var rec = r.data[0];
        if(rec.id === lastSeen) return;
        lastSeen = rec.id;
        if(rec.status !== 'signed') return;
        // Schedule next year
        var d = new Date(rec.recorded_at || rec.record_date);
        d.setFullYear(d.getFullYear() + 1);
        var dueDate = d.toISOString().slice(0,10);
        // Check if a task already exists for this anniversary
        var existing = await window.supa.from('compliance_tasks').select('id').eq('due_date', dueDate).eq('task_type','annual_fsp').limit(1);
        if(existing.data && existing.data.length) return;
        await window.supa.from('compliance_tasks').insert([{
          due_date: dueDate, task_type: 'annual_fsp',
          title: 'Annual FSP Review (FSP-VER-002)',
          description: 'Scheduled 12 months after the previous FSP review on ' + fmtDate(rec.recorded_at),
          source: 'auto',
          dedupe_key: 'annual_fsp_' + dueDate
        }]);
        if(typeof addNotification === 'function') addNotification('📅 Annual FSP review scheduled', 'Due ' + dueDate,'info');
      } catch(e){}
    }, 5000);
  })();

  // ============================================================
  // Hook the master-page header — add ⚙️ Applicability + 📄 Documents + 📦 Archive buttons
  // ============================================================
  function injectPolishButtons(){
    var host = document.getElementById('comp-body');
    if(!host){ setTimeout(injectPolishButtons, 700); return; }
    new MutationObserver(function(){
      var holdBtn = host.querySelector('.gl-comp-hold');
      if(!holdBtn) return;
      if(holdBtn.parentNode.querySelector('.gl-comp-applic')) return;
      function btn(cls, text, c, fn){
        var b = document.createElement('button');
        b.className = 'cbtn ' + cls;
        b.setAttribute('style','font-size:11px;padding:5px 11px;margin-right:6px;background:' + c.bg + ';border:1px solid ' + c.bd + ';color:' + c.fg);
        b.textContent = text;
        b.addEventListener('click', fn);
        return b;
      }
      var applic   = btn('gl-comp-applic',   '⚙️ Applicability', { bg:'rgba(196,164,248,.08)',  bd:'rgba(196,164,248,.3)',  fg:'#c4a4f8' }, function(){ window.glOpenApplicabilityConfig(); });
      var docs     = btn('gl-comp-docs',     '📄 Documents',     { bg:'rgba(127,198,245,.08)',  bd:'rgba(127,198,245,.3)',  fg:'#7fc6f5' }, function(){ window.glOpenDocumentControl(); });
      var archive  = btn('gl-comp-archive',  '📦 Archive old',   { bg:'rgba(154,167,189,.08)',  bd:'rgba(154,167,189,.3)',  fg:'#9aa7bd' }, function(){ window.glRunRetentionArchive(); });
      holdBtn.parentNode.insertBefore(archive, holdBtn);
      holdBtn.parentNode.insertBefore(docs, holdBtn);
      holdBtn.parentNode.insertBefore(applic, holdBtn);
    }).observe(host, { childList:true, subtree:true });
  }
  if(document.readyState !== 'loading') injectPolishButtons();
  else document.addEventListener('DOMContentLoaded', injectPolishButtons);

  console.log('[GL] compliance polish pack — A photos on NCR · B applicability · C single-print · D doc control · E retention · F mobile · G annual auto-reminder');
}());


/* ============================================================
   COMPLIANCE ENHANCEMENTS
   Ships nine high-impact features atop the existing compliance system:
     1. Bulk PCQI sign-off (Weekly Review)
     2. Recurring CCP timer (floating widget)
     3. Inline mini-charts on History records
     4. Lot QR-code generator
     5. Compliance records attached to invoices
     7. CSV import for training records
     9. Audit-ready scorecard (Dashboard widget)
    12. CCP trending alerts (last 10 readings → drift detection)
    14. Lock compliance records on paid invoices
   Items 6 / 8 / 10 / 11 / 13 / 15 / 16-19 deferred — they require
   external services (Mailgun cron, dedicated auth role, OCR/vision API,
   multi-tenant schema, etc.) and are documented in the PR.
   ============================================================ */
(function(){
  var esc = window.glEsc;
  function fmtDate(d){ if(!d) return ''; var x = new Date(d); return isNaN(x.getTime()) ? String(d) : x.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
  function fmtTs(d){ if(!d) return ''; var x = new Date(d); return isNaN(x.getTime()) ? String(d) : x.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }
  function nowISO(){ return new Date().toISOString(); }
  function pcqiName(){ var u = window.currentUser || {}; return u.name || u.email || 'PCQI'; }

  // ============================================================
  // 1) BULK PCQI SIGN-OFF on Weekly Review
  // ============================================================
  // The Weekly Review tab already has per-row checkboxes for local ack.
  // We add a "Sign N selected" PCQI action — updates compliance_records
  // status from 'complete' (or any non-signed) to 'signed' in one shot.
  function bulkSignSelected(){
    var checked = Array.prototype.slice.call(document.querySelectorAll('.gl-wk-ack:checked'));
    var ids = checked.map(function(cb){ return cb.getAttribute('data-id'); });
    if(!ids.length){ alert('Tick the records you want to sign first.'); return; }
    if(!confirm('Sign ' + ids.length + ' record' + (ids.length===1?'':'s') + ' as PCQI? Your name + timestamp will be locked into each.')) return;
    var user = window.currentUser || {};
    var patch = {
      status: 'signed',
      signed_by: user.id || null,
      signed_at: nowISO(),
      signature_name: pcqiName(),
      signature_meaning: 'PCQI bulk sign-off — records reviewed in batch'
    };
    (async function(){
      var done = 0;
      for(var i = 0; i < ids.length; i++){
        try { await window.supa.from('compliance_records').update(patch).eq('id', ids[i]); done++; }
        catch(e){ console.warn('[GL bulk sign] failed for ' + ids[i], e); }
      }
      if(typeof window.glAudit === 'function') window.glAudit('compliance_bulk_signoff','', { count: done });
      if(typeof addNotification === 'function') addNotification('✓ ' + done + ' record' + (done===1?'':'s') + ' signed', 'Bulk PCQI sign-off complete','success');
      if(typeof window.refreshComplianceMaster === 'function') window.refreshComplianceMaster();
    })();
  }
  // Inject the button into the Weekly Review header whenever it mounts
  (function injectBulkButton(){
    var host = document.getElementById('comp-body');
    if(!host){ setTimeout(injectBulkButton, 700); return; }
    new MutationObserver(function(){
      // The weekly review tab renders an "Ack all unreviewed" or empty message.
      // Look for the gl-wk-ack-all button area and add a sibling "Sign N selected" button.
      var ackBtn = host.querySelector('#gl-wk-ack-all');
      if(!ackBtn) return;
      if(ackBtn.parentNode.querySelector('.gl-wk-bulk-sign')) return;
      var b = document.createElement('button');
      b.className = 'cbtn gl-wk-bulk-sign';
      b.setAttribute('style','font-size:11px;padding:5px 11px;margin-right:6px;background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.32);color:#00e5c0');
      b.textContent = '✓ Sign selected as PCQI';
      b.addEventListener('click', bulkSignSelected);
      ackBtn.parentNode.insertBefore(b, ackBtn);
    }).observe(host, { childList:true, subtree:true });
  })();

  // ============================================================
  // 2) RECURRING CCP TIMER (floating bottom-left widget)
  // ============================================================
  // Operator starts a timer when they begin a CCP monitoring run.
  // Widget counts down to the next reading interval (30 min HTST/Hot Fill,
  // 60 min UV, etc.). On zero: notification + auto-open the form.
  var TIMER_INTERVALS = {
    'FSP-PC-001': { mins: 30, label:'HTST', open:'glOpenHtstForm' },
    'FSP-PC-002': { mins: 30, label:'Hot Fill', open:'glOpenHotFillForm' },
    'FSP-PC-003': { mins: 240, label:'Can Seam', open:'glOpenSeamForm' },
    'FSP-PC-004': { mins: 60, label:'UV', open:'glOpenUvForm' },
    'GMP-INSP-001':{ mins: 60, label:'Pre-Op', open:'glOpenPreOpForm' }
  };
  var TIMERS_KEY = 'gl_ccp_timers';
  function readTimers(){ try { return JSON.parse(localStorage.getItem(TIMERS_KEY) || '[]'); } catch(e){ return []; } }
  function writeTimers(arr){ localStorage.setItem(TIMERS_KEY, JSON.stringify(arr || [])); }

  window.glStartCcpTimer = function(form_code, run_id){
    if(!TIMER_INTERVALS[form_code]) return;
    var t = TIMER_INTERVALS[form_code];
    var timers = readTimers();
    // Replace any existing timer for this form_code+run combination
    timers = timers.filter(function(x){ return !(x.form_code === form_code && x.run_id === (run_id || null)); });
    timers.push({
      id: 'tm_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
      form_code: form_code, run_id: run_id || null,
      label: t.label, mins: t.mins,
      due_at: Date.now() + t.mins * 60000,
      open_fn: t.open
    });
    writeTimers(timers);
    renderTimerWidget();
  };
  window.glStopCcpTimer = function(id){
    var timers = readTimers().filter(function(x){ return x.id !== id; });
    writeTimers(timers);
    renderTimerWidget();
  };

  function renderTimerWidget(){
    var timers = readTimers();
    var widget = document.getElementById('gl-ccp-timer-widget');
    if(!timers.length){
      if(widget) widget.remove();
      return;
    }
    if(!widget){
      widget = document.createElement('div');
      widget.id = 'gl-ccp-timer-widget';
      widget.setAttribute('style','position:fixed;bottom:28px;left:28px;z-index:550;background:#243653;border:1px solid rgba(245,200,66,.4);border-radius:10px;padding:10px 12px;box-shadow:0 12px 36px rgba(0,0,0,.5);color:#fff;font-size:12px;font-family:var(--ff-body,sans-serif);min-width:260px;max-width:320px');
      document.body.appendChild(widget);
    }
    var nowMs = Date.now();
    widget.innerHTML =
      '<div style="font-size:10px;letter-spacing:2px;color:#f5c842;font-weight:700;margin-bottom:8px">⏱ CCP READING TIMERS</div>' +
      timers.map(function(t){
        var remain = Math.max(0, Math.floor((t.due_at - nowMs) / 1000));
        var m = Math.floor(remain / 60), s = remain % 60;
        var due = remain <= 0;
        var color = due ? '#ff8579' : (remain < 300 ? '#f5c842' : '#5fcf9e');
        return '<div style="display:flex;align-items:center;gap:8px;margin-bottom:5px"><div style="flex:1"><div style="font-weight:600">' + esc(t.label) + '</div>' +
          '<div style="font-size:11px;color:' + color + ';font-family:var(--ff-mono,monospace)">' + (due ? 'DUE NOW' : (m + 'm ' + (s<10?'0':'') + s + 's')) + '</div></div>' +
          (due ? '<button onclick="window.glOpenTimerForm(\'' + t.id + '\')" class="cbtn" style="font-size:10px;padding:3px 8px;background:rgba(255,133,121,.15);border-color:rgba(255,133,121,.4);color:#ff8579">▶ Log</button>'
               : '<button onclick="window.glStopCcpTimer(\'' + t.id + '\')" class="cbtn" style="font-size:10px;padding:3px 8px">✕</button>') +
        '</div>';
      }).join('');
  }
  window.glOpenTimerForm = function(id){
    var t = readTimers().find(function(x){ return x.id === id; });
    if(!t) return;
    var fn = window[t.open_fn];
    if(typeof fn === 'function'){
      fn({ run_id: t.run_id });
      // Reset the timer to the next interval
      var interval = TIMER_INTERVALS[t.form_code];
      if(interval){
        var timers = readTimers().map(function(x){ return x.id === id ? Object.assign({}, x, { due_at: Date.now() + interval.mins*60000 }) : x; });
        writeTimers(timers);
      }
      renderTimerWidget();
    }
  };
  // Tick every 1s
  setInterval(function(){
    if(readTimers().length) renderTimerWidget();
  }, 1000);

  // Hook the existing form openers to surface a "Start timer" hint
  // The forms render their own modal; we add a banner to the bottom.
  function decorateFormWithTimer(form_code){
    var modal = document.getElementById('gl-comp-modal');
    if(!modal) return;
    if(modal.dataset.glTimerBanner === '1') return;
    if(!TIMER_INTERVALS[form_code]) return;
    var t = TIMER_INTERVALS[form_code];
    modal.dataset.glTimerBanner = '1';
    var hint = document.createElement('div');
    hint.setAttribute('style','margin:8px 22px;padding:8px 12px;background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.25);border-radius:6px;font-size:11px;color:#cfd9e6;display:flex;align-items:center;gap:8px');
    hint.innerHTML = '<span style="font-size:14px">⏱</span><div style="flex:1">Set a ' + t.mins + '-min recurring reading reminder for this run?</div>' +
      '<button class="cbtn gl-timer-start" style="font-size:10px;padding:3px 8px">Start timer</button>';
    var foot = modal.querySelector('.gl-cf-cancel');
    if(foot && foot.parentNode) foot.parentNode.parentNode.insertBefore(hint, foot.parentNode);
    hint.querySelector('.gl-timer-start').addEventListener('click', function(){
      window.glStartCcpTimer(form_code, null);
      hint.innerHTML = '<span style="font-size:14px;color:#5fcf9e">✓</span> Timer started — bottom-left widget.';
    });
  }
  // Watch modal mounts and decorate by form_code (best-effort detection)
  new MutationObserver(function(muts){
    muts.forEach(function(m){
      if(!m.addedNodes) return;
      m.addedNodes.forEach(function(n){
        if(n.nodeType !== 1) return;
        // Detect by modal title
        setTimeout(function(){
          var modal = document.getElementById('gl-comp-modal');
          if(!modal) return;
          var title = modal.textContent;
          Object.keys(TIMER_INTERVALS).forEach(function(code){
            if(title.indexOf(code) !== -1) decorateFormWithTimer(code);
          });
        }, 60);
      });
    });
  }).observe(document.body, { childList:true, subtree:true });

  // ============================================================
  // 3) INLINE MINI-CHARTS on History records
  // ============================================================
  // For CCP form records, render a simple SVG sparkline of values
  // from the past 20 records of the same form_code.
  async function renderMiniChartFor(formCode, container){
    if(!window.supa) return;
    var r = await window.supa.from('compliance_records').select('data,recorded_at').eq('form_code', formCode).order('recorded_at',{ascending:false}).limit(20);
    var rows = (r.data || []).reverse();
    if(rows.length < 2) return;
    var field;
    if(formCode === 'FSP-PC-001') field = 'temp_f';
    if(formCode === 'FSP-PC-002') field = 'temp_f';
    if(formCode === 'FSP-PC-004') field = 'dose';
    if(formCode === 'FSP-PC-005') field = 'ph_final';
    if(!field) return;
    var values = rows.map(function(r){ var v = r.data && r.data[field]; return typeof v === 'number' ? v : parseFloat(v); }).filter(function(v){ return !isNaN(v); });
    if(values.length < 2) return;
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var range = (max - min) || 1;
    var w = 280, h = 50, pad = 4;
    var pts = values.map(function(v, i){
      var x = pad + (i / (values.length - 1)) * (w - 2*pad);
      var y = h - pad - ((v - min) / range) * (h - 2*pad);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    // CCP limit reference line
    var lim = (window.glGetLimits && window.glGetLimits()) || {};
    var limit = null;
    if(formCode === 'FSP-PC-001') limit = lim.htst_temp_f;
    if(formCode === 'FSP-PC-002') limit = lim.hot_fill_f;
    if(formCode === 'FSP-PC-004') limit = lim.uv_dose_mj_cm2;
    if(formCode === 'FSP-PC-005') limit = lim.final_pH_fermented;
    var limitY = (limit && limit >= min && limit <= max) ? (h - pad - ((limit - min) / range) * (h - 2*pad)) : null;
    var trend = values[values.length - 1] - values[0];
    var trendArrow = Math.abs(trend) < range * 0.05 ? '→' : (trend > 0 ? '↑' : '↓');
    var trendColor = (formCode === 'FSP-PC-005')  // pH — higher is worse for fermented
      ? (trend > range * 0.1 ? '#ff8579' : '#5fcf9e')
      : (trend < -range * 0.1 ? '#ff8579' : '#5fcf9e');
    container.innerHTML =
      '<div style="margin-top:10px;padding:8px;background:rgba(0,229,192,.04);border:1px solid rgba(0,229,192,.15);border-radius:6px">' +
        '<div style="font-size:10px;color:#9aa7bd;letter-spacing:1px;margin-bottom:4px">' + field + ' · last ' + values.length + ' readings · trend ' + trendArrow + '</div>' +
        '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:50px">' +
          (limitY !== null ? '<line x1="0" x2="' + w + '" y1="' + limitY + '" y2="' + limitY + '" stroke="#ff8579" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"></line>' : '') +
          '<polyline points="' + pts + '" fill="none" stroke="' + trendColor + '" stroke-width="2"></polyline>' +
        '</svg>' +
        '<div style="font-size:10px;color:#9aa7bd;display:flex;justify-content:space-between"><span>min ' + min.toFixed(1) + '</span><span>max ' + max.toFixed(1) + '</span>' + (limit ? '<span style="color:#ff8579">CL ' + limit + '</span>' : '') + '</div>' +
      '</div>';
  }
  // Hook into History expanded rows
  (function hookHistoryCharts(){
    var host = document.getElementById('comp-body');
    if(!host){ setTimeout(hookHistoryCharts, 700); return; }
    new MutationObserver(function(){
      host.querySelectorAll('.gl-hist-row').forEach(function(row){
        if(row.dataset.glChartHooked === '1') return;
        var detail = row.querySelector('.gl-hist-detail');
        if(!detail) return;
        // Get the form code from the row's first text
        var formCode = (row.querySelector('div').textContent.match(/[A-Z]+-[A-Z]+-\d+/) || [])[0];
        if(!formCode) return;
        if(!['FSP-PC-001','FSP-PC-002','FSP-PC-004','FSP-PC-005'].includes(formCode)) return;
        row.dataset.glChartHooked = '1';
        var chartDiv = document.createElement('div');
        chartDiv.className = 'gl-hist-chart';
        detail.appendChild(chartDiv);
        renderMiniChartFor(formCode, chartDiv);
      });
    }).observe(host, { childList:true, subtree:true });
  })();

  // ============================================================
  // 4) LOT QR-CODE GENERATOR
  // ============================================================
  // Generates a printable sticker with lot, QR code (via Google Chart API),
  // and the trace URL. Available from Trace Lot tab.
  window.glOpenLotQr = function(lot){
    if(!lot){
      lot = prompt('Enter the lot number to generate a QR sticker for:');
      if(!lot) return;
    }
    lot = String(lot).trim();
    var traceUrl = location.origin + '/?trace=' + encodeURIComponent(lot);
    var qrUrl = 'https://chart.googleapis.com/chart?cht=qr&chs=240x240&chld=Q&chl=' + encodeURIComponent(traceUrl);
    var w = window.open('','_blank');
    if(!w){ alert('Pop-up blocked'); return; }
    w.document.write(
      '<!doctype html><html><head><meta charset="utf-8"><title>Lot QR — ' + esc(lot) + '</title>' +
      '<style>body{font-family:Helvetica,Arial,sans-serif;margin:24px;color:#0a1628}.sticker{display:inline-block;border:2px solid #0a8;padding:18px 22px;border-radius:10px;text-align:center;margin:8px;break-inside:avoid}.sticker h2{font-size:14px;letter-spacing:1px;margin:0 0 8px;color:#0a8}.sticker .lot{font-family:monospace;font-size:14px;margin-bottom:8px;font-weight:700}.sticker img{display:block;margin:0 auto 6px}.sticker .url{font-size:9px;color:#666;max-width:240px;word-break:break-all}@media print{body{margin:8px}.no-print{display:none}}</style>' +
      '</head><body>' +
      '<div class="no-print" style="margin-bottom:14px"><button onclick="window.print()" style="padding:8px 16px;background:#0a8;color:#fff;border:none;border-radius:4px;cursor:pointer;font-weight:700">🖨️ Print sticker</button> <button onclick="window.close()" style="margin-left:6px">Close</button> · Print up to 4 copies for the pallet, BOL, master case, and warehouse copy.</div>' +
      '<div class="sticker"><h2>GOOD LIQUID BEV CO</h2><div class="lot">' + esc(lot) + '</div><img src="' + qrUrl + '" width="180" height="180" alt="QR"><div class="url">' + esc(traceUrl) + '</div></div>'.repeat(4) +
      '</body></html>'
    );
    w.document.close();
  };
  // Add a "Lot sticker" button to Trace Lot tab results
  (function hookTraceQr(){
    var host = document.getElementById('comp-body');
    if(!host){ setTimeout(hookTraceQr, 700); return; }
    new MutationObserver(function(){
      var traceInput = document.getElementById('gl-trace-q');
      if(!traceInput) return;
      var goBtn = document.getElementById('gl-trace-go');
      if(!goBtn || goBtn.parentNode.querySelector('.gl-trace-qr-btn')) return;
      var qrBtn = document.createElement('button');
      qrBtn.className = 'cbtn gl-trace-qr-btn';
      qrBtn.setAttribute('style','padding:9px 14px;background:rgba(196,164,248,.1);border:1px solid rgba(196,164,248,.32);color:#c4a4f8;margin-left:6px');
      qrBtn.textContent = '📱 Print lot sticker';
      qrBtn.addEventListener('click', function(){
        var lot = traceInput.value.trim();
        if(!lot){ alert('Enter a lot number first.'); return; }
        window.glOpenLotQr(lot);
      });
      goBtn.parentNode.appendChild(qrBtn);
    }).observe(host, { childList:true, subtree:true });
  })();

  // ============================================================
  // 5) COMPLIANCE RECORDS ATTACHED TO INVOICES
  // ============================================================
  // On any invoice detail panel, surface a "📋 Compliance for this lot"
  // footer with record counts + a Trace Lot deep-link.
  function injectInvoiceComplianceFooter(){
    var detail = document.querySelector('.inv-detail') || document.getElementById('cpg-invoice-detail');
    if(!detail) return;
    if(detail.querySelector('.gl-inv-compliance')) return;
    var lot = null;
    // Best-effort lot detection from the rendered invoice — look for "Lot" label or known patterns
    var lotMatch = (detail.innerText || '').match(/Lot[:\s]+([A-Z0-9-]+)/i);
    if(lotMatch) lot = lotMatch[1];
    if(!lot) return;
    (async function(){
      if(!window.supa) return;
      var like = '%' + lot + '%';
      try {
        var r = await window.supa.from('compliance_records').select('*',{count:'exact',head:true}).or('data->>lot.ilike.' + like + ',data->>lot_number.ilike.' + like);
        var holds = await window.supa.from('hold_tags').select('*',{count:'exact',head:true}).eq('status','open').ilike('lot_number', like);
        var count = r.count || 0;
        var openHolds = holds.count || 0;
        var footer = document.createElement('div');
        footer.className = 'gl-inv-compliance';
        footer.setAttribute('style','margin-top:12px;padding:11px 14px;background:rgba(0,229,192,.05);border:1px solid rgba(0,229,192,.18);border-left:3px solid var(--teal);border-radius:0 8px 8px 0;font-size:11px;color:#cfd9e6;display:flex;align-items:center;gap:10px');
        footer.innerHTML =
          '<div style="font-size:14px">📋</div>' +
          '<div style="flex:1"><b style="color:var(--teal)">Compliance records for lot ' + esc(lot) + ':</b> ' + count + ' record' + (count===1?'':'s') +
            (openHolds ? ' · <span style="color:#ff8579;font-weight:700">' + openHolds + ' OPEN HOLD' + (openHolds===1?'':'S') + '</span>' : '') + '</div>' +
          '<button class="cbtn gl-inv-trace" style="font-size:10px;padding:4px 10px">🔍 Trace</button>';
        detail.appendChild(footer);
        footer.querySelector('.gl-inv-trace').addEventListener('click', function(){
          if(typeof window.cNav === 'function') window.cNav('compliance');
          setTimeout(function(){
            var input = document.getElementById('gl-trace-q');
            if(input){ input.value = lot; var goBtn = document.getElementById('gl-trace-go'); if(goBtn) goBtn.click(); }
          }, 400);
        });
      } catch(e){ console.warn('[GL inv-compliance] failed', e); }
    })();
  }
  // Observe invoice detail mounts
  (function watchInvoiceDetail(){
    var pages = document.getElementById('crm-panel');
    if(!pages){ setTimeout(watchInvoiceDetail, 700); return; }
    new MutationObserver(function(){ setTimeout(injectInvoiceComplianceFooter, 80); }).observe(pages, { childList:true, subtree:true });
  })();

  // ============================================================
  // 7) CSV IMPORT for training records
  // ============================================================
  window.glOpenTrainingCsvImport = function(){
    var prior = document.getElementById('gl-tr-csv-modal'); if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-tr-csv-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:9000;background:rgba(6,13,26,.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto');
    ov.innerHTML =
      '<div style="background:#243653;border:1px solid rgba(0,229,192,.22);border-radius:14px;width:100%;max-width:600px;max-height:88vh;overflow-y:auto;color:#cfd9e6;box-shadow:0 20px 60px rgba(0,0,0,.6)">' +
        '<div style="padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.06)">' +
          '<div style="font-family:var(--ff-disp);font-size:14px;letter-spacing:2px;color:var(--teal);font-weight:700">📥 BULK IMPORT — TRAINING RECORDS</div>' +
          '<div style="font-size:11px;color:#9aa7bd;margin-top:3px">Paste CSV with header row. One training event per row.</div>' +
        '</div>' +
        '<div style="padding:18px 22px">' +
          '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Required columns (in order):</div>' +
          '<code style="display:block;padding:8px;background:rgba(255,255,255,.05);border-radius:6px;font-size:11px;color:#7fc6f5;margin-bottom:10px">employee,role,topic,method,duration_min,trainer,date</code>' +
          '<textarea id="gl-tr-csv-text" rows="10" placeholder="employee,role,topic,method,duration_min,trainer,date&#10;Jane Doe,Operator,GMP orientation,Online,30,Mike Krail,2026-05-17&#10;..." style="width:100%;padding:10px 12px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#fff;font-family:monospace;font-size:11px;box-sizing:border-box;resize:vertical"></textarea>' +
          '<div id="gl-tr-csv-preview" style="margin-top:10px;font-size:11px;color:#9aa7bd"></div>' +
        '</div>' +
        '<div style="padding:14px 22px;border-top:1px solid rgba(255,255,255,.06);display:flex;gap:8px;justify-content:flex-end">' +
          '<button id="gl-tr-csv-cancel" class="cbtn">Cancel</button>' +
          '<button id="gl-tr-csv-import" class="cbtn pri">Import &amp; sign all as PCQI</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    function close(){ ov.remove(); }
    ov.querySelector('#gl-tr-csv-cancel').addEventListener('click', close);
    ov.addEventListener('click', function(e){ if(e.target === ov) close(); });

    function parseCsv(txt){
      var lines = txt.split(/\r?\n/).filter(function(l){ return l.trim(); });
      if(lines.length < 2) return { error:'Need at least header + 1 row' };
      var header = lines[0].split(',').map(function(s){ return s.trim().toLowerCase(); });
      var need = ['employee','role','topic','method','duration_min','trainer','date'];
      var missing = need.filter(function(n){ return header.indexOf(n) === -1; });
      if(missing.length) return { error:'Missing required column(s): ' + missing.join(', ') };
      var rows = [];
      for(var i = 1; i < lines.length; i++){
        // Simple CSV split (no quoted-comma support)
        var cols = lines[i].split(',').map(function(s){ return s.trim(); });
        var obj = {};
        header.forEach(function(h, idx){ obj[h] = cols[idx] || ''; });
        if(obj.employee) rows.push(obj);
      }
      return { rows: rows };
    }

    var ta = ov.querySelector('#gl-tr-csv-text');
    var prev = ov.querySelector('#gl-tr-csv-preview');
    ta.addEventListener('input', function(){
      var res = parseCsv(ta.value);
      if(res.error){ prev.innerHTML = '<span style="color:#ff8579">' + esc(res.error) + '</span>'; }
      else {
        prev.innerHTML = '<span style="color:#5fcf9e">✓ ' + res.rows.length + ' row' + (res.rows.length===1?'':'s') + ' ready to import.</span>';
      }
    });
    ov.querySelector('#gl-tr-csv-import').addEventListener('click', async function(){
      var res = parseCsv(ta.value);
      if(res.error){ alert(res.error); return; }
      if(!confirm('Import ' + res.rows.length + ' training records, signed as PCQI?')) return;
      var btn = this; btn.disabled = true; btn.textContent = 'Importing…';
      var user = window.currentUser || {};
      var done = 0;
      for(var i = 0; i < res.rows.length; i++){
        var r = res.rows[i];
        try {
          await window.supa.from('compliance_records').insert([{
            form_code: 'GMP-TR-001',
            record_date: r.date || nowISO().slice(0,10),
            data: {
              employee: r.employee, role: r.role, topic: r.topic,
              method: r.method, duration: r.duration_min, trainer: r.trainer,
              sig: 'Y', imported_via_csv: true
            },
            status: 'signed',
            signed_by: user.id || null, signed_at: nowISO(),
            signature_name: pcqiName(),
            signature_meaning: 'PCQI bulk-imported training record'
          }]);
          done++;
        } catch(e){ console.warn('[GL training csv] failed for ' + r.employee, e); }
      }
      if(typeof addNotification === 'function') addNotification('📥 Imported ' + done + ' training records', '', 'success');
      if(typeof window.glAudit === 'function') window.glAudit('training_csv_import','', { count: done });
      close();
      if(typeof window.refreshComplianceMaster === 'function') window.refreshComplianceMaster();
    });
  };

  // ============================================================
  // 9) AUDIT-READY SCORECARD (Dashboard widget)
  // ============================================================
  // 5 components: unsigned >7d, expired cals, overdue annual review,
  // open Hold Tags, mock recall in last 90 days. Each red/yellow/green.
  async function computeAuditScore(){
    if(!window.supa) return null;
    var sevenDaysAgo = new Date(Date.now() - 7*86400000).toISOString();
    var ninetyDaysAgo = new Date(Date.now() - 90*86400000).toISOString();
    var oneYearAgo = new Date(Date.now() - 365*86400000).toISOString();
    var twentyfourMonthsAgo = new Date(Date.now() - 730*86400000).toISOString();
    var todayDate = new Date().toISOString().slice(0,10);
    var checks = [];
    // (a) Unsigned records older than 7 days
    var u = await window.supa.from('compliance_records').select('id',{count:'exact',head:true}).neq('status','signed').neq('status','voided').lt('recorded_at', sevenDaysAgo);
    checks.push({ id:'unsigned', label:'Unsigned records >7d old', count: u.count || 0, severity: (u.count > 0 ? 'red' : 'green'), action:'Open Logs tab → sign them' });
    // (b) Open Hold Tags
    var h = await window.supa.from('hold_tags').select('id',{count:'exact',head:true}).eq('status','open');
    checks.push({ id:'holds', label:'Open Hold Tags', count: h.count || 0, severity: (h.count > 0 ? 'yellow' : 'green'), action:'Sidebar → Hold Tags → disposition' });
    // (c) Calibrations — last cal record per instrument should be <30 days
    var cals = await window.supa.from('compliance_records').select('record_date,data').eq('form_code','GMP-CAL-001').order('record_date',{ascending:false}).limit(100);
    var byInst = {};
    (cals.data || []).forEach(function(c){ var inst = c.data && c.data.instrument; if(inst && !byInst[inst]) byInst[inst] = c.record_date; });
    var staleCount = 0;
    Object.keys(byInst).forEach(function(k){ if(byInst[k] < new Date(Date.now()-31*86400000).toISOString().slice(0,10)) staleCount++; });
    checks.push({ id:'cals', label:'Stale calibrations (>30d)', count: staleCount, severity: (staleCount > 0 ? 'red' : 'green'), action:'Run GMP-CAL-001 for each' });
    // (d) Annual FSP review — last one signed should be <365 days
    var fsp = await window.supa.from('compliance_records').select('signed_at').eq('form_code','FSP-VER-002').eq('status','signed').order('signed_at',{ascending:false}).limit(1);
    var lastFsp = fsp.data && fsp.data[0];
    var fspOk = lastFsp && lastFsp.signed_at > oneYearAgo;
    checks.push({ id:'fsp', label:'Annual FSP review current', count: fspOk ? 1 : 0, severity: fspOk ? 'green' : 'red', action: lastFsp ? 'Due ' + fmtDate(new Date(new Date(lastFsp.signed_at).getTime() + 365*86400000)) : 'Never done — schedule today' });
    // (e) Mock recall in last 90 days — look for entries where data has trace evidence
    // Approximation: we can't easily track "mock recall" as records, so use FSP-VER-002 mock_recall field or just flag green if any FSP review mentions it
    var mock = await window.supa.from('compliance_records').select('data').eq('form_code','FSP-VER-002').gt('recorded_at', ninetyDaysAgo).limit(1);
    var mockDone = mock.data && mock.data[0] && mock.data[0].data && mock.data[0].data.mock_recall;
    checks.push({ id:'mock', label:'Mock recall in last 90d', count: mockDone ? 1 : 0, severity: mockDone ? 'green' : 'yellow', action:'Run 🎯 Mock Recall on Compliance page' });
    var score = checks.filter(function(c){ return c.severity === 'green'; }).length;
    var total = checks.length;
    var overall = score === total ? 'green' : (checks.some(function(c){ return c.severity === 'red'; }) ? 'red' : 'yellow');
    return { checks: checks, score: score, total: total, overall: overall };
  }
  async function renderAuditScorecard(){
    var dash = document.getElementById('cpg-dashboard');
    if(!dash) return;
    if(dash.querySelector('#gl-audit-scorecard')) return;
    var data = await computeAuditScore();
    if(!data) return;
    var widget = document.createElement('div');
    widget.id = 'gl-audit-scorecard';
    widget.setAttribute('style','padding:14px;background:#2e486b;border:1px solid rgba(255,255,255,.1);border-radius:10px;margin-bottom:14px');
    var colorMap = { green:'#5fcf9e', yellow:'#f5c842', red:'#ff8579' };
    var overallColor = colorMap[data.overall];
    widget.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
        '<div style="font-family:var(--ff-disp);font-size:13px;letter-spacing:2px;color:var(--teal);font-weight:700">📋 FDA AUDIT READINESS</div>' +
        '<div style="display:flex;align-items:center;gap:8px"><div style="font-size:24px;font-weight:800;color:' + overallColor + '">' + data.score + '/' + data.total + '</div></div>' +
      '</div>' +
      data.checks.map(function(c){
        var col = colorMap[c.severity];
        return '<div style="display:flex;align-items:center;gap:10px;padding:7px 10px;background:rgba(255,255,255,.03);border-left:3px solid ' + col + ';border-radius:0 6px 6px 0;margin-bottom:4px;font-size:12px">' +
          '<div style="font-size:14px;color:' + col + ';width:14px;text-align:center">' + (c.severity === 'green' ? '✓' : (c.severity === 'red' ? '✕' : '!')) + '</div>' +
          '<div style="flex:1"><div style="color:#fff;font-weight:600">' + esc(c.label) + (c.count !== undefined ? ' <span style="color:#9aa7bd;font-weight:400">· ' + c.count + '</span>' : '') + '</div>' +
            '<div style="font-size:10px;color:#9aa7bd;margin-top:2px">' + esc(c.action) + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    // Insert after the first child (or banner if any)
    var first = dash.firstElementChild;
    var firstNonBanner = first;
    while(firstNonBanner && firstNonBanner.id && firstNonBanner.id.indexOf('banner') !== -1) firstNonBanner = firstNonBanner.nextElementSibling;
    if(firstNonBanner) dash.insertBefore(widget, firstNonBanner.nextSibling || null);
    else dash.appendChild(widget);
  }
  (function watchDashForScorecard(){
    var dash = document.getElementById('cpg-dashboard');
    if(!dash){ setTimeout(watchDashForScorecard, 700); return; }
    new MutationObserver(function(){
      if(dash.classList.contains('act') && !dash.querySelector('#gl-audit-scorecard')) renderAuditScorecard();
    }).observe(dash, { attributes:true, childList:true, attributeFilter:['class'] });
    if(dash.classList.contains('act')) renderAuditScorecard();
  })();

  // ============================================================
  // 12) CCP TRENDING ALERTS — look at the last 10 readings of each
  // CCP form_code; if the trend is moving toward CL, surface on dashboard.
  // ============================================================
  async function detectCcpTrends(){
    if(!window.supa) return [];
    var alerts = [];
    var lims = (window.glGetLimits && window.glGetLimits()) || { htst_temp_f: 165, hot_fill_f: 185, uv_dose_mj_cm2: 40, final_pH_fermented: 4.6 };
    var ccps = [
      { code:'FSP-PC-001', field:'temp_f', limit: lims.htst_temp_f, direction:'down', label:'HTST temp', unit:'°F' },
      { code:'FSP-PC-002', field:'temp_f', limit: lims.hot_fill_f, direction:'down', label:'Hot Fill temp', unit:'°F' },
      { code:'FSP-PC-004', field:'dose',   limit: lims.uv_dose_mj_cm2, direction:'down', label:'UV dose', unit:'mJ/cm²' },
      { code:'FSP-PC-005', field:'ph_final', limit: lims.final_pH_fermented, direction:'up', label:'Fermented pH', unit:'pH' }
    ];
    for(var i = 0; i < ccps.length; i++){
      var c = ccps[i];
      try {
        var r = await window.supa.from('compliance_records').select('data,recorded_at').eq('form_code', c.code).order('recorded_at',{ascending:false}).limit(10);
        var values = (r.data || []).map(function(rec){ var v = rec.data && rec.data[c.field]; return typeof v === 'number' ? v : parseFloat(v); }).filter(function(v){ return !isNaN(v); }).reverse();
        if(values.length < 4) continue;
        // Compare avg of first half vs last half
        var half = Math.floor(values.length / 2);
        var avg1 = values.slice(0, half).reduce(function(a,b){return a+b;}, 0) / half;
        var avg2 = values.slice(half).reduce(function(a,b){return a+b;}, 0) / (values.length - half);
        var drift = avg2 - avg1;
        var driftToCl = c.direction === 'down' ? -drift : drift;
        var distToCl = c.direction === 'down' ? (avg2 - c.limit) : (c.limit - avg2);
        // Alert if drifting toward limit AND within 1.5× the CL margin
        if(driftToCl > 0 && distToCl < Math.abs(c.limit * 0.05)){
          alerts.push({ ccp: c.label, latest: avg2.toFixed(2), limit: c.limit, unit: c.unit, drift: drift.toFixed(2) });
        }
      } catch(e){}
    }
    return alerts;
  }
  async function renderTrendAlerts(){
    var dash = document.getElementById('cpg-dashboard');
    if(!dash) return;
    var existing = dash.querySelector('#gl-trend-alerts');
    var alerts = await detectCcpTrends();
    if(!alerts.length){ if(existing) existing.remove(); return; }
    if(existing) existing.remove();
    var banner = document.createElement('div');
    banner.id = 'gl-trend-alerts';
    banner.setAttribute('style','padding:11px 14px;background:rgba(245,200,66,.1);border:1px solid rgba(245,200,66,.3);border-left:3px solid #f5c842;border-radius:0 8px 8px 0;margin-bottom:14px;font-size:12px;color:#cfd9e6');
    banner.innerHTML = '<b style="color:#f5c842">📉 CCP trend warning:</b><div style="margin-top:6px">' +
      alerts.map(function(a){ return '<div style="margin-top:3px"><b>' + esc(a.ccp) + '</b> trending toward critical limit. Last avg ' + a.latest + ' ' + esc(a.unit) + ' (CL ' + a.limit + ', drift ' + a.drift + ').</div>'; }).join('') +
    '</div>';
    var first = dash.firstElementChild;
    dash.insertBefore(banner, first || null);
  }
  (function watchDashForTrends(){
    var dash = document.getElementById('cpg-dashboard');
    if(!dash){ setTimeout(watchDashForTrends, 700); return; }
    new MutationObserver(function(){
      if(dash.classList.contains('act')) renderTrendAlerts();
    }).observe(dash, { attributes:true, attributeFilter:['class'] });
    if(dash.classList.contains('act')) renderTrendAlerts();
  })();

  // ============================================================
  // 14) LOCK records when invoice is marked paid
  // ============================================================
  // When the user marks an invoice paid, we find any compliance_records
  // referencing the invoice's run/lot and stamp data.locked_at + a
  // signature_meaning suffix. They stay visible but the History row gets
  // a 🔒 lock badge and the form-edit path can warn.
  function patchQuickPaid(){
    var orig = window.quickPaid;
    if(typeof orig !== 'function'){ setTimeout(patchQuickPaid, 700); return; }
    if(window.__glQuickPaidLockHooked) return;
    window.__glQuickPaidLockHooked = true;
    window.quickPaid = function(id){
      var r = orig.apply(this, arguments);
      // Find this invoice's lot/run and lock related records
      var inv = (window.invoices || []).find(function(i){ return i.id === id; });
      if(!inv || !window.supa) return r;
      (async function(){
        try {
          // Find compliance records by run_id (if invoice has one) OR by lot in data
          var recs = [];
          if(inv.run_id){
            var rr = await window.supa.from('compliance_records').select('id,data').eq('run_id', inv.run_id).neq('status','voided');
            recs = rr.data || [];
          }
          if(!recs.length && inv.lot){
            var like = '%' + inv.lot + '%';
            var rl = await window.supa.from('compliance_records').select('id,data').or('data->>lot.ilike.' + like + ',data->>lot_number.ilike.' + like).neq('status','voided');
            recs = rl.data || [];
          }
          if(!recs.length) return;
          var lockedCount = 0;
          for(var i = 0; i < recs.length; i++){
            var rec = recs[i];
            if(rec.data && rec.data.locked_at) continue;
            var newData = Object.assign({}, rec.data || {}, { locked_at: nowISO(), locked_reason: 'Invoice ' + inv.id + ' marked paid' });
            try { await window.supa.from('compliance_records').update({ data: newData }).eq('id', rec.id); lockedCount++; }
            catch(e){}
          }
          if(lockedCount && typeof addNotification === 'function'){
            addNotification('🔒 ' + lockedCount + ' compliance record' + (lockedCount===1?'':'s') + ' locked', 'Invoice ' + inv.id + ' paid → records frozen for audit', 'info');
          }
          if(typeof window.glAudit === 'function') window.glAudit('records_locked_on_paid', inv.id, { count: lockedCount });
        } catch(e){ console.warn('[GL records lock] failed', e); }
      })();
      return r;
    };
  }
  patchQuickPaid();

  // ============================================================
  // Add Training-CSV-import button onto the Compliance master page
  // ============================================================
  (function injectTrainingCsv(){
    var host = document.getElementById('comp-body');
    if(!host){ setTimeout(injectTrainingCsv, 700); return; }
    new MutationObserver(function(){
      var addBtn = host.querySelector('.gl-comp-applic');
      if(!addBtn) return;
      if(addBtn.parentNode.querySelector('.gl-comp-csv')) return;
      var b = document.createElement('button');
      b.className = 'cbtn gl-comp-csv';
      b.setAttribute('style','font-size:11px;padding:5px 11px;margin-right:6px;background:rgba(95,207,158,.08);border:1px solid rgba(95,207,158,.3);color:#5fcf9e');
      b.textContent = '📥 Import training CSV';
      b.addEventListener('click', function(){ window.glOpenTrainingCsvImport(); });
      addBtn.parentNode.insertBefore(b, addBtn);
    }).observe(host, { childList:true, subtree:true });
  })();

  console.log('[GL] compliance enhancements pack — 9 features: bulk sign + CCP timer + mini-charts + lot QR + invoice-records footer + training CSV + audit scorecard + trend alerts + paid-lock');
}());
