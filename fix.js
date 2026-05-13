/* fix.js v2.1 — Good Liquid Bev Co
   All patches in one file. Loaded after index.html.
   DO NOT use Ctrl+S on index.html — only deploy fix.js */
(function(){
  'use strict';

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


  /* ── FIX FOOTER LINKS ──────────────────────────────
     Footer links have escaped quotes in onclick attr.
     Override with direct event listeners instead.
  ────────────────────────────────────────────────── */
  (function fixFooterLinks(){
    var sections = {
      'About': 'about', 'Services': 'services', 'Pricing': 'pricing',
      'Certifications': 'certifications', 'Team': 'team', 'Get a Quote': 'contact'
    };
    // Run after DOM ready
    function attach(){
      var footerLinks = Array.from(document.querySelectorAll('footer a, [class*="footer"] a, .site-footer a'));
      footerLinks.forEach(function(a){
        var text = a.textContent.trim();
        if(sections[text]){
          a.href = 'javascript:void(0)';
          a.removeAttribute('onclick');
          a.addEventListener('click', function(e){
            e.preventDefault();
            window.navTo(sections[text]);
          });
        }
      });
      // Also fix nav links that might have broken onclick
      var navLinks = Array.from(document.querySelectorAll('nav a, #main-nav a, .nav-links a'));
      navLinks.forEach(function(a){
        var text = a.textContent.trim();
        if(sections[text]){
          a.href = 'javascript:void(0)';
          a.removeAttribute('onclick');
          a.addEventListener('click', function(e){
            e.preventDefault();
            window.navTo(sections[text]);
          });
        }
      });
    }
    if(document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', attach);
    } else {
      attach();
    }
    setTimeout(attach, 500); // run again after dynamic content loads
  })();

  /* ── INTERCEPT ALL NEW INVOICE ENTRY POINTS ── */
  var _cNavOrig = window.cNav;
  window.cNav = function(page, el){
    if(page==='newinv'||page==='new-invoice'||page==='newInvoice'){
      window.openNewInvoiceBuilder(); return;
    }
    if(typeof _cNavOrig==='function') _cNavOrig(page, el);
  };
  window.openNewInvoice = function(){ window.openNewInvoiceBuilder(); };
  document.addEventListener('click', function(e){
    var el = e.target.closest('button,a,.cni');
    if(!el) return;
    if((el.textContent||'').trim().includes('New Invoice')){
      e.preventDefault(); e.stopImmediatePropagation();
      window.openNewInvoiceBuilder();
    }
  }, true);

  /* ── CORE USERS ── */
  var coreUsers = [
    {id:'u1',name:'Mike Krail',email:'mike@goodliquid.com',password:'GL2026admin',role:'admin',status:'active',initials:'MK',color:'#f5c842',tc:'#0a1628',lastLogin:'Never'},
    {id:'u2',name:'Sandra Krail',email:'sandra@goodliquid.com',password:'GL2026ops',role:'sales',status:'active',initials:'SK',color:'#1a6fff',tc:'#fff',lastLogin:'Never'}
  ];
  if(!window.users||window.users.length===0){window.users=coreUsers;}
  else{coreUsers.forEach(function(cu){var ex=window.users.find(function(u){return u.email===cu.email;});if(ex)ex.role=cu.role;else window.users.unshift(cu);});}

  /* ── CORE CLIENTS ── */
  function glEnsureClients(){
    if(!window.clients||window.clients.length===0){
      window.clients=[
        {id:'c1',name:'Tide & Taste Co.',email:'contact@tidetaste.com',service:'Canning',status:'active'},
        {id:'c2',name:'Bloom Functional',email:'hello@bloomfunctional.com',service:'R&D',status:'active'},
        {id:'c3',name:'SunBurst Seltzers',email:'mike@sunburst.com',service:'Canning',status:'active'},
        {id:'c4',name:'Harbor Brew Co.',email:'info@harborbrew.com',service:'Bottling',status:'active'},
        {id:'c5',name:'Prism Hydration',email:'orders@prismh2o.com',service:'Canning',status:'lead'},
        {id:'c6',name:'NorthWave Drinks',email:'hello@northwave.com',service:'Canning',status:'lead'},
        {id:'c7',name:'Peak Performance',email:'ops@peakperformance.com',service:'R&D',status:'active'},
        {id:'c8',name:'Coastal Craft',email:'info@coastalcraft.com',service:'Bottling',status:'active'}
      ];
    }
  }
  glEnsureClients();

  /* ── PERMISSIONS ── */
  var ALL=['dashboard','clients','pipeline','invoices','invoice-detail','new-invoice','referrals','referrers','activity','users','customers','calendar','production-cal','tasks','documents','inventory','announcements','time-tracker','reports','ai-settings'];
  if(window.PERMISSIONS){window.PERMISSIONS.admin=ALL;window.PERMISSIONS.sales=['dashboard','clients','pipeline','invoices','new-invoice','referrals','referrers','activity','calendar','production-cal','tasks','announcements','reports'];}
  else{window.PERMISSIONS={admin:ALL,sales:['dashboard','clients','pipeline','invoices','new-invoice','referrals','referrers','activity','calendar','production-cal','tasks','announcements','reports'],viewer:['dashboard','clients','invoices','activity']};}
  window.can=function(page){var u=window.currentUser;if(!u)return false;if(u.role==='admin')return true;return(window.PERMISSIONS[u.role]||[]).includes(page);};
  var _cNavOrig2=window.cNav;
  window.cNav=function(page,el){if(!window.can(page)){if(typeof addNotification==='function')addNotification('Access denied',page,'warning');return;}if(typeof _cNavOrig2==='function')_cNavOrig2(page,el);};

  /* ── FIX DOM STRUCTURE ── */
  function fixDOMStructure(){
    var panel=document.getElementById('crm-panel'),top=document.getElementById('crm-top'),body=document.getElementById('crm-body'),notif=document.getElementById('notif-panel'),ov=document.getElementById('cnav-overlay');
    if(!panel||!top||!body)return;
    if(notif&&notif.parentElement===top)panel.appendChild(notif);
    if(ov&&ov.parentElement===top)panel.appendChild(ov);
    if(body.parentElement===top)panel.appendChild(body);
  }
  fixDOMStructure();
  document.addEventListener('DOMContentLoaded',fixDOMStructure);
  setTimeout(fixDOMStructure,100);

  /* ── CHAT BUBBLE — admin only ── */
  setTimeout(function(){
    var b=document.getElementById('gl-chat-bubble'),w=document.getElementById('gl-chat-window'),p=document.getElementById('crm-panel');
    if(!b||!p)return;b.style.display='none';
    new MutationObserver(function(){var o=p.classList.contains('show');b.style.display=o?'flex':'none';if(!o&&w)w.classList.remove('show');}).observe(p,{attributes:true,attributeFilter:['class']});
  },200);

  /* ── NAV / EXIT ── */
  window.navTo=function(id){
    // Close CRM if open
    var p=document.getElementById('crm-panel');
    if(p&&p.classList.contains('show')){p.classList.remove('show');document.body.style.overflow='';}
    // Close mobile nav
    var n=document.getElementById('nav-links-list');if(n)n.classList.remove('mobile-open');
    // Ensure body can scroll
    document.body.style.overflow='';
    document.documentElement.style.overflow='';
    // Scroll to section
    function doScroll(){
      var el=document.getElementById(id);
      if(!el){console.log('[GL] navTo: section not found:',id);return;}
      var top=el.getBoundingClientRect().top+window.pageYOffset-70;
      window.scrollTo({top:Math.max(0,top),behavior:'smooth'});
    }
    setTimeout(doScroll, 80);
  };
  window.exitCRM=function(){
    var p=document.getElementById('crm-panel');if(p)p.classList.remove('show');
    document.body.style.overflow='';
    var b=document.getElementById('gl-chat-bubble');if(b)b.style.display='none';
  };

  /* ── LOGIN USER ── */
  window.loginUser=function(u){
    window.currentUser=u;u.lastLogin='Just now';fixDOMStructure();
    if(typeof closePw==='function')closePw();
    var $=function(id){return document.getElementById(id);};
    if($('crm-av-init'))$('crm-av-init').textContent=u.initials||u.name[0].toUpperCase();
    if($('crm-user-name'))$('crm-user-name').textContent=u.name;
    var rb=$('crm-role-badge');
    if(rb){rb.textContent=u.role.charAt(0).toUpperCase()+u.role.slice(1);rb.style.cssText=u.role==='admin'?'background:rgba(245,200,66,.12);color:#d4a200;border:1px solid rgba(245,200,66,.25)':u.role==='sales'?'background:rgba(26,111,255,.12);color:#6b9fff;border:1px solid rgba(26,111,255,.25)':'background:rgba(255,255,255,.06);color:#6b87ad';}
    if(u.role==='admin'){var nu=$('nav-users'),nc=$('nav-customers');if(nu)nu.style.display='flex';if(nc)nc.style.display='flex';}
    var panel=$('crm-panel');if(panel)panel.classList.add('show');document.body.style.overflow='hidden';
    if(!window.crmInited&&typeof initCRM==='function')initCRM();
    if(typeof addAIToolbar==='function')addAIToolbar();
    if(typeof addNotifBadge==='function')addNotifBadge();
    if(typeof checkStaleDeals==='function')checkStaleDeals();
    if(typeof loadNotifications==='function')loadNotifications();
    setTimeout(function(){var n=document.querySelector('.cnav');if(n)n.scrollTop=0;},150);
  };

  /* ── checkPw ── */
  window.checkPw=async function(){
    var eEl=document.getElementById('pw-email'),pEl=document.getElementById('pw-input'),err=document.getElementById('pw-err');
    if(!eEl||!pEl)return;
    var email=eEl.value.trim().toLowerCase(),pw=pEl.value;
    if(err)err.style.display='none';
    function showErr(){if(err)err.style.display='block';pEl.classList.add('wrong');setTimeout(function(){pEl.classList.remove('wrong');},500);}
    if(window.customerLogins){var c=window.customerLogins.find(function(x){return x.email.toLowerCase()===email&&x.password===pw;});if(c){window.currentPortalUser=c;if(typeof closePw==='function')closePw();if(typeof openCustomerPortal==='function')openCustomerPortal(c);return;}}
    var sbKey=localStorage.getItem('gl_supabase_key');
    if(sbKey){try{var res=await fetch('https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1/crm_users?email=eq.'+encodeURIComponent(email)+'&select=password_hash',{headers:{'apikey':sbKey,'Authorization':'Bearer '+sbKey}});var rows=await res.json();if(Array.isArray(rows)&&rows.length>0&&rows[0].password_hash){if(atob(rows[0].password_hash)!==pw){showErr();return;}var u=(window.users||[]).find(function(x){return x.email.toLowerCase()===email;});if(u){window.loginUser(u);return;}window.loginUser({id:'sb'+Date.now(),name:email.split('@')[0],email:email,password:pw,role:'sales',initials:email[0].toUpperCase(),color:'#1a6fff',tc:'#fff',status:'active',lastLogin:'Just now'});return;}}catch(e){console.log('[GL]',e.message);}}
    var u=(window.users||[]).find(function(x){return x.email.toLowerCase()===email&&x.password===pw&&x.status==='active';});
    if(!u){showErr();return;}window.loginUser(u);
  };

  /* ── syncPasswordToSupabase ── */
  window.syncPasswordToSupabase=async function(email,pw){
    var k=localStorage.getItem('gl_supabase_key');if(!k)return;
    try{await fetch('https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1/crm_users',{method:'POST',headers:{'apikey':k,'Authorization':'Bearer '+k,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},body:JSON.stringify({email:email.toLowerCase(),password_hash:btoa(pw),updated_at:new Date().toISOString()})});}catch(e){}
  };

  /* ── SEO ── */
  (function(){
    var h=document.head;
    function m(a){var s=a.name?'meta[name="'+a.name+'"]':a.property?'meta[property="'+a.property+'"]':null;if(s&&document.querySelector(s))return;var el=document.createElement('meta');Object.keys(a).forEach(function(k){el.setAttribute(k,a[k]);});h.appendChild(el);}
    document.title='Good Liquid Bev Co | Beverage Co-Packer | Palmetto, FL';
    m({name:'description',content:'Family-run beverage co-packer in Palmetto, FL. Small-batch canning, bottling & R&D. GMP, PCQI & HACCP certified. Min 150 cases.'});
    m({name:'robots',content:'index, follow'});
    m({property:'og:title',content:'Good Liquid Bev Co | Beverage Co-Packer'});
    m({property:'og:description',content:'Family-run beverage co-packer in Palmetto, FL. Min 150 cases. GMP certified.'});
    m({property:'og:url',content:'https://www.goodliquidbevco.com'});
    m({name:'twitter:card',content:'summary_large_image'});
    if(!document.querySelector('link[rel="canonical"]')){var l=document.createElement('link');l.rel='canonical';l.href='https://www.goodliquidbevco.com';h.appendChild(l);}
    if(!document.getElementById('gl-schema')){var s=document.createElement('script');s.id='gl-schema';s.type='application/ld+json';s.textContent=JSON.stringify({'@context':'https://schema.org','@type':'LocalBusiness','name':'Good Liquid Bev Co','telephone':'+18034935065','email':'Mike@GoodLiquid.com','foundingDate':'2017','address':{'@type':'PostalAddress','streetAddress':'2011 51st Ave E, Unit 100','addressLocality':'Palmetto','addressRegion':'FL','postalCode':'34221','addressCountry':'US'}});h.appendChild(s);}
  })();

  /* ── GA4 ── */
  (function(){
    var id=localStorage.getItem('gl_ga_id');if(!id)return;
    if(document.querySelector('script[src*="googletagmanager"]'))return;
    var s=document.createElement('script');s.async=true;s.src='https://www.googletagmanager.com/gtag/js?id='+id;document.head.appendChild(s);
    window.dataLayer=window.dataLayer||[];window.gtag=function(){window.dataLayer.push(arguments);};window.gtag('js',new Date());window.gtag('config',id,{anonymize_ip:true});
  })();

  /* ── AI CHAT CONTEXT ── */
  window.sendChatMsg=async function(){
    var inp=document.getElementById('gl-chat-input'),msgs=document.getElementById('gl-chat-messages');if(!inp||!msgs)return;
    var msg=inp.value.trim();if(!msg)return;inp.value='';
    msgs.innerHTML+='<div class="chat-msg user">'+msg+'</div><div class="chat-msg bot" id="chat-thinking">Thinking\u2026</div>';msgs.scrollTop=msgs.scrollHeight;
    var reply='';try{reply=await callAI('You are the Good Liquid Bev Co assistant. Key facts: Family-run beverage co-packer, Palmetto FL, Est. 2017. Services: Canning (12oz/16oz), Bottling (750ml), R&D, Consulting. Min order: 150 cases (3,600 units). R&D from $1,000/SKU. Canning from $0.28/can. Timeline: ~8 weeks. GMP, PCQI, HACCP certified. Contact: Mike@GoodLiquid.com (803) 493-5065.',msg);}catch(e){reply='Contact Mike@GoodLiquid.com or call (803) 493-5065.';}
    var t=document.getElementById('chat-thinking');if(t)t.outerHTML='<div class="chat-msg bot">'+reply+'</div>';msgs.scrollTop=msgs.scrollHeight;
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

  /* ── RD PICKER ── */
  window.glShowRDPicker = function(cb){
    _pcb = cb;
    document.getElementById('gl-rd-picker')?.remove();
    var opts = [
      {label:'R&D Formulation',    price:1000, unit:'SKU', note:'$1,000/SKU · 3 iterations included', icon:'&#x1F9EA;'},
      {label:'Benchtop Verification',price:500,unit:'SKU', note:'$500/SKU · Required for co-packing',  icon:'&#x1F52C;'},
      {label:'IP License',         price:6000, unit:'yr',  note:'$6,000/yr · Annual licensing',        icon:'&#x1F4DC;'},
      {label:'IP Purchase',        price:15000,unit:'',    note:'$15,000 · Full ownership',            icon:'&#x1F3C6;'},
      {label:'Materials Sourcing', price:0,    unit:'',    note:'Cost+10% · Enter actual cost in Unit Price',icon:'&#x1F4E6;'}
    ];
    var modal = document.createElement('div');
    modal.id = 'gl-rd-picker';
    modal.style.cssText = 'position:fixed;inset:0;z-index:700;background:rgba(6,13,26,.95);display:flex;align-items:center;justify-content:center';
    var html = '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:28px;width:400px">' +
      '<div style="font-family:var(--ff-disp);font-size:16px;letter-spacing:2px;color:var(--white);margin-bottom:20px">SELECT R&D / IP SERVICE</div>';
    opts.forEach(function(o,i){
      html += '<button class="gl-rd-btn" data-idx="'+i+'" style="width:100%;text-align:left;padding:14px 16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:var(--white);cursor:pointer;margin-bottom:8px;display:block">' +
        '<div style="font-weight:700;font-size:14px;margin-bottom:3px">'+o.icon+' '+o.label+'</div>' +
        '<div style="font-size:11px;color:var(--muted)">'+o.note+'</div></button>';
    });
    html += '<button class="gl-rd-cancel" style="width:100%;padding:10px;background:none;border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--muted);cursor:pointer;margin-top:4px">Cancel</button></div>';
    modal.innerHTML = html;
    modal.addEventListener('click',function(e){
      var b=e.target.closest('.gl-rd-btn');
      if(b){modal.remove();if(_pcb){_pcb(opts[parseInt(b.getAttribute('data-idx'))]);_pcb=null;}return;}
      if(e.target.closest('.gl-rd-cancel')||e.target===modal){modal.remove();_pcb=null;}
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
  window.glAddLine=function(type){
    if(!INV)return;
    if(type==='canning'){
      window.glShowFormatPicker(function(fmt){
        var fmtLabel={'12oz-standard':'12oz Standard','12oz-sleek':'12oz Sleek','16oz-standard':'16oz Standard'};
        INV.lines.push({id:'l'+Date.now(),type:'canning',description:'Canning \u2014 '+(fmtLabel[fmt]||fmt),qty:0,unit:'cases',unitPrice:0,total:0,canType:fmt,note:'Enter number of cases \u2192 price auto-calculates',editable:false});
        glRenderBuilder();
      });
      return;
    }
    if(type==='bottling'){
      INV.lines.push({id:'l'+Date.now(),type:'bottling',description:'Bottle Filling \u2014 750ml',qty:0,unit:'cases',unitPrice:0,total:0,note:'Enter number of cases (6 bottles/case) \u2192 price auto-calculates',editable:false});
    } else if(type==='rd'){
      window.glShowRDPicker(function(o){
        INV.lines.push({id:'l'+Date.now(),type:'rd',description:o.label,qty:1,unit:o.unit,unitPrice:o.price,total:o.price*1,note:o.note,editable:false});
        glRenderBuilder();
      });
      return;
    } else if(type==='hours'){
      INV.lines.push({id:'l'+Date.now(),type:'hours',description:'Production Hours',qty:0,unit:'hrs',unitPrice:125,total:0,note:'$125/hr \u00b7 Full day (8hrs) = $1,000',editable:false});
    } else {
      INV.lines.push({id:'l'+Date.now(),type:'custom',description:'',qty:1,unit:'',unitPrice:0,total:0,note:'',editable:true});
    }
    glRenderBuilder();
  };

  /* ── RENDER BUILDER ── */
  function glRenderBuilder(){
    var body=document.getElementById('gl-inv-body');if(!body)return;
    glEnsureClients();
    var clients=window.clients||[];
    body.innerHTML=
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">'+
        '<div><div class="flbl">Client *</div>'+
          '<select class="fsel" id="ginv-client" onchange="if(window.INV)window.INV.clientId=this.value" style="width:100%">'+
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
          '<div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:2px;color:var(--white)">NEW INVOICE</div>'+
          '<button onclick="document.getElementById(\'gl-inv-builder\').classList.remove(\'show\')" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer">&#x2715;</button>'+
        '</div>'+
        '<div style="padding:24px" id="gl-inv-body"></div>'+
      '</div>';
      document.body.appendChild(ov);
    } else {
      existing.classList.add('show');
    }
    glRenderBuilder();
  };

  /* ── SAVE INVOICE ── */
  window.glSaveInvoice = function(){
    if(!INV){alert('No invoice state');return null;}
    var cid=document.getElementById('ginv-client')?.value||INV.clientId;
    if(!cid){alert('Please select a client');return null;}
    if(!INV.lines.length&&!INV.addons.some(function(a){return a.d&&a.p;})){alert('Add at least one line item');return null;}
    var client=(window.clients||[]).find(function(c){return c.id===cid;});
    var invId=document.getElementById('ginv-id')?.value||glNextId();
    var allLines=INV.lines.map(function(l){return {desc:l.description,qty:l.qty,unitPrice:l.unitPrice,total:l.total,unit:l.unit};})
      .concat(INV.addons.filter(function(a){return a.d&&a.p;}).map(function(a){return {desc:a.d,qty:1,unitPrice:parseFloat(a.p),total:parseFloat(a.p),unit:''};}));
    var inv={id:invId,client:cid,clientName:client?.name||'',clientEmail:client?.email||'',
      svc:allLines.map(function(l){return l.desc;}).join(', '),lines:allLines,
      addons:INV.addons.filter(function(a){return a.d&&a.p;}),
      discount:INV.discount,subtotal:sub(),discountAmt:discAmt(),amount:grandTotal(),
      notes:INV.notes,date:INV.date,status:'pending',paymentTerms:'Due upon receipt'};
    window.invoices=window.invoices||[];window.invoices.unshift(inv);
    if(typeof renderInvoices==='function')renderInvoices();
    if(typeof addNotification==='function')addNotification('Invoice saved: '+invId,(client?.name||'')+' \u00b7 '+glFmt(inv.amount),'success');
    document.getElementById('gl-inv-builder')?.classList.remove('show');
    return inv;
  };

  /* ── EXPORT PDF ── */
  window.glExportPDF = function(){
    var inv=window.glSaveInvoice();if(!inv)return;
    var client=(window.clients||[]).find(function(c){return c.id===inv.client;});
    var html='<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:Arial,sans-serif;margin:0;padding:40px;color:#1a1a2e;font-size:13px}.header{display:flex;justify-content:space-between;margin-bottom:40px}.brand{font-size:28px;font-weight:900;letter-spacing:2px}.brand span{color:#00e5c0}table{width:100%;border-collapse:collapse;margin-bottom:20px}th{background:#0a1628;color:#fff;padding:10px 12px;text-align:left;font-size:11px}td{padding:10px 12px;border-bottom:1px solid #eee;font-size:12px}tr:nth-child(even)td{background:#f9f9f9}.grand{font-size:18px;color:#00e5c0;font-weight:900}.footer{margin-top:40px;padding-top:20px;border-top:2px solid #eee;font-size:11px;color:#999;display:flex;justify-content:space-between}.badge{display:inline-block;background:#e8fff9;border:1px solid #00e5c0;color:#00695c;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700}</style></head><body>'+
      '<div class="header"><div><div class="brand">GOOD <span>LIQUID</span> BEV CO</div><div style="font-size:11px;color:#666;margin-top:6px;line-height:1.8">2011 51st Ave E, Unit 100<br>Palmetto, FL 34221<br>Mike@GoodLiquid.com &middot; (803) 493-5065<br>goodliquidbevco.com</div><div style="margin-top:8px"><span class="badge">GMP</span>&nbsp;<span class="badge">PCQI</span>&nbsp;<span class="badge">HACCP</span></div></div>'+
      '<div style="text-align:right"><h2 style="font-size:22px;margin:0 0 4px">INVOICE</h2><div><b>Invoice #:</b> '+inv.id+'</div><div><b>Date:</b> '+inv.date+'</div><div><b>Terms:</b> Due upon receipt</div></div></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px"><div><div style="font-size:10px;letter-spacing:2px;color:#999;margin-bottom:4px">BILL TO</div><div style="font-weight:700">'+(client?.name||inv.clientName)+'</div><div style="color:#666">'+(client?.email||inv.clientEmail)+'</div></div></div>'+
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

  console.log('[GL] fix.js v2.1 loaded');
})();
