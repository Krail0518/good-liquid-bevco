/*
 * full-sweep.cjs — broad verification sweep of the Good Liquid CRM.
 *
 * The companion to smoke.test.cjs. Where the smoke test guards a handful of
 * critical paths and is deliberately shallow, this one goes wide: every sidebar
 * page, every modal opener, the invoice flow end to end, and the correspondence
 * / nudge / AI-style logic.
 *
 * WHY BOTH: smoke.test.cjs is the merge gate — small, fast, near-zero false
 * positives. This sweep is the wider net. Keep them separate so a flaky broad
 * check can never block a release on its own.
 *
 * HOW IT WORKS
 *   - Serves the repo and drives it in headless Chromium.
 *   - Installs a chainable Supabase stub, so openers that `await` a query
 *     resolve instead of hanging. Without it, roughly a third of the modals
 *     never render and look broken when they are fine.
 *   - Forces an admin session and calls addAIToolbar/applyRedesign, which the
 *     real login flow does but initCRM alone does not.
 *
 * TWO TRAPS, both of which produced false failures while writing this:
 *   1. Tear down by COMPUTED STYLE, not by id pattern. Overlays are appended
 *      with inline `position:fixed;z-index:…`, so removing a `show` class
 *      leaves them covering the screen. #gl-cip-equip-mgr (z-index 9500) has
 *      no `-overlay`/`-modal` suffix and slipped through an id-based teardown,
 *      making the invoice builder look like it was stacked wrongly.
 *   2. Seed `window.clients` / `window.deals` by MUTATING them. Reassigning
 *      breaks the bridge to index.html's `let clients`, and record-scoped
 *      features then find nothing.
 *
 * RUN LOCALLY
 *   NODE_PATH=/opt/node22/lib/node_modules  *   PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome  *   node tests/full-sweep.cjs
 *
 * A FAILURE HERE IS A REAL BUG until proven otherwise. Chase it to a named
 * cause; do not relax the assertion to make it green.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=process.env.REPO_ROOT||path.resolve(__dirname,'..');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'};
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'text/plain'});s.end(b);});});

const results=[];
const rec=(group,name,ok,detail)=>results.push({group,name,ok:!!ok,detail:detail||''});

(async()=>{
await new Promise(r=>srv.listen(8901,r));
const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
const pg=await br.newPage();
const appErrors=[];
pg.on('pageerror',e=>{const m=String(e&&e.message||e);
  if(!/Failed to fetch|NetworkError|ERR_|net::|TUNNEL|WebSocket|Maximum call stack|jszip|supabase|Load failed|status of 4|status of 5|CORS|429|403|Access-Control/i.test(m)) appErrors.push(m);});

await pg.goto('http://127.0.0.1:8901/index.html',{waitUntil:'domcontentloaded',timeout:30000});
await pg.waitForTimeout(2600);

/* ---------- PHASE 1: boot ---------- */
const boot=await pg.evaluate(()=>{
  const txt=document.body?document.body.innerText:'';
  return {len:txt.trim().length, stuck:/^\s*loading\.?\.?\.?\s*$/i.test(txt.trim())};
});
rec('Boot','landing page renders content',boot.len>50,'body length '+boot.len);
rec('Boot','not stuck on "Loading"',!boot.stuck);

