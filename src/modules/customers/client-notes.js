/*
 * client-notes.js — extracted from crm-index-core.js (GL-037).
 *
 * VERBATIM move: the code below is byte-for-byte what was in the core, so
 * this diff is a relocation and nothing else.
 *
 * Loads AFTER crm-index-core.js and must stay a CLASSIC script — no defer,
 * async or type="module". Its top-level declarations become window
 * properties, which is how the inline on* handlers in index.html resolve
 * them. A module-scoped version would leave those handlers dead with no
 * error to show for it.
 *
 * Declares: glClientNotesBackfill, openClientNote, renderClientNotesList, saveClientNote, deleteClientNote
 */
/* ═══════════════════════════════════════════
   CLIENT NOTES
   Per-client sticky notes. Source of truth is the public.client_notes
   table in Supabase (see 20260523_client_notes_table.sql). Notes
   render in the modal directly from a Supabase SELECT — no in-memory
   cache to drift, no localStorage to lose on cache clear.
   The first time the new code loads on a browser that has the legacy
   `gl_client_notes` blob, glClientNotesBackfill() pushes those rows
   into the DB and sets a one-shot guard flag.
═══════════════════════════════════════════ */

// One-time backfill: if the legacy localStorage blob has any notes,
// insert them into client_notes (only if the user is an authenticated
// staff member, since RLS will reject anon inserts). Marks itself done
// in localStorage so it runs at most once per device.
async function glClientNotesBackfill(){
  try {
    if(localStorage.getItem('gl_client_notes_migrated') === '1') return;
    var blob = localStorage.getItem('gl_client_notes');
    if(!blob) { localStorage.setItem('gl_client_notes_migrated','1'); return; }
    var legacy = {};
    try { legacy = JSON.parse(blob) || {}; } catch(_e){ return; }
    if(!window.supa || !window.currentUser) return; // try again on next call
    var rows = [];
    var nowMs = Date.now();
    Object.keys(legacy).forEach(function(cid){
      (legacy[cid] || []).forEach(function(n, i){
        // Walk created_at back 1s per note so the locally-displayed
        // ordering survives the migration (newest first in the array
        // means newest in time).
        rows.push({
          client_id:    cid,
          body:         String(n.text || '').trim(),
          author_email: (window.currentUser && window.currentUser.email) || null,
          author_name:  n.author || (window.currentUser && window.currentUser.name) || 'Admin',
          created_at:   new Date(nowMs - i*1000).toISOString()
        });
      });
    });
    if(!rows.length){ localStorage.setItem('gl_client_notes_migrated','1'); return; }
    var r = await window.supa.from('client_notes').insert(rows);
    if(r.error){
      console.warn('[GL] client_notes backfill failed; will retry on next load:', r.error.message);
      return;
    }
    localStorage.setItem('gl_client_notes_migrated','1');
    // Keep the legacy blob around as a safety net for one more reload, then
    // clear it. The migrated flag prevents re-inserting duplicates.
    if(typeof addNotification === 'function'){
      addNotification('📝 Notes migrated', rows.length + ' client note' + (rows.length===1?'':'s') + ' moved from device storage to the cloud.', 'success');
    }
  } catch(e){ console.warn('[GL] client_notes backfill threw', e); }
}

async function openClientNote(clientId){
  const client = clients.find(c => c.id === clientId);
  if(!client) return;
  const existing = document.getElementById('client-note-modal');
  if(existing) existing.remove();

  // Fire-and-forget backfill (no-op if already done).
  glClientNotesBackfill();

  // Render scaffold immediately so the modal feels responsive; fill in
  // the notes once the SELECT lands.
  const modal = document.createElement('div');
  modal.id = 'client-note-modal';
  modal.className = 'modal-ov show';
  modal.innerHTML = `
    <div class="modal-box" style="width:500px">
      <div class="modal-title">📝 Notes — ${esc(client.name)} <span class="modal-close" onclick="this.closest('.modal-ov').remove()">✕</span></div>
      <div style="max-height:280px;overflow-y:auto;margin-bottom:12px" id="cn-list">
        <div style="color:var(--muted);font-size:13px">Loading…</div>
      </div>
      <textarea class="finp" id="cn-input" rows="3" placeholder="Add a note…" style="resize:none;margin-bottom:10px"></textarea>
      <div style="display:flex;gap:8px">
        <button class="cbtn pri" onclick="saveClientNote('${clientId}')" style="flex:1">Add Note</button>
        <button class="cbtn" onclick="this.closest('.modal-ov').remove()">Close</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if(e.target === modal) modal.remove(); });
  (document.getElementById('crm-panel')||document.body).appendChild(modal);
  await renderClientNotesList(clientId);
}

async function renderClientNotesList(clientId){
  const list = document.getElementById('cn-list');
  if(!list) return;
  if(!window.supa){
    list.innerHTML = '<div style="color:#ff8579;font-size:12px">Cloud sync unavailable — try reloading.</div>';
    return;
  }
  const r = await window.supa.from('client_notes')
    .select('id, body, author_name, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(200);
  if(r.error){
    list.innerHTML = '<div style="color:#ff8579;font-size:12px">Couldn\'t load notes: ' + (r.error.message || 'unknown error') + '</div>';
    return;
  }
  const rows = r.data || [];
  if(!rows.length){
    list.innerHTML = '<div style="color:var(--muted);font-size:13px">No notes yet.</div>';
    return;
  }
  list.innerHTML = rows.map(function(n){
    const when = n.created_at ? new Date(n.created_at).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'}) : '';
    const safeBody = String(n.body||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:11px;margin-bottom:8px">' +
      '<div style="font-size:12px;color:var(--white);line-height:1.6;white-space:pre-wrap">' + safeBody + '</div>' +
      '<div style="display:flex;justify-content:space-between;margin-top:6px">' +
        '<div style="font-size:10px;color:var(--muted)">' + when + ' · ' + (n.author_name || '—').replace(/[&<>]/g, '') + '</div>' +
        '<button class="cbtn red" style="font-size:9px;padding:2px 7px" onclick="deleteClientNote(\'' + clientId + '\',\'' + n.id + '\')">✕</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function saveClientNote(clientId){
  const input = document.getElementById('cn-input');
  const text = input ? input.value.trim() : '';
  if(!text) return;
  if(!window.supa){ alert('Cloud sync unavailable — try reloading.'); return; }
  const r = await window.supa.from('client_notes').insert([{
    client_id:    clientId,
    body:         text,
    author_email: (window.currentUser && window.currentUser.email) || null,
    author_name:  (window.currentUser && window.currentUser.name) || 'Admin'
  }]);
  if(r.error){ alert('Save failed: ' + r.error.message); return; }
  if(input) input.value = '';
  await renderClientNotesList(clientId);
  if(typeof glAudit === 'function') glAudit('client_note_added', clientId, null);
}

async function deleteClientNote(clientId, noteId){
  if(!window.supa){ alert('Cloud sync unavailable — try reloading.'); return; }
  if(!confirm('Delete this note?')) return;
  const res = await glCheckedDelete(sb => sb.from('client_notes').delete().eq('id', noteId).select('id'));
  if(!res.ok){ alert('Delete failed — the note has NOT been deleted: ' + res.reason); return; }
  await renderClientNotesList(clientId);
  if(typeof glAudit === 'function') glAudit('client_note_deleted', clientId, { note_id: noteId });
}
