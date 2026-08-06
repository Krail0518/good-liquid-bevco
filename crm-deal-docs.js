/* ============================================================
   crm-deal-docs.js — document storage for pipeline deals & clients
   ============================================================
   Customers routinely send an NDA, a Process Authority letter, formulas and
   label artwork while a deal is still in the pipeline — before there's a
   client record to hang them on. This module gives a deal its own Documents
   card (upload / view / download / delete), backed by the deal_documents table
   (migration: deal_documents). Files live in the shared client-docs bucket;
   the row just indexes the path.

   The SAME card renders on the client detail popup (filtered by client_id), so
   once a lead is converted the carried-over docs show up there. The actual
   hand-off — stamping client_id onto the rows and filing the PA letter / labels
   into the client's dedicated homes — happens in crm-onboarding.js at convert
   time; this module only reads/writes deal_documents and renders the UI.

   Exposes:
     window.glRenderDealDocs(mount, { dealId | clientId })
     window.GL_DEAL_DOC_TYPES  — the ordered doc-type list (shared with convert)
   ============================================================ */
(function(){
  'use strict';

  function sb(){ return window.supa || null; }
  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"]/g, function(c){
      return { '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' }[c];
    });
  }
  function elOf(m){ return typeof m === 'string' ? document.querySelector(m) : m; }

  // The document types a deal can carry. Order = dropdown order. The first four
  // are the ones Mike asked for by name; "Other" is the catch-all. Convert-time
  // routing in crm-onboarding.js keys off these exact strings.
  var DOC_TYPES = ['NDA', 'Process Authority Letter', 'Formula', 'Label / Artwork', 'Other'];
  window.GL_DEAL_DOC_TYPES = DOC_TYPES;

  // A little colour per type so the list scans quickly.
  var TYPE_STYLE = {
    'NDA':                     { icon:'🔒', bg:'rgba(26,111,255,.15)',  fg:'#6b9fff', br:'rgba(26,111,255,.35)' },
    'Process Authority Letter':{ icon:'📜', bg:'rgba(245,200,66,.15)',  fg:'#f5c842', br:'rgba(245,200,66,.35)' },
    'Formula':                 { icon:'⚗️', bg:'rgba(196,164,248,.15)', fg:'#c4a4f8', br:'rgba(196,164,248,.35)' },
    'Label / Artwork':         { icon:'🎨', bg:'rgba(0,229,192,.14)',   fg:'#00e5c0', br:'rgba(0,229,192,.35)' },
    'Other':                   { icon:'📄', bg:'rgba(255,255,255,.06)', fg:'#9aa7bd', br:'rgba(255,255,255,.14)' }
  };
  function typeStyle(t){ return TYPE_STYLE[t] || TYPE_STYLE['Other']; }

  // Upload a file into the client-docs bucket. Deal docs go under deal/<id>/…,
  // client-originated docs under <clientId>/docs/… — either way the path is all
  // the signed-URL helpers (glOpenClientDoc / glDownloadClientDoc) need.
  function uploadFile(scope, file){
    window.__lastDealDocError = '';
    if(!file || !sb()){ window.__lastDealDocError = 'Not signed in / storage unavailable'; return Promise.resolve(''); }
    var ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    var base = scope.dealId ? ('deal/' + scope.dealId) : (scope.clientId + '/docs');
    var path = base + '/' + Date.now() + '_' + Math.random().toString(36).slice(2,7) + '.' + ext;
    return sb().storage.from('client-docs').upload(path, file, { cacheControl:'3600', upsert:false })
      .then(function(r){
        if(r.error){ window.__lastDealDocError = (r.error && (r.error.message || r.error.error)) || 'upload rejected'; return ''; }
        return path;
      })
      .catch(function(e){ window.__lastDealDocError = (e && e.message) || String(e); return ''; });
  }

  function viewLinks(fp){
    if(!fp) return '<span style="color:#f5c842">⚠ no file stored</span>';
    var p = esc(String(fp).replace(/'/g,''));
    return '<a href="#" onclick="event.preventDefault();window.glOpenClientDoc(\''+p+'\')" style="color:#00e5c0;font-weight:700">📄 View</a>' +
      ' <a href="#" onclick="event.preventDefault();window.glDownloadClientDoc(\''+p+'\')" style="color:#00e5c0;font-weight:700">⬇ Download</a>';
  }

  function docRow(r){
    var st = typeStyle(r.doc_type);
    return '<div class="gl-dd-row" data-id="'+esc(r.id)+'" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:10px 0;border-top:1px solid rgba(255,255,255,.06)">' +
        '<div style="min-width:0">' +
          '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">' +
            '<span style="padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;background:'+st.bg+';color:'+st.fg+';border:1px solid '+st.br+'">'+st.icon+' '+esc(r.doc_type)+'</span>' +
            '<span style="font-weight:700;color:#eef4ff;font-size:13px">'+esc(r.name || '(unnamed)')+'</span>' +
          '</div>' +
          (r.notes ? '<div style="font-size:11.5px;color:#9aa7bd;margin-top:3px">'+esc(r.notes)+'</div>' : '') +
          '<div style="font-size:12px;margin-top:4px">'+viewLinks(r.file_path)+'</div>' +
        '</div>' +
        '<button class="gl-dd-del" data-id="'+esc(r.id)+'" title="Remove document" style="background:none;border:none;color:#ff8579;cursor:pointer;font-size:15px;flex-shrink:0">🗑</button>' +
      '</div>';
  }

  // Render the Documents card into `mount`. Pass { dealId } on the pipeline deal
  // panel or { clientId } on the client detail popup. New uploads inherit
  // whichever id was given, so a doc added on the deal is tied to the deal and a
  // doc added on the client is tied to the client.
  window.glRenderDealDocs = async function glRenderDealDocs(mount, opts){
    var host = elOf(mount);
    if(!host) return;
    opts = opts || {};
    var dealId = opts.dealId || null, clientId = opts.clientId || null;
    if(!dealId && !clientId){ host.innerHTML = ''; return; }
    if(!sb()){ host.innerHTML = '<div style="font-size:11px;color:#9aa7bd">Storage not ready.</div>'; return; }

    var title = '<div style="font-size:10px;letter-spacing:2px;color:var(--teal);margin-bottom:2px">📎 DOCUMENTS</div>' +
      '<div style="font-size:11px;color:#9aa7bd;margin-bottom:8px">' +
      (dealId ? 'NDAs, Process Authority letters, formulas and label artwork for this lead. They carry over automatically when you convert to a client.'
              : 'Documents on file for this client, including anything carried over from the pipeline.') + '</div>';

    host.innerHTML = title + '<div style="font-size:11px;color:#9aa7bd">Loading documents…</div>';

    var q = sb().from('deal_documents').select('*');
    q = dealId ? q.eq('deal_id', dealId) : q.eq('client_id', clientId);
    var rows = [];
    try { var r = await q.order('created_at', { ascending:false }); if(r.error) throw r.error; rows = r.data || []; }
    catch(e){ host.innerHTML = title + '<div style="font-size:11px;color:#ff8579">Could not load documents: '+esc(e.message||e)+'</div>'; return; }

    var inp = 'width:100%;padding:9px 10px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px';
    var typeOpts = DOC_TYPES.map(function(t){ return '<option value="'+esc(t)+'">'+esc(t)+'</option>'; }).join('');

    host.innerHTML = title +
      (rows.length ? rows.map(docRow).join('') : '<div style="font-size:12px;color:#9aa7bd;padding:6px 0">No documents yet. Add the first one below.</div>') +
      '<div style="border-top:1px solid rgba(255,255,255,.06);margin-top:8px;padding-top:10px">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<select class="gl-dd-type" style="'+inp+'">'+typeOpts+'</select>' +
          '<input class="gl-dd-name" placeholder="Document name (e.g. Mango NDA)" style="'+inp+'">' +
        '</div>' +
        '<input class="gl-dd-notes" placeholder="Notes (optional)" style="'+inp+';margin-top:8px">' +
        '<div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">' +
          '<input class="gl-dd-file" type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ai,.eps,.svg,.txt" style="'+inp+';flex:1;min-width:180px;padding:7px">' +
          '<button class="gl-dd-add" style="padding:9px 16px;background:rgba(0,229,192,.14);border:1px solid rgba(0,229,192,.35);border-radius:8px;color:#00e5c0;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap">＋ Add Document</button>' +
        '</div>' +
        '<div class="gl-dd-msg" style="display:none;font-size:12px;margin-top:8px"></div>' +
      '</div>';

    var msg = host.querySelector('.gl-dd-msg');
    function show(color, text){ msg.style.display='block'; msg.style.color=color; msg.textContent=text; }

    // Prefill the name field from the chosen type for a quicker add.
    var nameEl = host.querySelector('.gl-dd-name');
    host.querySelector('.gl-dd-type').addEventListener('change', function(){
      if(!nameEl.value.trim() && this.value !== 'Other') nameEl.value = this.value;
    });

    host.querySelector('.gl-dd-add').addEventListener('click', async function(){
      var btn = this;
      var type = host.querySelector('.gl-dd-type').value;
      var name = (nameEl.value || '').trim();
      var notes = (host.querySelector('.gl-dd-notes').value || '').trim();
      var fileEl = host.querySelector('.gl-dd-file');
      var file = fileEl.files && fileEl.files[0];
      if(!file){ show('#f5c842','Choose a file to upload.'); return; }
      if(!name) name = type;  // fall back to the type as the name
      btn.disabled = true; btn.textContent = 'Uploading…';
      var path = await uploadFile({ dealId: dealId, clientId: clientId }, file);
      if(!path){ btn.disabled=false; btn.textContent='＋ Add Document'; show('#ff8579','Upload failed'+(window.__lastDealDocError?(' ('+window.__lastDealDocError+')'):'')+'. Try again.'); return; }
      var uploader = (window.currentUser && (window.currentUser.name || window.currentUser.email)) || 'Staff';
      try {
        var ins = await sb().from('deal_documents').insert([{
          deal_id: dealId, client_id: clientId,
          doc_type: type, name: name, notes: notes || null,
          file_path: path, file_type: (file.name.split('.').pop()||'').toLowerCase(),
          uploaded_by: uploader
        }]);
        if(ins.error) throw ins.error;
      } catch(e){ btn.disabled=false; btn.textContent='＋ Add Document'; show('#ff8579','Save failed: '+(e.message||e)); return; }
      if(typeof window.glAudit === 'function') window.glAudit('deal_doc_added', name, { type: type, deal: dealId, client: clientId });
      glRenderDealDocs(host, opts); // re-render fresh
    });

    Array.prototype.forEach.call(host.querySelectorAll('.gl-dd-del'), function(b){
      b.addEventListener('click', async function(){
        if(!confirm('Remove this document?')) return;
        var id = this.getAttribute('data-id');
        try { await sb().from('deal_documents').delete().eq('id', id); } catch(e){}
        glRenderDealDocs(host, opts);
      });
    });
  };

  console.log('[GL] deal-documents module loaded');
}());
