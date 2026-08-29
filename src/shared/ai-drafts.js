/*
 * ai-drafts.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: openAICommModal, closeAICommModal, glRefineFeedback, glGetCapsDoc, glRunRefine, refineFollowupEmail, refineAIComm, generateAIComm, sendAIComm
 */
/* ═══════════════════════════════════════════
   AI COMMUNICATION DRAFTS
═══════════════════════════════════════════ */
function openAICommModal(){
  const sel=document.getElementById('ai-comm-client');
  sel.innerHTML='<option value="">Select client…</option>'+clients.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  document.getElementById('ai-comm-output').style.display='none';
  document.getElementById('ai-comm-send-btn').style.display='none';
  document.getElementById('ai-comm-custom-row').style.display='none';
  document.getElementById('ai-comm-modal').classList.add('show');
}
function closeAICommModal(){ document.getElementById('ai-comm-modal').classList.remove('show'); }

document.addEventListener('change',e=>{
  if(e.target.id==='ai-comm-type'){
    document.getElementById('ai-comm-custom-row').style.display=e.target.value==='custom'?'block':'none';
  }
});

// Shows a small inline note inside a "Refine with Claude" row so clicking
// ✨ Apply never silently does nothing. Two dead-ends this fixes: an empty
// instruction box (nothing to refine) and a failed AI call — both used to
// return with zero feedback, which reads as "the button is broken".
function glRefineFeedback(rowEl, msg, isError){
  if(!rowEl) return;
  var note = rowEl.querySelector('.gl-refine-note');
  if(!note){
    note = document.createElement('div');
    note.className = 'gl-refine-note';
    note.style.cssText = 'font-size:11px;margin-top:7px;line-height:1.4';
    rowEl.appendChild(note);
  }
  note.style.color = isError ? '#ff8579' : 'var(--teal)';
  note.textContent = msg;
  if(note._t) clearTimeout(note._t);
  note._t = setTimeout(function(){ if(note) note.textContent = ''; }, 5000);
}
window.glRefineFeedback = glRefineFeedback;

// The live pricing/capabilities reference every AI email feature reads.
// Cached briefly so several drafts in a row don't re-query. Empty string
// means NO doc is loaded — callers must then forbid invented prices
// (GL_NO_PRICING_GUARD) instead of letting Claude improvise numbers.
async function glGetCapsDoc(){
  try {
    var c = window.__glCapsDoc;
    if(c && (Date.now() - c.at) < 5 * 60000) return c.text;
    var res = await supa.from('company_docs').select('content').eq('key','capabilities_pricing').single();
    var text = (res && res.data && res.data.content) ? String(res.data.content) : '';
    window.__glCapsDoc = { text: text, at: Date.now() };
    return text;
  } catch(e){ console.warn('[GL] Could not load capabilities doc', e); return ''; }
}
window.glGetCapsDoc = glGetCapsDoc;

// Added to every AI email prompt whenever no pricing doc is loaded. Inventing
// prices cost real credibility with a real lead once — never again.
var GL_NO_PRICING_GUARD = 'IMPORTANT: No pricing reference document is loaded. Do NOT state any specific prices, fees, minimums, volumes or turnaround times — you do not know them and must not invent them. Instead, invite the lead to a quick call for current pricing.';
window.GL_NO_PRICING_GUARD = GL_NO_PRICING_GUARD;

