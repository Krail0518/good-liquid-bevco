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
  var ALL=['dashboard','clients','pipeline','invoices','invoice-detail','newinv','referrals','referrers','activity','users','customers','calendar','production-cal','cip','audit','tasks','documents','inventory','announcements','time-tracker','reports','ai-settings'];
  if(window.PERMISSIONS){window.PERMISSIONS.admin=ALL;window.PERMISSIONS.sales=['dashboard','clients','pipeline','invoices','newinv','referrals','referrers','activity','calendar','production-cal','cip','tasks','announcements','reports'];}
  else{window.PERMISSIONS={admin:ALL,sales:['dashboard','clients','pipeline','invoices','newinv','referrals','referrers','activity','calendar','production-cal','cip','tasks','announcements','reports'],viewer:['dashboard','clients','invoices','activity']};}
  window.can=function(page){var u=window.currentUser;if(!u)return false;if(u.role==='admin')return true;return(window.PERMISSIONS[u.role]||[]).includes(page);};
  /* Single cNav wrap: perm-gate first, then dispatch new-invoice variants
     to the builder, otherwise hand off to the original cNav from index.html. */
  window.cNav=function(page,el){
    if(!window.can(page)){if(typeof addNotification==='function')addNotification('Access denied',page,'warning');return;}
    if(page==='newinv'||page==='new-invoice'||page==='newInvoice'){window.openNewInvoiceBuilder();return;}
    if(typeof _cNavOrig==='function') _cNavOrig(page,el);
  };

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
    if(newPw.length<8){setErr('Password must be at least 8 characters.');return;}
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
        payment_terms: inv.paymentTerms,
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
      window.glRevealCredential({
        title: 'Onboarding email sent',
        message: 'The welcome email is on its way to <b>'+name+'</b>. The temporary password is shown below — share it via a separate channel.',
        email: email, password: tempPw, status: 'ok'
      });
    } else {
      if(typeof addNotification==='function') addNotification('Email send failed',email+' — see console for details','warning');
      window.glRevealCredential({
        title: 'Email send failed',
        message: 'Mailgun rejected the message but the account was created locally. Share the password manually and check Mailgun Settings (API key valid? Domain authorized?).',
        email: email, password: tempPw, status: 'warn'
      });
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
  function getLinks(){ try { return JSON.parse(localStorage.getItem('gl_invoice_paylinks')||'{}'); } catch(e){ return {}; } }
  function saveLinks(m){ try { localStorage.setItem('gl_invoice_paylinks', JSON.stringify(m)); } catch(e){} }

  window.glGetPayLink = function(invId){
    var m = getLinks();
    return m[invId] || '';
  };

  window.glSetPayLink = function(invId, url){
    var m = getLinks();
    if(url) m[invId] = url; else delete m[invId];
    saveLinks(m);
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
    var k = localStorage.getItem('gl_mailgun_key');
    if(k && k.length > 10) return { ok:true, msg:'Key set ('+ k.slice(0,8) +'…)' };
    return { ok:false, msg:'Click to add your Mailgun key', action:'mailgun_settings' };
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
    var billable = inv.filter(function(i){ return i.status !== 'quote'; });
    var paid = inv.filter(function(i){ return i.status === 'paid'; });
    var pending = inv.filter(function(i){ return i.status === 'pending'; });
    var overdue = inv.filter(function(i){ return i.status === 'overdue'; });
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
    return '<div style="background:#243a56;border:1px solid rgba(255,255,255,.06);border-radius:11px;padding:14px 16px">' +
      '<div style="font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:6px">' + label.toUpperCase() + '</div>' +
      '<div style="font-family:var(--ff-disp);font-size:24px;font-weight:700;color:' + color + ';line-height:1">' + value + '</div>' +
      '<div style="font-size:10px;color:var(--muted);margin-top:4px">' + sub + '</div>' +
    '</div>';
  }

  // Re-build whenever renderDash runs, so KPIs stay in sync with the data.
  (function(){
    var orig = window.renderDash;
    if(typeof orig === 'function'){
      window.renderDash = function(){
        var r = orig.apply(this, arguments);
        try { buildExtraKpis(); } catch(e){ console.error('[GL kpi] build threw', e); }
        return r;
      };
    } else {
      // renderDash not loaded yet — try once after a delay.
      setTimeout(function(){
        var o = window.renderDash;
        if(typeof o === 'function'){
          window.renderDash = function(){ var r = o.apply(this, arguments); try { buildExtraKpis(); } catch(e){} return r; };
        }
      }, 1500);
    }
  })();

  console.log('[GL] Dashboard extra KPIs loaded');
}());

/* ============================================================
   CUSTOMER PORTAL v2
   Wraps openCustomerPortal so each visit gets:
   - Pay buttons on invoices that have a Stripe pay link
   - "Accept this quote" button on quote-status invoices →
     emails Mike (no customer-side DB writes needed)
   - "Send us a message" contact form at the bottom that fires
     a Mailgun email to mike@goodliquid.com tagged with the
     customer's name/email
   Falls back gracefully if Mailgun isn't configured.
   ============================================================ */
