/* crm-invoice-builder.js — Invoice builder UI, rate card, line calculations, PDF export, AI chat */
(function(){
  'use strict';

  /* glEnsureClients: inline guard (was a private fn in fix.js) */
  function glEnsureClients(){ window.clients = window.clients || []; }

  /* ── CSS: ensure dynamic modals always appear above CRM panel ── */
  (function(){
    var s = document.createElement('style');
    s.textContent =
      '#gl-inv-builder{position:fixed!important;inset:0!important;z-index:650!important;background:rgba(6,13,26,.95)!important;backdrop-filter:blur(16px);display:none;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto}' +
      '#gl-inv-builder.show{display:flex!important}' +
      '#gl-fmt-picker,#gl-rd-picker{position:fixed!important;inset:0!important;z-index:700!important}' +
      '.gl-picker-btn{width:100%;text-align:left;padding:14px 16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:var(--white);cursor:pointer;margin-bottom:8px;display:block;transition:border-color .2s}' +
      '.gl-picker-btn:hover{border-color:var(--teal);background:rgba(0,229,192,.06)}';
    document.head.appendChild(s);
  })();

  /* ── INTERCEPT ALL NEW INVOICE ENTRY POINTS ── */
  window.openNewInvoice = function(){ window.openNewInvoiceBuilder(); };
  document.addEventListener('click', function(e){
    var el = e.target.closest('button,a,.cni');
    if(!el) return;
    if((el.textContent||'').trim().includes('New Invoice')){
      e.preventDefault(); e.stopImmediatePropagation();
      window.openNewInvoiceBuilder();
    }
  }, true);

  /* ── AI CHAT CONTEXT ── */
  window.sendChatMsg=async function(){
    var inp=document.getElementById('gl-chat-input'),msgs=document.getElementById('gl-chat-messages');if(!inp||!msgs)return;
    var msg=inp.value.trim();if(!msg)return;inp.value='';
    msgs.innerHTML+='<div class="chat-msg user">'+msg+'</div><div class="chat-msg bot" id="chat-thinking">Thinking\u2026</div>';msgs.scrollTop=msgs.scrollHeight;
    var reply='';try{reply=await callAI('You are the Good Liquid Bev Co assistant. Key facts: Family-run beverage co-packer, Palmetto FL, Est. 2017. Services: Canning (12oz/16oz), Bottling (750ml), R&D, Consulting. Min order: 150 cases (3,600 units). R&D from $1,000/SKU. Canning from $0.28/can. Timeline: ~8 weeks. GMP, PCQI, HACCP certified. Contact: Mike@GoodLiquid.com (803) 493-5065.',msg);}catch(e){reply='Contact Mike@GoodLiquid.com or call (803) 493-5065.';}
    var t=document.getElementById('chat-thinking');if(t)t.outerHTML='<div class="chat-msg bot">'+String(reply||'').replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];})+'</div>';msgs.scrollTop=msgs.scrollHeight;
  };

  /* ══════════════════════════════════════════════
     INVOICE BUILDER v2.1
     - Qty in CASES, price per CASE from rate card
     - Discount applies correctly
     - Format picker modal for canning
     - RD type picker modal
  ══════════════════════════════════════════════ */

  /* ── RATE CARD (per-CASE pricing) ── */
  var RC = {
    canning: {
      /* [minCases, maxCases, 12ozStd/case, 12ozSleek/case, 16ozStd/case, 12ozStd/can, 12ozSleek/can, 16ozStd/can] */
      tiers: [
        {min:150,  max:339,  cs:{s:11.52,sl:11.52,x:13.92}, cn:{s:0.48,sl:0.48,x:0.58}},
        {min:340,  max:500,  cs:{s:10.32,sl:10.32,x:12.72}, cn:{s:0.43,sl:0.43,x:0.53}},
        {min:501,  max:999,  cs:{s:9.12, sl:9.12, x:11.52}, cn:{s:0.38,sl:0.38,x:0.48}},
        {min:1000, max:2499, cs:{s:8.40, sl:8.40, x:10.80}, cn:{s:0.35,sl:0.35,x:0.45}},
        {min:2500, max:4999, cs:{s:7.44, sl:7.44, x:9.84},  cn:{s:0.31,sl:0.31,x:0.41}},
        {min:5000, max:1e9,  cs:{s:6.72, sl:6.72, x:9.12},  cn:{s:0.28,sl:0.28,x:0.38}}
      ],
      fmtKey: {'12oz-standard':'s','12oz-sleek':'sl','16oz-standard':'x'},
      getTier: function(cases){ return this.tiers.find(function(t){return cases>=t.min&&cases<=t.max;})||this.tiers[0]; },
      perCase: function(fmt,cases){ var k=this.fmtKey[fmt]||'s'; return this.getTier(cases).cs[k]; },
      perCan:  function(fmt,cases){ var k=this.fmtKey[fmt]||'s'; return this.getTier(cases).cn[k]; }
    },
    bottling: {
      tiers: [
        {min:220,  max:659,  perCase:12.96, perBottle:2.16},
        {min:660,  max:1319, perCase:11.46, perBottle:1.91},
        {min:1320, max:2639, perCase:9.48,  perBottle:1.58},
        {min:2640, max:5279, perCase:8.46,  perBottle:1.41},
        {min:5280, max:1e9,  perCase:6.72,  perBottle:1.12}
      ],
      getTier: function(cases){ return this.tiers.find(function(t){return cases>=t.min&&cases<=t.max;})||this.tiers[0]; }
    }
  };

  /* ── HELPERS ── */
  function glFmt(n){return '$'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function glNextId(){var ids=(window.invoices||[]).map(function(i){return parseInt((i.id||'').replace(/\D/g,''))||0;});return 'GL-'+(ids.length?Math.max.apply(null,ids)+1:1001);}

  /* ── STATE ── */
  var INV = null;
  function freshState(){return {clientId:'',lines:[],addons:[{d:'',p:''},{d:'',p:''},{d:'',p:''},{d:'',p:''}],discount:0,notes:'',date:new Date().toISOString().split('T')[0]};}
  function sub(){return INV.lines.reduce(function(s,l){return s+(l.total||0);},0)+INV.addons.reduce(function(s,a){return s+(parseFloat(a.p)||0);},0);}
  function discAmt(){return sub()*(INV.discount/100);}
  function grandTotal(){return sub()-discAmt();}

  /* ── PICKER CALLBACK ── */
  var _pcb = null;

  /* ── FORMAT PICKER ── */
  window.glShowFormatPicker = function(cb){
    _pcb = cb;
    document.getElementById('gl-fmt-picker')?.remove();
    var modal = document.createElement('div');
    modal.id = 'gl-fmt-picker';
    modal.style.cssText = 'position:fixed;inset:0;z-index:700;background:rgba(6,13,26,.95);display:flex;align-items:center;justify-content:center';
    var fmts = [
      {fmt:'12oz-standard',label:'12oz Standard',note:'$0.48 – $0.28 per can'},
      {fmt:'12oz-sleek',   label:'12oz Sleek',   note:'$0.48 – $0.28 per can'},
      {fmt:'16oz-standard',label:'16oz Standard',note:'$0.58 – $0.38 per can'}
    ];
    var html = '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:28px;width:380px">' +
      '<div style="font-family:var(--ff-disp);font-size:16px;letter-spacing:2px;color:var(--white);margin-bottom:6px">SELECT CAN FORMAT</div>' +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:20px">Price per case auto-calculates based on quantity entered</div>';
    fmts.forEach(function(f){
      html += '<button class="gl-fmt-btn" data-fmt="'+f.fmt+'" style="width:100%;text-align:left;padding:14px 16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:var(--white);cursor:pointer;margin-bottom:8px;display:block">' +
        '<div style="font-weight:700;font-size:14px;margin-bottom:3px">&#x1F9C3; '+f.label+'</div>' +
        '<div style="font-size:11px;color:var(--muted)">'+f.note+' &nbsp;·&nbsp; 24 cans/case</div></button>';
    });
    html += '<button class="gl-fmt-cancel" style="width:100%;padding:10px;background:none;border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--muted);cursor:pointer;margin-top:4px">Cancel</button></div>';
    modal.innerHTML = html;
    modal.addEventListener('click',function(e){
      var b=e.target.closest('.gl-fmt-btn');
      if(b){modal.remove();if(_pcb){_pcb(b.getAttribute('data-fmt'));_pcb=null;}return;}
      if(e.target.closest('.gl-fmt-cancel')||e.target===modal){modal.remove();_pcb=null;}
    });
    document.body.appendChild(modal);
  };

  /* ── TOTALS BOX ── */
  function renderTotals(){
    var s=sub(),d=discAmt(),t=grandTotal();
    return '<div style="font-size:12px;color:var(--muted);display:flex;justify-content:space-between;margin-bottom:8px"><span>Subtotal</span><span style="color:var(--white)">'+glFmt(s)+'</span></div>' +
      (d>0?'<div style="font-size:12px;color:#e74c3c;display:flex;justify-content:space-between;margin-bottom:8px"><span>Discount ('+INV.discount+'%)</span><span>\u2212'+glFmt(d)+'</span></div>':'')+
      '<div style="display:flex;justify-content:space-between;padding-top:8px;border-top:1px solid rgba(255,255,255,.07)">'+
        '<span style="font-size:14px;font-weight:700;color:var(--white)">TOTAL DUE</span>'+
        '<span style="font-family:var(--ff-disp);font-size:22px;background:linear-gradient(135deg,var(--teal),#1a6fff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">'+glFmt(t)+'</span>'+
      '</div><div style="font-size:10px;color:var(--muted);margin-top:6px;text-align:right">Due upon receipt</div>';
  }

  function refreshTotals(){
    var box=document.getElementById('ginv-totals-box');
    if(box)box.innerHTML=renderTotals();
    (INV.lines||[]).forEach(function(l,i){
      var el=document.getElementById('ginv-lt-'+i);
      if(el)el.textContent=glFmt(l.total||0);
    });
  }
  window.glApplyDiscount=function(v){INV.discount=parseFloat(v)||0;refreshTotals();};

  /* ── LINE RENDER ── */
  function renderLine(l,i){
    return '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 36px;gap:0;padding:10px 12px;border-top:1px solid rgba(255,255,255,.05);align-items:start">' +
      '<div>' +
        '<div style="font-size:13px;font-weight:600;color:var(--white);margin-bottom:2px">'+l.description+'</div>' +
        (l.note?'<div style="font-size:10px;color:var(--muted)">'+l.note+'</div>':'') +
        (l.editable?'<input class="finp" placeholder="Description" value="'+l.description+'" oninput="glInvState_lines_desc('+i+',this.value)" style="margin-top:4px;font-size:12px;padding:4px 8px;width:100%">':'') +
      '</div>' +
      '<div style="text-align:center">' +
        '<input class="finp" type="number" min="0" value="'+(l.qty||'')+'" placeholder="0" oninput="glUpdLine('+i+',this.value)" style="width:80px;text-align:center;font-size:13px;padding:4px">'+
        '<div style="font-size:10px;color:var(--muted);margin-top:2px">'+(l.unit||'')+'</div>' +
      '</div>' +
      '<div style="text-align:center">' +
        '<input class="finp" type="number" min="0" step="0.01" value="'+(l.unitPrice||'')+'" placeholder="0.00" oninput="glUpdLinePrice('+i+',this.value)" style="width:90px;text-align:center;font-size:13px;padding:4px">' +
      '</div>' +
      '<div id="ginv-lt-'+i+'" style="text-align:right;font-weight:700;color:var(--teal);font-size:13px;padding-top:6px">'+glFmt(l.total||0)+'</div>' +
      '<div style="text-align:center;padding-top:4px"><button onclick="glRemLine('+i+')" style="background:none;border:none;color:rgba(231,76,60,.6);cursor:pointer;font-size:16px;padding:4px">&#x2715;</button></div>' +
    '</div>';
  }

  /* ── LINE UPDATE ── */
  window.glInvState_lines_desc = function(i,v){if(INV&&INV.lines[i])INV.lines[i].description=v;};
  window.glUpdLine = function(i,v){
    if(!INV||!INV.lines[i])return;
    var l=INV.lines[i];
    l.qty=parseFloat(v)||0;
    if(l.type==='canning'&&l.qty>0){
      l.unitPrice=RC.canning.perCase(l.canType||'12oz-standard',l.qty);
      var pc=RC.canning.perCan(l.canType||'12oz-standard',l.qty);
      l.note=glFmt(pc)+'/can \u00b7 '+glFmt(l.unitPrice)+'/case \u00b7 '+(l.qty*24).toLocaleString()+' total cans';
      var upEl=document.querySelector('[oninput="glUpdLinePrice('+i+',this.value)"]');
      if(upEl)upEl.value=l.unitPrice.toFixed(2);
      var noteEl=document.querySelector('[style*="font-size:10px;color:var(--muted)"]');
    }
    if(l.type==='bottling'&&l.qty>0){
      var bt=RC.bottling.getTier(l.qty);
      l.unitPrice=bt.perCase;
      l.note=glFmt(bt.perBottle)+'/bottle \u00b7 '+glFmt(bt.perCase)+'/case (6 bottles) \u00b7 '+(l.qty*6).toLocaleString()+' total bottles';
      var bpEl=document.querySelector('[oninput="glUpdLinePrice('+i+',this.value)"]');
      if(bpEl)bpEl.value=bt.perCase.toFixed(2);
    }
    l.total=l.qty*(l.unitPrice||0);
    refreshTotals();
    // Update note display
    var noteEl2=document.getElementById('ginv-note-'+i);
    if(noteEl2)noteEl2.textContent=l.note||'';
  };
  window.glUpdLinePrice=function(i,v){if(!INV||!INV.lines[i])return;INV.lines[i].unitPrice=parseFloat(v)||0;INV.lines[i].total=INV.lines[i].qty*INV.lines[i].unitPrice;refreshTotals();};
  window.glRemLine=function(i){if(!INV)return;INV.lines.splice(i,1);glRenderBuilder();};

  /* ── ADD LINE ── */
  /* Legacy glAddLine (INV-model) removed \u2014 the live entry point is the
     DOM-based override defined later in this file. Kept as a no-op so any
     straggler caller fails fast instead of mutating dead state. */
  window.glAddLine=function(){};

  /* ── RENDER BUILDER ── */
  function glRenderBuilder(){
    var body=document.getElementById('gl-inv-body');if(!body)return;
    glEnsureClients();
    var clients=window.clients||[];
    body.innerHTML=
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">'+
        '<div><div class="flbl">Client *</div>'+
          '<select class="fsel" id="ginv-client" onchange="if(window.INV)window.INV.clientId=this.value;if(typeof window.glOnInvClientChange===&quot;function&quot;)window.glOnInvClientChange(this.value)" style="width:100%">'+
            '<option value="">Select client\u2026</option>'+
            clients.map(function(c){return '<option value="'+c.id+'"'+(INV.clientId===c.id?' selected':'')+'>'+c.name+'</option>';}).join('')+
          '</select></div>'+
        '<div><div class="flbl">Invoice date</div><input class="finp" type="date" id="ginv-date" value="'+INV.date+'" onchange="if(window.INV)window.INV.date=this.value"></div>'+
        '<div><div class="flbl">Invoice #</div><input class="finp" id="ginv-id" value="'+glNextId()+'" readonly style="opacity:.6"></div>'+
      '</div>'+

      '<div style="font-size:11px;letter-spacing:2px;color:var(--teal);margin-bottom:10px">LINE ITEMS</div>'+
      '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.07);border-radius:10px;overflow:hidden;margin-bottom:12px">'+
        '<div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 36px;gap:0;background:rgba(255,255,255,.04);padding:8px 12px">'+
          '<div style="font-size:10px;letter-spacing:1px;color:var(--muted)">DESCRIPTION</div>'+
          '<div style="font-size:10px;letter-spacing:1px;color:var(--muted);text-align:center">QTY</div>'+
          '<div style="font-size:10px;letter-spacing:1px;color:var(--muted);text-align:center">$/CASE OR $/UNIT</div>'+
          '<div style="font-size:10px;letter-spacing:1px;color:var(--muted);text-align:right">TOTAL</div>'+
          '<div></div>'+
        '</div>'+
        (INV.lines.length?INV.lines.map(renderLine).join(''):'<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">No line items yet. Add one below.</div>')+
      '</div>'+

      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px">'+
        '<button onclick="glAddLine(\'canning\')" class="cbtn" style="font-size:11px">+ &#x1F9C3; Canning</button>'+
        '<button onclick="glAddLine(\'bottling\')" class="cbtn" style="font-size:11px">+ &#x1F37E; Bottling</button>'+
        '<button onclick="glAddLine(\'rd\')" class="cbtn" style="font-size:11px">+ &#x1F9EA; R&amp;D / IP</button>'+
        '<button onclick="glAddLine(\'hours\')" class="cbtn" style="font-size:11px">+ &#x23F1; Production Hours</button>'+
        '<button onclick="glAddLine(\'custom\')" class="cbtn" style="font-size:11px;background:rgba(0,229,192,.08);border-color:rgba(0,229,192,.3);color:var(--teal)">+ &#x270F;&#xFE0F; Custom Line</button>'+
      '</div>'+

      '<div style="font-size:11px;letter-spacing:2px;color:var(--teal);margin-bottom:10px">ADD-ONS (manual)</div>'+
      '<div style="margin-bottom:20px">'+
        INV.addons.map(function(a,i){
          return '<div style="display:grid;grid-template-columns:1fr 130px;gap:8px;margin-bottom:8px">'+
            '<input class="finp" placeholder="Add-on description (e.g. Kratom filter, Shrink wrap)" value="'+(a.d||'')+'" oninput="if(window.INV)window.INV.addons['+i+'].d=this.value;glApplyDiscount(document.getElementById(\'ginv-disc\')?.value||0)">'+
            '<input class="finp" type="number" placeholder="$0.00" value="'+(a.p||'')+'" oninput="if(window.INV)window.INV.addons['+i+'].p=this.value;glApplyDiscount(document.getElementById(\'ginv-disc\')?.value||0)">'+
          '</div>';
        }).join('')+
      '</div>'+

      '<div style="margin-bottom:20px"><div class="flbl">Notes / payment instructions</div>'+
        '<textarea class="finp" rows="2" placeholder="e.g. 50% deposit required before production begins." oninput="if(window.INV)window.INV.notes=this.value" style="resize:none;font-size:13px">'+(INV.notes||'')+'</textarea></div>'+

      '<div style="display:grid;grid-template-columns:1fr 260px;gap:20px;align-items:end;margin-bottom:20px">'+
        '<div><div class="flbl">Discount (%)</div>'+
          '<div style="display:flex;align-items:center;gap:8px">'+
            '<input class="finp" type="number" id="ginv-disc" min="0" max="100" placeholder="0" value="'+(INV.discount||'')+'" oninput="glApplyDiscount(this.value)" style="width:100px;font-size:14px">'+
            '<span style="font-size:13px;color:var(--muted)">% off subtotal</span>'+
          '</div></div>'+
        '<div id="ginv-totals-box" style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:16px">'+renderTotals()+'</div>'+
      '</div>'+

      '<div style="display:flex;gap:10px;padding-top:16px;border-top:1px solid rgba(255,255,255,.07)">'+
        '<button onclick="glSaveInvoice()" class="cbtn pri" style="flex:1;font-size:14px">&#x1F4BE; Save Invoice</button>'+
        '<button onclick="glSaveAndSend()" class="cbtn" style="flex:1;font-size:14px;background:rgba(26,111,255,.12);border-color:rgba(26,111,255,.35);color:#6b9fff">&#x1F4E4; Save &amp; Send</button>'+
        '<button onclick="glExportPDF()" class="cbtn" style="flex:1;font-size:14px;background:rgba(0,229,192,.08);border-color:rgba(0,229,192,.3);color:var(--teal)">&#x1F4C4; Save &amp; Export PDF</button>'+
        '<button onclick="document.getElementById(\'gl-inv-builder\').classList.remove(\'show\')" class="cbtn" style="font-size:14px">Cancel</button>'+
      '</div>';
  }

  /* ── OPEN BUILDER ── */
  window.openNewInvoiceBuilder = function(){
    glEnsureClients();
    INV = freshState();
    window.INV = INV; // expose for oninput handlers
    var existing = document.getElementById('gl-inv-builder');
    if(!existing){
      var ov=document.createElement('div');ov.id='gl-inv-builder';ov.className='modal-ov show';
      ov.style.cssText='align-items:flex-start;padding:20px;overflow-y:auto';
      ov.innerHTML='<div style="background:#0a1628;border:1px solid rgba(0,229,192,.18);border-radius:18px;width:100%;max-width:820px;margin:0 auto;overflow:hidden">'+
        '<div style="background:#142238;padding:18px 24px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(255,255,255,.07)">'+
          '<div style="display:flex;align-items:center;gap:10px"><div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:2px;color:var(--white)">NEW INVOICE</div><span id="gl-inv-pricing-badge" style="display:none;font-size:10px;letter-spacing:1.5px;padding:3px 8px;border-radius:4px;background:rgba(245,200,66,.14);color:#f5c842;font-weight:700"></span></div>'+
          '<button onclick="document.getElementById(\'gl-inv-builder\').classList.remove(\'show\')" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer">&#x2715;</button>'+
        '</div>'+
        '<div style="padding:24px" id="gl-inv-body"></div>'+
      '</div>';
      document.body.appendChild(ov);
    } else {
      existing.classList.add('show');
    }
    glRenderBuilder();
    // Pre-load client rate overrides if the builder opened with a client
    // already pre-set (e.g. "Create invoice for this client" from the
    // client detail page). Triggers the same re-render hook the dropdown
    // onchange uses so the badge + row rates are correct on first paint.
    if(INV && INV.clientId && typeof window.glOnInvClientChange === 'function'){
      window.glOnInvClientChange(INV.clientId);
    }
  };

  /* Legacy glSaveInvoice (INV-model) removed — overridden later by the
     DOM-based save flow that reads from [data-gl-total] rows. The override
     at line ~1577 is what actually persists invoices today. */
  window.glSaveInvoice = function(){};

  /* ── EXPORT PDF ── */
  window.glExportPDF = function(){
    var inv=window.glSaveInvoice();if(!inv)return;
    var client=(window.clients||[]).find(function(c){return c.id===inv.client;}) || {};
    // Build a proper Bill To block from the client's billing address.
    var useBilling = client.billingSame === false && (client.billingStreet || client.billingCity);
    var bStreet = useBilling ? client.billingStreet : client.street;
    var bCity   = useBilling ? client.billingCity   : client.city;
    var bState  = useBilling ? client.billingState  : client.state;
    var bZip    = useBilling ? client.billingZip    : client.zip;
    var bLine2  = [bCity, bState].filter(Boolean).join(', ') + (bZip ? ' ' + bZip : '');
    var billToHtml = '<div style="font-weight:700">' + (client.legalName || client.name || inv.clientName || '') + '</div>'
      + (client.legalName && client.legalName !== client.name ? '<div style="color:#666;font-size:11px">dba ' + client.name + '</div>' : '')
      + (bStreet ? '<div style="color:#444;font-size:12px;margin-top:2px">' + bStreet + '</div>' : '')
      + (bLine2.trim() ? '<div style="color:#444;font-size:12px">' + bLine2 + '</div>' : '')
      + (client.contact ? '<div style="color:#666;font-size:11px;margin-top:3px">Attn: ' + client.contact + '</div>' : '')
      + (client.email || inv.clientEmail ? '<div style="color:#666;font-size:11px">' + (client.email || inv.clientEmail) + '</div>' : '');
    var terms = inv.paymentTerms || client.paymentTerms || 'Due on receipt';
    var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;margin:0;padding:40px;color:#1a1a2e;font-size:13px}.header{display:flex;justify-content:space-between;margin-bottom:40px}.brand{font-size:28px;font-weight:900;letter-spacing:2px}.brand span{color:#00e5c0}table{width:100%;border-collapse:collapse;margin-bottom:20px}th{background:#0a1628;color:#fff;padding:10px 12px;text-align:left;font-size:11px}td{padding:10px 12px;border-bottom:1px solid #eee;font-size:12px}tr:nth-child(even)td{background:#f9f9f9}.grand{font-size:18px;color:#00e5c0;font-weight:900}.footer{margin-top:40px;padding-top:20px;border-top:2px solid #eee;font-size:11px;color:#999;display:flex;justify-content:space-between}.badge{display:inline-block;background:#e8fff9;border:1px solid #00e5c0;color:#00695c;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700}</style></head><body>'+
      '<div class="header"><div><div class="brand">GOOD <span>LIQUID</span> BEV CO</div><div style="font-size:11px;color:#666;margin-top:6px;line-height:1.8">2011 51st Ave E, Unit 100<br>Palmetto, FL 34221<br>Mike@GoodLiquid.com &middot; (803) 493-5065<br>goodliquidbevco.com</div><div style="margin-top:8px"><span class="badge">GMP</span>&nbsp;<span class="badge">PCQI</span>&nbsp;<span class="badge">HACCP</span></div></div>'+
      '<div style="text-align:right"><h2 style="font-size:22px;margin:0 0 4px">INVOICE</h2><div><b>Invoice #:</b> '+inv.id+'</div><div><b>Date:</b> '+inv.date+'</div><div><b>Terms:</b> '+terms+'</div></div></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px"><div><div style="font-size:10px;letter-spacing:2px;color:#999;margin-bottom:4px">BILL TO</div>'+billToHtml+'</div></div>'+
      '<table><thead><tr><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:center">Unit</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead><tbody>'+
      inv.lines.map(function(l){return '<tr><td>'+l.desc+'</td><td style="text-align:center">'+Number(l.qty||0).toLocaleString()+'</td><td style="text-align:center">'+(l.unit||'')+'</td><td style="text-align:right">'+glFmt(l.unitPrice||0)+'</td><td style="text-align:right;font-weight:600">'+glFmt(l.total||0)+'</td></tr>';}).join('')+
      '<tr style="background:#f5f5f5"><td colspan="4" style="text-align:right;font-weight:600">Subtotal</td><td style="text-align:right;font-weight:700">'+glFmt(inv.subtotal)+'</td></tr>'+
      (inv.discountAmt>0?'<tr><td colspan="4" style="text-align:right;color:#c0392b">Discount ('+inv.discount+'%)</td><td style="text-align:right;color:#c0392b;font-weight:700">&minus;'+glFmt(inv.discountAmt)+'</td></tr>':'')+
      '<tr style="background:#e8fff9"><td colspan="4" style="text-align:right;font-size:15px;font-weight:700">TOTAL DUE</td><td style="text-align:right"><span class="grand">'+glFmt(inv.amount)+'</span></td></tr>'+
      '</tbody></table>'+(inv.notes?'<div style="background:#f9f9f9;border:1px solid #eee;border-radius:8px;padding:14px;margin-bottom:20px"><div style="font-size:10px;letter-spacing:2px;color:#999;margin-bottom:4px">NOTES</div><div style="font-size:12px;color:#444;line-height:1.6">'+inv.notes+'</div></div>':'')+
      '<div class="footer"><div><b>Good Liquid Bev Co</b><br>Thank you for your business.</div><div style="text-align:right">Questions? Mike@GoodLiquid.com<br>(803) 493-5065</div></div></body></html>';
    var w=window.open('','_blank','width=900,height=700');w.document.write(html);w.document.close();w.onload=function(){w.focus();w.print();};
    if(typeof addNotification==='function')addNotification('PDF generated','Invoice '+inv.id+' ready to print/save','success');
  };

}());
