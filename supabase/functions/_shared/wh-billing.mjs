/*
 * wh-billing.mjs — warehouse storage billing, shared by the wh-monthly-billing
 * edge function and its tests.
 *
 * WHY THIS EXISTS
 * The Billing tab (src/modules/warehouse/warehouse.js, section 7) works out a
 * client's month in the browser: pallets at CONRI any part of the month ×
 * storage rate, plus pallets pulled out × pull fee, from the append-only
 * wh_movements log. Invoicing it was manual (🧾 Create invoice, then Send),
 * and on 2026-11-15 two invoices were created and never sent. The monthly job
 * needs the SAME numbers server-side, so billMonth / billLines here are a
 * line-for-line port of the page's functions. tests/wh-billing.test.mjs pins
 * them to the page's behaviour; change both together.
 *
 * Days are Florida days (America/New_York), as the page computes them in
 * Mike's browser. A pull at 9pm ET on the 31st belongs to the 31st, not the
 * 1st as UTC would say.
 *
 * Plain ESM, no imports, no I/O: Deno and Node both load it unchanged.
 */

export const TZ = 'America/New_York';
export const DEFAULT_RATES = { storage: 30, pull: 15 };

const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const round2 = (n) => Math.round(n * 100) / 100;

// YYYY-MM-DD of an instant in Florida.
export function nyDay(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function monthBounds(ym) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym || ''));
  if (!m || +m[2] < 1 || +m[2] > 12) return null;
  const last = new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
  return { first: ym + '-01', last: ym + '-' + String(last).padStart(2, '0') };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function monthLabel(ym) {
  const b = monthBounds(ym);
  return b ? MONTHS[+ym.slice(5, 7) - 1] + ' ' + ym.slice(0, 4) : String(ym);
}

// The month before the Florida month containing `now`: what the job bills on the 1st.
export function previousMonth(now) {
  const day = nyDay(now || new Date());
  let y = +day.slice(0, 4), m = +day.slice(5, 7) - 1;
  if (m === 0) { y -= 1; m = 12; }
  return y + '-' + String(m).padStart(2, '0');
}

// When a move really happened: the appointment, or the moment it was completed
// if that came first. A pallet that appeared at CONRI with no transfer is a
// split, and it has been there since the original arrived. (Port of moveTime.)
export function moveTime(m, pallet) {
  const t = m.transfer;
  if (t && (t.scheduled_at || t.completed_at)) {
    if (t.scheduled_at && t.completed_at) return t.scheduled_at < t.completed_at ? t.scheduled_at : t.completed_at;
    return t.scheduled_at || t.completed_at;
  }
  if (!m.from_location && m.to_location === 'conri' && pallet && pallet.received_at_conri) return pallet.received_at_conri;
  return m.at;
}

