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

  /* ── CORE USERS (profile only; passwords live in Supabase crm_users) ── */
  var coreUsers = [
    {id:'u1',name:'Mike Krail',email:'mike@goodliquid.com',role:'admin',status:'active',initials:'MK',color:'#f5c842',tc:'#0a1628',lastLogin:'Never'},
    {id:'u2',name:'Sandra Krail',email:'sandra@goodliquid.com',role:'sales',status:'active',initials:'SK',color:'#1a6fff',tc:'#fff',lastLogin:'Never'}
  ];
  if(!window.users||window.users.length===0){window.users=coreUsers;}
  else{coreUsers.forEach(function(cu){var ex=window.users.find(function(u){return u.email===cu.email;});if(ex)ex.role=cu.role;else window.users.unshift(cu);});}

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
  var ALL=['dashboard','clients','pipeline','invoices','invoice-detail','newinv','referrals','referrers','activity','users','customers','calendar','production-cal','tasks','documents','inventory','announcements','time-tracker','reports','ai-settings'];
  if(window.PERMISSIONS){window.PERMISSIONS.admin=ALL;window.PERMISSIONS.sales=['dashboard','clients','pipeline','invoices','newinv','referrals','referrers','activity','calendar','production-cal','tasks','announcements','reports'];}
  else{window.PERMISSIONS={admin:ALL,sales:['dashboard','clients','pipeline','invoices','newinv','referrals','referrers','activity','calendar','production-cal','tasks','announcements','reports'],viewer:['dashboard','clients','invoices','activity']};}
  window.can=function(page){var u=window.currentUser;if(!u)return false;if(u.role==='admin')return true;return(window.PERMISSIONS[u.role]||[]).includes(page);};
  var _cNavOrig2=window.cNav;
  window.cNav=function(page,el){if(!window.can(page)){if(typeof addNotification==='function')addNotification('Access denied',page,'warning');return;}if(typeof _cNavOrig2==='function')_cNavOrig2(page,el);};

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

  /* ── Supabase Auth (bcrypt passwords managed by Supabase) ── */
  var _glSupa=null;
  function getSupa(){
    if(_glSupa)return _glSupa;
    if(window.supa){_glSupa=window.supa;return _glSupa;}
    if(window.supabase&&typeof window.supabase.createClient==='function'){
      try{
        _glSupa=window.supabase.createClient(
          'https://ufjkeqmxwuyhbqyugcgg.supabase.co',
          'sb_publishable_-37mkPw8uLzEJM21T9jJOA_YQRQ7ikB'
        );
        return _glSupa;
      }catch(e){console.error('[GL] supabase init failed',e);}
    }
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
    if(!sb){showErr('Auth service unavailable.');return;}
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

  /* ── syncPasswordToSupabase — current user changes their own password via Auth ── */
  window.syncPasswordToSupabase=async function(emailOrPw,maybePw){
    var newPw=typeof maybePw==='string'?maybePw:emailOrPw;
    var sb=getSupa();if(!sb)return false;
    try{
      var r=await sb.auth.updateUser({password:newPw});
      if(r.error){console.error('[GL] updateUser error',r.error);return false;}
      console.log('[GL] Password updated for current Supabase Auth user');
      return true;
    }catch(e){console.error('[GL] updateUser threw',e);return false;}
  };

  /* ── glSignOut — clear Supabase session and close CRM ── */
  window.glSignOut=async function(){
    var sb=getSupa();
    if(sb){try{await sb.auth.signOut();}catch(e){}}
    window.currentUser=null;
    if(typeof window.exitCRM==='function')window.exitCRM();
  };

  /* ══════════════════════════════════════════════
     ADMIN USER MANAGEMENT (Supabase Auth-backed)
     Overrides the legacy local-only flows so user
     invites, password resets, and removals go
     through Supabase Auth + profiles table.
  ══════════════════════════════════════════════ */

  /* ── createInvitedUser — admin creates a new CRM user via Supabase signUp ── */
  window.createInvitedUser=async function(){
    var nameEl=document.getElementById('inv-name');
    var emailEl=document.getElementById('inv-email');
    var pwEl=document.getElementById('inv-password');
    var roleEl=document.getElementById('inv-role');
    var err=document.getElementById('inv-err');
    var ok=document.getElementById('inv-ok');
    if(!nameEl||!emailEl||!pwEl||!roleEl)return;
    if(err)err.style.display='none';
    if(ok)ok.style.display='none';
    var name=nameEl.value.trim();
    var email=emailEl.value.trim().toLowerCase();
    var password=pwEl.value;
    var role=roleEl.value;
    function setErr(m){if(err){err.textContent=m;err.style.display='block';}}
    if(!name){setErr('Name is required');return;}
    if(!email||email.indexOf('@')<0){setErr('Valid email is required');return;}
    if(password.length<8){setErr('Password must be at least 8 characters');return;}
    if((window.users||[]).find(function(u){return u.email.toLowerCase()===email;})){setErr('A user with that email already exists');return;}

    var sb=getSupa();
    if(!sb){setErr('Auth service unavailable.');return;}

    var initials=name.split(' ').map(function(p){return p[0];}).join('').toUpperCase().substring(0,2);
    var palettes=[['#1a3a6e','#9FE1CB'],['#0F6E56','#E1F5EE'],['#854F0B','#FAEEDA'],['#3C3489','#EEEDFE'],['#712B13','#FAECE7']];
    var pal=palettes[(window.users||[]).length%palettes.length];

    try{
      var r=await sb.auth.signUp({email:email,password:password,options:{data:{name:name,role:role,initials:initials,color:pal[0],tc:pal[1]}}});
      if(r.error){setErr(r.error.message||'Sign-up failed');return;}
      var newId=(r.data&&r.data.user)?r.data.user.id:null;
      // Update profile row created by trigger with role/colors
      if(newId){
        var upd=await sb.from('profiles').update({name:name,role:role,initials:initials,color:pal[0],tc:pal[1]}).eq('id',newId);
        if(upd.error)console.warn('[GL] profile update failed (admin update policy missing?)',upd.error);
      }
      // Update local users array so UI refreshes immediately
      window.users=window.users||[];
      window.users.push({id:newId||('u'+Date.now()),name:name,email:email,role:role,initials:initials,color:pal[0],tc:pal[1],status:'active',lastLogin:'Never'});
      if(ok){
        ok.style.display='block';
        ok.textContent='User created. They must click the confirmation email link before they can log in. Password: '+password;
      }
      if(typeof renderUsersPanel==='function')renderUsersPanel();
      if(typeof renderUsers==='function')renderUsers();
      if(typeof addNotification==='function')addNotification('👤 User invited: '+name,email+' — confirmation email sent','success');
      setTimeout(function(){if(typeof closeInviteModal==='function')closeInviteModal();},4000);
    }catch(e){
      console.error('[GL] signUp threw',e);
      setErr('Failed: '+(e.message||'unknown'));
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

  /* ── doChangePassword — change-password modal (self change OR admin reset other) ── */
  window.doChangePassword=async function(){
    var newPw=(document.getElementById('change-pw-new')||{}).value||'';
    var confirmPw=(document.getElementById('change-pw-confirm')||{}).value||'';
    var err=document.getElementById('change-pw-err');
    var ok=document.getElementById('change-pw-ok');
    if(err)err.style.display='none';
    if(ok)ok.style.display='none';
    function setErr(m){if(err){err.textContent=m;err.style.display='block';}}
    function setOk(m){if(ok){ok.textContent=m;ok.style.display='block';}}
    if(newPw.length<8){setErr('Password must be at least 8 characters.');return;}
    if(newPw!==confirmPw){setErr('Passwords do not match.');return;}

    var sb=getSupa();
    if(!sb){setErr('Auth service unavailable.');return;}

    var isAdmin=window.currentUser&&window.currentUser.role==='admin';
    var sel=document.getElementById('change-pw-user-sel');
    var targetId=null;
    if(isAdmin&&sel&&sel.value&&window.currentUser&&sel.value!==window.currentUser.id)targetId=sel.value;

    if(!targetId){
      try{
        var r=await sb.auth.updateUser({password:newPw});
        if(r.error){setErr(r.error.message);return;}
        setOk('Password updated.');
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
        var r=await sb.from('profiles').update({status:'inactive',updated_at:new Date().toISOString()}).eq('id',u.id);
        if(r.error)console.warn('[GL] profile status update failed',r.error);
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
  window._glRates = { canning: [], bottling: [], loaded: false };

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

  function getCanRate(cases, format) {
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

  function getBottleRate(units, format) {
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

  /* ── Canning line ──────────────────────────────────────── */
  window.glCanFormatChange = function(uid) {
    var ce = document.getElementById(uid + '-cases');
    var fe = document.getElementById(uid + '-format');
    if (!ce || !fe) return;
    var cases   = Math.max(1, parseInt(ce.value) || 150);
    var format  = fe.value;
    var perCan  = getCanRate(cases, format);
    var perCase = perCan * CANS_PER_CASE;
    var total   = perCase * cases;
    function s(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
    s(uid + '-total', usd(total));
    s(uid + '-pcase', usd(perCase) + '/case');
    s(uid + '-pcan',  usd(perCan, 4) + '/can');
    s(uid + '-cans',  (cases * CANS_PER_CASE).toLocaleString() + ' cans');
    if (typeof window.glCalcInvTotal === 'function') window.glCalcInvTotal();
  };

  window.glRemoveCanLine = function(uid) {
    var e = document.getElementById(uid); if (e) e.remove();
    if (typeof window.glCalcInvTotal === 'function') window.glCalcInvTotal();
  };

  /* ── Bottling line ─────────────────────────────────────── */
  window.glBottleQtyChange = function(uid) {
    var qe = document.getElementById(uid + '-qty');
    var fe = document.getElementById(uid + '-format');
    if (!qe || !fe) return;
    var qty       = Math.max(1, parseInt(qe.value) || 500);
    var format    = fe.value;
    var perUnit   = getBottleRate(qty, format);
    var total     = perUnit * qty;
    function s(id, v) { var e = document.getElementById(id); if (e) e.textContent = v; }
    s(uid + '-total', usd(total));
    s(uid + '-punit', usd(perUnit, 4) + '/btl');
    if (typeof window.glCalcInvTotal === 'function') window.glCalcInvTotal();
  };

  window.glRemoveBottleLine = function(uid) {
    var e = document.getElementById(uid); if (e) e.remove();
    if (typeof window.glCalcInvTotal === 'function') window.glCalcInvTotal();
  };

  /* ── Override glAddLine ────────────────────────────────── */
  var _prev = window.glAddLine;
  window.glAddLine = async function(type) {
    if (type !== 'canning' && type !== 'bottling') {
      if (typeof _prev === 'function') _prev(type);
      return;
    }

    await window.glLoadRates();
    var t = getLineTable();
    if (!t) { if (typeof _prev === 'function') _prev(type); return; }

    var RS = 'display:grid;grid-template-columns:2fr 1fr 1fr 1fr 36px;gap:0;' +
             'padding:10px 12px;border-top:1px solid rgba(255,255,255,.05);align-items:start';
    var SS = 'background:#1a2a3a;color:#fff;border:1px solid rgba(0,229,192,.4);' +
             'border-radius:6px;padding:3px 8px;font-size:11px;cursor:pointer;width:100%;max-width:160px';
    var SI = 'width:60px;background:#1a2a3a;color:#fff;border:1px solid rgba(255,255,255,.18);' +
             'border-radius:6px;padding:3px 6px;font-size:12px;font-weight:600;text-align:center';

    if (type === 'canning') {
      var uid = 'glcan' + Date.now();
      var formats = [];
      var seen = {};
      window._glRates.canning.forEach(function(r) {
        if (!seen[r.format]) { seen[r.format] = true; formats.push({value: r.format, label: r.format_label}); }
      });
      if (!formats.length) formats = [{value:'12oz-standard',label:'12oz Standard'}];
      var def    = formats[0].value;
      var perCan = getCanRate(150, def);
      var pcase  = perCan * CANS_PER_CASE;
      var total  = pcase * 150;
      var opts   = formats.map(function(f) {
        return '<option value="' + f.value + '"' + (f.value === def ? ' selected' : '') + '>' + f.label + '</option>';
      }).join('');
      var row = document.createElement('div');
      row.id = uid;
      row.setAttribute('style', RS);
      row.innerHTML =
        '<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">Canning</div>' +
        '<select id="' + uid + '-format" onchange="window.glCanFormatChange(this.closest(\'[id^=glcan]\').id)" style="' + SS + '">' + opts + '</select></div>' +
        '<div style="text-align:center"><input id="' + uid + '-cases" type="number" min="1" value="150" onchange="window.glCanFormatChange(this.closest(\'[id^=glcan]\').id)" style="' + SI + '"/>' +
        '<div id="' + uid + '-cans" style="font-size:10px;color:var(--muted);margin-top:3px">' + (150*CANS_PER_CASE).toLocaleString() + ' cans</div></div>' +
        '<div style="text-align:right;padding-right:4px">' +
        '<div id="' + uid + '-pcase" style="font-size:12px;color:#fff;font-weight:600">' + usd(pcase) + '/case</div>' +
        '<div id="' + uid + '-pcan"  style="font-size:10px;color:var(--muted);margin-top:3px">' + usd(perCan,4) + '/can</div></div>' +
        '<div id="' + uid + '-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">' + usd(total) + '</div>' +
        '<div style="text-align:center"><button onclick="window.glRemoveCanLine(this.closest(\'[id^=glcan]\').id)" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0">x</button></div>';
      t.appendChild(row);
    }

    if (type === 'bottling') {
      var uid = 'glbtl' + Date.now();
      var bformats = [];
      var bseen = {};
      window._glRates.bottling.forEach(function(r) {
        if (!bseen[r.format]) { bseen[r.format] = true; bformats.push({value: r.format, label: r.format_label}); }
      });
      if (!bformats.length) bformats = [{value:'750ml',label:'750ml Bottle'}];
      var bdef    = bformats[0].value;
      var perUnit = getBottleRate(500, bdef);
      var btotal  = perUnit * 500;
      var bopts   = bformats.map(function(f) {
        return '<option value="' + f.value + '"' + (f.value === bdef ? ' selected' : '') + '>' + f.label + '</option>';
      }).join('');
      var brow = document.createElement('div');
      brow.id = uid;
      brow.setAttribute('style', RS);
      brow.innerHTML =
        '<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">Bottling</div>' +
        '<select id="' + uid + '-format" onchange="window.glBottleQtyChange(this.closest(\'[id^=glbtl]\').id)" style="' + SS + '">' + bopts + '</select></div>' +
        '<div style="text-align:center"><input id="' + uid + '-qty" type="number" min="1" value="500" onchange="window.glBottleQtyChange(this.closest(\'[id^=glbtl]\').id)" style="' + SI + '"/>' +
        '<div style="font-size:10px;color:var(--muted);margin-top:3px">bottles</div></div>' +
        '<div style="text-align:right;padding-right:4px">' +
        '<div id="' + uid + '-punit" style="font-size:12px;color:#fff;font-weight:600">' + usd(perUnit,4) + '/btl</div></div>' +
        '<div id="' + uid + '-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">' + usd(btotal) + '</div>' +
        '<div style="text-align:center"><button onclick="window.glRemoveBottleLine(this.closest(\'[id^=glbtl]\').id)" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0">x</button></div>';
      t.appendChild(brow);
    }

    if (typeof window.glCalcInvTotal === 'function') window.glCalcInvTotal();
  };

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
  window.glGetCanRate=function(cases,fmt){
    var t=window._glR.c.filter(function(r){return r.format===fmt;}).sort(function(a,b){return a.min_cases-b.min_cases;});
    if(!t.length)return 0;
    var v=parseFloat(t[0].price_per_can);
    for(var i=0;i<t.length;i++)if(cases>=t[i].min_cases)v=parseFloat(t[i].price_per_can);
    return v;
  };
  window.glGetBtlRate=function(qty,fmt){
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
  var _orig=window.glAddLine;
  window.glAddLine=function(type){
    if(type!=='canning'&&type!=='bottling'){if(typeof _orig==='function')_orig(type);return;}
    var tbl=window.glGetTbl();if(!tbl)return;
    var ph=[...tbl.children].find(function(c){return c.textContent.includes('No line items');});if(ph)ph.remove();
    if(!window._glR.ok){
      var uid='glline'+Date.now();
      var lr=document.createElement('div');lr.id=uid;
      lr.setAttribute('style','padding:12px;color:var(--muted);font-size:12px;border-top:1px solid rgba(255,255,255,.05)');
      lr.textContent='Loading rates...';tbl.appendChild(lr);
      window.glLoadRates().then(function(){var e=document.getElementById(uid);if(e)e.remove();window.glAddLine(type);});
      return;
    }
    var uid='glline'+Date.now();
    if(type==='canning'){
      var fmts=[],seen={};
      window._glR.c.forEach(function(r){if(!seen[r.format]){seen[r.format]=true;fmts.push({value:r.format,label:r.format_label});}});
      if(!fmts.length)fmts=[{value:'12oz-standard',label:'12oz Standard'}];
      var def=fmts[0].value,pc=window.glGetCanRate(150,def);
      tbl.appendChild(window.glBuildCanRow(uid,150,def,fmts,pc));
    }else{
      var bfmts=[],bseen={};
      window._glR.b.forEach(function(r){if(!bseen[r.format]){bseen[r.format]=true;bfmts.push({value:r.format,label:r.format_label});}});
      if(!bfmts.length)bfmts=[{value:'750ml',label:'750ml Bottle'}];
      var bdef=bfmts[0].value,pu=window.glGetBtlRate(500,bdef);
      tbl.appendChild(window.glBuildBtlRow(uid,500,bdef,bfmts,pu));
    }
    window.glCalcInvTotal();
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
  window.glGetCanRate=function(cases,fmt){
    var t=window._glR.c.filter(function(r){return r.format===fmt;}).sort(function(a,b){return a.min_cases-b.min_cases;});
    if(!t.length)return 0;
    var v=parseFloat(t[0].price_per_can);
    for(var i=0;i<t.length;i++)if(cases>=t[i].min_cases)v=parseFloat(t[i].price_per_can);
    return v;
  };
  window.glGetBtlRate=function(qty,fmt){
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

  /* ── Update bottling row ── */
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
  window.glBuildCanRow=function(uid,cases,fmt,fmts,pc){
    var pcase=pc*CPC,total=pcase*cases,cans=cases*CPC;
    var opts=fmts.map(function(f){return'<option value="'+f.value+'"'+(f.value===fmt?' selected':'')+'>'+f.label+'</option>';}).join('');
    var row=document.createElement('div');row.id=uid;row.setAttribute('style',RS);row.setAttribute('data-gl-total',total);
    row.innerHTML=
      '<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">Canning</div>'+
      '<select id="'+uid+'-format" onchange="window.glUpdateCan(\''+uid+'\')" style="'+SS+'">'+opts+'</select></div>'+
      '<div style="text-align:center"><input id="'+uid+'-cases" type="number" min="1" value="'+cases+'" onchange="window.glUpdateCan(\''+uid+'\')" style="'+SI+'"/>'+
      '<div id="'+uid+'-cans" style="font-size:10px;color:var(--muted);margin-top:3px">'+cans.toLocaleString()+' cans</div></div>'+
      '<div style="text-align:right;padding-right:4px">'+
      '<div id="'+uid+'-pcase" style="font-size:12px;color:#fff;font-weight:600">'+window.glUsd(pcase)+'/case</div>'+
      '<div id="'+uid+'-pcan" style="font-size:10px;color:var(--muted);margin-top:3px">'+window.glUsd(pc,4)+'/can</div></div>'+
      '<div id="'+uid+'-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">'+window.glUsd(total)+'</div>'+
      '<div style="text-align:center"><button onclick="window.glRemoveLine(\''+uid+'\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0;line-height:1">x</button></div>';
    return row;
  };

  /* ── Build bottling row ── */
  window.glBuildBtlRow=function(uid,qty,fmt,fmts,pu){
    var total=pu*qty;
    var opts=fmts.map(function(f){return'<option value="'+f.value+'"'+(f.value===fmt?' selected':'')+'>'+f.label+'</option>';}).join('');
    var row=document.createElement('div');row.id=uid;row.setAttribute('style',RS);row.setAttribute('data-gl-total',total);
    row.innerHTML=
      '<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">Bottling</div>'+
      '<select id="'+uid+'-format" onchange="window.glUpdateBtl(\''+uid+'\')" style="'+SS+'">'+opts+'</select></div>'+
      '<div style="text-align:center"><input id="'+uid+'-qty" type="number" min="1" value="'+qty+'" onchange="window.glUpdateBtl(\''+uid+'\')" style="'+SI+'"/>'+
      '<div style="font-size:10px;color:var(--muted);margin-top:3px">bottles</div></div>'+
      '<div style="text-align:right;padding-right:4px">'+
      '<div id="'+uid+'-punit" style="font-size:12px;color:#fff;font-weight:600">'+window.glUsd(pu,4)+'/btl</div></div>'+
      '<div id="'+uid+'-total" style="text-align:right;font-size:14px;font-weight:700;color:#fff">'+window.glUsd(total)+'</div>'+
      '<div style="text-align:center"><button onclick="window.glRemoveLine(\''+uid+'\')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:16px;opacity:.5;padding:0;line-height:1">x</button></div>';
    return row;
  };

  /* ── Build manual row (rd / hours / custom) ── */
  window.glBuildManualRow=function(uid,label,descDefault,qty,price){
    var total=qty*price;
    var row=document.createElement('div');row.id=uid;row.setAttribute('style',RS);row.setAttribute('data-gl-total',total);
    row.innerHTML=
      '<div><div style="font-size:12px;font-weight:700;color:var(--teal);margin-bottom:5px">'+label+'</div>'+
      '<input id="'+uid+'-desc" type="text" value="'+descDefault+'" placeholder="Description" style="'+SIT+'"/></div>'+
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
      if(casesEl){
        var cases=parseInt(casesEl.value)||0;
        var fEl=document.getElementById(uid+'-format');
        var fLbl=(fEl&&fEl.options[fEl.selectedIndex])?fEl.options[fEl.selectedIndex].text:'';
        var perCase=cases>0?total/cases:0;
        lines.push({desc:'Canning - '+fLbl,qty:cases,unitPrice:perCase,total:total,unit:'case'});
      }else if(punitEl){
        var qtyEl=document.getElementById(uid+'-qty');
        var qty=qtyEl?parseInt(qtyEl.value)||0:0;
        var fEl2=document.getElementById(uid+'-format');
        var fLbl2=(fEl2&&fEl2.options[fEl2.selectedIndex])?fEl2.options[fEl2.selectedIndex].text:'';
        var perBtl=qty>0?total/qty:0;
        lines.push({desc:'Bottling - '+fLbl2,qty:qty,unitPrice:perBtl,total:total,unit:'btl'});
      }else if(descEl){
        var qtyMEl=document.getElementById(uid+'-qty');
        var qtyM=qtyMEl?parseFloat(qtyMEl.value)||0:0;
        var priceMEl=document.getElementById(uid+'-price');
        var priceM=priceMEl?parseFloat(priceMEl.value)||0:0;
        var typed=(descEl.value||'').trim();
        var desc=typed?(label?label+' - '+typed:typed):(label||'Line item');
        lines.push({desc:desc,qty:qtyM,unitPrice:priceM,total:total,unit:''});
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

    var client=(window.clients||[]).find(function(c){return c.id===cid;})||{};
    var invIdEl=document.getElementById('ginv-id');
    var invId=(invIdEl&&invIdEl.value)?invIdEl.value:nextInvId();
    var dateEl=document.getElementById('ginv-date');
    var date=(dateEl&&dateEl.value)?dateEl.value:new Date().toISOString().slice(0,10);
    var discEl=document.getElementById('ginv-disc');
    var pct=discEl?parseFloat(discEl.value)||0:0;
    var subtotal=lines.reduce(function(s,l){return s+(l.total||0);},0);
    var discountAmt=subtotal*(pct/100);
    var amount=subtotal-discountAmt;

    var inv={
      id:invId,
      client:cid,
      clientName:client.name||'',
      clientEmail:client.email||'',
      svc:lines.map(function(l){return l.desc;}).join(', '),
      lines:lines,
      addons:[],
      discount:pct,
      subtotal:subtotal,
      discountAmt:discountAmt,
      amount:amount,
      notes:'',
      date:date,
      status:'pending',
      paymentTerms:'Due upon receipt'
    };
    window.invoices=window.invoices||[];
    // Mutate in place so index.html's `let invoices` (bridged to window.invoices)
    // keeps pointing at the same array. Replacing via .filter() would break that.
    for(var _k=window.invoices.length-1;_k>=0;_k--){if(window.invoices[_k]&&window.invoices[_k].id===invId)window.invoices.splice(_k,1);}
    window.invoices.unshift(inv);
    if(typeof renderInvoices==='function')renderInvoices();
    if(typeof addNotification==='function')addNotification('Invoice saved: '+invId,(client.name||'')+' · '+window.glUsd(amount),'success');
    var ov=document.getElementById('gl-inv-builder');if(ov)ov.classList.remove('show');

    // Fire-and-forget Supabase persistence (keeps synchronous contract for glExportPDF)
    var dueIso='';try{dueIso=new Date(Date.parse(date)+30*86400000).toISOString().slice(0,10);}catch(e){dueIso='';}
    fetch(SURL+'/invoices',{
      method:'POST',
      headers:Object.assign({},SH,{'Prefer':'return=representation'}),
      body:JSON.stringify({
        invoice_number:invId,
        client_id:(cid&&cid.charAt(0)==='c')?null:cid,
        client_name:client.name||'',
        service:inv.svc,
        amount:amount,
        status:'pending',
        invoice_date:date,
        due_date:dueIso||null,
        notes:'',
        line_items:lines
      })
    }).then(function(r){
      if(!r.ok)return r.text().then(function(t){throw new Error('HTTP '+r.status+' '+t);});
      return r.json();
    }).then(function(rows){
      if(Array.isArray(rows)&&rows[0])inv.supaId=rows[0].id;
      console.log('[GL] Invoice synced to Supabase:',invId,inv.supaId||'');
    }).catch(function(err){
      console.error('[GL] Supabase sync failed for '+invId+':',err);
      if(typeof addNotification==='function')addNotification('Cloud sync failed','Invoice '+invId+' saved locally only. '+(err.message||''),'warning');
    });

    return inv;
  };

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
    if(!['admin','sales','viewer'].includes(newRole)){alert('Invalid role.');return;}
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
      if(pw.length < 6){ showErr('Password must be at least 6 characters.'); return; }
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
  window.openMailgunSettings = function(){
    var existing = document.getElementById('mg-settings-overlay');
    if(existing) existing.remove();
    var ov = document.createElement('div');
    ov.id = 'mg-settings-overlay';
    ov.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.95);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;padding:20px');
    var saved = localStorage.getItem('gl_mailgun_key') || '';
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:36px;width:100%;max-width:520px">' +
        '<div style="font-family:var(--ff-disp);font-size:22px;letter-spacing:2px;color:var(--teal);margin-bottom:8px">📧 MAILGUN SETTINGS</div>' +
        '<div style="font-size:13px;color:var(--muted);margin-bottom:24px;line-height:1.6">Mailgun sends onboarding emails, follow-ups, and tour confirmations. Paste your private API key — it stays in this browser only.</div>' +
        (saved ? '<div style="background:rgba(29,158,117,.1);border:1px solid rgba(29,158,117,.3);border-radius:8px;padding:10px 14px;font-size:13px;color:#1D9E75;margin-bottom:16px">✅ API key is saved and active</div>' : '') +
        '<div style="margin-bottom:16px"><div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">MAILGUN PRIVATE API KEY</div>' +
          '<input id="mg-key-input" type="password" value="' + saved.replace(/"/g,'&quot;') + '" placeholder="key-..." style="width:100%;padding:13px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:13px;font-family:var(--ff-mono);box-sizing:border-box"></div>' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:20px">Find it at <span style="color:var(--teal)">app.mailgun.com → Send → Sending → Domain settings → API Keys</span></div>' +
        '<div style="display:flex;gap:10px">' +
          '<button onclick="window.glSaveMailgunKey()" style="flex:1;padding:13px;background:var(--teal);color:#0a1628;border:none;border-radius:8px;font-weight:800;cursor:pointer;font-size:14px">Save Key</button>' +
          (saved ? '<button onclick="window.glTestMailgun()" style="padding:13px 18px;background:rgba(245,200,66,.08);color:#f5c842;border:1px solid rgba(245,200,66,.3);border-radius:8px;cursor:pointer;font-size:13px">Test send</button>' : '') +
          '<button onclick="document.getElementById(\'mg-settings-overlay\').remove()" style="padding:13px 20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--muted);cursor:pointer">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
  };

  window.glSaveMailgunKey = function(){
    var k = (document.getElementById('mg-key-input')||{}).value || '';
    k = k.trim();
    if(!k){ alert('Please paste a Mailgun API key.'); return; }
    localStorage.setItem('gl_mailgun_key', k);
    document.getElementById('mg-settings-overlay').remove();
    if(typeof addNotification==='function') addNotification('Mailgun key saved','Onboarding + follow-up emails will now send.','success');
    else alert('✅ Mailgun key saved.');
  };

  window.glTestMailgun = async function(){
    var key = localStorage.getItem('gl_mailgun_key');
    if(!key){ alert('Save a key first.'); return; }
    if(typeof window.sendMailgunEmail !== 'function'){ alert('sendMailgunEmail unavailable.'); return; }
    var ok = await window.sendMailgunEmail('mike@goodliquid.com','Mailgun test from Good Liquid CRM','This is a test email confirming Mailgun is wired up. — Good Liquid CRM');
    if(ok) alert('✓ Test email sent to mike@goodliquid.com');
    else alert('✗ Test failed. Check the API key and the browser console for the Mailgun response.');
  };

  /* Replace sendOnboardingEmail with a version that pre-flights the Mailgun
     key, awaits the send, and only reports success when the send actually
     succeeded. */
  window.sendOnboardingEmail = async function(){
    if(!localStorage.getItem('gl_mailgun_key')){
      if(typeof addNotification==='function') addNotification('Mailgun key required','Paste your Mailgun API key in Settings before sending onboarding emails.','warning');
      window.openMailgunSettings();
      return;
    }
    var email = prompt('Customer email address to send onboarding link:');
    if(!email) return;
    email = email.trim();
    if(!email || email.indexOf('@')<0){ alert('Invalid email.'); return; }
    var name = prompt('Customer name:');
    if(!name) return;
    name = name.trim();
    if(!name){ alert('Name required.'); return; }

    var tempPw = 'GL' + Math.random().toString(36).substring(2,8).toUpperCase();
    var list = window.customerLogins || [];
    list.push({id:'cust-'+Date.now(),name:name,email:email,password:tempPw,createdAt:new Date().toISOString()});
    window.customerLogins = list;
    if(typeof saveCustomerLogins==='function') saveCustomerLogins();
    if(typeof renderCustomerLogins==='function') renderCustomerLogins();

    var body =
      'Hi ' + name + ',\n\n' +
      'Welcome to Good Liquid Bev Co! Your client portal is ready.\n\n' +
      'Login at: https://www.goodliquidbevco.com\n' +
      'Email: ' + email + '\n' +
      'Temporary password: ' + tempPw + '\n\n' +
      'Please change your password after first login.\n\n' +
      'Best,\nMike Krail\nGood Liquid Bev Co\nMike@GoodLiquid.com | (803) 493-5065';

    var ok = false;
    try{ ok = await window.sendMailgunEmail(email, 'Welcome to Good Liquid Bev Co — Your Portal Access', body); }
    catch(e){ console.error('[GL] onboarding mailgun threw', e); ok = false; }

    if(ok){
      if(typeof addNotification==='function') addNotification('📧 Onboarding email sent to '+name,email,'success');
      alert('✓ Onboarding email sent to '+email+'\n\nTemp password (share this securely too): '+tempPw);
    } else {
      if(typeof addNotification==='function') addNotification('Email send failed',email+' — see console for details','warning');
      alert('✗ Mailgun send failed for '+email+'.\n\nThe account was created locally with temp password:\n  '+tempPw+'\n\nCheck Mailgun Settings (API key valid? Domain authorized?) and try again.');
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
    tb.setAttribute('style','position:fixed;bottom:28px;right:28px;z-index:600;display:flex;flex-direction:column;gap:8px;align-items:flex-end;pointer-events:auto');

    var tools = document.createElement('div');
    tools.id = 'ai-tools';
    tools.setAttribute('style','display:none;flex-direction:column;gap:6px;align-items:flex-end;margin-bottom:6px');

    var items = [
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
    fab.setAttribute('style','width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,var(--teal),#1a6fff);border:none;color:#0a1628;font-size:22px;cursor:pointer;box-shadow:0 4px 20px rgba(0,229,192,.4);font-weight:900');
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
    host.appendChild(tb);
    console.log('[AI toolbar] mounted inside', host.id || host.tagName);
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
  function openRecoveryModal(){
    var existing = document.getElementById('gl-recovery-modal');
    if(existing) existing.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-recovery-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1200;background:rgba(6,13,26,.95);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:32px;width:100%;max-width:440px">' +
        '<div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:2px;color:#00e5c0;margin-bottom:6px">RESET YOUR PASSWORD</div>' +
        '<div style="font-size:13px;color:#9ca3af;margin-bottom:22px;line-height:1.5">You arrived via a password reset link. Choose a new password to sign in.</div>' +
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
      if(pw.length < 6){ showErr('Password must be at least 6 characters.'); return; }
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
        // Auto-open CRM via the same path as a normal login.
        var user = r.data && r.data.user;
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

  function attach(){
    var sb = window.supa;
    if(!sb || !sb.auth || typeof sb.auth.onAuthStateChange !== 'function'){
      console.warn('[GL] recovery handler: supa not ready, retrying');
      setTimeout(attach, 400);
      return;
    }
    // 1) Subscribe to future PASSWORD_RECOVERY events (fires when supabase-js
    //    parses the recovery hash on its own).
    sb.auth.onAuthStateChange(function(event){
      if(event === 'PASSWORD_RECOVERY'){
        console.log('[GL] PASSWORD_RECOVERY received → opening reset modal');
        openRecoveryModal();
      }
    });
    // 2) Defensive: if the page loaded with a recovery hash but the event
    //    fired before we subscribed, detect it by URL and open the modal.
    var hash = (window.location.hash || '').replace(/^#/, '');
    if(hash.indexOf('type=recovery') >= 0){
      console.log('[GL] recovery hash detected on load → opening reset modal');
      setTimeout(openRecoveryModal, 300);
    }
  }
  if(document.readyState !== 'loading') attach();
  else document.addEventListener('DOMContentLoaded', attach);

  console.log('[GL] Recovery link handler loaded');
}());