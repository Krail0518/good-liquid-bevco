/* ============================================================
   CRM: Customer Requests inbox
   ============================================================
   Customers submit requests (sample / reorder / quote / question)
   from the portal. Mike triages here. Adds:
   - A dashboard banner showing the count of NEW requests
   - A full inbox modal: list, drill into one, resolve/dismiss
   - Realtime subscription so new requests pop in without refresh
   ============================================================ */
(function(){
  function getSB(){ return window.supa || null; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function fmtTs(d){ if(!d) return ''; try { return new Date(d).toLocaleString(); } catch(e){ return String(d); } }

  var KIND_LABEL = { sample:'🧪 Sample request', reorder:'📦 Reorder', quote:'💬 Quote request', question:'❓ Question', other:'📩 Other' };
  var KIND_COLOR = { sample:'#c4b5fd', reorder:'#6b9fff', quote:'#f5c842', question:'#00e5c0', other:'#9aa7bd' };
  var STATUS_LABEL = { new:'NEW', in_progress:'IN PROGRESS', resolved:'RESOLVED', dismissed:'DISMISSED' };
  var STATUS_COLOR = { new:'#f5c842', in_progress:'#6b9fff', resolved:'#5fcf9e', dismissed:'#9aa7bd' };

  async function fetchRequests(status){
    var sb = getSB(); if(!sb) return [];
    var q = sb.from('customer_requests').select('id, client_id, kind, subject, body, status, resolved_at, resolution_notes, created_at').order('created_at', { ascending: false }).limit(200);
    if(status) q = q.eq('status', status);
    var r = await q;
    if(r.error){ console.warn('[GL] customer_requests load', r.error); return []; }
    return r.data || [];
  }
  async function fetchClientMap(){
    var sb = getSB(); if(!sb) return {};
    var r = await sb.from('clients').select('id, name, email');
    var map = {};
    (r.data || []).forEach(function(c){ map[c.id] = c; });
    return map;
  }

  // ── Dashboard banner: "N new customer requests" ────────────────────────
  async function refreshDashboardBanner(){
    var dash = document.getElementById('cpg-dashboard');
    if(!dash) return;
    var existing = document.getElementById('gl-cust-req-banner');
    if(existing) existing.remove();
    var newOnes = await fetchRequests('new');
    if(!newOnes.length) return;
    var banner = document.createElement('div');
    banner.id = 'gl-cust-req-banner';
    banner.style.cssText = 'background:rgba(245,200,66,.08);border:1px solid rgba(245,200,66,.3);border-radius:10px;padding:12px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px;cursor:pointer';
    banner.onclick = function(){ window.glOpenCustomerRequestsInbox(); };
    banner.innerHTML = '<div style="font-size:18px">📩</div>' +
      '<div style="flex:1"><div style="font-size:13px;font-weight:700;color:#f5c842">' + newOnes.length + ' new customer request' + (newOnes.length===1?'':'s') + '</div>' +
      '<div style="font-size:11px;color:#9aa7bd;margin-top:2px">Click to triage</div></div>' +
      '<div style="font-size:11px;color:#f5c842">Open inbox →</div>';
    var firstChild = dash.firstElementChild;
    if(firstChild) dash.insertBefore(banner, firstChild); else dash.appendChild(banner);
  }

  // ── Inbox modal ────────────────────────────────────────────────────────
  window.glOpenCustomerRequestsInbox = async function(){
    var existing = document.getElementById('gl-cri-modal');
    if(existing) existing.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-cri-modal';
    ov.style.cssText = 'position:fixed;inset:0;z-index:720;background:rgba(6,13,26,.95);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto';
    ov.innerHTML = '<div style="background:#142238;border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:24px;width:100%;max-width:920px;max-height:90vh;overflow-y:auto;color:#eef4ff;font-family:Arial,Helvetica,sans-serif">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
        '<div style="font-family:var(--ff-disp);font-size:20px;letter-spacing:2px;color:#f5c842">📩 CUSTOMER REQUESTS</div>' +
        '<button onclick="document.getElementById(\'gl-cri-modal\').remove()" style="background:none;border:0;color:#9aa7bd;font-size:22px;cursor:pointer">×</button>' +
      '</div>' +
      '<div style="display:flex;gap:6px;margin-bottom:14px" id="gl-cri-filters">' +
        '<button data-status="new" class="gl-cri-pill act">New</button>' +
        '<button data-status="in_progress" class="gl-cri-pill">In progress</button>' +
        '<button data-status="resolved" class="gl-cri-pill">Resolved</button>' +
        '<button data-status="dismissed" class="gl-cri-pill">Dismissed</button>' +
        '<button data-status="" class="gl-cri-pill">All</button>' +
      '</div>' +
      '<div id="gl-cri-list"><div style="padding:30px;text-align:center;color:#9aa7bd">Loading…</div></div>' +
    '</div>';
    document.body.appendChild(ov);
    var style = document.createElement('style');
    style.textContent = '.gl-cri-pill{padding:6px 14px;border-radius:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:#9aa7bd;font-size:11px;letter-spacing:1px;text-transform:uppercase;cursor:pointer}.gl-cri-pill.act{background:rgba(245,200,66,.15);border-color:rgba(245,200,66,.4);color:#f5c842}';
    ov.appendChild(style);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });

    var currentStatus = 'new';
    async function renderList(){
      var listEl = document.getElementById('gl-cri-list');
      listEl.innerHTML = '<div style="padding:30px;text-align:center;color:#9aa7bd">Loading…</div>';
      var rows = await fetchRequests(currentStatus || null);
      var clientMap = await fetchClientMap();
      if(!rows.length){
        listEl.innerHTML = '<div style="padding:60px;text-align:center;color:#9aa7bd;font-size:13px">No ' + (currentStatus || '') + ' requests.</div>';
        return;
      }
      listEl.innerHTML = rows.map(function(r){
        var client = clientMap[r.client_id] || {};
        var kindLabel = KIND_LABEL[r.kind] || ('📩 ' + r.kind);
        var kindColor = KIND_COLOR[r.kind] || '#9aa7bd';
        var statusColor = STATUS_COLOR[r.status] || '#9aa7bd';
        return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-left:3px solid ' + kindColor + ';border-radius:8px;padding:14px 16px;margin-bottom:10px">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:6px">' +
            '<div style="flex:1">' +
              '<div style="font-size:12px;color:' + kindColor + ';font-weight:700;letter-spacing:1px">' + kindLabel + '</div>' +
              '<div style="font-size:14px;color:#fff;font-weight:700;margin-top:3px">' + esc(client.name || '(unknown client)') + (r.subject ? ' — ' + esc(r.subject) : '') + '</div>' +
              '<div style="font-size:11px;color:#6b87ad;margin-top:2px">' + fmtTs(r.created_at) + (client.email ? ' · ' + esc(client.email) : '') + '</div>' +
            '</div>' +
            '<span style="font-size:9px;letter-spacing:1.5px;font-weight:700;color:' + statusColor + ';border:1px solid ' + statusColor + '55;padding:3px 8px;border-radius:10px;white-space:nowrap">' + (STATUS_LABEL[r.status] || r.status) + '</span>' +
          '</div>' +
          (r.body ? '<div style="font-size:13px;color:#eef4ff;line-height:1.6;margin-top:10px;padding:10px 12px;background:rgba(255,255,255,.03);border-radius:6px;white-space:pre-wrap">' + esc(r.body) + '</div>' : '') +
          (r.resolution_notes ? '<div style="font-size:12px;color:#9aa7bd;margin-top:8px;padding:8px 12px;background:rgba(95,207,158,.06);border-left:2px solid #5fcf9e;border-radius:4px"><b style="color:#5fcf9e">Resolution:</b> ' + esc(r.resolution_notes) + '</div>' : '') +
          (r.status === 'new' || r.status === 'in_progress' ? '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
            (r.status === 'new' ? '<button onclick="window.glCustReqSetStatus(\'' + r.id + '\',\'in_progress\')" style="background:rgba(107,159,255,.12);border:1px solid rgba(107,159,255,.4);color:#6b9fff;padding:5px 12px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:700">Mark in progress</button>' : '') +
            '<button onclick="window.glCustReqResolve(\'' + r.id + '\')" style="background:rgba(95,207,158,.12);border:1px solid rgba(95,207,158,.4);color:#5fcf9e;padding:5px 12px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:700">✓ Resolve</button>' +
            '<button onclick="window.glCustReqSetStatus(\'' + r.id + '\',\'dismissed\')" style="background:rgba(154,167,189,.1);border:1px solid rgba(154,167,189,.3);color:#9aa7bd;padding:5px 12px;border-radius:6px;font-size:11px;cursor:pointer">Dismiss</button>' +
            (client.email ? '<a href="mailto:' + esc(client.email) + '?subject=' + encodeURIComponent('Re: ' + (r.subject || kindLabel)) + '" style="background:rgba(0,229,192,.12);border:1px solid rgba(0,229,192,.4);color:#00e5c0;padding:5px 12px;border-radius:6px;font-size:11px;text-decoration:none;font-weight:700">↩ Reply via email</a>' : '') +
          '</div>' : '') +
        '</div>';
      }).join('');
    }
    ov.querySelectorAll('.gl-cri-pill').forEach(function(btn){
      btn.onclick = function(){
        ov.querySelectorAll('.gl-cri-pill').forEach(function(b){ b.classList.remove('act'); });
        btn.classList.add('act');
        currentStatus = btn.getAttribute('data-status');
        renderList();
      };
    });
    renderList();
  };

  window.glCustReqSetStatus = async function(id, status){
    var sb = getSB(); if(!sb) return;
    var sess = await sb.auth.getSession();
    var uid = sess && sess.data && sess.data.session && sess.data.session.user && sess.data.session.user.id;
    var payload = { status: status };
    if(status === 'resolved') { payload.resolved_at = new Date().toISOString(); payload.resolved_by = uid; }
    var r = await sb.from('customer_requests').update(payload).eq('id', id);
    if(r.error){ alert('Update failed: ' + r.error.message); return; }
    if(typeof window.glOpenCustomerRequestsInbox === 'function'){
      // Re-render by re-clicking the active filter button
      var ov = document.getElementById('gl-cri-modal');
      if(ov){ var active = ov.querySelector('.gl-cri-pill.act'); if(active) active.click(); }
    }
    refreshDashboardBanner();
  };

  window.glCustReqResolve = async function(id){
    var notes = prompt('Resolution notes (optional — what did you do?):');
    if(notes === null) return;
    var sb = getSB(); if(!sb) return;
    var sess = await sb.auth.getSession();
    var uid = sess && sess.data && sess.data.session && sess.data.session.user && sess.data.session.user.id;
    var r = await sb.from('customer_requests').update({
      status:'resolved', resolved_at: new Date().toISOString(), resolved_by: uid,
      resolution_notes: notes || null
    }).eq('id', id);
    if(r.error){ alert('Update failed: ' + r.error.message); return; }
    var ov = document.getElementById('gl-cri-modal');
    if(ov){ var active = ov.querySelector('.gl-cri-pill.act'); if(active) active.click(); }
    refreshDashboardBanner();
  };

  // Boot: render banner once dashboard is visible, and subscribe to changes.
  function watchDash(){
    if(!window.supa){ setTimeout(watchDash, 500); return; }
    refreshDashboardBanner();
    setInterval(refreshDashboardBanner, 60000); // poll every 60s as a fallback
    try {
      window.supa.channel('gl-cust-req').on('postgres_changes', { event:'*', schema:'public', table:'customer_requests' }, function(){
        refreshDashboardBanner();
      }).subscribe();
    } catch(e){ console.warn('[GL] customer_requests realtime failed', e); }
  }
  if(document.readyState !== 'loading') watchDash();
  else document.addEventListener('DOMContentLoaded', watchDash);

  console.log('[GL] customer requests inbox loaded');
}());

