/* ============================================================
   artwork.js — per-client label artwork, multiple SKUs
   ============================================================
   One row per SKU in client_artwork: a name, optional notes, and an uploaded
   artwork file (client-docs bucket, opened via signed URLs). The same section
   renders in two places:
     • the staff client card (window.glRenderArtwork(clientId, mount))
     • the customer portal (same call, with the customer's own client id)

   ARTWORK STATE IS NOT A COLUMN. client_artwork.status was dropped in
   20260915000000. State is the latest row of the append-only artwork_reviews
   ledger, and "Submitted" is the ABSENCE of a decision rather than a stored
   value. The old column was writable by the customer — a portal user could
   PATCH status='approved' and authorise their own print run — and a cache that
   does not exist cannot be desynchronised or tampered with.

   The two surfaces read different things, and the branch is by SURFACE, not by
   trusting a role claim in the browser:
     • portal → rpc('gl_portal_artwork'), whose return type carries no
       decided_by, no seq and no profiles id
     • CRM    → the base tables, which only staff can read anyway

   Only staff can record a decision; the database enforces the legal
   transitions, so the buttons here are a convenience, never the authority.

   Exposes:
     window.glRenderArtwork(clientId, mountElOrId, opts)  — list + "add SKU" form
   Reuses window.glOpenClientDoc / glDownloadClientDoc for view/download.
   ============================================================ */
