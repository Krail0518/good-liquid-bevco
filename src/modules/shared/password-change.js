/*
 * password-change.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: openChangePwModal, closeChangePwModal, doChangePassword, openResetOverlay, closeResetOverlay, sendResetLink, ensureJsPdf, generateInvoicePdfBlob, sendMailgunEmail
 */
/* ═══════════════════════════════════════════
   PASSWORD CHANGE SYSTEM
═══════════════════════════════════════════ */
function openChangePwModal(){
  const modal=document.getElementById('change-pw-modal');
  const isAdmin=currentUser&&currentUser.role==='admin';
  const adminSection=document.getElementById('change-pw-admin');
  if(adminSection) adminSection.style.display=isAdmin?'block':'none';
  if(isAdmin){
    const sel=document.getElementById('change-pw-user-sel');
    if(sel) sel.innerHTML=users.map(u=>`<option value="${esc(u.id)}">${esc(u.name)} (${esc(u.role)})</option>`).join('');
  }
  document.getElementById('change-pw-err').style.display='none';
  document.getElementById('change-pw-ok').style.display='none';
  modal.classList.add('show');
}
function closeChangePwModal(){ document.getElementById('change-pw-modal').classList.remove('show'); }

function doChangePassword(){
  const oldPw=document.getElementById('change-pw-old').value;
  const newPw=document.getElementById('change-pw-new').value;
  const confirmPw=document.getElementById('change-pw-confirm').value;
  const err=document.getElementById('change-pw-err');
  const ok=document.getElementById('change-pw-ok');
  
  err.style.display='none'; ok.style.display='none';
  
  const _pwErr = (window.glValidatePassword ? window.glValidatePassword(newPw) : (newPw.length < 8 ? 'Password must be at least 8 characters.' : null));
  if(_pwErr){ err.textContent = _pwErr; err.style.display='block'; return; }
  if(newPw!==confirmPw){err.textContent='Passwords do not match.';err.style.display='block';return;}
  
  const isAdmin=currentUser&&currentUser.role==='admin';
  let targetUser=currentUser;
  
  if(isAdmin&&document.getElementById('change-pw-user-sel')){
    const uid=document.getElementById('change-pw-user-sel').value;
    targetUser=users.find(u=>u.id===uid)||currentUser;
  }
  
  // For admin resetting someone else, skip current password check
  if(targetUser.id===currentUser.id&&oldPw!==currentUser.password){
    err.textContent='Current password is incorrect.';err.style.display='block';return;
  }
  
  targetUser.password=newPw;
  ok.style.display='block';
  addNotification('🔑 Password changed','Password updated for '+targetUser.name,'success');
  setTimeout(()=>closeChangePwModal(),2000);
}

function openResetOverlay(){ 
  closePw();
  document.getElementById('reset-overlay').classList.add('show'); 
}
function closeResetOverlay(){ document.getElementById('reset-overlay').classList.remove('show');document.getElementById('reset-step1').style.display='block';document.getElementById('reset-success').style.display='none';openAdmin(); }
function sendResetLink(){
  const email=document.getElementById('reset-email-inp').value.trim();
  if(!email) return;
  document.getElementById('reset-step1').style.display='none';
  document.getElementById('reset-success').style.display='block';
  const u=users.find(x=>x.email.toLowerCase()===email.toLowerCase());
  if(u){
    const tempPw='GL'+Math.random().toString(36).substring(2,8).toUpperCase();
    sendMailgunEmail(email,'[Good Liquid CRM] Password Reset',
      `Hi ${u.name},\n\nYour temporary password is: ${tempPw}\n\nPlease log in and change it immediately.\n\nGood Liquid Bev Co`);
  }
}

// (Removed dead MAILGUN_DOMAIN_DEFAULT / MAILGUN_FROM_DEFAULT constants —
//  outbound email now sends via Gmail; the from-address is set server-side in
//  the gmail-send / mailgun-send Edge Functions.)

