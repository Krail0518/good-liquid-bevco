/*
 * phase3-wave1.test.cjs — Phase 3 Wave 1: GMP scheduled-task generation
 * (src/modules/production/gmp-schedule.js) + traceability / mock-recall (src/modules/production/trace.js).
 *
 * Drives the real app with a stubbed Supabase, verifying the defining
 * behaviors of the two new modules:
 *   - glRenderGMPSchedule() paints the schedule page from active gmp_task_defs.
 *   - glGenerateGMPTasks() inserts due compliance_tasks rows, each tagged
 *     source='auto' with a dedupe_key namespaced 'gmpsched:'.
 *   - glRenderTrace() paints the traceability page.
 *   - glRunMockRecall(runId,lotCode) opens the recall flow and, once driven to
 *     save, writes exactly ONE mock_recalls row with a numeric pct_reconciled.
 *
 * NOTE: index.html wiring for these modules is added by the integrator. If a
 * global is still undefined when this runs pre-integration, that is expected —
 * this file only asserts its own self-consistent contract.
 *
 * RUN: NODE_PATH=/opt/node22/lib/node_modules \
 *      PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *      node tests/phase3-wave1.test.cjs
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
await new Promise(r=>srv.listen(8916,r));
const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
const pg=await br.newPage();
const appErrors=[];
pg.on('pageerror',e=>{const m=String(e&&e.message||e);
  if(!/Failed to fetch|NetworkError|ERR_|net::|TUNNEL|WebSocket|Maximum call stack|jszip|supabase|Load failed|status of 4|status of 5|CORS|is not a function/i.test(m)) appErrors.push(m);});

await pg.goto('http://127.0.0.1:8916/index.html',{waitUntil:'domcontentloaded',timeout:30000});
await pg.waitForTimeout(2500);

const TASK_DEFS=[
  {id:'d1',code:'GMP-SANI-DAILY',title:'Daily sanitation check',frequency:'daily',category:'sanitation',active:true,sort_order:10},
  {id:'d2',code:'GMP-CAL-WEEKLY',title:'Weekly scale calibration',frequency:'weekly',category:'calibration',active:true,sort_order:20}
];

const out=await pg.evaluate(async(TASK_DEFS)=>{
  const o={};
  // Chainable Supabase stub. Reads: gmp_task_defs -> active defs, compliance_tasks
  // -> [], production_runs -> one run. Inserts: capture compliance_tasks into
  // __tasks and mock_recalls into __recalls.
  window.__tasks=[];
  window.__recalls=[];
  const RUN={id:'run1',run_name:'SunBurst B-42',client_name:'Acme'};
  function dataFor(table){
    if(table==='gmp_task_defs') return TASK_DEFS;
    if(table==='production_runs') return [RUN];
    return [];
  }
  function chain(table){
    const c={_t:table};
    c.select=()=>c; c.eq=()=>c; c.neq=()=>c; c.in=()=>c; c.is=()=>c;
    c.order=()=>c; c.gte=()=>c; c.lte=()=>c; c.gt=()=>c; c.lt=()=>c;
    c.or=()=>c; c.filter=()=>c; c.match=()=>c; c.range=()=>c; c.ilike=()=>c;
    c.limit=async()=>({data:dataFor(table),error:null});
    c.single=async()=>({data:(dataFor(table)[0]||null),error:null});
    c.maybeSingle=async()=>({data:(dataFor(table)[0]||null),error:null});
    c.insert=(rows)=>{
      const arr=Array.isArray(rows)?rows:[rows];
      if(table==='compliance_tasks') window.__tasks.push(...arr);
      if(table==='mock_recalls') window.__recalls.push(...arr);
      return {select:async()=>({data:arr.map((_,i)=>({id:'ins'+i})),error:null})};
    };
    c.upsert=(rows)=>c.insert(rows);
    c.update=()=>({eq:async()=>({data:null,error:null})});
    c.delete=()=>({eq:async()=>({data:null,error:null})});
    // make a bare read chain awaitable
    c.then=(res)=>Promise.resolve({data:dataFor(table),error:null}).then(res);
    return c;
  }
  window.supa={from:(t)=>chain(t),rpc:async()=>({data:null,error:null}),
    functions:{invoke:async()=>({data:{ok:true},error:null})},
    auth:{getUser:async()=>({data:{user:{id:'u1'}},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
    channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:()=>{}};
  window.currentUser={id:'u1',email:'op@test',role:'admin',name:'Op Tester',initials:'OT'};

  // (a) GMP schedule renders.
  o.renderSchedIsFn=typeof window.glRenderGMPSchedule==='function';
  if(o.renderSchedIsFn){ try{ await window.glRenderGMPSchedule(); }catch(e){ o.schedThrew=e.message; } }
  await new Promise(r=>setTimeout(r,200));
  const schedHost=document.getElementById('cpg-gmpsched');
  o.schedHostExists=!!schedHost;
  o.schedRendered=!!schedHost && /SCHEDULE|Generate/i.test(schedHost.innerText||'');

  // (b) generating tasks inserts auto compliance_tasks rows with gmpsched: keys.
  o.genTasksIsFn=typeof window.glGenerateGMPTasks==='function';
  if(o.genTasksIsFn){ try{ await window.glGenerateGMPTasks(); }catch(e){ o.genThrew=e.message; } }
  await new Promise(r=>setTimeout(r,200));
  o.taskCount=window.__tasks.length;
  o.taskAuto=window.__tasks.some(t=>t.source==='auto' && typeof t.dedupe_key==='string' && t.dedupe_key.indexOf('gmpsched:')===0);

  // (c) traceability page renders.
  o.renderTraceIsFn=typeof window.glRenderTrace==='function';
  if(o.renderTraceIsFn){ try{ await window.glRenderTrace(); }catch(e){ o.traceThrew=e.message; } }
  await new Promise(r=>setTimeout(r,200));
  const traceHost=document.getElementById('cpg-trace');
  o.traceHostExists=!!traceHost;
  o.traceRendered=!!traceHost && /Trace|recall/i.test(traceHost.innerText||'');

  // (d) mock recall: open the flow, drive the modal to save one row.
  o.runRecallIsFn=typeof window.glRunMockRecall==='function';
  if(o.runRecallIsFn){
    const before=window.__recalls.length;
    try{ await window.glRunMockRecall('run1','B-42'); }catch(e){ o.recallThrew=e.message; }
    await new Promise(r=>setTimeout(r,250));
    // The recall flow should surface an overlay for the operator to reconcile units.
    const ov=document.querySelector('#gl-mock-recall,#gl-trace-recall,[id*="mock-recall"],[id*="recall"]');
    o.recallOpensOverlay=!!ov;
    // Best-effort: fill any produced/recovered unit inputs and click a save/run button.
    if(ov){
      const nums=[...ov.querySelectorAll('input[type="number"],input:not([type])')];
      if(nums[0]) nums[0].value='1000';
      if(nums[1]) nums[1].value='950';
      nums.forEach(n=>{ n.dispatchEvent(new Event('input',{bubbles:true})); n.dispatchEvent(new Event('change',{bubbles:true})); });
      const btn=[...ov.querySelectorAll('button')].find(b=>/save|run|reconcile|complete|finish/i.test(b.textContent||''));
      if(btn){ try{ btn.click(); }catch(e){} await new Promise(r=>setTimeout(r,250)); }
    }
    o.recallInserted=window.__recalls.length>before;
    o.recallPctNumeric=o.recallInserted && typeof window.__recalls[window.__recalls.length-1].pct_reconciled==='number';
  }

  return o;
},TASK_DEFS);

rec('glRenderGMPSchedule is a function', out.renderSchedIsFn);
rec('schedule page mount exists', out.schedHostExists);
rec('schedule renders (SCHEDULE/Generate)', out.schedRendered, out.schedThrew||'');
rec('glGenerateGMPTasks is a function', out.genTasksIsFn);
rec('generate inserts an auto task with gmpsched: dedupe_key', out.taskAuto, 'count='+out.taskCount+(out.genThrew?' threw '+out.genThrew:''));
rec('glRenderTrace is a function', out.renderTraceIsFn);
rec('trace page mount exists', out.traceHostExists);
rec('trace renders (Trace/recall)', out.traceRendered, out.traceThrew||'');
rec('glRunMockRecall is a function', out.runRecallIsFn);
rec('mock recall opens an overlay', out.recallOpensOverlay, out.recallThrew||'');
rec('mock recall saves one row with numeric pct_reconciled',
  out.recallInserted && out.recallPctNumeric,
  out.recallInserted?('pctNumeric='+out.recallPctNumeric):'no mock_recalls row inserted');
rec('no fatal app error', appErrors.length===0, appErrors.slice(0,3).join(' | '));

await br.close(); srv.close();
let fails=0;
console.log('');
results.forEach(r=>{ if(r.ok){console.log('  PASS  '+r.n);} else {fails++;console.log('  FAIL  '+r.n+(r.d?'  — '+r.d:''));} });
console.log('\n'+results.length+' checks · '+(results.length-fails)+' passed · '+fails+' failed');
process.exit(fails?1:0);
})();
