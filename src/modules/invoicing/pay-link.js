/*
 * pay-link.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: generatePayLink
 */
/* ═══════════════════════════════════════════
   INVOICE PAY LINK GENERATOR
   Generates a simple payment link for invoices
═══════════════════════════════════════════ */
function generatePayLink(invId){
  const inv = invoices.find(i => i.id === invId);
  if(!inv){ alert('Invoice not found'); return; }

  const payData = {
    inv: inv.id,
    amount: inv.amount,
    client: inv.clientName,
    due: inv.date
  };
  const encoded = btoa(JSON.stringify(payData));
  const payUrl = `${window.location.origin}?pay=${encoded}`;

  const modal = document.createElement('div');
  modal.className = 'modal-ov show';
  modal.innerHTML = `
    <div class="modal-box" style="width:480px">
      <div class="modal-title">💳 Payment Link — ${inv.id} <span class="modal-close" onclick="this.closest('.modal-ov').remove()">✕</span></div>
      <div style="background:rgba(0,229,192,.06);border:1px solid rgba(0,229,192,.15);border-radius:10px;padding:16px;margin-bottom:16px">
        <div style="font-size:12px;color:var(--muted);margin-bottom:6px">Share this link with ${esc(inv.clientName)} to request payment:</div>
        <div style="font-family:var(--ff-mono);font-size:11px;color:var(--teal);word-break:break-all;line-height:1.6">${payUrl}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px">
        <div style="text-align:center;padding:10px;background:rgba(255,255,255,.03);border-radius:8px">
          <div style="font-size:10px;color:var(--muted)">INVOICE</div>
          <div style="font-weight:700;color:var(--white)">${inv.id}</div>
        </div>
        <div style="text-align:center;padding:10px;background:rgba(255,255,255,.03);border-radius:8px">
          <div style="font-size:10px;color:var(--muted)">AMOUNT</div>
          <div style="font-weight:700;color:var(--teal)">$${inv.amount.toLocaleString()}</div>
        </div>
        <div style="text-align:center;padding:10px;background:rgba(255,255,255,.03);border-radius:8px">
          <div style="font-size:10px;color:var(--muted)">CLIENT</div>
          <div style="font-weight:700;color:var(--white);font-size:11px">${esc(inv.clientName)}</div>
        </div>
      </div>
      <div style="background:rgba(245,200,66,.06);border:1px solid rgba(245,200,66,.18);border-radius:8px;padding:11px;font-size:11px;color:#f5c842;margin-bottom:14px">
        ⚠ This is an informational link. To accept online payments, connect Stripe in a future update.
      </div>
      <div style="display:flex;gap:8px">
        <button class="cbtn pri" onclick="navigator.clipboard.writeText('${payUrl}').then(()=>alert('Link copied!'))" style="flex:1">📋 Copy Link</button>
        <button class="cbtn" onclick="this.closest('.modal-ov').remove()">Close</button>
      </div>
    </div>`;
  modal.addEventListener('click', e => { if(e.target === modal) modal.remove(); });
  (document.getElementById('crm-panel')||document.body).appendChild(modal);
}

// Email Templates and Time Report are already in fix.js's CATEGORIES list — no wrapper needed
