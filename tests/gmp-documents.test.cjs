/*
 * gmp-documents.test.cjs — the GMP Documents library (crm-gmp.js).
 * Drives the real hub + documents overlay with a stubbed Supabase, verifying:
 * the hub renders a "Documents" tile, glOpenGMPDocuments() opens an overlay
 * (#gl-gmp-docs) that lists the active gmp_documents rows, and each document
 * renders as a download anchor whose href equals the row's file_url.
 *
 * RUN: NODE_PATH=/opt/node22/lib/node_modules \
 *      PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node tests/gmp-documents.test.cjs
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
await new Promise(r=>srv.listen(8914,r));
const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
const pg=await br.newPage();
const appErrors=[];
pg.on('pageerror',e=>{const m=String(e&&e.message||e);
  if(!/Failed to fetch|NetworkError|ERR_|net::|TUNNEL|WebSocket|Maximum call stack|jszip|supabase|Load failed|status of 4|status of 5|CORS|is not a function/i.test(m)) appErrors.push(m);});

await pg.goto('http://127.0.0.1:8914/index.html',{waitUntil:'domcontentloaded',timeout:30000});
await pg.waitForTimeout(2500);

const DOCS=[
  {doc_code:'DOC-SOP-SUPP',title:'GMP SOP Supplement',category:'SOP',description:'SOPs',file_url:'/docs/GMP-SOP-Supplement.docx',file_type:'docx',rev:'1.0',sort_order:10,active:true},
  {doc_code:'DOC-REGISTERS',title:'GMP Registers (blank templates)',category:'Registers',description:'Registers',file_url:'/docs/GMP-Registers.xlsx',file_type:'xlsx',rev:'1.0',sort_order:20,active:true},
  {doc_code:'DOC-LACF',title:'LACF / Acidified Foods Regulatory Guide',category:'Regulatory',description:'Guide',file_url:'/docs/LACF-Acidified-Regulatory-Guide.docx',file_type:'docx',rev:'1.0',sort_order:30,active:true}
];

const out=await pg.evaluate(async(DOCS)=>{
  const o={};
  // Chainable stub; resolves DOCS for gmp_documents via both `then` and `.limit`.
  function chain(table){
    const c={_t:table};
    c.select=()=>c; c.order=()=>c; c.eq=()=>c; c.in=()=>c;
    c.limit=async()=>({data:table==='gmp_documents'?DOCS:[],error:null});
    c.maybeSingle=async()=>({data:null,error:null});
    c.insert=(rows)=>({select:async()=>({data:(rows||[]).map((_,i)=>({id:'r'+i})),error:null})});
    c.then=(res)=>Promise.resolve({data:table==='gmp_documents'?DOCS:[],error:null}).then(res);
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
  o.hubHasDocuments=/Documents/i.test(host?host.innerText:'');

  // Open the documents overlay.
  await window.glOpenGMPDocuments();
  await new Promise(r=>setTimeout(r,250));
  const ov=document.getElementById('gl-gmp-docs');
  o.docsOpened=!!ov;
  o.text=ov?ov.innerText:'';
  const anchors=ov?Array.from(ov.querySelectorAll('a[download]')):[];
  o.anchorCount=anchors.length;
  o.hrefs=anchors.map(a=>a.getAttribute('href'));
  return o;
},DOCS);

const titles=DOCS.map(d=>d.title);
const allTitles=out.docsOpened && titles.every(t=>(out.text||'').includes(t));
const wanted=DOCS.map(d=>d.file_url);
const hrefs=out.hrefs||[];
const allHrefs=out.docsOpened && wanted.every(u=>hrefs.some(h=>h && h.endsWith(u)));

rec('hub shows a Documents tile', out.hostExists && out.hubHasDocuments);
rec('documents overlay opens (gl-gmp-docs exists)', out.docsOpened);
rec('all 3 document titles appear in the overlay', allTitles);
rec('exactly 3 download anchors', out.anchorCount===3, 'count='+out.anchorCount);
rec('each file_url present among anchor hrefs', allHrefs, 'hrefs='+hrefs.join(','));
rec('no fatal app error', appErrors.length===0, appErrors.slice(0,3).join(' | '));

await br.close(); srv.close();
let fails=0;
console.log('');
results.forEach(r=>{ if(r.ok){console.log('  PASS  '+r.n);} else {fails++;console.log('  FAIL  '+r.n+(r.d?'  — '+r.d:''));} });
console.log('\n'+results.length+' checks · '+(results.length-fails)+' passed · '+fails+' failed');
process.exit(fails?1:0);
})();
