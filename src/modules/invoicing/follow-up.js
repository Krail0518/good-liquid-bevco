/*
 * follow-up.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: loadFollowupLog, openFollowUpModal, closeFollowupModal, sendFollowupEmail, regenFollowup, getFollowupLog
 */
/* ═══════════════════════════════════════════
   INVOICE FOLLOW-UP
═══════════════════════════════════════════ */
/* Follow-up log: backed by Supabase `followup_log` table. The in-memory
   `followupLog` keyed by invoice_number is hydrated from Supabase on
   login (see loadSupabaseData) and updated after each send. Reads are
   sync (cache lookups); writes go to both the cache and the DB. */
let followupLog = {};
window.followupLog = followupLog;
async function loadFollowupLog(){
  try {
    const r = await supa.from('followup_log').select('invoice_number, sent_at, kind, notes, sent').order('sent_at', { ascending: true });
    if(r.error) { console.warn('[GL] followup_log load:', r.error); return; }
    followupLog = {};
    (r.data || []).forEach(row => {
      const k = row.invoice_number || '';
      if(!k) return;
      if(!followupLog[k]) followupLog[k] = [];
      followupLog[k].push({
        date: new Date(row.sent_at).toLocaleDateString(),
        subject: row.notes || row.kind || 'Follow-up',
        sent: row.sent !== false
      });
    });
    window.followupLog = followupLog;
  } catch(e){ console.warn('[GL] followup_log load threw', e); }
}
let currentFollowupInvId = null;

function openFollowUpModal(){
  if(!currentInvId) return;
  const inv=invoices.find(i=>i.id===currentInvId);
  if(!inv) return;
  currentFollowupInvId=currentInvId;

  const modal=document.getElementById('followup-modal');
  modal.classList.add('show');
  document.getElementById('followup-loading').style.display='block';
  document.getElementById('followup-content').style.display='none';
  
  const daysDue=inv.date?Math.floor((Date.now()-new Date(inv.date).getTime())/(1000*60*60*24)):0;
  let tone='gentle';
  if(daysDue>30) tone='firm'; 
  else if(daysDue>14) tone='professional';
  
  callAI('You are a professional business communication specialist for Good Liquid Bev Co, a beverage co-packer.',
    `Draft a follow-up email for an unpaid invoice. 
    Client: ${inv.clientName}
    Invoice #: ${inv.id}
    Amount: $${inv.amount.toLocaleString()}
    Invoice Date: ${inv.date}
    Days since invoice: ${daysDue}
    Tone: ${tone} (${daysDue>30?'firm but professional, mention possible late fees':daysDue>14?'politely firm':'friendly reminder'})
    
    Format: Start with Subject: on first line, then blank line, then email body. Sign off as Good Liquid Accounting (do NOT use a personal name).`)
    .then(text=>{
      const lines=text.split('\n');
      const subjLine=lines.find(l=>l.startsWith('Subject:'));
      const subject=subjLine?subjLine.replace('Subject:','').trim():`Follow-up: Invoice ${inv.id} — ${inv.clientName}`;
      const body=lines.filter(l=>!l.startsWith('Subject:')).join('\n').trim();
      
      // Look up the freshest email from the clients array (covers the case
      // where the in-memory invoice has stale clientEmail). NEVER fall back
      // to the client name — that's what caused "Ceres14.com" to land in
      // the To field and the send will be rejected.
      (function(){
        var client = (window.clients||[]).find(function(c){ return c.id === inv.client; });
        var toAddr = (client && client.email) ? client.email : (inv.clientEmail || '');
        var toEl = document.getElementById('fu-to');
        toEl.value = toAddr;
        // Make the field readonly only when we have a valid email; otherwise
        // let the user type one in inline. The Send button below also
        // refuses to fire on an empty or non-email value.
        toEl.removeAttribute('readonly');
        if(!toAddr || toAddr.indexOf('@') < 0){
          toEl.style.borderColor = '#ff8579';
          toEl.placeholder = 'No email on file — type one to send';
        }
      })();
      // Surface the client's additional emails as Cc so the user can see
      // who else will be copied before sending.
      (function(){
        var client = (window.clients||[]).find(function(c){ return c.id === inv.client; });
        var cc = (client && Array.isArray(client.additionalEmails)) ? client.additionalEmails : [];
        var row = document.getElementById('fu-cc-row');
        var inp = document.getElementById('fu-cc');
        if(cc.length){
          inp.value = cc.map(function(c){ return c.email + (c.label ? ' ('+c.label+')' : ''); }).join(', ');
          row.style.display = '';
        } else {
          inp.value = '';
          row.style.display = 'none';
        }
      })();
      document.getElementById('fu-subject').value=subject;
      document.getElementById('fu-body').value=body;
      document.getElementById('followup-loading').style.display='none';
      document.getElementById('followup-content').style.display='block';
      document.getElementById('fu-refine-row').style.display='block';
    }).catch(()=>{
      document.getElementById('fu-body').value=`Dear ${inv.clientName},\n\nThis is a friendly reminder that Invoice ${inv.id} for $${inv.amount.toLocaleString()} remains unpaid.\n\nPlease remit payment at your earliest convenience.\n\nBest regards,\nGood Liquid Accounting\nMike@GoodLiquid.com | (803) 493-5065`;
      document.getElementById('followup-loading').style.display='none';
      document.getElementById('followup-content').style.display='block';
    });
}

