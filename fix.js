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

/* ==========================================================
   PRICING PATCH — Supabase rates + admin editor
   Canning & Bottling pulled from DB, never hardcoded
   ========================================================== */
(function(){

  var SURL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1';
  var SKEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE';
  var SH   = { 'apikey': SKEY, 'Authorization': 'Bearer ' + SKEY, 'Content-Type': 'application/json' };
  var CANS_PER_CASE = 24;

  /* ── Rate cache ────────────────────────────────────────── */
  window._glRates = { canning: [], bottling: [], loaded: false, overrides: {} };

  window.glLoadRates = async function() {
    if (window._glRates.loaded) return window._glRates;
    try {
      var res = await Promise.all([
        fetch(SURL + '/canning_rates?order=format,min_cases',  {headers: SH}).then(function(r){return r.json();}),
        fetch(SURL + '/bottling_rates?order=format,min_units', {headers: SH}).then(function(r){return r.json();})
      ]);
      window._glRates.canning  = Array.isArray(res[0]) ? res[0] : [];
      window._glRates.bottling = Array.isArray(res[1]) ? res[1] : [];
      window._glRates.loaded   = true;
    } catch(e) { console.error('[GL] Rate load failed', e); }
    return window._glRates;
  };

  // Per-client negotiated rates. Cached in memory keyed by client_id so the
  // builder reads them synchronously when rendering line rows. Refreshed on
  // demand by glLoadClientOverrides(clientId).
  window.glLoadClientOverrides = async function(clientId){
    if(!clientId) return null;
    try {
      var rows = await fetch(SURL + '/client_rate_overrides?client_id=eq.' + clientId, {headers: SH}).then(function(r){ return r.json(); });
      if(Array.isArray(rows)){
        var byKey = {};
        rows.forEach(function(r){
          var k = (r.service||'') + '|' + (r.format||'');
          byKey[k] = r;
        });
        window._glRates.overrides[clientId] = byKey;
        return byKey;
      }
    } catch(e){ console.warn('[GL] client override load failed', e); }
    return null;
  };
  // Re-renders any existing canning/bottling rows after a new client is
  // picked so the override rate is applied immediately. Used by the
  // invoice builder's client dropdown onchange handler.
  window.glOnInvClientChange = async function(clientId){
    if(!clientId) return;
    await window.glLoadClientOverrides(clientId);
    document.querySelectorAll('[id$="-format"]').forEach(function(fe){
      var uid = fe.id.replace(/-format$/, '');
      var row = document.getElementById(uid);
      if(!row) return;
      // Reset any manual price override so the new client's rate takes effect.
      if(row.hasAttribute('data-pu-override')) row.removeAttribute('data-pu-override');
      if(document.getElementById(uid+'-cases') && typeof window.glUpdateCan === 'function') window.glUpdateCan(uid);
      if(document.getElementById(uid+'-qty')   && typeof window.glUpdateBtl === 'function') window.glUpdateBtl(uid);
    });
    // Refresh the small chip showing whether this client has overrides.
    // Only count rows whose effective_from/until window includes today —
    // expired or not-yet-active overrides shouldn't show as "applied."
    var badge = document.getElementById('gl-inv-pricing-badge');
    if(badge){
      var cache = window._glRates.overrides && window._glRates.overrides[clientId];
      var today = new Date().toISOString().slice(0,10);
      var count = 0;
      if(cache){
        Object.keys(cache).forEach(function(k){
          var r = cache[k];
          if(r.effective_from   && today < r.effective_from)   return;
          if(r.effective_until  && today > r.effective_until)  return;
          count++;
        });
      }
      if(count){
        badge.style.display = 'inline-block';
        badge.textContent = '💵 ' + count + ' custom rate' + (count===1?'':'s') + ' applied';
      } else {
        badge.style.display = 'none';
      }
    }
  };
  function getClientOverride(clientId, service, format){
    if(!clientId) return null;
    var byKey = window._glRates.overrides && window._glRates.overrides[clientId];
    if(!byKey) return null;
    // Honor effective_from / effective_until if set.
    function active(r){
      if(!r) return false;
      var today = new Date().toISOString().slice(0,10);
      if(r.effective_from   && today < r.effective_from)   return false;
      if(r.effective_until  && today > r.effective_until)  return false;
      return true;
    }
    // Exact format match first; fall back to format-agnostic for hour services.
    var exact = byKey[service + '|' + (format||'')];
    if(active(exact)) return parseFloat(exact.override_rate);
    var anyFmt = byKey[service + '|'];
    if(active(anyFmt)) return parseFloat(anyFmt.override_rate);
    return null;
  }
  window.glGetClientOverride = getClientOverride;

  function getCanRate(cases, format, clientId) {
    var ovr = getClientOverride(clientId, 'canning', format);
    if(ovr != null) return ovr;
    var tiers = window._glRates.canning
      .filter(function(r){ return r.format === format; })
      .sort(function(a,b){ return a.min_cases - b.min_cases; });
    if (!tiers.length) return 0.48;
    var rate = parseFloat(tiers[0].price_per_can);
    for (var i = 0; i < tiers.length; i++) {
      if (cases >= tiers[i].min_cases) rate = parseFloat(tiers[i].price_per_can);
    }
    return rate;
  }

  function getBottleRate(units, format, clientId) {
    var ovr = getClientOverride(clientId, 'bottling', format);
    if(ovr != null) return ovr;
    var tiers = window._glRates.bottling
      .filter(function(r){ return r.format === format; })
      .sort(function(a,b){ return a.min_units - b.min_units; });
    if (!tiers.length) return 2.25;
    var rate = parseFloat(tiers[0].price_per_unit);
    for (var i = 0; i < tiers.length; i++) {
      if (units >= tiers[i].min_units) rate = parseFloat(tiers[i].price_per_unit);
    }
    return rate;
  }

  function usd(n, d) {
    return '$' + parseFloat(n).toLocaleString('en-US', {
      minimumFractionDigits: d == null ? 2 : d,
      maximumFractionDigits: d == null ? 2 : d
    });
  }

  function getLineTable() {
    var b = document.getElementById('gl-inv-body');
    return b ? b.children[2] : null;
  }

  /* ── Pricing Admin Page ────────────────────────────────── */
  window.glOpenPricing = async function() {
    document.getElementById('gl-pricing-modal')?.remove();
    await window.glLoadRates();

    var modal = document.createElement('div');
    modal.id = 'gl-pricing-modal';
    modal.setAttribute('style',
      'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px');

    function buildTable(title, rows, pkField, labelField, minField, priceField, tableKey) {
      var grouped = {};
      rows.forEach(function(r) { (grouped[r[labelField]] = grouped[r[labelField]] || []).push(r); });
      var html = '<div style="margin-bottom:24px">' +
        '<div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:10px">' + title + '</div>' +
        '<table style="width:100%;border-collapse:collapse">' +
        '<tr style="font-size:11px;color:var(--muted)">' +
        '<th style="text-align:left;padding:6px 8px">Format</th>' +
        '<th style="text-align:left;padding:6px 8px">Min ' + (tableKey==='canning'?'Cases':'Units') + '</th>' +
        '<th style="text-align:left;padding:6px 8px">Price</th>' +
        '<th style="padding:6px 8px"></th></tr>';
      rows.forEach(function(r) {
        html += '<tr style="border-top:1px solid rgba(255,255,255,.06)">' +
          '<td style="padding:7px 8px;font-size:12px;color:#fff">' + r[labelField] + '</td>' +
          '<td style="padding:7px 8px;font-size:12px;color:var(--muted)">' + r[minField] + '+</td>' +
          '<td style="padding:7px 8px">' +
          '<input data-id="' + r.id + '" data-table="' + tableKey + '" data-field="' + priceField + '" ' +
          'value="' + parseFloat(r[priceField]).toFixed(4) + '" type="number" step="0.0001" min="0" ' +
          'style="width:90px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:4px 8px;font-size:12px"/>' +
          '</td>' +
          '<td style="padding:7px 8px">' +
          '<button onclick="window.glSaveRate(this)" data-id="' + r.id + '" data-table="' + tableKey + '" data-field="' + priceField + '" ' +
          'style="background:rgba(0,229,192,.15);border:1px solid rgba(0,229,192,.3);color:var(--teal);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer">Save</button>' +
          '</td></tr>';
      });
      html += '</table></div>';
      return html;
    }

    modal.innerHTML =
      '<div style="background:#0d1f33;border:1px solid rgba(255,255,255,.1);border-radius:14px;width:100%;max-width:620px;max-height:85vh;overflow-y:auto;padding:24px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">' +
          '<div style="font-size:16px;font-weight:700;color:#fff">Pricing Manager</div>' +
          '<button onclick="document.getElementById(\'gl-pricing-modal\').remove()" ' +
          'style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer">x</button>' +
        '</div>' +
        buildTable('CANNING RATES (per can)', window._glRates.canning, 'id', 'format_label', 'min_cases', 'price_per_can', 'canning') +
        buildTable('BOTTLING RATES (per bottle)', window._glRates.bottling, 'id', 'format_label', 'min_units', 'price_per_unit', 'bottling') +
        '<div style="font-size:11px;color:var(--muted);margin-top:8px">Changes save instantly to the database and apply to all new invoices.</div>' +
      '</div>';

    document.body.appendChild(modal);
  };

  window.glSaveRate = async function(btn) {
    var id    = btn.getAttribute('data-id');
    var tbl   = btn.getAttribute('data-table');
    var field = btn.getAttribute('data-field');
    var input = btn.parentNode.parentNode.querySelector('input[data-id="' + id + '"]');
    var val   = parseFloat(input.value);
    if (isNaN(val) || val <= 0) { alert('Invalid price'); return; }

    btn.textContent = '...';
    var endpoint = SURL + '/' + (tbl === 'canning' ? 'canning_rates' : 'bottling_rates') + '?id=eq.' + id;
    var body = {};
    body[field] = val;
    body['updated_at'] = new Date().toISOString();

    try {
      var res = await fetch(endpoint, {
        method: 'PATCH',
        headers: Object.assign({}, SH, {'Prefer': 'return=minimal'}),
        body: JSON.stringify(body)
      });
      if (res.ok || res.status === 204) {
        btn.textContent = 'Saved';
        btn.style.background = 'rgba(34,197,94,.2)';
        btn.style.borderColor = 'rgba(34,197,94,.4)';
        btn.style.color = '#22c55e';
        // Update cache
        var cache = tbl === 'canning' ? window._glRates.canning : window._glRates.bottling;
        var row = cache.find(function(r){ return r.id == id; });
        if (row) row[field] = val;
        setTimeout(function(){ btn.textContent='Save'; btn.style.background=''; btn.style.borderColor=''; btn.style.color=''; }, 2000);
      } else {
        btn.textContent = 'Error';
        console.error('[GL] Save failed', res.status);
      }
    } catch(e) {
      btn.textContent = 'Error';
      console.error('[GL] Save error', e);
    }
  };

  /* ── Add Pricing nav button to CRM sidebar ─────────────── */
  function injectPricingNav() {
    var sidebar = document.querySelector('.cpills') || document.querySelector('[class*="nav"]');
    if (document.getElementById('gl-pricing-nav')) return;
    var btn = document.createElement('button');
    btn.id = 'gl-pricing-nav';
    btn.textContent = '$ Pricing';
    btn.onclick = window.glOpenPricing;
    btn.setAttribute('style',
      'background:rgba(0,229,192,.1);border:1px solid rgba(0,229,192,.3);color:var(--teal);' +
      'border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;cursor:pointer;margin:4px');
    // Add to page in a sensible spot — next to invoices button if it exists
    var invoiceBtn = [...document.querySelectorAll('button,a')].find(function(el){
      return el.textContent.includes('Invoice') || el.textContent.includes('invoice');
    });
    if (invoiceBtn && invoiceBtn.parentNode) {
      invoiceBtn.parentNode.insertBefore(btn, invoiceBtn.nextSibling);
    } else {
      document.body.appendChild(btn);
    }
  }

  // Inject nav after CRM loads
  setTimeout(injectPricingNav, 1500);
  document.addEventListener('click', function() { setTimeout(injectPricingNav, 500); });

  console.log('[GL] Pricing patch loaded — Supabase rates active');
}());

/* ============================================================
   INVOICE PRICING - Supabase live rates. Do not remove.
   ============================================================ */
(function(){
  var SURL='https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1';
  var SKEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE';
  var SH={'apikey':SKEY,'Authorization':'Bearer '+SKEY,'Content-Type':'application/json'};
  var CPC=24;
  window._glR={c:[],b:[],ok:false};
  window.glLoadRates=async function(){
    if(window._glR.ok)return;
    var res=await Promise.all([
      fetch(SURL+'/canning_rates?order=format,min_cases',{headers:SH}).then(function(r){return r.json();}),
      fetch(SURL+'/bottling_rates?order=format,min_units',{headers:SH}).then(function(r){return r.json();})
    ]);
    window._glR.c=Array.isArray(res[0])?res[0]:[];
    window._glR.b=Array.isArray(res[1])?res[1]:[];
    window._glR.ok=true;
  };
  window.glGetCanRate=function(cases,fmt,clientId){
    clientId = clientId || (window.INV && window.INV.clientId) || null;
    if(typeof window.glGetClientOverride === 'function'){
      var ovr = window.glGetClientOverride(clientId,'canning',fmt);
      if(ovr != null) return ovr;
    }
    var t=window._glR.c.filter(function(r){return r.format===fmt;}).sort(function(a,b){return a.min_cases-b.min_cases;});
    if(!t.length)return 0;
    var v=parseFloat(t[0].price_per_can);
    for(var i=0;i<t.length;i++)if(cases>=t[i].min_cases)v=parseFloat(t[i].price_per_can);
    return v;
  };
  window.glGetBtlRate=function(qty,fmt,clientId){
    clientId = clientId || (window.INV && window.INV.clientId) || null;
    if(typeof window.glGetClientOverride === 'function'){
      var ovr = window.glGetClientOverride(clientId,'bottling',fmt);
      if(ovr != null) return ovr;
    }
    var t=window._glR.b.filter(function(r){return r.format===fmt;}).sort(function(a,b){return a.min_units-b.min_units;});
    if(!t.length)return 0;
    var v=parseFloat(t[0].price_per_unit);
    for(var i=0;i<t.length;i++)if(qty>=t[i].min_units)v=parseFloat(t[i].price_per_unit);
    return v;
  };
  window.glUsd=function(n,d){return'$'+parseFloat(n).toLocaleString('en-US',{minimumFractionDigits:d==null?2:d,maximumFractionDigits:d==null?2:d});};
  window.glGetTbl=function(){var b=document.getElementById('gl-inv-body');return b?b.children[2]:null;};
  window.glCalcInvTotal=function(){
    var tot=0;
    document.querySelectorAll('[data-gl-total]').forEach(function(el){tot+=parseFloat(el.getAttribute('data-gl-total'))||0;});
    var box=document.getElementById('ginv-totals-box');if(!box)return;
    var disc=document.getElementById('ginv-disc');
    var pct=disc?parseFloat(disc.value)||0:0;
    var grand=tot*(1-pct/100);
    var s=box.children[0]?box.children[0].children[1]:null;
    var g=box.children[1]?box.children[1].children[1]:null;
    if(s)s.textContent=window.glUsd(tot);
    if(g)g.textContent=window.glUsd(grand);
  };
  window.glUpdateCan=function(uid){
    var ce=document.getElementById(uid+'-cases'),fe=document.getElementById(uid+'-format');
    if(!ce||!fe)return;
    var cases=Math.max(1,parseInt(ce.value)||150),fmt=fe.value;
    var pc=window.glGetCanRate(cases,fmt),pcase=pc*CPC,total=pcase*cases;
    function set(id,v){var e=document.getElementById(id);if(e)e.textContent=v;}
    set(uid+'-pcase',window.glUsd(pcase)+'/case');
    set(uid+'-pcan',window.glUsd(pc,4)+'/can');
    set(uid+'-cans',(cases*CPC).toLocaleString()+' cans');
    set(uid+'-total',window.glUsd(total));
    var row=document.getElementById(uid);if(row)row.setAttribute('data-gl-total',total);
    window.glCalcInvTotal();
  };
  window.glUpdateBtl=function(uid){
    var qe=document.getElementById(uid+'-qty'),fe=document.getElementById(uid+'-format');
    if(!qe||!fe)return;
    var qty=Math.max(1,parseInt(qe.value)||500),fmt=fe.value;
    var pu=window.glGetBtlRate(qty,fmt),total=pu*qty;
    function set(id,v){var e=document.getElementById(id);if(e)e.textContent=v;}
    set(uid+'-punit',window.glUsd(pu,4)+'/btl');
    set(uid+'-total',window.glUsd(total));
    var row=document.getElementById(uid);if(row)row.setAttribute('data-gl-total',total);
    window.glCalcInvTotal();
  };
  window.glRemoveLine=function(uid){
    var e=document.getElementById(uid);if(e)e.remove();
    window.glCalcInvTotal();
  };
  window.glBuildCanRow=function(uid,cases,fmt,fmts,pc){
    var pcase=pc*CPC,total=pcase*cases,cans=cases*CPC;
    var RS='display:grid;grid-template-columns:2fr 1fr 1fr 1fr 36px;gap:0;padding:10px 12px;border-top:1px solid rgba(255,255,255,.05);align-items:start';
    var SS='background:#1a2a3a;color:#fff;border:1px solid rgba(0,229,192,.4);border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;width:100%;max-width:160px';
    var SI='width:60px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:3px 6px;font-size:12px;font-weight:600;text-align:center';
    var opts=fmts.map(function(f){return'<option value="'+f.value+'"'+(f.value===fmt?' selected':'')+'>'+f.label+'</option>';}).join('');
    var row=document.createElement('div');row.id=uid;row.setAttribute('style',RS);row.setAttribute('data-gl-total',total);
    row.innerHTML='<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">Canning</div><select id="'+uid+'-format" onchange="window.glUpdateCan(\''+uid+'\')" style="'+SS+'">'+opts+'</select></div>'
      +'<div style="text-align:center"><input id="'+uid+'-cases" type="number" min="1" value="'+cases+'" onchange="window.glUpdateCan(\''+uid+'\')" style="'+SI+'"/><div id="'+uid+'-cans" style="font-size:10px;color:var(--muted);margin-top:3px">'+cans.toLocaleString()+' cans</div></div>'
      +'<div style="text-align:right;padding-right:4px"><div id="'+uid+'-pcase" style="font-size:12px;color:#fff;font-weight:600">'+window.glUsd(pcase)+'/case</div><div id="'+uid+'-pcan" style="font-size:10px;color:var(--muted);margin-top:3px">'+window.glUsd(pc,4)+'/can</div></div>'
      +'<div id="'+uid+'-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">'+window.glUsd(total)+'</div>'
      +'<div style="text-align:center"><button onclick="window.glRemoveLine(\''+uid+'\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0;line-height:1">x</button></div>';
    return row;
  };
  window.glBuildBtlRow=function(uid,qty,fmt,fmts,pu){
    var total=pu*qty;
    var RS='display:grid;grid-template-columns:2fr 1fr 1fr 1fr 36px;gap:0;padding:10px 12px;border-top:1px solid rgba(255,255,255,.05);align-items:start';
    var SS='background:#1a2a3a;color:#fff;border:1px solid rgba(0,229,192,.4);border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;width:100%;max-width:160px';
    var SI='width:60px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:3px 6px;font-size:12px;font-weight:600;text-align:center';
    var opts=fmts.map(function(f){return'<option value="'+f.value+'"'+(f.value===fmt?' selected':'')+'>'+f.label+'</option>';}).join('');
    var row=document.createElement('div');row.id=uid;row.setAttribute('style',RS);row.setAttribute('data-gl-total',total);
    row.innerHTML='<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">Bottling</div><select id="'+uid+'-format" onchange="window.glUpdateBtl(\''+uid+'\')" style="'+SS+'">'+opts+'</select></div>'
      +'<div style="text-align:center"><input id="'+uid+'-qty" type="number" min="1" value="'+qty+'" onchange="window.glUpdateBtl(\''+uid+'\')" style="'+SI+'"/><div style="font-size:10px;color:var(--muted);margin-top:3px">bottles</div></div>'
      +'<div style="text-align:right;padding-right:4px"><div id="'+uid+'-punit" style="font-size:12px;color:#fff;font-weight:600">'+window.glUsd(pu,4)+'/btl</div></div>'
      +'<div id="'+uid+'-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">'+window.glUsd(total)+'</div>'
      +'<div style="text-align:center"><button onclick="window.glRemoveLine(\''+uid+'\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0;line-height:1">x</button></div>';
    return row;
  };
  window.glOpenPricing=async function(){
    document.getElementById('gl-pm')?.remove();
    await window.glLoadRates();
    var m=document.createElement('div');m.id='gl-pm';
    m.setAttribute('style','position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px');
    function rws(data,mf,pf,tk){
      return data.map(function(r){
        return '<tr style="border-top:1px solid rgba(255,255,255,.06)"><td style="padding:7px 8px;font-size:12px;color:#fff">'+r.format_label+'</td><td style="padding:7px 8px;font-size:12px;color:var(--muted)">'+r[mf]+'+</td><td style="padding:7px 8px"><input data-id="'+r.id+'" data-tbl="'+tk+'" data-fld="'+pf+'" value="'+parseFloat(r[pf]).toFixed(4)+'" type="number" step="0.0001" min="0" style="width:90px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:4px 8px;font-size:12px"/></td><td style="padding:7px 8px"><button onclick="window.glSaveRate(this)" data-id="'+r.id+'" data-tbl="'+tk+'" data-fld="'+pf+'" style="background:rgba(0,229,192,.15);border:1px solid rgba(0,229,192,.3);color:var(--teal);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer">Save</button></td></tr>';
      }).join('');
    }
    m.innerHTML='<div style="background:#0d1f33;border:1px solid rgba(255,255,255,.1);border-radius:14px;width:100%;max-width:620px;max-height:85vh;overflow-y:auto;padding:24px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px"><div style="font-size:16px;font-weight:700;color:#fff">Pricing Manager</div><button onclick="document.getElementById(\'gl-pm\').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1">x</button></div><div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">CANNING ($/can)</div><table style="width:100%;border-collapse:collapse;margin-bottom:24px"><tr style="font-size:11px;color:var(--muted)"><th style="text-align:left;padding:6px 8px">Format</th><th style="text-align:left;padding:6px 8px">Min Cases</th><th style="text-align:left;padding:6px 8px">$/Can</th><th></th></tr>'+rws(window._glR.c,'min_cases','price_per_can','canning')+'</table><div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">BOTTLING ($/bottle)</div><table style="width:100%;border-collapse:collapse"><tr style="font-size:11px;color:var(--muted)"><th style="text-align:left;padding:6px 8px">Format</th><th style="text-align:left;padding:6px 8px">Min Units</th><th style="text-align:left;padding:6px 8px">$/Btl</th><th></th></tr>'+rws(window._glR.b,'min_units','price_per_unit','bottling')+'</table><div style="font-size:11px;color:var(--muted);margin-top:16px">Saves instantly to database.</div></div>';
    document.body.appendChild(m);
  };
  window.glSaveRate=async function(btn){
    var id=btn.getAttribute('data-id'),tbl=btn.getAttribute('data-tbl'),fld=btn.getAttribute('data-fld');
    var inp=btn.closest('tr').querySelector('input');
    var val=parseFloat(inp.value);if(isNaN(val)||val<=0){alert('Invalid');return;}
    btn.textContent='...';
    var ep=SURL+'/'+(tbl==='canning'?'canning_rates':'bottling_rates')+'?id=eq.'+id;
    var body={updated_at:new Date().toISOString()};body[fld]=val;
    var res=await fetch(ep,{method:'PATCH',headers:Object.assign({},SH,{'Prefer':'return=minimal'}),body:JSON.stringify(body)});
    if(res.ok||res.status===204){
      btn.textContent='Saved';btn.style.color='#22c55e';
      var cache=tbl==='canning'?window._glR.c:window._glR.b;
      var row=cache.find(function(r){return r.id==id;});if(row)row[fld]=val;
      window._glR.ok=false;
      setTimeout(function(){btn.textContent='Save';btn.style.color='';},2000);
    }else{btn.textContent='Error';}
  };
  window.glLoadRates();
  console.log('[GL] Invoice pricing loaded');
}());

/* ============================================================
   INVOICE PATCH v2 - handles ALL line types, fixes discount
   ============================================================ */