// One hardened path for every "Refine with Claude" button (lead composer,
// AI Comm, invoice follow-up). Guarantees the button is NEVER left hung and
// ALWAYS gives visible feedback — the try/catch/finally means even an
// unexpected throw re-enables the button and surfaces an error, and the
// 'AI response unavailable.' sentinel from callAI is treated as a failure
// (not pasted into the email). opts: {row, instrEl, subjEl, bodyEl, btn, statusEl}.
async function glRunRefine(opts){
  var row = opts.row, instrEl = opts.instrEl, subjEl = opts.subjEl, bodyEl = opts.bodyEl, btn = opts.btn, statusEl = opts.statusEl;
  var instruction = instrEl ? instrEl.value.trim() : '';
  if(!instruction){ glRefineFeedback(row, 'Type an instruction first (e.g. "make it shorter") — or just edit the message above directly.', true); if(instrEl) instrEl.focus(); return; }
  var origText = btn ? btn.textContent : '✨ Apply';
  try {
    if(btn){ btn.disabled = true; btn.textContent = '🤖 Refining…'; }
    if(statusEl){ statusEl.style.display = 'block'; statusEl.textContent = '🤖 Claude is refining your email…'; }
    // Refine gets the pricing doc too — "add the real prices" was a no-op
    // when only the first draft carried the reference.
    var caps = '';
    try { caps = await glGetCapsDoc(); } catch(_e){}
    var refined = await callAI(
      'You are helping Mike at Good Liquid Bev Co revise a draft email. Apply the requested changes precisely. Return the complete revised email: Subject line first (starting with "Subject: "), blank line, then email body only — no extra labels.'
        + (caps ? '\n\n--- GOOD LIQUID CAPABILITIES & PRICING REFERENCE (use these real numbers when pricing comes up) ---\n' + caps
                : '\n\n' + GL_NO_PRICING_GUARD),
      'Current email:\nSubject: ' + (subjEl ? subjEl.value.trim() : '') + '\n\n' + (bodyEl ? bodyEl.value.trim() : '') + '\n\n---\nRevise per this instruction: ' + instruction
    );
    if(!refined || refined === 'AI response unavailable.'){
      glRefineFeedback(row, '⚠ Couldn’t reach Claude to refine. Try again in a moment, or just edit the message directly.', true);
      return;
    }
    var lines = refined.split('\n');
    var subjLine = lines.find(function(l){ return /^subject:/i.test(l); });
    if(subjEl && subjLine) subjEl.value = subjLine.replace(/^subject:\s*/i,'').trim();
    if(bodyEl) bodyEl.value = lines.filter(function(l){ return !/^subject:/i.test(l); }).join('\n').trim();
    if(instrEl) instrEl.value = '';
    glRefineFeedback(row, '✓ Applied.', false);
  } catch(e){
    console.error('[GL] refine threw', e);
    glRefineFeedback(row, '⚠ Something went wrong applying the refine. Please try again.', true);
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = origText; }
    if(statusEl){ statusEl.style.display = 'none'; }
  }
}
window.glRunRefine = glRunRefine;

async function refineFollowupEmail(){
  return glRunRefine({
    row:     document.getElementById('fu-refine-row'),
    instrEl: document.getElementById('fu-refine'),
    subjEl:  document.getElementById('fu-subject'),
    bodyEl:  document.getElementById('fu-body'),
    btn:     document.querySelector('#fu-refine-row button')
  });
}

async function refineAIComm(){
  var instrEl = document.getElementById('ai-comm-refine');
  return glRunRefine({
    row:     instrEl ? instrEl.closest('.frow') : null,
    instrEl: instrEl,
    subjEl:  document.getElementById('ai-comm-subj'),
    bodyEl:  document.getElementById('ai-comm-body'),
    btn:     document.querySelector('#ai-comm-output button')
  });
}

async function generateAIComm(){
  const clientId=document.getElementById('ai-comm-client').value;
  const type=document.getElementById('ai-comm-type').value;
  const client=clients.find(c=>c.id===clientId);
  const custom=document.getElementById('ai-comm-custom')?.value;
  
  const prompts={
    quote:`Draft a professional email to ${client?client.name:'the client'} confirming a quote has been sent. Include next steps.`,
    production:`Draft a production status update email to ${client?client.name:'the client'}. Mention timeline, format, and what to expect next.`,
    delay:`Draft a professional delay notice email to ${client?client.name:'the client'}. Apologize, explain briefly, give new timeline.`,
    welcome:`Draft a warm onboarding welcome email for ${client?client.name:'a new client'} starting their beverage journey with Good Liquid Bev Co.`,
    custom:custom||'Draft a professional email.'
  };
  
  showAIModal('Drafting email...','',true);
  const text=await callAI('You are writing professional emails for Mike Krail at Good Liquid Bev Co, a beverage co-packer in Palmetto, FL.',
    `${prompts[type]}

Format: Subject: on first line, then blank line, then email body. Sign off as Good Liquid Accounting (do NOT use a personal name).`);
  closeAIModal();
  
  const lines=text.split('\n');
  const subjLine=lines.find(l=>l.startsWith('Subject:'));
  document.getElementById('ai-comm-subj').value=subjLine?subjLine.replace('Subject:','').trim():'Good Liquid Bev Co Update';
  document.getElementById('ai-comm-body').value=lines.filter(l=>!l.startsWith('Subject:')).join('\n').trim();
  document.getElementById('ai-comm-output').style.display='block';
  document.getElementById('ai-comm-send-btn').style.display='inline-flex';
}

async function sendAIComm(){
  var _clientId = document.getElementById('ai-comm-client').value;
  var _client = clients.find(function(c){ return c.id === _clientId; });
  if(!_client){ alert('Please select a client.'); return; }
  if(!_client.email){ alert('No email address on file for this client.'); return; }
  const subject=document.getElementById('ai-comm-subj').value;
  const body=document.getElementById('ai-comm-body').value;
  const sent=await sendMailgunEmail(_client.email,subject,body);
  addNotification('📧 Email sent','To: '+_client.name,'email');
  closeAICommModal();
  alert(sent?'✓ Email sent!':'✗ Send failed — check the browser console.');
}

