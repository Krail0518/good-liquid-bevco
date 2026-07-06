/* ============================================================
   KPI SCORECARD (business pulse dashboard widget)
   ============================================================ */
(function(){
  function fmt$(n){ return '$' + Math.round(n||0).toLocaleString(); }
  function gather(){
    var now = new Date();
    var mStart = new Date(now.getFullYear(), now.getMonth(), 1);
    var yStart = new Date(now.getFullYear(), 0, 1);
    var invs = window.invoices || [];
    var mtdRev = 0, ytdRev = 0, allRev = 0, paidCount = 0, totalCount = 0, daysToPayTotal = 0, daysToPayCount = 0;
    invs.forEach(function(i){
      if(!i || !i.date) return;
      var d = new Date(i.date);
      var amt = i.amount || 0;
      totalCount++;
      if(d >= yStart) ytdRev += amt;
      if(d >= mStart) mtdRev += amt;
      allRev += amt;
      if((i.status||'').toLowerCase() === 'paid'){
        paidCount++;
        if(i.paid_at || i.paidAt){
          var paidDate = new Date(i.paid_at || i.paidAt);
          if(!isNaN(paidDate)){
            daysToPayTotal += Math.round((paidDate - d) / 86400000);
            daysToPayCount++;
          }
        }
      }
    });
    return {
      mtdRev: mtdRev, ytdRev: ytdRev,
      avgInv: totalCount ? allRev / totalCount : 0,
      paidRate: totalCount ? Math.round(paidCount / totalCount * 100) : 0,
      avgDays: daysToPayCount ? Math.round(daysToPayTotal / daysToPayCount) : null,
      activeClients: (window.clients||[]).filter(function(c){ return c.status === 'active'; }).length
    };
  }
  window.renderKpiScorecard = function(){
    var host = document.getElementById('cpg-dashboard');
    if(!host) return;
    var existing = document.getElementById('gl-kpi-scorecard');
    var k = gather();
    if(k.mtdRev === 0 && k.ytdRev === 0 && k.activeClients === 0){ if(existing) existing.remove(); return; }
    var card = function(label, value, sub){
      return '<div style="flex:1;min-width:140px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px">' +
        '<div style="font-size:10px;letter-spacing:2px;color:var(--muted)">' + label + '</div>' +
        '<div style="font-family:var(--ff-disp);font-size:20px;color:var(--white);margin-top:4px">' + value + '</div>' +
        (sub ? '<div style="font-size:10px;color:var(--muted);margin-top:2px">' + sub + '</div>' : '') +
      '</div>';
    };
    var html =
      '<div id="gl-kpi-scorecard" class="ccard" style="grid-column:1/-1;margin-top:14px">' +
        '<div class="ccard-t">Business pulse</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:11px;margin-top:10px">' +
          card('MTD REVENUE', fmt$(k.mtdRev)) +
          card('YTD REVENUE', fmt$(k.ytdRev)) +
          card('AVG INVOICE', fmt$(k.avgInv)) +
          card('PAID RATE', k.paidRate + '%', k.paidRate >= 90 ? '✓ healthy' : k.paidRate >= 70 ? 'tighten collections' : 'collections need attention') +
          card('AVG DAYS TO PAY', k.avgDays != null ? k.avgDays + 'd' : '—', 'invoice → paid_at') +
          card('ACTIVE CLIENTS', k.activeClients) +
        '</div>' +
      '</div>';
    if(existing) existing.outerHTML = html;
    else host.insertAdjacentHTML('beforeend', html);
  };
  window.GL_HOOKS.registerDashPatch(function(){ try{ window.renderKpiScorecard(); }catch(e){ console.warn('[GL] KPI threw', e); } });
  console.log('[GL] KPI scorecard loaded');
}());

/* ============================================================
   DEFECT / NCR TRACKER
   FDA / QC defensible log of every non-conformance: what failed,
   when, root cause, corrective action, status. Linked to a run.
   ============================================================ */