function closeFollowupModal(){ document.getElementById('followup-modal').classList.remove('show'); }

async function sendFollowupEmail(){
  const to=document.getElementById('fu-to').value.trim();
  const subject=document.getElementById('fu-subject').value;
  const body=document.getElementById('fu-body').value;
  // Guard against the "Ceres14.com" class of bug — if there's no '@' in
  // the To field, the send will fail and the user gets no feedback.
  if(!to || to.indexOf('@') < 0){
    alert('No email address on file for this client. Type one in the To field, or add it via Edit Client first.');
    return;
  }

  // Cc the client's additional emails (AP, ops, etc.) so everyone on the
  // account sees the follow-up.
  const inv = (window.invoices||[]).find(i => i.id === currentFollowupInvId);
  const client = inv ? (window.clients||[]).find(c => c.id === inv.client) : null;
  const cc = (client && Array.isArray(client.additionalEmails)) ? client.additionalEmails : [];

  const sent=await sendMailgunEmail(to,subject,body,{cc:cc});

  // Log the follow-up — write to Supabase followup_log + mirror in cache.
  try {
    const supaInv = inv && inv.supaId ? inv.supaId : null;
    await supa.from('followup_log').insert({
      invoice_id:     supaInv,
      invoice_number: currentFollowupInvId,
      kind:           'manual',
      sent:           !!sent,
      cc_count:       cc.length,
      notes:          subject
    });
  } catch(e){ console.warn('[GL] followup_log insert failed', e); }
  if(!followupLog[currentFollowupInvId]) followupLog[currentFollowupInvId]=[];
  followupLog[currentFollowupInvId].push({date:new Date().toLocaleDateString(),subject,sent,ccCount:cc.length});

  const ccNote = cc.length ? ' (+' + cc.length + ' Cc)' : '';
  addNotification('📧 Follow-up sent','Invoice '+currentFollowupInvId+' — '+to+ccNote,'email');
  closeFollowupModal();

  if(sent) alert('✓ Follow-up email sent!' + (cc.length ? '\n\nCc: ' + cc.map(c => c.email).join(', ') : ''));
  else alert('✓ Follow-up logged. (Email sending not configured.)');
}

function regenFollowup(){
  document.getElementById('followup-loading').style.display='block';
  document.getElementById('followup-content').style.display='none';
  openFollowUpModal();
}

function getFollowupLog(invId){
  const log=followupLog[invId]||[];
  if(!log.length) return '';
  return `<div style="margin-top:16px"><div style="font-size:10px;letter-spacing:2px;color:var(--muted);margin-bottom:8px">FOLLOW-UP HISTORY</div>
    ${log.map(l=>`<div class="fu-log-item">
      <div class="fu-log-icon">📧</div>
      <div style="flex:1"><div class="fu-log-text">${esc(l.subject)}</div><div class="fu-log-time">${l.date} · ${l.sent?'Sent':'Logged only'}</div></div>
    </div>`).join('')}
  </div>`;
}
