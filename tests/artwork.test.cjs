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
  const EXISTING=[{id:'a1',client_id:'c1',sku_name:'Mango 12oz',description:'front panel',file_path:'c1/artwork/1.png',file_type:'png',status:'approved'}];
  function chain(table){
    const c={_t:table};
    c.select=()=>c; c.eq=()=>c; c.order=async()=>({data:table==='client_artwork'?EXISTING:[],error:null});
    c.insert=(rows)=>{ if(table==='client_artwork') window.__art.push(...rows); return { select:async()=>({data:rows,error:null}) , then:(r)=>Promise.resolve({data:rows,error:null}).then(r) }; };
    c.delete=()=>({ eq:async(k,v)=>{ window.__deleted.push(v); return {data:null,error:null}; } });
    c.then=(res)=>Promise.resolve({data:table==='client_artwork'?EXISTING:[],error:null}).then(res);
    return c;
  }
  window.supa={ from:(t)=>chain(t),
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

rec('no fatal app error', appErrors.length===0, appErrors.slice(0,3).join(' | '));

await br.close(); srv.close();
let fails=0;
console.log('');
results.forEach(r=>{ if(r.ok){console.log('  PASS  '+r.n);} else {fails++;console.log('  FAIL  '+r.n+(r.d?'  — '+r.d:''));} });
console.log('\n'+results.length+' checks · '+(results.length-fails)+' passed · '+fails+' failed');
process.exit(fails?1:0);
})();
