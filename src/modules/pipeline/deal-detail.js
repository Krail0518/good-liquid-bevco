/*
 * deal-detail.js — the deal detail panel (GL-037).
 *
 * VERBATIM move, twice over: lifted out of index.html with the rest of the
 * core, then split out of correspondence.js without an edit.
 *
 * It arrived in correspondence.js because the extractor takes a section
 * from its banner to the NEXT banner, and nothing separated these functions
 * from the correspondence renderer above them. The code worked; the module
 * was just misnamed for a quarter of its contents.
 *
 * Loads AFTER crm-index-core.js as a CLASSIC script — no defer, async or
 * type="module". These are reached from inline on* handlers, which resolve
 * against window, and only a classic top-level declaration puts them there.
 *
 * Declares: editDealDetail, closeDealDetail, saveDealDetail, deleteDeal
 */

function editDealDetail(){
  const stage = currentDealStage;
  const idx = currentDealIdx;
  const d = (deals[stage]||[])[idx];
  if(!d) return;
  const sv = (id, val) => { const el = document.getElementById(id); if(el) el.value = val||''; };
  document.getElementById('ddp-title').textContent = d.name || 'EDIT DEAL';
  sv('ddp-name',    d.name);
  sv('ddp-co',      d.co);
  sv('ddp-contact', d.contactName);
  sv('ddp-email',   d.email);
  sv('ddp-phone',   d.phone);
  sv('ddp-city',    d.city);
  sv('ddp-state',   d.state);
  sv('ddp-service', d.service);
  sv('ddp-product', d.productType);
  sv('ddp-volume',  d.volume);
  sv('ddp-timeline',d.timeline);
  sv('ddp-funding', d.fundingStage);
  sv('ddp-source',  d.leadSource);
  sv('ddp-val',     parseInt((d.val||'$0').replace(/[$,]/g,'')) || 0);
  sv('ddp-prob',    d.prob || 20);
  sv('ddp-stage',   stage);
  sv('ddp-notes',   d.notes);
  var fbox = document.getElementById('ddp-formulation');
  if(fbox && typeof window.glFormulationBlock === 'function'){
    fbox.innerHTML = window.glFormulationBlock(d, 'ddp-form');
    if(typeof window.glFormulationBind === 'function') window.glFormulationBind('ddp-form');
  }
  document.getElementById('ddp-view-mode').style.display = 'none';
  document.getElementById('ddp-edit-mode').style.display = 'flex';
}

function closeDealDetail(){
  document.getElementById('deal-detail-panel').classList.remove('show');
  currentDealStage = null;
  currentDealIdx = null;
  window.currentDealStage = null;
  window.currentDealIdx = null;
}