(function(){
  var SURL='https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1';
  var SKEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE';
  var SH={'apikey':SKEY,'Authorization':'Bearer '+SKEY,'Content-Type':'application/json'};
  var CPC=24;

  /* ── Supabase rates ── */
  window._glR={c:[],b:[],ok:false};
  window.glLoadRates=async function(){
    if(window._glR.ok)return;
    var res=await Promise.all([
      fetch(SURL+'/canning_rates?order=format,min_cases',{headers:SH}).then(function(r){return r.json();}),
      fetch(SURL+'/bottling_rates?order=format,min_units',{headers:SH}).then(function(r){return r.json();})
    ]);
    window._glR.c=Array.isArray(res[0])?res[0]:[];
    window._glR.b=Array.isArray(res[1])?res[1]:[];
    window._glR.ok=true;
  };
  window.glGetCanRate=function(cases,fmt,clientId){
    clientId = clientId || (window.INV && window.INV.clientId) || null;
    if(typeof window.glGetClientOverride === 'function'){
      var ovr = window.glGetClientOverride(clientId,'canning',fmt);
      if(ovr != null) return ovr;
    }
    var t=window._glR.c.filter(function(r){return r.format===fmt;}).sort(function(a,b){return a.min_cases-b.min_cases;});
    if(!t.length)return 0;
    var v=parseFloat(t[0].price_per_can);
    for(var i=0;i<t.length;i++)if(cases>=t[i].min_cases)v=parseFloat(t[i].price_per_can);
    return v;
  };
  window.glGetBtlRate=function(qty,fmt,clientId){
    clientId = clientId || (window.INV && window.INV.clientId) || null;
    if(typeof window.glGetClientOverride === 'function'){
      var ovr = window.glGetClientOverride(clientId,'bottling',fmt);
      if(ovr != null) return ovr;
    }
    var t=window._glR.b.filter(function(r){return r.format===fmt;}).sort(function(a,b){return a.min_units-b.min_units;});
    if(!t.length)return 0;
    var v=parseFloat(t[0].price_per_unit);
    for(var i=0;i<t.length;i++)if(qty>=t[i].min_units)v=parseFloat(t[i].price_per_unit);
    return v;
  };
  window.glUsd=function(n,d){return'$'+parseFloat(n||0).toLocaleString('en-US',{minimumFractionDigits:d==null?2:d,maximumFractionDigits:d==null?2:d});};
  window.glGetTbl=function(){var b=document.getElementById('gl-inv-body');return b?b.children[2]:null;};

  /* ── Invoice total recalc ── */
  window.glCalcInvTotal=function(){
    var tot=0;
    document.querySelectorAll('[data-gl-total]').forEach(function(el){
      tot+=parseFloat(el.getAttribute('data-gl-total'))||0;
    });
    var box=document.getElementById('ginv-totals-box');if(!box)return;
    var disc=document.getElementById('ginv-disc');
    var pct=disc?parseFloat(disc.value)||0:0;
    var grand=tot*(1-pct/100);
    var s=box.children[0]?box.children[0].children[1]:null;
    var g=box.children[1]?box.children[1].children[1]:null;
    if(s)s.textContent=window.glUsd(tot);
    if(g)g.textContent=window.glUsd(grand);
  };

  /* ── Wire up discount input ── */
  function wireDiscount(){
    var disc=document.getElementById('ginv-disc');
    if(disc&&!disc._glWired){
      disc.addEventListener('input',function(){window.glCalcInvTotal();});
      disc.addEventListener('change',function(){window.glCalcInvTotal();});
      disc._glWired=true;
    }
  }

  /* ── Shared row style ── */
  var RS='display:grid;grid-template-columns:2fr 1fr 1fr 1fr 36px;gap:0;padding:10px 12px;border-top:1px solid rgba(255,255,255,.05);align-items:start';
  var SS='background:#1a2a3a;color:#fff;border:1px solid rgba(0,229,192,.4);border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;width:100%;max-width:160px';
  var SI='width:60px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:3px 6px;font-size:12px;font-weight:600;text-align:center';
  var SIT='width:100%;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:3px 6px;font-size:11px';

  /* ── Remove any line ── */
  window.glRemoveLine=function(uid){
    var e=document.getElementById(uid);if(e)e.remove();
    window.glCalcInvTotal();
  };

  /* ── Update canning row ── */
  window.glUpdateCan=function(uid){
    var ce=document.getElementById(uid+'-cases'),fe=document.getElementById(uid+'-format'),pe=document.getElementById(uid+'-pcase');
    if(!ce||!fe)return;
    var cases=Math.max(1,parseInt(ce.value)||150),fmt=fe.value;
    var row=document.getElementById(uid);
    var override = row && row.getAttribute('data-pu-override')==='1';
    var pcase;
    if(override && pe){ pcase = parseFloat(pe.value)||0; }
    else { var pcDef = window.glGetCanRate(cases,fmt); pcase = pcDef*CPC; if(pe) pe.value = pcase.toFixed(2); }
    var pc = CPC ? (pcase/CPC) : 0;
    var total = pcase*cases;
    var pcanEl = document.getElementById(uid+'-pcan');
    if(pcanEl) pcanEl.innerHTML = window.glUsd(pc,4)+'/can <a href="javascript:window.glResetCanPrice(\''+uid+'\')" style="color:var(--teal);text-decoration:none;margin-left:4px" title="Reset to default rate">&#x21BA;</a>';
    var cansEl = document.getElementById(uid+'-cans');
    if(cansEl) cansEl.textContent=(cases*CPC).toLocaleString()+' cans';
    var te=document.getElementById(uid+'-total');
    if(te) te.textContent=window.glUsd(total);
    if(row) row.setAttribute('data-gl-total',total);
    window.glCalcInvTotal();
  };
  window.glUpdateCanPrice=function(uid){
    var row=document.getElementById(uid);
    if(row) row.setAttribute('data-pu-override','1');
    window.glUpdateCan(uid);
  };
  window.glResetCanPrice=function(uid){
    var row=document.getElementById(uid);
    if(row) row.setAttribute('data-pu-override','0');
    window.glUpdateCan(uid);
  };

  /* ── Update bottling row ── */
  window.glUpdateBtl=function(uid){
    var qe=document.getElementById(uid+'-qty'),fe=document.getElementById(uid+'-format'),pe=document.getElementById(uid+'-punit');
    if(!qe||!fe)return;
    var qty=Math.max(1,parseInt(qe.value)||500),fmt=fe.value;
    var row=document.getElementById(uid);
    var override = row && row.getAttribute('data-pu-override')==='1';
    var pu;
    if(override && pe){ pu = parseFloat(pe.value)||0; }
    else { pu = window.glGetBtlRate(qty,fmt); if(pe) pe.value = pu.toFixed(4); }
    var total = pu*qty;
    var te=document.getElementById(uid+'-total');
    if(te) te.textContent=window.glUsd(total);
    if(row) row.setAttribute('data-gl-total',total);
    window.glCalcInvTotal();
  };
  window.glUpdateBtlPrice=function(uid){
    var row=document.getElementById(uid);
    if(row) row.setAttribute('data-pu-override','1');
    window.glUpdateBtl(uid);
  };
  window.glResetBtlPrice=function(uid){
    var row=document.getElementById(uid);
    if(row) row.setAttribute('data-pu-override','0');
    window.glUpdateBtl(uid);
  };

  /* ── Update manual row (rd/hours/custom) ── */
  window.glUpdateManual=function(uid){
    var qe=document.getElementById(uid+'-qty');
    var pe=document.getElementById(uid+'-price');
    if(!qe||!pe)return;
    var qty=parseFloat(qe.value)||0;
    var price=parseFloat(pe.value)||0;
    var total=qty*price;
    var te=document.getElementById(uid+'-total');
    if(te)te.textContent=window.glUsd(total);
    var row=document.getElementById(uid);if(row)row.setAttribute('data-gl-total',total);
    window.glCalcInvTotal();
  };

  /* ── Build canning row ── */
  window.glBuildCanRow=function(uid,cases,fmt,fmts,pc,descPrefill){
    var pcase=pc*CPC,total=pcase*cases,cans=cases*CPC;
    var opts=fmts.map(function(f){return'<option value="'+f.value+'"'+(f.value===fmt?' selected':'')+'>'+f.label+'</option>';}).join('');
    var PSTY='width:84px;background:#1a2a3a;color:#fff;border:1px solid rgba(0,229,192,.25);border-radius:6px;padding:3px 6px;font-size:12px;font-weight:600;text-align:right';
    var DSTY='width:100%;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:3px 6px;font-size:11px;margin-top:4px';
    var row=document.createElement('div');row.id=uid;row.setAttribute('style',RS);row.setAttribute('data-gl-total',total);row.setAttribute('data-pu-override','0');
    row.innerHTML=
      '<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">Canning</div>'+
      '<select id="'+uid+'-format" onchange="window.glUpdateCan(\''+uid+'\')" style="'+SS+'">'+opts+'</select>'+
      '<input id="'+uid+'-desc" type="text" placeholder="Description (optional)" value="'+(descPrefill||'').replace(/"/g,'&quot;')+'" style="'+DSTY+'"/></div>'+
      '<div style="text-align:center"><input id="'+uid+'-cases" type="number" min="1" value="'+cases+'" onchange="window.glUpdateCan(\''+uid+'\')" style="'+SI+'"/>'+
      '<div id="'+uid+'-cans" style="font-size:10px;color:var(--muted);margin-top:3px">'+cans.toLocaleString()+' cans</div></div>'+
      '<div style="text-align:right;padding-right:4px">'+
      '<input id="'+uid+'-pcase" type="number" step="0.01" min="0" value="'+pcase.toFixed(2)+'" onchange="window.glUpdateCanPrice(\''+uid+'\')" title="$/case — edit to override the default rate" style="'+PSTY+'"/>'+
      '<div id="'+uid+'-pcan" style="font-size:10px;color:var(--muted);margin-top:3px">'+window.glUsd(pc,4)+'/can <a href="javascript:window.glResetCanPrice(\''+uid+'\')" style="color:var(--teal);text-decoration:none;margin-left:4px" title="Reset to default rate">&#x21BA;</a></div></div>'+
      '<div id="'+uid+'-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">'+window.glUsd(total)+'</div>'+
      '<div style="text-align:center"><button onclick="window.glRemoveLine(\''+uid+'\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0;line-height:1">x</button></div>';
    return row;
  };

  /* ── Build bottling row ── */
  window.glBuildBtlRow=function(uid,qty,fmt,fmts,pu,descPrefill){
    var total=pu*qty;
    var opts=fmts.map(function(f){return'<option value="'+f.value+'"'+(f.value===fmt?' selected':'')+'>'+f.label+'</option>';}).join('');
    var PSTY='width:84px;background:#1a2a3a;color:#fff;border:1px solid rgba(0,229,192,.25);border-radius:6px;padding:3px 6px;font-size:12px;font-weight:600;text-align:right';
    var DSTY='width:100%;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:3px 6px;font-size:11px;margin-top:4px';
    var row=document.createElement('div');row.id=uid;row.setAttribute('style',RS);row.setAttribute('data-gl-total',total);row.setAttribute('data-pu-override','0');
    row.innerHTML=
      '<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">Bottling</div>'+
      '<select id="'+uid+'-format" onchange="window.glUpdateBtl(\''+uid+'\')" style="'+SS+'">'+opts+'</select>'+
      '<input id="'+uid+'-desc" type="text" placeholder="Description (optional)" value="'+(descPrefill||'').replace(/"/g,'&quot;')+'" style="'+DSTY+'"/></div>'+
      '<div style="text-align:center"><input id="'+uid+'-qty" type="number" min="1" value="'+qty+'" onchange="window.glUpdateBtl(\''+uid+'\')" style="'+SI+'"/>'+
      '<div style="font-size:10px;color:var(--muted);margin-top:3px">bottles</div></div>'+
      '<div style="text-align:right;padding-right:4px">'+
      '<input id="'+uid+'-punit" type="number" step="0.0001" min="0" value="'+pu.toFixed(4)+'" onchange="window.glUpdateBtlPrice(\''+uid+'\')" title="$/bottle — edit to override the default rate" style="'+PSTY+'"/>'+
      '<div style="font-size:10px;color:var(--muted);margin-top:3px">$/btl <a href="javascript:window.glResetBtlPrice(\''+uid+'\')" style="color:var(--teal);text-decoration:none;margin-left:4px" title="Reset to default rate">&#x21BA;</a></div></div>'+
      '<div id="'+uid+'-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">'+window.glUsd(total)+'</div>'+
      '<div style="text-align:center"><button onclick="window.glRemoveLine(\''+uid+'\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0;line-height:1">x</button></div>';
    return row;
  };

  /* ── Build manual row (rd / hours / custom) ── */
  // descDefault = the "subtype" prefilled in the primary description (e.g.
  //   "Formulation" for R&D, "Production labor" for Hours, "" for Custom).
  // descPrefill = the user's free-text optional description carried over
  //   from a saved invoice when reopening for edit.
  window.glBuildManualRow=function(uid,label,descDefault,qty,price,descPrefill){
    var total=qty*price;
    var DSTY='width:100%;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:3px 6px;font-size:11px;margin-top:4px';
    var safePrefill = String(descPrefill||'').replace(/"/g,'&quot;');
    var row=document.createElement('div');row.id=uid;row.setAttribute('style',RS);row.setAttribute('data-gl-total',total);
    row.innerHTML=
      '<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">'+label+'</div>'+
      '<input id="'+uid+'-subtype" type="text" value="'+descDefault+'" placeholder="Service type" style="'+SIT+'"/>'+
      '<input id="'+uid+'-desc" type="text" placeholder="Description (optional)" value="'+safePrefill+'" style="'+DSTY+'"/></div>'+
      '<div style="text-align:center"><input id="'+uid+'-qty" type="number" min="0" step="any" value="'+qty+'" onchange="window.glUpdateManual(\''+uid+'\')" style="'+SI+'"/>'+
      '<div style="font-size:10px;color:var(--muted);margin-top:3px">qty</div></div>'+
      '<div style="text-align:right;padding-right:4px">'+
      '<input id="'+uid+'-price" type="number" min="0" step="any" value="'+price+'" onchange="window.glUpdateManual(\''+uid+'\')" style="'+SI+';width:80px;" placeholder="Unit $"/></div>'+
      '<div id="'+uid+'-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">'+window.glUsd(total)+'</div>'+
      '<div style="text-align:center"><button onclick="window.glRemoveLine(\''+uid+'\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0;line-height:1">x</button></div>';
    return row;
  };

  /* ── Override glAddLine — handles ALL types, never calls original ── */
  window.glAddLine=function(type){
    var tbl=window.glGetTbl();if(!tbl)return;
    var ph=[...tbl.children].find(function(c){return c.textContent.trim()==='No line items yet. Add one below.';});
    if(ph)ph.remove();
    wireDiscount();

    var uid='glline'+Date.now();

    if(type==='canning'){
      if(!window._glR.ok){
        var lr=document.createElement('div');lr.id=uid;
        lr.setAttribute('style','padding:12px;color:var(--muted);font-size:12px;border-top:1px solid rgba(255,255,255,.05)');
        lr.textContent='Loading rates...';tbl.appendChild(lr);
        window.glLoadRates().then(function(){var e=document.getElementById(uid);if(e)e.remove();window.glAddLine(type);});
        return;
      }
      var fmts=[],seen={};
      window._glR.c.forEach(function(r){if(!seen[r.format]){seen[r.format]=true;fmts.push({value:r.format,label:r.format_label});}});
      if(!fmts.length)fmts=[{value:'12oz-standard',label:'12oz Standard'}];
      var def=fmts[0].value,pc=window.glGetCanRate(150,def);
      tbl.appendChild(window.glBuildCanRow(uid,150,def,fmts,pc));

    }else if(type==='bottling'){
      if(!window._glR.ok){
        var lr=document.createElement('div');lr.id=uid;
        lr.setAttribute('style','padding:12px;color:var(--muted);font-size:12px;border-top:1px solid rgba(255,255,255,.05)');
        lr.textContent='Loading rates...';tbl.appendChild(lr);
        window.glLoadRates().then(function(){var e=document.getElementById(uid);if(e)e.remove();window.glAddLine(type);});
        return;
      }
      var bfmts=[],bseen={};
      window._glR.b.forEach(function(r){if(!bseen[r.format]){bseen[r.format]=true;bfmts.push({value:r.format,label:r.format_label});}});
      if(!bfmts.length)bfmts=[{value:'750ml',label:'750ml Bottle'}];
      var bdef=bfmts[0].value,pu=window.glGetBtlRate(500,bdef);
      tbl.appendChild(window.glBuildBtlRow(uid,500,bdef,bfmts,pu));

    }else if(type==='rd'){
      tbl.appendChild(window.glBuildManualRow(uid,'R&D / IP','Formulation',1,1500));

    }else if(type==='hours'){
      tbl.appendChild(window.glBuildManualRow(uid,'Production Hours','Production labor',1,125));

    }else{
      tbl.appendChild(window.glBuildManualRow(uid,'Custom','',1,0));
    }

    window.glCalcInvTotal();
  };

  /* ── Pricing admin ── */
  window.glOpenPricing=async function(){
    document.getElementById('gl-pm')?.remove();
    await window.glLoadRates();
    var m=document.createElement('div');m.id='gl-pm';
    m.setAttribute('style','position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px');
    function rws(data,mf,pf,tk){
      return data.map(function(r){
        return '<tr style="border-top:1px solid rgba(255,255,255,.06)">'+
          '<td style="padding:7px 8px;font-size:12px;color:#fff">'+r.format_label+'</td>'+
          '<td style="padding:7px 8px;font-size:12px;color:var(--muted)">'+r[mf]+'+</td>'+
          '<td style="padding:7px 8px"><input data-id="'+r.id+'" data-tbl="'+tk+'" data-fld="'+pf+'" value="'+parseFloat(r[pf]).toFixed(4)+'" type="number" step="0.0001" min="0" style="width:90px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:4px 8px;font-size:12px"/></td>'+
          '<td style="padding:7px 8px"><button onclick="window.glSaveRate(this)" data-id="'+r.id+'" data-tbl="'+tk+'" data-fld="'+pf+'" style="background:rgba(0,229,192,.15);border:1px solid rgba(0,229,192,.3);color:var(--teal);border-radius:6px;padding:3px 10px;font-size:11px;cursor:pointer">Save</button></td>'+
          '</tr>';
      }).join('');
    }
    m.innerHTML='<div style="background:#0d1f33;border:1px solid rgba(255,255,255,.1);border-radius:14px;width:100%;max-width:620px;max-height:85vh;overflow-y:auto;padding:24px">'+
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">'+
      '<div style="font-size:16px;font-weight:700;color:#fff">Pricing Manager</div>'+
      '<button onclick="document.getElementById(\'gl-pm\').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1">x</button></div>'+
      '<div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">CANNING ($/can)</div>'+
      '<table style="width:100%;border-collapse:collapse;margin-bottom:24px"><tr style="font-size:11px;color:var(--muted)"><th style="text-align:left;padding:6px 8px">Format</th><th style="text-align:left;padding:6px 8px">Min Cases</th><th style="text-align:left;padding:6px 8px">$/Can</th><th></th></tr>'+
      rws(window._glR.c,'min_cases','price_per_can','canning')+'</table>'+
      '<div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">BOTTLING ($/bottle)</div>'+
      '<table style="width:100%;border-collapse:collapse"><tr style="font-size:11px;color:var(--muted)"><th style="text-align:left;padding:6px 8px">Format</th><th style="text-align:left;padding:6px 8px">Min Units</th><th style="text-align:left;padding:6px 8px">$/Btl</th><th></th></tr>'+
      rws(window._glR.b,'min_units','price_per_unit','bottling')+'</table>'+
      '<div style="font-size:11px;color:var(--muted);margin-top:16px">Saves instantly to database.</div></div>';
    document.body.appendChild(m);
  };

  window.glSaveRate=async function(btn){
    var id=btn.getAttribute('data-id'),tbl=btn.getAttribute('data-tbl'),fld=btn.getAttribute('data-fld');
    var inp=btn.closest('tr').querySelector('input');
    var val=parseFloat(inp.value);if(isNaN(val)||val<=0){alert('Invalid');return;}
    btn.textContent='...';
    var ep=SURL+'/'+(tbl==='canning'?'canning_rates':'bottling_rates')+'?id=eq.'+id;
    var body={updated_at:new Date().toISOString()};body[fld]=val;
    var res=await fetch(ep,{method:'PATCH',headers:Object.assign({},SH,{'Prefer':'return=minimal'}),body:JSON.stringify(body)});
    if(res.ok||res.status===204){
      btn.textContent='Saved';btn.style.color='#22c55e';
      var cache=tbl==='canning'?window._glR.c:window._glR.b;
      var row=cache.find(function(r){return r.id==id;});if(row)row[fld]=val;
      window._glR.ok=false;
      setTimeout(function(){btn.textContent='Save';btn.style.color='';},2000);
    }else{btn.textContent='Error';}
  };

  window.glLoadRates();
  console.log('[GL] Invoice patch v2 loaded');
}());
/* ============================================================
   INVOICE FIX v4 - DOM-based save + Supabase persistence
   - glAddLine appends DOM rows but never touches INV.lines, so
     save reads lines straight from the rendered rows.
   - Save fires a background POST to Supabase invoices table so
     records survive page refresh and sync across devices.
     Requires permissive RLS policy on `invoices` (see README/
     project notes). On RLS or network failure, the in-memory
     save still succeeds and a warning notification fires.
   ============================================================ */
(function(){

  var SURL='https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1';
  var SKEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE';
  var SH={apikey:SKEY,Authorization:'Bearer '+SKEY,'Content-Type':'application/json'};

  window.glCalcInvTotal=function(){
    var tot=0;
    document.querySelectorAll('[data-gl-total]').forEach(function(el){
      tot+=parseFloat(el.getAttribute('data-gl-total'))||0;
    });
    // Include manually-entered addon prices in the subtotal so typing into
    // an add-on row doesn't appear to zero the total.
    document.querySelectorAll('#gl-inv-body input[oninput*="addons"][placeholder="$0.00"]').forEach(function(el){
      tot += parseFloat(el.value)||0;
    });
    var box=document.getElementById('ginv-totals-box');if(!box)return;
    var disc=document.getElementById('ginv-disc');
    var pct=disc?parseFloat(disc.value)||0:0;
    var discAmt=tot*(pct/100);
    var grand=tot-discAmt;
    var subRow=box.children[0];
    if(subRow&&subRow.children[1])subRow.children[1].textContent=window.glUsd(tot);
    var discRow=document.getElementById('gl-disc-row');
    if(pct>0){
      if(!discRow){
        discRow=document.createElement('div');
        discRow.id='gl-disc-row';
        discRow.setAttribute('style','font-size:12px;color:var(--muted);display:flex;justify-content:space-between;margin-bottom:8px');
        box.insertBefore(discRow,box.children[1]);
      }
      discRow.innerHTML='<span>Discount ('+pct+'%)</span><span style="color:#22c55e">-'+window.glUsd(discAmt)+'</span>';
    }else{
      if(discRow)discRow.remove();
    }
    var totRow=document.getElementById('gl-disc-row')?box.children[2]:box.children[1];
    if(totRow&&totRow.children[1])totRow.children[1].textContent=window.glUsd(grand);
  };

  function readLinesFromDOM(){
    var lines=[];
    document.querySelectorAll('[data-gl-total]').forEach(function(row){
      var uid=row.id;if(!uid)return;
      var total=parseFloat(row.getAttribute('data-gl-total'))||0;
      var casesEl=document.getElementById(uid+'-cases');
      var punitEl=document.getElementById(uid+'-punit');
      var descEl=document.getElementById(uid+'-desc');
      var labelEl=row.querySelector('div > div');
      var label=labelEl?labelEl.textContent.trim():'';
      // Free-text description user typed below the type's format select / qty.
      // Present on every row builder now (canning, bottling, manual).
      var userDesc = descEl ? (descEl.value||'').trim() : '';
      if(casesEl){
        var cases=parseInt(casesEl.value)||0;
        var fEl=document.getElementById(uid+'-format');
        var fLbl=(fEl&&fEl.options[fEl.selectedIndex])?fEl.options[fEl.selectedIndex].text:'';
        var perCase=cases>0?total/cases:0;
        var canDesc='Canning - '+fLbl;
        if(userDesc) canDesc += ' — ' + userDesc;
        lines.push({desc:canDesc,qty:cases,unitPrice:perCase,total:total,unit:'case'});
      }else if(punitEl){
        var qtyEl=document.getElementById(uid+'-qty');
        var qty=qtyEl?parseInt(qtyEl.value)||0:0;
        var fEl2=document.getElementById(uid+'-format');
        var fLbl2=(fEl2&&fEl2.options[fEl2.selectedIndex])?fEl2.options[fEl2.selectedIndex].text:'';
        var perBtl=qty>0?total/qty:0;
        var btlDesc='Bottling - '+fLbl2;
        if(userDesc) btlDesc += ' — ' + userDesc;
        lines.push({desc:btlDesc,qty:qty,unitPrice:perBtl,total:total,unit:'btl'});
      }else if(descEl){
        var qtyMEl=document.getElementById(uid+'-qty');
        var qtyM=qtyMEl?parseFloat(qtyMEl.value)||0:0;
        var priceMEl=document.getElementById(uid+'-price');
        var priceM=priceMEl?parseFloat(priceMEl.value)||0:0;
        // New layout: -subtype carries the service-type text (e.g.
        // "Formulation", "Production labor") and -desc carries the user's
        // optional add-on description. Old rows without -subtype fall back
        // to the legacy single-input behavior.
        var subtypeEl = document.getElementById(uid+'-subtype');
        var subtype = subtypeEl ? (subtypeEl.value||'').trim() : '';
        var manDesc;
        if(subtypeEl){
          // New layout
          manDesc = label || 'Line item';
          if(subtype) manDesc += ' - ' + subtype;
          if(userDesc) manDesc += ' — ' + userDesc;
        } else {
          // Legacy fallback
          manDesc = userDesc?(label?label+' - '+userDesc:userDesc):(label||'Line item');
        }
        lines.push({desc:manDesc,qty:qtyM,unitPrice:priceM,total:total,unit:''});
      }
    });
    return lines;
  }

  function nextInvId(){
    var ids=(window.invoices||[]).map(function(i){return parseInt((i.id||'').replace(/\D/g,''))||0;});
    return 'GL-'+(ids.length?Math.max.apply(null,ids)+1:1001);
  }

  window.glSaveInvoice=function(){
    var cidEl=document.getElementById('ginv-client');
    var cid=cidEl?cidEl.value:'';
    if(!cid){alert('Please select a client');return null;}
    var lines=readLinesFromDOM();
    if(!lines.length){alert('Add at least one line item.');return null;}

    // Edit mode: openEditInvoice tags the builder modal with the supa row id
    // of the invoice being edited. When present, we UPDATE that row instead of
    // INSERTing a new one (which would create a duplicate).
    var builderEl = document.getElementById('gl-inv-builder');
    var editingSupaId = builderEl ? builderEl.getAttribute('data-editing-supa-id') : null;
    var editingId     = builderEl ? builderEl.getAttribute('data-editing-id') : null;
    // Robustness: if we're editing but lost the supa row id (because a
    // prior save replaced the in-memory inv without preserving supaId),
    // we'll look it up by invoice_number further down before the update.

    var client=(window.clients||[]).find(function(c){return c.id===cid;})||{};
    var invIdEl=document.getElementById('ginv-id');
    var invId=(invIdEl&&invIdEl.value)?invIdEl.value:(editingId||nextInvId());
    var dateEl=document.getElementById('ginv-date');
    var date=(dateEl&&dateEl.value)?dateEl.value:new Date().toISOString().slice(0,10);
    var discEl=document.getElementById('ginv-disc');
    var pct=discEl?parseFloat(discEl.value)||0:0;

    // Read add-on rows from the DOM (description + price pairs).
    var addons=[];
    var addonDescEls = document.querySelectorAll('#gl-inv-body input[oninput*="addons"][placeholder*="Add-on"]');
    var addonPriceEls = document.querySelectorAll('#gl-inv-body input[oninput*="addons"][placeholder="$0.00"]');
    for(var ai=0; ai<addonDescEls.length; ai++){
      var d = (addonDescEls[ai].value||'').trim();
      var p = parseFloat(addonPriceEls[ai] ? addonPriceEls[ai].value : 0)||0;
      if(d || p) addons.push({ d: d, p: p });
    }
    var addonsTotal = addons.reduce(function(s,a){ return s + (parseFloat(a.p)||0); }, 0);

    var subtotal=lines.reduce(function(s,l){return s+(l.total||0);},0) + addonsTotal;
    var discountAmt=subtotal*(pct/100);
    var amount=subtotal-discountAmt;

    // Append addon entries as "line items" so the invoice detail / PDF
    // renders them in the same table as regular lines.
    var addonLines = addons.map(function(a){
      return { desc: a.d || 'Add-on', qty: 1, unitPrice: parseFloat(a.p)||0, total: parseFloat(a.p)||0, unit: '' };
    });
    var combinedLines = lines.concat(addonLines);

    var inv={
      id:invId,
      // Preserve the supa row id across saves so subsequent edits still
      // route through UPDATE (not INSERT that would silently fail on the
      // unique invoice_number constraint).
      supaId: editingSupaId || (function(){
        var prior = (window.invoices||[]).find(function(p){ return p && p.id === invId; });
        return prior ? prior.supaId : undefined;
      })(),
      client:cid,
      clientName:client.name||'',
      clientEmail:client.email||'',
      svc:combinedLines.map(function(l){return l.desc;}).join(', '),
      lines:combinedLines,
      addons:addons,
      discount:pct,
      subtotal:subtotal,
      discountAmt:discountAmt,
      amount:amount,
      notes:'',
      date:date,
      status:'pending',
      // Default to the client's terms (set in the Edit Client modal); fall back
      // to "Due on receipt" for clients without terms configured.
      paymentTerms: client.paymentTerms || 'Due on receipt'
    };
    window.invoices=window.invoices||[];
    // Mutate in place so index.html's `let invoices` (bridged to window.invoices)
    // keeps pointing at the same array. Replacing via .filter() would break that.
    for(var _k=window.invoices.length-1;_k>=0;_k--){if(window.invoices[_k]&&window.invoices[_k].id===invId)window.invoices.splice(_k,1);}
    window.invoices.unshift(inv);
    if(typeof renderInvoices==='function')renderInvoices();
    if(typeof addNotification==='function')addNotification('Invoice saved: '+invId,(client.name||'')+' · '+window.glUsd(amount),'success');
    var ov=document.getElementById('gl-inv-builder');if(ov)ov.classList.remove('show');

    // Compute the due date from the payment terms instead of hardcoding +30d.
    var dueIso='';
    try {
      var t = (inv.paymentTerms || '').toLowerCase();
      var addDays = 0;
      if(/^net\s*(\d+)/.test(t)) addDays = parseInt(RegExp.$1, 10);
      else if(t === 'prepaid')   addDays = null;     // no due date
      else if(t === 'cod')       addDays = 0;
      else                       addDays = 0;        // "Due on receipt"
      if(addDays !== null) dueIso = new Date(Date.parse(date) + addDays*86400000).toISOString().slice(0,10);
    } catch(e){ dueIso=''; }
    // Use the Supabase JS client so the user's session JWT is sent.
    // The earlier raw-fetch path used only the anon API key, which RLS
    // policies that require role=authenticated will reject (PR #61's
    // blanket RLS migration enforces `to authenticated`).
    (async function syncInvoice(){
      var sb = window.supa;
      if(!sb){
        console.error('[GL] Supabase JS client not ready for invoice sync.');
        if(typeof addNotification==='function')addNotification('Cloud sync skipped','Saved locally — Supabase client not loaded.','warning');
        return;
      }
      var payload = {
        invoice_number:invId,
        client_id:(cid&&cid.charAt(0)==='c')?null:cid,
        client_name:client.name||'',
        service:inv.svc,
        amount:amount,
        invoice_date:date,
        due_date:dueIso||null,
        payment_terms: inv.paymentTerms,
        line_items:combinedLines
      };
      // Fallback: if we're editing but lost the supa row id, look it up by
      // invoice_number. Prevents the save from silently INSERT-failing on a
      // unique-constraint violation when the user edits an invoice multiple
      // times in one session.
      if(!editingSupaId && editingId){
        try {
          var lookup = await sb.from('invoices').select('id').eq('invoice_number', editingId).maybeSingle();
          if(lookup && lookup.data && lookup.data.id) editingSupaId = lookup.data.id;
        } catch(e){ /* fall through to insert */ }
      }
      // On INSERT (new invoice) seed status=pending. On UPDATE preserve the
      // existing row's status so editing a paid invoice doesn't accidentally
      // un-mark it as paid.
      if(!editingSupaId){
        payload.status = 'pending';
        payload.notes = '';
      }
      // Retry on PGRST204 "column not found" by peeling off the offending
      // column from the payload. Without this, a single schema gap aborts
      // the entire write and the user's edits silently disappear on refresh.
      var working = Object.assign({}, payload);
      var r, retries = 20, droppedCols = [];
      while(retries-- > 0){
        if(editingSupaId){
          r = await sb.from('invoices').update(working).eq('id', editingSupaId).select().single();
        } else {
          r = await sb.from('invoices').insert(working).select().single();
        }
        if(!r || !r.error) break;
        if(r.error.code !== 'PGRST204') break;
        var m = (r.error.message || '').match(/'([^']+)' column/);
        if(!m || working[m[1]] === undefined) break;
        droppedCols.push(m[1]);
        delete working[m[1]];
      }
      if(droppedCols.length){
        console.warn('[GL] Invoice sync: dropped unknown columns to recover save:', droppedCols);
        if(typeof addNotification==='function')addNotification('Saved (partial)','Run the latest migration. Skipped: '+droppedCols.join(', '),'warning');
      }
      if(r && r.error){
        console.error('[GL] Supabase sync failed for '+invId+':', r.error);
        if(typeof addNotification==='function')addNotification('Cloud sync failed','Invoice '+invId+' saved locally only. '+(r.error.message||''),'warning');
        return;
      }
      inv.supaId = r && r.data && r.data.id;
      if(r && r.data && r.data.status) inv.status = r.data.status;
      console.log('[GL] Invoice synced to Supabase:',invId,inv.supaId||'',editingSupaId?'(updated)':'(inserted)');
    })().catch(function(err){
      console.error('[GL] Supabase sync threw for '+invId+':', err);
      if(typeof addNotification==='function')addNotification('Cloud sync failed','Invoice '+invId+' saved locally only. '+(err.message||''),'warning');
    });

    // Clear edit-mode markers so the next save returns to insert mode.
    if(builderEl){
      builderEl.removeAttribute('data-editing-supa-id');
      builderEl.removeAttribute('data-editing-id');
    }
    return inv;
  };

  /* ── SAVE & SEND — one click: save the invoice, then open Send composer ── */
  window.glSaveAndSend = function(){
    var inv = window.glSaveInvoice();
    if(!inv || !inv.id) return; // glSaveInvoice already alerted the user
    // Small delay so the builder modal finishes closing + the toast fires
    // before the send modal opens on top.
    setTimeout(function(){
      if(typeof window.openSendInvoiceModal === 'function'){
        window.openSendInvoiceModal(inv.id);
      } else {
        alert('Invoice saved as '+inv.id+'. Open it from the Invoices list and click Send Invoice.');
      }
    }, 350);
  };

  /* ── EDIT INVOICE — reopen the builder pre-filled with an existing invoice ── */
  window.openEditInvoice = function(invId){
    var inv = (window.invoices||[]).find(function(i){ return i.id === invId; });
    if(!inv){ alert('Invoice not found.'); return; }
    // Close the read-only detail panel if it's showing
    if(typeof closeDetail === 'function') try { closeDetail(); } catch(e){}
    var detail = document.getElementById('inv-detail');
    if(detail) detail.classList.remove('show');

    // Open the builder. openNewInvoiceBuilder resets INV via freshState(), so
    // we configure prefill *after* it returns.
    if(typeof window.openNewInvoiceBuilder !== 'function'){
      alert('Invoice builder not ready.'); return;
    }
    window.openNewInvoiceBuilder();

    setTimeout(function(){
      var builder = document.getElementById('gl-inv-builder');
      if(!builder){ return; }
      // Tag the modal so glSaveInvoice does UPDATE not INSERT
      builder.setAttribute('data-editing-id', inv.id);
      if(inv.supaId) builder.setAttribute('data-editing-supa-id', inv.supaId);

      // Header title swap NEW → EDIT
      var titleEl = builder.querySelector('div[style*="letter-spacing:2px"][style*="font-family"]');
      if(titleEl && /NEW INVOICE/i.test(titleEl.textContent)){
        titleEl.textContent = 'EDIT INVOICE ' + inv.id;
      }

      // Prefill scalar fields
      var cli = document.getElementById('ginv-client');
      if(cli){ cli.value = inv.client || ''; if(window.INV) window.INV.clientId = cli.value; }
      var dt = document.getElementById('ginv-date');
      if(dt && inv.date){ dt.value = inv.date; if(window.INV) window.INV.date = inv.date; }
      var idEl = document.getElementById('ginv-id');
      if(idEl){ idEl.value = inv.id; }
      var notesEl = builder.querySelector('textarea');
      if(notesEl && inv.notes){ notesEl.value = inv.notes; if(window.INV) window.INV.notes = inv.notes; }
      var discEl = document.getElementById('ginv-disc');
      if(discEl && inv.discount){ discEl.value = inv.discount; if(window.INV) window.INV.discount = inv.discount; }

      // Build editable rows for every existing line item. We try to use the
      // SAME row builder that originally created the line (Canning, Bottling,
      // or Manual) so the user sees the same UI they used to create it —
      // format dropdown + qty + price + separate Description (optional)
      // input. Falls back to a manual row if the type can't be detected.
      var tbl = window.glGetTbl && window.glGetTbl();
      function splitLineDesc(raw){
        // Format: "<Type> - <Format Label>[ — <User description>]"
        // The user description (if any) is separated by an em-dash (—).
        raw = (raw||'').trim();
        var emIdx = raw.indexOf(' — ');
        var beforeEm = emIdx >= 0 ? raw.slice(0, emIdx).trim() : raw;
        var userDesc = emIdx >= 0 ? raw.slice(emIdx + 3).trim() : '';
        var parts = beforeEm.split(' - ');
        return {
          type: parts[0] || '',
          fmtLabel: parts.length > 1 ? parts.slice(1).join(' - ') : '',
          userDesc: userDesc,
          raw: raw
        };
      }
      function findFormatByLabel(formats, label){
        if(!formats || !label) return null;
        var hit = formats.find(function(f){ return f.label === label || f.value === label; });
        return hit ? hit.value : null;
      }
      if(tbl && Array.isArray(inv.lines)){
        var placeholder = Array.prototype.slice.call(tbl.children).find(function(c){
          return c.textContent && c.textContent.trim() === 'No line items yet. Add one below.';
        });
        if(placeholder) placeholder.remove();
        // Need rates loaded so the format dropdowns populate properly.
        if(typeof window.glLoadRates === 'function' && !(window._glR && window._glR.ok)){
          try { window.glLoadRates(); } catch(e){}
        }
        var canFmts = [], canSeen = {};
        (window._glR && window._glR.c || []).forEach(function(r){ if(!canSeen[r.format]){ canSeen[r.format]=1; canFmts.push({value:r.format,label:r.format_label}); } });
        if(!canFmts.length) canFmts = [{value:'12oz-standard',label:'12oz Standard'}];
        var btlFmts = [], btlSeen = {};
        (window._glR && window._glR.b || []).forEach(function(r){ if(!btlSeen[r.format]){ btlSeen[r.format]=1; btlFmts.push({value:r.format,label:r.format_label}); } });
        if(!btlFmts.length) btlFmts = [{value:'750ml',label:'750ml Bottle'}];

        inv.lines.forEach(function(l, ix){
          var uid = 'gledit' + Date.now() + '_' + ix;
          var parsed = splitLineDesc(l.desc);
          var type = parsed.type.toLowerCase();
          var row = null;
          if(type === 'canning' && window.glBuildCanRow){
            var canFmt = findFormatByLabel(canFmts, parsed.fmtLabel) || canFmts[0].value;
            var perCan = (l.unitPrice || 0) / 24; // unitPrice on canning lines is per-case
            row = window.glBuildCanRow(uid, l.qty || 0, canFmt, canFmts, perCan, parsed.userDesc);
            row.setAttribute('data-pu-override','1'); // user's saved price wins over catalog
            row.setAttribute('data-gl-total', (l.qty||0) * (l.unitPrice||0));
          } else if(type === 'bottling' && window.glBuildBtlRow){
            var btlFmt = findFormatByLabel(btlFmts, parsed.fmtLabel) || btlFmts[0].value;
            row = window.glBuildBtlRow(uid, l.qty || 0, btlFmt, btlFmts, l.unitPrice || 0, parsed.userDesc);
            row.setAttribute('data-pu-override','1');
            row.setAttribute('data-gl-total', (l.qty||0) * (l.unitPrice||0));
          } else {
            // R&D / Hours / Custom / unknown — use the manual row, which now
            // has separate -subtype (e.g. "Formulation") and -desc (optional)
            // inputs. Map the parsed parts into those two fields.
            var manualLabel = parsed.type || 'Line';
            var manualSubtype = parsed.fmtLabel || '';
            var manualOpt = parsed.userDesc || '';
            row = window.glBuildManualRow(uid, manualLabel, manualSubtype, l.qty || 0, l.unitPrice || 0, manualOpt);
          }
          if(row) tbl.appendChild(row);
        });
        if(typeof window.glCalcInvTotal === 'function') window.glCalcInvTotal();
      }

      // Prefill addons (the builder always renders 4 addon input pairs)
      if(Array.isArray(inv.addons) && inv.addons.length){
        var addonDescInputs = builder.querySelectorAll('input[oninput*="addons"][placeholder*="Add-on"]');
        var addonPriceInputs = builder.querySelectorAll('input[oninput*="addons"][placeholder="$0.00"]');
        inv.addons.forEach(function(a, ix){
          if(addonDescInputs[ix]){ addonDescInputs[ix].value = a.d || ''; }
          if(addonPriceInputs[ix]){ addonPriceInputs[ix].value = a.p || ''; }
        });
      }
    }, 80);
  };

  // Override the legacy INV-state recalc so addon inputs and the discount
  // field route through the DOM-based total (data-gl-total + addon inputs).
  // The legacy refreshTotals() reads INV.lines which is empty under the
  // DOM-first save flow, which would zero out the totals box.
  window.glApplyDiscount = function(){ window.glCalcInvTotal(); };

  document.addEventListener('click',function(){
    var disc=document.getElementById('ginv-disc');
    if(disc&&!disc._glWired2){
      disc.addEventListener('input',function(){window.glCalcInvTotal();});
      disc._glWired2=true;
    }
  });

  console.log('[GL] Invoice fix v5 loaded - DOM save + Supabase sync + shared invoices array');
}());

/* ============================================================
   ADMIN: User panel — change role + set password
   - Role: direct UPDATE on profiles (requires the "Admins can
     update any profile" RLS policy we set in Round 3).
   - Password: RPC admin_set_user_password (SECURITY DEFINER,
     verifies caller is admin, bcrypts the new password into
     auth.users). Requires the SQL function to be created.
   ============================================================ */
(function(){

  function uuidish(s){return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s||'');}
  function esc(s){return (s||'').replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

  window.renderUsersPanel=function(){
    var el=document.getElementById('users-list');
    if(!el)return;
    var rows=(window.users||[]).map(function(u){
      var isOwner=u.email==='mike@goodliquid.com';
      var rolePicker=isOwner
        ? '<span style="font-size:11px;color:var(--muted)">admin (owner)</span>'
        : '<select onchange="window.glAdminChangeRole(\''+u.id+'\',this.value)" style="background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer">'
          +'<option value="admin"'+(u.role==='admin'?' selected':'')+'>admin</option>'
          +'<option value="sales"'+(u.role==='sales'?' selected':'')+'>sales</option>'
          +'<option value="warehouse"'+(u.role==='warehouse'?' selected':'')+'>warehouse</option>'
          +'<option value="viewer"'+(u.role==='viewer'?' selected':'')+'>viewer</option>'
        +'</select>';
      var actions=isOwner
        ? '<span style="font-size:10px;color:var(--muted)">Owner</span>'
        : '<button class="cbtn" style="font-size:10px;padding:3px 8px" onclick="window.glAdminSetPassword(\''+u.id+'\')">Set password</button>'
          +' <button class="cbtn" style="font-size:10px;padding:3px 8px;background:rgba(245,200,66,.08);border-color:rgba(245,200,66,.3);color:#f5c842" onclick="window.resetPw(\''+u.id+'\')">Email reset</button>'
          +' <button class="cbtn red" style="font-size:10px;padding:3px 8px" onclick="window.removeUser(\''+u.id+'\')">Remove</button>';
      return '<tr>'
        +'<td style="font-weight:600;display:flex;align-items:center;gap:8px">'
          +'<div style="width:28px;height:28px;border-radius:50%;background:'+(u.color||'#1a6fff')+';color:'+(u.tc||'#fff')+';display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">'+esc(u.initials||'?')+'</div>'
          +esc(u.name||'')
        +'</td>'
        +'<td style="font-family:var(--ff-mono);font-size:11px">'+esc(u.email||'')+'</td>'
        +'<td>'+rolePicker+'</td>'
        +'<td style="font-size:11px;color:var(--muted)">'+esc(u.lastLogin||'Never')+'</td>'
        +'<td style="display:flex;gap:6px;flex-wrap:wrap">'+actions+'</td>'
      +'</tr>';
    }).join('');
    el.innerHTML='<table class="ctbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last Login</th><th>Actions</th></tr></thead><tbody>'+rows+'</tbody></table>';
  };

  window.glAdminChangeRole=async function(uid,newRole){
    var u=(window.users||[]).find(function(x){return x.id===uid;});
    if(!u){alert('User not found.');return;}
    if(!['admin','sales','warehouse','viewer'].includes(newRole)){alert('Invalid role.');return;}
    var sb=window.supa;
    if(sb&&uuidish(u.id)){
      try{
        var r=await sb.from('profiles').update({role:newRole,updated_at:new Date().toISOString()}).eq('id',u.id);
        if(r.error){
          console.error('[GL] role update failed',r.error);
          alert('Role update failed: '+r.error.message);
          if(typeof window.renderUsersPanel==='function')window.renderUsersPanel();
          return;
        }
      }catch(e){
        console.error('[GL] role update threw',e);
        alert('Role update failed: '+e.message);
        if(typeof window.renderUsersPanel==='function')window.renderUsersPanel();
        return;
      }
    }
    u.role=newRole;
    if(typeof addNotification==='function')addNotification('Role updated',u.name+' → '+newRole,'success');
  };

  // Build the set-password modal lazily so we don't allocate DOM until needed.
  function _glOpenSetPwModal(u){
    var host = document.getElementById('crm-panel') || document.body;
    var existing = document.getElementById('gl-setpw-modal'); if(existing) existing.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-setpw-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:28px;width:100%;max-width:440px">' +
        '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal);margin-bottom:4px">SET PASSWORD</div>' +
        '<div style="font-size:13px;color:#fff;margin-bottom:4px">' + (u.name||'') + '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:18px;font-family:var(--ff-mono)">' + (u.email||'') + '</div>' +
        '<div class="frow"><div class="flbl">New password</div><input class="finp" type="password" id="gl-setpw-new" placeholder="Min 6 characters" autocomplete="new-password"></div>' +
        '<div class="frow"><div class="flbl">Confirm</div><input class="finp" type="password" id="gl-setpw-confirm" placeholder="Re-enter to confirm" autocomplete="new-password"></div>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted);margin:4px 0 18px;cursor:pointer">' +
          '<input type="checkbox" id="gl-setpw-show" style="margin:0">' +
          '<span>Show password</span>' +
        '</label>' +
        '<div id="gl-setpw-err" style="display:none;color:#e74c3c;font-size:12px;margin-bottom:10px"></div>' +
        '<div style="display:flex;gap:8px">' +
          '<button id="gl-setpw-save" class="cbtn pri" style="flex:1">Set password</button>' +
          '<button id="gl-setpw-cancel" class="cbtn">Cancel</button>' +
        '</div>' +
      '</div>';
    host.appendChild(ov);

    var newEl = ov.querySelector('#gl-setpw-new');
    var conEl = ov.querySelector('#gl-setpw-confirm');
    var errEl = ov.querySelector('#gl-setpw-err');
    var showEl = ov.querySelector('#gl-setpw-show');
    showEl.addEventListener('change', function(){
      var t = showEl.checked ? 'text' : 'password';
      newEl.type = t; conEl.type = t;
    });
    ov.querySelector('#gl-setpw-cancel').addEventListener('click', function(){ ov.remove(); });
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    setTimeout(function(){ newEl.focus(); }, 50);

    function showErr(m){ errEl.style.display='block'; errEl.textContent=m; }
    function clearErr(){ errEl.style.display='none'; errEl.textContent=''; }

    ov.querySelector('#gl-setpw-save').addEventListener('click', async function(){
      clearErr();
      var pw = newEl.value;
      var c  = conEl.value;
      var _pwErr = (window.glValidatePassword ? window.glValidatePassword(pw) : (pw.length < 8 ? 'Password must be at least 8 characters.' : null));
      if(_pwErr){ showErr(_pwErr); return; }
      if(pw !== c){ showErr('Passwords do not match.'); return; }
      var sb = window.supa;
      if(!sb){ showErr('Auth service unavailable.'); return; }
      var btn = this; var origLabel = btn.textContent; btn.disabled = true; btn.textContent = 'Saving…';
      try{
        var r = await sb.rpc('admin_set_user_password', {target_email: u.email, new_password: pw});
        if(r.error){
          showErr(r.error.message || 'RPC failed');
          btn.disabled = false; btn.textContent = origLabel;
          return;
        }
        if(r.data === 'ok'){
          if(typeof addNotification === 'function') addNotification('Password updated', u.email + ' — share securely', 'success');
          ov.remove();
        } else {
          showErr('Server returned: ' + r.data);
          btn.disabled = false; btn.textContent = origLabel;
        }
      }catch(e){
        console.error('[GL] admin_set_user_password threw', e);
        showErr('Failed: ' + (e.message || 'unknown'));
        btn.disabled = false; btn.textContent = origLabel;
      }
    });

    [newEl, conEl].forEach(function(el){
      el.addEventListener('keydown', function(e){
        if(e.key === 'Enter') ov.querySelector('#gl-setpw-save').click();
        if(e.key === 'Escape') ov.remove();
      });
    });
  }

  window.glAdminSetPassword = function(uid){
    var u = (window.users || []).find(function(x){ return x.id === uid; });
    if(!u){ alert('User not found.'); return; }
    _glOpenSetPwModal(u);
  };

  console.log('[GL] Admin user-panel v1 loaded (role dropdown + set-password)');
}());

/* ============================================================
   MAILGUN SETTINGS
   - openMailgunSettings: modal to paste/view the Mailgun API key
   - Fixes sendOnboardingEmail so it actually checks Mailgun before
     reporting success, opens Settings when key is missing.
   ============================================================ */
(function(){
  /* Wipe any legacy gl_mailgun_key on load. Per the security audit
     in PR #141, the Mailgun API key has lived in Supabase secrets
     (read by the mailgun-send Edge Function) for a while now. The
     localStorage copy was a hold-over that gave anyone with access
     to the browser a way to read the key. Remove on every load so
     we don't have stale credentials sitting in DevTools. */
  try { if(localStorage.getItem('gl_mailgun_key')) localStorage.removeItem('gl_mailgun_key'); } catch(_e){}

  window.openMailgunSettings = function(){
    var existing = document.getElementById('mg-settings-overlay');
    if(existing) existing.remove();
    var ov = document.createElement('div');
    ov.id = 'mg-settings-overlay';
    ov.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.95);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:36px;width:100%;max-width:560px">' +
        '<div style="font-family:var(--ff-disp);font-size:22px;letter-spacing:2px;color:var(--teal);margin-bottom:8px">📧 MAILGUN SETTINGS</div>' +
        '<div style="font-size:13px;color:var(--muted);margin-bottom:18px;line-height:1.6">Mailgun sends onboarding emails, follow-ups, and tour confirmations. The API key lives <b>server-side in Supabase secrets</b> — the browser never sees it.</div>' +
        '<div style="background:rgba(29,158,117,.1);border:1px solid rgba(29,158,117,.3);border-radius:8px;padding:12px 16px;font-size:13px;color:#5fcf9e;margin-bottom:20px;line-height:1.6">✅ Sends route through the <code>mailgun-send</code> Edge Function. The function reads <code>MAILGUN_API_KEY</code> from Supabase secrets at run time.</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">TO ROTATE THE KEY</div>' +
        '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px;margin-bottom:18px;font-size:12px;color:#cfd9e6;line-height:1.7">' +
          'Run in PowerShell: <code style="background:#0a1628;padding:2px 6px;border-radius:4px;color:var(--teal);font-family:var(--ff-mono);font-size:11px">supabase secrets set MAILGUN_API_KEY=key-...</code><br>' +
          'Then redeploy the function (or it will pick up the new value on next cold start). No frontend change needed.' +
        '</div>' +
        '<div style="display:flex;gap:10px">' +
          '<button onclick="window.glTestMailgun()" style="flex:1;padding:13px;background:rgba(245,200,66,.08);color:#f5c842;border:1px solid rgba(245,200,66,.3);border-radius:8px;cursor:pointer;font-size:13px">Test send</button>' +
          '<button onclick="document.getElementById(\'mg-settings-overlay\').remove()" style="padding:13px 20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--muted);cursor:pointer">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
  };

  /* Reusable masked-credential reveal modal — used by onboarding to surface
     a temp password without splashing it into a system alert.
     opts: { title, message, email, password, status: 'ok'|'warn' } */
  window.glRevealCredential = function(opts){
    opts = opts || {};
    var prior = document.getElementById('gl-reveal-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var statusColor = opts.status === 'warn' ? '#f5c842' : '#00e5c0';
    var statusIcon  = opts.status === 'warn' ? '⚠' : '✓';
    var ov = document.createElement('div');
    ov.id = 'gl-reveal-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1100;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:480px">' +
        '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:' + statusColor + ';margin-bottom:6px">' + statusIcon + ' ' + (opts.title || '').toUpperCase() + '</div>' +
        (opts.message ? '<div style="font-size:13px;color:#9aa7bd;margin-bottom:16px;line-height:1.5">' + opts.message + '</div>' : '') +
        (opts.email ? '<div style="font-size:11px;letter-spacing:1.5px;color:#9aa7bd;margin-bottom:4px">EMAIL</div>' +
                      '<div style="font-family:var(--ff-mono);font-size:13px;color:#fff;margin-bottom:14px;word-break:break-all">' + opts.email + '</div>' : '') +
        '<div style="font-size:11px;letter-spacing:1.5px;color:#9aa7bd;margin-bottom:4px">TEMPORARY PASSWORD</div>' +
        '<div style="display:flex;gap:8px;margin-bottom:18px">' +
          '<input class="finp" id="gl-reveal-pw" readonly type="password" value="' + (opts.password||'').replace(/"/g,'&quot;') + '" style="flex:1;font-family:var(--ff-mono);font-size:13px;color:#fff">' +
          '<button class="cbtn" id="gl-reveal-toggle" style="white-space:nowrap">Reveal</button>' +
          '<button class="cbtn pri" id="gl-reveal-copy" style="white-space:nowrap">Copy</button>' +
        '</div>' +
        '<div style="font-size:11px;color:#f5c842;background:rgba(245,200,66,.06);border:1px solid rgba(245,200,66,.2);border-radius:6px;padding:9px;margin-bottom:14px;line-height:1.5">Share via a separate channel (text, in person). Do not put it in the same email you just sent.</div>' +
        '<div style="display:flex;justify-content:flex-end"><button class="cbtn" id="gl-reveal-close">Done</button></div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    var pwEl = ov.querySelector('#gl-reveal-pw');
    var tog  = ov.querySelector('#gl-reveal-toggle');
    var cpy  = ov.querySelector('#gl-reveal-copy');
    tog.addEventListener('click', function(){
      var nowHidden = pwEl.type === 'password';
      pwEl.type = nowHidden ? 'text' : 'password';
      tog.textContent = nowHidden ? 'Hide' : 'Reveal';
    });
    cpy.addEventListener('click', async function(){
      try { await navigator.clipboard.writeText(opts.password || ''); cpy.textContent = '✓ Copied'; setTimeout(function(){ cpy.textContent = 'Copy'; }, 1500); }
      catch(e){ pwEl.type = 'text'; pwEl.select(); document.execCommand('copy'); cpy.textContent = '✓ Copied'; setTimeout(function(){ cpy.textContent = 'Copy'; }, 1500); }
    });
    ov.querySelector('#gl-reveal-close').addEventListener('click', function(){ ov.remove(); });
    host.appendChild(ov);
  };

  window.glTestMailgun = async function(){
    if(typeof window.sendMailgunEmail !== 'function'){ alert('sendMailgunEmail unavailable.'); return; }
    var ok = await window.sendMailgunEmail('mike@goodliquid.com','Mailgun test from Good Liquid CRM','This is a test email confirming Mailgun is wired up. — Good Liquid CRM');
    if(ok) alert('✓ Test email sent to mike@goodliquid.com');
    else alert('✗ Test failed. Check that MAILGUN_API_KEY is set in Supabase secrets (run `supabase secrets list`) and that the mailgun-send Edge Function is deployed.');
  };

  /* sendOnboardingEmail (called by the "📧 Send Onboarding Email" button on
     the Customer Logins page) is now a thin wrapper that opens the modern
     invite picker. The picker handles client selection, creates a real
     auth user via signUp, links it to the client via link_customer_user_by_email,
     and fires the Supabase password-reset email so the customer can set
     their own password — no more locally-generated "temp passwords" that
     don't actually work because no real auth user existed.

     This replaces the previous local-only flow that wrote to the dead
     customerLogins localStorage array and minted unusable temp passwords. */
  window.sendOnboardingEmail = function(){
    if(typeof window.glOpenInvitePicker === 'function'){
      window.glOpenInvitePicker();
    } else {
      alert('Invite UI not ready yet — reload the page and try again.');
    }
  };

  console.log('[GL] Mailgun settings v1 loaded');
}());

/* ============================================================
   AI TOOLBAR — robust override
   Replaces the original addAIToolbar with one that:
   - Removes any prior toolbar before recreating (idempotent on
     repeat login / re-render)
   - Uses an event listener (not inline onclick) so click failures
     show in the console
   - Anchors inside #crm-panel for correct stacking
   ============================================================ */
(function(){
  window.addAIToolbar = function(){
    var existing = document.getElementById('ai-toolbar');
    if(existing) existing.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var tb = document.createElement('div');
    tb.id = 'ai-toolbar';
    tb.setAttribute('style','position:relative;display:flex;align-items:center');

    var tools = document.createElement('div');
    tools.id = 'ai-tools';
    tools.setAttribute('style','display:none;flex-direction:column;gap:6px;align-items:flex-end;margin-bottom:6px');

    var items = [
      { label:'📣 Social post drafter', fn:'openSocialDrafter' },
      { label:'📰 Auto case study', fn:'openCaseStudyBuilder' },
      { label:'💡 Post ideas this week', fn:'openPostSuggester' },
      { label:'🎯 Cross-sell ideas', fn:'openCrossSellSuggester' },
      { label:'📊 Win-loss analytics', fn:'openWinLossAnalytics' },
      { label:'🎪 Trade Show ROI', fn:'openTradeShowROI', admin:true },
      { label:'📦 Service Packages', fn:'openServicePackages', admin:true },
      { label:'🔮 Churn Risk', fn:'openChurnPredictor', admin:true },
      { label:'🎨 AI Image Prompts', fn:'openAIImagePrompts' },
      { label:'✉️ Email drip generator', fn:'openEmailDripGenerator' },
      { label:'💼 LinkedIn outreach', fn:'openLinkedInOutreach' },
      { label:'💰 AR Collection', fn:'openARCollection', admin:true },
      { label:'🚀 Onboarding wizard', fn:'openOnboardingWizard', admin:true },
      { label:'⭐ NPS responses', fn:'openNpsResults', admin:true },
      { label:'📊 Capacity heatmap', fn:'openCapacityHeatmap', admin:true },
      { label:'🧮 Recipe cost calc', fn:'openRecipeCostCalc', admin:true },
      { label:'💰 Estimate Quote', fn:'aiEstimateQuote' },
      { label:'🧾 Draft Invoice',  fn:'aiDraftInvoice' },
      { label:'📝 Meeting Notes',  fn:'openMeetingNotesModal' },
      { label:'✉️ Draft Email',    fn:'openAICommModal' },
      { label:'📈 Revenue Forecast', fn:'aiGenerateForecast' },
      { label:'📊 Reports',        fn:'openReports' },
      { label:'⏱️ Time Tracker',   fn:'openTimeTracker' },
      { label:'📧 Email Templates', fn:'openEmailTemplates' },
      { label:'📊 Time Report',    fn:'openTimeTrackingReport' },
      { label:'🤖 AI Settings',    fn:'openAISettings' },
      { label:'📧 Mailgun Settings', fn:'openMailgunSettings' },
      { label:'📈 Google Analytics', fn:'openGA4Settings', admin:true },
      { label:'🔒 Two-Factor Auth', fn:'openMFASettings' },
      { label:'🐛 Error Log', fn:'glOpenErrorLog', admin:true },
      { label:'📱 SMS Alerts', fn:'openSmsSettings' },
      { label:'🚀 Setup Wizard', fn:'openSetupWizard', admin:true },
      { label:'💳 Stripe Checkout', fn:'openStripeSettings', admin:true },
      { label:'🛡️ Sentry', fn:'openSentrySettings', admin:true },
      { label:'📅 Capacity badge', fn:'openCapacitySettings', admin:true },
      { label:'📝 E-Signatures', fn:'openSignSettings', admin:true },
      { label:'💼 QuickBooks', fn:'openQBOSettings', admin:true },
      { label:'✍️ Email Signature', fn:'openEmailSignatureSettings' },
      { label:'🗑️ Clear local cache', fn:'glClearLocalCache', admin:true, danger:true }
    ];
    items.forEach(function(it){
      // Hide admin-only items for non-admin users.
      if(it.admin && (!window.currentUser || window.currentUser.role !== 'admin')) return;
      var b = document.createElement('button');
      var base = 'padding:8px 14px;background:#142238;border:1px solid rgba(0,229,192,.3);border-radius:20px;color:var(--teal);cursor:pointer;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 4px 16px rgba(0,0,0,.4)';
      if(it.danger) base = base.replace('rgba(0,229,192,.3)','rgba(231,76,60,.4)').replace('var(--teal)','#ff8579');
      b.setAttribute('style', base);
      b.textContent = it.label;
      b.addEventListener('click', function(){
        try{
          if(typeof window[it.fn] === 'function') window[it.fn]();
          else { console.warn('[AI toolbar] missing function:', it.fn); alert(it.label + ' is not available.'); }
        }catch(e){ console.error('[AI toolbar] '+it.fn+' threw', e); alert(it.label + ' failed: ' + (e.message||'')); }
        tools.style.display='none';
      });
      tools.appendChild(b);
    });

    var fab = document.createElement('button');
    fab.setAttribute('title','AI Tools');
    fab.setAttribute('style','width:34px;height:34px;border-radius:8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:16px;color:var(--teal);transition:all .2s');
    fab.textContent = '🤖';
    fab.addEventListener('click', function(e){
      e.stopPropagation();
      tools.style.display = (tools.style.display === 'none') ? 'flex' : 'none';
      console.log('[AI toolbar] toggled →', tools.style.display);
    });
    // Close the popout when clicking elsewhere
    document.addEventListener('click', function(e){
      if(tools.style.display !== 'none' && !tb.contains(e.target)) tools.style.display = 'none';
    });

    tb.appendChild(tools);
    tb.appendChild(fab);
    // Inject into the top-bar actions row so it sits beside the bell + chat buttons.
    var topActions = document.getElementById('crm-top-actions');
    if(topActions) topActions.insertBefore(tb, topActions.firstChild);
    else host.appendChild(tb);
    console.log('[AI toolbar] mounted in', topActions ? 'crm-top-actions' : (host.id || host.tagName));
  };

  console.log('[GL] AI toolbar v2 loaded');
}());

/* ============================================================
   GLOBAL BUSY INDICATOR
   Small "Working…" pill at the top of the viewport, auto-shown
   while any AI or Mailgun call is in-flight. Reference-counted
   so concurrent calls don't hide it prematurely.
   ============================================================ */
(function(){
  function ensurePill(){
    var p = document.getElementById('gl-busy');
    if(p) return p;
    p = document.createElement('div');
    p.id = 'gl-busy';
    p.setAttribute('style','position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:9999;background:#142238;border:1px solid rgba(0,229,192,.35);border-radius:20px;padding:8px 18px;color:var(--teal);font-size:12px;font-weight:600;font-family:var(--ff-body);box-shadow:0 4px 20px rgba(0,0,0,.5);display:flex;align-items:center;gap:9px;pointer-events:none;opacity:0;transition:opacity .18s');
    p.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(0,229,192,.3);border-top-color:var(--teal);border-radius:50%;animation:gl-spin .8s linear infinite"></span><span id="gl-busy-text">Working…</span>';
    document.body.appendChild(p);
    if(!document.getElementById('gl-busy-style')){
      var s = document.createElement('style');
      s.id = 'gl-busy-style';
      s.textContent = '@keyframes gl-spin{to{transform:rotate(360deg)}}';
      document.head.appendChild(s);
    }
    return p;
  }
  window.glStartBusy = function(label){
    var p = ensurePill();
    p._count = (p._count||0) + 1;
    var t = document.getElementById('gl-busy-text');
    if(t) t.textContent = label || 'Working…';
    p.style.opacity = '1';
  };
  window.glEndBusy = function(){
    var p = document.getElementById('gl-busy');
    if(!p) return;
    p._count = Math.max(0, (p._count||0) - 1);
    if(p._count === 0) p.style.opacity = '0';
  };

  // Wrap callAI so every AI call lights the pill.
  var origCallAI = window.callAI;
  if(typeof origCallAI === 'function'){
    window.callAI = async function(){
      window.glStartBusy('AI thinking…');
      try { return await origCallAI.apply(this, arguments); }
      catch(e){ console.error('[GL] callAI threw', e); throw e; }
      finally { window.glEndBusy(); }
    };
  }
  // Wrap sendMailgunEmail similarly.
  var origMG = window.sendMailgunEmail;
  if(typeof origMG === 'function'){
    window.sendMailgunEmail = async function(){
      window.glStartBusy('Sending email…');
      try { return await origMG.apply(this, arguments); }
      catch(e){ console.error('[GL] sendMailgunEmail threw', e); throw e; }
      finally { window.glEndBusy(); }
    };
  }

  console.log('[GL] Global busy indicator wired (callAI + sendMailgunEmail)');
}());

/* ============================================================
   FOLLOW-UP EMAIL: preview before send
   Adds a "📄 Preview" button to the follow-up composer modal.
   Shows the email rendered as the recipient would see it
   (white background, From / To / Subject headers, body in serif).
   ============================================================ */
(function(){
  function escapeHtml(s){
    return (s||'').replace(/[&<>"]/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
    });
  }

  window.glPreviewFollowup = function(){
    var toEl   = document.getElementById('fu-to');
    var subjEl = document.getElementById('fu-subject');
    var bodyEl = document.getElementById('fu-body');
    if(!toEl || !subjEl || !bodyEl){ alert('Compose modal not open.'); return; }
    var to = toEl.value, subject = subjEl.value, body = bodyEl.value;
    var from = localStorage.getItem('gl_mailgun_from') || 'Good Liquid Bev Co <noreply@mail.goodliquidbevco.com>';

    var host = document.getElementById('crm-panel') || document.body;
    var prev = document.getElementById('gl-preview-overlay'); if(prev) prev.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-preview-overlay';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1100;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#fff;color:#1a1a2e;border-radius:14px;width:100%;max-width:600px;max-height:88vh;overflow-y:auto;font-family:Arial,sans-serif;box-shadow:0 30px 80px rgba(0,0,0,.6)">' +
        '<div style="background:#142238;color:#fff;padding:14px 20px;border-radius:14px 14px 0 0;display:flex;justify-content:space-between;align-items:center">' +
          '<div style="font-family:var(--ff-disp);font-size:14px;letter-spacing:2px;color:#00e5c0">📄 EMAIL PREVIEW</div>' +
          '<button id="gl-preview-close" style="background:none;border:none;color:#9ca3af;font-size:20px;cursor:pointer;line-height:1">✕</button>' +
        '</div>' +
        '<div style="padding:24px 28px">' +
          '<div style="border-bottom:1px solid #e5e7eb;padding-bottom:14px;margin-bottom:20px;font-size:13px;line-height:1.85">' +
            '<div><span style="color:#6b7280;display:inline-block;width:70px">From:</span><strong>' + escapeHtml(from) + '</strong></div>' +
            '<div><span style="color:#6b7280;display:inline-block;width:70px">To:</span>' + escapeHtml(to) + '</div>' +
            '<div><span style="color:#6b7280;display:inline-block;width:70px">Subject:</span><strong>' + escapeHtml(subject) + '</strong></div>' +
          '</div>' +
          '<div style="font-size:14px;line-height:1.75;white-space:pre-wrap;color:#1a1a2e;font-family:Georgia,serif">' + escapeHtml(body) + '</div>' +
          '<div style="border-top:1px solid #e5e7eb;margin-top:28px;padding-top:16px;display:flex;gap:10px;justify-content:flex-end">' +
            '<button id="gl-preview-back" style="padding:10px 20px;background:#f3f4f6;color:#1a1a2e;border:1px solid #d1d5db;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">← Keep editing</button>' +
            '<button id="gl-preview-send" style="padding:10px 24px;background:#00e5c0;color:#0a1628;border:none;border-radius:6px;font-size:13px;font-weight:800;cursor:pointer">📤 Send now</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-preview-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-preview-back').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-preview-send').addEventListener('click', function(){
      ov.remove();
      if(typeof window.sendFollowupEmail === 'function') window.sendFollowupEmail();
    });
    host.appendChild(ov);
  };

  function injectPreviewButton(){
    var content = document.getElementById('followup-content');
    if(!content) return;
    // Find the button row (last div with display:flex inside content)
    var rows = content.querySelectorAll('div');
    var btnRow = null;
    rows.forEach(function(d){
      var s = d.getAttribute('style') || '';
      if(s.indexOf('display:flex') >= 0 && s.indexOf('gap:8px') >= 0) btnRow = d;
    });
    if(!btnRow) return;
    if(btnRow.querySelector('.gl-preview-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'cbtn gl-preview-btn';
    btn.textContent = '📄 Preview';
    btn.setAttribute('style','background:rgba(0,229,192,.08);border:1px solid rgba(0,229,192,.3);color:var(--teal)');
    btn.addEventListener('click', function(){ window.glPreviewFollowup(); });
    var sendBtn = btnRow.querySelector('button.pri');
    if(sendBtn) btnRow.insertBefore(btn, sendBtn);
    else btnRow.appendChild(btn);
  }
  if(document.readyState !== 'loading') setTimeout(injectPreviewButton, 50);
  else document.addEventListener('DOMContentLoaded', function(){ setTimeout(injectPreviewButton, 50); });

  console.log('[GL] Follow-up preview v1 loaded');
}());

/* ============================================================
   ADMIN UTILITY: clear local cache
   Wipes the gl_* localStorage keys that hold per-device app
   state (tasks, notifications, calendar, etc.) but preserves
   configuration keys (API keys, Mailgun settings). Useful when
   switching browsers or onboarding a new device.
   ============================================================ */
(function(){
  // Keys that hold per-device app state — safe to wipe.
  var APP_STATE_KEYS = [
    'gl_tasks','gl_activities','gl_notifications','gl_cal_events',
    'gl_inventory','gl_documents','gl_announcements','gl_customer_logins',
    'gl_followup_log','gl_deal_activity','gl_client_notes','gl_client_tags',
    'gl_email_templates','gl_time_entries','gl_active_timer','gl_prod_pipeline'
  ];
  // Keys that hold configuration / credentials — preserved by default.
  var CONFIG_KEYS = [
    'gl_ai_key','gl_mailgun_key','gl_mailgun_domain','gl_mailgun_from','gl_supabase_key','gl_ga_id'
  ];

  function buildModal(){
    var existing = document.getElementById('gl-clear-cache-modal');
    if(existing) existing.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var present = {};
    APP_STATE_KEYS.concat(CONFIG_KEYS).forEach(function(k){ if(localStorage.getItem(k) !== null) present[k] = (localStorage.getItem(k)||'').length; });
    var ov = document.createElement('div');
    ov.id = 'gl-clear-cache-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.85);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:20px');
    var stateRows = APP_STATE_KEYS.map(function(k){
      var len = present[k];
      var hasData = len !== undefined && len > 2;
      return '<label style="display:flex;align-items:center;gap:9px;padding:6px 0;font-size:12px;color:'+(hasData?'#fff':'var(--muted)')+'">'+
        '<input type="checkbox" class="gl-cc-state" data-k="'+k+'"'+(hasData?' checked':'')+'>'+
        '<code style="font-family:var(--ff-mono);font-size:11px">'+k+'</code>'+
        (hasData?'<span style="color:var(--muted);font-size:10px">~'+len+' bytes</span>':'<span style="color:var(--muted);font-size:10px">(empty)</span>')+
      '</label>';
    }).join('');
    var configRows = CONFIG_KEYS.map(function(k){
      var has = present[k] !== undefined;
      return '<label style="display:flex;align-items:center;gap:9px;padding:6px 0;font-size:12px;color:'+(has?'#fff':'var(--muted)')+'">'+
        '<input type="checkbox" class="gl-cc-config" data-k="'+k+'">'+
        '<code style="font-family:var(--ff-mono);font-size:11px">'+k+'</code>'+
        (has?'<span style="color:#1D9E75;font-size:10px">set</span>':'<span style="color:var(--muted);font-size:10px">(not set)</span>')+
      '</label>';
    }).join('');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(231,76,60,.3);border-radius:14px;padding:26px;width:100%;max-width:520px;max-height:88vh;overflow-y:auto">' +
        '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:#ff8579;margin-bottom:6px">🗑️ CLEAR LOCAL CACHE</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:18px;line-height:1.6">Wipes selected keys from this browser\'s localStorage. Cloud data (Supabase) is untouched.</div>' +
        '<div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">APP STATE (safe to wipe)</div>' +
        '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:10px 14px;margin-bottom:14px">' + stateRows + '</div>' +
        '<div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">CONFIGURATION (unchecked by default)</div>' +
        '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:10px 14px;margin-bottom:14px">' + configRows + '</div>' +
        '<div style="background:rgba(245,200,66,.06);border:1px solid rgba(245,200,66,.2);border-radius:6px;padding:9px 12px;font-size:11px;color:#f5c842;margin-bottom:14px">⚠ Page will reload after clearing.</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button id="gl-cc-confirm" class="cbtn red" style="flex:1">Clear selected</button>' +
          '<button id="gl-cc-cancel" class="cbtn">Cancel</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-cc-cancel').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-cc-confirm').addEventListener('click', function(){
      var toRemove = [];
      ov.querySelectorAll('input.gl-cc-state:checked, input.gl-cc-config:checked').forEach(function(cb){
        toRemove.push(cb.getAttribute('data-k'));
      });
      if(toRemove.length === 0){ alert('Nothing selected.'); return; }
      if(!confirm('Remove ' + toRemove.length + ' localStorage keys and reload?\n\n' + toRemove.join('\n'))) return;
      toRemove.forEach(function(k){ try { localStorage.removeItem(k); } catch(e){} });
      location.reload();
    });
    host.appendChild(ov);
  }

  window.glClearLocalCache = function(){
    if(!window.currentUser || window.currentUser.role !== 'admin'){
      alert('Admin only.');
      return;
    }
    buildModal();
  };

  console.log('[GL] Clear local cache utility loaded');
}());

