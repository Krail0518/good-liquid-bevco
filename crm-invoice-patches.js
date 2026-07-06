/* ==========================================================
   PRICING PATCH — Supabase rates + admin editor
   Canning & Bottling pulled from DB, never hardcoded
   ========================================================== */
(function(){

  var SURL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1';
  var SKEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE';
  var SH   = { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY, 'Content-Type': 'application/json' };
  var CANS_PER_CASE = 24;

  /* ── Rate cache ────────────────────────────────────────── */
  window._glRates = { canning: [], bottling: [], loaded: false, overrides: {} };

  window.glLoadRates = async function() {
    if (window._glRates.loaded) return window._glRates;
    try {
      var res = await Promise.all([
        fetch(SURL + '/canning_rates?order=format,min_cases',  {headers: SH}).then(function(r){return r.json();}),
        fetch(SURL + '/bottling_rates?order=format,min_units', {headers: SH}).then(function(r){return r.json();})
      ]);
      window._glRates.canning  = Array.isArray(res[0]) ? res[0] : [];
      window._glRates.bottling = Array.isArray(res[1]) ? res[1] : [];
      window._glRates.loaded   = true;
    } catch(e) { console.error('[GL] Rate load failed', e); }
    return window._glRates;
  };

  // Per-client negotiated rates. Cached in memory keyed by client_id so the
  // builder reads them synchronously when rendering line rows. Refreshed on
  // demand by glLoadClientOverrides(clientId).
  window.glLoadClientOverrides = async function(clientId){
    if(!clientId) return null;
    try {
      var rows = await fetch(SURL + '/client_rate_overrides?client_id=eq.' + clientId, {headers: SH}).then(function(r){ return r.json(); });
      if(Array.isArray(rows)){
        var byKey = {};
        rows.forEach(function(r){
          var k = (r.service||'') + '|' + (r.format||'');
          byKey[k] = r;
        });
        window._glRates.overrides[clientId] = byKey;
        return byKey;
      }
    } catch(e){ console.warn('[GL] client override load failed', e); }
    return null;
  };
  // Re-renders any existing canning/bottling rows after a new client is
  // picked so the override rate is applied immediately. Used by the
  // invoice builder's client dropdown onchange handler.
  window.glOnInvClientChange = async function(clientId){
    if(!clientId) return;
    await window.glLoadClientOverrides(clientId);
    document.querySelectorAll('[id$="-format"]').forEach(function(fe){
      var uid = fe.id.replace(/-format$/, '');
      var row = document.getElementById(uid);
      if(!row) return;
      // Reset any manual price override so the new client's rate takes effect.
      if(row.hasAttribute('data-pu-override')) row.removeAttribute('data-pu-override');
      if(document.getElementById(uid+'-cases') && typeof window.glUpdateCan === 'function') window.glUpdateCan(uid);
      if(document.getElementById(uid+'-qty')   && typeof window.glUpdateBtl === 'function') window.glUpdateBtl(uid);
    });
    // Refresh the small chip showing whether this client has overrides.
    // Only count rows whose effective_from/until window includes today —
    // expired or not-yet-active overrides shouldn't show as "applied."
    var badge = document.getElementById('gl-inv-pricing-badge');
    if(badge){
      var cache = window._glRates.overrides && window._glRates.overrides[clientId];
      var today = new Date().toISOString().slice(0,10);
      var count = 0;
      if(cache){
        Object.keys(cache).forEach(function(k){
          var r = cache[k];
          if(r.effective_from   && today < r.effective_from)   return;
          if(r.effective_until  && today > r.effective_until)  return;
          count++;
        });
      }
      if(count){
        badge.style.display = 'inline-block';
        badge.textContent = '💵 ' + count + ' custom rate' + (count===1?'':'s') + ' applied';
      } else {
        badge.style.display = 'none';
      }
    }
  };
  function getClientOverride(clientId, service, format){
    if(!clientId) return null;
    var byKey = window._glRates.overrides && window._glRates.overrides[clientId];
    if(!byKey) return null;
    // Honor effective_from / effective_until if set.
    function active(r){
      if(!r) return false;
      var today = new Date().toISOString().slice(0,10);
      if(r.effective_from   && today < r.effective_from)   return false;
      if(r.effective_until  && today > r.effective_until)  return false;
      return true;
    }
    // Exact format match first; fall back to format-agnostic for hour services.
    var exact = byKey[service + '|' + (format||'')];
    if(active(exact)) return parseFloat(exact.override_rate);
    var anyFmt = byKey[service + '|'];
    if(active(anyFmt)) return parseFloat(anyFmt.override_rate);
    return null;
  }
  window.glGetClientOverride = getClientOverride;

  function getCanRate(cases, format, clientId) {
    var ovr = getClientOverride(clientId, 'canning', format);
    if(ovr != null) return ovr;
    var tiers = window._glRates.canning
      .filter(function(r){ return r.format === format; })
      .sort(function(a,b){ return a.min_cases - b.min_cases; });
    if (!tiers.length) return 0.48;
    var rate = parseFloat(tiers[0].price_per_can);
    for (var i = 0; i < tiers.length; i++) {
      if (cases >= tiers[i].min_cases) rate = parseFloat(tiers[i].price_per_can);
    }
    return rate;
  }

  function getBottleRate(units, format, clientId) {
    var ovr = getClientOverride(clientId, 'bottling', format);
    if(ovr != null) return ovr;
    var tiers = window._glRates.bottling
      .filter(function(r){ return r.format === format; })
      .sort(function(a,b){ return a.min_units - b.min_units; });
    if (!tiers.length) return 2.25;
    var rate = parseFloat(tiers[0].price_per_unit);
    for (var i = 0; i < tiers.length; i++) {
      if (units >= tiers[i].min_units) rate = parseFloat(tiers[i].price_per_unit);
    }
    return rate;
  }

  function usd(n, d) {
    return '$' + parseFloat(n).toLocaleString('en-US', {
      minimumFractionDigits: d == null ? 2 : d,
      maximumFractionDigits: d == null ? 2 : d
    });
  }

  function getLineTable() {
    var b = document.getElementById('gl-inv-body');
    return b ? b.children[2] : null;
  }

  /* ── Pricing Admin Page ────────────────────────────────── */
  window.glOpenPricing = async function() {
    document.getElementById('gl-pricing-modal')?.remove();
    await window.glLoadRates();

    var modal = document.createElement('div');
    modal.id = 'gl-pricing-modal';
    modal.setAttribute('style',
      'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px');

    function buildTable(title, rows, pkField, labelField, minField, priceField, tableKey) {
      var grouped = {};
      rows.forEach(function(r) { (grouped[r[labelField]] = grouped[r[labelField]] || []).push(r); });
      var html = '<div style="margin-bottom:24px">' +
        '<div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:10px">' + title + '</div>' +
        '<table style="width:100%;border-collapse:collapse">' +
        '<tr style="font-size:11px;color:var(--muted)">' +
        '<th style="text-align:left;padding:6px 8px">Format</th>' +
        '<th style="text-align:left;padding:6px 8px">Min ' + (tableKey==='canning'?'Cases':'Units') + '</th>' +
        '<th style="text-align:left;padding:6px 8px">Price</th>' +
        '<th style="padding:6px 8px"></th></tr>';
      rows.forEach(function(r) {
        html += '<tr style="border-top:1px solid rgba(255,255,255,.06)">' +
          '<td style="padding:7px 8px;font-size:12px;color:#fff">' + r[labelField] + '</td>' +
          '<td style="padding:7px 8px;font-size:12px;color:var(--muted)">' + r[minField] + '+</td>' +
          '<td style="padding:7px 8px">' +
          '<input data-id="' + r.id + '" data-table="' + tableKey + '" data-field="' + priceField + '" ' +
          'value="' + parseFloat(r[priceField]).toFixed(4) + '" type="number" step="0.0001" min="0" ' +
          'style="width:90px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:4px 8px;font-size:12px"/>' +
          '</td>' +
          '<td style="padding:7px 8px">' +
          '<button onclick="window.glSaveRate(this)" data-id="' + r.id + '" data-table="' + tableKey + '" data-field="' + priceField + '" ' +
          'style="background:rgba(0,229,192,.15);border:1px solid rgba(0,229,192,.3);color:var(--teal);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer">Save</button>' +
          '</td></tr>';
      });
      html += '</table></div>';
      return html;
    }

    modal.innerHTML =
      '<div style="background:#0d1f33;border:1px solid rgba(255,255,255,.1);border-radius:14px;width:100%;max-width:620px;max-height:85vh;overflow-y:auto;padding:24px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">' +
          '<div style="font-size:16px;font-weight:700;color:#fff">Pricing Manager</div>' +
          '<button onclick="document.getElementById(\'gl-pricing-modal\').remove()" ' +
          'style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer">x</button>' +
        '</div>' +
        buildTable('CANNING RATES (per can)', window._glRates.canning, 'id', 'format_label', 'min_cases', 'price_per_can', 'canning') +
        buildTable('BOTTLING RATES (per bottle)', window._glRates.bottling, 'id', 'format_label', 'min_units', 'price_per_unit', 'bottling') +
        '<div style="font-size:11px;color:var(--muted);margin-top:8px">Changes save instantly to the database and apply to all new invoices.</div>' +
      '</div>';

    document.body.appendChild(modal);
  };

  window.glSaveRate = async function(btn) {
    var id    = btn.getAttribute('data-id');
    var tbl   = btn.getAttribute('data-table');
    var field = btn.getAttribute('data-field');
    var input = btn.parentNode.parentNode.querySelector('input[data-id="' + id + '"]');
    var val   = parseFloat(input.value);
    if (isNaN(val) || val <= 0) { alert('Invalid price'); return; }

    btn.textContent = '...';
    var endpoint = SURL + '/' + (tbl === 'canning' ? 'canning_rates' : 'bottling_rates') + '?id=eq.' + id;
    var body = {};
    body[field] = val;
    body['updated_at'] = new Date().toISOString();

    try {
      var res = await fetch(endpoint, {
        method: 'PATCH',
        headers: Object.assign({}, SH, {'Prefer': 'return=minimal'}),
        body: JSON.stringify(body)
      });
      if (res.ok || res.status === 204) {
        btn.textContent = 'Saved';
        btn.style.background = 'rgba(34,197,94,.2)';
        btn.style.borderColor = 'rgba(34,197,94,.4)';
        btn.style.color = '#22c55e';
        // Update cache
        var cache = tbl === 'canning' ? window._glRates.canning : window._glRates.bottling;
        var row = cache.find(function(r){ return r.id == id; });
        if (row) row[field] = val;
        setTimeout(function(){ btn.textContent='Save'; btn.style.background=''; btn.style.borderColor=''; btn.style.color=''; }, 2000);
      } else {
        btn.textContent = 'Error';
        console.error('[GL] Save failed', res.status);
      }
    } catch(e) {
      btn.textContent = 'Error';
      console.error('[GL] Save error', e);
    }
  };

  /* ── Add Pricing nav button to CRM sidebar ─────────────── */
  function injectPricingNav() {
    var sidebar = document.querySelector('.cpills') || document.querySelector('[class*="nav"]');
    if (document.getElementById('gl-pricing-nav')) return;
    var btn = document.createElement('button');
    btn.id = 'gl-pricing-nav';
    btn.textContent = '$ Pricing';
    btn.onclick = window.glOpenPricing;
    btn.setAttribute('style',
      'background:rgba(0,229,192,.1);border:1px solid rgba(0,229,192,.3);color:var(--teal);' +
      'border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;margin:4px');
    // Add to page in a sensible spot — next to invoices button if it exists
    var invoiceBtn = [...document.querySelectorAll('button,a')].find(function(el){
      return el.textContent.includes('Invoice') || el.textContent.includes('invoice');
    });
    if (invoiceBtn && invoiceBtn.parentNode) {
      invoiceBtn.parentNode.insertBefore(btn, invoiceBtn.nextSibling);
    } else {
      document.body.appendChild(btn);
    }
  }

  // Inject nav after CRM loads
  setTimeout(injectPricingNav, 1500);
  document.addEventListener('click', function() { setTimeout(injectPricingNav, 500); });

  console.log('[GL] Pricing patch loaded — Supabase rates active');
}());

