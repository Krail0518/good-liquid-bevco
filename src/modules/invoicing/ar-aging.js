/*
 * ar-aging.js — Accounts Receivable aging report.
 *
 * GL-037. Extracted VERBATIM from crm-index-core.js: the code below is
 * byte-for-byte what was there, so the diff is a relocation and nothing
 * else. One capability per PR, per CLAUDE.md.
 *
 * Buckets unpaid invoices by days past due — Current, 1-30, 31-60, 61-90,
 * 90+ — so the owner can see who owes what and for how long.
 *
 * WHY THE LOAD ORDER IS SAFE
 * --------------------------
 * This file loads AFTER crm-index-core.js, which still calls into it:
 *
 *   renderArAgingSection()  from openReports(), inside a template literal
 *   openArAging()           from an onclick= in generated markup
 *
 * Neither runs at load time — the first is evaluated when openReports() is
 * called, the second when a button is clicked. Both are long after every
 * script has parsed. There is no top-level invocation of any of these four
 * functions anywhere, which was checked before the move.
 *
 * This must stay a CLASSIC script with no defer/async/type=module. The
 * onclick handler resolves openArAging against window, and only a classic
 * top-level function declaration puts it there.
 *
 * aiGenerateInsights() was deliberately left in crm-index-core.js. Its
 * button renders in the same panel, but AI insights is a different
 * capability and belongs in its own extraction.
 */
/* ── A/R AGING REPORT ───────────────────────────────────────────
   Buckets unpaid invoices by days-past-due so Mike can see at a
   glance who owes what and how long it's been outstanding.
   Buckets: Current (not yet due), 1-30, 31-60, 61-90, 90+. */
