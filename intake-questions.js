/* ============================================================
   intake-questions.js — the single source of truth for the
   Good Liquid product intake questionnaire.
   ============================================================
   ONE questionnaire, used everywhere so nothing is asked twice:
     • Public tour booking (index.html + book.html) — required before a slot
       can be picked, so Mike never gets a blind tour.
     • Client onboarding page (onboard.html).
     • Staff view/edit inside the CRM (crm-intake.js on the client card).

   Plain browser global (window.GL_INTAKE) — no modules — so the minimal public
   pages can load it with a single <script>. It only renders/reads a form; each
   surface decides where the answers go (a lead via gl_tour_intake_submit, the
   client via the onboarding/staff path, etc.).

   API:
     GL_INTAKE.SECTIONS                 → the schema (array of sections)
     GL_INTAKE.render(mountEl, values)  → build the form (optionally prefilled)
     GL_INTAKE.collect(mountEl)         → { ok, answers, missing:[labels] }
     GL_INTAKE.summary(answers)         → human-readable text block (for Mike)
     GL_INTAKE.leadPayload(answers)     → submit_quote_request-shaped fields
   ============================================================ */
(function(){
  'use strict';

  // Mirrors the PROJECT QUESTIONNAIRE emailed to leads, so answers that come
  // back by email can be entered here field for field. Keys are stable; when an
  // option's wording changes, remap stored answers in a migration.
  var SECTIONS = [
    { key:'product', title:'Brand & product', fields:[
      { key:'company',        label:'Brand / company name',   type:'text',     required:true },
      { key:'first_name',     label:'First name',             type:'text',     required:true },
      { key:'last_name',      label:'Last name',              type:'text',     required:true },
      { key:'role',           label:'Your role',              type:'text',     required:false, placeholder:'e.g. Founder' },
      { key:'email',          label:'Email',                  type:'email',    required:true },
      { key:'phone',          label:'Phone',                  type:'tel',      required:true },
      { key:'website',        label:'Website',                type:'text',     required:false, placeholder:'e.g. yourbrand.com' },
      { key:'product_description', label:'What are you making? Describe the product', type:'textarea', required:true, placeholder:'e.g. A yerba mate energy drink, lightly sweetened, natural citrus flavor' },
      { key:'product_category', label:'Product category', type:'select', required:true,
        options:['Energy drink','Soda','Sparkling / seltzer water','Water','Tea','Cold brew / coffee','Juice','Kombucha','Functional / wellness','RTD cocktail','Hard seltzer','Other'] },
      { key:'carbonation', label:'Carbonated or still?', type:'select', required:true,
        options:['Still (no carbonation)','Lightly carbonated','Fully carbonated','Nitro'] },
      { key:'flavors', label:'How many flavors at launch?', type:'text', required:true, placeholder:'e.g. 3' },
      { key:'contains_alcohol', label:'Contains alcohol?', type:'select', required:true, options:['No','Yes'] },
      { key:'abv', label:'Target ABV %', type:'text', required:false, showIf:{ key:'contains_alcohol', value:'Yes' }, placeholder:'e.g. 5.0' },
      { key:'alcohol_licenses', label:'Federal and state licenses', type:'select', required:false, showIf:{ key:'contains_alcohol', value:'Yes' },
        options:['We hold them','Filing or planning to file','Not yet'] }
    ]},
    { key:'formula', title:'Formula & ingredients', fields:[
      { key:'formula_status', label:'Where is your formula?', type:'select', required:true,
        options:['Finished commercial formula, ready to scale','Working recipe that needs development','Need formulation from scratch'] },
      { key:'ingredients', label:'Key ingredients / short ingredient list', type:'textarea', required:true, placeholder:'e.g. filtered water, cane sugar, yerba mate extract, citric acid, natural flavor' },
      { key:'low_acid', label:'Does it contain dairy, protein, coffee, or other low acid ingredients?', type:'select', required:true,
        options:['No','Yes','Not sure'] },
      { key:'ph_known', label:'Target pH, if known', type:'select', required:false,
        options:['Below 4.6 (acidic)','4.6 or above (low acid)','Not sure'] },
      { key:'preservative', label:'Does your formula include a preservative? Every product we run must have one', type:'select', required:true,
        options:['Yes, potassium sorbate','Yes, another preservative','No preservative yet','Not sure'] },
      { key:'preservative_name', label:'Which preservative?', type:'text', required:false, showIf:{ key:'preservative', value:'Yes, another preservative' } },
      { key:'allergens', label:'Allergens present (check all)', type:'multiselect', required:false,
        options:['None','Milk','Eggs','Fish','Shellfish','Tree nuts','Peanuts','Wheat / gluten','Soy','Sesame'] },
      { key:'process_authority', label:'Process Authority Letter for this product', type:'select', required:true,
        options:['I have a PA letter','In progress','Don’t have one / need guidance','Not sure what that is'] }
    ]},
    { key:'run', title:'Run size & packaging', fields:[
      { key:'target_volume', label:'First run size per flavor (minimum 200 cases, 4,800 cans)', type:'select', required:true,
        options:['200 to 499 cases','500 to 999 cases','1,000 to 2,499 cases','2,500 cases or more'] },
      { key:'format', label:'Package format', type:'select', required:true,
        options:['12oz standard can','12oz sleek can','16oz standard can','750ml bottle','Not sure yet'] },
      { key:'label_type', label:'Decoration', type:'select', required:true,
        options:['Printed cans','Shrink sleeves','Bottle labels','Not decided yet'] },
      { key:'artwork_status', label:'Artwork status', type:'select', required:true,
        options:['Print ready artwork','In design','Not started'] },
      { key:'secondary_packaging', label:'Case packing (check all)', type:'multiselect', required:true,
        options:['24 count trays','12 count trays','4 pack carriers (PakTech)','Variety packs','Not sure yet'] },
      { key:'timeline', label:'When do you need finished product in hand?', type:'select', required:true,
        options:['ASAP','1 to 3 months','3 to 6 months','6+ months','Just exploring'] }
    ]},
    { key:'business', title:'Budget & sales', fields:[
      { key:'budget', label:'Budget set aside for the first run, including R&D, cans, packaging, and ingredients (optional)', type:'text', required:false, placeholder:'e.g. $25,000' },
      { key:'sales_channels', label:'Where will it sell? (check all)', type:'multiselect', required:true,
        options:['Retail','Online','Distribution','Food service / on premise'] },
      { key:'storage_needed', label:'Need storage after production?', type:'select', required:true, options:['Yes','No','Not sure'] },
      { key:'shelf_stability', label:'Shelf stability', type:'select', required:false,
        options:['Shelf stable / ambient','Refrigerated / cold chain','Not sure'] },
      { key:'nutritional_panel', label:'Nutrition / label panel', type:'select', required:false,
        options:['Have it','Need it','Not sure'] },
      { key:'certifications', label:'Certifications needed (check all)', type:'multiselect', required:false,
        options:['Gluten free','Non GMO','Vegan','None'] },
      { key:'goals', label:'Anything else we should know?', type:'textarea', required:false, placeholder:'Questions for Mike, decisions you are trying to make' }
    ]}
  ];

  function esc(s){ return String(s==null?'':s).replace(/[<>&"]/g,function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]; }); }
  function fid(k){ return 'gi-'+k; }

  var LBL = 'display:block;font-size:11px;letter-spacing:.5px;color:#9aa7bd;margin-bottom:5px;font-weight:600';
  var INP = 'width:100%;padding:10px 12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#fff;font-size:14px;font-family:inherit;box-sizing:border-box';

  function fieldHtml(f, values){
    var v = values && values[f.key] != null ? values[f.key] : (f.type==='multiselect' ? [] : '');
    var req = f.required ? ' <span style="color:#ff8579">*</span>' : '';
    var wrapAttr = f.showIf ? ' data-showif-key="'+esc(f.showIf.key)+'" data-showif-val="'+esc(f.showIf.value)+'"' : '';
    var inner = '';
    if(f.type === 'textarea'){
      inner = '<textarea id="'+fid(f.key)+'" rows="3" placeholder="'+esc(f.placeholder||'')+'" style="'+INP+';resize:vertical">'+esc(v)+'</textarea>';
    } else if(f.type === 'select'){
      inner = '<select id="'+fid(f.key)+'" class="gi-input" style="'+INP+'"><option value="">Select…</option>' +
        f.options.map(function(o){ return '<option'+(String(v)===o?' selected':'')+'>'+esc(o)+'</option>'; }).join('') + '</select>';
    } else if(f.type === 'multiselect'){
      var arr = Array.isArray(v) ? v : (v ? String(v).split(',').map(function(s){return s.trim();}) : []);
      inner = '<div id="'+fid(f.key)+'" class="gi-multi" style="display:flex;flex-wrap:wrap;gap:7px">' +
        f.options.map(function(o){
          var on = arr.indexOf(o) >= 0;
          return '<label style="display:inline-flex;align-items:center;gap:6px;font-size:12.5px;color:#e6edf6;background:rgba(255,255,255,.04);border:1px solid '+(on?'rgba(0,229,192,.5)':'rgba(255,255,255,.12)')+';border-radius:20px;padding:5px 11px;cursor:pointer">' +
            '<input type="checkbox" value="'+esc(o)+'"'+(on?' checked':'')+' style="accent-color:#00e5c0">'+esc(o)+'</label>';
        }).join('') + '</div>';
    } else {
      inner = '<input id="'+fid(f.key)+'" class="gi-input" type="'+(f.type||'text')+'" value="'+esc(v)+'" placeholder="'+esc(f.placeholder||'')+'" style="'+INP+'">';
    }
    return '<div class="gi-field" style="margin-bottom:13px"'+wrapAttr+'><label style="'+LBL+'">'+esc(f.label)+req+'</label>'+inner+'</div>';
  }

  function render(mount, values){
    var host = typeof mount === 'string' ? document.querySelector(mount) : mount;
    if(!host) return;
    host.innerHTML = SECTIONS.map(function(sec){
      return '<div class="gi-section" style="margin-bottom:18px">' +
        '<div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#00e5c0;font-weight:800;margin:4px 0 11px;padding-bottom:6px;border-bottom:1px solid rgba(0,229,192,.2)">'+esc(sec.title)+'</div>' +
        sec.fields.map(function(f){ return fieldHtml(f, values); }).join('') +
      '</div>';
    }).join('');
    // Conditional show/hide (e.g. ABV only when alcohol = Yes).
    function applyConds(){
      Array.prototype.forEach.call(host.querySelectorAll('.gi-field[data-showif-key]'), function(el){
        var k = el.getAttribute('data-showif-key'), want = el.getAttribute('data-showif-val');
        var driver = host.querySelector('#'+fid(k));
        var val = driver ? driver.value : '';
        el.style.display = (val === want) ? '' : 'none';
      });
    }
    Array.prototype.forEach.call(host.querySelectorAll('select.gi-input, input.gi-input'), function(el){
      el.addEventListener('change', applyConds);
    });
    // Keep the pill borders in sync with checked state.
    Array.prototype.forEach.call(host.querySelectorAll('.gi-multi input[type=checkbox]'), function(cb){
      cb.addEventListener('change', function(){ cb.parentNode.style.borderColor = cb.checked ? 'rgba(0,229,192,.5)' : 'rgba(255,255,255,.12)'; });
    });
    applyConds();
  }

  function readField(host, f){
    var el = host.querySelector('#'+fid(f.key));
    if(!el) return f.type==='multiselect' ? [] : '';
    if(f.type === 'multiselect'){
      return Array.prototype.filter.call(el.querySelectorAll('input[type=checkbox]'), function(c){ return c.checked; }).map(function(c){ return c.value; });
    }
    return (el.value || '').trim();
  }

  function collect(mount){
    var host = typeof mount === 'string' ? document.querySelector(mount) : mount;
    var answers = {}, missing = [];
    if(!host) return { ok:false, answers:answers, missing:['form not found'] };
    SECTIONS.forEach(function(sec){
      sec.fields.forEach(function(f){
        // Skip hidden conditional fields entirely.
        if(f.showIf){
          var driver = host.querySelector('#'+fid(f.showIf.key));
          if(!driver || driver.value !== f.showIf.value) return;
        }
        var v = readField(host, f);
        answers[f.key] = v;
        var empty = f.type==='multiselect' ? !v.length : !String(v).trim();
        if(f.required && empty) missing.push(f.label);
      });
    });
    // Light format checks on the always-present contact fields.
    if(answers.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(answers.email)) missing.push('a valid email');
    if(answers.phone && String(answers.phone).replace(/\D/g,'').length < 10) missing.push('a valid phone number');
    return { ok: missing.length === 0, answers: answers, missing: missing };
  }

  function summary(a){
    a = a || {};
    var lines = [];
    SECTIONS.forEach(function(sec){
      lines.push('— ' + sec.title + ' —');
      sec.fields.forEach(function(f){
        var v = a[f.key];
        if(Array.isArray(v)) v = v.join(', ');
        if(v == null || v === '') return;
        lines.push(f.label + ': ' + v);
      });
      lines.push('');
    });
    return lines.join('\n').trim();
  }

  // Map the intake answers onto the submit_quote_request / deal shape so the
  // tour booking can create a proper pipeline lead.
  function leadPayload(a){
    a = a || {};
    var fmt = a.format || '';
    var service = /bottle|750/i.test(fmt) ? 'Bottling' : (/can/i.test(fmt) ? 'Canning' : '');
    return {
      brand_name:   a.company || '',
      contact_name: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.contact_name || '',
      email:        a.email || '',
      phone:        a.phone || '',
      service:      service || 'Consulting',
      product_type: a.product_category || 'Beverage',
      volume:       a.target_volume || '',
      timeline:     a.timeline || '',
      lead_source:  'Tour request',
      details:      summary(a)
    };
  }

  window.GL_INTAKE = {
    SECTIONS: SECTIONS,
    render: render,
    collect: collect,
    summary: summary,
    leadPayload: leadPayload
  };
})();
