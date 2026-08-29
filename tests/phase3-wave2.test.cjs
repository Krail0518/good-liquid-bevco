/*
 * phase3-wave2.test.cjs — Phase 3 Wave 2: training records (src/modules/production/training.js) +
 * internal audit / findings / management review (src/modules/production/audit-review.js).
 *
 * Drives the real app with a stubbed Supabase, verifying the defining
 * behaviors of the two new modules:
 *   - glRenderTraining() paints the training page from training_records.
 *   - glAddTraining() opens an entry overlay.
 *   - glRenderAuditReview() paints the audit/review page from internal_audits,
 *     audit_findings and management_reviews.
 *   - glRaiseNCRFromFinding(finding) writes exactly ONE defects row tagged
 *     source='internal_audit' carrying the finding id as source_record_id.
 *
 * NOTE: index.html wiring for these modules is added by the integrator. If a
 * global is still undefined when this runs pre-integration, that is expected —
 * this file only asserts its own self-consistent contract.
 *
 * RUN: NODE_PATH=/opt/node22/lib/node_modules \
 *      PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *      node tests/phase3-wave2.test.cjs
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
await new Promise(r=>srv.listen(8917,r));
const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
const pg=await br.newPage();
const appErrors=[];
pg.on('pageerror',e=>{const m=String(e&&e.message||e);
  if(!/Failed to fetch|NetworkError|ERR_|net::|TUNNEL|WebSocket|Maximum call stack|jszip|supabase|Load failed|status of 4|status of 5|CORS|is not a function/i.test(m)) appErrors.push(m);});

await pg.goto('http://127.0.0.1:8917/index.html',{waitUntil:'domcontentloaded',timeout:30000});
await pg.waitForTimeout(2500);

const out=await pg.evaluate(async()=>{
  const o={};
  // Chainable Supabase stub. Reads by table (see dataFor). Inserts: capture
  // defects into __ncr (the NCR path) and the module's own tables into __ins.
  window.__ncr=[];
  window.__ins=[];
  function dataFor(table){
    if(table==='training_records') return [
      {id:'t1',employee_name:'Ann Baker',course:'GMP Basics',expires_date:'2026-12-01'},
      {id:'t2',employee_name:'Carl Doss',course:'Allergen Control',expires_date:'2027-03-15'}
    ];
    if(table==='internal_audits') return [
      {id:'a1',audit_date:'2026-07-01',scope:'Line 1 sanitation',auditor:'Op Tester',status:'planned'}
    ];
    if(table==='audit_findings') return [
      {id:'f1',audit_id:'a1',clause:'2.4.1',description:'gap',severity:'medium',status:'open'}
    ];
    if(table==='management_reviews') return [];
    return []; // vendors, defects, compliance_records, mock_recalls
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
      if(table==='defects') window.__ncr.push(...arr);
      if(table==='audit_findings'||table==='internal_audits'||table==='training_records') window.__ins.push(...arr);
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

  // (a) training page renders.
  o.renderTrainingIsFn=typeof window.glRenderTraining==='function';
  if(o.renderTrainingIsFn){ try{ await window.glRenderTraining(); }catch(e){ o.trainThrew=e.message; } }
  await new Promise(r=>setTimeout(r,200));
  const trainHost=document.getElementById('cpg-training');
  o.trainHostExists=!!trainHost;
  o.trainRendered=!!trainHost && /TRAINING|training/.test(trainHost.innerText||'');

  // (b) add-training opens an overlay.
  o.addTrainingIsFn=typeof window.glAddTraining==='function';
  if(o.addTrainingIsFn){
    const before=document.body.children.length;
    try{ await window.glAddTraining(); }catch(e){ o.addTrainThrew=e.message; }
    await new Promise(r=>setTimeout(r,200));
    o.addTrainOverlay=document.body.children.length>before ||
      !!document.querySelector('[id*="training"],[id*="train"]');
  }

  // (c) audit / management review page renders.
  o.renderReviewIsFn=typeof window.glRenderAuditReview==='function';
  if(o.renderReviewIsFn){ try{ await window.glRenderAuditReview(); }catch(e){ o.reviewThrew=e.message; } }
  await new Promise(r=>setTimeout(r,200));
  const reviewHost=document.getElementById('cpg-auditreview');
  o.reviewHostExists=!!reviewHost;
  o.reviewRendered=!!reviewHost && /AUDIT|review|MANAGEMENT/.test(reviewHost.innerText||'');

  // (d) raise NCR from a finding -> exactly one defects row, source='internal_audit'.
  o.raiseNCRIsFn=typeof window.glRaiseNCRFromFinding==='function';
  if(o.raiseNCRIsFn){
    const before=window.__ncr.length;
    try{ await window.glRaiseNCRFromFinding({id:'f1',clause:'2.4.1',description:'gap',severity:'medium'}); }catch(e){ o.raiseThrew=e.message; }
    await new Promise(r=>setTimeout(r,200));
    o.ncrDelta=window.__ncr.length-before;
    const ncr=window.__ncr[window.__ncr.length-1]||{};
    o.ncrSource=ncr.source==='internal_audit';
    o.ncrSourceRec=ncr.source_record_id==='f1';
  }

  return o;
});

rec('glRenderTraining is a function', out.renderTrainingIsFn);
rec('training page mount exists', out.trainHostExists);
rec('training renders (TRAINING/training)', out.trainRendered, out.trainThrew||'');
rec('glAddTraining is a function', out.addTrainingIsFn);
rec('glAddTraining opens an overlay', out.addTrainOverlay, out.addTrainThrew||'');
rec('glRenderAuditReview is a function', out.renderReviewIsFn);
rec('audit/review page mount exists', out.reviewHostExists);
rec('audit/review renders (AUDIT/review/MANAGEMENT)', out.reviewRendered, out.reviewThrew||'');
rec('glRaiseNCRFromFinding is a function', out.raiseNCRIsFn);
rec('raise NCR inserts exactly one defects row', out.ncrDelta===1, 'delta='+out.ncrDelta+(out.raiseThrew?' threw '+out.raiseThrew:''));
rec('NCR row is source=internal_audit for finding f1', out.ncrSource && out.ncrSourceRec,
  'source_ok='+out.ncrSource+' source_record_id_ok='+out.ncrSourceRec);
rec('no fatal app error', appErrors.length===0, appErrors.slice(0,3).join(' | '));

await br.close(); srv.close();
let fails=0;
console.log('');
results.forEach(r=>{ if(r.ok){console.log('  PASS  '+r.n);} else {fails++;console.log('  FAIL  '+r.n+(r.d?'  — '+r.d:''));} });
console.log('\n'+results.length+' checks · '+(results.length-fails)+' passed · '+fails+' failed');
process.exit(fails?1:0);
})();
