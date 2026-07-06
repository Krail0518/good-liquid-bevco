/* crm-auth.js — Supabase client factory, authentication, user management, app settings */
(function(){
  'use strict';

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

  /* Expose Supabase factory so external modules can call window.glGetSupa() if needed */
  window.glGetSupa = getSupa;

}());
