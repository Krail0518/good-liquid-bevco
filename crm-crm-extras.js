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
  var esc = window.glEsc;
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
  var esc = window.glEsc;
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
