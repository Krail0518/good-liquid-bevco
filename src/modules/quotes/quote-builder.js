/* ============================================================
   PRODUCTION QUOTE BUILDER
   Admin-only tool that generates production quotes from the
   standard price deck and saves them under the client's record.

   Entry points:
     glOpenQuoteBuilder(clientId, dealId?)  – from deal panel or client modal
     Injected buttons:
       – "📋 New Quote" in the deal detail panel (alongside Create Invoice)
       – "✅ Close Job"  in the deal detail panel (sets stage → Closed Won)
       – "📋 QUOTES" history section in the Edit Client modal
   ============================================================ */
(function(){
  'use strict';
  var esc = window.glEsc;

  /* ── Price deck ────────────────────────────────────────────── */
  var CANS_PER_CASE  = 24;
  var BTLS_PER_CASE  = 6;

  // [minCases, maxCases, $/can or $/btl]
  var DECK = {
    canning: {
      formats: ['12oz Standard','12oz Sleek','16oz Standard'],
      tiers: {
        '12oz Standard': [[200,339,0.48],[340,500,0.43],[501,999,0.38],[1000,2499,0.35],[2500,4999,0.31],[5000,1e9,0.28]],
        '12oz Sleek':    [[200,339,0.48],[340,500,0.43],[501,999,0.38],[1000,2499,0.35],[2500,4999,0.31],[5000,1e9,0.28]],
        '16oz Standard': [[200,339,0.58],[340,500,0.53],[501,999,0.48],[1000,2499,0.45],[2500,4999,0.41],[5000,1e9,0.38]]
      },
      defaultAddons: { nitrogen: 0.03, tray: 0.03 }
    },
    bottling: {
      formats: ['750ml Bottle'],
      tiers: {
        '750ml Bottle': [[220,659,2.16],[660,1319,1.91],[1320,2639,1.58],[2640,5279,1.41],[5280,1e9,1.12]]
      },
      defaultAddons: {}
    },
    keg: {
      formats: ['19.5L Hybrid Keg (Sixtel)'],
      tiers: {
        '19.5L Hybrid Keg (Sixtel)': [[40,1e9,12]]
      },
      defaultAddons: { emptyKeg: 17.50 }
    }
  };

  function getDeckRate(productType, format, qty){
    var tiers = (DECK[productType]||{tiers:{}})[format] ||
                ((DECK[productType]||{}).tiers||{})[format];
    if(!tiers) return 0;
    for(var i=0;i<tiers.length;i++){
      if(qty >= tiers[i][0] && qty <= tiers[i][1]) return tiers[i][2];
    }
    return 0;
  }

  // Default packaging / pallet rates for a canning quote. Every value is
  // editable per quote in the add-on panel; these are the standing prices.
  //   nitrogen / pasteurization → per can
  //   tray + case erector       → per case (24 cans)
  //   pallet + pallet wrap      → per pallet (casesPerPallet cases each)
  // Read a DB-backed price (pricing_settings, loaded by src/modules/invoicing/pricing-settings.js)
  // with a hard-coded fallback so quoting still works if the table is unreachable.
  function px(key, fallback){
    return (typeof window !== 'undefined' && typeof window.glPrice === 'function')
      ? window.glPrice(key, fallback) : fallback;
  }

  // Cans are priced by size, so the blank-can / shrink-label / printed-can rate
  // depends on the format being quoted. Map the selected canning format to the
  // right pricing_settings key. Printed is only defined for 12oz today.
  function canKeyFor(type, format){
    var f = String(format || ''), is16 = /16/.test(f), sleek = /sleek/i.test(f);
    if(type === 'blank')   return is16 ? 'can_blank_16std_per_unit'  : (sleek ? 'can_blank_12sleek_per_unit'  : 'can_blank_12std_per_unit');
    if(type === 'shrink')  return is16 ? 'can_shrink_16_per_unit'    : (sleek ? 'can_shrink_12sleek_per_unit' : 'can_shrink_12std_per_unit');
    if(type === 'printed') return is16 ? null : 'can_printed_12_per_unit';
    return null;
  }
  function canRate(type, format){
    var k = canKeyFor(type, format);
    return k ? px(k, 0) : 0;
  }
  function defaultCanningPkg(format){
    format = format || '12oz Sleek';
    return {
      nitrogenOn:true,   nitrogenPerCan:px('nitrogen_per_can',0.03),
      pasteurOn:false,   pasteurPerCan:px('pasteurization_per_can',0.05),
      // Case trays: 24-count is the default; check 12-count instead for that job.
      tray24On:true,     tray24PerCase:px('case_tray_24_per_case',0.50),
      tray12On:false,    tray12PerCase:px('case_tray_12_per_case',0.50),
      trayWrapOn:false,  trayWrapPerCase:px('case_tray_shrinkwrap_per_case',0),
      // Carriers — pick the one the client is using (off by default).
      paktech4On:false,  paktech4PerCan:px('paktech_4pack_per_can',0),
      paktech6On:false,  paktech6PerCan:px('paktech_6pack_per_can',0),
      proper4On:false,   proper4PerCan:px('proper_pack_4pack_per_can',0),
      proper6On:false,   proper6PerCan:px('proper_pack_6pack_per_can',0),
      // Cans (pass-through) — off by default; priced by the format being quoted.
      canBlankOn:false,   canBlankPerCan:canRate('blank', format),
      canShrinkOn:false,  canShrinkPerCan:canRate('shrink', format),
      canPrintedOn:false, canPrintedPerCan:canRate('printed', format),
      palletOn:true,     palletEach:px('pallet_each',12),
      palletWrapOn:true, palletWrapEach:px('pallet_wrap_each',8),  casesPerPallet:px('cases_per_pallet',80)
    };
  }

  // canningExtras / bottlingExtras / isNum lived here. They computed a whole
  // run total for one VOLUME TIER — per-can rate plus per-case packaging plus
  // pallets, with per-cell manual overrides. A quote is a list of lines now,
  // each priced as quantity times unit price, so the tier engine had no
  // callers left. Deleted rather than kept: a pricing engine that still looks
  // authoritative but is wired to nothing is a trap for whoever reads this
  // next. The rates it used are still the source for insertDeckLines().

  // Bottling packaging defaults (per bottle / per case / per pallet). Same
  // DB-backed pattern as canning; a 6-pack case counts as one "case".
  function defaultBottlingPkg(){
    return {
      pasteurOn:false,  pasteurPerBtl:px('bottling_pasteurization_per_btl',0.20),
      otlOn:false,      otlPerBtl:px('bottling_otl_per_btl',0.20),
      labelsOn:false,   labelsPerBtl:px('bottling_labels_per_btl',0.06),
      caseOn:true,      casePerCase:px('bottling_case_6pack_per_case',0),
      palletOn:true,    palletEach:px('pallet_each',12),
      palletWrapOn:true, palletWrapEach:px('pallet_wrap_each',8),
      casesPerPallet:px('bottling_cases_per_pallet',50)
    };
  }

  var CANNING_INCLUSIONS = [
    'Production labor and line supervision',
    'Standard batching and blending',
    'Can filling and seaming',
    'PakTech application and packing',
    'Palletizing and stretch wrapping (labor)',
    'Standard CIP, sanitation, and changeovers',
    'Routine quality checks and normal utilities'
  ];
  var BOTTLING_INCLUSIONS = [
    'Automatic filling','Corking','Palletizing',
    'Tamper-evident shrink sleeving','Case and insert building'
  ];
  var KEG_INCLUSIONS = ['Automatic filling','Purging and sealing','CO₂ or Nitrogen','Palletizing'];

  function inclusionsForType(t){
    return t==='bottling' ? BOTTLING_INCLUSIONS : t==='keg' ? KEG_INCLUSIONS : CANNING_INCLUSIONS;
  }

  var CANNING_TERMS = [
    '<b>Ingredients:</b> Ingredient costs are not included and will be provided after we review your formula.',
    '<b>Mixed Stock Keeping Units:</b> Stock Keeping Units may be combined to reach a volume pricing tier.',
    '<b>Changeover Fee:</b> A $125 changeover fee applies per product changeover, depending on the products being run.',
    '<b>Materials:</b> Pricing above covers fill and services only. Cans, ingredients, and PakTech handles are quoted separately.',
    '<b>Pricing:</b> Pricing is subject to change based on specific formulation requirements.'
  ];
  var BOTTLING_TERMS = [
    '<b>Materials:</b> Fees do not include raw materials, exception tape for cases, or pallet stretch wrap.',
    '<b>Labels:</b> Over-the-top labels and front/back labels are quoted separately.',
    '<b>Pricing:</b> Pricing is subject to change based on specific formulation requirements.'
  ];
  var KEG_TERMS = [
    '<b>Empty Keg:</b> $17.50/keg for the one-way PET keg (optional — priced separately).',
    '<b>Gas/Materials:</b> Fees do not include the empty keg, gas, or raw materials.',
    '<b>Minimum Order:</b> 40 kegs.'
  ];
  function termsForType(t){
    return t==='bottling' ? BOTTLING_TERMS : t==='keg' ? KEG_TERMS : CANNING_TERMS;
  }

  /* ── Quote number ─────────────────────────────────────────────
     quotes.quote_number is UNIQUE, so the number must be allocated by the
     database, not by a per-device counter — two browsers would eventually
     mint the same one and the second save would be rejected.
     gl_next_quote_number() allocates atomically and is called only at save
     time, so opening the builder and walking away burns no numbers. ── */
  async function allocQuoteNumber(sb){
    try {
      var r = await sb.rpc('gl_next_quote_number');
      if(r && !r.error && r.data) return String(r.data);
    } catch(e){}
    return null;
  }

  /* ── Formatters ─────────────────────────────────────────────── */
  function fmtUsd(n){ return '$' + Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function fmtNum(n){ return Number(n||0).toLocaleString('en-US'); }
  function today(){ return new Date().toISOString().slice(0,10); }
  function addDays(date, days){
    var d = new Date(date); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10);
  }
  function fmtDate(iso){
    if(!iso) return '';
    var d = new Date(iso+'T00:00:00');
    return d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  }

  /* ── Shared styles ──────────────────────────────────────────── */
  var INP  = 'width:100%;padding:8px 10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;font-size:13px;font-family:var(--ff-body);box-sizing:border-box';
  var LBL  = 'font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:5px';
  // Styles for the custom-line tables. Deliberately module scope: the TH/TD
  // pair inside the modal closure is assigned part-way down that function, so
  // a renderer that runs earlier would read undefined and emit a broken style.
  var QTH   = 'background:#0a1628;color:#9aa7bd;font-size:10px;letter-spacing:1.5px;padding:8px 10px;text-align:left;white-space:nowrap';
  var QTD   = 'padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);color:#fff';
  var QCELL = 'padding:5px 6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:4px;color:#fff;font-size:12px;box-sizing:border-box';
  var OVER = 'position:fixed;inset:0;z-index:950;background:rgba(6,13,26,.9);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto';

  /* ── Modal ──────────────────────────────────────────────────── */
  window.glOpenQuoteBuilder = function(clientId, dealId, opts){
    if(!window.currentUser || window.currentUser.role !== 'admin'){
      alert('Admin only.');
      return;
    }
    // Make sure the DB-backed prices are cached so the packaging/keg defaults
    // reflect any edits made in the "💲 Prices" editor. The cache is also
    // refreshed live whenever a price is saved there.
    if(typeof window.glLoadPricingSettings === 'function') window.glLoadPricingSettings();
    opts = opts || {};
    var prior = document.getElementById('gl-qb-modal');
    if(prior) prior.remove();

    var client  = (window.clients||[]).find(function(c){ return c.id===clientId; }) || {};
    var host    = document.getElementById('crm-panel') || document.body;
    var todayDate = today();

    var ov = document.createElement('div');
    ov.id  = 'gl-qb-modal';
    ov.setAttribute('style', OVER);

    ov.innerHTML =
      '<div style="background:#0d1f35;border:1px solid rgba(26,111,255,.25);border-radius:16px;width:100%;max-width:900px;padding:28px;margin:auto">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:22px">' +
          '<div>' +
            '<div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:2.5px;color:#1a6fff">📋 PRODUCTION QUOTE BUILDER</div>' +
            '<div style="font-size:11px;color:var(--muted);margin-top:2px">Admin only — generates and saves production quotes</div>' +
          '</div>' +
          '<button id="gl-qb-close" class="cbtn" style="font-size:18px;padding:4px 12px">&times;</button>' +
        '</div>' +

        /* ── Row 1: Client / Quote info ── */
        '<datalist id="gl-qb-clients-list">' +
          (window.clients||[]).map(function(c){ return '<option value="'+esc(c.name||'')+'">'; }).join('') +
        '</datalist>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 120px 80px;gap:12px;margin-bottom:18px">' +
          '<div><div style="'+LBL+'">PREPARED FOR</div>' +
            '<input id="gl-qb-client-name" list="gl-qb-clients-list" placeholder="Type company name…" style="'+INP+'" value="'+esc(opts.prefillCompany||client.name||'')+'">' +
          '</div>' +
          '<div><div style="'+LBL+'">EMAIL</div>' +
            '<input id="gl-qb-client-email" type="email" placeholder="contact@brand.com" style="'+INP+'" value="'+esc(opts.prefillEmail||client.email||'')+'">' +
          '</div>' +
          '<div><div style="'+LBL+'">QUOTE NUMBER</div>' +
            '<input id="gl-qb-num" placeholder="Assigned on save" style="'+INP+'">' +
          '</div>' +
          '<div><div style="'+LBL+'">QUOTE DATE</div>' +
            '<input id="gl-qb-date" type="date" style="'+INP+'" value="'+todayDate+'">' +
          '</div>' +
          '<div><div style="'+LBL+'">VALID (DAYS)</div>' +
            '<input id="gl-qb-valid" type="number" style="'+INP+'" value="30" min="1" max="180">' +
          '</div>' +
        '</div>' +

        /* ── Rate card → lines ──
           A quote is a LIST OF LINES now, like an invoice: description,
           quantity, unit, unit price, amount, and a total at the bottom. The
           customer can see where the number comes from, and two SKUs simply
           add up instead of reading as the same option printed twice.

           This panel is a generator, not the document. Pick a format and a
           volume, tick what applies, and it inserts the priced lines the
           rate card produces — fill, nitrogen, trays, cans, pallets. Run it
           again for a second SKU or a second size and those lines append.
           Every inserted line is then editable like any other. */
        '<div style="'+LBL+'">ADD LINES FROM THE RATE CARD</div>' +
        '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:14px;margin-bottom:18px">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr 130px auto;gap:12px;align-items:end">' +
            '<div><div style="'+LBL+'">PRODUCT TYPE</div>' +
              '<select id="gl-qb-type" style="'+INP+'">' +
                '<option value="canning">Canning</option>' +
                '<option value="bottling">Bottling (750ml)</option>' +
                '<option value="keg">Keg Filling</option>' +
              '</select>' +
            '</div>' +
            '<div><div style="'+LBL+'">PACKAGE FORMAT</div>' +
              /* An editable combobox, not a dropdown. The presets carry
                 size-specific can rates, but quoting a format that is not on
                 the list is an ordinary thing to want and the <select> made
                 it impossible. Type anything: the preset can-rates simply
                 stop applying, and every inserted price stays editable. */
              '<input id="gl-qb-fmt" list="gl-qb-fmt-list" autocomplete="off" placeholder="Pick one, or type your own…" style="'+INP+'">' +
              '<datalist id="gl-qb-fmt-list"></datalist>' +
            '</div>' +
            '<div><div id="gl-qb-vol-label" style="'+LBL+'">CASES</div>' +
              '<input id="gl-qb-vol" type="number" min="1" step="1" value="200" style="'+INP+'">' +
            '</div>' +
            '<div><button id="gl-qb-insert" class="cbtn pri" style="font-size:12.5px;padding:9px 16px;white-space:nowrap">↓ Insert lines</button></div>' +
          '</div>' +
          '<div id="gl-qb-addons" style="margin-top:14px"></div>' +
        '</div>' +

        /* ── The document itself ── */
        '<div id="gl-qb-lines" style="margin-bottom:18px"></div>' +

        /* ── Notes ── */
        /* ── Client request from website ── */
        (opts.dealNotes ? (
          '<div style="margin-bottom:18px">' +
            '<div style="'+LBL+'">CLIENT REQUEST (from website submission)</div>' +
            '<div style="padding:12px 14px;background:rgba(245,200,66,.05);border:1px solid rgba(245,200,66,.2);border-left:3px solid #f5c842;border-radius:0 8px 8px 0;font-size:12.5px;color:#cfd9e6;line-height:1.7;white-space:pre-wrap;max-height:120px;overflow-y:auto">'+esc(opts.dealNotes)+'</div>' +
          '</div>'
        ) : '') +

        /* ── Email body preview / editor ── */
        '<div style="margin-bottom:18px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">' +
            '<div style="'+LBL+'">EMAIL TO CLIENT (editable before sending)</div>' +
          '</div>' +
          '<textarea id="gl-qb-email-body" rows="9" style="'+INP+';resize:vertical;font-size:12.5px;line-height:1.7"></textarea>' +
        '</div>' +

        '<div style="'+LBL+'">INTERNAL NOTES / TERMS OVERRIDE (optional)</div>' +
        '<textarea id="gl-qb-notes" rows="2" placeholder="Leave blank to use standard terms…" style="'+INP+';resize:vertical;margin-bottom:20px"></textarea>' +

        /* ── Footer buttons ── */
        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
          '<button id="gl-qb-save" class="cbtn pri" style="flex:1;min-width:120px">💾 Save</button>' +
          '<button id="gl-qb-pdf" class="cbtn" style="flex:1;min-width:120px;background:rgba(26,111,255,.1);border-color:rgba(26,111,255,.4);color:#6b9fff">📄 PDF</button>' +
          '<button id="gl-qb-save-pdf" class="cbtn" style="flex:1;min-width:140px;background:rgba(29,158,117,.1);border-color:rgba(29,158,117,.4);color:#5fcf9e">💾 Save + PDF</button>' +
          '<button id="gl-qb-send-email" class="cbtn" style="flex:2;min-width:180px;background:rgba(245,200,66,.1);border-color:rgba(245,200,66,.4);color:#f5c842">📧 Save + Email Quote</button>' +
        '</div>' +
        '<div id="gl-qb-status" style="font-size:11px;color:var(--muted);margin-top:10px;min-height:16px"></div>' +
      '</div>';

    host.appendChild(ov);

    /* ── Pre-fill email body textarea ── */
    var emailBodyEl = ov.querySelector('#gl-qb-email-body');
    if(emailBodyEl){
      var greetName = opts.contactName || opts.prefillCompany || 'there';

      /* Product type label */
      var ptLabel = opts.productType === 'bottling' ? 'bottle filling'
                  : opts.productType === 'keg'      ? 'keg filling'
                  : 'canning';

      /* Specific request line referencing volume + product type */
      var requestLine;
      if(opts.suggestCases && opts.productType){
        requestLine = 'Based on your request for approximately ' + opts.suggestCases +
          ' cases of ' + ptLabel + ' services, we\'ve put together a tailored production quote for your review.';
      } else if(opts.productType){
        requestLine = 'Based on your inquiry about ' + ptLabel +
          ' services, we\'ve prepared a production quote tailored to your project.';
      } else {
        requestLine = 'We\'ve reviewed your request and prepared a tailored production quote for your review.';
      }

      /* If notes exist, acknowledge the specifics they mentioned */
      var notesAck = opts.dealNotes
        ? ' We\'ve gone through your project details and our pricing reflects what you\'re looking for — but we\'re happy to adjust volumes, formats, or add-ons to better fit your needs.'
        : '';

      emailBodyEl.value =
        'Hi ' + greetName + ',\n\n' +
        'Thank you for reaching out to Good Liquid Beverage Co. ' + requestLine + notesAck + '\n\n' +
        'Please find your production quote attached. A detailed pricing summary is included at the bottom of this email for quick reference.\n\n' +
        'We\'d love to schedule a call to walk you through the details and discuss your project further. Just reply here with a few times that work for you and we\'ll make it happen.\n\n' +
        'Looking forward to working together!\n\n' +
        'Best,\nMike Krail\nGood Liquid Beverage Co.\nmike@goodliquidbevco.com';
    }

    /* ── Local state ──
       lines IS the quote. productType / format / pkg / bpkg are the rate-card
       settings the generator reads when it inserts lines. They are not the
       document, so changing them afterwards does not silently reprice a line
       already on it. */
    var state = {
      lines: [],
      productType: 'canning',
      format: '12oz Sleek',
      pkg: defaultCanningPkg(),
      bpkg: defaultBottlingPkg(),
      savedId: null
    };

    // The volume box means cases for cans and bottles, and kegs for kegs.
    function updateVolLabel(){
      var lab = ov.querySelector('#gl-qb-vol-label');
      if(lab) lab.textContent = (state.productType === 'keg') ? 'KEGS' : 'CASES';
    }

    /* ── Wire close ── */
    ov.querySelector('#gl-qb-close').addEventListener('click', function(){ ov.remove(); });
    ov.addEventListener('click', function(e){ if(e.target===ov) ov.remove(); });

    /* ── Product type → format options ── */
    var typeEl = ov.querySelector('#gl-qb-type');
    var fmtEl  = ov.querySelector('#gl-qb-fmt');
    function rebuildFormats(){
      var t = typeEl.value;
      state.productType = t;
      var fmts = DECK[t].formats;
      // Suggestions now, not the only choices — they populate the datalist and
      // the field itself stays free text.
      var dl = ov.querySelector('#gl-qb-fmt-list');
      if(dl) dl.innerHTML = fmts.map(function(f){ return '<option value="'+esc(f)+'">'; }).join('');
      fmtEl.value = fmts[0];
      state.format = fmts[0];
      applyCanRates();
      rebuildAddons();
      updateVolLabel();
    }
    // Re-point the blank-can / shrink-label / printed-can rates at the current
    // format's prices (they are size-specific). Preserves the on/off toggles.
    function applyCanRates(){
      if(!state.pkg) return;
      state.pkg.canBlankPerCan   = canRate('blank',   state.format);
      state.pkg.canShrinkPerCan  = canRate('shrink',  state.format);
      state.pkg.canPrintedPerCan = canRate('printed', state.format);
    }
    // Switching product type re-points the rate card. It deliberately does NOT
    // touch lines already on the quote: those are priced and agreed, and a quote
    // that silently emptied itself when you reached for a second format would be
    // worse than the problem it solves.
    typeEl.addEventListener('change', function(){ rebuildFormats(); });
    // 'input' as well as 'change': a typed format has to take effect while you
    // are typing it, not only once focus leaves the field.
    ['change','input'].forEach(function(evt){
      fmtEl.addEventListener(evt, function(){
        state.format = fmtEl.value;
        applyCanRates(); rebuildAddons();
      });
    });
    rebuildFormats();

    // The packaging/add-on defaults are read synchronously from the price cache;
    // if the cache was cold when the builder opened, re-pull the DB prices and
    // refresh so the very first quote of a session never uses stale fallbacks.
    if(typeof window.glLoadPricingSettings === 'function'){
      window.glLoadPricingSettings().then(function(){
        if(!document.body.contains(ov)) return;   // builder was closed
        state.pkg  = defaultCanningPkg(state.format);
        state.bpkg = defaultBottlingPkg();
        rebuildAddons();
      }).catch(function(){});
    }

    /* ── Auto-select product type from deal ── */
    if(opts.productType && DECK[opts.productType]){
      typeEl.value = opts.productType;
      rebuildFormats();
    }

    /* ── Auto-select package format from notes (e.g. "16oz Sleek", "12oz Standard") ── */
    if(opts.dealNotes){
      var fmtOpts = Array.from(fmtEl.options).map(function(o){ return o.value; });
      var pickedFmt = null;
      if(/32\s*oz|crowler/i.test(opts.dealNotes))       pickedFmt = fmtOpts.find(function(f){ return /32/i.test(f); });
      else if(/19\.2\s*oz/i.test(opts.dealNotes))       pickedFmt = fmtOpts.find(function(f){ return /19/i.test(f); });
      else if(/16\s*oz/i.test(opts.dealNotes))          pickedFmt = fmtOpts.find(function(f){ return /16/i.test(f); });
      else if(/8\s*oz/i.test(opts.dealNotes))           pickedFmt = fmtOpts.find(function(f){ return /^8/i.test(f); });
      else if(/slim/i.test(opts.dealNotes))             pickedFmt = fmtOpts.find(function(f){ return /slim/i.test(f); });
      else if(/standard/i.test(opts.dealNotes))         pickedFmt = fmtOpts.find(function(f){ return /standard/i.test(f); });
      else if(/sleek/i.test(opts.dealNotes))            pickedFmt = fmtOpts.find(function(f){ return /sleek/i.test(f); });
      else if(/12\s*oz/i.test(opts.dealNotes))          pickedFmt = fmtOpts.find(function(f){ return /12/i.test(f); });
      if(pickedFmt){ fmtEl.value = pickedFmt; state.format = pickedFmt; }
    }

    /* ── Volume from the deal ──
       Seeds the generator's volume box rather than building a tier table.
       When the website form offered several volumes we take the first: those
       were alternatives to choose between, and a line-item quote prices what
       the customer is actually buying. Insert again for another volume. */
    var suggestedVol = (opts.suggestCasesList && opts.suggestCasesList.length)
      ? opts.suggestCasesList[0]
      : (opts.suggestCases || null);
    if(suggestedVol){
      var volSeed = ov.querySelector('#gl-qb-vol');
      if(volSeed) volSeed.value = suggestedVol;
    }

    /* ── Add-ons ── */
    function rebuildAddons(){
      var t = state.productType;
      var el = ov.querySelector('#gl-qb-addons');
      if(t === 'canning'){
        var P = state.pkg || (state.pkg = defaultCanningPkg());
        el.innerHTML =
          '<div style="'+LBL+'">ADD-ON SERVICES &amp; PACKAGING</div>' +
          '<div style="font-size:11px;color:#6b87ad;margin:-4px 0 8px">Check what applies to this run — each is priced from the “💲 Prices” settings and added to the tier totals below.</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:10px">' +
            addonToggle('gl-qb-nitrogen','Nitrogen Dosing', P.nitrogenPerCan.toFixed(2),'per can') +
            addonToggle('gl-qb-pasteur','Batch Flash Pasteurization', P.pasteurPerCan.toFixed(2),'per can') +
            addonToggle('gl-qb-tray24','24-count Case Tray', P.tray24PerCase.toFixed(2),'per case') +
            addonToggle('gl-qb-tray12','12-count Case Tray', P.tray12PerCase.toFixed(2),'per case') +
            addonToggle('gl-qb-traywrap','Shrink-wrap Case Tray', P.trayWrapPerCase.toFixed(2),'per case') +
            addonToggle('gl-qb-paktech4','PakTech Handle — 4-pack', P.paktech4PerCan.toFixed(2),'per can') +
            addonToggle('gl-qb-paktech6','PakTech Handle — 6-pack', P.paktech6PerCan.toFixed(2),'per can') +
            addonToggle('gl-qb-proper4','Proper Pack — 4-pack', P.proper4PerCan.toFixed(2),'per can') +
            addonToggle('gl-qb-proper6','Proper Pack — 6-pack', P.proper6PerCan.toFixed(2),'per can') +
            addonToggle('gl-qb-canblank','Blank / Brite Can', P.canBlankPerCan.toFixed(2),'per can') +
            addonToggle('gl-qb-canshrink','Shrink-Sleeve Label', P.canShrinkPerCan.toFixed(2),'per can') +
            addonToggle('gl-qb-canprinted','Pre-Printed Can', P.canPrintedPerCan.toFixed(2),'per can') +
            addonToggle('gl-qb-pallet','Pallet', P.palletEach.toFixed(2),'per pallet') +
            addonToggle('gl-qb-palletwrap','Pallet Shrink Wrap', P.palletWrapEach.toFixed(2),'per pallet') +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:10px;align-items:center;font-size:12px;color:#9aa7bd">' +
            '<label style="display:flex;align-items:center;gap:6px">Cases per pallet' +
              '<input id="gl-qb-cpp" type="number" min="1" step="1" value="'+(P.casesPerPallet||80)+'" style="width:70px;padding:4px 6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:4px;color:#fff"></label>' +
          '</div>';
        // Reflect current on/off state onto the checkboxes and wire changes.
        var canningMap = [
          ['gl-qb-nitrogen', 'nitrogenOn', 'nitrogenPerCan'],
          ['gl-qb-pasteur',  'pasteurOn',  'pasteurPerCan'],
          ['gl-qb-tray24',   'tray24On',   'tray24PerCase'],
          ['gl-qb-tray12',   'tray12On',   'tray12PerCase'],
          ['gl-qb-traywrap', 'trayWrapOn', 'trayWrapPerCase'],
          ['gl-qb-paktech4', 'paktech4On', 'paktech4PerCan'],
          ['gl-qb-paktech6', 'paktech6On', 'paktech6PerCan'],
          ['gl-qb-proper4',  'proper4On',  'proper4PerCan'],
          ['gl-qb-proper6',  'proper6On',  'proper6PerCan'],
          ['gl-qb-canblank', 'canBlankOn', 'canBlankPerCan'],
          ['gl-qb-canshrink','canShrinkOn','canShrinkPerCan'],
          ['gl-qb-canprinted','canPrintedOn','canPrintedPerCan'],
          ['gl-qb-pallet',   'palletOn',   'palletEach'],
          ['gl-qb-palletwrap','palletWrapOn','palletWrapEach']
        ];
        canningMap.forEach(function(m){
          var cb = el.querySelector('#'+m[0]+'-on'), rt = el.querySelector('#'+m[0]+'-rate');
          if(cb){ cb.checked = !!P[m[1]]; cb.addEventListener('change', function(){ P[m[1]] = cb.checked; }); }
          if(rt){ rt.addEventListener('input', function(){ P[m[2]] = parseFloat(rt.value)||0; }); }
        });
        var cpp = el.querySelector('#gl-qb-cpp');
        if(cpp) cpp.addEventListener('input', function(){ P.casesPerPallet = parseInt(cpp.value,10)||80; });
      } else if(t === 'bottling'){
        var B = state.bpkg || (state.bpkg = defaultBottlingPkg());
        el.innerHTML =
          '<div style="'+LBL+'">ADD-ON SERVICES &amp; PACKAGING</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:10px">' +
            addonToggle('gl-qb-bfp','Batch Flash Pasteurization', B.pasteurPerBtl.toFixed(2),'per bottle') +
            addonToggle('gl-qb-otl','Over the Top Labels', B.otlPerBtl.toFixed(2),'per bottle') +
            addonToggle('gl-qb-labels','Labels Applied Front & Back', B.labelsPerBtl.toFixed(2),'per bottle') +
            addonToggle('gl-qb-bcase','6-pack Bottle Case', B.casePerCase.toFixed(2),'per case') +
            addonToggle('gl-qb-bpallet','Pallet', B.palletEach.toFixed(2),'per pallet') +
            addonToggle('gl-qb-bpalletwrap','Pallet Shrink Wrap', B.palletWrapEach.toFixed(2),'per pallet') +
          '</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:10px;align-items:center;font-size:12px;color:#9aa7bd">' +
            '<label style="display:flex;align-items:center;gap:6px">Cases per pallet' +
              '<input id="gl-qb-bcpp" type="number" min="1" step="1" value="'+(B.casesPerPallet||50)+'" style="width:70px;padding:4px 6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:4px;color:#fff"></label>' +
          '</div>';
        var bottlingMap = [
          ['gl-qb-bfp',        'pasteurOn',   'pasteurPerBtl'],
          ['gl-qb-otl',        'otlOn',       'otlPerBtl'],
          ['gl-qb-labels',     'labelsOn',    'labelsPerBtl'],
          ['gl-qb-bcase',      'caseOn',      'casePerCase'],
          ['gl-qb-bpallet',    'palletOn',    'palletEach'],
          ['gl-qb-bpalletwrap','palletWrapOn','palletWrapEach']
        ];
        bottlingMap.forEach(function(m){
          var cb = el.querySelector('#'+m[0]+'-on'), rt = el.querySelector('#'+m[0]+'-rate');
          if(cb){ cb.checked = !!B[m[1]]; cb.addEventListener('change', function(){ B[m[1]] = cb.checked; }); }
          if(rt){ rt.addEventListener('input', function(){ B[m[2]] = parseFloat(rt.value)||0; }); }
        });
        var bcpp = el.querySelector('#gl-qb-bcpp');
        if(bcpp) bcpp.addEventListener('input', function(){ B.casesPerPallet = parseInt(bcpp.value,10)||50; });
      } else {
        el.innerHTML =
          '<div style="'+LBL+'">ADD-ON SERVICES</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:10px">' +
            addonToggle('gl-qb-empty-keg','Empty One-Way Keg','17.50','per keg') +
          '</div>';
        el.querySelector('#gl-qb-empty-keg-on').checked = true;
      }
    }

    /* ── THE QUOTE DOCUMENT ──────────────────────────────────────
       A quote is a list of lines: description, quantity, unit, unit price,
       amount — and a total. The same shape as an invoice, for the same
       reason: the customer can see where the number comes from.

       This replaced a table of VOLUME TIERS, where every row was an
       alternative the customer chose between and nothing ever summed. Two
       SKUs at the same volume were impossible to express that way: they read
       as one option printed twice. As lines they simply add up.

       MONEY IS COMPUTED IN WHOLE CENTS. Amount is quantity times unit price
       rounded to the cent, and the total sums those rounded amounts as
       integers. Binary floats put 5341.599999999999 on a real invoice; what
       is printed has to add up exactly to what is shown. */
    function money(n){ return Math.round((Number(n) || 0) * 100) / 100; }
    function centsOf(n){ return Math.round((Number(n) || 0) * 100); }
    function lineAmount(l){ return money((Number(l.qty) || 0) * (Number(l.unitPrice) || 0)); }
    function quoteTotal(){
      var c = (state.lines || []).reduce(function(a, l){ return a + centsOf(lineAmount(l)); }, 0);
      return c / 100;
    }

    function renderLines(){
      var host = ov.querySelector('#gl-qb-lines'); if(!host) return;
      var rows = (state.lines || []).map(function(l, i){
        return '<tr>' +
          '<td style="'+QTD+'"><input data-ln="'+i+'" data-f="desc" value="'+esc(l.desc || '')+'" placeholder="Description" style="'+QCELL+';width:100%;min-width:220px"></td>' +
          '<td style="'+QTD+'"><input data-ln="'+i+'" data-f="qty" type="number" step="any" value="'+esc(l.qty == null ? '' : l.qty)+'" style="'+QCELL+';width:90px"></td>' +
          '<td style="'+QTD+'"><input data-ln="'+i+'" data-f="unit" value="'+esc(l.unit || '')+'" placeholder="each" style="'+QCELL+';width:80px"></td>' +
          '<td style="'+QTD+'"><input data-ln="'+i+'" data-f="unitPrice" type="number" step="0.01" value="'+esc(l.unitPrice == null ? '' : l.unitPrice)+'" style="'+QCELL+';width:100px"></td>' +
          '<td style="'+QTD+';color:#00e5c0;font-weight:700;white-space:nowrap" data-amt="'+i+'">'+fmtUsd(lineAmount(l))+'</td>' +
          '<td style="'+QTD+'"><button data-del="'+i+'" title="Remove line" style="background:none;border:none;color:#ff8579;cursor:pointer;font-size:16px">&times;</button></td>' +
        '</tr>';
      }).join('');

      host.innerHTML =
        '<div style="'+LBL+'">LINE ITEMS</div>' +
        (state.lines.length
          ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:640px">' +
              '<thead><tr>' +
                '<th style="'+QTH+'">Description</th><th style="'+QTH+'">Qty</th><th style="'+QTH+'">Unit</th>' +
                '<th style="'+QTH+'">Unit Price</th><th style="'+QTH+'">Amount</th><th style="'+QTH+'"></th>' +
              '</tr></thead><tbody>' + rows + '</tbody></table></div>'
          : '<div style="font-size:12px;color:var(--muted);padding:10px 0">No lines yet. Insert them from the rate card above, or add one by hand.</div>') +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:10px;flex-wrap:wrap">' +
          '<button id="gl-qb-add-line" class="cbtn" style="font-size:12px;padding:6px 14px">+ Add Line</button>' +
          '<div style="font-size:15px;font-weight:800;color:#fff">Total <span id="gl-qb-total" style="color:#00e5c0;margin-left:10px">'+fmtUsd(quoteTotal())+'</span></div>' +
        '</div>';

      host.querySelectorAll('[data-ln]').forEach(function(inp){
        inp.addEventListener('input', function(){
          var l = state.lines[parseInt(inp.getAttribute('data-ln'), 10)]; if(!l) return;
          var f = inp.getAttribute('data-f');
          l[f] = (f === 'qty' || f === 'unitPrice') ? (parseFloat(inp.value) || 0) : inp.value;
          // Patch the two cells that changed rather than re-rendering: a full
          // re-render on every keystroke drops focus in the middle of a word.
          var amt = host.querySelector('[data-amt="' + inp.getAttribute('data-ln') + '"]');
          if(amt) amt.textContent = fmtUsd(lineAmount(l));
          var tot = host.querySelector('#gl-qb-total');
          if(tot) tot.textContent = fmtUsd(quoteTotal());
        });
      });
      host.querySelectorAll('[data-del]').forEach(function(btn){
        btn.addEventListener('click', function(){
          state.lines.splice(parseInt(btn.getAttribute('data-del'), 10), 1);
          renderLines();
        });
      });
      var addBtn = host.querySelector('#gl-qb-add-line');
      if(addBtn) addBtn.addEventListener('click', function(){
        state.lines.push({ desc:'', qty:1, unit:'each', unitPrice:0 });
        renderLines();
        var all = host.querySelectorAll('[data-f="desc"]');
        if(all.length) all[all.length - 1].focus();
      });
    }

    /* ── Rate card to lines ────────────────────────────────────────
       Everything the old tier table priced, emitted as ordinary editable
       lines. Run it once per SKU or per size; the lines append, so a quote
       for two SKUs is two passes and the total covers both. */
    function insertDeckLines(){
      var st = ov.querySelector('#gl-qb-status');
      var t = state.productType, fmt = state.format || '';
      var vol = parseInt((ov.querySelector('#gl-qb-vol') || {}).value, 10) || 0;
      if(vol <= 0){
        if(st){ st.style.color = '#ff8579'; st.textContent = 'Enter how many ' + (t === 'keg' ? 'kegs' : 'cases') + ' first.'; }
        return;
      }
      var added = 0;
      function add(desc, qty, unit, price){
        // A zero-priced or zero-quantity line is noise on a customer-facing
        // document: it reads as free rather than as not applicable. Add one by
        // hand if you do want it shown.
        if(!(qty > 0) || !(price > 0)) return;
        state.lines.push({ desc: desc, qty: qty, unit: unit, unitPrice: money(price) });
        added++;
      }
      var label = fmt ? ' — ' + fmt : '';

      if(t === 'canning'){
        var P = state.pkg || {};
        var cans = vol * CANS_PER_CASE;
        add('Canning' + label, cans, 'can', autoRate(vol));
        if(P.nitrogenOn)   add('Nitrogen dosing' + label, cans, 'can', P.nitrogenPerCan);
        if(P.pasteurOn)    add('Batch flash pasteurization' + label, cans, 'can', P.pasteurPerCan);
        if(P.paktech4On)   add('PakTech handle, 4-pack' + label, cans, 'can', P.paktech4PerCan);
        if(P.paktech6On)   add('PakTech handle, 6-pack' + label, cans, 'can', P.paktech6PerCan);
        if(P.proper4On)    add('Proper Pack, 4-pack' + label, cans, 'can', P.proper4PerCan);
        if(P.proper6On)    add('Proper Pack, 6-pack' + label, cans, 'can', P.proper6PerCan);
        if(P.canBlankOn)   add('Blank / brite can' + label, cans, 'can', P.canBlankPerCan);
        if(P.canShrinkOn)  add('Shrink-sleeve label' + label, cans, 'can', P.canShrinkPerCan);
        if(P.canPrintedOn) add('Pre-printed can' + label, cans, 'can', P.canPrintedPerCan);
        if(P.tray24On)     add('24-count case tray' + label, vol, 'case', P.tray24PerCase);
        if(P.tray12On)     add('12-count case tray' + label, vol, 'case', P.tray12PerCase);
        if(P.trayWrapOn)   add('Shrink-wrap case tray' + label, vol, 'case', P.trayWrapPerCase);
        var cpp = P.casesPerPallet || 80;
        var pallets = (P.palletOn || P.palletWrapOn) && cpp > 0 ? Math.ceil(vol / cpp) : 0;
        if(P.palletOn)     add('Pallet' + label, pallets, 'pallet', P.palletEach);
        if(P.palletWrapOn) add('Pallet shrink wrap' + label, pallets, 'pallet', P.palletWrapEach);
      } else if(t === 'bottling'){
        var B = state.bpkg || {};
        var btls = vol * BTLS_PER_CASE;
        add('Bottling' + label, btls, 'bottle', autoRate(vol));
        if(B.pasteurOn) add('Batch flash pasteurization' + label, btls, 'bottle', B.pasteurPerBtl);
        if(B.otlOn)     add('Over-the-top labels' + label, btls, 'bottle', B.otlPerBtl);
        if(B.labelsOn)  add('Labels applied front and back' + label, btls, 'bottle', B.labelsPerBtl);
        if(B.caseOn)    add('6-pack bottle case' + label, vol, 'case', B.casePerCase);
        var bcpp = B.casesPerPallet || 50;
        var bpal = (B.palletOn || B.palletWrapOn) && bcpp > 0 ? Math.ceil(vol / bcpp) : 0;
        if(B.palletOn)     add('Pallet' + label, bpal, 'pallet', B.palletEach);
        if(B.palletWrapOn) add('Pallet shrink wrap' + label, bpal, 'pallet', B.palletWrapEach);
      } else {
        add('Keg filling labor', vol, 'keg', px('keg_fill_per_keg', 12));
        var emptyOn = ov.querySelector('#gl-qb-empty-keg-on');
        if(!emptyOn || emptyOn.checked){
          var r = ov.querySelector('#gl-qb-empty-keg-rate');
          add('Empty one-way keg', vol, 'keg', r ? (parseFloat(r.value) || 0) : px('empty_keg_per_keg', 17.50));
        }
      }

      renderLines();
      if(st){
        st.style.color = added ? '#5fcf9e' : '#ff8579';
        st.textContent = added
          ? added + ' line' + (added === 1 ? '' : 's') + ' added.'
          : 'Nothing to add. No rate applies at that volume, so check the format and the add-ons.';
      }
    }

    function addonToggle(id, label, defaultRate, unit){
      return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px 14px;min-width:180px;flex:1">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#fff">' +
          '<input type="checkbox" id="'+id+'-on" style="width:15px;height:15px;cursor:pointer"> ' +
          esc(label) +
        '</label>' +
        '<div style="display:flex;align-items:center;gap:6px;margin-top:6px">' +
          '<span style="font-size:11px;color:var(--muted)">$</span>' +
          '<input id="'+id+'-rate" type="number" step="0.01" min="0" value="'+defaultRate+'" style="width:80px;padding:5px 8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:4px;color:#fff;font-size:12px">' +
          '<span style="font-size:11px;color:var(--muted)">/ '+esc(unit)+'</span>' +
        '</div>' +
      '</div>';
    }

    /* ── Tier row rendering ── */
    function autoRate(cases){
      return getDeckRate(state.productType, state.format, cases);
    }


    var TH = 'background:#0a1628;color:#9aa7bd;font-size:10px;letter-spacing:1.5px;padding:8px 10px;text-align:left;white-space:nowrap';
    var TD = 'padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);color:#fff';
    var TDM = 'padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);color:#1a6fff;font-weight:700';


    /* ── Insert lines from the rate card ── */
    ov.querySelector('#gl-qb-insert').addEventListener('click', insertDeckLines);

    /* ── Build quote data from current form state ── */
    function buildQuoteData(){
      var productType  = ov.querySelector('#gl-qb-type').value;
      var packageFormat = ov.querySelector('#gl-qb-fmt').value;
      var quoteNumber  = ov.querySelector('#gl-qb-num').value.trim();
      var quoteDate    = ov.querySelector('#gl-qb-date').value;
      var validDays    = parseInt(ov.querySelector('#gl-qb-valid').value)||30;
      var notes        = ov.querySelector('#gl-qb-notes').value.trim();

      // Collect add-ons
      var addons = [];
      ov.querySelectorAll('[id$="-on"]').forEach(function(cb){
        if(!cb.checked) return;
        var base = cb.id.replace(/-on$/,'');
        var rateEl = ov.querySelector('#'+base+'-rate');
        if(!rateEl) return;
        var label = cb.parentElement.textContent.trim();
        addons.push({ id:base, label:label, rate:parseFloat(rateEl.value)||0 });
      });

      // The document: blank descriptions are dropped here rather than nagging
      // while you type, and every amount is recomputed from qty x price so a
      // saved quote can never disagree with what was on screen.
      var lines = (state.lines || [])
        .filter(function(l){ return String(l.desc || '').trim() || (Number(l.qty) && Number(l.unitPrice)); })
        .map(function(l){
          return {
            desc:      String(l.desc || ''),
            qty:       Number(l.qty) || 0,
            unit:      String(l.unit || ''),
            unitPrice: money(l.unitPrice),
            amount:    lineAmount(l)
          };
        });
      var total = money(lines.reduce(function(a, l){ return a + centsOf(l.amount); }, 0) / 100);

      return {
        lines:         lines,
        total:         total,
        clientId:      (function(){
          var typed = (ov.querySelector('#gl-qb-client-name')||{}).value||'';
          if(clientId) return clientId;
          var match = (window.clients||[]).find(function(c){ return c.name && c.name.toLowerCase()===typed.toLowerCase(); });
          return match ? match.id : null;
        })(),
        dealId:        dealId || null,
        savedId:       state.savedId,
        quoteNumber:   quoteNumber,
        quoteDate:     quoteDate,
        validDays:     validDays,
        // product_type and package_format are NOT NULL on the table and are
        // read by the quote history list and the deal panel, so they stay,
        // describing the rate card the lines were generated from.
        productType:   productType,
        packageFormat: packageFormat,
        tiers:         [],
        addons:        addons,
        pkg:           JSON.parse(JSON.stringify(state.pkg || {})),
        bpkg:          JSON.parse(JSON.stringify(state.bpkg || {})),
        inclusions:    inclusionsForType(productType),
        notes:         notes,
        clientName:    (ov.querySelector('#gl-qb-client-name')||{}).value || client.name || '',
        clientEmail:   (ov.querySelector('#gl-qb-client-email')||{}).value || client.email || '',
        contactName:   opts.contactName || ''
      };
    }

    // A quote needs at least one line. Nothing else is required: a quote made
    // entirely of hand-typed lines is an ordinary quote.
    function quoteHasContent(d){ return (d.lines || []).length > 0; }

    /* ── Save ── */
    async function doSave(){
      var sb  = window.supa;
      var st  = ov.querySelector('#gl-qb-status');
      if(!sb){ st.style.color='#ff8579'; st.textContent='Not connected.'; return null; }
      st.style.color='var(--muted)'; st.textContent='Saving…';
      var data = buildQuoteData();
      if(!quoteHasContent(data)){ st.style.color='#ff8579'; st.textContent='Add at least one line before saving.'; return null; }
      /* Take a number from the database now. Never fall back to a locally
         guessed one — quote_number is UNIQUE and a duplicate loses the save. */
      if(!data.quoteNumber){
        var assigned = await allocQuoteNumber(sb);
        if(!assigned){
          st.style.color='#ff8579';
          st.textContent='Could not get a quote number from the database — nothing was saved. Check your connection and try again.';
          return null;
        }
        data.quoteNumber = assigned;
        var numEl = ov.querySelector('#gl-qb-num'); if(numEl) numEl.value = assigned;
      }
      var row = {
        client_id:      data.clientId,
        deal_id:        data.dealId,
        quote_number:   data.quoteNumber,
        quote_date:     data.quoteDate,
        valid_days:     data.validDays,
        product_type:   data.productType,
        package_format: data.packageFormat,
        status:         'draft',
        tiers:          data.tiers,
        // Persist the packaging/pallet config alongside the toggle list so a
        // reopened quote can restore it. Kept inside the existing addons jsonb
        // array (id '__pkg__') to avoid a schema change; readers key by id.
        addons:         (data.addons||[]).concat([{ id:'__pkg__', pkg: data.pkg }]),
        // The document and its total. sections and custom_lines stay empty:
        // they were the previous shape, and older rows still carry them.
        line_items:     data.lines || [],
        total:          data.total,
        sections:       [],
        custom_lines:   [],
        inclusions:     data.inclusions,
        notes:          data.notes,
        pdf_html:       generateQuoteHTML(data)
      };
      var r;
      if(state.savedId){
        r = await sb.from('quotes').update(row).eq('id', state.savedId).select().single();
      } else {
        r = await sb.from('quotes').insert(row).select().single();
      }
      if(r.error){ st.style.color='#ff8579'; st.textContent='Save failed: '+r.error.message; return null; }
      state.savedId = r.data.id;
      st.style.color='#5fcf9e';
      st.textContent='✓ Saved as ' + data.quoteNumber;
      if(typeof window.glAudit==='function') window.glAudit('quote_saved', data.quoteNumber, { client:data.clientName, format:data.packageFormat });
      return r.data;
    }

    ov.querySelector('#gl-qb-save').addEventListener('click', doSave);

    ov.querySelector('#gl-qb-pdf').addEventListener('click', function(){
      var data = buildQuoteData();
      if(!quoteHasContent(data)){ ov.querySelector('#gl-qb-status').style.color='#ff8579'; ov.querySelector('#gl-qb-status').textContent='Add at least one line.'; return; }
      openPrintWindow(data);
    });

    ov.querySelector('#gl-qb-save-pdf').addEventListener('click', async function(){
      var saved = await doSave();
      if(!saved) return;
      openPrintWindow(buildQuoteData());
    });

    ov.querySelector('#gl-qb-send-email').addEventListener('click', async function(){
      var saved = await doSave();
      if(!saved) return;
      var data = buildQuoteData();
      var st   = ov.querySelector('#gl-qb-status');
      if(!data.clientEmail){ st.style.color='#ff8579'; st.textContent='Add an email address first.'; return; }
      st.style.color='var(--muted)'; st.textContent='Sending email…';

      var quoteHtml = generateQuoteHTML(data);
      var b64 = await htmlToPdfBase64(quoteHtml, st);

      var contact   = data.contactName || data.clientName || 'there';
      var validThru = fmtDate(addDays(data.quoteDate, data.validDays));
      // The in-email summary walks every format on the quote, not just the
      // first, and names each one when there is more than one. Custom lines
      // are listed too — they are real money and used to be invisible here.
      // The in-email summary is the same list the PDF shows, so the two can
      // never disagree. It used to walk volume tiers and omitted everything
      // else on the quote.
      var tierLines = (data.lines || []).map(function(l){
        var q = Number(l.qty) || 0;
        return '<li>' + esc(l.desc || '') + ' \u2014 ' + fmtNum(q) + (l.unit ? ' ' + esc(l.unit) : '') +
               ' at ' + fmtUsd(l.unitPrice) + ' = <b>' + fmtUsd(l.amount) + '</b></li>';
      }).join('') +
      '<li style="list-style:none;margin-left:-20px;padding-top:8px;font-weight:800;font-size:15px">Total ' + fmtUsd(data.total) + '</li>';

      /* Build email HTML from the editable textarea, then append auto-generated quote summary */
      var rawBody   = ((ov.querySelector('#gl-qb-email-body')||{}).value || '').trim();
      /* Split on blank lines for paragraphs; within each paragraph \n becomes <br> */
      var bodyHtml  = rawBody.split(/\n\n+/).map(function(para){
        return '<p style="margin:0 0 14px 0">' + para.split('\n').map(esc).join('<br>') + '</p>';
      }).join('');

      var emailHtml =
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#222;max-width:640px;line-height:1.7">' +
        bodyHtml +
        '<hr style="border:none;border-top:1px solid #ddd;margin:24px 0">' +
        '<p style="margin:0 0 6px 0;font-size:13px;color:#555"><strong>Quote Reference: '+esc(data.quoteNumber)+'</strong></p>' +
        '<ul style="margin:6px 0 10px 0;padding-left:22px;font-size:13px;color:#555">'+tierLines+'</ul>' +
        '<p style="margin:0;font-size:13px;color:#555"><strong>Package:</strong> '+esc(data.packageFormat)+'<br><strong>Valid through:</strong> '+validThru+'</p>' +
        '</div>';

      var sb   = window.supa;
      if(!sb){ st.style.color='#ff8579'; st.textContent='Not connected.'; return; }
      // Send the quote (with its PDF attachment) from the company Gmail via the
      // gmail-send Edge Function; fall back to mailgun-send only if Gmail errors.
      var _mail = {
        to:          data.clientEmail,
        subject:     'Good Liquid Production Quote — '+data.quoteNumber+' — '+data.clientName,
        html:        emailHtml,
        text:        'Hi '+contact+', please see the attached production quote '+data.quoteNumber+' for '+data.clientName+'. Valid through '+validThru+'. Reply to discuss details.',
        attachments: [{ filename:'GoodLiquid-'+data.quoteNumber+'.pdf', contentBase64:b64, contentType:'application/pdf' }]
      };
      var resp = await sb.functions.invoke('gmail-send', { body: _mail });
      if(resp.error || (resp.data && resp.data.ok===false)){
        resp = await sb.functions.invoke('mailgun-send', { body: _mail }); // fallback
      }

      if(resp.error || (resp.data && resp.data.ok===false)){
        st.style.color='#ff8579';
        st.textContent='Email failed — '+(resp.error ? resp.error.message : 'check email config.');
      } else {
        st.style.color='#5fcf9e';
        st.textContent='Quote emailed to '+data.clientEmail+' ✓';
      }
    });

    // Paint tabs, add-ons, tiers and custom lines for the opening section.
    // Runs last so the table styles declared further up this function are
    // assigned before any renderer reads them.
    // Paint the rate-card panel and the (empty) document. Runs last so the
    // table styles declared further up this function are assigned first.
    updateVolLabel();
    renderLines();
  };

  /* ── PDF HTML generation (Stiiizy-format) ───────────────────── */
  function generateQuoteHTML(data){
    // A quote carries one or more formats. Quotes saved before sections
    // existed have no array, so treat those as the single format their own
    // columns describe — every quote ever saved still renders.
    var validUntil = fmtDate(addDays(data.quoteDate, data.validDays));

    // Addons lookup (kept for quotes saved under the older shape).
    function hasAddon(id){ return (data.addons||[]).some(function(a){ return a.id===id; }); }
    function addonRate(id){ var a=(data.addons||[]).find(function(x){ return x.id===id; }); return a?a.rate:0; }

    /* THE DOCUMENT. Description, quantity, unit price, amount, total \u2014 the
       same shape as an invoice, so the customer can follow where the number
       comes from. It replaced a volume-tier table whose rows were mutually
       exclusive options and never summed.

       Rounding is per line and the total adds the rounded amounts, so what is
       printed adds up exactly to what is shown. */
    function quoteLinesTable(lines, total){
      var rows = (lines || []).filter(function(l){ return String(l.desc || '').trim(); });
      if(!rows.length){
        return '<div style="padding:14px;color:#6b7280">No line items on this quote.</div>';
      }
      return '<table style="width:100%;border-collapse:collapse;margin-bottom:6px">' +
        '<thead><tr>' +
          '<th style="'+PTH+'">Description</th>' +
          '<th style="'+PTH+'">Qty</th>' +
          '<th style="'+PTH+'">Unit Price</th>' +
          '<th style="'+PTH+';color:#1a6fff">Amount</th>' +
        '</tr></thead><tbody>' +
        rows.map(function(l){
          var q = Number(l.qty) || 0;
          return '<tr>' +
            '<td style="'+PTDC+';text-align:left">' + esc(l.desc || '') + '</td>' +
            '<td style="'+PTDC+'">' + fmtNum(q) + (l.unit ? ' <span style="color:#6b7280">' + esc(l.unit) + '</span>' : '') + '</td>' +
            '<td style="'+PTDC+'">' + fmtUsd(l.unitPrice) + '</td>' +
            '<td style="'+PTD_BLUE+'">' + fmtUsd(l.amount) + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>' +
        '<div style="display:flex;justify-content:flex-end;align-items:baseline;gap:18px;padding:14px 10px 4px;border-top:2px solid #0a1628">' +
          '<div style="font-size:16px;font-weight:800;color:#0a1628">Quote Total</div>' +
          '<div style="font-size:20px;font-weight:900;color:#1a6fff">' + fmtUsd(total) + '</div>' +
        '</div>';
    }

    var lineRows = (data.line_items && data.line_items.length) ? data.line_items : (data.lines || []);
    var lineTotalSum = (data.total != null)
      ? data.total
      : Math.round(lineRows.reduce(function(a, l){ return a + Math.round((Number(l.amount) || 0) * 100); }, 0)) / 100;
    var tiersTable = quoteLinesTable(lineRows, lineTotalSum);

    // ── What's included ──
    var incl = (data.inclusions || inclusionsForType(data.productType));
    var half = Math.ceil(incl.length/2);
    var col1 = incl.slice(0,half).map(function(s){ return '<div style="display:flex;gap:8px;margin-bottom:6px"><span style="color:#1a6fff;flex-shrink:0">&#10003;</span> '+s+'</div>'; }).join('');
    var col2 = incl.slice(half).map(function(s){ return '<div style="display:flex;gap:8px;margin-bottom:6px"><span style="color:#1a6fff;flex-shrink:0">&#10003;</span> '+s+'</div>'; }).join('');

    // ── Terms ──
    // Terms are per product type, so a quote with cans and bottles on it needs
    // both sets. Union in first-seen order, de-duplicated: the pricing caveat
    // is worded identically for canning and bottling and should appear once.
    var terms = termsForType(data.productType);
    if(data.notes) terms = terms.concat(['<b>Additional Notes:</b> '+data.notes]);

    // PTH/PTDC/PTD_BLUE are defined at module scope (below). Declaring them
    // again here with `var` hoisted local `undefined` copies that shadowed the
    // module ones for the pricing table built earlier in this function, so its
    // cells rendered style="undefined". Use the module-scope constants instead.

    // Preview before the first save has no number yet — the database assigns it on save.
    var qref = data.quoteNumber || 'DRAFT';
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Production Quote '+esc(qref)+'</title>' +
    '<link rel="stylesheet" href="' + location.origin + '/gl-print-quote.css"></head><body>' +
    '<div class="header">' +
      '<div>' +
        '<div class="brand">GOOD LIQUID BEV CO</div>' +
        '<div class="brand-sub">2011 51st Ave E, Unit 100, Palmetto, FL 34221<br>Mike@GoodLiquid.com &nbsp;&middot;&nbsp; (803) 493-5065<br>goodliquidbevco.com</div>' +
      '</div>' +
      '<div class="quote-label">' +
        '<h2>PRODUCTION QUOTE</h2>' +
        '<div>Quote Date: '+fmtDate(data.quoteDate)+'</div>' +
        '<div>Valid for '+data.validDays+' Days</div>' +
        '<div style="margin-top:6px;font-size:10px;background:rgba(26,111,255,.2);color:#a8c4ff;padding:3px 10px;border-radius:20px;display:inline-block">'+esc(qref)+'</div>' +
      '</div>' +
    '</div>' +
    '<div class="divider"></div>' +
    '<div class="body">' +
      '<div class="client-row">' +
        '<div>' +
          '<div class="client-label">PREPARED FOR</div>' +
          '<div class="client-name">'+esc(data.clientName||'')+'</div>' +
          (data.clientEmail ? '<div style="font-size:12px;color:#4a5568;margin-top:3px">'+esc(data.clientEmail)+'</div>' : '') +
        '</div>' +
        '<div style="text-align:right">' +
          // On a multi-format quote this header used to name only the first
          // format, which reads as though the other blocks were not quoted.
          '<div class="client-label">PACKAGE FORMAT</div>' +
          '<div style="font-size:19px;font-weight:900;color:#1a2240">'+esc(data.packageFormat || '')+'</div>' +
        '</div>' +
      '</div>' +
      '<div class="section-title">QUOTE SUMMARY <span style="float:right;font-size:10px;color:#9aa7bd;font-weight:400;letter-spacing:0">All amounts USD</span></div>' +
      tiersTable +
      '<div class="section-title">WHAT\'S INCLUDED</div>' +
      '<div class="incl"><div>'+col1+'</div><div>'+col2+'</div></div>' +
      '<div class="section-title">TERMS &amp; NOTES</div>' +
      '<div class="terms-box">' + terms.map(function(t){ return '<p>'+t+'</p>'; }).join('') + '</div>' +
    '</div>' +
    '<div class="footer">' +
      '<div><b>Ready to move forward?</b><br>Contact Mike Krail, Sales &amp; Strategy &nbsp;|&nbsp; Mike@GoodLiquid.com</div>' +
      '<div style="text-align:right">Good Liquid Bev Co &nbsp;|&nbsp; Palmetto, FL</div>' +
    '</div>' +
    '</body></html>';
  }

  // Fix: define PTH/PTDC/PTD_BLUE at module scope for generateQuoteHTML
  var PTH      = 'background:#0a1628;color:#9aa7bd;padding:10px 12px;text-align:left;font-size:11px;letter-spacing:1px';
  var PTDC     = 'padding:12px;border-bottom:1px solid #eee;font-size:13px;color:#1a2240';
  var PTD_BLUE = 'padding:12px;border-bottom:1px solid #eee;font-size:13px;color:#1a6fff;font-weight:700';

  function loadScriptOnce(src){
    return new Promise(function(res, rej){
      if(document.querySelector('script[src="'+src+'"]')){ res(); return; }
      var s = document.createElement('script'); s.src = src;
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  async function htmlToPdfBase64(html, statusEl){
    if(statusEl) statusEl.textContent = 'Loading PDF engine…';
    await Promise.all([
      loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'),
      loadScriptOnce('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
    ]);
    if(statusEl) statusEl.textContent = 'Rendering quote…';
    var iframe = document.createElement('iframe');
    iframe.setAttribute('style','position:fixed;left:-99999px;top:0;width:900px;height:1200px;border:none;visibility:hidden');
    document.body.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
    await new Promise(function(r){ setTimeout(r, 900); });
    if(statusEl) statusEl.textContent = 'Generating PDF…';
    var canvas = await window.html2canvas(iframe.contentDocument.body, {
      scale:2, useCORS:true, allowTaint:true, width:900, windowWidth:900
    });
    document.body.removeChild(iframe);
    var jspdfNS = window.jspdf;
    var pdf = new jspdfNS.jsPDF({ orientation:'portrait', unit:'pt', format:'letter' });
    var pW = pdf.internal.pageSize.getWidth();
    var pH = pdf.internal.pageSize.getHeight();
    var imgH = canvas.height * pW / canvas.width;
    var imgData = canvas.toDataURL('image/jpeg', 0.92);
    var posY = 0;
    while(posY < imgH){
      if(posY > 0) pdf.addPage();
      pdf.addImage(imgData, 'JPEG', 0, -posY, pW, imgH);
      posY += pH;
    }
    return pdf.output('datauristring').split(',')[1];
  }

  function openPrintWindow(data){
    var html = generateQuoteHTML(data);
    var w = window.open('','_blank','width=980,height=780');
    if(!w){ alert('Pop-up blocked — please allow pop-ups and try again.'); return; }
    w.document.write(html);
    w.document.close();
    w.onload = function(){ w.focus(); w.print(); };
  }

  /* ── Deal panel footer buttons (hardcoded in index.html, called from onclick) ── */
  window.glQuoteFromDeal = function(){
    if(!window.currentUser || window.currentUser.role !== 'admin'){ alert('Admin only.'); return; }

    /* Find the deal object first — form inputs are inside #ddp-edit-mode (hidden in view mode)
       so they have no values when New Quote is clicked without entering edit mode. */
    var nameEl  = document.getElementById('ddp-name');
    var dealName = nameEl ? nameEl.value : '';
    var deals   = window.deals || {};
    var found   = null;
    Object.keys(deals).forEach(function(s){
      (deals[s]||[]).forEach(function(d){ if(d && d.name === dealName) found = d; });
    });

    /* Read from in-memory deal object; hidden form fields are unreliable in view mode */
    var co      = (found && found.co)          || (document.getElementById('ddp-co')||{}).value      || '';
    var email   = (found && found.email)       || (document.getElementById('ddp-email')||{}).value   || '';
    var contact = (found && found.contactName) || (document.getElementById('ddp-contact')||{}).value || '';
    var service = (found && found.service)     || (document.getElementById('ddp-service')||{}).value || '';
    var volume  = (found && found.volume)      || (document.getElementById('ddp-volume')||{}).value  || '';
    var dealNotes = (found && found.notes)     || (document.getElementById('ddp-notes')||{}).value   || '';

    var client  = (window.clients||[]).find(function(c){ return c.name && c.name.toLowerCase() === co.toLowerCase(); });
    var clientId = client ? client.id : null;

    /* ── Product type: service field first, then fall back to notes ── */
    var productType = 'canning';
    if(/bottle/i.test(service))         productType = 'bottling';
    else if(/keg/i.test(service))       productType = 'keg';
    else if(/bottle/i.test(dealNotes))  productType = 'bottling';
    else if(/keg/i.test(dealNotes))     productType = 'keg';

    /* ── Volume: read exactly what the client selected ──────────────────
       Website form checkboxes can produce comma-separated values like "200, 501".
       We parse every value and create one quote tier per selection.
       Mapping uses the ACTUAL numbers selected — 200 means 200, not 339. */
    function parseSingleCaseVal(str){
      var s = (str||'').trim();
      if(/2[.,]?500/.test(s))   return 2500;
      if(/1[.,]?000/.test(s))   return 1000;
      if(/501/.test(s))         return 501;
      if(/340/.test(s))         return 340;
      if(/200/.test(s))         return 200;
      var m = s.match(/(\d[\d,]*)/);
      if(m){ var n = parseInt(m[1].replace(/,/g,'')); if(n >= 50) return n; }
      return null;
    }

    var suggestCasesList = [];
    /* Split volume field on commas/semicolons in case multiple boxes were checked */
    (volume||'').split(/[,;]/).forEach(function(part){
      var v = parseSingleCaseVal(part);
      if(v && suggestCasesList.indexOf(v) < 0) suggestCasesList.push(v);
    });
    suggestCasesList.sort(function(a,b){ return a-b; });

    /* Fallback: parse notes for explicit quantities */
    if(!suggestCasesList.length && dealNotes){
      var casesM = dealNotes.match(/(\d[\d,]*)\s*[-–]?\s*cases?/i);
      if(casesM){ var cv = parseInt(casesM[1].replace(/,/g,'')); if(cv >= 1) suggestCasesList = [cv]; }
    }
    if(!suggestCasesList.length && dealNotes){
      var cansM = dealNotes.match(/(\d[\d,]*)\s*cans?/i);
      if(cansM){ var nc = parseInt(cansM[1].replace(/,/g,'')); if(nc > 0) suggestCasesList = [Math.round(nc/24)]; }
    }
    if(!suggestCasesList.length && dealNotes){
      var kegsM = dealNotes.match(/(\d[\d,]*)\s*kegs?/i);
      if(kegsM){ var nk = parseInt(kegsM[1].replace(/,/g,'')); if(nk > 0){ suggestCasesList = [nk]; productType = 'keg'; } }
    }
    if(!suggestCasesList.length && dealNotes){
      var btlsM = dealNotes.match(/(\d[\d,]*)\s*bottles?/i);
      if(btlsM){ var nb = parseInt(btlsM[1].replace(/,/g,'')); if(nb > 0){ suggestCasesList = [Math.round(nb/12)]; productType = 'bottling'; } }
    }

    /* "minimum run", "smallest batch", "get started", "first run" → use minimum */
    if(!suggestCasesList.length && /minimum|smallest|starter|get\s*started|first\s*run|start\s*small/i.test((volume||'')+' '+(dealNotes||''))){
      suggestCasesList = [ productType === 'bottling' ? 220 : productType === 'keg' ? 50 : 200 ];
    }

    var suggestCases = suggestCasesList.length ? suggestCasesList[0] : null;

    window.glOpenQuoteBuilder(clientId, found ? found.id : null, {
      prefillCompany:   co,
      prefillEmail:     email,
      contactName:      contact,
      productType:      productType,
      suggestCases:     suggestCases,
      suggestCasesList: suggestCasesList,
      dealNotes:        dealNotes
    });
  };

  /* ── Client Quote Builder — called from Clients section ─────── */
  window.glQuoteFromClient = function(clientId){
    if(!window.currentUser || window.currentUser.role !== 'admin'){ alert('Admin only.'); return; }
    var c = (window.clients||[]).find(function(x){ return x.id === clientId; });
    if(!c){ alert('Client not found.'); return; }
    var ov = document.getElementById('client-detail-overlay');
    if(ov) ov.remove();
    /* Pass only contact info — no productType/dealNotes so tiers stay blank for manual selection */
    window.glOpenQuoteBuilder(clientId, null, {
      prefillCompany: c.name  || '',
      prefillEmail:   c.email || '',
      contactName:    c.contact || ''
    });
  };

  window.glCloseJobFromDeal = function(outcome){
    if(!window.currentUser || window.currentUser.role !== 'admin'){ alert('Admin only.'); return; }
    var stageEl = document.getElementById('ddp-stage');
    if(!stageEl) return;
    var lost = (outcome === 'lost' || outcome === 'Closed Lost');
    var stage = lost ? 'Closed Lost' : 'Closed Won';
    if(!confirm('Mark this deal as ' + stage + '?')) return;
    stageEl.value = stage;
    stageEl.dispatchEvent(new Event('change'));
    var saveBtn = document.querySelector('[data-gl-action="saveDealDetail"]');
    if(saveBtn) saveBtn.click();
  };

  /* ── Quotes history section in Edit Client modal ─────────────── */
  async function loadClientQuotes(clientId, container){
    var sb = window.supa;
    if(!sb){ container.innerHTML = '<div style="font-size:11px;color:var(--muted);text-align:center;padding:8px">Not connected.</div>'; return; }
    var r = await sb.from('quotes').select('id,quote_number,quote_date,package_format,product_type,status,pdf_html')
      .eq('client_id', clientId)
      .order('quote_date',{ascending:false})
      .limit(20);
    if(r.error){ container.innerHTML = '<div style="font-size:11px;color:#ff8579">Could not load quotes.</div>'; return; }
    var rows = r.data || [];
    if(!rows.length){
      container.innerHTML = '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px">No quotes saved yet.</div>';
      return;
    }
    var STATUS_COLOR = { draft:'#9aa7bd', sent:'#1a6fff', accepted:'#5fcf9e', declined:'#ff8579' };
    container.innerHTML = rows.map(function(q){
      var sColor = STATUS_COLOR[q.status] || '#9aa7bd';
      return '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:10px;display:flex;align-items:center;gap:10px">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:12px;font-weight:600;color:#fff">' + esc(q.quote_number) + '</div>' +
          '<div style="font-size:11px;color:var(--muted)">' + esc(q.package_format||'') + ' &middot; ' + esc(q.quote_date||'') + '</div>' +
        '</div>' +
        '<span style="font-size:10px;letter-spacing:1.5px;color:'+sColor+'">' + esc((q.status||'').toUpperCase()) + '</span>' +
        (q.pdf_html ? '<button class="cbtn gl-q-dl" data-qid="'+q.id+'" style="font-size:11px;padding:4px 10px;flex-shrink:0">📄 PDF</button>' : '') +
      '</div>';
    }).join('');

    container.querySelectorAll('.gl-q-dl').forEach(function(btn){
      btn.addEventListener('click', async function(){
        var qid = btn.getAttribute('data-qid');
        var rr = await sb.from('quotes').select('pdf_html,quote_number').eq('id',qid).single();
        if(rr.data && rr.data.pdf_html){
          var w = window.open('','_blank','width=980,height=780');
          if(!w){ alert('Pop-up blocked.'); return; }
          w.document.write(rr.data.pdf_html);
          w.document.close();
          w.onload = function(){ w.focus(); w.print(); };
        }
      });
    });
  }

  function injectClientQuotesPanel(modal, clientId){
    if(!clientId) return;
    if(modal.querySelector('#gl-cq-panel')) return;
    var card = modal.firstElementChild;
    if(!card) return;

    var panel = document.createElement('div');
    panel.id = 'gl-cq-panel';
    panel.setAttribute('style','border-top:1px solid rgba(255,255,255,.07);margin-top:22px;padding-top:20px');
    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<div style="font-size:10px;letter-spacing:2px;color:var(--teal)">📋 PRODUCTION QUOTES</div>' +
        '<button id="gl-cq-new" class="cbtn pri" style="font-size:11px;padding:5px 14px">+ New Quote</button>' +
      '</div>' +
      '<div id="gl-cq-list" style="display:flex;flex-direction:column;gap:7px">' +
        '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px">Loading…</div>' +
      '</div>';

    card.appendChild(panel);

    loadClientQuotes(clientId, panel.querySelector('#gl-cq-list'));

    panel.querySelector('#gl-cq-new').addEventListener('click', function(){
      window.glOpenQuoteBuilder(clientId, null);
    });
  }

  // Hook into glOpenEditClient the same way src/modules/customers/client-email.js does
  (function(){
    var origOpen = window.glOpenEditClient;
    if(typeof origOpen !== 'function') return;
    window.glOpenEditClient = function(clientId){
      var r = origOpen.apply(this, arguments);
      setTimeout(function(){
        var modal = document.getElementById('gl-edit-client-modal');
        if(!modal) return;
        injectClientQuotesPanel(modal, clientId);
      }, 120);
      return r;
    };
  })();

  console.log('[GL] production quote builder loaded');
}());
