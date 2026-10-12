/* ============================================================
   sales-decks.js — Sales Decks admin screen
   ============================================================
   Admin-only. Opened from 🤖 AI Tools → Settings & Integrations →
   📑 Sales Decks (window.glOpenSalesDecks).

   What it manages: public.sales_decks, the PDFs Good Liquid sends to
   prospects. The one marked AUTO-SEND is emailed automatically by the
   quote-decks edge function to every new website quote request, once per
   prospect (migration 20261012050000_quote_decks.sql).

   Per deck: label, file name, size, upload date, an auto-send toggle, and
   "Upload / replace PDF". Uploads go to the private 'sales-decks' bucket at
   <key>/<filename> with the staff session; the row is then updated with a
   checked write (CLAUDE.md rule 4). Storage and table writes are admin-only
   in the database too (restrictive policies), not just hidden here.

   Auto-send rules:
     • At most one deck at a time (a unique index enforces it; turning one on
       turns the other off first).
     • A deck whose label says "confidential" asks for an explicit second step
       before it is turned on — and the sender refuses such a deck anyway, as
       it does any deck that names a client. lotus_nutra_pricing is another
       client's confidential pricing and must never reach a prospect.
     • No confirm(): Chrome suppresses it (CRM_FEATURE_MAP §11.6). The second
       step is an inline Yes/Cancel row.

   Controls use data-gl-action (src/shared/action-registry.js). No innerHTML:
   every node is built with h() and text goes in with textContent, so a deck
   label or file name can never become markup.
   ============================================================ */