(function(){
  function esc(v){ return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  window.glDefects = window.glDefects || [];
  var CATEGORIES = ['Fill weight','Carbonation','pH / brix off-spec','Foam-over','Can dent','Label misregister','Coding error','Contamination suspected','Allergen exposure','Other'];
  var SEVERITY = [['low','Low — cosmetic'],['medium','Medium — recoverable'],['high','High — hold + investigate'],['critical','Critical — recall risk']];
  var STATUSES = [['open','Open'],['investigating','Investigating'],['contained','Contained'],['closed','Closed']];

  async function loadFromSupabase(){
    if(!window.supa) return null;
    try { var r = await window.supa.from('defects').select('*').order('reported_at',{ascending:false}); if(r && r.data) return r.data; }
    catch(e){}
    return null;
  }
  function loadLocal(){ try { return JSON.parse(localStorage.getItem('gl_defects') || '[]'); } catch(e){ return []; } }
  function saveLocal(){ localStorage.setItem('gl_defects', JSON.stringify(window.glDefects)); }

  async function refresh(){
    var rows = await loadFromSupabase();
    window.glDefects = rows || loadLocal();
    render();
  }

  function severityColor(s){
    return ({ low:'#9aa7bd', medium:'#f5c842', high:'#ff8579', critical:'#e74c3c' })[s] || '#9aa7bd';
  }
  function statusColor(s){
    return ({ open:'#ff8579', investigating:'#f5c842', contained:'#7fc6f5', closed:'#5fcf9e' })[s] || '#9aa7bd';
  }

  function render(){
    var host = document.getElementById('def-body');
    if(!host) return;
    var sub = document.getElementById('def-sub');
    var rows = window.glDefects || [];
    var open = rows.filter(function(r){ return r.status !== 'closed'; }).length;
    var critical = rows.filter(function(r){ return r.severity === 'critical' && r.status !== 'closed'; }).length;
    if(sub) sub.textContent = rows.length + ' total' + (open ? ' · ' + open + ' open' : '') + (critical ? ' · ' + critical + ' CRITICAL unresolved' : '');

    if(!rows.length){
      host.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No defects logged. Hopefully it stays this way — but log anything off-spec so root causes show patterns.</div>';
      return;
    }
    host.innerHTML = '<table class="ctbl"><thead><tr><th>When</th><th>Run</th><th>Category</th><th>Severity</th><th>Status</th><th>Owner</th></tr></thead><tbody>' +
      rows.map(function(r){
        var when = r.reported_at ? new Date(r.reported_at).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—';
        var sevLabel = (SEVERITY.find(function(x){ return x[0] === r.severity; }) || ['',''])[1] || r.severity;
        var statLabel = (STATUSES.find(function(x){ return x[0] === r.status; }) || ['',''])[1] || r.status;
        return '<tr style="cursor:pointer" onclick="window.glOpenEditDefect(\'' + esc(r.id) + '\')">' +
          '<td style="padding:11px;color:var(--white);font-weight:600">' + when + '</td>' +
          '<td style="padding:11px;color:var(--muted)">' + esc(r.run_ref || '—') + '</td>' +
          '<td style="padding:11px;color:var(--muted)">' + esc(r.category || '—') + '</td>' +
          '<td style="padding:11px"><span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700;background:' + severityColor(r.severity) + '22;color:' + severityColor(r.severity) + ';border:1px solid ' + severityColor(r.severity) + '55">' + esc(sevLabel) + '</span></td>' +
          '<td style="padding:11px"><span style="padding:3px 9px;border-radius:20px;font-size:11px;font-weight:600;background:' + statusColor(r.status) + '22;color:' + statusColor(r.status) + ';border:1px solid ' + statusColor(r.status) + '55">' + esc(statLabel) + '</span></td>' +
          '<td style="padding:11px;color:var(--muted)">' + esc(r.owner || '—') + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  function defectModal(existing){
    var prior = document.getElementById('gl-def-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var isEdit = !!existing;
    var d = existing || { run_ref:'', category:'Fill weight', severity:'medium', status:'open', owner:'', description:'', root_cause:'', corrective_action:'', reported_at: new Date().toISOString().slice(0,16), closed_at:null };
    var catOpts = CATEGORIES.map(function(c){ return '<option' + (c === d.category ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    var sevOpts = SEVERITY.map(function(s){ return '<option value="' + s[0] + '"' + (s[0] === d.severity ? ' selected' : '') + '>' + esc(s[1]) + '</option>'; }).join('');
    var statOpts = STATUSES.map(function(s){ return '<option value="' + s[0] + '"' + (s[0] === d.status ? ' selected' : '') + '>' + esc(s[1]) + '</option>'; }).join('');

    var ov = document.createElement('div');
    ov.id = 'gl-def-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:540px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">' + (isEdit ? '✏️ EDIT NCR' : '⚠️ LOG DEFECT') + '</div>' +
          '<button id="gl-def-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Reported *</div><input class="finp" id="gl-def-when" type="datetime-local" value="' + esc(d.reported_at) + '"></div>' +
        '<div class="frow"><div class="flbl">Run reference *</div><input class="finp" id="gl-def-run" value="' + esc(d.run_ref) + '" placeholder="e.g. SunBurst Mango v3"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Category</div><select class="fsel" id="gl-def-cat">' + catOpts + '</select></div>' +
          '<div class="frow"><div class="flbl">Severity</div><select class="fsel" id="gl-def-sev">' + sevOpts + '</select></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Status</div><select class="fsel" id="gl-def-stat">' + statOpts + '</select></div>' +
          '<div class="frow"><div class="flbl">Owner *</div><input class="finp" id="gl-def-owner" value="' + esc(d.owner) + '"></div>' +
        '</div>' +
        '<div class="frow"><div class="flbl">What was observed</div><textarea class="finp" id="gl-def-desc" rows="3">' + esc(d.description) + '</textarea></div>' +
        '<div class="frow"><div class="flbl">Suspected root cause</div><textarea class="finp" id="gl-def-root" rows="2">' + esc(d.root_cause) + '</textarea></div>' +
        '<div class="frow"><div class="flbl">Corrective action taken</div><textarea class="finp" id="gl-def-corr" rows="2">' + esc(d.corrective_action) + '</textarea></div>' +
        '<div style="display:flex;gap:8px;margin-top:6px">' +
          '<button id="gl-def-save" class="cbtn pri" style="flex:1">💾 Save</button>' +
          (isEdit ? '<button id="gl-def-del" class="cbtn" style="background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#ff8579">Delete</button>' : '') +
          '<button id="gl-def-cancel" class="cbtn">Cancel</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-def-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-def-cancel').addEventListener('click', function(){ ov.remove(); });
    var del = ov.querySelector('#gl-def-del');
    if(del) del.addEventListener('click', async function(){
      if(!confirm('Delete this NCR? FDA expects you to retain non-conformance records.')) return;
      if(window.supa){ try { await window.supa.from('defects').delete().eq('id', d.id); } catch(e){} }
      window.glDefects = (window.glDefects||[]).filter(function(x){ return x.id !== d.id; });
      saveLocal(); render(); ov.remove();
    });
    ov.querySelector('#gl-def-save').addEventListener('click', async function(){
      var runRef = ov.querySelector('#gl-def-run').value.trim();
      var owner = ov.querySelector('#gl-def-owner').value.trim();
      if(!runRef || !owner){ alert('Run reference and owner are required.'); return; }
      var status = ov.querySelector('#gl-def-stat').value;
      var data = {
        reported_at:       ov.querySelector('#gl-def-when').value || new Date().toISOString(),
        run_ref:           runRef,
        category:          ov.querySelector('#gl-def-cat').value,
        severity:          ov.querySelector('#gl-def-sev').value,
        status:            status,
        owner:             owner,
        description:       ov.querySelector('#gl-def-desc').value,
        root_cause:        ov.querySelector('#gl-def-root').value,
        corrective_action: ov.querySelector('#gl-def-corr').value,
        closed_at:         status === 'closed' ? new Date().toISOString() : null
      };
      if(window.supa){
        try {
          if(isEdit){ await window.supa.from('defects').update(data).eq('id', d.id); Object.assign(d, data); }
          else { var r = await window.supa.from('defects').insert([data]).select().single(); if(r && r.data){ window.glDefects.unshift(r.data); } else { data.id = 'local_' + Date.now(); window.glDefects.unshift(data); } }
        } catch(e){
          if(isEdit) Object.assign(d, data);
          else { data.id = 'local_' + Date.now(); window.glDefects.unshift(data); }
        }
      } else {
        if(isEdit) Object.assign(d, data);
        else { data.id = 'local_' + Date.now(); window.glDefects.unshift(data); }
      }
      saveLocal(); ov.remove(); render();
      if(typeof addNotification === 'function') addNotification('⚠️ NCR ' + (isEdit ? 'updated' : 'logged'), data.run_ref + ' — ' + data.severity.toUpperCase(), data.severity === 'critical' ? 'warning' : 'info');
      if(typeof window.glAudit === 'function') window.glAudit(isEdit ? 'defect_edited' : 'defect_logged', data.run_ref, { severity: data.severity, status: data.status });
    });
    host.appendChild(ov);
  }
  window.glOpenAddDefect  = function(){ defectModal(null); };
  window.glOpenEditDefect = function(id){
    var d = (window.glDefects||[]).find(function(x){ return x.id === id; });
    if(d) defectModal(d);
  };
  function watch(){
    var pg = document.getElementById('cpg-defects');
    if(!pg){ setTimeout(watch, 600); return; }
    new MutationObserver(function(){ if(pg.classList.contains('act')) refresh(); }).observe(pg, { attributes:true, attributeFilter:['class'] });
  }
  if(document.readyState !== 'loading') watch();
  else document.addEventListener('DOMContentLoaded', watch);
  console.log('[GL] defects / NCR tracker loaded');
}());

/* ============================================================
   VENDOR DIRECTORY
   Suppliers + lead times + COI expiration + contact info.
   ============================================================ */
(function(){
  function esc(v){ return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  window.glVendors = window.glVendors || [];
  var CATEGORIES = ['Cans / Bottles','Caps / Closures','Labels / Packaging','Ingredients — Sweeteners','Ingredients — Flavors','Ingredients — Actives','CO2 / Gases','PakTech / Handles','Pallets / Shipping','Sanitation chemicals','Lab / COA testing','Freight / 3PL','Other'];

  async function loadFromSupabase(){
    if(!window.supa) return null;
    try { var r = await window.supa.from('vendors').select('*').order('name',{ascending:true}); if(r && r.data) return r.data; }
    catch(e){}
    return null;
  }
  function loadLocal(){ try { return JSON.parse(localStorage.getItem('gl_vendors') || '[]'); } catch(e){ return []; } }
  function saveLocal(){ localStorage.setItem('gl_vendors', JSON.stringify(window.glVendors)); }

  async function refresh(){
    var rows = await loadFromSupabase();
    window.glVendors = rows || loadLocal();
    render();
  }

  function coiBadge(v){
    if(!v.coi_expires) return '<span style="font-size:10px;color:rgba(255,255,255,.3);font-style:italic">no COI tracked</span>';
    var today = new Date(); today.setHours(0,0,0,0);
    var exp = new Date(v.coi_expires); exp.setHours(0,0,0,0);
    var d = Math.round((exp - today) / 86400000);
    if(d < 0)     return '<span style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:rgba(231,76,60,.15);color:#ff8579;border:1px solid rgba(231,76,60,.35)">COI EXPIRED ' + (-d) + 'd</span>';
    if(d < 30)   return '<span style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:rgba(245,200,66,.15);color:#f5c842;border:1px solid rgba(245,200,66,.35)">COI in ' + d + 'd</span>';
    return '<span style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:600;background:rgba(29,158,117,.15);color:#5fcf9e;border:1px solid rgba(29,158,117,.35)">COI ' + v.coi_expires + '</span>';
  }

  function render(){
    var host = document.getElementById('ven-body');
    if(!host) return;
    var sub = document.getElementById('ven-sub');
    var rows = window.glVendors || [];
    if(sub) sub.textContent = rows.length + ' vendor' + (rows.length === 1 ? '' : 's') + ' on file';

    if(!rows.length){
      host.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No vendors tracked yet. Add suppliers so you can see who has expiring COIs at a glance.</div>';
      return;
    }
    host.innerHTML = '<table class="ctbl"><thead><tr><th>Vendor</th><th>Category</th><th>Lead time</th><th>Contact</th><th>COI</th></tr></thead><tbody>' +
      rows.map(function(v){
        return '<tr style="cursor:pointer" onclick="window.glOpenEditVendor(\'' + esc(v.id) + '\')">' +
          '<td style="padding:11px;color:var(--white);font-weight:600">' + esc(v.name) + '</td>' +
          '<td style="padding:11px;color:var(--muted)">' + esc(v.category || '—') + '</td>' +
          '<td style="padding:11px;color:var(--muted)">' + (v.lead_time_days ? v.lead_time_days + ' days' : '—') + '</td>' +
          '<td style="padding:11px;color:var(--muted);font-size:11px">' + esc(v.contact_name || '—') + (v.email ? ' · ' + esc(v.email) : '') + '</td>' +
          '<td style="padding:11px">' + coiBadge(v) + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  function vendorModal(existing){
    var prior = document.getElementById('gl-ven-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var isEdit = !!existing;
    var v = existing || { name:'', category:'Ingredients — Flavors', contact_name:'', email:'', phone:'', lead_time_days:'', moq:'', payment_terms:'', coi_expires:'', notes:'' };
    var catOpts = CATEGORIES.map(function(c){ return '<option' + (c === v.category ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    var ov = document.createElement('div');
    ov.id = 'gl-ven-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:500px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">' + (isEdit ? '✏️ EDIT VENDOR' : '🏭 ADD VENDOR') + '</div>' +
          '<button id="gl-ven-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Vendor name *</div><input class="finp" id="gl-ven-name" value="' + esc(v.name) + '"></div>' +
        '<div class="frow"><div class="flbl">Category</div><select class="fsel" id="gl-ven-cat">' + catOpts + '</select></div>' +
        '<div class="frow"><div class="flbl">Contact name</div><input class="finp" id="gl-ven-contact" value="' + esc(v.contact_name) + '"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Email</div><input class="finp" id="gl-ven-email" type="email" value="' + esc(v.email) + '"></div>' +
          '<div class="frow"><div class="flbl">Phone</div><input class="finp" id="gl-ven-phone" value="' + esc(v.phone) + '"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Lead time (days)</div><input class="finp" id="gl-ven-lead" type="number" min="0" value="' + esc(v.lead_time_days) + '"></div>' +
          '<div class="frow"><div class="flbl">Minimum Order Quantity (MOQ)</div><input class="finp" id="gl-ven-moq" value="' + esc(v.moq) + '" placeholder="e.g. 50,000 cans"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Payment terms</div><input class="finp" id="gl-ven-terms" value="' + esc(v.payment_terms) + '" placeholder="e.g. Net 30"></div>' +
          '<div class="frow"><div class="flbl">Certificate of Insurance (COI) expires</div><input class="finp" id="gl-ven-coi" type="date" value="' + esc(v.coi_expires) + '"></div>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Notes</div><textarea class="finp" id="gl-ven-notes" rows="3">' + esc(v.notes) + '</textarea></div>' +
        '<div style="display:flex;gap:8px;margin-top:6px">' +
          '<button id="gl-ven-save" class="cbtn pri" style="flex:1">💾 Save</button>' +
          (isEdit ? '<button id="gl-ven-del" class="cbtn" style="background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#ff8579">Delete</button>' : '') +
          '<button id="gl-ven-cancel" class="cbtn">Cancel</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-ven-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-ven-cancel').addEventListener('click', function(){ ov.remove(); });
    var del = ov.querySelector('#gl-ven-del');
    if(del) del.addEventListener('click', async function(){
      if(!confirm('Delete vendor "' + v.name + '"?')) return;
      if(window.supa){ try { await window.supa.from('vendors').delete().eq('id', v.id); } catch(e){} }
      window.glVendors = (window.glVendors||[]).filter(function(x){ return x.id !== v.id; });
      saveLocal(); render(); ov.remove();
    });
    ov.querySelector('#gl-ven-save').addEventListener('click', async function(){
      var name = ov.querySelector('#gl-ven-name').value.trim();
      if(!name){ alert('Name is required.'); return; }
      var data = {
        name:          name,
        category:      ov.querySelector('#gl-ven-cat').value,
        contact_name:  ov.querySelector('#gl-ven-contact').value.trim(),
        email:         ov.querySelector('#gl-ven-email').value.trim(),
        phone:         ov.querySelector('#gl-ven-phone').value.trim(),
        lead_time_days: parseInt(ov.querySelector('#gl-ven-lead').value, 10) || null,
        moq:           ov.querySelector('#gl-ven-moq').value.trim(),
        payment_terms: ov.querySelector('#gl-ven-terms').value.trim(),
        coi_expires:   ov.querySelector('#gl-ven-coi').value || null,
        notes:         ov.querySelector('#gl-ven-notes').value
      };
      if(window.supa){
        try {
          if(isEdit){ await window.supa.from('vendors').update(data).eq('id', v.id); Object.assign(v, data); }
          else { var r = await window.supa.from('vendors').insert([data]).select().single(); if(r && r.data){ window.glVendors.push(r.data); } else { data.id = 'local_' + Date.now(); window.glVendors.push(data); } }
        } catch(e){
          if(isEdit) Object.assign(v, data);
          else { data.id = 'local_' + Date.now(); window.glVendors.push(data); }
        }
      } else {
        if(isEdit) Object.assign(v, data);
        else { data.id = 'local_' + Date.now(); window.glVendors.push(data); }
      }
      saveLocal(); ov.remove(); render();
      if(typeof addNotification === 'function') addNotification('🏭 Vendor ' + (isEdit ? 'updated' : 'added'), data.name, 'success');
    });
    host.appendChild(ov);
  }
  window.glOpenAddVendor  = function(){ vendorModal(null); };
  window.glOpenEditVendor = function(id){
    var v = (window.glVendors||[]).find(function(x){ return x.id === id; });
    if(v) vendorModal(v);
  };
  function watch(){
    var pg = document.getElementById('cpg-vendors');
    if(!pg){ setTimeout(watch, 600); return; }
    new MutationObserver(function(){ if(pg.classList.contains('act')) refresh(); }).observe(pg, { attributes:true, attributeFilter:['class'] });
  }
  if(document.readyState !== 'loading') watch();
  else document.addEventListener('DOMContentLoaded', watch);
  console.log('[GL] vendor directory loaded');
}());

/* ============================================================
   RECIPE COST CALCULATOR (toolbar tool)
   Plug in ingredient costs + batch yield → per-case COGS.
   Standalone calculator; doesn't persist (or saves to localStorage).
   ============================================================ */
(function(){
  function fmt$(n, d){ return '$' + Number(n||0).toFixed(d == null ? 2 : d); }

  window.openRecipeCostCalc = function(){
    var prior = document.getElementById('gl-rcc-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem('gl_recipe_calc') || 'null'); } catch(e){}
    var batch = saved || { name:'', batch_size_gal: 100, yield_per_gal: 12.5, ingredients:[{name:'',qty_per_gal:'',unit:'oz',cost_per_unit:''}], can_cost:0.30, packaging_cost:0.05, labor_cost:1.20 };
    if(!batch.ingredients || !batch.ingredients.length) batch.ingredients = [{name:'',qty_per_gal:'',unit:'oz',cost_per_unit:''}];

    function compute(){
      // ingredients per case
      var ingTotal = 0;
      batch.ingredients.forEach(function(i){
        var qty = parseFloat(i.qty_per_gal) || 0;
        var c   = parseFloat(i.cost_per_unit) || 0;
        var perGal = qty * c;
        ingTotal += perGal;
      });
      // cases per gallon: yield_per_gal cans, 24 cans per case → /24
      var casesPerGal = (parseFloat(batch.yield_per_gal) || 0) / 24;
      var ingPerCase = casesPerGal > 0 ? (ingTotal / casesPerGal) : 0;
      var canPerCase = (parseFloat(batch.can_cost) || 0) * 24;
      var pkgPerCase = (parseFloat(batch.packaging_cost) || 0) * 24;
      var labor = parseFloat(batch.labor_cost) || 0;
      var total = ingPerCase + canPerCase + pkgPerCase + labor;
      return { ingPerCase: ingPerCase, canPerCase: canPerCase, pkgPerCase: pkgPerCase, labor: labor, total: total };
    }

    function ingRowHtml(i, idx){
      return '<div style="display:grid;grid-template-columns:1.5fr 70px 70px 90px 30px;gap:6px;margin-bottom:5px" data-idx="' + idx + '">' +
        '<input class="finp gl-ing" data-k="name" placeholder="Ingredient" value="' + (i.name||'').replace(/"/g,'&quot;') + '">' +
        '<input class="finp gl-ing" data-k="qty_per_gal" type="number" step="any" placeholder="qty/gal" value="' + (i.qty_per_gal||'') + '">' +
        '<select class="fsel gl-ing" data-k="unit"><option' + (i.unit==='oz' ? ' selected' : '') + '>oz</option><option' + (i.unit==='ml' ? ' selected' : '') + '>ml</option><option' + (i.unit==='g' ? ' selected' : '') + '>g</option><option' + (i.unit==='lb' ? ' selected' : '') + '>lb</option><option' + (i.unit==='ea' ? ' selected' : '') + '>ea</option></select>' +
        '<input class="finp gl-ing" data-k="cost_per_unit" type="number" step="any" placeholder="$/unit" value="' + (i.cost_per_unit||'') + '">' +
        '<button class="gl-ing-rm" style="background:none;border:none;color:#ff8579;cursor:pointer;font-size:16px">✕</button>' +
      '</div>';
    }

    function render(){
      var c = compute();
      ov.querySelector('#gl-rcc-out').innerHTML =
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px">' +
          '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:10px;text-align:center"><div style="font-size:9px;color:var(--muted);letter-spacing:1px">INGREDIENTS</div><div style="font-family:var(--ff-disp);font-size:16px;color:var(--white)">' + fmt$(c.ingPerCase) + '</div></div>' +
          '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:10px;text-align:center"><div style="font-size:9px;color:var(--muted);letter-spacing:1px">CANS</div><div style="font-family:var(--ff-disp);font-size:16px;color:var(--white)">' + fmt$(c.canPerCase) + '</div></div>' +
          '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:10px;text-align:center"><div style="font-size:9px;color:var(--muted);letter-spacing:1px">PACKAGING</div><div style="font-family:var(--ff-disp);font-size:16px;color:var(--white)">' + fmt$(c.pkgPerCase) + '</div></div>' +
          '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:10px;text-align:center"><div style="font-size:9px;color:var(--muted);letter-spacing:1px">LABOR</div><div style="font-family:var(--ff-disp);font-size:16px;color:var(--white)">' + fmt$(c.labor) + '</div></div>' +
        '</div>' +
        '<div style="background:rgba(0,229,192,.08);border:1px solid rgba(0,229,192,.25);border-radius:10px;padding:14px;text-align:center">' +
          '<div style="font-size:10px;letter-spacing:2px;color:var(--teal);margin-bottom:4px">COGS PER CASE</div>' +
          '<div style="font-family:var(--ff-disp);font-size:32px;color:var(--white)">' + fmt$(c.total) + '</div>' +
          '<div style="font-size:11px;color:var(--muted);margin-top:4px">≈ ' + fmt$(c.total / 24, 3) + ' / can — set retail at 3-4× COGS for healthy margin</div>' +
        '</div>';
    }

    function rebuildIngList(){
      ov.querySelector('#gl-rcc-ings').innerHTML = batch.ingredients.map(ingRowHtml).join('');
      ov.querySelectorAll('.gl-ing').forEach(function(el){
        el.addEventListener('input', function(){
          var idx = parseInt(el.closest('[data-idx]').getAttribute('data-idx'), 10);
          var k = el.getAttribute('data-k');
          batch.ingredients[idx][k] = el.value;
          stash(); render();
        });
      });
      ov.querySelectorAll('.gl-ing-rm').forEach(function(b){
        b.addEventListener('click', function(){
          var idx = parseInt(b.closest('[data-idx]').getAttribute('data-idx'), 10);
          batch.ingredients.splice(idx, 1);
          if(!batch.ingredients.length) batch.ingredients.push({name:'',qty_per_gal:'',unit:'oz',cost_per_unit:''});
          rebuildIngList(); stash(); render();
        });
      });
    }

    function stash(){ localStorage.setItem('gl_recipe_calc', JSON.stringify(batch)); }

    var ov = document.createElement('div');
    ov.id = 'gl-rcc-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:680px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">🧮 RECIPE COST CALCULATOR</div>' +
          '<button id="gl-rcc-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:11px;color:#9aa7bd;margin-bottom:14px;line-height:1.6">Plug in batch size + per-gallon ingredient costs to see your true COGS per case. Calculations assume 24 cans/case. Saved locally per device.</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">' +
          '<div class="frow"><div class="flbl">Batch size (gallons)</div><input class="finp gl-rcc-meta" data-k="batch_size_gal" type="number" step="any" value="' + (batch.batch_size_gal||100) + '"></div>' +
          '<div class="frow"><div class="flbl">Yield (cans / gallon)</div><input class="finp gl-rcc-meta" data-k="yield_per_gal" type="number" step="any" value="' + (batch.yield_per_gal||12.5) + '"></div>' +
        '</div>' +
        '<div style="font-family:var(--ff-disp);font-size:11px;letter-spacing:2px;color:var(--teal);margin-bottom:6px">INGREDIENTS (per gallon)</div>' +
        '<div style="display:grid;grid-template-columns:1.5fr 70px 70px 90px 30px;gap:6px;margin-bottom:4px;font-size:9px;color:var(--muted);letter-spacing:1px">' +
          '<div>NAME</div><div>QTY/GAL</div><div>UNIT</div><div>$/UNIT</div><div></div>' +
        '</div>' +
        '<div id="gl-rcc-ings"></div>' +
        '<button id="gl-rcc-add" class="cbtn" style="font-size:11px;padding:5px 11px;margin-bottom:14px">+ Add ingredient</button>' +
        '<div style="font-family:var(--ff-disp);font-size:11px;letter-spacing:2px;color:var(--teal);margin-bottom:6px">PACKAGING / LABOR (per can / per case)</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px">' +
          '<div class="frow"><div class="flbl">Can cost / each</div><input class="finp gl-rcc-meta" data-k="can_cost" type="number" step="any" value="' + (batch.can_cost||0) + '"></div>' +
          '<div class="frow"><div class="flbl">Lid/label / each</div><input class="finp gl-rcc-meta" data-k="packaging_cost" type="number" step="any" value="' + (batch.packaging_cost||0) + '"></div>' +
          '<div class="frow"><div class="flbl">Labor / case</div><input class="finp gl-rcc-meta" data-k="labor_cost" type="number" step="any" value="' + (batch.labor_cost||0) + '"></div>' +
        '</div>' +
        '<div id="gl-rcc-out"></div>' +
        '<div style="display:flex;gap:8px;margin-top:14px">' +
          '<button id="gl-rcc-copy" class="cbtn pri" style="flex:1">📋 Copy summary to clipboard</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-rcc-close').addEventListener('click', function(){ ov.remove(); });
    host.appendChild(ov);
    rebuildIngList();
    render();

    ov.querySelectorAll('.gl-rcc-meta').forEach(function(el){
      el.addEventListener('input', function(){ batch[el.getAttribute('data-k')] = el.value; stash(); render(); });
    });
    ov.querySelector('#gl-rcc-add').addEventListener('click', function(){
      batch.ingredients.push({name:'',qty_per_gal:'',unit:'oz',cost_per_unit:''});
      rebuildIngList(); stash(); render();
    });
    ov.querySelector('#gl-rcc-copy').addEventListener('click', async function(){
      var c = compute();
      var txt = 'COGS breakdown\n' +
        '- Ingredients: ' + fmt$(c.ingPerCase) + ' / case\n' +
        '- Cans: ' + fmt$(c.canPerCase) + ' / case\n' +
        '- Packaging: ' + fmt$(c.pkgPerCase) + ' / case\n' +
        '- Labor: ' + fmt$(c.labor) + ' / case\n' +
        '———\nTotal COGS: ' + fmt$(c.total) + ' / case (' + fmt$(c.total/24, 3) + ' / can)';
      try { await navigator.clipboard.writeText(txt); } catch(e){
        var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      }
      this.textContent = '✓ Copied'; setTimeout(function(){ ov.querySelector('#gl-rcc-copy').textContent = '📋 Copy summary to clipboard'; }, 1500);
    });
  };
  console.log('[GL] recipe cost calculator loaded');
}());
