/*
 * gen-warehouse.cjs — the Warehouse Storage staff training video.
 *
 *   node gen-warehouse.cjs
 *
 * Unlike gen-video.cjs this drives a long, scripted walkthrough (12 parts) of
 * src/modules/warehouse/warehouse.js against an in-memory stand-in for
 * Supabase seeded from warehouse-demo.json (made-up clients: /tutorials is
 * public). Every caption is also narrated by Sofia (host.cjs) in the chosen
 * voice. It runs the walkthrough twice: a fast dry pass to collect every line,
 * then synthesis, then the recorded pass in which each caption stays up at
 * least as long as its narration. The narration is placed at the moment each
 * caption appeared and muxed into tutorial-warehouse.mp4 in $GL_VIDEO_OUT.
 */
'use strict';
const http=require('http'),fs=require('fs'),path=require('path'),{execSync,execFileSync}=require('child_process');const {chromium}=require('playwright');
const ROOT=process.env.GL_SITE_ROOT || path.resolve(__dirname,'..','..');
const OUT=process.env.GL_VIDEO_OUT || path.join(require('os').tmpdir(),'gl-video-out');
fs.mkdirSync(OUT,{recursive:true});
const S=path.join(OUT,'work-warehouse'); fs.mkdirSync(path.join(S,'video'),{recursive:true});
const KOKORO=process.env.GL_KOKORO_MODEL || '';
const PIPER=process.env.GL_PIPER_MODEL || '/opt/piper-voices/en-us-lessac-medium.onnx';
const HOST=require('./host.cjs');
const FIX=fs.readFileSync(path.join(__dirname,'warehouse-demo.json'),'utf8'), WH=fs.readFileSync(path.join(ROOT,'src/modules/warehouse/warehouse.js'),'utf8');
const JSPDF=fs.readFileSync(require.resolve('jspdf/dist/jspdf.umd.min.js'));
const CSS=fs.readFileSync(path.join(ROOT,'index.css'),'utf8')+'\n'+fs.readFileSync(path.join(ROOT,'crm-runtime.css'),'utf8');
const dur=f=>parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${f}"`).toString().trim());

