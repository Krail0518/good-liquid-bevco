/* ============================================================
   BILLING QUICK WINS — five small features
     - Schedule queue viewer (open / cancel pending sends)
     - AR Collection snooze (skip a single overdue invoice for N days)
     - Quote expiration auto-archive (>30 days old → status=expired)
     - PWA install nudge (top-bar banner when beforeinstallprompt fires)
     - Header button on Invoices toolbar to open the schedule queue
   ============================================================ */
(function(){
  function getSB(){ return window.supa || null; }
  function escHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function fmtDate(s){ try { return new Date(s).toLocaleString(); } catch(e){ return s; } }
  function toast(msg, kind){
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText='position:fixed;bottom:20px;right:20px;background:'+(kind==='err'?'#b91c1c':'#0f766e')+';color:#fff;padding:12px 18px;border-radius:8px;z-index:99999;font:14px system-ui;box-shadow:0 4px 12px rgba(0,0,0,.2);max-width:360px';
    document.body.appendChild(d);
    setTimeout(function(){ d.remove(); }, 4000);
  }

  // ────────────────────────────────────────────────────────────
  // SCHEDULE QUEUE — see + cancel pending follow-ups
  // ────────────────────────────────────────────────────────────
  window.glOpenScheduleQueue = async function(){
    var sb = getSB(); if(!sb) return;
    var ex = document.getElementById('gl-sched-queue'); if(ex) ex.remove();
    var r = await sb.from('email_schedule')
      .select('id, invoice_id, to_email, subject, send_at, status, attempts, last_error, sent_at, created_at')
      .order('send_at', { ascending: true })
      .limit(100);
    var rows = r.data || [];
    var STATUS_COLOR = { pending:'#f5c842', sent:'#5fcf9e', failed:'#e74c3c', cancelled:'#9aa7bd' };
    var rowsHtml = rows.length ? rows.map(function(s){
      var color = STATUS_COLOR[s.status] || '#9aa7bd';
      var canCancel = s.status === 'pending';
      return '<div style="padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.05);display:grid;grid-template-columns:1fr 120px 110px;gap:12px;align-items:center">' +
        '<div style="min-width:0">' +
          '<div style="color:#fff;font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHtml(s.subject) + '</div>' +
          '<div style="font-size:11px;color:var(--muted);margin-top:2px">→ ' + escHtml(s.to_email) + (s.last_error ? ' · <span style="color:#ff8579">' + escHtml(s.last_error.slice(0,60)) + '</span>' : '') + '</div>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--muted)">' +
          '<div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:' + color + ';font-weight:700">' + s.status + '</div>' +
          '<div style="margin-top:2px">' + fmtDate(s.send_at) + '</div>' +
        '</div>' +
        '<div style="text-align:right">' +
          (canCancel ? '<button class="gl-sq-cancel cbtn" data-id="'+s.id+'" style="background:rgba(231,76,60,.12);border-color:rgba(231,76,60,.35);color:#ff8579;font-size:11px;padding:5px 12px">Cancel</button>' : '') +
        '</div>' +
      '</div>';
    }).join('') : '<div style="padding:30px;text-align:center;color:var(--muted);font-size:13px">No scheduled follow-ups.</div>';

    var ov = document.createElement('div');
    ov.id = 'gl-sched-queue';
    ov.style.cssText = 'position:fixed;inset:0;z-index:1100;background:rgba(6,13,26,.85);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;padding:30px;overflow-y:auto';
    ov.innerHTML =
      '<div style="background:#142238;border:1px solid rgba(245,200,66,.25);border-radius:14px;width:100%;max-width:760px;padding:20px 24px;color:#fff">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
          '<div style="font-family:var(--ff-disp);font-size:18px;letter-spacing:2px;color:#f5c842">📅 SCHEDULED QUEUE</div>' +
          '<button id="gl-sq-close" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer">✕</button>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--muted);margin-bottom:10px">Cron worker fires every 15 minutes. Cancel a pending row to skip it.</div>' +
        '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:10px;max-height:60vh;overflow-y:auto">' + rowsHtml + '</div>' +
      '</div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-sq-close').onclick = function(){ ov.remove(); };
    ov.querySelectorAll('.gl-sq-cancel').forEach(function(b){
      b.onclick = async function(){
        if(!confirm('Cancel this scheduled send?')) return;
        var id = b.getAttribute('data-id');
        var rr = await sb.from('email_schedule').update({ status: 'cancelled' }).eq('id', id);
        if(rr.error){ alert('Failed: '+rr.error.message); return; }
        toast('Cancelled ✓');
        b.disabled = true; b.textContent = 'Cancelled';
        b.style.opacity = '0.5';
      };
    });
  };

  // ────────────────────────────────────────────────────────────
  // AR COLLECTION SNOOZE — local-only "remind me later" per invoice
  // ────────────────────────────────────────────────────────────
  var SNOOZE_KEY = 'gl_ar_snoozes';
  function getSnoozes(){ try { return JSON.parse(localStorage.getItem(SNOOZE_KEY)||'{}'); } catch(e){ return {}; } }
  function setSnoozes(s){ try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(s)); } catch(e){} }
  window.glSnoozeInvoice = function(invId, days){
    days = days || 5;
    var until = new Date(Date.now() + days*86400000).toISOString();
    var s = getSnoozes(); s[invId] = until; setSnoozes(s);
    toast('Snoozed ' + invId + ' for ' + days + ' day' + (days===1?'':'s') + ' ✓');
    return until;
  };

  // Inject a snooze button into the AR collection rows when they render
  (function watchAR(){
    var mo = new MutationObserver(function(){
      document.querySelectorAll('.gl-ar-send, .gl-ar-draft').forEach(function(b){
        var card = b.closest('div[style*="border-radius:10px"]');
        if(!card || card.querySelector('.gl-ar-snooze')) return;
        var invId = b.getAttribute('data-invid');
        if(!invId) return;
        var snz = document.createElement('button');
        snz.className = 'cbtn gl-ar-snooze';
        snz.setAttribute('data-invid', invId);
        snz.setAttribute('style', 'font-size:11px;padding:5px 11px;background:rgba(155,155,155,.12);border-color:rgba(155,155,155,.35);color:#cfd9e6;margin-left:6px');
        snz.textContent = '⏰ Snooze 5d';
        snz.onclick = function(){
          window.glSnoozeInvoice(invId, 5);
          card.style.opacity = '0.4';
          var note = document.createElement('div');
          note.style.cssText = 'font-size:11px;color:#cfd9e6;margin-top:8px';
          note.textContent = '⏰ Snoozed for 5 days';
          card.appendChild(note);
        };
        b.parentNode.appendChild(snz);
      });
    });
    mo.observe(document.body, { childList:true, subtree:true });
  })();

  // ────────────────────────────────────────────────────────────
  // QUOTE EXPIRATION — auto-flip quotes >30d old to status=expired
  // ────────────────────────────────────────────────────────────
  async function expireOldQuotes(){
    var sb = getSB(); if(!sb) return;
    var cutoff = new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
    try {
      var r = await sb.from('invoices').update({ status: 'expired' })
        .eq('status', 'quote').lt('invoice_date', cutoff).select('invoice_number');
      if(r.data && r.data.length){
        console.log('[GL] Auto-expired ' + r.data.length + ' quote(s) >30d old:', r.data.map(function(x){return x.invoice_number;}).join(', '));
      }
    } catch(e){ console.warn('[GL] expireOldQuotes threw', e); }
  }
  // Run once on init + once per hour while CRM is open
  if(document.readyState === 'complete' || document.readyState === 'interactive'){
    setTimeout(expireOldQuotes, 4000);
  } else {
    document.addEventListener('DOMContentLoaded', function(){ setTimeout(expireOldQuotes, 4000); });
  }
  setInterval(expireOldQuotes, 3600000);

  // ────────────────────────────────────────────────────────────
  // PWA INSTALL NUDGE — DISABLED here.
  // See sibling note above the pwaPromptDisabled stub: three independent
  // beforeinstallprompt listeners produced three install banners on
  // every page load. The canonical handler lives only in index.html now.

  // ────────────────────────────────────────────────────────────
  // Add a 📅 Queue button to the Invoices page toolbar
  // ────────────────────────────────────────────────────────────
  (function injectQueueBtn(){
    var mo = new MutationObserver(function(){
      var page = document.getElementById('cpg-invoices');
      if(!page) return;
      var header = page.querySelector('.cph');
      if(!header || header.querySelector('.gl-queue-btn')) return;
      var anchor = Array.from(header.querySelectorAll('button')).find(function(b){
        return (b.textContent||'').includes('Activity');
      });
      if(!anchor) return;
      var btn = document.createElement('button');
      btn.className = 'cbtn gl-queue-btn';
      btn.setAttribute('style','margin-left:8px;background:rgba(245,200,66,.10);border:1px solid rgba(245,200,66,.30);color:#f5c842');
      btn.textContent = '📅 Queue';
      btn.onclick = function(){ window.glOpenScheduleQueue(); };
      anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    });
    mo.observe(document.body, { childList:true, subtree:true });
  })();

  console.log('[GL] billing quick-wins loaded: glOpenScheduleQueue · glSnoozeInvoice · auto-expire quotes · PWA nudge');
}());

