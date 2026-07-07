/* ============================================================
   PRODUCTION RUNS — operations kanban
   - 6 columns: Discovery → Formulation → Sample → COA → Production → Ship.
   - Each card: client + run name + format + cases + scheduled date.
   - Add / edit / delete via modal. Move stage via dropdown (no
     drag-and-drop yet — keeps it shippable in one PR).
   - Backed by Supabase `production_runs` table. Falls back to local
     localStorage if the table is missing so the UI still works.
   - Renders into #prun-board whenever the user navigates to the page.
   ============================================================ */
(function(){
  var STAGES = ['Discovery','Formulation','Sample','COA','Production','Ship'];
  var STAGE_COLOR = {
    Discovery:'#9aa7bd', Formulation:'#7fc6f5', Sample:'#c4a4f8',
    COA:'#f5c842', Production:'#5fcf9e', Ship:'#00e5c0'
  };
  var esc = window.glEsc;
  window.glProductionRuns = window.glProductionRuns || [];
  window.glProductionLines = window.glProductionLines || [];

  // Loads production_lines into the in-memory cache. Called from the
  // run modal + the schedule page. No-op if the table is missing.
  async function loadProductionLines(){
    if(!window.supa) return [];
    try {
      var r = await window.supa.from('production_lines').select('*').eq('active', true).order('kind').order('name');
      if(r && r.data){ window.glProductionLines = r.data; return r.data; }
    } catch(e){ console.warn('[GL] production_lines load failed', e); }
    return window.glProductionLines || [];
  }

  // Detect whether `run` overlaps any OTHER run on the same line. Both
  // sides treat a missing end_date as a single-day occupation. Returns
  // the conflicting rows (excluding `selfId` if provided) sorted by date.
  function findConflicts(lineId, startStr, endStr, selfId){
    if(!lineId || !startStr) return [];
    var s1 = startStr;
    var e1 = endStr || startStr;
    return (window.glProductionRuns || []).filter(function(other){
      if(!other || other.id === selfId) return false;
      if(other.production_line_id !== lineId) return false;
      var s2 = other.scheduled_start_date || other.scheduled_date;
      var e2 = other.scheduled_end_date   || s2;
      if(!s2) return false;
      // Overlap rule: s1 <= e2 && s2 <= e1
      return s1 <= e2 && s2 <= e1;
    });
  }

  async function loadFromSupabase(){
    if(!window.supa) return null;
    try {
      var r = await window.supa.from('production_runs').select('*').order('scheduled_start_date',{ascending:true,nullsFirst:false});
      if(r && r.data) return r.data;
    } catch(e){ console.warn('[GL] production_runs load failed', e); }
    return null;
  }
  function loadFromLocal(){
    try { return JSON.parse(localStorage.getItem('gl_production_runs') || '[]'); }
    catch(e){ return []; }
  }
  function saveLocal(){
    localStorage.setItem('gl_production_runs', JSON.stringify(window.glProductionRuns));
  }

  async function refreshRuns(){
    var rows = await loadFromSupabase();
    if(rows) window.glProductionRuns = rows;
    else      window.glProductionRuns = loadFromLocal();
    // Pull lines in parallel so the kanban + capacity widgets render together.
    await loadProductionLines();
    renderBoard();
  }
  // Expose for the Production Schedule page (production-cal) so it can
  // load the production_runs table without re-rendering the kanban board
  // (renderBoard is a no-op if #prun-board is not in the DOM).
  window.glRefreshProductionRuns = refreshRuns;

  // ──────────────────────────────────────────────────────────
  // Capacity summary widget — sits above the kanban. Computes
  // this week + next week utilization per active line.
  // ──────────────────────────────────────────────────────────
  function renderCapacityWidget(){
    var host = document.getElementById('prun-capacity'); if(!host) return;
    var lines = (window.glProductionLines || []).filter(function(l){ return l.active !== false; });
    if(!lines.length){
      host.innerHTML = '<div style="font-size:11px;color:#6b87ad;font-style:italic;padding:6px 12px">No production lines configured. <button onclick="window.glOpenProductionLines()" style="background:none;border:0;color:#00e5c0;cursor:pointer;text-decoration:underline;font-size:11px">Set them up →</button></div>';
      return;
    }
    function weekRange(offset){
      var d = new Date();
      var day = d.getDay(); // 0 = Sun
      var monday = new Date(d); monday.setDate(d.getDate() - ((day+6)%7) + offset*7);
      var sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
      function iso(x){ return x.toISOString().slice(0,10); }
      return { start: iso(monday), end: iso(sunday), label: (offset===0?'This week':(offset===1?'Next week':('Week +'+offset))) };
    }
    function utilization(lineId, wkStart, wkEnd){
      var runs = (window.glProductionRuns || []).filter(function(r){
        if(r.production_line_id !== lineId) return false;
        var s = r.scheduled_start_date || r.scheduled_date;
        var e = r.scheduled_end_date || s;
        if(!s) return false;
        return s <= wkEnd && e >= wkStart;
      });
      var totalCases = runs.reduce(function(a,r){ return a + (Number(r.cases)||0); }, 0);
      return { runs: runs.length, cases: totalCases };
    }
    var cards = [weekRange(0), weekRange(1)].map(function(wk){
      var rows = lines.map(function(l){
        var u = utilization(l.id, wk.start, wk.end);
        var cap = Number(l.capacity_per_day) || 0;
        // Estimate: capacity_per_day × 5 weekdays in the week. Rough but
        // gives staff a sense of how booked the line is at a glance.
        var capWeek = cap * 5;
        var pct = capWeek ? Math.min(999, Math.round((u.cases / capWeek) * 100)) : 0;
        var color = pct >= 100 ? '#e74c3c' : pct >= 70 ? '#f5c842' : '#5fcf9e';
        return '<div style="display:grid;grid-template-columns:1fr 70px 60px 90px;gap:10px;align-items:center;padding:6px 10px;font-size:12px">' +
          '<div style="color:#fff;font-weight:600">' + esc(l.name) + ' <span style="color:#6b87ad;font-weight:400;font-size:10px;text-transform:uppercase;letter-spacing:1px">' + esc(l.kind||'') + '</span></div>' +
          '<div style="color:#9aa7bd;text-align:right">' + u.runs + ' run' + (u.runs===1?'':'s') + '</div>' +
          '<div style="color:#9aa7bd;text-align:right;font-family:var(--ff-mono)">' + u.cases.toLocaleString() + '</div>' +
          '<div style="text-align:right"><span style="color:' + color + ';font-weight:700">' + (capWeek ? pct + '%' : '—') + '</span>' + (capWeek ? '<span style="color:#6b87ad;font-size:10px"> / ' + capWeek.toLocaleString() + '</span>' : '') + '</div>' +
        '</div>';
      }).join('');
      return '<div style="flex:1;min-width:280px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:10px;margin-right:10px">' +
        '<div style="font-family:var(--ff-disp);font-size:11px;letter-spacing:2px;color:#7fc6f5;margin-bottom:6px;padding:0 10px">' + esc(wk.label) + ' · ' + esc(wk.start) + ' → ' + esc(wk.end) + '</div>' +
        rows +
      '</div>';
    }).join('');
    host.innerHTML = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">' + cards + '</div>';
  }

  function renderBoard(){
    var host = document.getElementById('prun-board');
    if(!host) return;
    // Make sure a capacity widget host exists right above the kanban.
    if(!document.getElementById('prun-capacity')){
      var cap = document.createElement('div'); cap.id = 'prun-capacity';
      host.parentNode.insertBefore(cap, host);
      // Toolbar with "⚙ Lines" admin button.
      var bar = document.createElement('div');
      bar.id = 'prun-toolbar';
      bar.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-bottom:8px';
      bar.innerHTML = '<button class="cbtn" style="font-size:11px;padding:5px 10px" onclick="window.glOpenProductionLines()">⚙ Production lines</button>';
      host.parentNode.insertBefore(bar, host.parentNode.firstChild.nextSibling);
    }
    renderCapacityWidget();
    var sub = document.getElementById('prun-sub');
    var byStage = {};
    STAGES.forEach(function(s){ byStage[s] = []; });
    (window.glProductionRuns || []).forEach(function(r){
      var s = r.stage || 'Discovery';
      if(!byStage[s]) byStage[s] = [];
      byStage[s].push(r);
    });
    var total = (window.glProductionRuns || []).length;
    if(sub) sub.textContent = total + ' run' + (total === 1 ? '' : 's') + ' across ' + STAGES.length + ' stages';

    var columnsHtml = STAGES.map(function(stage){
      var color = STAGE_COLOR[stage];
      var cards = byStage[stage].map(function(r){
        var clientName = r.client_name || ((window.clients||[]).find(function(c){ return c.id === r.client_id; })||{}).name || '—';
        var sched = r.scheduled_date ? window.fmtLocalDate(r.scheduled_date, {month:'short',day:'numeric'}) : '—';
        var cases = r.cases ? Number(r.cases).toLocaleString() + ' cs' : '';
        return '<div class="gl-prun-card" data-id="' + esc(r.id) + '" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:11px 13px;margin-bottom:9px;cursor:pointer;transition:border-color .15s" onmouseover="this.style.borderColor=\'rgba(0,229,192,.35)\'" onmouseout="this.style.borderColor=\'rgba(255,255,255,.08)\'">' +
          '<div style="font-size:13px;color:var(--white);font-weight:600;margin-bottom:4px">' + esc(r.run_name || '(untitled)') + '</div>' +
          '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">' + esc(clientName) + '</div>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#9aa7bd">' +
            '<span>' + esc(r.format || '—') + (cases ? ' · ' + cases : '') + '</span>' +
            '<span>📅 ' + sched + '</span>' +
          '</div>' +
        '</div>';
      }).join('');
      return '<div class="gl-prun-col" data-stage="' + stage + '" style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;min-height:240px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
          '<div style="font-family:var(--ff-disp);font-size:11px;letter-spacing:2px;color:' + color + '">' + stage.toUpperCase() + '</div>' +
          '<span style="font-size:11px;color:var(--muted);background:rgba(255,255,255,.05);padding:2px 8px;border-radius:10px">' + byStage[stage].length + '</span>' +
        '</div>' +
        cards +
        (cards ? '' : '<div style="font-size:11px;color:rgba(255,255,255,.25);text-align:center;padding:14px 0;font-style:italic">empty</div>') +
      '</div>';
    }).join('');

    host.innerHTML = '<div style="display:grid;grid-template-columns:repeat(6,minmax(180px,1fr));gap:12px;overflow-x:auto;padding-bottom:12px">' + columnsHtml + '</div>';
    host.querySelectorAll('.gl-prun-card').forEach(function(card){
      card.addEventListener('click', function(){ window.glOpenEditProductionRun(card.getAttribute('data-id')); });
    });
  }

  async function runModal(existing){
    var prior = document.getElementById('gl-prun-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var isEdit = !!existing;
    var run = existing || { run_name:'', client_id:'', client_name:'', format:'', cases:'', stage:'Discovery', scheduled_date:'', scheduled_start_date:'', scheduled_end_date:'', production_line_id:'', notes:'' };
    // Make sure the line list is in cache BEFORE we build the dropdown HTML —
    // otherwise the dropdown opens with only "— No line assigned —" if the
    // user clicks "+ Add Run" before refreshRuns() finishes loading lines.
    if(window.supa && !(window.glProductionLines && window.glProductionLines.length)){
      await loadProductionLines();
    }
    var lineOptions = '<option value="">— No line assigned —</option>' +
      (window.glProductionLines||[]).map(function(l){
        var sel = (l.id === run.production_line_id) ? ' selected' : '';
        var capBit = l.capacity_per_day ? ' (' + l.capacity_per_day + ' ' + (l.capacity_unit||'cases') + '/day)' : '';
        return '<option value="' + esc(l.id) + '"'+sel+'>' + esc(l.name) + capBit + '</option>';
      }).join('');
    var clientOptions = '<option value="">— Pick client —</option>' +
      (window.clients||[]).map(function(c){
        var sel = (c.id === run.client_id) ? ' selected' : '';
        return '<option value="' + esc(c.id) + '"'+sel+'>' + esc(c.name) + '</option>';
      }).join('');
    var stageOptions = STAGES.map(function(s){
      var sel = (s === run.stage) ? ' selected' : '';
      return '<option value="' + s + '"'+sel+'>' + s + '</option>';
    }).join('');
    var formatOptions = ['','12oz Standard can','12oz Sleek can','16oz Standard can','750ml bottle','R&D / pilot','Other'].map(function(f){
      var sel = (f === run.format) ? ' selected' : '';
      return '<option value="' + esc(f) + '"'+sel+'>' + esc(f || 'Select format…') + '</option>';
    }).join('');
    var startVal = run.scheduled_start_date || run.scheduled_date || '';
    var endVal   = run.scheduled_end_date || '';
    var ov = document.createElement('div');
    ov.id = 'gl-prun-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:480px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">' + (isEdit ? '✏️ EDIT RUN' : '🏭 ADD PRODUCTION RUN') + '</div>' +
          '<button id="gl-prun-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Run name *</div><input class="finp" id="gl-prun-name" value="' + esc(run.run_name) + '" placeholder="e.g. SunBurst Mango — Run #3"></div>' +
        '<div class="frow"><div class="flbl">Client</div><select class="fsel" id="gl-prun-client">' + clientOptions + '</select></div>' +
        '<div style="display:grid;grid-template-columns:2fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Format</div><select class="fsel" id="gl-prun-format">' + formatOptions + '</select></div>' +
          '<div class="frow"><div class="flbl">Cases planned</div><input class="finp" id="gl-prun-cases" type="number" min="0" value="' + (run.cases || '') + '"></div>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Stage</div><select class="fsel" id="gl-prun-stage">' + stageOptions + '</select></div>' +
        '<div class="frow"><div class="flbl">Production line</div><select class="fsel" id="gl-prun-line">' + lineOptions + '</select></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Start date</div><input class="finp" id="gl-prun-start" type="date" value="' + esc(startVal) + '"></div>' +
          '<div class="frow"><div class="flbl">End date <span style="opacity:.6">(blank = single day)</span></div><input class="finp" id="gl-prun-end" type="date" value="' + esc(endVal) + '"></div>' +
        '</div>' +
        '<div id="gl-prun-conflict" style="display:none;font-size:11px;background:rgba(231,76,60,.08);border:1px solid rgba(231,76,60,.3);color:#ff8579;border-radius:6px;padding:8px 10px;margin-bottom:8px;line-height:1.5"></div>' +
        '<div class="frow"><div class="flbl">Lot number <span style="opacity:.6">(stamped on cans for traceability)</span></div><input class="finp" id="gl-prun-lot" value="' + esc(run.lot_number || '') + '" placeholder="e.g. L26140-A"></div>' +
        '<div class="frow"><div class="flbl">Notes</div><textarea class="finp" id="gl-prun-notes" rows="3" placeholder="QC notes, allergen flags, anything the line lead should know…">' + esc(run.notes) + '</textarea></div>' +
        (isEdit ? (
          '<div style="border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px;margin:10px 0;background:rgba(255,255,255,.02)">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
              '<div style="font-family:var(--ff-disp);font-size:11px;letter-spacing:2px;color:#7fc6f5">📎 LOT DOCUMENTS</div>' +
              '<button id="gl-prun-doc-add" class="cbtn" style="font-size:11px;padding:4px 10px">+ Attach</button>' +
            '</div>' +
            '<div id="gl-prun-doc-list" style="font-size:11px;color:#9aa7bd">Loading…</div>' +
            '<div style="font-size:10px;color:#6b87ad;margin-top:6px;line-height:1.5">Files attached here are visible to the brand\'s portal customer. Use for COAs, spec sheets, allergen declarations, etc.</div>' +
          '</div>'
        ) : '') +
        '<div style="display:flex;gap:8px;margin-top:6px">' +
          '<button id="gl-prun-save" class="cbtn pri" style="flex:1">💾 Save</button>' +
          (isEdit ? '<button id="gl-prun-del" class="cbtn" style="background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#ff8579">Delete</button>' : '') +
          '<button id="gl-prun-cancel" class="cbtn">Cancel</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-prun-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-prun-cancel').addEventListener('click', function(){ ov.remove(); });
    var delBtn = ov.querySelector('#gl-prun-del');
    if(delBtn) delBtn.addEventListener('click', async function(){
      if(!confirm('Delete this run?')) return;
      if(window.supa){ try { await window.supa.from('production_runs').delete().eq('id', run.id); } catch(e){} }
      window.glProductionRuns = (window.glProductionRuns||[]).filter(function(r){ return r.id !== run.id; });
      saveLocal(); renderBoard(); ov.remove();
      if(typeof addNotification === 'function') addNotification('🏭 Run deleted', run.run_name, 'warning');
      if(typeof window.glAudit === 'function') window.glAudit('production_run_deleted', run.id, {});
    });
    // Live conflict banner — refresh whenever line / start / end change.
    function refreshConflictBanner(){
      var banner = ov.querySelector('#gl-prun-conflict'); if(!banner) return;
      var lid   = ov.querySelector('#gl-prun-line').value;
      var start = ov.querySelector('#gl-prun-start').value;
      var end   = ov.querySelector('#gl-prun-end').value;
      if(!lid || !start){ banner.style.display = 'none'; return; }
      var conflicts = findConflicts(lid, start, end, run.id);
      if(!conflicts.length){ banner.style.display = 'none'; return; }
      banner.style.display = 'block';
      var lineName = ((window.glProductionLines||[]).find(function(l){ return l.id === lid; })||{}).name || 'this line';
      banner.innerHTML = '⚠ <b>Schedule conflict</b> — ' + esc(lineName) + ' already has ' + conflicts.length + ' run' + (conflicts.length===1?'':'s') + ' overlapping these dates:<br>' +
        conflicts.slice(0,3).map(function(o){
          var s = o.scheduled_start_date || o.scheduled_date;
          var e = o.scheduled_end_date   || s;
          return '· <b>' + esc(o.run_name || '(unnamed)') + '</b> · ' + esc(o.client_name || '') + ' · ' + esc(s) + (e && e !== s ? ' → ' + esc(e) : '');
        }).join('<br>') +
        (conflicts.length > 3 ? '<br>… and ' + (conflicts.length - 3) + ' more' : '') +
        '<br><span style="color:#9aa7bd;font-size:10px">You can still save — this is a warning, not a block.</span>';
    }
    ['gl-prun-line','gl-prun-start','gl-prun-end'].forEach(function(id){
      var el = ov.querySelector('#' + id);
      if(el) el.addEventListener('change', refreshConflictBanner);
    });
    refreshConflictBanner();

    ov.querySelector('#gl-prun-save').addEventListener('click', async function(){
      var name = ov.querySelector('#gl-prun-name').value.trim();
      if(!name){ alert('Run name is required.'); return; }
      var cid = ov.querySelector('#gl-prun-client').value;
      var c   = (window.clients||[]).find(function(x){ return x.id === cid; });
      var lotEl = ov.querySelector('#gl-prun-lot');
      var startVal = ov.querySelector('#gl-prun-start').value || null;
      var endVal   = ov.querySelector('#gl-prun-end').value || null;
      var lineId   = ov.querySelector('#gl-prun-line').value || null;
      var data = {
        run_name:             name,
        client_id:            cid || null,
        client_name:          c ? c.name : '',
        format:               ov.querySelector('#gl-prun-format').value,
        cases:                parseInt(ov.querySelector('#gl-prun-cases').value, 10) || 0,
        stage:                ov.querySelector('#gl-prun-stage').value,
        scheduled_date:       startVal,
        scheduled_start_date: startVal,
        scheduled_end_date:   endVal,
        production_line_id:   lineId,
        lot_number:           lotEl ? (lotEl.value || '').trim() || null : (run.lot_number || null),
        notes:                ov.querySelector('#gl-prun-notes').value,
        updated_at:           new Date().toISOString()
      };
      // Final conflict check at save — warn but allow override.
      if(lineId && startVal){
        var conflicts = findConflicts(lineId, startVal, endVal, run.id);
        if(conflicts.length){
          var lineName = ((window.glProductionLines||[]).find(function(l){ return l.id === lineId; })||{}).name || 'this line';
          var msg = 'Schedule conflict on ' + lineName + ':\n\n' +
            conflicts.slice(0, 5).map(function(o){
              return '· ' + (o.run_name || '(unnamed)') + ' — ' + (o.client_name || '') + ' (' + (o.scheduled_start_date || o.scheduled_date) + (o.scheduled_end_date && o.scheduled_end_date !== (o.scheduled_start_date||o.scheduled_date) ? ' → ' + o.scheduled_end_date : '') + ')';
            }).join('\n') +
            '\n\nSave anyway?';
          if(!confirm(msg)) return;
        }
      }
      // Compliance gate — block transition to Ship if there's an open Hold Tag for this run
      if(data.stage === 'Ship' && run && run.id && typeof window.glCheckRunHoldStatus === 'function'){
        var blocker = await window.glCheckRunHoldStatus(run.id);
        if(blocker){
          alert('🚫 Cannot move to Ship — open Hold Tag ' + blocker.tag_number + ' on this run.\n\nReason: ' + (blocker.reason || '(none)') + '\n\nGo to sidebar → Hold Tags → disposition this hold before shipping.');
          return;
        }
      }
      var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
      if(window.supa){
        try {
          if(isEdit){
            await window.supa.from('production_runs').update(data).eq('id', run.id);
            Object.assign(run, data);
          } else {
            var r = await window.supa.from('production_runs').insert([data]).select().single();
            if(r && r.data){ window.glProductionRuns.push(r.data); }
            else            { data.id = 'local_' + Date.now(); window.glProductionRuns.push(data); }
          }
        } catch(e){
          console.warn('[GL] production_runs save failed; using local', e);
          if(isEdit) Object.assign(run, data);
          else { data.id = 'local_' + Date.now(); window.glProductionRuns.push(data); }
        }
      } else {
        if(isEdit) Object.assign(run, data);
        else { data.id = 'local_' + Date.now(); window.glProductionRuns.push(data); }
      }
      saveLocal();
      btn.disabled = false; btn.textContent = '💾 Save';
      ov.remove();
      renderBoard();
      if(typeof addNotification === 'function') addNotification(isEdit ? '🏭 Run updated' : '🏭 Run added', name, 'success');
      if(typeof window.glAudit === 'function') window.glAudit(isEdit ? 'production_run_edited' : 'production_run_added', data.run_name, { stage: data.stage });
    });
    host.appendChild(ov);

    // ──────────────────────────────────────────────────────────
    // Lot documents section — staff attach COAs / spec sheets /
    // allergen statements to this production run. Visible to the
    // brand's portal customer via lot_documents RLS.
    // ──────────────────────────────────────────────────────────
    if(isEdit){
      var listEl = ov.querySelector('#gl-prun-doc-list');
      var addBtn = ov.querySelector('#gl-prun-doc-add');
      var DOC_TYPES = [
        ['coa', 'Certificate of Analysis (COA)'],
        ['spec_sheet', 'Spec sheet'],
        ['allergen', 'Allergen statement'],
        ['kosher', 'Kosher certificate'],
        ['organic', 'Organic certificate'],
        ['nutrition', 'Nutrition / NFP'],
        ['other', 'Other']
      ];
      function fmtBytes(n){
        if(!n) return '';
        if(n < 1024) return n + ' B';
        if(n < 1024*1024) return (n/1024).toFixed(0) + ' KB';
        return (n/1024/1024).toFixed(1) + ' MB';
      }
      async function loadDocs(){
        if(!listEl) return;
        if(!window.supa){ listEl.innerHTML = '<span style="color:#ff8579">Supabase not ready.</span>'; return; }
        listEl.innerHTML = 'Loading…';
        var r = await window.supa.from('lot_documents')
          .select('id, document_type, title, lot_number, file_name, file_size, file_path, uploaded_at')
          .eq('production_run_id', run.id)
          .order('uploaded_at', { ascending: false });
        if(r.error){ listEl.innerHTML = '<span style="color:#ff8579">Failed to load: ' + esc(r.error.message) + '</span>'; return; }
        var rows = r.data || [];
        if(!rows.length){
          listEl.innerHTML = '<div style="font-style:italic;color:#6b87ad;padding:6px 0">No documents attached yet. Click <b>+ Attach</b> to upload a COA, spec sheet, or other PDF.</div>';
          return;
        }
        listEl.innerHTML = rows.map(function(d){
          var typeLabel = (DOC_TYPES.find(function(t){ return t[0] === d.document_type; }) || [d.document_type, d.document_type])[1];
          var when = d.uploaded_at ? new Date(d.uploaded_at).toLocaleDateString() : '';
          return '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);border-radius:6px;margin-bottom:5px">' +
            '<div style="flex:1;min-width:0">' +
              '<div style="color:#fff;font-size:12px;font-weight:600">' + esc(d.title || d.file_name || 'Document') + '</div>' +
              '<div style="color:#6b87ad;font-size:10px;margin-top:2px">' + esc(typeLabel) + (d.lot_number ? ' · Lot ' + esc(d.lot_number) : '') + (d.file_size ? ' · ' + fmtBytes(d.file_size) : '') + ' · ' + esc(when) + '</div>' +
            '</div>' +
            '<button data-doc-dl="' + esc(d.id) + '" class="cbtn" style="font-size:10px;padding:3px 8px">⬇</button>' +
            '<button data-doc-rm="' + esc(d.id) + '" data-doc-path="' + esc(d.file_path) + '" class="cbtn" style="font-size:10px;padding:3px 8px;background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#ff8579">🗑</button>' +
          '</div>';
        }).join('');
        // Wire row buttons
        Array.prototype.forEach.call(listEl.querySelectorAll('[data-doc-dl]'), function(b){
          b.onclick = async function(){
            var id = b.getAttribute('data-doc-dl');
            var row = rows.find(function(x){ return x.id === id; });
            if(!row) return;
            var su = await window.supa.storage.from('client-docs').createSignedUrl(row.file_path, 60);
            if(su.error || !su.data){ alert('Signed URL failed: ' + (su.error && su.error.message || 'unknown')); return; }
            window.open(su.data.signedUrl, '_blank', 'noopener');
          };
        });
        Array.prototype.forEach.call(listEl.querySelectorAll('[data-doc-rm]'), function(b){
          b.onclick = async function(){
            var id = b.getAttribute('data-doc-rm');
            var p  = b.getAttribute('data-doc-path');
            if(!confirm('Delete this document? The customer will no longer be able to see it.')) return;
            b.disabled = true; b.textContent = '…';
            try { if(p) await window.supa.storage.from('client-docs').remove([p]); } catch(e){}
            var rr = await window.supa.from('lot_documents').delete().eq('id', id);
            if(rr.error){ alert('Delete failed: ' + rr.error.message); b.disabled = false; b.textContent = '🗑'; return; }
            if(typeof window.glAudit === 'function') window.glAudit('lot_document_deleted', id, { run: run.id });
            loadDocs();
          };
        });
      }
      loadDocs();

      if(addBtn) addBtn.onclick = function(){
        if(!run.client_id){ alert('This run has no client linked. Pick a client + save the run first.'); return; }
        openAttachDocModal(run, loadDocs);
      };
    }
  }

  // ──────────────────────────────────────────────────────────
  // Attach-document sub-modal
  // ──────────────────────────────────────────────────────────
  function openAttachDocModal(run, onSaved){
    var prior = document.getElementById('gl-doc-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var DOC_TYPES = [
      ['coa', 'Certificate of Analysis (COA)'],
      ['spec_sheet', 'Spec sheet'],
      ['allergen', 'Allergen statement'],
      ['kosher', 'Kosher certificate'],
      ['organic', 'Organic certificate'],
      ['nutrition', 'Nutrition / NFP'],
      ['other', 'Other']
    ];
    var typeOpts = DOC_TYPES.map(function(t){ return '<option value="' + t[0] + '">' + esc(t[1]) + '</option>'; }).join('');
    var ov = document.createElement('div');
    ov.id = 'gl-doc-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1100;background:rgba(6,13,26,.92);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(127,198,245,.3);border-radius:14px;padding:24px;width:100%;max-width:460px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:16px;letter-spacing:2px;color:#7fc6f5">📎 ATTACH DOCUMENT</div>' +
          '<button id="gl-doc-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:11px;color:#6b87ad;margin-bottom:14px">Brand: <b style="color:#fff">' + esc(run.client_name || '') + '</b>' + (run.run_name ? ' · Run <b style="color:#fff">' + esc(run.run_name) + '</b>' : '') + '</div>' +
        '<div class="frow"><div class="flbl">File *</div><input class="finp" id="gl-doc-file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"></div>' +
        '<div class="frow"><div class="flbl">Document type *</div><select class="fsel" id="gl-doc-type">' + typeOpts + '</select></div>' +
        '<div class="frow"><div class="flbl">Title *</div><input class="finp" id="gl-doc-title" placeholder="e.g. COA — Mango pilot — Lot L26140-A"></div>' +
        '<div class="frow"><div class="flbl">Lot number <span style="opacity:.6">(optional)</span></div><input class="finp" id="gl-doc-lot" value="' + esc(run.lot_number || '') + '"></div>' +
        '<div class="frow"><div class="flbl">Notes <span style="opacity:.6">(optional)</span></div><textarea class="finp" id="gl-doc-notes" rows="2"></textarea></div>' +
        '<div id="gl-doc-msg" style="display:none;margin:10px 0;padding:8px 10px;border-radius:6px;font-size:12px"></div>' +
        '<div style="display:flex;gap:8px;margin-top:8px">' +
          '<button id="gl-doc-save" class="cbtn pri" style="flex:1">📤 Upload</button>' +
          '<button id="gl-doc-cancel" class="cbtn">Cancel</button>' +
        '</div>' +
      '</div>';
    host.appendChild(ov);
    function msg(text, kind){
      var el = ov.querySelector('#gl-doc-msg'); el.style.display='block'; el.textContent = text;
      if(kind === 'err'){ el.style.background='rgba(231,76,60,.12)'; el.style.border='1px solid rgba(231,76,60,.35)'; el.style.color='#ff8579'; }
      else { el.style.background='rgba(95,207,158,.12)'; el.style.border='1px solid rgba(95,207,158,.35)'; el.style.color='#5fcf9e'; }
    }
    ov.querySelector('#gl-doc-close').onclick  = function(){ ov.remove(); };
    ov.querySelector('#gl-doc-cancel').onclick = function(){ ov.remove(); };
    ov.querySelector('#gl-doc-save').onclick = async function(){
      var fileEl = ov.querySelector('#gl-doc-file');
      var f = fileEl && fileEl.files && fileEl.files[0];
      if(!f){ msg('Pick a file first.', 'err'); return; }
      var title = (ov.querySelector('#gl-doc-title').value||'').trim();
      if(!title){ msg('Title is required.', 'err'); return; }
      if(f.size > 25 * 1024 * 1024){ msg('File too large (max 25MB).', 'err'); return; }
      var docType = ov.querySelector('#gl-doc-type').value || 'other';
      var lot     = (ov.querySelector('#gl-doc-lot').value||'').trim() || run.lot_number || null;
      var notes   = (ov.querySelector('#gl-doc-notes').value||'').trim() || null;
      var btn = this; var orig = btn.textContent;
      btn.disabled = true; btn.textContent = 'Uploading…';
      try {
        var safeName = (f.name || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120);
        var stamp = Date.now();
        var path = run.client_id + '/lots/' + (lot || 'unlabeled') + '/' + stamp + '_' + safeName;
        var up = await window.supa.storage.from('client-docs').upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false });
        if(up.error){ msg('Upload failed: ' + up.error.message, 'err'); btn.disabled = false; btn.textContent = orig; return; }
        var ins = await window.supa.from('lot_documents').insert({
          client_id:         run.client_id,
          production_run_id: run.id,
          lot_number:        lot,
          document_type:     docType,
          title:             title,
          notes:             notes,
          file_path:         path,
          file_name:         f.name,
          file_size:         f.size,
          mime_type:         f.type || null
        });
        if(ins.error){
          // Clean up the orphaned storage file so we don't accumulate garbage.
          try { await window.supa.storage.from('client-docs').remove([path]); } catch(e){}
          msg('Save metadata failed: ' + ins.error.message, 'err');
          btn.disabled = false; btn.textContent = orig;
          return;
        }
        if(typeof window.glAudit === 'function') window.glAudit('lot_document_uploaded', run.id, { type: docType, title: title, lot: lot });
        if(typeof addNotification === 'function') addNotification('📎 Document attached', title, 'success');
        ov.remove();
        if(typeof onSaved === 'function') onSaved();
      } catch(e){
        msg('Threw: ' + (e.message || e), 'err');
        btn.disabled = false; btn.textContent = orig;
      }
    };
  }

  // ──────────────────────────────────────────────────────────
  // Production-line management modal (admin CRUD)
  // ──────────────────────────────────────────────────────────
  window.glOpenProductionLines = async function(){
    var prior = document.getElementById('gl-lines-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    await loadProductionLines();
    var ov = document.createElement('div');
    ov.id = 'gl-lines-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1100;background:rgba(6,13,26,.92);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px');
    function rowHtml(l){
      var checked = l.active === false ? '' : ' checked';
      return '<tr data-line-id="' + esc(l.id) + '" style="border-top:1px solid rgba(255,255,255,.05)">' +
        '<td style="padding:8px 6px"><input class="finp gl-ln-name" value="' + esc(l.name) + '" style="width:100%"></td>' +
        '<td style="padding:8px 6px"><select class="fsel gl-ln-kind">' +
          ['canning','bottling','rd','blending','other'].map(function(k){ return '<option value="'+k+'"'+(l.kind===k?' selected':'')+'>'+k+'</option>'; }).join('') +
        '</select></td>' +
        '<td style="padding:8px 6px"><input class="finp gl-ln-cap" type="number" step="0.01" min="0" value="' + (l.capacity_per_day != null ? l.capacity_per_day : '') + '" style="width:90px"></td>' +
        '<td style="padding:8px 6px"><select class="fsel gl-ln-unit"><option value="cases"'+(l.capacity_unit==='cases'?' selected':'')+'>cases</option><option value="hours"'+(l.capacity_unit==='hours'?' selected':'')+'>hours</option></select></td>' +
        '<td style="padding:8px 6px;text-align:center"><input type="checkbox" class="gl-ln-active"'+checked+'></td>' +
        '<td style="padding:8px 6px;text-align:right;white-space:nowrap">' +
          '<button class="cbtn gl-ln-save" style="font-size:11px;padding:4px 9px">💾</button> ' +
          '<button class="cbtn gl-ln-rm" style="font-size:11px;padding:4px 9px;background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#ff8579">🗑</button>' +
        '</td>' +
      '</tr>';
    }
    var rowsHtml = (window.glProductionLines||[]).map(rowHtml).join('');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(127,198,245,.3);border-radius:14px;padding:24px;width:100%;max-width:780px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:#7fc6f5">⚙ PRODUCTION LINES</div>' +
          '<button id="gl-lines-close" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:11px;color:#6b87ad;margin-bottom:14px;line-height:1.5">A line is a piece of equipment (or bench) you schedule runs on. Capacity is per <i>operating day</i>; the schedule widget multiplies by 5 weekdays for a weekly utilization estimate. Deactivate a line instead of deleting if you ever bring it back online.</div>' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="font-size:10px;letter-spacing:1.5px;color:#9aa7bd">' +
          '<th style="text-align:left;padding:6px">NAME</th>' +
          '<th style="text-align:left;padding:6px">KIND</th>' +
          '<th style="text-align:left;padding:6px">CAP/DAY</th>' +
          '<th style="text-align:left;padding:6px">UNIT</th>' +
          '<th style="text-align:center;padding:6px">ACTIVE</th>' +
          '<th style="padding:6px"></th>' +
        '</tr></thead><tbody id="gl-lines-tbody">' + rowsHtml + '</tbody></table>' +
        '<div style="display:flex;gap:8px;margin-top:14px">' +
          '<button id="gl-lines-add" class="cbtn pri" style="flex:1">+ Add line</button>' +
          '<button id="gl-lines-done" class="cbtn">Done</button>' +
        '</div>' +
      '</div>';
    host.appendChild(ov);
    function refresh(){
      var tb = ov.querySelector('#gl-lines-tbody');
      tb.innerHTML = (window.glProductionLines||[]).map(rowHtml).join('');
      wireRows();
    }
    function rowToPatch(tr){
      return {
        name:             tr.querySelector('.gl-ln-name').value.trim(),
        kind:             tr.querySelector('.gl-ln-kind').value,
        capacity_per_day: parseFloat(tr.querySelector('.gl-ln-cap').value) || null,
        capacity_unit:    tr.querySelector('.gl-ln-unit').value,
        active:           tr.querySelector('.gl-ln-active').checked
      };
    }
    function wireRows(){
      ov.querySelectorAll('tr[data-line-id]').forEach(function(tr){
        var id = tr.getAttribute('data-line-id');
        tr.querySelector('.gl-ln-save').onclick = async function(){
          var patch = rowToPatch(tr);
          if(!patch.name){ alert('Name is required.'); return; }
          if(window.supa){
            var r = await window.supa.from('production_lines').update(patch).eq('id', id);
            if(r.error){ alert('Save failed: ' + r.error.message); return; }
          }
          await loadProductionLines();
          renderCapacityWidget();
          if(typeof window.glAudit === 'function') window.glAudit('production_line_updated', id, patch);
          this.textContent = '✓';
          setTimeout(function(){ try { tr.querySelector('.gl-ln-save').textContent = '💾'; } catch(e){} }, 1200);
        };
        tr.querySelector('.gl-ln-rm').onclick = async function(){
          if(!confirm('Delete this line? Existing runs assigned to it will be unassigned (line_id set to NULL).')) return;
          if(window.supa){
            var r = await window.supa.from('production_lines').delete().eq('id', id);
            if(r.error){ alert('Delete failed: ' + r.error.message); return; }
          }
          await loadProductionLines();
          await refreshRuns();
          if(typeof window.glAudit === 'function') window.glAudit('production_line_deleted', id, {});
          refresh();
        };
      });
    }
    wireRows();
    ov.querySelector('#gl-lines-close').onclick = function(){ ov.remove(); };
    ov.querySelector('#gl-lines-done').onclick  = function(){ ov.remove(); };
    ov.querySelector('#gl-lines-add').onclick = async function(){
      if(!window.supa){ alert('Supabase not ready.'); return; }
      var ins = await window.supa.from('production_lines').insert({
        name: 'New line', kind: 'canning', capacity_per_day: null, capacity_unit: 'cases', active: true
      }).select().single();
      if(ins.error){ alert('Add failed: ' + ins.error.message); return; }
      await loadProductionLines();
      if(typeof window.glAudit === 'function') window.glAudit('production_line_added', ins.data && ins.data.id, {});
      refresh();
    };
  };

  window.glOpenAddProductionRun  = function(){ runModal(null); };
  window.glOpenEditProductionRun = function(id){
    var r = (window.glProductionRuns||[]).find(function(x){ return x.id === id; });
    if(r) runModal(r);
  };

  // Render the board whenever the Production Runs page becomes active.
  function watch(){
    var pg = document.getElementById('cpg-production-runs');
    if(!pg){ setTimeout(watch, 600); return; }
    new MutationObserver(function(){
      if(pg.classList.contains('act')) refreshRuns();
    }).observe(pg, { attributes:true, attributeFilter:['class'] });
  }
  if(document.readyState !== 'loading') watch();
  else document.addEventListener('DOMContentLoaded', watch);

  console.log('[GL] production runs kanban loaded');
}());
