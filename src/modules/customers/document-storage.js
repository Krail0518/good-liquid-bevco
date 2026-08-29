/*
 * document-storage.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: uploadDocToSupabase, glDownloadDocument, downloadDocFromSupabase
 */
/* ═══════════════════════════════════════════
   SUPABASE DOCUMENT STORAGE
   Real file upload + download via the live window.supa client
   (created in fix.js) against the 'client-docs' bucket.
═══════════════════════════════════════════ */
// Returns { url, path, error }. The caller MUST check `error` before saving a
// document row — a null url with no attached file is not a recoverable state.
async function uploadDocToSupabase(file, clientId, docType, docName) {
  const sb = window.supa;
  if(!sb) return { path: null, error: 'Cloud storage is not available.' };
  try {
    const ext = file.name.split('.').pop();
    // A document with no client used to produce a path with a leading slash.
    // The "client-docs customer read" policy matches on `name LIKE '<id>/%'`,
    // so give unassigned documents their own prefix rather than a bare one.
    const folder = /^[0-9a-f-]{36}$/i.test(clientId || '') ? clientId : 'general';
    const path = `${folder}/${Date.now()}_${docName.replace(/\s+/g,'_')}.${ext}`;
    const { error } = await sb.storage.from('client-docs').upload(path, file, {
      cacheControl: '3600', upsert: false
    });
    if(error) throw error;
    // No getPublicUrl here. client-docs is private: that URL returns 400, and
    // a signed URL expires, so neither is safe to persist. The path is the
    // only durable reference — glDownloadDocument() signs it on demand.
    return { path, error: null };
  } catch(e) {
    console.warn('[GL] Supabase document upload failed:', e);
    return { path: null, error: e.message || String(e) };
  }
}

// Hands the user the file behind a stored path. Signed, short-lived, and
// generated at click time. Returns an error string, or null on success.
async function glDownloadDocument(path, suggestedName){
  const sb = window.supa;
  if(!sb) return 'Cloud storage is not available.';
  if(!path) return 'This document has no file attached.';
  try {
    const r = await sb.storage.from('client-docs').createSignedUrl(path, 300, { download: suggestedName || true });
    if(r && r.error) return r.error.message;
    const url = r && r.data && r.data.signedUrl;
    if(!url) return 'Storage did not return a download link.';
    window.open(url, '_blank', 'noopener');
    return null;
  } catch(e) {
    return e.message || String(e);
  }
}
window.glDownloadDocument = glDownloadDocument;

window.glDownloadDocById = async function(id){
  const d = (window.documents || []).find(x => x.id === id);
  if(!d) { alert('That document is no longer in the list. Refresh and try again.'); return; }
  const err = await glDownloadDocument(d.filePath, d.name);
  if(err) alert('Could not download "' + d.name + '":\n\n' + err);
};

async function downloadDocFromSupabase(path) {
  const sb = window.supa;
  if(!sb || !path) return null;
  try {
    const { data } = await sb.storage.from('client-docs').download(path);
    return URL.createObjectURL(data);
  } catch(e) { return null; }
}

// Override saveDocument to support real file upload
saveDocument = async function() {
  const fileInput = document.getElementById('doc-file-input');
  const file = fileInput?.files?.[0];
  const clientId = document.getElementById('doc-client-sel').value;
  const name = document.getElementById('doc-name').value.trim();
  const type = document.getElementById('doc-type').value;

  if(!name) { alert('Document name required'); return; }
  if(!window.supa) { alert('Cloud sync unavailable — try reloading.'); return; }

  let filePath = null;
  if(file) {
    const result = await uploadDocToSupabase(file, clientId, type, name);
    // A file was chosen, so saving a record with no attachment would silently
    // create a document nobody can open. Stop instead.
    if(result.error || !result.path) {
      alert('The file could not be uploaded, so this document was not saved.\n\n'
        + (result.error || 'No download link came back from storage.')
        + '\n\nPlease check your connection and try again.');
      return;
    }
    filePath = result.path;
  }

  const client = clients.find(c => c.id === clientId);
  const r = await window.supa.from('documents').insert([{
    client_id:   /^[0-9a-f-]{36}$/i.test(clientId||'') ? clientId : null,
    client_name: client ? client.name : 'General',
    name:        name,
    doc_type:    type,
    notes:       document.getElementById('doc-notes').value || null,
    uploaded_by: (window.currentUser && window.currentUser.name) || 'Admin',
    file_path:   filePath
  }]).select('id');
  // PostgREST reports an unknown column as an error, but RLS refuses
  // silently — 0 rows, no error. Both mean the document was not saved.
  if(!r.error && (!Array.isArray(r.data) || r.data.length === 0)) {
    alert('The database accepted the request but saved no document row. '
      + 'This is usually a permissions problem — the file was uploaded but '
      + 'the record was not created.');
    return;
  }
  if(r.error) { alert('Save failed: ' + r.error.message); return; }
  await loadDocs();
  renderDocs();
  closeDocUploadModal();
  document.getElementById('doc-name').value = '';
  addNotification('📁 Document saved: ' + name, client ? client.name : 'General', 'success');
};

// Add file input to doc upload modal on first open
const _origOpenDocUploadModal = openDocUploadModal;
openDocUploadModal = function() {
  _origOpenDocUploadModal();
  const modal = document.getElementById('doc-upload-modal');
  if(modal && !document.getElementById('doc-file-input')) {
    const row = document.createElement('div');
    row.className = 'frow';
    row.innerHTML = `<div class="flbl">Attach file (optional)</div>
      <input type="file" id="doc-file-input" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xlsx,.csv"
        style="width:100%;padding:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:var(--white);font-size:12px">
      <div style="font-size:10px;color:var(--muted);margin-top:4px">PDF, Word, images, spreadsheets accepted.</div>`;
    const saveBtn = modal.querySelector('button[data-gl-action="saveDocument"]');
    if(saveBtn) saveBtn.parentElement.insertBefore(row, saveBtn.parentElement.querySelector('.frow:last-of-type'));
  }
};

// Enhanced renderDocs with download links
const _origRenderDocs = renderDocs;
renderDocs = function() {
  _origRenderDocs();
  // Add download buttons to items that have a fileUrl
  setTimeout(() => {
    document.querySelectorAll('.doc-item').forEach((el, i) => {
      if(i < documents.length && documents[i]?.fileUrl && !el.querySelector('.doc-dl-btn')) {
        const btn = document.createElement('a');
        btn.href = documents[i].fileUrl;
        btn.target = '_blank';
        btn.className = 'cbtn';
        btn.style.cssText = 'font-size:10px;padding:3px 8px;text-decoration:none;margin-right:4px';
        btn.textContent = '⬇ Open';
        btn.className = 'cbtn doc-dl-btn';
        const delBtn = el.querySelector('.cbtn.red');
        if(delBtn) el.insertBefore(btn, delBtn);
      }
    });
  }, 50);
};
