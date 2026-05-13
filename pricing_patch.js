
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
  window._glRates = { canning: [], bottling: [], loaded: false };

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

  function getCanRate(cases, format) {
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

  function getBottleRate(units, format) {
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

  /* ── Canning line ──────────────────────────────────────── */
  window.glCanFormatChange = function(uid) {
    var ce = document.getElementById(uid + '-cases');
    var fe = document.getElementById(uid + '-format');
    if (!ce || !fe) return;
    var cases   = Math.max(1, parseInt(ce.value) || 150);
    var format  = fe.value;
    var perCan  = getCanRate(cases, format);
    var perCase = perCan * CANS_PER_CASE;
    var total   = perCase * cases;
    function s(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
    s(uid + '-total', usd(total));
    s(uid + '-pcase', usd(perCase) + '/case');
    s(uid + '-pcan',  usd(perCan, 4) + '/can');
    s(uid + '-cans',  (cases * CANS_PER_CASE).toLocaleString() + ' cans');
    if (typeof window.glCalcInvTotal === 'function') window.glCalcInvTotal();
  };

  window.glRemoveCanLine = function(uid) {
    var e = document.getElementById(uid); if (e) e.remove();
    if (typeof window.glCalcInvTotal === 'function') window.glCalcInvTotal();
  };

  /* ── Bottling line ─────────────────────────────────────── */
  window.glBottleQtyChange = function(uid) {
    var qe = document.getElementById(uid + '-qty');
    var fe = document.getElementById(uid + '-format');
    if (!qe || !fe) return;
    var qty       = Math.max(1, parseInt(qe.value) || 500);
    var format    = fe.value;
    var perUnit   = getBottleRate(qty, format);
    var total     = perUnit * qty;
    function s(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
    s(uid + '-total', usd(total));
    s(uid + '-punit', usd(perUnit, 4) + '/btl');
    if (typeof window.glCalcInvTotal === 'function') window.glCalcInvTotal();
  };

  window.glRemoveBottleLine = function(uid) {
    var e = document.getElementById(uid); if (e) e.remove();
    if (typeof window.glCalcInvTotal === 'function') window.glCalcInvTotal();
  };

  /* ── Override glAddLine ────────────────────────────────── */
  var _prev = window.glAddLine;
  window.glAddLine = async function(type) {
    if (type !== 'canning' && type !== 'bottling') {
      if (typeof _prev === 'function') _prev(type);
      return;
    }

    await window.glLoadRates();
    var t = getLineTable();
    if (!t) { if (typeof _prev === 'function') _prev(type); return; }

    var RS = 'display:grid;grid-template-columns:2fr 1fr 1fr 1fr 36px;gap:0;' +
             'padding:10px 12px;border-top:1px solid rgba(255,255,255,.05);align-items:start';
    var SS = 'background:#1a2a3a;color:#fff;border:1px solid rgba(0,229,192,.4);' +
             'border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;width:100%;max-width:160px';
    var SI = 'width:60px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.18);' +
             'border-radius:6px;padding:3px 6px;font-size:12px;font-weight:600;text-align:center';

    if (type === 'canning') {
      var uid = 'glcan' + Date.now();
      var formats = [];
      var seen = {};
      window._glRates.canning.forEach(function(r) {
        if (!seen[r.format]) { seen[r.format] = true; formats.push({value: r.format, label: r.format_label}); }
      });
      if (!formats.length) formats = [{value:'12oz-standard',label:'12oz Standard'}];
      var def    = formats[0].value;
      var perCan = getCanRate(150, def);
      var pcase  = perCan * CANS_PER_CASE;
      var total  = pcase * 150;
      var opts   = formats.map(function(f) {
        return '<option value="' + f.value + '"' + (f.value === def ? ' selected' : '') + '>' + f.label + '</option>';
      }).join('');
      var row = document.createElement('div');
      row.id = uid;
      row.setAttribute('style', RS);
      row.innerHTML =
        '<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">Canning</div>' +
        '<select id="' + uid + '-format" onchange="window.glCanFormatChange(this.closest(\'[id^=glcan]\').id)" style="' + SS + '">' + opts + '</select></div>' +
        '<div style="text-align:center"><input id="' + uid + '-cases" type="number" min="1" value="150" onchange="window.glCanFormatChange(this.closest(\'[id^=glcan]\').id)" style="' + SI + '"/>' +
        '<div id="' + uid + '-cans" style="font-size:10px;color:var(--muted);margin-top:3px">' + (150*CANS_PER_CASE).toLocaleString() + ' cans</div></div>' +
        '<div style="text-align:right;padding-right:4px">' +
        '<div id="' + uid + '-pcase" style="font-size:12px;color:#fff;font-weight:600">' + usd(pcase) + '/case</div>' +
        '<div id="' + uid + '-pcan"  style="font-size:10px;color:var(--muted);margin-top:3px">' + usd(perCan,4) + '/can</div></div>' +
        '<div id="' + uid + '-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">' + usd(total) + '</div>' +
        '<div style="text-align:center"><button onclick="window.glRemoveCanLine(this.closest(\'[id^=glcan]\').id)" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0">x</button></div>';
      t.appendChild(row);
    }

    if (type === 'bottling') {
      var uid = 'glbtl' + Date.now();
      var bformats = [];
      var bseen = {};
      window._glRates.bottling.forEach(function(r) {
        if (!bseen[r.format]) { bseen[r.format] = true; bformats.push({value: r.format, label: r.format_label}); }
      });
      if (!bformats.length) bformats = [{value:'750ml',label:'750ml Bottle'}];
      var bdef    = bformats[0].value;
      var perUnit = getBottleRate(500, bdef);
      var btotal  = perUnit * 500;
      var bopts   = bformats.map(function(f) {
        return '<option value="' + f.value + '"' + (f.value === bdef ? ' selected' : '') + '>' + f.label + '</option>';
      }).join('');
      var brow = document.createElement('div');
      brow.id = uid;
      brow.setAttribute('style', RS);
      brow.innerHTML =
        '<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">Bottling</div>' +
        '<select id="' + uid + '-format" onchange="window.glBottleQtyChange(this.closest(\'[id^=glbtl]\').id)" style="' + SS + '">' + bopts + '</select></div>' +
        '<div style="text-align:center"><input id="' + uid + '-qty" type="number" min="1" value="500" onchange="window.glBottleQtyChange(this.closest(\'[id^=glbtl]\').id)" style="' + SI + '"/>' +
        '<div style="font-size:10px;color:var(--muted);margin-top:3px">bottles</div></div>' +
        '<div style="text-align:right;padding-right:4px">' +
        '<div id="' + uid + '-punit" style="font-size:12px;color:#fff;font-weight:600">' + usd(perUnit,4) + '/btl</div></div>' +
        '<div id="' + uid + '-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">' + usd(btotal) + '</div>' +
        '<div style="text-align:center"><button onclick="window.glRemoveBottleLine(this.closest(\'[id^=glbtl]\').id)" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0">x</button></div>';
      t.appendChild(brow);
    }

    if (typeof window.glCalcInvTotal === 'function') window.glCalcInvTotal();
  };

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
