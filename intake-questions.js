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

  var SECTIONS = [
    { key:'product', title:'Product & format', fields:[
      { key:'company',        label:'Brand / company name',   type:'text',     required:true },
      { key:'first_name',     label:'First name',             type:'text',     required:true },
      { key:'last_name',      label:'Last name',              type:'text',     required:true },
      { key:'email',          label:'Email',                  type:'email',    required:true },
      { key:'phone',          label:'Phone',                  type:'tel',      required:true },
      { key:'product_description', label:'What are you making? Describe the product', type:'textarea', required:true, placeholder:'e.g. A yerba-mate energy drink, lightly sweetened, natural citrus flavor' },
      { key:'product_category', label:'Product category', type:'select', required:true,
        options:['Sparkling / seltzer water','Soda','Energy drink','Kombucha','Cold brew / coffee','Tea','Juice','Functional / wellness','RTD cocktail','Hard seltzer','Wine / cider','Other'] },
      { key:'format', label:'Package format', type:'select', required:true,
        options:['12oz standard can','12oz sleek can','16oz can','750ml bottle','Not sure yet'] },
      { key:'target_volume', label:'Target first-run volume', type:'select', required:true,
        options:['200–339 cases','340–500 cases','501–999 cases','1,000–2,499 cases','2,500–4,999 cases','5,000+ cases'] },
      { key:'timeline', label:'Timeline to produce', type:'select', required:true,
        options:['ASAP','1–3 months','3–6 months','6+ months','Just exploring'] }
    ]},
    { key:'formula', title:'Formula & ingredients', fields:[
      { key:'formula_status', label:'Where is your formula?', type:'select', required:true,
        options:['I have a finished, tested formula','I have a draft — needs refinement','I need R&D from scratch'] },
      { key:'ingredients', label:'Key ingredients / short ingredient list', type:'textarea', required:true, placeholder:'e.g. filtered water, cane sugar, yerba mate extract, citric acid, natural flavor' },
      { key:'carbonation', label:'Carbonation', type:'select', required:true,
        options:['Still (no carbonation)','Lightly carbonated','Fully carbonated','Nitro'] },
      { key:'ph_known', label:'Do you know the pH / acidity?', type:'select', required:false,
        options:['Below 4.6 (acidic)','4.6 or above (low-acid)','Not sure'] },
      { key:'allergens', label:'Allergens present (check all)', type:'multiselect', required:true,
        options:['None','Milk','Eggs','Fish','Shellfish','Tree nuts','Peanuts','Wheat / gluten','Soy','Sesame'] },
      { key:'contains_alcohol', label:'Contains alcohol?', type:'select', required:true, options:['No','Yes'] },
      { key:'abv', label:'ABV %', type:'text', required:false, showIf:{ key:'contains_alcohol', value:'Yes' }, placeholder:'e.g. 5.0' }
    ]},
    { key:'packaging', title:'Packaging & labels', fields:[
      { key:'container', label:'Container plan', type:'select', required:true,
        options:['Cans — brite + shrink sleeve / label','Cans — pre-printed (CDL)','Bottles','Not sure yet'] },
      { key:'label_type', label:'Label type', type:'select', required:true,
        options:['Shrink sleeve','Pressure-sensitive label','Pre-printed can','None yet'] },
      { key:'artwork_status', label:'Artwork status', type:'select', required:true,
        options:['Print-ready artwork','In design','Not started'] },
      { key:'secondary_packaging', label:'Secondary packaging (check all)', type:'multiselect', required:false,
        options:['PakTech handles','Trays','Shrink multipack','None / not sure'] }
    ]},
    { key:'compliance', title:'Compliance & certifications', fields:[
      { key:'process_authority', label:'Process authority (PA) letter', type:'select', required:true,
        options:['I have a PA letter','In progress','Don’t have one / need guidance','Not sure what that is'] },
      { key:'nutritional_panel', label:'Nutritional / label panel', type:'select', required:true,
        options:['Have it','Need it','Not sure'] },
      { key:'shelf_stability', label:'Shelf stability', type:'select', required:true,
        options:['Shelf-stable / ambient','Refrigerated / cold-chain','Not sure'] },
      { key:'shelf_life_target', label:'Desired shelf life', type:'text', required:false, placeholder:'e.g. 12 months' },
      { key:'certifications', label:'Certifications needed (check all)', type:'multiselect', required:false,
        options:['Organic','Kosher','Gluten-free','Non-GMO','Vegan','None'] },
      { key:'goals', label:'What do you want to get out of the tour / this project?', type:'textarea', required:true, placeholder:'What you’re hoping to see, decisions you’re trying to make, questions for Mike' }
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
