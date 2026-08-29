/* ============================================================
   artwork.js — per-client label artwork, multiple SKUs
   ============================================================
   One row per SKU in client_artwork; each SKU carries a name, optional notes,
   an approval status, and an uploaded artwork file (client-docs bucket, opened
   via signed URLs). The same section renders in two places:
     • the staff client card (window.glRenderArtwork(clientId, mount))
     • the customer portal (same call, with the customer's own client id)

   Exposes:
     window.glRenderArtwork(clientId, mountElOrId)  — list + "add SKU" form
   Reuses window.glOpenClientDoc / glDownloadClientDoc for view/download.
   ============================================================ */
(function(){
  'use strict';

  function sb(){ return window.supa || null; }
  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"]/g, function(c){
      return { '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;' }[c];
    });
  }
  function elOf(m){ return typeof m === 'string' ? document.getElementById(m) : m; }

  var STATUS = {
    submitted: ['Submitted', 'rgba(245,200,66,.15)', '#f5c842'],
    in_review: ['In review', 'rgba(0,229,192,.14)', '#00e5c0'],
    approved:  ['Approved',  'rgba(29,158,117,.16)', '#5fcf9e'],
    rejected:  ['Rejected',  'rgba(231,76,60,.16)',  '#ff8579']
  };

  async function uploadArtwork(clientId, file){
    window.__lastUploadError = '';
    if(!file || !sb()){ window.__lastUploadError = 'Not signed in / storage unavailable'; return ''; }
    var ext = (file.name.split('.').pop() || 'png').toLowerCase();
    var path = clientId + '/artwork/' + Date.now() + '_' + Math.random().toString(36).slice(2,7) + '.' + ext;
    try {
      var r = await sb().storage.from('client-docs').upload(path, file, { cacheControl:'3600', upsert:false });
      if(r.error){ window.__lastUploadError = (r.error && (r.error.message || r.error.error)) || 'upload rejected'; return ''; }
      return path;
    } catch(e){ window.__lastUploadError = (e && e.message) || String(e); return ''; }
  }

  function skuRow(r){
    var st = STATUS[r.status] || STATUS.submitted;
    var links = r.file_path
      ? '<a href="#" data-gl-action="glOpenClientDoc" data-gl-prevent="" data-gl-arg1="'+esc(String(r.file_path).replace(/\x27/g,''))+'" style="color:#00e5c0;font-weight:700">📄 View</a>' +
        ' <a href="#" data-gl-action="glDownloadClientDoc" data-gl-prevent="" data-gl-arg1="'+esc(String(r.file_path).replace(/\x27/g,''))+'" style="color:#00e5c0;font-weight:700">⬇ Download</a>'
      : '<span style="color:#f5c842">⚠ no file stored</span>';
    return '<div class="gl-art-row" data-id="'+esc(r.id)+'" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:10px 0;border-top:1px solid rgba(255,255,255,.06)">' +
        '<div style="min-width:0">' +
          '<div style="font-weight:700;color:#eef4ff;font-size:13px">🎨 '+esc(r.sku_name)+' ' +
            '<span style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:'+st[1]+';color:'+st[2]+'">'+st[0]+'</span></div>' +
          (r.description ? '<div style="font-size:11.5px;color:#9aa7bd;margin-top:2px">'+esc(r.description)+'</div>' : '') +
          '<div style="font-size:12px;margin-top:4px">'+links+'</div>' +
        '</div>' +
        '<button class="gl-art-del" data-id="'+esc(r.id)+'" title="Remove SKU" style="background:none;border:none;color:#ff8579;cursor:pointer;font-size:15px;flex-shrink:0">🗑</button>' +
      '</div>';
  }

  window.glRenderArtwork = async function glRenderArtwork(clientId, mount){
    var host = elOf(mount);
    if(!host) return;
    if(!sb()){ host.innerHTML = '<div style="font-size:11px;color:#9aa7bd">Storage not ready.</div>'; return; }
    host.innerHTML = '<div style="font-size:11px;color:#9aa7bd">Loading artwork…</div>';
    var rows = [];
    try { var r = await sb().from('client_artwork').select('*').eq('client_id', clientId).order('created_at', { ascending:false }); if(r.error) throw r.error; rows = r.data || []; }
    catch(e){ host.innerHTML = '<div style="font-size:11px;color:#ff8579">Could not load artwork: '+esc(e.message||e)+'</div>'; return; }

    var inp = 'width:100%;padding:9px 10px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px';
    host.innerHTML =
      (rows.length ? rows.map(skuRow).join('') : '<div style="font-size:12px;color:#9aa7bd;padding:6px 0">No SKUs yet. Add each can design below.</div>') +
      '<div style="border-top:1px solid rgba(255,255,255,.06);margin-top:8px;padding-top:10px">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<input class="gl-art-name" placeholder="SKU / can name (e.g. Mango 12oz)" style="'+inp+'">' +
          '<input class="gl-art-desc" placeholder="Notes (optional)" style="'+inp+'">' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">' +
          '<input class="gl-art-file" type="file" accept="image/*,.pdf,.ai,.eps,.svg" style="'+inp+';flex:1;min-width:180px;padding:7px">' +
          '<button class="gl-art-add" style="padding:9px 16px;background:rgba(0,229,192,.14);border:1px solid rgba(0,229,192,.35);border-radius:8px;color:#00e5c0;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap">＋ Add SKU</button>' +
        '</div>' +
        '<div class="gl-art-msg" style="display:none;font-size:12px;margin-top:8px"></div>' +
      '</div>';

    var msg = host.querySelector('.gl-art-msg');
    function show(color, text){ msg.style.display='block'; msg.style.color=color; msg.textContent=text; }

    host.querySelector('.gl-art-add').addEventListener('click', async function(){
      var btn = this;
      var name = (host.querySelector('.gl-art-name').value || '').trim();
      var desc = (host.querySelector('.gl-art-desc').value || '').trim();
      var fileEl = host.querySelector('.gl-art-file');
      var file = fileEl.files && fileEl.files[0];
      if(!name){ show('#f5c842','Enter a SKU / can name.'); return; }
      if(!file){ show('#f5c842','Choose an artwork file to upload.'); return; }
      btn.disabled = true; btn.textContent = 'Uploading…';
      var path = await uploadArtwork(clientId, file);
      if(!path){ btn.disabled=false; btn.textContent='＋ Add SKU'; show('#ff8579','Upload failed'+(window.__lastUploadError?(' ('+window.__lastUploadError+')'):'')+'. Try again.'); return; }
      var uid = (window.currentUser && window.currentUser.id) || null;
      try {
        var ins = await sb().from('client_artwork').insert([{ client_id: clientId, sku_name: name, description: desc || null, file_path: path, file_type: (file.name.split('.').pop()||'').toLowerCase(), status:'submitted', created_by: uid }]);
        if(ins.error) throw ins.error;
      } catch(e){ btn.disabled=false; btn.textContent='＋ Add SKU'; show('#ff8579','Save failed: '+(e.message||e)); return; }
      if(typeof window.glAudit === 'function') window.glAudit('artwork_added', name, { client: clientId });
      glRenderArtwork(clientId, host); // re-render fresh
    });

    Array.prototype.forEach.call(host.querySelectorAll('.gl-art-del'), function(b){
      b.addEventListener('click', async function(){
        if(!confirm('Remove this SKU and its artwork?')) return;
        var id = this.getAttribute('data-id');
        var row = rows.filter(function(x){ return String(x.id) === String(id); })[0];
        // Storage object first: once the row is gone the file_path is gone
        // with it, and the upload is orphaned in the bucket forever.
        if(row && row.file_path){
          try {
            var rm = await sb().storage.from('client-docs').remove([row.file_path]);
            if(rm.error) throw rm.error;
          } catch(e){ show('#ff8579','Could not remove the artwork file: '+(e.message||e)); return; }
        }
        try {
          var del = await sb().from('client_artwork').delete().eq('id', id).select();
          if(del.error) throw del.error;
          if(!del.data || !del.data.length) throw new Error('no SKU was removed');
        } catch(e){ show('#ff8579','Delete failed: '+(e.message||e)); return; }
        glRenderArtwork(clientId, host);
      });
    });
  };

  console.log('[GL] artwork / SKU module loaded');
}());
