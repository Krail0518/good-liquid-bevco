/*
 * gmp-prp.test.cjs — the Prerequisite Program (PRP) registers (src/modules/production/gmp.js).
 * Verifies the PRP cluster: the GMP hub renders a "Prerequisite Programs"
 * section with tiles (Calibration, Pest, Chemical, Glass, Water, Complaint);
 * a PRP register (in_daily=false) opens its OWN single-form entry via
 * glOpenDailyGMP('GMP-CAL-001'); filling + signing writes exactly ONE
 * compliance_record for that form_code; and a failing tolerance check flags a
 * deviation. Supabase is stubbed.
 *
 * RUN: NODE_PATH=/opt/node22/lib/node_modules \
 *      PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node tests/gmp-prp.test.cjs
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
await new Promise(r=>srv.listen(8921,r));
const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
const pg=await br.newPage();
const appErrors=[];
pg.on('pageerror',e=>{const m=String(e&&e.message||e);
  if(!/Failed to fetch|NetworkError|ERR_|net::|TUNNEL|WebSocket|Maximum call stack|jszip|supabase|Load failed|status of 4|status of 5|CORS|is not a function/i.test(m)) appErrors.push(m);});

await pg.goto('http://127.0.0.1:8921/index.html',{waitUntil:'domcontentloaded',timeout:30000});
await pg.waitForTimeout(2500);

// A single PRP template (calibration), in_daily=false.
const TEMPLATES=[
  {form_code:'GMP-CAL-001',title:'Calibration Verification',category:'calibration',frequency:'monthly',in_daily:false,active:true,sort_order:110,
   fields:[{key:'instrument',label:'Instrument',type:'text',required:true},
           {key:'reference',label:'Reference standard',type:'text',required:true},
           {key:'tolerance_ok',label:'Within tolerance',type:'passfail',required:true,deviation_if:'fail'},
           {key:'next_due',label:'Next due',type:'date'}]}
];

const out=await pg.evaluate(async(TEMPLATES)=>{
  const o={};
  window.__inserted=[];
  function chain(table){
    const c={_t:table,_f:null};
    c.select=()=>c; c.order=()=>c;
    c.eq=(k,v)=>{ if(k==='form_code') c._f=v; return c; };
    c.limit=async()=>({data:table==='gmp_templates'?TEMPLATES:[],error:null});
    c.in=()=>c;
    c.maybeSingle=async()=>({data:table==='gmp_templates'?(TEMPLATES.find(t=>t.form_code===c._f)||null):null,error:null});
    c.insert=(rows)=>{ if(table==='compliance_records') window.__inserted.push(...rows); return {select:async()=>({data:(rows||[]).map((_,i)=>({id:'r'+i})),error:null})}; };
    // awaitable: gmp_templates read honors an eq('form_code',...) filter
    c.then=(res)=>{
      let data=table==='gmp_templates'?TEMPLATES.slice():[];
      if(table==='gmp_templates' && c._f) data=data.filter(t=>t.form_code===c._f);
      return Promise.resolve({data:data,error:null}).then(res);
    };
    return c;
  }
  window.supa={from:(t)=>chain(t),rpc:async()=>({data:null,error:null}),
    functions:{invoke:async()=>({data:{ok:true},error:null})},
    auth:{getUser:async()=>({data:{user:{id:'u1'}},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
    channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:()=>{}};
  window.currentUser={id:'u1',email:'op@test',role:'admin',name:'Op Tester',initials:'OT'};

  // Hub renders the PRP section + tiles.
  const host=document.getElementById('cpg-gmp');
  window.glRenderGMPHub();
  const hubTxt=host?host.innerText:'';
  o.hubHasPRP=/PREREQUISITE PROGRAMS/i.test(hubTxt);
  o.hubHasCalibration=/Calibration/i.test(hubTxt);
  o.hubHasPest=/Pest Control/i.test(hubTxt);
  o.hubHasChemical=/Chemical/i.test(hubTxt);
  o.hubHasGlass=/Glass/i.test(hubTxt);
  o.hubHasWater=/Water/i.test(hubTxt);
  o.hubHasComplaint=/Complaint/i.test(hubTxt);
  // hub calls the single-form entry with the PRP code
  o.tileTargetsCode=/glOpenGMPRegister\('GMP-CAL-001'\)/.test(host?host.innerHTML:'');

  // Open the single-form PRP entry directly.
  await window.glOpenDailyGMP('GMP-CAL-001');
  await new Promise(r=>setTimeout(r,250));
  const ov=document.getElementById('gl-gmp-daily');
  o.entryOpened=!!ov;
  o.titleIsCalibration=!!ov && /CALIBRATION VERIFICATION/i.test(ov.innerText);
  const secs=ov?ov.querySelectorAll('.gl-gmp-sec'):[];
  o.onlyOneForm=secs.length===1;
  o.sectionOpenByDefault=!!ov && !!ov.querySelector('.gl-gmp-sec[open]');
  o.hasDateField=!!ov && !!ov.querySelector('.gl-gmp-sec[data-code="GMP-CAL-001"] input[type="date"][data-key="next_due"]');

  // Fill with a FAILING tolerance → deviation, then sign & save.
  const s=ov.querySelector('.gl-gmp-sec[data-code="GMP-CAL-001"]');
  s.querySelector('[data-key="instrument"]').value='Digital thermometer';
  s.querySelector('[data-key="reference"]').value='NIST ice point';
  s.querySelector('[data-key="tolerance_ok"]').value='fail';
  ov.querySelector('#gmp-h-operator').value='Op Tester';
  ov.querySelector('#gmp-save-sign').click();
  await new Promise(r=>setTimeout(r,300));

  const ins=window.__inserted;
  o.count=ins.length;
  o.oneRecord=ins.length===1;
  o.rightForm=ins.length===1 && ins[0].form_code==='GMP-CAL-001';
  o.deviationFlagged=ins.length===1 && ins[0].has_deviation===true;
  o.signed=ins.length===1 && ins[0].status==='signed' && ins[0].signed_by==='u1';
  return o;
},TEMPLATES);

rec('hub shows a Prerequisite Programs section', out.hubHasPRP);
rec('hub lists Calibration tile', out.hubHasCalibration);
rec('hub lists Pest Control tile', out.hubHasPest);
rec('hub lists Chemical tile', out.hubHasChemical);
rec('hub lists Glass tile', out.hubHasGlass);
rec('hub lists Water tile', out.hubHasWater);
rec('hub lists Complaint tile', out.hubHasComplaint);
rec('PRP tile opens its register', out.tileTargetsCode);
rec('single-form PRP entry opens', out.entryOpened);
rec('entry title is the PRP form title', out.titleIsCalibration);
rec('only the one PRP form shows (no daily fan-out)', out.onlyOneForm);
rec('the PRP section is open by default', out.sectionOpenByDefault);
rec('date field type renders', out.hasDateField);
rec('signing writes exactly ONE record', out.oneRecord, 'count='+out.count);
rec('record carries the PRP form_code', out.rightForm);
rec('failing tolerance flags a deviation', out.deviationFlagged);
rec('sign & save marks the record signed', out.signed);
rec('no fatal app error', appErrors.length===0, appErrors.slice(0,3).join(' | '));

await br.close(); srv.close();
let fails=0;
console.log('');
results.forEach(r=>{ if(r.ok){console.log('  PASS  '+r.n);} else {fails++;console.log('  FAIL  '+r.n+(r.d?'  — '+r.d:''));} });
console.log('\n'+results.length+' checks · '+(results.length-fails)+' passed · '+fails+' failed');
process.exit(fails?1:0);
})();