(function(){
  'use strict';

  var BUCKET = 'sales-decks';
  var MODAL_ID = 'gl-sd-modal';
  // Gmail caps a message at 25 MB and base64 adds a third; the quote-decks
  // function refuses anything bigger than this too.
  var MAX_BYTES = 15 * 1024 * 1024;

  var state = { decks: [], pendingConfirm: null, status: {}, banner: null };

  function sb(){ return window.supa || null; }
  function isAdmin(){ return !!(window.currentUser && window.currentUser.role === 'admin'); }
  function audit(action, target, meta){
    if(typeof window.glAudit === 'function') window.glAudit(action, target, meta || {});
  }

  /* h('div', {style:'…', text:'…', 'data-gl-action':'x'}, [children]) — no
     event-handler attributes: actions go through the delegated dispatcher. */
  function h(tag, attrs, kids){
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function(k){
      var v = attrs[k];
      if(v == null || v === false) return;
      if(k === 'text') el.textContent = String(v);
      else if(k === 'style') el.setAttribute('style', v);
      else if(k === 'checked') el.checked = !!v;
      else if(/^on/i.test(k)) throw new Error('sales-decks: use data-gl-action, not ' + k);
      else el.setAttribute(k, v === true ? '' : String(v));
    });
    (kids || []).forEach(function(c){
      if(c == null || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  var S = {
    overlay: 'position:fixed;inset:0;z-index:960;background:rgba(6,13,26,.9);backdrop-filter:blur(8px);display:flex;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto',
    card:    'background:#0d1f35;border:1px solid rgba(26,111,255,.25);border-radius:16px;width:100%;max-width:760px;padding:22px;margin:auto;color:#fff;box-sizing:border-box',
    title:   'font-family:var(--ff-disp);font-size:19px;letter-spacing:2.5px;color:#1a6fff',
    row:     'background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:14px;margin-bottom:12px',
    meta:    'font-size:12px;color:#9aa7bd;margin-top:4px;line-height:1.6;word-break:break-word',
    btn:     'display:inline-block;padding:8px 13px;border-radius:8px;font-weight:700;font-size:12.5px;cursor:pointer;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:#fff',
    btnWarn: 'padding:8px 13px;border-radius:8px;font-weight:800;font-size:12.5px;cursor:pointer;border:none;background:#e0a526;color:#1b1300'
  };

  function fmtSize(n){
    n = Number(n) || 0;
    if(!n) return '—';
    if(n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    return Math.max(1, Math.round(n / 1024)) + ' KB';
  }
  function fmtDate(iso){
    if(!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString();
  }
  function looksConfidential(d){ return /confidential/i.test(String((d && d.label) || '') + ' ' + String((d && d.key) || '')); }
  function findDeck(id){ return state.decks.find(function(d){ return d.id === id; }) || null; }

  // Storage object names: keep it readable but boring. No path separators, no
  // control characters, always .pdf.
  function safePdfName(name){
    var base = String(name || 'deck.pdf').replace(/\.pdf$/i, '')
      .replace(/[^A-Za-z0-9 ._()&,-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    return (base || 'deck') + '.pdf';
  }

  /* ── Render ────────────────────────────────────────────────── */
  function modal(){ return document.getElementById(MODAL_ID); }

  function setBanner(msg, color){ state.banner = msg ? { msg: msg, color: color } : null; render(); }
  function setRowStatus(id, msg, color){ state.status[id] = msg ? { msg: msg, color: color } : null; render(); }

  function deckRow(d){
    var hasPdf = !!d.storage_path;
    var autoId = 'gl-sd-auto-' + d.id;
    var fileId = 'gl-sd-file-' + d.id;
    var conf = looksConfidential(d);
    var st = state.status[d.id];

    var kids = [
      h('div', { style:'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:flex-start' }, [
        h('div', { style:'min-width:0;flex:1 1 260px' }, [
          h('div', { style:'font-weight:800;font-size:14px;word-break:break-word', text: d.label || d.key }),
          h('div', { style:S.meta, 'data-sd-field':'meta', text:
            'File: ' + (d.filename || '—') + ' · ' + fmtSize(d.size_bytes) + ' · ' +
            (hasPdf ? 'uploaded ' + fmtDate(d.uploaded_at) : 'No PDF uploaded yet') +
            (d.active === false ? ' · inactive' : '') }),
          conf ? h('div', { style:'font-size:11.5px;color:#ffb35c;margin-top:4px', text:'⚠️ Confidential: never send this to prospects.' }) : null
        ]),
        h('div', { style:'display:flex;flex-direction:column;gap:8px;align-items:flex-end' }, [
          h('label', { 'for':autoId, style:'display:flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer;white-space:nowrap' }, [
            h('input', { type:'checkbox', id:autoId, checked: d.auto_send === true,
              'data-gl-on':'change', 'data-gl-action':'glSalesDeckSetAuto', 'data-gl-arg1':d.id, 'data-gl-el':true,
              'aria-label':'Auto-send ' + (d.label || d.key) + ' to new quote requests' }),
            'Auto-send to new quote requests'
          ]),
          h('label', { 'for':fileId, style:S.btn, text: hasPdf ? '⬆ Replace PDF' : '⬆ Upload PDF' }),
          h('input', { type:'file', id:fileId, accept:'application/pdf,.pdf', style:'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none',
            'data-gl-on':'change', 'data-gl-action':'glSalesDeckUpload', 'data-gl-arg1':d.id, 'data-gl-el':true,
            'aria-label':'Upload or replace the PDF for ' + (d.label || d.key) })
        ])
      ])
    ];

    if(state.pendingConfirm === d.id){
      kids.push(h('div', { style:'margin-top:12px;padding:12px;border-radius:8px;background:rgba(224,165,38,.1);border:1px solid rgba(224,165,38,.5)', 'data-sd-confirm':d.id }, [
        h('div', { style:'font-size:12.5px;line-height:1.6;color:#ffd58a', text:
          'This deck is labelled CONFIDENTIAL. Auto-send emails it to every stranger who fills in the website quote form. ' +
          'The sender refuses decks labelled confidential or naming a client, so nothing will go out, and you will get an alert for each lead instead. Turn it on anyway?' }),
        h('div', { style:'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, [
          h('button', { type:'button', style:S.btnWarn, 'data-gl-action':'glSalesDeckConfirmAuto', 'data-gl-arg1':d.id, text:'Yes, turn on auto-send' }),
          h('button', { type:'button', style:S.btn, 'data-gl-action':'glSalesDeckCancelAuto', text:'Cancel' })
        ])
      ]));
    }
    if(st) kids.push(h('div', { style:'font-size:12px;margin-top:8px;color:' + (st.color || '#9aa7bd'), 'data-sd-status':d.id, text: st.msg }));
    return h('div', { style:S.row, 'data-sd-deck':d.key }, kids);
  }

  function render(){
    var ov = modal();
    if(!ov) return;
    var body = ov.querySelector('[data-sd-body]');
    if(!body) return;
    while(body.firstChild) body.removeChild(body.firstChild);
    if(state.banner) body.appendChild(h('div', { style:'font-size:12.5px;margin-bottom:10px;color:' + (state.banner.color || '#9aa7bd'), 'data-sd-banner':'', text: state.banner.msg }));
    if(!state.decks.length && !state.banner) body.appendChild(h('div', { style:S.meta, text:'No sales decks yet.' }));
    state.decks.forEach(function(d){ body.appendChild(deckRow(d)); });
  }

  async function load(){
    var r = await sb().from('sales_decks')
      .select('id,key,label,filename,storage_path,active,auto_send,sort_order,size_bytes,uploaded_at')
      .order('sort_order', { ascending: true });
    if(r.error){ state.decks = []; setBanner('Could not load sales decks: ' + r.error.message, '#ff8579'); return false; }
    state.decks = r.data || [];
    render();
    return true;
  }

  /* ── Open ─────────────────────────────────────────────────── */
  window.glOpenSalesDecks = async function glOpenSalesDecks(){
    if(!isAdmin()){ alert('Admin only.'); return; }
    if(!sb()){ alert('Not connected to the database.'); return; }
    var prior = modal(); if(prior) prior.remove();
    state = { decks: [], pendingConfirm: null, status: {}, banner: { msg:'Loading…' } };
    var ov = h('div', { id:MODAL_ID, style:S.overlay, role:'dialog', 'aria-modal':'true', 'aria-label':'Sales decks' }, [
      h('div', { style:S.card }, [
        h('div', { style:'display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px' }, [
          h('div', {}, [
            h('div', { style:S.title, text:'📑 SALES DECKS' }),
            h('div', { style:'font-size:12px;color:#9aa7bd;margin-top:4px;line-height:1.6', text:
              'The deck marked auto-send is emailed, as a PDF attachment from mike@goodliquid.com, to every new website quote request, once per prospect. ' +
              'Only one deck can auto-send at a time. PDF only, up to 15 MB. If sending fails, or no PDF is uploaded, you get an alert.' })
          ]),
          h('button', { type:'button', style:'background:none;border:1px solid rgba(255,255,255,.15);border-radius:8px;color:#fff;font-size:15px;cursor:pointer;padding:4px 10px',
            'data-gl-close':'#' + MODAL_ID, 'aria-label':'Close', text:'✕' })
        ]),
        h('div', { 'data-sd-body':'' })
      ])
    ]);
    (document.getElementById('crm-panel') || document.body).appendChild(ov);
    render();
    state.banner = null;
    await load();
  };

  /* ── Upload / replace ─────────────────────────────────────── */
  window.glSalesDeckUpload = async function glSalesDeckUpload(id, input){
    if(!isAdmin()) return;
    var d = findDeck(id);
    var file = input && input.files && input.files[0];
    if(!d || !file) return;
    try { input.value = ''; } catch(e){}

    var isPdfType = file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '');
    if(!isPdfType){ setRowStatus(id, 'That is not a PDF. Choose a .pdf file.', '#ff8579'); return; }
    if(file.size > MAX_BYTES){ setRowStatus(id, 'That PDF is ' + fmtSize(file.size) + '. The limit is 15 MB (Gmail cannot attach more). Export a smaller PDF.', '#ff8579'); return; }
    if(!file.size){ setRowStatus(id, 'That file is empty.', '#ff8579'); return; }
    try {
      var head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if(String.fromCharCode.apply(null, head) !== '%PDF-'){ setRowStatus(id, 'That file is not really a PDF (it does not start with %PDF). Export it as PDF and try again.', '#ff8579'); return; }
    } catch(e){ /* cannot read the header here; the sender checks it again */ }

    var name = safePdfName(file.name);
    var path = d.key + '/' + name;
    setRowStatus(id, 'Uploading ' + name + '…', '#9aa7bd');

    var up = await sb().storage.from(BUCKET).upload(path, file, { upsert: true, contentType: 'application/pdf', cacheControl: '60' });
    if(up.error){ setRowStatus(id, 'Upload failed: ' + up.error.message, '#ff8579'); return; }

    var oldPath = d.storage_path;
    var patch = { storage_path: path, filename: name, size_bytes: file.size, uploaded_at: new Date().toISOString() };
    var u = await sb().from('sales_decks').update(patch).eq('id', id)
      .select('id,storage_path,filename,size_bytes,uploaded_at');
    if(u.error){ setRowStatus(id, 'The PDF uploaded but the deck was not updated: ' + u.error.message, '#ff8579'); return; }
    if(!u.data || !u.data.length){ setRowStatus(id, 'The PDF uploaded but the database did not accept the change (admin only).', '#ff8579'); return; }

    // The previous file, if it had a different name, is now unreferenced.
    if(oldPath && oldPath !== path){
      var rm = await sb().storage.from(BUCKET).remove([oldPath]);
      if(rm.error) console.warn('[sales-decks] old PDF not removed', oldPath, rm.error.message);
    }
    audit('sales_deck_uploaded', d.key, { filename: name, size_bytes: file.size });
    await load();
    setRowStatus(id, '✓ Uploaded ' + name + ' (' + fmtSize(file.size) + ').', '#5fcf9e');
  };

  /* ── Auto-send ────────────────────────────────────────────── */
  async function setAuto(id, on){
    var d = findDeck(id);
    if(!d) return;
    state.pendingConfirm = null;
    if(on){
      // One at a time: turn any other off first (unique index), and expect the
      // database to report exactly the rows we believe are on.
      var others = state.decks.filter(function(x){ return x.id !== id && x.auto_send === true; });
      if(others.length){
        var off = await sb().from('sales_decks').update({ auto_send: false }).eq('auto_send', true).neq('id', id).select('id');
        if(off.error){ setRowStatus(id, 'Could not turn off the other auto-send deck: ' + off.error.message, '#ff8579'); await load(); return; }
        if(!off.data || off.data.length !== others.length){ setRowStatus(id, 'Could not turn off the other auto-send deck (the database changed nothing). Nothing was changed.', '#ff8579'); await load(); return; }
      }
    }
    var u = await sb().from('sales_decks').update({ auto_send: !!on }).eq('id', id).select('id,auto_send');
    if(u.error){ setRowStatus(id, 'Auto-send was not changed: ' + u.error.message, '#ff8579'); await load(); return; }
    if(!u.data || !u.data.length || u.data[0].auto_send !== !!on){ setRowStatus(id, 'Auto-send was not changed (the database did not accept it).', '#ff8579'); await load(); return; }
    audit(on ? 'sales_deck_auto_send_on' : 'sales_deck_auto_send_off', d.key, {});
    await load();
    setRowStatus(id, on
      ? (d.storage_path ? '✓ Auto-send is on. New website quote requests get this deck.' : '✓ Auto-send is on, but no PDF is uploaded yet, so nothing will be sent until you upload one.')
      : 'Auto-send is off. New quote requests get no deck.', on ? '#5fcf9e' : '#9aa7bd');
  }

  window.glSalesDeckSetAuto = function glSalesDeckSetAuto(id, box){
    if(!isAdmin()) return;
    var d = findDeck(id);
    if(!d) return;
    var want = !!(box && box.checked);
    // Show the stored value until the database confirms a change.
    if(box) box.checked = d.auto_send === true;
    if(want && looksConfidential(d)){ state.pendingConfirm = id; state.status[id] = null; render(); return; }
    return setAuto(id, want);
  };
  window.glSalesDeckConfirmAuto = function glSalesDeckConfirmAuto(id){
    if(!isAdmin() || state.pendingConfirm !== id) return;
    return setAuto(id, true);
  };
  window.glSalesDeckCancelAuto = function glSalesDeckCancelAuto(){
    state.pendingConfirm = null;
    render();
  };

  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape'){ var m = modal(); if(m) m.remove(); }
  });
}());
