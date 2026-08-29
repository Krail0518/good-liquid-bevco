/*
 * referrals.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: renderReferrals, setRefFilter, payComm, updateRefStatus, openRefModal, closeRefModal, calcRefComm, renderReferrers, openRefForReferrer, openAddReferrer, closeAddReferrer, populateReferrerSelects, svcChange, toggleAddon, getCanRate, calcTotal, updatePreview, populateClientDropdown
 */
/* ═══ REFERRAL PROGRAM ═══ */
function renderReferrals(){
  // Update flow counts
  const statuses=['lead','presented','won','paid','lost'];
  statuses.forEach((s,i)=>{
    document.getElementById('flow-'+i).textContent=referrals.filter(r=>r.status===s).length;
  });
  // Metrics
  const wonRefs=referrals.filter(r=>r.status==='won'||r.status==='paid');
  const owed=referrals.filter(r=>r.status==='won').reduce((a,r)=>a+r.commAmount,0);
  const paidYTD=referrals.filter(r=>r.status==='paid').reduce((a,r)=>a+r.commAmount,0);
  const dealVal=wonRefs.reduce((a,r)=>a+r.dealValue,0);
  const total=referrals.filter(r=>r.status!=='').length;
  const wonCount=wonRefs.length;
  const lost=referrals.filter(r=>r.status==='lost').length;
  const decided=wonCount+lost;
  const winRate=decided>0?Math.round(wonCount/decided*100):0;
  document.getElementById('ref-owed').textContent='$'+owed.toLocaleString();
  document.getElementById('ref-paid-ytd').textContent='$'+paidYTD.toLocaleString();
  document.getElementById('ref-deal-val').textContent='$'+dealVal.toLocaleString();
  document.getElementById('ref-win-rate').textContent=winRate+'%';

  // Table
  let list=refFilter==='all'?referrals:referrals.filter(r=>r.status===refFilter);
  document.getElementById('ref-body').innerHTML=list.map(r=>{
    const ref=referrers.find(x=>x.id===r.referrerId)||{name:r.referrerName,color:'#444',tc:'#ccc',init:'?'};
    return`<tr>
      <td><div style="display:flex;align-items:center;gap:7px">
        <div class="cavt" style="background:${ref.color};color:${ref.tc};width:24px;height:24px;font-size:9px">${esc(ref.init)}</div>
        <div><div style="font-size:12px;font-weight:600;color:var(--white)">${esc(ref.name)}</div><div style="font-size:10px;color:var(--muted)">${esc(ref.rel||'')}</div></div>
      </div></td>
      <td style="font-weight:600">${esc(r.clientName)}</td>
      <td style="color:var(--muted)">$${(window.fmtUsd?window.fmtUsd(r.dealValue):Number(r.dealValue||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}))}</td>
      <td style="color:var(--muted)">${r.rate}%</td>
      <td style="font-weight:600;color:var(--teal)">$${(window.fmtUsd?window.fmtUsd(r.commAmount):Number(r.commAmount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}))}</td>
      <td><span class="cbdg ${r.status==='won'?'earned':r.status}">${r.status==='won'?'Comm. earned':r.status==='paid'?'Paid out':r.status==='presented'?'Presented':r.status==='lead'?'Lead ref.':'Lost'}</span></td>
      <td><div style="display:flex;gap:3px">
        ${r.status==='won'?`<button class="cbtn grn" style="font-size:10px;padding:3px 8px" onclick="payComm('${r.id}')">Pay $${(window.fmtUsd?window.fmtUsd(r.commAmount):Number(r.commAmount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}))}</button>`:''}
        ${r.status==='lead'?`<button class="cbtn amber" style="font-size:10px;padding:3px 8px" onclick="updateRefStatus('${r.id}','presented')">→ Presented</button>`:''}
        ${r.status==='presented'?`<button class="cbtn grn" style="font-size:10px;padding:3px 8px" onclick="updateRefStatus('${r.id}','won')">Won ✓</button><button class="cbtn red" style="font-size:10px;padding:3px 8px" onclick="updateRefStatus('${r.id}','lost')">Lost</button>`:''}
        ${r.status==='paid'?`<span class="paid-tag">✓ Paid ${r.datePaid||''}</span>`:''}
      </div></td>
    </tr>`;
  }).join('');
}

