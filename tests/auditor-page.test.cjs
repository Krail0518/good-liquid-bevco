/*
 * auditor-page.test.cjs — drives the standalone read-only auditor portal
 * (auditor.html) in a headless browser with window.fetch stubbed. Verifies the
 * things that matter for an auditor login: no token → sign-in card (no data);
 * an unrecognized token → clean error, no dashboard; a valid token → the
 * read-only dashboard renders (stats, registers, deviations, recent records);
 * EVERY data read carries the X-Inspector-Token header (so server RLS gates
 * it); and the page issues NO write to any compliance table (read-only).
 *
 * RUN: NODE_PATH=/opt/node22/lib/node_modules \
 *      PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *      node tests/auditor-page.test.cjs
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=process.env.REPO_ROOT||path.resolve(__dirname,'..');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'text/plain'});s.end(b);});});

const results=[];
const rec=(n,ok,d)=>results.push({n,ok:!!ok,d:d||''});

// Injected before the page's own script runs: stub fetch so PostgREST reads
// resolve locally. Records every request's method/url/headers so the test can
// assert on read-only-ness and the inspector-token header.
function stubInit(validToken){
  window.__reqs=[];
  const future=new Date(Date.now()+72*3600*1000).toISOString();
  const TPLS=[
    {form_code:'GMP-PREOP-001',title:'Pre-Op Sanitation',category:'sanitation'},
    {form_code:'GMP-SEAM-001',title:'Double-Seam',category:'seam'}
  ];
  const RECENT=[
    {form_code:'GMP-PREOP-001',record_date:'2026-07-29',status:'signed',has_deviation:false,signature_name:'Op A',data:{line:'Line 1',run:'B-1',operator:'Op A',area:'Filler',result:'pass'}},
    {form_code:'GMP-SEAM-001',record_date:'2026-07-29',status:'signed',has_deviation:true,signature_name:'Op A',data:{line:'Line 1',run:'B-1',operator:'Op A',seamer_id:'S-1',visual_ok:'fail'}}
  ];
  const DEVS=[
    {form_code:'GMP-SEAM-001',record_date:'2026-07-29',deviation_notes:'Deviation: Visual OK',corrective_action:'Re-checked seam, held lot',data:{line:'Line 1',run:'B-1'}}
  ];
  window.fetch=async function(url,opts){
    opts=opts||{};
    const method=(opts.method||'GET').toUpperCase();
    window.__reqs.push({url:String(url),method:method,headers:Object.assign({},opts.headers||{})});
    const ok=(data)=>({ok:true,status:200,json:async()=>data});
    if(/inspector_tokens\?token=eq\./.test(url)){
      if(method!=='GET'){ return ok([]); } // the last_used_at PATCH — accept, no body needed
      const m=/token=eq\.([^&]+)/.exec(url); const tok=m?decodeURIComponent(m[1]):'';
      if(tok===validToken) return ok([{inspector:'Jane Auditor',agency:'SQF',purpose:'Annual audit',valid_until:future,revoked_at:null}]);
      return ok([]); // unrecognized
    }
    if(/gmp_templates/.test(url)) return ok(TPLS);
    if(/compliance_records\?form_code=eq\./.test(url)) return ok(RECENT.filter(r=>new RegExp('form_code=eq\\.'+r.form_code).test(url)));
    if(/compliance_records\?has_deviation=eq\.true/.test(url)) return ok(DEVS);
    if(/compliance_records/.test(url)) return ok(RECENT);
    if(/cip_logs|defects|hold_tags/.test(url)) return ok([]);
    return {ok:false,status:404,json:async()=>([])};
  };
}

(async()=>{
await new Promise(r=>srv.listen(8913,r));
const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
const VALID='validtoken0123456789abcdef0123456789abcd';

async function open(query){
  const pg=await br.newPage();
  await pg.addInitScript(stubInit, VALID);
  await pg.goto('http://127.0.0.1:8913/auditor.html'+query,{waitUntil:'domcontentloaded',timeout:30000});
  await pg.waitForTimeout(500);
  return pg;
}

// 1) No token → sign-in card, no dashboard, no data reads.
{
  const pg=await open('');
  const r=await pg.evaluate(()=>({
    login:!document.getElementById('login').classList.contains('hidden'),
    dash:!document.getElementById('dash').classList.contains('hidden'),
    dataReads:(window.__reqs||[]).filter(x=>/compliance_records|gmp_templates/.test(x.url)).length
  }));
  rec('no token shows the sign-in card', r.login && !r.dash, JSON.stringify(r));
  rec('no token reads no compliance data', r.dataReads===0, 'reads='+r.dataReads);
  await pg.close();
}

// 2) Unrecognized token → clean error, no dashboard.
{
  const pg=await open('?token=nope-not-a-real-token');
  const r=await pg.evaluate(()=>({
    login:!document.getElementById('login').classList.contains('hidden'),
    dash:!document.getElementById('dash').classList.contains('hidden'),
    msg:document.getElementById('login-msg').textContent
  }));
  rec('unrecognized token shows the sign-in card', r.login && !r.dash, JSON.stringify(r));
  rec('unrecognized token shows a clean error', /not recognized|verify/i.test(r.msg), r.msg);
  await pg.close();
}

// 3) Valid token → read-only dashboard renders.
{
  const pg=await open('?token='+VALID);
  const r=await pg.evaluate(()=>({
    dash:!document.getElementById('dash').classList.contains('hidden'),
    login:!document.getElementById('login').classList.contains('hidden'),
    who:document.getElementById('who').innerText,
    stats:document.getElementById('stats').innerText,
    registers:document.getElementById('registers').innerText,
    deviations:document.getElementById('deviations').innerText,
    recent:document.getElementById('recent').innerText,
    bannerReadOnly:/read-only/i.test(document.querySelector('.banner').innerText)
  }));
  rec('valid token shows the dashboard', r.dash && !r.login, JSON.stringify({dash:r.dash,login:r.login}));
  rec('reviewer banner names the auditor', /Jane Auditor/.test(r.who), r.who);
  rec('read-only banner is present', r.bannerReadOnly);
  rec('stats tiles render', /GMP registers/i.test(r.stats) && /deviation/i.test(r.stats), r.stats.slice(0,80));
  rec('registers list renders both forms', /Pre-Op Sanitation/.test(r.registers) && /Double-Seam/.test(r.registers), r.registers.slice(0,80));
  rec('open deviation is shown', /Visual OK|Deviation/.test(r.deviations), r.deviations.slice(0,80));
  rec('recent records table renders rows', /GMP-PREOP-001/.test(r.recent) && /GMP-SEAM-001/.test(r.recent), r.recent.slice(0,80));

  // 3a) Every data read carried the inspector-token header.
  const hdr=await pg.evaluate((VALID)=>{
    const reads=(window.__reqs||[]).filter(x=>x.method==='GET' && /compliance_records|gmp_templates/.test(x.url));
    return { total:reads.length, withTok:reads.filter(x=>x.headers && x.headers['X-Inspector-Token']===VALID).length };
  }, VALID);
  rec('every data read sends the X-Inspector-Token header', hdr.total>0 && hdr.withTok===hdr.total, JSON.stringify(hdr));

  // 3b) Register drill-in works and is read-only.
  const drill=await pg.evaluate(async()=>{
    await window.__openReg('GMP-SEAM-001','Double-Seam');
    await new Promise(r=>setTimeout(r,200));
    return {
      regShown:!document.getElementById('reg-view').classList.contains('hidden'),
      title:document.getElementById('reg-title').textContent,
      table:document.getElementById('reg-table').innerText
    };
  });
  rec('register drill-in opens', drill.regShown && /Double-Seam/.test(drill.title), JSON.stringify(drill).slice(0,100));
  rec('drill-in shows records', /S-1|fail|Line 1/.test(drill.table), drill.table.slice(0,80));

  // 3c) READ-ONLY: no write to any compliance table. The only non-GET allowed
  // is the last_used_at bump on inspector_tokens.
  const writes=await pg.evaluate(()=>{
    return (window.__reqs||[]).filter(x=>x.method!=='GET' && !/inspector_tokens/.test(x.url)).map(x=>x.method+' '+x.url);
  });
  rec('no write to any compliance table (read-only)', writes.length===0, writes.join(' | '));
  await pg.close();
}

// 4) Pasted token via the login field works too.
{
  const pg=await open('');
  const r=await pg.evaluate(async(VALID)=>{
    document.getElementById('token-input').value=VALID;
    document.getElementById('login-btn').click();
    await new Promise(r=>setTimeout(r,500));
    return { dash:!document.getElementById('dash').classList.contains('hidden') };
  }, VALID);
  rec('pasting a valid token into the login field loads the dashboard', r.dash);
  await pg.close();
}

await br.close(); srv.close();
let fails=0;
console.log('');
results.forEach(r=>{ if(r.ok){console.log('  PASS  '+r.n);} else {fails++;console.log('  FAIL  '+r.n+(r.d?'  — '+r.d:''));} });
console.log('\n'+results.length+' checks · '+(results.length-fails)+' passed · '+fails+' failed');
process.exit(fails?1:0);
})();