function arAgingBuckets(){
  const today = new Date(); today.setHours(0,0,0,0);
  const unpaid = (window.invoices||[]).filter(i => i.status === 'pending' || i.status === 'overdue');
  const buckets = { current: [], b1_30: [], b31_60: [], b61_90: [], b90plus: [] };
  unpaid.forEach(i => {
    if(!i.dueDate){ buckets.current.push({ inv:i, days:0 }); return; }
    const due = new Date(i.dueDate); if(isNaN(due.getTime())){ buckets.current.push({ inv:i, days:0 }); return; }
    due.setHours(0,0,0,0);
    const days = Math.floor((today - due) / 86400000);
    if(days <= 0)        buckets.current.push({ inv:i, days:days });
    else if(days <= 30)  buckets.b1_30.push({ inv:i, days:days });
    else if(days <= 60)  buckets.b31_60.push({ inv:i, days:days });
    else if(days <= 90)  buckets.b61_90.push({ inv:i, days:days });
    else                 buckets.b90plus.push({ inv:i, days:days });
  });
  return buckets;
}
function sumBucket(b){ return b.reduce((s,x) => s + (Number(x.inv.amount)||0), 0); }
function renderArAgingSection(){
  const b = arAgingBuckets();
  const total = sumBucket(b.current) + sumBucket(b.b1_30) + sumBucket(b.b31_60) + sumBucket(b.b61_90) + sumBucket(b.b90plus);
  if(total === 0) return '<div style="margin-top:24px;padding:14px;background:rgba(95,207,158,.08);border:1px solid rgba(95,207,158,.25);border-radius:10px;font-size:13px;color:#5fcf9e;text-align:center">✓ A/R aging: nothing outstanding</div>';
  const cell = (label, color, amount, count) => `
    <div style="background:rgba(255,255,255,.04);border:1px solid ${color}33;border-top:3px solid ${color};border-radius:8px;padding:12px 14px">
      <div style="font-size:10px;letter-spacing:2px;color:${color};font-weight:700">${label}</div>
      <div style="font-family:var(--ff-disp);font-size:20px;color:#fff;margin-top:6px">${fmtMoneyShort(amount)}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${count} invoice${count===1?'':'s'}</div>
    </div>`;
  return `
    <div style="margin-top:28px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div style="font-size:11px;letter-spacing:2px;color:var(--muted)">ACCOUNTS RECEIVABLE (A/R) AGING</div>
        <div style="font-size:11px;color:#fff">Total outstanding: <b style="color:#f5c842">${fmtMoneyShort(total)}</b></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px">
        ${cell('Current',  '#5fcf9e', sumBucket(b.current),  b.current.length)}
        ${cell('1–30 d',   '#6b9fff', sumBucket(b.b1_30),    b.b1_30.length)}
        ${cell('31–60 d',  '#f5c842', sumBucket(b.b31_60),   b.b31_60.length)}
        ${cell('61–90 d',  '#ff9a3c', sumBucket(b.b61_90),   b.b61_90.length)}
        ${cell('90+ d',    '#e74c3c', sumBucket(b.b90plus),  b.b90plus.length)}
      </div>
    </div>`;
}
function openArAging(){
  const existing = document.getElementById('ar-aging-overlay');
  if(existing) existing.remove();
  const b = arAgingBuckets();
  /* Per-client roll-up: every client with at least one unpaid invoice,
     showing their bucket breakdown so Mike knows who to call first. */
  const byClient = {};
  function addClient(cid, cname, bucket, days, inv){
    if(!byClient[cid]) byClient[cid] = { id:cid, name:cname, current:0, b1_30:0, b31_60:0, b61_90:0, b90plus:0, total:0, worst:0, invoices:[] };
    const c = byClient[cid];
    c[bucket] += Number(inv.amount)||0;
    c.total   += Number(inv.amount)||0;
    if(days > c.worst) c.worst = days;
    c.invoices.push({ inv, days, bucket });
  }
  ['current','b1_30','b31_60','b61_90','b90plus'].forEach(k => {
    b[k].forEach(x => {
      const cid = x.inv.client || x.inv.clientName;
      const cname = x.inv.clientName || (clients.find(c => c.id === x.inv.client)||{}).name || '(unknown)';
      addClient(cid, cname, k, x.days, x.inv);
    });
  });
  const rows = Object.values(byClient).sort((a,c) => c.worst - a.worst || c.total - a.total);
  const ov = document.createElement('div');
  ov.id = 'ar-aging-overlay';
  ov.style.cssText = 'position:fixed;inset:0;z-index:710;background:rgba(6,13,26,.95);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;padding:20px;overflow-y:auto';
  function bcell(amt){ return amt > 0 ? `<td style="padding:8px 10px;text-align:right;font-family:var(--ff-mono);color:#fff">${fmtMoneyShort(amt)}</td>` : '<td style="padding:8px 10px;text-align:right;color:var(--muted)">—</td>'; }
  ov.innerHTML = `
    <div style="background:#142238;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:28px;width:100%;max-width:1100px;max-height:90vh;overflow-y:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
        <div style="font-family:var(--ff-disp);font-size:22px;letter-spacing:2px;color:#f5c842">📋 ACCOUNTS RECEIVABLE (A/R) AGING REPORT</div>
        <button onclick="document.getElementById('ar-aging-overlay').remove()" style="background:none;border:none;color:var(--muted);font-size:24px;cursor:pointer">✕</button>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:18px">Customers with unpaid invoices, sorted by worst-aged first. Click a row to drill into that client.</div>
      ${rows.length === 0 ? '<div style="padding:60px;text-align:center;color:#5fcf9e;font-size:14px">✓ No outstanding receivables.</div>' : `
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="border-bottom:1px solid rgba(255,255,255,.08);text-align:left">
            <th style="padding:9px 10px;color:var(--muted);font-size:10px;letter-spacing:1px">CLIENT</th>
            <th style="padding:9px 10px;color:var(--muted);font-size:10px;letter-spacing:1px;text-align:right">CURRENT</th>
            <th style="padding:9px 10px;color:var(--muted);font-size:10px;letter-spacing:1px;text-align:right">1–30</th>
            <th style="padding:9px 10px;color:var(--muted);font-size:10px;letter-spacing:1px;text-align:right">31–60</th>
            <th style="padding:9px 10px;color:var(--muted);font-size:10px;letter-spacing:1px;text-align:right">61–90</th>
            <th style="padding:9px 10px;color:var(--muted);font-size:10px;letter-spacing:1px;text-align:right;color:#e74c3c">90+</th>
            <th style="padding:9px 10px;color:var(--muted);font-size:10px;letter-spacing:1px;text-align:right">TOTAL</th>
            <th style="padding:9px 10px;color:var(--muted);font-size:10px;letter-spacing:1px;text-align:right">WORST</th>
          </tr></thead>
          <tbody>
            ${rows.map(r => `<tr style="border-bottom:1px solid rgba(255,255,255,.04);cursor:pointer" onclick="document.getElementById('ar-aging-overlay').remove();openClientDetail('${r.id}')">
              <td style="padding:9px 10px;font-weight:700;color:#fff">${esc(r.name)}</td>
              ${bcell(r.current)}${bcell(r.b1_30)}${bcell(r.b31_60)}${bcell(r.b61_90)}${bcell(r.b90plus)}
              <td style="padding:9px 10px;text-align:right;font-family:var(--ff-disp);color:#f5c842;font-size:14px">${fmtMoneyShort(r.total)}</td>
              <td style="padding:9px 10px;text-align:right;color:${r.worst>90?'#e74c3c':r.worst>60?'#ff9a3c':r.worst>30?'#f5c842':r.worst>0?'#6b9fff':'#5fcf9e'};font-weight:700">${r.worst > 0 ? r.worst + 'd' : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      `}
      <div style="margin-top:18px;padding-top:18px;border-top:1px solid rgba(255,255,255,.08);text-align:right">
        <button onclick="document.getElementById('ar-aging-overlay').remove()" style="padding:10px 18px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#fff;cursor:pointer">Close</button>
      </div>
    </div>`;
  ov.addEventListener('click', e => { if(e.target === ov) ov.remove(); });
  document.body.appendChild(ov);
}