/* ============================================================
   INVOICE PRICING - Supabase live rates. Do not remove.
   ============================================================ */
(function(){
  var SURL='https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1';
  var SKEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE';
  var SH={'apikey':SKEY,'Authorization':'Bearer '+SKEY,'Content-Type':'application/json'};
  var CPC=24;
  window._glR={c:[],b:[],ok:false};
  window.glLoadRates=async function(){
    if(window._glR.ok)return;
    var res=await Promise.all([
      fetch(SURL+'/canning_rates?order=format,min_cases',{headers:SH}).then(function(r){return r.json();}),
      fetch(SURL+'/bottling_rates?order=format,min_units',{headers:SH}).then(function(r){return r.json();})
    ]);
    window._glR.c=Array.isArray(res[0])?res[0]:[];
    window._glR.b=Array.isArray(res[1])?res[1]:[];
    window._glR.ok=true;
  };
  window.glGetCanRate=function(cases,fmt,clientId){
    clientId = clientId || (window.INV && window.INV.clientId) || null;
    if(typeof window.glGetClientOverride === 'function'){
      var ovr = window.glGetClientOverride(clientId,'canning',fmt);
      if(ovr != null) return ovr;
    }
    var t=window._glR.c.filter(function(r){return r.format===fmt;}).sort(function(a,b){return a.min_cases-b.min_cases;});
    if(!t.length)return 0;
    var v=parseFloat(t[0].price_per_can);
    for(var i=0;i<t.length;i++)if(cases>=t[i].min_cases)v=parseFloat(t[i].price_per_can);
    return v;
  };
  window.glGetBtlRate=function(qty,fmt,clientId){
    clientId = clientId || (window.INV && window.INV.clientId) || null;
    if(typeof window.glGetClientOverride === 'function'){
      var ovr = window.glGetClientOverride(clientId,'bottling',fmt);
      if(ovr != null) return ovr;
    }
    var t=window._glR.b.filter(function(r){return r.format===fmt;}).sort(function(a,b){return a.min_units-b.min_units;});
    if(!t.length)return 0;
    var v=parseFloat(t[0].price_per_unit);
    for(var i=0;i<t.length;i++)if(qty>=t[i].min_units)v=parseFloat(t[i].price_per_unit);
    return v;
  };
  window.glUsd=function(n,d){return'$'+parseFloat(n).toLocaleString('en-US',{minimumFractionDigits:d==null?2:d,maximumFractionDigits:d==null?2:d});};
  window.glGetTbl=function(){var b=document.getElementById('gl-inv-body');return b?b.children[2]:null;};
  window.glCalcInvTotal=function(){
    var tot=0;
    document.querySelectorAll('[data-gl-total]').forEach(function(el){tot+=parseFloat(el.getAttribute('data-gl-total'))||0;});
    var box=document.getElementById('ginv-totals-box');if(!box)return;
    var disc=document.getElementById('ginv-disc');
    var pct=disc?parseFloat(disc.value)||0:0;
    var grand=tot*(1-pct/100);
    var s=box.children[0]?box.children[0].children[1]:null;
    var g=box.children[1]?box.children[1].children[1]:null;
    if(s)s.textContent=window.glUsd(tot);
    if(g)g.textContent=window.glUsd(grand);
  };
  window.glUpdateCan=function(uid){
    var ce=document.getElementById(uid+'-cases'),fe=document.getElementById(uid+'-format');
    if(!ce||!fe)return;
    var cases=Math.max(1,parseInt(ce.value)||150),fmt=fe.value;
    var pc=window.glGetCanRate(cases,fmt),pcase=pc*CPC,total=pcase*cases;
    function set(id,v){var e=document.getElementById(id);if(e)e.textContent=v;}
    set(uid+'-pcase',window.glUsd(pcase)+'/case');
    set(uid+'-pcan',window.glUsd(pc,4)+'/can');
    set(uid+'-cans',(cases*CPC).toLocaleString()+' cans');
    set(uid+'-total',window.glUsd(total));
    var row=document.getElementById(uid);if(row)row.setAttribute('data-gl-total',total);
    window.glCalcInvTotal();
  };
  window.glUpdateBtl=function(uid){
    var qe=document.getElementById(uid+'-qty'),fe=document.getElementById(uid+'-format');
    if(!qe||!fe)return;
    var qty=Math.max(1,parseInt(qe.value)||500),fmt=fe.value;
    var pu=window.glGetBtlRate(qty,fmt),total=pu*qty;
    function set(id,v){var e=document.getElementById(id);if(e)e.textContent=v;}
    set(uid+'-punit',window.glUsd(pu,4)+'/btl');
    set(uid+'-total',window.glUsd(total));
    var row=document.getElementById(uid);if(row)row.setAttribute('data-gl-total',total);
    window.glCalcInvTotal();
  };
  window.glRemoveLine=function(uid){
    var e=document.getElementById(uid);if(e)e.remove();
    window.glCalcInvTotal();
  };
  window.glBuildCanRow=function(uid,cases,fmt,fmts,pc){
    var pcase=pc*CPC,total=pcase*cases,cans=cases*CPC;
    var RS='display:grid;grid-template-columns:2fr 1fr 1fr 1fr 36px;gap:0;padding:10px 12px;border-top:1px solid rgba(255,255,255,.05);align-items:start';
    var SS='background:#1a2a3a;color:#fff;border:1px solid rgba(0,229,192,.4);border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;width:100%;max-width:160px';
    var SI='width:60px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:3px 6px;font-size:12px;font-weight:600;text-align:center';
    var opts=fmts.map(function(f){return'<option value="'+f.value+'"'+(f.value===fmt?' selected':'')+'>'+f.label+'</option>';}).join('');
    var row=document.createElement('div');row.id=uid;row.setAttribute('style',RS);row.setAttribute('data-gl-total',total);
    row.innerHTML='<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">Canning</div><select id="'+uid+'-format" onchange="window.glUpdateCan(\''+uid+'\')" style="'+SS+'">'+opts+'</select></div>'
      +'<div style="text-align:center"><input id="'+uid+'-cases" type="number" min="1" value="'+cases+'" onchange="window.glUpdateCan(\''+uid+'\')" style="'+SI+'"/><div id="'+uid+'-cans" style="font-size:10px;color:var(--muted);margin-top:3px">'+cans.toLocaleString()+' cans</div></div>'
      +'<div style="text-align:right;padding-right:4px"><div id="'+uid+'-pcase" style="font-size:12px;color:#fff;font-weight:600">'+window.glUsd(pcase)+'/case</div><div id="'+uid+'-pcan" style="font-size:10px;color:var(--muted);margin-top:3px">'+window.glUsd(pc,4)+'/can</div></div>'
      +'<div id="'+uid+'-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">'+window.glUsd(total)+'</div>'
      +'<div style="text-align:center"><button onclick="window.glRemoveLine(\''+uid+'\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0;line-height:1">x</button></div>';
    return row;
  };
  window.glBuildBtlRow=function(uid,qty,fmt,fmts,pu){
    var total=pu*qty;
    var RS='display:grid;grid-template-columns:2fr 1fr 1fr 1fr 36px;gap:0;padding:10px 12px;border-top:1px solid rgba(255,255,255,.05);align-items:start';
    var SS='background:#1a2a3a;color:#fff;border:1px solid rgba(0,229,192,.4);border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;width:100%;max-width:160px';
    var SI='width:60px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:3px 6px;font-size:12px;font-weight:600;text-align:center';
    var opts=fmts.map(function(f){return'<option value="'+f.value+'"'+(f.value===fmt?' selected':'')+'>'+f.label+'</option>';}).join('');
    var row=document.createElement('div');row.id=uid;row.setAttribute('style',RS);row.setAttribute('data-gl-total',total);
    row.innerHTML='<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">Bottling</div><select id="'+uid+'-format" onchange="window.glUpdateBtl(\''+uid+'\')" style="'+SS+'">'+opts+'</select></div>'
      +'<div style="text-align:center"><input id="'+uid+'-qty" type="number" min="1" value="'+qty+'" onchange="window.glUpdateBtl(\''+uid+'\')" style="'+SI+'"/><div style="font-size:10px;color:var(--muted);margin-top:3px">bottles</div></div>'
      +'<div style="text-align:right;padding-right:4px"><div id="'+uid+'-punit" style="font-size:12px;color:#fff;font-weight:600">'+window.glUsd(pu,4)+'/btl</div></div>'
      +'<div id="'+uid+'-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">'+window.glUsd(total)+'</div>'
      +'<div style="text-align:center"><button onclick="window.glRemoveLine(\''+uid+'\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0;line-height:1">x</button></div>';
    return row;
  };
  window.glOpenPricing=async function(){
    document.getElementById('gl-pm')?.remove();
    await window.glLoadRates();
    var m=document.createElement('div');m.id='gl-pm';
    m.setAttribute('style','position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px');
    function rws(data,mf,pf,tk){
      return data.map(function(r){
        return '<tr style="border-top:1px solid rgba(255,255,255,.06)"><td style="padding:7px 8px;font-size:12px;color:#fff">'+r.format_label+'</td><td style="padding:7px 8px;font-size:12px;color:var(--muted)">'+r[mf]+'+</td><td style="padding:7px 8px"><input data-id="'+r.id+'" data-tbl="'+tk+'" data-fld="'+pf+'" value="'+parseFloat(r[pf]).toFixed(4)+'" type="number" step="0.0001" min="0" style="width:90px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:4px 8px;font-size:12px"/></td><td style="padding:7px 8px"><button onclick="window.glSaveRate(this)" data-id="'+r.id+'" data-tbl="'+tk+'" data-fld="'+pf+'" style="background:rgba(0,229,192,.15);border:1px solid rgba(0,229,192,.3);color:var(--teal);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer">Save</button></td></tr>';
      }).join('');
    }
    m.innerHTML='<div style="background:#0d1f33;border:1px solid rgba(255,255,255,.1);border-radius:14px;width:100%;max-width:620px;max-height:85vh;overflow-y:auto;padding:24px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px"><div style="font-size:16px;font-weight:700;color:#fff">Pricing Manager</div><button onclick="document.getElementById(\'gl-pm\').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1">x</button></div><div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">CANNING ($/can)</div><table style="width:100%;border-collapse:collapse;margin-bottom:24px"><tr style="font-size:11px;color:var(--muted)"><th style="text-align:left;padding:6px 8px">Format</th><th style="text-align:left;padding:6px 8px">Min Cases</th><th style="text-align:left;padding:6px 8px">$/Can</th><th></th></tr>'+rws(window._glR.c,'min_cases','price_per_can','canning')+'</table><div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">BOTTLING ($/bottle)</div><table style="width:100%;border-collapse:collapse"><tr style="font-size:11px;color:var(--muted)"><th style="text-align:left;padding:6px 8px">Format</th><th style="text-align:left;padding:6px 8px">Min Units</th><th style="text-align:left;padding:6px 8px">$/Btl</th><th></th></tr>'+rws(window._glR.b,'min_units','price_per_unit','bottling')+'</table><div style="font-size:11px;color:var(--muted);margin-top:16px">Saves instantly to database.</div></div>';
    document.body.appendChild(m);
  };
  window.glSaveRate=async function(btn){
    var id=btn.getAttribute('data-id'),tbl=btn.getAttribute('data-tbl'),fld=btn.getAttribute('data-fld');
    var inp=btn.closest('tr').querySelector('input');
    var val=parseFloat(inp.value);if(isNaN(val)||val<=0){alert('Invalid');return;}
    btn.textContent='...';
    var ep=SURL+'/'+(tbl==='canning'?'canning_rates':'bottling_rates')+'?id=eq.'+id;
    var body={updated_at:new Date().toISOString()};body[fld]=val;
    var res=await fetch(ep,{method:'PATCH',headers:Object.assign({},SH,{'Prefer':'return=minimal'}),body:JSON.stringify(body)});
    if(res.ok||res.status===204){
      btn.textContent='Saved';btn.style.color='#22c55e';
      var cache=tbl==='canning'?window._glR.c:window._glR.b;
      var row=cache.find(function(r){return r.id==id;});if(row)row[fld]=val;
      window._glR.ok=false;
      setTimeout(function(){btn.textContent='Save';btn.style.color='';},2000);
    }else{btn.textContent='Error';}
  };
  window.glLoadRates();
  console.log('[GL] Invoice pricing loaded');
}());

