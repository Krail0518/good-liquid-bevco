/* ============================================================
   CUSTOMER PORTAL — self-service login + dashboard
   - URL: ?portal=1 (or ?portal=login / ?portal=signin)
   - Customer signs in with email + password (Supabase Auth)
   - Lands on a dashboard showing their invoices + allergen decls
   - Each invoice has a Pay button + a "View" link to the public-token
     view (which already has the Stripe Pay flow)
   - Admin invites customers via the Clients page (separate "+ Customer
     login" button — added below)
   ============================================================ */
(function(){
  function getSB(){ return window.supa || null; }
  function escHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function usd(n){ return '$' + (Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }

  // ────────────────────────────────────────────────────────────
  // Recovery-link detection. Captured at script-load time so we still
  // know we're in a recovery flow even after supabase-js has parsed
  // and removed the URL fragment. Covers both implicit (#access_token
  // …type=recovery) and PKCE (?code=…) styles.
  // ────────────────────────────────────────────────────────────
  var _initialHash = window.location.hash || '';
  var _initialSearch = window.location.search || '';
  var _recoveryHint = (
    _initialHash.indexOf('type=recovery') >= 0 ||
    (/[?&]code=/.test(_initialSearch) && /[?&]portal=1\b/.test(_initialSearch)) ||
    (/[?&]token_hash=/.test(_initialSearch) && /[?&]type=recovery/.test(_initialSearch))
  );
  var _recoveryEventSeen = false;
  (function watchRecoveryEarly(){
    var sb = window.supa;
    if(sb && sb.auth && typeof sb.auth.onAuthStateChange === 'function'){
      try {
        sb.auth.onAuthStateChange(function(event){
          if(event === 'PASSWORD_RECOVERY'){
            _recoveryEventSeen = true;
            // If checkPortalMode already rendered login/dashboard before the
            // event fired, swap to the waiting placeholder so the recovery
            // modal isn't competing with the login form for the user's eye.
            var cp = document.getElementById('gl-cp');
            if(cp) cp.innerHTML = _waitingHtml();
          }
        });
      } catch(e){ console.warn('[GL portal] early recovery watcher failed', e); }
      return;
    }
    setTimeout(watchRecoveryEarly, 60);
  })();
  function _waitingHtml(){
    return '<div style="text-align:center;padding:120px 20px;color:#6b87ad;font-family:Arial,Helvetica,sans-serif">' +
      '<div style="font-size:18px;letter-spacing:2px;color:#00e5c0;margin-bottom:10px">CUSTOMER PORTAL</div>' +
      '<div style="font-size:13px">Setting up password reset… Please wait.</div>' +
    '</div>';
  }

  // ────────────────────────────────────────────────────────────
  // Portal mode detection
  // ────────────────────────────────────────────────────────────
  async function checkPortalMode(){
    var url = new URL(window.location.href);
    if(!url.searchParams.has('portal')) return false;
    var sb = getSB(); if(!sb) return false;
    document.title = 'Customer Portal — Good Liquid Bev Co';
    // Recovery flow? Don't render login/dashboard — show a waiting state and
    // let the global recovery modal handle it. After the customer saves their
    // new password, the recovery handler calls window.glCheckPortal which
    // re-enters this function without any recovery URL artifacts.
    if(_recoveryHint || _recoveryEventSeen){
      document.body.innerHTML = '<div id="gl-cp" style="min-height:100vh;background:#0a1628">' + _waitingHtml() + '</div>';
      return true;
    }
    // Render the portal shell — login first, then dashboard if signed in
    document.body.innerHTML = '<div id="gl-cp" style="min-height:100vh;background:#0a1628;font-family:Arial,Helvetica,sans-serif;color:#eef4ff">Loading…</div>';
    var sess = await sb.auth.getSession();
    if(sess.data && sess.data.session){
      // Verify the user is a customer (has a customer_users row)
      var u = await sb.from('customer_users')
        .select('id, client_id, email, display_name, active, role, notify_run_stage_changes')
        .eq('auth_user_id', sess.data.session.user.id)
        .eq('active', true)
        .maybeSingle();
      if(u.data){
        renderDashboard(u.data);
      } else {
        // Authenticated but not a customer — could be a staff member
        // visiting ?portal=1 by mistake. Show login.
        renderLogin('Account is not a customer portal account. Sign in with the email your account manager invited.');
      }
    } else {
      renderLogin('');
    }
    return true;
  }

  function shell(inner){
    return '<div style="max-width:520px;margin:60px auto;padding:30px;background:#142238;border:1px solid rgba(0,229,192,.25);border-radius:14px;color:#eef4ff;font-family:Arial,Helvetica,sans-serif">' + inner + '</div>';
  }

  function requestTile(emoji, kind, title, subtitle){
    return '<div onclick="window.glOpenCustomerRequest(\'' + kind + '\')" style="background:#142238;border:1px solid rgba(0,229,192,.18);border-radius:12px;padding:16px 18px;cursor:pointer;transition:background .15s,border-color .15s" onmouseover="this.style.background=\'#1a2c48\';this.style.borderColor=\'rgba(0,229,192,.4)\'" onmouseout="this.style.background=\'#142238\';this.style.borderColor=\'rgba(0,229,192,.18)\'">' +
      '<div style="font-size:22px">' + emoji + '</div>' +
      '<div style="font-size:14px;font-weight:700;color:#fff;margin-top:6px">' + escHtml(title) + '</div>' +
      '<div style="font-size:11px;color:#6b87ad;margin-top:2px">' + escHtml(subtitle) + '</div>' +
    '</div>';
  }

  window.glOpenCustomerRequest = function(kind){
    var sb = getSB(); if(!sb){ alert('Supabase not ready'); return; }
    var existing = document.getElementById('gl-cust-req');
    if(existing) existing.remove();
    var labels = { sample:'Request samples', reorder:'Place an order', quote:'Request a quote', question:'Ask a question', other:'Submit a request' };
    var placeholders = {
      sample:   'Which products? Any flavor or pack-size variants? Where should we ship to?',
      reorder:  'Which previous run are you reordering? Quantity? Target ship date?',
      quote:    'Describe the new project — formulation, format, target volume, timeline.',
      question: 'What\'s your question?',
      other:    'How can we help?'
    };
    var ov = document.createElement('div');
    ov.id = 'gl-cust-req';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1100;background:rgba(6,13,26,.94);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Arial,Helvetica,sans-serif');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(0,229,192,.25);border-radius:14px;padding:28px;width:100%;max-width:520px;color:#eef4ff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">' +
          '<div style="font-size:18px;font-weight:900;color:#00e5c0;letter-spacing:2px">' + escHtml((labels[kind]||labels.other).toUpperCase()) + '</div>' +
          '<button onclick="document.getElementById(\'gl-cust-req\').remove()" style="background:none;border:0;color:#6b87ad;font-size:22px;cursor:pointer">×</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#9ca3af;margin-bottom:18px;line-height:1.5">Mike will reply by email within 1 business day.</div>' +
        '<div style="font-size:11px;letter-spacing:1.5px;color:#6b87ad;margin-bottom:6px">SUBJECT (OPTIONAL)</div>' +
        '<input id="gl-cr-subject" type="text" placeholder="Brief one-line summary" style="width:100%;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#eef4ff;font-size:13px;margin-bottom:14px;box-sizing:border-box">' +
        '<div style="font-size:11px;letter-spacing:1.5px;color:#6b87ad;margin-bottom:6px">DETAILS</div>' +
        '<textarea id="gl-cr-body" rows="6" placeholder="' + escHtml(placeholders[kind] || placeholders.other) + '" style="width:100%;padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#eef4ff;font-size:13px;margin-bottom:14px;box-sizing:border-box;font-family:inherit;resize:vertical"></textarea>' +
        '<div id="gl-cr-msg" style="display:none;margin-bottom:10px;padding:8px 12px;border-radius:6px;font-size:12px"></div>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end">' +
          '<button onclick="document.getElementById(\'gl-cust-req\').remove()" class="cbtn" style="background:rgba(255,255,255,.06);color:#eef4ff;border:1px solid rgba(255,255,255,.12);padding:9px 16px;border-radius:6px;font-size:13px;cursor:pointer">Cancel</button>' +
          '<button id="gl-cr-send" class="cbtn pri" style="background:#00e5c0;color:#0a1628;border:0;padding:9px 20px;border-radius:6px;font-size:13px;font-weight:800;cursor:pointer">Submit</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    document.getElementById('gl-cr-send').onclick = async function(){
      var btn = this;
      var msg = document.getElementById('gl-cr-msg');
      msg.style.display = 'none';
      var subject = (document.getElementById('gl-cr-subject').value||'').trim();
      var body    = (document.getElementById('gl-cr-body').value||'').trim();
      if(!body){
        msg.style.display='block';
        msg.style.background='rgba(231,76,60,.12)';
        msg.style.border='1px solid rgba(231,76,60,.35)';
        msg.style.color='#ff8579';
        msg.textContent='Please add some details before submitting.';
        return;
      }
      btn.disabled = true; var origText = btn.textContent; btn.textContent='Submitting…';
      // Find the customer's auth user id + client_id via the existing customer_users link.
      try {
        var sess = await sb.auth.getSession();
        var uid = sess && sess.data && sess.data.session && sess.data.session.user && sess.data.session.user.id;
        var cu = await sb.from('customer_users').select('client_id').eq('auth_user_id', uid).maybeSingle();
        var clientId = cu && cu.data && cu.data.client_id;
        if(!clientId) throw new Error('Account not linked to a client. Contact Mike.');
        var ins = await sb.from('customer_requests').insert({
          client_id: clientId, submitted_by: uid,
          kind: kind, subject: subject || null, body: body, status: 'new'
        });
        if(ins.error) throw ins.error;
        msg.style.display='block';
        msg.style.background='rgba(95,207,158,.12)';
        msg.style.border='1px solid rgba(95,207,158,.35)';
        msg.style.color='#5fcf9e';
        msg.textContent='✓ Submitted. Mike will reply by email within 1 business day.';
        btn.textContent='Sent ✓';
        setTimeout(function(){ ov.remove(); }, 1400);
      } catch(e){
        console.error('[GL portal] request submit failed', e);
        msg.style.display='block';
        msg.style.background='rgba(231,76,60,.12)';
        msg.style.border='1px solid rgba(231,76,60,.35)';
        msg.style.color='#ff8579';
        msg.textContent='Submission failed: ' + (e.message || 'unknown');
        btn.disabled = false; btn.textContent = origText;
      }
    };
  };
  function logoBlock(){
    return '<div style="text-align:center;margin-bottom:28px">' +
      '<div style="font-size:22px;font-weight:900;color:#00e5c0;letter-spacing:3px">GOOD LIQUID BEV CO</div>' +
      '<div style="font-size:11px;color:#6b87ad;margin-top:4px;letter-spacing:1px;text-transform:uppercase">Customer Portal</div>' +
    '</div>';
  }

  function renderLogin(msg){
    document.getElementById('gl-cp').innerHTML = shell(
      logoBlock() +
      (msg ? '<div style="background:rgba(231,76,60,.12);border:1px solid rgba(231,76,60,.35);color:#ff8579;padding:10px 12px;border-radius:6px;font-size:12px;margin-bottom:14px">' + escHtml(msg) + '</div>' : '') +
      '<div style="font-size:11px;letter-spacing:2px;color:#6b87ad;margin-bottom:6px">EMAIL</div>' +
      '<input id="cp-email" type="email" autocomplete="username" style="width:100%;padding:11px 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#eef4ff;font-size:14px;box-sizing:border-box;margin-bottom:12px">' +
      '<div style="font-size:11px;letter-spacing:2px;color:#6b87ad;margin-bottom:6px">PASSWORD</div>' +
      '<input id="cp-pw" type="password" autocomplete="current-password" style="width:100%;padding:11px 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#eef4ff;font-size:14px;box-sizing:border-box;margin-bottom:14px">' +
      '<button id="cp-signin" style="width:100%;background:#00e5c0;color:#0a1628;border:0;padding:12px;border-radius:8px;font-size:14px;font-weight:800;cursor:pointer;letter-spacing:.3px">Sign in</button>' +
      '<button id="cp-forgot" style="width:100%;margin-top:10px;background:none;color:#6b87ad;border:0;font-size:11px;cursor:pointer;text-decoration:underline">Forgot password?</button>' +
      '<div id="cp-status" style="margin-top:12px;font-size:12px;color:#6b87ad;text-align:center;min-height:18px"></div>' +
      '<div style="margin-top:24px;font-size:11px;color:#6b87ad;text-align:center;line-height:1.5">' +
        'No account yet? Your Good Liquid account manager will send you an invite email.<br>' +
        'Questions: <a href="mailto:Mike@GoodLiquid.com" style="color:#00e5c0">Mike@GoodLiquid.com</a> · (803) 493-5065' +
      '</div>'
    );
    var sb = getSB();
    document.getElementById('cp-signin').onclick = async function(){
      var btn = this; var status = document.getElementById('cp-status');
      var email = document.getElementById('cp-email').value.trim();
      var pw = document.getElementById('cp-pw').value;
      if(!email || !pw){ status.style.color='#ff8579'; status.textContent='Enter email + password.'; return; }
      btn.disabled = true; btn.textContent = 'Signing in…';
      var r = await sb.auth.signInWithPassword({ email: email, password: pw });
      btn.disabled = false; btn.textContent = 'Sign in';
      if(r.error){ status.style.color='#ff8579'; status.textContent = r.error.message; return; }
      // Re-check portal mode after sign-in
      checkPortalMode();
    };
    document.getElementById('cp-forgot').onclick = async function(){
      var email = document.getElementById('cp-email').value.trim();
      if(!email){ document.getElementById('cp-status').textContent = 'Enter your email first.'; return; }
      var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + '?portal=1' });
      var status = document.getElementById('cp-status');
      if(r.error){ status.style.color='#ff8579'; status.textContent = r.error.message; }
      else { status.style.color='#5fcf9e'; status.textContent = 'Check your inbox for a reset link.'; }
    };
    // Allow Enter to submit
    document.getElementById('cp-pw').addEventListener('keydown', function(e){ if(e.key === 'Enter') document.getElementById('cp-signin').click(); });
  }

  async function renderDashboard(customer){
    var sb = getSB();
    // Update last_login (fire-and-forget)
    try { sb.from('customer_users').update({ last_login: new Date().toISOString() }).eq('id', customer.id); } catch(e){}
    // Fetch client + invoices + allergen decls + production runs + samples + formulas
    var clientRow = await sb.from('clients').select('name, contact_name, contact_type, email, phone, street, city, state, zip, additional_emails, shipping_same, shipping_street, shipping_city, shipping_state, shipping_zip, lift_gate, dock_hours').eq('id', customer.client_id).maybeSingle();
    var client = clientRow.data || {};
    var invR = await sb.from('invoices').select('id, invoice_number, amount, status, invoice_date, due_date, line_items, share_token').eq('client_id', customer.client_id).order('invoice_date', { ascending: false });
    var invs = invR.data || [];
    var algR = await sb.from('client_allergen_declarations').select('id, product_name, allergens, declared_at, share_token').eq('client_id', customer.client_id).order('declared_at', { ascending: false });
    var algs = algR.data || [];
    var prR = await sb.from('production_runs').select('id, run_name, format, cases, stage, scheduled_date, scheduled_start_date, scheduled_end_date, lot_number, updated_at').eq('client_id', customer.client_id).order('scheduled_start_date', { ascending: false, nullsFirst: false });
    var prs = (prR && prR.data) || [];
    // Note: updated_at omitted because some prod schemas have drifted and
    // it's not actually rendered downstream. Migration 20260521 restores
    // the column server-side; this SELECT stays defensive either way.
    var shR = await sb.from('sample_shipments').select('id, kind, qty, shipped_date, carrier, tracking, status').eq('client_id', customer.client_id).order('shipped_date', { ascending: false, nullsFirst: false });
    var shs = (shR && shR.data) || [];
    // Only show non-draft formulas to the customer
    var fmR = await sb.from('formulas').select('id, name, version, status, batch_size_gal, target_yield_cases, allergens, updated_at').eq('client_id', customer.client_id).neq('status', 'draft').order('updated_at', { ascending: false });
    var fms = (fmR && fmR.data) || [];
    var ldR = await sb.from('lot_documents').select('id, document_type, title, lot_number, file_name, file_size, file_path, mime_type, uploaded_at, production_run_id').eq('client_id', customer.client_id).order('uploaded_at', { ascending: false });
    var lds = (ldR && ldR.data) || [];

    var STATUS_COLOR = { paid:'#5fcf9e', pending:'#f5c842', overdue:'#e74c3c', quote:'#9aa7bd', expired:'#9aa7bd', draft:'#9aa7bd' };
    var paidTotal = invs.filter(function(i){ return i.status === 'paid'; }).reduce(function(s,i){ return s + (Number(i.amount)||0); }, 0);
    var pendingTotal = invs.filter(function(i){ return i.status === 'pending' || i.status === 'overdue'; }).reduce(function(s,i){ return s + (Number(i.amount)||0); }, 0);
    var openInvoiceCount = invs.filter(function(i){ return i.status === 'pending' || i.status === 'overdue'; }).length;

    var invRowsHtml = invs.length ? invs.map(function(i){
      var color = STATUS_COLOR[i.status] || '#9aa7bd';
      var viewUrl = i.share_token ? (location.origin + location.pathname + '?invoice_view=' + i.share_token) : '';
      var canPay = (i.status === 'pending' || i.status === 'overdue') && viewUrl;
      return '<div style="display:grid;grid-template-columns:1fr 120px 200px;gap:12px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.05);align-items:center">' +
        '<div>' +
          '<div style="font-size:13px;color:#fff;font-weight:700">' + escHtml(i.invoice_number) + '</div>' +
          '<div style="font-size:11px;color:#6b87ad;margin-top:2px">' + escHtml(i.invoice_date||'') + (i.due_date ? ' · Due ' + escHtml(i.due_date) : '') + '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<div style="font-size:14px;color:#00e5c0;font-weight:700">' + usd(i.amount) + '</div>' +
          '<div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:' + color + ';font-weight:700;margin-top:2px">' + (i.status||'') + '</div>' +
        '</div>' +
        '<div style="text-align:right;white-space:nowrap">' +
          '<button onclick="window.glPortalDownloadInvoicePdf(\'' + i.id + '\', event)" style="display:inline-block;background:rgba(124,58,237,.12);border:1px solid rgba(124,58,237,.35);color:#c4b5fd;padding:6px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;margin-right:4px">📥 PDF</button>' +
          (viewUrl ? '<a href="' + viewUrl + '" target="_blank" style="display:inline-block;background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.35);color:#00e5c0;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;text-decoration:none;cursor:pointer">View' + (canPay ? ' / Pay' : '') + '</a>' : '<span style="font-size:10px;color:#6b87ad">no link</span>') +
        '</div>' +
      '</div>';
    }).join('') : '<div style="padding:30px;text-align:center;color:#6b87ad;font-size:13px">No invoices yet.</div>';

    var PR_STAGE_COLOR = { Discovery:'#9aa7bd', Formulation:'#6b9fff', Sample:'#c4b5fd', COA:'#f5c842', Production:'#00e5c0', Ship:'#5fcf9e' };
    // Parse a Postgres `date` column (YYYY-MM-DD) as a LOCAL date — not UTC.
    // `new Date("2026-05-20")` interprets the string as UTC midnight, which
    // then renders as the PREVIOUS DAY in any timezone west of UTC (caught
    // during Playwright runtime audit — Mike in FL saw a 2026-05-20 run
    // displayed as "5/19/2026"). Forcing the timezone-naive parse here.
    function fmtLocalDate(s){
      if(!s) return '';
      var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
      if(m) return new Date(+m[1], +m[2]-1, +m[3]).toLocaleDateString();
      return new Date(s).toLocaleDateString();
    }
    var prRowsHtml = prs.length ? prs.map(function(p){
      var color = PR_STAGE_COLOR[p.stage] || '#9aa7bd';
      // Prefer the new start/end columns; fall back to legacy scheduled_date.
      var startDate = p.scheduled_start_date || p.scheduled_date;
      var endDate   = p.scheduled_end_date;
      var dateLbl   = 'TBD';
      if(startDate){
        var s = fmtLocalDate(startDate);
        if(endDate && endDate !== startDate){
          dateLbl = s + ' → ' + fmtLocalDate(endDate);
        } else {
          dateLbl = s;
        }
      }
      var meta = [];
      if(p.format) meta.push(escHtml(p.format));
      if(p.cases) meta.push(escHtml(String(p.cases)) + ' cases');
      if(p.lot_number) meta.push('Lot ' + escHtml(p.lot_number));
      return '<div style="display:grid;grid-template-columns:1fr 130px 120px;gap:12px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.05);align-items:center">' +
        '<div>' +
          '<div style="font-size:13px;color:#fff;font-weight:700">' + escHtml(p.run_name || 'Run') + '</div>' +
          (meta.length ? '<div style="font-size:11px;color:#6b87ad;margin-top:2px">' + meta.join(' · ') + '</div>' : '') +
        '</div>' +
        '<div style="text-align:right;font-size:12px;color:#9aa7bd">' + dateLbl + '</div>' +
        '<div style="text-align:right">' +
          '<span style="display:inline-block;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:' + color + ';font-weight:700;background:rgba(255,255,255,.04);border:1px solid ' + color + '33;padding:3px 8px;border-radius:4px">' + escHtml(p.stage || '') + '</span>' +
        '</div>' +
      '</div>';
    }).join('') : '<div style="padding:20px;text-align:center;color:#6b87ad;font-size:12px">No production runs scheduled.</div>';

    var SH_STATUS_COLOR = { prepping:'#f5c842', shipped:'#6b9fff', delivered:'#5fcf9e', followup_sent:'#c4b5fd', dead:'#9aa7bd' };
    function carrierTrackLink(carrier, tracking){
      if(!tracking) return '';
      var t = String(tracking).trim();
      var url = '';
      var c = (carrier||'').toLowerCase();
      if(c.indexOf('ups') >= 0) url = 'https://www.ups.com/track?tracknum=' + encodeURIComponent(t);
      else if(c.indexOf('fedex') >= 0) url = 'https://www.fedex.com/fedextrack/?trknbr=' + encodeURIComponent(t);
      else if(c.indexOf('usps') >= 0) url = 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + encodeURIComponent(t);
      else if(c.indexOf('dhl') >= 0) url = 'https://www.dhl.com/en/express/tracking.html?AWB=' + encodeURIComponent(t);
      if(!url) return '<span style="font-size:11px;color:#9aa7bd">' + escHtml(t) + '</span>';
      return '<a href="' + url + '" target="_blank" style="font-size:11px;color:#00e5c0;text-decoration:underline">' + escHtml(t) + '</a>';
    }
    var shRowsHtml = shs.length ? shs.map(function(s){
      var color = SH_STATUS_COLOR[s.status] || '#9aa7bd';
      var dateLbl = s.shipped_date ? fmtLocalDate(s.shipped_date) : '—';
      var meta = [];
      if(s.kind) meta.push(escHtml(s.kind));
      if(s.qty) meta.push(escHtml(String(s.qty)) + ' unit' + (s.qty===1?'':'s'));
      if(s.carrier) meta.push(escHtml(s.carrier));
      return '<div style="display:grid;grid-template-columns:1fr 130px 110px;gap:12px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.05);align-items:center">' +
        '<div>' +
          '<div style="font-size:13px;color:#fff;font-weight:700">' + (meta.length ? meta.join(' · ') : 'Shipment') + '</div>' +
          (s.tracking ? '<div style="margin-top:3px">' + carrierTrackLink(s.carrier, s.tracking) + '</div>' : '') +
        '</div>' +
        '<div style="text-align:right;font-size:12px;color:#9aa7bd">' + dateLbl + '</div>' +
        '<div style="text-align:right">' +
          '<span style="display:inline-block;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:' + color + ';font-weight:700;background:rgba(255,255,255,.04);border:1px solid ' + color + '33;padding:3px 8px;border-radius:4px">' + escHtml(s.status || '') + '</span>' +
        '</div>' +
      '</div>';
    }).join('') : '<div style="padding:20px;text-align:center;color:#6b87ad;font-size:12px">No sample shipments yet.</div>';

    var FM_STATUS_COLOR = { benchtop:'#f5c842', approved:'#5fcf9e', archived:'#9aa7bd' };
    var fmRowsHtml = fms.length ? fms.map(function(f){
      var color = FM_STATUS_COLOR[f.status] || '#9aa7bd';
      var meta = [];
      if(f.batch_size_gal) meta.push(escHtml(String(f.batch_size_gal)) + ' gal batch');
      if(f.target_yield_cases) meta.push(escHtml(String(f.target_yield_cases)) + ' case target');
      var allergList = (f.allergens && f.allergens.length) ? f.allergens.join(', ') : '';
      return '<div style="display:grid;grid-template-columns:1fr 130px 110px;gap:12px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.05);align-items:center">' +
        '<div>' +
          '<div style="font-size:13px;color:#fff;font-weight:700">' + escHtml(f.name || 'Formula') + ' <span style="font-size:11px;color:#6b87ad;font-weight:500">v' + escHtml(String(f.version||1)) + '</span></div>' +
          (meta.length ? '<div style="font-size:11px;color:#6b87ad;margin-top:2px">' + meta.join(' · ') + '</div>' : '') +
          (allergList ? '<div style="font-size:10px;color:#f5c842;margin-top:2px">Allergens: ' + escHtml(allergList) + '</div>' : '') +
        '</div>' +
        '<div style="text-align:right;font-size:11px;color:#9aa7bd">Updated ' + new Date(f.updated_at).toLocaleDateString() + '</div>' +
        '<div style="text-align:right">' +
          '<span style="display:inline-block;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:' + color + ';font-weight:700;background:rgba(255,255,255,.04);border:1px solid ' + color + '33;padding:3px 8px;border-radius:4px">' + escHtml(f.status || '') + '</span>' +
        '</div>' +
      '</div>';
    }).join('') : '<div style="padding:20px;text-align:center;color:#6b87ad;font-size:12px">No formulas on file.</div>';

    var DOC_TYPE_LBL = { coa:'COA', spec_sheet:'Spec sheet', allergen:'Allergen statement', kosher:'Kosher cert', organic:'Organic cert', nutrition:'Nutrition / NFP', other:'Document' };
    var DOC_TYPE_COLOR = { coa:'#5fcf9e', spec_sheet:'#6b9fff', allergen:'#c4b5fd', kosher:'#f5c842', organic:'#5fcf9e', nutrition:'#7fc6f5', other:'#9aa7bd' };
    function fmtBytesPortal(n){ if(!n) return ''; if(n<1024) return n+' B'; if(n<1024*1024) return (n/1024).toFixed(0)+' KB'; return (n/1024/1024).toFixed(1)+' MB'; }
    var ldRowsHtml = lds.length ? lds.map(function(d){
      var color = DOC_TYPE_COLOR[d.document_type] || '#9aa7bd';
      var typeLbl = DOC_TYPE_LBL[d.document_type] || 'Document';
      var meta = [];
      if(d.lot_number) meta.push('Lot ' + escHtml(d.lot_number));
      if(d.file_size)  meta.push(fmtBytesPortal(d.file_size));
      if(d.uploaded_at) meta.push(new Date(d.uploaded_at).toLocaleDateString());
      return '<div style="display:grid;grid-template-columns:1fr 120px 100px;gap:12px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.05);align-items:center">' +
        '<div>' +
          '<div style="font-size:13px;color:#fff;font-weight:600">' + escHtml(d.title || d.file_name || 'Document') + '</div>' +
          (meta.length ? '<div style="font-size:11px;color:#6b87ad;margin-top:2px">' + meta.join(' · ') + '</div>' : '') +
        '</div>' +
        '<div style="text-align:right">' +
          '<span style="display:inline-block;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:' + color + ';font-weight:700;background:rgba(255,255,255,.04);border:1px solid ' + color + '33;padding:3px 8px;border-radius:4px">' + escHtml(typeLbl) + '</span>' +
        '</div>' +
        '<div style="text-align:right">' +
          '<button onclick="window.glPortalDownloadLotDoc(\'' + d.id + '\', event)" style="background:rgba(124,58,237,.12);border:1px solid rgba(124,58,237,.35);color:#c4b5fd;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">⬇ Download</button>' +
        '</div>' +
      '</div>';
    }).join('') : '<div style="padding:20px;text-align:center;color:#6b87ad;font-size:12px">No documents on file yet. Your account manager will upload COAs and spec sheets here as they\'re produced.</div>';

    // Cache the file paths keyed by doc id so the download handler can use them
    window._glPortalLotDocs = {};
    lds.forEach(function(d){ window._glPortalLotDocs[d.id] = d; });
    window.glPortalDownloadLotDoc = async function(docId, ev){
      if(ev && ev.preventDefault) ev.preventDefault();
      var doc = window._glPortalLotDocs && window._glPortalLotDocs[docId];
      if(!doc){ alert('Document not found'); return; }
      var su = await sb.storage.from('client-docs').createSignedUrl(doc.file_path, 60);
      if(su.error || !su.data){ alert('Download link failed: ' + (su.error && su.error.message || 'unknown')); return; }
      window.open(su.data.signedUrl, '_blank', 'noopener');
    };

    var algRowsHtml = algs.length ? algs.map(function(a){
      var url = a.share_token ? (location.origin + location.pathname + '?allergen_decl=' + a.share_token) : '';
      return '<div style="display:grid;grid-template-columns:1fr 120px;gap:12px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.05);align-items:center">' +
        '<div>' +
          '<div style="font-size:13px;color:#fff;font-weight:600">' + escHtml(a.product_name) + '</div>' +
          '<div style="font-size:11px;color:#6b87ad;margin-top:2px">Declared ' + new Date(a.declared_at).toLocaleDateString() + '</div>' +
        '</div>' +
        '<div style="text-align:right">' + (url ? '<a href="' + url + '" target="_blank" style="display:inline-block;background:rgba(124,58,237,.12);border:1px solid rgba(124,58,237,.35);color:#c4b5fd;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:700;text-decoration:none">View</a>' : '<span style="font-size:10px;color:#6b87ad">no link</span>') + '</div>' +
      '</div>';
    }).join('') : '<div style="padding:20px;text-align:center;color:#6b87ad;font-size:12px">No declarations on file.</div>';

    document.getElementById('gl-cp').innerHTML =
      '<div style="background:#0a1628;min-height:100vh;color:#eef4ff;font-family:Arial,Helvetica,sans-serif">' +
        '<div style="background:#142238;border-bottom:3px solid #00e5c0;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
          '<div>' +
            '<div style="font-size:18px;font-weight:900;color:#00e5c0;letter-spacing:2px">GOOD LIQUID BEV CO</div>' +
            '<div style="font-size:10px;color:#6b87ad;letter-spacing:1px;text-transform:uppercase">Customer Portal</div>' +
          '</div>' +
          '<div style="text-align:right">' +
            '<div style="font-size:13px;color:#fff;font-weight:600">' + escHtml(client.name || customer.email) + '</div>' +
            '<div style="margin-top:2px;display:flex;justify-content:flex-end;gap:14px">' +
              '<button id="cp-account" style="background:none;border:0;color:#6b87ad;font-size:11px;cursor:pointer;text-decoration:underline">Account settings</button>' +
              '<button id="cp-signout" style="background:none;border:0;color:#6b87ad;font-size:11px;cursor:pointer;text-decoration:underline">Sign out</button>' +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div style="max-width:960px;margin:0 auto;padding:24px">' +
          // KPI tiles
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:24px">' +
            kpi('Open balance',     usd(pendingTotal), openInvoiceCount + ' invoice' + (openInvoiceCount===1?'':'s') + ' open', '#f5c842') +
            kpi('Paid to date',     usd(paidTotal),    invs.filter(function(i){return i.status==='paid';}).length + ' paid',     '#5fcf9e') +
            kpi('Total invoices',   String(invs.length), 'across all time',                                               '#00e5c0') +
          '</div>' +

          // Quick-action tiles for portal-submitted requests.
          '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;margin-bottom:24px">' +
            requestTile('🧪', 'sample',   'Request samples',    'Ask for new product samples') +
            requestTile('📦', 'reorder',  'Place an order',     'Reorder a previous run') +
            requestTile('💬', 'quote',    'Request a quote',    'Pricing on a new project') +
            requestTile('❓', 'question', 'Ask a question',     'General question for Mike') +
          '</div>' +

          '<div style="background:#142238;border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden;margin-bottom:24px">' +
            '<div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;letter-spacing:2px;color:#00e5c0;font-weight:700">YOUR INVOICES</div>' +
            invRowsHtml +
          '</div>' +

          '<div style="background:#142238;border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden;margin-bottom:24px">' +
            '<div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;letter-spacing:2px;color:#6b9fff;font-weight:700">PRODUCTION RUNS</div>' +
            prRowsHtml +
          '</div>' +

          '<div style="background:#142238;border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden;margin-bottom:24px">' +
            '<div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;letter-spacing:2px;color:#f5c842;font-weight:700">SAMPLE SHIPMENTS</div>' +
            shRowsHtml +
          '</div>' +

          '<div style="background:#142238;border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden;margin-bottom:24px">' +
            '<div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;letter-spacing:2px;color:#5fcf9e;font-weight:700">FORMULAS</div>' +
            fmRowsHtml +
          '</div>' +

          '<div style="background:#142238;border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden;margin-bottom:24px">' +
            '<div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;letter-spacing:2px;color:#7fc6f5;font-weight:700">📎 COAs & DOCUMENTS</div>' +
            ldRowsHtml +
          '</div>' +

          (algs.length ? '<div style="background:#142238;border:1px solid rgba(255,255,255,.06);border-radius:12px;overflow:hidden;margin-bottom:24px">' +
            '<div style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06);font-size:12px;letter-spacing:2px;color:#c4b5fd;font-weight:700">ALLERGEN DECLARATIONS</div>' +
            algRowsHtml +
          '</div>' : '') +

          '<div style="padding:14px 18px;font-size:11px;color:#6b87ad;text-align:center">' +
            'Questions about your account? Email <a href="mailto:Mike@GoodLiquid.com" style="color:#00e5c0">Mike@GoodLiquid.com</a> or call (803) 493-5065.' +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById('cp-signout').onclick = async function(){
      await sb.auth.signOut();
      location.reload();
    };
    document.getElementById('cp-account').onclick = function(){
      openAccountSettings(client, customer);
    };
  }

  // ────────────────────────────────────────────────────────────
  // Account Settings overlay — contact info, billing/shipping
  // address, delivery prefs, change password.
  // ────────────────────────────────────────────────────────────
  function openAccountSettings(client, customer){
    var existing = document.getElementById('gl-account-modal');
    if(existing) existing.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-account-modal';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1100;background:rgba(6,13,26,.94);backdrop-filter:blur(10px);overflow-y:auto;padding:24px;font-family:Arial,Helvetica,sans-serif;color:#eef4ff');
    var addEmails = '';
    if(Array.isArray(client.additional_emails)) addEmails = client.additional_emails.join(', ');
    else if(client.additional_emails && typeof client.additional_emails === 'string'){
      try { var arr = JSON.parse(client.additional_emails); if(Array.isArray(arr)) addEmails = arr.join(', '); }
      catch(e){ addEmails = client.additional_emails; }
    }
    function fld(id, label, val, type, placeholder){
      type = type || 'text';
      // Force autocomplete="new-password" on any password input rendered by
      // this helper. The Account Settings modal uses it ONLY for the
      // "change password" + "confirm password" fields (no sign-in form
      // routes through here). Without this hint, Chrome / 1Password /
      // Edge silently autofill the user's SAVED LOGIN password into the
      // "New password" field — caught during the Playwright runtime
      // audit on 2026-05-21, where the modal opened with a 9-character
      // password already in place. If the user clicked Save without
      // noticing, they would have silently set their password to
      // whatever the browser had remembered. autocomplete="new-password"
      // tells autofill systems "this is a brand-new password being
      // created" and they leave it alone.
      var extra = '';
      if(type === 'password') extra = ' autocomplete="new-password"';
      return '<div style="margin-bottom:12px">' +
        '<div style="font-size:10px;letter-spacing:1.5px;color:#6b87ad;margin-bottom:4px;text-transform:uppercase">' + escHtml(label) + '</div>' +
        '<input id="' + id + '" type="' + type + '"' + extra + ' value="' + escHtml(val||'') + '" placeholder="' + escHtml(placeholder||'') + '" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#eef4ff;font-size:13px;box-sizing:border-box">' +
      '</div>';
    }
    function chk(id, label, val){
      return '<label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#eef4ff;cursor:pointer;padding:6px 0">' +
        '<input id="' + id + '" type="checkbox"' + (val ? ' checked' : '') + ' style="margin:0">' +
        '<span>' + escHtml(label) + '</span>' +
      '</label>';
    }
    function sectionHdr(text, color){
      return '<div style="font-size:12px;letter-spacing:2px;color:' + color + ';font-weight:700;margin:18px 0 12px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,.08)">' + text + '</div>';
    }
    ov.innerHTML =
      '<div style="max-width:680px;margin:0 auto;background:#142238;border:1px solid rgba(0,229,192,.2);border-radius:14px;padding:28px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<div style="font-size:18px;font-weight:900;color:#00e5c0;letter-spacing:2px">ACCOUNT SETTINGS</div>' +
          '<button id="acct-close" style="background:none;border:0;color:#6b87ad;font-size:22px;cursor:pointer;line-height:1">×</button>' +
        '</div>' +
        '<div style="font-size:12px;color:#6b87ad;margin-bottom:8px">Brand: <span style="color:#fff;font-weight:700">' + escHtml(client.name || '') + '</span> (contact your account manager to change)</div>' +

        sectionHdr('CONTACT INFO', '#00e5c0') +
        fld('acct-contact-name', 'Contact name',    client.contact_name) +
        fld('acct-contact-type', 'Role / title',    client.contact_type, 'text', 'e.g. Founder, AP') +
        fld('acct-email',        'Primary email',   client.email,        'email') +
        fld('acct-phone',        'Phone',           client.phone,        'tel') +
        fld('acct-add-emails',   'Additional emails (comma-separated, cc on invoices)', addEmails, 'text', 'billing@..., ap@...') +

        sectionHdr('BILLING ADDRESS', '#6b9fff') +
        fld('acct-street', 'Street',   client.street) +
        '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px">' +
          fld('acct-city',  'City',  client.city) +
          fld('acct-state', 'State', client.state) +
          fld('acct-zip',   'Zip',   client.zip) +
        '</div>' +

        sectionHdr('SHIPPING ADDRESS', '#c4b5fd') +
        chk('acct-ship-same', 'Same as billing address', client.shipping_same !== false) +
        '<div id="acct-ship-block" style="' + (client.shipping_same === false ? '' : 'display:none') + ';margin-top:10px">' +
          fld('acct-ship-street', 'Street',   client.shipping_street) +
          '<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px">' +
            fld('acct-ship-city',  'City',  client.shipping_city) +
            fld('acct-ship-state', 'State', client.shipping_state) +
            fld('acct-ship-zip',   'Zip',   client.shipping_zip) +
          '</div>' +
        '</div>' +

        sectionHdr('DELIVERY PREFERENCES', '#f5c842') +
        chk('acct-lift-gate', 'Lift gate required for delivery', !!client.lift_gate) +
        fld('acct-dock-hours', 'Receiving hours', client.dock_hours, 'text', 'e.g. Mon–Fri 8a–4p') +

        sectionHdr('NOTIFICATIONS', '#c4b5fd') +
        '<label style="display:flex;align-items:flex-start;gap:10px;font-size:13px;color:#eef4ff;cursor:pointer;padding:8px 10px;background:rgba(124,58,237,.05);border:1px solid rgba(124,58,237,.2);border-radius:6px;line-height:1.45">' +
          '<input type="checkbox" id="acct-notify-stage"' + (customer.notify_run_stage_changes === false ? '' : ' checked') + ' style="margin-top:1px;width:15px;height:15px;cursor:pointer;flex-shrink:0;accent-color:#c4b5fd">' +
          '<span>🏭 <b>Production stage emails</b> — get an email each time my run advances between kanban stages (Discovery → Formulation → Sample → COA → Production → Ship). <span style="color:#6b87ad;font-size:11px">Uncheck to opt out.</span></span>' +
        '</label>' +

        sectionHdr('TEAMMATES', '#7fc6f5') +
        '<div style="font-size:11px;color:#6b87ad;margin-bottom:10px;line-height:1.5">' +
          (customer.role === 'owner'
            ? 'Add your AP, ops, or buyer so they can sign into the same portal. They\'ll get a password-reset email at the address you enter.'
            : '<i>Only the brand owner can invite teammates. Ask them to add you instead.</i>') +
        '</div>' +
        '<div id="acct-teammates-list" style="font-size:12px;color:#9aa7bd;margin-bottom:10px">Loading…</div>' +
        (customer.role === 'owner' ? (
          '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end">' +
            '<div><div style="font-size:10px;letter-spacing:1.5px;color:#6b87ad;margin-bottom:4px;text-transform:uppercase">Email</div>' +
              '<input id="acct-mate-email" type="email" placeholder="ap@brand.com" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#eef4ff;font-size:13px;box-sizing:border-box"></div>' +
            '<div><div style="font-size:10px;letter-spacing:1.5px;color:#6b87ad;margin-bottom:4px;text-transform:uppercase">Display name <span style="opacity:.6;text-transform:none">(optional)</span></div>' +
              '<input id="acct-mate-name" type="text" placeholder="Jordan Lee" style="width:100%;padding:9px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#eef4ff;font-size:13px;box-sizing:border-box"></div>' +
            '<button id="acct-mate-invite" style="background:#00e5c0;border:0;color:#0a1628;padding:9px 16px;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer;white-space:nowrap">+ Invite</button>' +
          '</div>'
        ) : '') +
        '<div id="acct-mate-msg" style="display:none;margin-top:10px;padding:9px 11px;border-radius:6px;font-size:12px"></div>' +

        sectionHdr('CHANGE PASSWORD', '#5fcf9e') +
        '<div style="font-size:11px;color:#6b87ad;margin-bottom:8px">Leave blank to keep your current password.</div>' +
        fld('acct-new-pw',     'New password',     '', 'password', 'Min 6 characters') +
        fld('acct-confirm-pw', 'Confirm password', '', 'password', '') +

        '<div id="acct-msg" style="display:none;margin:14px 0;padding:10px 12px;border-radius:6px;font-size:12px"></div>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;padding-top:18px;border-top:1px solid rgba(255,255,255,.08)">' +
          '<button id="acct-cancel" style="background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:#eef4ff;padding:10px 18px;border-radius:6px;font-size:13px;cursor:pointer">Cancel</button>' +
          '<button id="acct-save" style="background:#00e5c0;border:0;color:#0a1628;padding:10px 22px;border-radius:6px;font-size:13px;font-weight:800;cursor:pointer">Save changes</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);

    var sb = getSB();
    function msg(text, kind){
      var el = document.getElementById('acct-msg');
      el.style.display = 'block';
      el.textContent = text;
      if(kind === 'err'){ el.style.background = 'rgba(231,76,60,.12)'; el.style.border = '1px solid rgba(231,76,60,.35)'; el.style.color = '#ff8579'; }
      else { el.style.background = 'rgba(95,207,158,.12)'; el.style.border = '1px solid rgba(95,207,158,.35)'; el.style.color = '#5fcf9e'; }
    }
    function val(id){ var e = document.getElementById(id); return e ? (e.value||'').trim() : ''; }
    function chkv(id){ var e = document.getElementById(id); return !!(e && e.checked); }

    document.getElementById('acct-close').onclick  = function(){ ov.remove(); };
    document.getElementById('acct-cancel').onclick = function(){ ov.remove(); };
    document.getElementById('acct-ship-same').onchange = function(){
      document.getElementById('acct-ship-block').style.display = this.checked ? 'none' : 'block';
    };

    // ── Teammates: load + invite + remove ──────────────────────────
    function mateMsg(text, kind){
      var el = document.getElementById('acct-mate-msg'); if(!el) return;
      el.style.display = 'block'; el.textContent = text;
      if(kind === 'err'){ el.style.background='rgba(231,76,60,.12)'; el.style.border='1px solid rgba(231,76,60,.35)'; el.style.color='#ff8579'; }
      else { el.style.background='rgba(95,207,158,.12)'; el.style.border='1px solid rgba(95,207,158,.35)'; el.style.color='#5fcf9e'; }
    }
    async function loadTeammates(){
      var listEl = document.getElementById('acct-teammates-list'); if(!listEl) return;
      listEl.innerHTML = 'Loading…';
      var r = await sb.from('customer_users')
        .select('id, email, display_name, role, active, last_login, invited_at, auth_user_id')
        .eq('client_id', customer.client_id)
        .order('invited_at', { ascending: true });
      if(r.error){ listEl.innerHTML = '<span style="color:#ff8579">Failed to load teammates: ' + escHtml(r.error.message) + '</span>'; return; }
      var rows = (r.data || []).filter(function(x){ return x.active !== false; });
      if(!rows.length){ listEl.innerHTML = '<span style="color:#6b87ad;font-style:italic">No teammates yet — you\'re the only one with portal access.</span>'; return; }
      listEl.innerHTML = rows.map(function(u){
        var isYou  = u.auth_user_id && (u.id === customer.id);
        var isOwn  = (u.role === 'owner');
        var lastIn = u.last_login ? new Date(u.last_login).toLocaleDateString() : 'never';
        var canRm  = (customer.role === 'owner') && !isYou && !isOwn;
        return '<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:6px;margin-bottom:6px">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="color:#fff;font-size:13px;font-weight:600">' + escHtml(u.display_name || u.email) +
              (isYou ? ' <span style="color:#00e5c0;font-size:10px;letter-spacing:1px;margin-left:6px">YOU</span>' : '') +
              '<span style="margin-left:8px;font-size:9px;letter-spacing:1.5px;padding:2px 6px;border-radius:3px;background:' + (isOwn?'rgba(0,229,192,.14)':'rgba(127,198,245,.14)') + ';color:' + (isOwn?'#00e5c0':'#7fc6f5') + '">' + (isOwn?'OWNER':'MEMBER') + '</span>' +
            '</div>' +
            (u.display_name ? '<div style="color:#6b87ad;font-size:11px;margin-top:2px">' + escHtml(u.email) + '</div>' : '') +
            '<div style="color:#6b87ad;font-size:10px;margin-top:2px">Last sign-in: ' + escHtml(lastIn) + '</div>' +
          '</div>' +
          (canRm
            ? '<button data-mate-rm="' + escHtml(u.id) + '" style="background:rgba(231,76,60,.12);border:1px solid rgba(231,76,60,.35);color:#ff8579;font-size:11px;padding:5px 10px;border-radius:4px;cursor:pointer">Remove</button>'
            : '') +
        '</div>';
      }).join('');
      // Wire remove buttons
      Array.prototype.forEach.call(listEl.querySelectorAll('[data-mate-rm]'), function(btn){
        btn.onclick = async function(){
          var id = btn.getAttribute('data-mate-rm');
          if(!confirm('Remove this teammate? They will lose portal access immediately.')) return;
          btn.disabled = true; btn.textContent = '…';
          var rr = await sb.rpc('portal_remove_teammate', { p_customer_user_id: id });
          if(rr.error){ mateMsg('Remove failed: ' + rr.error.message, 'err'); btn.disabled = false; btn.textContent = 'Remove'; return; }
          if(rr.data && rr.data.ok === false){ mateMsg('Remove failed: ' + (rr.data.error||'unknown'), 'err'); btn.disabled = false; btn.textContent = 'Remove'; return; }
          mateMsg('Teammate removed.', 'ok');
          loadTeammates();
        };
      });
    }
    loadTeammates();

    var inviteBtn = document.getElementById('acct-mate-invite');
    if(inviteBtn){
      inviteBtn.onclick = async function(){
        var email = (val('acct-mate-email') || '').toLowerCase();
        var name  = val('acct-mate-name');
        if(!email || email.indexOf('@') < 0){ mateMsg('Enter a valid email.', 'err'); return; }
        var btn = this; var origTxt = btn.textContent;
        btn.disabled = true; btn.textContent = 'Inviting…';
        try {
          // Try the RPC first (handles the case where the auth user already exists).
          var first = await sb.rpc('portal_invite_teammate', { p_email: email, p_display_name: name || null });
          if(first.error){ mateMsg('Invite failed: ' + first.error.message, 'err'); return; }
          if(first.data && first.data.ok){
            mateMsg('✓ ' + (first.data.action === 'reactivated' ? 'Teammate reactivated.' : 'Teammate added.') + ' Sending sign-in email…', 'ok');
            await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + '?portal=1' });
            document.getElementById('acct-mate-email').value = '';
            document.getElementById('acct-mate-name').value = '';
            loadTeammates();
            return;
          }
          // Need to create the auth user first, then re-call the RPC.
          if(first.data && first.data.error === 'auth_user_not_found'){
            var tempPw = 'GL!' + Math.random().toString(36).slice(2,12) + 'aZ1';
            var su = await sb.auth.signUp({ email: email, password: tempPw, options: { emailRedirectTo: location.origin + location.pathname + '?portal=1' } });
            if(su.error && !/already (registered|exists)|user_already_exists/i.test(su.error.message||'')){
              mateMsg('Sign-up failed: ' + su.error.message, 'err'); return;
            }
            var second = await sb.rpc('portal_invite_teammate', { p_email: email, p_display_name: name || null });
            if(second.error || (second.data && second.data.ok === false)){
              mateMsg('Invite failed: ' + (second.error ? second.error.message : second.data.error), 'err'); return;
            }
            mateMsg('✓ Teammate added. Sending sign-in email…', 'ok');
            await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname + '?portal=1' });
            document.getElementById('acct-mate-email').value = '';
            document.getElementById('acct-mate-name').value = '';
            loadTeammates();
            return;
          }
          mateMsg('Invite failed: ' + (first.data && first.data.error || 'unknown'), 'err');
        } finally {
          btn.disabled = false; btn.textContent = origTxt;
        }
      };
    }

    document.getElementById('acct-save').onclick = async function(){
      var btn = this; var orig = btn.textContent;
      var newPw = val('acct-new-pw');
      var confirmPw = val('acct-confirm-pw');
      if(newPw){
        var _pwErr = (window.glValidatePassword ? window.glValidatePassword(newPw) : (newPw.length < 8 ? 'New password must be at least 8 characters.' : null));
        if(_pwErr){ msg(_pwErr, 'err'); return; }
        if(newPw !== confirmPw){ msg('New passwords do not match.', 'err'); return; }
      }
      btn.disabled = true; btn.textContent = 'Saving…';

      // 1) Update account fields via RPC (server-side allow-list)
      var addEmailsArr = val('acct-add-emails')
        .split(/[\s,;]+/).map(function(s){return s.trim();}).filter(function(s){return s && s.indexOf('@') > 0;});
      var shipSame = chkv('acct-ship-same');
      var args = {
        p_contact_name:      val('acct-contact-name'),
        p_contact_type:      val('acct-contact-type'),
        p_email:             val('acct-email'),
        p_phone:             val('acct-phone'),
        p_additional_emails: addEmailsArr,
        p_street:            val('acct-street'),
        p_city:              val('acct-city'),
        p_state:             val('acct-state'),
        p_zip:               val('acct-zip'),
        p_shipping_same:     shipSame,
        p_shipping_street:   shipSame ? null : val('acct-ship-street'),
        p_shipping_city:     shipSame ? null : val('acct-ship-city'),
        p_shipping_state:    shipSame ? null : val('acct-ship-state'),
        p_shipping_zip:      shipSame ? null : val('acct-ship-zip'),
        p_lift_gate:         chkv('acct-lift-gate'),
        p_dock_hours:        val('acct-dock-hours')
      };
      var r = await sb.rpc('update_customer_account', args);
      if(r.error){ msg('Save failed: ' + r.error.message, 'err'); btn.disabled = false; btn.textContent = orig; return; }
      if(r.data && r.data.ok === false){ msg('Save failed: ' + (r.data.error||'unknown'), 'err'); btn.disabled = false; btn.textContent = orig; return; }

      // 1b) Notification preferences — flips customer_users.notify_run_stage_changes
      // via a dedicated SECURITY DEFINER RPC since the customer can't update
      // their own customer_users row directly under the current RLS policies.
      var notifyOn = chkv('acct-notify-stage');
      var nr = await sb.rpc('portal_update_my_notify', { p_notify_run_stage_changes: notifyOn });
      if(nr.error){ console.warn('[GL portal] notify update failed', nr.error); }

      // 2) Update password if provided
      if(newPw){
        var pwRes = await sb.auth.updateUser({ password: newPw });
        if(pwRes.error){ msg('Account saved but password update failed: ' + pwRes.error.message, 'err'); btn.disabled = false; btn.textContent = orig; return; }
      }

      msg(newPw ? 'Account and password updated.' : 'Account updated.', 'ok');
      btn.textContent = 'Saved ✓';
      setTimeout(function(){
        ov.remove();
        // Re-render dashboard with fresh data
        if(typeof window.glCheckPortal === 'function') window.glCheckPortal();
      }, 900);
    };
  }
  function kpi(label, value, sub, color){
    return '<div style="background:#142238;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:16px 18px">' +
      '<div style="font-size:10px;letter-spacing:2px;color:#6b87ad;text-transform:uppercase">' + escHtml(label) + '</div>' +
      '<div style="font-size:24px;font-weight:900;color:' + color + ';margin-top:4px">' + escHtml(value) + '</div>' +
      '<div style="font-size:11px;color:#6b87ad;margin-top:2px">' + escHtml(sub) + '</div>' +
    '</div>';
  }

  // Expose so the global password-recovery modal can re-enter the portal
  // flow after a customer sets their password. The companion helper clears
  // the recovery hint/event flags first so checkPortalMode skips its
  // "Setting up password reset…" branch (the recovery is now done) and
  // renders the dashboard for the freshly-authenticated session.
  window.glCheckPortal = checkPortalMode;
  window.glClearRecoveryFlags = function(){
    _recoveryHint = false;
    _recoveryEventSeen = false;
  };

  // Boot — only when ?portal is on the URL
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ checkPortalMode(); });
  } else {
    checkPortalMode();
  }

  // ────────────────────────────────────────────────────────────
  // ADMIN: + Customer login button on the client detail overlay
  // ────────────────────────────────────────────────────────────
  window.glInviteCustomerLogin = async function(clientId, clientName, preEmail){
    if(!clientId){ alert('No client id'); return; }
    var sb = getSB(); if(!sb){ alert('Supabase not ready'); return; }
    var email = (preEmail && String(preEmail).trim()) || prompt('Customer email to invite for ' + (clientName||'this client') + ':');
    if(!email) return;
    email = String(email).trim().toLowerCase();
    if(email.indexOf('@') < 0){ alert('Not a valid email'); return; }
    var redirectTo = location.origin + location.pathname + '?portal=1';
    // 1) Create auth user (idempotent — already-exists is fine, means they were invited before).
    var tempPw = 'GL!' + Math.random().toString(36).slice(2,12) + 'aZ1';
    var su = await sb.auth.signUp({ email: email, password: tempPw, options: { emailRedirectTo: redirectTo } });
    var userId = (su.data && su.data.user && su.data.user.id) || null;
    if(su.error && !/already (registered|exists)|user_already_exists/i.test(su.error.message||'')){
      alert('Sign up failed: ' + su.error.message); return;
    }
    // 2) Link auth user → client via SECURITY DEFINER RPC.
    //    Works for both brand-new signups AND already-existing auth users
    //    (where signUp returns success without a user object so we can't
    //    insert customer_users directly from the browser).
    var linkRes = await sb.rpc('link_customer_user_by_email', { p_client_id: clientId, p_email: email });
    if(linkRes.error){
      console.warn('[invite-portal] link RPC:', linkRes.error);
      alert('Linking failed: ' + linkRes.error.message + '\n\nThe auth user may not be visible yet. Try again in a moment.');
      return;
    }
    if(linkRes.data && linkRes.data.ok === false){
      alert('Linking failed: ' + (linkRes.data.error || 'unknown') + '\n\nThe customer was created but not yet linked to a client — invite again.');
      return;
    }
    // 3) Send a password-reset email — goes through SMTP reliably and gives the
    //    customer a one-click flow to set their password and land on the portal.
    var pr = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
    if(pr.error){ alert('Email failed to send: ' + pr.error.message); return; }
    alert('Invite sent to ' + email + '.\n\nThey will receive an email to set their password, then can sign in at ' + redirectTo);
  };
  // Inject the button on the client detail overlay action row
  (function watchClientDetail(){
    var mo = new MutationObserver(function(){
      var ov = document.getElementById('client-detail-overlay');
      if(!ov || ov.querySelector('.gl-cd-portal')) return;
      var btns = ov.querySelectorAll('button');
      var actionRow = null;
      for(var i=0;i<btns.length;i++){
        if(/Edit Client|AI Health Score|Add Task|Draft Email|Allergen Declaration/.test(btns[i].textContent||'')){
          actionRow = btns[i].parentNode; break;
        }
      }
      if(!actionRow) return;
      var cid = null, cname = '';
      Array.prototype.some.call(actionRow.querySelectorAll('button'), function(b){
        var on = b.getAttribute('onclick') || '';
        var m = on.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if(m){ cid = m[0]; return true; }
        return false;
      });
      if(!cid) return;
      var h = ov.querySelector('h1, h2, h3, .client-name');
      if(h) cname = h.textContent.trim();
      var btn = document.createElement('button');
      btn.className = 'cbtn gl-cd-portal';
      btn.setAttribute('style','background:rgba(26,111,255,.12);border-color:rgba(26,111,255,.35);color:#6b9fff');
      btn.textContent = '🔑 Invite Portal Login';
      btn.onclick = function(){ window.glInviteCustomerLogin(cid, cname); };
      actionRow.appendChild(btn);
    });
    mo.observe(document.body, { childList:true, subtree:true });
  })();

  // ────────────────────────────────────────────────────────────
  // ADMIN: top-of-page Invite Customer Login picker (client dropdown + email)
  // ────────────────────────────────────────────────────────────
  window.glOpenInvitePicker = function(preselectedClientId){
    var existing = document.getElementById('gl-invite-picker');
    if(existing) existing.remove();
    var clients = (window.clients && Array.isArray(window.clients)) ? window.clients.slice() : [];
    clients.sort(function(a,b){ return (a.name||'').localeCompare(b.name||''); });
    var ov = document.createElement('div');
    ov.id = 'gl-invite-picker';
    ov.setAttribute('style','position:fixed;inset:0;z-index:9500;background:rgba(6,13,26,.92);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;padding:20px');
    var opts = ['<option value="">— Pick a client —</option>'].concat(clients.map(function(c){
      var sel = (c.id === preselectedClientId) ? ' selected' : '';
      return '<option value="' + escHtml(c.id) + '"' + sel + '>' + escHtml(c.name || '(no name)') + '</option>';
    })).join('');
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(26,111,255,.35);border-radius:14px;padding:28px;width:100%;max-width:460px">' +
        '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:#6b9fff;margin-bottom:6px">INVITE CUSTOMER LOGIN</div>' +
        '<div style="font-size:12px;color:#9ca3af;margin-bottom:20px;line-height:1.5">Pick a client and enter the customer email. They\'ll get an email with a link to set their password and access their invoices.</div>' +
        '<div style="font-size:11px;letter-spacing:1.5px;color:#6b87ad;margin-bottom:6px">CLIENT</div>' +
        '<select id="gl-ip-client" style="width:100%;padding:11px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#eef4ff;font-size:14px;margin-bottom:14px;box-sizing:border-box">' + opts + '</select>' +
        '<div style="font-size:11px;letter-spacing:1.5px;color:#6b87ad;margin-bottom:6px">CUSTOMER EMAIL</div>' +
        '<input id="gl-ip-email" type="email" placeholder="customer@example.com" style="width:100%;padding:11px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:8px;color:#eef4ff;font-size:14px;margin-bottom:18px;box-sizing:border-box">' +
        '<div id="gl-ip-err" style="display:none;color:#ff8579;font-size:12px;margin-bottom:10px"></div>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end">' +
          '<button id="gl-ip-cancel" class="cbtn" style="background:rgba(255,255,255,.06)">Cancel</button>' +
          '<button id="gl-ip-send" class="cbtn pri">Send invite</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    var selEl = ov.querySelector('#gl-ip-client');
    var emEl  = ov.querySelector('#gl-ip-email');
    var errEl = ov.querySelector('#gl-ip-err');
    var sendBtn = ov.querySelector('#gl-ip-send');
    ov.querySelector('#gl-ip-cancel').onclick = function(){ ov.remove(); };
    setTimeout(function(){ (preselectedClientId ? emEl : selEl).focus(); }, 30);
    function showErr(m){ errEl.style.display='block'; errEl.textContent = m; }
    sendBtn.onclick = async function(){
      errEl.style.display = 'none';
      var cid = selEl.value;
      var em  = (emEl.value||'').trim();
      if(!cid){ showErr('Pick a client.'); return; }
      if(!em || em.indexOf('@') < 0){ showErr('Enter a valid email address.'); return; }
      var cname = (clients.find(function(c){ return c.id === cid; }) || {}).name || '';
      sendBtn.disabled = true; var orig = sendBtn.textContent; sendBtn.textContent = 'Sending…';
      try {
        await window.glInviteCustomerLogin(cid, cname, em);
        ov.remove();
      } catch(e){
        showErr('Failed: ' + (e && e.message ? e.message : 'unknown'));
        sendBtn.disabled = false; sendBtn.textContent = orig;
      }
    };
  };

  console.log('[GL] customer portal loaded — ?portal=1');
}());