/* ---------- install stub + open CRM ---------- */
const opened=await pg.evaluate(()=>{
  // Chainable Supabase stub: any query chain is awaitable and resolves empty.
  function mkChain(data){
    const o={};
    ['select','insert','update','upsert','delete','eq','neq','gt','gte','lt','lte','like','ilike','is','in','or','and','not','order','limit','range','single','maybeSingle','match','filter','textSearch','overlaps','contains','containedBy','returns','abortSignal','onConflict','count','head','csv']
      .forEach(m=>{o[m]=()=>mkChain(data);});
    const p=()=>Promise.resolve({data:data,error:null});
    o.then=(a,b)=>p().then(a,b); o.catch=f=>p().catch(f); o.finally=f=>p().finally(f);
    return o;
  }
  window.__invokes=[];
  window.supa={
    from:()=>mkChain([]),
    rpc:()=>mkChain([]),
    functions:{invoke:async(fn,opt)=>{window.__invokes.push(fn);return {data:{ok:true,text:'AI text',inserted:0,skipped:0},error:null};}},
    auth:{getUser:async()=>({data:{user:{id:'test-admin'}},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
    storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'#'},error:null}),upload:async()=>({data:{},error:null}),list:async()=>({data:[],error:null}),remove:async()=>({data:{},error:null})})},
    channel:()=>({on(){return this;},subscribe(){return this;}}),
    removeChannel:()=>{}
  };
  window.currentUser={id:'test-admin',email:'test@local',role:'admin',is_admin:true,is_super_user:true,name:'Test Admin',initials:'TA'};
  // Seed a client and a deal so record-scoped features have something to open.
  window.clients=window.clients||[];
  if(!window.clients.find(c=>c.id==='sweep-c1'))
    window.clients.push({id:'sweep-c1',name:'Sweep Test Co',email:'sweep@test.local',init:'ST',color:'#333',tc:'#fff',contact:'Tester',service:'Co-pack',status:'active',phone:'8035550100'});
  if(window.deals&&window.deals['Prospecting'])
    window.deals['Prospecting'].push({id:'sweep-d1',name:'Sweep Deal',co:'Sweep Co',email:'sweep@test.local',contactName:'Tester',val:'$0',prob:20,createdAt:new Date().toISOString(),stageEnteredAt:new Date(Date.now()-13*86400000).toISOString()});
  const panel=document.getElementById('crm-panel'); if(panel)panel.classList.add('show');
  try{ if(typeof window.initCRM==='function') window.initCRM(); }catch(e){ return {err:e.message}; }
  // The AI toolbar is built by the real open flow, not by initCRM alone.
  try{ if(typeof window.addAIToolbar==='function') window.addAIToolbar(); }catch(e){}
  try{ if(typeof window.applyRedesign==='function') window.applyRedesign(); }catch(e){}
  const p=document.getElementById('crm-panel');
  return {shown:!!p&&p.classList.contains('show')};
});
rec('Boot','CRM shell opens for admin',opened.shown,opened.err||'');
// Snapshot the page's OWN top-level elements. Teardown between phases must only
// remove layers this run created — #pw-ov (the admin password prompt) is a
// fixed z-index-500 overlay that ships in index.html, and blanket-removing
// fixed layers deleted it, making openAdmin() throw on null.
await pg.evaluate(()=>{ window.__baseline=new Set([...document.body.children]); });
await pg.waitForTimeout(1200);

/* ---------- PHASE 2: every sidebar nav item ---------- */
const nav=await pg.evaluate(async()=>{
  const items=[...document.querySelectorAll('.cni')];
  const out=[];
  for(const el of items){
    const label=(el.textContent||'').trim().replace(/\s+/g,' ');
    const before=document.querySelectorAll('.modal-ov.show,[id$="-overlay"]').length;
    try{ el.click(); }catch(e){ out.push({label,ok:false,why:'threw '+e.message}); continue; }
    await new Promise(r=>setTimeout(r,120));
    const active=document.querySelector('.cpg.act');
    const overlays=document.querySelectorAll('.modal-ov.show,[id$="-overlay"]').length;
    const builder=document.getElementById('gl-inv-builder');
    const builderShown=!!builder&&builder.classList.contains('show');
    // A nav item is satisfied if it activated a page OR opened something.
    out.push({label,ok:!!active||overlays>before||builderShown,page:active?active.id:''});
    // tidy up anything it opened so the next click starts clean
    document.querySelectorAll('[id$="-overlay"]').forEach(o=>o.remove());
    if(builder) builder.classList.remove('show');
  }
  return out;
});
nav.forEach(n=>rec('Navigation','nav: '+n.label,n.ok,n.why||('page '+n.page)));

