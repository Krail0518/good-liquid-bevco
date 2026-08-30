/*
 * training-edit.test.cjs — the per-record Edit button on Training & Competency.
 * Renders src/modules/production/training.js against a stubbed Supabase, clicks Edit on a record
 * and asserts the modal opens prefilled with that record. Regression guard for
 * the id being interpolated into onclick="…" with JSON.stringify, whose double
 * quotes closed the attribute and left the handler as a syntax error.
 *
 * RUN: NODE_PATH=/opt/node22/lib/node_modules \
 *      PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node tests/training-edit.test.cjs
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=process.env.REPO_ROOT||path.resolve(__dirname,'..');
const TRAINING=process.env.TRAINING_JS||path.join(ROOT,'src/modules/production/training.js');

const REC={id:'54d7acaa-3c48-4fb5-849a-31f807ef388d',employee_name:'Zack Weeks',role:'Production',
  course:'Haccp first training session.',completed_date:'2026-08-01',expires_date:'2026-08-30',
  trainer:'QA lead',notes:'session one',active:true};

const PAGE=`<!doctype html><meta charset="utf-8"><body><div id="cpg-training"></div>
<script>
// training_records is staff-only, and glRenderTraining now refuses to load it
// without a staff session (GL-052) — the public marketing site used to query
// it for every anonymous visitor. This harness renders staff UI, so it has to
// say who it is, the same way smoke.test.cjs forces an admin session rather
// than performing a real login.
window.currentUser={id:'test-admin',email:'test@local',role:'admin',is_admin:true,name:'Test Admin'};
var REC=${JSON.stringify(REC)};
function res(data){var p=Promise.resolve({data:data,error:null});
  p.eq=function(){return res(data)};p.order=function(){return res(data)};
  p.maybeSingle=function(){return Promise.resolve({data:Array.isArray(data)?data[0]:data,error:null})};
  p.select=function(){return res(data)};return p;}
window.supa={from:function(){return {select:function(){return res([REC])},
  update:function(){return res([REC])},insert:function(){return res([REC])},
  delete:function(){return res([REC])}};}};
<\/script>
<script src="/src/modules/production/training.js"><\/script></body>`;

const srv=http.createServer((q,s)=>{
  const p=decodeURIComponent(q.url.split('?')[0]);
  if(p==='/'||p==='/index.html'){s.writeHead(200,{'Content-Type':'text/html'});return s.end(PAGE);}
  if(p==='/src/modules/production/training.js'){s.writeHead(200,{'Content-Type':'text/javascript'});return s.end(fs.readFileSync(TRAINING));}
  s.writeHead(404);s.end();
});

(async()=>{
  await new Promise(r=>srv.listen(8931,r));
  const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
  const pg=await br.newPage();
  const errs=[];
  pg.on('pageerror',e=>errs.push(String(e&&e.message||e)));
  await pg.goto('http://127.0.0.1:8931/index.html',{waitUntil:'domcontentloaded'});
  await pg.waitForTimeout(600);

  const btn=await pg.$('#cpg-training button:has-text("Edit")');
  console.log('Edit button rendered:', !!btn);
  const attrs=await pg.evaluate(()=>{const b=[...document.querySelectorAll('#cpg-training button')]
    .find(x=>x.textContent.trim()==='Edit'); return b?b.outerHTML.slice(0,160):null;});
  console.log('button HTML:', attrs);

  if(btn) await btn.click();
  await pg.waitForTimeout(500);

  const modal=await pg.evaluate(()=>{
    const m=document.getElementById('gl-training-edit'); if(!m) return null;
    return {title:(m.querySelector('div div div')||{}).textContent||'',
      employee:(m.querySelector('#tr-employee')||{}).value,
      course:(m.querySelector('#tr-course')||{}).value,
      completed:(m.querySelector('#tr-completed')||{}).value,
      hasDelete:!!m.querySelector('#tr-delete')};
  });
  console.log('modal:', JSON.stringify(modal));
  console.log('page errors:', JSON.stringify(errs));
  const ok = !!modal && modal.employee==='Zack Weeks' && modal.course==='Haccp first training session.'
    && modal.completed==='2026-08-01' && modal.hasDelete;
  console.log(ok?'PASS — edit modal opened prefilled':'FAIL — edit did not open the record');
  await br.close(); srv.close();
  process.exit(ok?0:1);
})();