// Port of billMonth: movements + pallets (by id, with sku.client_id and
// sku.client.name) + month + rateFor(client_id) in, one bill per owner out.
// Good Liquid's own packaging (sku.client_id null) comes back billable:false.
export function billMonth(moves, pallets, ym, rateFor) {
  const b = monthBounds(ym);
  if (!b) throw new Error('Bad month: ' + ym);
  const byPallet = {};
  (moves || []).slice().sort((x, y) => num(x.seq) - num(y.seq)).forEach((m) => {
    (byPallet[m.pallet_id] = byPallet[m.pallet_id] || []).push(m);
  });
  const owners = {};
  Object.keys(byPallet).forEach((pid) => {
    const p = pallets[pid];
    if (!p) return;
    const s = p.sku || {}, cid = s.client_id || null, key = cid || '__gl__';
    const stays = [], pulls = [];
    let open = null;
    byPallet[pid].forEach((m) => {
      const day = nyDay(moveTime(m, p));
      if (m.to_location === 'conri' && m.from_location !== 'conri') { open = { in: day, out: null }; stays.push(open); }
      else if (m.from_location === 'conri' && m.to_location !== 'conri') {
        if (open) { open.out = day; open = null; }
        pulls.push({ day, type: m.transfer && m.transfer.type, transfer: m.transfer && m.transfer.transfer_number });
      }
    });
    const hit = stays.filter((x) => x.in && x.in <= b.last && (!x.out || x.out >= b.first));
    const monthPulls = pulls.filter((x) => x.day >= b.first && x.day <= b.last);
    if (!hit.length && !monthPulls.length) return;
    const o = owners[key] = owners[key] || {
      client_id: cid, name: cid ? ((s.client && s.client.name) || 'Client') : 'Good Liquid (own packaging)',
      billable: !!cid, rate: cid ? rateFor(cid) : { storage: 0, pull: 0 }, stored: [], pulls: [],
    };
    const ref = { id: pid, pallet_tag: p.pallet_tag, conri_pallet_id: p.conri_pallet_id || null, sku: s.upc_sku || '', description: s.description || '' };
    if (hit.length) o.stored.push(Object.assign({ in: hit[0].in, out: hit[hit.length - 1].out }, ref));
    monthPulls.forEach((x) => o.pulls.push(Object.assign({ day: x.day, type: x.type, transfer: x.transfer }, ref)));
  });
  return Object.keys(owners).map((k) => {
    const o = owners[k];
    o.stored.sort((x, y) => String(x.pallet_tag).localeCompare(String(y.pallet_tag)));
    o.pulls.sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : String(x.pallet_tag).localeCompare(String(y.pallet_tag))));
    o.storageAmt = round2(o.stored.length * num(o.rate.storage));
    o.pullAmt = round2(o.pulls.length * num(o.rate.pull));
    o.total = round2(o.storageAmt + o.pullAmt);
    return o;
  }).sort((x, y) => (x.billable !== y.billable ? (x.billable ? -1 : 1) : x.name.localeCompare(y.name)));
}

// Port of billLines, plus `total` per line as the invoices table stores it.
export function billLines(o, ym) {
  const label = monthLabel(ym), items = [];
  const refs = (list) => {
    const r = list.map((x) => (x.conri_pallet_id ? 'CONRI #' + x.conri_pallet_id : x.pallet_tag));
    return r.length > 12 ? r.slice(0, 12).join(', ') + ' and ' + (r.length - 12) + ' more' : r.join(', ');
  };
  if (o.stored.length) items.push({ desc: 'Warehouse storage, ' + label + ': ' + o.stored.length + ' pallet' + (o.stored.length === 1 ? '' : 's') + ' (' + refs(o.stored) + ')',
    qty: o.stored.length, unitPrice: num(o.rate.storage), unit: 'pallet-month', total: o.storageAmt });
  if (o.pulls.length) items.push({ desc: 'Pallet pulls, ' + label + ': ' + o.pulls.length + ' pallet' + (o.pulls.length === 1 ? '' : 's') + ' (' + refs(o.pulls) + ')',
    qty: o.pulls.length, unitPrice: num(o.rate.pull), unit: 'pallet', total: o.pullAmt });
  return items;
}

// "Net 30" → today + 30; anything else (Due on receipt, blank) → today.
export function dueDate(terms, today) {
  const m = /net\s*(\d{1,3})/i.exec(String(terms || ''));
  if (!m) return today;
  const d = new Date(today + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + +m[1]);
  return d.toISOString().slice(0, 10);
}

// Next GL-<n> number: one above the highest numeric invoice number in use,
// the rule the CRM's invoice builder uses (glNextId).
export function nextInvoiceNumber(existing) {
  let max = 1000;
  (existing || []).forEach((s) => { const n = parseInt(String(s || '').replace(/\D/g, ''), 10); if (n > max) max = n; });
  return 'GL-' + (max + 1);
}

