/* ============================================================
   INVOICE ADD-ON PANEL + CREATE INVOICE FROM QUOTE
   The quote builder's "Add-on services & packaging" checkboxes, in the
   invoice builder. Tick nitrogen, trays, pallets… and each becomes its own
   line item, priced from the same Prices settings the quote uses, with the
   quantity worked out from the canning lines: cans, cases (24 cans) or
   pallets (cases ÷ cases-per-pallet, rounded up).

   The add-on list itself lives in quote-builder.js (window.glCanningAddons)
   so an item is named and priced identically on a quote and on its invoice.

   Rows are ordinary manual rows (glBuildManualRow), so the existing save,
   edit and PDF paths handle them unchanged. Each carries:
     data-gl-addon   the add-on key, linking it to its checkbox
     data-gl-unit    can / case / pallet, saved as the line's unit
     data-qty-manual set once someone types a quantity; from then on the row
                     keeps that number instead of following the case count

   glInvoiceFromQuote() opens a new invoice filled in from one option of a
   quote (see glQuoteToInvoice in quote-builder.js).
   ============================================================ */
(function(){
  'use strict';
  var esc = window.glEsc;
  var CPC = 24;

  function panel(){ return document.getElementById('gl-inv-addons'); }
  function table(){ return typeof window.glGetTbl === 'function' ? window.glGetTbl() : null; }
  function catalog(){
    return typeof window.glCanningAddons === 'function' ? window.glCanningAddons() : { casesPerPallet: 80, items: [] };
  }
  function addonRow(key){ return document.querySelector('#gl-inv-body [data-gl-addon="' + key + '"]'); }

  // Total cases across every canning row on the invoice.
  function canningCases(){
    var cases = 0, tbl = table();
    if(!tbl) return 0;
    Array.prototype.forEach.call(tbl.children, function(row){
      var ce = row.id && document.getElementById(row.id + '-cases');
      if(ce) cases += parseInt(ce.value, 10) || 0;
    });
    return cases;
  }
  function cpp(){
    var el = document.getElementById('gl-inv-addons-cpp');
    return Math.max(1, parseInt(el && el.value, 10) || 80);
  }
  function qtyFor(unit, cases){
    if(unit === 'can')    return cases * CPC;
    if(unit === 'case')   return cases;
    if(unit === 'pallet') return cases > 0 ? Math.ceil(cases / cpp()) : 0;
    return 0;
  }

  function removePlaceholder(tbl){
    Array.prototype.slice.call(tbl.children).forEach(function(c){
      if(c.textContent && c.textContent.trim() === 'No line items yet. Add one below.') c.remove();
    });
  }

  // A plain priced line: the description is the whole label (no "Custom -"
  // prefix and no service-type box), and the unit is kept for the PDF.
  function plainRow(desc, qty, price, unit){
    var uid = 'gladd' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    var row = window.glBuildManualRow(uid, esc(desc), '', qty, price);
    var sub = row.querySelector('#' + uid + '-subtype');
    if(sub) sub.remove();
    row.setAttribute('data-gl-unit', unit || '');
    var qtyEl = row.querySelector('#' + uid + '-qty');
    if(qtyEl) qtyEl.addEventListener('input', function(){ row.setAttribute('data-qty-manual', '1'); });
    return row;
  }

  /* ── Keep the add-on rows in step with the checkboxes and the case count ── */
  function sync(){
    var p = panel(), tbl = table();
    if(!p || !tbl) return;
    var cases = canningCases();
    p.querySelectorAll('input[type="checkbox"][data-addon]').forEach(function(cb){
      var key = cb.getAttribute('data-addon'), unit = cb.getAttribute('data-unit');
      var rateEl = p.querySelector('input[data-addon-rate="' + key + '"]');
      var rate = parseFloat(rateEl && rateEl.value) || 0;
      var row = addonRow(key);
      if(!cb.checked){ if(row) row.remove(); return; }
      if(!row){
        removePlaceholder(tbl);
        row = plainRow(cb.getAttribute('data-label'), qtyFor(unit, cases), rate, unit);
        row.setAttribute('data-gl-addon', key);
        var priceEl = row.querySelector('[id$="-price"]');
        // Editing the price on the row updates the panel, and the other way
        // round, so the two never show different rates.
        if(priceEl) priceEl.addEventListener('input', function(){ if(rateEl) rateEl.value = priceEl.value; });
      }
      // Re-appending in checkbox order keeps add-ons below the production
      // lines even when a Canning line is added after the boxes are ticked.
      tbl.appendChild(row);
      var q = row.querySelector('[id$="-qty"]'), pr = row.querySelector('[id$="-price"]');
      if(q && row.getAttribute('data-qty-manual') !== '1') q.value = qtyFor(unit, cases);
      if(pr) pr.value = rate;
      window.glUpdateManual(row.id);
    });
    var hint = document.getElementById('gl-inv-addons-hint');
    if(hint) hint.textContent = cases > 0
      ? 'Quantities follow the canning lines: ' + cases.toLocaleString() + ' cases · ' + (cases * CPC).toLocaleString() + ' cans · ' + qtyFor('pallet', cases) + ' pallets.'
      : 'Add a Canning line first — add-on quantities are worked out from its case count.';
    if(typeof window.glCalcInvTotal === 'function') window.glCalcInvTotal();
  }

  /* ── The panel ── (built with DOM calls, not HTML strings) */
  function el(tag, style, text){
    var e = document.createElement(tag);
    if(style) e.setAttribute('style', style);
    if(text != null) e.textContent = text;
    return e;
  }
  function buildPanel(){
    var cat = catalog();
    var wrap = el('div', 'margin-bottom:24px');
    wrap.id = 'gl-inv-addons';
    wrap.appendChild(el('div', 'font-size:11px;letter-spacing:2px;color:var(--teal);margin-bottom:4px', 'ADD-ON SERVICES & PACKAGING'));
    wrap.appendChild(el('div', 'font-size:11px;color:var(--muted);margin-bottom:10px', 'Tick what applies — each becomes its own line item, priced from the $ Prices settings.'));
    var grid = el('div', 'display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px');
    cat.items.forEach(function(a){
      var card = el('label', 'display:block;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:9px 10px;cursor:pointer');
      var top = el('div', 'display:flex;gap:8px;align-items:flex-start;font-size:12px;color:#fff;font-weight:600;margin-bottom:6px');
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.setAttribute('data-addon', a.key);
      cb.setAttribute('data-unit', a.unit);
      cb.setAttribute('data-label', a.label);
      top.appendChild(cb);
      top.appendChild(el('span', '', a.label));
      var rateLine = el('div', 'display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)');
      rateLine.appendChild(el('span', '', '$'));
      var rate = document.createElement('input');
      rate.type = 'number'; rate.step = '0.001'; rate.min = '0';
      rate.value = a.rate;
      rate.setAttribute('data-addon-rate', a.key);
      rate.setAttribute('style', 'width:72px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:3px 6px;font-size:12px');
      rateLine.appendChild(rate);
      rateLine.appendChild(el('span', '', '/ per ' + a.unit));
      card.appendChild(top);
      card.appendChild(rateLine);
      grid.appendChild(card);
      cb.addEventListener('change', sync);
      rate.addEventListener('input', sync);
    });
    wrap.appendChild(grid);
    var foot = el('div', 'display:flex;align-items:center;gap:8px;margin-top:10px;font-size:11px;color:var(--muted)');
    foot.appendChild(el('span', '', 'Cases per pallet'));
    var c = document.createElement('input');
    c.type = 'number'; c.min = '1'; c.id = 'gl-inv-addons-cpp';
    c.value = cat.casesPerPallet || 80;
    c.setAttribute('style', 'width:64px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:3px 6px;font-size:12px');
    c.addEventListener('input', sync);
    foot.appendChild(c);
    wrap.appendChild(foot);
    var hint = el('div', 'font-size:11px;color:var(--muted);margin-top:6px');
    hint.id = 'gl-inv-addons-hint';
    wrap.appendChild(hint);
    return wrap;
  }

  function ensurePanel(){
    var body = document.getElementById('gl-inv-body');
    if(!body || panel()) return;
    var customBtn = body.querySelector('[data-gl-action="glAddLine"][data-gl-arg1="custom"]');
    var buttons = customBtn && customBtn.parentElement;
    if(!buttons) return;
    buttons.parentNode.insertBefore(buildPanel(), buttons.nextSibling);
    sync();
  }

  // An invoice reopened for editing comes back as manual rows. Re-link any
  // whose description is exactly an add-on's name to its checkbox, keeping the
  // saved quantity and price — otherwise ticking the box would add a duplicate.
  function adoptExistingRows(){
    var p = panel(), tbl = table();
    if(!p || !tbl) return;
    Array.prototype.forEach.call(tbl.children, function(row){
      if(!row.id || row.hasAttribute('data-gl-addon')) return;
      if(!document.getElementById(row.id + '-price')) return;
      var labelEl = row.querySelector('div > div');
      var sub = document.getElementById(row.id + '-subtype');
      var desc = (labelEl ? labelEl.textContent.trim() : '') + (sub && sub.value.trim() ? ' - ' + sub.value.trim() : '');
      var cb = Array.prototype.find.call(p.querySelectorAll('input[data-addon]'), function(x){
        return x.getAttribute('data-label').toLowerCase() === desc.toLowerCase();
      });
      if(!cb || cb.checked) return;
      var key = cb.getAttribute('data-addon');
      if(sub) sub.remove();
      row.setAttribute('data-gl-addon', key);
      row.setAttribute('data-gl-unit', cb.getAttribute('data-unit'));
      row.setAttribute('data-qty-manual', '1');
      var price = document.getElementById(row.id + '-price');
      var rateEl = p.querySelector('input[data-addon-rate="' + key + '"]');
      if(rateEl && price) rateEl.value = price.value;
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
      // openEditInvoice rebuilds saved rows ~80ms after the builder opens.
      setTimeout(adoptExistingRows, 300);
      return r;
    };
  }
  function after(name, fn){
    var orig = window[name];
    if(typeof orig !== 'function') return;
    window[name] = function(){
      var r = orig.apply(this, arguments);
      try { fn.apply(this, arguments); } catch(e){ console.error('[GL] invoice add-ons:', e); }
      return r;
    };
  }
  // A canning row's case count drives every add-on quantity.
  after('glUpdateCan', sync);
  after('glAddLine', function(){ ensurePanel(); sync(); });
  // Deleting an add-on row with its ✕ unticks the box; deleting a canning row
  // changes the counts.
  var removeOrig = window.glRemoveLine;
  if(typeof removeOrig === 'function'){
    window.glRemoveLine = function(uid){
      var row = document.getElementById(uid);
      var key = row && row.getAttribute('data-gl-addon');
      var r = removeOrig.apply(this, arguments);
      var p = panel();
      if(key && p){ var cb = p.querySelector('input[data-addon="' + key + '"]'); if(cb) cb.checked = false; }
      sync();
      return r;
    };
  }

  /* ── Create an invoice from a quote option ──
     spec: { clientId, quoteNumber, items: [quote line items], casesPerPallet } */
  function norm(s){ return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function formats(list){
    var out = [], seen = {};
    (list || []).forEach(function(r){ if(!seen[r.format]){ seen[r.format] = 1; out.push({ value: r.format, label: r.format_label }); } });
    return out;
  }
  window.glInvoiceFromQuote = async function(spec){
    if(typeof window.openNewInvoiceBuilder !== 'function'){ alert('Invoice builder not ready.'); return; }
    // Open without a client, then set it and WAIT for its rate lookup to
    // finish before adding rows: choosing a client resets every canning price
    // to that client's catalog rate, which would overwrite the quoted prices.
    window.openNewInvoiceBuilder();
    var sel = document.getElementById('ginv-client');
    if(sel && spec.clientId){
      sel.value = spec.clientId;
      if(window.INV) window.INV.clientId = spec.clientId;
      if(typeof window.glOnInvClientChange === 'function'){
        try { await window.glOnInvClientChange(spec.clientId); } catch(e){ console.error('[GL] client rates:', e); }
      }
    }
    if(window._glR && !window._glR.ok && typeof window.glLoadRates === 'function'){
      try { await window.glLoadRates(); } catch(e){}
    }
    var tbl = table(), p = panel();
    if(!tbl){ alert('Invoice builder did not open.'); return; }
    removePlaceholder(tbl);

    var items = spec.items || [];
    // The panel works out add-on quantities from ONE case count. With a single
    // canning line that matches the quote exactly; with several, per-format
    // rates and pallet rounding can differ, so every item keeps the quote's
    // own quantity and price as a plain row instead.
    var canningLines = items.filter(function(l){ return l.kind === 'canning'; });
    var usePanel = !!p && canningLines.length === 1;
    if(usePanel && spec.casesPerPallet){
      var cppEl = document.getElementById('gl-inv-addons-cpp');
      if(cppEl) cppEl.value = spec.casesPerPallet;
    }
    var canFmts = formats(window._glR && window._glR.c);
    if(!canFmts.length) canFmts = [{ value: '12oz-standard', label: '12oz Standard' }];
    var btlFmts = formats(window._glR && window._glR.b);
    if(!btlFmts.length) btlFmts = [{ value: '750ml', label: '750ml Bottle' }];

    items.forEach(function(l, i){
      var uid = 'glq2i' + Date.now() + '_' + i;
      if(l.kind === 'canning' && l.cases > 0 && window.glBuildCanRow){
        var hit = canFmts.find(function(f){ return norm(f.label) === norm(l.format) || norm(f.value) === norm(l.format); });
        // An unknown format still invoices at the quoted price; its name goes
        // in the row's description so nothing is silently relabelled.
        var row = window.glBuildCanRow(uid, l.cases, hit ? hit.value : canFmts[0].value, canFmts, l.perCan, hit ? '' : l.format);
        row.setAttribute('data-pu-override', '1');   // the quoted price wins over the catalog
        tbl.appendChild(row);
      } else if(l.kind === 'bottling' && window.glBuildBtlRow){
        var bhit = btlFmts.find(function(f){ return norm(f.label) === norm(l.format) || norm(f.value) === norm(l.format); });
        var brow = window.glBuildBtlRow(uid, l.qty, bhit ? bhit.value : btlFmts[0].value, btlFmts, l.unitPrice, bhit ? '' : l.format);
        brow.setAttribute('data-pu-override', '1');
        tbl.appendChild(brow);
      } else if(usePanel && l.addon){
        var cb = p.querySelector('input[data-addon="' + l.addon + '"]');
        var rateEl = p.querySelector('input[data-addon-rate="' + l.addon + '"]');
        if(cb && rateEl){ cb.checked = true; rateEl.value = l.unitPrice; return; }
        tbl.appendChild(plainRow(l.desc, l.qty, l.unitPrice, l.unit));
      } else {
        tbl.appendChild(plainRow(l.desc, l.qty, l.unitPrice, l.unit));
      }
    });
    sync();

    var notes = document.querySelector('#gl-inv-body [data-gl-action="glSetInvNotes"]');
    if(notes && !notes.value && spec.quoteNumber){
      notes.value = 'Per quote ' + spec.quoteNumber + '.';
      if(window.INV) window.INV.notes = notes.value;
    }
    if(typeof window.glCalcInvTotal === 'function') window.glCalcInvTotal();
  };

  console.log('[GL] invoice add-on panel loaded');
}());