/* ── LOGIN IP ALERT ─────────────────────────────────────────────────────────
   On every login we:
     1. Fetch the caller's public IP from ipify
     2. Insert a login_events row in Supabase
     3. Query whether this IP has been seen before for this user
     4. If it's new → show an in-app alert banner + fire a Mailgun email
   Graceful: all steps are try/catch'd so a failure never blocks the login.
   ────────────────────────────────────────────────────────────────────────── */
(function(){
  'use strict';

  /* ── helpers ── */
  function showNewIpBanner(ip){
    var old = document.getElementById('gl-new-ip-banner');
    if(old) old.remove();
    var banner = document.createElement('div');
    banner.id = 'gl-new-ip-banner';
    banner.setAttribute('style', [
      'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999',
      'background:#1a2a3a;border:1px solid rgba(245,200,66,.35);border-radius:12px',
      'padding:14px 20px;display:flex;gap:12px;align-items:flex-start',
      'max-width:420px;width:calc(100% - 40px);box-shadow:0 8px 32px rgba(0,0,0,.5)'
    ].join(';'));
    banner.innerHTML = [
      '<span style="font-size:22px;line-height:1;flex-shrink:0">⚠️</span>',
      '<div style="flex:1;min-width:0">',
        '<div style="font-weight:600;color:#f5c842;font-size:13px;margin-bottom:4px">New sign-in location detected</div>',
        '<div style="font-size:12px;color:#9ca3af;line-height:1.5">',
          'We saw a login from IP <b style="color:#cbd5e1">' + ip + '</b> — an address we haven\'t seen for your account before. ',
          'If this was you, no action needed. If not, <b style="color:#f87171">change your password immediately.</b>',
        '</div>',
        '<div style="margin-top:10px;display:flex;gap:8px">',
          '<button onclick="cNav(\'ai-settings\')" style="font-size:11px;padding:4px 12px;border-radius:6px;border:1px solid rgba(245,200,66,.4);background:rgba(245,200,66,.08);color:#f5c842;cursor:pointer">Account Security</button>',
          '<button onclick="document.getElementById(\'gl-new-ip-banner\').remove()" style="font-size:11px;padding:4px 12px;border-radius:6px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#9ca3af;cursor:pointer">Dismiss</button>',
        '</div>',
      '</div>'
    ].join('');
    document.body.appendChild(banner);
    /* auto-dismiss after 30 s */
    setTimeout(function(){ if(banner.parentNode) banner.remove(); }, 30000);
  }

  async function sendNewIpEmail(user, ip){
    try {
      var sb = window.supa;
      if(!sb) return;
      var name = (user.name || user.email || 'there').split(' ')[0];
      await sb.functions.invoke('mailgun-send', {
        body: {
          to: user.email,
          subject: 'New sign-in location detected — Good Liquid CRM',
          html: [
            '<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a1a2e">',
            '<h2 style="color:#d4a200">⚠️ New sign-in location</h2>',
            '<p>Hi ' + name + ',</p>',
            '<p>We noticed a login to the Good Liquid CRM from an IP address we haven\'t seen for your account before:</p>',
            '<p style="background:#f3f4f6;border-radius:8px;padding:12px 16px;font-family:monospace;font-size:15px">' + ip + '</p>',
            '<p>If this was you, no action is needed.</p>',
            '<p>If you don\'t recognise this sign-in, please <strong>change your password immediately</strong> and contact your administrator.</p>',
            '<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">',
            '<p style="font-size:12px;color:#6b7280">Good Liquid Beverage Co. CRM — automated security alert</p>',
            '</div>'
          ].join('')
        }
      });
    } catch(e){ console.warn('[GL] new-IP email failed:', e); }
  }

  async function recordLoginEvent(user){
    try {
      var sb = window.supa;
      if(!sb || !user || !user.id) return;

      /* fetch IP */
      var ip = null;
      try {
        var r = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(4000) });
        var j = await r.json();
        ip = j.ip || null;
      } catch(e){ console.warn('[GL] ipify failed:', e); }

      /* look up prior IPs for this user */
      var isNew = false;
      if(ip){
        var { data: prior, error: priorErr } = await sb
          .from('login_events')
          .select('ip_address')
          .eq('user_id', user.id)
          .eq('ip_address', ip)
          .limit(1);
        if(!priorErr) isNew = (!prior || prior.length === 0);
      }

      /* insert the event */
      await sb.from('login_events').insert([{
        user_id   : user.id,
        ip_address: ip,
        user_agent: navigator.userAgent.slice(0, 512),
        is_new_ip : isNew
      }]);

      /* alert if new */
      if(isNew && ip){
        showNewIpBanner(ip);
        sendNewIpEmail(user, ip); /* fire-and-forget */
      }
    } catch(e){ console.warn('[GL] login event record failed:', e); }
  }

  /* ── hook into loginUser ── */
  window.GL_HOOKS.registerLoginHook(function(u){ setTimeout(function(){ recordLoginEvent(u); }, 1500); });

  console.log('[GL] login IP alert loaded');
}());