/* ============================================================
   PASSWORD RECOVERY LINK HANDLER
   When a Supabase password-reset email link is clicked, the
   user lands here with #access_token=...&type=recovery in the
   URL hash. supabase-js parses the tokens and emits an
   AuthChange event 'PASSWORD_RECOVERY'. We listen for it and
   open a "set new password" modal. On save, auth.updateUser
   persists the new bcrypt hash and the user is signed in.
   ============================================================ */
(function(){
  function openRecoveryModal(mode){
    var isInvite = mode === 'invite';
    var existing = document.getElementById('gl-recovery-modal');
    if(existing) existing.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-recovery-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1200;background:rgba(6,13,26,.95);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:32px;width:100%;max-width:440px">' +
        '<div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:2px;color:#00e5c0;margin-bottom:6px">'+(isInvite?'CREATE YOUR PASSWORD':'RESET YOUR PASSWORD')+'</div>' +
        '<div style="font-size:13px;color:#9ca3af;margin-bottom:22px;line-height:1.5">'+(isInvite?"Welcome to Good Liquid Bev Co CRM! Set a password to complete your account setup.":'You arrived via a password reset link. Choose a new password to sign in.')+'</div>' +
        '<div class="frow"><div class="flbl">New password</div><input class="finp" type="password" id="gl-rec-new" placeholder="Min 6 characters" autocomplete="new-password"></div>' +
        '<div class="frow"><div class="flbl">Confirm</div><input class="finp" type="password" id="gl-rec-confirm" placeholder="Re-enter to confirm" autocomplete="new-password"></div>' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:11px;color:#9ca3af;margin:4px 0 18px;cursor:pointer">' +
          '<input type="checkbox" id="gl-rec-show" style="margin:0"><span>Show password</span>' +
        '</label>' +
        '<div id="gl-rec-err" style="display:none;color:#e74c3c;font-size:12px;margin-bottom:10px"></div>' +
        '<button id="gl-rec-save" class="cbtn pri" style="width:100%">Set new password & sign in</button>' +
      '</div>';
    document.body.appendChild(ov);

    var newEl = ov.querySelector('#gl-rec-new');
    var conEl = ov.querySelector('#gl-rec-confirm');
    var errEl = ov.querySelector('#gl-rec-err');
    var showEl = ov.querySelector('#gl-rec-show');
    var btn = ov.querySelector('#gl-rec-save');
    showEl.addEventListener('change', function(){
      var t = showEl.checked ? 'text' : 'password';
      newEl.type = t; conEl.type = t;
    });
    function showErr(m){ errEl.style.display='block'; errEl.textContent=m; }
    setTimeout(function(){ newEl.focus(); }, 50);

    btn.addEventListener('click', async function(){
      errEl.style.display='none';
      var pw = newEl.value;
      var _pwErr = (window.glValidatePassword ? window.glValidatePassword(pw) : (pw.length < 8 ? 'Password must be at least 8 characters.' : null));
      if(_pwErr){ showErr(_pwErr); return; }
      if(pw !== conEl.value){ showErr('Passwords do not match.'); return; }
      var sb = window.supa;
      if(!sb){ showErr('Auth service unavailable.'); return; }
      var orig = btn.textContent; btn.disabled = true; btn.textContent = 'Saving…';
      try{
        var r = await sb.auth.updateUser({ password: pw });
        if(r.error){ showErr(r.error.message); btn.disabled = false; btn.textContent = orig; return; }
        // Strip the recovery hash from the URL so a refresh doesn't re-trigger.
        try { history.replaceState(null, '', location.pathname + location.search); } catch(e){}
        ov.remove();
        var user = r.data && r.data.user;
        // Portal customer? Re-run portal check so the dashboard renders for them
        // (skip the CRM-staff loginUser path entirely). Clear the recovery
        // flags first so the portal exits its waiting state and renders the
        // dashboard for the freshly-authenticated session.
        if(/[?&]portal=1\b/.test(location.search)){
          if(typeof window.glClearRecoveryFlags === 'function'){
            try { window.glClearRecoveryFlags(); } catch(e){}
          }
          if(typeof window.glCheckPortal === 'function'){
            try { window.glCheckPortal(); } catch(e){ console.warn('[GL] glCheckPortal threw', e); location.reload(); }
          } else {
            location.reload();
          }
          return;
        }
        // Auto-open CRM via the same path as a normal login.
        if(user && typeof window.loginUser === 'function'){
          // Try to pull profile; if not there, build a minimal one.
          try{
            var prof = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
            var p = (prof && prof.data) || {};
            window.loginUser({
              id: user.id, email: user.email,
              name: p.name || (user.email||'').split('@')[0],
              role: p.role || 'sales', status: p.status || 'active',
              initials: p.initials || (user.email||'?').slice(0,2).toUpperCase(),
              color: p.color || '#1a6fff', tc: p.tc || '#fff', lastLogin: 'Just now'
            });
          }catch(e){ console.warn('[GL] post-recovery loginUser failed', e); }
        }
        if(typeof addNotification==='function') addNotification('Password updated','You are now signed in with the new password.','success');
      }catch(e){
        console.error('[GL] recovery updateUser threw', e);
        showErr('Failed: ' + (e.message||'unknown'));
        btn.disabled = false; btn.textContent = orig;
      }
    });
    [newEl, conEl].forEach(function(el){
      el.addEventListener('keydown', function(e){ if(e.key==='Enter') btn.click(); });
    });
  }

  var _attachAttempts = 0;
  function attach(){
    var sb = window.supa;
    if(!sb || !sb.auth || typeof sb.auth.onAuthStateChange !== 'function'){
      _attachAttempts++;
      if(_attachAttempts > 25){ // give up after ~10s
        console.warn('[GL] recovery handler: supa never became ready, giving up');
        return;
      }
      setTimeout(attach, 400);
      return;
    }
    // 1) Subscribe to future PASSWORD_RECOVERY events (fires when supabase-js
    //    parses the recovery hash or completes the PKCE code exchange).
    sb.auth.onAuthStateChange(function(event){
      if(event === 'PASSWORD_RECOVERY'){
        console.log('[GL] PASSWORD_RECOVERY received → opening reset modal');
        openRecoveryModal();
      }
    });
    // 2) Defensive: if the page loaded with recovery URL artifacts but the
    //    event fired before we subscribed (or never fires), open the modal
    //    by URL inspection. Cover both implicit (#type=recovery) and PKCE
    //    (?code=… on a ?portal=1 page) styles.
    var hash = (window.location.hash || '').replace(/^#/, '');
    var search = window.location.search || '';
    var hashRecovery = hash.indexOf('type=recovery') >= 0;
    var hashInvite   = hash.indexOf('type=invite')   >= 0;
    var pkceRecovery = /[?&]code=/.test(search) && /[?&]portal=1\b/.test(search);
    var tokenRecovery = /[?&]token_hash=/.test(search) && /[?&]type=recovery/.test(search);
    var tokenInvite   = /[?&]token_hash=/.test(search) && /[?&]type=invite/.test(search);
    if(hashRecovery || pkceRecovery || tokenRecovery){
      console.log('[GL] recovery URL artifact detected on load → opening reset modal');
      // Slight delay so supabase-js gets a chance to finalize the session
      // (so updateUser inside the modal will have credentials).
      setTimeout(function(){
        if(!document.getElementById('gl-recovery-modal')) openRecoveryModal('recovery');
      }, pkceRecovery ? 1500 : 300);
    } else if(hashInvite || tokenInvite){
      console.log('[GL] invite URL artifact detected on load → opening create-password modal');
      // Longer delay: supabase-js needs to exchange the invite token for a session.
      setTimeout(function(){
        if(!document.getElementById('gl-recovery-modal')) openRecoveryModal('invite');
      }, 800);
    }
  }
  if(document.readyState !== 'loading') attach();
  else document.addEventListener('DOMContentLoaded', attach);

  console.log('[GL] Recovery link handler loaded');
}());

/* ============================================================
   QUOTE PDF EXPORT
   Builds the same line-item PDF as glExportPDF, but labelled
   as a QUOTE with a 30-day validity instead of an invoice with
   due-upon-receipt terms. Reads the same lines / discount /
   total from the in-progress invoice builder; does NOT persist
   to the invoices table (quotes aren't billable until accepted).
   ============================================================ */
(function(){
  function fmt(n){ return '$'+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}); }

  function readLinesFromBuilder(){
    var rows = document.querySelectorAll('[data-gl-total]');
    var lines = [];
    rows.forEach(function(row){
      var uid = row.id; if(!uid) return;
      var total = parseFloat(row.getAttribute('data-gl-total'))||0;
      var casesEl = document.getElementById(uid+'-cases');
      var punitEl = document.getElementById(uid+'-punit');
      var descEl  = document.getElementById(uid+'-desc');
      var labelEl = row.querySelector('div > div');
      var label = labelEl ? labelEl.textContent.trim() : '';
      if(casesEl){
        var cases = parseInt(casesEl.value)||0;
        var fEl = document.getElementById(uid+'-format');
        var fLbl = (fEl && fEl.options[fEl.selectedIndex]) ? fEl.options[fEl.selectedIndex].text : '';
        var perCase = cases>0 ? total/cases : 0;
        lines.push({ desc:'Canning - '+fLbl, qty:cases, unitPrice:perCase, total:total, unit:'case' });
      } else if(punitEl){
        var qtyEl = document.getElementById(uid+'-qty');
        var qty = qtyEl ? parseInt(qtyEl.value)||0 : 0;
        var fEl2 = document.getElementById(uid+'-format');
        var fLbl2 = (fEl2 && fEl2.options[fEl2.selectedIndex]) ? fEl2.options[fEl2.selectedIndex].text : '';
        var perBtl = qty>0 ? total/qty : 0;
        lines.push({ desc:'Bottling - '+fLbl2, qty:qty, unitPrice:perBtl, total:total, unit:'btl' });
      } else if(descEl){
        var qtyM = parseFloat((document.getElementById(uid+'-qty')||{}).value)||0;
        var priceM = parseFloat((document.getElementById(uid+'-price')||{}).value)||0;
        var typed = (descEl.value||'').trim();
        var desc = typed ? (label?label+' - '+typed:typed) : (label||'Line item');
        lines.push({ desc:desc, qty:qtyM, unitPrice:priceM, total:total, unit:'' });
      }
    });
    return lines;
  }

  function nextQuoteId(){
    return 'GLQ-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + Math.floor(Math.random()*9000+1000);
  }

  window.glExportQuotePDF = function(){
    var cidEl = document.getElementById('ginv-client');
    var cid = cidEl ? cidEl.value : '';
    if(!cid){ alert('Please select a client.'); return; }
    var lines = readLinesFromBuilder();
    if(!lines.length){ alert('Add at least one line item before exporting a quote.'); return; }

    var client = (window.clients||[]).find(function(c){ return c.id === cid; }) || {};
    var dateEl = document.getElementById('ginv-date');
    var date = (dateEl && dateEl.value) ? dateEl.value : new Date().toISOString().slice(0,10);
    var discEl = document.getElementById('ginv-disc');
    var pct = discEl ? parseFloat(discEl.value)||0 : 0;
    var subtotal = lines.reduce(function(s,l){ return s + (l.total||0); }, 0);
    var discountAmt = subtotal * (pct/100);
    var amount = subtotal - discountAmt;

    var quoteId = nextQuoteId();
    var validUntil = '';
    try { validUntil = new Date(Date.parse(date) + 30*86400000).toISOString().slice(0,10); }
    catch(e){ validUntil = ''; }

    var html =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Quote '+quoteId+'</title>' +
      '<style>body{font-family:Arial,sans-serif;margin:0;padding:40px;color:#1a1a2e;font-size:13px}' +
        '.header{display:flex;justify-content:space-between;margin-bottom:40px}' +
        '.brand{font-size:28px;font-weight:900;letter-spacing:2px}.brand span{color:#00e5c0}' +
        'table{width:100%;border-collapse:collapse;margin-bottom:20px}' +
        'th{background:#0a1628;color:#fff;padding:10px 12px;text-align:left;font-size:11px}' +
        'td{padding:10px 12px;border-bottom:1px solid #eee;font-size:12px}' +
        'tr:nth-child(even) td{background:#f9f9f9}' +
        '.grand{font-size:18px;color:#1a6fff;font-weight:900}' +
        '.footer{margin-top:40px;padding-top:20px;border-top:2px solid #eee;font-size:11px;color:#999;display:flex;justify-content:space-between}' +
        '.badge{display:inline-block;background:#e8fff9;border:1px solid #00e5c0;color:#00695c;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700}' +
        '.qbadge{display:inline-block;background:#eef3ff;border:1px solid #1a6fff;color:#0c3a8a;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700}' +
        '.terms{background:#f3f6fb;border:1px solid #dde4ef;border-radius:8px;padding:14px;margin-top:18px;font-size:12px;line-height:1.7;color:#1a2240}' +
      '</style></head><body>' +
      '<div class="header"><div>' +
        '<div class="brand">GOOD <span>LIQUID</span> BEV CO</div>' +
        '<div style="font-size:11px;color:#666;margin-top:6px;line-height:1.8">2011 51st Ave E, Unit 100<br>Palmetto, FL 34221<br>Mike@GoodLiquid.com &middot; (803) 493-5065<br>goodliquidbevco.com</div>' +
        '<div style="margin-top:8px"><span class="badge">GMP</span>&nbsp;<span class="badge">PCQI</span>&nbsp;<span class="badge">HACCP</span></div>' +
      '</div>' +
      '<div style="text-align:right">' +
        '<h2 style="font-size:22px;margin:0 0 4px;color:#1a6fff">QUOTE</h2>' +
        '<div><b>Quote #:</b> '+quoteId+'</div>' +
        '<div><b>Date:</b> '+date+'</div>' +
        '<div><b>Valid until:</b> '+(validUntil||'30 days from date')+'</div>' +
        '<div style="margin-top:6px"><span class="qbadge">ESTIMATE — NOT AN INVOICE</span></div>' +
      '</div></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px"><div>' +
        '<div style="font-size:10px;letter-spacing:2px;color:#999;margin-bottom:4px">PREPARED FOR</div>' +
        '<div style="font-weight:700">'+ (client.name||'') +'</div>' +
        '<div style="color:#666">'+ (client.email||'') +'</div>' +
      '</div></div>' +
      '<table><thead><tr><th>Description</th><th style="text-align:center">Qty</th><th style="text-align:center">Unit</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead><tbody>' +
      lines.map(function(l){
        return '<tr><td>'+l.desc+'</td><td style="text-align:center">'+Number(l.qty||0).toLocaleString()+'</td><td style="text-align:center">'+(l.unit||'')+'</td><td style="text-align:right">'+fmt(l.unitPrice||0)+'</td><td style="text-align:right;font-weight:600">'+fmt(l.total||0)+'</td></tr>';
      }).join('') +
      '<tr style="background:#f5f5f5"><td colspan="4" style="text-align:right;font-weight:600">Subtotal</td><td style="text-align:right;font-weight:700">'+fmt(subtotal)+'</td></tr>' +
      (discountAmt>0 ? '<tr><td colspan="4" style="text-align:right;color:#c0392b">Discount ('+pct+'%)</td><td style="text-align:right;color:#c0392b;font-weight:700">&minus;'+fmt(discountAmt)+'</td></tr>' : '') +
      '<tr style="background:#eef3ff"><td colspan="4" style="text-align:right;font-size:15px;font-weight:700">ESTIMATED TOTAL</td><td style="text-align:right"><span class="grand">'+fmt(amount)+'</span></td></tr>' +
      '</tbody></table>' +
      '<div class="terms"><b>Quote terms</b>' +
        '<ul style="margin:6px 0 0 18px;padding:0;font-size:12px;color:#1a2240"><li>Pricing valid for 30 days from quote date</li>' +
        '<li>Minimum order: 150 cases (canning) / 220 cases (bottling)</li>' +
        '<li>50% deposit on accepted quote; balance due on completion</li>' +
        '<li>Lead time: ~8 weeks from artwork & ingredient approval</li>' +
        '<li>Final invoice may vary based on actual production volume</li></ul>' +
      '</div>' +
      '<div class="footer"><div><b>Good Liquid Bev Co</b><br>Reply to accept this quote.</div><div style="text-align:right">Questions? Mike@GoodLiquid.com<br>(803) 493-5065</div></div>' +
      '</body></html>';

    var w = window.open('', '_blank', 'width=900,height=700');
    w.document.write(html); w.document.close();
    w.onload = function(){ w.focus(); w.print(); };
    if(typeof addNotification === 'function') addNotification('Quote generated', 'Quote '+quoteId+' ready to print/save','success');
  };

  // Inject the "Export as Quote" button into the invoice builder modal
  // every time it opens (using a MutationObserver since fix.js v5 rebuilds
  // the builder DOM each open).
  function injectQuoteButton(){
    var body = document.getElementById('gl-inv-body');
    if(!body) return;
    // Find the bottom action button row (Save Invoice / Save & Export PDF)
    var saveBtn = Array.from(body.querySelectorAll('button')).find(function(b){
      return (b.textContent||'').trim().includes('Save Invoice');
    });
    if(!saveBtn) return;
    var row = saveBtn.parentElement;
    if(!row || row.querySelector('.gl-quote-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'cbtn gl-quote-btn';
    btn.setAttribute('style','flex:1;font-size:14px;background:rgba(26,111,255,.08);border:1px solid rgba(26,111,255,.3);color:#6b9fff');
    btn.innerHTML = '📋 Export as Quote';
    btn.addEventListener('click', function(){ window.glExportQuotePDF(); });
    row.appendChild(btn);
  }

  // Watch the builder modal: any time gl-inv-body's children change, re-inject.
  var observer = new MutationObserver(function(){ setTimeout(injectQuoteButton, 60); });
  function startObserving(){
    var body = document.getElementById('gl-inv-body');
    if(body){ observer.observe(body, {childList:true, subtree:true}); injectQuoteButton(); }
    else setTimeout(startObserving, 500);
  }
  if(document.readyState !== 'loading') startObserving();
  else document.addEventListener('DOMContentLoaded', startObserving);

  console.log('[GL] Quote PDF export loaded');
}());

/* ============================================================
   AUDIT LOG
   Records significant admin / user actions to the Supabase
   audit_log table. Fire-and-forget — never blocks UX, never
   surfaces errors to the user (just console.warn). The table
   itself is created via the SQL in PROJECT.md; if it doesn't
   exist yet, the inserts will fail silently and that's fine.

   Logged actions:
   - login / signout
   - invoice_save
   - invite_user / set_password / change_role / remove_user
   ============================================================ */
(function(){
  var uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  window.glAudit = async function(action, target, details){
    var sb = window.supa;
    if(!sb) return;
    var u = window.currentUser || {};
    var payload = {
      actor_id: (u.id && uuidRe.test(u.id)) ? u.id : null,
      actor_email: u.email || null,
      action: String(action || 'unknown').slice(0,80),
      target: target ? String(target).slice(0,200) : null,
      details: details || null
    };
    try{
      var r = await sb.from('audit_log').insert([payload]);
      if(r.error) console.warn('[GL audit] insert failed (table may not exist yet):', r.error.message);
    }catch(e){ console.warn('[GL audit] threw', e); }
  };

  // Wrap existing admin functions so they emit audit entries.
  function wrap(name, action, targetFn){
    var orig = window[name];
    if(typeof orig !== 'function') return;
    window[name] = async function(){
      var argsForLog = Array.from(arguments);
      var result;
      try { result = await orig.apply(this, arguments); }
      catch(e){
        window.glAudit(action+'_error', null, { message:String(e&&e.message||e) });
        throw e;
      }
      try {
        var target = targetFn ? targetFn(argsForLog, result) : null;
        window.glAudit(action, target, null);
      } catch(e){ /* never break the original */ }
      return result;
    };
  }

  // glAdminChangeRole(uid, newRole)
  wrap('glAdminChangeRole', 'change_role', function(args){
    var u = (window.users||[]).find(function(x){return x.id===args[0];});
    return (u && u.email ? u.email : args[0]) + ' → ' + args[1];
  });

  // glAdminSetPassword(uid) — the prompt happens inside; we log after returning
  // Note: returning fast (modal opens) doesn't mean password changed; the
  // success path lives inside the modal. We log here as "set_password_opened"
  // to keep noise low — actual success is logged via the modal save handler
  // below if/when we instrument it. Skip wrapping; modal handles it directly.

  // removeUser(id)
  wrap('removeUser', 'remove_user', function(args){
    var u = (window.users||[]).find(function(x){return x.id===args[0];});
    return u && u.email ? u.email : args[0];
  });

  // createInvitedUser() — no args, reads from form. Log after success.
  wrap('createInvitedUser', 'invite_user', function(){
    var em = document.getElementById('inv-email');
    var role = document.getElementById('inv-role');
    return (em && em.value ? em.value : '?') + ' / ' + (role && role.value ? role.value : '?');
  });

  // glSignOut()
  wrap('glSignOut', 'signout', function(){
    return (window.currentUser && window.currentUser.email) || null;
  });

  // checkPw() — wrap so a successful login emits an event. We use a
  // post-condition: only log if currentUser changed during the call.
  (function(){
    var orig = window.checkPw;
    if(typeof orig !== 'function') return;
    window.checkPw = async function(){
      var before = window.currentUser;
      var result = await orig.apply(this, arguments);
      if(window.currentUser && window.currentUser !== before){
        try { window.glAudit('login', window.currentUser.email||null, null); } catch(e){}
      }
      return result;
    };
  })();

  // glSaveInvoice() — wrap to log after a successful save (returns truthy inv).
  (function(){
    var orig = window.glSaveInvoice;
    if(typeof orig !== 'function') return;
    window.glSaveInvoice = function(){
      var inv = orig.apply(this, arguments);
      if(inv && inv.id){
        try { window.glAudit('invoice_save', inv.id, { amount: inv.amount, client: inv.clientName }); } catch(e){}
      }
      return inv;
    };
  })();

  console.log('[GL] Audit log wired (login/signout/invoice/users)');
}());

/* ============================================================
   AUDIT LOG VIEWER
   Admin-only modal that paginates recent audit_log entries.
   Adds an "📋 Activity log" button to the Users panel header
   right next to "Invite User".
   ============================================================ */
(function(){
  function esc(s){
    return String(s||'').replace(/[&<>"]/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
    });
  }
  function fmtWhen(iso){
    if(!iso) return '';
    var d = new Date(iso);
    var ms = Date.now() - d.getTime();
    if(ms < 60000) return Math.floor(ms/1000) + 's ago';
    if(ms < 3600000) return Math.floor(ms/60000) + 'm ago';
    if(ms < 86400000) return Math.floor(ms/3600000) + 'h ago';
    if(ms < 7*86400000) return Math.floor(ms/86400000) + 'd ago';
    return d.toLocaleDateString();
  }
  function actionStyle(a){
    a = String(a||'').toLowerCase();
    if(a.indexOf('error') >= 0) return 'background:rgba(231,76,60,.12);color:#ff8579';
    if(a.indexOf('login') >= 0 || a.indexOf('signout') >= 0) return 'background:rgba(0,229,192,.1);color:var(--teal)';
    if(a.indexOf('remove') >= 0 || a.indexOf('delete') >= 0) return 'background:rgba(245,200,66,.1);color:#f5c842';
    if(a.indexOf('invite') >= 0 || a.indexOf('invoice_save') >= 0) return 'background:rgba(26,111,255,.1);color:#6b9fff';
    if(a.indexOf('password') >= 0 || a.indexOf('role') >= 0) return 'background:rgba(168,85,247,.1);color:#c4a4f8';
    return 'background:rgba(255,255,255,.06);color:var(--muted)';
  }

  window.glOpenAuditLog = async function(){
    if(!window.currentUser || window.currentUser.role !== 'admin'){
      alert('Admin only.');
      return;
    }
    var existing = document.getElementById('gl-audit-modal');
    if(existing) existing.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var ov = document.createElement('div');
    ov.id = 'gl-audit-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:24px;width:100%;max-width:760px;max-height:85vh;display:flex;flex-direction:column">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
          '<div>' +
            '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">📋 ACTIVITY LOG</div>' +
            '<div style="font-size:11px;color:var(--muted);margin-top:2px">Last 100 actions across all users</div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;align-items:center">' +
            '<button id="gl-audit-refresh" class="cbtn" style="font-size:11px;padding:5px 11px">🔄 Refresh</button>' +
            '<button id="gl-audit-close" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer">✕</button>' +
          '</div>' +
        '</div>' +
        '<div id="gl-audit-body" style="flex:1;overflow-y:auto;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05);border-radius:8px;padding:8px">' +
          '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">Loading…</div>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-audit-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-audit-refresh').addEventListener('click', loadEntries);
    host.appendChild(ov);

    async function loadEntries(){
      var body = ov.querySelector('#gl-audit-body');
      body.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">Loading…</div>';
      var sb = window.supa;
      if(!sb){ body.innerHTML = '<div style="padding:30px;text-align:center;color:#ff8579;font-size:13px">Auth service unavailable.</div>'; return; }
      try{
        var r = await sb.from('audit_log').select('*').order('created_at',{ascending:false}).limit(100);
        if(r.error){
          body.innerHTML = '<div style="padding:30px;text-align:center;color:#ff8579;font-size:13px;line-height:1.6">' +
            '<div style="font-size:24px;margin-bottom:8px">⚠</div>' +
            esc(r.error.message) +
            '<div style="font-size:11px;margin-top:14px;color:var(--muted)">If you haven\'t created the audit_log table yet, run the SQL block from the deploy notes.</div>' +
          '</div>';
          return;
        }
        var rows = r.data || [];
        if(!rows.length){
          body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px">No actions logged yet. Do something in the CRM and they\'ll show up here.</div>';
          return;
        }
        body.innerHTML =
          '<table style="width:100%;border-collapse:collapse">' +
            '<thead><tr style="font-size:10px;letter-spacing:2px;color:var(--muted);text-align:left">' +
              '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">WHEN</th>' +
              '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">ACTOR</th>' +
              '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">ACTION</th>' +
              '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">TARGET</th>' +
              '<th style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.08)">DETAILS</th>' +
            '</tr></thead>' +
            '<tbody>' +
            rows.map(function(r){
              var det = r.details ? JSON.stringify(r.details) : '';
              if(det.length > 80) det = det.slice(0,80) + '…';
              return '<tr style="border-bottom:1px solid rgba(255,255,255,.04)">' +
                '<td style="padding:9px 10px;font-size:11px;color:var(--muted);white-space:nowrap" title="'+esc(r.created_at)+'">'+esc(fmtWhen(r.created_at))+'</td>' +
                '<td style="padding:9px 10px;font-size:12px;color:#fff">'+esc(r.actor_email||'system')+'</td>' +
                '<td style="padding:9px 10px"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600;'+actionStyle(r.action)+'">'+esc(r.action||'?')+'</span></td>' +
                '<td style="padding:9px 10px;font-size:12px;color:#fff;font-family:var(--ff-mono)">'+esc(r.target||'')+'</td>' +
                '<td style="padding:9px 10px;font-size:11px;color:var(--muted);font-family:var(--ff-mono)">'+esc(det)+'</td>' +
              '</tr>';
            }).join('') +
            '</tbody>' +
          '</table>';
      }catch(e){
        console.error('[GL audit viewer] load failed', e);
        body.innerHTML = '<div style="padding:30px;text-align:center;color:#ff8579;font-size:13px">Failed: '+esc(e.message||'unknown')+'</div>';
      }
    }
    loadEntries();
  };

  // Inject the "Activity log" button next to the Users panel header button.
  function injectAuditBtn(){
    var page = document.getElementById('cpg-users');
    if(!page) return;
    var header = page.querySelector('.cph');
    if(!header) return;
    if(header.querySelector('.gl-audit-btn')) return;
    if(!window.currentUser || window.currentUser.role !== 'admin') return;
    var inviteBtn = Array.from(header.querySelectorAll('button')).find(function(b){
      return (b.textContent||'').trim().toLowerCase().includes('invite');
    });
    var btn = document.createElement('button');
    btn.className = 'cbtn gl-audit-btn';
    btn.setAttribute('style','margin-left:8px;background:rgba(0,229,192,.08);border:1px solid rgba(0,229,192,.3);color:var(--teal)');
    btn.textContent = '📋 Activity log';
    btn.addEventListener('click', function(){ window.glOpenAuditLog(); });
    if(inviteBtn && inviteBtn.parentElement) inviteBtn.parentElement.appendChild(btn);
    else header.appendChild(btn);
  }
  // Re-attempt injection whenever the users page renders
  var observer = new MutationObserver(function(){ setTimeout(injectAuditBtn, 50); });
  function startObs(){
    var p = document.getElementById('cpg-users');
    if(p){ observer.observe(p, {childList:true, subtree:true}); injectAuditBtn(); }
    else setTimeout(startObs, 500);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] Audit log viewer loaded');
}());