/* ============================================================
   ADMIN EXPORT — one-click full-database backup as a ZIP of JSON files
   Each table → its own .json file inside a date-stamped ZIP.
   ============================================================ */
(function(){
  function getSB(){ return window.supa || null; }
  function toast(msg, kind){
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText='position:fixed;bottom:20px;right:20px;background:'+(kind==='err'?'#b91c1c':'#0f766e')+';color:#fff;padding:12px 18px;border-radius:8px;z-index:99999;font:14px system-ui;box-shadow:0 4px 12px rgba(0,0,0,.2);max-width:360px';
    document.body.appendChild(d);
    setTimeout(function(){ d.remove(); }, 4500);
  }

  // Pre-load JSZip at IIFE init so it's ready when the user clicks
  var _zipLoading = null;
  function ensureJsZip(){
    if(window.JSZip) return Promise.resolve(window.JSZip);
    if(_zipLoading) return _zipLoading;
    _zipLoading = new Promise(function(resolve, reject){
      var s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
      s.async = true;
      s.onload = function(){ resolve(window.JSZip); };
      s.onerror = function(){ _zipLoading = null; reject(new Error('jszip load failed')); };
      document.head.appendChild(s);
    });
    return _zipLoading;
  }
  // Warm up JSZip in the background so first click is instant
  ensureJsZip();

  // Every table we want to back up. Order doesn't matter for export.
  var EXPORT_TABLES = [
    'clients','invoices','referrals','referrers','deals','activity',
    'vendors','formulas','production_runs','yield_logs','cip_logs',
    'defects','sample_shipments','content_calendar','trade_shows',
    'capacity','case_studies','nps_responses','resources','audit_log',
    'compliance_tasks','compliance_records','hold_tags','facilities',
    'inspector_tokens','client_allergen_declarations',
    'email_templates','email_log','email_schedule','cip_equipment'
  ];

  window.glExportEverything = async function(){
    var sb = getSB();
    if(!sb){ toast('Supabase not ready — try reloading the page.', 'err'); return; }
    // Show progress immediately (no confirm — Chrome silently swallows confirm() if the
    // user ever clicked "Don't allow additional dialogs", making the button appear broken)
    var status = document.createElement('div');
    status.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#142238;color:#fff;border:1px solid rgba(0,229,192,.35);border-radius:10px;padding:14px 22px;z-index:99999;font:13px system-ui;box-shadow:0 6px 18px rgba(0,0,0,.4)';
    status.innerHTML = '<div style="font-weight:700;margin-bottom:4px">📦 Building backup…</div><div id="gl-exp-progress" style="font-size:11px;color:#9aa7bd">Starting…</div>';
    document.body.appendChild(status);

    try {
      var JSZip = await ensureJsZip();
      var zip = new JSZip();
      var manifest = {
        exported_at: new Date().toISOString(),
        exported_by: (window.currentUser && window.currentUser.email) || 'unknown',
        project: 'goodliquid',
        tables: {}
      };

      for(var i=0; i<EXPORT_TABLES.length; i++){
        var t = EXPORT_TABLES[i];
        var prog = document.getElementById('gl-exp-progress');
        if(prog) prog.textContent = (i+1) + ' / ' + EXPORT_TABLES.length + ' · ' + t;
        try {
          var r = await sb.from(t).select('*').limit(10000);
          if(r.error){
            manifest.tables[t] = { rows: 0, error: r.error.message };
            zip.file(t + '.json', JSON.stringify({ error: r.error.message }, null, 2));
          } else {
            var rows = r.data || [];
            manifest.tables[t] = { rows: rows.length };
            zip.file(t + '.json', JSON.stringify(rows, null, 2));
          }
        } catch(e){
          manifest.tables[t] = { rows: 0, error: e.message };
          zip.file(t + '.json', JSON.stringify({ error: e.message }, null, 2));
        }
      }
      zip.file('_manifest.json', JSON.stringify(manifest, null, 2));
      zip.file('README.txt',
        'Good Liquid Bev Co — CRM full backup\n' +
        'Exported: ' + manifest.exported_at + '\n' +
        'Exported by: ' + manifest.exported_by + '\n\n' +
        'Each .json file in this archive is the full dump of one Supabase\n' +
        'table at the time of export. _manifest.json lists the row counts.\n\n' +
        'To restore: import each JSON file into the matching table.\n' +
        'Use the Supabase Dashboard → SQL Editor or psql + INSERT statements.\n'
      );

      if(document.getElementById('gl-exp-progress')) document.getElementById('gl-exp-progress').textContent = 'Building zip…';
      var blob = await zip.generateAsync({ type: 'blob', compression:'DEFLATE', compressionOptions:{ level: 6 } });

      var stamp = new Date().toISOString().slice(0,16).replace(':','-').replace('T','_');
      var fname = 'goodliquid-crm-backup-' + stamp + '.zip';
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      a.click();
      setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
      status.remove();
      var totalRows = Object.values(manifest.tables).reduce(function(s,t){ return s + (t.rows||0); }, 0);
      toast('Backup downloaded: ' + fname + ' (' + totalRows.toLocaleString() + ' rows)');
      if(typeof window.glAudit === 'function') window.glAudit('admin_export_all', null, { total_rows: totalRows, table_count: EXPORT_TABLES.length });
    } catch(e){
      status.remove();
      alert('Backup failed: ' + (e.message || e));
      console.error('[GL] export failed', e);
    }
  };

  // Inject a 💾 Backup button into the Users page header (admin tools live there)
  (function injectBtn(){
    var mo = new MutationObserver(function(){
      var page = document.getElementById('cpg-users');
      if(!page) return;
      var header = page.querySelector('.cph');
      if(!header || header.querySelector('.gl-export-btn')) return;
      var btn = document.createElement('button');
      btn.className = 'cbtn gl-export-btn';
      btn.setAttribute('style','margin-left:8px;background:rgba(0,229,192,.10);border:1px solid rgba(0,229,192,.30);color:#00e5c0');
      btn.textContent = '💾 Backup all data';
      btn.onclick = function(){ window.glExportEverything(); };
      header.appendChild(btn);
    });
    mo.observe(document.body, { childList:true, subtree:true });
  })();

  console.log('[GL] admin export loaded — glExportEverything()');
}());