function setRefFilter(el,f){document.querySelectorAll('#ref-pills .cpill').forEach(p=>p.classList.remove('act'));el.classList.add('act');refFilter=f;renderReferrals()}

function payComm(id){
  const r=referrals.find(x=>x.id===id);
  if(r&&confirm(`Pay $${r.commAmount.toLocaleString()} commission to ${r.referrerName}?`)){
    r.status='paid';r.datePaid=new Date().toISOString().split('T')[0];
    renderReferrals();renderDash();
    activities.unshift({type:'ref',icon:'🤝',name:`Commission paid — ${r.referrerName}`,detail:`$${r.commAmount.toLocaleString()} for ${r.clientName} referral`,time:'Just now'});saveActivities();
    renderActivity();
    supa.from('referrals').update({status:'paid', date_paid: r.datePaid}).eq('id', id).then(function(res){ if(res.error) console.warn('payComm Supabase error:', res.error.message); });
  }
}

async function updateRefStatus(id,status){
  const r=referrals.find(x=>x.id===id);
  if(!r)return;
  if(status==='won'){
    const actual=prompt(`Enter actual deal value for ${r.clientName} (est. $${r.dealValue.toLocaleString()}):`,r.dealValue);
    if(actual){r.dealValue=parseFloat(actual)||r.dealValue;r.commAmount=Math.round(r.dealValue*r.rate/100);}
  }
  r.status=status;
  renderReferrals();renderDash();
  // Persist to Supabase — without this every status change was per-device
  // and disappeared on refresh.
  try {
    if(window.supa && r.id && !String(r.id).startsWith('ref')){
      const patch = { status: status };
      if(status==='won'){
        patch.deal_value       = r.dealValue;
        patch.commission_amount = r.commAmount;
      }
      await window.supa.from('referrals').update(patch).eq('id', r.id);
    }
  } catch(e){ console.warn('[GL] referral status save failed', e); }
}

function openRefModal(){
  document.getElementById('ref-modal').classList.add('show');
  calcRefComm();
}
function closeRefModal(){document.getElementById('ref-modal').classList.remove('show')}

function calcRefComm(){
  const deal=parseFloat(document.getElementById('ref-deal')?.value)||0;
  const rate=parseFloat(document.getElementById('ref-rate')?.value)||0;
  const comm=Math.round(deal*rate/100);
  const el=document.getElementById('ref-comm-preview');
  if(el)el.textContent='$'+comm.toLocaleString();
}

/* Referrers */
function renderReferrers(){
  document.getElementById('referrers-list').innerHTML=referrers.map(r=>{
    const rRefs=referrals.filter(x=>x.referrerId===r.id);
    const totalEarned=rRefs.filter(x=>x.status==='paid').reduce((a,x)=>a+x.commAmount,0);
    const owed=rRefs.filter(x=>x.status==='won').reduce((a,x)=>a+x.commAmount,0);
    const wonCount=rRefs.filter(x=>x.status==='won'||x.status==='paid').length;
    return`<div class="rref-card">
      <div class="rref-left">
        <div class="rref-av" style="background:${r.color};color:${r.tc}">${esc(r.init)}</div>
        <div>
          <div class="rref-name">${esc(r.name)}</div>
          <div class="rref-rel">${esc(r.rel)} · ${esc(r.email)} · Default: ${esc(r.rate)}% commission</div>
          ${r.notes?`<div style="font-size:10px;color:rgba(107,135,173,.6);margin-top:2px">${esc(r.notes)}</div>`:''}
        </div>
      </div>
      <div class="rref-stats">
        <div class="rref-stat"><div class="rv-val" style="color:var(--muted)">${rRefs.length}</div><div class="rv-lbl">Referrals</div></div>
        <div class="rref-stat"><div class="rv-val" style="color:#1D9E75">${wonCount}</div><div class="rv-lbl">Won</div></div>
        <div class="rref-stat"><div class="rv-val" style="color:#1D9E75">$${totalEarned.toLocaleString()}</div><div class="rv-lbl">Paid out</div></div>
        <div class="rref-stat">
          ${owed>0?`<div class="owed-tag">$${owed.toLocaleString()} owed</div>`:
          `<div class="rv-val" style="color:var(--muted)">$0</div><div class="rv-lbl">Owed</div>`}
        </div>
        <button class="cbtn" style="font-size:10px;padding:4px 10px" onclick="openRefForReferrer('${r.id}')">+ Log referral</button>
      </div>
    </div>`;
  }).join('');
}