/* ============================================================
   QUOTE -> INVOICE WORKFLOW
   - "💾 Save as Quote" button in the builder persists the same
     line items as an invoice with status='quote' (doesn't show
     in receivables tracking, doesn't count toward revenue).
   - Invoice list rows with status='quote' get a "✓ Convert to
     Invoice" button that flips status to 'pending'.
   ============================================================ */
(function(){
  var SURL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1';
  var SKEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE';

  // Save the current builder state as an invoice with status='quote'.
  // Reuses glSaveInvoice's machinery by temporarily flipping status
  // and undoing the flip after the call returns.
  window.glSaveAsQuote = function(){
    var orig = window.glSaveInvoice;
    if(typeof orig !== 'function'){ alert('glSaveInvoice not available.'); return; }
    var marker = '__GL_QUOTE_PATCH__';
    if(window[marker]) return;  // re-entrancy guard
    window[marker] = true;
    var inv;
    try {
      inv = orig();
    } finally {
      window[marker] = false;
    }
    if(!inv) return;
    // Flip status locally
    inv.status = 'quote';
    // Update the Supabase row via PATCH (the save above did an INSERT)
    if(inv.id){
      fetch(SURL + '/invoices?invoice_number=eq.' + encodeURIComponent(inv.id), {
        method: 'PATCH',
        headers: { apikey: SKEY, Authorization: 'Bearer ' + SKEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'quote' })
      }).catch(function(e){ console.warn('[GL quote] status patch failed', e); });
    }
    // Update the visible row
    if(typeof renderInvoices === 'function') renderInvoices();
    if(typeof addNotification === 'function') addNotification('💾 Quote saved', inv.id + ' · ' + (inv.clientName||''), 'success');
  };

  // Promote a quote to a billable invoice by flipping status.
  window.glConvertQuoteToInvoice = async function(invId){
    if(!invId) return;
    if(!confirm('Convert quote ' + invId + ' to a billable invoice?\n\nThe status will change from "quote" to "pending" and it will count toward receivables.')) return;
    var inv = (window.invoices||[]).find(function(i){ return i.id === invId; });
    if(!inv){ alert('Invoice not found.'); return; }
    try {
      var res = await fetch(SURL + '/invoices?invoice_number=eq.' + encodeURIComponent(invId), {
        method: 'PATCH',
        headers: { apikey: SKEY, Authorization: 'Bearer ' + SKEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'pending' })
      });
      if(!res.ok){
        var t = await res.text();
        alert('Conversion failed: HTTP ' + res.status + '\n' + t);
        return;
      }
      inv.status = 'pending';
      if(typeof renderInvoices === 'function') renderInvoices();
      if(typeof renderDash === 'function') renderDash();
      if(typeof addNotification === 'function') addNotification('✓ Quote converted', invId + ' is now a billable invoice', 'success');
      if(typeof window.glAudit === 'function') window.glAudit('quote_convert', invId);
    } catch(e){
      console.error('[GL convert quote] threw', e);
      alert('Failed: ' + (e.message || 'unknown'));
    }
  };

  // Inject "💾 Save as Quote" button into the invoice builder action row.
  function injectSaveQuoteButton(){
    var body = document.getElementById('gl-inv-body');
    if(!body) return;
    var saveBtn = Array.from(body.querySelectorAll('button')).find(function(b){
      return (b.textContent||'').trim() === '💾 Save Invoice' || (b.textContent||'').trim().includes('Save Invoice');
    });
    if(!saveBtn) return;
    var row = saveBtn.parentElement;
    if(!row || row.querySelector('.gl-save-quote-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'cbtn gl-save-quote-btn';
    btn.setAttribute('style','flex:1;font-size:14px;background:rgba(26,111,255,.08);border:1px solid rgba(26,111,255,.3);color:#6b9fff');
    btn.textContent = '💾 Save as Quote';
    btn.addEventListener('click', function(){ window.glSaveAsQuote(); });
    // Insert right after the main Save button.
    if(saveBtn.nextSibling) row.insertBefore(btn, saveBtn.nextSibling);
    else row.appendChild(btn);
  }

  // Inject "Convert" button onto invoice rows where status='quote'.
  function injectConvertButtons(){
    var body = document.getElementById('inv-body');
    if(!body) return;
    body.querySelectorAll('tr').forEach(function(tr){
      var statusBadge = tr.querySelector('.cbdg');
      if(!statusBadge) return;
      var status = (statusBadge.textContent||'').trim().toLowerCase();
      if(status !== 'quote') return;
      var actionsCell = tr.querySelector('td:last-child > div') || tr.querySelector('td:last-child');
      if(!actionsCell || actionsCell.querySelector('.gl-convert-btn')) return;
      var idCell = tr.querySelector('td:first-child');
      var invId = idCell ? (idCell.textContent||'').trim() : '';
      if(!invId) return;
      var btn = document.createElement('button');
      btn.className = 'cbtn gl-convert-btn';
      btn.setAttribute('style','font-size:10px;padding:3px 7px;background:rgba(26,111,255,.12);border:1px solid rgba(26,111,255,.35);color:#6b9fff');
      btn.textContent = '→ Invoice';
      btn.title = 'Convert this quote to a billable invoice';
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        window.glConvertQuoteToInvoice(invId);
      });
      actionsCell.insertBefore(btn, actionsCell.firstChild);
      // Tint the badge so quote rows are visually distinct
      statusBadge.setAttribute('style','background:rgba(26,111,255,.12);color:#6b9fff;border:1px solid rgba(26,111,255,.3)');
    });
  }

  // Watch both the builder body (for Save-as-Quote button) and the invoice
  // list body (for Convert buttons on quote rows).
  function startObservers(){
    var builder = document.getElementById('gl-inv-body');
    var invList = document.getElementById('inv-body');
    if(builder) new MutationObserver(function(){ setTimeout(injectSaveQuoteButton, 40); }).observe(builder, {childList:true, subtree:true});
    if(invList) new MutationObserver(function(){ setTimeout(injectConvertButtons, 40); }).observe(invList, {childList:true, subtree:true});
    if(!builder || !invList) setTimeout(startObservers, 500);
  }
  if(document.readyState !== 'loading') startObservers();
  else document.addEventListener('DOMContentLoaded', startObservers);

  console.log('[GL] Quote -> Invoice workflow loaded');
}());

