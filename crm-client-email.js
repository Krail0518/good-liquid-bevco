/* ============================================================
   CLIENT EMAIL THREAD
   Injects an email compose + history panel into the Edit Client
   modal so Mike can send and track emails per client without
   leaving the CRM.

   Sends via window.sendMailgunEmail (Mailgun edge function) with
   replyTo: mike@goodliquid.com so client replies land in the inbox.
   History loads from email_log filtered by the client's email.
   ============================================================ */
(function(){
  'use strict';
  var esc = window.glEsc;

  var REPLY_TO = 'mike@goodliquid.com';

  var INPUT_STYLE = 'width:100%;padding:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;font-size:13px;font-family:var(--ff-body);box-sizing:border-box';
  var LABEL_STYLE = 'font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:5px';

  function fmt(s){
    if(!s) return '';
    try { return new Date(s).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}); }
    catch(e){ return s; }
  }

  // Matches the STATUS_COLOR map in crm-email.js so the same row looks
  // identical in the Email Activity modal and the per-client thread.
  function statusColor(s){
    return s === 'opened'    ? '#1a6fff'
         : s === 'clicked'   ? '#7c3aed'
         : s === 'delivered' ? '#5fcf9e'
         : s === 'sent'      ? '#5fcf9e'
         : s === 'failed'    ? '#ff8579'
         : s === 'bounced'   ? '#ff8579'
         : '#6b87ad';
  }

  async function loadHistory(clientEmail, histEl){
    if(!histEl) return;
    var sb = window.supa;
    if(!sb){
      histEl.innerHTML = '<div style="font-size:11px;color:var(--muted);text-align:center;padding:8px">Not connected.</div>';
      return;
    }
    // Escape LIKE wildcards so an address like mike_jones@co.com doesn't
    // expand _ as a single-char wildcard and return cross-client rows.
    var safe = clientEmail.replace(/%/g,'\\%').replace(/_/g,'\\_');
    var r = await sb.from('email_log')
      .select('to_email, subject, body_preview, status, sent_at, created_at')
      .ilike('to_email', '%' + safe + '%')
      .order('created_at', { ascending: false })
      .limit(30);

    if(r.error){
      histEl.innerHTML = '<div style="font-size:11px;color:#ff8579;text-align:center;padding:12px">Could not load history.</div>';
      return;
    }
    var rows = r.data || [];
    if(!rows.length){
      histEl.innerHTML = '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px">No emails sent yet.</div>';
      return;
    }
    histEl.innerHTML = rows.map(function(row){
      return '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:10px">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px">' +
          '<div style="font-size:12px;color:var(--white);font-weight:600;line-height:1.3">' + esc(row.subject) + '</div>' +
          '<div style="font-size:10px;color:' + statusColor(row.status) + ';white-space:nowrap;flex-shrink:0">' + esc(row.status||'') + '</div>' +
        '</div>' +
        (row.body_preview ? '<div style="font-size:11px;color:#9aa7bd;line-height:1.4;margin-bottom:4px;white-space:pre-wrap">' + esc(row.body_preview) + '</div>' : '') +
        '<div style="font-size:10px;color:rgba(154,167,189,.5)">' + fmt(row.sent_at || row.created_at) + '</div>' +
      '</div>';
    }).join('');
  }

  function injectEmailPanel(modal, client){
    if(!client || !client.email) return;
    if(modal.querySelector('#gl-ce-panel')) return;

    var card = modal.firstElementChild;
    if(!card) return;

    var panel = document.createElement('div');
    panel.id = 'gl-ce-panel';
    panel.style.cssText = 'border-top:1px solid rgba(255,255,255,.07);margin-top:22px;padding-top:20px';
    panel.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<div style="font-size:10px;letter-spacing:2px;color:var(--teal)">📧 EMAIL THREAD</div>' +
        '<span style="font-size:11px;color:var(--muted)">' + esc(client.email) + '</span>' +
      '</div>' +
      '<div id="gl-ce-history" style="max-height:220px;overflow-y:auto;margin-bottom:14px;display:flex;flex-direction:column;gap:7px">' +
        '<div style="font-size:11px;color:var(--muted);text-align:center;padding:12px">Loading…</div>' +
      '</div>' +
      '<div style="background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:14px">' +
        '<div style="' + LABEL_STYLE + ';margin-bottom:10px">COMPOSE</div>' +
        '<input id="gl-ce-subject" placeholder="Subject" style="' + INPUT_STYLE + ';margin-bottom:8px">' +
        '<textarea id="gl-ce-body" rows="5" placeholder="Hi [name],&#10;&#10;" style="' + INPUT_STYLE + ';resize:vertical;margin-bottom:10px"></textarea>' +
        '<div style="display:flex;gap:10px;align-items:center">' +
          '<button id="gl-ce-send" class="cbtn pri" style="font-size:12px;padding:8px 18px">📤 Send</button>' +
          '<span style="font-size:10px;color:rgba(154,167,189,.5)">Replies → ' + REPLY_TO + '</span>' +
          '<span id="gl-ce-status" style="font-size:11px;margin-left:auto"></span>' +
        '</div>' +
      '</div>';

    card.appendChild(panel);

    // Load existing history
    loadHistory(client.email, panel.querySelector('#gl-ce-history'));

    // Send handler
    panel.querySelector('#gl-ce-send').addEventListener('click', async function(){
      var subj    = (panel.querySelector('#gl-ce-subject').value || '').trim();
      var body    = (panel.querySelector('#gl-ce-body').value || '').trim();
      var statusEl = panel.querySelector('#gl-ce-status');
      var sendBtn  = panel.querySelector('#gl-ce-send');

      if(!subj){ statusEl.style.color = '#ff8579'; statusEl.textContent = 'Subject is required.'; return; }
      if(!body){ statusEl.style.color = '#ff8579'; statusEl.textContent = 'Message is required.'; return; }

      sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
      statusEl.textContent = ''; statusEl.style.color = 'var(--muted)';

      try {
        var ok = await window.sendMailgunEmail(client.email, subj, body, {
          replyTo: REPLY_TO
        });
        if(ok){
          panel.querySelector('#gl-ce-subject').value = '';
          panel.querySelector('#gl-ce-body').value = '';
          statusEl.style.color = '#1D9E75';
          statusEl.textContent = '✓ Sent';
          setTimeout(function(){ statusEl.textContent = ''; }, 3500);
          // Reload history to show the new send
          setTimeout(function(){
            loadHistory(client.email, panel.querySelector('#gl-ce-history'));
          }, 800);
        } else {
          statusEl.style.color = '#ff8579';
          statusEl.textContent = 'Send failed — check Mailgun settings.';
        }
      } catch(e){
        statusEl.style.color = '#ff8579';
        statusEl.textContent = 'Error: ' + (e.message || 'unknown');
      } finally {
        sendBtn.disabled = false; sendBtn.textContent = '📤 Send';
      }
    });
  }

  // Wrap glOpenEditClient to inject the email panel after the modal opens.
  // crm-edit-client.js always loads before this file, so glOpenEditClient
  // is guaranteed to be defined synchronously at this point.
  (function(){
    var orig = window.glOpenEditClient;
    if(typeof orig !== 'function') return; // defensive only; should never be false
    window.glOpenEditClient = function(clientId){
      var r = orig.apply(this, arguments);
      setTimeout(function(){
        var modal = document.getElementById('gl-edit-client-modal');
        if(!modal) return;
        var client = (window.clients||[]).find(function(c){ return c.id === clientId; });
        injectEmailPanel(modal, client);
      }, 80);
      return r;
    };
  }());

  console.log('[GL] client email thread loaded');
}());
