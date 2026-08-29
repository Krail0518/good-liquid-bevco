/*
 * gmp.test.cjs — the Daily GMP module (src/modules/production/gmp.js).
 * Drives the real hub + combo entry with a stubbed Supabase, verifying the
 * defining behavior: ONE entry with shared header + two forms filled writes
 * TWO compliance_records that SHARE a batch_id and carry the shared header,
 * and a failing check flags has_deviation. Also checks the hub renders and a
 * register view opens.
 *
 * RUN: NODE_PATH=/opt/node22/lib/node_modules  *      PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node tests/gmp.test.cjs
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=process.env.REPO_ROOT||path.resolve(__dirname,'..');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'text/plain'});s.end(b);});});

const results=[];
const rec=(n,ok,d)=>results.push({n,ok:!!ok,d:d||''});

(async()=>{
await new Promise(r=>srv.listen(8912,r));
const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
const pg=await br.newPage();
const appErrors=[];
pg.on('pageerror',e=>{const m=String(e&&e.message||e);
  if(!/Failed to fetch|NetworkError|ERR_|net::|TUNNEL|WebSocket|Maximum call stack|jszip|supabase|Load failed|status of 4|status of 5|CORS|is not a function/i.test(m)) appErrors.push(m);});

await pg.goto('http://127.0.0.1:8912/index.html',{waitUntil:'domcontentloaded',timeout:30000});
await pg.waitForTimeout(2500);

const TEMPLATES=[
  {form_code:'GMP-PREOP-001',title:'Pre-Op Sanitation',category:'sanitation',frequency:'per_run',in_daily:true,active:true,sort_order:10,
   fields:[{key:'area',label:'Line / area',type:'text',required:true},{key:'result',label:'Result',type:'passfail',required:true,deviation_if:'fail'}]},
  {form_code:'GMP-SEAM-001',title:'Double-Seam',category:'seam',frequency:'per_run',in_daily:true,active:true,sort_order:40,
   fields:[{key:'seamer_id',label:'Seamer',type:'text',required:true},{key:'visual_ok',label:'Visual OK',type:'passfail',required:true,deviation_if:'fail'}]}
];

const out=await pg.evaluate(async(TEMPLATES)=>{
  const o={};
  // Chainable stub; capture inserts into compliance_records.
  window.__inserted=[];
  function chain(table){
    const c={_t:table,_f:null};
    c.select=()=>c; c.order=()=>c; c.limit=async()=>({data:table==='gmp_templates'?TEMPLATES:[],error:null});
    c.eq=(k,v)=>{ if(k==='form_code') c._f=v; return c; };
    c.in=()=>c; c.maybeSingle=async()=>({data:table==='gmp_templates'?(TEMPLATES.find(t=>t.form_code===c._f)||null):null,error:null});
    c.insert=(rows)=>{ if(table==='compliance_records') window.__inserted.push(...rows); return {select:async()=>({data:(rows||[]).map((_,i)=>({id:'r'+i})),error:null})}; };
    // make the eq(...).order(...).limit chain awaitable for records reads
    c.then=(res)=>Promise.resolve({data:table==='gmp_templates'?TEMPLATES:[],error:null}).then(res);
    return c;
  }
  window.supa={from:(t)=>chain(t),rpc:async()=>({data:null,error:null}),
    functions:{invoke:async()=>({data:{ok:true},error:null})},
    auth:{getUser:async()=>({data:{user:{id:'u1'}},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
    channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:()=>{}};
  window.currentUser={id:'u1',email:'op@test',role:'admin',name:'Op Tester',initials:'OT'};

  // Hub renders into the page container.
  const host=document.getElementById('cpg-gmp');
  o.hostExists=!!host;
  window.glRenderGMPHub();
  o.hubHasLogButton=/Log today/i.test(host?host.innerText:'');

  // Open the combo entry, fill shared header + two forms (seam fails).
  await window.glOpenDailyGMP();
  await new Promise(r=>setTimeout(r,200));
  const ov=document.getElementById('gl-gmp-daily');
  o.entryOpened=!!ov;
  o.sharedOnce=!!ov && !!ov.querySelector('#gmp-h-date') && !!ov.querySelector('#gmp-h-operator');
  // header
  ov.querySelector('#gmp-h-line').value='Line 1';
  ov.querySelector('#gmp-h-run').value='B-42';
  ov.querySelector('#gmp-h-operator').value='Op Tester';
  // form 1: preop pass
  const s1=ov.querySelector('.gl-gmp-sec[data-code="GMP-PREOP-001"]');
  s1.querySelector('[data-key="area"]').value='Filler';
  s1.querySelector('[data-key="result"]').value='pass';
  // form 2: seam FAIL
  const s2=ov.querySelector('.gl-gmp-sec[data-code="GMP-SEAM-001"]');
  s2.querySelector('[data-key="seamer_id"]').value='S-1';
  s2.querySelector('[data-key="visual_ok"]').value='fail';

  ov.querySelector('#gmp-save-sign').click();
  await new Promise(r=>setTimeout(r,300));

  const ins=window.__inserted;
  o.count=ins.length;
  o.twoRecords=ins.length===2;
  o.sameBatch=ins.length===2 && ins[0].batch_id && ins[0].batch_id===ins[1].batch_id;
  o.sharedFannedOut=ins.every(r=>r.data && r.data.line==='Line 1' && r.data.run==='B-42' && r.data.operator==='Op Tester');
  o.seamDeviation=!!ins.find(r=>r.form_code==='GMP-SEAM-001' && r.has_deviation===true);
  o.preopNoDeviation=!!ins.find(r=>r.form_code==='GMP-PREOP-001' && r.has_deviation===false);
  o.signed=ins.every(r=>r.status==='signed' && r.signed_by==='u1');
  return o;
},TEMPLATES);

rec('hub page container exists', out.hostExists);
rec('hub renders with a Log button', out.hubHasLogButton);
rec('combo entry opens', out.entryOpened);
rec('shared header entered once (date + operator)', out.sharedOnce);
rec('ONE entry writes TWO records (fan-out)', out.twoRecords, 'count='+out.count);
rec('the two records share one batch_id', out.sameBatch);
rec('shared header fanned into every record', out.sharedFannedOut);
rec('failing seam check flags a deviation', out.seamDeviation);
rec('passing pre-op has no deviation', out.preopNoDeviation);
rec('sign & save marks records signed', out.signed);
rec('no fatal app error', appErrors.length===0, appErrors.slice(0,3).join(' | '));

await br.close(); srv.close();
let fails=0;
console.log('');
results.forEach(r=>{ if(r.ok){console.log('  PASS  '+r.n);} else {fails++;console.log('  FAIL  '+r.n+(r.d?'  — '+r.d:''));} });
console.log('\n'+results.length+' checks · '+(results.length-fails)+' passed · '+fails+' failed');
process.exit(fails?1:0);
})();