(function(){
  function esc(s){ return String(s||'').replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  function enhancePortal(customer){
    if(!customer) return;

    // 1) Inject Pay / Accept buttons on invoice rows.
    var tbody = document.getElementById('portal-invoices');
    if(tbody){
      tbody.querySelectorAll('tr').forEach(function(tr){
        if(tr.querySelector('.gl-portal-pay-btn') || tr.querySelector('.gl-portal-accept-btn')) return;
        var idCell = tr.querySelector('td:first-child');
        if(!idCell) return;
        var invId = (idCell.textContent||'').trim();
        if(!invId || invId === '—') return;
        var statusCell = tr.querySelector('td:last-child');
        var statusText = statusCell ? (statusCell.textContent||'').trim().toLowerCase() : '';

        var actionCell = document.createElement('td');
        actionCell.setAttribute('style','padding:6px 8px;text-align:right;white-space:nowrap');

        if(statusText === 'quote'){
          var acceptBtn = document.createElement('button');
          acceptBtn.className = 'gl-portal-accept-btn';
          acceptBtn.setAttribute('style','padding:5px 12px;background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.35);color:var(--teal);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer');
          acceptBtn.textContent = '✓ Accept quote';
          acceptBtn.addEventListener('click', async function(){
            if(!confirm('Accept quote ' + invId + '?\n\nWe\'ll email Mike to convert this into a real invoice and schedule production.')) return;
            acceptBtn.disabled = true; acceptBtn.textContent = 'Sending…';
            try{
              await window.sendMailgunEmail('mike@goodliquid.com',
                '[Portal] Quote accepted by ' + (customer.name||'customer') + ': ' + invId,
                customer.name + ' (' + customer.email + ') accepted quote ' + invId + ' via the customer portal.\n\nPlease convert it to a billable invoice and follow up with production scheduling.\n\n— Good Liquid CRM');
              acceptBtn.style.background = 'rgba(29,158,117,.18)';
              acceptBtn.style.borderColor = 'rgba(29,158,117,.4)';
              acceptBtn.style.color = '#1D9E75';
              acceptBtn.textContent = '✓ Sent';
            }catch(e){
              acceptBtn.disabled = false; acceptBtn.textContent = '✓ Accept quote';
              alert('Could not send. Please email Mike@GoodLiquid.com directly.');
            }
          });
          actionCell.appendChild(acceptBtn);
        } else if(statusText !== 'paid'){
          var link = (typeof window.glGetPayLink === 'function') ? window.glGetPayLink(invId) : '';
          if(link){
            var payBtn = document.createElement('a');
            payBtn.className = 'gl-portal-pay-btn';
            payBtn.href = link;
            payBtn.target = '_blank';
            payBtn.rel = 'noopener';
            payBtn.setAttribute('style','display:inline-block;padding:5px 14px;background:var(--teal);color:#0a1628;border-radius:6px;font-size:11px;font-weight:800;text-decoration:none');
            payBtn.textContent = '💳 Pay now';
            actionCell.appendChild(payBtn);
          }
        }
        tr.appendChild(actionCell);
      });
    }

    // 2) Add "Send us a message" form below the existing portal body.
    var portal = document.getElementById('customer-portal');
    if(!portal) return;
    if(portal.querySelector('#gl-portal-contact')) return;
    // Find a sensible parent — the main content container inside portal.
    var body = portal.querySelector('[id^="portal-"]')?.parentElement || portal;
    var section = document.createElement('div');
    section.id = 'gl-portal-contact';
    section.setAttribute('style','background:#142238;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:24px;margin-top:24px;max-width:760px;margin-left:auto;margin-right:auto');
    section.innerHTML =
      '<div style="font-family:var(--ff-disp);font-size:16px;letter-spacing:2px;color:var(--teal);margin-bottom:6px">SEND US A MESSAGE</div>' +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6">Questions about your run, an invoice, or anything else? Drop us a note and we\'ll get back to you within one business day.</div>' +
      '<textarea id="gl-portal-msg" rows="4" placeholder="Hi Mike, …" style="width:100%;padding:13px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-family:var(--ff-body);font-size:13px;resize:vertical;box-sizing:border-box;margin-bottom:10px"></textarea>' +
      '<div style="display:flex;gap:10px;align-items:center">' +
        '<button id="gl-portal-send" class="cbtn pri" style="flex:0 0 auto">📤 Send message</button>' +
        '<span id="gl-portal-status" style="font-size:11px;color:var(--muted)"></span>' +
      '</div>';
    body.appendChild(section);
    var sendBtn = section.querySelector('#gl-portal-send');
    var msgEl = section.querySelector('#gl-portal-msg');
    var statusEl = section.querySelector('#gl-portal-status');
    sendBtn.addEventListener('click', async function(){
      var msg = (msgEl.value||'').trim();
      if(!msg){ statusEl.textContent = 'Type a message first.'; statusEl.style.color = '#ff8579'; return; }
      sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
      statusEl.textContent = ''; statusEl.style.color = 'var(--muted)';
      try{
        var ok = await window.sendMailgunEmail('mike@goodliquid.com',
          '[Portal] Message from ' + (customer.name||'customer'),
          'From: ' + (customer.name||'') + ' <' + (customer.email||'') + '>\n\n' + msg + '\n\n— Sent via Good Liquid customer portal');
        if(ok){
          msgEl.value = '';
          statusEl.style.color = '#1D9E75';
          statusEl.textContent = '✓ Sent. We\'ll get back to you shortly.';
        } else {
          statusEl.style.color = '#ff8579';
          statusEl.textContent = 'Send failed. Please email Mike@GoodLiquid.com directly.';
        }
      }catch(e){
        statusEl.style.color = '#ff8579';
        statusEl.textContent = 'Send failed: ' + (e.message||'') + '. Please email Mike@GoodLiquid.com directly.';
      } finally {
        sendBtn.disabled = false; sendBtn.textContent = '📤 Send message';
      }
    });
  }

  // Wrap openCustomerPortal so the enhancements apply on every open.
  (function(){
    var orig = window.openCustomerPortal;
    if(typeof orig !== 'function'){
      // openCustomerPortal not yet loaded — retry once.
      setTimeout(function(){
        var o = window.openCustomerPortal;
        if(typeof o === 'function'){
          window.openCustomerPortal = function(customer){
            var r = o.apply(this, arguments);
            setTimeout(function(){ enhancePortal(customer); }, 60);
            return r;
          };
        }
      }, 1200);
      return;
    }
    window.openCustomerPortal = function(customer){
      var r = orig.apply(this, arguments);
      setTimeout(function(){ enhancePortal(customer); }, 60);
      return r;
    };
  })();

  console.log('[GL] Customer portal v2 loaded');
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
    var overdue = (window.invoices||[]).filter(function(i){ return i.status === 'overdue'; });
    if(!overdue.length){ alert('No overdue invoices.'); return; }
    if(!localStorage.getItem('gl_mailgun_key')){
      if(typeof window.openMailgunSettings === 'function') window.openMailgunSettings();
      alert('Mailgun key required first.');
      return;
    }
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
    var rem = document.createElement('button');
    rem.className = 'cbtn gl-overdue-btn';
    rem.setAttribute('style','margin-left:8px;background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.3);color:#f5c842');
    rem.textContent = '📧 Send overdue reminders';
    rem.addEventListener('click', function(){ window.glSendOverdueReminders(); });
    if(newBtn && newBtn.parentElement){
      newBtn.parentElement.appendChild(csv);
      newBtn.parentElement.appendChild(rem);
    } else {
      header.appendChild(csv);
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

/* ============================================================
   IN-APP HELP PANEL (v2 — fixed layout + visual wireframes)
   Replaces the broken v1 grid layout with a flexbox row that
   actually renders, larger TOC items, and inline SVG mockups
   on the busiest sections (Dashboard, Invoices, New Invoice,
   Users) with numbered callouts mapped to bullets.
   ============================================================ */
(function(){
  function section(id, heading, html){
    return '<section id="' + id + '" style="padding:22px 4px 26px;border-bottom:1px solid rgba(255,255,255,.06);scroll-margin-top:20px">' +
      '<h3 style="margin:0 0 14px;font-family:var(--ff-disp);font-size:15px;letter-spacing:2px;color:var(--teal)">' + heading + '</h3>' +
      html +
    '</section>';
  }
  function bullets(items){
    return '<ul style="margin:10px 0 4px;padding-left:20px;color:#cfd9e6;font-size:13px;line-height:1.75">' +
      items.map(function(t){ return '<li style="margin-bottom:6px">' + t + '</li>'; }).join('') +
    '</ul>';
  }
  function wf(width, height, content){
    return '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" style="background:#0a1628;border-radius:10px;border:1px solid rgba(255,255,255,.08);margin:12px 0 4px;display:block;max-height:340px">' +
      content +
    '</svg>';
  }
  function box(x,y,w,h,fill,stroke){ return '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="6" fill="'+(fill||'#243a56')+'" stroke="'+(stroke||'rgba(255,255,255,.06)')+'"/>'; }
  function txt(x,y,t,size,color,anchor){ return '<text x="'+x+'" y="'+y+'" fill="'+(color||'#cfd9e6')+'" font-size="'+(size||11)+'" text-anchor="'+(anchor||'start')+'" font-family="Arial">'+t+'</text>'; }
  function tag(x,y,n){ return '<circle cx="'+x+'" cy="'+y+'" r="11" fill="#00e5c0"/><text x="'+x+'" y="'+(y+4)+'" fill="#0a1628" font-size="11" text-anchor="middle" font-weight="bold" font-family="Arial">'+n+'</text>'; }

  var MOCK_DASHBOARD = wf(620, 320,
    box(0,0,140,320,'#142238','rgba(255,255,255,.05)') +
    txt(15,28,'CRM nav',10,'#9aa7bd') +
    txt(15,52,'• Dashboard',11,'#00e5c0') + txt(15,72,'• Clients',11,'#9aa7bd') +
    txt(15,92,'• Pipeline',11,'#9aa7bd') + txt(15,112,'• Invoices',11,'#9aa7bd') +
    txt(160,28,'DASHBOARD',13,'#fff') + txt(160,46,'Good Liquid · 2026',10,'#9aa7bd') +
    box(160,60,100,52) + txt(170,82,'Collected',9,'#9aa7bd') + txt(170,103,'$0K',13,'#00e5c0') +
    box(270,60,100,52) + txt(280,82,'Pending',9,'#9aa7bd') + txt(280,103,'$0K',13,'#fff') +
    box(380,60,100,52) + txt(390,82,'Overdue',9,'#9aa7bd') + txt(390,103,'$0K',13,'#e74c3c') +
    box(490,60,115,52) + txt(500,82,'Active brands',9,'#9aa7bd') + txt(500,103,'0',13,'#00e5c0') +
    box(160,122,100,52) + txt(170,144,'Avg inv',9,'#9aa7bd') + txt(170,165,'$—',13,'#00e5c0') +
    box(270,122,100,52) + txt(280,144,'Outstanding',9,'#9aa7bd') + txt(280,165,'$0',13,'#f5c842') +
    box(380,122,100,52) + txt(390,144,'Days to paid',9,'#9aa7bd') + txt(390,165,'—',13,'#fff') +
    box(490,122,115,52) + txt(500,144,'Quotes',9,'#9aa7bd') + txt(500,165,'0',13,'#6b9fff') +
    box(160,184,280,120) + txt(300,210,'Revenue by service',10,'#9aa7bd','middle') +
    '<rect x="190" y="240" width="20" height="50" rx="2" fill="#1a6fff"/>' +
    '<rect x="230" y="260" width="20" height="30" rx="2" fill="#00c4a7"/>' +
    '<rect x="270" y="245" width="20" height="45" rx="2" fill="#1a6fff"/>' +
    '<rect x="310" y="270" width="20" height="20" rx="2" fill="#00c4a7"/>' +
    box(450,184,155,120) + txt(460,205,'Recent activity',10,'#9aa7bd') +
    '<line x1="460" y1="220" x2="595" y2="220" stroke="rgba(255,255,255,.05)"/>' +
    txt(460,238,'• Invoice saved',9,'#cfd9e6') + txt(460,256,'• Deal moved',9,'#cfd9e6') + txt(460,274,'• Note added',9,'#cfd9e6') +
    box(160,310,445,8,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') +
    tag(155,60,1) + tag(155,122,2) + tag(155,184,3) + tag(440,184,4) + tag(445,318,5)
  );

  var MOCK_INVOICES = wf(620, 290,
    box(0,0,140,290,'#142238','rgba(255,255,255,.05)') +
    txt(15,28,'CRM nav',10,'#9aa7bd') +
    txt(160,28,'INVOICES',13,'#fff') + txt(160,46,'X invoices',10,'#9aa7bd') +
    box(380,16,80,24,'#00e5c0','#00e5c0') + txt(420,32,'+ New',10,'#0a1628','middle') +
    box(465,16,80,24,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(505,32,'📊 CSV',10,'#00e5c0','middle') +
    box(550,16,55,24,'rgba(245,200,66,.08)','rgba(245,200,66,.3)') + txt(577,32,'📧',10,'#f5c842','middle') +
    box(160,56,445,28) + txt(175,75,'🔍 Search invoices…',11,'#9aa7bd') +
    box(160,96,40,22,'rgba(0,229,192,.2)','rgba(0,229,192,.3)') + txt(180,111,'All',10,'#00e5c0','middle') +
    box(205,96,55,22,'rgba(255,255,255,.04)') + txt(232,111,'Draft',10,'#9aa7bd','middle') +
    box(265,96,65,22,'rgba(255,255,255,.04)') + txt(297,111,'Pending',10,'#9aa7bd','middle') +
    box(335,96,55,22,'rgba(255,255,255,.04)') + txt(362,111,'Paid',10,'#9aa7bd','middle') +
    box(395,96,65,22,'rgba(255,255,255,.04)') + txt(427,111,'Overdue',10,'#9aa7bd','middle') +
    box(465,96,55,22,'rgba(255,255,255,.04)') + txt(492,111,'Quote',10,'#6b9fff','middle') +
    box(160,130,445,150) +
    '<line x1="160" y1="160" x2="605" y2="160" stroke="rgba(255,255,255,.06)"/>' +
    txt(170,150,'Invoice #',9,'#9aa7bd') + txt(245,150,'Client',9,'#9aa7bd') +
    txt(320,150,'Amount',9,'#9aa7bd') + txt(380,150,'Status',9,'#9aa7bd') + txt(455,150,'Actions',9,'#9aa7bd') +
    txt(170,180,'GL-1001',10,'#00e5c0') + txt(245,180,'Acme Co.',10,'#fff') + txt(320,180,'$3,850',10,'#fff') +
    box(380,170,55,16,'rgba(245,200,66,.12)','rgba(245,200,66,.3)') + txt(407,182,'pending',9,'#f5c842','middle') +
    box(455,170,35,16,'rgba(34,197,94,.15)','rgba(34,197,94,.3)') + txt(472,182,'Paid',8,'#22c55e','middle') +
    box(495,170,25,16,'rgba(168,85,247,.15)') + txt(507,182,'💳',9,'#c4a4f8','middle') +
    box(525,170,40,16,'rgba(255,255,255,.06)') + txt(545,182,'👁',9,'#9aa7bd','middle') +
    txt(170,210,'GL-1002',10,'#00e5c0') + txt(245,210,'Beta Brands',10,'#fff') + txt(320,210,'$5,420',10,'#fff') +
    box(380,200,55,16,'rgba(107,159,255,.12)','rgba(107,159,255,.3)') + txt(407,212,'quote',9,'#6b9fff','middle') +
    box(455,200,75,16,'rgba(107,159,255,.15)','rgba(107,159,255,.3)') + txt(492,212,'→ Invoice',8,'#6b9fff','middle') +
    tag(380,16,1) + tag(465,16,2) + tag(550,16,3) + tag(160,96,4) + tag(530,178,5) + tag(490,210,6)
  );

  var MOCK_NEWINV = wf(620, 320,
    box(0,0,620,320,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'NEW INVOICE',13,'#00e5c0') +
    box(20,48,180,46) + txt(28,64,'Client *',9,'#9aa7bd') + txt(28,84,'— pick a client —',11,'#cfd9e6') +
    box(210,48,180,46) + txt(218,64,'Invoice date',9,'#9aa7bd') + txt(218,84,'2026-05-15',11,'#fff') +
    box(400,48,200,46) + txt(408,64,'Invoice #',9,'#9aa7bd') + txt(408,84,'GL-1001',11,'#fff') +
    box(20,104,90,26,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(65,121,'+ Canning',10,'#00e5c0','middle') +
    box(115,104,90,26,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(160,121,'+ Bottling',10,'#00e5c0','middle') +
    box(210,104,90,26,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(255,121,'+ R&amp;D',10,'#00e5c0','middle') +
    box(305,104,90,26,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(350,121,'+ Hours',10,'#00e5c0','middle') +
    box(400,104,90,26,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(445,121,'+ Custom',10,'#00e5c0','middle') +
    box(20,140,580,90) +
    txt(30,156,'Canning · 12oz Std',10,'#00e5c0') + txt(180,156,'150 cases',10,'#fff') + txt(280,156,'$11.52/case',10,'#9aa7bd') + txt(540,156,'$1,728.00',11,'#fff','end') +
    '<line x1="30" y1="170" x2="590" y2="170" stroke="rgba(255,255,255,.05)"/>' +
    txt(30,188,'Bottling · 750ml',10,'#00e5c0') + txt(180,188,'500 btl',10,'#fff') + txt(280,188,'$1.85/btl',10,'#9aa7bd') + txt(540,188,'$925.00',11,'#fff','end') +
    '<line x1="30" y1="202" x2="590" y2="202" stroke="rgba(255,255,255,.05)"/>' +
    txt(30,220,'R&amp;D · Formulation',10,'#00e5c0') + txt(180,220,'1',10,'#fff') + txt(280,220,'$1,500',10,'#9aa7bd') + txt(540,220,'$1,500.00',11,'#fff','end') +
    box(360,240,240,32) + txt(370,260,'Discount %',9,'#9aa7bd') + txt(550,260,'0',10,'#fff','end') +
    box(360,278,240,28,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(370,296,'TOTAL',10,'#00e5c0') + txt(590,296,'$4,153.00',12,'#00e5c0','end') +
    box(20,278,75,28,'#00e5c0','#00e5c0') + txt(57,296,'💾 Save',10,'#0a1628','middle') +
    box(100,278,90,28,'rgba(107,159,255,.12)','rgba(107,159,255,.3)') + txt(145,296,'💾 Quote',10,'#6b9fff','middle') +
    box(195,278,75,28,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(232,296,'📄 PDF',10,'#00e5c0','middle') +
    box(275,278,80,28,'rgba(107,159,255,.12)','rgba(107,159,255,.3)') + txt(315,296,'📋 Q-PDF',10,'#6b9fff','middle') +
    tag(20,48,1) + tag(20,104,2) + tag(20,140,3) + tag(360,240,4) + tag(20,278,5)
  );

  var MOCK_USERS = wf(620, 250,
    box(0,0,620,250,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'USERS &amp; PERMISSIONS',13,'#fff') + txt(20,46,'Manage team access',10,'#9aa7bd') +
    box(380,16,80,24,'#00e5c0','#00e5c0') + txt(420,32,'+ Invite',10,'#0a1628','middle') +
    box(465,16,110,24,'rgba(0,229,192,.08)','rgba(0,229,192,.3)') + txt(520,32,'📋 Activity log',9,'#00e5c0','middle') +
    box(20,60,180,42,'rgba(0,229,192,.06)','rgba(0,229,192,.18)') + txt(30,78,'👑 ADMIN',10,'#00e5c0') + txt(30,94,'Full access',9,'#9aa7bd') +
    box(210,60,180,42,'rgba(26,111,255,.06)','rgba(26,111,255,.18)') + txt(220,78,'💼 SALES',10,'#6b9fff') + txt(220,94,'CRM only',9,'#9aa7bd') +
    box(400,60,200,42,'rgba(255,255,255,.04)') + txt(410,78,'👁 VIEWER',10,'#9aa7bd') + txt(410,94,'Read only',9,'#9aa7bd') +
    box(20,114,580,120) +
    txt(30,134,'Name',9,'#9aa7bd') + txt(180,134,'Email',9,'#9aa7bd') + txt(310,134,'Role',9,'#9aa7bd') + txt(390,134,'Actions',9,'#9aa7bd') +
    '<line x1="30" y1="142" x2="590" y2="142" stroke="rgba(255,255,255,.06)"/>' +
    txt(30,160,'Mike Krail',11,'#fff') + txt(180,160,'mike@goodliquid.com',10,'#9aa7bd') +
    box(310,150,55,16,'rgba(245,200,66,.12)','rgba(245,200,66,.3)') + txt(337,162,'admin',9,'#f5c842','middle') +
    txt(390,160,'Owner',10,'#9aa7bd') +
    txt(30,190,'Sandra Krail',11,'#fff') + txt(180,190,'sandra@goodliquid.com',10,'#9aa7bd') +
    box(310,180,55,18,'#243a56','rgba(255,255,255,.18)') + txt(337,193,'sales ▾',9,'#fff','middle') +
    box(375,180,72,18,'rgba(255,255,255,.06)') + txt(411,193,'Set password',8,'#fff','middle') +
    box(450,180,68,18,'rgba(245,200,66,.08)','rgba(245,200,66,.3)') + txt(484,193,'Email reset',8,'#f5c842','middle') +
    box(522,180,55,18,'rgba(231,76,60,.15)','rgba(231,76,60,.3)') + txt(549,193,'Remove',8,'#e74c3c','middle') +
    tag(380,16,1) + tag(465,16,2) + tag(20,60,3) + tag(310,180,4) + tag(450,180,5)
  );

  var MOCK_PIPELINE = wf(620, 280,
    box(0,0,620,280,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'PIPELINE',13,'#fff') + txt(20,46,'X active deals',10,'#9aa7bd') +
    box(520,16,80,24,'#00e5c0','#00e5c0') + txt(560,32,'+ Add Deal',9,'#0a1628','middle') +
    // 5 columns
    box(20,60,110,210,'#243a56','rgba(255,255,255,.06)') + txt(28,80,'Prospecting',10,'#6b87ad') + txt(118,80,'2',10,'#9aa7bd','end') +
    box(20,98,110,52,'#1c2e48','rgba(255,255,255,.08)') + txt(28,116,'NorthWave',10,'#fff') + txt(28,130,'NorthWave Drinks',8,'#9aa7bd') + txt(28,144,'$11,000',9,'#00e5c0') +
    box(20,156,110,52,'#1c2e48','rgba(255,255,255,.08)') + txt(28,174,'Datasphere',10,'#fff') + txt(28,188,'Datasphere',8,'#9aa7bd') + txt(28,202,'$22,000',9,'#00e5c0') +
    // stale badge example on first card
    '<circle cx="120" cy="106" r="9" fill="rgba(245,200,66,.4)"/>' + txt(120,110,'⏰',8,'#f5c842','middle') +
    box(140,60,110,210,'#243a56','rgba(255,255,255,.06)') + txt(148,80,'Proposal',10,'#1a6fff') + txt(238,80,'2',10,'#9aa7bd','end') +
    box(140,98,110,52,'#1c2e48','rgba(255,255,255,.08)') + txt(148,116,'Harbor Pilot',10,'#fff') + txt(148,130,'Harbor Brew',8,'#9aa7bd') + txt(148,144,'$5,200',9,'#00e5c0') +
    box(140,156,110,52,'#1c2e48','rgba(255,255,255,.08)') + txt(148,174,'Bloom Batch #3',10,'#fff') + txt(148,188,'Bloom Functional',8,'#9aa7bd') + txt(148,202,'$18,400',9,'#00e5c0') +
    box(260,60,110,210,'#243a56','rgba(255,255,255,.06)') + txt(268,80,'Negotiation',10,'#f5c842') + txt(358,80,'1',10,'#9aa7bd','end') +
    box(260,98,110,52,'#1c2e48','rgba(255,255,255,.08)') + txt(268,116,'Verde IP',10,'#fff') + txt(268,130,'Verde Wellness',8,'#9aa7bd') + txt(268,144,'$6,000',9,'#00e5c0') +
    box(380,60,110,210,'#243a56','rgba(255,255,255,.06)') + txt(388,80,'Closed Won',10,'#00c4a7') + txt(478,80,'1',10,'#9aa7bd','end') +
    box(380,98,110,52,'#1c2e48','rgba(255,255,255,.08)') + txt(388,116,'SunBurst Q2',10,'#fff') + txt(388,130,'SunBurst',8,'#9aa7bd') + txt(388,144,'$35,820',9,'#00e5c0') +
    box(500,60,110,210,'#243a56','rgba(255,255,255,.06)') + txt(508,80,'Closed Lost',10,'#e74c3c') + txt(598,80,'0',10,'#9aa7bd','end') +
    tag(520,16,1) + tag(75,98,2) + tag(135,106,3) + tag(380,98,4)
  );

  var MOCK_CLIENTS = wf(620, 240,
    box(0,0,620,240,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'CLIENTS',13,'#fff') + txt(20,46,'X active brands',10,'#9aa7bd') +
    box(510,16,90,24,'#00e5c0','#00e5c0') + txt(555,32,'+ Add Client',9,'#0a1628','middle') +
    box(20,56,580,28) + txt(35,75,'🔍 Search clients…',11,'#9aa7bd') +
    box(20,96,580,130) +
    '<line x1="20" y1="124" x2="600" y2="124" stroke="rgba(255,255,255,.06)"/>' +
    txt(30,116,'Brand',9,'#9aa7bd') + txt(180,116,'Contact',9,'#9aa7bd') + txt(290,116,'Service',9,'#9aa7bd') + txt(400,116,'Status',9,'#9aa7bd') + txt(490,116,'Total billed',9,'#9aa7bd') +
    '<circle cx="40" cy="148" r="10" fill="#1a3a6e"/><text x="40" y="151" fill="#9FE1CB" font-size="9" text-anchor="middle" font-family="Arial">TT</text>' +
    txt(58,151,'Tide & Taste Co.',10,'#fff') + txt(180,151,'Jordan Mills',9,'#9aa7bd') + txt(290,151,'Canning',10,'#cfd9e6') +
    box(400,142,55,16,'rgba(34,197,94,.15)','rgba(34,197,94,.3)') + txt(427,154,'active',9,'#22c55e','middle') +
    txt(490,151,'$48,240',10,'#00e5c0') +
    '<circle cx="40" cy="178" r="10" fill="#0F6E56"/><text x="40" y="181" fill="#E1F5EE" font-size="9" text-anchor="middle" font-family="Arial">BF</text>' +
    txt(58,181,'Bloom Functional',10,'#fff') + txt(180,181,'Riley Park',9,'#9aa7bd') + txt(290,181,'R&amp;D + Canning',10,'#cfd9e6') +
    box(400,172,55,16,'rgba(34,197,94,.15)','rgba(34,197,94,.3)') + txt(427,184,'active',9,'#22c55e','middle') +
    txt(490,181,'$24,800',10,'#00e5c0') +
    '<circle cx="40" cy="208" r="10" fill="#854F0B"/><text x="40" y="211" fill="#FAEEDA" font-size="9" text-anchor="middle" font-family="Arial">SS</text>' +
    txt(58,211,'SunBurst Seltzers',10,'#fff') + txt(180,211,'Alex Torres',9,'#9aa7bd') + txt(290,211,'Canning',10,'#cfd9e6') +
    box(400,202,45,16,'rgba(107,159,255,.15)','rgba(107,159,255,.3)') + txt(422,214,'lead',9,'#6b9fff','middle') +
    txt(490,211,'$0',10,'#9aa7bd') +
    tag(510,16,1) + tag(20,96,2) + tag(58,151,3) + tag(400,151,4)
  );

  var MOCK_REFERRALS = wf(620, 220,
    box(0,0,620,220,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'REFERRALS',13,'#fff') + txt(20,46,'X tracked',10,'#9aa7bd') +
    box(490,16,110,24,'#00e5c0','#00e5c0') + txt(545,32,'+ Add referral',9,'#0a1628','middle') +
    box(20,56,580,150) +
    '<line x1="20" y1="84" x2="600" y2="84" stroke="rgba(255,255,255,.06)"/>' +
    txt(30,76,'Referrer',9,'#9aa7bd') + txt(150,76,'Client',9,'#9aa7bd') + txt(270,76,'Deal',9,'#9aa7bd') + txt(360,76,'Rate',9,'#9aa7bd') + txt(420,76,'Commission',9,'#9aa7bd') + txt(520,76,'Status',9,'#9aa7bd') +
    txt(30,108,'Jake Denton',10,'#fff') + txt(150,108,'SunBurst',10,'#cfd9e6') + txt(270,108,'$35,820',10,'#cfd9e6') + txt(360,108,'5%',10,'#9aa7bd') + txt(420,108,'$1,791',10,'#00e5c0') +
    box(520,98,55,16,'rgba(34,197,94,.15)','rgba(34,197,94,.3)') + txt(547,110,'paid',9,'#22c55e','middle') +
    txt(30,140,'Maria Santos',10,'#fff') + txt(150,140,'Bloom',10,'#cfd9e6') + txt(270,140,'$16,000',10,'#cfd9e6') + txt(360,140,'7%',10,'#9aa7bd') + txt(420,140,'$1,120',10,'#00e5c0') +
    box(520,130,55,16,'rgba(245,200,66,.15)','rgba(245,200,66,.3)') + txt(547,142,'won',9,'#f5c842','middle') +
    box(580,130,15,16,'rgba(245,200,66,.18)','rgba(245,200,66,.4)') + txt(587,142,'✓',9,'#f5c842','middle') +
    txt(30,172,'Dave Okafor',10,'#fff') + txt(150,172,'Crest Bev',10,'#cfd9e6') + txt(270,172,'$22,000',10,'#cfd9e6') + txt(360,172,'6%',10,'#9aa7bd') + txt(420,172,'$1,320',10,'#9aa7bd') +
    box(520,162,55,16,'rgba(231,76,60,.15)','rgba(231,76,60,.3)') + txt(547,174,'lost',9,'#e74c3c','middle') +
    tag(490,16,1) + tag(520,108,2) + tag(595,140,3)
  );

  var MOCK_REFERRERS = wf(620, 220,
    box(0,0,620,220,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'REFERRERS',13,'#fff') + txt(20,46,'External partners',10,'#9aa7bd') +
    box(480,16,120,24,'#00e5c0','#00e5c0') + txt(540,32,'+ Add referrer',9,'#0a1628','middle') +
    // 3 referrer cards
    box(20,60,190,150) +
    '<circle cx="44" cy="84" r="12" fill="#1a3a6e"/><text x="44" y="88" fill="#9FE1CB" font-size="10" text-anchor="middle" font-family="Arial">JD</text>' +
    txt(64,82,'Jake Denton',11,'#fff') + txt(64,98,'Broker',9,'#9aa7bd') +
    txt(30,124,'jake@dentonsales.com',9,'#9aa7bd') + txt(30,142,'(813) 555-0144',9,'#9aa7bd') +
    txt(30,168,'Rate: 5% · 2 referrals',9,'#cfd9e6') + box(30,178,160,22,'rgba(245,200,66,.08)','rgba(245,200,66,.3)') + txt(110,193,'$1,791 owed',9,'#f5c842','middle') +
    box(220,60,190,150) +
    '<circle cx="244" cy="84" r="12" fill="#0F6E56"/><text x="244" y="88" fill="#E1F5EE" font-size="10" text-anchor="middle" font-family="Arial">MS</text>' +
    txt(264,82,'Maria Santos',11,'#fff') + txt(264,98,'Industry contact',9,'#9aa7bd') +
    txt(230,124,'msantos@bevworld.com',9,'#9aa7bd') + txt(230,142,'(727) 555-0289',9,'#9aa7bd') +
    txt(230,168,'Rate: 7% · 2 referrals',9,'#cfd9e6') + box(230,178,160,22,'rgba(29,158,117,.08)','rgba(29,158,117,.3)') + txt(310,193,'$1,120 paid YTD',9,'#1D9E75','middle') +
    box(420,60,190,150) +
    '<circle cx="444" cy="84" r="12" fill="#854F0B"/><text x="444" y="88" fill="#FAEEDA" font-size="10" text-anchor="middle" font-family="Arial">DO</text>' +
    txt(464,82,'Dave Okafor',11,'#fff') + txt(464,98,'Business partner',9,'#9aa7bd') +
    txt(430,124,'dave@okaforgroup.com',9,'#9aa7bd') + txt(430,142,'(941) 555-0076',9,'#9aa7bd') +
    txt(430,168,'Rate: 6% · 1 referral',9,'#cfd9e6') + box(430,178,160,22,'rgba(255,255,255,.04)') + txt(510,193,'$0 owed',9,'#9aa7bd','middle') +
    tag(480,16,1) + tag(20,60,2)
  );

  var MOCK_DOCUMENTS = wf(620, 230,
    box(0,0,620,230,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'DOCUMENTS',13,'#fff') + txt(20,46,'Per-client file storage',10,'#9aa7bd') +
    box(490,16,110,24,'#00e5c0','#00e5c0') + txt(545,32,'+ Upload',9,'#0a1628','middle') +
    box(20,60,580,160) +
    '<line x1="20" y1="88" x2="600" y2="88" stroke="rgba(255,255,255,.06)"/>' +
    txt(30,80,'Name',9,'#9aa7bd') + txt(220,80,'Client',9,'#9aa7bd') + txt(340,80,'Type',9,'#9aa7bd') + txt(420,80,'Uploaded',9,'#9aa7bd') + txt(530,80,'Action',9,'#9aa7bd') +
    txt(30,108,'📄 Bloom Master Formula.pdf',10,'#fff') + txt(220,108,'Bloom Functional',10,'#cfd9e6') +
    box(340,98,55,16,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') + txt(367,110,'R&amp;D',9,'#00e5c0','middle') +
    txt(420,108,'2026-05-12',10,'#9aa7bd') +
    box(530,98,55,16,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') + txt(557,110,'⬇ Open',9,'#00e5c0','middle') +
    txt(30,140,'🖼️ SunBurst label artwork.png',10,'#fff') + txt(220,140,'SunBurst Seltzers',10,'#cfd9e6') +
    box(340,130,55,16,'rgba(168,85,247,.1)','rgba(168,85,247,.3)') + txt(367,142,'design',9,'#c4a4f8','middle') +
    txt(420,140,'2026-05-08',10,'#9aa7bd') +
    box(530,130,55,16,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') + txt(557,142,'⬇ Open',9,'#00e5c0','middle') +
    txt(30,172,'📊 Q2 production schedule.xlsx',10,'#fff') + txt(220,172,'(general)',10,'#9aa7bd') +
    box(340,162,55,16,'rgba(245,200,66,.1)','rgba(245,200,66,.3)') + txt(367,174,'ops',9,'#f5c842','middle') +
    txt(420,172,'2026-05-01',10,'#9aa7bd') +
    box(530,162,55,16,'rgba(0,229,192,.1)','rgba(0,229,192,.3)') + txt(557,174,'⬇ Open',9,'#00e5c0','middle') +
    txt(30,205,'Files persist to Supabase Storage (client-docs bucket)',9,'#9aa7bd') +
    tag(490,16,1) + tag(20,60,2) + tag(530,108,3)
  );

  var MOCK_CALENDAR = wf(620, 250,
    box(0,0,620,250,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'CALENDAR',13,'#fff') + txt(20,46,'General events & tour requests',10,'#9aa7bd') +
    box(420,16,40,24,'rgba(255,255,255,.06)') + txt(440,32,'‹',12,'#fff','middle') +
    txt(490,32,'May 2026',11,'#fff','middle') +
    box(540,16,40,24,'rgba(255,255,255,.06)') + txt(560,32,'›',12,'#fff','middle') +
    // 7-col grid header
    ['Su','Mo','Tu','We','Th','Fr','Sa'].map(function(d,i){ return txt(60 + i*78, 76, d, 10, '#9aa7bd','middle'); }).join('') +
    // 5 rows × 7 cols grid (simplified)
    (function(){
      var cells = '';
      for(var r=0; r<4; r++){
        for(var c=0; c<7; c++){
          var x = 26 + c*78, y = 90 + r*36;
          cells += box(x, y, 70, 30, 'rgba(255,255,255,.02)', 'rgba(255,255,255,.04)');
          cells += txt(x+8, y+18, (r*7+c+1), 10, '#cfd9e6');
        }
      }
      return cells;
    })() +
    // Highlight one cell with an event
    '<rect x="338" y="126" width="70" height="30" rx="6" fill="rgba(0,229,192,.12)" stroke="rgba(0,229,192,.4)"/>' +
    txt(346,144,'15',10,'#00e5c0') + box(363,134,42,12,'rgba(0,229,192,.18)','rgba(0,229,192,.4)') + txt(384,143,'Tour',8,'#00e5c0','middle') +
    txt(20,240,'Public "Schedule a tour" submissions land here automatically.',9,'#9aa7bd') +
    tag(338,126,1) + tag(420,16,2)
  );

  var MOCK_TASKS = wf(620, 220,
    box(0,0,620,220,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'TASKS',13,'#fff') + txt(20,46,'Personal to-do list',10,'#9aa7bd') +
    box(510,16,90,24,'#00e5c0','#00e5c0') + txt(555,32,'+ Add Task',9,'#0a1628','middle') +
    // Filter pills
    box(20,56,55,22,'rgba(0,229,192,.2)','rgba(0,229,192,.3)') + txt(47,71,'All',10,'#00e5c0','middle') +
    box(80,56,65,22,'rgba(255,255,255,.04)') + txt(112,71,'Open',10,'#9aa7bd','middle') +
    box(150,56,75,22,'rgba(255,255,255,.04)') + txt(187,71,'Done',10,'#9aa7bd','middle') +
    // Task rows
    box(20,90,580,120) +
    box(36,104,14,14,'rgba(255,255,255,.04)','rgba(255,255,255,.18)') +
    txt(60,116,'Follow up with Bloom on Q3 volume',11,'#fff') + box(440,108,90,16,'rgba(26,111,255,.12)','rgba(26,111,255,.3)') + txt(485,120,'Bloom Functional',9,'#6b9fff','middle') +
    box(540,108,55,16,'rgba(245,200,66,.12)','rgba(245,200,66,.3)') + txt(567,120,'due today',9,'#f5c842','middle') +
    box(36,134,14,14,'#00e5c0','#00e5c0') + txt(43,144,'✓',10,'#0a1628','middle') +
    txt(60,146,'Send tour confirmation to Verde',11,'#9aa7bd','start') +
    '<line x1="60" y1="142" x2="380" y2="142" stroke="#9aa7bd" stroke-opacity=".5"/>' +
    txt(440,146,'completed yesterday',9,'#9aa7bd') +
    box(36,164,14,14,'rgba(255,255,255,.04)','rgba(255,255,255,.18)') +
    txt(60,176,'Reply to NorthWave intro email',11,'#fff') + box(440,168,90,16,'rgba(26,111,255,.12)','rgba(26,111,255,.3)') + txt(485,180,'NorthWave',9,'#6b9fff','middle') +
    box(36,194,14,14,'rgba(255,255,255,.04)','rgba(255,255,255,.18)') +
    txt(60,206,'Order more 12oz Sleek cans',11,'#fff') + txt(440,206,'no client',9,'#9aa7bd') +
    tag(510,16,1) + tag(36,104,2) + tag(540,108,3)
  );

  var MOCK_INVENTORY = wf(620, 220,
    box(0,0,620,220,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'INVENTORY',13,'#fff') + txt(20,46,'Stock tracker',10,'#9aa7bd') +
    box(510,16,90,24,'#00e5c0','#00e5c0') + txt(555,32,'+ Add Item',9,'#0a1628','middle') +
    box(20,60,580,150) +
    '<line x1="20" y1="88" x2="600" y2="88" stroke="rgba(255,255,255,.06)"/>' +
    txt(30,80,'Item',9,'#9aa7bd') + txt(280,80,'Quantity',9,'#9aa7bd') + txt(380,80,'Unit',9,'#9aa7bd') + txt(470,80,'Low at',9,'#9aa7bd') + txt(550,80,'Status',9,'#9aa7bd') +
    txt(30,108,'12oz Standard Cans',11,'#fff') + txt(280,108,'1,200',11,'#00e5c0') + txt(380,108,'cases',10,'#cfd9e6') + txt(470,108,'200',10,'#9aa7bd') +
    box(540,98,50,16,'rgba(34,197,94,.15)','rgba(34,197,94,.3)') + txt(565,110,'OK',9,'#22c55e','middle') +
    txt(30,138,'CO₂ Gas',11,'#fff') + txt(280,138,'2',11,'#f5c842') + txt(380,138,'tanks',10,'#cfd9e6') + txt(470,138,'3',10,'#9aa7bd') +
    box(540,128,50,16,'rgba(245,200,66,.15)','rgba(245,200,66,.3)') + txt(565,140,'LOW',9,'#f5c842','middle') +
    txt(30,168,'PakTech Handles',11,'#fff') + txt(280,168,'500',11,'#00e5c0') + txt(380,168,'bags',10,'#cfd9e6') + txt(470,168,'100',10,'#9aa7bd') +
    box(540,158,50,16,'rgba(34,197,94,.15)','rgba(34,197,94,.3)') + txt(565,170,'OK',9,'#22c55e','middle') +
    txt(30,196,'750ml Bottles',11,'#fff') + txt(280,196,'220',11,'#00e5c0') + txt(380,196,'cases',10,'#cfd9e6') + txt(470,196,'50',10,'#9aa7bd') +
    box(540,186,50,16,'rgba(34,197,94,.15)','rgba(34,197,94,.3)') + txt(565,198,'OK',9,'#22c55e','middle') +
    tag(510,16,1) + tag(540,138,2)
  );

  var MOCK_CUSTOMERS = wf(620, 200,
    box(0,0,620,200,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'CUSTOMER LOGINS',13,'#fff') + txt(20,46,'Portal access for your clients',10,'#9aa7bd') +
    box(420,16,180,24,'#00e5c0','#00e5c0') + txt(510,32,'📧 Send Onboarding Email',9,'#0a1628','middle') +
    box(20,60,580,120) +
    '<line x1="20" y1="88" x2="600" y2="88" stroke="rgba(255,255,255,.06)"/>' +
    txt(30,80,'Name',9,'#9aa7bd') + txt(220,80,'Email',9,'#9aa7bd') + txt(390,80,'Created',9,'#9aa7bd') + txt(500,80,'Actions',9,'#9aa7bd') +
    txt(30,108,'Jordan Mills',11,'#fff') + txt(220,108,'jordan@tidetaste.com',10,'#9aa7bd') + txt(390,108,'2026-05-10',10,'#9aa7bd') +
    box(500,98,55,16,'rgba(245,200,66,.12)','rgba(245,200,66,.3)') + txt(527,110,'reset',9,'#f5c842','middle') +
    box(560,98,40,16,'rgba(231,76,60,.15)','rgba(231,76,60,.3)') + txt(580,110,'remove',8,'#e74c3c','middle') +
    txt(30,140,'Riley Park',11,'#fff') + txt(220,140,'r.park@bloomfx.com',10,'#9aa7bd') + txt(390,140,'2026-05-08',10,'#9aa7bd') +
    box(500,130,55,16,'rgba(245,200,66,.12)','rgba(245,200,66,.3)') + txt(527,142,'reset',9,'#f5c842','middle') +
    box(560,130,40,16,'rgba(231,76,60,.15)','rgba(231,76,60,.3)') + txt(580,142,'remove',8,'#e74c3c','middle') +
    tag(420,16,1) + tag(500,108,2)
  );

  var MOCK_SETTINGS = wf(620, 320,
    box(0,0,620,320,'#142238','rgba(255,255,255,.05)') +
    txt(20,28,'CRM AREA',13,'#9aa7bd') + txt(20,46,'(any panel)',10,'#9aa7bd') +
    // Floating 🤖 FAB bottom-right
    '<circle cx="560" cy="270" r="26" fill="url(#fabGrad)"/>' +
    '<defs><linearGradient id="fabGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#00e5c0"/><stop offset="100%" stop-color="#1a6fff"/></linearGradient></defs>' +
    txt(560,277,'🤖',18,'#0a1628','middle') +
    // Popout menu above the FAB
    box(420,60,180,200) +
    txt(515,80,'AI tools',10,'#9aa7bd','middle') +
    box(432,90,156,22,'rgba(0,229,192,.06)') + txt(440,105,'💰 Estimate Quote',10,'#00e5c0') +
    box(432,116,156,22,'rgba(0,229,192,.06)') + txt(440,131,'🧾 Draft Invoice',10,'#00e5c0') +
    box(432,142,156,22,'rgba(0,229,192,.06)') + txt(440,157,'📝 Meeting Notes',10,'#00e5c0') +
    box(432,168,156,22,'rgba(0,229,192,.06)') + txt(440,183,'✉️ Draft Email',10,'#00e5c0') +
    box(432,194,156,22,'rgba(0,229,192,.06)') + txt(440,209,'📧 Mailgun Settings',10,'#00e5c0') +
    box(432,220,156,22,'rgba(0,229,192,.06)') + txt(440,235,'🤖 AI Settings',10,'#00e5c0') +
    box(432,246,156,22,'rgba(231,76,60,.08)','rgba(231,76,60,.3)') + txt(440,261,'🗑️ Clear cache',10,'#ff8579') +
    // Arrow from popout to FAB
    '<line x1="560" y1="262" x2="540" y2="245" stroke="rgba(255,255,255,.2)" stroke-dasharray="3,3"/>' +
    tag(560,247,1) + tag(515,60,2)
  );

  var SEC_OVERVIEW = bullets([
    '<b>Quick search:</b> press <kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.1)">Ctrl+K</kbd> anywhere to jump to an invoice, client, deal, or user by name.',
    '<b>This help panel:</b> press <kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.1)">?</kbd> any time, or click ❓ Help in the topbar. It opens to the section matching the page you\'re on.',
    '<b>AI tools:</b> the floating 🤖 button bottom-right opens a menu of AI helpers plus all the settings (Mailgun, AI key, Email signature, Clear local cache).',
    '<b>Data sync:</b> invoices, clients, deals, referrers, referrals, and user profiles all live in Supabase and sync across devices. Tasks, calendar, notifications, and the activity feed live in localStorage (per device).'
  ]);

  var SEC_DASHBOARD = MOCK_DASHBOARD +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) Top metrics row</b> — Total collected (paid YTD), Pending, Overdue, Active brands.',
      '<b>(2) Second KPI row</b> — Avg invoice value, Outstanding ($ pending + overdue), Avg days to paid, Quotes pending.',
      '<b>(3) Revenue by service chart</b> — bar chart split by Canning / R&D / Bottling / Consulting. Mixed-service invoices split per line item.',
      '<b>(4) Recent activity feed</b> — last few CRM actions; click to jump to the related screen.',
      '<b>(5) System Health widget</b> (admin only) — ✓ or ✗ for Supabase Auth, Mailgun key, AI key, audit_log table, client-docs bucket. Each ✗ has a one-click fix button.'
    ]);

  var SEC_INVOICES = MOCK_INVOICES +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) + New invoice</b> — opens the builder modal.',
      '<b>(2) 📊 Export CSV</b> — downloads every non-quote invoice as CSV (drop into QuickBooks or hand to your accountant).',
      '<b>(3) 📧 Send overdue reminders</b> — confirms, then emails every overdue client at once using Mailgun + your email signature.',
      '<b>(4) Status filter pills</b> — All / Draft / Pending / Paid / Overdue / Quote.',
      '<b>(5) Row actions</b> — 💳 opens the Stripe pay link for that invoice; 👁 opens the invoice detail.',
      '<b>(6) → Invoice button</b> — appears on quote-status rows. One-click conversion from "quote" to billable "pending".'
    ]);

  var SEC_NEWINV = MOCK_NEWINV +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) Client / date / invoice #</b> — client dropdown is required; date defaults to today; invoice # auto-generates.',
      '<b>(2) Add-line buttons</b> — Canning, Bottling, R&D / IP, Production Hours, Custom. Canning & Bottling auto-tier their per-unit rate from Supabase canning_rates / bottling_rates.',
      '<b>(3) Line rows</b> — change quantity inline; per-case / per-unit price and totals update live. The X on the right removes a line.',
      '<b>(4) Discount + total</b> — enter a discount percent; subtotal and grand total recompute live.',
      '<b>(5) Save buttons</b> — 💾 Save Invoice (status=pending), 💾 Save as Quote (status=quote), 📄 Save & Export PDF (real invoice PDF), 📋 Export as Quote (PDF only with 30-day validity, no DB save).'
    ]);

  var SEC_USERS = MOCK_USERS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) + Invite</b> — creates a Supabase Auth account. Invitee clicks the email confirmation link before they can log in.',
      '<b>(2) 📋 Activity log</b> — last 100 audit_log entries. Requires the audit_log table SQL.',
      '<b>(3) Role legend</b> — Admin (full access), Sales (CRM only), Viewer (read-only).',
      '<b>(4) Role dropdown per row</b> — change role inline. Persists to profiles immediately.',
      '<b>(5) Row actions</b> — Set password (masked-input modal → admin_set_user_password RPC, no email), Email reset (Supabase recovery email), Remove (soft-delete via profile.status = inactive). Owner row is locked.'
    ]);

  var SEC_CLIENTS = MOCK_CLIENTS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) + Add Client</b> — header button. Opens a modal: name, contact, email, service, status (lead / active).',
      '<b>(2) Search bar</b> — filters the list as you type (matches across name / contact / email).',
      '<b>(3) Row click</b> — opens the client detail panel: billed-to-date, recent invoices, deals, notes, 🤖 AI Summary button.',
      '<b>(4) Status badge</b> — green = active, blue = lead. Active clients count toward the dashboard "Active brands" metric. New clients persist to Supabase.'
    ]);

  var SEC_PIPELINE = MOCK_PIPELINE +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) + Add Deal</b> — creates a card in Prospecting. Click any card to open the deal detail modal (edit name / company / value / probability / notes / stage).',
      '<b>(2) Deal card</b> — name, company, value. Click to open detail. Drag cards between columns (or use the arrow buttons inside each card).',
      '<b>(3) ⏰ Stale badge</b> — appears on cards in active stages (Prospecting / Proposal / Negotiation) that haven\'t been touched in >14 days. Visual cue to follow up.',
      '<b>(4) Closed Won column</b> — moving a card here also auto-bumps the related Activity Feed. Use the <b>→ Invoice</b> button in the deal detail to spin a billable invoice from a Closed Won deal.'
    ]);

  var SEC_REFERRALS = MOCK_REFERRALS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) + Add referral</b> — pick a referrer, type the client name, deal value, rate %, status (lead / presented / won / paid / lost).',
      '<b>(2) Status badge</b> — color-coded. Won = commission "owed" on the dashboard referrer card. Paid = counts toward "Paid YTD".',
      '<b>(3) ✓ Pay commission</b> — appears on Won rows. Click to mark the commission paid, recompute YTD totals, and log to Activity.'
    ]);

  var SEC_REFERRERS = MOCK_REFERRERS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) + Add referrer</b> — name, relationship (broker / industry contact / business partner), email, phone, default commission rate %.',
      '<b>(2) Referrer card</b> — avatar, name, relationship, contact info, rate %, count of referrals, and current owed / paid YTD badge. Mirrors what appears on the dashboard.'
    ]);
  var SEC_ACTIVITY = bullets([
    'Chronological log of CRM events: calls, emails, referrals, deal moves, notes, commissions.',
    'Stored in localStorage (gl_activities). <b>Per device</b>, capped at 100.',
    'Distinct from the <b>audit_log</b> (security-relevant admin actions) — see Users → 📋 Activity log for that.'
  ]);
  var SEC_CALENDAR = MOCK_CALENDAR +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) Day cell with event</b> — green highlight means an event is scheduled. Click any day to add an event or view existing ones.',
      '<b>(2) Month navigation</b> — arrows on either side of the month label move forward / backward.',
      'Public "Schedule a tour" submissions on the marketing site land here automatically. Stored in localStorage (gl_cal_events), per device.'
    ]);

  var SEC_PRODUCTION = bullets([
    'Same calendar mechanics as the General Calendar, but focused on <b>production runs</b>: which client, what format, how many cases, what stage (scheduled / in production / quality check / completed / shipped).',
    'Customers see their own scheduled runs in the Customer Portal automatically.',
    'Stored in localStorage (gl_prod_pipeline).'
  ]);

  var SEC_TASKS = MOCK_TASKS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) + Add Task</b> — name, optional client link, optional due date.',
      '<b>(2) Checkbox</b> — click to mark done. Completed tasks strike through and dim. Filter pills above the list switch between All / Open / Done.',
      '<b>(3) Due-today badge</b> — yellow badge when a task is due today; turns red when overdue. Stored in localStorage (gl_tasks), per device.'
    ]);

  var SEC_DOCUMENTS = MOCK_DOCUMENTS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) + Upload</b> — pick a file (PDF / Word / image / CSV), select the client and document type, upload. Files persist to Supabase Storage in the <b>client-docs</b> bucket.',
      '<b>(2) Document table</b> — every uploaded file with the client name, type badge, uploaded date.',
      '<b>(3) ⬇ Open</b> — opens the file in a new tab from Supabase. Documents are private to authenticated users.',
      'If the bucket isn\'t set up yet, the file metadata is recorded but the file itself isn\'t stored. The dashboard System Health widget surfaces this with a one-click "Copy SQL" button.'
    ]);

  var SEC_INVENTORY = MOCK_INVENTORY +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) + Add Item</b> — name, quantity, unit (cases / tanks / bags / etc.), low-stock threshold.',
      '<b>(2) LOW badge</b> — yellow badge when quantity is at or below the threshold. Items at LOW also surface on the dashboard. Stored in localStorage (gl_inventory).'
    ]);
  var SEC_ANNOUNCEMENTS = bullets([
    'Company-wide notes shown on every user\'s dashboard.',
    'Stored in localStorage.'
  ]);
  var SEC_CUSTOMERS = MOCK_CUSTOMERS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) 📧 Send Onboarding Email</b> — prompts for name + email, creates a portal login with a temp password, emails the customer the login link via Mailgun. Requires Mailgun key (🤖 toolbar → 📧 Mailgun Settings).',
      '<b>(2) Row actions</b> — <span style="color:#f5c842">reset</span> sends a Supabase password recovery email; <span style="color:#e74c3c">remove</span> deletes the portal login.',
      'Customers who log in see invoices addressed to them, 💳 Pay Now buttons (using Stripe links you saved per-invoice), ✓ Accept Quote buttons (emails Mike on click), and a contact form to message you.'
    ]);

  var SEC_SETTINGS = MOCK_SETTINGS +
    '<div style="font-size:11px;color:#9aa7bd;margin-bottom:6px">Numbered callouts on the wireframe above:</div>' +
    bullets([
      '<b>(1) Floating 🤖 button</b> — bottom-right corner of any CRM page. Click to open the menu.',
      '<b>(2) Popout menu</b> — opens above the button. Contains AI tools (Estimate Quote / Draft Invoice / Meeting Notes / Draft Email) AND all settings:',
      '<b>📧 Mailgun Settings</b> — paste your Mailgun private API key. Required for outgoing email. Has a "Test send" button.',
      '<b>🤖 AI Settings</b> — paste your Anthropic API key. Required for 🤖 AI features.',
      '<b>✍️ Email Signature</b> — per-device signature auto-appended to outgoing follow-ups.',
      '<b>🗑️ Clear local cache</b> (admin only, red styling) — per-key opt-in cleanup of gl_* localStorage. Use when handing the device to a new user.',
      'The <b>System Health</b> widget on the dashboard also surfaces missing integrations with one-click fixers.'
    ]);
  var SEC_SHORTCUTS = bullets([
    '<kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.1)">Ctrl+K</kbd> / <kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.1)">⌘K</kbd> — open Global Search across invoices / clients / deals / referrers / users.',
    '<kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.1)">?</kbd> — open this Help panel (auto-scrolled to the section matching your current page).',
    '<kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.1)">Esc</kbd> — close most overlays.',
    '<kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.1)">↑↓</kbd> in Global Search — navigate; <kbd style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.1)">Enter</kbd> opens.'
  ]);

  var HELP_HTML =
    section('help-overview',     '👋 OVERVIEW',                   SEC_OVERVIEW) +
    section('help-dashboard',    '📊 DASHBOARD',                  SEC_DASHBOARD) +
    section('help-clients',      '👥 CLIENTS',                    SEC_CLIENTS) +
    section('help-pipeline',     '📊 PIPELINE (DEALS)',           SEC_PIPELINE) +
    section('help-invoices',     '🧾 INVOICES',                   SEC_INVOICES) +
    section('help-newinv',       '➕ NEW INVOICE BUILDER',         SEC_NEWINV) +
    section('help-referrals',    '🤝 REFERRALS',                  SEC_REFERRALS) +
    section('help-referrers',    '👤 REFERRERS',                  SEC_REFERRERS) +
    section('help-activity',     '📡 ACTIVITY FEED',              SEC_ACTIVITY) +
    section('help-calendar',     '📅 CALENDAR',                   SEC_CALENDAR) +
    section('help-production',   '🏭 PRODUCTION SCHEDULE',        SEC_PRODUCTION) +
    section('help-tasks',        '✅ TASKS',                      SEC_TASKS) +
    section('help-documents',    '📁 DOCUMENTS',                  SEC_DOCUMENTS) +
    section('help-inventory',    '📦 INVENTORY',                  SEC_INVENTORY) +
    section('help-announcements','📣 ANNOUNCEMENTS',              SEC_ANNOUNCEMENTS) +
    section('help-customers',    '🌐 CUSTOMER LOGINS (ADMIN)',    SEC_CUSTOMERS) +
    section('help-users',        '🔑 USERS & PERMISSIONS (ADMIN)',SEC_USERS) +
    section('help-settings',     '⚙️ SETTINGS & INTEGRATIONS',    SEC_SETTINGS) +
    section('help-shortcuts',    '⌨️ KEYBOARD SHORTCUTS',          SEC_SHORTCUTS);

  var TOC_ENTRIES = [
    ['help-overview','👋 Overview'],['help-dashboard','📊 Dashboard'],
    ['help-clients','👥 Clients'],['help-pipeline','📊 Pipeline'],
    ['help-invoices','🧾 Invoices'],['help-newinv','➕ New Invoice'],
    ['help-referrals','🤝 Referrals'],['help-referrers','👤 Referrers'],
    ['help-activity','📡 Activity'],['help-calendar','📅 Calendar'],
    ['help-production','🏭 Production'],['help-tasks','✅ Tasks'],
    ['help-documents','📁 Documents'],['help-inventory','📦 Inventory'],
    ['help-announcements','📣 Announcements'],['help-customers','🌐 Customer Logins'],
    ['help-users','🔑 Users'],['help-settings','⚙️ Settings'],
    ['help-shortcuts','⌨️ Shortcuts']
  ];
  var PAGE_TO_SECTION = {
    'cpg-dashboard':'help-dashboard','cpg-clients':'help-clients','cpg-pipeline':'help-pipeline',
    'cpg-invoices':'help-invoices','cpg-invoice-detail':'help-invoices','cpg-newinv':'help-newinv',
    'cpg-referrals':'help-referrals','cpg-referrers':'help-referrers','cpg-activity':'help-activity',
    'cpg-calendar':'help-calendar','cpg-production-cal':'help-production','cpg-tasks':'help-tasks',
    'cpg-documents':'help-documents','cpg-inventory':'help-inventory','cpg-announcements':'help-announcements',
    'cpg-customers':'help-customers','cpg-users':'help-users'
  };
  function currentSection(){
    var active = document.querySelector('#crm-panel .cpg.act');
    if(active && PAGE_TO_SECTION[active.id]) return PAGE_TO_SECTION[active.id];
    return 'help-overview';
  }
  function buildTOC(){
    return TOC_ENTRIES.map(function(e){
      return '<a href="#'+e[0]+'" data-anchor="'+e[0]+'" ' +
        'style="display:block;padding:8px 12px;margin:2px 0;border-radius:6px;font-size:12px;' +
        'color:#9aa7bd;text-decoration:none;line-height:1.4;white-space:nowrap;' +
        'overflow:hidden;text-overflow:ellipsis;transition:background .12s,color .12s">' + e[1] + '</a>';
    }).join('');
  }

  window.glOpenHelp = function(scrollTo){
    var prior = document.getElementById('gl-help-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var target = scrollTo || currentSection();

    var ov = document.createElement('div');
    ov.id = 'gl-help-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:950;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');

    var card = document.createElement('div');
    card.setAttribute('style','background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;width:100%;max-width:960px;height:88vh;max-height:88vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6)');

    var header = document.createElement('div');
    header.setAttribute('style','display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.06);flex-shrink:0');
    header.innerHTML =
      '<div>' +
        '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">❓ HELP &amp; GUIDE</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-top:2px">Press <kbd style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:1px 5px;font-size:10px">?</kbd> any time</div>' +
      '</div>' +
      '<button id="gl-help-close" title="Close" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer;padding:4px 8px;line-height:1">✕</button>';

    var split = document.createElement('div');
    split.setAttribute('style','display:flex;flex:1 1 auto;min-height:0;overflow:hidden');

    var toc = document.createElement('nav');
    toc.id = 'gl-help-toc';
    toc.setAttribute('style','width:220px;flex:0 0 220px;border-right:1px solid rgba(255,255,255,.06);padding:14px 10px;overflow-y:auto;background:rgba(0,0,0,.18)');
    toc.innerHTML = buildTOC();

    var body = document.createElement('main');
    body.id = 'gl-help-body';
    body.setAttribute('style','flex:1 1 auto;min-width:0;padding:6px 30px 24px;overflow-y:auto;background:#142238;color:#fff');
    body.innerHTML = HELP_HTML;

    split.appendChild(toc);
    split.appendChild(body);
    card.appendChild(header);
    card.appendChild(split);
    ov.appendChild(card);

    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    header.querySelector('#gl-help-close').addEventListener('click', function(){ ov.remove(); });
    function highlightToc(id){
      toc.querySelectorAll('a').forEach(function(x){
        var on = x.getAttribute('data-anchor') === id;
        x.style.background = on ? 'rgba(0,229,192,.1)' : '';
        x.style.color = on ? 'var(--teal)' : '#9aa7bd';
      });
    }
    toc.querySelectorAll('a').forEach(function(a){
      a.addEventListener('click', function(e){
        e.preventDefault();
        highlightToc(a.getAttribute('data-anchor'));
        var el = body.querySelector('#' + a.getAttribute('data-anchor'));
        if(el) el.scrollIntoView({behavior:'smooth', block:'start'});
      });
    });
    document.addEventListener('keydown', function escH(e){
      if(e.key === 'Escape' && document.getElementById('gl-help-modal')){
        ov.remove();
        document.removeEventListener('keydown', escH);
      }
    });

    host.appendChild(ov);
    // Initial scroll + TOC highlight after the modal lays out
    setTimeout(function(){
      var el = body.querySelector('#' + target);
      if(el) el.scrollIntoView({behavior:'auto', block:'start'});
      highlightToc(target);
    }, 60);
  };

  // "?" hotkey to toggle
  document.addEventListener('keydown', function(e){
    if(e.key !== '?') return;
    var t = e.target;
    if(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if(!document.getElementById('crm-panel') || !document.getElementById('crm-panel').classList.contains('show')) return;
    e.preventDefault();
    if(document.getElementById('gl-help-modal')) document.getElementById('gl-help-modal').remove();
    else window.glOpenHelp();
  });

  // ❓ Help button in topbar
  function injectHelpButton(){
    var brand = document.querySelector('#crm-top .crm-brand');
    if(!brand || !brand.parentElement) return;
    if(brand.parentElement.querySelector('.gl-help-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'gl-help-btn';
    btn.title = 'Open help (or press ?)';
    btn.setAttribute('style',
      'display:flex;align-items:center;gap:6px;padding:5px 10px;' +
      'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);' +
      'border-radius:7px;color:var(--muted);font-size:11px;cursor:pointer;' +
      'font-family:var(--ff-body);transition:all .15s;margin-left:6px'
    );
    btn.innerHTML = '<span style="color:#9aa7bd">❓</span><span>Help</span>';
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
    btn.addEventListener('click', function(){ window.glOpenHelp(); });
    brand.parentElement.insertBefore(btn, brand);
  }
  function startObs(){
    var top = document.getElementById('crm-top');
    if(top){
      new MutationObserver(function(){ setTimeout(injectHelpButton, 50); }).observe(top, {childList:true, subtree:true});
      injectHelpButton();
    } else setTimeout(startObs, 500);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] In-app help panel v2 loaded (flexbox + wireframes)');
}());

/* ============================================================
   GOOGLE ANALYTICS 4 SETTINGS
   The gtag loader already auto-runs when localStorage.gl_ga_id
   is set (fix.js:465). This adds a UI to paste the Measurement
   ID without dropping to DevTools.
   ============================================================ */
(function(){
  window.openGA4Settings = function(){
    var prior = document.getElementById('gl-ga-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var saved = localStorage.getItem('gl_ga_id') || '';
    var ov = document.createElement('div');
    ov.id = 'gl-ga-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:28px;width:100%;max-width:480px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">📈 GOOGLE ANALYTICS</div>' +
          '<button id="gl-ga-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:18px;line-height:1.6">Drops the GA4 (gtag) script into the page so you can track public site traffic. IP addresses are anonymized.</div>' +
        (saved ? '<div style="background:rgba(29,158,117,.08);border:1px solid rgba(29,158,117,.25);border-radius:8px;padding:10px 14px;font-size:12px;color:#1D9E75;margin-bottom:14px">✓ Currently tracking with ID <code>' + saved.replace(/</g,'&lt;') + '</code></div>' : '') +
        '<div class="frow"><div class="flbl">Measurement ID</div>' +
          '<input class="finp" id="gl-ga-input" placeholder="G-XXXXXXXXXX" value="' + saved.replace(/"/g,'&quot;') + '" style="font-family:var(--ff-mono)">' +
        '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:18px;line-height:1.6">Find it in <span style="color:var(--teal)">analytics.google.com → Admin → Data Streams → your stream → Measurement ID</span>. Starts with <code>G-</code>.</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button id="gl-ga-save" class="cbtn pri" style="flex:1">💾 Save & enable</button>' +
          (saved ? '<button id="gl-ga-clear" class="cbtn red">Disable</button>' : '') +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-ga-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-ga-save').addEventListener('click', function(){
      var id = (ov.querySelector('#gl-ga-input').value||'').trim();
      if(!id){ alert('Please enter a Measurement ID.'); return; }
      if(!/^G-[A-Z0-9]+$/i.test(id)){
        if(!confirm('That doesn\'t look like a GA4 Measurement ID (should start with "G-"). Save anyway?')) return;
      }
      localStorage.setItem('gl_ga_id', id);
      if(typeof addNotification === 'function') addNotification('📈 GA4 enabled','Reload the page for tracking to start.','success');
      else alert('Saved. Reload the page to start tracking.');
      ov.remove();
    });
    if(saved){
      ov.querySelector('#gl-ga-clear').addEventListener('click', function(){
        if(!confirm('Disable GA4 tracking on this domain?')) return;
        localStorage.removeItem('gl_ga_id');
        ov.remove();
        if(typeof addNotification === 'function') addNotification('GA4 disabled','Reload to take effect.','warning');
      });
    }
    host.appendChild(ov);
  };

  console.log('[GL] GA4 settings loaded');
}());

/* ============================================================
   TWO-FACTOR AUTHENTICATION (TOTP via Supabase Auth)
   - openMFASettings: modal to enroll / unenroll an authenticator
     app (Google Authenticator, Authy, 1Password, etc.). Shows QR
     code + base32 secret on enrollment.
   - On login, if the user has verified TOTP factors, prompt for
     the 6-digit code before completing sign-in. This produces
     an AAL2 session.
   ============================================================ */
(function(){
  function modal(html, onMount){
    var prior = document.getElementById('gl-mfa-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var ov = document.createElement('div');
    ov.id = 'gl-mfa-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:920;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML = '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:28px;width:100%;max-width:480px;max-height:88vh;overflow-y:auto">' + html + '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    host.appendChild(ov);
    if(typeof onMount === 'function') onMount(ov);
    return ov;
  }

  async function listFactors(sb){
    try {
      var r = await sb.auth.mfa.listFactors();
      if(r && r.data){
        var totp = (r.data.totp || []).filter(function(f){ return f.status === 'verified'; });
        return totp;
      }
    } catch(e){ console.warn('[GL mfa] listFactors threw', e); }
    return [];
  }

  function shellHeader(title){
    return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
      '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">' + title + '</div>' +
      '<button id="gl-mfa-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
    '</div>';
  }
  function wireClose(ov){
    ov.querySelector('#gl-mfa-close').addEventListener('click', function(){ ov.remove(); });
  }

  async function showEnrollFlow(){
    var sb = window.supa;
    if(!sb || !sb.auth || !sb.auth.mfa){ alert('Supabase MFA not available.'); return; }
    var enrollResp;
    try {
      enrollResp = await sb.auth.mfa.enroll({
        factorType:'totp',
        friendlyName:'Good Liquid CRM ' + new Date().toISOString().slice(0,10)
      });
    } catch(e){ alert('Could not start enrollment: ' + (e.message||'unknown')); return; }
    if(enrollResp.error){ alert('Enrollment error: ' + enrollResp.error.message); return; }
    var d = enrollResp.data;
    var factorId = d.id;
    var qr = d.totp && d.totp.qr_code;
    var secret = d.totp && d.totp.secret;

    var ov = modal(
      shellHeader('🔒 ENABLE 2FA') +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6">Scan this QR with an authenticator app (Google Authenticator, Authy, 1Password, etc). Then enter the 6-digit code it shows to confirm.</div>' +
      '<div style="background:#fff;padding:12px;border-radius:10px;display:flex;justify-content:center;margin-bottom:12px">' +
        (qr ? qr : '<div style="color:#1a1a2e;font-size:12px;padding:24px">No QR returned</div>') +
      '</div>' +
      '<div style="font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:4px">CAN\'T SCAN? MANUAL ENTRY</div>' +
      '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:10px;font-family:var(--ff-mono);font-size:12px;color:#fff;letter-spacing:1px;text-align:center;margin-bottom:18px;word-break:break-all">' + (secret || '—') + '</div>' +
      '<div class="frow"><div class="flbl">6-digit code from your app</div>' +
        '<input class="finp" id="gl-mfa-code" maxlength="6" inputmode="numeric" placeholder="123456" style="font-family:var(--ff-mono);letter-spacing:6px;text-align:center;font-size:18px">' +
      '</div>' +
      '<div id="gl-mfa-err" style="display:none;color:#e74c3c;font-size:12px;margin-bottom:10px"></div>' +
      '<div style="display:flex;gap:8px">' +
        '<button id="gl-mfa-verify" class="cbtn pri" style="flex:1">✓ Verify and enable</button>' +
        '<button id="gl-mfa-cancel" class="cbtn">Cancel</button>' +
      '</div>',
      function(ov){
        wireClose(ov);
        var input = ov.querySelector('#gl-mfa-code');
        var err   = ov.querySelector('#gl-mfa-err');
        function showErr(m){ err.style.display = 'block'; err.textContent = m; }
        async function verify(){
          err.style.display = 'none';
          var code = (input.value||'').trim();
          if(!/^\d{6}$/.test(code)){ showErr('Enter the 6-digit code from your authenticator app.'); return; }
          var btn = ov.querySelector('#gl-mfa-verify');
          btn.disabled = true; btn.textContent = 'Verifying…';
          try {
            var ch = await sb.auth.mfa.challenge({ factorId: factorId });
            if(ch.error) throw ch.error;
            var v = await sb.auth.mfa.verify({ factorId: factorId, challengeId: ch.data.id, code: code });
            if(v.error) throw v.error;
            ov.remove();
            if(typeof addNotification === 'function') addNotification('🔒 2FA enabled','Future logins will require your authenticator code.','success');
            else alert('✓ 2FA enabled. Future logins will require a code.');
          } catch(e){
            showErr(e.message || 'Verification failed');
            btn.disabled = false; btn.textContent = '✓ Verify and enable';
            // Note: if the user cancels here, the factor stays in 'unverified' state.
            // Supabase auto-cleans these but they can also unenroll explicitly.
          }
        }
        ov.querySelector('#gl-mfa-verify').addEventListener('click', verify);
        ov.querySelector('#gl-mfa-cancel').addEventListener('click', async function(){
          // Best-effort cleanup of the unverified factor
          try { await sb.auth.mfa.unenroll({ factorId: factorId }); } catch(e){}
          ov.remove();
        });
        input.addEventListener('keydown', function(e){ if(e.key === 'Enter') verify(); });
        setTimeout(function(){ input.focus(); }, 40);
      }
    );
  }

  async function showStatusFlow(){
    var sb = window.supa;
    if(!sb || !sb.auth || !sb.auth.mfa){ alert('Supabase MFA not available.'); return; }
    if(!sb.auth.getSession){ alert('Not signed in.'); return; }
    var sess = await sb.auth.getSession();
    if(!sess.data || !sess.data.session){ alert('Sign in first.'); return; }
    var factors = await listFactors(sb);
    if(!factors.length){
      // Not enrolled — go straight to enrollment
      showEnrollFlow();
      return;
    }
    var f = factors[0];  // assume single TOTP factor per user (Supabase default)
    var ov = modal(
      shellHeader('🔒 TWO-FACTOR AUTH') +
      '<div style="background:rgba(29,158,117,.08);border:1px solid rgba(29,158,117,.25);border-radius:8px;padding:12px 14px;margin-bottom:16px">' +
        '<div style="font-size:13px;color:#1D9E75;font-weight:600">✓ 2FA is enabled</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-top:3px">Factor: ' + (f.friendly_name || 'Authenticator') + ' · enrolled ' + (f.created_at ? new Date(f.created_at).toLocaleDateString() : '—') + '</div>' +
      '</div>' +
      '<div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6">Disabling 2FA removes the requirement to enter a code on future logins. Only do this if you\'re replacing the authenticator (then re-enroll right away) or shutting down 2FA deliberately.</div>' +
      '<div id="gl-mfa-err" style="display:none;color:#e74c3c;font-size:12px;margin-bottom:10px"></div>' +
      '<div style="display:flex;gap:8px">' +
        '<button id="gl-mfa-unenroll" class="cbtn red" style="flex:1">Disable 2FA</button>' +
        '<button id="gl-mfa-cancel" class="cbtn">Close</button>' +
      '</div>',
      function(ov){
        wireClose(ov);
        ov.querySelector('#gl-mfa-cancel').addEventListener('click', function(){ ov.remove(); });
        ov.querySelector('#gl-mfa-unenroll').addEventListener('click', async function(){
          if(!confirm('Disable 2FA on your account?\n\nFuture logins will only require a password (no code).')) return;
          var btn = this; btn.disabled = true; btn.textContent = 'Removing…';
          try {
            var r = await sb.auth.mfa.unenroll({ factorId: f.id });
            if(r.error) throw r.error;
            ov.remove();
            if(typeof addNotification === 'function') addNotification('🔒 2FA disabled', '', 'warning');
          } catch(e){
            var err = ov.querySelector('#gl-mfa-err');
            err.style.display = 'block'; err.textContent = 'Failed: ' + (e.message || 'unknown');
            btn.disabled = false; btn.textContent = 'Disable 2FA';
          }
        });
      }
    );
  }

  window.openMFASettings = function(){ showStatusFlow(); };

  // Prompt for the TOTP code after a successful password login.
  async function promptMfaCode(factorId){
    return new Promise(function(resolve){
      var sb = window.supa;
      modal(
        shellHeader('🔒 ENTER 2FA CODE') +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:14px;line-height:1.6">Enter the 6-digit code from your authenticator app to complete sign-in.</div>' +
        '<div class="frow"><div class="flbl">6-digit code</div>' +
          '<input class="finp" id="gl-mfa-code" maxlength="6" inputmode="numeric" placeholder="123456" style="font-family:var(--ff-mono);letter-spacing:6px;text-align:center;font-size:18px">' +
        '</div>' +
        '<div id="gl-mfa-err" style="display:none;color:#e74c3c;font-size:12px;margin-bottom:10px"></div>' +
        '<div style="display:flex;gap:8px">' +
          '<button id="gl-mfa-verify" class="cbtn pri" style="flex:1">✓ Verify</button>' +
          '<button id="gl-mfa-cancel" class="cbtn">Cancel</button>' +
        '</div>',
        function(ov){
          wireClose(ov);
          var input = ov.querySelector('#gl-mfa-code');
          var err   = ov.querySelector('#gl-mfa-err');
          async function verify(){
            err.style.display = 'none';
            var code = (input.value||'').trim();
            if(!/^\d{6}$/.test(code)){ err.style.display='block'; err.textContent='Enter the 6-digit code.'; return; }
            var btn = ov.querySelector('#gl-mfa-verify');
            btn.disabled = true; btn.textContent = 'Verifying…';
            try {
              var ch = await sb.auth.mfa.challenge({ factorId: factorId });
              if(ch.error) throw ch.error;
              var v = await sb.auth.mfa.verify({ factorId: factorId, challengeId: ch.data.id, code: code });
              if(v.error) throw v.error;
              ov.remove();
              resolve(true);
            } catch(e){
              err.style.display = 'block'; err.textContent = e.message || 'Failed';
              btn.disabled = false; btn.textContent = '✓ Verify';
            }
          }
          ov.querySelector('#gl-mfa-verify').addEventListener('click', verify);
          ov.querySelector('#gl-mfa-cancel').addEventListener('click', async function(){
            // Sign out — they cancelled the second factor
            try { await sb.auth.signOut(); } catch(e){}
            window.currentUser = null;
            if(typeof window.exitCRM === 'function') window.exitCRM();
            ov.remove();
            resolve(false);
          });
          input.addEventListener('keydown', function(e){ if(e.key === 'Enter') verify(); });
          setTimeout(function(){ input.focus(); }, 40);
        }
      );
    });
  }

  // Wrap checkPw so that after a successful password sign-in, if the user
  // has a verified TOTP factor, we prompt for the code before completing.
  (function(){
    var orig = window.checkPw;
    if(typeof orig !== 'function') return;
    window.checkPw = async function(){
      var before = window.currentUser;
      var result = await orig.apply(this, arguments);
      if(!window.currentUser || window.currentUser === before) return result;
      var sb = window.supa;
      if(!sb || !sb.auth || !sb.auth.mfa) return result;
      try {
        var factors = await listFactors(sb);
        if(!factors.length) return result;
        // Need to go from aal1 to aal2 — prompt for the code
        var ok = await promptMfaCode(factors[0].id);
        if(!ok){
          // User cancelled — they're already signed out by promptMfaCode
          if(typeof addNotification === 'function') addNotification('Sign-in cancelled','2FA code required.','warning');
        }
      } catch(e){ console.warn('[GL mfa] post-login check threw', e); }
      return result;
    };
  })();

  console.log('[GL] 2FA (Supabase TOTP) loaded');
}());

/* ============================================================
   ERROR LOGGER (Sentry-style, self-hosted in Supabase)
   - Captures window.onerror and unhandledrejection
   - Dedupes identical errors within a 60s window
   - Skips known-harmless third-party noise (ResizeObserver, etc.)
   - Fire-and-forget POST to error_log via anon REST
   - Admin viewer modal (window.glOpenErrorLog) lists recent
     errors with stack + user-agent
   - Wake-up summary includes the table SQL
   ============================================================ */
(function(){
  var SURL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/rest/v1';
  var SKEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE';

  var SKIP_PATTERNS = [
    'ResizeObserver loop limit exceeded',
    'ResizeObserver loop completed with undelivered notifications',
    'Script error.', // cross-origin scripts
    'Non-Error promise rejection captured',
    'NetworkError when attempting to fetch resource',  // user offline
    'Load failed'  // Safari fetch noise
  ];
  function shouldSkip(msg){
    if(!msg) return true;
    msg = String(msg);
    for(var i=0;i<SKIP_PATTERNS.length;i++) if(msg.indexOf(SKIP_PATTERNS[i]) >= 0) return true;
    return false;
  }

  // Dedupe: don't fire identical errors more than once per 60s
  var lastSent = {};
  function fingerprint(msg, source, line){ return [msg, source, line].join('|').slice(0,200); }
  function recentlySent(fp){
    var now = Date.now();
    Object.keys(lastSent).forEach(function(k){ if(now - lastSent[k] > 60000) delete lastSent[k]; });
    if(lastSent[fp]) return true;
    lastSent[fp] = now;
    return false;
  }

  async function postError(payload){
    try {
      await fetch(SURL + '/error_log', {
        method: 'POST',
        headers: { apikey: SKEY, Authorization: 'Bearer ' + SKEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(payload),
        keepalive: true
      });
    } catch(e){ /* silent — never let the logger break the app */ }
  }

  function capture(err){
    if(shouldSkip(err.message)) return;
    var fp = fingerprint(err.message, err.source, err.line_no);
    if(recentlySent(fp)) return;
    var actor = (window.currentUser && window.currentUser.email) || null;
    postError({
      actor_email: actor,
      message: String(err.message || '').slice(0, 500),
      source: err.source ? String(err.source).slice(0, 200) : null,
      line_no: err.line_no || null,
      col_no: err.col_no || null,
      stack: err.stack ? String(err.stack).slice(0, 4000) : null,
      user_agent: navigator.userAgent.slice(0, 200),
      url: location.href.slice(0, 300)
    });
  }

  window.addEventListener('error', function(e){
    capture({
      message: e.message,
      source: e.filename,
      line_no: e.lineno,
      col_no: e.colno,
      stack: e.error && e.error.stack
    });
  });
  window.addEventListener('unhandledrejection', function(e){
    var reason = e.reason;
    capture({
      message: (reason && (reason.message || reason)) + ' [unhandled promise]',
      stack: reason && reason.stack
    });
  });

  // ---- Admin viewer ----
  function fmtWhen(iso){
    if(!iso) return '';
    var d = new Date(iso);
    var ms = Date.now() - d.getTime();
    if(ms < 60000) return Math.floor(ms/1000) + 's ago';
    if(ms < 3600000) return Math.floor(ms/60000) + 'm ago';
    if(ms < 86400000) return Math.floor(ms/3600000) + 'h ago';
    return d.toLocaleDateString();
  }
  function esc(s){ return String(s||'').replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }

  window.glOpenErrorLog = async function(){
    if(!window.currentUser || window.currentUser.role !== 'admin'){ alert('Admin only.'); return; }
    var prior = document.getElementById('gl-err-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var ov = document.createElement('div');
    ov.id = 'gl-err-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:920;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:24px;width:100%;max-width:880px;max-height:88vh;display:flex;flex-direction:column">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div><div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">🐛 ERROR LOG</div>' +
            '<div style="font-size:11px;color:var(--muted);margin-top:2px">Last 100 captured errors (browser-side)</div></div>' +
          '<div style="display:flex;gap:6px;align-items:center">' +
            '<button id="gl-err-refresh" class="cbtn" style="font-size:11px;padding:5px 11px">🔄 Refresh</button>' +
            '<button id="gl-err-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
          '</div>' +
        '</div>' +
        '<div id="gl-err-body" style="flex:1;overflow-y:auto;background:rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.05);border-radius:8px;padding:6px"><div style="padding:30px;text-align:center;color:#9aa7bd;font-size:12px">Loading…</div></div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-err-close').addEventListener('click', function(){ ov.remove(); });
    host.appendChild(ov);

    async function load(){
      var body = ov.querySelector('#gl-err-body');
      body.innerHTML = '<div style="padding:30px;text-align:center;color:#9aa7bd;font-size:12px">Loading…</div>';
      var sb = window.supa;
      if(!sb){ body.innerHTML = '<div style="padding:30px;text-align:center;color:#ff8579;font-size:12px">Auth unavailable.</div>'; return; }
      try {
        var r = await sb.from('error_log').select('*').order('created_at',{ascending:false}).limit(100);
        if(r.error){
          body.innerHTML = '<div style="padding:30px;text-align:center;color:#ff8579;font-size:12px;line-height:1.6">⚠ ' + esc(r.error.message) + '<div style="font-size:11px;color:#9aa7bd;margin-top:12px">If the error_log table doesn\'t exist yet, run the SQL from the dashboard System Health widget.</div></div>';
          return;
        }
        var rows = r.data || [];
        if(!rows.length){ body.innerHTML = '<div style="padding:40px;text-align:center;color:#9aa7bd;font-size:12px">No errors captured. 🎉</div>'; return; }
        body.innerHTML = rows.map(function(r){
          return '<details style="border-bottom:1px solid rgba(255,255,255,.05);padding:10px 14px">' +
            '<summary style="cursor:pointer;display:flex;align-items:center;gap:10px;font-size:12px;color:#fff;list-style:none">' +
              '<span style="color:#9aa7bd;font-size:11px;min-width:60px">'+esc(fmtWhen(r.created_at))+'</span>' +
              '<span style="font-family:var(--ff-mono);color:#ff8579;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(r.message)+'</span>' +
              '<span style="font-size:10px;color:#9aa7bd">'+esc(r.actor_email||'anon')+'</span>' +
            '</summary>' +
            '<div style="padding:10px 0 4px;font-size:11px;color:#cfd9e6;font-family:var(--ff-mono)">' +
              '<div><b>URL:</b> '+esc(r.url||'')+'</div>' +
              (r.source ? '<div><b>Source:</b> '+esc(r.source)+(r.line_no?' line '+r.line_no:'')+'</div>' : '') +
              '<div><b>UA:</b> '+esc(r.user_agent||'')+'</div>' +
              (r.stack ? '<pre style="margin-top:8px;background:rgba(0,0,0,.3);border-radius:6px;padding:10px;overflow-x:auto;font-size:10px;line-height:1.5;color:#cfd9e6;max-height:200px">'+esc(r.stack)+'</pre>' : '') +
            '</div>' +
          '</details>';
        }).join('');
      } catch(e){
        body.innerHTML = '<div style="padding:30px;text-align:center;color:#ff8579;font-size:12px">Failed: '+esc(e.message||'')+'</div>';
      }
    }
    ov.querySelector('#gl-err-refresh').addEventListener('click', load);
    load();
  };

  console.log('[GL] Error logger (Sentry-style) loaded');
}());

/* ============================================================
   TWILIO SMS — admin alerts
   Direct browser → Twilio API is blocked by CORS. The helper
   POSTs to a Supabase Edge Function (template in wake-up
   notes) that holds the Twilio credentials server-side.
   Settings UI: alert phone number + per-event toggles.
   Edge Function URL defaults to:
   https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/twilio-sms
   ============================================================ */
(function(){
  var DEFAULT_FN_URL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/twilio-sms';
  var EVENT_KEYS = [
    { key:'gl_sms_paid',    label:'An invoice is marked paid' },
    { key:'gl_sms_won',     label:'A deal is moved to Closed Won' },
    { key:'gl_sms_quote',   label:'A customer accepts a quote' },
    { key:'gl_sms_tour',    label:'A tour request comes in via the public site' },
    { key:'gl_sms_overdue', label:'An invoice ages past due' }
  ];

  function getPhone(){ return (localStorage.getItem('gl_sms_to') || '').trim(); }
  function getEnabled(key){ return localStorage.getItem(key) === '1'; }
  function getFnUrl(){ return (localStorage.getItem('gl_sms_fn_url') || DEFAULT_FN_URL).trim(); }

  // Public helper. Returns true on success, false otherwise.
  window.sendSMS = async function(body, opts){
    opts = opts || {};
    var to = opts.to || getPhone();
    if(!to){
      console.log('[GL sms] no phone number configured');
      return false;
    }
    if(!body) return false;
    if(typeof window.glStartBusy === 'function') window.glStartBusy('Sending SMS…');
    try {
      // Use the Supabase JWT from the current session as the bearer
      var token = null;
      try {
        if(window.supa && window.supa.auth && window.supa.auth.getSession){
          var s = await window.supa.auth.getSession();
          if(s && s.data && s.data.session) token = s.data.session.access_token;
        }
      } catch(e){}
      var r = await fetch(getFnUrl(), {
        method: 'POST',
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          token ? { 'Authorization': 'Bearer ' + token } : {}
        ),
        body: JSON.stringify({ to: to, body: body.slice(0, 1000) })
      });
      if(!r.ok){
        var t = await r.text().catch(function(){ return ''; });
        console.error('[GL sms] HTTP', r.status, t);
        return false;
      }
      return true;
    } catch(e){
      console.error('[GL sms] send threw', e);
      return false;
    } finally {
      if(typeof window.glEndBusy === 'function') window.glEndBusy();
    }
  };

  window.openSmsSettings = function(){
    var prior = document.getElementById('gl-sms-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var phone = getPhone();
    var url = getFnUrl();
    var ov = document.createElement('div');
    ov.id = 'gl-sms-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:920;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    var togglesHtml = EVENT_KEYS.map(function(e){
      var on = getEnabled(e.key);
      return '<label style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(255,255,255,.03);border-radius:6px;font-size:12px;color:#fff;cursor:pointer">' +
        '<input type="checkbox" class="gl-sms-tog" data-k="'+e.key+'"'+(on?' checked':'')+' style="width:14px;height:14px;accent-color:var(--teal);cursor:pointer">' +
        '<span>'+e.label+'</span>' +
      '</label>';
    }).join('');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:520px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">📱 SMS ALERTS</div>' +
          '<button id="gl-sms-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="background:rgba(245,200,66,.06);border:1px solid rgba(245,200,66,.2);border-radius:8px;padding:11px;font-size:11px;color:#f5c842;margin-bottom:16px;line-height:1.6">' +
          '⚠ Browser-to-Twilio is blocked by CORS. This UI talks to a Supabase Edge Function (template in deploy notes). Deploy that function with your Twilio credentials before SMS will fire.' +
        '</div>' +
        '<div class="frow"><div class="flbl">Your phone number (E.164)</div>' +
          '<input class="finp" id="gl-sms-phone" placeholder="+18034935065" value="'+phone.replace(/"/g,'&quot;')+'" style="font-family:var(--ff-mono)">' +
        '</div>' +
        '<div class="frow"><div class="flbl">Edge Function URL</div>' +
          '<input class="finp" id="gl-sms-url" value="'+url.replace(/"/g,'&quot;')+'" style="font-family:var(--ff-mono);font-size:11px">' +
        '</div>' +
        '<div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin:14px 0 8px">ALERT ME WHEN</div>' +
        '<div style="display:flex;flex-direction:column;gap:6px;margin-bottom:18px">'+togglesHtml+'</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button id="gl-sms-save" class="cbtn pri" style="flex:1">💾 Save</button>' +
          '<button id="gl-sms-test" class="cbtn">📤 Test send</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-sms-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-sms-save').addEventListener('click', function(){
      var p = (ov.querySelector('#gl-sms-phone').value||'').trim();
      var u = (ov.querySelector('#gl-sms-url').value||'').trim();
      if(p) localStorage.setItem('gl_sms_to', p); else localStorage.removeItem('gl_sms_to');
      if(u) localStorage.setItem('gl_sms_fn_url', u); else localStorage.removeItem('gl_sms_fn_url');
      ov.querySelectorAll('.gl-sms-tog').forEach(function(cb){
        var k = cb.getAttribute('data-k');
        if(cb.checked) localStorage.setItem(k, '1'); else localStorage.removeItem(k);
      });
      if(typeof addNotification === 'function') addNotification('📱 SMS settings saved','','success');
      ov.remove();
    });
    ov.querySelector('#gl-sms-test').addEventListener('click', async function(){
      var p = (ov.querySelector('#gl-sms-phone').value||'').trim();
      if(!p){ alert('Add your phone number first.'); return; }
      // Persist the URL/phone before testing so getFnUrl/getPhone read fresh
      localStorage.setItem('gl_sms_to', p);
      var u = (ov.querySelector('#gl-sms-url').value||'').trim();
      if(u) localStorage.setItem('gl_sms_fn_url', u);
      var ok = await window.sendSMS('Good Liquid CRM test message — ' + new Date().toLocaleString());
      if(ok) alert('✓ Test SMS dispatched. Check your phone.');
      else alert('✗ Send failed. See browser console for the Edge Function response.');
    });
    host.appendChild(ov);
  };

  // Hook into key events. Wrapped lazily so they fire even if other IIFEs
  // override the originals later. Each fires only if the matching toggle
  // is set AND a phone number is configured.
  function maybeSms(eventKey, msg){
    if(!getEnabled(eventKey) || !getPhone()) return;
    window.sendSMS(msg);  // fire-and-forget
  }

  // Invoice marked paid
  (function(){
    var orig = window.quickPaid;
    if(typeof orig !== 'function') return;
    window.quickPaid = function(id){
      var inv = (window.invoices||[]).find(function(i){ return i.id === id; });
      var r = orig.apply(this, arguments);
      if(inv) maybeSms('gl_sms_paid', '💰 Invoice ' + id + ' marked paid — $' + Number(inv.amount||0).toLocaleString() + ' (' + (inv.clientName||'') + ')');
      return r;
    };
  })();

  // Deal moved to Closed Won
  (function(){
    var orig = window.moveDeal;
    if(typeof orig !== 'function') return;
    window.moveDeal = async function(dealId, fromStage, toStage, fallbackIdx){
      var r = await orig.apply(this, arguments);
      if(toStage === 'Closed Won'){
        var deals = window.deals && window.deals[toStage] || [];
        var d = deals.find(function(x){ return x && x.id === dealId; }) || deals[deals.length-1] || {};
        maybeSms('gl_sms_won', '🎉 Deal closed won: ' + (d.name||'') + ' (' + (d.co||'') + ') ' + (d.val||''));
      }
      return r;
    };
  })();

  // Quote accepted (when admin clicks "→ Invoice" on a quote row)
  (function(){
    var orig = window.glConvertQuoteToInvoice;
    if(typeof orig !== 'function') return;
    window.glConvertQuoteToInvoice = async function(invId){
      var inv = (window.invoices||[]).find(function(i){ return i.id === invId; }) || {};
      var r = await orig.apply(this, arguments);
      maybeSms('gl_sms_quote', '✓ Quote ' + invId + ' converted to invoice — $' + Number(inv.amount||0).toLocaleString() + ' (' + (inv.clientName||'') + ')');
      return r;
    };
  })();

  console.log('[GL] Twilio SMS scaffold loaded');
}());

/* ============================================================
   iCAL (.ics) EXPORT — production calendar + general calendar
   Generates an RFC 5545-compliant .ics file from the user's
   calEvents (gl_cal_events localStorage). Drop into Apple
   Calendar / Google Calendar / Outlook to subscribe.
   Injects an 📅 Export button into both calendar pages.
   ============================================================ */
(function(){
  function pad(n){ return n < 10 ? '0' + n : '' + n; }
  function toIcsDate(input){
    var d = input instanceof Date ? input : new Date(input);
    if(isNaN(d.getTime())) return null;
    // Use UTC (Z) format
    return d.getUTCFullYear() +
      pad(d.getUTCMonth()+1) +
      pad(d.getUTCDate()) + 'T' +
      pad(d.getUTCHours()) +
      pad(d.getUTCMinutes()) +
      pad(d.getUTCSeconds()) + 'Z';
  }
  function icsEscape(s){
    // RFC 5545: backslash, comma, semicolon, newline
    return String(s||'').replace(/\\/g,'\\\\').replace(/,/g,'\\,').replace(/;/g,'\\;').replace(/\r?\n/g,'\\n');
  }
  function fold(line){
    // RFC 5545: max 75 octets per line; continuation = CRLF + space
    if(line.length <= 75) return line;
    var out = line.slice(0, 75);
    var rest = line.slice(75);
    while(rest.length > 74){ out += '\r\n ' + rest.slice(0, 74); rest = rest.slice(74); }
    if(rest.length) out += '\r\n ' + rest;
    return out;
  }

  function parseEventDateTime(ev){
    // Try multiple shapes: ev.date + ev.time, ev.startMs, ev.start, ev.when
    var start = null, end = null;
    if(ev.startMs){ start = new Date(ev.startMs); }
    else if(ev.start){ start = new Date(ev.start); }
    else if(ev.date){
      var t = (ev.time || '09:00').trim();
      // accept "9:00 AM" or "14:00"
      var m12 = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
      var h, mi;
      if(m12){ h = parseInt(m12[1],10); mi = parseInt(m12[2],10); if(/PM/i.test(m12[3]) && h !== 12) h += 12; if(/AM/i.test(m12[3]) && h === 12) h = 0; }
      else {
        var m24 = t.match(/^(\d{1,2}):(\d{2})$/);
        if(m24){ h = parseInt(m24[1],10); mi = parseInt(m24[2],10); } else { h = 9; mi = 0; }
      }
      start = new Date(ev.date + 'T' + pad(h) + ':' + pad(mi) + ':00');
    }
    if(!start || isNaN(start.getTime())) return null;
    end = ev.endMs ? new Date(ev.endMs) : new Date(start.getTime() + (ev.durationMin||60) * 60000);
    return { start: start, end: end };
  }

  function eventTitle(ev){
    if(ev.title) return ev.title;
    if(ev.name) return ev.name;
    if(ev.type === 'production') return 'Production: ' + (ev.clientName || ev.client || '');
    return ev.type || 'Event';
  }
  function eventDescription(ev){
    var parts = [];
    if(ev.notes) parts.push(ev.notes);
    if(ev.format) parts.push('Format: ' + ev.format);
    if(ev.qty) parts.push('Quantity: ' + ev.qty + ' cases');
    if(ev.clientName || ev.client) parts.push('Client: ' + (ev.clientName || ev.client));
    return parts.join('\n');
  }

  function buildIcs(events){
    var lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Good Liquid Bev Co//CRM//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Good Liquid Bev Co',
      'X-WR-TIMEZONE:America/New_York'
    ];
    var stamp = toIcsDate(new Date());
    events.forEach(function(ev){
      var when = parseEventDateTime(ev);
      if(!when) return;
      var uid = (ev.id || ('ev-' + Date.now() + '-' + Math.random().toString(36).slice(2,8))) + '@goodliquidbevco.com';
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + uid);
      lines.push('DTSTAMP:' + stamp);
      lines.push('DTSTART:' + toIcsDate(when.start));
      lines.push('DTEND:'   + toIcsDate(when.end));
      lines.push(fold('SUMMARY:' + icsEscape(eventTitle(ev))));
      var desc = eventDescription(ev);
      if(desc) lines.push(fold('DESCRIPTION:' + icsEscape(desc)));
      lines.push('LOCATION:2011 51st Ave E Unit 100\\, Palmetto FL 34221');
      lines.push('END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    // RFC 5545 requires CRLF line endings
    return lines.join('\r\n');
  }

  function download(name, content){
    var blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1500);
  }

  window.glExportCalendarIcs = function(filterType){
    var events = (window.calEvents || []);
    if(filterType === 'production') events = events.filter(function(e){ return e.type === 'production'; });
    if(filterType === 'general')    events = events.filter(function(e){ return e.type !== 'production'; });
    if(!events.length){
      alert('No events to export.');
      return;
    }
    var stamp = new Date().toISOString().slice(0,10);
    var name = filterType === 'production' ? 'goodliquid-production-' + stamp + '.ics'
            : filterType === 'general'     ? 'goodliquid-calendar-'   + stamp + '.ics'
            : 'goodliquid-events-' + stamp + '.ics';
    var ics = buildIcs(events);
    download(name, ics);
    if(typeof addNotification === 'function') addNotification('📅 Calendar exported', events.length + ' events · drop into Apple/Google/Outlook', 'success');
    if(typeof window.glAudit === 'function') window.glAudit('export_ics', filterType || 'all', { events: events.length });
  };

  // Inject export buttons into both calendar pages.
  function inject(){
    [
      { pageId:'cpg-calendar',       filter:'general',    label:'📅 Export to calendar', title:'Download an .ics file of general events (open in Apple/Google/Outlook to subscribe)' },
      { pageId:'cpg-production-cal', filter:'production', label:'📅 Export to calendar', title:'Download an .ics file of production runs' }
    ].forEach(function(spec){
      var page = document.getElementById(spec.pageId);
      if(!page) return;
      var header = page.querySelector('.cph');
      if(!header) return;
      if(header.querySelector('.gl-ics-btn-' + spec.filter)) return;
      var btn = document.createElement('button');
      btn.className = 'cbtn gl-ics-btn-' + spec.filter;
      btn.title = spec.title;
      btn.setAttribute('style','margin-left:8px;background:rgba(0,229,192,.08);border:1px solid rgba(0,229,192,.3);color:var(--teal)');
      btn.textContent = spec.label;
      btn.addEventListener('click', function(){ window.glExportCalendarIcs(spec.filter); });
      // Try to put it alongside any existing header button.
      var existingBtn = header.querySelector('button');
      if(existingBtn && existingBtn.parentElement){
        existingBtn.parentElement.appendChild(btn);
      } else {
        header.appendChild(btn);
      }
    });
  }
  function startObs(){
    var cal = document.getElementById('cpg-calendar') || document.getElementById('cpg-production-cal');
    if(cal){
      new MutationObserver(function(){ setTimeout(inject, 50); }).observe(cal.parentElement || cal, {childList:true, subtree:true});
      inject();
    } else setTimeout(startObs, 700);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] iCal export loaded');
}());

/* ============================================================
   FIRST-RUN SETUP WIZARD
   Auto-opens on first admin login (gates on localStorage flag
   gl_wizard_done). Big welcome card + 5-step checklist with
   live status indicators and "Set up" buttons that fan out
   to the existing settings modals. "Finish" marks done and
   never auto-opens again — but the wizard is re-accessible
   from the AI toolbar 🚀 Setup any time.
   ============================================================ */
(function(){
  function isDone(){ return localStorage.getItem('gl_wizard_done') === '1'; }
  function markDone(){ localStorage.setItem('gl_wizard_done', '1'); }

  function statusMailgun(){ return (localStorage.getItem('gl_mailgun_key')||'').length > 10; }
  function statusAI(){ return (localStorage.getItem('gl_ai_key')||'').length > 10; }
  function statusSignature(){ var s = localStorage.getItem('gl_email_signature'); return s !== null && (s || '').trim().length > 0; }
  function statusGA(){ return (localStorage.getItem('gl_ga_id')||'').length > 5; }
  async function status2FA(){
    var sb = window.supa;
    if(!sb || !sb.auth || !sb.auth.mfa) return false;
    try {
      var r = await sb.auth.mfa.listFactors();
      var totp = (r && r.data && r.data.totp) || [];
      return totp.some(function(f){ return f.status === 'verified'; });
    } catch(e){ return false; }
  }

  var STEPS = [
    {
      key:'mailgun', icon:'📧', title:'Mailgun API key',
      desc:'Required for ANY outgoing email — follow-ups, password resets, onboarding, alerts. Paste your Mailgun private API key.',
      action: 'openMailgunSettings',
      required: true,
      status: function(){ return Promise.resolve(statusMailgun()); }
    },
    {
      key:'signature', icon:'✍️', title:'Your email signature',
      desc:'Auto-appended to follow-up emails so each outgoing message ends with your name + contact info.',
      action: 'openEmailSignatureSettings',
      required: false,
      status: function(){ return Promise.resolve(statusSignature()); }
    },
    {
      key:'mfa', icon:'🔒', title:'Two-factor auth',
      desc:'Highly recommended for admin accounts. Scan a QR code with Google Authenticator / Authy / 1Password / etc.',
      action: 'openMFASettings',
      required: false,
      status: status2FA
    },
    {
      key:'ai', icon:'🤖', title:'Anthropic API key',
      desc:'Optional — enables the 🤖 AI helpers (draft email, score lead, estimate quote, etc.).',
      action: 'openAISettings',
      required: false,
      status: function(){ return Promise.resolve(statusAI()); }
    },
    {
      key:'ga', icon:'📈', title:'Google Analytics',
      desc:'Optional — paste your GA4 Measurement ID to track public site traffic.',
      action: 'openGA4Settings',
      required: false,
      status: function(){ return Promise.resolve(statusGA()); }
    }
  ];

  function badge(done, required){
    if(done) return '<span style="font-size:10px;letter-spacing:2px;color:#1D9E75;background:rgba(29,158,117,.12);border:1px solid rgba(29,158,117,.3);border-radius:10px;padding:2px 8px">✓ DONE</span>';
    if(required) return '<span style="font-size:10px;letter-spacing:2px;color:#ff8579;background:rgba(231,76,60,.12);border:1px solid rgba(231,76,60,.35);border-radius:10px;padding:2px 8px">REQUIRED</span>';
    return '<span style="font-size:10px;letter-spacing:2px;color:#9aa7bd;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:2px 8px">OPTIONAL</span>';
  }

  async function rowsHtml(){
    var statuses = await Promise.all(STEPS.map(function(s){ return s.status(); }));
    return STEPS.map(function(s, i){
      var done = statuses[i];
      return '<div data-step="'+s.key+'" style="display:flex;align-items:center;gap:14px;padding:14px;background:rgba(255,255,255,.03);border:1px solid '+(done?'rgba(29,158,117,.2)':'rgba(255,255,255,.06)')+';border-radius:10px">' +
        '<div style="font-size:24px;line-height:1;flex-shrink:0">'+s.icon+'</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">' +
            '<div style="font-size:13px;font-weight:700;color:#fff">'+s.title+'</div>' +
            badge(done, s.required) +
          '</div>' +
          '<div style="font-size:11px;color:#9aa7bd;line-height:1.5">'+s.desc+'</div>' +
        '</div>' +
        '<button class="gl-wiz-action" data-action="'+s.action+'" class="cbtn" style="padding:7px 14px;font-size:12px;background:'+(done?'rgba(255,255,255,.04)':'rgba(0,229,192,.1)')+';border:1px solid '+(done?'rgba(255,255,255,.1)':'rgba(0,229,192,.3)')+';color:'+(done?'#9aa7bd':'var(--teal)')+';border-radius:6px;cursor:pointer;flex-shrink:0">'+(done?'Edit':'Set up')+'</button>' +
      '</div>';
    }).join('');
  }

  window.openSetupWizard = async function(opts){
    opts = opts || {};
    var auto = !!opts.auto;  // whether this was an auto-open on first run

    var prior = document.getElementById('gl-wiz-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var ov = document.createElement('div');
    ov.id = 'gl-wiz-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:910;background:rgba(6,13,26,.9);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.25);border-radius:16px;padding:32px;width:100%;max-width:640px;max-height:90vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px">' +
          '<div>' +
            '<div style="font-family:var(--ff-disp);font-size:22px;letter-spacing:2px;color:var(--teal);margin-bottom:4px">🚀 SETUP WIZARD</div>' +
            '<div style="font-size:12px;color:#9aa7bd;line-height:1.6">Get your CRM live in about 3 minutes. Each step opens its own settings panel — come back here when you\'re done. ' + (auto ? '<br><br><b>Tip:</b> you can re-open this any time from the AI toolbar (🤖) → 🚀 Setup.' : '') + '</div>' +
          '</div>' +
          '<button id="gl-wiz-close" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer;line-height:1;padding:4px 8px">✕</button>' +
        '</div>' +
        '<div id="gl-wiz-rows" style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px"><div style="padding:20px;text-align:center;color:#9aa7bd;font-size:12px">Loading status…</div></div>' +
        '<div style="display:flex;gap:8px;align-items:center">' +
          '<button id="gl-wiz-refresh" class="cbtn" style="font-size:11px;padding:7px 12px">🔄 Recheck</button>' +
          '<div style="flex:1"></div>' +
          (auto ? '' : '<button id="gl-wiz-reopen" class="cbtn" style="font-size:11px;padding:7px 12px">Show this on next login</button>') +
          '<button id="gl-wiz-finish" class="cbtn pri" style="padding:9px 18px">' + (auto ? '✓ Finish setup' : 'Done') + '</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov && !auto) ov.remove(); });
    host.appendChild(ov);

    async function refresh(){
      var box = ov.querySelector('#gl-wiz-rows');
      box.innerHTML = '<div style="padding:20px;text-align:center;color:#9aa7bd;font-size:12px">Loading status…</div>';
      box.innerHTML = await rowsHtml();
      box.querySelectorAll('.gl-wiz-action').forEach(function(b){
        b.addEventListener('click', function(){
          var fn = b.getAttribute('data-action');
          if(typeof window[fn] === 'function') window[fn]();
          else alert('Setting ' + fn + ' not available.');
        });
      });
    }
    ov.querySelector('#gl-wiz-close').addEventListener('click', function(){
      if(auto) markDone();  // dismissed without finishing — still set the flag so we don't re-auto-open
      ov.remove();
    });
    ov.querySelector('#gl-wiz-refresh').addEventListener('click', refresh);
    if(ov.querySelector('#gl-wiz-reopen')){
      ov.querySelector('#gl-wiz-reopen').addEventListener('click', function(){
        localStorage.removeItem('gl_wizard_done');
        if(typeof addNotification === 'function') addNotification('Setup wizard reset','Will auto-open on the next admin login.','success');
        ov.remove();
      });
    }
    ov.querySelector('#gl-wiz-finish').addEventListener('click', function(){
      markDone();
      ov.remove();
      if(typeof addNotification === 'function') addNotification('🎉 Setup complete','You can revisit any time via 🤖 → 🚀 Setup','success');
    });

    refresh();
  };

  // Auto-open on first admin login: hook loginUser. Skip if already done
  // or if the user isn't an admin.
  (function(){
    var orig = window.loginUser;
    if(typeof orig !== 'function') return;
    window.loginUser = function(u){
      var r = orig.apply(this, arguments);
      if(u && u.role === 'admin' && !isDone()){
        // Delay so the CRM panel renders first
        setTimeout(function(){ window.openSetupWizard({ auto: true }); }, 600);
      }
      return r;
    };
  })();

  console.log('[GL] First-run setup wizard loaded');
}());

/* ============================================================
   SENTRY (optional, plug-and-play)
   - Paste a Sentry DSN in the settings modal to mirror the
     client-side error logger to Sentry too. Loads the Sentry
     browser SDK from their CDN on demand.
   - Independent from the Supabase error_log — you can run
     either, both, or neither.
   ============================================================ */
(function(){
  var SDK_URL = 'https://browser.sentry-cdn.com/7.119.0/bundle.tracing.min.js';

  function loadSentry(dsn){
    if(window.Sentry) {
      try { window.Sentry.init({ dsn: dsn, tracesSampleRate: 0.1, release: 'goodliquid-crm' }); } catch(e){}
      return;
    }
    if(document.querySelector('script[src="' + SDK_URL + '"]')) return;
    var s = document.createElement('script');
    s.src = SDK_URL; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = function(){
      if(window.Sentry){
        try {
          window.Sentry.init({ dsn: dsn, tracesSampleRate: 0.1, release: 'goodliquid-crm' });
          // Stamp the current user on errors if we're signed in.
          if(window.currentUser && window.currentUser.email){
            try { window.Sentry.setUser({ email: window.currentUser.email, id: window.currentUser.id }); } catch(e){}
          }
          console.log('[GL] Sentry initialized');
        } catch(e){ console.warn('[GL] Sentry init failed', e); }
      }
    };
    document.head.appendChild(s);
  }

  // Auto-load on page load if a DSN is set
  var saved = localStorage.getItem('gl_sentry_dsn');
  if(saved) loadSentry(saved);

  window.openSentrySettings = function(){
    var prior = document.getElementById('gl-sentry-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var dsn = localStorage.getItem('gl_sentry_dsn') || '';
    var ov = document.createElement('div');
    ov.id = 'gl-sentry-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:920;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:520px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">🛡️ SENTRY</div>' +
          '<button id="gl-sentry-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--muted);margin-bottom:16px;line-height:1.6">Optional. Paste a Sentry DSN to mirror client-side errors to your Sentry project (in addition to the built-in Supabase error_log).</div>' +
        (dsn ? '<div style="background:rgba(29,158,117,.08);border:1px solid rgba(29,158,117,.25);border-radius:8px;padding:10px 14px;font-size:12px;color:#1D9E75;margin-bottom:14px">✓ Sentry active</div>' : '') +
        '<div class="frow"><div class="flbl">DSN</div>' +
          '<input class="finp" id="gl-sentry-input" placeholder="https://xxxxx@oXXXX.ingest.sentry.io/YYYY" value="' + dsn.replace(/"/g,'&quot;') + '" style="font-family:var(--ff-mono);font-size:11px">' +
        '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:18px;line-height:1.6">Find it at <span style="color:var(--teal)">sentry.io → Settings → Projects → [your project] → Client Keys (DSN)</span>.</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button id="gl-sentry-save" class="cbtn pri" style="flex:1">💾 Save & enable</button>' +
          (dsn ? '<button id="gl-sentry-test" class="cbtn">📤 Test error</button>' : '') +
          (dsn ? '<button id="gl-sentry-clear" class="cbtn red">Disable</button>' : '') +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-sentry-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-sentry-save').addEventListener('click', function(){
      var v = (ov.querySelector('#gl-sentry-input').value||'').trim();
      if(!v){ alert('Paste a DSN first.'); return; }
      localStorage.setItem('gl_sentry_dsn', v);
      loadSentry(v);
      if(typeof addNotification === 'function') addNotification('🛡️ Sentry enabled', 'Errors mirror to your Sentry project from now on.', 'success');
      ov.remove();
    });
    if(dsn){
      ov.querySelector('#gl-sentry-test').addEventListener('click', function(){
        try {
          if(window.Sentry) window.Sentry.captureMessage('Good Liquid CRM test event at ' + new Date().toISOString());
          alert('✓ Test event sent. Check your Sentry inbox.');
        } catch(e){ alert('Failed: ' + (e.message||'')); }
      });
      ov.querySelector('#gl-sentry-clear').addEventListener('click', function(){
        if(!confirm('Disable Sentry? Errors will still go to the built-in Supabase error_log.')) return;
        localStorage.removeItem('gl_sentry_dsn');
        if(window.Sentry) try { window.Sentry.close(); } catch(e){}
        ov.remove();
      });
    }
    host.appendChild(ov);
  };

  console.log('[GL] Sentry plug-in loaded');
}());

/* ============================================================
   STRIPE CHECKOUT SESSIONS (real, via Edge Function)
   - Click "Charge invoice" on an unpaid invoice → request a
     Checkout Session from a Supabase Edge Function (template
     in deploy notes) → redirect to Stripe-hosted checkout.
   - The Edge Function holds the Stripe secret key server-side.
   - Distinct from the static Stripe Payment Link manager
     (window.generatePayLink) — that's for pre-created links;
     this creates a session per-invoice with the exact amount.
   ============================================================ */
(function(){
  var DEFAULT_FN_URL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/stripe-checkout';
  function getFnUrl(){ return (localStorage.getItem('gl_stripe_fn_url') || DEFAULT_FN_URL).trim(); }

  window.openStripeSettings = function(){
    var prior = document.getElementById('gl-stripe-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var pub = localStorage.getItem('gl_stripe_pub') || '';
    var url = getFnUrl();
    var ov = document.createElement('div');
    ov.id = 'gl-stripe-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:920;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:560px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">💳 STRIPE CHECKOUT</div>' +
          '<button id="gl-stripe-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="background:rgba(245,200,66,.06);border:1px solid rgba(245,200,66,.2);border-radius:8px;padding:11px;font-size:11px;color:#f5c842;margin-bottom:16px;line-height:1.6">' +
          '⚠ Browser-to-Stripe-API is blocked by CORS. This UI talks to a Supabase Edge Function (template in deploy notes). Deploy that function with your Stripe SECRET key before live charges fire.' +
        '</div>' +
        '<div class="frow"><div class="flbl">Stripe PUBLISHABLE key (optional, for embedded UI)</div>' +
          '<input class="finp" id="gl-stripe-pub" placeholder="pk_live_... or pk_test_..." value="'+pub.replace(/"/g,'&quot;')+'" style="font-family:var(--ff-mono);font-size:11px">' +
        '</div>' +
        '<div class="frow"><div class="flbl">Edge Function URL</div>' +
          '<input class="finp" id="gl-stripe-url" value="'+url.replace(/"/g,'&quot;')+'" style="font-family:var(--ff-mono);font-size:11px">' +
        '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:18px;line-height:1.6">Distinct from the static <b>Payment Link manager</b> (💳 on any invoice row) — that\'s for re-using a Stripe Payment Link you created in the dashboard. This creates a unique Checkout Session for the invoice\'s exact amount and client email.</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button id="gl-stripe-save" class="cbtn pri" style="flex:1">💾 Save</button>' +
          '<button id="gl-stripe-test" class="cbtn">📤 Test session</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-stripe-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-stripe-save').addEventListener('click', function(){
      var p = (ov.querySelector('#gl-stripe-pub').value||'').trim();
      var u = (ov.querySelector('#gl-stripe-url').value||'').trim();
      if(p) localStorage.setItem('gl_stripe_pub', p); else localStorage.removeItem('gl_stripe_pub');
      if(u) localStorage.setItem('gl_stripe_fn_url', u); else localStorage.removeItem('gl_stripe_fn_url');
      ov.remove();
      if(typeof addNotification === 'function') addNotification('💳 Stripe Checkout settings saved','','success');
    });
    ov.querySelector('#gl-stripe-test').addEventListener('click', async function(){
      var u = (ov.querySelector('#gl-stripe-url').value||'').trim() || DEFAULT_FN_URL;
      try {
        var token = null;
        try {
          var s = window.supa && await window.supa.auth.getSession();
          if(s && s.data && s.data.session) token = s.data.session.access_token;
        } catch(e){}
        var r = await fetch(u, {
          method: 'POST',
          headers: Object.assign({ 'Content-Type':'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
          body: JSON.stringify({ amount: 100, client_email: 'test@example.com', invoice_id: 'TEST-' + Date.now(), description: 'Test charge' })
        });
        var text = await r.text();
        if(r.ok){
          try { var data = JSON.parse(text); alert('✓ Function responded. Session URL:\n' + (data.url || text.slice(0,200))); }
          catch(e){ alert('✓ Function responded but did not return JSON.'); }
        } else {
          alert('✗ Function returned ' + r.status + ':\n' + text.slice(0,300));
        }
      } catch(e){
        alert('✗ Could not reach function: ' + (e.message||''));
      }
    });
    host.appendChild(ov);
  };

  // Create a Checkout Session for an invoice and redirect the user to Stripe.
  window.glCreateStripeCheckout = async function(invoice, opts){
    opts = opts || {};
    if(!invoice || !invoice.amount){ alert('Invalid invoice.'); return null; }
    if(typeof window.glStartBusy === 'function') window.glStartBusy('Creating Stripe Checkout…');
    try {
      var token = null;
      try {
        var s = window.supa && await window.supa.auth.getSession();
        if(s && s.data && s.data.session) token = s.data.session.access_token;
      } catch(e){}
      var body = {
        amount: Math.round(invoice.amount * 100),  // Stripe uses cents
        currency: opts.currency || 'usd',
        client_email: invoice.clientEmail || (function(){
          var c = (window.clients||[]).find(function(x){ return x.id === invoice.client; });
          return c ? c.email : '';
        })(),
        invoice_id: invoice.id,
        description: 'Invoice ' + invoice.id + ' — ' + (invoice.svc || invoice.clientName || ''),
        success_url: location.origin + '/?stripe=success&invoice=' + encodeURIComponent(invoice.id),
        cancel_url:  location.origin + '/?stripe=cancel&invoice=' + encodeURIComponent(invoice.id)
      };
      var r = await fetch(getFnUrl(), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type':'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
        body: JSON.stringify(body)
      });
      if(!r.ok){
        var t = await r.text();
        alert('Stripe Checkout failed: HTTP ' + r.status + '\n' + t.slice(0,300));
        return null;
      }
      var data = await r.json();
      if(!data.url){ alert('No checkout URL returned.'); return null; }
      if(typeof window.glAudit === 'function') window.glAudit('stripe_checkout_open', invoice.id, { amount: invoice.amount });
      // Redirect (or open in new tab if explicitly requested)
      if(opts.newTab) window.open(data.url, '_blank', 'noopener');
      else window.location.href = data.url;
      return data;
    } catch(e){
      alert('Stripe Checkout error: ' + (e.message||''));
      return null;
    } finally {
      if(typeof window.glEndBusy === 'function') window.glEndBusy();
    }
  };

  // Inject "Charge" button on invoice detail panel (admin use)
  function injectChargeButton(){
    var detail = document.getElementById('cpg-invoice-detail') || document.querySelector('.inv-detail');
    if(!detail) return;
    if(detail.querySelector('.gl-stripe-charge-btn')) return;
    if(!window.currentInvId) return;
    var inv = (window.invoices||[]).find(function(i){ return i.id === window.currentInvId; });
    if(!inv || inv.status === 'paid' || inv.status === 'quote') return;
    var btnRow = detail.querySelector('.btn-row') || detail.querySelector('.cph');
    if(!btnRow) return;
    var btn = document.createElement('button');
    btn.className = 'cbtn gl-stripe-charge-btn';
    btn.setAttribute('style','background:rgba(168,85,247,.12);border:1px solid rgba(168,85,247,.35);color:#c4a4f8');
    btn.textContent = '💳 Charge via Stripe';
    btn.addEventListener('click', function(){
      if(!confirm('Open a Stripe Checkout for invoice ' + inv.id + ' ($' + Number(inv.amount||0).toLocaleString() + ')?')) return;
      window.glCreateStripeCheckout(inv);
    });
    btnRow.appendChild(btn);
  }

  // Watch the invoice-detail page for renders
  function startObs(){
    var pages = document.getElementById('crm-panel');
    if(pages){
      new MutationObserver(function(){ setTimeout(injectChargeButton, 80); }).observe(pages, { childList:true, subtree:true });
      injectChargeButton();
    } else setTimeout(startObs, 700);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] Stripe Checkout sessions loaded');
}());

/* ============================================================
   E-SIGNATURES (Dropbox Sign, formerly HelloSign)
   - Admin sends a signature request from inside the CRM.
   - Browser → Supabase Edge Function (template in deploy notes)
     → Dropbox Sign API. The function holds the API key.
   - Two flows:
       1) Send from a saved template (admin creates the template
          in Dropbox Sign dashboard, pastes the template ID here)
       2) Send raw text (NDA quick-send) — function wraps it as
          a one-off PDF.
   ============================================================ */
(function(){
  var DEFAULT_FN_URL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/dropbox-sign';
  function getFnUrl(){ return (localStorage.getItem('gl_sign_fn_url') || DEFAULT_FN_URL).trim(); }

  // Saved templates as a JSON map: { name: template_id }
  function getTemplates(){
    try { return JSON.parse(localStorage.getItem('gl_sign_templates') || '{}'); }
    catch(e){ return {}; }
  }
  function saveTemplates(m){ localStorage.setItem('gl_sign_templates', JSON.stringify(m)); }

  // Helper: send a request via the Edge Function. payload shape:
  //   { template_id?, raw_text?, signer_email, signer_name,
  //     title, subject, message, custom_fields? }
  window.glRequestSignature = async function(payload){
    if(typeof window.glStartBusy === 'function') window.glStartBusy('Sending for signature…');
    try {
      var token = null;
      try {
        var s = window.supa && await window.supa.auth.getSession();
        if(s && s.data && s.data.session) token = s.data.session.access_token;
      } catch(e){}
      var r = await fetch(getFnUrl(), {
        method: 'POST',
        headers: Object.assign({ 'Content-Type':'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}),
        body: JSON.stringify(payload)
      });
      if(!r.ok){
        var t = await r.text();
        console.error('[GL sign] HTTP', r.status, t);
        return { ok: false, status: r.status, error: t };
      }
      var data = await r.json();
      if(typeof window.glAudit === 'function') window.glAudit('signature_sent', payload.signer_email, { template: payload.template_id || 'raw', title: payload.title });
      return { ok: true, data: data };
    } catch(e){
      console.error('[GL sign] threw', e);
      return { ok: false, error: e.message };
    } finally {
      if(typeof window.glEndBusy === 'function') window.glEndBusy();
    }
  };

  window.openSignSettings = function(){
    var prior = document.getElementById('gl-sign-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var url = getFnUrl();
    var tpls = getTemplates();
    var tplRows = Object.keys(tpls).map(function(name){
      return '<div data-name="' + name + '" style="display:flex;align-items:center;gap:9px;padding:7px 10px;background:rgba(255,255,255,.03);border-radius:6px;margin-bottom:5px;font-size:12px">' +
        '<div style="flex:1"><div style="color:#fff;font-weight:600">' + name + '</div>' +
        '<div style="font-family:var(--ff-mono);font-size:10px;color:#9aa7bd">' + tpls[name] + '</div></div>' +
        '<button class="gl-sign-tpl-del" data-name="' + name + '" style="background:rgba(231,76,60,.15);border:1px solid rgba(231,76,60,.3);color:#e74c3c;border-radius:5px;padding:3px 8px;font-size:10px;cursor:pointer">remove</button>' +
      '</div>';
    }).join('') || '<div style="font-size:11px;color:#9aa7bd;padding:8px 2px">No templates saved yet.</div>';

    var ov = document.createElement('div');
    ov.id = 'gl-sign-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:920;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:540px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">📝 E-SIGNATURES</div>' +
          '<button id="gl-sign-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="background:rgba(245,200,66,.06);border:1px solid rgba(245,200,66,.2);border-radius:8px;padding:11px;font-size:11px;color:#f5c842;margin-bottom:16px;line-height:1.6">' +
          '⚠ Routes through a Supabase Edge Function (template in deploy notes). Deploy with your Dropbox Sign API key before requests will send.' +
        '</div>' +
        '<div class="frow"><div class="flbl">Edge Function URL</div>' +
          '<input class="finp" id="gl-sign-url" value="' + url.replace(/"/g,'&quot;') + '" style="font-family:var(--ff-mono);font-size:11px">' +
        '</div>' +
        '<div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin:14px 0 8px">SAVED TEMPLATES</div>' +
        '<div id="gl-sign-tpls" style="margin-bottom:12px">' + tplRows + '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 2fr;gap:8px;margin-bottom:10px">' +
          '<input class="finp" id="gl-sign-tpl-name" placeholder="Friendly name (e.g. NDA)">' +
          '<input class="finp" id="gl-sign-tpl-id" placeholder="Template ID from Dropbox Sign" style="font-family:var(--ff-mono);font-size:11px">' +
        '</div>' +
        '<button id="gl-sign-tpl-add" class="cbtn" style="width:100%;margin-bottom:18px">+ Add template</button>' +
        '<div style="display:flex;gap:8px">' +
          '<button id="gl-sign-save" class="cbtn pri" style="flex:1">💾 Save URL</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-sign-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-sign-save').addEventListener('click', function(){
      var u = (ov.querySelector('#gl-sign-url').value||'').trim();
      if(u) localStorage.setItem('gl_sign_fn_url', u); else localStorage.removeItem('gl_sign_fn_url');
      ov.remove();
      if(typeof addNotification === 'function') addNotification('📝 E-signature settings saved','','success');
    });
    ov.querySelector('#gl-sign-tpl-add').addEventListener('click', function(){
      var name = (ov.querySelector('#gl-sign-tpl-name').value||'').trim();
      var id   = (ov.querySelector('#gl-sign-tpl-id').value||'').trim();
      if(!name || !id){ alert('Both name and template ID are required.'); return; }
      var m = getTemplates();
      m[name] = id;
      saveTemplates(m);
      window.openSignSettings();  // reopen to refresh the list
    });
    ov.querySelectorAll('.gl-sign-tpl-del').forEach(function(b){
      b.addEventListener('click', function(){
        var n = b.getAttribute('data-name');
        if(!confirm('Remove template "' + n + '"?')) return;
        var m = getTemplates();
        delete m[n];
        saveTemplates(m);
        window.openSignSettings();
      });
    });
    host.appendChild(ov);
  };

  // Send-for-signature modal (per invoice / client)
  window.glOpenSendForSignature = function(context){
    context = context || {};
    var prior = document.getElementById('gl-sign-send-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var tpls = getTemplates();
    var tplOptions = '<option value="">— Raw text (no template) —</option>' +
      Object.keys(tpls).map(function(n){ return '<option value="' + tpls[n] + '">' + n + '</option>'; }).join('');
    var ov = document.createElement('div');
    ov.id = 'gl-sign-send-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:930;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:560px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">📝 SEND FOR SIGNATURE</div>' +
          '<button id="gl-sign-send-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Template</div>' +
          '<select class="fsel" id="gl-sign-tpl">' + tplOptions + '</select>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Signer name</div>' +
          '<input class="finp" id="gl-sign-sname" value="' + (context.signerName||'').replace(/"/g,'&quot;') + '">' +
        '</div>' +
        '<div class="frow"><div class="flbl">Signer email</div>' +
          '<input class="finp" id="gl-sign-semail" value="' + (context.signerEmail||'').replace(/"/g,'&quot;') + '">' +
        '</div>' +
        '<div class="frow"><div class="flbl">Title</div>' +
          '<input class="finp" id="gl-sign-title" value="' + (context.title||'').replace(/"/g,'&quot;') + '">' +
        '</div>' +
        '<div class="frow"><div class="flbl">Message to signer (optional)</div>' +
          '<textarea class="finp" id="gl-sign-msg" rows="3">' + (context.message||'') + '</textarea>' +
        '</div>' +
        '<div id="gl-sign-raw-wrap" style="display:none">' +
          '<div class="frow"><div class="flbl">Document text (for raw signature)</div>' +
            '<textarea class="finp" id="gl-sign-raw" rows="6" placeholder="Paste your NDA / agreement text here…"></textarea>' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;margin-top:6px">' +
          '<button id="gl-sign-send-btn" class="cbtn pri" style="flex:1">📤 Send</button>' +
          '<button id="gl-sign-cancel" class="cbtn">Cancel</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    var tpl = ov.querySelector('#gl-sign-tpl');
    var rawWrap = ov.querySelector('#gl-sign-raw-wrap');
    function updateRawVisibility(){ rawWrap.style.display = tpl.value ? 'none' : 'block'; }
    tpl.addEventListener('change', updateRawVisibility); updateRawVisibility();
    ov.querySelector('#gl-sign-send-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-sign-cancel').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-sign-send-btn').addEventListener('click', async function(){
      var payload = {
        template_id: ov.querySelector('#gl-sign-tpl').value || null,
        raw_text:    ov.querySelector('#gl-sign-tpl').value ? null : (ov.querySelector('#gl-sign-raw').value || '').trim(),
        signer_name:  ov.querySelector('#gl-sign-sname').value.trim(),
        signer_email: ov.querySelector('#gl-sign-semail').value.trim(),
        title:        ov.querySelector('#gl-sign-title').value.trim() || 'Please sign',
        subject:      'Please sign: ' + (ov.querySelector('#gl-sign-title').value.trim() || ''),
        message:      ov.querySelector('#gl-sign-msg').value
      };
      if(!payload.signer_email || payload.signer_email.indexOf('@') < 0){ alert('Signer email required'); return; }
      if(!payload.template_id && !payload.raw_text){ alert('Pick a template or paste document text.'); return; }
      var btn = this; btn.disabled = true; btn.textContent = 'Sending…';
      var r = await window.glRequestSignature(payload);
      if(r.ok){
        if(typeof addNotification === 'function') addNotification('📝 Signature request sent', payload.signer_email, 'success');
        ov.remove();
        alert('✓ Request sent to ' + payload.signer_email + '.');
      } else {
        alert('✗ Failed: ' + (r.error || ('HTTP ' + r.status)));
        btn.disabled = false; btn.textContent = '📤 Send';
      }
    });
    host.appendChild(ov);
  };

  // Inject "📝 Sign" button on invoice detail panel
  function injectSignButton(){
    var detail = document.getElementById('cpg-invoice-detail') || document.querySelector('.inv-detail');
    if(!detail) return;
    if(detail.querySelector('.gl-sign-btn')) return;
    if(!window.currentInvId) return;
    var inv = (window.invoices||[]).find(function(i){ return i.id === window.currentInvId; });
    if(!inv) return;
    var btnRow = detail.querySelector('.btn-row') || detail.querySelector('.cph');
    if(!btnRow) return;
    var client = (window.clients||[]).find(function(c){ return c.id === inv.client; }) || {};
    var btn = document.createElement('button');
    btn.className = 'cbtn gl-sign-btn';
    btn.setAttribute('style','background:rgba(168,85,247,.12);border:1px solid rgba(168,85,247,.35);color:#c4a4f8');
    btn.textContent = '📝 Send for signature';
    btn.addEventListener('click', function(){
      window.glOpenSendForSignature({
        signerName: client.contact || client.name || inv.clientName,
        signerEmail: client.email || inv.clientEmail || '',
        title: 'Quote / Invoice ' + inv.id,
        message: 'Please review and sign the attached document for invoice ' + inv.id + '.'
      });
    });
    btnRow.appendChild(btn);
  }
  function startObs(){
    var pages = document.getElementById('crm-panel');
    if(pages){
      new MutationObserver(function(){ setTimeout(injectSignButton, 80); }).observe(pages, { childList:true, subtree:true });
      injectSignButton();
    } else setTimeout(startObs, 700);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] E-signatures (Dropbox Sign) loaded');
}());

/* ============================================================
   QUICKBOOKS ONLINE — connect + invoice push
   - OAuth lives in Supabase Edge Functions (qbo-connect /
     qbo-callback). The function holds the client_id, client_secret,
     refresh_token, and realm_id.
   - Browser opens /qbo-connect in a popup. Intuit redirects to
     /qbo-callback which stores tokens server-side and posts
     "qbo_connected" back to the opener via window.postMessage.
   - Push: POST invoice JSON to /qbo-push-invoice. Function maps
     to QuickBooks Invoice + CustomerRef and returns QB invoice id.
   - All three URLs share a base configured in settings.
   ============================================================ */
(function(){
  var DEFAULT_BASE = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1';
  function getBase(){ return (localStorage.getItem('gl_qbo_fn_base') || DEFAULT_BASE).trim().replace(/\/$/, ''); }
  function fnUrl(name){ return getBase() + '/' + name; }

  function isConnected(){ return localStorage.getItem('gl_qbo_connected') === '1'; }
  function setConnected(v){
    if(v) localStorage.setItem('gl_qbo_connected','1');
    else localStorage.removeItem('gl_qbo_connected');
  }

  // Listen for the OAuth-callback postMessage from the popup.
  window.addEventListener('message', function(ev){
    if(!ev || !ev.data) return;
    if(ev.data === 'qbo_connected' || (ev.data && ev.data.type === 'qbo_connected')){
      setConnected(true);
      if(typeof addNotification === 'function') addNotification('💼 QuickBooks connected','','success');
      if(typeof window.glAudit === 'function') window.glAudit('qbo_connected', '', {});
      // refresh settings modal if open
      var s = document.getElementById('gl-qbo-modal'); if(s){ s.remove(); window.openQBOSettings(); }
    }
  });

  async function authHeader(){
    try {
      var s = window.supa && await window.supa.auth.getSession();
      if(s && s.data && s.data.session) return { Authorization: 'Bearer ' + s.data.session.access_token };
    } catch(e){}
    return {};
  }

  window.glConnectQBO = async function(){
    var hdr = await authHeader();
    // Two-step: ask the function for an Intuit OAuth URL, then open the popup.
    try {
      var r = await fetch(fnUrl('qbo-connect'), { method:'POST', headers: Object.assign({'Content-Type':'application/json'}, hdr), body: JSON.stringify({ origin: location.origin }) });
      if(!r.ok){ alert('Could not start QBO connect: HTTP ' + r.status); return; }
      var d = await r.json();
      if(!d.auth_url){ alert('Function did not return auth_url.'); return; }
      var w = 620, h = 720;
      var l = (screen.width - w) / 2, t = (screen.height - h) / 2;
      window.open(d.auth_url, 'qbo_oauth', 'width=' + w + ',height=' + h + ',left=' + l + ',top=' + t);
    } catch(e){
      alert('QBO connect failed: ' + (e.message || ''));
    }
  };

  window.glDisconnectQBO = async function(){
    if(!confirm('Disconnect QuickBooks Online? You will need to reconnect to push invoices.')) return;
    var hdr = await authHeader();
    try {
      await fetch(fnUrl('qbo-disconnect'), { method:'POST', headers: hdr });
    } catch(e){}
    setConnected(false);
    if(typeof window.glAudit === 'function') window.glAudit('qbo_disconnected', '', {});
    if(typeof addNotification === 'function') addNotification('💼 QuickBooks disconnected','','info');
    var s = document.getElementById('gl-qbo-modal'); if(s){ s.remove(); window.openQBOSettings(); }
  };

  window.glPushInvoiceToQBO = async function(invoice){
    if(!invoice) return { ok:false, error:'no invoice' };
    if(!isConnected()){
      if(!confirm('QuickBooks not connected. Open settings to connect?')) return { ok:false, error:'not connected' };
      window.openQBOSettings(); return { ok:false, error:'not connected' };
    }
    if(typeof window.glStartBusy === 'function') window.glStartBusy('Pushing to QuickBooks…');
    try {
      var client = (window.clients||[]).find(function(c){ return c.id === invoice.client; }) || {};
      var payload = {
        invoice_id: invoice.id,
        amount:     invoice.total || invoice.amount || 0,
        currency:   'USD',
        issued_at:  invoice.issuedAt || invoice.date || new Date().toISOString().slice(0,10),
        due_at:     invoice.dueAt || invoice.due || null,
        status:     invoice.status || 'sent',
        notes:      invoice.notes || '',
        customer: {
          name:    client.name || invoice.clientName || '(unknown)',
          email:   client.email || invoice.clientEmail || '',
          company: client.company || ''
        },
        lines: (invoice.lines || []).map(function(l){
          return { description: l.description || l.desc || '', qty: l.qty || l.quantity || 1, unit_price: l.unitPrice || l.price || 0, total: l.total || 0, category: l.category || '' };
        })
      };
      var hdr = await authHeader();
      var r = await fetch(fnUrl('qbo-push-invoice'), {
        method:'POST',
        headers: Object.assign({'Content-Type':'application/json'}, hdr),
        body: JSON.stringify(payload)
      });
      var bodyText = await r.text();
      var data; try { data = JSON.parse(bodyText); } catch(e){ data = { raw: bodyText }; }
      if(!r.ok){
        console.error('[GL QBO] push failed', r.status, data);
        return { ok:false, status: r.status, error: (data && (data.error || data.raw)) || ('HTTP ' + r.status) };
      }
      // Persist the QB id on the invoice so we don't double-push.
      try {
        invoice.qboId = data.qbo_invoice_id || data.Id || data.id;
        invoice.qboPushedAt = new Date().toISOString();
        if(window.supa && invoice.qboId){
          await window.supa.from('invoices').update({ qbo_id: invoice.qboId, qbo_pushed_at: invoice.qboPushedAt }).eq('id', invoice.id);
        }
      } catch(e){}
      if(typeof window.glAudit === 'function') window.glAudit('qbo_invoice_pushed', invoice.id, { qbo_id: invoice.qboId });
      return { ok:true, data: data };
    } catch(e){
      console.error('[GL QBO] threw', e);
      return { ok:false, error: e.message };
    } finally {
      if(typeof window.glEndBusy === 'function') window.glEndBusy();
    }
  };

  window.openQBOSettings = function(){
    var prior = document.getElementById('gl-qbo-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var connected = isConnected();
    var ov = document.createElement('div');
    ov.id = 'gl-qbo-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:920;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:520px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">💼 QUICKBOOKS ONLINE</div>' +
          '<button id="gl-qbo-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="background:rgba(245,200,66,.06);border:1px solid rgba(245,200,66,.2);border-radius:8px;padding:11px;font-size:11px;color:#f5c842;margin-bottom:16px;line-height:1.6">' +
          '⚠ Routes through three Supabase Edge Functions (qbo-connect, qbo-callback, qbo-push-invoice). Deploy them with your Intuit app credentials before connecting.' +
        '</div>' +
        '<div class="frow"><div class="flbl">Edge Function base URL</div>' +
          '<input class="finp" id="gl-qbo-base" value="' + getBase().replace(/"/g,'&quot;') + '" style="font-family:var(--ff-mono);font-size:11px">' +
          '<div style="font-size:10px;color:#9aa7bd;margin-top:4px">e.g. https://&lt;project-ref&gt;.supabase.co/functions/v1</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.03);border-radius:8px;padding:12px;margin:14px 0">' +
          '<div style="flex:1">' +
            '<div style="font-size:11px;letter-spacing:1.5px;color:#9aa7bd">STATUS</div>' +
            '<div style="font-size:14px;color:' + (connected?'#00e5c0':'#f5c842') + ';font-weight:600">' + (connected?'● Connected':'○ Not connected') + '</div>' +
          '</div>' +
          (connected
            ? '<button id="gl-qbo-disc" class="cbtn" style="background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#ff8579">Disconnect</button>'
            : '<button id="gl-qbo-conn" class="cbtn pri">Connect to QuickBooks</button>') +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
          '<button id="gl-qbo-save" class="cbtn pri" style="flex:1">💾 Save URL</button>' +
          (connected ? '<button id="gl-qbo-sync" class="cbtn">⟳ Sync paid invoices</button>' : '') +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-qbo-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-qbo-save').addEventListener('click', function(){
      var u = (ov.querySelector('#gl-qbo-base').value||'').trim().replace(/\/$/, '');
      if(u) localStorage.setItem('gl_qbo_fn_base', u); else localStorage.removeItem('gl_qbo_fn_base');
      ov.remove();
      if(typeof addNotification === 'function') addNotification('💼 QuickBooks settings saved','','success');
    });
    var c = ov.querySelector('#gl-qbo-conn'); if(c) c.addEventListener('click', function(){ window.glConnectQBO(); });
    var d = ov.querySelector('#gl-qbo-disc'); if(d) d.addEventListener('click', function(){ window.glDisconnectQBO(); });
    var s = ov.querySelector('#gl-qbo-sync'); if(s) s.addEventListener('click', async function(){
      var paid = (window.invoices||[]).filter(function(i){ return (i.status||'').toLowerCase() === 'paid' && !i.qboId; });
      if(!paid.length){ alert('No unsynced paid invoices.'); return; }
      if(!confirm('Push ' + paid.length + ' paid invoice(s) to QuickBooks?')) return;
      s.disabled = true; s.textContent = 'Syncing 0/' + paid.length + '…';
      var ok = 0, fail = 0;
      for(var i = 0; i < paid.length; i++){
        s.textContent = 'Syncing ' + (i+1) + '/' + paid.length + '…';
        var r = await window.glPushInvoiceToQBO(paid[i]);
        if(r.ok) ok++; else fail++;
      }
      alert('Done — ' + ok + ' pushed, ' + fail + ' failed.');
      ov.remove(); window.openQBOSettings();
    });
    host.appendChild(ov);
  };

  // Inject "💼 Push to QuickBooks" button on the invoice detail panel
  function injectQBOButton(){
    var detail = document.getElementById('cpg-invoice-detail') || document.querySelector('.inv-detail');
    if(!detail) return;
    if(detail.querySelector('.gl-qbo-btn')) return;
    if(!window.currentInvId) return;
    var inv = (window.invoices||[]).find(function(i){ return i.id === window.currentInvId; });
    if(!inv) return;
    var btnRow = detail.querySelector('.btn-row') || detail.querySelector('.cph');
    if(!btnRow) return;
    var btn = document.createElement('button');
    btn.className = 'cbtn gl-qbo-btn';
    btn.setAttribute('style','background:rgba(45,156,219,.12);border:1px solid rgba(45,156,219,.35);color:#7fc6f5');
    btn.textContent = inv.qboId ? ('💼 QBO #' + inv.qboId) : '💼 Push to QuickBooks';
    if(inv.qboId) btn.disabled = true;
    btn.addEventListener('click', async function(){
      if(inv.qboId) return;
      btn.disabled = true; btn.textContent = 'Pushing…';
      var r = await window.glPushInvoiceToQBO(inv);
      if(r.ok){
        btn.textContent = '💼 QBO #' + (inv.qboId || '?');
        if(typeof addNotification === 'function') addNotification('💼 Invoice pushed to QuickBooks', inv.id, 'success');
      } else {
        btn.disabled = false; btn.textContent = '💼 Push to QuickBooks';
        alert('Push failed: ' + (r.error || ('HTTP ' + r.status)));
      }
    });
    btnRow.appendChild(btn);
  }
  function startObs(){
    var pages = document.getElementById('crm-panel');
    if(pages){
      new MutationObserver(function(){ setTimeout(injectQBOButton, 80); }).observe(pages, { childList:true, subtree:true });
      injectQBOButton();
    } else setTimeout(startObs, 700);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] QuickBooks Online loaded');
}());

/* ============================================================
   DELETE INVOICE
   - Confirm prompt (paid invoices double-confirm for safety).
   - Hard delete from Supabase by invoice_number (preferred) or by
     row id (supaId) when present. Local-only invoices skip the
     Supabase call.
   - Splice from window.invoices, re-render list + dashboard.
   - Close the detail panel if the deleted invoice is currently open.
   - Audit log via glAudit (if loaded).
   ============================================================ */
(function(){
  window.deleteInvoice = async function(id, opts){
    opts = opts || {};
    var list = window.invoices || [];
    var inv = list.find(function(i){ return i.id === id || i.supaId === id; });
    if(!inv){ alert('Invoice not found.'); return false; }

    var label = inv.id + (inv.clientName ? ' — ' + inv.clientName : '');
    if(!opts.skipConfirm){
      var msg = 'Delete invoice ' + label + '?\n\nThis cannot be undone.';
      if(inv.status === 'paid') msg = '⚠ This invoice is marked PAID.\n\n' + msg + '\n\nIf this was already paid out, deleting it will remove the revenue from reports.';
      if(!confirm(msg)) return false;
    }

    var sb = window.supa;
    if(sb){
      try {
        var q;
        // Prefer the human-readable invoice_number; fall back to row id when supaId exists.
        if(inv.id && /^GL-/i.test(inv.id)){
          q = await sb.from('invoices').delete().eq('invoice_number', inv.id);
        } else if(inv.supaId){
          q = await sb.from('invoices').delete().eq('id', inv.supaId);
        }
        if(q && q.error){
          console.warn('[GL] invoice delete: supabase error', q.error);
          if(!confirm('Server reported: ' + q.error.message + '\n\nRemove from this session anyway?')) return false;
        }
      } catch(e){
        console.warn('[GL] invoice delete: supabase threw', e);
        if(!confirm('Could not reach the server.\n\nRemove from this session anyway?')) return false;
      }
    }

    // Remove from in-memory list.
    var idx = list.indexOf(inv);
    if(idx >= 0) list.splice(idx, 1);

    // Close the detail panel if it's showing this invoice.
    if(window.currentInvId === inv.id || window.currentInvId === inv.supaId){
      window.currentInvId = null;
      var d = document.getElementById('inv-detail');
      if(d) d.classList.remove('show');
      if(typeof closeDetail === 'function') try { closeDetail(); } catch(e){}
    }

    if(typeof renderInvoices === 'function') try { renderInvoices(); } catch(e){}
    if(typeof renderDash === 'function')     try { renderDash();     } catch(e){}
    if(typeof renderActivity === 'function') try { renderActivity(); } catch(e){}

    if(typeof window.glAudit === 'function') window.glAudit('invoice_deleted', inv.id, { client: inv.clientName||'', amount: inv.amount||0, status: inv.status||'' });
    if(typeof addNotification === 'function') addNotification('🗑 Invoice deleted', label, 'warning');
    return true;
  };

  /* Auto-inject a delete button on the invoice-detail panel header so the
     user has a place to delete from the open view, not just the row. */
  function injectDeleteBtn(){
    var detailHeader = document.querySelector('#inv-detail > div:first-child');
    if(!detailHeader) return;
    if(detailHeader.querySelector('.gl-del-inv-btn')) return;
    var btn = document.createElement('button');
    btn.className = 'cbtn gl-del-inv-btn';
    btn.setAttribute('style','background:rgba(231,76,60,.12);border:1px solid rgba(231,76,60,.4);color:#ff8579');
    btn.textContent = '🗑 Delete';
    btn.addEventListener('click', function(){
      if(window.currentInvId) window.deleteInvoice(window.currentInvId);
    });
    detailHeader.appendChild(btn);
  }
  function startObs(){
    var panel = document.getElementById('crm-panel');
    if(panel){
      new MutationObserver(function(){ setTimeout(injectDeleteBtn, 60); }).observe(panel, { childList:true, subtree:true });
      injectDeleteBtn();
    } else setTimeout(startObs, 700);
  }
  if(document.readyState !== 'loading') startObs();
  else document.addEventListener('DOMContentLoaded', startObs);

  console.log('[GL] deleteInvoice loaded');
}());

/* ============================================================
   EDIT CLIENT NOTES
   Inline-editable notes textarea on both client detail panels. The
   panels render a textarea + Save button (no separate edit modal);
   this helper persists the change to Supabase and the in-memory
   record. Used by the buttons wired in openClientDetail and
   viewClientEnhanced.
   ============================================================ */
(function(){
  window.glSaveClientNotes = async function(clientId, notesText){
    var c = (window.clients||[]).find(function(x){ return x.id === clientId; });
    if(!c){ alert('Client not found.'); return false; }
    var trimmed = (notesText == null ? '' : String(notesText)).trim();
    c.notes = trimmed;

    if(window.supa){
      try {
        var r = await window.supa.from('clients').update({ notes: trimmed }).eq('id', clientId);
        if(r && r.error){
          console.warn('[GL] glSaveClientNotes: supabase error', r.error);
          if(typeof addNotification === 'function') addNotification('Notes saved locally','Server error — see console','warning');
          return false;
        }
      } catch(e){
        console.warn('[GL] glSaveClientNotes threw', e);
        if(typeof addNotification === 'function') addNotification('Notes saved locally','Server unreachable','warning');
        return false;
      }
    }
    if(typeof window.glAudit === 'function') window.glAudit('client_notes_edited', clientId, { length: trimmed.length });
    if(typeof addNotification === 'function') addNotification('📝 Notes saved', c.name, 'success');
    return true;
  };

  /* Helper used by both detail panels to render a consistent
     "click to expand, save inline" notes block.
     Returns an HTML string with a textarea + save button. */
  window.glRenderClientNotesBlock = function(client){
    var notes = (client.notes||'').replace(/</g,'&lt;');
    return ''
      + '<div style="margin-bottom:18px">'
      +   '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
      +     '<div style="font-size:10px;letter-spacing:2px;color:var(--muted)">NOTES</div>'
      +     '<span id="gl-notes-status-'+client.id+'" style="font-size:11px;color:var(--muted)">'+(client.notes ? '' : 'empty — add some')+'</span>'
      +   '</div>'
      +   '<textarea id="gl-notes-'+client.id+'" rows="4" placeholder="Add notes about this client — preferences, history, key dates…" '
      +     'style="width:100%;padding:11px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--white);font-size:13px;font-family:var(--ff-body);resize:vertical;line-height:1.5">'+notes+'</textarea>'
      +   '<div style="display:flex;justify-content:flex-end;margin-top:6px">'
      +     '<button class="cbtn pri" style="font-size:12px;padding:6px 14px" '
      +       'onclick="(async function(){'
      +         'var t=document.getElementById(\'gl-notes-'+client.id+'\').value;'
      +         'var s=document.getElementById(\'gl-notes-status-'+client.id+'\');'
      +         'var btn=event.target;var orig=btn.textContent;btn.disabled=true;btn.textContent=\'Saving…\';'
      +         'var ok=await window.glSaveClientNotes(\''+client.id+'\',t);'
      +         'btn.disabled=false;btn.textContent=orig;'
      +         'if(s) s.textContent=ok?\'✓ saved\':\'⚠ saved locally only\';'
      +         'setTimeout(function(){if(s)s.textContent=\'\';},2500);'
      +       '})()">💾 Save notes</button>'
      +   '</div>'
      + '</div>';
  };

  console.log('[GL] editable client notes loaded');
}());

/* ============================================================
   EDIT CLIENT — full record editor
   Opens a modal pre-filled with the current client's values. On save,
   updates Supabase + the in-memory client and re-renders the list,
   dashboard, and (if still open) the client detail panel.

   Covers every field collected at create time:
     name, contact, email, phone,
     street, city, state, zip,
     comm_prefs (Email / SMS / WhatsApp / WeChat),
     service, status, referred_by, notes.
   ============================================================ */
(function(){
  var INPUT_STYLE = 'width:100%;padding:11px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--white);font-size:14px;font-family:var(--ff-body)';
  var LABEL_STYLE = 'font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:5px';

  function esc(v){
    if(v == null) return '';
    return String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  }

  window.glOpenEditClient = function(clientId){
    var c = (window.clients||[]).find(function(x){ return x.id === clientId; });
    if(!c){ alert('Client not found.'); return; }

    var prior = document.getElementById('gl-edit-client-modal');
    if(prior) prior.remove();

    var host = document.getElementById('crm-panel') || document.body;
    var refOptions = '<option value="">None</option>' +
      (window.referrers||[]).map(function(r){
        var sel = (c.referredBy === r.id) ? ' selected' : '';
        return '<option value="'+esc(r.id)+'"'+sel+'>'+esc(r.name)+'</option>';
      }).join('');

    var serviceOptions = ['','Canning','Bottling','R&D','R&D + Canning','Consulting'].map(function(s){
      var v = s; var label = s || 'Select service…';
      var sel = (c.service === v) ? ' selected' : '';
      return '<option value="'+esc(v)+'"'+sel+'>'+esc(label)+'</option>';
    }).join('');

    var statusOptions = ['lead','active','inactive'].map(function(s){
      var sel = ((c.status||'lead') === s) ? ' selected' : '';
      return '<option value="'+s+'"'+sel+'>'+s.charAt(0).toUpperCase()+s.slice(1)+'</option>';
    }).join('');

    var commPrefs = Array.isArray(c.commPrefs) ? c.commPrefs : [];
    function ck(key){ return commPrefs.indexOf(key) >= 0 ? ' checked' : ''; }
    var productTypes = Array.isArray(c.productTypes) ? c.productTypes : [];
    function pt(key){ return productTypes.indexOf(key) >= 0 ? ' checked' : ''; }

    var paymentTermsOptions = ['Due on receipt','Net 15','Net 30','Net 60','Prepaid','COD'].map(function(t){
      var sel = ((c.paymentTerms||'Due on receipt') === t) ? ' selected' : '';
      return '<option value="'+esc(t)+'"'+sel+'>'+esc(t)+'</option>';
    }).join('');

    var ownerOptions = '<option value="">Unassigned</option>' +
      (window.users||[]).filter(function(u){ return u.status !== 'inactive'; }).map(function(u){
        var sel = (c.accountOwner === u.id) ? ' selected' : '';
        return '<option value="'+esc(u.id)+'"'+sel+'>'+esc(u.name)+' ('+esc(u.role)+')</option>';
      }).join('');

    var billingSame  = c.billingSame  !== false;
    var shippingSame = c.shippingSame !== false;

    var contactTypeOptions = [
      ['',''], ['owner','Owner'], ['executive','Executive'], ['purchasing','Purchasing'],
      ['freight','Freight / Logistics'], ['sales','Sales'], ['other','Other']
    ].map(function(o){
      var sel = ((c.contactType||'') === o[0]) ? ' selected' : '';
      return '<option value="'+esc(o[0])+'"'+sel+'>'+esc(o[1]||'Contact type…')+'</option>';
    }).join('');

    var leadSourceOptions = [
      ['',''], ['google','Google search'], ['instagram','Instagram'], ['linkedin','LinkedIn'],
      ['trade_show','Trade show'], ['industry_pub','Industry publication'],
      ['customer_referral','Customer referral'], ['word_of_mouth','Word of mouth'],
      ['cold_outreach','Cold outreach (they reached us)'], ['returning','Returning customer'],
      ['other','Other']
    ].map(function(o){
      var sel = ((c.leadSource||'') === o[0]) ? ' selected' : '';
      return '<option value="'+esc(o[0])+'"'+sel+'>'+esc(o[1]||'Select…')+'</option>';
    }).join('');

    var paymentMethodOptions = [
      ['',''], ['ach','ACH'], ['wire','Wire'], ['credit_card','Credit card (3% fee)'], ['check','Check']
    ].map(function(o){
      var sel = ((c.paymentMethod||'') === o[0]) ? ' selected' : '';
      return '<option value="'+esc(o[0])+'"'+sel+'>'+esc(o[1]||'Select…')+'</option>';
    }).join('');

    var dockDaysArr = Array.isArray(c.dockDays) ? c.dockDays : [];
    function dck(day){ return dockDaysArr.indexOf(day) >= 0 ? ' checked' : ''; }

    var ov = document.createElement('div');
    ov.id = 'gl-edit-client-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1050;background:rgba(6,13,26,.92);backdrop-filter:blur(12px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:32px;width:100%;max-width:520px;max-height:90vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:22px">' +
          '<div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:2px;color:var(--teal)">EDIT CLIENT</div>' +
          '<button id="gl-ec-close" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:12px">' +
          '<div><div style="'+LABEL_STYLE+'">BRAND NAME *</div><input id="gl-ec-name" value="'+esc(c.name)+'" style="'+INPUT_STYLE+'"></div>' +
          '<div><div style="'+LABEL_STYLE+'">LEGAL BUSINESS NAME <span style="opacity:.6">(if different)</span></div><input id="gl-ec-legal-name" value="'+esc(c.legalName)+'" style="'+INPUT_STYLE+'"></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div><div style="'+LABEL_STYLE+'">EIN / TAX ID</div><input id="gl-ec-ein" placeholder="XX-XXXXXXX" value="'+esc(c.ein)+'" style="'+INPUT_STYLE+'"></div>' +
            '<div><div style="'+LABEL_STYLE+'">WEBSITE</div><input id="gl-ec-website" placeholder="https://" value="'+esc(c.website)+'" style="'+INPUT_STYLE+'"></div>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:12px">' +
            '<div style="'+LABEL_STYLE+';margin-bottom:8px">MAIN POINT OF CONTACT</div>' +
            '<div style="display:flex;flex-direction:column;gap:8px">' +
              '<input id="gl-ec-contact" placeholder="Name" value="'+esc(c.contact)+'" style="'+INPUT_STYLE+'">' +
              '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
                '<input id="gl-ec-email" type="email" placeholder="Email" value="'+esc(c.email)+'" style="'+INPUT_STYLE+'">' +
                '<input id="gl-ec-phone" placeholder="Phone" value="'+esc(c.phone)+'" style="'+INPUT_STYLE+'">' +
              '</div>' +
              '<select id="gl-ec-contact-type" style="'+INPUT_STYLE+'">'+contactTypeOptions+'</select>' +
            '</div>' +
          '</div>' +
          '<div><div style="'+LABEL_STYLE+'">STREET ADDRESS</div><input id="gl-ec-street" value="'+esc(c.street)+'" style="'+INPUT_STYLE+'"></div>' +
          '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px">' +
            '<div><div style="'+LABEL_STYLE+'">CITY</div><input id="gl-ec-city" value="'+esc(c.city)+'" style="'+INPUT_STYLE+'"></div>' +
            '<div><div style="'+LABEL_STYLE+'">STATE</div><input id="gl-ec-state" maxlength="2" value="'+esc(c.state)+'" style="'+INPUT_STYLE+';text-transform:uppercase"></div>' +
            '<div><div style="'+LABEL_STYLE+'">ZIP</div><input id="gl-ec-zip" value="'+esc(c.zip)+'" style="'+INPUT_STYLE+'"></div>' +
          '</div>' +
          '<div>' +
            '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--white);cursor:pointer;margin-bottom:8px">' +
              '<input type="checkbox" id="gl-ec-billing-same"'+(billingSame?' checked':'')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">' +
              'Billing address same as physical' +
            '</label>' +
            '<div id="gl-ec-billing-block" style="display:'+(billingSame?'none':'grid')+';grid-template-columns:1fr;gap:8px">' +
              '<input id="gl-ec-billing-street" placeholder="Billing street address" value="'+esc(c.billingStreet)+'" style="'+INPUT_STYLE+'">' +
              '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px">' +
                '<input id="gl-ec-billing-city" placeholder="City" value="'+esc(c.billingCity)+'" style="'+INPUT_STYLE+'">' +
                '<input id="gl-ec-billing-state" placeholder="State" maxlength="2" value="'+esc(c.billingState)+'" style="'+INPUT_STYLE+';text-transform:uppercase">' +
                '<input id="gl-ec-billing-zip" placeholder="Zip" value="'+esc(c.billingZip)+'" style="'+INPUT_STYLE+'">' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div>' +
            '<label style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--white);cursor:pointer;margin-bottom:8px">' +
              '<input type="checkbox" id="gl-ec-shipping-same"'+(shippingSame?' checked':'')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">' +
              'Shipping address same as billing' +
            '</label>' +
            '<div id="gl-ec-shipping-block" style="display:'+(shippingSame?'none':'grid')+';grid-template-columns:1fr;gap:8px">' +
              '<input id="gl-ec-shipping-street" placeholder="Shipping street address" value="'+esc(c.shippingStreet)+'" style="'+INPUT_STYLE+'">' +
              '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px">' +
                '<input id="gl-ec-shipping-city" placeholder="City" value="'+esc(c.shippingCity)+'" style="'+INPUT_STYLE+'">' +
                '<input id="gl-ec-shipping-state" placeholder="State" maxlength="2" value="'+esc(c.shippingState)+'" style="'+INPUT_STYLE+';text-transform:uppercase">' +
                '<input id="gl-ec-shipping-zip" placeholder="Zip" value="'+esc(c.shippingZip)+'" style="'+INPUT_STYLE+'">' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:12px">' +
            '<div style="'+LABEL_STYLE+';margin-bottom:8px">RECEIVING / LOGISTICS</div>' +
            '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--white);cursor:pointer;margin-bottom:10px">' +
              '<input type="checkbox" id="gl-ec-lift-gate"'+(c.liftGate?' checked':'')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🛗 Lift gate required for delivery' +
            '</label>' +
            '<div style="'+LABEL_STYLE+';margin-bottom:6px">LOADING DOCK DAYS</div>' +
            '<div style="display:flex;flex-wrap:wrap;gap:6px 12px;margin-bottom:10px">' +
              '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-dock-mon"'+dck('mon')+' style="accent-color:var(--teal);width:15px;height:15px;cursor:pointer">Mon</label>' +
              '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-dock-tue"'+dck('tue')+' style="accent-color:var(--teal);width:15px;height:15px;cursor:pointer">Tue</label>' +
              '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-dock-wed"'+dck('wed')+' style="accent-color:var(--teal);width:15px;height:15px;cursor:pointer">Wed</label>' +
              '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-dock-thu"'+dck('thu')+' style="accent-color:var(--teal);width:15px;height:15px;cursor:pointer">Thu</label>' +
              '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-dock-fri"'+dck('fri')+' style="accent-color:var(--teal);width:15px;height:15px;cursor:pointer">Fri</label>' +
              '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-dock-sat"'+dck('sat')+' style="accent-color:var(--teal);width:15px;height:15px;cursor:pointer">Sat</label>' +
              '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-dock-sun"'+dck('sun')+' style="accent-color:var(--teal);width:15px;height:15px;cursor:pointer">Sun</label>' +
            '</div>' +
            '<div style="'+LABEL_STYLE+';margin-bottom:5px">DOCK HOURS</div>' +
            '<input id="gl-ec-dock-hours" placeholder="e.g. 7am – 3pm" value="'+esc(c.dockHours)+'" style="'+INPUT_STYLE+'">' +
          '</div>' +
          '<div>' +
            '<div style="'+LABEL_STYLE+'">PREFERRED COMMUNICATION</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px">' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-comm-email"'+ck('email')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">✉️ Email</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-comm-sms"'+ck('sms')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">📱 SMS</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-comm-whatsapp"'+ck('whatsapp')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🟢 WhatsApp</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-comm-wechat"'+ck('wechat')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">💬 WeChat</label>' +
            '</div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div><div style="'+LABEL_STYLE+'">SERVICE</div><select id="gl-ec-service" style="'+INPUT_STYLE+'">'+serviceOptions+'</select></div>' +
            '<div><div style="'+LABEL_STYLE+'">STATUS</div><select id="gl-ec-status" style="'+INPUT_STYLE+'">'+statusOptions+'</select></div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div><div style="'+LABEL_STYLE+'">PAYMENT TERMS</div><select id="gl-ec-payment-terms" style="'+INPUT_STYLE+'">'+paymentTermsOptions+'</select></div>' +
            '<div><div style="'+LABEL_STYLE+'">ACCOUNT OWNER</div><select id="gl-ec-account-owner" style="'+INPUT_STYLE+'">'+ownerOptions+'</select></div>' +
          '</div>' +
          '<div><div style="'+LABEL_STYLE+'">REFERRED BY</div><select id="gl-ec-referrer" style="'+INPUT_STYLE+'">'+refOptions+'</select></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div><div style="'+LABEL_STYLE+'">HOW DID YOU FIND US?</div><select id="gl-ec-lead-source" style="'+INPUT_STYLE+'">'+leadSourceOptions+'</select></div>' +
            '<div><div style="'+LABEL_STYLE+'">PREFERRED PAYMENT METHOD</div><select id="gl-ec-payment-method" style="'+INPUT_STYLE+'">'+paymentMethodOptions+'</select></div>' +
          '</div>' +
          '<div>' +
            '<div style="'+LABEL_STYLE+'">PRODUCT TYPES</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px;padding:10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px">' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-seltzer"'+pt('seltzer')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🥤 Seltzer</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-kombucha"'+pt('kombucha')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🍵 Kombucha</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-coldbrew"'+pt('coldbrew')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">☕ Cold Brew</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-juice"'+pt('juice')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🧃 Juice</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-rtd"'+pt('rtd')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🍸 RTD Cocktail</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-energy"'+pt('energy')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">⚡ Energy</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-mocktail"'+pt('mocktail')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🍹 Mocktail</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-sparkling"'+pt('sparkling')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">💧 Sparkling Water</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-sports"'+pt('sports')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">🏃 Sports Drink</label>' +
              '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--white)"><input type="checkbox" id="gl-ec-pt-other"'+pt('other')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">📦 Other</label>' +
            '</div>' +
          '</div>' +
          '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:12px">' +
            '<div style="'+LABEL_STYLE+';margin-bottom:8px">COMPLIANCE DOCS</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">' +
              '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--white);cursor:pointer">' +
                '<input type="checkbox" id="gl-ec-coi-on-file"'+(c.coiOnFile?' checked':'')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">📄 Certificate of Insurance (COI) on file' +
              '</label>' +
              '<div><div style="'+LABEL_STYLE+';margin-bottom:3px">CERTIFICATE OF INSURANCE EXPIRES</div><input type="date" id="gl-ec-coi-expires" value="'+esc(c.coiExpires)+'" style="'+INPUT_STYLE+';padding:8px;font-size:13px"></div>' +
            '</div>' +
            '<div style="border-top:1px solid rgba(255,255,255,.06);margin:10px 0"></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">' +
              '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--white);cursor:pointer">' +
                '<input type="checkbox" id="gl-ec-w9-on-file"'+(c.w9OnFile?' checked':'')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">📄 W-9 on file' +
              '</label>' +
              '<div><div style="'+LABEL_STYLE+';margin-bottom:3px">W-9 RECEIVED</div><input type="date" id="gl-ec-w9-received" value="'+esc(c.w9Received)+'" style="'+INPUT_STYLE+';padding:8px;font-size:13px"></div>' +
            '</div>' +
            (c.w9FilePath ? '<div style="font-size:12px;color:var(--teal);margin-top:6px"><a href="#" id="gl-ec-w9-link" style="color:var(--teal)">📄 View current W-9</a></div>' : '') +
            '<div style="margin-top:8px"><div style="'+LABEL_STYLE+';margin-bottom:3px">UPLOAD NEW W-9 PDF</div>' +
              '<input type="file" id="gl-ec-w9-file" accept=".pdf,image/*" style="'+INPUT_STYLE+';padding:8px;font-size:12px">' +
            '</div>' +
            '<div style="border-top:1px solid rgba(255,255,255,.06);margin:10px 0"></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">' +
              '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--white);cursor:pointer">' +
                '<input type="checkbox" id="gl-ec-tax-exempt"'+(c.taxExempt?' checked':'')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">📄 State sales-tax exempt' +
              '</label>' +
              '<div><div style="'+LABEL_STYLE+';margin-bottom:3px">EXEMPT STATE</div><input id="gl-ec-tax-exempt-state" maxlength="2" value="'+esc(c.taxExemptState)+'" style="'+INPUT_STYLE+';padding:8px;font-size:13px;text-transform:uppercase"></div>' +
            '</div>' +
            (c.taxExemptFilePath ? '<div style="font-size:12px;color:var(--teal);margin-top:6px"><a href="#" id="gl-ec-tax-link" style="color:var(--teal)">📄 View current exemption certificate</a></div>' : '') +
            '<div style="margin-top:8px"><div style="'+LABEL_STYLE+';margin-bottom:3px">UPLOAD NEW EXEMPTION CERTIFICATE</div>' +
              '<input type="file" id="gl-ec-tax-exempt-file" accept=".pdf,image/*" style="'+INPUT_STYLE+';padding:8px;font-size:12px">' +
            '</div>' +
            '<div style="border-top:1px solid rgba(255,255,255,.06);margin:10px 0"></div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">' +
              '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--white);cursor:pointer">' +
                '<input type="checkbox" id="gl-ec-pa-letter"'+(c.paLetterOnFile?' checked':'')+' style="accent-color:var(--teal);width:16px;height:16px;cursor:pointer">📄 Process Authority letter on file' +
              '</label>' +
              '<div><div style="'+LABEL_STYLE+';margin-bottom:3px">PA LETTER EXPIRES</div><input type="date" id="gl-ec-pa-letter-expires" value="'+esc(c.paLetterExpires)+'" style="'+INPUT_STYLE+';padding:8px;font-size:13px"></div>' +
            '</div>' +
            (c.paLetterFilePath ? '<div style="font-size:12px;color:var(--teal);margin-top:6px"><a href="#" id="gl-ec-pa-link" style="color:var(--teal)">📄 View current Process Authority letter</a></div>' : '') +
            '<div style="margin-top:8px"><div style="'+LABEL_STYLE+';margin-bottom:3px">UPLOAD NEW PROCESS AUTHORITY LETTER</div>' +
              '<input type="file" id="gl-ec-pa-letter-file" accept=".pdf,image/*" style="'+INPUT_STYLE+';padding:8px;font-size:12px">' +
              '<div style="font-size:11px;color:var(--muted);margin-top:4px">FDA-required for acidified / low-acid canned beverages.</div>' +
            '</div>' +
          '</div>' +
          ((c.stripeCustomerId || c.qboCustomerId) ?
            '<div style="background:rgba(0,229,192,.04);border:1px solid rgba(0,229,192,.15);border-radius:8px;padding:12px">' +
              '<div style="'+LABEL_STYLE+';margin-bottom:8px">LINKED ACCOUNTS <span style="opacity:.6">(auto-populated, read-only)</span></div>' +
              (c.stripeCustomerId ? '<div style="font-size:12px;color:var(--white);margin-bottom:4px"><span style="color:var(--muted)">Stripe:</span> <code style="font-family:var(--ff-mono);font-size:11px">'+esc(c.stripeCustomerId)+'</code></div>' : '') +
              (c.qboCustomerId ?    '<div style="font-size:12px;color:var(--white)"><span style="color:var(--muted)">QuickBooks:</span> <code style="font-family:var(--ff-mono);font-size:11px">'+esc(c.qboCustomerId)+'</code></div>' : '') +
            '</div>' : '') +
          '<div><div style="'+LABEL_STYLE+'">NOTES</div><textarea id="gl-ec-notes" rows="3" style="'+INPUT_STYLE+';resize:vertical">'+esc(c.notes)+'</textarea></div>' +
          '<div id="gl-ec-err" style="display:none;color:#e74c3c;font-size:12px"></div>' +
          '<div style="display:flex;gap:8px;margin-top:6px">' +
            '<button id="gl-ec-save" class="cbtn pri" style="flex:1;padding:13px;font-weight:800">💾 Save changes</button>' +
            '<button id="gl-ec-cancel" class="cbtn" style="padding:13px 20px">Cancel</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-ec-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-ec-cancel').addEventListener('click', function(){ ov.remove(); });
    // Toggle billing block based on "same as physical" checkbox.
    var bsame = ov.querySelector('#gl-ec-billing-same');
    var bblock = ov.querySelector('#gl-ec-billing-block');
    bsame.addEventListener('change', function(){ bblock.style.display = bsame.checked ? 'none' : 'grid'; });
    // Toggle shipping block based on "same as billing" checkbox.
    var ssame = ov.querySelector('#gl-ec-shipping-same');
    var sblock = ov.querySelector('#gl-ec-shipping-block');
    if(ssame && sblock) ssame.addEventListener('change', function(){ sblock.style.display = ssame.checked ? 'none' : 'grid'; });

    // Wire signed-URL preview links for stored compliance docs.
    async function openDoc(path){
      if(!path || !window.supa) return;
      try {
        var r = await window.supa.storage.from('client-docs').createSignedUrl(path, 300);
        if(r && r.data && r.data.signedUrl) window.open(r.data.signedUrl, '_blank');
      } catch(e){ console.warn('[GL] signed url failed', e); }
    }
    var w9Link  = ov.querySelector('#gl-ec-w9-link');
    var taxLink = ov.querySelector('#gl-ec-tax-link');
    var paLink  = ov.querySelector('#gl-ec-pa-link');
    if(w9Link)  w9Link.addEventListener('click',  function(e){ e.preventDefault(); openDoc(c.w9FilePath); });
    if(taxLink) taxLink.addEventListener('click', function(e){ e.preventDefault(); openDoc(c.taxExemptFilePath); });
    if(paLink)  paLink.addEventListener('click',  function(e){ e.preventDefault(); openDoc(c.paLetterFilePath); });

    ov.querySelector('#gl-ec-save').addEventListener('click', async function(){
      var errEl = ov.querySelector('#gl-ec-err');
      errEl.style.display = 'none';
      function setErr(m){ errEl.textContent = m; errEl.style.display = 'block'; }
      function val(id){ var el = ov.querySelector('#'+id); return el ? el.value.trim() : ''; }
      function chk(id){ var el = ov.querySelector('#'+id); return !!(el && el.checked); }
      function fileOf(id){ var el = ov.querySelector('#'+id); return el && el.files && el.files[0] ? el.files[0] : null; }

      var name = val('gl-ec-name');
      if(!name){ setErr('Brand name is required.'); return; }

      var commPrefsOut = [
        chk('gl-ec-comm-email')    ? 'email'    : null,
        chk('gl-ec-comm-sms')      ? 'sms'      : null,
        chk('gl-ec-comm-whatsapp') ? 'whatsapp' : null,
        chk('gl-ec-comm-wechat')   ? 'wechat'   : null
      ].filter(Boolean);

      var productTypesOut = [
        chk('gl-ec-pt-seltzer')   ? 'seltzer'   : null,
        chk('gl-ec-pt-kombucha')  ? 'kombucha'  : null,
        chk('gl-ec-pt-coldbrew')  ? 'coldbrew'  : null,
        chk('gl-ec-pt-juice')     ? 'juice'     : null,
        chk('gl-ec-pt-rtd')       ? 'rtd'       : null,
        chk('gl-ec-pt-energy')    ? 'energy'    : null,
        chk('gl-ec-pt-mocktail')  ? 'mocktail'  : null,
        chk('gl-ec-pt-sparkling') ? 'sparkling' : null,
        chk('gl-ec-pt-sports')    ? 'sports'    : null,
        chk('gl-ec-pt-other')     ? 'other'     : null
      ].filter(Boolean);

      var dockDaysOut = ['mon','tue','wed','thu','fri','sat','sun']
        .filter(function(d){ return chk('gl-ec-dock-'+d); });

      var street = val('gl-ec-street');
      var city   = val('gl-ec-city');
      var state  = val('gl-ec-state').toUpperCase();
      var zip    = val('gl-ec-zip');
      var bSame  = chk('gl-ec-billing-same');
      var bStreet= bSame ? street : val('gl-ec-billing-street');
      var bCity  = bSame ? city   : val('gl-ec-billing-city');
      var bState = bSame ? state  : val('gl-ec-billing-state').toUpperCase();
      var bZip   = bSame ? zip    : val('gl-ec-billing-zip');
      var sSame  = chk('gl-ec-shipping-same');

      // Upload new compliance files if the user picked any.
      var w9File  = fileOf('gl-ec-w9-file');
      var taxFile = fileOf('gl-ec-tax-exempt-file');
      var paFile  = fileOf('gl-ec-pa-letter-file');
      var w9OnFile = chk('gl-ec-w9-on-file');
      var w9Received = val('gl-ec-w9-received');
      var taxExempt = chk('gl-ec-tax-exempt');
      var paLetterOnFile = chk('gl-ec-pa-letter');
      var newW9Path = '', newTaxPath = '', newPaPath = '';
      if(w9File){
        // Implicitly mark on file if a fresh file is being attached.
        w9OnFile = true;
        if(!w9Received) w9Received = new Date().toISOString().slice(0,10);
      }
      if(taxFile) taxExempt = true;
      if(paFile)  paLetterOnFile = true;

      var btn = this; var orig = btn.textContent;
      btn.disabled = true; btn.textContent = 'Saving…';

      if(w9File && typeof window.uploadComplianceDoc === 'function'){
        newW9Path = await window.uploadComplianceDoc(w9File, clientId, 'w9');
      }
      if(taxFile && typeof window.uploadComplianceDoc === 'function'){
        newTaxPath = await window.uploadComplianceDoc(taxFile, clientId, 'tax_exempt');
      }
      if(paFile && typeof window.uploadComplianceDoc === 'function'){
        newPaPath = await window.uploadComplianceDoc(paFile, clientId, 'pa_letter');
      }

      var patch = {
        name:           name,
        legalName:      val('gl-ec-legal-name'),
        ein:            val('gl-ec-ein'),
        website:        val('gl-ec-website'),
        contact:        val('gl-ec-contact'),
        email:          val('gl-ec-email'),
        phone:          val('gl-ec-phone'),
        contactType:    val('gl-ec-contact-type'),
        street:         street,
        city:           city,
        state:          state,
        zip:            zip,
        billingSame:    bSame,
        billingStreet:  bStreet,
        billingCity:    bCity,
        billingState:   bState,
        billingZip:     bZip,
        shippingSame:   sSame,
        shippingStreet: sSame ? bStreet : val('gl-ec-shipping-street'),
        shippingCity:   sSame ? bCity   : val('gl-ec-shipping-city'),
        shippingState:  sSame ? bState  : val('gl-ec-shipping-state').toUpperCase(),
        shippingZip:    sSame ? bZip    : val('gl-ec-shipping-zip'),
        liftGate:       chk('gl-ec-lift-gate'),
        dockDays:       dockDaysOut,
        dockHours:      val('gl-ec-dock-hours'),
        commPrefs:      commPrefsOut,
        productTypes:   productTypesOut,
        service:        val('gl-ec-service'),
        status:         val('gl-ec-status'),
        paymentTerms:   val('gl-ec-payment-terms') || 'Due on receipt',
        paymentMethod:  val('gl-ec-payment-method'),
        leadSource:     val('gl-ec-lead-source'),
        accountOwner:   val('gl-ec-account-owner'),
        referredBy:     val('gl-ec-referrer'),
        coiOnFile:      chk('gl-ec-coi-on-file'),
        coiExpires:     val('gl-ec-coi-expires'),
        w9OnFile:       w9OnFile,
        w9Received:     w9Received,
        taxExempt:      taxExempt,
        taxExemptState: val('gl-ec-tax-exempt-state').toUpperCase(),
        paLetterOnFile: paLetterOnFile,
        paLetterExpires:val('gl-ec-pa-letter-expires'),
        notes:          val('gl-ec-notes')
      };
      // Only set file paths in the patch when a new upload happened; otherwise
      // leave them alone so we don't overwrite the existing pointer.
      if(newW9Path)  patch.w9FilePath = newW9Path;
      if(newTaxPath) patch.taxExemptFilePath = newTaxPath;
      if(newPaPath)  patch.paLetterFilePath = newPaPath;

      var ok = await window.glUpdateClient(clientId, patch);
      btn.disabled = false; btn.textContent = orig;
      if(ok) ov.remove();
      else   setErr('Save failed — check the browser console.');
    });

    host.appendChild(ov);
    setTimeout(function(){ ov.querySelector('#gl-ec-name').focus(); }, 50);
  };

  window.glUpdateClient = async function(clientId, patch){
    var list = window.clients || [];
    var c = list.find(function(x){ return x.id === clientId; });
    if(!c) return false;

    // Recompute initials if the name changed.
    var newInit = (patch.name||c.name||'').split(' ').map(function(w){ return w[0]||''; }).join('').toUpperCase().slice(0,2);

    // Apply locally first so the UI feels instant.
    var prevSnapshot = Object.assign({}, c);
    Object.assign(c, patch, { init: newInit });

    if(window.supa){
      try {
        var supaPatch = {
          name:            patch.name,
          legal_name:      patch.legalName,
          ein:             patch.ein,
          website:         patch.website,
          contact_name:    patch.contact,
          email:           patch.email,
          phone:           patch.phone,
          contact_type:    patch.contactType || null,
          street:          patch.street,
          city:            patch.city,
          state:           patch.state,
          zip:             patch.zip,
          billing_same:    patch.billingSame,
          billing_street:  patch.billingStreet,
          billing_city:    patch.billingCity,
          billing_state:   patch.billingState,
          billing_zip:     patch.billingZip,
          shipping_same:   patch.shippingSame,
          shipping_street: patch.shippingStreet,
          shipping_city:   patch.shippingCity,
          shipping_state:  patch.shippingState,
          shipping_zip:    patch.shippingZip,
          lift_gate:       !!patch.liftGate,
          dock_days:       patch.dockDays,
          dock_hours:      patch.dockHours,
          comm_prefs:      patch.commPrefs,
          product_types:   patch.productTypes,
          service:         patch.service,
          status:          patch.status,
          payment_terms:   patch.paymentTerms,
          payment_method:  patch.paymentMethod || null,
          lead_source:     patch.leadSource || null,
          account_owner:   patch.accountOwner || null,
          referred_by:     patch.referredBy || null,
          coi_on_file:     !!patch.coiOnFile,
          coi_expires:     patch.coiExpires || null,
          w9_on_file:      !!patch.w9OnFile,
          w9_received:     patch.w9Received || null,
          w9_file_path:    patch.w9FilePath,
          tax_exempt:      !!patch.taxExempt,
          tax_exempt_state: patch.taxExemptState || null,
          tax_exempt_file_path: patch.taxExemptFilePath,
          pa_letter_on_file: !!patch.paLetterOnFile,
          pa_letter_expires: patch.paLetterExpires || null,
          pa_letter_file_path: patch.paLetterFilePath,
          notes:           patch.notes,
          initials:        newInit
        };
        // Strip undefined keys so we don't accidentally wipe values not in the patch
        // (file paths are only present when a fresh upload happened).
        Object.keys(supaPatch).forEach(function(k){ if(supaPatch[k] === undefined) delete supaPatch[k]; });
        var r = await window.supa.from('clients').update(supaPatch).eq('id', clientId);
        if(r && r.error){
          console.warn('[GL] glUpdateClient: supabase error', r.error);
          // Roll back? We keep the local change but warn.
          if(typeof addNotification === 'function') addNotification('Saved locally','Server error: '+r.error.message,'warning');
        }
      } catch(e){
        console.warn('[GL] glUpdateClient threw', e);
        if(typeof addNotification === 'function') addNotification('Saved locally','Server unreachable','warning');
      }
    }

    if(typeof window.glAudit === 'function'){
      // Audit only the fields that changed for a compact log.
      var diff = {};
      Object.keys(patch).forEach(function(k){
        if(JSON.stringify(prevSnapshot[k]) !== JSON.stringify(patch[k])) diff[k] = true;
      });
      window.glAudit('client_edited', clientId, { fields: Object.keys(diff) });
    }

    if(typeof renderClients === 'function') try { renderClients(); } catch(e){}
    if(typeof renderDash === 'function')    try { renderDash();    } catch(e){}

    // If a detail panel is open for this client, re-open it to reflect the changes.
    var openOv = document.getElementById('client-detail-overlay');
    if(openOv){
      openOv.remove();
      if(typeof viewClientEnhanced === 'function') try { viewClientEnhanced(clientId); } catch(e){
        if(typeof openClientDetail === 'function') openClientDetail(clientId);
      } else if(typeof openClientDetail === 'function') openClientDetail(clientId);
    }

    if(typeof addNotification === 'function') addNotification('✓ Client updated', c.name, 'success');
    return true;
  };

  console.log('[GL] glOpenEditClient + glUpdateClient loaded');
}());

/* ============================================================
   DASHBOARD COMPLIANCE ALERT
   Surfaces clients whose Certificate of Insurance or Process
   Authority letter is expired or expiring within the next 30 days.
   - Renders nothing if no docs are at risk.
   - Renders an amber banner if only "expiring soon" items exist.
   - Renders a red banner if anything is already expired (mixed
     content still uses red since the expired items dominate).
   - Click any client row to jump straight to that client's detail
     panel. Wires through whichever viewer the CRM has loaded.
   ============================================================ */
(function(){
  function daysBetween(d){
    var today = new Date(); today.setHours(0,0,0,0);
    var exp = new Date(d); exp.setHours(0,0,0,0);
    return Math.round((exp - today) / 86400000);
  }

  function gatherAtRisk(){
    var rows = [];
    (window.clients || []).forEach(function(c){
      function consider(kind, label, hasFlag, expDate){
        if(!hasFlag) return;       // nothing to track if doc not on file
        if(!expDate) return;       // no date = no expiration to warn on
        var d = daysBetween(expDate);
        if(d > 30) return;          // safe window
        rows.push({
          clientId: c.id, clientName: c.name,
          kind: kind, label: label,
          daysLeft: d, expDate: expDate
        });
      }
      consider('coi', 'Certificate of Insurance', c.coiOnFile, c.coiExpires);
      consider('pa',  'Process Authority letter', c.paLetterOnFile, c.paLetterExpires);
    });
    // Sort: expired first (most negative daysLeft), then by daysLeft ascending.
    rows.sort(function(a,b){ return a.daysLeft - b.daysLeft; });
    return rows;
  }

  function openClient(id){
    if(typeof window.viewClientEnhanced === 'function') return window.viewClientEnhanced(id);
    if(typeof window.openClientDetail === 'function') return window.openClientDetail(id);
  }

  window.renderComplianceAlert = function(){
    var host = document.getElementById('dash-compliance-alert');
    if(!host) return;
    var rows = gatherAtRisk();
    if(!rows.length){ host.innerHTML = ''; return; }

    var anyExpired = rows.some(function(r){ return r.daysLeft < 0; });
    var color = anyExpired ? '#e74c3c' : '#f5c842';
    var bg    = anyExpired ? 'rgba(231,76,60,.07)' : 'rgba(245,200,66,.06)';
    var border= anyExpired ? 'rgba(231,76,60,.35)' : 'rgba(245,200,66,.3)';
    var icon  = anyExpired ? '🚨' : '⚠';
    var headline = anyExpired
      ? rows.filter(function(r){ return r.daysLeft < 0; }).length + ' expired · ' + rows.length + ' total flagged'
      : rows.length + ' document' + (rows.length === 1 ? '' : 's') + ' expiring soon';

    var listHtml = rows.map(function(r){
      var sev, txt;
      if(r.daysLeft < 0)      { sev = '#ff8579'; txt = 'EXPIRED ' + (-r.daysLeft) + 'd ago'; }
      else if(r.daysLeft < 8) { sev = '#ff8579'; txt = 'in ' + r.daysLeft + 'd'; }
      else                    { sev = '#f5c842'; txt = 'in ' + r.daysLeft + 'd'; }
      return '<div class="gl-comp-row" data-cid="' + r.clientId + '" style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-radius:8px;cursor:pointer;transition:background .15s" onmouseover="this.style.background=\'rgba(255,255,255,.04)\'" onmouseout="this.style.background=\'transparent\'">' +
        '<div style="display:flex;align-items:center;gap:10px;min-width:0">' +
          '<span style="font-size:14px">📄</span>' +
          '<div style="min-width:0">' +
            '<div style="color:var(--white);font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + r.clientName + '</div>' +
            '<div style="color:var(--muted);font-size:11px">' + r.label + ' · ' + r.expDate + '</div>' +
          '</div>' +
        '</div>' +
        '<div style="color:' + sev + ';font-size:11px;font-weight:700;white-space:nowrap;letter-spacing:.5px">' + txt + '</div>' +
      '</div>';
    }).join('');

    host.innerHTML =
      '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:12px;padding:14px 16px;margin-bottom:14px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span style="font-size:18px">' + icon + '</span>' +
            '<div>' +
              '<div style="font-family:var(--ff-disp);font-size:13px;letter-spacing:2px;color:' + color + '">COMPLIANCE EXPIRING</div>' +
              '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + headline + '</div>' +
            '</div>' +
          '</div>' +
          '<button id="gl-comp-dismiss" style="background:none;border:1px solid rgba(255,255,255,.12);color:var(--muted);font-size:11px;padding:5px 11px;border-radius:6px;cursor:pointer">hide for today</button>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:2px">' + listHtml + '</div>' +
      '</div>';

    // Click row → open client detail.
    host.querySelectorAll('.gl-comp-row').forEach(function(row){
      row.addEventListener('click', function(){ openClient(row.getAttribute('data-cid')); });
    });
    // Hide for today (per-device).
    var dismiss = host.querySelector('#gl-comp-dismiss');
    if(dismiss) dismiss.addEventListener('click', function(){
      localStorage.setItem('gl_comp_alert_hide_until', new Date().toISOString().slice(0,10));
      host.innerHTML = '';
    });
  };

  // Wrap renderDash so the alert refreshes whenever the dashboard re-renders.
  (function wrap(){
    var orig = window.renderDash;
    if(typeof orig !== 'function'){ setTimeout(wrap, 500); return; }
    window.renderDash = function(){
      var r = orig.apply(this, arguments);
      try {
        // Honor the per-day dismiss.
        var hideUntil = localStorage.getItem('gl_comp_alert_hide_until');
        var today = new Date().toISOString().slice(0,10);
        if(hideUntil === today){
          var host = document.getElementById('dash-compliance-alert');
          if(host) host.innerHTML = '';
          return r;
        }
        window.renderComplianceAlert();
      } catch(e){ console.warn('[GL] compliance alert render threw', e); }
      return r;
    };
  })();

  console.log('[GL] dashboard compliance alert loaded');
}());

/* ============================================================
   PUBLIC FACILITY GALLERY
   Pulls photos from the Supabase Storage 'facility-photos' bucket
   and drops them into the #facility-gallery grid on the public site.
   Renders elegant SVG placeholders if the bucket is empty or
   unreachable so the section never looks broken.
   Admin uploads via the CRM (separate admin UI to follow if needed
   — for now drop files into the bucket through the Supabase dashboard).
   ============================================================ */
(function(){
  var PLACEHOLDERS = [
    { label: 'Canning line',     icon: '🥫' },
    { label: 'Filling station',  icon: '⚙' },
    { label: 'Cold-fill tank',   icon: '🧊' },
    { label: 'Palletizing',      icon: '📦' },
    { label: 'Quality check',    icon: '🔬' },
    { label: 'PakTech handles',  icon: '🤝' }
  ];

  function tileHtml(src, label){
    if(src){
      return '<a href="' + src + '" target="_blank" rel="noopener" style="display:block;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);aspect-ratio:4/3;position:relative">' +
        '<img src="' + src + '" alt="' + (label||'Facility photo').replace(/"/g,'&quot;') + '" loading="lazy" style="width:100%;height:100%;object-fit:cover;display:block">' +
        (label ? '<div style="position:absolute;left:0;right:0;bottom:0;padding:10px 12px;background:linear-gradient(to top,rgba(0,0,0,.7),transparent);color:#fff;font-size:11px;letter-spacing:1px;font-family:var(--ff-disp)">' + label + '</div>' : '') +
      '</a>';
    }
    // Placeholder tile — graceful fallback if the bucket is empty / unreachable.
    return '<div style="border-radius:12px;overflow:hidden;border:1px dashed rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(0,229,192,.05),rgba(26,111,255,.04));aspect-ratio:4/3;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--muted);gap:8px">' +
      '<div style="font-size:38px;opacity:.45">' + label.icon + '</div>' +
      '<div style="font-size:11px;letter-spacing:2px;color:rgba(255,255,255,.45);font-family:var(--ff-disp)">' + label.label + '</div>' +
    '</div>';
  }

  async function renderGallery(){
    var host = document.getElementById('facility-gallery');
    if(!host) return;

    var photos = [];
    try {
      if(window.supa && window.supa.storage){
        var r = await window.supa.storage.from('facility-photos').list('', { limit: 24, sortBy: { column:'name', order:'asc' } });
        if(r && r.data){
          photos = r.data.filter(function(o){
            // Only images, skip the auto-created .emptyFolderPlaceholder file.
            return o.name && !o.name.startsWith('.') && /\.(jpe?g|png|webp|gif|avif)$/i.test(o.name);
          });
        }
      }
    } catch(e){ console.warn('[GL] facility-photos list failed', e); }

    var html;
    if(photos.length){
      // Public URLs work because the bucket is set public; if not, signed URLs
      // would be needed but that defeats SEO/embedding so we assume public.
      html = photos.map(function(p){
        var u = window.supa.storage.from('facility-photos').getPublicUrl(p.name);
        var url = (u && u.data && u.data.publicUrl) || '';
        // Use filename (minus extension) as the caption.
        var label = p.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
        return tileHtml(url, label);
      }).join('');
    } else {
      // No photos uploaded yet — show the 6 elegant placeholders so the
      // section still looks intentional.
      html = PLACEHOLDERS.map(function(p){ return tileHtml(null, p); }).join('');
    }
    host.innerHTML = html;
  }

  function start(){
    if(document.getElementById('facility-gallery')) renderGallery();
    else setTimeout(start, 600);
  }
  if(document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  console.log('[GL] public facility gallery loaded');
}());

/* ============================================================
   PUBLIC CAPACITY INDICATOR
   - Renders a "Q3 2026: 65% booked · Q4 opens Sep 1" badge in the
     hero so visitors see urgency + production transparency.
   - Data lives in Supabase table `capacity` (one row per quarter)
     with anon read access; the admin edits via a toolbar item.
   - Falls back to a sensible hardcoded default if the table is
     empty or unreachable, so the badge always shows something.
   - Pulses on the hero to draw the eye.
   ============================================================ */
(function(){
  function currentQuarter(){
    var now = new Date();
    var q = Math.floor(now.getMonth() / 3) + 1; // 1..4
    return { q: q, y: now.getFullYear() };
  }
  function nextQuarter(){
    var c = currentQuarter();
    return c.q === 4 ? { q:1, y:c.y+1 } : { q:c.q+1, y:c.y };
  }
  function quarterStartMonthName(q){ return ['Jan','Apr','Jul','Oct'][q-1]; }

  var DEFAULT_CAPACITY = {
    quarter: 'Q' + currentQuarter().q + ' ' + currentQuarter().y,
    booked: 60,
    next_label: 'Q' + nextQuarter().q + ' opens ' + quarterStartMonthName(nextQuarter().q) + ' 1',
    updated_at: ''
  };

  async function loadCapacity(){
    // Prefer Supabase, fall back to localStorage override, fall back to default.
    var override = null;
    try {
      var ls = localStorage.getItem('gl_capacity_override');
      if(ls) override = JSON.parse(ls);
    } catch(e){}
    if(override) return override;

    if(window.supa){
      try {
        var r = await window.supa.from('capacity').select('*').order('updated_at',{ascending:false}).limit(1);
        if(r && r.data && r.data[0]) return r.data[0];
      } catch(e){ /* table may not exist yet — silent fallback */ }
    }
    return DEFAULT_CAPACITY;
  }

  function fmt(c){
    var pct = Math.max(0, Math.min(100, parseInt(c.booked, 10) || 0));
    return (c.quarter || DEFAULT_CAPACITY.quarter) + ': ' + pct + '% booked · ' + (c.next_label || DEFAULT_CAPACITY.next_label);
  }

  async function renderBadge(){
    var host = document.getElementById('gl-capacity-badge');
    var txt  = document.getElementById('gl-capacity-text');
    if(!host || !txt) return;
    var c = await loadCapacity();
    txt.textContent = fmt(c);
    host.style.display = 'inline-flex';
  }

  // Inject the pulse keyframe once (shared with the dot in the badge).
  function injectPulse(){
    if(document.getElementById('gl-capacity-style')) return;
    var s = document.createElement('style');
    s.id = 'gl-capacity-style';
    s.textContent = '@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(.85)}}';
    document.head.appendChild(s);
  }

  function start(){
    injectPulse();
    if(document.getElementById('gl-capacity-badge')) renderBadge();
    else setTimeout(start, 600);
  }
  if(document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  /* Admin-only editor (CRM toolbar). Lets Mike update the badge in 10
     seconds without touching code. Writes to Supabase if the table
     exists; otherwise stores a localStorage override (same device only). */
  window.openCapacitySettings = async function(){
    var prior = document.getElementById('gl-cap-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var c = await loadCapacity();
    var ov = document.createElement('div');
    ov.id = 'gl-cap-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:920;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:460px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">📅 CAPACITY BADGE</div>' +
          '<button id="gl-cap-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#9aa7bd;margin-bottom:18px;line-height:1.6">Shown in the hero of the public site. Set what visitors should see right now.</div>' +
        '<div class="frow"><div class="flbl">Quarter label</div><input class="finp" id="gl-cap-quarter" value="' + (c.quarter||'').replace(/"/g,'&quot;') + '" placeholder="Q3 2026"></div>' +
        '<div class="frow"><div class="flbl">% booked</div><input class="finp" id="gl-cap-booked" type="number" min="0" max="100" value="' + (parseInt(c.booked,10)||0) + '"></div>' +
        '<div class="frow"><div class="flbl">Next-quarter line</div><input class="finp" id="gl-cap-next" value="' + (c.next_label||'').replace(/"/g,'&quot;') + '" placeholder="Q4 opens Oct 1"></div>' +
        '<div style="background:rgba(0,229,192,.05);border:1px solid rgba(0,229,192,.15);border-radius:8px;padding:11px;font-size:11px;color:#9aa7bd;margin:8px 0 16px">Preview: <span id="gl-cap-preview" style="color:var(--teal);font-weight:600"></span></div>' +
        '<div style="display:flex;gap:8px">' +
          '<button id="gl-cap-save" class="cbtn pri" style="flex:1">💾 Save</button>' +
          '<button id="gl-cap-reset" class="cbtn">Reset to default</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    host.appendChild(ov);

    function readForm(){
      return {
        quarter:    ov.querySelector('#gl-cap-quarter').value.trim(),
        booked:     parseInt(ov.querySelector('#gl-cap-booked').value, 10) || 0,
        next_label: ov.querySelector('#gl-cap-next').value.trim(),
        updated_at: new Date().toISOString()
      };
    }
    function updatePreview(){ ov.querySelector('#gl-cap-preview').textContent = fmt(readForm()); }
    ['gl-cap-quarter','gl-cap-booked','gl-cap-next'].forEach(function(id){
      ov.querySelector('#'+id).addEventListener('input', updatePreview);
    });
    updatePreview();

    ov.querySelector('#gl-cap-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-cap-reset').addEventListener('click', function(){
      localStorage.removeItem('gl_capacity_override');
      ov.remove();
      renderBadge();
      if(typeof addNotification === 'function') addNotification('📅 Capacity reset', 'Cleared override','info');
    });
    ov.querySelector('#gl-cap-save').addEventListener('click', async function(){
      var data = readForm();
      var btn = this; btn.disabled = true; btn.textContent = 'Saving…';
      // Try Supabase first; fall back to local override.
      var supaOk = false;
      if(window.supa){
        try {
          var r = await window.supa.from('capacity').insert([data]);
          supaOk = !r.error;
          if(r.error) console.warn('[GL] capacity insert error', r.error);
        } catch(e){ console.warn('[GL] capacity insert threw', e); }
      }
      if(!supaOk) localStorage.setItem('gl_capacity_override', JSON.stringify(data));
      else        localStorage.removeItem('gl_capacity_override');
      btn.disabled = false; btn.textContent = '💾 Save';
      ov.remove();
      renderBadge();
      if(typeof addNotification === 'function') addNotification('📅 Capacity updated', supaOk ? 'Synced to Supabase' : 'Saved locally (table missing?)','success');
      if(typeof window.glAudit === 'function') window.glAudit('capacity_updated', '', data);
    });
  };

  console.log('[GL] capacity indicator loaded');
}());

/* ============================================================
   CIP / SANITATION LOG (compliance)
   FDA-defensible record of every cleaning cycle between runs.
   Captures: date/time, line, cleaning method (CIP / manual / both),
   chemicals used + concentration, water temp, contact time, operator,
   verification (ATP swab result), pass/fail, notes. Linked to the
   run that ran before and after if known.
   ============================================================ */
(function(){
  function esc(v){ return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  window.glCipLogs = window.glCipLogs || [];

  var METHODS = ['CIP (closed-loop)','Manual scrub','CIP + manual'];
  var CHEMICALS = ['Caustic (NaOH)','Acid (phosphoric)','Sanitizer (peracetic)','Sanitizer (chlorine)','Sanitizer (quat)','Other'];

  async function loadFromSupabase(){
    if(!window.supa) return null;
    try { var r = await window.supa.from('cip_logs').select('*').order('cycle_at',{ascending:false}); if(r && r.data) return r.data; }
    catch(e){}
    return null;
  }
  function loadLocal(){ try { return JSON.parse(localStorage.getItem('gl_cip_logs') || '[]'); } catch(e){ return []; } }
  function saveLocal(){ localStorage.setItem('gl_cip_logs', JSON.stringify(window.glCipLogs)); }

  async function refresh(){
    var rows = await loadFromSupabase();
    window.glCipLogs = rows || loadLocal();
    render();
  }

  function render(){
    var host = document.getElementById('cip-body');
    if(!host) return;
    var sub = document.getElementById('cip-sub');
    var rows = window.glCipLogs || [];
    var fails = rows.filter(function(r){ return r.result === 'fail'; }).length;
    if(sub) sub.textContent = rows.length + ' cycle' + (rows.length === 1 ? '' : 's') + ' logged' + (fails ? ' · ' + fails + ' fail' + (fails === 1 ? '' : 's') + ' on record' : '');

    if(!rows.length){
      host.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No cycles logged yet. Click "Log Cycle" after every sanitation between runs. FDA-required.</div>';
      return;
    }
    host.innerHTML = '<table class="ctbl"><thead><tr><th>When</th><th>Line / area</th><th>Method</th><th>Chemicals</th><th>Operator</th><th>ATP swab</th><th>Result</th></tr></thead><tbody>' +
      rows.map(function(r){
        var when = r.cycle_at ? new Date(r.cycle_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '—';
        var resColor = r.result === 'pass' ? '#5fcf9e' : r.result === 'fail' ? '#ff8579' : '#9aa7bd';
        var resLabel = (r.result || 'pending').toUpperCase();
        return '<tr style="cursor:pointer" onclick="window.glOpenEditCip(\'' + esc(r.id) + '\')">' +
          '<td style="padding:11px;color:var(--white);font-weight:600">' + when + '</td>' +
          '<td style="padding:11px;color:var(--muted)">' + esc(r.line_area || '—') + '</td>' +
          '<td style="padding:11px;color:var(--muted)">' + esc(r.method || '—') + '</td>' +
          '<td style="padding:11px;color:var(--muted);font-size:11px">' + esc((r.chemicals||[]).join(', ') || '—') + '</td>' +
          '<td style="padding:11px;color:var(--muted)">' + esc(r.operator || '—') + '</td>' +
          '<td style="padding:11px;color:var(--muted);font-family:var(--ff-mono);font-size:11px">' + esc(r.atp_reading || '—') + '</td>' +
          '<td style="padding:11px;color:' + resColor + ';font-weight:700">' + resLabel + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  function cipModal(existing){
    var prior = document.getElementById('gl-cip-modal'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;
    var isEdit = !!existing;
    var c = existing || { line_area:'', method:'CIP (closed-loop)', chemicals:[], water_temp_f:'', contact_min:'', operator:'', atp_reading:'', result:'pass', notes:'', cycle_at: new Date().toISOString().slice(0,16) };
    var methodOpts = METHODS.map(function(m){
      var sel = (m === c.method) ? ' selected' : ''; return '<option' + sel + '>' + esc(m) + '</option>';
    }).join('');
    var chemChecks = CHEMICALS.map(function(x){
      var k = x.replace(/\W+/g,'_').toLowerCase();
      var ch = (c.chemicals||[]).indexOf(x) >= 0 ? ' checked' : '';
      return '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--white)"><input type="checkbox" data-chem="' + esc(x) + '" id="gl-cip-ch-' + k + '"'+ch+' style="accent-color:var(--teal);width:15px;height:15px;cursor:pointer">' + esc(x) + '</label>';
    }).join('');
    var resultOpts = [['pass','✓ Pass'],['fail','✗ Fail'],['pending','⏳ Pending verification']].map(function(o){
      var sel = (o[0] === c.result) ? ' selected' : ''; return '<option value="' + o[0] + '"'+sel+'>' + o[1] + '</option>';
    }).join('');
    var ov = document.createElement('div');
    ov.id = 'gl-cip-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1000;background:rgba(6,13,26,.88);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:26px;width:100%;max-width:520px;max-height:88vh;overflow-y:auto">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:var(--teal)">' + (isEdit ? '✏️ EDIT CYCLE' : '🧼 LOG CIP CYCLE') + '</div>' +
          '<button id="gl-cip-close" style="background:none;border:none;color:#9aa7bd;font-size:20px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div class="frow"><div class="flbl">When *</div><input class="finp" id="gl-cip-when" type="datetime-local" value="' + esc(c.cycle_at) + '"></div>' +
        '<div class="frow"><div class="flbl">Line / area *</div><input class="finp" id="gl-cip-area" value="' + esc(c.line_area) + '" placeholder="e.g. Filler #1 / fill heads / hoses"></div>' +
        '<div class="frow"><div class="flbl">Method</div><select class="fsel" id="gl-cip-method">' + methodOpts + '</select></div>' +
        '<div>' +
          '<div class="flbl" style="margin-bottom:6px">Chemicals used</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px 12px;padding:11px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:8px;margin-bottom:12px">' + chemChecks + '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Water temp (°F)</div><input class="finp" id="gl-cip-temp" type="number" min="0" value="' + esc(c.water_temp_f) + '"></div>' +
          '<div class="frow"><div class="flbl">Contact (min)</div><input class="finp" id="gl-cip-contact" type="number" min="0" value="' + esc(c.contact_min) + '"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<div class="frow"><div class="flbl">Operator *</div><input class="finp" id="gl-cip-op" value="' + esc(c.operator) + '"></div>' +
          '<div class="frow"><div class="flbl">ATP reading (RLU)</div><input class="finp" id="gl-cip-atp" value="' + esc(c.atp_reading) + '" placeholder="< 30 = pass"></div>' +
        '</div>' +
        '<div class="frow"><div class="flbl">Result *</div><select class="fsel" id="gl-cip-result">' + resultOpts + '</select></div>' +
        '<div class="frow"><div class="flbl">Notes</div><textarea class="finp" id="gl-cip-notes" rows="2">' + esc(c.notes) + '</textarea></div>' +
        '<div style="display:flex;gap:8px;margin-top:6px">' +
          '<button id="gl-cip-save" class="cbtn pri" style="flex:1">💾 Save</button>' +
          (isEdit ? '<button id="gl-cip-del" class="cbtn" style="background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#ff8579">Delete</button>' : '') +
          '<button id="gl-cip-cancel" class="cbtn">Cancel</button>' +
        '</div>' +
      '</div>';
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-cip-close').addEventListener('click', function(){ ov.remove(); });
    ov.querySelector('#gl-cip-cancel').addEventListener('click', function(){ ov.remove(); });
    var del = ov.querySelector('#gl-cip-del');
    if(del) del.addEventListener('click', async function(){
      if(!confirm('Delete this CIP cycle? FDA requires you to retain a log — only delete if entered in error.')) return;
      if(window.supa){ try { await window.supa.from('cip_logs').delete().eq('id', c.id); } catch(e){} }
      window.glCipLogs = (window.glCipLogs||[]).filter(function(x){ return x.id !== c.id; });
      saveLocal(); render(); ov.remove();
      if(typeof window.glAudit === 'function') window.glAudit('cip_cycle_deleted', c.id, {});
    });
    ov.querySelector('#gl-cip-save').addEventListener('click', async function(){
      var area = ov.querySelector('#gl-cip-area').value.trim();
      var op = ov.querySelector('#gl-cip-op').value.trim();
      if(!area || !op){ alert('Line/area and operator are required.'); return; }
      var chemicals = [];
      ov.querySelectorAll('input[data-chem]').forEach(function(el){ if(el.checked) chemicals.push(el.getAttribute('data-chem')); });
      var data = {
        cycle_at:    ov.querySelector('#gl-cip-when').value || new Date().toISOString(),
        line_area:   area,
        method:      ov.querySelector('#gl-cip-method').value,
        chemicals:   chemicals,
        water_temp_f: parseFloat(ov.querySelector('#gl-cip-temp').value) || null,
        contact_min:  parseInt(ov.querySelector('#gl-cip-contact').value, 10) || null,
        operator:    op,
        atp_reading: ov.querySelector('#gl-cip-atp').value.trim(),
        result:      ov.querySelector('#gl-cip-result').value,
        notes:       ov.querySelector('#gl-cip-notes').value
      };
      if(window.supa){
        try {
          if(isEdit){ await window.supa.from('cip_logs').update(data).eq('id', c.id); Object.assign(c, data); }
          else { var r = await window.supa.from('cip_logs').insert([data]).select().single(); if(r && r.data){ window.glCipLogs.unshift(r.data); } else { data.id = 'local_' + Date.now(); window.glCipLogs.unshift(data); } }
        } catch(e){
          if(isEdit) Object.assign(c, data);
          else { data.id = 'local_' + Date.now(); window.glCipLogs.unshift(data); }
        }
      } else {
        if(isEdit) Object.assign(c, data);
        else { data.id = 'local_' + Date.now(); window.glCipLogs.unshift(data); }
      }
      saveLocal(); ov.remove(); render();
      if(typeof addNotification === 'function') addNotification('🧼 CIP cycle ' + (isEdit ? 'updated' : 'logged'), data.line_area + ' — ' + data.result.toUpperCase(), data.result === 'fail' ? 'warning' : 'success');
      if(typeof window.glAudit === 'function') window.glAudit(isEdit ? 'cip_cycle_edited' : 'cip_cycle_logged', data.line_area, { result: data.result });
    });
    host.appendChild(ov);
  }

  window.glOpenAddCip  = function(){ cipModal(null); };
  window.glOpenEditCip = function(id){
    var c = (window.glCipLogs||[]).find(function(x){ return x.id === id; });
    if(c) cipModal(c);
  };

  function watch(){
    var pg = document.getElementById('cpg-cip');
    if(!pg){ setTimeout(watch, 600); return; }
    new MutationObserver(function(){ if(pg.classList.contains('act')) refresh(); }).observe(pg, { attributes:true, attributeFilter:['class'] });
  }
  if(document.readyState !== 'loading') watch();
  else document.addEventListener('DOMContentLoaded', watch);

  console.log('[GL] CIP / sanitation log loaded');
}());

/* ============================================================
   AUDIT LOG VIEWER (admin-only)
   Shows the audit_log table contents — every glAudit() call that has
   been written throughout the app. Filterable, last 200 events.
   The nav item is hidden until login; revealed for admin only by
   the existing loginUser flow (matches users/customers admin-only items).
   ============================================================ */
(function(){
  function esc(v){ return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  window.glAuditRows = window.glAuditRows || [];

  async function refresh(){
    if(!window.supa){ render([]); return; }
    try {
      var r = await window.supa.from('audit_log').select('*').order('created_at',{ascending:false}).limit(200);
      if(r && r.data) window.glAuditRows = r.data;
    } catch(e){ console.warn('[GL] audit fetch failed', e); }
    render(window.glAuditRows);
  }

  function render(rows){
    var host = document.getElementById('audit-body');
    if(!host) return;
    var sub = document.getElementById('audit-sub');
    if(sub) sub.textContent = rows.length + ' event' + (rows.length === 1 ? '' : 's') + ' shown (most recent first)';
    if(!rows.length){
      host.innerHTML = '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No audit events yet. Actions like creating clients, deleting invoices, editing formulas all write here automatically.</div>';
      return;
    }
    host.innerHTML = '<table class="ctbl"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>' +
      rows.map(function(r){
        var when = r.created_at ? new Date(r.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : '—';
        var details = r.details ? '<code style="font-family:var(--ff-mono);font-size:11px;color:var(--muted);max-width:240px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(JSON.stringify(r.details)) + '</code>' : '<span style="color:rgba(255,255,255,.2)">—</span>';
        return '<tr>' +
          '<td style="padding:11px;color:var(--muted);font-size:11px;white-space:nowrap">' + when + '</td>' +
          '<td style="padding:11px;color:var(--white);font-size:12px">' + esc(r.actor || 'system') + '</td>' +
          '<td style="padding:11px;color:var(--teal);font-family:var(--ff-mono);font-size:11px">' + esc(r.action) + '</td>' +
          '<td style="padding:11px;color:var(--muted);font-size:12px">' + esc(r.target || '—') + '</td>' +
          '<td style="padding:11px">' + details + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table>';
  }

  function watch(){
    var pg = document.getElementById('cpg-audit');
    if(!pg){ setTimeout(watch, 600); return; }
    new MutationObserver(function(){ if(pg.classList.contains('act')) refresh(); }).observe(pg, { attributes:true, attributeFilter:['class'] });
    // Filter input
    var f = document.getElementById('audit-filter');
    if(f) f.addEventListener('input', function(){
      var q = f.value.toLowerCase();
      if(!q){ render(window.glAuditRows||[]); return; }
      var filtered = (window.glAuditRows||[]).filter(function(r){
        return (r.action || '').toLowerCase().includes(q) ||
               (r.target || '').toLowerCase().includes(q) ||
               (r.actor  || '').toLowerCase().includes(q);
      });
      render(filtered);
    });
    // Reveal sidebar entry for admins.
    setInterval(function(){
      var navItem = document.getElementById('nav-audit');
      if(navItem && window.currentUser && window.currentUser.role === 'admin'){
        navItem.style.display = 'flex';
      }
    }, 1500);
  }
  if(document.readyState !== 'loading') watch();
  else document.addEventListener('DOMContentLoaded', watch);

  console.log('[GL] audit log viewer loaded');
}());

/* ============================================================
   LOW-STOCK DASHBOARD ALERT
   Reads window.inventory (the existing inventory list) and surfaces
   any item where qty <= reorder_threshold on a dashboard banner.
   Wraps renderDash like the compliance + AR aging widgets.
   ============================================================ */
(function(){
  function esc(v){ return v == null ? '' : String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function gather(){
    var items = window.inventory || [];
    return items.filter(function(i){
      if(!i || typeof i !== 'object') return false;
      // Two field-name conventions seen in the wild:
      var qty = Number(i.qty != null ? i.qty : i.quantity);
      var par = Number(i.par != null ? i.par : (i.threshold != null ? i.threshold : i.reorder_at));
      return !isNaN(qty) && !isNaN(par) && qty <= par;
    });
  }

  window.renderLowStockAlert = function(){
    var host = document.getElementById('dash-low-stock');
    if(!host) return;
    var low = gather();
    if(!low.length){ host.innerHTML = ''; return; }
    var rows = low.slice(0, 6).map(function(i){
      var name = i.name || i.item || '(unnamed)';
      var qty = i.qty != null ? i.qty : i.quantity;
      var par = i.par != null ? i.par : (i.threshold != null ? i.threshold : i.reorder_at);
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 12px;border-radius:7px">' +
        '<div style="font-size:13px;color:var(--white);font-weight:600">' + esc(name) + '</div>' +
        '<div style="font-size:12px;color:#f5c842;font-weight:700">' + qty + ' on hand · par ' + par + '</div>' +
      '</div>';
    }).join('');
    host.innerHTML =
      '<div style="background:rgba(245,200,66,.06);border:1px solid rgba(245,200,66,.3);border-radius:12px;padding:14px 16px;margin-top:14px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
          '<div style="display:flex;align-items:center;gap:10px">' +
            '<span style="font-size:18px">📦</span>' +
            '<div>' +
              '<div style="font-family:var(--ff-disp);font-size:13px;letter-spacing:2px;color:#f5c842">LOW STOCK</div>' +
              '<div style="font-size:11px;color:var(--muted);margin-top:2px">' + low.length + ' item' + (low.length === 1 ? '' : 's') + ' at or below reorder threshold</div>' +
            '</div>' +
          '</div>' +
          '<a href="javascript:void(0)" onclick="if(window.cNav)window.cNav(\'inventory\',null)" style="font-size:11px;color:var(--teal);text-decoration:none">Open inventory →</a>' +
        '</div>' +
        '<div>' + rows + '</div>' +
      '</div>';
  };

  (function wrap(){
    var orig = window.renderDash;
    if(typeof orig !== 'function'){ setTimeout(wrap, 500); return; }
    window.renderDash = function(){
      var r = orig.apply(this, arguments);
      try { window.renderLowStockAlert(); } catch(e){ console.warn('[GL] low-stock alert threw', e); }
      return r;
    };
  })();

  console.log('[GL] low-stock dashboard alert loaded');
}());
