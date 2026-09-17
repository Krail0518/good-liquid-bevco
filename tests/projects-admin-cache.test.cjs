/*
 * projects-admin-cache.test.cjs — milestone edits reach Preview and new rounds
 * (GL-124, independent review R6).
 *
 * The reviewer's reproduction: change a milestone's target date Oct 1 → Nov 1
 * and its owner Good Liquid → Client, both saved successfully; "Preview as
 * client" still rendered Oct 1 and Good Liquid, and "Add new round" copied the
 * old owner. The save handlers never updated the in-memory cache those read.
 *
 * Drives the real page: index.html, the real action dispatcher (change events
 * on the real date input and owner select), projects-admin.js and the portal
 * renderers. Only PostgREST is stubbed, and it answers with the persisted row,
 * or refuses, as the database would.
 *
 * RUN: node tests/projects-admin-cache.test.cjs   (needs playwright)
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
pg.on('dialog', d=>d.accept());

await pg.goto('http://127.0.0.1:8921/index.html',{waitUntil:'domcontentloaded',timeout:30000});
await pg.waitForTimeout(1200);

await pg.evaluate(()=>{
  const MS=[
    {id:'m-sample',project_id:'p1',track:'formulation',key:'sample_sent',label:'Sample sent',sort_order:3,round:1,status:'in_progress',owner:'gl',target_date:'2026-10-01',completed_at:null,client_note:null},
    {id:'m-feedback',project_id:'p1',track:'formulation',key:'client_feedback',label:'Client feedback',sort_order:4,round:1,status:'not_started',owner:'client',target_date:null,completed_at:null,client_note:null},
    {id:'m-revise',project_id:'p1',track:'formulation',key:'formula_revisions',label:'Formula revisions',sort_order:5,round:1,status:'not_started',owner:'gl',target_date:null,completed_at:null,client_note:null},
  ];
  window.__db = { ms: MS.map(m=>Object.assign({},m)), inserts: [], mode: 'ok' };
  function chain(table){
    const st={table, patch:null, id:null};
    const c={};
    c.select=()=>c; c.in=()=>c; c.is=()=>c;
    c.eq=(k,v)=>{ if(k==='id') st.id=v; return c; };
    c.order=async()=>{
      if(table==='projects') return {data:[{id:'p1',name:'Mango Seltzer',product_name:null,status:'active',started_on:null,target_date:null,archived_at:null}],error:null};
      if(table==='project_milestones') return {data:window.__db.ms.map(m=>Object.assign({},m)),error:null};
      return {data:[],error:null};
    };
    c.update=(patch)=>{ st.patch=patch; return {
      eq:(k,v)=>{ st.id=v; return { select:async()=>{
        if(window.__db.mode==='refuse') return {data:[],error:null};
        if(window.__db.mode==='error') return {data:null,error:{message:'permission denied'}};
        const row=window.__db.ms.find(m=>m.id===st.id); Object.assign(row, st.patch);
        return {data:[Object.assign({},row)],error:null};
      }}; } }; };
    c.insert=(rows)=>({ select:async()=>{ window.__db.inserts.push(...rows); return {data:rows.map((r,i)=>({id:'new'+i})),error:null}; } });
    return c;
  }
  window.supa={ from:(t)=>chain(t), rpc:async()=>({data:[],error:null}),
    storage:{from:()=>({})}, auth:{getUser:async()=>({data:{user:{id:'u1'}}}),getSession:async()=>({data:{session:null}})} };
  window.currentUser={id:'u1',role:'admin',name:'Admin'};
  const host=document.createElement('div'); host.id='gl-ec-projects'; document.body.appendChild(host);
  // Record what Preview hands the portal renderer.
  const realTracker=window.glPortalMilestoneTracker;
  window.glPortalMilestoneTracker=function(ms){ window.__previewMs=JSON.parse(JSON.stringify(ms)); return realTracker?realTracker(ms):''; };
});

rec('projects-admin and portal renderers are loaded', await pg.evaluate(()=>typeof window.glRenderProjects==='function' && typeof window.glProjectPreviewAsClient==='function'));

await pg.evaluate(async()=>{ await window.glRenderProjects(document.getElementById('gl-ec-projects'), {clientId:'c1'}); });
await pg.waitForTimeout(200);

async function setControl(action, id, value){
  await pg.evaluate(({action,id,value})=>{
    const el=[...document.querySelectorAll('[data-gl-action="'+action+'"]')].find(x=>x.getAttribute('data-gl-arg1')===id);
    el.value=value; el.dispatchEvent(new Event('change',{bubbles:true}));
  },{action,id,value});
  await pg.waitForTimeout(250);
}
const controlValue=(action,id)=>pg.evaluate(({action,id})=>{
  const el=[...document.querySelectorAll('[data-gl-action="'+action+'"]')].find(x=>x.getAttribute('data-gl-arg1')===id); return el&&el.value; },{action,id});

// ── The reviewer's case ──────────────────────────────────────────────────────
await setControl('glMilestoneSetTarget','m-sample','2026-11-01');
await setControl('glMilestoneSetOwner','m-sample','client');
rec('the saves reached the database stub (Nov 1, Client)', await pg.evaluate(()=>{const m=window.__db.ms.find(x=>x.id==='m-sample'); return m.target_date==='2026-11-01' && m.owner==='client';}));

await pg.evaluate(()=>window.glProjectPreviewAsClient('p1','c1'));
await pg.waitForTimeout(200);
const pv=await pg.evaluate(()=>(window.__previewMs||[]).find(m=>m.id==='m-sample')||null);
rec('R6 Preview as client, immediately after saving, uses Nov 1 (not Oct 1)', pv && pv.target_date==='2026-11-01', JSON.stringify(pv));
rec('R6 Preview as client, immediately after saving, uses owner Client (not Good Liquid)', pv && pv.owner==='client', JSON.stringify(pv));
await pg.evaluate(()=>{ const o=document.getElementById('gl-proj-preview'); if(o) o.remove(); });

await pg.evaluate(async()=>{ await window.glMilestoneNewRound('p1','c1'); });
await pg.waitForTimeout(300);
const round2=await pg.evaluate(()=>window.__db.inserts.find(r=>r.key==='sample_sent')||null);
rec('R6 Add new round without closing the panel copies the SAVED owner (Client)', round2 && round2.owner==='client' && round2.round===2, JSON.stringify(round2));

// ── Refused and failed writes ────────────────────────────────────────────────
await pg.evaluate(async()=>{ window.__db.inserts=[]; await window.glRenderProjects(document.getElementById('gl-ec-projects'), {clientId:'c1'}); });
await pg.waitForTimeout(200);
await pg.evaluate(()=>{ window.__db.mode='refuse'; });
await setControl('glMilestoneSetTarget','m-feedback','2026-12-24');
await setControl('glMilestoneSetOwner','m-feedback','gl');
rec('R6 a refused date save puts the control back to the saved value', (await controlValue('glMilestoneSetTarget','m-feedback'))==='', await controlValue('glMilestoneSetTarget','m-feedback'));
rec('R6 a refused owner save puts the control back to the saved owner', (await controlValue('glMilestoneSetOwner','m-feedback'))==='client', await controlValue('glMilestoneSetOwner','m-feedback'));
await pg.evaluate(()=>window.glProjectPreviewAsClient('p1','c1'));
await pg.waitForTimeout(200);
const pv2=await pg.evaluate(()=>(window.__previewMs||[]).find(m=>m.id==='m-feedback')||null);
rec('R6 after a refused save, Preview still shows the saved values', pv2 && pv2.target_date===null && pv2.owner==='client', JSON.stringify(pv2));
await pg.evaluate(()=>{ const o=document.getElementById('gl-proj-preview'); if(o) o.remove(); });

await pg.evaluate(()=>{ window.__db.mode='error'; });
await setControl('glMilestoneSetOwner','m-revise','client');
rec('R6 an erroring owner save puts the control back and says why',
  (await controlValue('glMilestoneSetOwner','m-revise'))==='gl' &&
  await pg.evaluate(()=>/permission denied/.test((document.getElementById('gl-proj-msg')||{}).textContent||'')));

rec('no fatal app error', appErrors.length===0, appErrors.slice(0,3).join(' | '));

await br.close(); srv.close();
let fails=0;
console.log('');
results.forEach(r=>{ if(r.ok){console.log('  PASS  '+r.n);} else {fails++;console.log('  FAIL  '+r.n+(r.d?'  — '+r.d:''));} });
console.log('\n'+results.length+' checks · '+(results.length-fails)+' passed · '+fails+' failed');
process.exit(fails?1:0);
})();