/* ============================================================
   CRM: Customer Logins management page — backed by Supabase
   ============================================================
   The original renderCustomerLogins (index.html) reads an
   in-memory `customerLogins` array stored in localStorage —
   it never knew about Supabase. Now that customer_users is the
   real source of truth, this override fetches that table, joins
   to clients for the brand name, and exposes Resend invite /
   Deactivate / Reactivate actions per row.
   ============================================================ */
(function(){
  function getSB(){ return window.supa || null; }
  var esc = window.glEsc;
  function fmtDate(s){ if(!s) return ''; try { return new Date(s).toLocaleDateString(); } catch(e){ return String(s).split('T')[0]; } }
  function fmtDateTime(s){ if(!s) return ''; try { return new Date(s).toLocaleString(); } catch(e){ return String(s); } }

  async function renderFromSupabase(){
    var el = document.getElementById('customer-logins-list');
    if(!el) return;
    var sb = getSB();
    if(!sb){ el.innerHTML = '<div style="color:var(--muted);padding:20px 0">Supabase not ready.</div>'; return; }
    el.innerHTML = '<div style="color:var(--muted);padding:20px 0">Loading…</div>';
    var cuR = await sb.from('customer_users')
      .select('id, auth_user_id, client_id, email, display_name, active, invited_at, last_login, created_at, role')
      .order('invited_at', { ascending: false });
    if(cuR.error){ el.innerHTML = '<div style="color:#ff8579;padding:20px 0">Error: ' + esc(cuR.error.message) + '</div>'; return; }
    var rows = cuR.data || [];
    // Resolve client names in one fetch
    var clientIds = rows.map(function(r){ return r.client_id; }).filter(Boolean);
    var clientMap = {};
    if(clientIds.length){
      var clR = await sb.from('clients').select('id, name').in('id', clientIds);
      (clR.data || []).forEach(function(c){ clientMap[c.id] = c.name || ''; });
    }
    var total = rows.length;
    var loggedIn = rows.filter(function(r){ return !!r.last_login; }).length;
    var active = rows.filter(function(r){ return r.active !== false; }).length;
    var summary =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:18px">' +
        kpi('Invited',   String(total),    'total accounts',       '#00e5c0') +
        kpi('Active',    String(active),   'enabled accounts',     '#5fcf9e') +
        kpi('Signed in', String(loggedIn), 'have logged in once+', '#6b9fff') +
      '</div>';
    if(!rows.length){
      el.innerHTML = summary + '<div style="color:var(--muted);padding:20px 0">No customer portal accounts yet. Click "🔑 Invite Customer Login" on the Clients page to create one.</div>';
      return;
    }
    var body = rows.map(function(r){
      var brand = clientMap[r.client_id] || '(no client)';
      var inactive = r.active === false;
      var lastLogin = r.last_login ? fmtDateTime(r.last_login) : '<span style="color:var(--muted);font-style:italic">never</span>';
      var role = (r.role || 'owner').toLowerCase();
      var roleBadge = '<span style="font-size:9px;letter-spacing:1.5px;padding:2px 7px;border-radius:3px;background:' + (role==='owner'?'rgba(0,229,192,.14)':'rgba(127,198,245,.14)') + ';color:' + (role==='owner'?'#00e5c0':'#7fc6f5') + ';font-weight:700">' + role.toUpperCase() + '</span>';
      return '<tr style="' + (inactive ? 'opacity:.55' : '') + '">' +
        '<td style="font-weight:600">' + esc(brand) + '</td>' +
        '<td style="font-family:var(--ff-mono);font-size:11px">' + esc(r.email) + '</td>' +
        '<td>' + roleBadge + '</td>' +
        '<td style="font-size:11px;color:var(--muted)">' + fmtDate(r.invited_at) + '</td>' +
        '<td style="font-size:11px;color:var(--muted)">' + lastLogin + '</td>' +
        '<td>' + (inactive ? '<span style="font-size:10px;letter-spacing:1px;color:#e74c3c;font-weight:700">DISABLED</span>' : '<span style="font-size:10px;letter-spacing:1px;color:#5fcf9e;font-weight:700">ACTIVE</span>') + '</td>' +
        '<td>' +
          '<button class="cbtn" style="font-size:10px;padding:3px 8px" onclick="window.glCpResendInvite(\'' + r.id + '\',\'' + esc(r.email) + '\')">Resend invite</button> ' +
          (role === 'member'
            ? '<button class="cbtn" style="font-size:10px;padding:3px 8px;color:#00e5c0;border-color:rgba(0,229,192,.35)" onclick="window.glCpSetRole(\'' + r.id + '\',\'owner\')">Make owner</button> '
            : '') +
          (inactive
            ? '<button class="cbtn" style="font-size:10px;padding:3px 8px;color:#5fcf9e" onclick="window.glCpSetActive(\'' + r.id + '\',true)">Reactivate</button>'
            : '<button class="cbtn red" style="font-size:10px;padding:3px 8px" onclick="window.glCpSetActive(\'' + r.id + '\',false)">Deactivate</button>') +
        '</td>' +
      '</tr>';
    }).join('');
    el.innerHTML = summary +
      '<table class="ctbl"><thead><tr>' +
        '<th>Brand</th><th>Email</th><th>Role</th><th>Invited</th><th>Last login</th><th>Status</th><th>Actions</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function kpi(label, value, sub, color){
    return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:12px 14px">' +
      '<div style="font-size:10px;letter-spacing:1.5px;color:var(--muted);text-transform:uppercase">' + esc(label) + '</div>' +
      '<div style="font-size:22px;font-weight:900;color:' + color + ';margin-top:2px">' + esc(value) + '</div>' +
      '<div style="font-size:10px;color:var(--muted)">' + esc(sub) + '</div>' +
    '</div>';
  }

  window.glCpResendInvite = async function(rowId, email){
    var sb = getSB(); if(!sb) return alert('Supabase not ready');
    if(!confirm('Resend a password-reset email to ' + email + '?')) return;
    var redirectTo = location.origin + location.pathname + '?portal=1';
    var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectTo });
    if(r.error) return alert('Send failed: ' + r.error.message);
    alert('Reset email sent to ' + email + '.');
  };

  window.glCpSetActive = async function(rowId, active){
    var sb = getSB(); if(!sb) return alert('Supabase not ready');
    var verb = active ? 'reactivate' : 'deactivate';
    if(!confirm('Are you sure you want to ' + verb + ' this customer portal account?')) return;
    var r = await sb.from('customer_users').update({ active: active }).eq('id', rowId);
    if(r.error) return alert('Update failed: ' + r.error.message);
    renderFromSupabase();
  };

  window.glCpSetRole = async function(rowId, role){
    var sb = getSB(); if(!sb) return alert('Supabase not ready');
    if(role !== 'owner' && role !== 'member'){ alert('Invalid role'); return; }
    if(!confirm('Set this portal user as ' + role + '? ' + (role === 'owner' ? 'They will be able to invite/remove teammates and edit account settings.' : 'They will lose invite + edit privileges.'))) return;
    var r = await sb.from('customer_users').update({ role: role }).eq('id', rowId);
    if(r.error) return alert('Update failed: ' + r.error.message);
    if(typeof window.glAudit === 'function') window.glAudit('portal_role_changed', rowId, { role: role });
    renderFromSupabase();
  };

  // Override the in-memory version once Supabase is ready
  function install(){
    if(!window.supa){ setTimeout(install, 200); return; }
    window.renderCustomerLogins = renderFromSupabase;
    // If the page is currently visible, refresh now
    var page = document.getElementById('cpg-customers');
    if(page && page.classList.contains('act')) renderFromSupabase();
  }
  if(document.readyState !== 'loading') install();
  else document.addEventListener('DOMContentLoaded', install);

  console.log('[GL] customer-login management page → backed by Supabase');
}());

