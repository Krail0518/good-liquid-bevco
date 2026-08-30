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

  // Full cost breakdown for one canning tier given the packaging rates. Used by
  // BOTH the live builder table and the generated quote PDF so a saved quote can
  // never show a different number than the one on screen.
  function canningExtras(tier, pkg){
    pkg = pkg || {};
    var cans = tier.cans || 0, cases = tier.cases || 0;
    var perCan = (tier.fillPerCan || 0);
    if(pkg.nitrogenOn) perCan += (pkg.nitrogenPerCan || 0);
    if(pkg.pasteurOn)  perCan += (pkg.pasteurPerCan  || 0);
    if(pkg.paktech4On) perCan += (pkg.paktech4PerCan || 0);
    if(pkg.paktech6On) perCan += (pkg.paktech6PerCan || 0);
    if(pkg.proper4On)  perCan += (pkg.proper4PerCan  || 0);
    if(pkg.proper6On)  perCan += (pkg.proper6PerCan  || 0);
    if(pkg.canBlankOn)   perCan += (pkg.canBlankPerCan   || 0);
    if(pkg.canShrinkOn)  perCan += (pkg.canShrinkPerCan  || 0);
    if(pkg.canPrintedOn) perCan += (pkg.canPrintedPerCan || 0);
    var caseExtra = 0;
    if(pkg.tray24On)   caseExtra += (pkg.tray24PerCase   || 0);
    if(pkg.tray12On)   caseExtra += (pkg.tray12PerCase   || 0);
    if(pkg.trayWrapOn) caseExtra += (pkg.trayWrapPerCase || 0);
    var pallets = 0, palletCost = 0;
    if(pkg.palletOn || pkg.palletWrapOn){
      var cpp = pkg.casesPerPallet || 80;
      pallets = cpp > 0 ? Math.ceil(cases / cpp) : 0;
      palletCost = pallets * ((pkg.palletOn ? (pkg.palletEach || 0) : 0) +
                              (pkg.palletWrapOn ? (pkg.palletWrapEach || 0) : 0));
    }
    // ── Manual overrides win over the calculation ──
    // A quote is a commercial document, not a spreadsheet output: sometimes the
    // number you have to put in front of a customer is not the number the rate
    // card produces. Any of these can be typed over, and an overridden cell
    // keeps its value when other inputs change — same contract as fillPerCan,
    // which has always worked this way.
    if(isNum(tier.addonsOverride))    perCan    = (tier.fillPerCan || 0) + tier.addonsOverride;
    if(isNum(tier.caseExtraOverride)) caseExtra = tier.caseExtraOverride;
    if(isNum(tier.palletCostOverride)) palletCost = tier.palletCostOverride;

    var runTotal = perCan * cans + caseExtra * cases + palletCost;
    if(isNum(tier.runTotalOverride)) runTotal = tier.runTotalOverride;

    return {
      perCan: perCan, caseExtra: caseExtra, pallets: pallets, palletCost: palletCost,
      runTotal: runTotal
    };
  }

  // An override is only in force when it is a real number. 0 is a legitimate
  // override — "this line is free" — so a plain truthiness test would silently
  // drop it back to the calculated value.
  function isNum(v){ return typeof v === 'number' && isFinite(v); }

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

  // Full cost breakdown for one bottling tier (mirror of canningExtras).
  function bottlingExtras(tier, pkg){
    pkg = pkg || {};
    var bottles = tier.bottles || 0, cases = tier.cases || 0;
    var perBtl = (tier.ratePerBtl || 0);
    if(pkg.pasteurOn) perBtl += (pkg.pasteurPerBtl || 0);
    if(pkg.otlOn)     perBtl += (pkg.otlPerBtl     || 0);
    if(pkg.labelsOn)  perBtl += (pkg.labelsPerBtl  || 0);
    var caseExtra = 0;
    if(pkg.caseOn) caseExtra += (pkg.casePerCase || 0);
    var pallets = 0, palletCost = 0;
    if(pkg.palletOn || pkg.palletWrapOn){
      var cpp = pkg.casesPerPallet || 50;
      pallets = cpp > 0 ? Math.ceil(cases / cpp) : 0;
      palletCost = pallets * ((pkg.palletOn ? (pkg.palletEach || 0) : 0) +
                              (pkg.palletWrapOn ? (pkg.palletWrapEach || 0) : 0));
    }
    return {
      perBtl: perBtl, caseExtra: caseExtra, pallets: pallets, palletCost: palletCost,
      runTotal: perBtl * bottles + caseExtra * cases + palletCost
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

        /* ── Row 2: Product type / format ── */
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:18px">' +
          '<div><div style="'+LBL+'">PRODUCT TYPE</div>' +
            '<select id="gl-qb-type" style="'+INP+'">' +
              '<option value="canning">Canning</option>' +
              '<option value="bottling">Bottling (750ml)</option>' +
              '<option value="keg">Keg Filling</option>' +
            '</select>' +
          '</div>' +
          '<div><div style="'+LBL+'">PACKAGE FORMAT</div>' +
            /* An editable combobox, not a dropdown. The presets carry
               size-specific can rates, but quoting a format that is not on the
               list is an ordinary thing to want and the <select> made it
               impossible. Type anything: the preset can-rates simply stop
               applying, and those prices are editable in the add-ons grid. */
            '<input id="gl-qb-fmt" list="gl-qb-fmt-list" autocomplete="off" placeholder="Pick one, or type your own…" style="'+INP+'">' +
            '<datalist id="gl-qb-fmt-list"></datalist>' +
          '</div>' +
        '</div>' +

        /* ── Volume tiers ── */
        '<div style="'+LBL+';margin-bottom:8px">VOLUME PRICING TIERS</div>' +
        '<div id="gl-qb-tiers" style="margin-bottom:8px"></div>' +
        '<div style="display:flex;gap:8px;margin-bottom:20px">' +
          '<button id="gl-qb-add-tier" class="cbtn" style="font-size:12px;padding:6px 14px">+ Add Tier</button>' +
          '<button id="gl-qb-auto-tiers" class="cbtn" style="font-size:12px;padding:6px 14px">⚡ Load Standard Tiers</button>' +
        '</div>' +

        /* ── Add-ons ── */
        '<div id="gl-qb-addons" style="margin-bottom:18px"></div>' +

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

    /* ── Local state ── */
    var state = { productType:'canning', format:'12oz Sleek', tiers:[], savedId:null, pkg:defaultCanningPkg(), bpkg:defaultBottlingPkg() };

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
      rerenderTiers();
    }
    // Re-point the blank-can / shrink-label / printed-can rates at the current
    // format's prices (they are size-specific). Preserves the on/off toggles.
    function applyCanRates(){
      if(!state.pkg) return;
      state.pkg.canBlankPerCan   = canRate('blank',   state.format);
      state.pkg.canShrinkPerCan  = canRate('shrink',  state.format);
      state.pkg.canPrintedPerCan = canRate('printed', state.format);
    }
    typeEl.addEventListener('change', function(){ rebuildFormats(); state.tiers=[]; renderTiers(); });
    // 'input' as well as 'change': a typed format has to take effect while you
    // are typing it, not only once focus leaves the field.
    ['change','input'].forEach(function(evt){
      fmtEl.addEventListener(evt, function(){
        state.format = fmtEl.value;
        applyCanRates(); rebuildAddons(); rerenderTiers();
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
        renderTiers();
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

    /* ── Auto-populate volume pricing tiers ── */
    var t2 = state.productType;
    var caseList = (opts.suggestCasesList && opts.suggestCasesList.length) ? opts.suggestCasesList : (opts.suggestCases ? [opts.suggestCases] : []);

    if(caseList.length){
      /* One tier per selected volume — matches exactly what the client checked on the form */
      state.tiers = caseList.map(function(sc){
        if(t2==='canning')  return { cases:sc, cans:sc*CANS_PER_CASE, fillPerCan:autoRate(sc), nitrogenPerCan:0.03, trayPerCan:0.03 };
        if(t2==='bottling') return { cases:sc, bottles:sc*BTLS_PER_CASE, ratePerBtl:autoRate(sc) };
        return { kegs:Math.max(px('keg_minimum',40),sc), laborPerKeg:px('keg_fill_per_keg',12), kegCostPerKeg:px('empty_keg_per_keg',17.50) };
      });
      renderTiers();
    } else if(opts.productType){
      /* Opening from a deal but no specific volume — load standard tiers so quote isn't blank */
      if(t2==='canning'){
        state.tiers = [
          { cases:200,  cans:200*CANS_PER_CASE,  fillPerCan:autoRate(200),  nitrogenPerCan:0.03, trayPerCan:0.03 },
          { cases:501,  cans:501*CANS_PER_CASE,  fillPerCan:autoRate(501),  nitrogenPerCan:0.03, trayPerCan:0.03 },
          { cases:1000, cans:1000*CANS_PER_CASE, fillPerCan:autoRate(1000), nitrogenPerCan:0.03, trayPerCan:0.03 }
        ];
      } else if(t2==='bottling'){
        state.tiers = [
          { cases:220,  bottles:220*BTLS_PER_CASE,  ratePerBtl:autoRate(220) },
          { cases:660,  bottles:660*BTLS_PER_CASE,  ratePerBtl:autoRate(660) },
          { cases:1320, bottles:1320*BTLS_PER_CASE, ratePerBtl:autoRate(1320) }
        ];
      } else {
        state.tiers = [{ kegs:px('keg_minimum',40), laborPerKeg:px('keg_fill_per_keg',12), kegCostPerKeg:px('empty_keg_per_keg',17.50) }];
      }
      renderTiers();
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
          if(cb){ cb.checked = !!P[m[1]]; cb.addEventListener('change', function(){ P[m[1]] = cb.checked; renderTiers(); }); }
          if(rt){ rt.addEventListener('input', function(){ P[m[2]] = parseFloat(rt.value)||0; renderTiers(); }); }
        });
        var cpp = el.querySelector('#gl-qb-cpp');
        if(cpp) cpp.addEventListener('input', function(){ P.casesPerPallet = parseInt(cpp.value,10)||80; renderTiers(); });
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
          if(cb){ cb.checked = !!B[m[1]]; cb.addEventListener('change', function(){ B[m[1]] = cb.checked; renderTiers(); }); }
          if(rt){ rt.addEventListener('input', function(){ B[m[2]] = parseFloat(rt.value)||0; renderTiers(); }); }
        });
        var bcpp = el.querySelector('#gl-qb-bcpp');
        if(bcpp) bcpp.addEventListener('input', function(){ B.casesPerPallet = parseInt(bcpp.value,10)||50; renderTiers(); });
      } else {
        el.innerHTML =
          '<div style="'+LBL+'">ADD-ON SERVICES</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:10px">' +
            addonToggle('gl-qb-empty-keg','Empty One-Way Keg','17.50','per keg') +
          '</div>';
        el.querySelector('#gl-qb-empty-keg-on').checked = true;
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

    function renderTiers(){
      var tbody = ov.querySelector('#gl-qb-tiers');
      var t = state.productType;
      if(!state.tiers.length){
        tbody.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0">No tiers yet — click "Add Tier" or "Load Standard Tiers".</div>';
        return;
      }
      var isCanning  = t === 'canning';
      var isBottling = t === 'bottling';
      var isKeg      = t === 'keg';

      var headerCols = isCanning
        ? '<th style="'+TH+'">Cases</th><th style="'+TH+'">Cans</th><th style="'+TH+'">Fill /Can</th><th style="'+TH+'">Add-ons /Can</th><th style="'+TH+'">Pkg /Case</th><th style="'+TH+'">Pallets</th><th style="'+TH+'">Run Total</th><th style="'+TH+'"></th>'
        : isBottling
          ? '<th style="'+TH+'">Cases</th><th style="'+TH+'">Bottles</th><th style="'+TH+'">/Bottle</th><th style="'+TH+'">Add-ons /Btl</th><th style="'+TH+'">Pkg /Case</th><th style="'+TH+'">Pallets</th><th style="'+TH+'">Run Total</th><th style="'+TH+'"></th>'
          : '<th style="'+TH+'">Kegs</th><th style="'+TH+'">Labor /Keg</th><th style="'+TH+'">Keg Cost /Keg</th><th style="'+TH+'">Run Total</th><th style="'+TH+'"></th>';

      var rows = state.tiers.map(function(tier, i){
        return buildTierRow(tier, i, isCanning, isBottling, isKeg);
      }).join('');

      tbody.innerHTML =
        '<div style="overflow-x:auto">' +
        '<table style="width:100%;border-collapse:collapse;font-size:12px;min-width:560px">' +
          '<thead><tr>' + headerCols + '</tr></thead>' +
          '<tbody id="gl-qb-tbody">' + rows + '</tbody>' +
        '</table></div>';

      // Wire up all inputs
      tbody.querySelectorAll('[data-tier-field]').forEach(function(inp){
        inp.addEventListener('input', function(){
          var idx  = parseInt(inp.getAttribute('data-tier-idx'),10);
          var field = inp.getAttribute('data-tier-field');
          var raw  = String(inp.value).trim();
          var tier = state.tiers[idx];

          // The *Override fields are the manual-entry cells. Emptying one hands
          // the cell back to the calculation, which is the only way out once a
          // number has been typed — without it the first keystroke would be
          // permanent.
          var OVERRIDES = ['addonsOverride','caseExtraOverride','palletCostOverride','runTotalOverride'];
          if(OVERRIDES.indexOf(field) >= 0){
            if(raw === ''){ delete tier[field]; }
            else { tier[field] = parseFloat(raw) || 0; }
            renderTiers();
            return;
          }

          var val = parseFloat(raw) || 0;
          tier[field] = val;

          // Typing a can/bottle count means you want THAT count, not cases×24.
          if(field === 'cans' || field === 'bottles') tier._countOverride = true;

          if(field === 'cases'){
            if(isCanning){
              if(!tier._countOverride) tier.cans = Math.round(val * CANS_PER_CASE);
              var deck = autoRate(val);
              if(!tier._fillOverride) tier.fillPerCan = deck;
            } else if(isBottling){
              if(!tier._countOverride) tier.bottles = Math.round(val * BTLS_PER_CASE);
              var deck2 = autoRate(val);
              if(!tier._rateOverride) tier.ratePerBtl = deck2;
            }
          }
          if(field === 'fillPerCan' || field === 'ratePerBtl'){
            tier._fillOverride = true;
            tier._rateOverride = true;
          }
          renderTiers();
        });
      });

      tbody.querySelectorAll('[data-del-tier]').forEach(function(btn){
        btn.addEventListener('click', function(){
          var idx = parseInt(btn.getAttribute('data-del-tier'),10);
          state.tiers.splice(idx,1);
          renderTiers();
        });
      });
    }

    var TH = 'background:#0a1628;color:#9aa7bd;font-size:10px;letter-spacing:1.5px;padding:8px 10px;text-align:left;white-space:nowrap';
    var TD = 'padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);color:#fff';
    var TDM = 'padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);color:#1a6fff;font-weight:700';

    function buildTierRow(tier, i, isCanning, isBottling, isKeg){
      if(isCanning){
        var x = canningExtras(tier, state.pkg);
        var addonsPerCan = x.perCan - (tier.fillPerCan||0); // nitrogen + pasteurization
        var palletCell = x.pallets
          ? x.pallets + ' × ' + fmtUsd((x.palletCost/x.pallets)) + '<div style="color:var(--muted);font-size:10px">' + fmtUsd(x.palletCost) + '</div>'
          : '—';
        // Every number in this row is typed over-able. The ones that used to be
        // plain text — cans, add-ons, packaging, pallets, the run total — are
        // inputs now, and an edited cell holds its value instead of being
        // recalculated out from under you.
        return '<tr>' +
          '<td style="'+TD+'">' + numInp(i,'cases',tier.cases,0,60) + '</td>' +
          '<td style="'+TD+'">' + ovrInp(i,'cans',tier.cans||0,tier._countOverride,68,1) + '</td>' +
          '<td style="'+TD+'">' + rateInp(i,'fillPerCan',tier.fillPerCan,tier._fillOverride) + '</td>' +
          '<td style="'+TDM+'">' + ovrInp(i,'addonsOverride',addonsPerCan,isNum(tier.addonsOverride),64,0.01) + '</td>' +
          '<td style="'+TDM+'">' + ovrInp(i,'caseExtraOverride',x.caseExtra,isNum(tier.caseExtraOverride),64,0.01) + '</td>' +
          '<td style="'+TDM+';font-size:11px">' +
            ovrInp(i,'palletCostOverride',x.palletCost,isNum(tier.palletCostOverride),68,0.01) +
            '<div style="color:var(--muted);font-size:10px;margin-top:2px">' + (x.pallets ? x.pallets + ' pallet' + (x.pallets===1?'':'s') : '—') + '</div>' +
          '</td>' +
          '<td style="'+TDM+'">' + ovrInp(i,'runTotalOverride',x.runTotal,isNum(tier.runTotalOverride),82,0.01) + '</td>' +
          '<td style="'+TD+'"><button data-del-tier="'+i+'" class="cbtn" style="padding:3px 8px;font-size:11px;color:#ff8579;border-color:rgba(255,133,121,.3)">✕</button></td>' +
        '</tr>';
      } else if(isBottling){
        var bx = bottlingExtras(tier, state.bpkg);
        var bAddPerBtl = bx.perBtl - (tier.ratePerBtl||0);
        var bPalletCell = bx.pallets
          ? bx.pallets + '<div style="color:var(--muted);font-size:10px">' + fmtUsd(bx.palletCost) + '</div>'
          : '—';
        return '<tr>' +
          '<td style="'+TD+'">' + numInp(i,'cases',tier.cases,0,60) + '</td>' +
          '<td style="'+TD+';color:var(--muted)">' + fmtNum(tier.bottles||0) + '</td>' +
          '<td style="'+TD+'">' + rateInp(i,'ratePerBtl',tier.ratePerBtl,tier._rateOverride) + '</td>' +
          '<td style="'+TDM+';color:var(--muted)">' + fmtUsd(bAddPerBtl) + '</td>' +
          '<td style="'+TDM+';color:var(--muted)">' + fmtUsd(bx.caseExtra) + '</td>' +
          '<td style="'+TDM+';color:var(--muted);font-size:11px">' + bPalletCell + '</td>' +
          '<td style="'+TDM+'">' + fmtUsd(bx.runTotal) + '</td>' +
          '<td style="'+TD+'"><button data-del-tier="'+i+'" class="cbtn" style="padding:3px 8px;font-size:11px;color:#ff8579;border-color:rgba(255,133,121,.3)">✕</button></td>' +
        '</tr>';
      } else {
        var kegTotal = ((tier.laborPerKeg||0)+(tier.kegCostPerKeg||0)) * (tier.kegs||0);
        return '<tr>' +
          '<td style="'+TD+'">' + numInp(i,'kegs',tier.kegs,0,40) + '</td>' +
          '<td style="'+TD+'">' + rateInp(i,'laborPerKeg',tier.laborPerKeg) + '</td>' +
          '<td style="'+TD+'">' + rateInp(i,'kegCostPerKeg',tier.kegCostPerKeg) + '</td>' +
          '<td style="'+TDM+'">' + fmtUsd(kegTotal) + '</td>' +
          '<td style="'+TD+'"><button data-del-tier="'+i+'" class="cbtn" style="padding:3px 8px;font-size:11px;color:#ff8579;border-color:rgba(255,133,121,.3)">✕</button></td>' +
        '</tr>';
      }
    }

    function numInp(i, field, val, step, width){
      return '<input data-tier-idx="'+i+'" data-tier-field="'+field+'" type="number" min="0" step="'+(step||1)+'" value="'+(val||0)+'" style="width:'+(width||60)+'px;padding:5px 6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:4px;color:#fff;font-size:12px">';
    }
    // A cell that shows a CALCULATED value but accepts a typed one. Yellow
    // border once overridden, so at a glance you can see which numbers on a
    // quote are the rate card's and which are yours. Clearing the box hands the
    // cell back to the calculation.
    function ovrInp(i, field, val, overridden, width, step){
      var border = overridden ? 'rgba(245,200,66,.5)' : 'rgba(255,255,255,.12)';
      var colour = overridden ? '#f5c842' : 'var(--muted)';
      var title  = overridden
        ? 'Custom value — clear the box to go back to the calculated one'
        : 'Calculated. Type over it to set your own.';
      return '<input data-tier-idx="' + i + '" data-tier-field="' + field + '"' +
        ' type="number" step="' + (step || 0.01) + '" value="' + (Math.round((val || 0) * 100) / 100) + '"' +
        ' style="width:' + (width || 68) + 'px;padding:5px 6px;background:rgba(255,255,255,.04);' +
        'border:1px solid ' + border + ';border-radius:4px;color:' + colour + ';font-size:12px"' +
        ' title="' + title + '">';
    }

    function rateInp(i, field, val, overridden){
      var border = overridden ? 'rgba(245,200,66,.5)' : 'rgba(255,255,255,.12)';
      return '<input data-tier-idx="'+i+'" data-tier-field="'+field+'" type="number" min="0" step="0.01" value="'+(val||0)+'" style="width:68px;padding:5px 6px;background:rgba(255,255,255,.04);border:1px solid '+border+';border-radius:4px;color:#fff;font-size:12px" title="'+(overridden?'Custom rate':'Deck rate — edit to override')+'">';
    }

    function rerenderTiers(){
      // Refresh deck rates on existing tiers when format changes
      var isCanning = state.productType === 'canning';
      state.tiers.forEach(function(t){
        if(isCanning && !t._fillOverride){
          t.fillPerCan = autoRate(t.cases||0);
        } else if(state.productType==='bottling' && !t._rateOverride){
          t.ratePerBtl = autoRate(t.cases||0);
        }
      });
      renderTiers();
    }

    /* ── Add tier ── */
    ov.querySelector('#gl-qb-add-tier').addEventListener('click', function(){
      var t = state.productType;
      if(t==='canning'){
        var cases = 500;
        state.tiers.push({ cases:cases, cans:cases*CANS_PER_CASE, fillPerCan:autoRate(cases), nitrogenPerCan:0.03, trayPerCan:0.03 });
      } else if(t==='bottling'){
        var c = 660;
        state.tiers.push({ cases:c, bottles:c*BTLS_PER_CASE, ratePerBtl:autoRate(c) });
      } else {
        state.tiers.push({ kegs:px('keg_minimum',40), laborPerKeg:px('keg_fill_per_keg',12), kegCostPerKeg:px('empty_keg_per_keg',17.50) });
      }
      renderTiers();
    });

    /* ── Standard tiers ── */
    ov.querySelector('#gl-qb-auto-tiers').addEventListener('click', function(){
      var t = state.productType;
      if(t==='canning'){
        state.tiers = [
          { cases:501,  cans:501*CANS_PER_CASE,  fillPerCan:autoRate(501),  nitrogenPerCan:0.03, trayPerCan:0.03 },
          { cases:1000, cans:1000*CANS_PER_CASE, fillPerCan:autoRate(1000), nitrogenPerCan:0.03, trayPerCan:0.03 },
          { cases:5000, cans:5000*CANS_PER_CASE, fillPerCan:autoRate(5000), nitrogenPerCan:0.03, trayPerCan:0.03 }
        ];
      } else if(t==='bottling'){
        state.tiers = [
          { cases:220,  bottles:220*BTLS_PER_CASE,  ratePerBtl:autoRate(220) },
          { cases:660,  bottles:660*BTLS_PER_CASE,  ratePerBtl:autoRate(660) },
          { cases:1320, bottles:1320*BTLS_PER_CASE, ratePerBtl:autoRate(1320) }
        ];
      } else {
        state.tiers = [{ kegs:px('keg_minimum',40), laborPerKeg:px('keg_fill_per_keg',12), kegCostPerKeg:px('empty_keg_per_keg',17.50) }];
      }
      renderTiers();
    });

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

      return {
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
        productType:   productType,
        packageFormat: packageFormat,
        tiers:         state.tiers,
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

    /* ── Save ── */
    async function doSave(){
      var sb  = window.supa;
      var st  = ov.querySelector('#gl-qb-status');
      if(!sb){ st.style.color='#ff8579'; st.textContent='Not connected.'; return null; }
      st.style.color='var(--muted)'; st.textContent='Saving…';
      var data = buildQuoteData();
      if(!data.tiers.length){ st.style.color='#ff8579'; st.textContent='Add at least one tier before saving.'; return null; }
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
      if(!data.tiers.length){ ov.querySelector('#gl-qb-status').style.color='#ff8579'; ov.querySelector('#gl-qb-status').textContent='Add at least one tier.'; return; }
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
      var tierLines = data.tiers.map(function(t){
        if(data.productType==='canning'){
          var x = canningExtras(t, data.pkg);
          return '<li>'+fmtNum(t.cases)+' cases ('+fmtNum(t.cans||0)+' cans) — '+fmtUsd(x.runTotal)+' all-in ('+fmtUsd((t.cans||0)?x.runTotal/(t.cans||1):0)+'/can)</li>';
        } else if(data.productType==='bottling'){
          var bx = bottlingExtras(t, data.bpkg);
          return '<li>'+fmtNum(t.cases)+' cases ('+fmtNum(t.bottles||0)+' bottles) — '+fmtUsd(bx.runTotal)+' all-in</li>';
        } else {
          return '<li>'+fmtNum(t.kegs||0)+' kegs — '+fmtUsd((t.laborPerKeg||0)+(t.kegCostPerKeg||0))+'/keg</li>';
        }
      }).join('');

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

    renderTiers();
  };

  /* ── PDF HTML generation (Stiiizy-format) ───────────────────── */
  function generateQuoteHTML(data){
    var isCanning  = data.productType === 'canning';
    var isBottling = data.productType === 'bottling';
    var isKeg      = data.productType === 'keg';
    var validUntil = fmtDate(addDays(data.quoteDate, data.validDays));

    // Addons lookup
    function hasAddon(id){ return (data.addons||[]).some(function(a){ return a.id===id; }); }
    function addonRate(id){ var a=(data.addons||[]).find(function(x){ return x.id===id; }); return a?a.rate:0; }
    // Renders a selected add-on as its own priced line on the quote (same styling
    // as palletizing). Without this, per-can/per-bottle add-ons like flash
    // pasteurization and the bottling label options were collected but never
    // shown or charged — silent revenue leakage on every affected quote.
    function addonLine(id, label, unit){
      if(!hasAddon(id)) return '';
      return '<div style="border-left:4px solid #1a6fff;padding:12px 16px;background:#eef3ff;display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<div><b>'+esc(label)+'</b></div>' +
        '<div style="color:#1a6fff;font-weight:700;font-size:15px">'+fmtUsd(addonRate(id))+' / '+esc(unit)+'</div>' +
      '</div>';
    }

    // ── Tiers table (canning format) ──
    var tiersTable = '';
    if(isCanning){
      var PK = data.pkg || {};
      tiersTable = (data.tiers||[]).map(function(t){
        var x   = canningExtras(t, PK);
        var addonsPerCan = x.perCan - (t.fillPerCan||0);
        var vol = fmtNum(t.cans||0)+' cans ('+fmtNum(t.cases||0)+' cases)';
        return '<tr>' +
          '<td style="'+PTDC+'">'+vol+'</td>' +
          '<td style="'+PTDC+'">'+fmtUsd(t.fillPerCan||0)+'</td>' +
          '<td style="'+PTDC+'">'+fmtUsd(addonsPerCan)+'</td>' +
          '<td style="'+PTDC+'">'+fmtUsd(x.caseExtra)+'</td>' +
          '<td style="'+PTDC+'">'+(x.pallets ? x.pallets+' ('+fmtUsd(x.palletCost)+')' : '—')+'</td>' +
          '<td style="'+PTD_BLUE+'">'+fmtUsd(x.runTotal)+'</td>' +
        '</tr>';
      }).join('');
      // Itemized add-on / packaging breakdown — each active line with its rate.
      function pkgLine(on, label, rate, unit){
        if(!on || !(rate>0)) return '';
        return '<div style="border-left:4px solid #1a6fff;padding:10px 16px;background:#eef3ff;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
          '<div><b>'+esc(label)+'</b></div>' +
          '<div style="color:#1a6fff;font-weight:700;font-size:14px">'+fmtUsd(rate)+' / '+esc(unit)+'</div>' +
        '</div>';
      }
      tiersTable = '<table style="width:100%;border-collapse:collapse;margin-bottom:16px">' +
        '<thead><tr>' +
          '<th style="'+PTH+'">Volume</th>' +
          '<th style="'+PTH+'">Fill /Can</th>' +
          '<th style="'+PTH+'">Add-ons /Can</th>' +
          '<th style="'+PTH+'">Pkg /Case</th>' +
          '<th style="'+PTH+'">Pallets</th>' +
          '<th style="'+PTH+';color:#1a6fff">Run Total</th>' +
        '</tr></thead><tbody>' + tiersTable + '</tbody></table>' +
        pkgLine(PK.nitrogenOn, 'Nitrogen Dosing', PK.nitrogenPerCan, 'can') +
        pkgLine(PK.pasteurOn,  'Batch Flash Pasteurization', PK.pasteurPerCan, 'can') +
        pkgLine(PK.tray24On,   '24-count Case Tray', PK.tray24PerCase, 'case') +
        pkgLine(PK.tray12On,   '12-count Case Tray', PK.tray12PerCase, 'case') +
        pkgLine(PK.trayWrapOn, 'Shrink-wrap Case Tray', PK.trayWrapPerCase, 'case') +
        pkgLine(PK.paktech4On, 'PakTech Handle — 4-pack', PK.paktech4PerCan, 'can') +
        pkgLine(PK.paktech6On, 'PakTech Handle — 6-pack', PK.paktech6PerCan, 'can') +
        pkgLine(PK.proper4On,  'Proper Pack — 4-pack', PK.proper4PerCan, 'can') +
        pkgLine(PK.proper6On,  'Proper Pack — 6-pack', PK.proper6PerCan, 'can') +
        pkgLine(PK.canBlankOn,   'Blank / Brite Can', PK.canBlankPerCan, 'can') +
        pkgLine(PK.canShrinkOn,  'Shrink-Sleeve Label', PK.canShrinkPerCan, 'can') +
        pkgLine(PK.canPrintedOn, 'Pre-Printed Can', PK.canPrintedPerCan, 'can') +
        pkgLine(PK.palletOn,   'Pallet', PK.palletEach, 'pallet') +
        pkgLine(PK.palletWrapOn, 'Pallet Shrink Wrap', PK.palletWrapEach, 'pallet');
    } else if(isBottling){
      var BB = data.bpkg || {};
      function bpkgLine(on, label, rate, unit){
        if(!on || !(rate>0)) return '';
        return '<div style="border-left:4px solid #1a6fff;padding:10px 16px;background:#eef3ff;display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
          '<div><b>'+esc(label)+'</b></div>' +
          '<div style="color:#1a6fff;font-weight:700;font-size:14px">'+fmtUsd(rate)+' / '+esc(unit)+'</div>' +
        '</div>';
      }
      tiersTable = '<table style="width:100%;border-collapse:collapse;margin-bottom:16px">' +
        '<thead><tr>' +
          '<th style="'+PTH+'">Volume</th>' +
          '<th style="'+PTH+'">Per Bottle</th>' +
          '<th style="'+PTH+'">Add-ons /Btl</th>' +
          '<th style="'+PTH+'">Pkg /Case</th>' +
          '<th style="'+PTH+'">Pallets</th>' +
          '<th style="'+PTH+';color:#1a6fff">Run Total</th>' +
        '</tr></thead><tbody>' +
        (data.tiers||[]).map(function(t){
          var bx = bottlingExtras(t, BB);
          var addPerBtl = bx.perBtl - (t.ratePerBtl||0);
          return '<tr>' +
            '<td style="'+PTDC+'">' + fmtNum(t.cases||0)+' cases ('+fmtNum(t.bottles||0)+' bottles)</td>' +
            '<td style="'+PTDC+'">' + fmtUsd(t.ratePerBtl||0) + '</td>' +
            '<td style="'+PTDC+'">' + fmtUsd(addPerBtl) + '</td>' +
            '<td style="'+PTDC+'">' + fmtUsd(bx.caseExtra) + '</td>' +
            '<td style="'+PTDC+'">' + (bx.pallets ? bx.pallets+' ('+fmtUsd(bx.palletCost)+')' : '—') + '</td>' +
            '<td style="'+PTD_BLUE+'">' + fmtUsd(bx.runTotal) + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>' +
        bpkgLine(BB.pasteurOn, 'Batch Flash Pasteurization', BB.pasteurPerBtl, 'bottle') +
        bpkgLine(BB.otlOn,     'Over the Top Labels', BB.otlPerBtl, 'bottle') +
        bpkgLine(BB.labelsOn,  'Labels Front &amp; Back', BB.labelsPerBtl, 'bottle') +
        bpkgLine(BB.caseOn,    '6-pack Bottle Case', BB.casePerCase, 'case') +
        bpkgLine(BB.palletOn,  'Pallet', BB.palletEach, 'pallet') +
        bpkgLine(BB.palletWrapOn, 'Pallet Shrink Wrap', BB.palletWrapEach, 'pallet');
    } else {
      tiersTable = '<table style="width:100%;border-collapse:collapse;margin-bottom:20px">' +
        '<thead><tr><th style="'+PTH+'">Quantity</th><th style="'+PTH+'">Labor / Keg</th><th style="'+PTH+'">Keg Cost / Keg</th><th style="'+PTH+';color:#1a6fff">Run Total</th></tr></thead><tbody>' +
        (data.tiers||[]).map(function(t){
          var total = ((t.laborPerKeg||0)+(t.kegCostPerKeg||0))*(t.kegs||0);
          return '<tr>' +
            '<td style="'+PTDC+'">' + fmtNum(t.kegs||0) + ' kegs</td>' +
            '<td style="'+PTDC+'">' + fmtUsd(t.laborPerKeg||0) + '</td>' +
            '<td style="'+PTDC+'">' + fmtUsd(t.kegCostPerKeg||0) + '</td>' +
            '<td style="'+PTD_BLUE+'">' + fmtUsd(total) + '</td>' +
          '</tr>';
        }).join('') +
        '</tbody></table>';
    }

    // ── What's included ──
    var incl = (data.inclusions || inclusionsForType(data.productType));
    var half = Math.ceil(incl.length/2);
    var col1 = incl.slice(0,half).map(function(s){ return '<div style="display:flex;gap:8px;margin-bottom:6px"><span style="color:#1a6fff;flex-shrink:0">&#10003;</span> '+s+'</div>'; }).join('');
    var col2 = incl.slice(half).map(function(s){ return '<div style="display:flex;gap:8px;margin-bottom:6px"><span style="color:#1a6fff;flex-shrink:0">&#10003;</span> '+s+'</div>'; }).join('');

    // ── Terms ──
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
          '<div class="client-label">PACKAGE FORMAT</div>' +
          '<div style="font-size:19px;font-weight:900;color:#1a2240">'+esc(data.packageFormat)+'</div>' +
        '</div>' +
      '</div>' +
      '<div class="section-title">VOLUME PRICING OPTIONS <span style="float:right;font-size:10px;color:#9aa7bd;font-weight:400;letter-spacing:0">All amounts USD</span></div>' +
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
