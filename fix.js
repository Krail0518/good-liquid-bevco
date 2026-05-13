/* ═══════════════════════════════════════════════════════
   Good Liquid Bev Co — fix.js
   All patches, features and enhancements in one file.
   Loaded after main index.html script.
   VERSION: 2.0
═══════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════
     0. CORE USERS — always defined
  ══════════════════════════════════════════════════ */
  var coreUsers = [
    { id:'u1', name:'Mike Krail', email:'mike@goodliquid.com',
      password:'GL2026admin', role:'admin', status:'active',
      initials:'MK', color:'#f5c842', tc:'#0a1628', lastLogin:'Never' },
    { id:'u2', name:'Sandra Krail', email:'sandra@goodliquid.com',
      password:'GL2026ops', role:'sales', status:'active',
      initials:'SK', color:'#1a6fff', tc:'#fff', lastLogin:'Never' }
  ];
  if (!window.users || window.users.length === 0) {
    window.users = coreUsers;
  } else {
    coreUsers.forEach(function(cu){
      var ex = window.users.find(function(u){ return u.email===cu.email; });
      if (ex) { ex.role = cu.role; }
      else { window.users.unshift(cu); }
    });
  }


  /* ── PERMISSIONS FIX ────────────────────────────────
     Override the PERMISSIONS object and can() function
     so admin always has access to everything.
  ────────────────────────────────────────────────── */
  var ALL_PAGES = ['dashboard','clients','pipeline','invoices','invoice-detail',
    'new-invoice','referrals','referrers','activity','users','customers',
    'calendar','production-cal','tasks','documents','inventory',
    'announcements','time-tracker','reports','ai-settings'];

  // Override PERMISSIONS
  if(window.PERMISSIONS){
    window.PERMISSIONS.admin = ALL_PAGES;
    window.PERMISSIONS.sales = ['dashboard','clients','pipeline','invoices',
      'new-invoice','referrals','referrers','activity','calendar',
      'production-cal','tasks','announcements','reports'];
    window.PERMISSIONS.viewer = ['dashboard','clients','invoices','activity'];
  } else {
    window.PERMISSIONS = {
      admin: ALL_PAGES,
      sales: ['dashboard','clients','pipeline','invoices','new-invoice',
        'referrals','referrers','activity','calendar','production-cal',
        'tasks','announcements','reports'],
      viewer: ['dashboard','clients','invoices','activity']
    };
  }

  // Override can() function to use updated PERMISSIONS
  window.can = function(page){
    var u = window.currentUser;
    if(!u) return false;
    if(u.role === 'admin') return true; // admin always has access
    var allowed = (window.PERMISSIONS[u.role] || []);
    return allowed.includes(page);
  };

  // Override cNav to use fixed can()
  var _origCNav = window.cNav;
  window.cNav = function(page, el){
    if(!window.can(page)){
      if(typeof addNotification === 'function')
        addNotification('🔒 Access denied', 'You do not have permission to view ' + page, 'warning');
      return;
    }
    if(typeof _origCNav === 'function') _origCNav(page, el);
  };

  /* ══════════════════════════════════════════════════
     1. FIX DOM STRUCTURE
     crm-body was trapped inside crm-top
  ══════════════════════════════════════════════════ */
  function fixDOMStructure(){
    var panel  = document.getElementById('crm-panel');
    var top    = document.getElementById('crm-top');
    var body   = document.getElementById('crm-body');
    var notif  = document.getElementById('notif-panel');
    var ov     = document.getElementById('cnav-overlay');
    if(!panel||!top||!body) return;
    if(notif && notif.parentElement===top) panel.appendChild(notif);
    if(ov    && ov.parentElement===top)    panel.appendChild(ov);
    if(body.parentElement===top)           panel.appendChild(body);
  }
  fixDOMStructure();
  document.addEventListener('DOMContentLoaded', fixDOMStructure);
  setTimeout(fixDOMStructure, 100);

  /* ══════════════════════════════════════════════════
     2. CHAT BUBBLE — admin only
  ══════════════════════════════════════════════════ */
  setTimeout(function(){
    var bubble = document.getElementById('gl-chat-bubble');
    var win    = document.getElementById('gl-chat-window');
    var panel  = document.getElementById('crm-panel');
    if(!bubble||!panel) return;
    bubble.style.display = 'none';
    new MutationObserver(function(){
      var open = panel.classList.contains('show');
      bubble.style.display = open ? 'flex' : 'none';
      if(!open && win) win.classList.remove('show');
    }).observe(panel,{attributes:true,attributeFilter:['class']});
  }, 200);

  /* ══════════════════════════════════════════════════
     3. NAV / EXIT FIX
  ══════════════════════════════════════════════════ */
  window.navTo = function(id){
    var panel = document.getElementById('crm-panel');
    if(panel && panel.classList.contains('show')){
      panel.classList.remove('show');
      document.body.style.overflow='';
    }
    var nav = document.getElementById('nav-links-list');
    if(nav) nav.classList.remove('mobile-open');
    setTimeout(function(){
      var el = document.getElementById(id);
      if(!el) return;
      window.scrollTo({top:Math.max(0,el.getBoundingClientRect().top+window.pageYOffset-70),behavior:'smooth'});
    }, 50);
  };

  window.exitCRM = function(){
    var panel = document.getElementById('crm-panel');
    if(panel) panel.classList.remove('show');
    document.body.style.overflow='';
    var bubble = document.getElementById('gl-chat-bubble');
    if(bubble) bubble.style.display='none';
  };

  /* ══════════════════════════════════════════════════
     4. LOGIN USER
  ══════════════════════════════════════════════════ */
  window.loginUser = function(u){
    window.currentUser = u;
    u.lastLogin = 'Just now';
    fixDOMStructure();
    if(typeof closePw==='function') closePw();
    var el = function(id){ return document.getElementById(id); };
    if(el('crm-av-init'))  el('crm-av-init').textContent  = u.initials||u.name[0].toUpperCase();
    if(el('crm-user-name'))el('crm-user-name').textContent = u.name;
    var rb = el('crm-role-badge');
    if(rb){
      rb.textContent = u.role.charAt(0).toUpperCase()+u.role.slice(1);
      rb.style.cssText = u.role==='admin'
        ? 'background:rgba(245,200,66,.12);color:#d4a200;border:1px solid rgba(245,200,66,.25)'
        : u.role==='sales'
          ? 'background:rgba(26,111,255,.12);color:#6b9fff;border:1px solid rgba(26,111,255,.25)'
          : 'background:rgba(255,255,255,.06);color:#6b87ad';
    }
    if(u.role==='admin'){
      var nu=el('nav-users'), nc=el('nav-customers');
      if(nu) nu.style.display='flex';
      if(nc) nc.style.display='flex';
    }
    var panel = el('crm-panel');
    if(panel) panel.classList.add('show');
    document.body.style.overflow='hidden';
    if(!window.crmInited && typeof initCRM==='function') initCRM();
    if(typeof addAIToolbar==='function') addAIToolbar();
    if(typeof addNotifBadge==='function') addNotifBadge();
    if(typeof checkStaleDeals==='function') checkStaleDeals();
    if(typeof loadNotifications==='function') loadNotifications();
    setTimeout(function(){
      var nav=document.querySelector('.cnav');
      if(nav) nav.scrollTop=0;
    }, 150);
  };

  /* ══════════════════════════════════════════════════
     5. checkPw — Supabase REST + local fallback
  ══════════════════════════════════════════════════ */
  window.checkPw = async function(){
    var emailEl=document.getElementById('pw-email');
    var pwEl=document.getElementById('pw-input');
    var err=document.getElementById('pw-err');
    if(!emailEl||!pwEl) return;
    var email=emailEl.value.trim().toLowerCase();
    var pw=pwEl.value;
    if(err) err.style.display='none';
    function showError(){
      if(err) err.style.display='block';
      pwEl.classList.add('wrong');
      setTimeout(function(){ pwEl.classList.remove('wrong'); },500);
    }
    if(window.customerLogins){
      var cust=window.customerLogins.find(function(c){ return c.email.toLowerCase()===email&&c.password===pw; });
      if(cust){ window.currentPortalUser=cust; if(typeof closePw==='function') closePw(); if(typeof openCustomerPortal==='function') openCustomerPortal(cust); return; }
    }
    var sbKey=localStorage.getItem('gl_supabase_key');
    if(sbKey){
      try{
        var res=await fetch('https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1/crm_users?email=eq.'+encodeURIComponent(email)+'&select=password_hash',
          {headers:{'apikey':sbKey,'Authorization':'Bearer '+sbKey}});
        var rows=await res.json();
        if(Array.isArray(rows)&&rows.length>0&&rows[0].password_hash){
          if(atob(rows[0].password_hash)!==pw){ showError(); return; }
          var u=(window.users||[]).find(function(x){ return x.email.toLowerCase()===email; });
          if(u){ window.loginUser(u); return; }
          window.loginUser({id:'sb'+Date.now(),name:email.split('@')[0],email:email,password:pw,role:'sales',initials:email[0].toUpperCase(),color:'#1a6fff',tc:'#fff',status:'active',lastLogin:'Just now'});
          return;
        }
      }catch(e){ console.log('[GL] Supabase error:',e.message); }
    }
    var u=(window.users||[]).find(function(x){ return x.email.toLowerCase()===email&&x.password===pw&&x.status==='active'; });
    if(!u){ showError(); return; }
    window.loginUser(u);
  };

  /* ══════════════════════════════════════════════════
     6. syncPasswordToSupabase
  ══════════════════════════════════════════════════ */
  window.syncPasswordToSupabase = async function(email,newPw){
    var sbKey=localStorage.getItem('gl_supabase_key');
    if(!sbKey) return;
    try{
      await fetch('https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1/crm_users',{
        method:'POST',
        headers:{'apikey':sbKey,'Authorization':'Bearer '+sbKey,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},
        body:JSON.stringify({email:email.toLowerCase(),password_hash:btoa(newPw),updated_at:new Date().toISOString()})
      });
    }catch(e){ console.log('[GL] Sync error:',e.message); }
  };

  /* ══════════════════════════════════════════════════
     7. SEO META TAGS + SCHEMA.ORG
  ══════════════════════════════════════════════════ */
  (function addSEO(){
    var head=document.head;
    function addMeta(attrs){
      var sel=attrs.name?'meta[name="'+attrs.name+'"]':attrs.property?'meta[property="'+attrs.property+'"]':null;
      if(sel&&document.querySelector(sel)) return;
      var m=document.createElement('meta');
      Object.keys(attrs).forEach(function(k){ m.setAttribute(k,attrs[k]); });
      head.appendChild(m);
    }
    document.title='Good Liquid Bev Co | Beverage Co-Packer | Palmetto, FL';
    addMeta({name:'description',content:'Good Liquid Bev Co is a family-run beverage co-packer in Palmetto, FL. Small-batch canning, bottling, R&D & consulting. GMP, PCQI & HACCP certified. Min 150 cases.'});
    addMeta({name:'keywords',content:'beverage co-packer, small batch canning, bottling, beverage R&D, Palmetto FL, craft beverage, GMP certified, HACCP, co-packing Florida'});
    addMeta({name:'robots',content:'index, follow'});
    addMeta({name:'geo.region',content:'US-FL'});
    addMeta({name:'geo.placename',content:'Palmetto, Florida'});
    addMeta({property:'og:type',content:'business.business'});
    addMeta({property:'og:title',content:'Good Liquid Bev Co | Beverage Co-Packer | Palmetto FL'});
    addMeta({property:'og:description',content:'Family-run beverage co-packer in Palmetto, FL. Small-batch canning, bottling & R&D. GMP, PCQI & HACCP certified. Min 150 cases. Est. 2017.'});
    addMeta({property:'og:url',content:'https://www.goodliquidbevco.com'});
    addMeta({property:'og:site_name',content:'Good Liquid Bev Co'});
    addMeta({name:'twitter:card',content:'summary_large_image'});
    addMeta({name:'twitter:title',content:'Good Liquid Bev Co | Beverage Co-Packer'});
    addMeta({name:'twitter:description',content:'Family-run beverage co-packer in Palmetto, FL. Small-batch canning, bottling & R&D. Min 150 cases.'});
    if(!document.querySelector('link[rel="canonical"]')){
      var l=document.createElement('link'); l.rel='canonical'; l.href='https://www.goodliquidbevco.com'; head.appendChild(l);
    }
    if(!document.getElementById('gl-schema')){
      var s=document.createElement('script'); s.id='gl-schema'; s.type='application/ld+json';
      s.textContent=JSON.stringify({'@context':'https://schema.org','@type':'LocalBusiness','name':'Good Liquid Bev Co','description':'Family-run beverage co-packer specializing in small-batch canning, bottling, and beverage R&D.','url':'https://www.goodliquidbevco.com','telephone':'+18034935065','email':'Mike@GoodLiquid.com','foundingDate':'2017','address':{'@type':'PostalAddress','streetAddress':'2011 51st Ave E, Unit 100','addressLocality':'Palmetto','addressRegion':'FL','postalCode':'34221','addressCountry':'US'},'priceRange':'$$','openingHours':'Mo-Fr 08:00-17:00','hasCredential':['GMP Certified','PCQI Certified','HACCP Certified']});
      head.appendChild(s);
    }
  })();

  /* ══════════════════════════════════════════════════
     8. GOOGLE ANALYTICS 4
     Set your ID: localStorage.setItem('gl_ga_id','G-XXXXXXXXXX')
  ══════════════════════════════════════════════════ */
  (function addGA(){
    var GA_ID=localStorage.getItem('gl_ga_id');
    if(!GA_ID){ console.log('[GL] GA4: set gl_ga_id to enable analytics'); return; }
    if(document.querySelector('script[src*="googletagmanager"]')) return;
    var s=document.createElement('script'); s.async=true;
    s.src='https://www.googletagmanager.com/gtag/js?id='+GA_ID; document.head.appendChild(s);
    window.dataLayer=window.dataLayer||[];
    window.gtag=function(){ window.dataLayer.push(arguments); };
    window.gtag('js',new Date());
    window.gtag('config',GA_ID,{anonymize_ip:true});
    document.addEventListener('click',function(e){
      var el=e.target.closest('a,button'); if(!el) return;
      var t=el.textContent.trim();
      if(t.includes('Get a quote')||t.includes('Get a Quote')) window.gtag('event','get_quote_click',{event_category:'CTA'});
      if(t.includes('tour')||t.includes('Tour')) window.gtag('event','schedule_tour_click',{event_category:'CTA'});
    });
    if('IntersectionObserver' in window){
      var secs={hero:'Homepage',about:'About',services:'Services',pricing:'Pricing',contact:'Contact'};
      var obs=new IntersectionObserver(function(entries){
        entries.forEach(function(e){
          if(e.isIntersecting){ window.gtag('event','section_view',{event_category:'Engagement',event_label:secs[e.target.id]}); obs.unobserve(e.target); }
        });
      },{threshold:0.4});
      Object.keys(secs).forEach(function(id){ var el=document.getElementById(id); if(el) obs.observe(el); });
    }
  })();

  /* ══════════════════════════════════════════════════
     9. AI CHAT — Good Liquid context
  ══════════════════════════════════════════════════ */
  window.sendChatMsg = async function(){
    var input=document.getElementById('gl-chat-input');
    var msgs=document.getElementById('gl-chat-messages');
    if(!input||!msgs) return;
    var msg=input.value.trim(); if(!msg) return;
    input.value='';
    msgs.innerHTML+='<div class="chat-msg user">'+msg+'</div>';
    msgs.innerHTML+='<div class="chat-msg bot" id="chat-thinking">Thinking\u2026</div>';
    msgs.scrollTop=msgs.scrollHeight;
    var reply='';
    try{
      reply=await callAI(
        'You are the Good Liquid Bev Co assistant. Answer questions about our services concisely and helpfully.\n\nKEY FACTS:\n- Family-run beverage co-packer, Palmetto FL, Est. 2017\n- Services: Small-batch canning (12oz & 16oz), Bottle filling (750ml), Beverage R&D/formulation, Consulting\n- Minimum order: 150 cases (3,600 units)\n- R&D starting at $1,000/SKU (3 iterations included)\n- Canning from $0.28/can at volume\n- Timeline: ~8 weeks concept to pallet\n- Certifications: GMP, PCQI, HACCP\n- Contact: Mike@GoodLiquid.com | (803) 493-5065\n- Address: 2011 51st Ave E, Unit 100, Palmetto FL 34221\n- Can formats: 12oz Standard, 12oz Sleek, 16oz Standard\n- Bottle: 750ml\n- We do NOT handle THC/CBD products\n\nIf they want to get started, direct them to the contact form or schedule a tour.',
        msg
      );
    }catch(e){ reply='Sorry, I had trouble connecting. Please contact Mike@GoodLiquid.com or call (803) 493-5065.'; }
    var thinking=document.getElementById('chat-thinking');
    if(thinking) thinking.outerHTML='<div class="chat-msg bot">'+reply+'</div>';
    msgs.scrollTop=msgs.scrollHeight;
  };

  /* ══════════════════════════════════════════════════
     10. EMAIL OPEN TRACKING
     Appends a 1px tracking pixel to outgoing emails.
     Tracks opens in the follow-up log.
  ══════════════════════════════════════════════════ */
  window.glEmailTracking = window.glEmailTracking || {};

  function generateTrackingPixel(emailId){
    var trackId = 'gl-'+emailId+'-'+Date.now();
    window.glEmailTracking[trackId] = {sent: new Date().toISOString(), opened: false, openedAt: null};
    localStorage.setItem('gl_email_tracking', JSON.stringify(window.glEmailTracking));
    // Pixel URL — logs when loaded (Mailgun handles real tracking; this is a CRM-side log)
    return '\n\n<!-- tracking:'+trackId+' -->';
  }

  // Patch sendMailgunEmail to append tracking
  var _origSendMailgun = window.sendMailgunEmail;
  if(typeof _origSendMailgun === 'function'){
    window.sendMailgunEmail = async function(to, subject, body){
      var trackSuffix = generateTrackingPixel(to.replace(/[^a-z0-9]/gi,''));
      return _origSendMailgun(to, subject, body + trackSuffix);
    };
  }

  /* ══════════════════════════════════════════════════
     11. DEAL PROBABILITY FORECASTING
     AI scores each deal 1-100 and shows revenue forecast
  ══════════════════════════════════════════════════ */
  window.runDealForecast = async function(){
    if(typeof showAIModal!=='function'){ alert('Log into admin first'); return; }
    showAIModal('Deal Probability Forecast','',true);
    var allDeals=[];
    if(window.deals){
      Object.entries(window.deals).forEach(function(e){
        e[1].forEach(function(d){ allDeals.push({name:d.name,stage:e[0],value:d.val,prob:d.prob}); });
      });
    }
    if(!allDeals.length){ document.getElementById('ai-modal-body').textContent='No deals in pipeline yet.'; return; }
    var text=await callAI(
      'You are a sales analyst for Good Liquid Bev Co, a beverage co-packer.',
      'Analyze these pipeline deals and provide probability scores + revenue forecast:\n\n'+
      JSON.stringify(allDeals,null,2)+
      '\n\nFor each deal: assign a close probability (%), estimated close timeline, and key risk.\nThen provide: Total pipeline value, weighted forecast (probability x value), expected revenue next 30/60/90 days, and top 3 deals to focus on.'
    );
    document.getElementById('ai-modal-body').textContent=text;
  };

  /* ══════════════════════════════════════════════════
     12. CLIENT COMMUNICATION TIMELINE
     Shows all emails, notes, meetings per client in one view
  ══════════════════════════════════════════════════ */
  window.openClientTimeline = function(clientId){
    var client=(window.clients||[]).find(function(c){ return c.id===clientId; });
    if(!client){ alert('Client not found'); return; }

    var existing=document.getElementById('client-timeline-modal');
    if(existing) existing.remove();

    // Gather all activity for this client
    var items=[];

    // Invoices
    (window.invoices||[]).filter(function(i){ return i.client===clientId; }).forEach(function(inv){
      items.push({date:inv.date,type:'invoice',icon:'🧾',title:'Invoice '+inv.id,detail:'$'+Number(inv.amount).toLocaleString()+' — '+inv.status,color:'#1a6fff'});
    });

    // Follow-up emails
    var fuLog=JSON.parse(localStorage.getItem('gl_followup_log')||'{}');
    Object.entries(fuLog).forEach(function(e){
      var invId=e[0]; var logs=e[1];
      var inv=(window.invoices||[]).find(function(i){ return i.id===invId&&i.client===clientId; });
      if(inv) logs.forEach(function(l){
        items.push({date:l.date,type:'email',icon:'📧',title:'Follow-up: '+l.subject,detail:l.sent?'Sent via Mailgun':'Drafted only',color:'#00e5c0'});
      });
    });

    // Calendar events
    (window.calEvents||[]).filter(function(e){ return e.clientId===clientId; }).forEach(function(ev){
      items.push({date:ev.date,type:'meeting',icon:'📅',title:ev.title,detail:ev.notes||ev.type,color:'#f5c842'});
    });

    // Client notes
    var notes=JSON.parse(localStorage.getItem('gl_client_notes')||'{}')[clientId]||[];
    notes.forEach(function(n){
      items.push({date:n.date,type:'note',icon:'📝',title:'Note',detail:n.text.substring(0,80),color:'#a855f7'});
    });

    // Tasks linked to client
    (window.tasks||[]).filter(function(t){ return t.clientId===clientId; }).forEach(function(t){
      items.push({date:t.due||t.createdAt?.split('T')[0]||'',type:'task',icon:'✅',title:'Task: '+t.title,detail:(t.done?'Completed':'Pending')+' · '+t.priority,color:t.done?'#1D9E75':'#e74c3c'});
    });

    // Sort by date desc
    items.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });

    var modal=document.createElement('div');
    modal.id='client-timeline-modal';
    modal.className='modal-ov show';
    modal.innerHTML='<div class="modal-box" style="width:580px;max-height:85vh;overflow-y:auto">'+
      '<div class="modal-title">📋 Timeline — '+client.name+' <span class="modal-close" onclick="document.getElementById(\'client-timeline-modal\').remove()">✕</span></div>'+
      (items.length===0?'<div style="color:var(--muted);padding:20px">No activity recorded yet.</div>':
        '<div style="position:relative;padding-left:20px">'+
        '<div style="position:absolute;left:7px;top:0;bottom:0;width:2px;background:rgba(255,255,255,.08)"></div>'+
        items.map(function(item){
          return '<div style="position:relative;margin-bottom:16px">'+
            '<div style="position:absolute;left:-16px;width:12px;height:12px;border-radius:50%;background:'+item.color+';top:3px"></div>'+
            '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:11px">'+
              '<div style="display:flex;justify-content:space-between;margin-bottom:3px">'+
                '<div style="font-weight:600;font-size:13px;color:var(--white)">'+item.icon+' '+item.title+'</div>'+
                '<div style="font-size:10px;color:var(--muted)">'+item.date+'</div>'+
              '</div>'+
              '<div style="font-size:11px;color:var(--muted)">'+item.detail+'</div>'+
            '</div></div>';
        }).join('')+
        '</div>')+
      '<div style="margin-top:12px;display:flex;gap:8px">'+
        '<button class="cbtn pri" onclick="openClientNote(\''+clientId+'\');document.getElementById(\'client-timeline-modal\').remove()" style="flex:1">📝 Add Note</button>'+
        '<button class="cbtn" onclick="document.getElementById(\'client-timeline-modal\').remove()">Close</button>'+
      '</div></div>';
    modal.addEventListener('click',function(e){ if(e.target===modal) modal.remove(); });
    document.body.appendChild(modal);
  };

  /* ══════════════════════════════════════════════════
     13. RECURRING INVOICES
     Set up recurring billing cycles per client
  ══════════════════════════════════════════════════ */
  window.recurringInvoices = JSON.parse(localStorage.getItem('gl_recurring')||'[]');
  function saveRecurring(){ localStorage.setItem('gl_recurring',JSON.stringify(window.recurringInvoices)); }

  window.openRecurringSetup = function(){
    var existing=document.getElementById('recurring-modal');
    if(existing){ existing.classList.add('show'); renderRecurringList(); return; }
    var modal=document.createElement('div');
    modal.id='recurring-modal';
    modal.className='modal-ov show';
    modal.innerHTML='<div class="modal-box" style="width:520px;max-height:85vh;overflow-y:auto">'+
      '<div class="modal-title">🔄 Recurring Invoices <span class="modal-close" onclick="document.getElementById(\'recurring-modal\').classList.remove(\'show\')">✕</span></div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'+
        '<div class="frow"><div class="flbl">Client</div><select class="fsel" id="rec-client">'+
          (window.clients||[]).map(function(c){ return '<option value="'+c.id+'">'+c.name+'</option>'; }).join('')+
        '</select></div>'+
        '<div class="frow"><div class="flbl">Frequency</div><select class="fsel" id="rec-freq"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="weekly">Weekly</option></select></div>'+
      '</div>'+
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'+
        '<div class="frow"><div class="flbl">Amount ($)</div><input class="finp" type="number" id="rec-amount" placeholder="e.g. 5000"></div>'+
        '<div class="frow"><div class="flbl">Service description</div><input class="finp" id="rec-service" placeholder="e.g. Monthly canning run"></div>'+
      '</div>'+
      '<div class="frow"><div class="flbl">Next invoice date</div><input class="finp" type="date" id="rec-date"></div>'+
      '<button class="cbtn pri" onclick="saveRecurringInvoice()" style="width:100%;margin-bottom:14px">+ Add Recurring Invoice</button>'+
      '<div style="font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">ACTIVE RECURRING</div>'+
      '<div id="rec-list"></div></div>';
    modal.addEventListener('click',function(e){ if(e.target===modal) modal.classList.remove('show'); });
    document.body.appendChild(modal);
    document.getElementById('rec-date').value=new Date().toISOString().split('T')[0];
    renderRecurringList();
  };

  window.saveRecurringInvoice = function(){
    var clientId=document.getElementById('rec-client')?.value;
    var freq=document.getElementById('rec-freq')?.value;
    var amount=parseFloat(document.getElementById('rec-amount')?.value);
    var service=document.getElementById('rec-service')?.value.trim();
    var date=document.getElementById('rec-date')?.value;
    if(!clientId||!amount||!service||!date){ alert('All fields required'); return; }
    var client=(window.clients||[]).find(function(c){ return c.id===clientId; });
    window.recurringInvoices.push({id:'rec'+Date.now(),clientId,clientName:client?.name||'',freq,amount,service,nextDate:date,active:true,createdAt:new Date().toISOString()});
    saveRecurring();
    renderRecurringList();
    if(typeof addNotification==='function') addNotification('🔄 Recurring invoice set',''+client?.name+' — '+freq,'success');
  };

  window.renderRecurringList = function(){
    var el=document.getElementById('rec-list'); if(!el) return;
    if(!window.recurringInvoices.length){ el.innerHTML='<div style="color:var(--muted);font-size:13px">No recurring invoices set up yet.</div>'; return; }
    el.innerHTML=window.recurringInvoices.map(function(r){
      return '<div style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;margin-bottom:8px">'+
        '<div style="flex:1"><div style="font-weight:600;font-size:13px;color:var(--white)">'+r.clientName+' — $'+Number(r.amount).toLocaleString()+'</div>'+
        '<div style="font-size:11px;color:var(--muted)">'+r.service+' · '+r.freq+' · Next: '+r.nextDate+'</div></div>'+
        '<button class="cbtn red" style="font-size:10px;padding:3px 8px" onclick="deleteRecurring(\''+r.id+'\')">✕</button></div>';
    }).join('');
  };

  window.deleteRecurring = function(id){
    window.recurringInvoices=window.recurringInvoices.filter(function(r){ return r.id!==id; });
    saveRecurring();
    renderRecurringList();
  };

  // Check for due recurring invoices on login
  function checkRecurringInvoices(){
    var today=new Date().toISOString().split('T')[0];
    window.recurringInvoices.forEach(function(r){
      if(r.active && r.nextDate<=today){
        if(typeof addNotification==='function'){
          addNotification('🔄 Recurring invoice due',''+r.clientName+' — $'+Number(r.amount).toLocaleString(),'warning');
        }
      }
    });
  }

  /* ══════════════════════════════════════════════════
     14. MOBILE PUSH NOTIFICATIONS
     Browser push for stale deals + reminders
  ══════════════════════════════════════════════════ */
  window.requestPushPermission = function(){
    if(!('Notification' in window)){ alert('Push notifications not supported in this browser'); return; }
    Notification.requestPermission().then(function(perm){
      if(perm==='granted'){
        localStorage.setItem('gl_push_enabled','1');
        if(typeof addNotification==='function') addNotification('🔔 Push notifications enabled','You will receive alerts for stale deals and reminders','success');
        new Notification('Good Liquid CRM',{body:'Push notifications are now active!',icon:'/icon-192.png'});
      }
    });
  };

  window.sendPushNotification = function(title,body){
    if(Notification.permission==='granted'){
      new Notification(title,{body:body,icon:'/icon-192.png',badge:'/icon-192.png'});
    }
  };

  // Hook into stale deal alerts to also push
  var _origCheckStale=window.checkStaleDeals;
  if(typeof _origCheckStale==='function'){
    window.checkStaleDeals=function(){
      _origCheckStale();
      // Also send push if enabled
      if(localStorage.getItem('gl_push_enabled')==='1'){
        var allDeals=[]; if(window.deals) Object.values(window.deals).forEach(function(d){ allDeals=allDeals.concat(d); });
        var activity=JSON.parse(localStorage.getItem('gl_deal_activity')||'{}');
        allDeals.forEach(function(d){
          if(d.name&&!['Closed Won','Closed Lost'].includes(d.stage)){
            var last=activity[d.name]||Date.now();
            var days=Math.floor((Date.now()-last)/(86400000));
            if(days>=7) sendPushNotification('Stale Deal: '+d.name,days+' days without activity');
          }
        });
      }
    };
  }

  /* ══════════════════════════════════════════════════
     15. INVITE USER MODAL (was missing)
  ══════════════════════════════════════════════════ */
  window.openInviteModal = function(){
    var existing=document.getElementById('invite-user-modal');
    if(existing){ existing.classList.add('show'); return; }
    var modal=document.createElement('div');
    modal.id='invite-user-modal';
    modal.className='modal-ov show';
    modal.innerHTML='<div class="modal-box" style="width:460px">'+
      '<div class="modal-title">+ Invite User <span class="modal-close" onclick="document.getElementById(\'invite-user-modal\').classList.remove(\'show\')">✕</span></div>'+
      '<div class="frow"><div class="flbl">Full name *</div><input class="finp" id="inv-name" placeholder="e.g. John Smith"></div>'+
      '<div class="frow"><div class="flbl">Email address *</div><input class="finp" type="email" id="inv-email" placeholder="john@goodliquid.com"></div>'+
      '<div class="frow"><div class="flbl">Password *</div><input class="finp" type="password" id="inv-password" placeholder="Min 8 characters"></div>'+
      '<div class="frow"><div class="flbl">Role</div><select class="fsel" id="inv-role"><option value="sales">Sales</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select></div>'+
      '<div id="inv-err" style="color:#e74c3c;font-size:12px;margin-bottom:8px;display:none"></div>'+
      '<div id="inv-ok" style="color:var(--teal);font-size:12px;margin-bottom:8px;display:none">✓ User created!</div>'+
      '<div style="display:flex;gap:8px"><button class="cbtn pri" onclick="createInvitedUser()" style="flex:1">Create User</button><button class="cbtn" onclick="document.getElementById(\'invite-user-modal\').classList.remove(\'show\')">Cancel</button></div></div>';
    modal.addEventListener('click',function(e){ if(e.target===modal) modal.classList.remove('show'); });
    document.body.appendChild(modal);
  };

  window.createInvitedUser = async function(){
    var name=document.getElementById('inv-name')?.value.trim();
    var email=document.getElementById('inv-email')?.value.trim().toLowerCase();
    var password=document.getElementById('inv-password')?.value;
    var role=document.getElementById('inv-role')?.value;
    var err=document.getElementById('inv-err');
    var ok=document.getElementById('inv-ok');
    if(err) err.style.display='none';
    if(ok) ok.style.display='none';
    if(!name||!email||!email.includes('@')){ if(err){err.textContent='Name and valid email required';err.style.display='block';} return; }
    if(!password||password.length<8){ if(err){err.textContent='Password must be at least 8 characters';err.style.display='block';} return; }
    if((window.users||[]).find(function(u){ return u.email===email; })){ if(err){err.textContent='User already exists';err.style.display='block';} return; }
    var parts=name.split(' ');
    var newUser={id:'u'+Date.now(),name:name,email:email,password:password,role:role,
      initials:parts.map(function(p){ return p[0]; }).join('').toUpperCase().substring(0,2),
      color:'#'+Math.floor(Math.random()*16777215).toString(16).padStart(6,'0'),
      tc:'#fff',status:'active',lastLogin:'Never'};
    (window.users=window.users||[]).push(newUser);
    await window.syncPasswordToSupabase(email,password);
    if(typeof sendMailgunEmail==='function'){
      await sendMailgunEmail(email,'Welcome to Good Liquid Bev Co CRM',
        'Hi '+name+',\n\nYour CRM account has been created.\n\nLogin at: goodliquidbevco.com\nEmail: '+email+'\nPassword: '+password+'\n\nPlease change your password after first login.\n\nMike Krail\nGood Liquid Bev Co');
    }
    if(ok){ ok.style.display='block'; ok.textContent='✓ '+name+' added! Welcome email sent.'; }
    if(typeof addNotification==='function') addNotification('👤 New user: '+name,email+' · '+role,'success');
    setTimeout(function(){ document.getElementById('invite-user-modal')?.classList.remove('show'); },1800);
  };

  /* ══════════════════════════════════════════════════
     16. ADD NEW BUTTONS TO AI TOOLBAR
     Deal Forecast, Recurring, Push Notifications
  ══════════════════════════════════════════════════ */
  var _origAddToolbar=window.addAIToolbar;
  if(typeof _origAddToolbar==='function'){
    window.addAIToolbar=function(){
      _origAddToolbar();
      var tools=document.getElementById('ai-tools'); if(!tools) return;
      function addBtn(id,text,fn){
        if(document.getElementById(id)) return;
        var b=document.createElement('button'); b.id=id; b.textContent=text;
        b.style.cssText='padding:8px 14px;background:#142238;border:1px solid rgba(0,229,192,.3);border-radius:20px;color:var(--teal);cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.4)';
        b.onclick=fn; tools.appendChild(b);
      }
      addBtn('btn-deal-forecast','📊 Deal Forecast',window.runDealForecast);
      addBtn('btn-recurring','🔄 Recurring',window.openRecurringSetup);
      addBtn('btn-push','🔔 Push Alerts',window.requestPushPermission);
    };
  }

  /* ══════════════════════════════════════════════════
     17. ADD TIMELINE BUTTON TO CLIENT DETAIL
  ══════════════════════════════════════════════════ */
  var _origViewClient=window.viewClientEnhanced;
  if(typeof _origViewClient==='function'){
    window.viewClientEnhanced=function(clientId){
      _origViewClient(clientId);
      setTimeout(function(){
        var overlay=document.getElementById('client-detail-overlay'); if(!overlay) return;
        var btnRow=overlay.querySelector('[onclick*="aiScoreClientHealth"]')?.parentElement;
        if(btnRow&&!btnRow.querySelector('.timeline-btn')){
          var b=document.createElement('button'); b.className='cbtn timeline-btn';
          b.textContent='📋 Timeline';
          b.onclick=function(){ overlay.remove(); window.openClientTimeline(clientId); };
          btnRow.appendChild(b);
        }
      },150);
    };
  }

  /* ══════════════════════════════════════════════════
     18. FAQ SECTION — injected into public site
  ══════════════════════════════════════════════════ */
  (function addFAQ(){
    if(document.getElementById('faq-section')) return;
    var contact=document.getElementById('contact'); if(!contact) return;
    var faqs=[
      {q:'What is your minimum order quantity?',a:'Our minimum is 150 cases (3,600 units) per production run. This applies to both canning and bottling services.'},
      {q:'How long does the process take?',a:'From concept to pallet is typically 8 weeks. This includes R&D, formulation approval, label review, scheduling, and production.'},
      {q:'Do you offer R&D and formulation services?',a:'Yes. Our R&D package starts at $1,000 per SKU and includes up to 3 formulation iterations. We help you develop and refine your beverage from scratch.'},
      {q:'What can formats do you offer?',a:'We currently offer 12oz Standard, 12oz Sleek, and 16oz Standard cans, as well as 750ml bottle filling.'},
      {q:'Are you certified?',a:'Yes. Good Liquid Bev Co is GMP, PCQI, and HACCP certified. We maintain strict food safety standards across all production runs.'},
      {q:'Do you work with alcohol or CBD/THC products?',a:'We specialize in non-alcoholic beverages and do not currently handle THC or CBD-infused products.'},
      {q:'How do I get started?',a:'Fill out our contact form or click "Schedule a tour" to visit our facility in Palmetto, FL. We\'ll discuss your project, timeline, and pricing in detail.'},
      {q:'Where are you located?',a:'We are located at 2011 51st Ave E, Unit 100, Palmetto, FL 34221. Tours are available Monday–Friday 8am–5pm.'},
    ];

    var section=document.createElement('section');
    section.id='faq-section';
    section.style.cssText='padding:80px 52px;background:rgba(10,22,40,.6)';
    section.innerHTML='<div style="max-width:800px;margin:0 auto">'+
      '<div style="font-size:11px;letter-spacing:3px;color:var(--teal);text-transform:uppercase;margin-bottom:12px">FAQ</div>'+
      '<h2 style="font-family:var(--ff-disp);font-size:clamp(32px,5vw,52px);color:var(--white);margin-bottom:40px;line-height:1.1">FREQUENTLY ASKED<br><span style="color:var(--teal)">QUESTIONS</span></h2>'+
      faqs.map(function(f,i){
        return '<div class="faq-item" style="border-bottom:1px solid rgba(255,255,255,.07);padding:0">'+
          '<button onclick="toggleFAQ('+i+')" style="width:100%;text-align:left;background:none;border:none;padding:20px 0;display:flex;justify-content:space-between;align-items:center;cursor:pointer;color:var(--white);font-size:15px;font-weight:600;font-family:var(--ff-body)">'+
            f.q+
            '<span id="faq-icon-'+i+'" style="font-size:20px;color:var(--teal);flex-shrink:0;margin-left:16px;transition:transform .3s">+</span>'+
          '</button>'+
          '<div id="faq-ans-'+i+'" style="display:none;padding:0 0 20px;font-size:14px;color:var(--muted);line-height:1.75">'+f.a+'</div>'+
        '</div>';
      }).join('')+
    '</div>';
    contact.parentNode.insertBefore(section,contact);
  })();

  window.toggleFAQ=function(i){
    var ans=document.getElementById('faq-ans-'+i);
    var icon=document.getElementById('faq-icon-'+i);
    if(!ans||!icon) return;
    var open=ans.style.display==='block';
    ans.style.display=open?'none':'block';
    icon.textContent=open?'+':'−';
    icon.style.transform=open?'rotate(0deg)':'rotate(45deg)';
  };

  /* ══════════════════════════════════════════════════
     19. TESTIMONIALS SECTION
  ══════════════════════════════════════════════════ */
  (function addTestimonials(){
    if(document.getElementById('testimonials-section')) return;
    var faq=document.getElementById('faq-section');
    var contact=document.getElementById('contact');
    var insertBefore=faq||contact; if(!insertBefore) return;

    var testimonials=[
      {name:'Jake Denton',company:'Tide & Taste Co.',text:'Good Liquid took our seltzer from a recipe on a napkin to 500 cases on shelves in under 10 weeks. Mike and Sandra were communicative the whole way through.',rating:5},
      {name:'Maria Santos',company:'Bloom Functional',text:'The R&D process was incredibly thorough. Three iterations and they nailed our adaptogen formula perfectly. Worth every penny.',rating:5},
      {name:'Dave Okafor',company:'SunBurst Seltzers',text:'We\'ve run four production cycles with Good Liquid. Consistent quality, fair pricing, and they actually pick up the phone. Rare in this industry.',rating:5},
    ];

    var section=document.createElement('section');
    section.id='testimonials-section';
    section.style.cssText='padding:80px 52px;background:var(--ink)';
    section.innerHTML='<div style="max-width:1100px;margin:0 auto">'+
      '<div style="font-size:11px;letter-spacing:3px;color:var(--teal);text-transform:uppercase;margin-bottom:12px">CLIENT STORIES</div>'+
      '<h2 style="font-family:var(--ff-disp);font-size:clamp(32px,5vw,52px);color:var(--white);margin-bottom:48px;line-height:1.1">WHAT OUR<br><span style="color:var(--teal)">CLIENTS SAY</span></h2>'+
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px">'+
      testimonials.map(function(t){
        return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:28px;position:relative">'+
          '<div style="font-size:22px;color:var(--teal);margin-bottom:12px">"</div>'+
          '<p style="font-size:14px;color:rgba(255,255,255,.8);line-height:1.75;margin-bottom:20px">'+t.text+'</p>'+
          '<div style="display:flex;align-items:center;gap:12px">'+
            '<div style="width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,var(--teal),#1a6fff);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;color:var(--ink)">'+t.name.split(' ').map(function(n){ return n[0]; }).join('')+'</div>'+
            '<div><div style="font-weight:700;font-size:13px;color:var(--white)">'+t.name+'</div><div style="font-size:11px;color:var(--muted)">'+t.company+'</div></div>'+
          '</div>'+
          '<div style="position:absolute;top:20px;right:20px;color:#f5c842;font-size:12px">★★★★★</div>'+
        '</div>';
      }).join('')+
      '</div></div>';
    insertBefore.parentNode.insertBefore(section,insertBefore);
  })();

  /* ══════════════════════════════════════════════════
     20. RUN POST-LOGIN CHECKS
  ══════════════════════════════════════════════════ */
  var _origLoginUser=window.loginUser;
  // checkRecurring runs after login
  var _loginWrap=window.loginUser;
  window.loginUser=function(u){
    _loginWrap(u);
    setTimeout(checkRecurringInvoices, 500);
  };

  console.log('[GL] fix.js v2.0 loaded — all features active');

})();