// Every value that reaches the email comes from the database (client names,
// addresses, SKU descriptions a person typed), so all of it is escaped.
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const usd = (n) => '$' + num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usdRate = (n) => '$' + num(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export function emailSubject(inv) {
  return 'Invoice ' + inv.invoice_number + ' from Good Liquid Bev Co — ' + usd(inv.amount);
}

export function emailText(inv, client, ym, portalUrl) {
  return 'Hi ' + (client.contact_name || client.name || 'there') + ',\n\n' +
    'Please find Invoice ' + inv.invoice_number + ' below for ' + usd(inv.amount) + ', warehouse storage at CONRI for ' + monthLabel(ym) + '.\n\n' +
    'Payment is due ' + (inv.payment_terms || 'on receipt').replace(/^due\s+/i, '') + '.' +
    (portalUrl ? ' You can view and pay online here: ' + portalUrl + '\n\nWire instructions are also included at the bottom of the invoice.' : ' Wire instructions are included at the bottom of the invoice.') +
    '\n\nLet me know if you have any questions.\n\nThanks,\nGood Liquid Accounting\n(803) 493-5065 · Mike@GoodLiquid.com';
}

// Port of buildInvoiceEmailHtml (crm-index-core.js) so an automatic invoice
// looks the same as one sent from the CRM.
export function invoiceHtml(inv, c, portalUrl) {
  const useBilling = c.billing_same === false && (c.billing_street || c.billing_city);
  const bStreet = useBilling ? c.billing_street : c.street;
  const bLine2 = [useBilling ? c.billing_city : c.city, useBilling ? c.billing_state : c.state].filter(Boolean).join(', ') +
    ((useBilling ? c.billing_zip : c.zip) ? ' ' + (useBilling ? c.billing_zip : c.zip) : '');
  const rows = (inv.line_items || []).map((l) =>
    '<tr><td style="padding:10px 14px;border-bottom:1px solid #eee">' + esc(l.desc) + '</td>' +
    '<td style="padding:10px 14px;text-align:center;border-bottom:1px solid #eee">' + esc(num(l.qty).toLocaleString('en-US')) + '</td>' +
    '<td style="padding:10px 14px;text-align:right;border-bottom:1px solid #eee">' + esc(usdRate(l.unitPrice) + (l.unit ? ' /' + l.unit : '')) + '</td>' +
    '<td style="padding:10px 14px;text-align:right;font-weight:700;border-bottom:1px solid #eee">' + esc(usd(l.total)) + '</td></tr>').join('');
  const pay = portalUrl
    ? '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:24px 0 0"><tr><td align="center" style="padding:0 28px;text-align:center">' +
      '<a href="' + esc(portalUrl) + '" style="display:inline-block;background:#00e5c0;color:#0a1628;padding:14px 34px;border-radius:8px;font-size:15px;font-weight:800;text-decoration:none;letter-spacing:.5px">💳 View Invoice &amp; Pay Online →</a>' +
      '<div style="font-size:11px;color:#6b87ad;margin-top:8px">Pay by card or ACH via Stripe. Or use the wire instructions below.</div></td></tr></table>'
    : '';
  return '<div style="max-width:700px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;color:#0a1628;font-size:14px;background:#ffffff">' +
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%;border-bottom:3px solid #00e5c0"><tr>' +
      '<td valign="top" style="padding:24px 28px"><div style="font-size:22px;font-weight:900;color:#00b89a;letter-spacing:2px;line-height:1.1">GOOD LIQUID BEV CO</div>' +
        '<div style="font-size:11px;color:#6b87ad;margin-top:6px">2011 51st Ave E, Unit 100 · Palmetto, FL 34221</div>' +
        '<div style="font-size:11px;color:#6b87ad">Mike@GoodLiquid.com · (803) 493-5065</div></td>' +
      '<td valign="top" align="right" style="padding:24px 28px;text-align:right"><div style="font-size:26px;font-weight:900;color:#0a1628;letter-spacing:3px;line-height:1">INVOICE</div>' +
        '<div style="font-size:14px;color:#00b89a;font-weight:700;margin-top:4px;font-family:\'Space Mono\',monospace,Arial">' + esc(inv.invoice_number) + '</div>' +
        '<div style="margin-top:8px"><span style="display:inline-block;background:#fff7d6;color:#8a6500;padding:4px 12px;border-radius:14px;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase">' + esc(inv.status) + '</span></div></td>' +
    '</tr></table>' +
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:100%"><tr>' +
      '<td valign="top" style="padding:18px 28px;width:60%"><div style="font-size:10px;letter-spacing:2px;color:#6b87ad;text-transform:uppercase;margin-bottom:4px">Bill To</div>' +
        '<div style="font-weight:700;color:#0a1628">' + esc(c.legal_name || c.name) + '</div>' +
        (c.legal_name && c.legal_name !== c.name ? '<div style="font-size:11px;color:#6b87ad">dba ' + esc(c.name) + '</div>' : '') +
        (bStreet ? '<div style="font-size:12px;color:#0a1628">' + esc(bStreet) + '</div>' : '') +
        (bLine2.trim() ? '<div style="font-size:12px;color:#0a1628">' + esc(bLine2) + '</div>' : '') +
        (c.contact_name ? '<div style="font-size:11px;color:#6b87ad;margin-top:4px">Attn: ' + esc(c.contact_name) + '</div>' : '') +
        (c.email ? '<div style="font-size:11px;color:#6b87ad">' + esc(c.email) + '</div>' : '') + '</td>' +
      '<td valign="top" align="right" style="padding:18px 28px;text-align:right"><div style="font-size:10px;letter-spacing:2px;color:#6b87ad;text-transform:uppercase;margin-bottom:4px">Invoice Details</div>' +
        '<div style="font-size:12px;color:#0a1628">Date: ' + esc(inv.invoice_date) + '</div>' +
        '<div style="font-size:12px;color:#0a1628">Due: ' + esc(inv.due_date) + '</div>' +
        '<div style="font-size:12px;color:#0a1628">Terms: ' + esc(inv.payment_terms || 'Due on receipt') + '</div></td>' +
    '</tr></table>' +
    '<table cellspacing="0" cellpadding="0" border="0" style="width:calc(100% - 56px);margin:8px 28px 0;border-collapse:collapse"><thead><tr style="background:#0a1628;color:#00e5c0">' +
      '<th align="left" style="padding:10px 14px;text-align:left;font-size:11px;letter-spacing:1px;font-weight:700">Description</th>' +
      '<th align="center" style="padding:10px 14px;text-align:center;font-size:11px;letter-spacing:1px;font-weight:700">Qty</th>' +
      '<th align="right" style="padding:10px 14px;text-align:right;font-size:11px;letter-spacing:1px;font-weight:700">Unit Price</th>' +
      '<th align="right" style="padding:10px 14px;text-align:right;font-size:11px;letter-spacing:1px;font-weight:700">Amount</th></tr></thead><tbody>' + rows +
      '<tr style="background:#e6fbf6"><td colspan="3" style="padding:16px 14px;font-weight:900;color:#0a1628;font-size:16px;letter-spacing:.3px">Total Due</td>' +
      '<td align="right" style="padding:16px 14px;text-align:right;font-weight:900;color:#00b89a;font-size:20px">' + esc(usd(inv.amount)) + '</td></tr></tbody></table>' +
    pay +
    '<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="width:calc(100% - 56px);margin:24px 28px;border-collapse:separate;background:#f0fbf7;border:1px solid #00e5c0;border-radius:8px"><tr><td style="padding:14px 18px">' +
      '<div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#00b89a;font-weight:700;margin-bottom:8px">Payment Instructions — Wire Transfer</div>' +
      '<table cellspacing="0" cellpadding="0" border="0" style="width:100%;border-collapse:collapse;font-size:13px">' +
        '<tr><td style="padding:3px 0;color:#6b87ad;width:160px">Bank Name</td><td style="color:#0a1628">Gulfside Bank</td></tr>' +
        '<tr><td style="padding:3px 0;color:#6b87ad">Account Number</td><td style="color:#0a1628;font-family:\'Space Mono\',monospace,Arial">1000007789</td></tr>' +
        '<tr><td style="padding:3px 0;color:#6b87ad">Routing (ABA)</td><td style="color:#0a1628;font-family:\'Space Mono\',monospace,Arial">063116902</td></tr>' +
      '</table></td></tr></table>' +
    '<div style="padding:14px 28px;border-top:1px solid #e5e7eb;font-size:11px;color:#6b87ad;text-align:center">Payment to Good Liquid Bev Co · Mike@GoodLiquid.com · (803) 493-5065 · goodliquidbevco.com</div>' +
  '</div>';
}

export function emailHtml(inv, client, ym, portalUrl) {
  const intro = esc(emailText(inv, client, ym, '')).replace(/\n/g, '<br>');
  return '<div style="font-family:Arial,sans-serif;color:#1a1a1a;line-height:1.55"><div style="padding:0 28px 14px">' + intro + '</div>' +
    invoiceHtml(inv, client, portalUrl) + '</div>';
}
