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
  var esc = window.glEsc;

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