async function saveDealDetail(){
  if(currentDealStage === null || currentDealIdx === null) return;
  const d = (deals[currentDealStage]||[])[currentDealIdx];
  if(!d) return;

  const gv = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
  const newName        = gv('ddp-name');
  const newCo          = gv('ddp-co');
  const newContactName = gv('ddp-contact');
  const newEmail       = gv('ddp-email');
  const newPhone       = gv('ddp-phone');
  const newCity        = gv('ddp-city');
  const newState       = gv('ddp-state').toUpperCase();
  const newService     = gv('ddp-service');
  const newProduct     = gv('ddp-product');
  const newVolume      = gv('ddp-volume');
  const newTimeline    = gv('ddp-timeline');
  const newFunding     = gv('ddp-funding');
  const newSource      = gv('ddp-source');
  const newVal         = parseFloat(document.getElementById('ddp-val').value)||0;
  const newProb        = parseInt(document.getElementById('ddp-prob').value)||20;
  const newStage       = gv('ddp-stage');
  const newNotes       = gv('ddp-notes');
  // Formulation block (checkbox + house + spend). null when the module or the
  // block is absent, in which case the existing values are left untouched.
  const newFormulation = (typeof window.glFormulationRead === 'function')
    ? window.glFormulationRead('ddp-form') : null;

  // Update local deal object
  d.name         = newName;
  d.co           = newCo;
  d.contactName  = newContactName;
  d.email        = newEmail;
  d.phone        = newPhone;
  d.city         = newCity;
  d.state        = newState;
  d.service      = newService;
  d.productType  = newProduct;
  d.volume       = newVolume;
  d.timeline     = newTimeline;
  d.fundingStage = newFunding;
  d.leadSource   = newSource;
  d.val          = '$' + newVal.toLocaleString();
  d.prob         = newProb;
  d.notes        = newNotes;
  if(newFormulation){
    d.formulationDone   = newFormulation.done;
    d.formulationVendor = newFormulation.vendor || '';
    d.formulationSpend  = newFormulation.spend;
    d.formulationPct    = newFormulation.pct;
  }

  // Move to different stage if changed; reset stage timer.
  // Remember the pre-move location so a rejected DB write can be rolled back —
  // otherwise the card appears to move (Close Won/Lost) while nothing persists,
  // and reverts on the next reload. See CLAUDE.md rule #4.
  const prevStage = currentDealStage;
  const prevStageEnteredAt = d.stageEnteredAt;
  const stageChanged = newStage !== currentDealStage;
  if(stageChanged){
    d.stageEnteredAt = new Date().toISOString();
    deals[currentDealStage].splice(currentDealIdx, 1);
    if(!deals[newStage]) deals[newStage] = [];
    deals[newStage].push(d);
  }

  // Save to Supabase if real id
  if(d.id && !String(d.id).startsWith('tmp_')){
    const updatePayload = {
      name: newName, client_name: newCo, value: newVal,
      probability: newProb, stage: newStage, notes: newNotes,
      contact_name: newContactName || undefined,
      email:        newEmail       || undefined,
      phone:        newPhone       || undefined,
      city:         newCity        || undefined,
      state:        newState       || undefined,
      service:      newService     || undefined,
      product_type: newProduct     || undefined,
      volume:       newVolume      || undefined,
      timeline:     newTimeline    || undefined,
      funding_stage:newFunding     || undefined,
      lead_source:  newSource      || undefined
    };
    if(newFormulation){
      updatePayload.formulation_done   = newFormulation.done;
      updatePayload.formulation_vendor = newFormulation.vendor;
      updatePayload.formulation_spend  = newFormulation.spend;
      updatePayload.formulation_pct    = newFormulation.pct;
    }
    if(stageChanged) updatePayload.stage_entered_at = d.stageEnteredAt;
    // .select() so RLS/constraint rejections surface: a silent 0-row reject
    // must be treated as failure, not success. On failure, roll the in-memory
    // move back so the board reflects what actually saved.
    let uq;
    try {
      uq = await supa.from('deals').update(updatePayload).eq('id', d.id).select();
    } catch(e){ uq = { error: e }; }
    if(uq.error || (Array.isArray(uq.data) && uq.data.length === 0)){
      console.warn('Deal save failed:', uq.error || '0 rows');
      if(stageChanged){
        const i = (deals[newStage]||[]).indexOf(d);
        if(i > -1) deals[newStage].splice(i, 1);
        d.stageEnteredAt = prevStageEnteredAt;
        if(!deals[prevStage]) deals[prevStage] = [];
        deals[prevStage].push(d);
      }
      alert('Could not save this deal — the server rejected the change'
        + (uq.error ? ': ' + (uq.error.message || uq.error) : ' (0 rows changed).')
        + '\n\nNothing was saved and the deal has NOT been moved. Please try again.');
      renderKanban();
      renderDash();
      return;
    }
    if(stageChanged && newStage === 'Closed Won') glNotifyDeal('deal_closed_won', {name: newName, company: newCo, stage:'Closed Won', value: String(newVal), email: newEmail, phone: newPhone});
  } else if(stageChanged && newStage === 'Closed Won'){
    glNotifyDeal('deal_closed_won', {name: newName, company: newCo, stage:'Closed Won', value: String(newVal), email: newEmail, phone: newPhone});
  }

  touchDeal(d.name || d.co || d.id);
  closeDealDetail();
  renderKanban();
  renderDash();
}

async function deleteDeal(){
  if(currentDealStage === null || currentDealIdx === null) return;
  if(!confirm('Delete this deal?')) return;
  const stage = currentDealStage, idx = currentDealIdx;
  const d = (deals[stage]||[])[idx];
  if(d && d.id && !String(d.id).startsWith('tmp_')){
    // Confirm the server actually deleted the row before removing it from the
    // board — an RLS reject deletes 0 rows with no error (CLAUDE.md rule #4).
    let dq;
    try { dq = await supa.from('deals').delete().eq('id', d.id).select(); }
    catch(e){ dq = { error: e }; }
    if(dq.error || (Array.isArray(dq.data) && dq.data.length === 0)){
      alert('Could not delete this deal — the server rejected it'
        + (dq.error ? ': ' + (dq.error.message || dq.error) : ' (0 rows). Nothing was deleted.'));
      return;
    }
  }
  deals[stage].splice(idx, 1);
  closeDealDetail();
  renderKanban();
  renderDash();
}

document.getElementById('deal-detail-panel').addEventListener('click', function(e){
  if(e.target === this) closeDealDetail();
});