// What the narrator says for a caption: the same words, minus emoji and
// arrows, with the abbreviations spelled the way staff say them.
function speakable(t){
  t=String(t).replace(/<[^>]+>/g,' ');
  t=t.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE0F}\u{200D}\u{2713}\u{2714}]/gu,' ');
  const sub=[[/\bCONRI\b/g,'Conri'],[/\bGL-TR\b/g,'G L T R'],[/\bGL-P-?/g,'G L P '],[/\bGL-OB-?/g,'G L O B '],[/\bFEFO\b/g,'fee foe'],
    [/\bLTL\b/g,'L T L'],[/\bFTL\b/g,'F T L'],[/\bBOL\b/g,'B O L'],[/\bPO\b/g,'P O'],[/\bSKUs?\b/g,m=>m==='SKUs'?'S K Us':'S K U'],[/\bQA\b/g,'Q A'],
    [/\bCSV\b/g,'C S V'],[/\bUPC\b/g,'U P C'],[/\bPDF\b/g,'P D F'],[/\bCRM\b/g,'C R M'],[/\bGL\b/g,'G L'],[/"/g,'']];
  sub.forEach(r=>{ t=t.replace(r[0],r[1]); });
  return t.replace(/\s+/g,' ').trim();
}
function titleCase(t){ return String(t).toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase()).replace(/\bLtl\b/g,'L T L').replace(/\bConri\b/g,'Conri'); }
const PAGE=`<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style>
<style>body{background:#060d1a;margin:0;overflow-x:hidden}#wrap{padding:26px 34px 150px}
#cap{position:fixed;left:calc(50% + 60px);bottom:26px;transform:translateX(-50%);max-width:1040px;width:calc(100% - 260px);z-index:5000;background:rgba(0,0,0,.86);color:#fff;
 font:600 22px/1.4 'Plus Jakarta Sans',Arial,sans-serif;padding:16px 24px;border-radius:14px;border:2px solid #00e5c0;text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.6);transition:opacity .3s}
#cap .step{display:block;font-size:14px;letter-spacing:2px;color:#00e5c0;margin-bottom:4px}
.hl{outline:4px solid #f5c842 !important;outline-offset:3px;border-radius:8px}
#title{position:fixed;inset:0;z-index:6000;background:#060d1a;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:Arial,sans-serif;text-align:center}
#title h1{font-size:54px;color:#00e5c0;margin:0 0 14px;letter-spacing:2px}#title p{font-size:24px;color:#dfe7f1;margin:6px}
#pdfv{position:fixed;inset:0;z-index:4000;background:rgba(6,13,26,.96);display:none;align-items:center;justify-content:center;gap:26px}
#pdfv img{max-height:78vh;box-shadow:0 0 0 2px #00e5c0;background:#fff}
#gm-mascot{position:fixed;left:10px;bottom:18px;width:150px;height:183px;z-index:6500;pointer-events:none;filter:drop-shadow(0 6px 14px rgba(0,0,0,.6))}
${HOST.HOST_CSS}</style></head>
<body><div id="wrap"><div id="cpg-warehouse" class="cpg act"></div></div><div id="cap" style="opacity:0"></div><div id="pdfv"></div><div id="gm-mascot">${HOST.HOST_SVG}</div>
<script>
window.__speak=function(ms){var m=document.getElementById('gm-mascot');if(!m)return;m.classList.add('gm-talking');clearTimeout(window.__spk);window.__spk=setTimeout(function(){m.classList.remove('gm-talking');},ms);};
window.currentUser={id:'demo',email:'mike@goodliquid.com',role:'admin',name:'Mike Krail'};
var D=${FIX}; D.wh_outbound_orders=D.wh_outbound_orders||[]; D.wh_lots=D.wh_lots||[];
var DEMO_CONRI={'p-dl-1':'9501','p-dl-2':'9502','p-dl-3':'9503'};
D.wh_pallets.forEach(function(p,i){p.conri_pallet_id=DEMO_CONRI[p.id]||(p.location==='conri'?String(9488+i):null);});
D.wh_movements=D.wh_pallets.filter(p=>p.location==='conri').map((p,i)=>({seq:i+1,pallet_id:p.id,transfer_id:null,at:p.received_at_conri,from_location:null,to_location:'conri',from_status:null,to_status:'stored',pallet:{pallet_tag:p.pallet_tag}}));
D.wh_billing_rates=[{id:'r-def',client_id:null,storage_per_pallet_month:30,pull_per_pallet:15}]; D.wh_billing_statements=[];
var C=D.clients, byId=(a,id)=>a.find(r=>r.id===id);
var tagN=30, trN=2, uid=0; window.FIX_CLIENT=function(){return (C.find(c=>/Demo Beverage/.test(c.name))||C[0]).id;}; function nid(p){return p+'-demo-'+(++uid);}
function clientOf(id){var c=byId(C,id);return c?{id:c.id,name:c.name}:null;}
function skuOut(s){return s&&Object.assign({},s,{client:clientOf(s.client_id)});}
function palletOut(p){return Object.assign({},p,{sku:skuOut(byId(D.wh_skus,p.sku_id)),lot:p.lot_id?byId(D.wh_lots,p.lot_id):null});}
function view(t){
 if(t==='wh_transfer_lines')return D.wh_transfer_lines.map(l=>Object.assign({},l,{pallet:palletOut(byId(D.wh_pallets,l.pallet_id))}));
 if(t==='wh_transfers')return D.wh_transfers.map(x=>Object.assign({},x,{client:clientOf(x.client_id)}));
 if(t==='wh_skus')return D.wh_skus.map(skuOut);
 if(t==='wh_pallets')return D.wh_pallets.map(palletOut);
 if(t==='wh_outbound_orders')return (D.wh_outbound_orders||[]).map(o=>Object.assign({},o,{client:clientOf(o.client_id),transfer:o.transfer_id?byId(D.wh_transfers,o.transfer_id):null}));
 if(t==='wh_movements')return D.wh_movements.map(m=>Object.assign({},m,{transfer:m.transfer_id?byId(D.wh_transfers,m.transfer_id):null}));
 if(t==='clients')return C; return D[t]||[];}
function Q(t,op,p){this.t=t;this.op=op;this.p=p;this.f=[];}
['select','order','limit','or','range'].forEach(m=>Q.prototype[m]=function(){return this;});
Q.prototype.eq=function(k,v){this.f.push(r=>r[k]===v);return this;};
Q.prototype.neq=function(k,v){this.f.push(r=>r[k]!==v);return this;};
Q.prototype.is=function(k,v){this.f.push(r=>(r[k]==null)===(v===null));return this;};
Q.prototype.in=function(k,a){this.f.push(r=>a.indexOf(r[k])>=0);return this;};
Q.prototype.not=function(k,op,v){var a=String(v).replace(/[()]/g,'').split(',');this.f.push(r=>a.indexOf(r[k])<0);return this;};
Q.prototype.then=function(res,rej){var s=this,out=[];
 if(s.op==='select') out=view(s.t).filter(r=>s.f.every(f=>f(r)));
 else if(s.op==='insert'){[].concat(s.p).forEach(r=>{r=Object.assign({},r);
   if(s.t==='wh_skus'){r.id=nid('s');r.active=true;r.last_exported_at=null;}
   if(s.t==='wh_transfers'){r.id=nid('t');r.transfer_number='GL-TR-20261008-0'+(trN++);r.status='draft';r.client_id=r.client_id||null;}
   if(s.t==='wh_pallets'){r.id=nid('p');r.pallet_tag='GL-P-0000'+(tagN++);r.location='good_liquid';r.status='staged';r.current_transfer_id=null;}
   if(s.t==='wh_transfer_lines'){var p=byId(D.wh_pallets,r.pallet_id);if(p)p.current_transfer_id=r.transfer_id;}
   if(s.t==='wh_outbound_orders'){r.id=nid('o');r.order_number='GL-OB-0000'+(D.wh_outbound_orders.length+1);r.created_at=new Date().toISOString();}
   if(s.t==='wh_lots'){r.id=nid('l');}
   if(s.t==='wh_billing_statements'||s.t==='wh_billing_rates'){r.id=nid('b');r.billed_at=r.billed_at||new Date().toISOString();}
   (D[s.t]=D[s.t]||[]).push(r);out.push(r);});}
 else if(s.op==='update'){var raw=(D[s.t]||[]);var ids=view(s.t).filter(r=>s.f.every(f=>f(r))).map(r=>r.id);
   raw.filter(r=>ids.indexOf(r.id)>=0).forEach(r=>{Object.assign(r,s.p);
     if(s.t==='wh_transfers'&&s.p.status==='completed'){r.completed_at=new Date().toISOString();
       D.wh_transfer_lines.filter(l=>l.transfer_id===r.id).forEach(l=>{var p=byId(D.wh_pallets,l.pallet_id);var dest=r.type==='outbound_pickup'?['shipped','shipped']:r.type==='pull_back'?['good_liquid','pulled']:['conri','stored'];D.wh_movements.push({seq:D.wh_movements.length+1,pallet_id:p.id,transfer_id:r.id,at:new Date().toISOString(),from_location:p.location,from_status:p.status,to_location:dest[0],to_status:dest[1],pallet:{pallet_tag:p.pallet_tag}});p.location=dest[0];p.status=dest[1];if(dest[0]==='conri')p.received_at_conri=r.scheduled_at;p.current_transfer_id=null;});}
     if(s.t==='wh_transfers'&&s.p.status==='cancelled'){D.wh_pallets.filter(p=>p.current_transfer_id===r.id).forEach(p=>p.current_transfer_id=null);}
     out.push(r);});}
 else if(s.op==='delete'){var keep=[];(D[s.t]||[]).forEach(r=>{if(s.f.every(f=>f(r))){out.push(r);if(s.t==='wh_transfer_lines'){var p=byId(D.wh_pallets,r.pallet_id);if(p)p.current_transfer_id=null;}}else keep.push(r);});D[s.t]=keep;}
 return Promise.resolve({data:out,error:null}).then(res,rej);};
window.supa={from:t=>({select:()=>new Q(t,'select'),insert:p=>new Q(t,'insert',p),update:p=>new Q(t,'update',p),delete:()=>new Q(t,'delete')}),
 rpc:function(fn,a){var o=byId(D.wh_pallets,a.p_pallet);var n=Object.assign({},o,{id:nid('p'),pallet_tag:'GL-P-0000'+(tagN++),cases:a.p_cases,split_from:o.id,conri_pallet_id:null,current_transfer_id:null});
   o.cases-=a.p_cases;D.wh_pallets.push(n);D.wh_movements.push({seq:D.wh_movements.length+1,pallet_id:n.id,transfer_id:null,at:new Date().toISOString(),from_location:null,to_location:n.location,from_status:null,to_status:n.status,pallet:{pallet_tag:n.pallet_tag}});
   return Promise.resolve({data:palletOut(n),error:null});},
 functions:{invoke:function(){return new Promise(r=>setTimeout(()=>r({data:{ok:true,text:JSON.stringify({transaction:'3100417',reference:'DEMO-881',received_date:'2026-10-09',
   pallets:[{pallet:'9520',sku:'CAN-12OZ-SLK',description:'12OZ SLEEK CANS, EMPTY',qty:1},{pallet:'9521',sku:'CAN-12OZ-SLK',qty:1},{pallet:'9522',sku:'CAN-12OZ-SLK',qty:1}]})},error:null}),2500));}}};
window.glInvoiceFromQuote=function(spec){var c=byId(C,spec.clientId);var m=document.createElement('div');m.id='demo-inv';m.className='wh-ov';
 m.setAttribute('style','position:fixed;inset:0;z-index:950;background:rgba(6,13,26,.95);display:flex;align-items:center;justify-content:center');
 var tot=0;var rows=spec.items.map(l=>{var a=l.qty*l.unitPrice;tot+=a;return '<tr><td style="padding:8px">'+l.desc+'</td><td style="text-align:right;padding:8px">'+l.qty+'</td><td style="text-align:right;padding:8px">$'+l.unitPrice.toFixed(2)+'</td><td style="text-align:right;padding:8px">$'+a.toFixed(2)+'</td></tr>';}).join('');
 m.innerHTML='<div style="background:#142238;border:1px solid rgba(0,229,192,.3);border-radius:16px;padding:24px;max-width:900px;color:#fff;font-family:Arial"><div style="font-size:20px;color:#00e5c0;margin-bottom:6px">NEW INVOICE · '+(c?c.name:'')+'</div><div style="color:#9aa7bd;margin-bottom:12px">(the CRM invoice builder, lines filled in)</div><table style="width:100%;border-collapse:collapse;font-size:15px"><tr style="color:#9aa7bd"><th style="text-align:left;padding:8px">Description</th><th style="text-align:right;padding:8px">Qty</th><th style="text-align:right;padding:8px">Rate</th><th style="text-align:right;padding:8px">Amount</th></tr>'+rows+'<tr><td colspan="3" style="text-align:right;padding:8px;font-weight:700">Total</td><td style="text-align:right;padding:8px;font-weight:700;color:#00e5c0">$'+tot.toFixed(2)+'</td></tr></table></div>';
 document.body.appendChild(m);return Promise.resolve();};
URL.createObjectURL=()=>'blob:x';
<\/script><script src="/jspdf.js"><\/script><script>window.ensureJsPdf=()=>Promise.resolve(window.jspdf.jsPDF);
window.addEventListener('load',()=>{window.jspdf.jsPDF.API.save=function(n){window.__pdf=this.output('datauristring');return this;};});<\/script>
<script src="/wh.js"><\/script></body></html>`;
const srv=http.createServer((q,r)=>{if(q.url==='/jspdf.js'){r.writeHead(200,{'Content-Type':'text/javascript'});return r.end(JSPDF);}
 if(q.url==='/wh.js'){r.writeHead(200,{'Content-Type':'text/javascript'});return r.end(WH);} r.writeHead(200,{'Content-Type':'text/html'});r.end(PAGE);});