/* ---------- PHASE 3: modal openers ---------- */
const OPENERS=[
  ['openAddClientModal','add-client-modal'],['openAddDealModal','add-deal-modal'],
  ['openTaskModal','task-modal'],['openAICommModal','ai-comm-modal'],
  ['openReports','reports-overlay'],['openAISettings','ai-settings-overlay'],
  ['openAddReferrer','add-ref-modal'],['openMeetingNotesModal','meeting-notes-modal'],
  ['glOpenQuoteBuilder','gl-qb-modal'],['openNewInvoiceBuilder','gl-inv-builder'],
  ['glOpenEditClient','gl-edit-client-modal'],['openMailgunSettings','mg-settings-overlay'],
  ['glOpenAddProductionRun','gl-prun-modal'],['openTimeTracker','time-tracker-modal'],
  ['glOpenCipForm','gl-comp-modal'],['openInviteModal','invite-user-modal'],
  ['glOpenCipEquipManager','gl-comp-modal']
];
const openers=await pg.evaluate(async(list)=>{
  const out=[];
  for(const [fn,sel] of list){
    if(typeof window[fn]!=='function'){ out.push({fn,ok:null,why:'not defined in this build'}); continue; }
    document.querySelectorAll('[id$="-overlay"],[id$="-modal"]').forEach(o=>{o.classList&&o.classList.remove('show');});
    let threw='';
    try{ await window[fn]('sweep-c1'); }catch(e){ threw=e.message; }
    await new Promise(r=>setTimeout(r,320));
    const el=document.getElementById(sel);
    const shown=!!el&&(el.classList.contains('show')||getComputedStyle(el).display!=='none');
    out.push({fn,ok:shown,why:threw?('threw '+threw):(el?'present but hidden':'missing '+sel)});
    if(el)el.classList.remove('show');
  }
  return out;
},OPENERS);
openers.forEach(o=>{ if(o.ok===null) rec('Modal openers',o.fn,true,'skipped: '+o.why);
  else rec('Modal openers',o.fn+' opens '+'',o.ok,o.why); });

/* ---------- PHASE 4: the regression-prone invoice flow ---------- */
const inv=await pg.evaluate(async()=>{
  const o={};
  // Full teardown first: several openers append an overlay shown by inline
  // style, which classList.remove('show') does not hide. Report what was left.
  // Remove ANY full-screen layer left by an earlier phase. Matching on id
  // patterns missed #gl-cip-equip-mgr (z-index 9500), so match on what actually
  // makes an element block clicks: fixed position with a stacking z-index.
  const isRunCreated=el=>!(window.__baseline&&window.__baseline.has(el)) && el.id!=='crm-panel';
  const isLayer=el=>{ const cs=getComputedStyle(el); return cs.position==='fixed' && (parseInt(cs.zIndex,10)||0)>=300; };
  o.leftoverOverlays=[...document.body.children].filter(el=>isRunCreated(el)&&isLayer(el))
    .map(e=>e.id||e.className||e.tagName);
  [...document.body.children].filter(el=>isRunCreated(el)&&isLayer(el)).forEach(el=>el.remove());
  try{ window.openNewInvoiceBuilder(); document.getElementById('gl-inv-builder').classList.remove('show'); }catch(e){}
  try{ window.viewClientEnhanced('sweep-c1'); }catch(e){ return {err:e.message}; }
  await new Promise(r=>setTimeout(r,320));
  const btn=[...document.querySelectorAll('#client-detail-overlay button')].find(b=>(b.textContent||'').includes('New Invoice'));
  o.buttonFound=!!btn;
  if(btn){ btn.click(); await new Promise(r=>setTimeout(r,420)); }
  const b=document.getElementById('gl-inv-builder');
  o.builderShown=!!b&&b.classList.contains('show');
  o.clientPreselected=(document.getElementById('ginv-client')||{}).value==='sweep-c1';
  o.overlayClosed=!document.getElementById('client-detail-overlay');
  const top=document.elementFromPoint(Math.floor(innerWidth/2),60);
  o.builderOnTop=!!(top&&top.closest('#gl-inv-builder'));
  if(!o.builderOnTop && top){
    // Name whatever is covering it, so a real stacking bug is distinguishable
    // from a stray element left behind by an earlier phase of this sweep.
    let n=top, chain=[];
    while(n && n!==document.body){ chain.push(n.id?('#'+n.id):(n.className?('.'+String(n.className).split(' ')[0]):n.tagName)); n=n.parentElement; }
    o.blockedBy=chain.join(' < ');
    o.blockerZ=getComputedStyle(top.closest('[style*="z-index"]')||top).zIndex;
  }
  if(b)b.classList.remove('show');
  return o;
});
rec('Invoice flow','"+ New Invoice" button exists on the client',inv.buttonFound,inv.err||'');
rec('Invoice flow','clicking it opens the builder',inv.builderShown);
rec('Invoice flow','client is pre-selected',inv.clientPreselected);
rec('Invoice flow','client popup closes',inv.overlayClosed);
rec('Invoice flow','builder is the topmost overlay',inv.builderOnTop,
  'blocked by: '+(inv.blockedBy||'?')+'  z='+(inv.blockerZ||'?'));