function openRefForReferrer(rid){
  openRefModal();
  setTimeout(()=>{document.getElementById('ref-referrer-sel').value=rid;},100);
}

function openAddReferrer(){document.getElementById('add-ref-modal').classList.add('show')}
function closeAddReferrer(){document.getElementById('add-ref-modal').classList.remove('show')}

/* The Supabase-backed saveReferrer() is further down (search "Override
   saveReferrer"). A dead first declaration used to sit here: same name, same
   script block, so the later one won at hoist time and this body never ran.
   It pushed to a local array and never reached the database.

   Removed rather than annotated. The annotation was the previous state and it
   did not stop the trap being real -- this is the exact shape that hid a bug
   in quickPaid, where someone wrote a better version while the worse one kept
   winning. tests/duplicate-declarations.test.cjs now fails on any repeat. */
function populateReferrerSelects(){
  ['ref-referrer-sel'].forEach(selId=>{
    const sel=document.getElementById(selId);if(!sel)return;
    const cur=sel.value;
    sel.innerHTML='<option value="">Select referrer…</option>';
    referrers.forEach(r=>{const o=document.createElement('option');o.value=r.id;o.textContent=r.name+' ('+r.rate+'%)';sel.appendChild(o)});
    if(cur)sel.value=cur;
  });
}