(function(){
  'use strict';

  function sb(){ return window.supa || null; }
  function esc(s){
    return String(s == null ? '' : s).replace(/[<>&"']/g, function(c){ return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]; });
  }
  function elOf(m){ return typeof m === 'string' ? document.getElementById(m) : m; }

  function isPortalSurface(){
    try { return new URL(location.href).searchParams.has('portal'); } catch(e){ return false; }
  }

  // Label, background, foreground. 'submitted' is synthesised, not stored.
  var STATE = {
    submitted:         ['Submitted',        'rgba(245,200,66,.15)',  '#f5c842'],
    in_review:         ['In review',        'rgba(0,229,192,.14)',   '#00e5c0'],
    changes_requested: ['Changes requested','rgba(231,76,60,.16)',   '#ff8579'],
    approved:          ['Approved',         'rgba(29,158,117,.16)',  '#5fcf9e'],
    sent_to_printer:   ['Sent to printer',  'rgba(107,159,255,.16)', '#6b9fff']
  };

  // Mirrors the database trigger in 20260915000000. Kept here only so staff are
  // not offered a button the server will refuse; the server remains the
  // authority and an illegal insert raises 42501 regardless of this map.
  var NEXT = {
    submitted:         ['in_review', 'changes_requested', 'approved'],
    in_review:         ['changes_requested', 'approved'],
    changes_requested: ['in_review', 'approved'],
    approved:          ['sent_to_printer', 'changes_requested'],
    sent_to_printer:   []
  };

  async function uploadArtwork(clientId, file, portal){
    window.__lastUploadError = '';
    if(!file || !sb()){ window.__lastUploadError = 'Not signed in / storage unavailable'; return ''; }
    var ext = (file.name.split('.').pop() || 'png').toLowerCase();
    // CP01: a customer may only upload into, and reference files in, their own
    // <client>/portal/ namespace — the database refuses anything else. Staff
    // keep the staff folder.
    var path = clientId + (portal ? '/portal/artwork/' : '/artwork/') +
      Date.now() + '_' + Math.random().toString(36).slice(2,7) + '.' + ext;
    try {
      var r = await sb().storage.from('client-docs').upload(path, file, { cacheControl:'3600', upsert:false });
      if(r.error){ window.__lastUploadError = (r.error && (r.error.message || r.error.error)) || 'upload rejected'; return ''; }
      return path;
    } catch(e){ window.__lastUploadError = (e && e.message) || String(e); return ''; }
  }

  // Normalises both surfaces to one shape: { id, sku_name, description,
  // file_path, file_type, created_at, state, decided_at, client_note }.
  async function loadRows(clientId, portal){
    if(portal){
      var rp = await sb().rpc('gl_portal_artwork');
      if(rp.error) throw rp.error;
      return (rp.data || []).map(function(r){
        return { id: r.artwork_id, project_id: r.project_id, sku_name: r.sku_name, description: r.description,
                 file_path: r.file_path, file_type: r.file_type, created_at: r.created_at,
                 state: r.state || 'submitted', decided_at: r.decided_at, client_note: r.client_note };
      });
    }
    var ar = await sb().from('client_artwork').select('*')
      .eq('client_id', clientId).is('archived_at', null)
      .order('created_at', { ascending:false });
    if(ar.error) throw ar.error;
    var rows = ar.data || [];
    if(!rows.length) return [];

    // Latest decision per SKU. Ordered ascending so the last write wins in the
    // map — seq is the order, never decided_at, which is not unique.
    var rv = await sb().from('artwork_reviews')
      .select('artwork_id, decision, decided_at, client_note, seq')
      .in('artwork_id', rows.map(function(r){ return r.id; }))
      .order('seq', { ascending:true });
    if(rv.error) throw rv.error;
    var latest = {};
    (rv.data || []).forEach(function(d){ latest[d.artwork_id] = d; });

    return rows.map(function(r){
      var d = latest[r.id];
      r.state = d ? d.decision : 'submitted';
      r.decided_at = d ? d.decided_at : null;
      r.client_note = d ? d.client_note : null;
      return r;
    });
  }

  function decisionButtons(r, staff){
    if(!staff) return '';
    var next = NEXT[r.state] || [];
    if(!next.length){
      return '<div style="font-size:10.5px;color:#6b87ad;margin-top:6px">Sent to the printer — this SKU is closed.</div>';
    }
    return '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">' +
      next.map(function(d){
        var st = STATE[d];
        return '<button type="button" class="gl-art-decide" data-id="'+esc(r.id)+'" data-decision="'+esc(d)+'" ' +
          'style="padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;cursor:pointer;white-space:nowrap;' +
          'background:'+st[1]+';color:'+st[2]+';border:1px solid '+st[2]+'55">'+esc(st[0])+'</button>';
      }).join('') + '</div>';
  }

  function skuRow(r, staff){
    var st = STATE[r.state] || STATE.submitted;
    var links = r.file_path
      // arg2 is the SKU name, so the download arrives as "Mango 12oz.png"
      // rather than the storage id. The extension comes from the stored path.
      ? '<a href="#" data-gl-action="glOpenClientDoc" data-gl-prevent="" data-gl-arg1="'+esc(String(r.file_path).replace(/\x27/g,''))+'" style="color:#00e5c0;font-weight:700">📄 View</a>' +
        ' <a href="#" data-gl-action="glDownloadClientDoc" data-gl-prevent="" data-gl-arg1="'+esc(String(r.file_path).replace(/\x27/g,''))+'" data-gl-arg2="'+esc(String(r.sku_name||''))+'" style="color:#00e5c0;font-weight:700">⬇ Download</a>'
      : '<span style="color:#f5c842">⚠ no file stored</span>';
    // A SKU with a decision on it is part of the record: the ledger's ON DELETE
    // RESTRICT foreign key refuses to remove it, so offering the bin would only
    // produce an error. Staff archive instead.
    var reviewed = r.state !== 'submitted';
    var removeBtn = reviewed
      ? (staff ? '<button class="gl-art-archive" data-id="'+esc(r.id)+'" title="Archive this SKU" style="background:none;border:none;color:#9aa7bd;cursor:pointer;font-size:14px;flex-shrink:0">🗄</button>' : '')
      : '<button class="gl-art-del" data-id="'+esc(r.id)+'" title="Remove SKU" style="background:none;border:none;color:#ff8579;cursor:pointer;font-size:15px;flex-shrink:0">🗑</button>';
    return '<div class="gl-art-row" data-id="'+esc(r.id)+'" style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:10px 0;border-top:1px solid rgba(255,255,255,.06)">' +
        '<div style="min-width:0">' +
          '<div style="font-weight:700;color:#eef4ff;font-size:13px">🎨 '+esc(r.sku_name)+' ' +
            '<span style="padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:'+st[1]+';color:'+st[2]+'">'+esc(st[0])+'</span></div>' +
          (r.description ? '<div style="font-size:11.5px;color:#9aa7bd;margin-top:2px">'+esc(r.description)+'</div>' : '') +
          (r.client_note ? '<div style="font-size:11.5px;color:#c8d4e8;margin-top:3px;border-left:2px solid '+st[2]+';padding-left:7px">'+esc(r.client_note)+'</div>' : '') +
          '<div style="font-size:12px;margin-top:4px">'+links+'</div>' +
          // CP02: approved artwork is fixed; changes arrive as a NEW upload that
          // starts unreviewed, with the earlier one and its decisions kept.
          (r.state === 'changes_requested'
            ? '<button type="button" class="gl-art-revise" data-id="'+esc(r.id)+'" data-name="'+esc(r.sku_name||'')+'" style="margin-top:6px;padding:3px 10px;border-radius:20px;font-size:10px;font-weight:700;cursor:pointer;background:rgba(245,200,66,.12);color:#f5c842;border:1px solid rgba(245,200,66,.4)">⤴ Upload revised artwork</button>'
            : '') +
          decisionButtons(r, staff) +
        '</div>' + removeBtn +
      '</div>';
  }

  window.glRenderArtwork = async function glRenderArtwork(clientId, mount, opts){
    var host = elOf(mount);
    if(!host) return;
    if(!sb()){ host.innerHTML = '<div style="font-size:11px;color:#9aa7bd">Storage not ready.</div>'; return; }
    var portal = opts && typeof opts.portal === 'boolean' ? opts.portal : isPortalSurface();
    var staff = !portal;

    host.innerHTML = '<div style="font-size:11px;color:#9aa7bd">Loading artwork…</div>';
    var rows = [];
    try { rows = await loadRows(clientId, portal); }
    catch(e){ host.innerHTML = '<div style="font-size:11px;color:#ff8579">Could not load artwork: '+esc(e.message||e)+'</div>'; return; }

    // CP04: in the portal, a project shows its own artwork. Artwork uploaded
    // before projects existed (project_id null) belongs to no project, so it is
    // listed separately and labelled, rather than repeated under every project.
    var projectId = (opts && opts.projectId) || null;
    // GL-123: revision mode lives on the host element, which the portal reuses
    // across project switches. Any re-render starts outside revision mode, so a
    // revision chosen under one project can never be filed under another.
    delete host.dataset.supersedes;
    var assigned = rows, legacy = [];
    if(portal && projectId){
      assigned = rows.filter(function(r){ return r.project_id === projectId; });
      legacy   = rows.filter(function(r){ return !r.project_id; });
    }
    var inp = 'width:100%;padding:9px 10px;background:#0a1628;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#fff;font-size:13px';
    host.innerHTML =
      (assigned.length ? assigned.map(function(r){ return skuRow(r, staff); }).join('')
                   : '<div style="font-size:12px;color:#9aa7bd;padding:6px 0">No SKUs on this project yet. Add each can design below.</div>') +
      (legacy.length
        ? '<div style="font-size:10px;letter-spacing:1px;color:#6b87ad;font-weight:700;margin-top:12px">EARLIER ARTWORK — NOT ASSIGNED TO A PROJECT</div>' +
          legacy.map(function(r){ return skuRow(r, staff); }).join('')
        : '') +
      '<div style="border-top:1px solid rgba(255,255,255,.06);margin-top:8px;padding-top:10px">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
          '<input class="gl-art-name" placeholder="SKU / can name (e.g. Mango 12oz)" style="'+inp+'">' +
          '<input class="gl-art-desc" placeholder="Notes (optional)" style="'+inp+'">' +
        '</div>' +
        '<div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">' +
          '<input class="gl-art-file" type="file" accept="image/*,.pdf,.ai,.eps,.svg" style="'+inp+';flex:1;min-width:180px;padding:7px">' +
          '<button class="gl-art-add" style="padding:9px 16px;background:rgba(0,229,192,.14);border:1px solid rgba(0,229,192,.35);border-radius:8px;color:#00e5c0;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap">＋ Add SKU</button>' +
        '</div>' +
        '<div class="gl-art-revising-wrap" style="display:none;margin-top:8px;align-items:center;gap:10px;flex-wrap:wrap">' +
          '<span class="gl-art-revising" style="font-size:11.5px;color:#f5c842"></span>' +
          '<button type="button" class="gl-art-revise-cancel" style="padding:2px 10px;border-radius:20px;font-size:10px;font-weight:700;cursor:pointer;background:none;color:#9aa7bd;border:1px solid rgba(255,255,255,.2)">Cancel revision</button>' +
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
      var path = await uploadArtwork(clientId, file, portal);
      if(!path){ btn.disabled=false; btn.textContent='＋ Add SKU'; show('#ff8579','Upload failed'+(window.__lastUploadError?(' ('+window.__lastUploadError+')'):'')+'. Try again.'); return; }
      var uid = (window.currentUser && window.currentUser.id) || null;
      // GL-123 (review R5): a revision belongs to the SAME project as the
      // artwork it replaces. It used to take the project from the mount, and the
      // staff mount passes none, so every staff revision fell into "unassigned";
      // in the portal, revising unassigned artwork while a project was open filed
      // it under that project. The database enforces the same rule.
      var supersedes = host.dataset.supersedes || null;
      var parent = supersedes ? rows.filter(function(x){ return String(x.id) === String(supersedes); })[0] : null;
      if(supersedes && !parent){
        btn.disabled=false; btn.textContent='＋ Add SKU';
        show('#ff8579','The artwork being revised is no longer on this list. Cancel the revision and try again.');
        return;
      }
      try {
        // No status: the absence of a decision IS "Submitted".
        var row = { client_id: clientId, sku_name: name, description: desc || null, file_path: path,
                    file_type: (file.name.split('.').pop()||'').toLowerCase(), created_by: uid,
                    project_id: parent ? (parent.project_id || null) : projectId,
                    supersedes_id: supersedes };
        var ins = await sb().from('client_artwork').insert([row]).select('id');
        if(ins.error) throw ins.error;
        if(!ins.data || !ins.data.length) throw new Error('the upload was not recorded');
      } catch(e){ btn.disabled=false; btn.textContent='＋ Add SKU'; show('#ff8579','Save failed: '+(e.message||e)); return; }
      if(typeof window.glAudit === 'function') window.glAudit('artwork_added', name, { client: clientId });
      delete host.dataset.supersedes;   // the next upload is a new SKU unless asked again
      glRenderArtwork(clientId, host, opts); // re-render fresh
    });

    // Staff record a decision. The note is written knowing the client reads it:
    // gl_portal_artwork() returns client_note to the portal verbatim.
    Array.prototype.forEach.call(host.querySelectorAll('.gl-art-decide'), function(b){
      b.addEventListener('click', async function(){
        var btn = this;
        var id = btn.getAttribute('data-id');
        var decision = btn.getAttribute('data-decision');
        var row = rows.filter(function(x){ return String(x.id) === String(id); })[0] || {};
        var label = (STATE[decision] || [decision])[0];
        if(decision === 'sent_to_printer' &&
           !confirm('Mark "' + (row.sku_name||'this SKU') + '" as sent to the printer? Nothing follows this — it is the end of the line for this artwork.')) return;
        var note = prompt('Note for the CLIENT to read with "' + label + '" (optional):', '');
        if(note === null) return;
        var uid = (window.currentUser && window.currentUser.id) || null;
        if(!uid){ show('#ff8579','Could not identify you — sign in again.'); return; }
        btn.disabled = true;
        var r;
        // .select() so a silent RLS rejection (no error, 0 rows) cannot redraw
        // as success — CLAUDE.md rule 4.
        try { r = await sb().from('artwork_reviews').insert([{ artwork_id: id, decision: decision, client_note: note || null, decided_by: uid }]).select('seq'); }
        catch(e){ btn.disabled=false; show('#ff8579','Could not record the decision: '+(e.message||e)); return; }
        if(r.error){ btn.disabled=false; show('#ff8579','Could not record the decision: '+r.error.message); return; }
        if(!Array.isArray(r.data) || r.data.length === 0){
          btn.disabled = false;
          show('#ff8579','The server rejected the decision (0 rows written). Nothing was recorded.');
          return;
        }
        glRenderArtwork(clientId, host, opts);
      });
    });

    Array.prototype.forEach.call(host.querySelectorAll('.gl-art-archive'), function(b){
      b.addEventListener('click', async function(){
        if(!confirm('Archive this SKU? It disappears from the client portal. Its decisions are kept.')) return;
        var id = this.getAttribute('data-id');
        var up;
        try { up = await sb().from('client_artwork').update({ archived_at: new Date().toISOString() }).eq('id', id).select('id'); }
        catch(e){ show('#ff8579','Archive failed: '+(e.message||e)); return; }
        if(up.error){ show('#ff8579','Archive failed: '+up.error.message); return; }
        if(!Array.isArray(up.data) || up.data.length === 0){ show('#ff8579','The server rejected the archive (0 rows). The SKU is unchanged.'); return; }
        glRenderArtwork(clientId, host, opts);
      });
    });

    Array.prototype.forEach.call(host.querySelectorAll('.gl-art-revise'), function(b){
      b.addEventListener('click', function(){
        host.dataset.supersedes = this.getAttribute('data-id');
        host.querySelector('.gl-art-name').value = this.getAttribute('data-name') || '';
        var note = host.querySelector('.gl-art-revising');
        host.querySelector('.gl-art-revising-wrap').style.display = 'flex';
        note.textContent = 'Uploading a revision of "' + (this.getAttribute('data-name') || 'this SKU') +
          '". It stays in the same project and starts a new review; the earlier version and its decisions are kept.';
        host.querySelector('.gl-art-file').focus();
      });
    });

    host.querySelector('.gl-art-revise-cancel').addEventListener('click', function(){
      delete host.dataset.supersedes;
      host.querySelector('.gl-art-revising-wrap').style.display = 'none';
      host.querySelector('.gl-art-revising').textContent = '';
      host.querySelector('.gl-art-name').value = '';
    });

    Array.prototype.forEach.call(host.querySelectorAll('.gl-art-del'), function(b){
      b.addEventListener('click', async function(){
        if(!confirm('Remove this SKU and its artwork?')) return;
        var id = this.getAttribute('data-id');
        var row = rows.filter(function(x){ return String(x.id) === String(id); })[0];
        // CP03/CP02: the RECORD goes first. If the database refuses (a decision
        // was recorded meanwhile, or permissions), the file must still exist.
        // A file left behind after a successful row delete is only an orphan;
        // a row whose file is gone is a broken record.
        try {
          var del = await sb().from('client_artwork').delete().eq('id', id).select('id');
          if(del.error) throw del.error;
          if(!del.data || !del.data.length) throw new Error('no SKU was removed');
        } catch(e){ show('#ff8579','Delete failed: '+(e.message||e)+'. Nothing was removed.'); return; }
        if(row && row.file_path && staff){
          // Customers hold no storage delete permission; staff clean up the file.
          try {
            var rm = await sb().storage.from('client-docs').remove([row.file_path]);
            if(rm.error) throw rm.error;
          } catch(e){ console.warn('[GL] artwork file left in storage after its SKU was removed', row.file_path, e); }
        }
        glRenderArtwork(clientId, host, opts);
      });
    });
  };

  console.log('[GL] artwork / SKU module loaded');
}());