const W=1366,H=820;
// Narration lines collected by the dry pass, synthesized once, then timed.
const LINES=[], LEN={}, EVENTS=[];
async function pass(record){
const b=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
const ctx=await b.newContext({viewport:{width:W,height:H},...(record?{recordVideo:{dir:path.join(S,'video'),size:{width:W,height:H}}}:{})});
const p=await ctx.newPage(); const T0=Date.now(); const errs=[]; p.on('pageerror',e=>errs.push(String(e.message||e)));
p.on('dialog',async d=>{await p.waitForTimeout(record?1200:30);d.accept();});
const SP=record?1:0.02; const wait=ms=>p.waitForTimeout(Math.max(30,ms*SP));
// say(): narrate a line now. In the dry pass it only collects the line; in
// the recorded pass it marks when the line starts and returns how long it
// runs, so the caller can hold the screen at least that long.
const say=async(txt)=>{ const t=speakable(txt); if(!t) return 0;
  if(!record){ if(LINES.indexOf(t)<0) LINES.push(t); return 0; }
  const L=LEN[t]; if(!L) return 0;
  EVENTS.push({t:(Date.now()-T0)/1000, file:L.file});
  await p.evaluate(ms=>window.__speak(ms), Math.round(L.d*1000));
  return L.d*1000+700; };
const cap=async(step,txt,ms)=>{ms=Math.max(ms||0,4200,String(txt).split(/\s+/).length*360);await p.evaluate(([s,t])=>{var c=document.getElementById('cap');c.innerHTML=(s?'<span class="step">'+s+'</span>':'')+t;c.style.opacity=1;},[step,txt]);const sp=await say(txt);if(record)ms=Math.max(ms,sp);await wait(ms||3500);};
const hl=async sel=>{await p.waitForSelector(sel);await p.evaluate(s=>{document.querySelectorAll('.hl').forEach(e=>e.classList.remove('hl'));var e=document.querySelector(s);e.classList.add('hl');e.scrollIntoView({block:'center',behavior:'smooth'});},sel);await wait(1300);};
const click=async sel=>{await hl(sel);await p.click(sel);await p.evaluate(()=>document.querySelectorAll('.hl').forEach(e=>e.classList.remove('hl')));await wait(900);};
const type=async(sel,txt)=>{await hl(sel);await p.fill(sel,'');await p.type(sel,txt,{delay:55});await wait(400);};
const pick=async(sel,v)=>{await hl(sel);await p.selectOption(sel,v);await wait(900);};
const chapter=async(n,title,sub)=>{await p.evaluate(([n,t,u])=>{document.getElementById('cap').style.opacity=0;var d=document.createElement('div');d.id='chap';d.setAttribute('style','position:fixed;inset:0;z-index:6000;background:rgba(6,13,26,.97);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:Arial,sans-serif;text-align:center;padding:40px');d.innerHTML='<div style="font-size:22px;letter-spacing:4px;color:#9aa7bd">PART '+n+'</div><div style="font-size:50px;color:#00e5c0;margin:12px 0 18px;letter-spacing:1px">'+t+'</div><div style="font-size:24px;color:#dfe7f1;max-width:1000px;line-height:1.5">'+u+'</div>';document.body.appendChild(d);},[n,title,sub]);const sp=await say('Part '+n+'. '+titleCase(title)+'. '+sub);await wait(Math.max(4500,sub.split(/\s+/).length*330,record?sp:0));await p.evaluate(()=>document.getElementById('chap').remove());await wait(300);};
const scrollTo=async(sel)=>{await p.evaluate(s=>{var e=document.querySelector(s);if(e)e.scrollIntoView({block:'center',behavior:'smooth'});},sel);await wait(1000);};
const cardBy=async(re)=>{await p.evaluate(r=>{var h=[...document.querySelectorAll('#wh-body .ccard-t')].find(e=>new RegExp(r).test(e.textContent));if(h){h.parentElement.scrollIntoView({block:'start',behavior:'smooth'});h.parentElement.classList.add('hl');setTimeout(()=>h.parentElement.classList.remove('hl'),2500);}},re);await wait(1200);};
const closeOv=async()=>{await p.evaluate(()=>document.querySelectorAll('.wh-ov').forEach(o=>o.remove()));await wait(500);};
const top=async()=>{await p.evaluate(()=>window.scrollTo({top:0,behavior:'smooth'}));await wait(600);};
await p.goto('http://127.0.0.1:8971/');
await p.evaluate(()=>{var t=document.createElement('div');t.id='title';t.innerHTML='<h1>WAREHOUSE STORAGE</h1><p>Staff training: storing pallets at CONRI, Paul\'s pallet numbers, paperwork, shipping out LTL and billing</p><p style="color:#9aa7bd;font-size:18px;margin-top:22px">Good Liquid Bev Co CRM &nbsp;·&nbsp; demo data, nothing real is changed</p>';document.body.appendChild(t);});
await wait(Math.max(6000, await say("Hi, I'm Sofia. This is your training on Warehouse Storage: how we store pallets at Conri, keep track of Paul's pallet numbers, ship out by L T L, and bill our clients for storage. Everything you'll see is demo data, so nothing real changes.")));
await p.evaluate(()=>{document.getElementById('title').remove();window.glRenderWarehouse();}); await p.waitForSelector('#wh-body .ccard');

// ═════ PART 1 · THE PAGE
await chapter(1,'THE PAGE','Where it is, what it tracks, and the buttons you will use every day.');
await cap('WHERE IT IS','In the CRM sidebar, open Operations and click 🏬 Warehouse Storage. Admin and sales logins can see it.');
await cap('WHAT IT IS','This is the record of every pallet we keep at CONRI Services, across the street. Paul Nolletti is our contact there. If a pallet is at CONRI, it should be in here.');
await cap('THREE KINDS OF PALLETS','We store three kinds: a client\'s FINISHED GOODS (racked, waiting for a truck), a client\'s EMPTY CANS (overflow, back to us for a run in 1 to 2 days), and GOOD LIQUID PACKAGING (our own supplies, like Pak-it carrier trays).');
await hl('[data-wh="newTransfer"]');
await cap('TOP BUTTONS','"+ New transfer" starts any move of pallets in or out of CONRI.');
await hl('.cph [data-wh="newOrder"]');
await cap('TOP BUTTONS','"🚚 Ship out (LTL)" sends a client\'s product from CONRI out on a truck.');
await hl('#wh-tabs');
await cap('TABS','The tabs: Dashboard, Transfers (every move), SKU master (the item list), Outbound orders (trucks going out), Reconciliation (checking CONRI\'s count), BOL pallet sheets, and 💵 Billing (what each client owes for storage).');
await cap('THE RULE','Every move has the same 4 steps: 1) make a transfer and its pallets, 2) make sure the items are on CONRI\'s list, 3) schedule it with Paul, 4) complete it when Paul has them. Until step 4 the CRM still shows the pallets at Good Liquid.');
await cap('HELP','Stuck at any point? Click ❓ Help at the top of the CRM, or press the ? key, and it opens the Warehouse Storage guide.');

// ═════ PART 2 · DASHBOARD
await chapter(2,'THE DASHBOARD','What is at CONRI right now, and what needs attention. Check it every morning.');
await scrollTo('.cph');
await hl('#wh-body .ccard');
await cap('TOTALS','Across the top: pallets at CONRI, cases, units, empty-can pallets held more than 2 days, and finished lots within 90 days of best by.');
await cardBy('On hand at CONRI');
await cap('ON HAND','"On hand at CONRI" lists every item there, grouped by client. Each line shows the lot, pallets, cases, units and best by date. Our Pak-it trays are here under "Good Liquid (own packaging)".');
await cardBy('Every pallet at CONRI');
await cap('EVERY PALLET','"Every pallet at CONRI" lists each pallet with our tag AND Paul\'s own number, the CONRI #. Paul pulls pallets by his number, so this is the column to read him over the phone. Yellow "not recorded" means we still need his number (Part 6).');
await cardBy('Empty cans at CONRI');
await cap('EMPTY CANS','Empty cans are meant to come back within 1 to 2 days. A pallet held longer turns RED here. That is your cue to schedule the pull back.');
await cardBy('Finished goods lots under');
await cap('BEST BY','Finished goods within 90 days of their best by date turn YELLOW. Talk to the client about shipping them.');
await cardBy('Upcoming transfers');
await cap('UPCOMING','"Upcoming transfers and pickups" lists every move that is still a draft or scheduled. Click a row to open it.');
await top();

// ═════ PART 3 · RECEIVING A CLIENT'S CANS
await chapter(3,'A PALLET OF CANS COMES IN','Example: Demo Beverage Co\'s empty cans arrive and go to CONRI. Pick the client, build the pallets, add a note.');
await click('[data-wh="newTransfer"]');
await cap('STEP 1 · NEW TRANSFER','Click "+ New transfer". The first box is the TYPE of move.');
await hl('#wnt-type');
await cap('THE 5 TYPES','To CONRI: finished goods. To CONRI: empty can overflow. To CONRI: Good Liquid packaging (our supplies). Pull back from CONRI (bringing pallets home). Outbound carrier pickup (made for you by Ship out).');
await pick('#wnt-type','to_conri_overflow');
await cap('PICK THE TYPE','These are empty cans going over, so pick "To CONRI: empty can overflow".');
await pick('#wnt-client',await p.evaluate(()=>FIX_CLIENT()));
await cap('PICK THE CLIENT','Then pick WHO the cans belong to. Every client in the CRM is in this list. Here: Demo Beverage Co.');
await hl('#wnt-date');
await cap('DATES','Transfer date defaults to today. "Scheduled with CONRI for" can be left blank now and filled in when Paul gives you a time.');
await type('#wnt-notes','Demo cans for the Friday run');
await cap('NOTES','Notes here are about the whole move. Notes about a single pallet come next.');
await click('#wnt-save'); await p.waitForSelector('[data-wh="quickBuild"]'); await wait(800);
await cap('DRAFT','It is created as a DRAFT with its own number, GL-TR plus the date. Nothing has moved yet, and you can still change anything.');
await click('[data-wh="quickBuild"]'); await p.waitForSelector('#wqb-newsku');
await cap('QUICK BUILD','"⚡ Quick build pallets" creates the pallet records. The top line confirms whose pallets these are: Client: Demo Beverage Co.');
await hl('#wqb-newsku');
await cap('NEW ITEM','Demo Beverage Co has no empty-can item in the system yet, so click "+ New empty cans item for Demo Beverage Co". You only do this the first time.');
await click('#wqb-newsku'); await p.waitForSelector('#ws-upc');
await cap('NEW ITEM','The item form is already set to Demo Beverage Co and Empty cans.');
await type('#ws-upc','CAN-12OZ-SLK');
await cap('NEW ITEM','UPC / SKU: the client\'s item number or the can supplier\'s part number, exactly as on their paperwork.');
await type('#ws-desc','12oz Sleek Cans, empty');
await type('#ws-pack','bulk pallet');
await cap('NEW ITEM','Description is what prints on the label. Pack, units per case and the pallet defaults are optional. Click Save SKU.');
await click('#ws-save'); await p.waitForSelector('#wqb-note'); await wait(800);
await cap('BACK TO QUICK BUILD','You land straight back in Quick build with the new item picked.');
await hl('#wqb-lot');
await cap('LOT','Lot: empty cans and packaging do not need one. Finished goods MUST have a lot that QA has released (Part 7).');
await type('#wqb-count','2');
await cap('PALLETS','Pallet count: how many pallets of this item. Each becomes its own record with its own tag and label.');
await type('#wqb-cases','20');
await type('#wqb-weight','650');
await cap('CASES AND WEIGHT','Cases per pallet (for cans, use layers or sleeves, whatever you count by), and the weight of each pallet. Height matters for finished goods: CONRI only racks pallets under 72 inches.');
await hl('#wqb-pull'); await p.fill('#wqb-pull','2026-10-16'); await wait(800);
await cap('PULL DATE','Expected pull date: when the cans should come back for the run. Empty cans only.');
await type('#wqb-note','Silver sleek, for the Demo run Fri 10/16');
await cap('THE NOTE','The Note box: anything someone should know about these pallets. It goes on EVERY pallet built here, prints on the labels and shows on the dashboard.');
await click('#wqb-save'); await p.waitForSelector('[data-wh="editPalletNote"]'); await wait(900);
await scrollTo('#wh-body .ctbl');
await cap('PALLET LIST','Two pallets, each with a tag (GL-P- and a number), cases, weight and the Note column. The totals are at the top of the list.');
await click('[data-wh="editPalletNote"]');
await cap('ONE PALLET\'S NOTE','To note something about ONE pallet, click ✏️ (or "+ Note") on that pallet. You can do this at any time, even after it is at CONRI.');
await type('#wpn-note','Silver sleek, for the Demo run Fri 10/16. Top layer short 3 sleeves');
await click('#wpn-save'); await p.waitForSelector('[data-wh="editPalletNote"]'); await wait(900);
await scrollTo('#wh-body .ctbl');
await cap('ONE PALLET\'S NOTE','Only that pallet changed. "Remove" takes a pallet off the draft if you built too many; it asks whether to void the record.');
await top();
await click('[data-wh="printPaperwork"]'); await p.waitForFunction(()=>!!window.__pdf);
{ const durl=await p.evaluate(()=>window.__pdf); const pdfPath=S+'/video/demo.pdf';
  fs.writeFileSync(pdfPath,Buffer.from(durl.split(',')[1],'base64')); execFileSync('pdftoppm',['-png','-r','70','-f','1','-l','2',pdfPath,S+'/video/demopg']);
  const imgs=fs.readdirSync(S+'/video').filter(f=>/^demopg.*png$/.test(f)).sort().map(f=>'data:image/png;base64,'+fs.readFileSync(S+'/video/'+f).toString('base64'));
  await p.evaluate(a=>{var v=document.getElementById('pdfv');v.innerHTML=a.map(s=>'<img src="'+s+'">').join('');v.style.display='flex';},imgs); }
await cap('PRINT PAPERWORK','"🖨️ Print paperwork" downloads a PDF. Page 1 is the packing list: every pallet, its notes, totals, a receiving box and signature lines for us and for CONRI.');
await cap('LABELS','Then one big label per pallet: the item, client, cases, the note, "PALLET 1/2", and a barcode of the pallet tag. Tape one label on each pallet and send the packing list with the load.');
await p.evaluate(()=>document.getElementById('pdfv').style.display='none'); await wait(500);

// ═════ PART 4 · CONRI'S LIST + SCHEDULING
await chapter(4,'SCHEDULE IT WITH PAUL','CONRI has to know the item before they can receive it, and every move is booked in advance.');
await top();
await hl('[data-wh="scheduleTransfer"]');
await cap('WHY IS IT GREY?','"📅 Mark scheduled" is grey and a red line explains why: the new item has never been sent to CONRI. CONRI cannot receive an item they have not keyed in.');
await click('[data-wh="tab"][data-arg="skus"]');
await pick('#wh-sku-client',await p.evaluate(()=>FIX_CLIENT())); await p.waitForSelector('[data-wh="exportSkus"]'); await wait(600);
await cap('SKU MASTER','Go to the SKU master tab. Use the owner box at the top left to show one client. The "Sent to CONRI" column shows "never" for the new item.');
await hl('[data-wh="exportSkus"]');
await cap('SEND TO CONRI','Click "⬇ Export CSV for CONRI". A file downloads. Email it to Paul (pnolletti@conriservices.com).');
await click('[data-wh="exportSkus"]'); await p.waitForFunction(()=>!/never/.test(document.getElementById('wh-body').innerText)); await wait(900);
await cap('SENT','The column now shows today\'s date. If you later change an item\'s number, description or units per case, it goes back to "never" so it is sent again.');
await click('[data-wh="tab"][data-arg="transfers"]');
await cap('TRANSFERS TAB','The Transfers tab lists every move: number, date, type, client, pallets, cases, when it is scheduled and its status. Click one to open it.');
{ const tid=await p.evaluate(()=>D.wh_transfers[D.wh_transfers.length-1].id);
  await click('[data-wh="openTransfer"][data-arg="'+tid+'"]'); await p.waitForSelector('[data-wh="editTransfer"]'); await wait(600); }
await click('[data-wh="editTransfer"]');
await cap('SET THE TIME','Click "✏️ Edit". Enter the date and time Paul agreed to, then Save. Leave the CONRI confirmation box empty: Paul\'s transaction number goes there later, from his receipt (Part 6).');
await hl('#wet-when'); await p.fill('#wet-when','2026-10-09T10:00'); await wait(900);
await click('#wet-save'); await p.waitForSelector('[data-wh="scheduleTransfer"]'); await wait(700);
await click('[data-wh="schedEmail"]');
await p.evaluate(()=>{var b=document.getElementById('wem-body');if(b){b.scrollTop=b.scrollHeight;}}); await wait(500);
await cap('EMAIL PAUL','"✉ Scheduling email to CONRI" writes the email for you: date, time, client, pallets, cases, items, pallet notes and dimensions. Click "Open in mail app" or "Copy text".');
await closeOv();
await click('[data-wh="scheduleTransfer"]'); await p.waitForSelector('[data-wh="completeTransfer"]'); await wait(800);
await cap('SCHEDULED','Click "📅 Mark scheduled". Its status is now SCHEDULED. "↩ Back to draft" undoes it if plans change, and "Cancel transfer" cancels the move.');

// ═════ PART 5 · COMPLETE
await chapter(5,'WHEN PAUL HAS THE PALLETS','Complete the transfer. This is what moves the pallets to CONRI in the CRM.');
await click('[data-wh="completeTransfer"]');
await cap('COMPLETE','Click "✓ Complete (received)". Pallets and cases received fill in from the packing list. Type who received them at CONRI.');
await type('#wc-by','Paul Nolletti');
await hl('#wc-cond');
await cap('CONDITION','Condition: Good, or "Exceptions noted". If the counts differ or anything is damaged, you MUST pick Exceptions noted and describe it. The CRM will not let mismatched counts through as Good.');
await hl('#wc-file');
await cap('SIGNED PACKING LIST','Attach a photo or PDF of the packing list Paul signed, now or later ("📎 Upload signed packing list").');
await click('#wc-save'); await p.waitForSelector('#wh-moves .ctbl'); await wait(900);
await cap('DONE','Status: COMPLETED. The receipt is recorded, and the pallets now read CONRI / stored. A completed transfer cannot be undone.');
await scrollTo('#wh-moves');
await cap('MOVEMENT LOG','The movement log at the bottom records every pallet move with the time. Nobody can edit it.');
await top();

// ═════ PART 6 · PAUL'S PALLET NUMBERS
await chapter(6,'PAUL\'S PALLET NUMBERS','When Paul receives our pallets he gives each one his own number, and he pulls by that number. Here is how they get into the CRM.');
await cap('HIS PAPERWORK','After the pallets are in, Paul emails a "Receive Summary Ticket". It lists every pallet he received under his own pallet number, grouped by item. Here is a demo one: 3 pallets of our 12oz Sleek cans, numbers 9520, 9521 and 9522.');
{ const tpage=await ctx.newPage(); await tpage.setViewportSize({width:820,height:620});
  await tpage.setContent('<body style="margin:0;background:#fff;font-family:Arial;color:#000;padding:28px"><div style="text-align:center;font-size:22px;font-weight:700">Receive Summary Ticket</div><div style="text-align:center;color:#a00;font-size:13px">DEMO DOCUMENT FOR TRAINING</div><div style="display:flex;justify-content:space-between;margin:18px 0;font-size:14px"><div>Good Liquid Bev Co.<br>CONRI Services Florida</div><div style="text-align:right">Transaction # : 3100417<br>Reference # : DEMO-881<br>Creation Date : 10/9/2026</div></div><table style="width:100%;border-collapse:collapse;font-size:14px"><tr style="border-bottom:2px solid #000"><th style="text-align:left">SKU</th><th style="text-align:left">Item Description</th><th>Unit</th><th>Qty</th></tr><tr><td><b>CAN-12OZ-SLK</b></td><td>12OZ SLEEK CANS, EMPTY</td><td style="text-align:center">Pallet</td><td style="text-align:center">3</td></tr><tr><td colspan="4" style="padding:8px 0 0 30px">Details: Loc: DOCK-EAST &nbsp; Qty: 1 &nbsp; <b>Pallet: 9520</b></td></tr><tr><td colspan="4" style="padding:4px 0 0 30px">Details: Loc: DOCK-EAST &nbsp; Qty: 1 &nbsp; <b>Pallet: 9521</b></td></tr><tr><td colspan="4" style="padding:4px 0 0 30px">Details: Loc: DOCK-EAST &nbsp; Qty: 1 &nbsp; <b>Pallet: 9522</b></td></tr><tr style="border-top:2px solid #000"><td colspan="3" style="text-align:right;padding-top:6px">Totals :</td><td style="text-align:center;padding-top:6px">3</td></tr></table></body>');
  await tpage.screenshot({path:S+'/video/ticket.png'}); await tpage.close(); await p.bringToFront();
  const img='data:image/png;base64,'+fs.readFileSync(S+'/video/ticket.png').toString('base64');
  await p.evaluate(a=>{var v=document.getElementById('pdfv');v.innerHTML='<img src="'+a+'">';v.style.display='flex';},img); }
await cap('WHY IT MATTERS','Notice Paul counted 3 pallets, but we sent 2. That happens: he may break one pallet into two. The CRM will catch it.');
await p.evaluate(()=>document.getElementById('pdfv').style.display='none'); await wait(500);
await top();
await click('[data-wh="conriReceipt"]'); await p.waitForSelector('#wrc-file');
await cap('📎 CONRI RECEIPT','Open the completed transfer and click "📎 CONRI receipt (pallet #s)". The bottom lists OUR pallets on this transfer, each with a box for Paul\'s number.');
await hl('#wrc-file');
await cap('UPLOAD IT','Choose Paul\'s ticket: the PDF from his email, or a photo of the paper. The CRM reads it for you.');
await p.setInputFiles('#wrc-file', S+'/video/ticket.png');
await p.waitForSelector('#wrc-found table',{timeout:15000}); await wait(800);
await hl('#wrc-found');
await cap('WHAT IT FOUND','It found 3 CONRI pallets on transaction 3100417 and matched them by item: 9520 and 9521 went on our two pallets. 9522 is YELLOW: Paul has one more pallet of this item than we have records.');
await cap('THE YELLOW LINE','The yellow line tells you what to do: if one of ours is really several pallets, ✂ Split it first. Nothing has been saved yet, so check every number before you save.');
await hl('#wrc-tx');
await cap('TRANSACTION #','Paul\'s transaction number is filled in too, so you can find his paperwork later.');
await click('#wrc-save'); await p.waitForSelector('[data-wh="splitPallet"]'); await wait(900);
await scrollTo('#wh-body .ctbl');
await cap('SAVED','Saved. The CONRI # column now shows 9520 and 9521. You can also type or fix a number by hand any time with ✏️ on the pallet.');
await click('[data-wh="splitPallet"]'); await p.waitForSelector('#wsp-cases');
await cap('✂ SPLIT','Now the third pallet. Paul split our first pallet into two, so click "✂ Split" on it. Say how many cases went onto the new pallet, and Paul\'s number for it.');
await type('#wsp-cases','10');
await type('#wsp-conri','9522');
await click('#wsp-save'); await p.waitForSelector('#wh-body .ctbl'); await wait(900);
await scrollTo('#wh-body .ctbl');
await cap('SPLIT DONE','Now there are 3 pallet records, one for each of Paul\'s numbers: 9520, 9521 and the new split pallet 9522. Every CONRI number belongs to exactly one record.');
await click('[data-wh="tab"][data-arg="dashboard"]'); await p.waitForSelector('#wh-body .ctbl'); await wait(800);
await cardBy('Every pallet at CONRI');
await cap('ON THE DASHBOARD','Back on the Dashboard, the cans are at CONRI with Paul\'s numbers. From now on every email that asks Paul to pull or ship a pallet says "pull CONRI #9520", so he goes straight to it.');
await top();

// ═════ PART 6 · FINISHED GOODS
await chapter(7,'FINISHED GOODS AND LOTS','A client\'s finished product can only go to CONRI from a lot that QA has released.');
await click('[data-wh="tab"][data-arg="skus"]');
await pick('#wh-sku-client',await p.evaluate(()=>FIX_CLIENT())); await p.waitForSelector('[data-wh="addLot"]'); await wait(600);
await cap('LOTS','In SKU master, each finished-goods item lists its lots. Each lot shows HOLD (red) or RELEASED (green).');
await click('[data-wh="addLot"]');
await cap('ADD A LOT','"+ Lot" adds one: lot number, production date and best by date. A new lot starts on QA HOLD.');
await type('#wl-num','628300B');
await hl('#wl-bb'); await p.fill('#wl-bb','2028-04-10'); await wait(700);
await click('#wl-save'); await p.waitForSelector('[data-wh="toggleLot"]'); await wait(800);
await scrollTo('[data-wh="toggleLot"]');
await cap('QA RELEASE','When QA signs off, click "QA release" on the lot. Only then can its pallets be scheduled to CONRI. "Put on hold" blocks it again, even mid-move.');
await cap('THE REST','After that it is the same 4 steps: + New transfer, "To CONRI: finished goods", the client, Quick build with the released lot, print, schedule, complete.');
await top();

// ═════ PART 7 · OUR PACKAGING
await chapter(8,'OUR OWN PACKAGING','Carrier trays, lids, cartons: supplies Good Liquid owns, not a client.');
await click('[data-wh="newTransfer"]');
await pick('#wnt-type','to_conri_packaging');
await cap('PACKAGING','Pick "To CONRI: Good Liquid packaging". The owner fills in as "Good Liquid (own packaging)" by itself. Everything else is the same as Part 3.');
await cap('PACKAGING ITEMS','Packaging items are added in SKU master with the owner "Good Liquid (own packaging)". The item number is the vendor\'s part number, like TRAY12-1800.');
await closeOv();

// ═════ PART 8 · SHIP OUT LTL
await chapter(9,'SHIP OUT BY LTL','A client\'s product is sitting at CONRI and has to go out on a truck. Two buttons start it.');
await click('[data-wh="tab"][data-arg="dashboard"]'); await p.waitForSelector('[data-wh="shipSku"]'); await wait(600);
await hl('.cph [data-wh="newOrder"]');
await cap('BUTTON 1 · TOP OF THE PAGE','"🚚 Ship out (LTL)" at the top of Warehouse Storage opens a blank order: you pick the client and the items yourself.');
{ const sel=await p.evaluate(()=>{var b=[...document.querySelectorAll('[data-wh="shipSku"]')].find(x=>/Lemon Fizz/.test(x.closest('tr').innerText));return b?'[data-wh="shipSku"][data-arg2="'+b.getAttribute('data-arg2')+'"]':'[data-wh="shipSku"]';});
  await hl(sel);
  await cap('BUTTON 2 · ON THE PRODUCT LINE','Faster: every client product at CONRI has a "🚚 Ship" button on its line on the Dashboard. Here: Demo Lemon Fizz, 3 pallets at CONRI. Click it.');
  await click(sel); }
await p.waitForSelector('.wo-qty'); await wait(900);
await cap('ALREADY FILLED IN','The order opens with the client chosen (Demo Beverage Co), Ship method LTL, and 1 pallet of Lemon Fizz filled in.');
await hl('#wo-lines');
await cap('WHAT CAN SHIP','The table lists everything this client has at CONRI that can ship, and how many pallets of each. Finished goods only ship from a QA-released lot. Empty cans ship too. Our own packaging never ships out.');
await type('.wo-qty','2');
await cap('HOW MANY','Type how many pallets go out. Here: 2. If you ask for more than are at CONRI, it tells you and does not create the order.');
await type('#wo-ref','PO 7781');
await cap('RELEASE / PO','Client release / PO: the client\'s release number or PO for this pickup. It goes on the email to Paul.');
await hl('#wo-date'); await p.fill('#wo-date','2026-10-12'); await wait(800);
await cap('PICKUP DATE','Requested pickup date: the day the truck comes to CONRI.');
await hl('#wo-method');
await cap('SHIP METHOD','Ship method stays LTL for a freight truck. FTL, Parcel and Customer pickup are there if needed.');
await type('#wo-carrier','Estes');
await type('#wo-shipto','Demo Beverage Co Warehouse\n400 Industrial Blvd\nAnytown, FL 30000');
await cap('CARRIER AND SHIP TO','Carrier (Estes, XPO, Saia…) and the full ship to address. Then click "Allocate FEFO + create pickup".');
await click('#wo-save'); await p.waitForSelector('#wh-oemail'); await wait(1000);
await cap('IT PICKS THE PALLETS','It chose the 2 pallets with the earliest best by date first (FEFO), so the oldest product leaves first. It also created the pickup transfer.');
await p.evaluate(()=>{var t=document.querySelector('#wh-oemail textarea');if(t){t.scrollTop=t.scrollHeight/3;}}); await wait(700);
await cap('EMAIL PAUL','The email to Paul is written for you: order number, client, pickup date, LTL and carrier, ship to, and exactly which pallets to pull BY PAUL\'S NUMBER: "pull CONRI #9501 (our GL-P-000901)". Click "Open in mail app" and send it.');
await closeOv();
await scrollTo('#wh-body .ctbl');
await cap('OUTBOUND ORDERS','You land on the Outbound orders tab. The order is ALLOCATED: pallets are reserved, nothing has left yet. Click the transfer number to see or print the pickup paperwork. "✉ Order email" reopens the email.');
await hl('[data-wh="shipOrder"]');
await cap('WHEN THE TRUCK LEAVES','When the truck has picked up, click "Mark shipped".');
await click('[data-wh="shipOrder"]');
await type('#wsh-bol','BOL-883410');
await hl('#wsh-by');
await cap('BOL AND DRIVER','Enter the BOL number from the carrier, and the driver or carrier name (filled in from the order). Both are required.');
await click('#wsh-save'); await wait(1500);
await scrollTo('#wh-body .ctbl');
await cap('SHIPPED','The order is SHIPPED with its BOL. The pickup is completed and those pallets are marked shipped, so they leave the CONRI count.');
await click('[data-wh="tab"][data-arg="dashboard"]'); await p.waitForSelector('#wh-body .ctbl'); await wait(800);
await cardBy('On hand at CONRI');
await cap('THE COUNT GOES DOWN','Back on the Dashboard, Demo Lemon Fizz went from 3 pallets at CONRI to 1. The same steps work for a client\'s empty cans.');
await top();

// ═════ PART 9 · BRINGING PALLETS BACK
await chapter(10,'BRINGING PALLETS BACK','Empty cans coming home for a run, or anything else returning from CONRI.');
await click('[data-wh="newTransfer"]');
await pick('#wnt-type','pull_back');
await pick('#wnt-client',await p.evaluate(()=>FIX_CLIENT()));
await cap('PULL BACK','"+ New transfer", type "Pull back from CONRI", and the client.');
await click('#wnt-save'); await p.waitForSelector('[data-wh="pickPallets"]'); await wait(700);
await click('[data-wh="pickPallets"]'); await p.waitForSelector('.wpk'); await wait(700);
await cap('PICK PALLETS','"☑ Pick existing pallets" lists that client\'s pallets at CONRI, oldest best by first, with their notes. Tick the ones coming back and click "Add selected".');
await p.click('.wpk'); await wait(700);
await click('#wpk-save'); await p.waitForSelector('[data-wh="editTransfer"]'); await wait(700);
await cap('SAME STEPS','Then the same as always: Print paperwork, Edit the time, Mark scheduled, and Complete when they are back. They then show at Good Liquid again.');

// ═════ PART 10 · OTHER TABS
await chapter(11,'THE OTHER TABS','Checking CONRI\'s count, and pallet sheets for a client\'s BOL.');
await click('[data-wh="tab"][data-arg="recon"]');
await cap('RECONCILIATION','Reconciliation: upload CONRI\'s inventory report (CSV). It compares their count with ours by item and lot and highlights every difference in red. Nothing is changed.');
await click('[data-wh="tab"][data-arg="bol"]');
await cap('BOL PALLET SHEETS','BOL pallet sheets: upload a client\'s BOL (PDF or photo) or type it in, and print one big "PALLET 1 OF 14" sheet per pallet. Check the filled-in fields against the paper before printing.');

// ═════ PART 12 · BILLING
await chapter(12,'BILLING','What each client owes for storage at CONRI: $30 per pallet per month, and $15 for every pallet pulled out.');
await click('[data-wh="tab"][data-arg="billing"]'); await p.waitForSelector('#wb-month'); await wait(900);
await cap('THE RULE','Storage is $30 per pallet for every month it is at CONRI. Any part of a month counts as the month: a pallet that arrives on the 30th pays for that month. Every pallet pulled out, back to us or shipped on a truck, is $15.');
await hl('#wb-month');
await cap('PICK THE MONTH','Pick the month. There is nothing to type: it is worked out from the pallet moves the CRM already records. October is still in progress, so the yellow line says to bill it once the month is over.');
await hl('#wh-body > div:nth-child(2)');
await cap('TOTALS','Across the top: pallet-months, storage, pulls, pull fees, the month\'s total, and how much is not billed yet.');
await hl('#wh-body table.ctbl tr:nth-child(2)');
await cap('ONE LINE PER CLIENT','One line per client. Demo Beverage Co: the pallets stored this month, the storage charge, the pulls (the 2 Lemon Fizz pallets that shipped), the pull fees and the total.');
{ const cid=await p.evaluate(()=>FIX_CLIENT());
  await click('[data-wh="billDetail"][data-arg="'+cid+'"]'); await wait(600);
  await scrollTo('#wb-det-'+cid);
  await cap('DETAILS','"Details" shows exactly which pallets: our tag, Paul\'s CONRI #, the item, the day it came in and went out, and every pull with its date. This is your backup if a client asks.');
  await click('[data-wh="billDetail"][data-arg="'+cid+'"]');
  await click('[data-wh="billInvoice"][data-arg="'+cid+'"]'); await p.waitForSelector('#demo-inv'); await wait(900);
  await cap('🧾 CREATE INVOICE','"🧾 Create invoice" opens a new invoice for that client with the storage line and the pulls line filled in, at the client\'s rates, naming the pallets. Check it and send it like any invoice.');
  await closeOv();
  await click('[data-wh="billMark"][data-arg="'+cid+'"]'); await p.waitForSelector('#wbm-ref');
  await cap('✓ MARK BILLED','After you send the invoice, click "✓ Mark billed" and type the invoice number. This stops anyone billing the same month twice.');
  await type('#wbm-ref','INV-1001');
  await click('#wbm-save'); await p.waitForSelector('[data-wh="billUnmark"]'); await wait(900);
  await hl('#wh-body table.ctbl tr:nth-child(2)');
  await cap('BILLED','The line now says Billed, with the date and invoice number. If a pallet move is added for that month later, the line turns red and shows the new amount, and "↻ Update billed" records it. "Undo" removes the billed mark.'); }
await cap('OUR OWN TRAYS','Good Liquid\'s own packaging is listed too, but marked "not billed": it is our stock.');
await click('[data-wh="billRates"]'); await p.waitForSelector('#wr-client');
await cap('✏️ RATES','"✏️ Rates" changes the prices. The default ($30 and $15) applies to every client. Pick a client to give them their own rate, for example a discount for a big account.');
await closeOv();
await hl('[data-wh="billCsv"]');
await cap('⬇ CSV','"⬇ CSV" downloads the whole month, pallet by pallet, for the bookkeeper. Billing is for admin and sales logins only.');
await click('[data-wh="tab"][data-arg="dashboard"]'); await p.waitForSelector('#wh-body .ccard'); await wait(600);

// ═════ SUMMARY
await p.evaluate(()=>{document.getElementById('cap').style.opacity=0;var t=document.createElement('div');t.id='title';t.innerHTML='<h1>CHEAT SHEET</h1>'+
 '<p><b style="color:#00e5c0">Every morning:</b> Dashboard. Red empties → pull back. Yellow lots → talk to the client.</p>'+
 '<p><b style="color:#00e5c0">Pallets in:</b> + New transfer → type + client → ⚡ Quick build (+ note) → 🖨️ Print</p>'+
 '<p>New item? SKU master → ⬇ Export CSV for CONRI → email Paul</p>'+
 '<p>✏️ Edit the time → ✉ email Paul → 📅 Mark scheduled → ✓ Complete when he has them</p>'+
 '<p><b style="color:#00e5c0">Ship out:</b> 🚚 Ship on the item (or 🚚 Ship out at the top) → pallets, date, carrier, ship to → email Paul → truck leaves → Mark shipped + BOL</p>'+
 '<p><b style="color:#00e5c0">Bring back:</b> + New transfer → Pull back → ☑ Pick pallets → same steps</p>'+
 '<p><b style="color:#00e5c0">Paul\'s numbers:</b> his ticket arrives → open the transfer → 📎 CONRI receipt → upload → check → Save (✂ Split if he has more pallets)</p>'+
 '<p><b style="color:#00e5c0">Billing (monthly):</b> 💵 Billing → last month → 🧾 Create invoice → send → ✓ Mark billed</p>'+
 '<p style="color:#9aa7bd;margin-top:18px">Stuck? ❓ Help or press ?</p>';t.querySelectorAll('p').forEach(x=>x.style.fontSize='19px');document.body.appendChild(t);});
await wait(Math.max(20000, await say("That's the whole system. Pause here if you want to copy the cheat sheet, and remember: the Help button, or the question mark key, opens this guide from anywhere in the C R M. Thanks for watching.")));
console.log((record?'record':'dry')+' pass errors:',JSON.stringify(errs));
if(errs.length) throw new Error('page errors: '+errs.join(' | '));
const total=(Date.now()-T0)/1000;
const vp=record?await p.video().path():null; await ctx.close(); await b.close();
return {vp:vp,total:total};
}

