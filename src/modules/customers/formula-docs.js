/* ============================================================
   formula-docs.js — documents published against a formula version
   ============================================================
   The portal's Formula tab shows STATUS ONLY by design: name, version, stage.
   public.formulas is staff-only (20260914090300) because three permissive
   USING (true) policies once let any portal customer read ingredients directly.

   This is the one sanctioned exception: staff attach a document to a SPECIFIC
   formula version and publish it to that client, one file at a time. Nothing is
   visible by default.

   PUBLISHING IS THE SECURITY BOUNDARY. A spec sheet or COA can contain the
   formulation itself, and the clients here are competing beverage brands — so
   the act is deliberate, the confirmation names the file and the client, and
   the audit row is written by a database trigger rather than a call from here
   that someone could forget.

   Storage paths live under formula/<formula_id>/… — NOT under the client's own
   prefix. A customer cannot read that prefix, which is deliberate: the only way
   to obtain the bytes is the portal-formula-doc edge function, and that function
   writes the download log before it hands back a URL.

   Exposes:
     window.glRenderFormulaDocs(mount, { formulaId, version, clientName })
   ============================================================ */
(function(){
  'use strict';

  function sb(){ return window.supa || null; }
  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"']/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]; });
  }
  function elOf(m){ return typeof m === 'string' ? document.querySelector(m) : m; }

  // Constrained kinds, not free text: (formula_id, version, doc_kind) is the
  // uniqueness key, and a display name is editable so it makes a poor key.
  var KINDS = [
    ['spec_sheet', '📄 Spec sheet'],
    ['coa',        '🧪 COA'],
    ['process',    '⚙️ Process'],
    ['other',      '📎 Other']
  ];
  function kindLabel(k){
    var m = KINDS.filter(function(x){ return x[0] === k; })[0];
    return m ? m[1] : k;
  }

  async function upload(formulaId, file){
    window.__lastFormulaDocError = '';
    var ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    var path = 'formula/' + formulaId + '/' + Date.now() + '_' + Math.random().toString(36).slice(2,7) + '.' + ext;
    try {
      var r = await sb().storage.from('client-docs').upload(path, file, { cacheControl:'3600', upsert:false });
      if(r.error){ window.__lastFormulaDocError = r.error.message || 'upload rejected'; return ''; }
      return path;
    } catch(e){ window.__lastFormulaDocError = (e && e.message) || String(e); return ''; }
  }

  function docRow(d, clientName){
    var published = !!d.published_at;
    var pill = published
      ? '<span style="padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;background:rgba(95,207,158,.14);color:#5fcf9e;border:1px solid rgba(95,207,158,.4)">👁 Published to client</span>'
      : '<span style="padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;background:rgba(255,255,255,.04);color:#9aa7bd;border:1px solid rgba(255,255,255,.14)">🔒 Internal</span>';
    return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:9px 0;border-top:1px solid rgba(255,255,255,.06)">' +
        '<div style="min-width:0">' +
          '<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">' +
            '<span style="font-size:11px;color:#9aa7bd">' + esc(kindLabel(d.doc_kind)) + '</span>' +
            '<span style="font-weight:700;color:#eef4ff;font-size:13px">' + esc(d.name) + '</span>' +
            '<span style="font-size:10px;color:#00e5c0;font-family:var(--ff-mono)">v' + esc(String(d.version)) + '</span>' +
            pill +
          '</div>' +
          (published ? '<div style="font-size:10.5px;color:#6b87ad;margin-top:3px">Published ' + esc(new Date(d.published_at).toLocaleDateString()) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;gap:6px;flex-shrink:0">' +
          '<button class="gl-fd-pub" data-id="' + esc(d.id) + '" data-pub="' + (published ? '1' : '0') + '" ' +
            'style="padding:3px 9px;border-radius:6px;font-size:10px;font-weight:700;cursor:pointer;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.14);color:' + (published ? '#f5c842' : '#5fcf9e') + '">' +
            (published ? 'Unpublish' : 'Publish') + '</button>' +
          (published ? '' : '<button class="gl-fd-del" data-id="' + esc(d.id) + '" title="Remove" style="background:none;border:none;color:#ff8579;cursor:pointer;font-size:14px">🗑</button>') +
        '</div>' +
      '</div>';
  }

  window.glRenderFormulaDocs = async function glRenderFormulaDocs(mount, opts){
    var host = elOf(mount);
    if(!host) return;
    opts = opts || {};
    var formulaId = opts.formulaId, version = Number(opts.version || 1);
    var clientName = opts.clientName || 'this client';
    if(!sb() || !formulaId){ host.innerHTML = ''; return; }

    host.innerHTML = '<div style="font-size:11px;color:#9aa7bd">Loading documents…</div>';
    var rows = [];
    try {
      var r = await sb().from('formula_documents')
        .select('id, version, doc_kind, name, file_path, published_at')
        .eq('formula_id', formulaId).order('version', { ascending:false });
      if(r.error) throw r.error;
      rows = r.data || [];
    } catch(e){
      host.innerHTML = '<div style="font-size:11px;color:#ff8579">Could not load documents: ' + esc(e.message||e) + '</div>';
      return;
    }

    var inp = 'width:100%;padding:8px 9px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;font-size:12px';
    host.innerHTML =
      '<div style="font-size:10px;letter-spacing:1px;color:#9aa7bd;font-weight:700;margin-bottom:4px">📎 DOCUMENTS FOR THIS FORMULA</div>' +
      '<div style="font-size:11px;color:#6b87ad;margin-bottom:6px">Published documents appear on the client’s Formula tab. Everything else stays internal.</div>' +
      (rows.length ? rows.map(function(d){ return docRow(d, clientName); }).join('')
                   : '<div style="font-size:11.5px;color:#9aa7bd;padding:6px 0">No documents against this formula yet.</div>') +
      '<div style="border-top:1px solid rgba(255,255,255,.06);margin-top:8px;padding-top:9px">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
          '<select class="gl-fd-kind" style="' + inp + '">' +
            KINDS.map(function(k){ return '<option value="' + k[0] + '">' + esc(k[1]) + '</option>'; }).join('') +
          '</select>' +
          '<input class="gl-fd-version" type="number" min="1" value="' + esc(String(version)) + '" title="Formula version this document belongs to" style="' + inp + '">' +
        '</div>' +
        '<input class="gl-fd-name" placeholder="Document name (e.g. Citrus v3 spec sheet)" style="' + inp + ';margin-top:6px">' +
        '<div style="display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap">' +
          '<input class="gl-fd-file" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" style="' + inp + ';flex:1;min-width:150px;padding:6px">' +
          '<button class="gl-fd-add" style="padding:8px 13px;background:rgba(0,229,192,.14);border:1px solid rgba(0,229,192,.35);border-radius:6px;color:#00e5c0;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap">＋ Attach</button>' +
        '</div>' +
        '<div class="gl-fd-msg" style="display:none;font-size:11.5px;margin-top:6px"></div>' +
      '</div>';

    var msg = host.querySelector('.gl-fd-msg');
    function show(color, text){ msg.style.display='block'; msg.style.color=color; msg.textContent=text; }

    host.querySelector('.gl-fd-add').addEventListener('click', async function(){
      var btn = this;
      var kind = host.querySelector('.gl-fd-kind').value;
      var ver = Number(host.querySelector('.gl-fd-version').value || version) || 1;
      var name = (host.querySelector('.gl-fd-name').value || '').trim();
      var fileEl = host.querySelector('.gl-fd-file');
      var file = fileEl.files && fileEl.files[0];
      if(!file){ show('#f5c842','Choose a file.'); return; }
      if(!name) name = kindLabel(kind).replace(/^\S+\s/, '') + ' v' + ver;
      btn.disabled = true; btn.textContent = 'Uploading…';
      var path = await upload(formulaId, file);
      if(!path){ btn.disabled=false; btn.textContent='＋ Attach'; show('#ff8579','Upload failed' + (window.__lastFormulaDocError ? ' (' + window.__lastFormulaDocError + ')' : '') + '.'); return; }
      var uid = (window.currentUser && window.currentUser.id) || null;
      var ins;
      // Attached, NOT published: published_at stays null until someone decides.
      try {
        ins = await sb().from('formula_documents').insert([{
          formula_id: formulaId, version: ver, doc_kind: kind, name: name,
          file_path: path, file_type: (file.name.split('.').pop()||'').toLowerCase(),
          created_by: uid
        }]).select('id');
      } catch(e){ btn.disabled=false; btn.textContent='＋ Attach'; show('#ff8579','Save failed: ' + (e.message||e)); return; }
      if(ins.error){
        btn.disabled=false; btn.textContent='＋ Attach';
        show('#ff8579', /formula_documents_kind_uniq/.test(ins.error.message || '')
          ? 'There is already a ' + kindLabel(kind).replace(/^\S+\s/, '') + ' on v' + ver + '. Remove it first, or use a different kind.'
          : 'Save failed: ' + ins.error.message);
        return;
      }
      if(!ins.data || !ins.data.length){ btn.disabled=false; btn.textContent='＋ Attach'; show('#ff8579','The server rejected the document (0 rows written).'); return; }
      glRenderFormulaDocs(host, opts);
    });

    Array.prototype.forEach.call(host.querySelectorAll('.gl-fd-pub'), function(b){
      b.addEventListener('click', async function(){
        var btn = this;
        var id = btn.getAttribute('data-id');
        var isPublished = btn.getAttribute('data-pub') === '1';
        var row = rows.filter(function(x){ return x.id === id; })[0] || {};
        var q = isPublished
          ? 'Unpublish "' + (row.name || 'this document') + '"? ' + clientName + ' will no longer see it.'
          : 'Publish "' + (row.name || 'this document') + '" to ' + clientName + '?\n\n' +
            'They will be able to download it. A formula document can contain the formulation itself, ' +
            'and every download is recorded.';
        if(!confirm(q)) return;
        var uid = (window.currentUser && window.currentUser.id) || null;
        btn.disabled = true;
        var patch = isPublished
          ? { published_at: null, published_by: null }
          : { published_at: new Date().toISOString(), published_by: uid };
        var up;
        // .select() so a silent RLS rejection cannot redraw as success.
        try { up = await sb().from('formula_documents').update(patch).eq('id', id).select('id'); }
        catch(e){ btn.disabled=false; show('#ff8579','Could not change publication: ' + (e.message||e)); return; }
        if(up.error){ btn.disabled=false; show('#ff8579','Could not change publication: ' + up.error.message); return; }
        if(!Array.isArray(up.data) || up.data.length === 0){
          btn.disabled=false;
          show('#ff8579','The server rejected the change (0 rows updated). Nothing was published.');
          return;
        }
        glRenderFormulaDocs(host, opts);
      });
    });

    Array.prototype.forEach.call(host.querySelectorAll('.gl-fd-del'), function(b){
      b.addEventListener('click', async function(){
        if(!confirm('Remove this document? The file is deleted from storage too.')) return;
        var id = this.getAttribute('data-id');
        var row = rows.filter(function(x){ return x.id === id; })[0];
        if(row && row.file_path){
          try {
            var rm = await sb().storage.from('client-docs').remove([row.file_path]);
            if(rm.error) throw rm.error;
          } catch(e){ show('#ff8579','Could not remove the file: ' + (e.message||e)); return; }
        }
        var del;
        try { del = await sb().from('formula_documents').delete().eq('id', id).select('id'); }
        catch(e){ show('#ff8579','Delete failed: ' + (e.message||e)); return; }
        if(del.error){
          // A downloaded document is referenced by the access log, which is
          // ON DELETE RESTRICT: the record of who read it outlives the file.
          show('#ff8579', /foreign key/i.test(del.error.message || '')
            ? 'This document has been downloaded, so its access log holds it. Unpublish it instead.'
            : 'Delete failed: ' + del.error.message);
          return;
        }
        if(!del.data || !del.data.length){ show('#ff8579','The server rejected the delete (0 rows).'); return; }
        glRenderFormulaDocs(host, opts);
      });
    });
  };

  console.log('[GL] formula-documents module loaded');
}());
