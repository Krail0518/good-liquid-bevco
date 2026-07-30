/*
 * sqf-supplier-ncr.test.cjs — the Approved-Supplier program + NCR/CAPA
 * (crm-quality.js + crm-gmp.js). Drives the real app with a stubbed Supabase,
 * verifying the defining Phase-2 behaviors:
 *   - a GMP deviation can be escalated into an NCR: glRaiseNCRFromDeviation(rec)
 *     writes exactly ONE `defects` row tagged source='gmp_deviation', carrying
 *     the source record id, severity 'high', status 'open', and an NCR number.
 *   - the vendor modal carries the approval-program fields (status, cert, risk).
 *   - the defect modal carries the CAPA fields (preventive action, verified-at,
 *     due date).
 *
 * NOTE: the parallel agents' crm-quality.js / crm-gmp.js changes may not be
 * present when this runs. This file only asserts its own contract; a failure
 * solely because a function is still undefined is expected pre-integration.
 *
 * RUN: NODE_PATH=/opt/node22/lib/node_modules \
 *      PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *      node tests/sqf-supplier-ncr.test.cjs
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
await new Promise(r=>srv.listen(8915,r));
const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
const pg=await br.newPage();
const appErrors=[];
pg.on('pageerror',e=>{const m=String(e&&e.message||e);
  if(!/Failed to fetch|NetworkError|ERR_|net::|TUNNEL|WebSocket|Maximum call stack|jszip|supabase|Load failed|status of 4|status of 5|CORS|is not a function/i.test(m)) appErrors.push(m);});

await pg.goto('http://127.0.0.1:8915/index.html',{waitUntil:'domcontentloaded',timeout:30000});
await pg.waitForTimeout(2500);

const out=await pg.evaluate(async()=>{
  const o={};
  // Chainable stub: reads resolve empty; inserts to `defects` are captured.
  window.__ncr=[];
  function chain(table){
    const c={_t:table};
    ['select','order','eq','neq','gt','gte','lt','lte','like','ilike','is','in','or','and','not','limit','range','match','filter','single','onConflict']
      .forEach(m=>{c[m]=()=>c;});
    c.maybeSingle=async()=>({data:null,error:null});
    c.update=()=>c; c.upsert=()=>c; c.delete=()=>c;
    c.insert=(rows)=>{
      const arr=Array.isArray(rows)?rows:[rows];
      if(table==='defects') window.__ncr.push(...arr);
      const ret={select:()=>({single:async()=>({data:arr.map((_,i)=>({id:'d'+i}))[0]||null,error:null}),
        maybeSingle:async()=>({data:arr.map((_,i)=>({id:'d'+i}))[0]||null,error:null}),
        then:(res)=>Promise.resolve({data:arr.map((_,i)=>({id:'d'+i})),error:null}).then(res)}),
        then:(res)=>Promise.resolve({data:arr.map((_,i)=>({id:'d'+i})),error:null}).then(res)};
      return ret;
    };
    c.then=(res)=>Promise.resolve({data:[],error:null}).then(res);
    return c;
  }
  window.supa={from:(t)=>chain(t),rpc:async()=>({data:null,error:null}),
    functions:{invoke:async()=>({data:{ok:true},error:null})},
    auth:{getUser:async()=>({data:{user:{id:'u1'}},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
    storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'#'},error:null}),upload:async()=>({data:{},error:null}),list:async()=>({data:[],error:null}),remove:async()=>({data:{},error:null})})},
    channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:()=>{}};
  window.currentUser={id:'u1',email:'qa@test',role:'admin',is_admin:true,name:'QA Tester',initials:'QT'};

  // a) Escalate a GMP deviation into an NCR.
  o.raiseIsFn=typeof window.glRaiseNCRFromDeviation==='function';
  if(o.raiseIsFn){
    window.__ncr.length=0;
    const dev={id:'r1',form_code:'GMP-SEAM-001',deviation_notes:'seam fail',data:{run:'B-1',operator:'Op A'}};
    try{ await window.glRaiseNCRFromDeviation(dev); }catch(e){ o.raiseThrew=e.message; }
    await new Promise(r=>setTimeout(r,150));
    o.ncrCount=window.__ncr.length;
    const row=window.__ncr[0]||{};
    o.ncrSource=row.source==='gmp_deviation';
    o.ncrSourceId=row.source_record_id==='r1';
    o.ncrSeverity=row.severity==='high';
    o.ncrStatus=row.status==='open';
    o.ncrNumber=typeof row.ncr_number==='string' && /^NCR-/.test(row.ncr_number);
  }

  // b) Vendor modal carries the approval-program fields.
  o.venIsFn=typeof window.glOpenAddVendor==='function';
  if(o.venIsFn){
    try{ await window.glOpenAddVendor(); }catch(e){ o.venThrew=e.message; }
    await new Promise(r=>setTimeout(r,200));
    o.venStatus=!!document.getElementById('gl-ven-status');
    o.venCert=!!document.getElementById('gl-ven-cert');
    o.venRisk=!!document.getElementById('gl-ven-risk');
    document.querySelectorAll('[id$="-overlay"],[id$="-modal"]').forEach(x=>x.remove());
  }

  // c) Defect modal carries the CAPA fields.
  o.defIsFn=typeof window.glOpenAddDefect==='function';
  if(o.defIsFn){
    try{ await window.glOpenAddDefect(); }catch(e){ o.defThrew=e.message; }
    await new Promise(r=>setTimeout(r,200));
    o.defPrev=!!document.getElementById('gl-def-prev');
    o.defVat=!!document.getElementById('gl-def-vat');
    o.defDue=!!document.getElementById('gl-def-due');
    document.querySelectorAll('[id$="-overlay"],[id$="-modal"]').forEach(x=>x.remove());
  }
  return o;
});

rec('glRaiseNCRFromDeviation is a function', out.raiseIsFn);
rec('raising an NCR writes exactly one defects row', out.ncrCount===1, out.raiseThrew?('threw '+out.raiseThrew):('count='+out.ncrCount));
rec('the NCR is tagged source=gmp_deviation', out.ncrSource);
rec('the NCR carries the source record id', out.ncrSourceId);
rec('the NCR is severity=high', out.ncrSeverity);
rec('the NCR opens with status=open', out.ncrStatus);
rec('the NCR gets an NCR-… number', out.ncrNumber);
rec('glOpenAddVendor is a function', out.venIsFn);
rec('vendor modal has the approval-status field', out.venStatus, out.venThrew?('threw '+out.venThrew):'');
rec('vendor modal has the food-safety cert field', out.venCert);
rec('vendor modal has the risk-level field', out.venRisk);
rec('glOpenAddDefect is a function', out.defIsFn);
rec('defect modal has the preventive-action (CAPA) field', out.defPrev, out.defThrew?('threw '+out.defThrew):'');
rec('defect modal has the verified-at field', out.defVat);
rec('defect modal has the due-date field', out.defDue);
rec('no fatal app error', appErrors.length===0, appErrors.slice(0,3).join(' | '));

await br.close(); srv.close();
let fails=0;
console.log('');
results.forEach(r=>{ if(r.ok){console.log('  PASS  '+r.n);} else {fails++;console.log('  FAIL  '+r.n+(r.d?'  — '+r.d:''));} });
console.log('\n'+results.length+' checks · '+(results.length-fails)+' passed · '+fails+' failed');
process.exit(fails?1:0);
})();