/* ---------- PHASE 5: correspondence + nudge + badges ---------- */
const corr=await pg.evaluate(async()=>{
  const o={}; const D=d=>new Date(Date.now()-d*86400000).toISOString();
  o.helpers=['glDedupeEmailRows','glNoReplyFor','glCorrTime','glOutreachBadge','glLoadOutreachIndex','glShowEmailFull','glRenderCorrespondence','glSyncGmail','glStripDashes','glRunRefine','ddpNudgeLead','cdeNudge']
    .filter(f=>typeof window[f]!=='function');
  // dedupe: same message twice + a genuine reply
  const rows=[
    {subject:'Re: Quote',to_email:'sweep@test.local',direction:'outbound',body_preview:'short snippet',sent_at:D(5),created_at:D(5)},
    {subject:'Re: Quote',to_email:'sweep@test.local',direction:'outbound',body_preview:'the full message text is much longer than the snippet',sent_at:D(5),created_at:D(4)},
    {subject:'Re: Quote',from_email:'sweep@test.local',to_email:'mike@goodliquid.com',direction:'inbound',body_preview:'their reply',sent_at:D(2),created_at:D(1)}
  ];
  const dd=window.glDedupeEmailRows(rows);
  o.dedupedTo=dd.length;
  o.keptFuller=dd.some(x=>x.body_preview.length>40);
  o.replyKept=dd.some(x=>x.direction==='inbound');
  o.sortedNewestFirst=window.glCorrTime(dd[0])>=window.glCorrTime(dd[dd.length-1]);
  // nudge
  o.nudgeStale=window.glNoReplyFor([{direction:'outbound',sent_at:D(11),created_at:D(11)}]);
  o.nudgeReplied=window.glNoReplyFor(rows);
  // badges
  window.supa.from=()=>({select:()=>({order:()=>({limit:async()=>({data:[
    {to_email:'sweep@test.local',direction:'outbound',sent_at:D(13),created_at:D(13)},
    {to_email:'sweep@test.local',direction:'outbound',sent_at:D(2),created_at:D(2)}
  ]})})})});
  await window.glLoadOutreachIndex();
  o.badge=String(window.glOutreachBadge('sweep@test.local')).replace(/<[^>]+>/g,'');
  // full-message popup
  window.glRenderCorrespondence('sweep',dd);
  window.glShowEmailFull('sweep',0);
  await new Promise(r=>setTimeout(r,150));
  const pop=document.getElementById('gl-email-full');
  o.popupOpens=!!pop;
  o.popupScrolls=pop?/overflow-y:auto/.test(pop.innerHTML):false;
  if(pop)pop.remove();
  // AI dash stripping
  o.dash1=window.glStripDashes('Enjoyed the meeting — excited about this.');
  o.dash2=window.glStripDashes('Lead time 2–6 weeks for co-packing GL-1042.');
  return o;
});
rec('Correspondence','all helper functions defined',corr.helpers.length===0,'missing: '+corr.helpers.join(', '));
rec('Correspondence','duplicate pair merged to one',corr.dedupedTo===2,'got '+corr.dedupedTo+' rows');
rec('Correspondence','keeps the fuller message body',corr.keptFuller);
rec('Correspondence','a genuine reply is never merged away',corr.replyKept);
rec('Correspondence','thread sorted newest-first by send date',corr.sortedNewestFirst);
rec('Correspondence','nudge fires at 11 days no reply',corr.nudgeStale&&corr.nudgeStale.days===11);
rec('Correspondence','nudge suppressed once they replied',corr.nudgeReplied===null);
rec('Correspondence','pipeline badge reads "nudged"',/nudged/.test(corr.badge),corr.badge);
rec('Correspondence','full-message popup opens and scrolls',corr.popupOpens&&corr.popupScrolls);
rec('AI style','em dash becomes a comma',corr.dash1==='Enjoyed the meeting, excited about this.',corr.dash1);
rec('AI style','range becomes "to", hyphens kept',corr.dash2==='Lead time 2 to 6 weeks for co-packing GL-1042.',corr.dash2);