/* ============================================================
   PORTAL: Download invoice PDF button
   ============================================================
   Reuses the existing window.generateInvoicePdfBlob() from
   index.html. That function looks up the invoice in the global
   `invoices` array; in portal mode that array is empty (the
   portal queries Supabase directly), so this wrapper maps the
   portal's Supabase invoice + client into the CRM-shaped object
   the PDF generator expects, pushes them into the globals, and
   triggers a blob download.
   ============================================================ */
(function(){
  window.glPortalDownloadInvoicePdf = async function(invoiceSupaId, evt){
    if(typeof window.generateInvoicePdfBlob !== 'function'){
      alert('PDF generator not loaded. Please refresh and try again.');
      return;
    }
    var sb = window.supa;
    if(!sb){ alert('Supabase not ready'); return; }
    // Accept event from second arg (when called via inline onclick with explicit pass)
    // OR fall back to global event for legacy inline onclicks.
    var btn = (evt && evt.currentTarget) || (typeof event !== 'undefined' && event && event.currentTarget) || null;
    var origText = btn ? btn.textContent : '';
    if(btn){ btn.disabled = true; btn.textContent = '…'; }
    try {
      var iR = await sb.from('invoices')
        .select('id, invoice_number, amount, status, invoice_date, due_date, payment_terms, line_items, client_id, notes, service')
        .eq('id', invoiceSupaId).maybeSingle();
      if(iR.error || !iR.data){ throw new Error((iR.error && iR.error.message) || 'Invoice not found'); }
      var inv = iR.data;
      var cR = await sb.from('clients')
        .select('id, name, contact_name, email, phone, street, city, state, zip, shipping_same, shipping_street, shipping_city, shipping_state, shipping_zip')
        .eq('id', inv.client_id).maybeSingle();
      var client = (cR && cR.data) || { id: inv.client_id, name: '' };
      // Map → CRM shape expected by generateInvoicePdfBlob
      var appInv = {
        id:           inv.invoice_number || inv.id,
        supaId:       inv.id,
        client:       client.id,
        clientName:   client.name || '',
        svc:          inv.service || '',
        amount:       inv.amount || 0,
        date:         inv.invoice_date || '',
        status:       inv.status || 'pending',
        notes:        inv.notes || '',
        paymentTerms: inv.payment_terms || '',
        dueDate:      inv.due_date || '',
        lines:        Array.isArray(inv.line_items) ? inv.line_items : []
      };
      var appClient = {
        id:           client.id,
        name:         client.name || '',
        contact:      client.contact_name || '',
        email:        client.email || '',
        phone:        client.phone || '',
        street:       client.street || '',
        city:         client.city || '',
        state:        client.state || '',
        zip:          client.zip || '',
        billingSame:  client.shipping_same !== false,
        billingStreet: client.shipping_street || '',
        billingCity:   client.shipping_city || '',
        billingState:  client.shipping_state || '',
        billingZip:    client.shipping_zip || ''
      };
      if(!Array.isArray(window.invoices)) window.invoices = [];
      if(!Array.isArray(window.clients))  window.clients  = [];
      // Push only if not already present so we don't bloat the array
      if(!window.invoices.find(function(x){ return x.id === appInv.id; })) window.invoices.push(appInv);
      if(!window.clients.find(function(x){ return x.id === appClient.id; }))  window.clients.push(appClient);

      var blob = await window.generateInvoicePdfBlob(appInv.id);
      if(!blob) throw new Error('PDF generator returned no blob');
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = (appInv.id || 'invoice') + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function(){ URL.revokeObjectURL(url); }, 2000);
    } catch(e){
      console.error('[GL portal] PDF download failed', e);
      alert('Download failed: ' + (e.message || 'unknown'));
    } finally {
      if(btn){ btn.disabled = false; btn.textContent = origText; }
    }
  };

  console.log('[GL] portal invoice PDF download ready');
}());