(async()=>{await new Promise(r=>srv.listen(8971,r));
console.log('dry pass…'); await pass(false);
console.log(LINES.length+' narration lines; synthesizing…');
const jobs=LINES.map((t,i)=>[t, path.join(S,'line_'+i+'.wav')]);
if(KOKORO){ fs.writeFileSync(path.join(S,'tts-jobs.json'),JSON.stringify(jobs)); execSync(`python3 "${path.join(__dirname,'tts-kokoro.py')}" "${path.join(S,'tts-jobs.json')}"`,{stdio:'inherit'}); }
else jobs.forEach(j=>execSync(`piper --model ${PIPER} --output_file "${j[1]}"`,{input:j[0]}));
jobs.forEach(j=>{ LEN[j[0]]={file:j[1], d:dur(j[1])}; });
console.log('recording…'); const r=await pass(true); srv.close();
const V=dur(r.vp);
// Lay every line at the moment its caption appeared, over silence as long as the video.
const mix=path.join(S,'narration.wav');
fs.writeFileSync(path.join(S,'events.json'),JSON.stringify({total:V,events:EVENTS}));
execFileSync('python3',[path.join(__dirname,'mix-narration.py'),path.join(S,'events.json'),mix],{stdio:'inherit'});
const out=path.join(OUT,'tutorial-warehouse.mp4');
execSync(`ffmpeg -y -loglevel error -i "${r.vp}" -i "${mix}" -map 0:v:0 -map 1:a:0 -c:v libx264 -preset slow -crf 30 -pix_fmt yuv420p -r 25 -c:a aac -b:a 96k -shortest -movflags +faststart "${out}"`);
console.log('WROTE',out,fs.statSync(out).size,'bytes',dur(out).toFixed(1)+'s');
process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
