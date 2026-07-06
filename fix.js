/* fix.js v2.2 — Good Liquid Bev Co
   All patches in one file. Loaded after index.html.
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

  /* ── Timezone-naive date formatter ──
     `new Date("2026-05-20")` parses YYYY-MM-DD as UTC midnight, so any timezone
     west of UTC renders the PREVIOUS day. Caught when a Florida-scheduled
     2026-05-20 run displayed "May 19" in the kanban + clients page + run sheet.
     Use window.fmtLocalDate(s, opts) for any date column persisted as a bare
     ISO date string. Accepts the same options object as toLocaleDateString. */
  window.fmtLocalDate = window.fmtLocalDate || function(s, opts){
    if(!s) return '';
    var str = String(s);
    var m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    var d = m ? new Date(+m[1], +m[2]-1, +m[3]) : new Date(str);
    return d.toLocaleDateString('en-US', opts);
  };

  /* ── Password policy helper ──
     Org-wide rule (set by Mike on 2026-05-22): minimum 8 characters,
     at least one uppercase letter, at least one special character.
     Returns null when the password is acceptable, otherwise an English
     error message ready to display.
     The error message is intentionally specific so users can see which
     rule they tripped — vague "password is invalid" messages just lead
     to support tickets. */
  window.GL_PW_MIN_LEN = 8;
  window.GL_PW_SPECIAL_RE = /[^A-Za-z0-9]/;
  window.GL_PW_UPPER_RE = /[A-Z]/;
  window.glValidatePassword = window.glValidatePassword || function(pw){
    pw = String(pw == null ? '' : pw);
    if(pw.length < window.GL_PW_MIN_LEN){
      return 'Password must be at least ' + window.GL_PW_MIN_LEN + ' characters.';
    }
    if(!window.GL_PW_UPPER_RE.test(pw)){
      return 'Password must include at least one capital letter (A–Z).';
    }
    if(!window.GL_PW_SPECIAL_RE.test(pw)){
      return 'Password must include at least one special character (e.g. !@#$%^&*).';
    }
    return null;
  };

  /* ── Compliant temporary password generator ──
     Produces a passphrase that satisfies window.glValidatePassword() by
     construction (always 12 chars, at least one uppercase, one lowercase,
     one digit, one special). Used when an admin invites a new staff or
     customer user and the system needs to seed a password they'll
     immediately reset. The old GL+6-random generator only sometimes hit
     the policy. */
  window.glGenerateTempPassword = window.glGenerateTempPassword || function(){
    var UP = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    var LO = 'abcdefghjkmnpqrstuvwxyz';
    var DG = '23456789';
    var SP = '!@#$%^&*';
    function pick(s){ return s[Math.floor(Math.random()*s.length)]; }
    // Guarantee one of each class so policy is always met.
    var out = [pick(UP), pick(LO), pick(DG), pick(SP)];
    var pool = UP + LO + DG + SP;
    while(out.length < 12) out.push(pick(pool));
    // Shuffle so the guaranteed chars aren't always in positions 0..3.
    for(var i = out.length - 1; i > 0; i--){
      var j = Math.floor(Math.random() * (i + 1));
      var t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out.join('');
  };

  /* ── USD currency formatter with enforced two-decimal precision ──
     Plain `.toLocaleString()` on a number drops trailing fractional zeros
     ($2,312.50 → "$2,312.5") which looks like a glitch on every invoice,
     KPI tile, and total line. Use window.fmtUsd(n) anywhere a dollar
     amount is shown to a user. Returns the bare numeric string — caller
     prepends the '$'. */
  window.fmtUsd = window.fmtUsd || function(n){
    return Number(n||0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  /* ── Super-user check ──
     UI gate that hides destructive buttons (Delete client, Remove
     user, etc.) for non-super admins. The server-side enforcement
     lives in 20260523_super_user_rls_enforcement.sql — RLS policies
     consult public.is_super_user() which reads profiles.is_super_user
     for the calling user, so a DevTools call bypassing this UI
     check still bounces at the database. This JS function is
     purely cosmetic now; the security boundary is the DB.

     Reads profiles.is_super_user from currentUser when available
     (post-migration). Falls back to the hardcoded owner email so
     the gate works against deployments that haven't applied the
     migration yet. */
  window.GL_SUPER_USER_EMAIL = 'mike@goodliquid.com';
  window.glIsSuperUser = window.glIsSuperUser || function(){
    var u = window.currentUser;
    if(!u) return false;
    if(u.is_super_user === true) return true;            // canonical
    if(u.is_super_user === false) return false;          // explicitly not super
    // Field absent (migration not applied yet) — fall back to email.
    return String(u.email||'').toLowerCase() === window.GL_SUPER_USER_EMAIL;
  };

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

  /* ── Supabase Auth (bcrypt passwords managed by Supabase) ── */
  var _glSupa=null;
  var _GL_SUPA_URL='https://ufjkeqmxwuyhbqyugcgg.supabase.co';
  var _GL_ANON_KEY='sb_publishable_-37mkPw8uLzEJM21T9jJOA_YQRQ7ikB';
  function getSupa(){
    if(_glSupa)return _glSupa;
    // 1. Use already-created client from index.html
    if(window.supa&&window.supa.auth){_glSupa=window.supa;return _glSupa;}
    // 2. Create from the CDN global (self-hosted supabase.min.js)
    if(window.supabase&&typeof window.supabase.createClient==='function'){
      try{
        _glSupa=window.supabase.createClient(_GL_SUPA_URL,_GL_ANON_KEY);
        window.supa=_glSupa;
        return _glSupa;
      }catch(e){console.error('[GL] supabase init failed',e);}
    }
    // 3. Last resort: build a minimal fetch-based client so auth still works
    //    even if the supabase-js bundle failed to parse/execute.
    try{
      var _s={auth:{signInWithPassword:async function(o){
        var r=await fetch(_GL_SUPA_URL+'/auth/v1/token?grant_type=password',{
          method:'POST',headers:{'Content-Type':'application/json','apikey':_GL_ANON_KEY},
          body:JSON.stringify({email:o.email,password:o.password})});
        var j=await r.json();
        if(j.error_code||j.error)return{data:null,error:{message:j.error_description||j.message||'Auth failed'}};
        return{data:{user:j.user,session:j},error:null};
      },signOut:async function(){return{error:null};},
      onAuthStateChange:function(){return{data:{subscription:{unsubscribe:function(){}}}};},
      getSession:async function(){return{data:{session:null},error:null};}},
      from:function(t){
        var _f=[];var _sel='*';var _si=false;
        var q={select:function(c){_sel=c||'*';return q;},
          eq:function(c,v){_f.push(c+'=eq.'+encodeURIComponent(v));return q;},
          is:function(c,v){_f.push(c+'=is.'+v);return q;},
          maybeSingle:function(){_si=true;return q;},single:function(){_si=true;return q;},
          then:function(res){
            var u=_GL_SUPA_URL+'/rest/v1/'+t+'?select='+encodeURIComponent(_sel)+(_f.length?'&'+_f.join('&'):'');
            var h={'apikey':_GL_ANON_KEY,'Content-Type':'application/json'};
            if(_si)h['Accept']='application/vnd.pgrst.object+json';
            return fetch(u,{headers:h}).then(function(r){return r.json();})
              .then(function(j){return res({data:j,error:null});})
              .catch(function(e){return res({data:null,error:{message:e.message}});});
          }};
        return q;
      },functions:{invoke:async function(){return{data:null,error:{message:'SDK not loaded'}};}},
      storage:{from:function(){return{getPublicUrl:function(p){return{data:{publicUrl:_GL_SUPA_URL+'/storage/v1/object/public/'+p}}}}}}
      };
      _glSupa=_s;window.supa=_s;
      console.warn('[GL] Using fetch-based Supabase fallback — supabase.min.js may not have loaded');
      return _glSupa;
    }catch(fb){console.error('[GL] fallback client failed',fb);}
    return null;
  }

  async function _glFetchProfile(sb,authUser){
    try{
      var r=await sb.from('profiles').select('*').eq('id',authUser.id).maybeSingle();
      if(r.error){console.warn('[GL] profile fetch error',r.error);return null;}
      if(!r.data)return null;
      var p=r.data;
      return {
        id:p.id, email:p.email||authUser.email,
        name:p.name||(authUser.email||'').split('@')[0],
        role:p.role||'sales', status:p.status||'active',
        // is_super_user: read from the profile column when it exists
        // (after 20260523_super_user_rls_enforcement.sql is applied).
        // glIsSuperUser() falls back to the owner-email check when this
        // is undefined so the UI gate works either way.
        is_super_user: typeof p.is_super_user === 'boolean' ? p.is_super_user : undefined,
        initials:p.initials||(authUser.email||'?').slice(0,2).toUpperCase(),
        color:p.color||'#1a6fff', tc:p.tc||'#fff',
        lastLogin:'Just now'
      };
    }catch(e){console.error('[GL] profile fetch threw',e);return null;}
  }

  /* ── checkPw — Supabase Auth (bcrypt). Falls back to customerLogins only. ── */
  window.checkPw=async function(){
    var eEl=document.getElementById('pw-email'),pEl=document.getElementById('pw-input'),err=document.getElementById('pw-err');
    if(!eEl||!pEl)return;
    var email=eEl.value.trim().toLowerCase(),pw=pEl.value;
    if(err){err.style.display='none';err.textContent='Incorrect email or password.';}
    function showErr(msg){if(err){err.style.display='block';if(msg)err.textContent=msg;}pEl.classList.add('wrong');setTimeout(function(){pEl.classList.remove('wrong');},500);}

    // Customer portal logins (browser-local, not in Supabase Auth)
    if(window.customerLogins){
      var c=window.customerLogins.find(function(x){return x.email.toLowerCase()===email&&x.password===pw;});
      if(c){window.currentPortalUser=c;if(typeof closePw==='function')closePw();if(typeof openCustomerPortal==='function')openCustomerPortal(c);return;}
    }

    var sb=getSupa();
    if(!sb){
      showErr('');
      if(err){err.innerHTML='Connection error. <a href="javascript:location.reload()" style="color:var(--teal)">Reload page</a> and try again.';err.style.display='block';}
      return;
    }
    try{
      var r=await sb.auth.signInWithPassword({email:email,password:pw});
      if(r.error||!r.data||!r.data.user){showErr();return;}
      var profile=await _glFetchProfile(sb,r.data.user);
      if(!profile){
        profile={
          id:r.data.user.id, email:r.data.user.email,
          name:(r.data.user.email||'').split('@')[0], role:'sales', status:'active',
          initials:(r.data.user.email||'?').slice(0,2).toUpperCase(),
          color:'#1a6fff', tc:'#fff', lastLogin:'Just now'
        };
      }
      // Merge into window.users so other UI lookups find the profile
      window.users=window.users||[];
      var idx=window.users.findIndex(function(u){return u.email.toLowerCase()===profile.email.toLowerCase();});
      if(idx>=0)window.users[idx]=Object.assign({},window.users[idx],profile);
      else window.users.unshift(profile);
      window.loginUser(profile);
    }catch(e){
      console.error('[GL] sign-in threw',e);
      showErr('Login service unavailable. Try again.');
    }
  };

  /* ── glSignOut — clear Supabase session and close CRM ── */
  window.glSignOut=async function(){
    var sb=getSupa();
    if(sb){try{await sb.auth.signOut();}catch(e){}}
    window.currentUser=null;
    if(typeof window.exitCRM==='function')window.exitCRM();
  };

  /* ══════════════════════════════════════════════
     APP SETTINGS — Supabase-backed org config
     Replaces per-device localStorage for any setting
     that must be consistent across all staff browsers:
       - SMS notification toggles + phone number
       - CCP (Critical Control Point) limit overrides
       - Compliance task visibility overrides
       - Dropbox Sign template mappings
       - Service package pricing
     Called automatically on login via loginUser().
     Admin writes go through glSaveAppSetting().
  ══════════════════════════════════════════════ */

  /* In-memory cache — refreshed on login and after any write */
  window.GL_APP_SETTINGS = window.GL_APP_SETTINGS || {};

  /* Load all settings rows from Supabase into the cache */
  window.glLoadAppSettings = async function(){
    var sb = getSupa(); if(!sb) return;
    try {
      var r = await sb.from('app_settings').select('key,value');
      if(r.error || !r.data) return;
      r.data.forEach(function(row){
        window.GL_APP_SETTINGS[row.key] = row.value;
      });
      // Bridge legacy localStorage knobs → in-memory cache (read-only;
      // writes go to DB from now on). Done once to unify the code path.
      _bridgeLegacySettings();
    } catch(e){ /* non-fatal — fall back to localStorage */ }
  };

  /* Get a setting by key (DB cache first, localStorage fallback) */
  window.glGetSetting = function(key, fallback){
    if(key in window.GL_APP_SETTINGS) return window.GL_APP_SETTINGS[key];
    return fallback !== undefined ? fallback : null;
  };

  /* Save a setting to Supabase and update the local cache */
  window.glSaveAppSetting = async function(key, value){
    window.GL_APP_SETTINGS[key] = value;
    var sb = getSupa(); if(!sb) return false;
    try {
      var r = await sb.from('app_settings').upsert({key:key,value:value},{onConflict:'key'});
      if(r.error){ console.warn('[GL] app_settings save failed',r.error); return false; }
      return true;
    } catch(e){ console.warn('[GL] app_settings save threw',e); return false; }
  };

  /* One-time bridge: copy existing localStorage values into the
     in-memory cache so the rest of the app doesn't need to change yet.
     Org admins can then update settings via the UI to persist to DB. */
  function _bridgeLegacySettings(){
    var map = {
      sms_to:          'gl_sms_to',
      sms_alert_phone: 'gl_sms_alert_phone',
      sms_paid:        'gl_sms_paid',
      sms_won:         'gl_sms_won',
      sms_quote:       'gl_sms_quote',
      sms_tour:        'gl_sms_tour',
      sms_overdue:     'gl_sms_overdue',
      sign_templates:  'gl_sign_templates',
      stripe_pub_key:  'gl_stripe_pub',
      sentry_dsn:      'gl_sentry_dsn'
    };
    Object.keys(map).forEach(function(settingKey){
      if(!(settingKey in window.GL_APP_SETTINGS)){
        var raw = localStorage.getItem(map[settingKey]);
        if(raw != null){
          try { window.GL_APP_SETTINGS[settingKey] = JSON.parse(raw); }
          catch(e){ window.GL_APP_SETTINGS[settingKey] = raw; }
        }
      }
    });
    // Remove the dead dead-code key that the audit flagged
    localStorage.removeItem('gl_supabase_key');
  }

  /* Hook into loginUser so settings load immediately on auth */
  window.GL_HOOKS.registerLoginHook(function(){ window.glLoadAppSettings(); });

  /* ══════════════════════════════════════════════
     ADMIN USER MANAGEMENT (Supabase Auth-backed)
     Overrides the legacy local-only flows so user
     invites, password resets, and removals go
     through Supabase Auth + profiles table.
  ══════════════════════════════════════════════ */

  /* ── createInvitedUser — admin sends a Supabase invite email (magic link) ──
     The invitee receives an email with a link. Clicking it brings them to the
     CRM where they are auto-signed-in and prompted to create their own password.
     No admin-set password is ever transmitted or stored. ── */
  window.createInvitedUser=async function(){
    var nameEl=document.getElementById('inv-name');
    var emailEl=document.getElementById('inv-email');
    var roleEl=document.getElementById('inv-role');
    var err=document.getElementById('inv-err');
    var ok=document.getElementById('inv-ok');
    if(!nameEl||!emailEl||!roleEl){alert('Invite form not found — reload and try again.');return;}
    if(err)err.style.display='none';
    if(ok)ok.style.display='none';
    var name=nameEl.value.trim();
    var email=emailEl.value.trim().toLowerCase();
    var role=roleEl.value;
    function setErr(m){
      if(err){err.textContent=m;err.style.display='block';}
      else{alert(m);}
    }
    if(!name){setErr('Name is required');return;}
    if(!email||email.indexOf('@')<0){setErr('Valid email is required');return;}
    if((window.users||[]).find(function(u){return u.email.toLowerCase()===email;})){setErr('A user with that email already exists');return;}

    // ── Give immediate feedback BEFORE any async work ──
    var btn=document.querySelector('#invite-user-modal button.cbtn.pri');
    var origText=btn?btn.textContent:'Send Invite';
    if(btn){btn.disabled=true;btn.textContent='Sending…';}

    var sb=getSupa();
    if(!sb){setErr('Auth service unavailable.');if(btn){btn.disabled=false;btn.textContent=origText;}return;}

    try{
      var sess=await sb.auth.getSession();
      var token=sess&&sess.data&&sess.data.session&&sess.data.session.access_token;
      if(!token){
        setErr('Not signed in — please log in and try again.');
        if(btn){btn.disabled=false;btn.textContent=origText;}
        return;
      }
      var r=await fetch(_GL_SUPA_URL+'/functions/v1/invite-staff-user',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},
        body:JSON.stringify({email:email,name:name,role:role,redirectTo:window.location.origin})
      });
      var d=await r.json();
      if(!r.ok||!d.ok){
        setErr(d.error||'Invite failed (HTTP '+r.status+') — see console');
        if(btn){btn.disabled=false;btn.textContent=origText;}
        return;
      }
      var initials=name.split(' ').map(function(p){return p[0];}).join('').toUpperCase().substring(0,2);
      window.users=window.users||[];
      window.users.push({id:d.userId||('u'+Date.now()),name:name,email:email,role:role,initials:initials,color:'#1a6fff',tc:'#fff',status:'invited',lastLogin:'Never'});
      if(ok){ok.style.display='block';ok.textContent='✓ Invite sent! '+name+' will receive an email with a link to set their password.';}
      if(typeof renderUsersPanel==='function')renderUsersPanel();
      if(typeof renderUsers==='function')renderUsers();
      if(typeof addNotification==='function')addNotification('👤 Invite sent: '+name,email+' — password-setup link emailed','success');
      setTimeout(function(){if(typeof closeInviteModal==='function')closeInviteModal();},4000);
    }catch(e){
      console.error('[GL] invite-staff-user threw',e);
      setErr('Failed: '+(e.message||'unknown error'));
      if(btn){btn.disabled=false;btn.textContent=origText;}
    }
  };

  /* ── resetPw — admin clicks Reset on a user row → send password reset email ── */
  window.resetPw=async function(uid){
    var u=(window.users||[]).find(function(x){return x.id===uid;});
    if(!u){alert('User not found.');return;}
    var sb=getSupa();
    if(!sb){alert('Auth service unavailable.');return;}
    if(!confirm('Send password reset email to '+u.email+'? They will click the link to choose a new password.'))return;
    try{
      var r=await sb.auth.resetPasswordForEmail(u.email,{redirectTo:window.location.origin});
      if(r.error){alert('Reset failed: '+r.error.message);return;}
      alert('✓ Password reset email sent to '+u.email);
      if(typeof addNotification==='function')addNotification('📧 Reset email sent',u.email,'success');
    }catch(e){
      console.error('[GL] resetPasswordForEmail threw',e);
      alert('Failed: '+(e.message||'unknown error'));
    }
  };

  /* ── Wrap openChangePwModal: toggle Current-password row when an admin
       picks another user (admin path uses reset email, not reauth). ── */
  (function(){
    var inner = window.openChangePwModal;
    window.openChangePwModal = function(){
      if(typeof inner === 'function') inner.apply(this, arguments);
      var oldRow = document.getElementById('change-pw-old');
      var sel    = document.getElementById('change-pw-user-sel');
      function updateOldVisibility(){
        if(!oldRow) return;
        var row = oldRow.closest('.frow') || oldRow.parentElement;
        if(!row) return;
        var selfPick = !sel || !sel.value || (window.currentUser && sel.value === window.currentUser.id);
        row.style.display = selfPick ? '' : 'none';
        if(!selfPick) oldRow.value = '';
      }
      if(sel && !sel._glOldHookBound){
        sel.addEventListener('change', updateOldVisibility);
        sel._glOldHookBound = true;
      }
      updateOldVisibility();
    };
  }());

  /* ── doChangePassword — change-password modal (self change OR admin reset other) ── */
  window.doChangePassword=async function(){
    var oldPw=(document.getElementById('change-pw-old')||{}).value||'';
    var newPw=(document.getElementById('change-pw-new')||{}).value||'';
    var confirmPw=(document.getElementById('change-pw-confirm')||{}).value||'';
    var err=document.getElementById('change-pw-err');
    var ok=document.getElementById('change-pw-ok');
    if(err)err.style.display='none';
    if(ok)ok.style.display='none';
    function setErr(m){if(err){err.textContent=m;err.style.display='block';}}
    function setOk(m){if(ok){ok.textContent=m;ok.style.display='block';}}
    var _pwErr = (window.glValidatePassword ? window.glValidatePassword(newPw) : (newPw.length < 8 ? 'Password must be at least 8 characters.' : null));
    if(_pwErr){ setErr(_pwErr); return; }
    if(newPw!==confirmPw){setErr('Passwords do not match.');return;}

    var sb=getSupa();
    if(!sb){setErr('Auth service unavailable.');return;}

    var isAdmin=window.currentUser&&window.currentUser.role==='admin';
    var sel=document.getElementById('change-pw-user-sel');
    var targetId=null;
    if(isAdmin&&sel&&sel.value&&window.currentUser&&sel.value!==window.currentUser.id)targetId=sel.value;

    if(!targetId){
      // Self-change: verify the current password by reauthenticating first.
      if(!oldPw){setErr('Enter your current password to confirm the change.');return;}
      if(oldPw===newPw){setErr('New password must differ from the current one.');return;}
      try{
        var check=await sb.auth.signInWithPassword({email:window.currentUser.email,password:oldPw});
        if(check.error){setErr('Current password is incorrect.');return;}
      }catch(e){setErr('Could not verify current password: '+(e.message||'unknown'));return;}
      try{
        var r=await sb.auth.updateUser({password:newPw});
        if(r.error){setErr(r.error.message);return;}
        setOk('Password updated.');
        if(typeof window.glAudit==='function')window.glAudit('password_changed_self',window.currentUser.email,{});
        if(typeof addNotification==='function')addNotification('🔑 Password changed','Your password was updated','success');
        setTimeout(function(){if(typeof closeChangePwModal==='function')closeChangePwModal();},1500);
      }catch(e){setErr('Failed: '+(e.message||'unknown'));}
    }else{
      var target=(window.users||[]).find(function(u){return u.id===targetId;});
      if(!target){setErr('Target user not found.');return;}
      try{
        var rr=await sb.auth.resetPasswordForEmail(target.email,{redirectTo:window.location.origin});
        if(rr.error){setErr(rr.error.message);return;}
        setOk('Reset email sent to '+target.email+'.');
        if(typeof addNotification==='function')addNotification('📧 Reset email sent',target.email,'success');
        setTimeout(function(){if(typeof closeChangePwModal==='function')closeChangePwModal();},2000);
      }catch(e){setErr('Failed: '+(e.message||'unknown'));}
    }
  };

  /* ── removeUser — soft delete (status=inactive); hard delete needs dashboard ── */
  window.removeUser=async function(id){
    var u=(window.users||[]).find(function(x){return x.id===id;});
    if(!u)return;
    if(!confirm('Remove '+u.name+'? They will lose CRM access immediately.\n\nNote: their Supabase Auth account remains. To fully delete, remove from the Auth → Users dashboard.'))return;
    var sb=getSupa();
    var uuidRe=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if(sb&&uuidRe.test(u.id||'')){
      try{
        // updated_at is bumped automatically by the trg_profiles_updated_at
        // trigger (see 20260522_profiles_updated_at.sql) — don't send it
        // here or the UPDATE 400's against deployments that haven't run
        // the migration yet.
        var r=await sb.from('profiles').update({status:'inactive'}).eq('id',u.id);
        if(r.error){
          console.warn('[GL] profile status update failed',r.error);
          if(typeof addNotification==='function') addNotification('Remove failed', r.error.message, 'error');
        }
      }catch(e){console.error('[GL] removeUser profile update threw',e);}
    }
    if(window.users)window.users=window.users.filter(function(x){return x.id!==id;});
    if(typeof renderUsersPanel==='function')renderUsersPanel();
    if(typeof renderUsers==='function')renderUsers();
    if(typeof addNotification==='function')addNotification('👤 User removed: '+u.name,u.email,'warning');
  };

  /* ── sendResetLink — public "Forgot password?" → email a reset link ── */
  window.sendResetLink=async function(){
    var email=(document.getElementById('reset-email-inp')||{}).value||'';
    email=email.trim();
    if(!email)return;
    var sb=getSupa();
    if(!sb){alert('Auth service unavailable.');return;}
    document.getElementById('reset-step1').style.display='none';
    document.getElementById('reset-success').style.display='block';
    try{
      await sb.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin});
    }catch(e){console.error('[GL] resetPasswordForEmail threw',e);}
  };

  /* ── checkPw addition: reject inactive profiles (applied via wrapping) ── */
  var _glOrigCheckPw=window.checkPw;
  window.checkPw=async function(){
    var origLoginUser=window.loginUser;
    var rejectedReason=null;
    // Intercept loginUser briefly to inspect the profile before completing
    window.loginUser=function(u){
      if(u&&u.status==='inactive'){
        rejectedReason='inactive';
        return;
      }
      origLoginUser(u);
    };
    try{
      await _glOrigCheckPw();
    }finally{
      window.loginUser=origLoginUser;
    }
    if(rejectedReason==='inactive'){
      var err=document.getElementById('pw-err');
      if(err){err.style.display='block';err.textContent='This account has been disabled.';}
      // Also sign out the orphan session so we don't leak auth
      var sb=getSupa();if(sb){try{await sb.auth.signOut();}catch(e){}}
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

  console.log('[GL] fix.js v2.1 loaded');
})();