/* Invoice form */
function svcChange(){
  const svc=document.getElementById('inv-svc').value;selAddons={};
  let html='';
  if(svc==='canning'||svc==='copacking'){
    html=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div class="frow"><div class="flbl">Can format</div><select class="fsel" id="can-fmt" onchange="updatePreview()"><option value="12std">12oz Standard</option><option value="12slk">12oz Sleek</option><option value="16std">16oz Standard</option></select></div>
      <div class="frow"><div class="flbl">Cases</div><input type="number" class="finp" id="can-cases" value="500" min="200" oninput="updatePreview()"></div>
    </div><div style="font-size:10px;color:var(--muted);margin-bottom:12px">Min 200 cases · 24 cans/case</div>`;
    if(svc==='copacking')html+=`<div class="frow"><div class="flbl">Benchtop verification</div><select class="fsel" id="verif" onchange="updatePreview()"><option value="1">Yes — $500/SKU</option><option value="0">No (PAL provided)</option></select></div>`;
  }else if(svc==='bottling'){
    html=`<div class="frow"><div class="flbl">Cases (6-pack)</div><select class="fsel" id="btl-cases" onchange="updatePreview()">
      <option value="220">220 cases (1,320 btls)</option><option value="660">660 cases (3,960 btls)</option>
      <option value="1320">1,320 cases</option><option value="2640">2,640 cases</option><option value="5280">5,280 cases</option>
    </select></div>`;
  }else if(svc==='rd'){
    html=`<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div class="frow"><div class="flbl">R&D package</div><select class="fsel" id="rd-pkg" onchange="updatePreview()"><option value="rd">R&D Only ($2,500)</option><option value="rd-lic">R&D + IP License ($7,000)</option><option value="rd-buy">R&D + IP Purchase ($16,000)</option></select></div>
      <div class="frow"><div class="flbl">SKUs</div><input type="number" class="finp" id="rd-skus" value="1" min="1" oninput="updatePreview()"></div>
    </div>`;
  }else{
    html=`<div class="frow"><div class="flbl">Flat fee ($)</div><input type="number" class="finp" id="consult-fee" value="2500" oninput="updatePreview()"></div>`;
  }
  document.getElementById('svc-fields').innerHTML=html;
  let addons='';
  if(svc==='canning'||svc==='copacking'){
    addons=`<div class="addon-card" onclick="toggleAddon(this,'past')"><div class="addon-card-t">🔥 Flash Pasteurization</div><div class="addon-card-p">5¢ per can</div></div>
    <div class="addon-card" onclick="toggleAddon(this,'nitro')"><div class="addon-card-t">💨 Nitrogen Dosing</div><div class="addon-card-p">3¢ per can</div></div>`;
  }else if(svc==='bottling'){
    addons=`<div class="addon-card" onclick="toggleAddon(this,'pastbtl')"><div class="addon-card-t">🔥 Flash Pasteurization</div><div class="addon-card-p">$0.20/btl</div></div>
    <div class="addon-card" onclick="toggleAddon(this,'overlbl')"><div class="addon-card-t">🏷️ Over-Top Labels</div><div class="addon-card-p">$0.20/btl</div></div>`;
  }
  document.getElementById('addon-grid').innerHTML=addons;
  updatePreview();
}

function toggleAddon(el,k){el.classList.toggle('sel');selAddons[k]=el.classList.contains('sel');updatePreview()}

function getCanRate(cases,fmt){
  for(const t of PRICING.canning.tiers){if(cases>=t.min&&cases<=t.max)return t[fmt]||t['12std'];}
  return PRICING.canning.tiers.at(-1)['12std'];
}

function calcTotal(){
  const svc=document.getElementById('inv-svc').value;
  let lines=[],total=0,desc='';
  if(svc==='canning'||svc==='copacking'){
    const fmt=document.getElementById('can-fmt')?.value||'12std';
    const cases=parseInt(document.getElementById('can-cases')?.value)||500;
    const cans=cases*24,rate=getCanRate(cases,fmt);
    const mfg=Math.round(rate*cans*100)/100,canC=Math.round(.32*cans*100)/100,pkgC=Math.round(.055*cans*100)/100;
    const fmtL={'12std':'12oz Standard','12slk':'12oz Sleek','16std':'16oz Standard'}[fmt];
    lines.push({d:`Manufacturing — ${cases} cases ${fmtL} @ $${rate}/can`,a:mfg});
    lines.push({d:`Can costs — ${cans.toLocaleString()} cans @ $0.32`,a:canC});
    lines.push({d:`Packaging — trays & PakTechs @ $0.055/can`,a:pkgC});
    total=mfg+canC+pkgC;
    if(svc==='copacking'&&document.getElementById('verif')?.value==='1'){lines.push({d:'Benchtop verification',a:500});total+=500}
    if(selAddons.past){const c=Math.round(.05*cans*100)/100;lines.push({d:'Flash Pasteurization @ $0.05/can',a:c});total+=c}
    if(selAddons.nitro){const c=Math.round(.03*cans*100)/100;lines.push({d:'Nitrogen Dosing @ $0.03/can',a:c});total+=c}
    desc=`Canning — ${cases} cases ${fmtL}`;
  }else if(svc==='bottling'){
    const cases=parseInt(document.getElementById('btl-cases')?.value)||660;
    const tier=PRICING.bottling.tiers.find(t=>t.cases===cases)||PRICING.bottling.tiers[1];
    const btls=cases*6,mfg=Math.round(tier.perBtl*btls*100)/100;
    lines.push({d:`Bottle filling — ${cases} cases @ $${tier.perBtl}/btl`,a:mfg});total=mfg;
    if(selAddons.pastbtl){const c=Math.round(.20*btls*100)/100;lines.push({d:'Flash Pasteurization @ $0.20/btl',a:c});total+=c}
    if(selAddons.overlbl){const c=Math.round(.20*btls*100)/100;lines.push({d:'Over-Top Labels @ $0.20/btl',a:c});total+=c}
    desc=`Bottle Filling — ${cases} cases 750ml`;
  }else if(svc==='rd'){
    const pkg=document.getElementById('rd-pkg')?.value||'rd';
    const skus=parseInt(document.getElementById('rd-skus')?.value)||1;
    lines.push({d:`R&D Formulation — ${skus} SKU(s)`,a:2500*skus});total=2500*skus;
    if(pkg==='rd-lic'){lines.push({d:'IP Licensing (annual)',a:6000});total+=6000}
    if(pkg==='rd-buy'){lines.push({d:'IP Purchase (outright)',a:15000});total+=15000}
    desc=pkg==='rd'?'R&D Formulation':pkg==='rd-lic'?'R&D + IP License':'R&D + IP Purchase';
  }else{
    const fee=parseFloat(document.getElementById('consult-fee')?.value)||2500;
    lines.push({d:'Consulting & Brand Support',a:fee});total=fee;desc='Consulting & Brand Support';
  }
  return{lines,total:Math.round(total*100)/100,desc};
}

function updatePreview(){
  try{
    const{lines,total,desc}=calcTotal();
    const cid=document.getElementById('inv-client').value;
    const c=clients.find(x=>x.id===cid);
    const date=document.getElementById('inv-date').value||new Date().toISOString().split('T')[0];
    const num='GL-'+new Date().getFullYear()+'-'+(invoices.length+1).toString().padStart(3,'0');
    const fmtUsd = n => (window.fmtUsd ? window.fmtUsd(n) : Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}));
    document.getElementById('live-total').innerHTML=
      lines.map(l=>`<div class="tot-line"><span>${l.d}</span><span>$${fmtUsd(l.a)}</span></div>`).join('')+
      `<div class="tot-final"><span>Total</span><span>$${fmtUsd(total)}</span></div>`;
    document.getElementById('inv-preview-box').innerHTML=`
      <div class="inv-top">
        <div><div class="inv-co" style="font-size:11px">${GL.name}</div><div style="font-size:10px;color:var(--muted)">${GL.addr}</div></div>
        <div style="text-align:right"><div style="font-family:var(--ff-disp);font-size:12px;color:var(--white)">INVOICE</div><div style="font-size:10px;color:var(--teal)">${num}</div><div style="font-size:10px;color:var(--muted)">${date}</div></div>
      </div>
      <div style="margin-bottom:10px"><div style="font-size:9px;color:var(--muted);margin-bottom:2px">BILL TO</div><div style="font-weight:600;font-size:12px;color:var(--white)">${c?esc(c.name):'[Select client]'}</div></div>
      <table style="width:100%;border-collapse:collapse;font-size:10px">
        <thead><tr><th style="text-align:left;padding:4px;background:rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.07);color:var(--muted)">Description</th><th style="text-align:right;padding:4px;background:rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.07);color:var(--muted)">Amount</th></tr></thead>
        <tbody>${lines.map(l=>`<tr><td style="padding:5px;border-bottom:1px solid rgba(255,255,255,.05);color:var(--white)">${l.d}</td><td style="padding:5px;text-align:right;border-bottom:1px solid rgba(255,255,255,.05);color:var(--white)">$${fmtUsd(l.a)}</td></tr>`).join('')}</tbody>
      </table>
      <div style="text-align:right;margin-top:8px;font-family:var(--ff-disp);font-size:16px;color:var(--teal)">$${fmtUsd(total)}</div>`;
  }catch(e){}
}

function populateClientDropdown(){
  const sel=document.getElementById('inv-client');
  clients.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.name;sel.appendChild(o)});
}

// Dead saveInvoice (sync) and dead checkPw v2 removed in Round 4 cleanup.
// saveInvoice was superseded by the async Supabase version later in this file.
// checkPw v2 referenced the removed `password` field on users — superseded by
// the supa.auth version below + fix.js's Supabase Auth wrapper.