/* ============================================================
   INVOICE PATCH v2 - handles ALL line types, fixes discount
   ============================================================ */
(function(){
  var SURL='https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1';
  var SKEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE';
  var SH={'apikey':SKEY,'Authorization':'Bearer '+SKEY,'Content-Type':'application/json'};
  var CPC=24;

  /* ── Supabase rates ── */
  window._glR={c:[],b:[],ok:false};
  window.glLoadRates=async function(){
    if(window._glR.ok)return;
    var res=await Promise.all([
      fetch(SURL+'/canning_rates?order=format,min_cases',{headers:SH}).then(function(r){return r.json();}),
      fetch(SURL+'/bottling_rates?order=format,min_units',{headers:SH}).then(function(r){return r.json();})
    ]);
    window._glR.c=Array.isArray(res[0])?res[0]:[];
    window._glR.b=Array.isArray(res[1])?res[1]:[];
    window._glR.ok=true;
  };
  window.glGetCanRate=function(cases,fmt,clientId){
    clientId = clientId || (window.INV && window.INV.clientId) || null;
    if(typeof window.glGetClientOverride === 'function'){
      var ovr = window.glGetClientOverride(clientId,'canning',fmt);
      if(ovr != null) return ovr;
    }
    var t=window._glR.c.filter(function(r){return r.format===fmt;}).sort(function(a,b){return a.min_cases-b.min_cases;});
    if(!t.length)return 0;
    var v=parseFloat(t[0].price_per_can);
    for(var i=0;i<t.length;i++)if(cases>=t[i].min_cases)v=parseFloat(t[i].price_per_can);
    return v;
  };
  window.glGetBtlRate=function(qty,fmt,clientId){
    clientId = clientId || (window.INV && window.INV.clientId) || null;
    if(typeof window.glGetClientOverride === 'function'){
      var ovr = window.glGetClientOverride(clientId,'bottling',fmt);
      if(ovr != null) return ovr;
    }
    var t=window._glR.b.filter(function(r){return r.format===fmt;}).sort(function(a,b){return a.min_units-b.min_units;});
    if(!t.length)return 0;
    var v=parseFloat(t[0].price_per_unit);
    for(var i=0;i<t.length;i++)if(qty>=t[i].min_units)v=parseFloat(t[i].price_per_unit);
    return v;
  };
  window.glUsd=function(n,d){return'$'+parseFloat(n||0).toLocaleString('en-US',{minimumFractionDigits:d==null?2:d,maximumFractionDigits:d==null?2:d});};
  window.glGetTbl=function(){var b=document.getElementById('gl-inv-body');return b?b.children[2]:null;};

  /* ── Invoice total recalc ── */
  window.glCalcInvTotal=function(){
    var tot=0;
    document.querySelectorAll('[data-gl-total]').forEach(function(el){
      tot+=parseFloat(el.getAttribute('data-gl-total'))||0;
    });
    var box=document.getElementById('ginv-totals-box');if(!box)return;
    var disc=document.getElementById('ginv-disc');
    var pct=disc?parseFloat(disc.value)||0:0;
    var grand=tot*(1-pct/100);
    var s=box.children[0]?box.children[0].children[1]:null;
    var g=box.children[1]?box.children[1].children[1]:null;
    if(s)s.textContent=window.glUsd(tot);
    if(g)g.textContent=window.glUsd(grand);
  };

  /* ── Wire up discount input ── */
  function wireDiscount(){
    var disc=document.getElementById('ginv-disc');
    if(disc&&!disc._glWired){
      disc.addEventListener('input',function(){window.glCalcInvTotal();});
      disc.addEventListener('change',function(){window.glCalcInvTotal();});
      disc._glWired=true;
    }
  }

  /* ── Shared row style ── */
  var RS='display:grid;grid-template-columns:2fr 1fr 1fr 1fr 36px;gap:0;padding:10px 12px;border-top:1px solid rgba(255,255,255,.05);align-items:start';
  var SS='background:#1a2a3a;color:#fff;border:1px solid rgba(0,229,192,.4);border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;width:100%;max-width:160px';
  var SI='width:60px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:3px 6px;font-size:12px;font-weight:600;text-align:center';
  var SIT='width:100%;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:3px 6px;font-size:11px';

  /* ── Remove any line ── */
  window.glRemoveLine=function(uid){
    var e=document.getElementById(uid);if(e)e.remove();
    window.glCalcInvTotal();
  };

  /* ── Update canning row ── */
  window.glUpdateCan=function(uid){
    var ce=document.getElementById(uid+'-cases'),fe=document.getElementById(uid+'-format'),pe=document.getElementById(uid+'-pcase');
    if(!ce||!fe)return;
    var cases=Math.max(1,parseInt(ce.value)||150),fmt=fe.value;
    var row=document.getElementById(uid);
    var override = row && row.getAttribute('data-pu-override')==='1';
    var pcase;
    if(override && pe){ pcase = parseFloat(pe.value)||0; }
    else { var pcDef = window.glGetCanRate(cases,fmt); pcase = pcDef*CPC; if(pe) pe.value = pcase.toFixed(2); }
    var pc = CPC ? (pcase/CPC) : 0;
    var total = pcase*cases;
    var pcanEl = document.getElementById(uid+'-pcan');
    if(pcanEl) pcanEl.innerHTML = window.glUsd(pc,4)+'/can <a href="javascript:window.glResetCanPrice(\''+uid+'\')" style="color:var(--teal);text-decoration:none;margin-left:4px" title="Reset to default rate">&#x21BA;</a>';
    var cansEl = document.getElementById(uid+'-cans');
    if(cansEl) cansEl.textContent=(cases*CPC).toLocaleString()+' cans';
    var te=document.getElementById(uid+'-total');
    if(te) te.textContent=window.glUsd(total);
    if(row) row.setAttribute('data-gl-total',total);
    window.glCalcInvTotal();
  };
  window.glUpdateCanPrice=function(uid){
    var row=document.getElementById(uid);
    if(row) row.setAttribute('data-pu-override','1');
    window.glUpdateCan(uid);
  };
  window.glResetCanPrice=function(uid){
    var row=document.getElementById(uid);
    if(row) row.setAttribute('data-pu-override','0');
    window.glUpdateCan(uid);
  };

  /* ── Update bottling row ── */
  window.glUpdateBtl=function(uid){
    var qe=document.getElementById(uid+'-qty'),fe=document.getElementById(uid+'-format'),pe=document.getElementById(uid+'-punit');
    if(!qe||!fe)return;
    var qty=Math.max(1,parseInt(qe.value)||500),fmt=fe.value;
    var row=document.getElementById(uid);
    var override = row && row.getAttribute('data-pu-override')==='1';
    var pu;
    if(override && pe){ pu = parseFloat(pe.value)||0; }
    else { pu = window.glGetBtlRate(qty,fmt); if(pe) pe.value = pu.toFixed(4); }
    var total = pu*qty;
    var te=document.getElementById(uid+'-total');
    if(te) te.textContent=window.glUsd(total);
    if(row) row.setAttribute('data-gl-total',total);
    window.glCalcInvTotal();
  };
  window.glUpdateBtlPrice=function(uid){
    var row=document.getElementById(uid);
    if(row) row.setAttribute('data-pu-override','1');
    window.glUpdateBtl(uid);
  };
  window.glResetBtlPrice=function(uid){
    var row=document.getElementById(uid);
    if(row) row.setAttribute('data-pu-override','0');
    window.glUpdateBtl(uid);
  };

  /* ── Update manual row (rd/hours/custom) ── */
  window.glUpdateManual=function(uid){
    var qe=document.getElementById(uid+'-qty');
    var pe=document.getElementById(uid+'-price');
    if(!qe||!pe)return;
    var qty=parseFloat(qe.value)||0;
    var price=parseFloat(pe.value)||0;
    var total=qty*price;
    var te=document.getElementById(uid+'-total');
    if(te)te.textContent=window.glUsd(total);
    var row=document.getElementById(uid);if(row)row.setAttribute('data-gl-total',total);
    window.glCalcInvTotal();
  };

  /* ── Build canning row ── */
  window.glBuildCanRow=function(uid,cases,fmt,fmts,pc,descPrefill){
    var pcase=pc*CPC,total=pcase*cases,cans=cases*CPC;
    var opts=fmts.map(function(f){return'<option value="'+f.value+'"'+(f.value===fmt?' selected':'')+'>'+f.label+'</option>';}).join('');
    var PSTY='width:84px;background:#1a2a3a;color:#fff;border:1px solid rgba(0,229,192,.25);border-radius:6px;padding:3px 6px;font-size:12px;font-weight:600;text-align:right';
    var DSTY='width:100%;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:3px 6px;font-size:11px;margin-top:4px';
    var row=document.createElement('div');row.id=uid;row.setAttribute('style',RS);row.setAttribute('data-gl-total',total);row.setAttribute('data-pu-override','0');
    row.innerHTML=
      '<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">Canning</div>'+
      '<select id="'+uid+'-format" onchange="window.glUpdateCan(\''+uid+'\')" style="'+SS+'">'+opts+'</select>'+
      '<input id="'+uid+'-desc" type="text" placeholder="Description (optional)" value="'+(descPrefill||'').replace(/"/g,'&quot;')+'" style="'+DSTY+'"/></div>'+
      '<div style="text-align:center"><input id="'+uid+'-cases" type="number" min="1" value="'+cases+'" onchange="window.glUpdateCan(\''+uid+'\')" style="'+SI+'"/>'+
      '<div id="'+uid+'-cans" style="font-size:10px;color:var(--muted);margin-top:3px">'+cans.toLocaleString()+' cans</div></div>'+
      '<div style="text-align:right;padding-right:4px">'+
      '<input id="'+uid+'-pcase" type="number" step="0.01" min="0" value="'+pcase.toFixed(2)+'" onchange="window.glUpdateCanPrice(\''+uid+'\')" title="$/case — edit to override the default rate" style="'+PSTY+'"/>'+
      '<div id="'+uid+'-pcan" style="font-size:10px;color:var(--muted);margin-top:3px">'+window.glUsd(pc,4)+'/can <a href="javascript:window.glResetCanPrice(\''+uid+'\')" style="color:var(--teal);text-decoration:none;margin-left:4px" title="Reset to default rate">&#x21BA;</a></div></div>'+
      '<div id="'+uid+'-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">'+window.glUsd(total)+'</div>'+
      '<div style="text-align:center"><button onclick="window.glRemoveLine(\''+uid+'\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0;line-height:1">x</button></div>';
    return row;
  };

  /* ── Build bottling row ── */
  window.glBuildBtlRow=function(uid,qty,fmt,fmts,pu,descPrefill){
    var total=pu*qty;
    var opts=fmts.map(function(f){return'<option value="'+f.value+'"'+(f.value===fmt?' selected':'')+'>'+f.label+'</option>';}).join('');
    var PSTY='width:84px;background:#1a2a3a;color:#fff;border:1px solid rgba(0,229,192,.25);border-radius:6px;padding:3px 6px;font-size:12px;font-weight:600;text-align:right';
    var DSTY='width:100%;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:3px 6px;font-size:11px;margin-top:4px';
    var row=document.createElement('div');row.id=uid;row.setAttribute('style',RS);row.setAttribute('data-gl-total',total);row.setAttribute('data-pu-override','0');
    row.innerHTML=
      '<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">Bottling</div>'+
      '<select id="'+uid+'-format" onchange="window.glUpdateBtl(\''+uid+'\')" style="'+SS+'">'+opts+'</select>'+
      '<input id="'+uid+'-desc" type="text" placeholder="Description (optional)" value="'+(descPrefill||'').replace(/"/g,'&quot;')+'" style="'+DSTY+'"/></div>'+
      '<div style="text-align:center"><input id="'+uid+'-qty" type="number" min="1" value="'+qty+'" onchange="window.glUpdateBtl(\''+uid+'\')" style="'+SI+'"/>'+
      '<div style="font-size:10px;color:var(--muted);margin-top:3px">bottles</div></div>'+
      '<div style="text-align:right;padding-right:4px">'+
      '<input id="'+uid+'-punit" type="number" step="0.0001" min="0" value="'+pu.toFixed(4)+'" onchange="window.glUpdateBtlPrice(\''+uid+'\')" title="$/bottle — edit to override the default rate" style="'+PSTY+'"/>'+
      '<div style="font-size:10px;color:var(--muted);margin-top:3px">$/btl <a href="javascript:window.glResetBtlPrice(\''+uid+'\')" style="color:var(--teal);text-decoration:none;margin-left:4px" title="Reset to default rate">&#x21BA;</a></div></div>'+
      '<div id="'+uid+'-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">'+window.glUsd(total)+'</div>'+
      '<div style="text-align:center"><button onclick="window.glRemoveLine(\''+uid+'\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0;line-height:1">x</button></div>';
    return row;
  };

  /* ── Build manual row (rd / hours / custom) ── */
  // descDefault = the "subtype" prefilled in the primary description (e.g.
  //   "Formulation" for R&D, "Production labor" for Hours, "" for Custom).
  // descPrefill = the user's free-text optional description carried over
  //   from a saved invoice when reopening for edit.
  window.glBuildManualRow=function(uid,label,descDefault,qty,price,descPrefill){
    var total=qty*price;
    var DSTY='width:100%;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:3px 6px;font-size:11px;margin-top:4px';
    var safePrefill = String(descPrefill||'').replace(/"/g,'&quot;');
    var row=document.createElement('div');row.id=uid;row.setAttribute('style',RS);row.setAttribute('data-gl-total',total);
    row.innerHTML=
      '<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">'+label+'</div>'+
      '<input id="'+uid+'-subtype" type="text" value="'+descDefault+'" placeholder="Service type" style="'+SIT+'"/>'+
      '<input id="'+uid+'-desc" type="text" placeholder="Description (optional)" value="'+safePrefill+'" style="'+DSTY+'"/></div>'+
      '<div style="text-align:center"><input id="'+uid+'-qty" type="number" min="0" step="any" value="'+qty+'" onchange="window.glUpdateManual(\''+uid+'\')" style="'+SI+'"/>'+
      '<div style="font-size:10px;color:var(--muted);margin-top:3px">qty</div></div>'+
      '<div style="text-align:right;padding-right:4px">'+
      '<input id="'+uid+'-price" type="number" min="0" step="any" value="'+price+'" onchange="window.glUpdateManual(\''+uid+'\')" style="'+SI+';width:80px;" placeholder="Unit $"/></div>'+
      '<div id="'+uid+'-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">'+window.glUsd(total)+'</div>'+
      '<div style="text-align:center"><button onclick="window.glRemoveLine(\''+uid+'\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0;line-height:1">x</button></div>';
    return row;
  };

  /* ── Override glAddLine — handles ALL types, never calls original ── */
  window.glAddLine=function(type){
    var tbl=window.glGetTbl();if(!tbl)return;
    var ph=[...tbl.children].find(function(c){return c.textContent.trim()==='No line items yet. Add one below.';});
    if(ph)ph.remove();
    wireDiscount();

    var uid='glline'+Date.now();

    if(type==='canning'){
      if(!window._glR.ok){
        var lr=document.createElement('div');lr.id=uid;
        lr.setAttribute('style','padding:12px;color:var(--muted);font-size:12px;border-top:1px solid rgba(255,255,255,.05)');
        lr.textContent='Loading rates...';tbl.appendChild(lr);
        window.glLoadRates().then(function(){var e=document.getElementById(uid);if(e)e.remove();window.glAddLine(type);});
        return;
      }
      var fmts=[],seen={};
      window._glR.c.forEach(function(r){if(!seen[r.format]){seen[r.format]=true;fmts.push({value:r.format,label:r.format_label});}});
      if(!fmts.length)fmts=[{value:'12oz-standard',label:'12oz Standard'}];
      var def=fmts[0].value,pc=window.glGetCanRate(150,def);
      tbl.appendChild(window.glBuildCanRow(uid,150,def,fmts,pc));

    }else if(type==='bottling'){
      if(!window._glR.ok){
        var lr=document.createElement('div');lr.id=uid;
        lr.setAttribute('style','padding:12px;color:var(--muted);font-size:12px;border-top:1px solid rgba(255,255,255,.05)');
        lr.textContent='Loading rates...';tbl.appendChild(lr);
        window.glLoadRates().then(function(){var e=document.getElementById(uid);if(e)e.remove();window.glAddLine(type);});
        return;
      }
      var bfmts=[],bseen={};
      window._glR.b.forEach(function(r){if(!bseen[r.format]){bseen[r.format]=true;bfmts.push({value:r.format,label:r.format_label});}});
      if(!bfmts.length)bfmts=[{value:'750ml',label:'750ml Bottle'}];
      var bdef=bfmts[0].value,pu=window.glGetBtlRate(500,bdef);
      tbl.appendChild(window.glBuildBtlRow(uid,500,bdef,bfmts,pu));

    }else if(type==='rd'){
      tbl.appendChild(window.glBuildManualRow(uid,'R&D / IP','Formulation',1,1500));

    }else if(type==='hours'){
      tbl.appendChild(window.glBuildManualRow(uid,'Production Hours','Production labor',1,125));

    }else{
      tbl.appendChild(window.glBuildManualRow(uid,'Custom','',1,0));
    }

    window.glCalcInvTotal();
  };

  /* ── Pricing admin ── */
  window.glOpenPricing=async function(){
    document.getElementById('gl-pm')?.remove();
    await window.glLoadRates();
    var m=document.createElement('div');m.id='gl-pm';
    m.setAttribute('style','position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px');
    function rws(data,mf,pf,tk){
      return data.map(function(r){
        return '<tr style="border-top:1px solid rgba(255,255,255,.06)">'+
          '<td style="padding:7px 8px;font-size:12px;color:#fff">'+r.format_label+'</td>'+
          '<td style="padding:7px 8px;font-size:12px;color:var(--muted)">'+r[mf]+'+</td>'+
          '<td style="padding:7px 8px"><input data-id="'+r.id+'" data-tbl="'+tk+'" data-fld="'+pf+'" value="'+parseFloat(r[pf]).toFixed(4)+'" type="number" step="0.0001" min="0" style="width:90px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:4px 8px;font-size:12px"/></td>'+
          '<td style="padding:7px 8px"><button onclick="window.glSaveRate(this)" data-id="'+r.id+'" data-tbl="'+tk+'" data-fld="'+pf+'" style="background:rgba(0,229,192,.15);border:1px solid rgba(0,229,192,.3);color:var(--teal);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer">Save</button></td>'+
          '</tr>';
      }).join('');
    }
    m.innerHTML='<div style="background:#0d1f33;border:1px solid rgba(255,255,255,.1);border-radius:14px;width:100%;max-width:620px;max-height:85vh;overflow-y:auto;padding:24px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">'+
      '<div style="font-size:16px;font-weight:700;color:#fff">Pricing Manager</div>'+
      '<button onclick="document.getElementById(\'gl-pm\').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1">x</button></div>'+
      '<div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">CANNING ($/can)</div>'+
      '<table style="width:100%;border-collapse:collapse;margin-bottom:24px"><tr style="font-size:11px;color:var(--muted)"><th style="text-align:left;padding:6px 8px">Format</th><th style="text-align:left;padding:6px 8px">Min Cases</th><th style="text-align:left;padding:6px 8px">$/Can</th><th></th></tr>'+
      rws(window._glR.c,'min_cases','price_per_can','canning')+'</table>'+
      '<div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">BOTTLING ($/bottle)</div>'+
      '<table style="width:100%;border-collapse:collapse"><tr style="font-size:11px;color:var(--muted)"><th style="text-align:left;padding:6px 8px">Format</th><th style="text-align:left;padding:6px 8px">Min Units</th><th style="text-align:left;padding:6px 8px">$/Btl</th><th></th></tr>'+
      rws(window._glR.b,'min_units','price_per_unit','bottling')+'</table>'+
      '<div style="font-size:11px;color:var(--muted);margin-top:16px">Saves instantly to database.</div></div>';
    document.body.appendChild(m);
  };

  window.glSaveRate=async function(btn){
    var id=btn.getAttribute('data-id'),tbl=btn.getAttribute('data-tbl'),fld=btn.getAttribute('data-fld');
    var inp=btn.closest('tr').querySelector('input');
    var val=parseFloat(inp.value);if(isNaN(val)||val<=0){alert('Invalid');return;}
    btn.textContent='...';
    var ep=SURL+'/'+(tbl==='canning'?'canning_rates':'bottling_rates')+'?id=eq.'+id;
    var body={updated_at:new Date().toISOString()};body[fld]=val;
    var res=await fetch(ep,{method:'PATCH',headers:Object.assign({},SH,{'Prefer':'return=minimal'}),body:JSON.stringify(body)});
    if(res.ok||res.status===204){
      btn.textContent='Saved';btn.style.color='#22c55e';
      var cache=tbl==='canning'?window._glR.c:window._glR.b;
      var row=cache.find(function(r){return r.id==id;});if(row)row[fld]=val;
      window._glR.ok=false;
      setTimeout(function(){btn.textContent='Save';btn.style.color='';},2000);
    }else{btn.textContent='Error';}
  };

  window.glLoadRates();
  console.log('[GL] Invoice patch v2 loaded');
}());
/* ============================================================
   INVOICE FIX v4 - DOM-based save + Supabase persistence
   - glAddLine appends DOM rows but never touches INV.lines, so
     save reads lines straight from the rendered rows.
   - Save fires a background POST to Supabase invoices table so
     records survive page refresh and sync across devices.
     Requires permissive RLS policy on `invoices` (see README/
     project notes). On RLS or network failure, the in-memory
     save still succeeds and a warning notification fires.
   ============================================================ */
(function(){

  var SURL='https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1';
  var SKEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE';
  var SH={apikey:SKEY,Authorization:'Bearer '+SKEY,'Content-Type':'application/json'};

  window.glCalcInvTotal=function(){
    var tot=0;
    document.querySelectorAll('[data-gl-total]').forEach(function(el){
      tot+=parseFloat(el.getAttribute('data-gl-total'))||0;
    });
    // Include manually-entered addon prices in the subtotal so typing into
    // an add-on row doesn't appear to zero the total.
    document.querySelectorAll('#gl-inv-body input[oninput*="addons"][placeholder="$0.00"]').forEach(function(el){
      tot += parseFloat(el.value)||0;
    });
    var box=document.getElementById('ginv-totals-box');if(!box)return;
    var disc=document.getElementById('ginv-disc');
    var pct=disc?parseFloat(disc.value)||0:0;
    var discAmt=tot*(pct/100);
    var grand=tot-discAmt;
    var subRow=box.children[0];
    if(subRow&&subRow.children[1])subRow.children[1].textContent=window.glUsd(tot);
    var discRow=document.getElementById('gl-disc-row');
    if(pct>0){
      if(!discRow){
        discRow=document.createElement('div');
        discRow.id='gl-disc-row';
        discRow.setAttribute('style','font-size:12px;color:var(--muted);display:flex;justify-content:space-between;margin-bottom:8px');
        box.insertBefore(discRow,box.children[1]);
      }
      discRow.innerHTML='<span>Discount ('+pct+'%)</span><span style="color:#22c55e">-'+window.glUsd(discAmt)+'</span>';
    }else{
      if(discRow)discRow.remove();
    }
    var totRow=document.getElementById('gl-disc-row')?box.children[2]:box.children[1];
    if(totRow&&totRow.children[1])totRow.children[1].textContent=window.glUsd(grand);
  };

  function readLinesFromDOM(){
    var lines=[];
    document.querySelectorAll('[data-gl-total]').forEach(function(row){
      var uid=row.id;if(!uid)return;
      var total=parseFloat(row.getAttribute('data-gl-total'))||0;
      var casesEl=document.getElementById(uid+'-cases');
      var punitEl=document.getElementById(uid+'-punit');
      var descEl=document.getElementById(uid+'-desc');
      var labelEl=row.querySelector('div > div');
      var label=labelEl?labelEl.textContent.trim():'';
      // Free-text description user typed below the type's format select / qty.
      // Present on every row builder now (canning, bottling, manual).
      var userDesc = descEl ? (descEl.value||'').trim() : '';
      if(casesEl){
        var cases=parseInt(casesEl.value)||0;
        var fEl=document.getElementById(uid+'-format');
        var fLbl=(fEl&&fEl.options[fEl.selectedIndex])?fEl.options[fEl.selectedIndex].text:'';
        var perCase=cases>0?total/cases:0;
        var canDesc='Canning - '+fLbl;
        if(userDesc) canDesc += ' — ' + userDesc;
        lines.push({desc:canDesc,qty:cases,unitPrice:perCase,total:total,unit:'case'});
      }else if(punitEl){
        var qtyEl=document.getElementById(uid+'-qty');
        var qty=qtyEl?parseInt(qtyEl.value)||0:0;
        var fEl2=document.getElementById(uid+'-format');
        var fLbl2=(fEl2&&fEl2.options[fEl2.selectedIndex])?fEl2.options[fEl2.selectedIndex].text:'';
        var perBtl=qty>0?total/qty:0;
        var btlDesc='Bottling - '+fLbl2;
        if(userDesc) btlDesc += ' — ' + userDesc;
        lines.push({desc:btlDesc,qty:qty,unitPrice:perBtl,total:total,unit:'btl'});
      }else if(descEl){
        var qtyMEl=document.getElementById(uid+'-qty');
        var qtyM=qtyMEl?parseFloat(qtyMEl.value)||0:0;
        var priceMEl=document.getElementById(uid+'-price');
        var priceM=priceMEl?parseFloat(priceMEl.value)||0:0;
        // New layout: -subtype carries the service-type text (e.g.
        // "Formulation", "Production labor") and -desc carries the user's
        // optional add-on description. Old rows without -subtype fall back
        // to the legacy single-input behavior.
        var subtypeEl = document.getElementById(uid+'-subtype');
        var subtype = subtypeEl ? (subtypeEl.value||'').trim() : '';
        var manDesc;
        if(subtypeEl){
          // New layout
          manDesc = label || 'Line item';
          if(subtype) manDesc += ' - ' + subtype;
          if(userDesc) manDesc += ' — ' + userDesc;
        } else {
          // Legacy fallback
          manDesc = userDesc?(label?label+' - '+userDesc:userDesc):(label||'Line item');
        }
        lines.push({desc:manDesc,qty:qtyM,unitPrice:priceM,total:total,unit:''});
      }
    });
    return lines;
  }

  function nextInvId(){
    var ids=(window.invoices||[]).map(function(i){return parseInt((i.id||'').replace(/\D/g,''))||0;});
    return 'GL-'+(ids.length?Math.max.apply(null,ids)+1:1001);
  }

  window.glSaveInvoice=function(){
    var cidEl=document.getElementById('ginv-client');
    var cid=cidEl?cidEl.value:'';
    if(!cid){alert('Please select a client');return null;}
    var lines=readLinesFromDOM();
    if(!lines.length){alert('Add at least one line item.');return null;}

    // Edit mode: openEditInvoice tags the builder modal with the supa row id
    // of the invoice being edited. When present, we UPDATE that row instead of
    // INSERTing a new one (which would create a duplicate).
    var builderEl = document.getElementById('gl-inv-builder');
    var editingSupaId = builderEl ? builderEl.getAttribute('data-editing-supa-id') : null;
    var editingId     = builderEl ? builderEl.getAttribute('data-editing-id') : null;
    // Robustness: if we're editing but lost the supa row id (because a
    // prior save replaced the in-memory inv without preserving supaId),
    // we'll look it up by invoice_number further down before the update.

    var client=(window.clients||[]).find(function(c){return c.id===cid;})||{};
    var invIdEl=document.getElementById('ginv-id');
    var invId=(invIdEl&&invIdEl.value)?invIdEl.value:(editingId||nextInvId());
    var dateEl=document.getElementById('ginv-date');
    var date=(dateEl&&dateEl.value)?dateEl.value:new Date().toISOString().slice(0,10);
    var discEl=document.getElementById('ginv-disc');
    var pct=discEl?parseFloat(discEl.value)||0:0;

    // Read add-on rows from the DOM (description + price pairs).
    var addons=[];
    var addonDescEls = document.querySelectorAll('#gl-inv-body input[oninput*="addons"][placeholder*="Add-on"]');
    var addonPriceEls = document.querySelectorAll('#gl-inv-body input[oninput*="addons"][placeholder="$0.00"]');
    for(var ai=0; ai<addonDescEls.length; ai++){
      var d = (addonDescEls[ai].value||'').trim();
      var p = parseFloat(addonPriceEls[ai] ? addonPriceEls[ai].value : 0)||0;
      if(d || p) addons.push({ d: d, p: p });
    }
    var addonsTotal = addons.reduce(function(s,a){ return s + (parseFloat(a.p)||0); }, 0);

    var subtotal=lines.reduce(function(s,l){return s+(l.total||0);},0) + addonsTotal;
    var discountAmt=subtotal*(pct/100);
    var amount=subtotal-discountAmt;

    // Append addon entries as "line items" so the invoice detail / PDF
    // renders them in the same table as regular lines.
    var addonLines = addons.map(function(a){
      return { desc: a.d || 'Add-on', qty: 1, unitPrice: parseFloat(a.p)||0, total: parseFloat(a.p)||0, unit: '' };
    });
    var combinedLines = lines.concat(addonLines);

    var inv={
      id:invId,
      // Preserve the supa row id across saves so subsequent edits still
      // route through UPDATE (not INSERT that would silently fail on the
      // unique invoice_number constraint).
      supaId: editingSupaId || (function(){
        var prior = (window.invoices||[]).find(function(p){ return p && p.id === invId; });
        return prior ? prior.supaId : undefined;
      })(),
      client:cid,
      clientName:client.name||'',
      clientEmail:client.email||'',
      svc:combinedLines.map(function(l){return l.desc;}).join(', '),
      lines:combinedLines,
      addons:addons,
      discount:pct,
      subtotal:subtotal,
      discountAmt:discountAmt,
      amount:amount,
      notes:'',
      date:date,
      status:'pending',
      // Default to the client's terms (set in the Edit Client modal); fall back
      // to "Due on receipt" for clients without terms configured.
      paymentTerms: client.paymentTerms || 'Due on receipt'
    };
    window.invoices=window.invoices||[];
    // Mutate in place so index.html's `let invoices` (bridged to window.invoices)
    // keeps pointing at the same array. Replacing via .filter() would break that.
    for(var _k=window.invoices.length-1;_k>=0;_k--){if(window.invoices[_k]&&window.invoices[_k].id===invId)window.invoices.splice(_k,1);}
    window.invoices.unshift(inv);
    if(typeof renderInvoices==='function')renderInvoices();
    if(typeof addNotification==='function')addNotification('Invoice saved: '+invId,(client.name||'')+' · '+window.glUsd(amount),'success');
    var ov=document.getElementById('gl-inv-builder');if(ov)ov.classList.remove('show');

    // Compute the due date from the payment terms instead of hardcoding +30d.
    var dueIso='';
    try {
      var t = (inv.paymentTerms || '').toLowerCase();
      var addDays = 0;
      if(/^net\s*(\d+)/.test(t)) addDays = parseInt(RegExp.$1, 10);
      else if(t === 'prepaid')   addDays = null;     // no due date
      else if(t === 'cod')       addDays = 0;
      else                       addDays = 0;        // "Due on receipt"
      if(addDays !== null) dueIso = new Date(Date.parse(date) + addDays*86400000).toISOString().slice(0,10);
    } catch(e){ dueIso=''; }
    // Use the Supabase JS client so the user's session JWT is sent.
    // The earlier raw-fetch path used only the anon API key, which RLS
    // policies that require role=authenticated will reject (PR #61's
    // blanket RLS migration enforces `to authenticated`).
    (async function syncInvoice(){
      var sb = window.supa;
      if(!sb){
        console.error('[GL] Supabase JS client not ready for invoice sync.');
        if(typeof addNotification==='function')addNotification('Cloud sync skipped','Saved locally — Supabase client not loaded.','warning');
        return;
      }
      var payload = {
        invoice_number:invId,
        client_id:(cid&&cid.charAt(0)==='c')?null:cid,
        client_name:client.name||'',
        service:inv.svc,
        amount:amount,
        invoice_date:date,
        due_date:dueIso||null,
        payment_terms: inv.paymentTerms,
        line_items:combinedLines
      };
      // Fallback: if we're editing but lost the supa row id, look it up by
      // invoice_number. Prevents the save from silently INSERT-failing on a
      // unique-constraint violation when the user edits an invoice multiple
      // times in one session.
      if(!editingSupaId && editingId){
        try {
          var lookup = await sb.from('invoices').select('id').eq('invoice_number', editingId).maybeSingle();
          if(lookup && lookup.data && lookup.data.id) editingSupaId = lookup.data.id;
        } catch(e){ /* fall through to insert */ }
      }
      // On INSERT (new invoice) seed status=pending. On UPDATE preserve the
      // existing row's status so editing a paid invoice doesn't accidentally
      // un-mark it as paid.
      if(!editingSupaId){
        payload.status = 'pending';
        payload.notes = '';
      }
      // Retry on PGRST204 "column not found" by peeling off the offending
      // column from the payload. Without this, a single schema gap aborts
      // the entire write and the user's edits silently disappear on refresh.
      var working = Object.assign({}, payload);
      var r, retries = 20, droppedCols = [];
      while(retries-- > 0){
        if(editingSupaId){
          r = await sb.from('invoices').update(working).eq('id', editingSupaId).select().single();
        } else {
          r = await sb.from('invoices').insert(working).select().single();
        }
        if(!r || !r.error) break;
        if(r.error.code !== 'PGRST204') break;
        var m = (r.error.message || '').match(/'([^']+)' column/);
        if(!m || working[m[1]] === undefined) break;
        droppedCols.push(m[1]);
        delete working[m[1]];
      }
      if(droppedCols.length){
        console.warn('[GL] Invoice sync: dropped unknown columns to recover save:', droppedCols);
        if(typeof addNotification==='function')addNotification('Saved (partial)','Run the latest migration. Skipped: '+droppedCols.join(', '),'warning');
      }
      if(r && r.error){
        console.error('[GL] Supabase sync failed for '+invId+':', r.error);
        if(typeof addNotification==='function')addNotification('Cloud sync failed','Invoice '+invId+' saved locally only. '+(r.error.message||''),'warning');
        return;
      }
      inv.supaId = r && r.data && r.data.id;
      if(r && r.data && r.data.status) inv.status = r.data.status;
      console.log('[GL] Invoice synced to Supabase:',invId,inv.supaId||'',editingSupaId?'(updated)':'(inserted)');
    })().catch(function(err){
      console.error('[GL] Supabase sync threw for '+invId+':', err);
      if(typeof addNotification==='function')addNotification('Cloud sync failed','Invoice '+invId+' saved locally only. '+(err.message||''),'warning');
    });

    // Clear edit-mode markers so the next save returns to insert mode.
    if(builderEl){
      builderEl.removeAttribute('data-editing-supa-id');
      builderEl.removeAttribute('data-editing-id');
    }
    return inv;
  };

  /* ── SAVE & SEND — one click: save the invoice, then open Send composer ── */
  window.glSaveAndSend = function(){
    var inv = window.glSaveInvoice();
    if(!inv || !inv.id) return; // glSaveInvoice already alerted the user
    // Small delay so the builder modal finishes closing + the toast fires
    // before the send modal opens on top.
    setTimeout(function(){
      if(typeof window.openSendInvoiceModal === 'function'){
        window.openSendInvoiceModal(inv.id);
      } else {
        alert('Invoice saved as '+inv.id+'. Open it from the Invoices list and click Send Invoice.');
      }
    }, 350);
  };

  /* ── EDIT INVOICE — reopen the builder pre-filled with an existing invoice ── */
  window.openEditInvoice = function(invId){
    var inv = (window.invoices||[]).find(function(i){ return i.id === invId; });
    if(!inv){ alert('Invoice not found.'); return; }
    // Close the read-only detail panel if it's showing
    if(typeof closeDetail === 'function') try { closeDetail(); } catch(e){}
    var detail = document.getElementById('inv-detail');
    if(detail) detail.classList.remove('show');

    // Open the builder. openNewInvoiceBuilder resets INV via freshState(), so
    // we configure prefill *after* it returns.
    if(typeof window.openNewInvoiceBuilder !== 'function'){
      alert('Invoice builder not ready.'); return;
    }
    window.openNewInvoiceBuilder();

    setTimeout(function(){
      var builder = document.getElementById('gl-inv-builder');
      if(!builder){ return; }
      // Tag the modal so glSaveInvoice does UPDATE not INSERT
      builder.setAttribute('data-editing-id', inv.id);
      if(inv.supaId) builder.setAttribute('data-editing-supa-id', inv.supaId);

      // Header title swap NEW → EDIT
      var titleEl = builder.querySelector('div[style*="letter-spacing:2px"][style*="font-family"]');
      if(titleEl && /NEW INVOICE/i.test(titleEl.textContent)){
        titleEl.textContent = 'EDIT INVOICE ' + inv.id;
      }

      // Prefill scalar fields
      var cli = document.getElementById('ginv-client');
      if(cli){ cli.value = inv.client || ''; if(window.INV) window.INV.clientId = cli.value; }
      var dt = document.getElementById('ginv-date');
      if(dt && inv.date){ dt.value = inv.date; if(window.INV) window.INV.date = inv.date; }
      var idEl = document.getElementById('ginv-id');
      if(idEl){ idEl.value = inv.id; }
      var notesEl = builder.querySelector('textarea');
      if(notesEl && inv.notes){ notesEl.value = inv.notes; if(window.INV) window.INV.notes = inv.notes; }
      var discEl = document.getElementById('ginv-disc');
      if(discEl && inv.discount){ discEl.value = inv.discount; if(window.INV) window.INV.discount = inv.discount; }

      // Build editable rows for every existing line item. We try to use the
      // SAME row builder that originally created the line (Canning, Bottling,
      // or Manual) so the user sees the same UI they used to create it —
      // format dropdown + qty + price + separate Description (optional)
      // input. Falls back to a manual row if the type can't be detected.
      var tbl = window.glGetTbl && window.glGetTbl();
      function splitLineDesc(raw){
        // Format: "<Type> - <Format Label>[ — <User description>]"
        // The user description (if any) is separated by an em-dash (—).
        raw = (raw||'').trim();
        var emIdx = raw.indexOf(' — ');
        var beforeEm = emIdx >= 0 ? raw.slice(0, emIdx).trim() : raw;
        var userDesc = emIdx >= 0 ? raw.slice(emIdx + 3).trim() : '';
        var parts = beforeEm.split(' - ');
        return {
          type: parts[0] || '',
          fmtLabel: parts.length > 1 ? parts.slice(1).join(' - ') : '',
          userDesc: userDesc,
          raw: raw
        };
      }
      function findFormatByLabel(formats, label){
        if(!formats || !label) return null;
        var hit = formats.find(function(f){ return f.label === label || f.value === label; });
        return hit ? hit.value : null;
      }
      if(tbl && Array.isArray(inv.lines)){
        var placeholder = Array.prototype.slice.call(tbl.children).find(function(c){
          return c.textContent && c.textContent.trim() === 'No line items yet. Add one below.';
        });
        if(placeholder) placeholder.remove();
        // Need rates loaded so the format dropdowns populate properly.
        if(typeof window.glLoadRates === 'function' && !(window._glR && window._glR.ok)){
          try { window.glLoadRates(); } catch(e){}
        }
        var canFmts = [], canSeen = {};
        (window._glR && window._glR.c || []).forEach(function(r){ if(!canSeen[r.format]){ canSeen[r.format]=1; canFmts.push({value:r.format,label:r.format_label}); } });
        if(!canFmts.length) canFmts = [{value:'12oz-standard',label:'12oz Standard'}];
        var btlFmts = [], btlSeen = {};
        (window._glR && window._glR.b || []).forEach(function(r){ if(!btlSeen[r.format]){ btlSeen[r.format]=1; btlFmts.push({value:r.format,label:r.format_label}); } });
        if(!btlFmts.length) btlFmts = [{value:'750ml',label:'750ml Bottle'}];

        inv.lines.forEach(function(l, ix){
          var uid = 'gledit' + Date.now() + '_' + ix;
          var parsed = splitLineDesc(l.desc);
          var type = parsed.type.toLowerCase();
          var row = null;
          if(type === 'canning' && window.glBuildCanRow){
            var canFmt = findFormatByLabel(canFmts, parsed.fmtLabel) || canFmts[0].value;
            var perCan = (l.unitPrice || 0) / 24; // unitPrice on canning lines is per-case
            row = window.glBuildCanRow(uid, l.qty || 0, canFmt, canFmts, perCan, parsed.userDesc);
            row.setAttribute('data-pu-override','1'); // user's saved price wins over catalog
            row.setAttribute('data-gl-total', (l.qty||0) * (l.unitPrice||0));
          } else if(type === 'bottling' && window.glBuildBtlRow){
            var btlFmt = findFormatByLabel(btlFmts, parsed.fmtLabel) || btlFmts[0].value;
            row = window.glBuildBtlRow(uid, l.qty || 0, btlFmt, btlFmts, l.unitPrice || 0, parsed.userDesc);
            row.setAttribute('data-pu-override','1');
            row.setAttribute('data-gl-total', (l.qty||0) * (l.unitPrice||0));
          } else {
            // R&D / Hours / Custom / unknown — use the manual row, which now
            // has separate -subtype (e.g. "Formulation") and -desc (optional)
            // inputs. Map the parsed parts into those two fields.
            var manualLabel = parsed.type || 'Line';
            var manualSubtype = parsed.fmtLabel || '';
            var manualOpt = parsed.userDesc || '';
            row = window.glBuildManualRow(uid, manualLabel, manualSubtype, l.qty || 0, l.unitPrice || 0, manualOpt);
          }
          if(row) tbl.appendChild(row);
        });
        if(typeof window.glCalcInvTotal === 'function') window.glCalcInvTotal();
      }

      // Prefill addons (the builder always renders 4 addon input pairs)
      if(Array.isArray(inv.addons) && inv.addons.length){
        var addonDescInputs = builder.querySelectorAll('input[oninput*="addons"][placeholder*="Add-on"]');
        var addonPriceInputs = builder.querySelectorAll('input[oninput*="addons"][placeholder="$0.00"]');
        inv.addons.forEach(function(a, ix){
          if(addonDescInputs[ix]){ addonDescInputs[ix].value = a.d || ''; }
          if(addonPriceInputs[ix]){ addonPriceInputs[ix].value = a.p || ''; }
        });
      }
    }, 80);
  };

  // Override the legacy INV-state recalc so addon inputs and the discount
  // field route through the DOM-based total (data-gl-total + addon inputs).
  // The legacy refreshTotals() reads INV.lines which is empty under the
  // DOM-first save flow, which would zero out the totals box.
  window.glApplyDiscount = function(){ window.glCalcInvTotal(); };

  document.addEventListener('click',function(){
    var disc=document.getElementById('ginv-disc');
    if(disc&&!disc._glWired2){
      disc.addEventListener('input',function(){window.glCalcInvTotal();});
      disc._glWired2=true;
    }
  });

  console.log('[GL] Invoice fix v5 loaded - DOM save + Supabase sync + shared invoices array');
}());

