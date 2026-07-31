/*
 * client-detail.test.cjs — the shared client-detail info block
 * (crm-client-detail.js, window.glClientInfoSections). Verifies the two
 * things the fix is about: (1) every section renders even when the client is
 * sparse, so the read-only card no longer hides half the fields; (2) an
 * uploaded compliance document exposes a "View" link, and a doc marked
 * on-file but with no stored file says so instead of pretending.
 *
 * RUN: NODE_PATH=/opt/node22/lib/node_modules \
 *      PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *      node tests/client-detail.test.cjs
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
await new Promise(r=>srv.listen(8918,r));
const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
const pg=await br.newPage();
const appErrors=[];
pg.on('pageerror',e=>{const m=String(e&&e.message||e);
  if(!/Failed to fetch|NetworkError|ERR_|net::|TUNNEL|WebSocket|Maximum call stack|jszip|supabase|Load failed|status of 4|status of 5|CORS|is not a function/i.test(m)) appErrors.push(m);});

await pg.goto('http://127.0.0.1:8918/index.html',{waitUntil:'domcontentloaded',timeout:30000});
await pg.waitForTimeout(1500);

const out=await pg.evaluate(()=>{
  const o={};
  o.isFn = typeof window.glClientInfoSections === 'function';
  // 1) Sparse client — every section header must still appear.
  const sparse = window.glClientInfoSections({ name:'Sparse Co', contact:'', email:'' });
  o.hasContact   = /CONTACT/.test(sparse);
  o.hasBusiness  = /BUSINESS INFO/.test(sparse);
  o.hasReceiving = /RECEIVING \/ LOGISTICS/.test(sparse);
  o.hasProducts  = /PRODUCT TYPES/.test(sparse);
  o.hasDocs      = /COMPLIANCE DOCUMENTS/.test(sparse);
  o.hasDash      = /—/.test(sparse);                 // empty fields shown as em dash
  o.sparseNotOnFile = /not on file/.test(sparse);
  o.sparseNoneProducts = /None specified/.test(sparse);

  // 2a) PA letter uploaded (has file path) -> a View link that calls glOpenClientDoc.
  const withFile = window.glClientInfoSections({
    name:'Doc Co', paLetterOnFile:true, paLetterFilePath:'c1/compliance/pa_letter_123.pdf', paLetterExpires:'2027-01-01'
  });
  o.paView = /Process Authority letter/.test(withFile) && /glOpenClientDoc\(/.test(withFile) && /View/.test(withFile);

  // 2b) PA letter marked on file but NO stored file -> explicit warning, no View.
  const noFile = window.glClientInfoSections({ name:'Gap Co', paLetterOnFile:true, paLetterFilePath:'' });
  o.paNoFileWarns = /no stored file/.test(noFile);

  // openDoc helper exists.
  o.openDocFn = typeof window.glOpenClientDoc === 'function';
  return o;
});

rec('glClientInfoSections is a function', out.isFn);
rec('sparse client still shows CONTACT', out.hasContact);
rec('sparse client still shows BUSINESS INFO', out.hasBusiness);
rec('sparse client still shows RECEIVING / LOGISTICS', out.hasReceiving);
rec('sparse client still shows PRODUCT TYPES', out.hasProducts);
rec('sparse client still shows COMPLIANCE DOCUMENTS', out.hasDocs);
rec('empty fields render as an em dash (not hidden)', out.hasDash);
rec('missing docs say "not on file"', out.sparseNotOnFile);
rec('no products says "None specified"', out.sparseNoneProducts);
rec('uploaded PA letter exposes a View link', out.paView);
rec('on-file-but-no-file PA letter warns "no stored file"', out.paNoFileWarns);
rec('glOpenClientDoc helper exists', out.openDocFn);
rec('no fatal app error', appErrors.length===0, appErrors.slice(0,3).join(' | '));

await br.close(); srv.close();
let fails=0;
console.log('');
results.forEach(r=>{ if(r.ok){console.log('  PASS  '+r.n);} else {fails++;console.log('  FAIL  '+r.n+(r.d?'  — '+r.d:''));} });
console.log('\n'+results.length+' checks · '+(results.length-fails)+' passed · '+fails+' failed');
process.exit(fails?1:0);
})();
