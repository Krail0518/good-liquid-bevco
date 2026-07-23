/* ============================================================
   CUSTOMER PORTAL — tokenized public invoice view
   Adds:
     - ?invoice_view=<token> URL handler that renders the invoice on a
       clean public page (read-only, no login)
     - window.glGenerateInvoiceShareLink(invId) creates a share token
       on the invoice and copies a public URL to clipboard
     - "Public link" button on the Send Invoice composer
   ============================================================ */
(function(){
  var PARAM = 'invoice_view';
  function getSB(){ return window.supa || null; }
  function escHtml(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function usd(n){ return '$' + (Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
  function toast(msg, kind){
    var d = document.createElement('div');
    d.textContent = msg;
    d.style.cssText='position:fixed;bottom:20px;right:20px;background:'+(kind==='err'?'#b91c1c':'#0f766e')+';color:#fff;padding:12px 18px;border-radius:8px;z-index:99999;font:14px system-ui;box-shadow:0 4px 12px rgba(0,0,0,.2);max-width:360px';
    document.body.appendChild(d);
    setTimeout(function(){ d.remove(); }, 4500);
  }
  function randToken(){
    var a = new Uint8Array(20); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function(b){ return ('0'+b.toString(16)).slice(-2); }).join('');
  }

  async function checkInvoiceViewMode(){
    var url = new URL(window.location.href);
    var token = url.searchParams.get(PARAM);
    if(!token) return false;
    var sb = getSB(); if(!sb) return false;
    var r = await sb.from('invoices')
      .select('id, invoice_number, line_items, amount, status, invoice_date, due_date, payment_terms, notes, client_name, client_id, client_email')
      .eq('share_token', token).maybeSingle();
    if(r.error || !r.data){
      document.body.innerHTML = '<div style="padding:40px;font:16px system-ui;text-align:center;color:#444">Invoice not found or revoked.</div>';
      return true;
    }
    renderPublicInvoice(r.data, token);
    return true;
  }

  function renderPublicInvoice(inv, token){
    var lines = Array.isArray(inv.line_items) && inv.line_items.length
      ? inv.line_items
      : [{ desc: 'Service', qty: 1, unitPrice: inv.amount, total: inv.amount }];
    var rowsHtml = lines.map(function(l){
      var qty = (l.qty != null) ? Number(l.qty).toLocaleString() : '';
      var up = (l.unitPrice != null) ? usd(l.unitPrice) + (l.unit ? '<span style="font-size:10px;color:#888;margin-left:4px">/'+escHtml(l.unit)+'</span>' : '') : '';
      return '<tr><td style="padding:11px 14px;border-bottom:1px solid #eee">' + escHtml(l.desc||'') + '</td>' +
        '<td style="padding:11px 14px;text-align:center;border-bottom:1px solid #eee">' + qty + '</td>' +
        '<td style="padding:11px 14px;text-align:right;border-bottom:1px solid #eee">' + up + '</td>' +
        '<td style="padding:11px 14px;text-align:right;font-weight:700;border-bottom:1px solid #eee">' + usd(l.total||0) + '</td></tr>';
    }).join('');
    var statusBadgeBg = inv.status==='paid'?'#d1fae5':inv.status==='overdue'?'#fee2e2':'#fef3c7';
    var statusBadgeFg = inv.status==='paid'?'#065f46':inv.status==='overdue'?'#991b1b':'#92400e';
    var dueLine = inv.due_date ? 'Due: ' + inv.due_date : 'Terms: ' + (inv.payment_terms || 'Due on receipt');

    document.title = 'Invoice ' + (inv.invoice_number || '') + ' — Good Liquid Bev Co';
    document.body.innerHTML =
      '<div style="background:#f4f6fa;min-height:100vh;padding:30px 16px;font:14px/1.55 Arial,sans-serif;color:#1a1a1a">' +
        '<div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;box-shadow:0 4px 12px rgba(15,110,86,.06)">' +
          '<div style="padding:24px 28px;border-bottom:3px solid #0F6E56;display:flex;justify-content:space-between;align-items:flex-start;gap:20px;flex-wrap:wrap">' +
            '<div>' +
              '<div style="font-size:20px;font-weight:900;color:#0F6E56;letter-spacing:2px">GOOD LIQUID BEV CO</div>' +
              '<div style="font-size:11px;color:#666;margin-top:4px">2011 51st Ave E, Unit 100 · Palmetto, FL 34221</div>' +
              '<div style="font-size:11px;color:#666">Mike@GoodLiquid.com · (803) 493-5065</div>' +
            '</div>' +
            '<div style="text-align:right">' +
              '<div style="font-size:24px;font-weight:900">INVOICE</div>' +
              '<div style="font-size:13px;color:#0F6E56;font-weight:700">' + escHtml(inv.invoice_number||'') + '</div>' +
              '<div style="margin-top:6px;font-size:11px"><span style="background:' + statusBadgeBg + ';color:' + statusBadgeFg + ';padding:3px 10px;border-radius:14px;font-weight:700;text-transform:uppercase">' + escHtml(inv.status||'pending') + '</span></div>' +
            '</div>' +
          '</div>' +
          '<div style="padding:18px 28px;display:flex;gap:24px;justify-content:space-between;flex-wrap:wrap">' +
            '<div>' +
              '<div style="font-size:10px;letter-spacing:2px;color:#999;text-transform:uppercase;margin-bottom:4px">Bill To</div>' +
              '<div style="font-weight:700">' + escHtml(inv.client_name||'') + '</div>' +
            '</div>' +
            '<div style="text-align:right">' +
              '<div style="font-size:10px;letter-spacing:2px;color:#999;text-transform:uppercase;margin-bottom:4px">Invoice Details</div>' +
              '<div style="font-size:12px">Date: ' + escHtml(inv.invoice_date||'') + '</div>' +
              '<div style="font-size:12px">' + escHtml(dueLine) + '</div>' +
            '</div>' +
          '</div>' +
          '<table style="width:100%;border-collapse:collapse;margin:8px 0 0;font-size:13px">' +
            '<thead><tr style="background:#0F6E56;color:#fff">' +
              '<th style="padding:10px 14px;text-align:left;font-size:11px;letter-spacing:1px">Description</th>' +
              '<th style="padding:10px 14px;text-align:center;font-size:11px;letter-spacing:1px">Qty</th>' +
              '<th style="padding:10px 14px;text-align:right;font-size:11px;letter-spacing:1px">Unit Price</th>' +
              '<th style="padding:10px 14px;text-align:right;font-size:11px;letter-spacing:1px">Amount</th>' +
            '</tr></thead>' +
            '<tbody>' + rowsHtml +
              (inv.notes ? '<tr><td colspan="4" style="padding:10px 14px;font-size:12px;color:#666;font-style:italic">' + escHtml(inv.notes) + '</td></tr>' : '') +
              '<tr style="background:#f4fbf9"><td colspan="3" style="padding:14px;font-weight:900;color:#0F6E56;font-size:16px">Total Due</td><td style="padding:14px;text-align:right;font-weight:900;color:#0F6E56;font-size:18px">' + usd(inv.amount||0) + '</td></tr>' +
            '</tbody>' +
          '</table>' +
          '<div style="margin:0 28px 28px;padding:14px 18px;background:#f4fbf9;border:1px solid #0F6E56;border-radius:8px">' +
            '<div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#0F6E56;font-weight:700;margin-bottom:8px">Payment Instructions — Wire Transfer</div>' +
            '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
              '<tr><td style="padding:3px 0;color:#555;width:160px">Bank Name</td><td>Gulfside Bank</td></tr>' +
              '<tr><td style="padding:3px 0;color:#555">Account Number</td><td style="font-family:monospace">1000007789</td></tr>' +
              '<tr><td style="padding:3px 0;color:#555">Routing (ABA)</td><td style="font-family:monospace">063116902</td></tr>' +
            '</table>' +
          '</div>' +
          (inv.status === 'paid'
            ? '<div style="margin:0 28px 24px;padding:14px;background:#d1fae5;border-radius:8px;text-align:center;font-weight:700;color:#065f46">✓ Paid in full · Thank you</div>'
            : '<div style="display:flex;gap:10px;justify-content:center;padding:0 28px 8px;flex-wrap:wrap">' +
                '<button id="gl-pub-pay-card" style="background:#635bff;color:#fff;border:0;padding:13px 28px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer">💳 Pay with Card</button>' +
                '<button id="gl-pub-pay-ach" style="background:#0F6E56;color:#fff;border:0;padding:13px 28px;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer">🏦 Pay with ACH</button>' +
              '</div>' +
              '<div id="gl-pub-pay-status" style="text-align:center;padding:6px 28px;font-size:12px;color:#666;min-height:18px"></div>'
          ) +
          '<div style="display:flex;gap:10px;justify-content:center;padding:0 28px 28px;flex-wrap:wrap">' +
            '<button id="gl-pub-print" style="background:rgba(15,110,86,.10);color:#0F6E56;border:1px solid #0F6E56;padding:10px 22px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">⬇ Save as PDF</button>' +
          '</div>' +
          '<div style="padding:14px 28px;border-top:1px solid #eee;font-size:11px;color:#999;text-align:center;background:#fafafa">' +
            'Payment to Good Liquid Bev Co · Mike@GoodLiquid.com · (803) 493-5065 · goodliquidbevco.com' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<style>@media print { body { background:#fff!important } div[style*="max-width:720px"] { box-shadow:none!important; border:0!important } #gl-pub-print, #gl-pub-pay-card, #gl-pub-pay-ach { display:none } }</style>';
    var printBtn = document.getElementById('gl-pub-print');
    if(printBtn) printBtn.onclick = function(){ window.print(); };

    // Pay buttons — POST to the stripe-checkout-session Edge Function
    // (deployed at /functions/v1/stripe-checkout-session, no-verify-jwt) and
    // redirect to the Stripe-hosted checkout. The Edge Function holds the
    // Stripe secret server-side; the customer doesn't need a CRM login.
    function fireStripe(method){
      var status = document.getElementById('gl-pub-pay-status');
      var btnC = document.getElementById('gl-pub-pay-card');
      var btnA = document.getElementById('gl-pub-pay-ach');
      if(!status) return;
      if(btnC) btnC.disabled = true;
      if(btnA) btnA.disabled = true;
      status.textContent = 'Opening secure Stripe checkout…';
      var origin = window.location.origin;
      var basePath = window.location.pathname;
      var qs = '?invoice_view=' + encodeURIComponent(token);
      var body = {
        invoice_id: inv.invoice_number || inv.id,
        amount: Number(inv.amount) || 0,
        currency: 'usd',
        description: 'Invoice ' + (inv.invoice_number || inv.id) + ' — Good Liquid Bev Co',
        client_email: inv.client_email || '',
        success_url: origin + basePath + qs + '&paid=1',
        cancel_url:  origin + basePath + qs,
        payment_method: method,
        surcharge_pct: method === 'card' ? 3 : 0
      };
      // Supabase function gateway requires an Authorization header even
      // when the function was deployed with --no-verify-jwt unless the
      // anon-call path is explicitly enabled. Send the project's anon key
      // so anonymous customers (no CRM login) can hit the endpoint.
      var ANON_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVmamtlcW14d3V5aGJxeXVnY2dnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNDI2MDksImV4cCI6MjA5MzkxODYwOX0.godgU_jeprCqSzqe0ji_ZA_hwvPF2s7BmzQyAB-c_xE';
      fetch('https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/stripe-checkout-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ANON_JWT,
          'Authorization': 'Bearer ' + ANON_JWT
        },
        body: JSON.stringify(body)
      }).then(function(r){
        if(!r.ok) return r.text().then(function(t){ throw new Error('HTTP '+r.status+': '+t.slice(0,200)); });
        return r.json();
      }).then(function(data){
        if(data && data.url){ window.location.href = data.url; }
        else { status.textContent = 'Could not open checkout. Please use the wire instructions below.'; }
      }).catch(function(e){
        if(btnC) btnC.disabled = false;
        if(btnA) btnA.disabled = false;
        status.textContent = 'Checkout failed: ' + (e.message || '') + '. Use the wire instructions below, or contact Mike@GoodLiquid.com.';
      });
    }
    var btnCard = document.getElementById('gl-pub-pay-card');
    if(btnCard) btnCard.onclick = function(){ fireStripe('card'); };
    var btnAch = document.getElementById('gl-pub-pay-ach');
    if(btnAch) btnAch.onclick = function(){ fireStripe('ach'); };
  }

  // Generate or fetch a share token, then return a public URL.
  window.glGenerateInvoiceShareLink = async function(invId){
    var inv = (window.invoices||[]).find(function(i){ return i.id === invId; });
    if(!inv || !inv.supaId){ alert('Invoice not synced to Supabase yet.'); return null; }
    var sb = getSB(); if(!sb){ alert('Supabase not ready.'); return null; }
    var supaRow = await sb.from('invoices').select('share_token').eq('id', inv.supaId).maybeSingle();
    var token = supaRow && supaRow.data && supaRow.data.share_token;
    if(!token){
      token = randToken();
      var upd = await sb.from('invoices').update({ share_token: token }).eq('id', inv.supaId);
      if(upd.error){ alert('Failed to set share token: '+upd.error.message); return null; }
    }
    var link = window.location.origin + window.location.pathname + '?invoice_view=' + token;
    return link;
  };

  // Inject a "Public link" button into the Send Invoice composer (modal-id: gl-send-inv-modal).
  // The button copies the public URL to clipboard.
  (function watchSendModal(){
    var mo = new MutationObserver(function(){
      var modal = document.getElementById('gl-send-inv-modal');
      if(!modal || modal.querySelector('#gl-pub-link-btn')) return;
      // Inject next to the Send button
      var sendBtn = modal.querySelector('#gl-si-send');
      if(!sendBtn) return;
      var btn = document.createElement('button');
      btn.id = 'gl-pub-link-btn';
      btn.className = 'cbtn';
      btn.style.cssText = 'font-size:13px;background:rgba(124,58,237,.12);border-color:rgba(124,58,237,.35);color:#c4b5fd';
      btn.textContent = '🔗 Get public link';
      btn.onclick = async function(){
        var orig = btn.textContent;
        btn.disabled = true; btn.textContent = 'Generating…';
        // Find the invoice id from the modal title
        var titleEl = modal.querySelector('[style*="letter-spacing:2px"]');
        var m = titleEl && titleEl.textContent.match(/GL-\d+/);
        if(!m){ btn.disabled = false; btn.textContent = orig; alert('Could not detect invoice id.'); return; }
        var link = await window.glGenerateInvoiceShareLink(m[0]);
        btn.disabled = false; btn.textContent = orig;
        if(!link) return;
        try { await navigator.clipboard.writeText(link); toast('Public link copied: ' + link.slice(0, 50) + '…'); }
        catch(e){ prompt('Copy the public link:', link); }
      };
      sendBtn.parentNode.insertBefore(btn, sendBtn);
    });
    mo.observe(document.body, { childList:true, subtree:true });
  })();

  // Boot — if the URL has ?invoice_view=token, render the public page and skip everything else
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ checkInvoiceViewMode(); });
  } else {
    checkInvoiceViewMode();
  }

  console.log('[GL] customer portal — public invoice view loaded');
}());