/* ============================================================
   STRIPE PAYMENT LINK MANAGER
   - Admin pastes a Stripe Payment Link URL per invoice (created
     in their Stripe dashboard once per amount/SKU and reused).
   - Stored in localStorage gl_invoice_paylinks as {invId: url}.
   - Invoice rows / detail show "💳 Pay link" if present.
   - Follow-up emails auto-append the link if present.
   - Future: when a backend exists, swap glStripeCheckout() for a
     real Checkout Session creator using the Stripe secret key.
   ============================================================ */
(function(){
  /* Pay link storage: source of truth is the
     invoices.stripe_payment_link column added by
     20260523_activities_calendar_pipeline_paylinks.sql. The
     legacy gl_invoice_paylinks {invId: url} blob is preserved
     ONLY as a fallback for renderers that need a sync read
     before the DB has loaded — every write goes to the DB. */
  function getLinks(){ try { return JSON.parse(localStorage.getItem('gl_invoice_paylinks')||'{}'); } catch(e){ return {}; } }
  function saveLinks(m){ try { localStorage.setItem('gl_invoice_paylinks', JSON.stringify(m)); } catch(e){} }

  // One-shot backfill: every legacy LS entry becomes an UPDATE on
  // the invoices row.
  (async function backfillPaylinks(){
    try {
      if(localStorage.getItem('gl_invoice_paylinks_migrated') === '1') return;
      if(!window.supa) return;
      var blob = localStorage.getItem('gl_invoice_paylinks');
      if(!blob){ localStorage.setItem('gl_invoice_paylinks_migrated','1'); return; }
      var legacy = {}; try { legacy = JSON.parse(blob) || {}; } catch(_e){ return; }
      var ids = Object.keys(legacy);
      if(!ids.length){ localStorage.setItem('gl_invoice_paylinks_migrated','1'); return; }
      for(var i=0;i<ids.length;i++){
        var invId = ids[i]; var url = legacy[invId];
        if(!url) continue;
        // Match by invoice_number since the legacy keys are GL-2026-XYZ strings.
        await window.supa.from('invoices').update({ stripe_payment_link: url }).eq('invoice_number', invId);
      }
      localStorage.setItem('gl_invoice_paylinks_migrated','1');
    } catch(e){ console.warn('[GL] invoice_paylinks backfill threw', e); }
  })();

  window.glGetPayLink = function(invId){
    // Prefer the invoices column when available (canonical), fall
    // back to the LS map for callers that haven't refetched yet.
    var inv = (window.invoices||[]).find(function(i){ return i.id === invId || i.invoice_number === invId; });
    if(inv && inv.stripe_payment_link) return inv.stripe_payment_link;
    var m = getLinks();
    return m[invId] || '';
  };

  window.glSetPayLink = function(invId, url){
    var m = getLinks();
    if(url) m[invId] = url; else delete m[invId];
    saveLinks(m);
    // Persist to the canonical column too.
    if(window.supa){
      window.supa.from('invoices').update({ stripe_payment_link: url || null }).eq('invoice_number', invId).then(function(r){
        if(r.error) console.warn('[GL] pay link DB update failed', r.error.message);
      });
    }
  };

  // Override the legacy generatePayLink with a Stripe-aware version.
  window.generatePayLink = function(invId){
    var inv = (window.invoices||[]).find(function(i){ return i.id === invId; });
    if(!inv){ alert('Invoice not found'); return; }
    var existing = window.glGetPayLink(invId);
    var host = document.getElementById('crm-panel') || document.body;
    var prior = document.getElementById('gl-paylink-modal'); if(prior) prior.remove();
    var modal = document.createElement('div');
    modal.id = 'gl-paylink-modal';
    modal.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    modal.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:520px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">💳 PAYMENT LINK — ' + inv.id + '</div>' +
          '<button id="gl-pl-close" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;font-size:12px">' +
          '<div style="background:rgba(255,255,255,.04);border-radius:8px;padding:10px 12px"><div style="font-size:10px;color:var(--muted)">CLIENT</div><div style="color:#fff;font-weight:600">' + (inv.clientName||'') + '</div></div>' +
          '<div style="background:rgba(255,255,255,.04);border-radius:8px;padding:10px 12px"><div style="font-size:10px;color:var(--muted)">AMOUNT</div><div style="color:var(--teal);font-weight:700">$' + Number(inv.amount||0).toLocaleString() + '</div></div>' +
        '</div>' +
        '<div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:6px">STRIPE PAYMENT LINK</div>' +
        '<input id="gl-pl-url" class="finp" placeholder="https://buy.stripe.com/..." value="' + existing.replace(/"/g,'&quot;') + '" style="margin-bottom:6px">' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:14px;line-height:1.6">Create payment links in your Stripe dashboard → <span style="color:var(--teal)">dashboard.stripe.com → Product catalog → Payment links</span>. Paste the URL here. The link is included automatically in any follow-up email for this invoice.</div>' +
        (existing ? '<div style="background:rgba(29,158,117,.08);border:1px solid rgba(29,158,117,.25);border-radius:8px;padding:10px 12px;font-size:11px;color:#1D9E75;margin-bottom:14px">✓ Link saved. Customers who click it pay via Stripe directly.</div>' : '') +
        '<div style="display:flex;gap:8px">' +
          '<button id="gl-pl-save" class="cbtn pri" style="flex:1">💾 Save link</button>' +
          (existing ? '<button id="gl-pl-open" class="cbtn" style="background:rgba(0,229,192,.08);border:1px solid rgba(0,229,192,.3);color:var(--teal)">🔗 Open</button>' : '') +
          (existing ? '<button id="gl-pl-copy" class="cbtn">📋 Copy</button>' : '') +
          (existing ? '<button id="gl-pl-clear" class="cbtn red">Clear</button>' : '') +
        '</div>' +
      '</div>';
    modal.addEventListener('click', function(e){ if(e.target === modal) modal.remove(); });
    modal.querySelector('#gl-pl-close').addEventListener('click', function(){ modal.remove(); });
    modal.querySelector('#gl-pl-save').addEventListener('click', function(){
      var url = (modal.querySelector('#gl-pl-url').value||'').trim();
      if(url && !/^https?:\/\//i.test(url)){ alert('URL must start with https://'); return; }
      window.glSetPayLink(invId, url);
      if(typeof addNotification === 'function') addNotification('💳 Pay link saved', invId, 'success');
      modal.remove();
      if(typeof renderInvoices === 'function') renderInvoices();
    });
    if(existing){
      modal.querySelector('#gl-pl-open').addEventListener('click', function(){ window.open(existing, '_blank', 'noopener'); });
      modal.querySelector('#gl-pl-copy').addEventListener('click', function(){
        navigator.clipboard.writeText(existing).then(function(){
          if(typeof addNotification === 'function') addNotification('Link copied', invId, 'success');
        });
      });
      modal.querySelector('#gl-pl-clear').addEventListener('click', function(){
        if(!confirm('Remove the pay link from this invoice?')) return;
        window.glSetPayLink(invId, '');
        modal.remove();
        if(typeof renderInvoices === 'function') renderInvoices();
      });
    }
    host.appendChild(modal);
  };

  // Wrap sendFollowupEmail so any link saved on the current invoice is
  // appended to the email body before sending.
  (function(){
    var orig = window.sendFollowupEmail;
    if(typeof orig !== 'function') return;
    window.sendFollowupEmail = async function(){
      var invId = window.currentFollowupInvId || window.currentInvId;
      var link = invId ? window.glGetPayLink(invId) : '';
      if(link){
        var bodyEl = document.getElementById('fu-body');
        if(bodyEl && bodyEl.value.indexOf(link) === -1){
          bodyEl.value = bodyEl.value.replace(/\s*$/, '') + '\n\nPay securely: ' + link;
        }
      }
      return orig.apply(this, arguments);
    };
  })();

  // Inject "💳" badge / button into invoice rows that have a pay link.
  function injectPayLinkBadges(){
    var body = document.getElementById('inv-body');
    if(!body) return;
    var links = getLinks();
    body.querySelectorAll('tr').forEach(function(tr){
      var idCell = tr.querySelector('td:first-child');
      if(!idCell) return;
      var invId = (idCell.textContent||'').trim();
      var actions = tr.querySelector('td:last-child > div');
      if(!actions) return;
      var existing = actions.querySelector('.gl-pl-badge');
      var hasLink = !!links[invId];
      if(hasLink && !existing){
        var badge = document.createElement('button');
        badge.className = 'cbtn gl-pl-badge';
        badge.title = 'Open Stripe pay link';
        badge.setAttribute('style','font-size:10px;padding:3px 7px;background:rgba(168,85,247,.12);border:1px solid rgba(168,85,247,.35);color:#c4a4f8');
        badge.textContent = '💳';
        badge.addEventListener('click', function(e){
          e.stopPropagation();
          window.open(links[invId], '_blank', 'noopener');
        });
        actions.insertBefore(badge, actions.firstChild);
      } else if(!hasLink && existing){
        existing.remove();
      }
    });
  }

  function startObs(){
    var invList = document.getElementById('inv-body');
    if(invList){ new MutationObserver(function(){ setTimeout(injectPayLinkBadges, 40); }).observe(invList, {childList:true, subtree:true}); injectPayLinkBadges(); }
    else setTimeout(startObs, 500);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] Stripe pay-link manager loaded');
}());

/* ============================================================
   DOCUMENTS: Real Supabase Storage
   The existing uploadDocToSupabase / downloadDocFromSupabase
   code in index.html is wired correctly but routes through a
   dead getSupabase() that reads localStorage.gl_supabase_key
   (which we deprecated). Repoint it at window.supa so the
   storage uploads work with the shared authenticated client.

   Requires SQL setup of the 'client-docs' bucket + RLS policies
   (provided in wake-up notes). Until that SQL runs, the original
   silent-fallback behavior is preserved (metadata saved, no file).
   ============================================================ */
(function(){
  // Replace the legacy factory so all document storage calls share the
  // already-initialized authenticated supabase-js client.
  var origGet = window.getSupabase;
  window.getSupabase = function(){
    if(window.supa) return window.supa;
    if(typeof origGet === 'function') try { return origGet(); } catch(e){}
    return null;
  };

  // Add an upload-progress indicator + clearer error messages around the
  // existing uploadDocToSupabase helper.
  var origUpload = window.uploadDocToSupabase;
  if(typeof origUpload === 'function'){
    window.uploadDocToSupabase = async function(file, clientId, docType, docName){
      if(typeof window.glStartBusy === 'function') window.glStartBusy('Uploading ' + (file && file.name ? file.name : 'document') + '…');
      try {
        var result = await origUpload.apply(this, arguments);
        if(!result || !result.url){
          // Most likely cause: bucket doesn't exist or RLS forbids.
          // Surface that to the admin rather than silently dropping the file.
          if(typeof addNotification === 'function') addNotification('Upload failed — file not stored', 'Check that the client-docs Supabase Storage bucket exists and that you ran the bucket SQL.', 'warning');
        } else {
          if(typeof addNotification === 'function') addNotification('📎 File uploaded', (file && file.name) || 'document', 'success');
        }
        return result;
      } finally {
        if(typeof window.glEndBusy === 'function') window.glEndBusy();
      }
    };
  }

  console.log('[GL] Documents → Supabase Storage bridge loaded');
}());

/* ============================================================
   LIST LOADING STATES
   - Wrap loadSupabaseData with the global busy pill so the
     initial CRM hydration shows a clear "Loading your data…"
     indicator.
   - Insert lightweight skeleton rows into the invoice / client
     / deal renderers when those views render empty during the
     initial load — so the user sees "loading" pulses instead
     of "0 invoices" briefly.
   ============================================================ */
(function(){
  window._glLoading = false;

  // Style the pulsing skeleton row.
  if(!document.getElementById('gl-skeleton-style')){
    var s = document.createElement('style');
    s.id = 'gl-skeleton-style';
    s.textContent =
      '@keyframes gl-pulse{0%,100%{opacity:.4}50%{opacity:1}}' +
      '.gl-skel{display:block;height:10px;border-radius:4px;background:rgba(255,255,255,.06);animation:gl-pulse 1.2s ease-in-out infinite}' +
      '.gl-skel-row{display:grid;grid-template-columns:140px 1fr 1fr 100px 80px;gap:14px;padding:14px 12px;border-bottom:1px solid rgba(255,255,255,.04)}';
    document.head.appendChild(s);
  }

  function injectSkeleton(targetId, cols){
    var el = document.getElementById(targetId);
    if(!el) return;
    if(el.querySelector('.gl-skel-row')) return;  // already showing skeletons
    var rows = '';
    for(var i=0;i<4;i++){
      var cells = '';
      for(var c=0;c<cols;c++) cells += '<div class="gl-skel" style="width:' + (50 + Math.random()*40) + '%"></div>';
      rows += '<div class="gl-skel-row">' + cells + '</div>';
    }
    el.innerHTML = rows;
  }

  // Wrap loadSupabaseData so it (a) shows the busy pill, (b) toggles _glLoading.
  var origLoad = window.loadSupabaseData;
  if(typeof origLoad === 'function'){
    window.loadSupabaseData = async function(){
      window._glLoading = true;
      if(typeof window.glStartBusy === 'function') window.glStartBusy('Loading your data…');
      // Pre-populate skeletons in case the user is staring at an empty list.
      try {
        if(document.getElementById('inv-body') && !(window.invoices||[]).length) injectSkeleton('inv-body', 5);
        if(document.getElementById('clients-body') && !(window.clients||[]).length) injectSkeleton('clients-body', 4);
      } catch(e){}
      try { return await origLoad.apply(this, arguments); }
      catch(e){ console.error('[GL] loadSupabaseData threw', e); throw e; }
      finally {
        window._glLoading = false;
        if(typeof window.glEndBusy === 'function') window.glEndBusy();
        // Force a re-render so any skeleton rows get replaced.
        if(typeof window.renderInvoices === 'function') try { window.renderInvoices(); } catch(e){}
        if(typeof window.renderClients === 'function') try { window.renderClients(); } catch(e){}
        if(typeof window.renderKanban === 'function') try { window.renderKanban(); } catch(e){}
      }
    };
  }

  console.log('[GL] List loading skeletons + busy wrap loaded');
}());

/* ============================================================
   DEAL -> INVOICE conversion
   Adds a "→ Invoice" button to the deal detail modal that opens
   the invoice builder pre-populated with the deal's client and
   notes. Admin fills in line items and saves.
   ============================================================ */
(function(){
  function injectDealToInvoice(){
    var panel = document.getElementById('deal-detail-panel');
    if(!panel) return;
    // Find Save Changes button to insert next to it
    var saveBtn = Array.from(panel.querySelectorAll('button')).find(function(b){
      return (b.textContent||'').trim().toLowerCase().includes('save changes');
    });
    if(!saveBtn) return;
    if(saveBtn.parentElement.querySelector('.gl-deal-to-inv-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'gl-deal-to-inv-btn';
    btn.setAttribute('style','padding:12px 20px;background:rgba(26,111,255,.12);color:#6b9fff;border:1px solid rgba(26,111,255,.35);border-radius:8px;font-weight:700;font-size:14px;cursor:pointer');
    btn.textContent = '→ Invoice';
    btn.title = 'Create an invoice for this deal';
    btn.addEventListener('click', function(){
      var dealName = (document.getElementById('ddp-name')||{}).value || '';
      var co       = (document.getElementById('ddp-co')||{}).value || '';
      var val      = parseFloat((document.getElementById('ddp-val')||{}).value)||0;
      var notes    = (document.getElementById('ddp-notes')||{}).value || '';

      // Close the deal modal first
      var dpanel = document.getElementById('deal-detail-panel');
      if(dpanel) dpanel.style.display = 'none';

      // Open the invoice builder
      if(typeof window.openNewInvoiceBuilder === 'function') window.openNewInvoiceBuilder();
      else { alert('Invoice builder not available.'); return; }

      // Pre-populate after the builder renders
      setTimeout(function(){
        // Match client by name (case-insensitive)
        var sel = document.getElementById('ginv-client');
        if(sel && co){
          var lower = co.toLowerCase();
          var match = Array.from(sel.options).find(function(o){
            return (o.textContent||'').toLowerCase().includes(lower);
          });
          if(match){ sel.value = match.value; sel.dispatchEvent(new Event('change')); }
        }
        // Set today's date (already default), and stash the deal context for the admin
        if(typeof addNotification === 'function'){
          var msg = 'Pre-filled from deal "' + dealName + '" (' + co + ')' +
                    (val > 0 ? ' — estimated $' + Math.round(val).toLocaleString() : '');
          addNotification('Deal → Invoice', msg, 'success');
        }
        // Audit
        if(typeof window.glAudit === 'function') window.glAudit('deal_to_invoice', dealName, { client: co, value: val });
      }, 250);
    });
    // Insert before the Delete button so order reads: Save / Invoice / Delete
    saveBtn.parentElement.insertBefore(btn, saveBtn.nextSibling);
  }

  function startObs(){
    var panel = document.getElementById('deal-detail-panel');
    if(panel){
      new MutationObserver(function(){ setTimeout(injectDealToInvoice, 50); }).observe(panel, {childList:true, subtree:true, attributes:true, attributeFilter:['style']});
      injectDealToInvoice();
    } else setTimeout(startObs, 500);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] Deal → Invoice converter loaded');
}());

/* ============================================================
   STALE DEAL INDICATOR
   Kanban cards in stages OTHER than Closed Won/Lost that haven't
   been moved/edited in >14 days get a small ⏰ badge and slight
   border tint so they catch the eye. "Last touched" is tracked
   via the existing dealLastActivity localStorage map populated
   by moveDeal / saveDealDetail.
   ============================================================ */
(function(){
  var STALE_DAYS = 14;
  function ms(){ return Date.now(); }
  function read(){ try { return JSON.parse(localStorage.getItem('gl_deal_activity')||'{}'); } catch(e){ return {}; } }

  function markStaleCards(){
    var kanban = document.getElementById('kanban') || document.querySelector('.kboard');
    if(!kanban) return;
    var activity = read();
    var staleMs = STALE_DAYS * 86400000;
    kanban.querySelectorAll('.kcard').forEach(function(card){
      // Already badged?
      if(card.querySelector('.gl-stale-badge')) return;
      // Determine the deal id from its onclick handler (openDealDetail('stage', idx))
      var onclick = card.getAttribute('onclick') || '';
      var m = onclick.match(/openDealDetail\('([^']+)',\s*(\d+)\)/);
      if(!m) return;
      var stage = m[1];
      if(stage === 'Closed Won' || stage === 'Closed Lost') return;  // don't mark closed
      var idx = parseInt(m[2],10);
      var deal = (window.deals && window.deals[stage]) ? window.deals[stage][idx] : null;
      if(!deal) return;
      var id = deal.id;
      var last = id && activity[id] ? activity[id] : null;
      if(!last) return;  // never touched = newly added, don't flag
      var age = ms() - new Date(last).getTime();
      if(age < staleMs) return;
      var days = Math.floor(age / 86400000);
      var badge = document.createElement('div');
      badge.className = 'gl-stale-badge';
      badge.setAttribute('style','position:absolute;top:6px;right:6px;padding:2px 7px;background:rgba(245,200,66,.16);border:1px solid rgba(245,200,66,.4);color:#f5c842;border-radius:10px;font-size:9px;font-weight:700;letter-spacing:.5px');
      badge.textContent = '⏰ ' + days + 'd';
      badge.title = 'Last touched ' + days + ' days ago';
      // Make sure the card is positioned so absolute child anchors
      if(getComputedStyle(card).position === 'static') card.style.position = 'relative';
      card.style.borderColor = 'rgba(245,200,66,.35)';
      card.appendChild(badge);
    });
  }

  function startObs(){
    var kanban = document.getElementById('kanban') || document.querySelector('.kboard');
    if(kanban){
      new MutationObserver(function(){ setTimeout(markStaleCards, 60); }).observe(kanban, {childList:true, subtree:true});
      markStaleCards();
    } else setTimeout(startObs, 700);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] Stale deal indicator loaded');
}());

/* ============================================================
   SYSTEM HEALTH WIDGET
   Admin-only dashboard widget that probes the key integrations
   (Supabase Auth, Mailgun key, AI key, audit_log table,
   client-docs storage bucket) and shows ✓/✗ with an action to
   fix any missing piece. Solves the "which setup steps did I
   forget to run" problem.
   ============================================================ */
(function(){
  var SURL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1';
  var SKEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE';

  async function checkAuth(){
    var sb = window.supa;
    if(!sb || !sb.auth) return { ok:false, msg:'Supabase client not loaded' };
    try {
      var r = await sb.auth.getSession();
      if(r && r.data && r.data.session) return { ok:true, msg:'Signed in as ' + r.data.session.user.email };
      return { ok:false, msg:'No active session' };
    } catch(e){ return { ok:false, msg:e.message||'auth check threw' }; }
  }
  async function checkAuditTable(){
    try {
      var r = await fetch(SURL + '/audit_log?select=count&limit=1', {
        headers: { apikey: SKEY, Authorization: 'Bearer ' + SKEY, 'Prefer':'count=exact' }
      });
      if(r.ok) return { ok:true, msg:'Table ready' };
      if(r.status === 404 || r.status === 400) return { ok:false, msg:'Run the audit_log SQL', action:'audit_sql' };
      return { ok:false, msg:'HTTP ' + r.status };
    } catch(e){ return { ok:false, msg:e.message||'check threw' }; }
  }
  async function checkStorageBucket(){
    var sb = window.supa;
    if(!sb || !sb.storage) return { ok:false, msg:'Storage client not loaded' };
    try {
      // List 1 file in the client-docs bucket to confirm it exists + RLS allows read.
      var r = await sb.storage.from('client-docs').list('', { limit: 1 });
      if(r && !r.error) return { ok:true, msg:'Bucket ready' };
      var m = (r.error && r.error.message) || '';
      if(m.toLowerCase().indexOf('not found') >= 0 || m.toLowerCase().indexOf('bucket') >= 0) {
        return { ok:false, msg:'Run the client-docs bucket SQL', action:'bucket_sql' };
      }
      return { ok:false, msg:m || 'Bucket check failed' };
    } catch(e){ return { ok:false, msg:e.message||'storage check threw' }; }
  }
  function checkMailgun(){
    // Mailgun key lives in Supabase secrets — the browser has no way
    // to inspect the secret directly, so we surface the status of the
    // Edge Function instead. Status panel is informational; the real
    // test is the "Test send" button in Mailgun Settings.
    return { ok:true, msg:'Managed via Supabase secrets' };
  }
  function checkAIKey(){
    var k = localStorage.getItem('gl_ai_key');
    if(k && k.length > 10) return { ok:true, msg:'Key set ('+ k.slice(0,8) +'…)' };
    return { ok:false, msg:'Optional — click to add your Anthropic key', action:'ai_settings', optional:true };
  }

  async function buildWidget(){
    var dash = document.getElementById('cpg-dashboard');
    if(!dash) return;
    if(!window.currentUser || window.currentUser.role !== 'admin') return;
    var existing = document.getElementById('gl-health-widget');
    if(existing) existing.remove();

    var w = document.createElement('div');
    w.id = 'gl-health-widget';
    w.setAttribute('style','background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:16px 20px;margin-top:18px');
    w.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
        '<div><div style="font-family:var(--ff-disp);font-size:13px;letter-spacing:2px;color:var(--white)">SYSTEM HEALTH</div><div style="font-size:10px;color:var(--muted);margin-top:1px">Admin only · auto-refresh on dashboard open</div></div>' +
        '<button id="gl-health-refresh" class="cbtn" style="font-size:10px;padding:4px 9px">🔄 Recheck</button>' +
      '</div>' +
      '<div id="gl-health-rows" style="display:flex;flex-direction:column;gap:6px">' +
        '<div style="font-size:12px;color:var(--muted)">Running checks…</div>' +
      '</div>';
    dash.appendChild(w);

    async function refresh(){
      var rows = w.querySelector('#gl-health-rows');
      rows.innerHTML = '<div style="font-size:12px;color:var(--muted)">Running checks…</div>';
      var checks = [
        { key:'auth',    label:'Supabase Auth',         run: checkAuth },
        { key:'mailgun', label:'Mailgun API key',       run: function(){ return Promise.resolve(checkMailgun()); } },
        { key:'ai',      label:'Anthropic AI key',      run: function(){ return Promise.resolve(checkAIKey()); } },
        { key:'audit',   label:'audit_log table',       run: checkAuditTable },
        { key:'storage', label:'client-docs bucket',    run: checkStorageBucket }
      ];
      var results = await Promise.all(checks.map(function(c){ return c.run().then(function(r){ return { c:c, r:r }; }); }));
      rows.innerHTML = results.map(function(x){
        var ok = !!x.r.ok;
        var optional = !!x.r.optional;
        var color = ok ? '#1D9E75' : (optional ? '#f5c842' : '#ff8579');
        var icon  = ok ? '✓' : (optional ? '○' : '✗');
        var actionHtml = '';
        if(!ok && x.r.action){
          var label = x.r.action === 'mailgun_settings' ? 'Open Mailgun Settings'
                    : x.r.action === 'ai_settings' ? 'Open AI Settings'
                    : x.r.action === 'audit_sql' ? 'Copy SQL'
                    : x.r.action === 'bucket_sql' ? 'Copy SQL'
                    : 'Fix';
          actionHtml = '<button class="gl-health-action" data-action="'+x.r.action+'" style="margin-left:8px;font-size:10px;padding:3px 8px;background:rgba(0,229,192,.08);border:1px solid rgba(0,229,192,.3);border-radius:6px;color:var(--teal);cursor:pointer;font-family:var(--ff-body)">'+label+'</button>';
        }
        return '<div style="display:flex;align-items:center;gap:10px;font-size:12px;color:#fff">' +
                 '<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:rgba(' + (ok?'29,158,117':optional?'245,200,66':'231,76,60') + ',.18);color:'+color+';font-weight:700;font-size:11px;flex-shrink:0">'+icon+'</span>' +
                 '<span style="font-weight:600;min-width:170px">'+x.c.label+'</span>' +
                 '<span style="color:var(--muted);font-size:11px">'+(x.r.msg||'')+'</span>' +
                 actionHtml +
               '</div>';
      }).join('');
      rows.querySelectorAll('.gl-health-action').forEach(function(b){
        b.addEventListener('click', function(){
          var a = b.getAttribute('data-action');
          if(a === 'mailgun_settings' && typeof window.openMailgunSettings === 'function') window.openMailgunSettings();
          else if(a === 'ai_settings' && typeof window.openAISettings === 'function') window.openAISettings();
          else if(a === 'audit_sql') showSqlModal('audit_log table', AUDIT_SQL);
          else if(a === 'bucket_sql') showSqlModal('client-docs storage bucket', BUCKET_SQL);
        });
      });
    }
    w.querySelector('#gl-health-refresh').addEventListener('click', refresh);
    refresh();
  }

  var AUDIT_SQL =
    "CREATE TABLE IF NOT EXISTS audit_log (\n" +
    "  id BIGSERIAL PRIMARY KEY,\n" +
    "  actor_id UUID REFERENCES auth.users ON DELETE SET NULL,\n" +
    "  actor_email TEXT,\n" +
    "  action TEXT NOT NULL,\n" +
    "  target TEXT,\n" +
    "  details JSONB,\n" +
    "  created_at TIMESTAMPTZ NOT NULL DEFAULT now()\n" +
    ");\n" +
    "ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;\n\n" +
    "DROP POLICY IF EXISTS \"Authenticated insert audit_log\" ON audit_log;\n" +
    "CREATE POLICY \"Authenticated insert audit_log\" ON audit_log\n" +
    "  FOR INSERT TO authenticated WITH CHECK (true);\n\n" +
    "DROP POLICY IF EXISTS \"Admins read audit_log\" ON audit_log;\n" +
    "CREATE POLICY \"Admins read audit_log\" ON audit_log\n" +
    "  FOR SELECT TO authenticated\n" +
    "  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');\n\n" +
    "CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log (created_at DESC);";

  var BUCKET_SQL =
    "INSERT INTO storage.buckets (id, name, public)\n" +
    "VALUES ('client-docs', 'client-docs', false)\n" +
    "ON CONFLICT (id) DO NOTHING;\n\n" +
    "DROP POLICY IF EXISTS \"Authenticated read client-docs\"   ON storage.objects;\n" +
    "CREATE POLICY \"Authenticated read client-docs\"   ON storage.objects\n" +
    "  FOR SELECT TO authenticated USING (bucket_id = 'client-docs');\n\n" +
    "DROP POLICY IF EXISTS \"Authenticated write client-docs\"  ON storage.objects;\n" +
    "CREATE POLICY \"Authenticated write client-docs\"  ON storage.objects\n" +
    "  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'client-docs');\n\n" +
    "DROP POLICY IF EXISTS \"Authenticated update client-docs\" ON storage.objects;\n" +
    "CREATE POLICY \"Authenticated update client-docs\" ON storage.objects\n" +
    "  FOR UPDATE TO authenticated USING (bucket_id = 'client-docs');\n\n" +
    "DROP POLICY IF EXISTS \"Authenticated delete client-docs\" ON storage.objects;\n" +
    "CREATE POLICY \"Authenticated delete client-docs\" ON storage.objects\n" +
    "  FOR DELETE TO authenticated USING (bucket_id = 'client-docs');";

  function showSqlModal(title, sql){
    var prior = document.getElementById('gl-sql-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var ov = document.createElement('div');
    ov.id = 'gl-sql-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:24px;width:100%;max-width:680px;max-height:85vh;display:flex;flex-direction:column">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">' +
          '<div><div style="font-family:var(--ff-disp);font-size:16px;letter-spacing:2px;color:var(--teal)">SETUP SQL — ' + title.toUpperCase() + '</div><div style="font-size:11px;color:var(--muted);margin-top:2px">Paste into Supabase SQL editor → Run</div></div>' +
          '<button id="gl-sql-close" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<textarea id="gl-sql-text" readonly style="flex:1;width:100%;background:#0a1628;color:#fff;border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:14px;font-family:var(--ff-mono);font-size:11px;line-height:1.5;resize:none;min-height:280px"></textarea>' +
        '<div style="display:flex;gap:8px;margin-top:12px">' +
          '<button id="gl-sql-copy" class="cbtn pri" style="flex:1">📋 Copy</button>' +
          '<a id="gl-sql-open" target="_blank" rel="noopener" href="https://supabase.com/dashboard/project/ufjkeqmxwuyhbqyugcgg/sql/new" class="cbtn" style="text-decoration:none;text-align:center">↗ Open SQL editor</a>' +
          '<button id="gl-sql-done" class="cbtn">Close</button>' +
        '</div>' +
      '</div>';
    ov.querySelector('#gl-sql-text').value = sql;
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-sql-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-sql-done').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-sql-copy').addEventListener('click', function(){
      navigator.clipboard.writeText(sql).then(function(){
        var b = ov.querySelector('#gl-sql-copy');
        var orig = b.textContent;
        b.textContent = '✓ Copied';
        setTimeout(function(){ b.textContent = orig; }, 1500);
      });
    });
    host.appendChild(ov);
  }

  // Build the widget once on dashboard render. Inject via observer on cpg-dashboard.
  function startObs(){
    var dash = document.getElementById('cpg-dashboard');
    if(dash){
      buildWidget();
      // Re-build when dashboard visibility flips (so it refreshes when re-shown)
      new MutationObserver(function(){ if(!document.getElementById('gl-health-widget')) setTimeout(buildWidget, 100); }).observe(dash, {childList:true, subtree:true});
    } else setTimeout(startObs, 700);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] System health widget loaded');
}());

/* ============================================================
   EMAIL SIGNATURE
   Per-device localStorage signature (gl_email_signature) that
   gets auto-appended to outgoing follow-up emails before send.
   Configurable via a new entry in the AI toolbar.
   ============================================================ */
(function(){
  function defaultSig(){
    var u = window.currentUser;
    var name = (u && u.name) || 'Mike Krail';
    return name + '\nGood Liquid Bev Co\nMike@GoodLiquid.com · (803) 493-5065\nhttps://www.goodliquidbevco.com';
  }
  window.glGetSignature = function(){
    var s = localStorage.getItem('gl_email_signature');
    if(s !== null) return s;  // even "" is a valid explicit setting
    return '';
  };
  window.glSetSignature = function(sig){
    if(sig === null || sig === undefined) localStorage.removeItem('gl_email_signature');
    else localStorage.setItem('gl_email_signature', sig);
  };

  window.openEmailSignatureSettings = function(){
    var prior = document.getElementById('gl-sig-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var current = window.glGetSignature();
    var ov = document.createElement('div');
    ov.id = 'gl-sig-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:24px;width:100%;max-width:540px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">✍️ EMAIL SIGNATURE</div>' +
          '<button id="gl-sig-close" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6">Appended to outgoing follow-up emails after the body. Stored in this browser only — Sandra needs to set hers separately on her device.</div>' +
        '<textarea id="gl-sig-text" rows="8" style="width:100%;padding:13px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-family:var(--ff-mono);font-size:12px;line-height:1.6;resize:vertical;box-sizing:border-box">' + (current || defaultSig()).replace(/&/g,'&amp;').replace(/</g,'&lt;') + '</textarea>' +
        '<div style="display:flex;gap:8px;margin-top:14px">' +
          '<button id="gl-sig-save" class="cbtn pri" style="flex:1">💾 Save signature</button>' +
          '<button id="gl-sig-default" class="cbtn">Restore default</button>' +
          '<button id="gl-sig-clear" class="cbtn red">Clear</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-sig-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-sig-save').addEventListener('click', function(){
      var v = ov.querySelector('#gl-sig-text').value;
      window.glSetSignature(v);
      if(typeof addNotification === 'function') addNotification('Signature saved','Will be appended to outgoing follow-ups.','success');
      ov.remove();
    });
    ov.querySelector('#gl-sig-default').addEventListener('click', function(){
      ov.querySelector('#gl-sig-text').value = defaultSig();
    });
    ov.querySelector('#gl-sig-clear').addEventListener('click', function(){
      if(!confirm('Clear the saved signature?')) return;
      window.glSetSignature('');
      ov.querySelector('#gl-sig-text').value = '';
    });
    host.appendChild(ov);
  };

  // Wrap sendFollowupEmail so signature is appended if not already present.
  (function(){
    var orig = window.sendFollowupEmail;
    if(typeof orig !== 'function') return;
    window.sendFollowupEmail = async function(){
      var sig = window.glGetSignature();
      var body = document.getElementById('fu-body');
      if(sig && body && body.value && body.value.indexOf(sig.split('\n')[0]) === -1){
        body.value = body.value.replace(/\s*$/, '') + '\n\n' + sig;
      }
      return orig.apply(this, arguments);
    };
  })();
}());

/* ============================================================
   GLOBAL SEARCH (Ctrl+K / Cmd+K)
   Cross-entity quick switcher: invoices, clients, deals,
   referrers, users. Keyboard-driven. Opens with a hotkey,
   search-as-you-type, Enter to jump.
   ============================================================ */
(function(){
  function esc(s){ return String(s||'').replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function open(){
    if(document.getElementById('gl-search-modal')) return;  // already open
    if(!document.getElementById('crm-panel') || !document.getElementById('crm-panel').classList.contains('show')) return;  // CRM not open
    var host = document.getElementById('crm-panel');
    var ov = document.createElement('div');
    ov.id = 'gl-search-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;padding:80px 20px 20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.25);border-radius:12px;width:100%;max-width:600px;max-height:70vh;display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden">' +
        '<div style="display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06)">' +
          '<span style="font-size:16px;color:var(--teal)">🔍</span>' +
          '<input id="gl-search-input" type="text" placeholder="Search invoices, clients, deals, referrers, users…" style="flex:1;background:none;border:none;outline:none;color:#fff;font-size:14px;font-family:var(--ff-body)" autofocus>' +
          '<kbd style="font-size:10px;color:var(--muted);background:rgba(255,255,255,.06);padding:2px 6px;border-radius:4px;border:1px solid rgba(255,255,255,.1)">Esc</kbd>' +
        '</div>' +
        '<div id="gl-search-results" style="flex:1;overflow-y:auto;padding:6px 0">' +
          '<div style="padding:30px;text-align:center;color:var(--muted);font-size:12px">Start typing to search.</div>' +
        '</div>' +
        '<div style="padding:8px 18px;border-top:1px solid rgba(255,255,255,.06);font-size:10px;color:var(--muted);display:flex;justify-content:space-between">' +
          '<span><kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:3px">↑↓</kbd> navigate · <kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:3px">⏎</kbd> open</span>' +
          '<span><kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:3px">Ctrl+K</kbd> toggle</span>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    host.appendChild(ov);
    var input = ov.querySelector('#gl-search-input');
    var results = ov.querySelector('#gl-search-results');
    var selectedIdx = 0;
    var lastItems = [];

    function navigate(item){
      if(!item) return;
      ov.remove();
      try {
        if(item.kind === 'invoice'){
          if(typeof window.cNav === 'function') window.cNav('invoices', document.querySelectorAll('.cni')[4] || null);
          setTimeout(function(){ if(typeof window.viewInvoice === 'function') window.viewInvoice(item.id); }, 80);
        } else if(item.kind === 'client'){
          if(typeof window.cNav === 'function') window.cNav('clients', null);
          setTimeout(function(){ if(typeof window.openClientDetail === 'function') window.openClientDetail(item.id); }, 80);
        } else if(item.kind === 'deal'){
          if(typeof window.cNav === 'function') window.cNav('pipeline', null);
          setTimeout(function(){ if(typeof window.openDealDetail === 'function') window.openDealDetail(item.stage, item.idx); }, 80);
        } else if(item.kind === 'referrer'){
          if(typeof window.cNav === 'function') window.cNav('referrers', null);
        } else if(item.kind === 'user'){
          if(typeof window.cNav === 'function') window.cNav('users', null);
        }
      } catch(e){ console.error('[GL search] navigate threw', e); }
    }

    function render(){
      var q = (input.value||'').trim().toLowerCase();
      if(!q){ results.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-size:12px">Start typing to search.</div>'; lastItems = []; return; }
      var items = [];
      (window.invoices||[]).forEach(function(i){
        var hay = ((i.id||'') + ' ' + (i.clientName||'') + ' ' + (i.svc||'')).toLowerCase();
        if(hay.indexOf(q) >= 0) items.push({ kind:'invoice', id:i.id, title:i.id, subtitle:(i.clientName||'')+' · $'+Number(i.amount||0).toLocaleString()+' · '+(i.status||''), icon:'🧾' });
      });
      (window.clients||[]).forEach(function(c){
        var hay = ((c.name||'') + ' ' + (c.contact||'') + ' ' + (c.email||'')).toLowerCase();
        if(hay.indexOf(q) >= 0) items.push({ kind:'client', id:c.id, title:c.name||'(unnamed)', subtitle:(c.email||'')+' · '+(c.service||''), icon:'👥' });
      });
      var stages = window.deals ? Object.keys(window.deals) : [];
      stages.forEach(function(s){
        (window.deals[s]||[]).forEach(function(d, idx){
          var hay = ((d.name||'') + ' ' + (d.co||'')).toLowerCase();
          if(hay.indexOf(q) >= 0) items.push({ kind:'deal', stage:s, idx:idx, title:d.name||'(unnamed deal)', subtitle:(d.co||'')+' · '+s+' · '+(d.val||''), icon:'📊' });
        });
      });
      (window.referrers||[]).forEach(function(r){
        var hay = ((r.name||'') + ' ' + (r.email||'')).toLowerCase();
        if(hay.indexOf(q) >= 0) items.push({ kind:'referrer', id:r.id, title:r.name||'(unnamed)', subtitle:(r.rel||'referrer')+' · '+(r.email||''), icon:'🤝' });
      });
      (window.users||[]).forEach(function(u){
        var hay = ((u.name||'') + ' ' + (u.email||'')).toLowerCase();
        if(hay.indexOf(q) >= 0) items.push({ kind:'user', id:u.id, title:u.name||'(unnamed)', subtitle:(u.email||'')+' · '+(u.role||''), icon:'🔑' });
      });
      lastItems = items.slice(0, 40);
      if(selectedIdx >= lastItems.length) selectedIdx = 0;
      if(!lastItems.length){
        results.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-size:12px">No matches for "'+esc(q)+'"</div>';
        return;
      }
      results.innerHTML = lastItems.map(function(it, i){
        var selected = i === selectedIdx;
        return '<div data-i="'+i+'" class="gl-sr-row" style="display:flex;align-items:center;gap:12px;padding:10px 18px;cursor:pointer;border-left:3px solid '+(selected?'var(--teal)':'transparent')+';background:'+(selected?'rgba(0,229,192,.06)':'transparent')+'">' +
          '<span style="font-size:18px">'+it.icon+'</span>' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:13px;color:#fff;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(it.title)+'</div>' +
            '<div style="font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(it.subtitle)+'</div>' +
          '</div>' +
          '<span style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:1px">'+it.kind+'</span>' +
        '</div>';
      }).join('');
      results.querySelectorAll('.gl-sr-row').forEach(function(r){
        r.addEventListener('click', function(){ navigate(lastItems[parseInt(r.getAttribute('data-i'),10)]); });
        r.addEventListener('mouseenter', function(){ selectedIdx = parseInt(r.getAttribute('data-i'),10); render(); });
      });
      // Scroll selected into view if off-screen
      var selectedEl = results.querySelector('.gl-sr-row[data-i="'+selectedIdx+'"]');
      if(selectedEl) selectedEl.scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', function(){ selectedIdx = 0; render(); });
    input.addEventListener('keydown', function(e){
      if(e.key === 'Escape'){ ov.remove(); }
      else if(e.key === 'ArrowDown'){ e.preventDefault(); if(selectedIdx < lastItems.length-1) selectedIdx++; render(); }
      else if(e.key === 'ArrowUp'){ e.preventDefault(); if(selectedIdx > 0) selectedIdx--; render(); }
      else if(e.key === 'Enter'){ e.preventDefault(); navigate(lastItems[selectedIdx]); }
    });
    setTimeout(function(){ input.focus(); }, 30);
  }

  window.glOpenGlobalSearch = open;

  document.addEventListener('keydown', function(e){
    if((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')){
      // Don't trigger if user is typing in an input/textarea unless it's already in search
      var t = e.target;
      var isInput = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      var inSearch = t && t.id === 'gl-search-input';
      if(isInput && !inSearch) return;  // let real fields handle Ctrl+K (rare)
      e.preventDefault();
      if(document.getElementById('gl-search-modal')) document.getElementById('gl-search-modal').remove();
      else open();
    }
  });

  console.log('[GL] Global search (Ctrl+K) loaded');
}());

/* ============================================================
   DASHBOARD KPI EXPANSION
   Second metrics row under the existing collected/pending/overdue/
   active-brands cards. Shows:
     - Avg invoice value (across all non-quote invoices)
     - Outstanding (pending + overdue total)
     - Avg days to paid (from invoice date to status flip)
     - Quotes pending (status='quote' count + total $)
   Updates whenever renderDash runs.
   ============================================================ */
(function(){
  function fmtUsd(n){ return '$' + Math.round(n||0).toLocaleString(); }
  function fmtUsdShort(n){
    n = Number(n||0);
    if(n >= 1_000_000) return '$' + (n/1_000_000).toFixed(1) + 'M';
    if(n >= 1_000)     return '$' + Math.round(n/1_000) + 'K';
    return '$' + Math.round(n);
  }
  function avg(a){ if(!a.length) return 0; return a.reduce(function(s,x){return s+x;},0) / a.length; }

  function buildExtraKpis(){
    var dash = document.getElementById('cpg-dashboard');
    if(!dash) return;
    var metrics = document.getElementById('dash-metrics');
    if(!metrics) return;
    var existing = document.getElementById('gl-extra-kpis');
    if(existing) existing.remove();

    var inv = (window.invoices||[]);
    // Use effective status so a pending invoice past its due_date counts
    // as overdue here too (matches the dashboard tallies).
    var eff = function(i){ return (typeof window.effectiveInvoiceStatus === 'function') ? window.effectiveInvoiceStatus(i) : (i && i.status); };
    var billable = inv.filter(function(i){ return i.status !== 'quote'; });
    var paid = inv.filter(function(i){ return eff(i) === 'paid'; });
    var pending = inv.filter(function(i){ return eff(i) === 'pending'; });
    var overdue = inv.filter(function(i){ return eff(i) === 'overdue'; });
    var quotes = inv.filter(function(i){ return i.status === 'quote'; });

    var avgVal = avg(billable.map(function(i){ return Number(i.amount||0); }));
    var outstanding = pending.concat(overdue).reduce(function(s,i){ return s + Number(i.amount||0); }, 0);
    var quotesTotal = quotes.reduce(function(s,i){ return s + Number(i.amount||0); }, 0);

    // Days-to-paid: approximate using created_at -> updated_at when available
    // (Supabase rows have both; freshly loaded ones may not). Fall back to "—"
    // when we don't have the data.
    var daysToPaid = paid.map(function(i){
      if(i.date && i.updatedAt){
        var d1 = new Date(i.date).getTime();
        var d2 = new Date(i.updatedAt).getTime();
        if(!isNaN(d1) && !isNaN(d2) && d2 > d1) return (d2 - d1) / 86400000;
      }
      return null;
    }).filter(function(d){ return d != null; });
    var avgDays = daysToPaid.length ? Math.round(avg(daysToPaid)) : null;

    var row = document.createElement('div');
    row.id = 'gl-extra-kpis';
    row.setAttribute('style','display:grid;grid-template-columns:repeat(4,1fr);gap:11px;margin-top:11px');
    row.innerHTML =
      kpiCard('Avg invoice', fmtUsdShort(avgVal), billable.length ? billable.length + ' billable' : 'no invoices yet') +
      kpiCard('Outstanding', fmtUsdShort(outstanding), (pending.length + overdue.length) + ' open', outstanding > 0 ? '#f5c842' : '') +
      kpiCard('Avg days to paid', avgDays != null ? avgDays + 'd' : '—', paid.length ? paid.length + ' paid' : 'no payments yet') +
      kpiCard('Quotes pending', quotes.length || 0, quotes.length ? fmtUsdShort(quotesTotal) + ' potential' : 'none open', '#6b9fff');

    metrics.parentNode.insertBefore(row, metrics.nextSibling);

    // Tighten mobile: collapse to 2 cols if narrow
    if(window.matchMedia && window.matchMedia('(max-width: 768px)').matches){
      row.style.gridTemplateColumns = 'repeat(2,1fr)';
    }
  }
  function kpiCard(label, value, sub, color){
    color = color || 'var(--teal)';
    // Empty-state values (— em-dash, "0", null-rendered "—") should render
    // in the muted color so they read as "no data" instead of looking like
    // a colored progress bar (caught on the dashboard "AVG DAYS TO PAID"
    // tile during the Playwright runtime audit — the teal em-dash at 24px
    // looked exactly like a progress indicator).
    var v = String(value == null ? '—' : value);
    var isEmpty = v === '—' || v === 'n/a' || v === '0' || v === '0d';
    var valColor = isEmpty ? 'var(--muted)' : color;
    return '<div style="background:#243a56;border:1px solid rgba(255,255,255,.06);border-radius:11px;padding:14px 16px">' +
      '<div style="font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:6px">' + label.toUpperCase() + '</div>' +
      '<div style="font-family:var(--ff-disp);font-size:24px;font-weight:700;color:' + valColor + ';line-height:1">' + v + '</div>' +
      '<div style="font-size:10px;color:var(--muted);margin-top:4px">' + sub + '</div>' +
    '</div>';
  }

  // Re-build whenever renderDash runs, so KPIs stay in sync with the data.
  window.GL_HOOKS.registerDashPatch(function(){ try{ buildExtraKpis(); }catch(e){ console.error('[GL kpi] build threw', e); } });

  console.log('[GL] Dashboard extra KPIs loaded');
}());


/* ============================================================
   INVOICE TOOLS: CSV export + bulk overdue reminders
   - "📊 Export CSV" in the invoice list header. Downloads
     the currently-filtered invoice set as CSV (handy for
     QuickBooks / accountant handoff).
   - "📧 Send overdue reminders" in the same header. Iterates
     all status='overdue' invoices and fires a follow-up email
     to each client via Mailgun. Skips invoices without a
     client email; reports count at the end.
   ============================================================ */
(function(){
  function csvEsc(s){
    s = String(s == null ? '' : s);
    if(/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  function buildCsv(rows){
    var headers = ['Invoice #','Client','Service','Amount','Status','Date','Due','Notes'];
    var out = headers.map(csvEsc).join(',') + '\n';
    rows.forEach(function(i){
      var dueDate = '';
      if(i.date){
        try { dueDate = new Date(new Date(i.date).getTime() + 30*86400000).toISOString().slice(0,10); }
        catch(e){ dueDate = ''; }
      }
      out += [
        i.id, i.clientName, i.svc, i.amount, i.status, i.date, dueDate, i.notes||''
      ].map(csvEsc).join(',') + '\n';
    });
    return out;
  }
  function downloadFile(name, content, type){
    var blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
  }

  window.glExportInvoicesCsv = function(){
    var inv = (window.invoices||[]).filter(function(i){ return i.status !== 'quote'; });
    if(!inv.length){ alert('No invoices to export.'); return; }
    var stamp = new Date().toISOString().slice(0,10);
    downloadFile('goodliquid-invoices-' + stamp + '.csv', buildCsv(inv), 'text/csv;charset=utf-8');
    if(typeof addNotification === 'function') addNotification('📊 CSV exported', inv.length + ' rows downloaded', 'success');
    if(typeof window.glAudit === 'function') window.glAudit('export_csv', 'invoices', { rows: inv.length });
  };

  window.glSendOverdueReminders = async function(){
    // Effective status — past-due pending invoices also get reminders.
    var eff = function(i){ return (typeof window.effectiveInvoiceStatus === 'function') ? window.effectiveInvoiceStatus(i) : (i && i.status); };
    var overdue = (window.invoices||[]).filter(function(i){ return eff(i) === 'overdue'; });
    if(!overdue.length){ alert('No overdue invoices.'); return; }
    // Mailgun lives server-side in the mailgun-send Edge Function — the
    // send itself returns a clear error if the secret isn't set, so no
    // need to gate on a stale localStorage flag here.
    if(!confirm('Send a reminder email to ' + overdue.length + ' overdue invoice client(s)?\n\nEach email will include the invoice id, amount, days overdue, and your Stripe pay link (if set).')) return;

    var sent = 0, skipped = 0, failed = 0;
    for(var k = 0; k < overdue.length; k++){
      var inv = overdue[k];
      var client = (window.clients||[]).find(function(c){ return c.id === inv.client; });
      var to = (client && client.email) || inv.clientEmail || '';
      if(!to || to.indexOf('@') < 0){ skipped++; continue; }
      var days = '';
      try { var d = (Date.now() - new Date(inv.date).getTime()) / 86400000; days = Math.floor(d) + ' days'; } catch(e){ days = ''; }
      var payLink = typeof window.glGetPayLink === 'function' ? window.glGetPayLink(inv.id) : '';
      var sig = typeof window.glGetSignature === 'function' ? window.glGetSignature() : '';
      var body =
        'Hi ' + (inv.clientName || 'there') + ',\n\n' +
        'This is a friendly reminder that invoice ' + inv.id + ' for $' + Number(inv.amount||0).toLocaleString() +
        (days ? ' is ' + days + ' overdue.' : ' is past due.') + '\n\n' +
        'Please let us know if you have any questions or if there is anything blocking payment.\n\n' +
        (payLink ? 'Pay securely: ' + payLink + '\n\n' : '') +
        (sig ? sig : 'Best,\nMike Krail\nGood Liquid Bev Co\nMike@GoodLiquid.com · (803) 493-5065');
      var subject = 'Payment reminder — Invoice ' + inv.id;
      try {
        var ok = await window.sendMailgunEmail(to, subject, body);
        if(ok) sent++; else failed++;
      } catch(e){ failed++; }
    }
    var msg = '✓ Sent ' + sent + ' reminder(s).' +
              (skipped ? '\n⊘ Skipped ' + skipped + ' (no client email on file).' : '') +
              (failed  ? '\n✗ Failed ' + failed + ' (check console).' : '');
    if(typeof addNotification === 'function') addNotification('Overdue reminders', sent + ' sent / ' + (skipped+failed) + ' skipped', sent ? 'success' : 'warning');
    if(typeof window.glAudit === 'function') window.glAudit('overdue_reminders', null, { sent: sent, skipped: skipped, failed: failed });
    alert(msg);
  };

  // Inject the two buttons into the invoices page header.
  function inject(){
    var page = document.getElementById('cpg-invoices');
    if(!page) return;
    var header = page.querySelector('.cph');
    if(!header) return;
    if(header.querySelector('.gl-csv-btn')) return;
    var newBtn = Array.from(header.querySelectorAll('button')).find(function(b){
      return (b.textContent||'').trim().toLowerCase().includes('new invoice');
    });
    var csv = document.createElement('button');
    csv.className = 'cbtn gl-csv-btn';
    csv.setAttribute('style','margin-left:8px;background:rgba(0,229,192,.08);border:1px solid rgba(0,229,192,.3);color:var(--teal)');
    csv.textContent = '📊 Export CSV';
    csv.addEventListener('click', function(){ window.glExportInvoicesCsv(); });
    // Activity button — shows all email_log entries across every invoice
    var act = document.createElement('button');
    act.className = 'cbtn gl-activity-btn';
    act.setAttribute('style','margin-left:8px;background:rgba(26,111,255,.10);border:1px solid rgba(26,111,255,.30);color:#6b9fff');
    act.textContent = '📊 Activity';
    act.addEventListener('click', function(){
      if(typeof window.glOpenEmailActivity === 'function') window.glOpenEmailActivity();
      else alert('Email Activity not loaded yet.');
    });
    var rem = document.createElement('button');
    rem.className = 'cbtn gl-overdue-btn';
    rem.setAttribute('style','margin-left:8px;background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.3);color:#f5c842');
    rem.textContent = '📧 Send overdue reminders';
    rem.addEventListener('click', function(){ window.glSendOverdueReminders(); });
    if(newBtn && newBtn.parentElement){
      newBtn.parentElement.appendChild(csv);
      newBtn.parentElement.appendChild(act);
      newBtn.parentElement.appendChild(rem);
    } else {
      header.appendChild(csv);
      header.appendChild(act);
      header.appendChild(rem);
    }
  }
  function startObs(){
    var page = document.getElementById('cpg-invoices');
    if(page){
      new MutationObserver(function(){ setTimeout(inject, 50); }).observe(page, {childList:true, subtree:true});
      inject();
    } else setTimeout(startObs, 500);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] Invoice CSV export + overdue reminders loaded');
}());

/* ============================================================
   CRM TOPBAR: Ctrl+K hint badge
   Small "🔍 Search ⌘K" pill in the CRM topbar, left of the
   brand logo. Click also opens the search modal.
   ============================================================ */
(function(){
  function injectHint(){
    var brand = document.querySelector('#crm-top .crm-brand');
    if(!brand || !brand.parentElement) return;
    if(brand.parentElement.querySelector('.gl-kbd-hint')) return;
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
    var btn = document.createElement('button');
    btn.className = 'gl-kbd-hint';
    btn.title = 'Quick search across invoices, clients, deals, referrers, users';
    btn.setAttribute('style',
      'display:flex;align-items:center;gap:6px;padding:5px 10px 5px 8px;' +
      'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);' +
      'border-radius:7px;color:var(--muted);font-size:11px;cursor:pointer;' +
      'font-family:var(--ff-body);transition:all .15s'
    );
    btn.innerHTML =
      '<span style="color:#9aa7bd">🔍</span>' +
      '<span>Search</span>' +
      '<kbd style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);' +
      'border-radius:4px;padding:1px 5px;font-size:10px;color:var(--muted);font-family:var(--ff-mono)">' +
      (isMac ? '⌘K' : 'Ctrl+K') + '</kbd>';
    btn.addEventListener('mouseenter', function(){
      btn.style.background = 'rgba(0,229,192,.08)';
      btn.style.borderColor = 'rgba(0,229,192,.25)';
      btn.style.color = 'var(--teal)';
    });
    btn.addEventListener('mouseleave', function(){
      btn.style.background = 'rgba(255,255,255,.04)';
      btn.style.borderColor = 'rgba(255,255,255,.08)';
      btn.style.color = 'var(--muted)';
    });
    btn.addEventListener('click', function(){
      if(typeof window.glOpenGlobalSearch === 'function') window.glOpenGlobalSearch();
    });
    // Insert immediately before the brand element (i.e. to its left)
    brand.parentElement.insertBefore(btn, brand);
  }

  function startObs(){
    var top = document.getElementById('crm-top');
    if(top){
      new MutationObserver(function(){ setTimeout(injectHint, 50); }).observe(top, {childList:true, subtree:true});
      injectHint();
    } else setTimeout(startObs, 500);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] Topbar Ctrl+K hint loaded');
}());

/* ============================================================
   "REMEMBER THIS COMPUTER" CHECKBOX
   - Adds a checkbox to the password modal (default: checked)
   - When checked + login succeeds: persists gl_remember='1'.
     Next time the Admin button is clicked, we look for a live
     Supabase Auth session and skip the password modal entirely.
   - When unchecked: stores gl_remember='0' and registers a
     beforeunload handler that signs the user out when the
     tab/browser closes.
   ============================================================ */
(function(){
  function injectCheckbox(){
    var pw = document.getElementById('pw-ov');
    if(!pw) return;
    if(pw.querySelector('#gl-remember-cb')) return;
    var btn = pw.querySelector('.pw-btn');
    if(!btn) return;
    var saved = localStorage.getItem('gl_remember');
    // Default to true so the box is checked when the user first sees it.
    var checked = (saved === null) || (saved === '1');
    var label = document.createElement('label');
    label.setAttribute('style',
      'display:flex;align-items:center;gap:9px;font-size:12px;color:var(--muted);' +
      'margin:6px 2px 14px;cursor:pointer;user-select:none;text-align:left'
    );
    label.innerHTML =
      '<input type="checkbox" id="gl-remember-cb"' + (checked ? ' checked' : '') +
        ' style="width:14px;height:14px;accent-color:var(--teal);cursor:pointer;margin:0;flex-shrink:0">' +
      '<span>Stay signed in on this computer<br>' +
        '<span style="font-size:10px;color:var(--muted);opacity:.7">Survives closing the browser. Clicking <b>Sign out</b> still ends the session.</span>' +
      '</span>';
    btn.parentNode.insertBefore(label, btn);

    // Pre-fill the email field from the last successful login (always — independent
    // of Remember Me). Saves typing even after an explicit sign-out.
    var emailEl = document.getElementById('pw-email');
    if(emailEl && !emailEl.value){
      var last = localStorage.getItem('gl_last_email');
      if(last) {
        emailEl.value = last;
        // Move focus to the password field if email is already known.
        setTimeout(function(){
          var pwEl = document.getElementById('pw-input');
          if(pwEl) pwEl.focus();
        }, 30);
      }
    }
  }

  // Wrap checkPw so we save the preference after a successful login.
  (function(){
    var orig = window.checkPw;
    if(typeof orig !== 'function') return;
    window.checkPw = async function(){
      var before = window.currentUser;
      var result = await orig.apply(this, arguments);
      var loggedIn = window.currentUser && window.currentUser !== before;
      if(loggedIn){
        var cb = document.getElementById('gl-remember-cb');
        var remember = cb ? cb.checked : true;
        localStorage.setItem('gl_remember', remember ? '1' : '0');
        // Always remember the email so they don't retype it next time.
        if(window.currentUser && window.currentUser.email){
          localStorage.setItem('gl_last_email', window.currentUser.email);
        }
      }
      return result;
    };
  })();

  // Sign out on browser close when remember is false.
  window.addEventListener('beforeunload', function(){
    if(localStorage.getItem('gl_remember') === '0' && window.supa && window.supa.auth){
      try { window.supa.auth.signOut({ scope: 'local' }); } catch(e){}
    }
  });

  // Wrap openAdmin so that if a session is already cached AND the user opted
  // to be remembered, we skip the password modal and go straight to the CRM.
  function autoLoginIfPossible(){
    return (async function(){
      if(localStorage.getItem('gl_remember') !== '1') return false;
      var sb = window.supa;
      if(!sb || !sb.auth) return false;
      try {
        var r = await sb.auth.getSession();
        if(!r || !r.data || !r.data.session) return false;
        var user = r.data.session.user;
        var prof = null;
        try {
          var p = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
          prof = p.data || null;
        } catch(e){}
        var profile = {
          id: user.id, email: user.email,
          name: (prof && prof.name) || (user.email||'').split('@')[0],
          role: (prof && prof.role) || 'sales',
          status: (prof && prof.status) || 'active',
          initials: (prof && prof.initials) || (user.email||'?').slice(0,2).toUpperCase(),
          color: (prof && prof.color) || '#1a6fff',
          tc: (prof && prof.tc) || '#fff',
          lastLogin: 'Just now'
        };
        if(profile.status === 'inactive'){
          try { await sb.auth.signOut(); } catch(e){}
          return false;
        }
        if(typeof window.loginUser === 'function') window.loginUser(profile);
        return true;
      } catch(e){
        console.warn('[GL remember] auto-login attempt threw', e);
        return false;
      }
    })();
  }

  (function(){
    var orig = window.openAdmin;
    if(typeof orig !== 'function') return;
    window.openAdmin = async function(){
      var ok = await autoLoginIfPossible();
      if(ok) return;  // skipped the modal
      orig.apply(this, arguments);
      setTimeout(injectCheckbox, 30);
    };
  })();

  // Also inject when the password modal opens via any other path (the
  // "Forgot password" → back-to-login flow re-shows pw-ov directly).
  function startObs(){
    var pw = document.getElementById('pw-ov');
    if(pw){
      new MutationObserver(function(){ if(pw.classList.contains('show')) setTimeout(injectCheckbox, 40); }).observe(pw, {attributes:true, attributeFilter:['class']});
      if(pw.classList.contains('show')) injectCheckbox();
    } else setTimeout(startObs, 500);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] Remember-this-computer login persistence loaded');
}());









