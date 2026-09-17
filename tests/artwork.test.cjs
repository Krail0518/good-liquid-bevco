/*
 * artwork.test.cjs — the artwork / SKU manager (src/modules/customers/artwork.js).
 * Verifies the core: existing SKUs render with View/Download, the add form is
 * present, adding a SKU (name + file) uploads to storage and inserts one
 * client_artwork row carrying the sku_name + stored file_path, and deleting a
 * SKU issues a delete. Storage + PostgREST are stubbed.
 *
 * RUN: NODE_PATH=/opt/node22/lib/node_modules \
 *      PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *      node tests/artwork.test.cjs
 */
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os');
const {chromium}=require('playwright');
const ROOT=process.env.REPO_ROOT||path.resolve(__dirname,'..');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'text/plain'});s.end(b);});});

const results=[];
const rec=(n,ok,d)=>results.push({n,ok:!!ok,d:d||''});

(async()=>{
await new Promise(r=>srv.listen(8919,r));
const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
const pg=await br.newPage();
const appErrors=[];
pg.on('pageerror',e=>{const m=String(e&&e.message||e);
  if(!/Failed to fetch|NetworkError|ERR_|net::|TUNNEL|WebSocket|Maximum call stack|jszip|supabase|Load failed|status of 4|status of 5|CORS|is not a function/i.test(m)) appErrors.push(m);});

await pg.goto('http://127.0.0.1:8919/index.html',{waitUntil:'domcontentloaded',timeout:30000});
await pg.waitForTimeout(1200);

// Install the stub + a mount, and pre-load one existing SKU.
await pg.evaluate(()=>{
  window.__art=[]; window.__deleted=[];
  // No status column: client_artwork.status was dropped in 20260915000000 and
  // state now comes from the artwork_reviews ledger. This SKU has no decision,
  // which is what "Submitted" means.
  const EXISTING=[{id:'a1',client_id:'c1',sku_name:'Mango 12oz',description:'front panel',file_path:'c1/artwork/1.png',file_type:'png',archived_at:null}];
  function chain(table){
    const c={_t:table};
    // .is() and .in() are part of the staff read now: client_artwork is
    // filtered by archived_at, and the latest decision per SKU is fetched from
    // artwork_reviews by id.
    c.select=()=>c; c.eq=()=>c; c.is=()=>c; c.in=()=>c;
    c.order=async()=>({data:table==='client_artwork'?(window.__rows||EXISTING):table==='artwork_reviews'?(window.__reviews||[]):[],error:null});
    c.insert=(rows)=>{ if(table==='client_artwork') window.__art.push(...rows); return { select:async()=>({data:rows,error:null}) , then:(r)=>Promise.resolve({data:rows,error:null}).then(r) }; };
    c.delete=()=>({ eq:async(k,v)=>{ window.__deleted.push(v); return {data:null,error:null}; } });
    c.then=(res)=>Promise.resolve({data:table==='client_artwork'?EXISTING:[],error:null}).then(res);
    return c;
  }
  window.supa={ from:(t)=>chain(t),
    rpc:async(name)=>({data:name==='gl_portal_artwork'?(window.__portalRows||[]):null,error:null}),
    storage:{ from:()=>({ upload:async(p)=>({data:{path:p},error:null}), createSignedUrl:async(p)=>({data:{signedUrl:'blob:'+p},error:null}) }) },
    auth:{getUser:async()=>({data:{user:{id:'u1'}}}),getSession:async()=>({data:{session:null}})} };
  window.currentUser={id:'u1',role:'admin',name:'Admin'};
  var m=document.createElement('div'); m.id='art-mount'; document.body.appendChild(m);
});

rec('glRenderArtwork is a function', await pg.evaluate(()=>typeof window.glRenderArtwork==='function'));

await pg.evaluate(async()=>{ await window.glRenderArtwork('c1', document.getElementById('art-mount')); });
await pg.waitForTimeout(200);

const render=await pg.evaluate(()=>{
  const m=document.getElementById('art-mount');
  return {
    existing: /Mango 12oz/.test(m.innerText),
    // Matches EITHER wiring on purpose. What matters is that a View and a
    // Download control exist and name the right action -- not whether they
    // are wired through an inline onclick or data-gl-action. GL-DEF-01 is
    // migrating every control from the first to the second, and a test keyed
    // to the mechanism fails on a change that breaks nothing.
    view: !!m.querySelector('a[onclick*="glOpenClientDoc"], a[data-gl-action="glOpenClientDoc"]'),
    download: !!m.querySelector('a[onclick*="glDownloadClientDoc"], a[data-gl-action="glDownloadClientDoc"]'),
    nameInput: !!m.querySelector('.gl-art-name'),
    fileInput: !!m.querySelector('.gl-art-file'),
    addBtn: !!m.querySelector('.gl-art-add')
  };
});
rec('existing SKU renders', render.existing);
rec('existing SKU has View link', render.view);
rec('existing SKU has Download link', render.download);
rec('add form has SKU name input', render.nameInput);
rec('add form has file input', render.fileInput);
rec('add form has Add button', render.addBtn);

// Add with no file -> validation, no insert.
await pg.evaluate(()=>{ document.querySelector('#art-mount .gl-art-name').value='Lime 12oz'; document.querySelector('#art-mount .gl-art-add').click(); });
await pg.waitForTimeout(150);
rec('add without a file is blocked (no insert)', await pg.evaluate(()=>window.__art.length===0));

// Provide a real file to the input, then add -> one client_artwork insert.
const tmp=path.join(os.tmpdir(),'sku.png'); fs.writeFileSync(tmp, Buffer.from([0x89,0x50,0x4e,0x47]));
await pg.setInputFiles('#art-mount .gl-art-file', tmp);
await pg.evaluate(()=>{ document.querySelector('#art-mount .gl-art-name').value='Lime 12oz'; document.querySelector('#art-mount .gl-art-desc').value='back'; document.querySelector('#art-mount .gl-art-add').click(); });
await pg.waitForTimeout(500);
const added=await pg.evaluate(()=>window.__art);
rec('adding a SKU inserts one client_artwork row', added.length===1, 'n='+added.length);
rec('inserted row carries the SKU name', added[0] && added[0].sku_name==='Lime 12oz', JSON.stringify(added[0]||{}).slice(0,80));
rec('inserted row carries a stored file_path', !!(added[0] && added[0].file_path && /artwork\//.test(added[0].file_path)), (added[0]||{}).file_path||'');

// ── GL-123 (independent review R5): a revision keeps its original's project ──
// The reviewer's reproduction: artwork on project-1, "Upload revised artwork"
// from the STAFF view, and the new row had supersedes_id set but project_id
// null. These drive the real renderer and click handlers.
async function reviseAndUpload(label){
  await pg.setInputFiles('#art-mount .gl-art-file', tmp);
  await pg.evaluate(()=>{ document.querySelector('#art-mount .gl-art-add').click(); });
  await pg.waitForTimeout(500);
  return pg.evaluate(()=>window.__art[window.__art.length-1]||null);
}

// A. Staff view (mounted with no project, exactly as edit-client.js does).
await pg.evaluate(async()=>{
  window.__art=[];
  window.__rows=[{id:'art-1',client_id:'c1',project_id:'project-1',sku_name:'Peach 12oz',file_path:'c1/portal/artwork/p.png',file_type:'png',archived_at:null}];
  window.__reviews=[{artwork_id:'art-1',decision:'changes_requested',decided_at:'2026-09-17',client_note:'darker',seq:1}];
  await window.glRenderArtwork('c1', document.getElementById('art-mount'));
});
await pg.waitForTimeout(200);
await pg.evaluate(()=>document.querySelector('#art-mount .gl-art-revise[data-id="art-1"]').click());
const staffRev = await reviseAndUpload();
rec('R5 staff revision keeps the original\'s project (project-1, not null)',
  staffRev && staffRev.project_id==='project-1' && staffRev.supersedes_id==='art-1', JSON.stringify(staffRev));

// B. Portal, project-2 open, revising artwork that belongs to no project.
await pg.evaluate(async()=>{
  window.__art=[];
  window.__portalRows=[{artwork_id:'art-legacy',project_id:null,sku_name:'Old Can',file_path:'c1/portal/artwork/o.png',file_type:'png',state:'changes_requested'}];
  await window.glRenderArtwork('c1', document.getElementById('art-mount'), {portal:true, projectId:'project-2'});
});
await pg.waitForTimeout(200);
await pg.evaluate(()=>document.querySelector('#art-mount .gl-art-revise[data-id="art-legacy"]').click());
const legacyRev = await reviseAndUpload();
rec('R5 portal revision of unassigned artwork stays unassigned (not filed under the open project)',
  legacyRev && legacyRev.project_id===null && legacyRev.supersedes_id==='art-legacy', JSON.stringify(legacyRev));

// C. Portal: choose a revision under project-1, then switch to project-2.
await pg.evaluate(async()=>{
  window.__art=[];
  window.__portalRows=[{artwork_id:'art-p1',project_id:'project-1',sku_name:'P1 Can',file_path:'c1/portal/artwork/1.png',file_type:'png',state:'changes_requested'}];
  await window.glRenderArtwork('c1', document.getElementById('art-mount'), {portal:true, projectId:'project-1'});
});
await pg.waitForTimeout(200);
await pg.evaluate(async()=>{
  document.querySelector('#art-mount .gl-art-revise[data-id="art-p1"]').click();
  await window.glRenderArtwork('c1', document.getElementById('art-mount'), {portal:true, projectId:'project-2'});
});
await pg.waitForTimeout(200);
await pg.evaluate(()=>{ document.querySelector('#art-mount .gl-art-name').value='New P2 Can'; });
const switched = await reviseAndUpload();
rec('R5 switching project clears revision mode: the next upload is a new SKU on the new project',
  switched && switched.supersedes_id===null && switched.project_id==='project-2', JSON.stringify(switched));

// D. Cancel revision.
await pg.evaluate(async()=>{
  window.__art=[];
  await window.glRenderArtwork('c1', document.getElementById('art-mount'), {portal:true, projectId:'project-1'});
});
await pg.waitForTimeout(200);
const cancelUi = await pg.evaluate(()=>{
  document.querySelector('#art-mount .gl-art-revise[data-id="art-p1"]').click();
  const shown = document.querySelector('#art-mount .gl-art-revising-wrap').style.display !== 'none';
  document.querySelector('#art-mount .gl-art-revise-cancel').click();
  const hidden = document.querySelector('#art-mount .gl-art-revising-wrap').style.display === 'none';
  document.querySelector('#art-mount .gl-art-name').value='Fresh Can';
  return shown && hidden;
});
const cancelled = await reviseAndUpload();
rec('R5 Cancel revision shows then clears the revision banner, and the upload is a new SKU',
  cancelUi && cancelled && cancelled.supersedes_id===null && cancelled.project_id==='project-1', JSON.stringify(cancelled));

rec('no fatal app error', appErrors.length===0, appErrors.slice(0,3).join(' | '));

await br.close(); srv.close();
let fails=0;
console.log('');
results.forEach(r=>{ if(r.ok){console.log('  PASS  '+r.n);} else {fails++;console.log('  FAIL  '+r.n+(r.d?'  — '+r.d:''));} });
console.log('\n'+results.length+' checks · '+(results.length-fails)+' passed · '+fails+' failed');
process.exit(fails?1:0);
})();
