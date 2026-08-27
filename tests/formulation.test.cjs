/*
 * formulation.test.cjs — the 🧪 formulation block on Pipeline + Clients.
 * Drives the real index.html with a stubbed Supabase that CAPTURES every
 * update payload, then asserts the three columns actually reach the server:
 * formulation_done / formulation_vendor / formulation_spend. Also checks the
 * house dropdown is seeded from public.formulators, that "＋ Add formulator…"
 * inserts and selects the new house, and that unticking clears the pair.
 *
 * RUN: NODE_PATH=/opt/node22/lib/node_modules \
 *      PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node tests/formulation.test.cjs
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=process.env.REPO_ROOT||path.resolve(__dirname,'..');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{if(e){s.writeHead(404);s.end();return;}
    s.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'text/plain'});s.end(b);});});

const results=[];
const rec=(n,ok,d)=>{results.push({n,ok:!!ok,d:d||''});console.log((ok?'  ok   ':'  FAIL ')+n+(d?' — '+d:''));};

(async()=>{
await new Promise(r=>srv.listen(8934,r));
const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
const pg=await br.newPage();
const appErrors=[];
pg.on('pageerror',e=>{const m=String(e&&e.message||e);
  if(!/Failed to fetch|NetworkError|ERR_|net::|TUNNEL|WebSocket|Maximum call stack|jszip|supabase|Load failed|status of 4|status of 5|CORS|is not a function/i.test(m)) appErrors.push(m);});
pg.on('dialog',async d=>{ await d.accept(d.type()==='prompt' ? 'Nutra Labs West' : ''); });

await pg.goto('http://127.0.0.1:8934/index.html',{waitUntil:'domcontentloaded',timeout:30000});
await pg.waitForTimeout(2500);

const out=await pg.evaluate(async()=>{
  const o={};
  try {
  window.__writes=[];
  const FORMULATORS=[{name:'Lotus Nutra',active:true,sort_order:10}];

  function chain(table){
    const c={_t:table};
    const data=()=> table==='formulators' ? FORMULATORS.slice() : [];
    c.select=()=>c; c.eq=()=>c; c.order=()=>c; c.limit=()=>c; c.range=()=>c; c.in=()=>c;
    c.maybeSingle=async()=>({data:null,error:null});
    c.then=(res)=>Promise.resolve({data:data(),error:null,count:data().length}).then(res);
    c.update=(row)=>{ const w={op:'update',table,row}; window.__writes.push(w);
      return {eq:()=>({select:async()=>({data:[Object.assign({id:'x'},row)],error:null})})}; };
    c.insert=(rows)=>{ window.__writes.push({op:'insert',table,row:(rows||[])[0]});
      if(table==='formulators') FORMULATORS.push({name:(rows||[])[0].name,active:true,sort_order:99});
      return {select:async()=>({data:(rows||[]).map((r,i)=>Object.assign({id:'n'+i},r)),error:null})}; };
    c.delete=()=>({eq:()=>({select:async()=>({data:[{id:'x'}],error:null})})});
    c.upsert=(rows)=>{ window.__writes.push({op:'upsert',table,row:(rows||[])[0]});
      const u={select:async()=>({data:(rows||[]),error:null}),
               then:(res)=>Promise.resolve({data:(rows||[]),error:null}).then(res)};
      return u; };
    return c;
  }
  window.supa={from:chain,rpc:async()=>({data:null,error:null}),
    functions:{invoke:async()=>({data:{ok:true},error:null})},
    auth:{getUser:async()=>({data:{user:{id:'u1'}},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
    channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:()=>{}};
  window.currentUser={id:'u1',email:'mike@krail.us',role:'admin',name:'Mike',initials:'MK'};

  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  // ══ PIPELINE ══════════════════════════════════════════════
  window.deals['Prospecting']=[{id:'d-uuid-1',name:'Lotus Test Deal',co:'Test Brand',
    val:'$10,000',prob:20,notes:'',contactName:'',email:'',phone:'',
    formulationDone:false,formulationVendor:'',formulationSpend:null}];
  window.openDealDetail('Prospecting',0);
  await sleep(200);
  window.editDealDetail();
  await sleep(400);

  o.dealBlockRendered = !!document.getElementById('ddp-form-done');
  const dsel=document.getElementById('ddp-form-vendor');
  o.dealVendorSeeded = !!dsel && [...dsel.options].some(x=>x.value==='Lotus Nutra');
  o.dealHasAddOption = !!dsel && [...dsel.options].some(x=>/Add formulator/.test(x.textContent));
  o.dealFieldsHiddenWhenUnticked = document.getElementById('ddp-form-fields').style.display==='none';

  const dcb=document.getElementById('ddp-form-done');
  dcb.checked=true; dcb.dispatchEvent(new Event('change'));
  await sleep(100);
  o.dealFieldsShownWhenTicked = document.getElementById('ddp-form-fields').style.display==='grid';
  o.dealVendorAutoPicked = dsel.value==='Lotus Nutra';

  document.getElementById('ddp-form-spend').value='2500.50';
  window.__writes.length=0;
  await window.saveDealDetail();
  await sleep(400);
  const dw=window.__writes.find(w=>w.table==='deals'&&w.op==='update');
  o.dealSaved = !!dw;
  o.dealSavedDone   = dw && dw.row.formulation_done===true;
  o.dealSavedVendor = dw && dw.row.formulation_vendor==='Lotus Nutra';
  o.dealSavedSpend  = dw && dw.row.formulation_spend===2500.5;
  o.dealSavedPayload = dw ? JSON.stringify({d:dw.row.formulation_done,v:dw.row.formulation_vendor,s:dw.row.formulation_spend}) : null;

  // View mode shows it back
  window.openDealDetail('Prospecting',0);
  await sleep(200);
  const vtxt=document.getElementById('ddp-view-mode').innerText;
  o.dealViewShowsVendor = /Lotus Nutra/.test(vtxt);
  o.dealViewShowsSpend  = /2,500\.50/.test(vtxt);

  // ══ ADD A FORMULATOR (dropdown → prompt → insert) ═════════
  window.editDealDetail();
  await sleep(400);
  const dsel2=document.getElementById('ddp-form-vendor');
  dsel2.value='__gl_add_formulator__';
  dsel2.dispatchEvent(new Event('change'));
  await sleep(600);
  const ins=window.__writes.find(w=>w.table==='formulators'&&w.op==='insert');
  o.addedFormulatorInserted = !!ins && ins.row.name==='Nutra Labs West';
  o.addedFormulatorSelected = dsel2.value==='Nutra Labs West';
  o.sentinelNeverStored = dsel2.value!=='__gl_add_formulator__';

  // ══ UNTICK CLEARS THE PAIR ════════════════════════════════
  const dcb2=document.getElementById('ddp-form-done');
  dcb2.checked=false; dcb2.dispatchEvent(new Event('change'));
  window.__writes.length=0;
  await window.saveDealDetail();
  await sleep(400);
  const dw2=window.__writes.find(w=>w.table==='deals'&&w.op==='update');
  o.untickClears = dw2 && dw2.row.formulation_done===false
    && dw2.row.formulation_vendor===null && dw2.row.formulation_spend===null;

  // ══ CLIENTS ═══════════════════════════════════════════════
  window.clients.length=0;
  window.clients.push({id:'c-uuid-1',name:'Lotus Nutra Brand',contact:'A B',email:'a@b.co',phone:'',
    status:'active',service:'Canning',paymentTerms:'Net 30',commPrefs:[],productTypes:[],dockDays:[],
    additionalEmails:[],notes:'',formulationDone:false,formulationVendor:'',formulationSpend:null});
  window.glOpenEditClient('c-uuid-1');
  await sleep(600);
  o.clientBlockRendered = !!document.getElementById('gl-ec-form-done');
  const csel=document.getElementById('gl-ec-form-vendor');
  o.clientVendorSeeded = !!csel && [...csel.options].some(x=>x.value==='Lotus Nutra');

  const ccb=document.getElementById('gl-ec-form-done');
  ccb.checked=true; ccb.dispatchEvent(new Event('change'));
  await sleep(100);
  csel.value='Lotus Nutra';
  document.getElementById('gl-ec-form-spend').value='875.25';
  window.__writes.length=0;
  document.getElementById('gl-ec-save').click();
  await sleep(900);
  const cw=window.__writes.find(w=>w.table==='clients'&&w.op==='update');
  o.clientSaved = !!cw;
  o.clientSavedDone   = cw && cw.row.formulation_done===true;
  o.clientSavedVendor = cw && cw.row.formulation_vendor==='Lotus Nutra';
  o.clientSavedSpend  = cw && cw.row.formulation_spend===875.25;
  o.clientSavedPayload = cw ? JSON.stringify({d:cw.row.formulation_done,v:cw.row.formulation_vendor,s:cw.row.formulation_spend}) : null;

  // Read-only detail popup section
  const summary = window.glFormulationSummary({formulationDone:true,formulationVendor:'Lotus Nutra',formulationSpend:875.25});
  o.detailSummaryRenders = /Lotus Nutra/.test(summary) && /875\.25/.test(summary);
  o.summaryEmptyWhenNotDone = window.glFormulationSummary({formulationDone:false})==='';

  // Escaping: a house name with markup must not reach the DOM as HTML.
  const nasty = window.glFormulationSummary({formulationDone:true,formulationVendor:'<img src=x onerror=alert(1)>',formulationSpend:1});
  o.vendorEscaped = nasty.indexOf('<img') === -1 && nasty.indexOf('&lt;img') > -1;

  // Negative spend is dropped here rather than bounced by the DB CHECK.
  // Saving closed the editor, so reopen it to get a live form back.
  window.glOpenEditClient('c-uuid-1');
  await sleep(600);
  const ncb=document.getElementById('gl-ec-form-done');
  ncb.checked=true; ncb.dispatchEvent(new Event('change'));
  document.getElementById('gl-ec-form-spend').value='-50';
  o.negativeSpendDropped = window.glFormulationRead('gl-ec-form').spend===null;
  // A blank amount is null, not 0 — "unknown" and "zero" are different facts.
  document.getElementById('gl-ec-form-spend').value='';
  o.blankSpendIsNull = window.glFormulationRead('gl-ec-form').spend===null;
  } catch(err){ o.__threw = String(err && err.message || err); }
  return o;
});

rec('deal: block renders in edit mode', out.dealBlockRendered);
rec('deal: dropdown seeded from formulators table', out.dealVendorSeeded);
rec('deal: "＋ Add formulator…" offered', out.dealHasAddOption);
rec('deal: fields hidden until ticked', out.dealFieldsHiddenWhenUnticked);
rec('deal: fields shown when ticked', out.dealFieldsShownWhenTicked);
rec('deal: ticking auto-picks first house', out.dealVendorAutoPicked);
rec('deal: update reached the server', out.dealSaved, out.dealSavedPayload);
rec('deal: formulation_done saved', out.dealSavedDone);
rec('deal: formulation_vendor saved', out.dealSavedVendor);
rec('deal: formulation_spend saved', out.dealSavedSpend);
rec('deal: view mode shows the house', out.dealViewShowsVendor);
rec('deal: view mode shows the amount', out.dealViewShowsSpend);
rec('add formulator: inserted', out.addedFormulatorInserted);
rec('add formulator: selected after adding', out.addedFormulatorSelected);
rec('add formulator: sentinel never stored as a vendor', out.sentinelNeverStored);
rec('untick clears house + amount', out.untickClears);
rec('client: block renders in edit form', out.clientBlockRendered);
rec('client: dropdown seeded', out.clientVendorSeeded);
rec('client: update reached the server', out.clientSaved, out.clientSavedPayload);
rec('client: formulation_done saved', out.clientSavedDone);
rec('client: formulation_vendor saved', out.clientSavedVendor);
rec('client: formulation_spend saved', out.clientSavedSpend);
rec('detail popup: summary renders', out.detailSummaryRenders);
rec('detail popup: empty when not done', out.summaryEmptyWhenNotDone);
rec('vendor name is HTML-escaped', out.vendorEscaped);
rec('negative spend dropped before save', out.negativeSpendDropped);
rec('blank spend saves as null, not 0', out.blankSpendIsNull);
rec('evaluate ran clean', !out.__threw, out.__threw||'');
rec('no unexpected page errors', appErrors.length===0, appErrors.join(' | '));

const failed=results.filter(r=>!r.ok);
console.log('\n'+(results.length-failed.length)+'/'+results.length+' passed');
await br.close();srv.close();
process.exit(failed.length?1:0);
})();
