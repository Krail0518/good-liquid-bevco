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
      // Use the user's session JWT when available so the row passes RLS
      // (the `error_log insert anyone authed` policy is scoped `to authenticated`).
      // Anonymous visitors fall through to the anon key — those inserts get
      // rejected with 401, which is fine since they wouldn't have anything
      // useful to log anyway.
      var token = null;
      try {
        if(window.supa && window.supa.auth && typeof window.supa.auth.getSession === 'function'){
          var s = await window.supa.auth.getSession();
          token = s && s.data && s.data.session && s.data.session.access_token;
        }
      } catch(_e){}
      var headers = { apikey: SKEY, Authorization: 'Bearer ' + (token || SKEY), 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };
      await fetch(SURL + '/error_log', {
        method: 'POST',
        headers: headers,
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
  var DEFAULT_FN_URL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/send-sms';
  var LEGACY_FN_URL  = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/twilio-sms';
  // Legacy one-time migration (gl_sms_fn_url rewrite) removed — no longer needed.
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

  // Mailgun key lives in Supabase secrets; assume it's set when the
  // first-run wizard runs. (Operators can still re-run the wizard
  // manually if they want a checklist.)
  function statusMailgun(){ return true; }
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
  window.GL_HOOKS.registerLoginHook(function(u){
    if(u && u.role === 'admin' && !isDone())
      setTimeout(function(){ window.openSetupWizard({ auto: true }); }, 600);
  });

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
  var DEFAULT_FN_URL = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/stripe-checkout-session';
  function getFnUrl(){
    var stored = (localStorage.getItem('gl_stripe_fn_url') || '').trim();
    // Auto-correct the old wrong URL that was baked into earlier builds —
    // the deployed function is /stripe-checkout-session, not /stripe-checkout.
    if(stored && /\/functions\/v1\/stripe-checkout$/.test(stored)){
      stored = stored + '-session';
      localStorage.setItem('gl_stripe_fn_url', stored);
    }
    return stored || DEFAULT_FN_URL;
  }

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
  // opts:
  //   payment_method: 'card' | 'ach' | 'both' (default 'both')
  //   surcharge_pct:  number (default 0; only applied when payment_method='card')
  //   newTab:         boolean (open Stripe in new tab instead of redirecting)
  //   currency:       string (default 'usd')
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
        amount: Number(invoice.amount),  // dollars — function multiplies by 100 itself
        currency: opts.currency || 'usd',
        client_email: invoice.clientEmail || (function(){
          var c = (window.clients||[]).find(function(x){ return x.id === invoice.client; });
          return c ? c.email : '';
        })(),
        invoice_id: invoice.id,
        description: 'Invoice ' + invoice.id + ' — ' + (invoice.svc || invoice.clientName || ''),
        success_url: location.origin + '/?stripe=success&invoice=' + encodeURIComponent(invoice.id),
        cancel_url:  location.origin + '/?stripe=cancel&invoice=' + encodeURIComponent(invoice.id),
        payment_method: opts.payment_method || 'both',
        surcharge_pct:  opts.surcharge_pct  || 0
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
      glOpenStripeMethodPicker(inv, { adminMode: true });
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
