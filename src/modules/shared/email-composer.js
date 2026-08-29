/*
 * email-composer.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: openFollowUp, closeFollowUp, setTone, openMailto, copyEmail
 */
/* ═══ FOLLOW-UP EMAIL COMPOSER ═══ */
let currentTone = 'friendly';

function openFollowUp(){
  if(!currentInvId)return;
  const inv = invoices.find(i=>i.id===currentInvId);
  if(!inv)return;
  const c = clients.find(x=>x.id===inv.client)||{name:inv.clientName,email:''};
  const toEl = document.getElementById('fu-to');
  toEl.value = c.email||'';
  toEl.removeAttribute('readonly');
  if(!toEl.value || toEl.value.indexOf('@')<0){
    toEl.style.borderColor='#ff8579';
    toEl.placeholder='No email on file — type one to send';
  }
  // Auto-select tone based on status
  const tone = inv.status==='overdue' ? 'firm' : 'friendly';
  setTone(tone, inv);
  // Show content, hide loading spinner
  document.getElementById('followup-loading').style.display='none';
  document.getElementById('followup-content').style.display='block';
  document.getElementById('followup-modal').classList.add('show');
}

function closeFollowUp(){
  document.getElementById('followup-modal').classList.remove('show');
  document.getElementById('fu-copied').style.display='none';
}

function setTone(tone, inv){
  currentTone = tone;
  // Style buttons
  ['friendly','firm','final'].forEach(t=>{
    const btn=document.getElementById('tone-'+t);
    if(btn){btn.className = t===tone ? 'cbtn pri' : (t==='final' ? 'cbtn red' : 'cbtn');btn.style.fontSize='11px';btn.style.flex='1';}
  });
  if(!inv){
    if(!currentInvId)return;
    inv = invoices.find(i=>i.id===currentInvId);
    if(!inv)return;
  }
  const c = clients.find(x=>x.id===inv.client)||{name:inv.clientName,contact:'',email:''};
  const firstName = (c.contact||c.name).split(' ')[0];
  const amt = '$'+inv.amount.toLocaleString();
  const invNum = inv.id;
  const date = inv.date;

  const subjects = {
    friendly: `Following up — Invoice ${invNum}`,
    firm: `Payment reminder — Invoice ${invNum} (${amt})`,
    final: `FINAL NOTICE — Invoice ${invNum} — ${amt} past due`
  };

  const bodies = {
    friendly:
`Hi ${firstName},

Hope things are going well! I wanted to follow up on invoice ${invNum} for ${amt}, issued on ${date}.

If you have any questions about the invoice or need anything from our end, please don't hesitate to reach out — happy to help.

If payment has already been sent, please disregard this message.

Thanks so much,
Mike Krail
Good Liquid Bev Co
Mike@GoodLiquid.com
2011 51st Ave E, Unit 100 · Palmetto, FL 34221`,

    firm:
`Hi ${firstName},

I'm following up on invoice ${invNum} for ${amt} dated ${date}, which appears to be outstanding.

Could you let me know when we can expect payment, or if there's anything holding things up on your end? We're happy to work through any questions.

Please remit payment at your earliest convenience. Wire transfer or check are both accepted — reply to this email for banking details.

Thank you,
Mike Krail
Good Liquid Bev Co
Mike@GoodLiquid.com
(941) 555-0100`,

    final:
`Hi ${firstName},

This is a final notice regarding invoice ${invNum} for ${amt}, issued ${date}, which remains unpaid.

We value our relationship and want to resolve this promptly. Please arrange payment immediately or contact me directly today to discuss.

Failure to respond may result in suspension of future production runs.

Mike Krail
Good Liquid Bev Co
Mike@GoodLiquid.com
(941) 555-0100`
  };

  document.getElementById('fu-subject').value = subjects[tone];
  document.getElementById('fu-body').value = bodies[tone];
}

function openMailto(){
  const to = encodeURIComponent(document.getElementById('fu-to').value||'');
  const subject = encodeURIComponent(document.getElementById('fu-subject').value||'');
  const body = encodeURIComponent(document.getElementById('fu-body').value||'');
  window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
}

function copyEmail(){
  const subject = document.getElementById('fu-subject').value;
  const body = document.getElementById('fu-body').value;
  const text = `Subject: ${subject}\n\n${body}`;
  navigator.clipboard.writeText(text).then(()=>{
    const el=document.getElementById('fu-copied');
    el.style.display='block';
    setTimeout(()=>el.style.display='none',2500);
  }).catch(()=>{
    const ta=document.createElement('textarea');
    ta.value=text;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);
    const el=document.getElementById('fu-copied');el.style.display='block';
    setTimeout(()=>el.style.display='none',2500);
  });
}
