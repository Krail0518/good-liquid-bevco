/*
 * onboard-page.test.cjs — drives the public onboarding page (onboard.html) in
 * a headless browser with the Supabase RPCs stubbed, verifying the three
 * things that matter: an invalid/missing token fails cleanly, a valid token
 * prefills the form from the lead data, and submit sends the completed answers
 * back through gl_onboarding_submit. No real network — window.fetch is stubbed
 * so the page's own rpc() wrapper is exercised end to end.
 *
 * RUN: NODE_PATH=/opt/node22/lib/node_modules  *      PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome  *      node tests/onboard-page.test.cjs
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {chromium}=require('playwright');
const ROOT=process.env.REPO_ROOT||path.resolve(__dirname,'..');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'text/plain'});s.end(b);});});

const results=[];
const rec=(n,ok,d)=>results.push({n,ok:!!ok,d:d||''});

// Injected before the page's own script runs: stub fetch so the RPC calls
// resolve locally and record what the page sent to gl_onboarding_submit.
function stubInit(scenario){
  window.__submitBody=null;
  window.__setpwBody=null;
  window.__setpwCalledBeforeSubmit=false;
  const PREFILL={company:'Onb Co',name:'Ann Onb',email:'ann@onb.test',phone:'8035550100',city:'Palmetto',state:'FL',service:'12oz seltzer canning',notes:'wants a test run'};
  window.fetch=async function(url,opts){
    const body=JSON.parse((opts&&opts.body)||'{}');
    if(/gl_onboarding_get/.test(url)){
      if(scenario==='bad') return {ok:true,json:async()=>({ok:false,error:'This onboarding link is not valid.'})};
      if(scenario==='done') return {ok:true,json:async()=>({ok:true,status:'submitted',submitted:true,client_name:'Onb Co',prefill:PREFILL,data:{}})};
      return {ok:true,json:async()=>({ok:true,status:'started',submitted:false,client_name:'Onb Co',email:'ann@onb.test',prefill:PREFILL,data:{}})};
    }
    if(/onboarding-set-password/.test(url)){ window.__setpwBody=body; return {ok:true,json:async()=>({ok:true,email:'ann@onb.test',portal_url:'/?portal=1'})}; }
    if(/gl_onboarding_submit/.test(url)){ window.__submitBody=body; window.__setpwCalledBeforeSubmit=!!window.__setpwBody; return {ok:true,json:async()=>({ok:true})}; }
    return {ok:false,status:404,json:async()=>({})};
  };
}

(async()=>{
await new Promise(r=>srv.listen(8911,r));
const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});

async function run(scenario, token){
  const pg=await br.newPage();
  await pg.addInitScript(stubInit, scenario);
  await pg.goto('http://127.0.0.1:8911/onboard.html?token='+token,{waitUntil:'domcontentloaded',timeout:30000});
  await pg.waitForTimeout(500);
  return pg;
}

// 1) Missing token → fatal, no form.
{
  const pg=await br.newPage();
  await pg.addInitScript(stubInit,'ok');
  await pg.goto('http://127.0.0.1:8911/onboard.html',{waitUntil:'domcontentloaded'});
  await pg.waitForTimeout(400);
  const r=await pg.evaluate(()=>({fatal:!document.getElementById('fatal').classList.contains('hidden'),form:!document.getElementById('form').classList.contains('hidden')}));
  rec('missing token shows the error card, not the form', r.fatal && !r.form, JSON.stringify(r));
  await pg.close();
}

// 2) Invalid token → fatal.
{
  const pg=await run('bad','short');
  const r=await pg.evaluate(()=>({fatal:!document.getElementById('fatal').classList.contains('hidden'),msg:document.getElementById('fatal-msg').textContent}));
  rec('invalid token shows a clean error', r.fatal && /not valid/i.test(r.msg), r.msg);
  await pg.close();
}

// 3) Already submitted → thank-you, no form.
{
  const pg=await run('done','abcdef0123456789abcdef0123456789abcdef01');
  const r=await pg.evaluate(()=>({done:!document.getElementById('done').classList.contains('hidden'),form:!document.getElementById('form').classList.contains('hidden')}));
  rec('already-submitted token shows the thank-you, not the form', r.done && !r.form, JSON.stringify(r));
  await pg.close();
}

// 4) Valid token → form prefilled from the lead data.
{
  const pg=await run('ok','abcdef0123456789abcdef0123456789abcdef01');
  const r=await pg.evaluate(()=>({
    formShown:!document.getElementById('form').classList.contains('hidden'),
    company:document.getElementById('f-company').value,
    contact:document.getElementById('f-contact_name').value,
    service:document.getElementById('f-service').value,
    city:document.getElementById('f-city').value
  }));
  rec('valid token shows the form', r.formShown);
  rec('form is prefilled from the lead (company)', r.company==='Onb Co', r.company);
  rec('form is prefilled from the lead (contact)', r.contact==='Ann Onb', r.contact);
  rec('form is prefilled from the lead (service)', r.service==='12oz seltzer canning', r.service);
  const pwFields=await pg.evaluate(()=>({p:!!document.getElementById('f-password'),p2:!!document.getElementById('f-password2'),
    masked:(document.getElementById('f-password')||{}).type==='password',
    policyStated:/uppercase/i.test(document.body.innerText)&&/special character/i.test(document.body.innerText)}));
  rec('password + confirm fields exist', pwFields.p && pwFields.p2);
  rec('password field is masked', pwFields.masked);
  rec('the complexity policy is stated on the page', pwFields.policyStated);

  // 5a) A weak password must be rejected client-side — no submit, no set-password call.
  const weak=await pg.evaluate(async()=>{
    document.getElementById('f-legal_name').value='Onb Co LLC';
    document.getElementById('f-password').value='alllowercase';   // no upper/number/special
    document.getElementById('f-password2').value='alllowercase';
    document.getElementById('form').dispatchEvent(new Event('submit',{cancelable:true}));
    await new Promise(r=>setTimeout(r,150));
    return { setpwCalled:!!window.__setpwBody, submitCalled:!!window.__submitBody, msg:document.getElementById('msg').textContent };
  });
  rec('weak password is blocked before any network call', !weak.setpwCalled && !weak.submitCalled, weak.msg);
  rec('weak password shows a policy message', /uppercase|number|special|8 char/i.test(weak.msg||''), weak.msg);

  // 5b) Mismatched confirm must be rejected.
  const mism=await pg.evaluate(async()=>{
    document.getElementById('f-password').value='Str0ng!pass';
    document.getElementById('f-password2').value='Different1!';
    document.getElementById('form').dispatchEvent(new Event('submit',{cancelable:true}));
    await new Promise(r=>setTimeout(r,150));
    return { setpwCalled:!!window.__setpwBody, msg:document.getElementById('msg').textContent };
  });
  rec('mismatched passwords are blocked', !mism.setpwCalled && /match/i.test(mism.msg||''), mism.msg);

  // 5c) A strong, matching password → set-password called BEFORE submit, then done.
  const sub=await pg.evaluate(async()=>{
    document.getElementById('f-password').value='Str0ng!pass';
    document.getElementById('f-password2').value='Str0ng!pass';
    document.getElementById('form').dispatchEvent(new Event('submit',{cancelable:true}));
    await new Promise(r=>setTimeout(r,350));
    return {
      body:window.__submitBody, setpw:window.__setpwBody, orderOk:window.__setpwCalledBeforeSubmit,
      doneShown:!document.getElementById('done').classList.contains('hidden'),
      formHidden:document.getElementById('form').classList.contains('hidden')
    };
  });
  rec('set-password is called with the token + password', sub.setpw && sub.setpw.token && sub.setpw.password==='Str0ng!pass');
  rec('login is created BEFORE the intake is finalized', sub.orderOk===true);
  rec('submit sends legal_name in the payload', sub.body && sub.body.p_data && sub.body.p_data.legal_name==='Onb Co LLC', JSON.stringify(sub.body&&sub.body.p_data||{}).slice(0,120));
  rec('submit mirrors company address into billing (same ticked)', sub.body && sub.body.p_data && sub.body.p_data.billing_city==='Palmetto', String(sub.body&&sub.body.p_data&&sub.body.p_data.billing_city));
  rec('submit passes the token', sub.body && sub.body.p_token==='abcdef0123456789abcdef0123456789abcdef01');
  rec('submit shows the thank-you screen', sub.doneShown && sub.formHidden);
  await pg.close();
}

await br.close(); srv.close();
let fails=0;
console.log('');
results.forEach(r=>{ if(r.ok){console.log('  PASS  '+r.n);} else {fails++;console.log('  FAIL  '+r.n+(r.d?'  — '+r.d:''));} });
console.log('\n'+results.length+' checks · '+(results.length-fails)+' passed · '+fails+' failed');
process.exit(fails?1:0);
})();