// Lazily load jsPDF (only when the user actually sends an invoice with
// PDF attached). Bundle stays small at ~0KB for users who never send.
// jsPDF builds native-text PDFs — smaller, sharper, copy-paste-able,
// and search-indexable — vs the image-based output html2pdf produced.
let _jsPdfLoading = null;
function ensureJsPdf(){
  if(window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if(_jsPdfLoading) return _jsPdfLoading;
  _jsPdfLoading = new Promise(function(resolve, reject){
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    s.async = true;
    s.onload = function(){
      if(window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
      else reject(new Error('jspdf exported under unexpected global'));
    };
    s.onerror = function(){ _jsPdfLoading = null; reject(new Error('jspdf load failed')); };
    document.head.appendChild(s);
  });
  return _jsPdfLoading;
}

// Generate a native-text PDF Blob from the invoice. Uses jsPDF directly
// so the output is:
//   • text-based (searchable + copy-paste-able)
//   • small (~10-20 KB instead of 150 KB image PDF)
//   • crisp at any zoom level
//   • brand-consistent (site teal + navy)
async function generateInvoicePdfBlob(invId){
  try {
    const jsPDF = await ensureJsPdf();
    const inv = invoices.find(i => i.id === invId);
    if(!inv) return null;
    const c = clients.find(x => x.id === inv.client) || { name: inv.clientName||'', contact:'', email:'' };

    // Brand colors (site teal + dark navy)
    const TEAL_RGB = [0, 184, 154];      // #00b89a — used for accents, body
    const TEAL_BG  = [0, 229, 192];      // #00e5c0 — bright accent for header rule
    const NAVY_RGB = [10, 22, 40];       // #0a1628 — table header bg + text
    const MUTED    = [107, 135, 173];    // #6b87ad — labels
    const LIGHT    = [240, 251, 247];    // #f0fbf7 — wire-info card bg
    const usd = n => '$' + (Number(n)||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
    const terms = inv.paymentTerms || c.paymentTerms || 'Due on receipt';
    const useBilling = c.billingSame === false && (c.billingStreet || c.billingCity);
    const bStreet = useBilling ? c.billingStreet : c.street;
    const bCity   = useBilling ? c.billingCity   : c.city;
    const bState  = useBilling ? c.billingState  : c.state;
    const bZip    = useBilling ? c.billingZip    : c.zip;
    const bLine2  = [bCity, bState].filter(Boolean).join(', ') + (bZip ? ' ' + bZip : '');

    const lines = Array.isArray(inv.lines) && inv.lines.length
      ? inv.lines
      : [{ desc: inv.svc, qty: 1, unitPrice: inv.amount, total: inv.amount }];

    // Letter size, points (612 × 792)
    const pdf = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
    const PW = 612, PH = 792, M = 36;
    const CW = PW - 2*M; // content width

    let y = M;

    // ── Header — left: brand, right: INVOICE / number / status ──
    pdf.setFont('helvetica','bold');
    pdf.setFontSize(16);
    pdf.setTextColor(TEAL_RGB[0], TEAL_RGB[1], TEAL_RGB[2]);
    pdf.text('GOOD LIQUID BEV CO', M, y+14);
    pdf.setFont('helvetica','normal');
    pdf.setFontSize(9);
    pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    pdf.text('2011 51st Ave E, Unit 100 · Palmetto, FL 34221', M, y+28);
    pdf.text('Mike@GoodLiquid.com · (803) 493-5065', M, y+40);

    // Right block — text(text, x, y, { align: 'right' })
    pdf.setFont('helvetica','bold');
    pdf.setFontSize(22);
    pdf.setTextColor(NAVY_RGB[0], NAVY_RGB[1], NAVY_RGB[2]);
    pdf.text('INVOICE', PW-M, y+18, { align:'right' });
    pdf.setFont('courier','bold');
    pdf.setFontSize(11);
    pdf.setTextColor(TEAL_RGB[0], TEAL_RGB[1], TEAL_RGB[2]);
    pdf.text(String(inv.id||''), PW-M, y+34, { align:'right' });
    // Status badge
    const status = (inv.status||'pending').toUpperCase();
    const badgeBg = inv.status==='paid' ? [209,250,229] : inv.status==='overdue' ? [254,226,226] : [255,247,214];
    const badgeFg = inv.status==='paid' ? [6,95,70] : inv.status==='overdue' ? [153,27,27] : [138,101,0];
    pdf.setFont('helvetica','bold'); pdf.setFontSize(9);
    const badgeW = pdf.getTextWidth(status) + 14;
    pdf.setFillColor(badgeBg[0], badgeBg[1], badgeBg[2]);
    pdf.roundedRect(PW-M-badgeW, y+42, badgeW, 14, 7, 7, 'F');
    pdf.setTextColor(badgeFg[0], badgeFg[1], badgeFg[2]);
    pdf.text(status, PW-M-badgeW/2, y+51, { align:'center' });

    y += 70;
    // Teal divider rule
    pdf.setDrawColor(TEAL_BG[0], TEAL_BG[1], TEAL_BG[2]);
    pdf.setLineWidth(2);
    pdf.line(M, y, PW-M, y);
    y += 16;

    // ── Bill To (left) + Invoice Details (right) ──
    pdf.setFont('helvetica','bold'); pdf.setFontSize(8);
    pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    pdf.text('BILL TO', M, y);
    pdf.text('INVOICE DETAILS', PW-M, y, { align:'right' });

    pdf.setFontSize(11);
    pdf.setTextColor(NAVY_RGB[0], NAVY_RGB[1], NAVY_RGB[2]);
    let bly = y + 12;
    pdf.text(String(c.legalName || c.name || ''), M, bly);
    bly += 12;
    pdf.setFont('helvetica','normal'); pdf.setFontSize(9);
    if(c.legalName && c.legalName !== c.name){
      pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      pdf.text('dba ' + c.name, M, bly); bly += 10;
      pdf.setTextColor(NAVY_RGB[0], NAVY_RGB[1], NAVY_RGB[2]);
    }
    if(bStreet){ pdf.text(String(bStreet), M, bly); bly += 10; }
    else { pdf.setTextColor(170,170,170); pdf.setFont('helvetica','italic'); pdf.text('(address not on file)', M, bly); pdf.setFont('helvetica','normal'); pdf.setTextColor(NAVY_RGB[0], NAVY_RGB[1], NAVY_RGB[2]); bly += 10; }
    if(bLine2.trim()){ pdf.text(bLine2, M, bly); bly += 10; }
    pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    if(c.contact){ pdf.text('Attn: ' + c.contact, M, bly); bly += 10; }
    if(c.email){ pdf.text(String(c.email), M, bly); bly += 10; }
    if(c.phone){ pdf.text(String(c.phone), M, bly); bly += 10; }

    pdf.setTextColor(NAVY_RGB[0], NAVY_RGB[1], NAVY_RGB[2]);
    pdf.text('Date: ' + (inv.date||''), PW-M, y+12, { align:'right' });
    pdf.text('Terms: ' + terms,         PW-M, y+24, { align:'right' });

    y = Math.max(bly, y+40) + 8;

    // ── Line items table ──
    const colX = [ M, M+260, M+360, PW-M-90 ]; // Description / Qty / Unit Price / Amount
    const colW = [ 260, 100, 70, 90 ];
    const HEAD_H = 22;
    pdf.setFillColor(NAVY_RGB[0], NAVY_RGB[1], NAVY_RGB[2]);
    pdf.rect(M, y, CW, HEAD_H, 'F');
    pdf.setFont('helvetica','bold'); pdf.setFontSize(9);
    pdf.setTextColor(TEAL_BG[0], TEAL_BG[1], TEAL_BG[2]);
    pdf.text('DESCRIPTION', colX[0]+8,  y+14);
    pdf.text('QTY',         colX[1]+colW[1]/2, y+14, { align:'center' });
    pdf.text('UNIT PRICE',  colX[2]+colW[2],   y+14, { align:'right' });
    pdf.text('AMOUNT',      colX[3]+colW[3]-2, y+14, { align:'right' });
    y += HEAD_H;

    // Rows
    pdf.setFont('helvetica','normal'); pdf.setFontSize(10);
    pdf.setTextColor(NAVY_RGB[0], NAVY_RGB[1], NAVY_RGB[2]);
    pdf.setDrawColor(230,232,236);
    pdf.setLineWidth(0.5);
    lines.forEach(function(l){
      const desc = String(l.desc || '');
      const wrapped = pdf.splitTextToSize(desc, colW[0] - 16);
      const rowH = Math.max(22, 12 + (wrapped.length - 1) * 11);
      pdf.text(wrapped, colX[0]+8, y+14);
      pdf.text(l.qty != null ? Number(l.qty).toLocaleString() : '', colX[1]+colW[1]/2, y+14, { align:'center' });
      const up = l.unitPrice != null ? usd(l.unitPrice) + (l.unit ? ' /'+l.unit : '') : '';
      pdf.text(up, colX[2]+colW[2], y+14, { align:'right' });
      pdf.setFont('helvetica','bold');
      pdf.text(usd(l.total||0), colX[3]+colW[3]-2, y+14, { align:'right' });
      pdf.setFont('helvetica','normal');
      pdf.line(M, y+rowH, PW-M, y+rowH);
      y += rowH;
    });
    if(inv.discount && inv.discountAmt){
      pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      pdf.text('Discount (' + inv.discount + '%)', colX[2]+colW[2], y+14, { align:'right' });
      pdf.text('−' + usd(inv.discountAmt),         colX[3]+colW[3]-2, y+14, { align:'right' });
      pdf.line(M, y+22, PW-M, y+22);
      y += 22;
      pdf.setTextColor(NAVY_RGB[0], NAVY_RGB[1], NAVY_RGB[2]);
    }
    if(inv.notes){
      pdf.setFont('helvetica','italic'); pdf.setFontSize(9);
      pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      const wn = pdf.splitTextToSize(String(inv.notes), CW-16);
      pdf.text(wn, M+8, y+14);
      y += Math.max(22, 12 + (wn.length-1)*11);
      pdf.setFont('helvetica','normal');
    }
    // Total Due row
    pdf.setFillColor(230, 251, 246);
    pdf.rect(M, y, CW, 30, 'F');
    pdf.setFont('helvetica','bold'); pdf.setFontSize(13);
    pdf.setTextColor(NAVY_RGB[0], NAVY_RGB[1], NAVY_RGB[2]);
    pdf.text('Total Due', M+12, y+20);
    pdf.setFontSize(16);
    pdf.setTextColor(TEAL_RGB[0], TEAL_RGB[1], TEAL_RGB[2]);
    pdf.text(usd(inv.amount), PW-M-8, y+20, { align:'right' });
    y += 44;

    // ── Wire transfer instructions ──
    pdf.setDrawColor(TEAL_BG[0], TEAL_BG[1], TEAL_BG[2]);
    pdf.setFillColor(LIGHT[0], LIGHT[1], LIGHT[2]);
    pdf.setLineWidth(0.8);
    const wireH = 86;
    pdf.roundedRect(M, y, CW, wireH, 6, 6, 'FD');
    pdf.setFont('helvetica','bold'); pdf.setFontSize(8);
    pdf.setTextColor(TEAL_RGB[0], TEAL_RGB[1], TEAL_RGB[2]);
    pdf.text('PAYMENT INSTRUCTIONS — WIRE TRANSFER', M+14, y+18);
    pdf.setFontSize(10);
    pdf.setFont('helvetica','normal');
    pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    pdf.text('Bank Name',         M+14, y+36);
    pdf.text('Account Number',    M+14, y+52);
    pdf.text('Routing (ABA)',     M+14, y+68);
    pdf.setTextColor(NAVY_RGB[0], NAVY_RGB[1], NAVY_RGB[2]);
    pdf.text('Gulfside Bank',     M+150, y+36);
    pdf.setFont('courier','normal');
    pdf.text('1000007789',        M+150, y+52);
    pdf.text('063116902',         M+150, y+68);
    y += wireH + 12;

    // Footer
    pdf.setFont('helvetica','normal'); pdf.setFontSize(8);
    pdf.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    pdf.text('Payment to Good Liquid Bev Co · Mike@GoodLiquid.com · (803) 493-5065 · goodliquidbevco.com',
      PW/2, PH-24, { align:'center' });

    // Generate blob
    const blob = pdf.output('blob');
    if(!blob || blob.size < 1500){
      console.warn('[GL] PDF blob suspiciously small ('+(blob ? blob.size : 0)+' bytes)');
      return null;
    }
    return { blob: blob, filename: invId + '.pdf' };
  } catch(e){
    console.error('[GL] PDF generation failed', e);
    return null;
  }
}

/* ⚠️ EMAIL SEND — READ ME (future devs) ⚠️
   Despite the historical name `sendMailgunEmail`, this is THE single wrapper
   for ALL outbound CRM email, and as of 2026-07-25 it sends via GMAIL
   (the company account mike@goodliquid.com) through the `gmail-send` Edge
   Function — NOT Mailgun. We moved off Mailgun for deliverability (mail wasn't
   reaching clients). `mailgun-send` is kept only as an automatic fallback that
   fires if gmail-send errors, so email is never lost.
   • Credentials (Gmail OAuth / Mailgun key) live in Supabase secrets — never
     in the browser. Invoked via supa.functions.invoke so the staff JWT is
     attached and the function authorizes the caller.
   • Attachments are base64-encoded for JSON transport, decoded server-side.
   • The name and the `_lastMailgunId` / email_log.mailgun_id fields are legacy
     and now just hold whichever provider's message id was returned.
   To fully retire Mailgun later: remove the fallback branch below + the
   mailgun-* Edge Functions. */
async function sendMailgunEmail(to, subject, body, opts){
  opts = opts || {};
  function normalizeList(list, primary){
    if(!list) return [];
    if(typeof list === 'string'){
      list = list.split(/[,;]/).map(s => s.trim()).filter(Boolean);
    } else if(Array.isArray(list)){
      list = list.map(c => (typeof c === 'string' ? c : (c && c.email))).filter(Boolean);
    } else {
      return [];
    }
    return list.filter(e => e !== primary);
  }
  function blobToBase64(blob){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result || '';
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  try {
    const toList = typeof to === 'string'
      ? to.split(/[,;]/).map(s => s.trim()).filter(Boolean)
      : [to].filter(Boolean);
    if(!toList.length){ console.error('[Mailgun] no To recipients'); return false; }
    const primary = toList[0];

    const payload = {
      to: toList,
      subject: subject,
      text: body,
    };
    const ccList = normalizeList(opts.cc, primary);
    if(ccList.length) payload.cc = ccList;
    const bccList = normalizeList(opts.bcc, primary);
    if(bccList.length) payload.bcc = bccList;
    if(opts.html) payload.html = opts.html;
    if(opts.replyTo) payload.replyTo = opts.replyTo;

    if(Array.isArray(opts.attachments) && opts.attachments.length){
      payload.attachments = [];
      for(const a of opts.attachments){
        if(!a || !a.blob || !a.filename) continue;
        try {
          const b64 = await blobToBase64(a.blob);
          payload.attachments.push({
            filename: a.filename,
            contentBase64: b64,
            contentType: a.blob.type || 'application/octet-stream',
          });
        } catch(e){ console.warn('[Mailgun] attachment encode failed', a.filename, e); }
      }
    }

    // Send from the company Gmail (mike@goodliquid.com) via the gmail-send Edge
    // Function. gmail-send accepts the same payload shape (to/subject/text/html/
    // cc/bcc/attachments). Invoked through the Supabase client so the staff JWT
    // is attached automatically (the function checks auth before sending).
    // If Gmail fails or isn't configured, fall back to mailgun-send so outbound
    // email is never lost.
    let resp = await supa.functions.invoke('gmail-send', { body: payload });
    let via = 'gmail';
    if(resp.error || (resp.data && resp.data.ok === false)){
      console.warn('[email] gmail-send failed, falling back to mailgun-send', resp.error || (resp.data && resp.data.error));
      resp = await supa.functions.invoke('mailgun-send', { body: payload });
      via = 'mailgun';
    }
    if(resp.error){
      console.error('[email] send failed ('+via+')', resp.error);
      return false;
    }
    if(resp.data && resp.data.ok === false){
      console.error('[email] send rejected ('+via+')', resp.data.error);
      return false;
    }
    // Stash the returned provider message id so the email_log wrapper
    // (crm-email.js wrapSend IIFE) can record it on the row. For Gmail sends
    // this is the Gmail message id; for a Mailgun fallback send it's the
    // Mailgun id. (Note: Gmail has no open/click webhook like Mailgun, so
    // delivered/opened/clicked tracking only populates for Mailgun-sent mail.)
    var msgId = resp.data && resp.data.id ? String(resp.data.id) : null;
    try { sendMailgunEmail._lastMailgunId = msgId; } catch(e){}
    return true;
  } catch(e){ console.error('[email] send threw',e); return false; }
}
