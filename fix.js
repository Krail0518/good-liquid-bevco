/* fix.js v2.2 — Good Liquid Bev Co
   Bootstrap only — auth/utils/invoice in separate modules. Loaded after index.html.
   DO NOT use Ctrl+S on index.html — only deploy fix.js */
(function(){
  'use strict';

  /* ── Production console guard ──────────────────────────────
     Suppress all console.log output in production so the
     feature map, record counts, and internal state are not
     visible to anyone with DevTools open.
     To re-enable for debugging, run in the browser console:
       localStorage.setItem('gl_debug','1'); location.reload();
     To disable again:
       localStorage.removeItem('gl_debug'); location.reload();
  ─────────────────────────────────────────────────────────── */
  window.GL_DEBUG = (localStorage.getItem('gl_debug') === '1');
  if(!window.GL_DEBUG){
    var _noop = function(){};
    console.log  = _noop;
    console.info = _noop;
    // Keep console.warn and console.error so real problems still surface.
  }

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


  /* ── INTERCEPT ALL NEW INVOICE ENTRY POINTS ──
       The original cNav lives in index.html. We only need to wrap it once;
       the perm-gate is added below in the same wrap. */
  var _cNavOrig = window.cNav;
  window.openNewInvoice = function(){ window.openNewInvoiceBuilder(); };
  document.addEventListener('click', function(e){
    var el = e.target.closest('button,a,.cni');
    if(!el) return;
    if((el.textContent||'').trim().includes('New Invoice')){
      e.preventDefault(); e.stopImmediatePropagation();
      window.openNewInvoiceBuilder();
    }
  }, true);

  /* Staff users are loaded from Supabase `profiles` via loadSupabaseData()
     on login. Removed the hardcoded coreUsers seed — having it here used
     to force-overwrite the role from the database (e.g. promoting Sandra
     to admin in profiles got reverted to 'sales' on every page load).
     Source of truth is now exclusively the profiles table. */
  window.users = window.users || [];

  /* ── CORE CLIENTS ──
     Production state: no demo clients. Real clients come from Supabase via
     loadSupabaseData() or from the CRM "Add Client" button. */
  function glEnsureClients(){
    window.clients = window.clients || [];
  }
  glEnsureClients();

  /* ── PERMISSIONS ──
     Page-name convention matches index.html cNav calls (e.g. 'newinv', not 'new-invoice').
     window.PERMISSIONS is bridged from index.html so both the role-filter UI and can() share one table. */
  var ALL=['dashboard','clients','pipeline','invoices','invoice-detail','newinv','referrals','referrers','activity','users','customers','calendar','production-cal','production-runs','samples','formulas','yield','content','compliance','holds','cip','audit','defects','vendors','tasks','documents','inventory','announcements','time-tracker','reports','ai-settings'];
  var WAREHOUSE=['dashboard','production-runs','production-cal','inventory','cip','defects','yield','samples','tasks','announcements'];
  if(window.PERMISSIONS){window.PERMISSIONS.admin=ALL;window.PERMISSIONS.sales=['dashboard','clients','pipeline','invoices','newinv','referrals','referrers','activity','calendar','production-cal','production-runs','samples','formulas','yield','content','cip','defects','vendors','tasks','announcements','reports'];window.PERMISSIONS.warehouse=WAREHOUSE;}
  else{window.PERMISSIONS={admin:ALL,sales:['dashboard','clients','pipeline','invoices','newinv','referrals','referrers','activity','calendar','production-cal','production-runs','samples','formulas','yield','content','cip','defects','vendors','tasks','announcements','reports'],warehouse:WAREHOUSE,viewer:['dashboard','clients','invoices','activity']};}
  window.can=function(page){var u=window.currentUser;if(!u)return false;if(u.role==='admin')return true;return(window.PERMISSIONS[u.role]||[]).includes(page);};
  /* Register nav guards: role-based perm check + new-invoice routing */
  window.GL_HOOKS.registerNavGuard(function(page){
    if(!window.can(page)){if(typeof addNotification==='function')addNotification('Access denied',page,'warning');return false;}
  });
  window.GL_HOOKS.registerNavGuard(function(page){
    if(page==='newinv'||page==='new-invoice'||page==='newInvoice'){window.openNewInvoiceBuilder();return false;}
  });

  /* ── FIX DOM STRUCTURE ── */
  function fixDOMStructure(){
    if(fixDOMStructure._done)return;
    var panel=document.getElementById('crm-panel'),top=document.getElementById('crm-top'),body=document.getElementById('crm-body'),notif=document.getElementById('notif-panel'),ov=document.getElementById('cnav-overlay');
    if(!panel||!top||!body)return;  // try again next call when DOM is ready
    if(notif&&notif.parentElement===top)panel.appendChild(notif);
    if(ov&&ov.parentElement===top)panel.appendChild(ov);
    if(body.parentElement===top)panel.appendChild(body);
    fixDOMStructure._done=true;
  }
  fixDOMStructure();
  if(!fixDOMStructure._done) document.addEventListener('DOMContentLoaded',fixDOMStructure);
  if(!fixDOMStructure._done) setTimeout(fixDOMStructure,100);

  /* ── CHAT BUBBLE — admin only ── */
  setTimeout(function(){
    var b=document.getElementById('gl-chat-bubble'),w=document.getElementById('gl-chat-window'),p=document.getElementById('crm-panel');
    if(!b||!p)return;b.style.display='none';
    // Keep the floating bubble hidden in CRM — the top-bar 💬 button is used instead.
    new MutationObserver(function(){var o=p.classList.contains('show');b.style.display='none';if(!o&&w)w.classList.remove('show');}).observe(p,{attributes:true,attributeFilter:['class']});
    // Top-bar chat toggle: reposition the window to drop down from the toolbar.
    window.glToggleCRMChat=function(){if(!w)return;w.style.top='54px';w.style.bottom='auto';w.style.right='12px';if(typeof toggleChat==='function')toggleChat();else w.classList.toggle('show');};
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
    if(rb){rb.textContent=u.role.charAt(0).toUpperCase()+u.role.slice(1);rb.style.cssText=u.role==='admin'?'background:rgba(245,200,66,.12);color:#d4a200;border:1px solid rgba(245,200,66,.25)':u.role==='sales'?'background:rgba(26,111,255,.12);color:#6b9fff;border:1px solid rgba(26,111,255,.25)':u.role==='warehouse'?'background:rgba(168,85,247,.12);color:#c4a4f8;border:1px solid rgba(168,85,247,.25)':'background:rgba(255,255,255,.06);color:#6b87ad';}
    if(u.role==='admin'){var nu=$('nav-users'),nc=$('nav-customers');if(nu)nu.style.display='flex';if(nc)nc.style.display='flex';var tbu=$('top-btn-users'),tbb=$('top-btn-backup'),tbd=$('top-btn-digest');if(tbu)tbu.style.display='';if(tbb)tbb.style.display='';if(tbd)tbd.style.display='';}
    var panel=$('crm-panel');if(panel)panel.classList.add('show');document.body.style.overflow='hidden';
    if(!window.crmInited&&typeof initCRM==='function')initCRM();
    if(typeof addAIToolbar==='function')addAIToolbar();
    if(typeof addNotifBadge==='function')addNotifBadge();
    if(typeof checkStaleDeals==='function')checkStaleDeals();
    if(typeof loadNotifications==='function')loadNotifications();
    setTimeout(function(){var n=document.querySelector('.cnav');if(n)n.scrollTop=0;},150);
    if(window.GL_HOOKS && window.GL_HOOKS._loginHooks){
      window.GL_HOOKS._loginHooks.forEach(function(fn){ try{ fn(u); }catch(e){ console.warn('[GL] login hook threw',e); } });
    }
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


  console.log('[GL] fix.js v2.2 loaded');
})();

