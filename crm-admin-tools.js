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
  var esc = window.glEsc;

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
          +'<div style="width:28px;height:28px;border-radius:50%;background:'+(/^#[0-9a-fA-F]{3,8}$/.test(u.color||'')?u.color:'#1a6fff')+';color:'+(/^#[0-9a-fA-F]{3,8}$/.test(u.tc||'')?u.tc:'#fff')+';display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700">'+esc(u.initials||'?')+'</div>'
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
   EMAIL DELIVERY SETTINGS
   Outbound email sends via GMAIL (gmail-send Edge Function); Mailgun is
   only an automatic fallback. This panel documents where the credentials
   live (Supabase secrets) and offers a "Test send". Function name
   openMailgunSettings kept for back-compat.
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
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:32px;width:100%;max-width:600px;max-height:92vh;overflow-y:auto">' +
        '<div style="font-family:var(--ff-disp);font-size:22px;letter-spacing:2px;color:var(--teal);margin-bottom:8px">📧 EMAIL DELIVERY</div>' +
        '<div style="font-size:13px;color:var(--muted);margin-bottom:16px;line-height:1.6">Outbound email sends from your <b>Gmail (mike@goodliquid.com)</b>, with Mailgun as an automatic fallback so mail is never lost. All credentials live server-side in <b>Supabase Vault</b> — the browser never keeps them.</div>' +

        '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">GMAIL CONNECTION</div>' +
        '<div id="gl-gmail-status" style="font-size:12.5px;line-height:1.55;margin-bottom:10px;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#9aa7bd">Checking…</div>' +
        '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:12px;margin-bottom:14px">' +
          '<div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;line-height:1.5">One-time setup (or after changing the Google OAuth client): paste the <b>Client ID</b> and <b>Client Secret</b> from Google Console, Save, then Connect. No OAuth Playground, no copying tokens.</div>' +
          '<input id="gl-gm-cid" placeholder="Client ID (…apps.googleusercontent.com)" autocomplete="off" style="width:100%;margin-bottom:8px;padding:10px;background:#0a1628;border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#fff;font-size:12px;font-family:var(--ff-mono)">' +
          '<input id="gl-gm-csec" type="password" placeholder="Client Secret (GOCSPX-…)" autocomplete="off" style="width:100%;margin-bottom:10px;padding:10px;background:#0a1628;border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#fff;font-size:12px;font-family:var(--ff-mono)">' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<button onclick="window.glGmailSaveCreds()" style="flex:1;min-width:110px;padding:10px;background:rgba(0,229,192,.08);color:var(--teal);border:1px solid rgba(0,229,192,.25);border-radius:7px;cursor:pointer;font-size:12.5px">💾 Save keys</button>' +
            '<button onclick="window.glGmailConnect()" style="flex:1;min-width:110px;padding:10px;background:rgba(0,229,192,.14);color:var(--teal);border:1px solid rgba(0,229,192,.35);border-radius:7px;cursor:pointer;font-size:12.5px;font-weight:700">🔗 Connect Gmail</button>' +
            '<button onclick="window.glGmailTest()" style="flex:1;min-width:110px;padding:10px;background:rgba(255,255,255,.05);color:#cfd9e6;border:1px solid rgba(255,255,255,.12);border-radius:7px;cursor:pointer;font-size:12.5px">🧪 Test connection</button>' +
          '</div>' +
          // Backup connect path: routes the Google sign-in through the ONE
          // redirect URI known to be registered on the OAuth client (the
          // playground URL, saved 2026-07-28) so a redirect_uri_mismatch on
          // the site URLs can never block connecting. The CRM still does the
          // token exchange itself — the landing page is only a code display.
          '<div style="font-size:11px;color:var(--muted);margin:12px 0 6px">IF GOOGLE BLOCKS THE NORMAL CONNECT — BACKUP PATH</div>' +
          '<div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;line-height:1.5">1) Click the button and approve on Google. 2) You land on a Google developer page — copy the <b>Authorization code</b> shown on the left. 3) Paste it below and click Finish.</div>' +
          '<button onclick="window.glGmailManualStart()" style="width:100%;padding:10px;background:rgba(245,200,66,.08);color:#f5c842;border:1px solid rgba(245,200,66,.25);border-radius:7px;cursor:pointer;font-size:12.5px;margin-bottom:8px">🪪 Open Google sign-in (backup)</button>' +
          '<input id="gl-gm-code" placeholder="Paste the Authorization code here (starts 4/…)" autocomplete="off" style="width:100%;margin-bottom:8px;padding:10px;background:#0a1628;border:1px solid rgba(255,255,255,.1);border-radius:6px;color:#fff;font-size:12px;font-family:var(--ff-mono)">' +
          '<button onclick="window.glGmailManualFinish()" style="width:100%;padding:10px;background:rgba(0,229,192,.1);color:var(--teal);border:1px solid rgba(0,229,192,.3);border-radius:7px;cursor:pointer;font-size:12.5px">✅ Finish connection with pasted code</button>' +
        '</div>' +

        // Incoming side: pull real Gmail history into the CRM. This is the
        // in-app equivalent of invoking gmail-sync from the Supabase dashboard,
        // so the initial backfill never requires a trip there.
        '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">INCOMING MAIL</div>' +
        '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px;margin-bottom:12px;font-size:12px;color:#cfd9e6;line-height:1.7">' +
          'Sync reads your Gmail and files every message to or from a client or lead into their correspondence panel — including replies and mail sent from your phone. It runs automatically while the CRM is open, and hourly on a schedule. The button below is for a deep backfill or an on-demand refresh.' +
        '</div>' +
        '<button id="gl-sync-all-btn" onclick="window.glSyncAllEmail(this)" style="width:100%;padding:13px;background:rgba(0,229,192,.1);color:var(--teal);border:1px solid rgba(0,229,192,.3);border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;margin-bottom:10px">🔄 Sync email history from Gmail</button>' +
        // Persistent result line — stays put so the outcome can't be missed.
        '<div id="gl-sync-result" style="display:none;font-size:12px;line-height:1.55;margin-bottom:12px;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px"></div>' +

        '<div style="font-size:11px;color:var(--muted);margin-bottom:6px">SCHEDULED JOBS</div>' +
        '<div id="gl-cron-health" style="font-size:12px;line-height:1.6;margin-bottom:14px;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#9aa7bd">Checking…</div>' +

        '<div id="gl-test-result" style="display:none;font-size:12px;line-height:1.55;margin-bottom:12px;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px"></div>' +
        '<div style="display:flex;gap:10px">' +
          '<button onclick="window.glTestMailgun()" style="flex:1;padding:13px;background:rgba(245,200,66,.08);color:#f5c842;border:1px solid rgba(245,200,66,.3);border-radius:8px;cursor:pointer;font-size:13px">Test send</button>' +
          '<button onclick="document.getElementById(\'mg-settings-overlay\').remove()" style="padding:13px 20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--muted);cursor:pointer">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    // Live checks on open — each guarded so a stubbed/offline Supabase can
    // never break the panel itself.
    try { window.glGmailStatus(); } catch(_e){}
    try { window.glCronHealth(); } catch(_e){}
  };

  /* Full Gmail history sync, triggered from the Email Delivery panel. Runs the
     gmail-sync edge function over every client/lead address and reports the
     result inline on the button so the outcome is obvious without opening the
     console. Deliberately a wide sweep (180 days) since this is the one-time
     backfill; the per-client 🔄 Sync buttons handle day-to-day top-ups. */
  window.glSyncAllEmail = async function(btn){
    if(typeof window.glSyncGmail !== 'function'){
      alert('Email sync is not available in this build.');
      return;
    }
    // The result is written into a panel line that STAYS until the panel is
    // closed. The first version only flipped the button label for 6 seconds,
    // which is useless for a job that runs for a minute — you look away and
    // miss it, with no way to tell whether anything happened.
    var out = document.getElementById('gl-sync-result');
    var orig = btn ? btn.textContent : '';
    if(out){
      out.style.display = 'block';
      out.style.color = '#9aa7bd';
      out.textContent = 'Reading your Gmail… this can take a minute. You can leave this open.';
    }
    if(btn){ btn.disabled = true; btn.textContent = '🔄 Syncing…'; }

    var res = await window.glSyncGmail(null, { days: 180, max: 400 });

    if(btn){ btn.disabled = false; btn.textContent = orig; }
    if(!out) return;
    if(!res){
      out.style.color = '#ff8579';
      out.textContent = '⚠ Sync failed. ' + (window.glSyncGmail.lastError || 'See the notification for details.');
      return;
    }
    var filed   = res.inserted || 0;
    var already = res.skipped  || 0;
    var fixed   = res.upgraded || 0;
    if(filed || already || fixed){
      out.style.color = '#5fcf9e';
      out.textContent = '✓ Done — ' + filed + ' new email' + (filed === 1 ? '' : 's') + ' filed, ' +
        already + ' already had' +
        (fixed ? ', ' + fixed + ' had their full text filled in' : '') +
        '. Open a client or lead and scroll to CORRESPONDENCE.';
    } else {
      // Succeeded but found nothing — say why rather than looking broken.
      out.style.color = '#f5c842';
      out.textContent = '✓ Ran fine, but found no matching email. Checked ' +
        (res.scanned || 0) + ' recent message(s) against ' + (res.contacts || 0) +
        ' client/lead address(es). Likely means no email in the last 180 days with an address saved in the CRM.';
    }
  };

  /* ── Pricing & Capabilities doc editor ────────────────────────────────────
     The text stored here (company_docs.capabilities_pricing) is handed to
     Claude with EVERY AI-drafted or refined email. This editor is the screen
     that never existed: the drafts always LOOKED for the doc, but nothing in
     the app could create it — so Claude improvised prices for real leads. */
  window.glOpenPricingDoc = async function(){
    var prior = document.getElementById('gl-pricing-doc-modal'); if(prior) prior.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-pricing-doc-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:900;background:rgba(6,13,26,.95);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;padding:20px');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:16px;padding:28px;width:100%;max-width:780px;max-height:92vh;overflow-y:auto">' +
        '<div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:2px;color:var(--teal);margin-bottom:8px">📄 PRICING &amp; CAPABILITIES DOC</div>' +
        '<div style="font-size:12.5px;color:var(--muted);margin-bottom:12px;line-height:1.6">This text is given to Claude with <b>every</b> AI-drafted and refined email, so it quotes your real prices instead of inventing them. Keep it current — when your deck changes, update it here.</div>' +
        '<div id="gl-pd-status" style="font-size:12px;line-height:1.5;margin-bottom:10px;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;color:#9aa7bd">Loading…</div>' +
        '<textarea id="gl-pd-text" spellcheck="false" style="width:100%;height:48vh;padding:12px;background:#0a1628;border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#dfe7f1;font-size:12px;font-family:var(--ff-mono);line-height:1.5;resize:vertical"></textarea>' +
        '<div style="display:flex;gap:10px;margin-top:12px">' +
          '<button id="gl-pd-save" style="flex:1;padding:12px;background:rgba(0,229,192,.12);color:var(--teal);border:1px solid rgba(0,229,192,.3);border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">💾 Save</button>' +
          '<button id="gl-pd-close" style="padding:12px 20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--muted);cursor:pointer">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    var status = ov.querySelector('#gl-pd-status');
    var ta = ov.querySelector('#gl-pd-text');
    ov.querySelector('#gl-pd-close').addEventListener('click', function(){ ov.remove(); });

    try {
      var res = await supa.from('company_docs').select('content, updated_at').eq('key','capabilities_pricing').maybeSingle();
      if(res && res.data && res.data.content){
        ta.value = res.data.content;
        status.style.color = '#5fcf9e';
        status.textContent = '✓ Loaded — last updated ' + (res.data.updated_at ? new Date(res.data.updated_at).toLocaleString() : 'unknown') + '.';
      } else {
        status.style.color = '#ff8579';
        status.textContent = '⚠ EMPTY — Claude currently has NO pricing and is told not to quote any numbers. Paste your deck text below and Save.';
      }
    } catch(e){
      status.style.color = '#ff8579';
      status.textContent = '⚠ Could not load: ' + (e.message || e);
    }

    ov.querySelector('#gl-pd-save').addEventListener('click', async function(){
      var content = ta.value.trim();
      if(!content){ status.style.color = '#ff8579'; status.textContent = 'Nothing to save — the box is empty.'; return; }
      status.style.color = '#9aa7bd'; status.textContent = 'Saving…';
      try {
        var up = await supa.from('company_docs').upsert({ key: 'capabilities_pricing', content: content, updated_at: new Date().toISOString() });
        if(up && up.error) throw up.error;
        try { window.__glCapsDoc = null; } catch(_e){}   // next draft re-reads it
        status.style.color = '#5fcf9e';
        status.textContent = '✓ Saved (' + content.length + ' characters). Every AI draft and refine now uses this.';
      } catch(e){
        status.style.color = '#ff8579';
        status.textContent = '✗ Save failed: ' + (e.message || e);
      }
    });
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

  /* ── Gmail connection (gmail-oauth Edge Function) ─────────────────────────
     The in-app replacement for the OAuth Playground: keys are saved straight
     into Supabase Vault server-side, Connect runs Google's consent flow, and
     the refresh token never touches a clipboard. */

  function glEsc(s){
    return String(s == null ? '' : s).replace(/[<>&]/g, function(c){
      return {'<':'&lt;','>':'&gt;','&':'&amp;'}[c];
    });
  }

  // Pull the most useful error text out of a supa.functions.invoke result.
  async function glInvokeErr(resp){
    try {
      if(resp && resp.data && resp.data.error) return String(resp.data.error);
      if(resp && resp.error){
        var ctx = resp.error.context;
        if(ctx && typeof ctx.clone === 'function'){
          try {
            var j = await ctx.clone().json();
            if(j && (j.error || j.message)) return String(j.error || j.message);
          } catch(_e){}
        }
        return String(resp.error.message || resp.error);
      }
    } catch(_e){}
    return 'Unknown error';
  }
  window.glInvokeErr = glInvokeErr;

  window.glGmailStatus = async function(){
    var el = document.getElementById('gl-gmail-status'); if(!el) return;
    if(!window.supa || !supa.functions || !supa.functions.invoke){
      el.textContent = 'Status unavailable in this build.'; return;
    }
    el.style.color = '#9aa7bd'; el.textContent = 'Checking Gmail connection…';
    try {
      var resp = await supa.functions.invoke('gmail-oauth', { body: { action: 'status' } });
      var d = (resp && resp.data) || {};
      if(resp.error || d.ok === false){
        el.style.color = '#ff8579';
        el.textContent = '⚠ Could not check: ' + (await glInvokeErr(resp));
        return;
      }
      if(d.connected){
        // Credentials exist — but existence isn't health. Verify live so a
        // broken pair can never hide behind a green "connected".
        el.textContent = 'Credentials found — verifying with Google…';
        var t = await supa.functions.invoke('gmail-oauth', { body: { action: 'test' } });
        var td = (t && t.data) || {};
        if(!t.error && td.ok){
          el.style.color = '#5fcf9e';
          el.textContent = '✓ Connected' + (d.email ? ' as ' + d.email : '') +
            (td.source === 'vault' ? ' — credentials held in Supabase Vault.' : ' — using legacy Supabase secrets.');
        } else {
          el.style.color = '#ff8579';
          el.textContent = '✗ Credentials are saved but BROKEN: ' + (td.error || (await glInvokeErr(t)));
        }
      } else if(d.pending_connect || (d.has_client_id && d.has_client_secret)){
        el.style.color = '#f5c842';
        el.textContent = '⚠ Keys saved — one step left: click "🔗 Connect Gmail" and approve access. (Test buttons have nothing to test until then.)';
      } else {
        el.style.color = '#ff8579';
        el.textContent = '✗ Not connected. Paste the Client ID and Client Secret from Google Console below, Save, then Connect.';
      }
    } catch(e){
      el.style.color = '#ff8579';
      el.textContent = '⚠ Could not check: ' + e.message;
    }
  };

  window.glGmailSaveCreds = async function(){
    var el = document.getElementById('gl-gmail-status');
    if(!window.supa || !supa.functions || !supa.functions.invoke){
      if(el){ el.style.color = '#ff8579'; el.textContent = 'Unavailable in this build.'; }
      return;
    }
    var cid = ((document.getElementById('gl-gm-cid')  || {}).value || '').trim();
    var sec = ((document.getElementById('gl-gm-csec') || {}).value || '').trim();
    if(!cid || !sec){
      if(el){ el.style.color = '#ff8579'; el.textContent = 'Both fields are needed — Client ID and Client Secret.'; }
      return;
    }
    if(el){ el.style.color = '#9aa7bd'; el.textContent = 'Saving keys to Supabase Vault…'; }
    var resp = await supa.functions.invoke('gmail-oauth', { body: { action: 'save', client_id: cid, client_secret: sec } });
    if(resp.error || (resp.data && resp.data.ok === false)){
      if(el){ el.style.color = '#ff8579'; el.textContent = '✗ Save failed: ' + (await glInvokeErr(resp)); }
      return;
    }
    // Clear the fields — the values now live server-side only.
    try { document.getElementById('gl-gm-cid').value = ''; document.getElementById('gl-gm-csec').value = ''; } catch(_e){}
    if(el){ el.style.color = '#f5c842'; el.textContent = '✓ Keys saved to Vault. Now click "Connect Gmail".'; }
  };

  window.glGmailConnect = async function(){
    var el = document.getElementById('gl-gmail-status');
    if(!window.supa || !supa.functions || !supa.functions.invoke){
      if(el){ el.style.color = '#ff8579'; el.textContent = 'Unavailable in this build.'; }
      return;
    }
    if(el){ el.style.color = '#9aa7bd'; el.textContent = 'Opening Google sign-in…'; }
    // Per-attempt CSRF nonce: Google echoes it back via `state`, and the
    // return handler only finishes a connect whose nonce THIS browser minted.
    // A constant state would let a crafted link bind a stranger's mailbox.
    var nonce = 'glgmail.';
    try {
      var a = new Uint32Array(4); crypto.getRandomValues(a);
      nonce += Array.prototype.join.call(a, '-');
    } catch(_e){ nonce += String(Date.now()) + '-' + Math.floor(Math.random() * 1e9); }
    try { sessionStorage.setItem('gl_gmail_state', nonce); } catch(_e){}
    // Always the bare site root: launching from /index.html (or any path)
    // must not change the return address, because Google only accepts
    // exact-match URIs registered on the OAuth client.
    var resp = await supa.functions.invoke('gmail-oauth', {
      body: { action: 'start', redirect_uri: location.origin + '/', state: nonce }
    });
    if(resp.error || !resp.data || !resp.data.url){
      if(el){ el.style.color = '#ff8579'; el.textContent = '✗ ' + (await glInvokeErr(resp)); }
      return;
    }
    location.href = resp.data.url;
  };

  /* Backup connect: Google returns the user to the OAuth Playground URL (the
     one redirect URI reliably registered on the client), which displays the
     authorization code; the user pastes it here and the CRM's own edge
     function performs the exchange with the Vault-held key pair. Exists
     because saving new redirect URIs in Google Console repeatedly failed to
     stick, hard-blocking the normal same-tab flow. */
  var GL_PLAYGROUND = 'https://developers.google.com/oauthplayground';

  window.glGmailManualStart = async function(){
    var el = document.getElementById('gl-gmail-status');
    if(!window.supa || !supa.functions || !supa.functions.invoke){
      if(el){ el.style.color = '#ff8579'; el.textContent = 'Unavailable in this build.'; }
      return;
    }
    if(el){ el.style.color = '#9aa7bd'; el.textContent = 'Opening Google sign-in (backup path)…'; }
    var resp = await supa.functions.invoke('gmail-oauth', {
      body: { action: 'start', redirect_uri: GL_PLAYGROUND, state: 'glgmail.manual-' + Date.now() }
    });
    if(resp.error || !resp.data || !resp.data.url){
      if(el){ el.style.color = '#ff8579'; el.textContent = '✗ ' + (await glInvokeErr(resp)); }
      return;
    }
    window.open(resp.data.url, '_blank');
    if(el){
      el.style.color = '#f5c842';
      el.textContent = 'Approve on Google in the new tab. You will land on a Google developer page — copy the "Authorization code" from its left panel, paste it in the box below, then click Finish.';
    }
  };

  window.glGmailManualFinish = async function(){
    var el = document.getElementById('gl-gmail-status');
    if(!window.supa || !supa.functions || !supa.functions.invoke){
      if(el){ el.style.color = '#ff8579'; el.textContent = 'Unavailable in this build.'; }
      return;
    }
    var raw = ((document.getElementById('gl-gm-code') || {}).value || '').trim();
    // Accept a bare code or a whole pasted URL containing ?code=…
    var code = raw;
    var m = raw.match(/[?&]code=([^&\s]+)/);
    if(m){ try { code = decodeURIComponent(m[1]); } catch(_e){ code = m[1]; } }
    if(!code){
      if(el){ el.style.color = '#ff8579'; el.textContent = 'Paste the Authorization code first (it starts with 4/).'; }
      return;
    }
    if(el){ el.style.color = '#9aa7bd'; el.textContent = 'Finishing the connection…'; }
    var resp = await supa.functions.invoke('gmail-oauth', {
      body: { action: 'callback', code: code, redirect_uri: GL_PLAYGROUND }
    });
    if(!resp.error && resp.data && resp.data.ok){
      try { document.getElementById('gl-gm-code').value = ''; } catch(_e){}
      if(el){ el.style.color = '#5fcf9e'; el.textContent = '✓ Gmail connected' + (resp.data.email ? ' as ' + resp.data.email : '') + '. Now click "Test send" below.'; }
    } else {
      if(el){ el.style.color = '#ff8579'; el.textContent = '✗ ' + (await glInvokeErr(resp)) + ' (Codes expire in minutes and work once — if it sat a while, click the backup sign-in again for a fresh one.)'; }
    }
  };

  window.glGmailTest = async function(){
    var el = document.getElementById('gl-gmail-status'); if(!el) return;
    if(!window.supa || !supa.functions || !supa.functions.invoke){
      el.style.color = '#ff8579'; el.textContent = 'Unavailable in this build.'; return;
    }
    el.style.color = '#9aa7bd'; el.textContent = 'Testing the Gmail connection…';
    var resp = await supa.functions.invoke('gmail-oauth', { body: { action: 'test' } });
    var d = (resp && resp.data) || {};
    if(!resp.error && d.ok){
      el.style.color = '#5fcf9e';
      el.textContent = '✓ Gmail connection works (' + (d.source || 'saved') + ' credentials).';
    } else {
      el.style.color = '#ff8579';
      el.textContent = '✗ ' + (d.error || (await glInvokeErr(resp)));
    }
  };

  /* Scheduled-jobs health — reads gl_cron_health() so a silent cron failure
     (the thing that stopped follow-up email for hours) is visible in the app. */
  window.glCronHealth = async function(){
    var el = document.getElementById('gl-cron-health'); if(!el) return;
    if(!window.supa || typeof supa.rpc !== 'function'){ el.textContent = 'Unavailable in this build.'; return; }
    el.style.color = '#9aa7bd'; el.textContent = 'Checking scheduled jobs…';
    try {
      var res = await supa.rpc('gl_cron_health');
      var d = res && res.data;
      if(!d || !d.jobs){ el.textContent = 'Could not load job status.'; return; }
      var http = d.http || [];
      var bad = http.filter(function(h){ return !(h.status >= 200 && h.status < 300); });
      var overdue = Number(d.overdue || 0);
      var lines = (d.jobs || []).map(function(j){
        var when = j.last_run ? new Date(j.last_run).toLocaleString() : 'never';
        return '• ' + glEsc(j.name) + ' (' + glEsc(j.schedule) + ') — last run ' + glEsc(when);
      });
      // The decisive signal is `overdue`: follow-ups due >30 min ago and still
      // unsent means the scheduler is NOT doing its job, whatever else looks
      // fine. The raw http list is context only — the database's outbound
      // call log is shared with deal alerts, so a failure there isn't
      // necessarily an email job.
      if(overdue > 0){
        el.style.color = '#ff8579';
        el.innerHTML = '✗ ' + overdue + ' follow-up email' + (overdue === 1 ? ' is' : 's are') +
          ' due but unsent for over 30 minutes — the scheduler may be down.<br>' + lines.join('<br>');
      } else if(http.length === 0){
        el.style.color = '#f5c842';
        el.innerHTML = '⚠ No overdue follow-ups, but no recent delivery records to confirm either.<br>' + lines.join('<br>');
      } else if(bad.length === 0){
        el.style.color = '#5fcf9e';
        el.innerHTML = '✓ No overdue follow-ups; last ' + http.length + ' outbound calls all OK.<br>' + lines.join('<br>');
      } else {
        el.style.color = '#f5c842';
        el.innerHTML = '⚠ No overdue follow-ups, but ' + bad.length + ' of the last ' + http.length +
          ' outbound calls from the database failed (HTTP ' +
          bad.map(function(h){ return glEsc(h.status); }).join(', ') +
          '). This list includes deal-alert traffic, not just the email jobs.<br>' + lines.join('<br>');
      }
    } catch(e){
      el.textContent = 'Could not load job status: ' + e.message;
    }
  };

  /* Test send — HONEST version. The old one reported "✓ sent" when only the
     Mailgun fallback had fired, which hid a dead Gmail connection behind a
     green checkmark for hours. This one tries Gmail DIRECTLY first and names
     the channel that actually delivered. */
  window.glTestMailgun = async function(){
    var out = document.getElementById('gl-test-result');
    var show = function(color, html){
      if(out){ out.style.display = 'block'; out.style.color = color; out.innerHTML = html; }
      else alert(String(html).replace(/<[^>]+>/g, ''));
    };
    if(!window.supa || !supa.functions || !supa.functions.invoke){ show('#ff8579', 'Email sender unavailable.'); return; }
    show('#9aa7bd', 'Sending a test email…');
    var payload = {
      to: 'mike@goodliquid.com',
      subject: 'Test email from Good Liquid CRM',
      text: 'This is a test email confirming outbound email is working. Sent ' + new Date().toLocaleString() + '. — Good Liquid CRM'
    };
    var g = await supa.functions.invoke('gmail-send', { body: payload });
    var gOk = !g.error && g.data && g.data.ok !== false;
    if(gOk){
      show('#5fcf9e', '✓ Sent via <b>Gmail</b> (the primary channel). Check mike@goodliquid.com — remember your filter files CRM mail under "5 · Auto-Reports", not the inbox.');
      return;
    }
    var gErr = glEsc(await glInvokeErr(g));
    var m = await supa.functions.invoke('mailgun-send', { body: payload });
    var mOk = !m.error && m.data && m.data.ok !== false;
    if(mOk){
      show('#f5c842', '⚠ Gmail failed (' + gErr + '), but the <b>Mailgun fallback delivered it</b> — mail IS going out, just from noreply@mail.goodliquidbevco.com instead of your Gmail. Fix Gmail with "Connect Gmail" above. The test lands under your "5 · Auto-Reports" label.');
    } else {
      var mErr = glEsc(await glInvokeErr(m));
      show('#ff8579', '✗ BOTH channels failed — outbound email is down.<br>Gmail: ' + gErr + '<br>Mailgun: ' + mErr);
    }
  };

  /* Landing back from Google after "Connect Gmail": the consent flow returns
     to the CRM's own URL with ?code=…&state=glgmail. Finish the exchange
     server-side (gmail-oauth stores the refresh token in Vault) and tell the
     user how it went. */
  (function glGmailReturnBoot(){
    var q;
    try { q = new URLSearchParams(location.search); } catch(_e){ return; }
    var state = q.get('state') || '';
    if(state.indexOf('glgmail') !== 0 || !q.get('code')) return;
    var code = q.get('code');
    // Clean the URL immediately so a reload can't resend a used code.
    try { history.replaceState(null, '', location.origin + location.pathname); } catch(_e){}
    // CSRF check: only finish a connect THIS browser started. glGmailConnect
    // minted the nonce into sessionStorage; Google echoed it back as `state`.
    var expected = '';
    try {
      expected = sessionStorage.getItem('gl_gmail_state') || '';
      sessionStorage.removeItem('gl_gmail_state');
    } catch(_e){}
    if(!expected || expected !== state){
      alert('Gmail connect ignored — this window did not start that connection (security check). Open Email Delivery and click Connect Gmail again.');
      return;
    }
    // The redirect back from Google is a fresh page load, so don't wait for a
    // full CRM login (currentUser) — the Supabase client restores its session
    // from storage on its own, and functions.invoke attaches it.
    var tries = 0;
    (function wait(){
      if(!window.supa || !window.supa.auth || typeof supa.auth.getSession !== 'function'){
        if(++tries > 40){
          alert('Gmail connect: the app did not finish loading. Reload the page, log in, and click Connect Gmail again.');
          return;
        }
        setTimeout(wait, 250);
        return;
      }
      supa.auth.getSession().then(function(s){
        var session = s && s.data && s.data.session;
        if(!session){
          alert('Gmail connect: you are signed out. Log in (Admin), then click Connect Gmail again.');
          return;
        }
        // Must byte-match the redirect_uri used in 'start' (origin + '/').
        supa.functions.invoke('gmail-oauth', {
          body: { action: 'callback', code: code, redirect_uri: location.origin + '/' }
        }).then(async function(resp){
          if(!resp.error && resp.data && resp.data.ok){
            alert('✓ Gmail connected' + (resp.data.email ? ' as ' + resp.data.email : '') + '. Outbound email now sends from Gmail.');
          } else {
            alert('✗ Gmail connect failed: ' + (await glInvokeErr(resp)));
          }
          try { if(typeof window.glGmailStatus === 'function' && document.getElementById('gl-gmail-status')) window.glGmailStatus(); } catch(_e){}
        });
      });
    })();
  })();

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
      { label:'📄 Pricing Doc (AI)', fn:'glOpenPricingDoc', admin:true },
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

