/* ============================================================
   FORMULA TO SHELF PACKAGES: checkboxes in the invoice builder
   The founder launch program (goodliquidbevco.com/launch) sold as line items.
   Tick a package and it becomes its own line on the invoice, with a quantity
   (SKUs, months, rounds) and a price that both stay editable.

   window.glLaunchPackages() is the one list of packages, shared with the
   quote builder (quote-builder.js), so a package is named and priced the same
   on a quote and on its invoice. Prices come from pricing_settings (category
   "Formula to Shelf", migration 20261108120000), edited on the Prices screen;
   the numbers here are only the fallback if that table cannot be read.

   Rows are ordinary manual rows (glBuildManualRow), so the existing save, edit
   and PDF paths handle them unchanged. Each carries data-gl-launch (the
   package key). An invoice reopened for editing, or made from a quote, comes
   back as plain rows; any whose description is exactly a package name is
   linked back to its checkbox so ticking it again cannot add a duplicate.

   Everything here is built with DOM calls and textContent; nothing a client
   typed is written as HTML.
   ============================================================ */
(function(){
  'use strict';

  function px(key, fallback){
    return typeof window.glPrice === 'function' ? window.glPrice(key, fallback) : fallback;
  }

  // hidden: not offered yet. The Launch Toolkit and Founder Membership are on
  // hold until their content is built; flip hidden off to sell them again.
  // Their prices stay in pricing_settings meanwhile.
  // discount: Core and Full price the first production run(s) two volume
  // tiers lower. The quote builder offers that as its own box when one of
  // them is ticked.
  var PACKAGES = [
    { key: 'launch_toolkit',      label: 'Formula to Shelf: Launch Toolkit',          unit: 'each',  per: 'one time',  priceKey: 'launch_toolkit',              fallback: 147, hidden: true },
    { key: 'launch_core',         label: 'Formula to Shelf: Core Launch',             unit: 'SKU',   per: 'per SKU',   priceKey: 'launch_core_per_sku',         fallback: 4250, discount: true },
    { key: 'launch_full',         label: 'Formula to Shelf: Full Launch',             unit: 'SKU',   per: 'per SKU',   priceKey: 'launch_full_per_sku',         fallback: 7500, discount: true },
    { key: 'launch_membership',   label: 'Formula to Shelf: Founder Membership',      unit: 'month', per: 'per month', priceKey: 'launch_membership_per_month', fallback: 199, hidden: true },
    { key: 'launch_sample_round', label: 'Formula to Shelf: Additional Sample Round', unit: 'round', per: 'per round', priceKey: 'launch_extra_sample_round',   fallback: 475 }
  ];

  window.glLaunchPackages = function(){
    return PACKAGES.filter(function(p){ return !p.hidden; }).map(function(p){
      return { key: p.key, label: p.label, unit: p.unit, per: p.per, rate: px(p.priceKey, p.fallback), discount: !!p.discount };
    });
  };
  window.glLaunchPackageByLabel = function(desc){
    var d = String(desc || '').trim().toLowerCase();
    return window.glLaunchPackages().find(function(p){ return p.label.toLowerCase() === d; }) || null;
  };

  /* ── Invoice builder panel ── */
  function panel(){ return document.getElementById('gl-inv-launch'); }
  function table(){ return typeof window.glGetTbl === 'function' ? window.glGetTbl() : null; }
  function pkgRow(key){ return document.querySelector('#gl-inv-body [data-gl-launch="' + key + '"]'); }

  function el(tag, style, text){
    var e = document.createElement(tag);
    if(style) e.setAttribute('style', style);
    if(text != null) e.textContent = text;
    return e;
  }
  var NUM = 'background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:3px 6px;font-size:12px';

  function removePlaceholder(tbl){
    Array.prototype.slice.call(tbl.children).forEach(function(c){
      if(c.textContent && c.textContent.trim() === 'No line items yet. Add one below.') c.remove();
    });
  }

  function buildPanel(){
    var wrap = el('div', 'margin-bottom:24px');
    wrap.id = 'gl-inv-launch';
    wrap.appendChild(el('div', 'font-size:11px;letter-spacing:2px;color:var(--teal);margin-bottom:4px', 'FORMULA TO SHELF PACKAGES'));
    wrap.appendChild(el('div', 'font-size:11px;color:var(--muted);margin-bottom:10px', 'Tick each package the client bought. Each becomes its own line item, priced from the $ Prices settings.'));
    var grid = el('div', 'display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px');
    window.glLaunchPackages().forEach(function(p){
      var card = el('div', 'background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:9px 10px');
      var top = el('label', 'display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#fff;font-weight:600;margin-bottom:6px;cursor:pointer');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-launch', p.key);
      cb.setAttribute('data-label', p.label);
      cb.setAttribute('data-unit', p.unit);
      top.appendChild(cb);
      top.appendChild(el('span', '', p.label.replace('Formula to Shelf: ', '')));
      var line = el('div', 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:11px;color:var(--muted)');
      var qty = document.createElement('input');
      qty.type = 'number'; qty.min = '1'; qty.step = '1'; qty.value = '1';
      qty.setAttribute('data-launch-qty', p.key);
      qty.setAttribute('aria-label', p.label + ' quantity');
      qty.setAttribute('style', NUM + ';width:48px');
      var rate = document.createElement('input');
      rate.type = 'number'; rate.min = '0'; rate.step = '0.01'; rate.value = p.rate;
      rate.setAttribute('data-launch-rate', p.key);
      rate.setAttribute('aria-label', p.label + ' price');
      rate.setAttribute('style', NUM + ';width:78px');
      line.appendChild(qty);
      line.appendChild(el('span', '', '× $'));
      line.appendChild(rate);
      line.appendChild(el('span', '', p.per));
      card.appendChild(top);
      card.appendChild(line);
      grid.appendChild(card);
      cb.addEventListener('change', sync);
      qty.addEventListener('input', sync);
      rate.addEventListener('input', sync);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  function ensurePanel(){
    var body = document.getElementById('gl-inv-body');
    if(!body || panel()) return;
    var addons = document.getElementById('gl-inv-addons');
    var anchor = addons;
    if(!anchor){
      var customBtn = body.querySelector('[data-gl-action="glAddLine"][data-gl-arg1="custom"]');
      anchor = customBtn && customBtn.parentElement;
    }
    if(!anchor || !anchor.parentNode) return;
    anchor.parentNode.insertBefore(buildPanel(), anchor.nextSibling);
  }

  function plainRow(p, qty, rate){
    var uid = 'gllaunch' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    var row = window.glBuildManualRow(uid, window.glEsc(p.label), '', qty, rate);
    var sub = row.querySelector('#' + uid + '-subtype');
    if(sub) sub.remove();
    row.setAttribute('data-gl-unit', p.unit);
    row.setAttribute('data-gl-launch', p.key);
    return row;
  }

  // Keep the package rows in step with the boxes. Editing the quantity or
  // price on the row itself writes back to the panel, so the two never differ.
  function sync(){
    var pnl = panel(), tbl = table();
    if(!pnl || !tbl || typeof window.glBuildManualRow !== 'function') return;
    window.glLaunchPackages().forEach(function(p){
      var cb = pnl.querySelector('input[data-launch="' + p.key + '"]');
      var qEl = pnl.querySelector('input[data-launch-qty="' + p.key + '"]');
      var rEl = pnl.querySelector('input[data-launch-rate="' + p.key + '"]');
      var qty = Math.max(1, parseInt(qEl && qEl.value, 10) || 1);
      var rate = parseFloat(rEl && rEl.value) || 0;
      var row = pkgRow(p.key);
      if(!cb || !cb.checked){ if(row) row.remove(); return; }
      if(!row){
        removePlaceholder(tbl);
        row = plainRow(p, qty, rate);
        var rq = row.querySelector('[id$="-qty"]'), rp = row.querySelector('[id$="-price"]');
        if(rq) rq.addEventListener('input', function(){ if(qEl) qEl.value = rq.value; });
        if(rp) rp.addEventListener('input', function(){ if(rEl) rEl.value = rp.value; });
        tbl.appendChild(row);
      }
      var q = row.querySelector('[id$="-qty"]'), pr = row.querySelector('[id$="-price"]');
      if(q) q.value = qty;
      if(pr) pr.value = rate;
      if(typeof window.glUpdateManual === 'function') window.glUpdateManual(row.id);
    });
    if(typeof window.glCalcInvTotal === 'function') window.glCalcInvTotal();
  }

  // Link saved or quote-made rows back to their boxes, keeping their quantity
  // and price.
  function adoptExistingRows(){
    var pnl = panel(), tbl = table();
    if(!pnl || !tbl) return;
    Array.prototype.forEach.call(tbl.children, function(row){
      if(!row.id || row.hasAttribute('data-gl-launch') || row.hasAttribute('data-gl-addon')) return;
      var price = document.getElementById(row.id + '-price');
      if(!price) return;
      var labelEl = row.querySelector('div > div');
      var sub = document.getElementById(row.id + '-subtype');
      var desc = (labelEl ? labelEl.textContent.trim() : '') + (sub && sub.value.trim() ? ' - ' + sub.value.trim() : '');
      var p = window.glLaunchPackageByLabel(desc);
      if(!p) return;
      var cb = pnl.querySelector('input[data-launch="' + p.key + '"]');
      if(!cb || cb.checked) return;
      if(sub) sub.remove();
      row.setAttribute('data-gl-launch', p.key);
      row.setAttribute('data-gl-unit', p.unit);
      var qEl = pnl.querySelector('input[data-launch-qty="' + p.key + '"]');
      var rEl = pnl.querySelector('input[data-launch-rate="' + p.key + '"]');
      var rq = document.getElementById(row.id + '-qty');
      if(qEl && rq) qEl.value = rq.value;
      if(rEl) rEl.value = price.value;
      if(rq) rq.addEventListener('input', function(){ if(qEl) qEl.value = rq.value; });
      price.addEventListener('input', function(){ if(rEl) rEl.value = price.value; });
      cb.checked = true;
    });
    sync();
  }

  /* ── Hooks into the invoice builder ── */
  var openOrig = window.openNewInvoiceBuilder;
  if(typeof openOrig === 'function'){
    window.openNewInvoiceBuilder = function(){
      var r = openOrig.apply(this, arguments);
      ensurePanel();
      // openEditInvoice rebuilds saved rows shortly after the builder opens.
      setTimeout(adoptExistingRows, 350);
      return r;
    };
  }
  var addOrig = window.glAddLine;
  if(typeof addOrig === 'function'){
    window.glAddLine = function(){
      var r = addOrig.apply(this, arguments);
      ensurePanel();
      return r;
    };
  }
  // Deleting a package row with its ✕ unticks the box.
  var removeOrig = window.glRemoveLine;
  if(typeof removeOrig === 'function'){
    window.glRemoveLine = function(uid){
      var row = document.getElementById(uid);
      var key = row && row.getAttribute('data-gl-launch');
      var r = removeOrig.apply(this, arguments);
      var pnl = panel();
      if(key && pnl){ var cb = pnl.querySelector('input[data-launch="' + key + '"]'); if(cb) cb.checked = false; }
      return r;
    };
  }
  // An invoice made from a quote arrives as plain rows; tick their boxes.
  var fromQuoteOrig = window.glInvoiceFromQuote;
  if(typeof fromQuoteOrig === 'function'){
    window.glInvoiceFromQuote = async function(){
      var r = await fromQuoteOrig.apply(this, arguments);
      ensurePanel();
      adoptExistingRows();
      return r;
    };
  }

  console.log('[GL] Formula to Shelf packages loaded');
}());