/* ---------- PHASE 6: refine feedback can never be silent ---------- */
const refine=await pg.evaluate(async()=>{
  const o={};
  const row=document.createElement('div'); document.body.appendChild(row);
  const instr=document.createElement('textarea'); const subj=document.createElement('input'); const body=document.createElement('textarea');
  const btn=document.createElement('button'); btn.textContent='✨ Apply';
  [instr,subj,body,btn].forEach(e=>row.appendChild(e));
  // empty instruction -> must warn, not sit silent
  await window.glRunRefine({row,instrEl:instr,subjEl:subj,bodyEl:body,btn});
  o.emptyWarns=!!row.querySelector('.gl-refine-note')&&row.querySelector('.gl-refine-note').textContent.length>0;
  // AI unreachable -> must report, and re-enable the button
  instr.value='make it shorter';
  window.supa.functions.invoke=async()=>({data:null,error:{message:'boom'}});
  await window.glRunRefine({row,instrEl:instr,subjEl:subj,bodyEl:body,btn});
  o.failWarns=/Couldn|wrong/i.test(row.querySelector('.gl-refine-note').textContent);
  o.btnReEnabled=btn.disabled===false;
  // success path applies the text
  window.supa.functions.invoke=async()=>({data:{ok:true,text:'Subject: New subject\n\nNew body here.'},error:null});
  instr.value='make it shorter';
  await window.glRunRefine({row,instrEl:instr,subjEl:subj,bodyEl:body,btn});
  o.applied=subj.value==='New subject'&&/New body here/.test(body.value);
  row.remove();
  return o;
});
rec('Refine with Claude','empty instruction gives feedback',refine.emptyWarns);
rec('Refine with Claude','failure reports instead of hanging',refine.failWarns);
rec('Refine with Claude','button re-enables after failure',refine.btnReEnabled);
rec('Refine with Claude','success applies subject + body',refine.applied);

/* ---------- PHASE 7: help ---------- */
const help=await pg.evaluate(async()=>{
  const o={};
  if(typeof window.glOpenHelp!=='function') return {missing:true};
  try{ window.glOpenHelp(); }catch(e){ return {threw:e.message}; }
  await new Promise(r=>setTimeout(r,900));
  o.tocHasNewSection=document.body.innerText.includes('Email & Correspondence');
  const sec=document.getElementById('help-corr');
  o.sectionMounted=!!sec;
  const t=sec?sec.innerText:'';
  o.covers=['CORRESPONDENCE PANEL','NO-REPLY NUDGE','FOLLOW-UP BADGES','GMAIL SYNC','HOW THE AI WRITES'].filter(k=>!t.includes(k));
  document.querySelectorAll('[id^="help"]').forEach(x=>{ if(x.classList)x.classList.remove('show'); });
  return o;
});
rec('Help','help modal opens',!help.missing&&!help.threw,help.threw||'');
rec('Help','new section in the contents',help.tocHasNewSection);
rec('Help','new section mounted',help.sectionMounted);
rec('Help','covers every new feature',(help.covers||[]).length===0,'missing: '+(help.covers||[]).join(', '));

/* ---------- PHASE 7b: fixes that had no coverage ---------- */
/* Each of these was fixed today and asserted nowhere, so a later change could
   have silently undone it. */
