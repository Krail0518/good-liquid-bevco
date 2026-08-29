/*
 * tags.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: glClientTagsBackfill, loadClientTags, getClientTagsEl, addTag, removeTag, renderClientDetail
 */
/* ═══════════════════════════════════════════
   TAGS SYSTEM
═══════════════════════════════════════════ */
/* Client tags: { clientId: [tag, tag, ...] } populated from
   public.client_tags. Local cache rebuilt on every loadClientTags()
   call. Each add/remove writes through to Supabase. */
let clientTags = {};

async function glClientTagsBackfill(){
  try {
    if(localStorage.getItem('gl_client_tags_migrated') === '1') return;
    if(!window.supa || !window.currentUser) return;
    const blob = localStorage.getItem('gl_client_tags');
    if(!blob){ localStorage.setItem('gl_client_tags_migrated','1'); return; }
    let legacy = {}; try { legacy = JSON.parse(blob) || {}; } catch(_e){ return; }
    const rows = [];
    Object.keys(legacy).forEach(cid => {
      if(!/^[0-9a-f-]{36}$/i.test(cid)) return;
      (legacy[cid]||[]).forEach(t => {
        if(t && typeof t === 'string') rows.push({ client_id: cid, tag: t.toLowerCase().slice(0,80), created_by: (window.currentUser.name||null) });
      });
    });
    if(!rows.length){ localStorage.setItem('gl_client_tags_migrated','1'); return; }
    const r = await window.supa.from('client_tags').upsert(rows, { onConflict: 'client_id,tag', ignoreDuplicates: true });
    if(r.error){ console.warn('[GL] client_tags backfill failed', r.error.message); return; }
    localStorage.setItem('gl_client_tags_migrated','1');
  } catch(e){ console.warn('[GL] client_tags backfill threw', e); }
}

async function loadClientTags(){
  if(!window.supa){ return; }
  await glClientTagsBackfill();
  const r = await window.supa.from('client_tags').select('client_id, tag');
  if(r.error){ console.warn('[GL] loadClientTags failed', r.error.message); return; }
  clientTags = {};
  (r.data || []).forEach(row => {
    if(!clientTags[row.client_id]) clientTags[row.client_id] = [];
    clientTags[row.client_id].push(row.tag);
  });
}

function getClientTagsEl(clientId,editable=false){
  const tags=clientTags[clientId]||[];
  const esc = s => String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
  if(!editable) return tags.map(t=>`<span class="tag-chip">${esc(t)}</span>`).join('');
  return `<div class="tag-input-wrap" id="tag-wrap-${clientId}">
    ${tags.map(t=>`<span class="tag-chip">${esc(t)}<span class="tag-rm" data-gl-action="removeTag" data-gl-arg1="${esc(clientId)}" data-gl-arg2="${esc(t)}">✕</span></span>`).join('')}
    <input placeholder="Add tag, press Enter" onkeydown="if(event.key==='Enter'){addTag('${clientId}',this.value);this.value=''}">
  </div>`;
}

async function addTag(clientId,tag){
  tag=String(tag||'').trim().toLowerCase().slice(0,80);
  if(!tag) return;
  if(!clientTags[clientId]) clientTags[clientId]=[];
  if(clientTags[clientId].includes(tag)){ renderClientDetail(clientId); return; }
  // Optimistic
  clientTags[clientId].push(tag);
  renderClientDetail(clientId);
  if(window.supa){
    const r = await window.supa.from('client_tags').insert([{ client_id: clientId, tag, created_by: (window.currentUser && window.currentUser.name) || null }]);
    if(r.error && !/duplicate|unique/i.test(r.error.message||'')){
      // Rollback on real error
      clientTags[clientId] = clientTags[clientId].filter(t => t !== tag);
      renderClientDetail(clientId);
      alert('Save failed: ' + r.error.message);
    }
  }
}

async function removeTag(clientId,tag){
  if(!clientTags[clientId]) return;
  clientTags[clientId]=clientTags[clientId].filter(t=>t!==tag);
  renderClientDetail(clientId);
  if(window.supa){
    const res = await glCheckedDelete(sb => sb.from('client_tags').delete().eq('client_id', clientId).eq('tag', tag).select('tag'));
    if(!res.ok){
      // Put it back: the database still has it.
      if(!clientTags[clientId]) clientTags[clientId] = [];
      if(!clientTags[clientId].includes(tag)) clientTags[clientId].push(tag);
      renderClientDetail(clientId);
      alert('Could not remove the tag — it has NOT been deleted: ' + res.reason);
    }
  }
}

function renderClientDetail(clientId){
  // Re-render the tag section if visible
  const tw=document.getElementById('tag-wrap-'+clientId);
  if(tw){
    const tags=clientTags[clientId]||[];
    const inp=tw.querySelector('input');
    const currentVal=inp?inp.value:'';
    tw.innerHTML=tags.map(t=>`<span class="tag-chip">${esc(t)}<span class="tag-rm" data-gl-action="removeTag" data-gl-arg1="${esc(clientId)}" data-gl-arg2="${esc(t)}">✕</span></span>`).join('')+`<input placeholder="Add tag, press Enter" value="${esc(currentVal)}" onkeydown="if(event.key==='Enter'){addTag('${esc(clientId)}',this.value);this.value=''}">`;
  }
}
