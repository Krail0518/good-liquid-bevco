/*
 * email-templates.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: glEmailTemplatesBackfill, loadEmailTemplates, openEmailTemplates, renderEmailTemplates, saveNewTemplate, deleteTemplate, useTemplate
 */
/* ═══════════════════════════════════════════
   EMAIL TEMPLATES
   Save & reuse email templates (sent via Gmail)
═══════════════════════════════════════════ */
/* Email templates source of truth: public.email_templates
   (migration shipped 2026-05-18). The JS used to dual-write to
   localStorage; now it just reads + writes the table. */
let emailTemplates = [];

async function glEmailTemplatesBackfill(){
  try {
    if(localStorage.getItem('gl_email_templates_migrated') === '1') return;
    if(!window.supa) return;
    const blob = localStorage.getItem('gl_email_templates');
    if(!blob){ localStorage.setItem('gl_email_templates_migrated','1'); return; }
    let legacy = []; try { legacy = JSON.parse(blob) || []; } catch(_e){ return; }
    if(!legacy.length){ localStorage.setItem('gl_email_templates_migrated','1'); return; }
    const rows = legacy.map(t => ({
      name:     String(t.name || 'Untitled').slice(0, 200),
      category: 'general',
      subject:  String(t.subject || '').slice(0, 500),
      body:     String(t.body || ''),
      active:   true
    })).filter(r => r.subject && r.body);
    if(!rows.length){ localStorage.setItem('gl_email_templates_migrated','1'); return; }
    const r = await window.supa.from('email_templates').insert(rows);
    if(r.error){ console.warn('[GL] email_templates backfill failed', r.error.message); return; }
    localStorage.setItem('gl_email_templates_migrated','1');
    if(typeof addNotification === 'function'){
      addNotification('📧 Templates migrated', rows.length + ' email template' + (rows.length===1?'':'s') + ' moved to the cloud.', 'success');
    }
  } catch(e){ console.warn('[GL] email_templates backfill threw', e); }
}

async function loadEmailTemplates(){
  if(!window.supa){ emailTemplates = []; return; }
  await glEmailTemplatesBackfill();
  const r = await window.supa.from('email_templates')
    .select('id, name, subject, body, category, active')
    .eq('active', true)
    .order('name', { ascending: true });
  if(r.error){ console.warn('[GL] loadEmailTemplates failed', r.error.message); emailTemplates = []; return; }
  emailTemplates = r.data || [];
}

async function openEmailTemplates(){
  await loadEmailTemplates();
  const existing = document.getElementById('email-templates-modal');
  if(existing){ existing.classList.add('show'); renderEmailTemplates(); return; }

  const modal = document.createElement('div');
  modal.id = 'email-templates-modal';
  modal.className = 'modal-ov show';
  modal.innerHTML = `
    <div class="modal-box" style="width:600px;max-height:85vh;overflow-y:auto">
      <div class="modal-title">📧 Email Templates <span class="modal-close" onclick="document.getElementById('email-templates-modal').classList.remove('show')">✕</span></div>
      <div id="et-list"></div>
      <div style="margin-top:16px;border-top:1px solid rgba(255,255,255,.07);padding-top:16px">
        <div style="font-size:11px;letter-spacing:2px;color:var(--muted);margin-bottom:10px">CREATE NEW TEMPLATE</div>
        <div class="frow"><div class="flbl">Template name</div><input class="finp" id="et-name" placeholder="e.g. Payment Reminder"></div>
        <div class="frow"><div class="flbl">Subject</div><input class="finp" id="et-subject" placeholder="Email subject line"></div>
        <div class="frow"><div class="flbl">Body</div><textarea class="finp" id="et-body" rows="5" placeholder="Use [Name] for client name, [Amount] for invoice amount…" style="resize:vertical"></textarea></div>
        <button class="cbtn pri" onclick="saveNewTemplate()" style="width:100%">Save Template</button>
      </div>
    </div>`;
  (document.getElementById('crm-panel')||document.body).appendChild(modal);
  renderEmailTemplates();
}

function renderEmailTemplates(){
  const el = document.getElementById('et-list');
  if(!el) return;
  const esc = s => String(s||'').replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  if(!emailTemplates.length){ el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:10px 0">No templates yet. Save one below.</div>'; return; }
  el.innerHTML = emailTemplates.map(t => `
    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:13px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <div style="font-weight:700;font-size:13px;color:var(--white)">${esc(t.name)}</div>
        <div style="display:flex;gap:6px">
          <button class="cbtn" style="font-size:10px;padding:3px 8px" onclick="useTemplate('${t.id}')">Use</button>
          <button class="cbtn red" style="font-size:10px;padding:3px 8px" onclick="deleteTemplate('${t.id}')">✕</button>
        </div>
      </div>
      <div style="font-size:11px;color:var(--teal);margin-bottom:3px">${esc(t.subject)}</div>
      <div style="font-size:11px;color:var(--muted);white-space:pre-wrap">${esc(t.body.substring(0,100))}${t.body.length>100?'…':''}</div>
    </div>`).join('');
}

async function saveNewTemplate(){
  const name = document.getElementById('et-name')?.value.trim();
  const subject = document.getElementById('et-subject')?.value.trim();
  const body = document.getElementById('et-body')?.value.trim();
  if(!name || !subject || !body){ alert('All fields required'); return; }
  if(!window.supa){ alert('Cloud sync unavailable — try reloading.'); return; }
  const r = await window.supa.from('email_templates').insert([{ name, subject, body, category: 'general', active: true }]);
  if(r.error){ alert('Save failed: ' + r.error.message); return; }
  await loadEmailTemplates();
  renderEmailTemplates();
  document.getElementById('et-name').value='';
  document.getElementById('et-subject').value='';
  document.getElementById('et-body').value='';
  if(typeof glAudit === 'function') glAudit('email_template_saved', null, { name: name.slice(0,80) });
}

async function deleteTemplate(id){
  if(!confirm('Delete this template?')) return;
  if(!window.supa){ return; }
  // Soft-delete via active=false so any historical references survive.
  const r = await window.supa.from('email_templates').update({ active: false }).eq('id', id);
  if(r.error){ alert('Delete failed: ' + r.error.message); return; }
  await loadEmailTemplates();
  renderEmailTemplates();
}

function useTemplate(id){
  const t = emailTemplates.find(x => x.id === id);
  if(!t) return;
  document.getElementById('email-templates-modal')?.classList.remove('show');
  openAICommModal();
  setTimeout(() => {
    document.getElementById('ai-comm-type').value = 'custom';
    document.getElementById('ai-comm-custom-row').style.display = 'block';
    document.getElementById('ai-comm-custom').value = t.body;
    document.getElementById('ai-comm-subj').value = t.subject;
    document.getElementById('ai-comm-output').style.display = 'block';
    document.getElementById('ai-comm-body').value = t.body;
    document.getElementById('ai-comm-send-btn').style.display = 'inline-flex';
  }, 200);
}