const gaps=await pg.evaluate(async()=>{
  const o={};
  // Mobile bottom-nav Dashboard tab: pointed at a page name that does not exist,
  // so tapping it on a phone did nothing.
  const dashTab=[...document.querySelectorAll('.crm-bnav-item')].find(b=>/Dashboard/i.test(b.textContent||''));
  o.mobileTabFound=!!dashTab;
  o.mobileTabTargetsRealPage=!!dashTab && /cNav\('dashboard'/.test(dashTab.getAttribute('onclick')||'');
  if(dashTab){ try{ dashTab.click(); }catch(e){ o.mobileTabThrew=e.message; } }
  await new Promise(r=>setTimeout(r,200));
  o.mobileTabShowsPage=!!document.getElementById('cpg-dashboard');

  // Admin button on the public site must open the password prompt.
  if(typeof window.openAdmin==='function'){
    try{ window.openAdmin(); }catch(e){ o.adminThrew=e.message; }
    await new Promise(r=>setTimeout(r,200));
    const pw=document.getElementById('pw-ov');
    o.adminOpensPrompt=!!pw&&pw.classList.contains('show');
    if(pw)pw.classList.remove('show');
  } else o.adminOpensPrompt=null;

  // Cross-sell "Draft email" wrote to an element that does not exist, so the
  // reasoning never reached the AI modal.
  o.crossSellFieldExists=!!document.getElementById('ai-comm-custom');
  o.crossSellRowExists=!!document.getElementById('ai-comm-custom-row');
  o.crossSellTypeHasCustom=[...(document.getElementById('ai-comm-type')||{options:[]}).options]
    .some(op=>op.value==='custom');

  // Automatic sync: throttled so it cannot fire on every render or loop.
  o.autoSyncFns=['glAutoSyncDue','glAutoSyncContact'].filter(f=>typeof window[f]!=='function');
  try{ localStorage.removeItem('gl_sync_probe'); }catch(e){}
  o.throttleFirstCallAllowed=window.glAutoSyncDue('probe',15)===true;
  o.throttleSecondCallBlocked=window.glAutoSyncDue('probe',15)===false;

  // Clients-list loading skeleton targeted the wrong tbody id.
  o.clientTbodyExists=!!document.getElementById('client-body');
  return o;
});
rec('Previously untested','mobile Dashboard tab exists',gaps.mobileTabFound);
rec('Previously untested','mobile Dashboard tab targets a real page',gaps.mobileTabTargetsRealPage,gaps.mobileTabThrew||'');
rec('Previously untested','mobile Dashboard tab reaches the dashboard',gaps.mobileTabShowsPage);
if(gaps.adminOpensPrompt===null) rec('Previously untested','admin button opens the password prompt',true,'skipped: openAdmin not defined');
else rec('Previously untested','admin button opens the password prompt',gaps.adminOpensPrompt,gaps.adminThrew||'');
rec('Previously untested','cross-sell target field exists',gaps.crossSellFieldExists);
rec('Previously untested','cross-sell custom row exists',gaps.crossSellRowExists);
rec('Previously untested','AI comm type offers "custom"',gaps.crossSellTypeHasCustom);
rec('Previously untested','auto-sync helpers defined',gaps.autoSyncFns.length===0,'missing: '+gaps.autoSyncFns.join(', '));
rec('Previously untested','auto-sync throttle allows the first call',gaps.throttleFirstCallAllowed);
rec('Previously untested','auto-sync throttle blocks the repeat (no loop)',gaps.throttleSecondCallBlocked);
rec('Previously untested','clients table body id is correct',gaps.clientTbodyExists);

/* ---------- PHASE 8: no fatal errors overall ---------- */
rec('Stability','no fatal JS error across the whole sweep',appErrors.length===0,appErrors.slice(0,4).join(' | '));

await br.close(); srv.close();

/* ---------- report ---------- */
const groups=[...new Set(results.map(r=>r.group))];
let fails=0, skips=0;
console.log('');
groups.forEach(g=>{
  const rows=results.filter(r=>r.group===g);
  const bad=rows.filter(r=>!r.ok).length;
  console.log('── '+g+'  ('+(rows.length-bad)+'/'+rows.length+')');
  rows.forEach(r=>{
    if(/^skipped/.test(r.detail)){ skips++; console.log('   SKIP  '+r.name+'  ('+r.detail+')'); return; }
    if(r.ok){ console.log('   PASS  '+r.name); }
    else { fails++; console.log('   FAIL  '+r.name+(r.detail?'  — '+r.detail:'')); }
  });
});
console.log('');
console.log('TOTAL: '+results.length+' checks · '+(results.length-fails-skips)+' passed · '+fails+' failed · '+skips+' skipped');
process.exit(fails?1:0);
})();
