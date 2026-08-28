/* ============================================================
   SALES DECKS — the PDFs every quote request gets automatically.

   Mike's rule: whoever submits the public quote form should receive
   the Good Liquid capabilities/pricing deck and the Lotus Nutra R&D
   pricing deck straight away. The send itself is server-side
   (submit_quote_request → gl_send_quote_decks → the quote-decks edge
   function, migration 20260828000000); this screen is where the files
   live and where Mike swaps one out.

   The PDFs are stored in the PRIVATE `sales-decks` bucket, never in
   the repo: the Lotus deck is a confidential partner document, and
   anything committed under the site root is served publicly by Vercel.
   Staff-only RLS on both the bucket and the sales_decks table.
   ============================================================ */
(function(){
  'use strict';

  var BUCKET = 'sales-decks';
  var MAX_MB = 20;   // Mailgun caps a message at 25MB; leave room for both.

  var esc = window.glEsc || function(s){
    return String(s==null?'':s).replace(/[&<>"]/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
    });
  };

  function canEdit(){
    var r = window.currentUser && window.currentUser.role;
    return r === 'admin' || r === 'super' || r === 'sales';
  }
  function fmtSize(b){
    if(!b && b !== 0) return '';
    return b > 1048576 ? (b/1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b/1024)) + ' KB';
  }
  function fmtWhen(ts){
    if(!ts) return '';
    try { return new Date(ts).toLocaleDateString(); } catch(e){ return ''; }
  }

  window.glLoadSalesDecks = async function(){
    if(!window.supa) return [];
    var r = await window.supa.from('sales_decks')
      .select('id,key,label,filename,storage_path,active,sort_order,size_bytes,uploaded_at')
      .order('sort_order');
    if(r.error){ console.warn('[GL] sales_decks load:', r.error.message); return []; }
    return r.data || [];
  };

  window.glOpenSalesDecks = async function(){
    if(!window.supa){ alert('Supabase not ready.'); return; }
    var prior = document.getElementById('gl-sd-ov'); if(prior) prior.remove();
    var host = document.getElementById('crm-panel') || document.body;

    var ov = document.createElement('div');
    ov.id = 'gl-sd-ov';
    ov.setAttribute('style','position:fixed;inset:0;z-index:1200;background:rgba(6,13,26,.92);backdrop-filter:blur(10px);display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow:auto');
    ov.innerHTML = '<div style="background:#142238;border:1px solid rgba(0,229,192,.25);border-radius:16px;padding:24px;width:100%;max-width:600px;margin:auto">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
        '<div style="font-family:var(--ff-disp,inherit);font-size:19px;letter-spacing:1px;color:#00e5c0">📎 SALES DECKS</div>' +
        '<button id="gl-sd-close" class="cbtn" style="padding:6px 12px">✕</button>' +
      '</div>' +
      '<div style="font-size:12px;color:#9aa7bd;margin-bottom:16px;line-height:1.6">Every deck switched on here is attached automatically to the reply a lead gets the moment they submit the quote form. Files are stored privately — they are never published on the website and never shown in the customer portal.</div>' +
      '<div id="gl-sd-body"><div style="color:#9aa7bd;font-size:13px;padding:12px 0">Loading…</div></div>' +
    '</div>';
    host.appendChild(ov);
    ov.addEventListener('click', function(e){ if(e.target === ov) ov.remove(); });
    ov.querySelector('#gl-sd-close').addEventListener('click', function(){ ov.remove(); });

    await renderDecks(ov.querySelector('#gl-sd-body'));
  };

  async function renderDecks(bodyEl){
    var rows = await window.glLoadSalesDecks();
    if(!rows.length){
      bodyEl.innerHTML = '<div style="color:#ff8579;font-size:13px;padding:12px 0">Could not load the deck list. If you are signed in as staff and still see this, the sales_decks table may not have been migrated yet.</div>';
      return;
    }
    bodyEl.innerHTML = rows.map(function(d){
      var ready = !!d.storage_path;
      var state = ready
        ? '<span style="color:#5fcf9e">✓ ' + esc(fmtSize(d.size_bytes)) + (d.uploaded_at ? ' · uploaded ' + esc(fmtWhen(d.uploaded_at)) : '') + '</span>'
        : '<span style="color:#f5c842">⚠ No file yet — nothing will be attached until you upload one.</span>';
      return '<div style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,.06)">' +
        '<div style="display:flex;align-items:center;gap:10px">' +
          '<div style="flex:1;min-width:0">' +
            '<div style="font-size:14px;color:#fff">' + esc(d.label) + '</div>' +
            '<div style="font-size:11px;color:#6b87ad">Sent as: ' + esc(d.filename) + '</div>' +
            '<div style="font-size:11px;margin-top:3px">' + state + '</div>' +
          '</div>' +
          '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:#9aa7bd;cursor:pointer">' +
            '<input type="checkbox" data-active="' + esc(d.id) + '"' + (d.active ? ' checked' : '') + '> Auto-send' +
          '</label>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-top:8px">' +
          '<input type="file" accept="application/pdf,.pdf" id="gl-sd-file-' + esc(d.id) + '" ' +
            'style="flex:1;font-size:12px;color:#9aa7bd">' +
          '<button data-upload="' + esc(d.id) + '" data-key="' + esc(d.key) + '" class="cbtn pri" style="padding:6px 12px;font-size:12px">' +
            (ready ? 'Replace' : 'Upload') + '</button>' +
        '</div>' +
      '</div>';
    }).join('');

    bodyEl.querySelectorAll('[data-upload]').forEach(function(btn){
      btn.addEventListener('click', function(){ uploadDeck(btn, bodyEl); });
    });
    bodyEl.querySelectorAll('[data-active]').forEach(function(cb){
      cb.addEventListener('change', function(){ toggleDeck(cb); });
    });
  }

  async function uploadDeck(btn, bodyEl){
    if(!canEdit()){ alert('Only admin or sales can change the decks.'); return; }
    var id  = btn.getAttribute('data-upload');
    var key = btn.getAttribute('data-key');
    var inp = document.getElementById('gl-sd-file-' + id);
    var file = inp && inp.files && inp.files[0];
    if(!file){ alert('Pick a PDF first.'); return; }
    if(!/pdf$/i.test(file.name) && file.type !== 'application/pdf'){
      alert('That is not a PDF. The decks go out as PDF attachments.'); return;
    }
    if(file.size > MAX_MB * 1048576){
      alert('That file is ' + fmtSize(file.size) + '. Keep each deck under ' + MAX_MB + 'MB so the email still sends.');
      return;
    }

    var orig = btn.textContent;
    btn.textContent = 'Uploading…'; btn.disabled = true;
    try {
      // One stable object per deck, overwritten in place: the previous file is
      // replaced rather than accumulating orphans in the bucket.
      var path = key + '.pdf';
      var up = await window.supa.storage.from(BUCKET)
        .upload(path, file, { upsert: true, contentType: 'application/pdf' });
      if(up.error) throw new Error(up.error.message);

      // .select() + treat error AND 0-rows as failure (CLAUDE.md rule #4):
      // RLS rejects silently, so an unchecked update would report success while
      // the row still pointed at nothing.
      var q = await window.supa.from('sales_decks').update({
        storage_path: path,
        size_bytes:   file.size,
        uploaded_at:  new Date().toISOString(),
        updated_at:   new Date().toISOString()
      }).eq('id', id).select('id,key');
      if(q.error || !(q.data && q.data.length)){
        throw new Error(q.error ? q.error.message
          : 'the server rejected the change (0 rows). Are you signed in as staff?');
      }

      btn.textContent = '✓ Saved'; btn.style.color = '#5fcf9e';
      if(typeof window.glAudit === 'function') window.glAudit('sales_deck_uploaded', key, { size: file.size });
      setTimeout(function(){ renderDecks(bodyEl); }, 900);
    } catch(e){
      btn.textContent = orig; btn.disabled = false;
      console.error('[GL] deck upload', e);
      alert('Not uploaded: ' + (e.message || e));
    }
  }

  async function toggleDeck(cb){
    if(!canEdit()){ alert('Only admin or sales can change the decks.'); cb.checked = !cb.checked; return; }
    var id = cb.getAttribute('data-active');
    var want = cb.checked;
    cb.disabled = true;
    try {
      var q = await window.supa.from('sales_decks')
        .update({ active: want, updated_at: new Date().toISOString() })
        .eq('id', id).select('id,key,active');
      if(q.error || !(q.data && q.data.length)){
        throw new Error(q.error ? q.error.message
          : 'the server rejected the change (0 rows). Are you signed in as staff?');
      }
      if(typeof window.glAudit === 'function') window.glAudit('sales_deck_toggled', q.data[0].key, { active: want });
    } catch(e){
      cb.checked = !want;
      console.error('[GL] deck toggle', e);
      alert('Not saved: ' + (e.message || e));
    } finally {
      cb.disabled = false;
    }
  }

  // Resend the decks to one lead by hand — the same edge function the quote
  // form fires, called with the staff session, so it re-sends even if this
  // address already had them (the automated path can never do that).
  window.glSendDecksToDeal = async function(dealId){
    if(!window.supa){ alert('Supabase not ready.'); return; }
    if(!dealId){ alert('No lead selected.'); return; }
    if(!confirm('Email our sales decks to this lead now?')) return;
    try {
      var r = await window.supa.functions.invoke('quote-decks', { body: { deal_id: dealId, force: true } });
      if(r.error) throw new Error(r.error.message || 'send failed');
      var d = r.data || {};
      if(d.sent) alert('✓ Decks sent to ' + (d.to || 'the lead') + '.');
      else alert('Nothing was sent: ' + (d.skipped || 'no deck files uploaded yet — see 📎 Sales Decks.'));
    } catch(e){
      console.error('[GL] resend decks', e);
      alert('Could not send the decks: ' + (e.message || e));
    }
  };

  console.log('[GL] sales-decks manager loaded');
}());
