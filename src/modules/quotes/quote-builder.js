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
      palletWrapOn:true, palletWrapEach:px('pallet_wrap_each',8),  casesPerPallet:px('cases_per_pallet',80),
      // GL-132: the one add-on that does not scale with the run. Charged per
      // changeover, so it is added once rather than per can, case or pallet.
      // Off by default — most runs do not need one.
      changeOverOn:false, changeOverFee:px('change_over_fee',100)
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

    // GL-132: flat charges — added once, not multiplied by anything. Kept as
    // its own term so the run total stays the sum of its visible parts, which
    // is what qReconcile checks the line items against.
    var flatCost = pkg.changeOverOn ? (pkg.changeOverFee || 0) : 0;

    var runTotal = perCan * cans + caseExtra * cases + palletCost + flatCost;
    if(isNum(tier.runTotalOverride)) runTotal = tier.runTotalOverride;

    return {
      perCan: perCan, caseExtra: caseExtra, pallets: pallets, palletCost: palletCost,
      flatCost: flatCost, runTotal: runTotal
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

        /* ── Section tabs ──
           A quote can price more than one format for the same client: 12oz and
           16oz cans, or cans and bottles, on one document with one quote
           number. Each section owns its own product type, format, volume tiers
           and add-ons; everything below this strip edits the SELECTED section.
           A one-section quote looks and behaves exactly as it always did. */
        '<div style="'+LBL+'">FORMATS ON THIS QUOTE</div>' +
        '<div id="gl-qb-sections" style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:16px"></div>' +

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

        /* ── Custom lines ──
           The escape hatch. Everything above prices from the standard deck, so
           anything the deck does not model had nowhere to go and the quote had
           to be written by hand outside the system. These are free text with a
           quantity and a price, like the invoice builder's custom line.
           Section lines price one format; quote lines price the whole job. */
        '<div id="gl-qb-lines" style="margin-bottom:18px"></div>' +
        '<div id="gl-qb-qlines" style="margin-bottom:18px"></div>' +

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
          '<button id="gl-qb-invoice" class="cbtn" style="flex:1;min-width:160px;background:rgba(0,229,192,.08);border-color:rgba(0,229,192,.3);color:var(--teal)">🧾 Save + Create Invoice</button>' +
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
       A quote is a LIST of sections. Each one is what the whole quote used to
       be: a product type, a package format, its volume tiers, its packaging
       config and its own custom lines.

       state.productType / .format / .tiers / .pkg / .bpkg / .lines are
       accessors onto the SELECTED section. That is deliberate: every pricing,
       rendering and add-on function below was written against those five
       names, and pointing them at the active section means all of that code
       keeps working untouched instead of being rewritten by hand. Constrain,
       don't rewrite. */
    function newSection(productType, format){
      productType = productType || 'canning';
      format = format || (DECK[productType] || DECK.canning).formats[0];
      return {
        productType: productType,
        format: format,
        tiers: [],
        pkg: defaultCanningPkg(format),
        bpkg: defaultBottlingPkg(),
        lines: []          // custom lines belonging to THIS format
      };
    }
    var state = {
      sections: [newSection()],
      activeIdx: 0,
      quoteLines: [],      // custom lines that apply to the whole quote
      savedId: null
    };
    function cur(){ return state.sections[state.activeIdx] || state.sections[0]; }
    ['productType','format','tiers','pkg','bpkg','lines'].forEach(function(k){
      Object.defineProperty(state, k, {
        get: function(){ return cur()[k]; },
        set: function(v){ cur()[k] = v; },
        enumerable: false, configurable: true
      });
    });

    /* ── Section tabs ── */
    function sectionLabel(s){
      if(s.format) return s.format;
      return s.productType === 'bottling' ? 'Bottling' : s.productType === 'keg' ? 'Keg Filling' : 'Canning';
    }
    function renderSectionTabs(){
      var bar = ov.querySelector('#gl-qb-sections'); if(!bar) return;
      var multi = state.sections.length > 1;
      bar.innerHTML = state.sections.map(function(s, i){
        var on = i === state.activeIdx;
        return '<span class="gl-qb-tab" data-idx="'+i+'" style="display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border-radius:8px;cursor:pointer;font-size:12.5px;font-weight:700;' +
          (on ? 'background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.45);color:#00e5c0'
              : 'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:#9aa7bd') + '">' +
          esc(sectionLabel(s)) +
          (multi ? '<span class="gl-qb-tab-x" data-idx="'+i+'" title="Remove this format" style="color:#ff8579;font-weight:800;padding:0 2px">&times;</span>' : '') +
        '</span>';
      }).join('') +
      '<button id="gl-qb-add-section" class="cbtn" style="font-size:12px;padding:6px 12px">+ Add Format</button>' +
      '<button id="gl-qb-dup-section" class="cbtn" style="font-size:12px;padding:6px 12px" title="Copy this format’s tiers and add-ons into a new one">⧉ Duplicate</button>';

      bar.querySelectorAll('.gl-qb-tab').forEach(function(el){
        el.addEventListener('click', function(e){
          if(e.target.classList.contains('gl-qb-tab-x')) return;   // the × handles itself
          selectSection(parseInt(el.getAttribute('data-idx'),10));
        });
      });
      bar.querySelectorAll('.gl-qb-tab-x').forEach(function(x){
        x.addEventListener('click', function(e){
          e.stopPropagation();
          var i = parseInt(x.getAttribute('data-idx'),10);
          var s = state.sections[i];
          // Only ask when there is something to lose. An empty section the user
          // just added should close without a dialog.
          var hasWork = (s.tiers && s.tiers.length) || (s.lines && s.lines.length);
          if(hasWork && !confirm('Remove ' + sectionLabel(s) + ' and its pricing from this quote?')) return;
          state.sections.splice(i, 1);
          if(!state.sections.length) state.sections.push(newSection());
          selectSection(Math.min(state.activeIdx, state.sections.length - 1));
        });
      });
      var addBtn = bar.querySelector('#gl-qb-add-section');
      if(addBtn) addBtn.addEventListener('click', function(){
        state.sections.push(newSection());
        selectSection(state.sections.length - 1);
      });
      // Quoting 16oz right after 12oz is the common case: same volumes, same
      // add-ons, different size. Copy the section and change the format rather
      // than rebuilding the tier table by hand. Deck rates re-derive from the
      // new format as soon as it is picked.
      var dupBtn = bar.querySelector('#gl-qb-dup-section');
      if(dupBtn) dupBtn.addEventListener('click', function(){
        var copy = JSON.parse(JSON.stringify(cur()));
        state.sections.push(copy);
        selectSection(state.sections.length - 1);
        fmtEl.focus(); fmtEl.select();
      });
    }

    // Point the type/format controls, the add-on panel and the tier table at
    // the selected section. Assigning .value does NOT fire 'change', so this
    // never trips the handler that clears tiers on a real type change.
    function selectSection(i){
      state.activeIdx = Math.max(0, Math.min(i, state.sections.length - 1));
      var s = cur();
      typeEl.value = s.productType;
      var dl = ov.querySelector('#gl-qb-fmt-list');
      if(dl) dl.innerHTML = (DECK[s.productType] || DECK.canning).formats
        .map(function(f){ return '<option value="'+esc(f)+'">'; }).join('');
      fmtEl.value = s.format;
      renderSectionTabs();
      rebuildAddons();
      renderTiers();
      renderCustomLines();
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
    typeEl.addEventListener('change', function(){
      rebuildFormats(); state.tiers=[]; renderTiers();
      renderSectionTabs(); renderCustomLines();
    });
    // 'input' as well as 'change': a typed format has to take effect while you
    // are typing it, not only once focus leaves the field.
    ['change','input'].forEach(function(evt){
      fmtEl.addEventListener(evt, function(){
        state.format = fmtEl.value;
        applyCanRates(); rebuildAddons(); rerenderTiers();
        renderSectionTabs();   // the tab is named after the format
        renderCustomLines();   // so is the section's custom-line heading
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
            addonToggle('gl-qb-changeover','Change Over Fee', (P.changeOverFee||0).toFixed(2),'per changeover') +
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
          ['gl-qb-palletwrap','palletWrapOn','palletWrapEach'],
          ['gl-qb-changeover','changeOverOn','changeOverFee']
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

    /* ── Custom lines ──────────────────────────────────────────
       One line is { desc, qty, unit, rate }. The extended amount is qty × rate
       and is always shown, so a line reads the same on screen as on the PDF.
       Blank-description lines are dropped at save time rather than nagging
       while you type. */
    function lineTotal(l){ return (parseFloat(l.qty)||0) * (parseFloat(l.rate)||0); }

    function customLineRows(list, scope){
      if(!list.length){
        return '<div style="font-size:12px;color:var(--muted);padding:6px 0">None yet.</div>';
      }
      return '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px;min-width:560px">' +
        '<thead><tr>' +
          '<th style="'+QTH+'">Description</th><th style="'+QTH+'">Qty</th><th style="'+QTH+'">Unit</th>' +
          '<th style="'+QTH+'">Price</th><th style="'+QTH+'">Amount</th><th style="'+QTH+'"></th>' +
        '</tr></thead><tbody>' +
        list.map(function(l, i){
          return '<tr>' +
            '<td style="'+QTD+'"><input data-ln-scope="'+scope+'" data-ln-idx="'+i+'" data-ln-field="desc" value="'+esc(l.desc||'')+'" placeholder="e.g. Kratom filtration setup" style="'+QCELL+';min-width:200px"></td>' +
            '<td style="'+QTD+'"><input data-ln-scope="'+scope+'" data-ln-idx="'+i+'" data-ln-field="qty" type="number" step="any" value="'+esc(l.qty==null?'':l.qty)+'" style="'+QCELL+';width:80px"></td>' +
            '<td style="'+QTD+'"><input data-ln-scope="'+scope+'" data-ln-idx="'+i+'" data-ln-field="unit" value="'+esc(l.unit||'')+'" placeholder="each" style="'+QCELL+';width:90px"></td>' +
            '<td style="'+QTD+'"><input data-ln-scope="'+scope+'" data-ln-idx="'+i+'" data-ln-field="rate" type="number" step="0.01" value="'+esc(l.rate==null?'':l.rate)+'" style="'+QCELL+';width:90px"></td>' +
            '<td style="'+QTD+';color:#00e5c0;font-weight:700">'+fmtUsd(lineTotal(l))+'</td>' +
            '<td style="'+QTD+'"><button data-ln-del-scope="'+scope+'" data-ln-del="'+i+'" style="background:none;border:none;color:#ff8579;cursor:pointer;font-size:15px">&times;</button></td>' +
          '</tr>';
        }).join('') +
        '</tbody></table></div>';
    }

    function renderCustomLines(){
      var secEl = ov.querySelector('#gl-qb-lines');
      var qEl   = ov.querySelector('#gl-qb-qlines');
      if(!secEl || !qEl) return;
      var s = cur();
      s.lines = s.lines || [];
      state.quoteLines = state.quoteLines || [];

      secEl.innerHTML =
        '<div style="'+LBL+'">CUSTOM LINES — ' + esc(sectionLabel(s).toUpperCase()) + '</div>' +
        '<div style="font-size:11px;color:#6b87ad;margin:-4px 0 8px">Anything not on the price deck that applies to this format only.</div>' +
        customLineRows(s.lines, 'section') +
        '<button id="gl-qb-add-line" class="cbtn" style="font-size:12px;padding:6px 14px;margin-top:8px">+ Custom Line</button>';

      qEl.innerHTML =
        '<div style="'+LBL+'">CUSTOM LINES — WHOLE QUOTE</div>' +
        '<div style="font-size:11px;color:#6b87ad;margin:-4px 0 8px">One-off charges that span the job, whatever formats are on it.</div>' +
        customLineRows(state.quoteLines, 'quote') +
        '<button id="gl-qb-add-qline" class="cbtn" style="font-size:12px;padding:6px 14px;margin-top:8px">+ Quote-wide Line</button>';

      function listFor(scope){ return scope === 'quote' ? state.quoteLines : cur().lines; }

      [secEl, qEl].forEach(function(host){
        host.querySelectorAll('[data-ln-field]').forEach(function(inp){
          inp.addEventListener('input', function(){
            var list = listFor(inp.getAttribute('data-ln-scope'));
            var l = list[parseInt(inp.getAttribute('data-ln-idx'),10)];
            if(!l) return;
            var f = inp.getAttribute('data-ln-field');
            l[f] = (f === 'qty' || f === 'rate') ? (parseFloat(inp.value) || 0) : inp.value;
            // Only the amount cell changes, so patch it rather than re-render:
            // a full re-render on every keystroke would drop focus mid-word.
            var cell = inp.closest('tr').children[4];
            if(cell) cell.textContent = fmtUsd(lineTotal(l));
            renderTiers();   // the running total below includes these
          });
        });
        host.querySelectorAll('[data-ln-del]').forEach(function(btn){
          btn.addEventListener('click', function(){
            listFor(btn.getAttribute('data-ln-del-scope')).splice(parseInt(btn.getAttribute('data-ln-del'),10), 1);
            renderCustomLines(); renderTiers();
          });
        });
      });

      var a1 = secEl.querySelector('#gl-qb-add-line');
      if(a1) a1.addEventListener('click', function(){
        cur().lines.push({ desc:'', qty:1, unit:'each', rate:0 });
        renderCustomLines();
        var inputs = secEl.querySelectorAll('[data-ln-field="desc"]');
        if(inputs.length) inputs[inputs.length-1].focus();
      });
      var a2 = qEl.querySelector('#gl-qb-add-qline');
      if(a2) a2.addEventListener('click', function(){
        state.quoteLines.push({ desc:'', qty:1, unit:'each', rate:0 });
        renderCustomLines();
        var inputs = qEl.querySelectorAll('[data-ln-field="desc"]');
        if(inputs.length) inputs[inputs.length-1].focus();
      });
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

      // The add-on checkboxes above belong to the SELECTED section, so read
      // them into that section before snapshotting. Every other section
      // already holds its own pkg/bpkg from when it was on screen.
      var sections = state.sections.map(function(s){
        return {
          productType: s.productType,
          format:      s.format,
          tiers:       s.tiers || [],
          pkg:         JSON.parse(JSON.stringify(s.pkg  || {})),
          bpkg:        JSON.parse(JSON.stringify(s.bpkg || {})),
          // Drop the blank rows that come from clicking "+ Custom Line" and
          // then thinking better of it.
          lines:       (s.lines || []).filter(function(l){ return String(l.desc||'').trim(); }),
          inclusions:  inclusionsForType(s.productType)
        };
      });
      var quoteLines = (state.quoteLines || []).filter(function(l){ return String(l.desc||'').trim(); });

      return {
        sections:      sections,
        quoteLines:    quoteLines,
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
        // Legacy single-format fields, taken from the FIRST section. The
        // quotes table still has NOT NULL product_type and package_format
        // columns, and the quote history list, the deal panel and every saved
        // quote read them. Keeping them populated means nothing downstream
        // has to learn about sections to keep working.
        productType:   sections[0] ? sections[0].productType : productType,
        packageFormat: sections[0] ? sections[0].format      : packageFormat,
        tiers:         sections[0] ? sections[0].tiers       : state.tiers,
        addons:        addons,
        pkg:           JSON.parse(JSON.stringify(state.pkg || {})),
        bpkg:          JSON.parse(JSON.stringify(state.bpkg || {})),
        // Union across sections, in first-seen order. A quote with cans and
        // bottles on it has to show what is included for both.
        inclusions:    (function(){
          var seen = {}, out = [];
          sections.forEach(function(s){
            inclusionsForType(s.productType).forEach(function(x){
              if(!seen[x]){ seen[x] = 1; out.push(x); }
            });
          });
          return out.length ? out : inclusionsForType(productType);
        })(),
        notes:         notes,
        clientName:    (ov.querySelector('#gl-qb-client-name')||{}).value || client.name || '',
        clientEmail:   (ov.querySelector('#gl-qb-client-email')||{}).value || client.email || '',
        contactName:   opts.contactName || ''
      };
    }

    // Priceable = any section has a volume tier, or there is a custom line
    // somewhere. The old check looked only at the single tier list, so a
    // quote made entirely of custom lines could not be saved at all.
    function quoteHasContent(d){
      var secs = d.sections || [];
      if(secs.some(function(x){ return (x.tiers||[]).length || (x.lines||[]).length; })) return true;
      if((d.quoteLines||[]).length) return true;
      return (d.tiers||[]).length > 0;
    }

    /* ── Save ── */
    async function doSave(){
      var sb  = window.supa;
      var st  = ov.querySelector('#gl-qb-status');
      if(!sb){ st.style.color='#ff8579'; st.textContent='Not connected.'; return null; }
      st.style.color='var(--muted)'; st.textContent='Saving…';
      var data = buildQuoteData();
      if(!quoteHasContent(data)){ st.style.color='#ff8579'; st.textContent='Add a volume tier or a custom line before saving.'; return null; }
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
        tiers:          data.tiers,
        // Persist the packaging/pallet config alongside the toggle list so a
        // reopened quote can restore it. Kept inside the existing addons jsonb
        // array (id '__pkg__') to avoid a schema change; readers key by id.
        addons:         (data.addons||[]).concat([{ id:'__pkg__', pkg: data.pkg }]),
        // Every format on the quote, and the free-text lines. product_type and
        // package_format above describe sections[0] only; these two columns are
        // the whole picture.
        sections:       data.sections || [],
        custom_lines:   data.quoteLines || [],
        inclusions:     data.inclusions,
        notes:          data.notes,
        pdf_html:       generateQuoteHTML(data)
      };
      var r;
      // status is set on INSERT only (GL-083). The builder edits a quote's
      // content; whether it is sent, accepted or declined is set from the
      // quote's Services control. Sending 'draft' on every save meant reopening
      // an accepted quote to fix a typo silently reverted it to Draft — while
      // the services its acceptance had unlocked stayed unlocked, because grants
      // are ledger events. The record would then contradict the ledger.
      if(state.savedId){
        r = await sb.from('quotes').update(row).eq('id', state.savedId).select().single();
      } else {
        row.status = 'draft';
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

    // Save the quote, then open the invoice builder already filled in from it.
    ov.querySelector('#gl-qb-invoice').addEventListener('click', async function(){
      var saved = await doSave();
      if(!saved) return;
      var data = buildQuoteData();
      var st = ov.querySelector('#gl-qb-status');
      if(!data.clientId){
        st.style.color = '#ff8579';
        st.textContent = 'Quote saved, but it is not linked to a client record — pick an existing client to invoice it.';
        return;
      }
      if(window.glQuoteToInvoice(data, data.clientId)) ov.remove();
    });

    ov.querySelector('#gl-qb-pdf').addEventListener('click', function(){
      var data = buildQuoteData();
      if(!quoteHasContent(data)){ ov.querySelector('#gl-qb-status').style.color='#ff8579'; ov.querySelector('#gl-qb-status').textContent='Add a volume tier or a custom line.'; return; }
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
      var _secs = (data.sections && data.sections.length) ? data.sections : [{
        productType: data.productType, format: data.packageFormat,
        tiers: data.tiers, pkg: data.pkg, bpkg: data.bpkg, lines: []
      }];
      var _multi = _secs.length > 1;
      function _lineRows(list){
        return (list||[]).filter(function(l){ return String(l.desc||'').trim(); }).map(function(l){
          var qty = Number(l.qty)||0, rate = Number(l.rate)||0;
          return '<li>'+esc(l.desc)+' — '+fmtNum(qty)+(l.unit ? ' '+esc(l.unit) : '')+' @ '+fmtUsd(rate)+' = '+fmtUsd(qty*rate)+'</li>';
        }).join('');
      }
      var tierLines = _secs.map(function(sec){
        var label = sec.format || (sec.productType === 'bottling' ? 'Bottling' : sec.productType === 'keg' ? 'Keg Filling' : 'Canning');
        var rows = (sec.tiers||[]).map(function(t){
          if(sec.productType==='canning'){
            var x = canningExtras(t, sec.pkg);
            return '<li>'+fmtNum(t.cases)+' cases ('+fmtNum(t.cans||0)+' cans) — '+fmtUsd(x.runTotal)+' all-in ('+fmtUsd((t.cans||0)?x.runTotal/(t.cans||1):0)+'/can)</li>';
          } else if(sec.productType==='bottling'){
            var bx = bottlingExtras(t, sec.bpkg);
            return '<li>'+fmtNum(t.cases)+' cases ('+fmtNum(t.bottles||0)+' bottles) — '+fmtUsd(bx.runTotal)+' all-in</li>';
          }
          return '<li>'+fmtNum(t.kegs||0)+' kegs — '+fmtUsd((t.laborPerKeg||0)+(t.kegCostPerKeg||0))+'/keg</li>';
        }).join('') + _lineRows(sec.lines);
        if(!rows) return '';
        return _multi ? '<li style="list-style:none;margin-left:-20px;font-weight:700;padding-top:6px">'+esc(label)+'</li>' + rows : rows;
      }).join('') + _lineRows(data.quoteLines);

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
    selectSection(state.activeIdx);
  };

  /* ── Quote line items ─────────────────────────────────────────
     A quote is laid out exactly like an invoice: one row per charge, each
     with its own quantity, unit price and amount. These build those rows in
     the invoice's line shape ({desc, qty, unit, unitPrice, total}) from the
     same canningExtras / bottlingExtras the builder screen uses, so a tier's
     rows always add up to the run total shown while building it.

     The quote used to print one summary row per tier (fill, "add-ons",
     "packaging", pallets) plus a list of bare rates. The customer could not
     see what each item cost or check the arithmetic. ── */
  function qItem(out, desc, qty, unit, rate){
    qty = Number(qty) || 0; rate = Number(rate) || 0;
    if(!(qty > 0) || !(rate > 0)) return null;
    var item = { desc: desc, qty: qty, unit: unit, unitPrice: rate, total: qty * rate };
    out.push(item);
    return item;
  }
  // Rows must reconcile with the tier's run total. They drift apart only when
  // someone typed an override (a combined add-on rate, or a whole run total),
  // and then the difference is shown as its own row rather than hidden.
  function qReconcile(out, runTotal){
    var sum = out.reduce(function(a, l){ return a + l.total; }, 0);
    var diff = Math.round((runTotal - sum) * 100) / 100;
    if(Math.abs(diff) >= 0.01) out.push({ desc: 'Pricing adjustment', qty: 1, unit: '', unitPrice: diff, total: diff });
    return out;
  }

  // Every canning add-on, once. The quote builder's checkboxes, the quote's
  // line items, the invoice builder's add-on panel and "Create Invoice" from a
  // quote all read this list, so an item is named and priced the same way on a
  // quote and on the invoice that follows it.
  //   on / rate  → the keys in a canning pkg (see defaultCanningPkg)
  //   unit       → what the quantity counts: can, case (24 cans) or pallet
  var CANNING_ADDONS = [
    { key:'nitrogen',   on:'nitrogenOn',   rate:'nitrogenPerCan',   unit:'can',    label:'Nitrogen dosing' },
    { key:'pasteur',    on:'pasteurOn',    rate:'pasteurPerCan',    unit:'can',    label:'Batch flash pasteurization' },
    { key:'tray24',     on:'tray24On',     rate:'tray24PerCase',    unit:'case',   label:'24-count case tray' },
    { key:'tray12',     on:'tray12On',     rate:'tray12PerCase',    unit:'case',   label:'12-count case tray' },
    { key:'trayWrap',   on:'trayWrapOn',   rate:'trayWrapPerCase',  unit:'case',   label:'Case tray shrink wrap' },
    { key:'paktech4',   on:'paktech4On',   rate:'paktech4PerCan',   unit:'can',    label:'PakTech handle - 4-pack' },
    { key:'paktech6',   on:'paktech6On',   rate:'paktech6PerCan',   unit:'can',    label:'PakTech handle - 6-pack' },
    { key:'proper4',    on:'proper4On',    rate:'proper4PerCan',    unit:'can',    label:'Proper Pack - 4-pack' },
    { key:'proper6',    on:'proper6On',    rate:'proper6PerCan',    unit:'can',    label:'Proper Pack - 6-pack' },
    { key:'canBlank',   on:'canBlankOn',   rate:'canBlankPerCan',   unit:'can',    label:'Blank / brite cans and lids' },
    { key:'canShrink',  on:'canShrinkOn',  rate:'canShrinkPerCan',  unit:'can',    label:'Shrink sleeve label' },
    { key:'canPrinted', on:'canPrintedOn', rate:'canPrintedPerCan', unit:'can',    label:'Pre-printed cans' },
    { key:'pallet',     on:'palletOn',     rate:'palletEach',       unit:'pallet', label:'Pallet' },
    { key:'palletWrap', on:'palletWrapOn', rate:'palletWrapEach',   unit:'pallet', label:'Pallet shrink wrap' },
    // GL-132: unit 'flat' — quantity 1, not derived from the run size. See
    // canningLineItems and invoice-addons.js qtyFor, both of which special-case
    // it rather than looking up a per-can/case/pallet count.
    { key:'changeOver', on:'changeOverOn', rate:'changeOverFee',    unit:'flat',   label:'Change over fee' }
  ];

  function canningLineItems(t, pkg, format){
    pkg = pkg || {};
    var x = canningExtras(t, pkg), out = [];
    var cans = t.cans || 0, cases = t.cases || 0, fill = t.fillPerCan || 0;
    var label = 'Canning - ' + (format || 'Cans');
    // Fill is priced per case, the way the invoice prices it.
    var fillItem = (cases > 0 && cans === cases * CANS_PER_CASE)
      ? qItem(out, label, cases, 'case', fill * CANS_PER_CASE)
      : qItem(out, label, cans, 'can', fill);
    // What "Create Invoice" needs to rebuild this as a real canning row.
    if(fillItem){ fillItem.kind = 'canning'; fillItem.format = format || ''; fillItem.cases = cases; fillItem.perCan = fill; }

    var qtyFor = { can: cans, 'case': cases, pallet: x.pallets };
    var overrideFor = { can: t.addonsOverride, 'case': t.caseExtraOverride, pallet: t.palletCostOverride };
    var overrideLabel = { can: 'Add-ons (combined rate)', 'case': 'Case packaging (combined rate)', pallet: 'Pallets and shrink wrap' };
    ['can', 'case', 'pallet'].forEach(function(unit){
      if(isNum(overrideFor[unit])){
        // A typed-over combined rate replaces every item of that unit.
        if(unit === 'pallet') qItem(out, overrideLabel[unit], 1, '', overrideFor[unit]);
        else qItem(out, overrideLabel[unit], qtyFor[unit], unit, overrideFor[unit]);
        return;
      }
      CANNING_ADDONS.forEach(function(a){
        if(a.unit === unit && pkg[a.on]){
          var it = qItem(out, a.label, qtyFor[unit], unit, pkg[a.rate]);
          if(it) it.addon = a.key;
        }
      });
    });
    // GL-132: flat add-ons sit outside the per-unit loop above — there is no
    // quantity to look up and no combined-rate override to apply, so they are
    // emitted once at quantity 1. They are already in x.runTotal as flatCost,
    // so qReconcile below still balances.
    CANNING_ADDONS.forEach(function(a){
      if(a.unit === 'flat' && pkg[a.on]){
        var it = qItem(out, a.label, 1, '', pkg[a.rate]);
        if(it) it.addon = a.key;
      }
    });
    return qReconcile(out, x.runTotal);
  }

  function bottlingLineItems(t, bpkg, format){
    bpkg = bpkg || {};
    var x = bottlingExtras(t, bpkg), out = [];
    var bottles = t.bottles || 0, cases = t.cases || 0;
    var btl = qItem(out, 'Bottling - ' + (format || 'Bottles'), bottles, 'bottle', t.ratePerBtl);
    if(btl){ btl.kind = 'bottling'; btl.format = format || ''; }
    if(bpkg.pasteurOn) qItem(out, 'Batch flash pasteurization', bottles, 'bottle', bpkg.pasteurPerBtl);
    if(bpkg.otlOn)     qItem(out, 'Over-the-top labels',        bottles, 'bottle', bpkg.otlPerBtl);
    if(bpkg.labelsOn)  qItem(out, 'Labels, front and back',     bottles, 'bottle', bpkg.labelsPerBtl);
    if(bpkg.caseOn)    qItem(out, '6-pack bottle case',         cases,   'case',   bpkg.casePerCase);
    if(bpkg.palletOn)     qItem(out, 'Pallet',             x.pallets, 'pallet', bpkg.palletEach);
    if(bpkg.palletWrapOn) qItem(out, 'Pallet shrink wrap', x.pallets, 'pallet', bpkg.palletWrapEach);
    return qReconcile(out, x.runTotal);
  }

  function kegLineItems(t, format){
    var out = [], kegs = t.kegs || 0;
    qItem(out, 'Keg filling - ' + (format || 'Kegs'), kegs, 'keg', t.laborPerKeg);
    qItem(out, 'Keg',                                  kegs, 'keg', t.kegCostPerKeg);
    return out;
  }

  // Free-text lines typed into the builder (qty × rate).
  function customLineItems(lines){
    return (lines || []).filter(function(l){ return String(l.desc||'').trim(); }).map(function(l){
      var qty = Number(l.qty) || 0, rate = Number(l.rate) || 0;
      return { desc: String(l.desc).trim(), qty: qty, unit: l.unit || '', unitPrice: rate, total: qty * rate };
    });
  }

  function tierLineItems(sec, t){
    if(sec.productType === 'bottling') return bottlingLineItems(t, sec.bpkg, sec.format);
    if(sec.productType === 'keg')      return kegLineItems(t, sec.format);
    return canningLineItems(t, sec.pkg, sec.format);
  }
  function tierVolumeLabel(sec, t){
    if(sec.productType === 'bottling') return fmtNum(t.cases||0)+' cases ('+fmtNum(t.bottles||0)+' bottles)';
    if(sec.productType === 'keg')      return fmtNum(t.kegs||0)+' kegs';
    return fmtNum(t.cans||0)+' cans ('+fmtNum(t.cases||0)+' cases)';
  }

  // Unit prices are shown to as many decimals as they actually carry (up to
  // four). Rounding $0.475/can to "$0.48" printed a row whose quantity times
  // unit price did not equal its amount.
  function fmtRate(n){
    n = Number(n) || 0;
    return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:4});
  }
  function fmtAmt(n){
    n = Number(n) || 0;
    return (n < 0 ? '−' : '') + fmtUsd(Math.abs(n));
  }

  /* ── PDF HTML generation ──────────────────────────────────────
     Same page as the invoice PDF (downloadInvoicePDF in crm-index-core.js):
     same stylesheet, header, Bill To / details block and line-item table.
     Only the title, the details and the What's Included / Terms blocks
     differ, because those are what make it a quote. ── */
  function generateQuoteHTML(data){
    // A quote carries one or more formats. Quotes saved before sections
    // existed have no array, so treat those as the single format their own
    // columns describe — every quote ever saved still renders.
    var SECTIONS = (data.sections && data.sections.length) ? data.sections : [{
      productType: data.productType, format: data.packageFormat,
      tiers: data.tiers, pkg: data.pkg, bpkg: data.bpkg, lines: []
    }];
    var MULTI = SECTIONS.length > 1;
    var validUntil = fmtDate(addDays(data.quoteDate, data.validDays));
    function secLabel(sec){
      return sec.format || (sec.productType === 'bottling' ? 'Bottling' : sec.productType === 'keg' ? 'Keg Filling' : 'Canning');
    }

    var GROUP = 'font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#0F6E56;font-weight:700;background:#f4fbf9;padding:10px 16px';
    function itemRows(items){
      return items.map(function(l){
        var unitLbl = l.unit ? '<span style="font-size:10px;color:#888;margin-left:4px">/'+esc(l.unit)+'</span>' : '';
        return '<tr>' +
          '<td>' + esc(l.desc) + '</td>' +
          '<td style="text-align:center">' + fmtNum(l.qty) + '</td>' +
          '<td style="text-align:right">' + fmtRate(l.unitPrice) + unitLbl + '</td>' +
          '<td style="text-align:right;font-weight:700">' + fmtAmt(l.total) + '</td>' +
        '</tr>';
      }).join('');
    }
    function groupRow(label){ return '<tr><td colspan="4" style="'+GROUP+'">'+esc(label)+'</td></tr>'; }
    function totalRow(label, amount){
      return '<tr class="total-row"><td colspan="3">'+esc(label)+'</td><td style="text-align:right">'+fmtAmt(amount)+'</td></tr>';
    }
    function sumOf(items){ return items.reduce(function(a, l){ return a + l.total; }, 0); }
    function table(body){
      return '<table><thead><tr>' +
        '<th>Description</th>' +
        '<th style="text-align:center">Qty</th>' +
        '<th style="text-align:right">Unit Price</th>' +
        '<th style="text-align:right">Amount</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table>';
    }

    var quoteLines = customLineItems(data.quoteLines || data.customLines);
    // One volume per format is a single job: one table, one total, exactly
    // like an invoice. Several volumes for a format are alternatives the
    // customer chooses between, so each gets its own table and total.
    var singleJob = SECTIONS.every(function(sec){ return (sec.tiers||[]).length <= 1; });

    var itemsHtml;
    if(singleJob){
      var all = [], body = '';
      SECTIONS.forEach(function(sec){
        var items = [];
        (sec.tiers||[]).forEach(function(t){ items = items.concat(tierLineItems(sec, t)); });
        items = items.concat(customLineItems(sec.lines));
        if(!items.length) return;
        if(MULTI) body += groupRow(secLabel(sec));
        body += itemRows(items);
        all = all.concat(items);
      });
      if(quoteLines.length){
        if(MULTI) body += groupRow('Additional items');
        body += itemRows(quoteLines);
        all = all.concat(quoteLines);
      }
      itemsHtml = table(body + totalRow('Quote Total', sumOf(all)));
    } else {
      var n = 0;
      itemsHtml = SECTIONS.map(function(sec){
        var tiers = sec.tiers || [];
        var extra = customLineItems(sec.lines);
        var blocks = tiers.map(function(t){
          n++;
          var items = tierLineItems(sec, t).concat(extra);
          var title = (tiers.length > 1 ? 'Option ' + n + ' — ' : '') + (MULTI ? secLabel(sec) + ' — ' : '') + tierVolumeLabel(sec, t);
          return table(groupRow(title) + itemRows(items) + totalRow(tiers.length > 1 ? 'Option ' + n + ' Total' : 'Total', sumOf(items)));
        }).join('');
        if(!tiers.length && extra.length){
          blocks = table((MULTI ? groupRow(secLabel(sec)) : '') + itemRows(extra) + totalRow('Total', sumOf(extra)));
        }
        return blocks;
      }).join('') +
      (quoteLines.length ? table(groupRow('Additional items — added to any option') + itemRows(quoteLines) + totalRow('Additional Items Total', sumOf(quoteLines))) : '');
    }

    // ── What's included ──
    var incl = (data.inclusions || inclusionsForType(data.productType));
    var inclHtml = incl.map(function(s){
      return '<div style="padding:3px 0"><span style="color:#0F6E56;font-weight:700;margin-right:8px">&#10003;</span>'+esc(s)+'</div>';
    }).join('');

    // ── Terms ──
    // Terms are per product type, so a quote with cans and bottles on it needs
    // both sets. Union in first-seen order, de-duplicated: the pricing caveat
    // is worded identically for canning and bottling and should appear once.
    // The built-in terms carry their own <b> markup; the typed notes are
    // escaped because they are free text.
    var terms = (function(){
      var seen = {}, out = [];
      SECTIONS.forEach(function(sec){
        termsForType(sec.productType).forEach(function(t){
          if(!seen[t]){ seen[t] = 1; out.push(t); }
        });
      });
      return out.length ? out : termsForType(data.productType);
    })();
    if(data.notes) terms = terms.concat(['<b>Additional Notes:</b> '+esc(data.notes)]);

    var BOX   = 'margin-top:24px;padding:14px 18px;background:#f4fbf9;border:1px solid #0F6E56;border-radius:8px;font-size:13px;line-height:1.6';
    var BOXH  = 'font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#0F6E56;margin-bottom:8px;font-weight:700';

    var formats = SECTIONS.map(function(sec){ return esc(secLabel(sec)); }).join(', ');
    var preparedFor = '<strong>'+esc(data.clientName||'')+'</strong>' +
      (data.contactName ? '<br><span style="color:#666;font-size:12px">Attn: '+esc(data.contactName)+'</span>' : '') +
      (data.clientEmail ? '<br><span style="color:#666;font-size:12px">'+esc(data.clientEmail)+'</span>' : '');

    // Preview before the first save has no number yet — the database assigns it on save.
    var qref = data.quoteNumber || 'DRAFT';
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>'+esc(qref)+' — Good Liquid Bev Co</title>' +
    '<link rel="stylesheet" href="' + location.origin + '/gl-print-invoice-pdf.css"></head><body>' +
    '<div class="header">' +
      '<div>' +
        '<div class="brand">GOOD LIQUID BEV CO</div>' +
        '<div class="brand-sub">2011 51st Ave E, Unit 100 · Palmetto, FL 34221</div>' +
        '<div class="brand-sub">Mike@GoodLiquid.com · (803) 493-5065</div>' +
      '</div>' +
      '<div>' +
        '<div class="inv-title">QUOTE</div>' +
        '<div class="inv-num">'+esc(qref)+'</div>' +
      '</div>' +
    '</div>' +
    '<div class="meta">' +
      '<div class="meta-box"><h4>Prepared For</h4><p>'+preparedFor+'</p></div>' +
      '<div class="meta-box" style="text-align:right"><h4>Quote Details</h4>' +
        '<p>Date: '+esc(data.quoteDate||'')+'<br>Valid until: '+esc(validUntil)+'<br>'+(MULTI ? 'Formats' : 'Format')+': '+formats+'</p></div>' +
    '</div>' +
    itemsHtml +
    '<div style="font-size:11px;color:#999;margin-top:-12px">All amounts USD.</div>' +
    (inclHtml ? '<div style="'+BOX+'"><div style="'+BOXH+'">What\'s Included</div>'+inclHtml+'</div>' : '') +
    '<div style="'+BOX+'"><div style="'+BOXH+'">Terms &amp; Notes</div>' +
      terms.map(function(t){ return '<p style="margin:0 0 6px">'+t+'</p>'; }).join('') +
    '</div>' +
    '<div class="footer">Questions? Mike Krail, Sales &amp; Strategy · Mike@GoodLiquid.com · (803) 493-5065 · goodliquidbevco.com</div>' +
    '</body></html>';
  }

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
    var r = await sb.from('quotes').select('id,quote_number,quote_date,package_format,product_type,status,pdf_html,project_id,services')
      .eq('client_id', clientId)
      .order('quote_date',{ascending:false})
      .limit(20);
    if(r.error){ container.innerHTML = '<div style="font-size:11px;color:#ff8579">Could not load quotes.</div>'; return; }
    var rows = r.data || [];

    // Projects this client's quotes may be attached to. Archived ones are left
    // out: the database refuses to unlock anything on an archived project, so
    // offering one here would be a control that silently does nothing.
    var projRes = await sb.from('projects').select('id,name')
      .eq('client_id', clientId).is('archived_at', null).order('created_at');
    var projects = (projRes && projRes.data) || [];
    if(!rows.length){
      container.innerHTML = '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px">No quotes saved yet.</div>';
      return;
    }
    var STATUS_COLOR = { draft:'#9aa7bd', sent:'#1a6fff', accepted:'#5fcf9e', declined:'#ff8579' };

    // ── Which services this quote sells, and which project they unlock ──────
    // Accepting the quote is what grants them (trg_quote_grant_entitlements).
    // The two facts are set explicitly rather than inferred from the line items:
    // a quote's addons are production options — nitrogen, trays, palletizing —
    // and nothing in the priced lines names a portal service. Guessing a
    // billing-adjacent grant from wording would break the first time someone
    // rephrased a line.
    var PORTAL_SERVICES = [
      { key:'renders',           label:'Product Renders' },
      { key:'packaging_artwork', label:'Packaging & Artwork' },
      { key:'market_analytics',  label:'Market Analytics' }
    ];

    function svcEditorHtml(q){
      var have = q.services || [];
      // CP07 — owner decision 2026-09-17: an accepted quote is locked. Its
      // project, services and status cannot change (the database refuses it,
      // gl_guard_accepted_quote); more services are sold on a new quote.
      if(q.status === 'accepted'){
        var projName = (projects.filter(function(p){ return p.id === q.project_id; })[0] || {}).name;
        var labels = PORTAL_SERVICES.filter(function(s){ return have.indexOf(s.key) > -1; })
          .map(function(s){ return s.label; });
        return '<div class="gl-q-svc-panel" data-for="' + esc(q.id) + '" data-locked="1" ' +
          'style="display:none;background:rgba(95,207,158,.05);border:1px solid rgba(95,207,158,.25);' +
          'border-radius:6px;padding:12px;margin-top:-3px;flex-direction:column;gap:6px">' +
          '<div style="font-size:10px;letter-spacing:1.5px;color:#5fcf9e">ACCEPTED — LOCKED</div>' +
          '<div style="font-size:12px;color:#c9d4e4">Project: ' + esc(projName || (q.project_id ? '(archived or unavailable)' : 'none')) + '</div>' +
          '<div style="font-size:12px;color:#c9d4e4">Services: ' + esc(labels.length ? labels.join(', ') : 'none') + '</div>' +
          '<div style="font-size:11px;color:var(--muted)">An accepted quote cannot be changed. To sell more services, create a new quote for this client; it unlocks them when it is accepted. Services can also be granted or revoked directly in the client&rsquo;s project admin.</div>' +
        '</div>';
      }
      var projOpts = '<option value="">— no project —</option>' + projects.map(function(p){
        return '<option value="' + esc(p.id) + '"' +
          (q.project_id === p.id ? ' selected' : '') + '>' + esc(p.name || 'Untitled') + '</option>';
      }).join('');
      var statusOpts = ['draft','sent','accepted','declined'].map(function(s){
        return '<option value="' + s + '"' + (q.status === s ? ' selected' : '') + '>' +
          s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
      }).join('');
      var boxes = PORTAL_SERVICES.map(function(s){
        return '<label style="display:flex;align-items:center;gap:6px;font-size:11px;color:#c9d4e4;cursor:pointer">' +
          '<input type="checkbox" class="gl-q-svc-box" value="' + s.key + '"' +
          (have.indexOf(s.key) > -1 ? ' checked' : '') + '>' + esc(s.label) + '</label>';
      }).join('');

      // display is controlled inline, NOT with the `hidden` attribute: an
      // inline `display:flex` outranks the UA stylesheet's [hidden]{display:none},
      // so the panel rendered expanded on every row while `hidden` flipped
      // uselessly underneath. Found by clicking it (GL-082).
      return '<div class="gl-q-svc-panel" data-for="' + esc(q.id) + '" ' +
        'style="display:none;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);' +
        'border-radius:6px;padding:12px;margin-top:-3px;flex-direction:column;gap:10px">' +
        '<div style="font-size:10px;letter-spacing:1.5px;color:var(--muted)">UNLOCKS IN THE CLIENT PORTAL WHEN ACCEPTED</div>' +
        '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
          '<label style="font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:3px">Project' +
            '<select class="gl-q-proj" style="font-size:11px;padding:4px 6px;min-width:170px">' + projOpts + '</select>' +
          '</label>' +
          '<label style="font-size:11px;color:var(--muted);display:flex;flex-direction:column;gap:3px">Status' +
            '<select class="gl-q-status" style="font-size:11px;padding:4px 6px">' + statusOpts + '</select>' +
          '</label>' +
        '</div>' +
        '<div style="display:flex;gap:14px;flex-wrap:wrap">' + boxes + '</div>' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<button class="cbtn pri gl-q-svc-save" style="font-size:11px;padding:5px 14px">Save</button>' +
          '<span class="gl-q-svc-msg" style="font-size:11px;color:var(--muted)"></span>' +
        '</div>' +
      '</div>';
    }

    container.innerHTML = rows.map(function(q){
      var sColor = STATUS_COLOR[q.status] || '#9aa7bd';
      return '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:10px;display:flex;align-items:center;gap:10px">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:12px;font-weight:600;color:#fff">' + esc(q.quote_number) + '</div>' +
          '<div style="font-size:11px;color:var(--muted)">' + esc(q.package_format||'') + ' &middot; ' + esc(q.quote_date||'') + '</div>' +
        '</div>' +
        '<span style="font-size:10px;letter-spacing:1.5px;color:'+sColor+'">' + esc((q.status||'').toUpperCase()) + '</span>' +
        (q.pdf_html ? '<button class="cbtn gl-q-dl" data-qid="'+q.id+'" style="font-size:11px;padding:4px 10px;flex-shrink:0">📄 PDF</button>' : '') +
        '<button class="cbtn gl-q-inv" data-qid="'+q.id+'" style="font-size:11px;padding:4px 10px;flex-shrink:0" title="Open a new invoice filled in from this quote">🧾 Invoice</button>' +
        '<button class="cbtn gl-q-svc" data-qid="'+q.id+'" style="font-size:11px;padding:4px 10px;flex-shrink:0">⚙ Services</button>' +
      '</div>' +
      svcEditorHtml(q);
    }).join('');

    container.querySelectorAll('.gl-q-svc').forEach(function(btn){
      btn.addEventListener('click', function(){
        var panel = container.querySelector('.gl-q-svc-panel[data-for="' + btn.getAttribute('data-qid') + '"]');
        if(!panel) return;
        panel.style.display = (panel.style.display === 'none') ? 'flex' : 'none';
      });
    });

    container.querySelectorAll('.gl-q-svc-panel').forEach(function(panel){
      if(panel.getAttribute('data-locked') === '1') return;
      var qid  = panel.getAttribute('data-for');
      var save = panel.querySelector('.gl-q-svc-save');
      var msg  = panel.querySelector('.gl-q-svc-msg');

      save.addEventListener('click', async function(){
        var projectId = panel.querySelector('.gl-q-proj').value || null;
        var status    = panel.querySelector('.gl-q-status').value;
        var services  = Array.prototype.slice
          .call(panel.querySelectorAll('.gl-q-svc-box:checked'))
          .map(function(b){ return b.value; });

        if(services.length && !projectId){
          msg.textContent = 'Pick a project — services unlock per project, not per client.';
          msg.style.color = '#f5c842';
          return;
        }
        if(status === 'accepted' && services.length){
          var names = services.length + (services.length === 1 ? ' service' : ' services');
          if(!confirm('Accepting this quote unlocks ' + names + ' in the client portal straight away.\n\nThis is recorded in the entitlement ledger and the client is emailed. An accepted quote is then locked — later additions go on a new quote. Continue?')) return;
        }

        save.disabled = true;
        msg.style.color = 'var(--muted)';
        msg.textContent = 'Saving…';

        // CLAUDE.md rule 4: check what the server actually did. RLS refuses
        // silently — 0 rows and no error — so an unchecked write reports
        // success while nothing saved.
        var up = await sb.from('quotes')
          .update({ project_id: projectId, services: services, status: status })
          .eq('id', qid)
          .select();

        save.disabled = false;

        if(up.error){
          msg.style.color = '#ff8579';
          msg.textContent = up.error.message || 'Could not save.';
          return;
        }
        if(!up.data || !up.data.length){
          msg.style.color = '#ff8579';
          msg.textContent = 'Nothing saved — the database refused the change.';
          return;
        }

        // Report what the ledger now says, not what was asked for.
        if(status === 'accepted' && services.length){
          var led = await sb.from('project_entitlement_events')
            .select('service_key, action, seq').eq('project_id', projectId).in('service_key', services)
            .order('seq', { ascending: true });
          var current = {};
          ((led && led.data) || []).forEach(function(e){ current[e.service_key] = e.action; });
          var open = services.filter(function(k){ return current[k] === 'grant'; });
          var missing = services.filter(function(k){ return current[k] !== 'grant'; });
          if(led && led.error){
            msg.style.color = '#f5c842';
            msg.textContent = 'Saved as accepted, but the unlock could not be confirmed (' + led.error.message + '). Check the project’s services.';
          } else if(missing.length){
            msg.style.color = '#ff8579';
            msg.textContent = 'Saved as accepted, but these are NOT unlocked: ' + missing.join(', ') + '. Grant them in project admin.';
          } else {
            msg.style.color = '#5fcf9e';
            msg.textContent = 'Saved — unlocked for the client: ' + open.join(', ') + '. This quote is now locked.';
          }
        } else {
          msg.style.color = '#5fcf9e';
          msg.textContent = 'Saved.';
        }
        if(typeof window.glAudit === 'function'){
          window.glAudit('quote_services_set', qid, { status: status, services: services, project: projectId });
        }
        setTimeout(function(){ loadClientQuotes(clientId, container); }, 700);
      });
    });

    container.querySelectorAll('.gl-q-inv').forEach(function(btn){
      btn.addEventListener('click', async function(){
        var rr = await sb.from('quotes').select('*').eq('id', btn.getAttribute('data-qid')).single();
        if(rr.error || !rr.data){ alert('Could not load that quote' + (rr.error ? ': ' + rr.error.message : '.')); return; }
        window.glQuoteToInvoice(quoteDataFromRow(rr.data), clientId);
      });
    });

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

  /* ── Quote → invoice ──────────────────────────────────────────
     A saved quote's own columns rebuilt into the shape generateQuoteHTML
     reads. Rows saved before sections existed describe one format in
     product_type / package_format / tiers, with the packaging config parked
     in the addons array under id '__pkg__'. ── */
  function quoteDataFromRow(q){
    var legacyPkg = ((q.addons || []).find(function(a){ return a && a.id === '__pkg__'; }) || {}).pkg;
    return {
      quoteNumber: q.quote_number,
      sections: (q.sections && q.sections.length) ? q.sections : [{
        productType: q.product_type, format: q.package_format,
        tiers: q.tiers || [], pkg: legacyPkg || {}, bpkg: {}, lines: []
      }],
      quoteLines: q.custom_lines || []
    };
  }

  function secLabelOf(sec){
    return sec.format || (sec.productType === 'bottling' ? 'Bottling' : sec.productType === 'keg' ? 'Keg Filling' : 'Canning');
  }

  // The choices a quote offers, each as a complete list of invoice lines.
  // Mirrors the PDF: one volume per format is a single job (everything on it
  // is one option); several volumes are alternatives, one option each, with
  // that format's custom lines and the quote-wide lines on every option.
  function quoteOptions(data){
    var SECTIONS = data.sections || [];
    var quoteLines = customLineItems(data.quoteLines || data.customLines);
    function cpp(sec){ return (sec.pkg && sec.pkg.casesPerPallet) || null; }
    var singleJob = SECTIONS.every(function(sec){ return (sec.tiers || []).length <= 1; });
    if(singleJob){
      var items = [], casesPerPallet = null;
      SECTIONS.forEach(function(sec){
        (sec.tiers || []).forEach(function(t){ items = items.concat(tierLineItems(sec, t)); });
        items = items.concat(customLineItems(sec.lines));
        if(casesPerPallet == null && sec.productType === 'canning') casesPerPallet = cpp(sec);
      });
      items = items.concat(quoteLines);
      return items.length ? [{ label: 'Whole quote', items: items, casesPerPallet: casesPerPallet }] : [];
    }
    var out = [], n = 0;
    SECTIONS.forEach(function(sec){
      var extra = customLineItems(sec.lines);
      (sec.tiers || []).forEach(function(t){
        n++;
        var items = tierLineItems(sec, t).concat(extra, quoteLines);
        var total = items.reduce(function(a, l){ return a + l.total; }, 0);
        out.push({
          label: 'Option ' + n + ' — ' + secLabelOf(sec) + ', ' + tierVolumeLabel(sec, t) + ' — ' + fmtUsd(total),
          items: items, casesPerPallet: sec.productType === 'canning' ? cpp(sec) : null
        });
      });
    });
    return out;
  }

  // Ask which option was accepted (only when there is more than one), then
  // hand its lines to the invoice builder. Returns false if nothing opened.
  window.glQuoteToInvoice = function(data, clientId){
    if(typeof window.glInvoiceFromQuote !== 'function'){ alert('Invoice builder not ready — reload and try again.'); return false; }
    var opts = quoteOptions(data);
    if(!opts.length){ alert('This quote has no priced lines to invoice.'); return false; }
    function go(o){
      window.glInvoiceFromQuote({ clientId: clientId, quoteNumber: data.quoteNumber || '', items: o.items, casesPerPallet: o.casesPerPallet });
    }
    if(opts.length === 1){ go(opts[0]); return true; }

    var old = document.getElementById('gl-q2i-pick'); if(old) old.remove();
    var m = document.createElement('div');
    m.id = 'gl-q2i-pick';
    m.setAttribute('style', 'position:fixed;inset:0;z-index:10000;background:rgba(6,13,26,.9);display:flex;align-items:center;justify-content:center;padding:16px');
    var card = document.createElement('div');
    card.setAttribute('style', 'background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:22px;width:100%;max-width:460px');
    var h = document.createElement('div');
    h.setAttribute('style', 'font-size:14px;font-weight:700;color:#fff;margin-bottom:4px');
    h.textContent = 'Which option did the client choose?';
    var sub = document.createElement('div');
    sub.setAttribute('style', 'font-size:12px;color:var(--muted);margin-bottom:14px');
    sub.textContent = 'The invoice is filled in with that option\'s line items.';
    card.appendChild(h); card.appendChild(sub);
    opts.forEach(function(o){
      var b = document.createElement('button');
      b.className = 'cbtn';
      b.setAttribute('style', 'display:block;width:100%;text-align:left;margin-bottom:8px;font-size:12px;padding:10px 12px');
      b.textContent = o.label;
      b.addEventListener('click', function(){ m.remove(); go(o); });
      card.appendChild(b);
    });
    var cancel = document.createElement('button');
    cancel.className = 'cbtn';
    cancel.setAttribute('style', 'width:100%;font-size:12px;color:var(--muted)');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', function(){ m.remove(); });
    card.appendChild(cancel);
    m.appendChild(card);
    document.body.appendChild(m);
    return true;
  };

  // The shared add-on list with today's rates, for the invoice builder's panel.
  window.glCanningAddons = function(format){
    var pkg = defaultCanningPkg(format);
    return {
      casesPerPallet: pkg.casesPerPallet,
      items: CANNING_ADDONS.map(function(a){
        return { key: a.key, label: a.label, unit: a.unit, rate: pkg[a.rate] || 0 };
      })
    };
  };
  // Exposed for tests: the option list a quote offers the invoice builder.
  window.glQuoteOptions = function(data){ return quoteOptions(data); };

  console.log('[GL] production quote builder loaded');
}());
