/*
 * gen-video.cjs — module tutorial-video generator with neural voiceover.
 *
 *   node gen-video.cjs <storyboardKey>
 *
 * Pipeline: Playwright drives the real app (stubbed data) → silent .webm with a
 * visible cursor + caption banner; Kokoro (or Piper) synthesizes each step's narration; the
 * per-step wall-time is forced to the narration length so audio lines up; ffmpeg
 * trims the pre-roll, muxes the narration track, and encodes an MP4.
 *
 * Expandable: add a new object to STORYBOARDS (its setup + steps) and run again.
 */
const http=require('http'),fs=require('fs'),path=require('path');
const {execSync}=require('child_process');
const {chromium}=require('playwright');
// GL-129: hardcoded to one machine's checkout, like SCRATCH below. The static
// server silently 404s every file when this is wrong, so index.html loads empty
// and the first storyboard step dies on `window.invoices` being undefined — a
// confusing way to be told the path is wrong. Default to the repo this file
// lives in, which is right by construction; GL_SITE_ROOT still overrides.
const ROOT=process.env.GL_SITE_ROOT || path.resolve(__dirname,'..','..');
// GL-129: this was hardcoded to one machine's sandbox path, so the generator
// only ever ran where it was written. GL_VIDEO_OUT lets CI (and anyone else)
// point it somewhere real; the old path stays as the default so nothing that
// worked before changes. The directory is created if it does not exist.
const SCRATCH=process.env.GL_VIDEO_OUT
  || '/tmp/claude-0/-home-user-good-liquid-bevco/a8dbf2c3-6093-5bf2-adf9-cca45eb015ed/scratchpad';
try { require('fs').mkdirSync(SCRATCH,{recursive:true}); } catch(e){}
const MODEL=process.env.GL_PIPER_MODEL || '/opt/piper-voices/en-us-lessac-medium.onnx';
// Kokoro (voice 1, af_heart) replaced Piper as the narrator on 2026-10-18:
// Piper sounded robotic. Used when GL_KOKORO_MODEL is set; Piper otherwise.
const KOKORO=process.env.GL_KOKORO_MODEL || '';
const HOST=require('./host.cjs');
function synthAll(lines, work){
  if(KOKORO){
    const jobs=path.join(work,'tts-jobs.json');
    fs.writeFileSync(jobs, JSON.stringify(lines));
    execSync(`python3 "${path.join(__dirname,'tts-kokoro.py')}" "${jobs}"`, { stdio: 'inherit' });
  } else {
    lines.forEach(function(l){ execSync(`piper --model ${MODEL} --output_file "${l[1]}"`,{input:l[0]}); });
  }
}
const W=1120,H=740, LEAD=0.15, TAILPAD=0.55;   // per-step: LEAD + narration + TAILPAD
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dur=f=>parseFloat(execSync(`ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "${f}"`).toString().trim());

// ─────────────────────────── stub + overlays (shared) ───────────────────────────
function installCommon(){
  // runs in the browser; sets a stubbed supabase, a fake cursor, and a caption bar
  window.__inserted=[];
  window.__chain=function(tables, single){
    single = single || function(){ return null; };
    function chain(table){
      const rows=function(){ return tables[table] || (tables[table]=[]); };
      const filters=[]; // {k,v}
      const applyF=function(arr){ return arr.filter(function(r){ return filters.every(function(f){ return String(r[f.k])===String(f.v); }); }); };
      const keyF=function(){ return filters.find(function(f){ return f.k==='form_code'||f.k==='id'; }); };
      const c={};
      ['order','limit','gte','lte','gt','lt','neq','in','range','not','is','filter','contains','or','ilike','like','match'].forEach(function(m){ c[m]=function(){ return c; }; });
      c.select=function(cols,opts){ if(opts&&opts.count) c._count=true; return c; };
      c.eq=function(k,v){ filters.push({k:k,v:v}); return c; };
      c.maybeSingle=async function(){ let d=applyF(rows()); const f=keyF(); if(!d.length && f && single(table,f.v)) d=[single(table,f.v)]; return {data:d[0]||null,error:null}; };
      c.single=c.maybeSingle;
      // Inserts: rows get an id (and any per-table defaults a storyboard sets in
      // window.__insertDefaults, e.g. a server generated job number), and
      // .select() answers like PostgREST, including .single().
      c.insert=function(r){ const a=Array.isArray(r)?r:[r];
        const def=(window.__insertDefaults||{})[table];
        const full=a.map(function(x,i){ return Object.assign({id:'new'+i+'_'+Date.now()}, typeof def==='function'?def(x):(def||{}), x); });
        full.forEach(function(x){ rows().push(x); }); window.__inserted.push({table:table,rows:full});
        const sel=function(){ const p=Promise.resolve({data:full,error:null}); p.single=async function(){ return {data:full[0]||null,error:null}; }; p.maybeSingle=p.single; return p; };
        return { select:sel, then:function(res,rej){ return Promise.resolve({data:full,error:null}).then(res,rej); } }; };
      // Updates: filters apply, the matched rows are patched once, and .select()
      // returns them, so code that checks for 0 rows (CLAUDE.md rule 4) sees a
      // real save.
      c.update=function(patch){ const uf=[]; let done=null;
        const run=function(){ if(done) return done; done=rows().filter(function(r){ return uf.every(function(f){ return f.isNull!==undefined ? ((r[f.k]==null)===f.isNull) : String(r[f.k])===String(f.v); }); }); done.forEach(function(r){ Object.assign(r,patch); }); return done; };
        const u={ eq:function(k,v){ uf.push({k:k,v:v}); return u; }, is:function(k,v){ uf.push({k:k,isNull:v==null}); return u; } };
        ['in','neq','match','or','filter','not'].forEach(function(m){ u[m]=function(){ return u; }; });
        u.select=function(){ const p=Promise.resolve().then(function(){ return {data:run(),error:null}; }); p.single=async function(){ return {data:run()[0]||null,error:null}; }; p.maybeSingle=p.single; return p; };
        u.then=function(res,rej){ return Promise.resolve().then(function(){ run(); return {data:null,error:null}; }).then(res,rej); };
        return u; };
      c.delete=function(){ return { eq:function(k,v){ const a=rows(); for(let i=a.length-1;i>=0;i--){ if(String(a[i][k])===String(v)) a.splice(i,1); } return { then:function(res){ return Promise.resolve({data:null,error:null}).then(res); } }; } }; };
      c.then=function(res){ let d=applyF(rows()); const f=keyF(); if(!d.length && f && single(table,f.v)) d=[single(table,f.v)]; return Promise.resolve({data:d,count:(c._count?d.length:undefined),error:null}).then(res); };
      return c;
    }
    // window.__rpc = { fn: args => data } lets a storyboard answer an RPC.
    window.supa={from:function(t){ return chain(t); },rpc:async(fn,args)=>({data:(window.__rpc&&window.__rpc[fn])?window.__rpc[fn](args):null,error:null}),
      storage:{from:function(){ return { upload:async function(p){ return {data:{path:p},error:null}; }, createSignedUrl:async function(){ return {data:{signedUrl:'about:blank'},error:null}; }, remove:async function(){ return {data:[],error:null}; } }; }},
      functions:{invoke:async(fn,o)=>({data:(window.__fn&&window.__fn[fn])?window.__fn[fn](o):{ok:true},error:null})},
      auth:{getUser:async()=>({data:{user:{id:'u1'}},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
      channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:()=>{}};
    window.currentUser={id:'u1',email:'mike@krail.us',role:'admin',name:'Mike',initials:'MK'};
  };
  window.__hud=function(){
    // auth.js shows a red "session has expired" bar 60s in, because the real
    // Supabase client it captured at load has no session. The demo is not a
    // real session, so the bar is hidden rather than filmed.
    if(!document.getElementById('gl-video-nosession')){
      const ns=document.createElement('style'); ns.id='gl-video-nosession';
      ns.textContent='#gl-session-expired{display:none!important}';
      document.head.appendChild(ns);
    }
    if(!document.getElementById('vcursor')){
      const cur=document.createElement('div'); cur.id='vcursor';
      cur.style.cssText='position:fixed;left:130px;top:130px;width:22px;height:22px;border-radius:50%;background:rgba(0,229,192,.35);border:2px solid #00e5c0;box-shadow:0 0 10px rgba(0,229,192,.7);z-index:2147483647;pointer-events:none;transition:left .55s cubic-bezier(.4,0,.2,1),top .55s cubic-bezier(.4,0,.2,1);transform:translate(-50%,-50%)';
      document.body.appendChild(cur);
    }
    if(!document.getElementById('vcap')){
      const cap=document.createElement('div'); cap.id='vcap';
      cap.style.cssText='position:fixed;left:0;right:0;bottom:0;padding:16px 40px;background:linear-gradient(180deg,rgba(10,22,40,0),rgba(10,22,40,.97) 45%);color:#eaf3f0;font-size:19px;line-height:1.5;font-weight:600;z-index:2147483646;text-align:center;min-height:52px;box-sizing:border-box;pointer-events:none';
      document.body.appendChild(cap);
    }
    if(!document.getElementById('gm-mascot')){
      // Sofia, the host (host.cjs, injected as window.__host before this runs).
      // Her open mouth shows only while __speak says she is talking.
      const st=document.createElement('style'); st.id='gm-style';
      st.textContent=(window.__host?window.__host.css:'');
      document.head.appendChild(st);
      const m=document.createElement('div'); m.id='gm-mascot';
      m.style.cssText='position:fixed;left:16px;bottom:84px;width:132px;height:162px;z-index:2147483646;pointer-events:none;filter:drop-shadow(0 6px 14px rgba(0,0,0,.5))';
      m.innerHTML=(window.__host?window.__host.svg:'');
      document.body.appendChild(m);
    }
    window.__speak=function(ms){ const m=document.getElementById('gm-mascot'); if(!m) return; m.classList.add('gm-talking'); clearTimeout(window.__spk); window.__spk=setTimeout(function(){ m.classList.remove('gm-talking'); }, ms); };
    window.__vcap=t=>{const c=document.getElementById('vcap'); if(c) c.textContent=t;};
    window.__pulse=(x,y)=>{const p=document.createElement('div');p.style.cssText='position:fixed;left:'+x+'px;top:'+y+'px;width:14px;height:14px;border-radius:50%;border:2px solid #00e5c0;z-index:2147483645;pointer-events:none;transform:translate(-50%,-50%);transition:all .5s ease-out';document.body.appendChild(p);requestAnimationFrame(()=>{p.style.width='64px';p.style.height='64px';p.style.opacity='0';});setTimeout(()=>p.remove(),520);};
  };
  window.__overlays=function(containerId){
    document.body.innerHTML=''; document.body.style.cssText='margin:0;background:#0a1628;font-family:Inter,Arial,sans-serif';
    const stage=document.createElement('div'); stage.id='vstage';
    stage.style.cssText='position:fixed;inset:0;padding:26px 26px 92px;overflow:auto;box-sizing:border-box';
    const host=document.createElement('div'); host.id=containerId||'cpg-gmp'; stage.appendChild(host); document.body.appendChild(stage);
    window.__hud();
  };
}

// ─────────────────────────── storyboards ───────────────────────────
const CAL_TPL={form_code:'GMP-CAL-001',title:'Calibration Verification',category:'calibration',frequency:'monthly',in_daily:false,active:true,sort_order:110,
  fields:[{key:'instrument',label:'Instrument / device',type:'text',required:true},{key:'instrument_id',label:'Instrument ID / serial',type:'text'},{key:'reference',label:'Reference standard used',type:'text',required:true},{key:'as_found',label:'As-found reading',type:'number'},{key:'as_left',label:'As-left reading',type:'number'},{key:'tolerance_ok',label:'Within tolerance',type:'passfail',required:true,deviation_if:'fail'},{key:'next_due',label:'Next calibration due',type:'date'},{key:'performed_by',label:'Performed by',type:'text'},{key:'notes',label:'Adjustment / notes',type:'textarea'}]};

const DAILY_TPLS=[
  {form_code:'GMP-PREOP-001',title:'Pre-Op Sanitation',category:'sanitation',frequency:'per_run',in_daily:true,active:true,sort_order:10,
   fields:[{key:'area',label:'Line / area',type:'text',required:true},{key:'result',label:'Result',type:'passfail',required:true,deviation_if:'fail'},{key:'notes',label:'Notes',type:'textarea'}]},
  {form_code:'GMP-HYGIENE-001',title:'GMP & Personnel Hygiene',category:'hygiene',frequency:'daily',in_daily:true,active:true,sort_order:20,
   fields:[{key:'garments',label:'Garments / hairnets / beard nets OK',type:'passfail',required:true,deviation_if:'fail'},{key:'handwashing',label:'Handwashing stations stocked',type:'passfail',required:true,deviation_if:'fail'},{key:'notes',label:'Notes / follow-ups',type:'textarea'}]}
];

// dates relative to the recording day (the app uses the real system date)
function isoDaysAgo(n){ const d=new Date(Date.now()-n*86400000); return d.toISOString().slice(0,10); }
const TODAY=isoDaysAgo(0), NOWISO=new Date().toISOString();
const SCHED_TASKS=[
  {id:'t1',title:'Pest control inspection',task_type:'pest',due_date:isoDaysAgo(3),status:'open'},
  {id:'t2',title:'Glass & brittle-plastic audit',task_type:'glass',due_date:isoDaysAgo(1),status:'open'},
  {id:'t3',title:'Daily GMP & hygiene check',task_type:'hygiene',due_date:TODAY,due_time:'07:00',status:'open'},
  {id:'t4',title:'Pre-op sanitation verification',task_type:'preop',due_date:TODAY,due_time:'06:00',status:'open'},
  {id:'t5',title:'CCP — pasteurizer monitoring',task_type:'ccp',due_date:TODAY,status:'open'},
  {id:'t6',title:'Calibration verification',task_type:'calibration',due_date:TODAY,status:'done',completed_at:NOWISO}
];

const TRAIN_ROWS=[
  {id:'tr1',employee_name:'Jane Smith',role:'Line lead',course:'HACCP Level 2',completed_date:'2025-09-01',expires_date:'2026-09-01',trainer:'QA Lead',active:true},
  {id:'tr2',employee_name:'Jane Smith',role:'Line lead',course:'GMP Annual Refresher',completed_date:'2026-01-15',expires_date:'2027-01-15',trainer:'QA Lead',active:true},
  {id:'tr3',employee_name:'Carlos Ruiz',role:'Operator',course:'Better Process Control School',completed_date:'2024-06-10',expires_date:'2026-08-15',trainer:'University Ext.',active:true},
  {id:'tr4',employee_name:'Carlos Ruiz',role:'Operator',course:'Allergen Control',completed_date:'2025-03-01',expires_date:'2026-03-01',trainer:'QA',active:true}
];

const TRACE_DATA={
  production_runs:[{id:1,run_name:'Cold Brew R-2041',client_name:'Perico Nutrition',format:'12oz can',cases:520,stage:'Filled'}],
  lot_inputs:[
    {run_id:1,material:'Cold brew concentrate',supplier:'Bean Co.',supplier_lot:'BC-8841',lot_code:'CB-2041',quantity:200,uom:'L'},
    {run_id:1,material:'Filtered water',supplier:'Municipal (UV treated)',supplier_lot:'—',lot_code:'CB-2041',quantity:1800,uom:'L'},
    {run_id:1,material:'12oz cans + ends',supplier:'CanWorks',supplier_lot:'CW-5521',lot_code:'CB-2041',quantity:13000,uom:'cans'}
  ],
  lot_shipments:[
    {run_id:1,customer:'Whole Foods SE',quantity:5000,uom:'cans',ship_date:'2026-07-20',po:'PO-3321'},
    {run_id:1,customer:'Sprouts DC-4',quantity:6000,uom:'cans',ship_date:'2026-07-22',po:'PO-3340'}
  ],
  compliance_records:[
    {run_id:1,form_code:'GMP-CCP-PAST-001',record_date:'2026-07-18',has_deviation:false},
    {run_id:1,form_code:'GMP-SEAM-001',record_date:'2026-07-18',has_deviation:false},
    {run_id:1,form_code:'GMP-LABEL-001',record_date:'2026-07-18',has_deviation:true}
  ],
  mock_recalls:[]
};

const AUDIT_DATA={
  internal_audits:[
    {id:'a1',audit_date:'2026-07-25',scope:'Allergen control program',auditor:'External · NSF',status:'in_progress',summary:'Two findings open; corrective actions underway.'},
    {id:'a2',audit_date:'2026-06-15',scope:'Sanitation program / SQF 11.2',auditor:'Jane Smith (QA)',status:'closed',summary:'Both minor findings closed and verified.'}
  ],
  audit_findings:[
    {id:'f1',audit_id:'a1',clause:'2.5.2',description:'Allergen changeover log missing one entry on 7/24.',severity:'medium',status:'open',ncr_id:null,created_at:'2026-07-25'},
    {id:'f2',audit_id:'a2',clause:'11.2.3',description:'Sanitizer concentration not recorded for one shift.',severity:'minor',status:'closed',ncr_id:'n1',created_at:'2026-06-15'}
  ],
  management_reviews:[
    {id:'r1',review_date:'2026-06-30',attendees:'Mike Krail, QA Lead',notes:'Reviewed KPIs and open items; actions assigned.'}
  ],
  // seed the KPI snapshot with realistic counts
  compliance_records:[{has_deviation:true,status:'open'}],
  defects:[{status:'open'},{status:'open'}],
  vendors:[{approval_status:'approved'},{approval_status:'approved'},{approval_status:'approved'}],
  mock_recalls:[{passed:true},{passed:true}]
};

const AUD_TOKEN=[{inspector:'A. Nguyen',agency:'NSF · SQF',purpose:'Recertification audit',valid_until:'2027-12-31T00:00:00+00:00',revoked_at:null}];
const AUD_TPLS=[{form_code:'GMP-PREOP-001',title:'Pre-Op Sanitation',category:'sanitation'},{form_code:'GMP-CCP-PAST-001',title:'CCP — Pasteurizer',category:'ccp'},{form_code:'GMP-SEAM-001',title:'Double-Seam',category:'seam'},{form_code:'GMP-LABEL-001',title:'Label Reconciliation',category:'label'}];
const AUD_RECENT=[
  {form_code:'GMP-CCP-PAST-001',record_date:'2026-07-30',status:'signed',has_deviation:false,signature_name:'Mike Krail',data:{line:'Line 1'}},
  {form_code:'GMP-SEAM-001',record_date:'2026-07-30',status:'signed',has_deviation:false,signature_name:'Mike Krail',data:{line:'Line 1'}},
  {form_code:'GMP-LABEL-001',record_date:'2026-07-29',status:'signed',has_deviation:true,signature_name:'Mike Krail',data:{line:'Line 1'}}
];
const AUD_DEVS=[{form_code:'GMP-LABEL-001',record_date:'2026-07-29',deviation_notes:'Label reconciliation gap of 40 units',corrective_action:'Recounted; NCR raised and closed',data:{line:'Line 1'}}];
const AUD_VENDORS=[
  {name:'Bean Co.',category:'Ingredient',approval_status:'approved',food_safety_cert:'SQF',cert_expires:'2027-03-01',risk_level:'low',materials:'Cold brew concentrate'},
  {name:'CanWorks',category:'Packaging',approval_status:'approved',food_safety_cert:'BRC',cert_expires:'2026-11-15',risk_level:'low',materials:'Cans & ends'}
];
const AUD_DOCS=[
  {doc_code:'SOP-DS-01',title:'Double-Seam Integrity SOP',category:'SOP',description:'Monitoring, limits, corrective action',file_url:'#',file_type:'pdf',rev:'1.0'},
  {doc_code:'FSP-01',title:'HACCP / Food Safety Plan',category:'Plan',description:'Hazard analysis, CCPs, recall plan',file_url:'#',file_type:'pdf',rev:'1.0'}
];
function audMock(table,url){
  switch(table){
    case 'inspector_tokens': return AUD_TOKEN;
    case 'gmp_templates': return AUD_TPLS;
    case 'compliance_records': return /has_deviation=eq\.true/.test(url)?AUD_DEVS:AUD_RECENT;
    case 'vendors': return AUD_VENDORS;
    case 'gmp_documents': return AUD_DOCS;
    case 'internal_audits': return [{id:'a1',audit_date:'2026-06-15',scope:'Sanitation / SQF 11.2',auditor:'Jane Smith',status:'closed'}];
    case 'management_reviews': return [{id:'r1',review_date:'2026-06-30',attendees:'Mike Krail, QA'}];
    case 'mock_recalls': return [{id:'m1',lot_code:'CB-2041',pct_reconciled:99.6,passed:true,conducted_by:'Mike',initiated_at:'2026-07-10'}];
    case 'training_records': return [{employee_name:'Jane Smith',course:'HACCP Level 2',completed_date:'2025-09-01',expires_date:'2026-09-01'}];
    default: return [];
  }
}

// ── Core CRM sample data (Invoices / Pipeline / Clients) ──
const CORE_CLIENTS=[
  {id:'c1',name:'Perico Nutrition',contact:'Ana Perez',email:'ana@perico.co',service:'Canning',status:'active',billed:12400,color:'#00c4a7',tc:'#04231d',init:'PN',referredBy:null},
  {id:'c2',name:'Lotus Beverages',contact:'Sam Lee',email:'sam@lotus.co',service:'Bottling',status:'active',billed:5300,color:'#1a6fff',tc:'#ffffff',init:'LB',referredBy:null},
  {id:'c3',name:'Cold Brew Collective',contact:'Dana Wu',email:'dana@coldbrew.co',service:'Co-Packing',status:'lead',billed:0,color:'#f5c842',tc:'#04231d',init:'CB',referredBy:null}
];
const CORE_INVOICES=[
  {id:'GL-1042',clientName:'Perico Nutrition',client:'c1',svc:'Small Batch Canning',amount:3850,date:'2026-07-20',status:'pending'},
  {id:'GL-1041',clientName:'Lotus Beverages',client:'c2',svc:'Bottle Filling (750ml)',amount:5420,date:'2026-07-05',status:'overdue'},
  {id:'GL-1039',clientName:'Perico Nutrition',client:'c1',svc:'R&D / Formulation',amount:1500,date:'2026-06-28',status:'paid'},
  {id:'GL-1038',clientName:'Cold Brew Collective',client:'c3',svc:'Straight Co-Packing',amount:2760,date:'2026-06-15',status:'draft'},
  // GL-126: one part-paid invoice so the tutorials actually show the `partial`
  // badge and the "$X left" balance line. paidAmount is what the real app loads
  // from invoices.paid_amount, so the badge and every total render exactly as
  // they do in production.
  {id:'GL-1040',clientName:'Lotus Beverages',client:'c2',svc:'Small Batch Canning',amount:4200,date:'2026-07-12',status:'partial',paidAmount:1800}
];
const CORE_DEALS={
  'Prospecting':[{id:'d1',name:'Quote Request',co:'Perico Nutrition',contactName:'Ana Perez',email:'ana@perico.co',val:'$8,000',service:'Canning',createdAt:'2026-07-25'}],
  'Proposal':[{id:'d2',name:'12oz can run',co:'Lotus Beverages',contactName:'Sam Lee',email:'sam@lotus.co',val:'$14,500',service:'Bottling',createdAt:'2026-07-18'}],
  'Negotiation':[{id:'d3',name:'Annual co-pack',co:'Cold Brew Collective',contactName:'Dana Wu',val:'$42,000',service:'Co-Packing',createdAt:'2026-07-10'}],
  'Closed Won':[{id:'d4',name:'Sample run',co:'Perico Nutrition',val:'$3,200',createdAt:'2026-06-30'}],
  'Closed Lost':[]
};
const DASH_ACTS=[
  {type:'inv',icon:'🧾',name:'Invoice GL-1042 sent',detail:'Perico Nutrition · $3,850',time:'2h ago'},
  {type:'deal',icon:'📊',name:'Deal moved to Proposal',detail:'Lotus Beverages · 12oz can run',time:'Yesterday'},
  {type:'client',icon:'👥',name:'New brand added',detail:'Cold Brew Collective',time:'2d ago'},
  {type:'pay',icon:'💳',name:'Payment received',detail:'Perico Nutrition · $1,500',time:'3d ago'},
  {type:'note',icon:'📝',name:'Note added',detail:'Lotus — samples approved',time:'4d ago'}
];
const FORMULAS=[
  {id:'f1',name:'SunBurst Mango Seltzer',version:2,status:'approved',batch_size_gal:200,target_yield_cases:520,allergens:[],updated_at:'2026-07-10'},
  {id:'f2',name:'Cold Brew Concentrate',version:1,status:'approved',batch_size_gal:150,target_yield_cases:300,allergens:[],updated_at:'2026-06-28'},
  {id:'f3',name:'Oat Protein Shake',version:3,status:'draft',batch_size_gal:120,target_yield_cases:240,allergens:['Oats','Soy'],updated_at:'2026-07-22'}
];
const PROD_DATA={
  production_runs:[
    {id:'pr1',run_name:'Cold Brew R-2041',client_name:'Perico Nutrition',format:'12oz can',cases:520,stage:'Production',scheduled_start_date:'2026-07-15',lot_number:'CB-2041',production_line_id:'l1'},
    {id:'pr2',run_name:'Mango Seltzer R-2043',client_name:'Lotus Beverages',format:'12oz can',cases:800,stage:'Sample',scheduled_start_date:'2026-07-22',production_line_id:'l1'},
    {id:'pr3',run_name:'Oat Shake R-2044',client_name:'Cold Brew Collective',format:'8oz bottle',cases:300,stage:'Formulation',scheduled_start_date:'2026-07-28',production_line_id:'l2'}
  ],
  production_lines:[{id:'l1',name:'Line 1'},{id:'l2',name:'Line 2'}]
};
async function coreSetup(pg, page, opts){
  await pg.evaluate(({page,opts})=>{
    window.__chain({});                       // stub supa + admin currentUser (window)
    window.currentUser={id:'u1',email:'mike@krail.us',role:'admin',name:'Mike',initials:'MK'};
    var seed=window.__coreData;
    window.clients.length=0; seed.clients.forEach(c=>window.clients.push(c));
    window.invoices.length=0; seed.invoices.forEach(i=>window.invoices.push(i));
    Object.keys(window.deals).forEach(s=>{ window.deals[s].length=0; });
    Object.keys(seed.deals).forEach(s=>{ (seed.deals[s]||[]).forEach(d=>{ (window.deals[s]=window.deals[s]||[]).push(d); }); });
    if(typeof window.populateClientDropdown==='function'){ try{ window.populateClientDropdown(); }catch(e){} }
    // Remove any nav guards (unsaved-changes / permission checks that read the
    // real, null currentUser) so programmatic navigation isn't blocked.
    if(window.GL_HOOKS){ window.GL_HOOKS._navGuards=[]; }
    document.getElementById('crm-panel').classList.add('show');
    if(typeof window.cNav==='function') window.cNav(page);
    window.__hud();
  }, {page,opts:opts||{}});
}

const PORTAL_DATA={
  customer_users:[{id:'cu1',auth_user_id:'cust1',client_id:'c1',email:'ana@perico.co',display_name:'Ana — Perico Nutrition',active:true,role:'customer',notify_run_stage_changes:true}],
  clients:[{id:'c1',name:'Perico Nutrition',contact_name:'Ana Perez',contact_type:'Owner',email:'ana@perico.co',phone:'',street:'',city:'',state:'',zip:''}],
  invoices:[
    {id:'i1',client_id:'c1',invoice_number:'GL-1042',amount:3850,status:'pending',invoice_date:'2026-07-20',due_date:'2026-08-19',line_items:[],share_token:'t1'},
    {id:'i2',client_id:'c1',invoice_number:'GL-1039',amount:1500,status:'paid',invoice_date:'2026-06-28',due_date:'2026-07-28',line_items:[],share_token:'t2'}
  ],
  production_runs:[{id:'r1',client_id:'c1',run_name:'Cold Brew R-2041',format:'12oz can',cases:520,stage:'Production',scheduled_start_date:'2026-07-15',lot_number:'CB-2041',updated_at:'2026-07-16'}],
  lot_documents:[{id:'ld1',client_id:'c1',document_type:'COA',title:'COA — Cold Brew R-2041',lot_number:'CB-2041',file_name:'coa-cb2041.pdf',file_size:120000,file_path:'x',mime_type:'application/pdf',uploaded_at:'2026-07-16',production_run_id:'r1'}],
  client_artwork:[{id:'a1',client_id:'c1',sku_name:'Cold Brew 12oz',description:'Front panel design',file_path:'c1/artwork/1.png',file_type:'png'}],
  client_allergen_declarations:[],sample_shipments:[],formulas:[],customer_requests:[]
};

// ── Job intake (staff + portal), 2026-10-27 ──
// Demo data only: a fictional canning partner and fictional brands.
const JI_CLIENT={id:'cj',name:'Harbor Canning Co',contact_name:'Dev Patel',email:'dev@harborcanning.co'};
const JI_DOCS=[
  {id:'fd1',client_id:'cj',doc_type:'Formula',name:'Volt Energy Mango Peach v3.pdf',file_path:'cj/portal/f1.pdf',created_at:'2026-10-02T14:00:00Z',client_visible:true,project_id:null},
  {id:'fd2',client_id:'cj',doc_type:'Formula',name:'Brightwater Lime Seltzer.pdf',file_path:'cj/portal/f2.pdf',created_at:'2026-09-18T14:00:00Z',client_visible:true,project_id:null}
];
const JI_ROWS=[
  {id:'j3',job_no:1003,client_id:'cj',submitted_via:'portal',end_customer:'Volt Energy',product_name:'Mango Peach',job_type:'repeat',cases:420,can_size:'12oz_sleek',can_decoration:'printed',carbonation:'carbonated',co2_volumes:2.8,lid_color:'Black',tray_format:24,shrink_wrap:true,paktech:'4',paktech_color:'White',flash_pasteurize:true,preservative:'Potassium sorbate',pa_letter_on_file:true,client_supplies:['cans','lids'],fg_disposition:'warehouse',needed_by:'2026-11-14',expiration_date:'2027-11-14',batch_code:'VE1114A',notes:'Same spec as the September run.',formula_doc_id:'fd1',status:'submitted',created_at:'2026-10-27T13:05:00Z'},
  {id:'j2',job_no:1002,client_id:'cj',submitted_via:'portal',end_customer:'Brightwater Seltzer',product_name:'Lime',job_type:'new',cases:300,can_size:'12oz_standard',can_decoration:'sleeved',carbonation:'carbonated',co2_volumes:3.5,lid_color:'Silver',tray_format:12,shrink_wrap:true,paktech:'none',flash_pasteurize:false,preservative:'None (water)',client_supplies:['cans'],fg_disposition:'pickup',expiration_date:'2027-10-20',formula_doc_id:'fd2',status:'scheduled',created_at:'2026-10-20T15:30:00Z'}
];
function jiTables(){
  return {
    clients:[JI_CLIENT,{id:'c1',name:'Perico Nutrition'},{id:'c2',name:'Lotus Beverages'}],
    job_intakes:JSON.parse(JSON.stringify(JI_ROWS)),
    deal_documents:JSON.parse(JSON.stringify(JI_DOCS)),
    formulas:[{id:'fv1',name:'Volt Energy Original',version:2,client_id:'cj',client_name:'Harbor Canning Co'}],
    production_runs:PROD_DATA.production_runs, production_lines:PROD_DATA.production_lines
  };
}

// ── Quotes and invoice case trays, 2026-10-27 ──
// Rates match the live rate card (canning_rates / pricing_settings, Oct 2026).
const CANNING_RATES=[];
[['12oz-standard','12oz Standard',[0.48,0.43,0.38,0.35,0.31,0.28]],['12oz-sleek','12oz Sleek',[0.48,0.43,0.38,0.35,0.31,0.28]],['16oz-standard','16oz Standard',[0.58,0.53,0.48,0.45,0.41,0.38]]]
  .forEach(function(f){ [200,340,501,1000,2500,5000].forEach(function(m,i){ CANNING_RATES.push({format:f[0],format_label:f[1],min_cases:m,price_per_can:f[2][i]}); }); });
const PRICING_ROWS=[
  ['nitrogen_per_can','Canning add-ons','Nitrogen Dosing','per can',0.03,10],
  ['pasteurization_per_can','Canning add-ons','Batch Flash Pasteurization (12 oz)','per can',0.03,20],
  ['pasteurization_per_can_16','Canning add-ons','Batch Flash Pasteurization (16 oz)','per can',0.05,21],
  ['change_over_fee','Canning add-ons','Change Over Fee','per changeover',125,25],
  ['case_tray_12_per_case','Packaging','12-count Case Tray','per case',0.55,30],
  ['case_tray_24_per_case','Packaging','24-count Case Tray','per case',0.65,31],
  ['case_tray_shrinkwrap_per_case','Packaging','Shrink-wrap a Case Tray','per case',0.025,32],
  ['pallet_each','Pallet','Pallet','per pallet',12,50],
  ['pallet_wrap_each','Pallet','Pallet Shrink Wrap','per pallet',8,60],
  ['cases_per_pallet','Pallet','Cases per Pallet','cases',80,70],
  ['bottling_pasteurization_per_btl','Bottling add-ons','Batch Flash Pasteurization','per bottle',0.20,140]
].map(function(r){ return {key:r[0],category:r[1],label:r[2],unit:r[3],value:r[4],sort_order:r[5]}; });
const QUOTE_ROWS=[
  {id:'q1',quote_number:'GLQ-202610-041',quote_date:'2026-10-21',valid_days:7,status:'sent',package_format:'12oz Sleek',client_id:'c1',client_name:'Perico Nutrition',client_email:'ana@perico.co',sent_at:'2026-10-21T15:00:00Z',sent_to:'ana@perico.co',created_at:'2026-10-21T14:50:00Z',
   sections:[{productType:'canning',format:'12oz Sleek',tiers:[{cases:500,cans:12000,fillPerCan:0.43}],pkg:{},bpkg:{},lines:[]}],custom_lines:[]},
  {id:'q2',quote_number:'GLQ-202610-042',quote_date:'2026-10-24',valid_days:7,status:'draft',package_format:'16oz Standard',client_id:'c2',client_name:'Lotus Beverages',client_email:'sam@lotus.co',created_at:'2026-10-24T16:10:00Z',
   sections:[{productType:'canning',format:'16oz Standard',tiers:[{cases:1000,cans:24000,fillPerCan:0.45}],pkg:{},bpkg:{},lines:[]}],custom_lines:[]},
  {id:'q3',quote_number:'GLQ-202610-039',quote_date:'2026-10-10',valid_days:7,status:'accepted',package_format:'12oz Standard',client_id:'c1',client_name:'Perico Nutrition',client_email:'ana@perico.co',sent_at:'2026-10-10T13:00:00Z',created_at:'2026-10-10T12:40:00Z',sections:[],custom_lines:[]},
  {id:'q4',quote_number:'GLQ-202610-037',quote_date:'2026-10-06',valid_days:7,status:'declined',package_format:'12oz Sleek',client_id:null,client_name:'Cold Brew Collective',client_email:'dana@coldbrew.co',sent_at:'2026-10-06T13:00:00Z',created_at:'2026-10-06T12:40:00Z',sections:[],custom_lines:[]}
];

// ── Agreements and e-signatures, 2026-10-27 ──
// Short demo templates. The real ones live in agreement_templates and are
// edited from AI Tools, Agreement Templates.
const AGR_TEMPLATES=[
  {kind:'nda',title:'Mutual Nondisclosure Agreement',body:'# Mutual Nondisclosure Agreement\n\nThis Mutual Nondisclosure Agreement is made on {{effective_date}} between {{gl_legal_name}}, {{gl_address}}, and {{client_legal_name}}, {{client_address}}.\n\n## Confidential Information\n\nEach party may share formulas, pricing, and business plans. The receiving party keeps them confidential and uses them only to evaluate and perform work together.\n\n## Term\n\nThese obligations last for three years from the effective date.\n\n[[SIGNATURES]]'},
  {kind:'manufacturing',title:'Contract Manufacturing Agreement',body:'# Contract Manufacturing Agreement\n\nThis Contract Manufacturing Agreement is made on {{effective_date}} between {{gl_legal_name}}, {{gl_address}} (the Manufacturer), and {{client_legal_name}}, {{client_address}} (the Client).\n\n## Services\n\nThe Manufacturer will batch, fill, and package the Client\'s products to the specifications in each accepted quote.\n\n## Term\n\nThis agreement runs for {{term_years}} year(s) from the effective date and renews unless either party gives notice.\n\n## Formulas and Ownership\n\nEach party keeps ownership of its own formulas, trademarks, and know how.\n\n[[SIGNATURES]]'}
];
const AGR_ROWS=[
  {id:'ag1',kind:'nda',title:'Mutual Nondisclosure Agreement, Perico Nutrition LLC',status:'signed',party_name:'Perico Nutrition LLC',client_id:'c1',deal_id:null,sent_to:'ana@perico.co',sent_at:'2026-10-06T14:00:00Z',signed_at:'2026-10-07T16:20:00Z',created_at:'2026-10-06T13:55:00Z',created_by_name:'Mike',document_id:'dd1',signed_document_id:'dd2',body:''},
  {id:'ag2',kind:'nda',title:'Mutual Nondisclosure Agreement, Perico Nutrition LLC (new flavors)',status:'sent',party_name:'Perico Nutrition LLC',client_id:'c1',sent_to:'ana@perico.co',sent_at:'2026-10-20T15:00:00Z',signed_at:null,created_at:'2026-10-20T14:58:00Z',created_by_name:'Mike',document_id:'dd3',signed_document_id:null,body:''}
];
const AGR_SIGNERS=[
  {agreement_id:'ag1',role:'client',sign_order:1,name:'Ana Perez',email:'ana@perico.co',status:'signed',signed_at:'2026-10-07T15:02:00Z'},
  {agreement_id:'ag1',role:'gl',sign_order:2,name:'Mike Krail',email:'mike@goodliquid.com',status:'signed',signed_at:'2026-10-07T16:20:00Z'},
  {agreement_id:'ag2',role:'client',sign_order:1,name:'Ana Perez',email:'ana@perico.co',status:'viewed',viewed_at:'2026-10-21T13:10:00Z'},
  {agreement_id:'ag2',role:'gl',sign_order:2,name:'Mike Krail',email:'mike@goodliquid.com',status:'waiting'}
];
const SIGN_BODY=AGR_TEMPLATES[1].body
  .replace(/\{\{effective_date\}\}/g,'October 27, 2026').replace(/\{\{gl_legal_name\}\}/g,'Good Liquid Bev Co')
  .replace(/\{\{gl_address\}\}/g,'2011 51st Ave E, Unit 100, Palmetto, FL 34221').replace(/\{\{client_legal_name\}\}/g,'Perico Nutrition LLC')
  .replace(/\{\{client_address\}\}/g,'100 Main St, Tampa, FL 33602').replace(/\{\{term_years\}\}/g,'2').replace('[[SIGNATURES]]','');

// ── Lead questionnaire, 2026-10-27 ──
const QN_ANSWERS={company:'Cold Brew Collective',first_name:'Dana',last_name:'Wu',role:'Founder',email:'dana@coldbrew.co',phone:'813 555 0142',
  product_description:'A sparkling yerba mate energy drink, lightly sweetened with cane sugar.',product_category:'Energy drink',carbonation:'Fully carbonated',flavors:'3',contains_alcohol:'No',
  formula_status:'Finished commercial formula, ready to scale',ingredients:'Carbonated water, cane sugar, yerba mate extract, citric acid, natural flavor, potassium sorbate',low_acid:'No',ph_known:'Below 4.6 (acidic)',preservative:'Yes, potassium sorbate',allergens:['None'],process_authority:'In progress',
  target_volume:'500 to 999 cases',format:'12oz sleek can',label_type:'Printed cans',artwork_status:'Print ready artwork',secondary_packaging:['24 count trays','4 pack carriers (PakTech)'],timeline:'1 to 3 months',
  sales_channels:['Retail','Online'],storage_needed:'Yes',shelf_stability:'Shelf stable / ambient'};
const QN_TOKEN='3f9a1c7e5b2d4f608a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d';

const STORYBOARDS={
  questionnaire:{
    title:'The Project Questionnaire: Everything You Need to Quote',
    seedCore:true,
    async setup(pg){
      await coreSetup(pg,'pipeline');
      await pg.evaluate((D)=>{
        window.__chain(D.tables);
        window.__rpc={ gl_questionnaire_link:function(){ return D.token; } };
      }, {token:QN_TOKEN, tables:{product_intake:[{id:'pi1',deal_id:'d1',email:'ana@perico.co',answers:Object.assign({},QN_ANSWERS,{company:'Perico Nutrition',first_name:'Ana',last_name:'Perez',email:'ana@perico.co'}),source:'questionnaire',submitted_at:'2026-10-25T14:00:00Z',updated_at:'2026-10-25T14:00:00Z'}]}});
      await sleep(500); await pg.evaluate(()=>window.__hud());
    },
    steps:[
      {say:"Before you quote a new brand, you need the same answers every time. The project questionnaire collects them, and it now lives right on the pipeline deal."},
      {say:"Open a deal.", act:{type:'click',sel:'.kcard:has-text("Quote Request")'}},
      {say:"Under the A I brief is Product Intake. These are the lead's answers, grouped the same way as the emailed questionnaire: brand and product, formula and ingredients, run size and packaging, and sales.", act:{type:'move',sel:'#ddp-intake'}},
      {say:"Run size and packaging tells you the format, case packing, and timeline you need to quote.", act:{type:'move',sel:'#ddp-intake >> text=RUN SIZE & PACKAGING'}},
      {say:"To send a lead the web version, click Copy questionnaire link, and paste it into your email.", act:{type:'click',sel:'#gl-intake-link'}},
      {say:"The link is private to this deal. The lead can open it again later to update their answers.", act:{type:'move',sel:'#gl-intake-link-msg'}},
      {say:"When they submit, you get an alert, and the answers land here under Intake. Answers that come back by email can be typed in with Edit intake, field for field.", act:{type:'move',sel:'#gl-intake-edit'}},
      {say:"The budget question is optional. Never hold a quote over it.", act:{type:'move',sel:'#ddp-intake'}},
      {say:"And when the lead becomes a client, click Convert to Client. The intake answers move to the client's record automatically, so nothing has to be asked twice.", act:{type:'move',sel:'[data-gl-action="glConvertLeadToOnboarding"]'}}
    ]
  },
  'questionnaire-form':{
    title:'The Questionnaire: What Your Lead Sees',
    url:'/questionnaire.html?t='+QN_TOKEN,
    mockRest:function(table,u){
      if(/gl_questionnaire_get/.test(u)) return {ok:true,submitted:false,company:'Cold Brew Collective',contact_name:'Dana Wu',email:'dana@coldbrew.co',phone:'813 555 0142',answers:{}};
      if(/gl_questionnaire_submit/.test(u)) return {ok:true,intake_id:'pi9'};
      return [];
    },
    steps:[
      {say:"This is the questionnaire your lead opens from the link you send. There is no login, and their name, company, email, and phone are already filled in."},
      {say:"It is addressed to them by name.", act:{type:'move',sel:'#hi'}},
      {say:"They describe the product in their own words.", act:{type:'type',sel:'#gi-product_description',text:'A sparkling yerba mate energy drink, lightly sweetened.'}},
      {say:"Pick the category.", act:{type:'select',sel:'#gi-product_category',label:'Energy drink'}},
      {say:"Carbonated or still.", act:{type:'select',sel:'#gi-carbonation',label:'Fully carbonated'}},
      {say:"And the preservative. Every product you run must have one, and the form says so up front.", act:{type:'select',sel:'#gi-preservative',label:'Yes, potassium sorbate'}},
      {say:"They work down the rest: formula, ingredients, Process Authority letter, run size, package format, decoration, case packing, and timeline.", act:{type:'js',fn:(A)=>{
        Object.keys(A).forEach(function(k){
          var e=document.getElementById('gi-'+k); if(!e) return; var v=A[k];
          if(e.tagName==='DIV'){ (Array.isArray(v)?v:[v]).forEach(function(x){ var b=e.querySelector('input[value="'+x+'"]'); if(b && !b.checked){ b.checked=true; b.dispatchEvent(new Event('change',{bubbles:true})); } }); return; }
          if(e.value) return;
          e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}));
        });
        var s=document.getElementById('gi-target_volume'); if(s) s.scrollIntoView({block:'center'});
      }, arg:QN_ANSWERS}},
      {say:"The budget question is optional, so it never stops them from submitting.", act:{type:'move',sel:'#gi-budget'}},
      {say:"Then they click Submit questionnaire.", act:{type:'click',sel:'#submit-btn'}},
      {say:"Done. Their answers go straight onto the deal in your C R M, and you get an alert. If anything changes, they open the same link and update it.", act:{type:'move',sel:'#done'}}
    ]
  },
  agreements:{
    title:'Agreements: NDAs and Manufacturing Agreements with E-Signatures',
    seedCore:true,
    async setup(pg){
      await coreSetup(pg,'clients');
      await pg.evaluate((D)=>{
        window.__chain(D);
        window.__fn={ 'agreement-sign':function(){ return {ok:true, sent_to:'ana@perico.co'}; } };
        window.currentUser={id:'u1',email:'mike@goodliquid.com',role:'admin',name:'Mike Krail',initials:'MK'};
        var c=window.clients.filter(function(x){ return x.id==='c1'; })[0];
        if(c){ c.legalName='Perico Nutrition LLC'; c.street='100 Main St'; c.city='Tampa'; c.state='FL'; c.zip='33602'; c.contact='Ana Perez'; }
      }, {agreement_templates:AGR_TEMPLATES, agreements:JSON.parse(JSON.stringify(AGR_ROWS)), agreement_signers:AGR_SIGNERS, deal_documents:[]});
      await sleep(500); await pg.evaluate(()=>window.__hud());
    },
    steps:[
      {say:"You can now write NDAs and manufacturing agreements right in the C R M, and have them signed electronically. No more Word files and no outside signing service."},
      {say:"On the Clients page, click Agreements next to a client. The same button is on a pipeline deal and on the client's record.", act:{type:'click',sel:'[data-gl-action="glAgreementsForClient"][data-gl-arg1="c1"]'}},
      {say:"On file lists every agreement for this client, and where it stands: draft, sent for signature, signed, declined, or void.", act:{type:'move',sel:'#gl-agr-modal >> text=ON FILE'}},
      {say:"Each one shows who has signed and when, and who is still waiting. View signed opens the final copy.", act:{type:'move',sel:'#gl-agr-modal >> text=Signed'}},
      {say:"To make a new one, pick the kind: a mutual N D A, or a manufacturing agreement.", act:{type:'click',sel:'#gl-agr-modal button:has-text("Manufacturing Agreement")'}},
      {say:"The fields fill in from the client's record and from your own company details. Anything required that is still blank is highlighted in yellow.", act:{type:'move',sel:'input[data-agr-field="client_legal_name"]'}},
      {say:"For a manufacturing agreement, set the term in years.", act:{type:'fill',sel:'input[data-agr-field="term_years"]',text:'2'}},
      {say:"Click Generate draft.", act:{type:'click',sel:'#gl-agr-modal button:has-text("Generate draft")'}},
      {say:"The draft appears with a live preview. You can edit the text for this one client without changing your template.", act:{type:'move',sel:'#gl-agr-modal >> text=DOCUMENT'}},
      {say:"Then download the P D F, save it to the client's documents, or send it for e-signature.", act:{type:'move',sel:'#gl-agr-modal button:has-text("Send for e-signature")'}},
      {say:"Sending emails the client a private signing link. They sign first, then you countersign, and the signed copy files itself under the client's documents and shows up in their portal."},
      {say:"Your standard wording lives in Agreement Templates under A I Tools. Change it there once, and every new agreement uses it."}
    ]
  },
  'agreement-signing':{
    title:'Signing an Agreement: What Your Client Sees',
    url:'/sign.html#t=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    async routes(pg){
      const body=SIGN_BODY;
      await pg.route('**/functions/v1/agreement-sign', async route=>{
        const h={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST, OPTIONS'};
        if(route.request().method()==='OPTIONS') return route.fulfill({status:204,headers:h,body:''});
        let a='view'; try { a=(route.request().postDataJSON()||{}).action||'view'; } catch(e){}
        const out = a==='sign' ? {ok:true,signed:true,complete:false}
          : {ok:true,title:'Contract Manufacturing Agreement, Perico Nutrition LLC',body:body,
             signer:{name:'Ana Perez',email:'ana@perico.co',title:'Owner',role:'client'},
             parties:{good_liquid:'Good Liquid Bev Co',company:'Perico Nutrition LLC'},
             consent_text:'I agree to use electronic records and signatures, and I intend my typed name below to be my legal signature on this agreement, with the same effect as a handwritten signature (U.S. ESIGN Act, 15 U.S.C. 7001 et seq.; Florida Uniform Electronic Transaction Act, Fla. Stat. 668.50).'};
        return route.fulfill({status:200,headers:Object.assign({'Content-Type':'application/json'},h),body:JSON.stringify(out)});
      });
    },
    steps:[
      {say:"This is what your client sees when they open the signing link from their email. There is no login. The private link is the key."},
      {say:"At the top: the agreement, who it is between, and who is signing.", act:{type:'move',sel:'#doc-title'}},
      {say:"Below that, the full agreement to read.", act:{type:'move',sel:'#doc-body'}},
      {say:"At the bottom, they agree to sign electronically.", act:{type:'check',sel:'#consent'}},
      {say:"Their typed name becomes their signature. It is filled in for them, and they can correct it.", act:{type:'move',sel:'#typed'}},
      {say:"Then they click Sign agreement.", act:{type:'click',sel:'#sign-btn'}},
      {say:"Done. Good Liquid countersigns next, and once everyone has signed, both sides get the signed copy by email.", act:{type:'move',sel:'#done-title'}},
      {say:"If they do not want to sign, they can decline and give a reason, and you see that on the agreement in the C R M."}
    ]
  },
  quotes:{
    title:'Quotes: Build, Send, and Track Every Quote',
    seedCore:true,
    async setup(pg){
      await coreSetup(pg,'pipeline');
      await pg.evaluate((D)=>{
        window.__chain(D);
        window.__rpc={ gl_next_quote_number:function(){ return 'GLQ-202610-043'; } };
        window._glPricingLoaded=false;
      }, {quotes:JSON.parse(JSON.stringify(QUOTE_ROWS)), pricing_settings:PRICING_ROWS, canning_rates:CANNING_RATES});
      await sleep(600); await pg.evaluate(()=>window.__hud());
    },
    steps:[
      {say:"Quotes live on the Pipeline page. There are two buttons at the top: Quote Builder makes a new quote, and Quotes lists every quote you have saved."},
      {say:"Click Quotes.", act:{type:'click',sel:'#gl-pipeline-quotes-list-btn'}},
      {say:"This is every saved quote, including ones not linked to a client or deal yet. It opens on the quotes you have sent.", act:{type:'move',sel:'#gl-ql-list'}},
      {say:"Filter by Sent, Draft, Accepted, or Declined. Let's show them all.", act:{type:'click',sel:'button.gl-ql-f[data-f="all"]'}},
      {say:"Search by company, email, or quote number.", act:{type:'type',sel:'#gl-ql-search',text:'Lotus'}},
      {say:"Change a quote's status right on the row. This draft has gone out, so mark it Sent.", act:{type:'select',sel:'select.gl-ql-status[data-qid="q2"]',value:'sent'}},
      {say:"Accepted is set from the client's record, because accepting a quote can unlock services in their portal. So here it shows locked.", act:{type:'move',sel:'#gl-ql-filters'}},
      {say:"When a quote turns into a job, click Invoice. The invoice builder opens with the quote's lines already on it. If the quote has no client yet, it asks which client first.", act:{type:'move',sel:'button.gl-ql-inv'}},
      {say:"Now let's build a new quote. Click New Quote.", act:{type:'click',sel:'#gl-ql-new'}},
      {say:"Enter who it is for.", act:{type:'type',sel:'#gl-qb-client-name',text:'Brightwater Seltzer'}},
      {say:"And their email.", act:{type:'type',sel:'#gl-qb-client-email',text:'hello@brightwater.co'}},
      {say:"Pick the can format.", act:{type:'fill',sel:'#gl-qb-fmt',text:'12oz Sleek'}},
      {say:"New: choose a twenty four or twelve count case tray. Switching trays keeps the number of cans the same and changes the case count to match.", act:{type:'select',sel:'#gl-qb-tray',value:'12'}},
      {say:"Load the standard volume tiers with one click. Each tier is priced from your rate card.", act:{type:'click',sel:'#gl-qb-auto-tiers'}},
      {say:"Add flash pasteurization. It is priced by can size: three cents a can on twelve ounce cans.", act:{type:'check',sel:'#gl-qb-pasteur-on'}},
      {say:"Switch the format to sixteen ounce, and pasteurization moves to five cents a can on its own.", act:{type:'fill',sel:'#gl-qb-fmt',text:'16oz Standard'}},
      {say:"The change over fee is one hundred twenty five dollars per changeover.", act:{type:'move',sel:'#gl-qb-changeover-on'}},
      {say:"Each tier shows its run total, and you can override any price on the line.", act:{type:'move',sel:'#gl-qb-tbody'}},
      {say:"For bottling, choose six or twelve bottles per case. Bottling is priced by total bottles, so the price per bottle does not change with the case size.", act:{type:'select',sel:'#gl-qb-type',value:'bottling'}},
      {say:"Load the bottling tiers.", act:{type:'click',sel:'#gl-qb-auto-tiers'}},
      {say:"Here is the bottles per case setting, on each tier.", act:{type:'move',sel:'#gl-qb-tiers [data-tier-field="perCase"]'}},
      {say:"When it looks right, save it, email it, or save it and create the invoice. The quote number comes from the C R M in order, so numbers never repeat.", act:{type:'move',sel:'#gl-qb-send-email'}},
      {say:"Tip: open a deal on the Pipeline and click New Quote, and the builder fills in the company, email, product, and volume from the deal for you."}
    ]
  },
  'job-intake':{
    title:'Job Intake: One Spec Sheet for Every Production Job',
    async setup(pg){
      await pg.evaluate(async(D)=>{
        window.__chain(D);
        window.__insertDefaults={ job_intakes:function(){ return { job_no:1004, status:'submitted', created_at:new Date().toISOString() }; } };
        window.currentUser={id:'u1',email:'mike@krail.us',role:'admin',name:'Mike',initials:'MK'};
        if(window.GL_HOOKS){ window.GL_HOOKS._navGuards=[]; }
        document.getElementById('crm-panel').classList.add('show');
        window.cNav('production-runs');
        window.__hud();
      }, jiTables());
      await sleep(1000); await pg.evaluate(()=>window.__hud());
    },
    steps:[
      {say:"Every production job now starts with one form: the Job Intake. It holds the full spec for the run and the formula, all in one place, so nothing gets lost in emails and texts."},
      {say:"Your canning partners fill it out from their customer portal. On your side, the jobs land in Production Runs. Click Job Intakes.", act:{type:'click',sel:'button:has-text("Job Intakes"):visible'}},
      {say:"Each job gets its own number, so everyone can refer to it the same way. You see who sent it, the end customer, and the product.", act:{type:'move',sel:'#gl-ji-rows > div:has-text("JOB #1003")'}},
      {say:"Underneath is the whole spec: cases and cans, can size and decoration, carbonation, lid color, case tray, shrink wrap, PakTechs, the expiration date and batch code, and what the client is supplying.", act:{type:'move',sel:'#gl-ji-rows > div:has-text("JOB #1003") >> text=Lid color'}},
      {say:"The formula is attached to every job. A job cannot be submitted without one. Click it to open the file.", act:{type:'move',sel:'#gl-ji-rows > div:has-text("JOB #1003") .gl-ji-fopen'}},
      {say:"As the job moves along, change its status: Submitted, Reviewed, Scheduled, Completed, or Cancelled. Let's mark this one Reviewed.", act:{type:'select',sel:'select.gl-ji-status[data-id="j3"]',value:'reviewed'}},
      {say:"Keep internal notes on the job. Your partner never sees these.", act:{type:'type',sel:'.gl-ji-snote[data-id="j3"]',text:'Cans arrive Nov 3'}},
      {say:"Then save the note.", act:{type:'click',sel:'.gl-ji-snote-save[data-id="j3"]'}},
      {say:"The list opens on open jobs. Use the filter to see completed or cancelled ones, or search by client, brand, or job number.", act:{type:'move',sel:'#gl-ji-fstatus'}},
      {say:"If a partner sends a job by email instead, enter it yourself with New job.", act:{type:'click',sel:'#gl-ji-new'}},
      {say:"Pick the client the job is for.", act:{type:'select',sel:'#gl-ji-client',value:'cj'}},
      {say:"Enter the end customer, the brand the product is for.", act:{type:'type',sel:'#gl-ji-endcust',text:'Volt Energy'}},
      {say:"Then the product or flavor.", act:{type:'type',sel:'#gl-ji-product',text:'Blue Razz'}},
      {say:"Is it a new product, or a repeat run?", act:{type:'select',sel:'#gl-ji-jobtype',value:'new'}},
      {say:"How many cases.", act:{type:'type',sel:'#gl-ji-cases',text:'500'}},
      {say:"Now the packaging. The can size.", act:{type:'select',sel:'#gl-ji-can',value:'12oz_sleek'}},
      {say:"Printed cans, shrink sleeved, or brite.", act:{type:'select',sel:'#gl-ji-deco',value:'printed'}},
      {say:"The lid color.", act:{type:'type',sel:'#gl-ji-lid',text:'Black'}},
      {say:"A twelve or twenty four count case tray, and whether the trays get shrink wrapped.", act:{type:'select',sel:'#gl-ji-tray',value:'24'}},
      {say:"Yes, shrink wrap them.", act:{type:'select',sel:'#gl-ji-shrink',value:'yes'}},
      {say:"PakTechs: none, four pack, or six pack. Choosing one opens the PakTech color.", act:{type:'select',sel:'#gl-ji-pak',value:'4'}},
      {say:"Next, the coding printed on the can. The expiration date is required.", act:{type:'fill',sel:'#gl-ji-exp',text:'2027-11-15'}},
      {say:"A batch code is optional. Fill it in only if the client wants one.", act:{type:'type',sel:'#gl-ji-batch',text:'VE1115A'}},
      {say:"Now the liquid. Carbonated jobs ask for the target volumes of C O 2. Still jobs are nitrogen dosed.", act:{type:'select',sel:'#gl-ji-carb',value:'carbonated'}},
      {say:"Two point eight volumes.", act:{type:'type',sel:'#gl-ji-co2',text:'2.8'}},
      {say:"Then the formula. Upload the file, or pick one already on file for this client.", act:{type:'click',sel:'input[name="gl-ji-fsrc"][value="onfile"]'}},
      {say:"Here are the formulas on file. Choose the right one.", act:{type:'select',sel:'#gl-ji-fdoc',value:'fd1'}},
      {say:"Tick what the client is supplying, so you know what to order.", act:{type:'check',sel:'.gl-ji-supply[value="cans"]'}},
      {say:"Submit the job.", act:{type:'click',sel:'#gl-ji-send'}},
      {say:"It gets the next job number, and the full spec is emailed to you right away. Every job, every time, in the same format."}
    ]
  },
  'job-intake-portal':{
    title:'Job Intake from the Customer Portal',
    url:'/index.html?portal=1',
    async setup(pg){
      await pg.evaluate(async(D)=>{
        window.__chain(D);
        window.__insertDefaults={ job_intakes:function(){ return { job_no:1004, status:'submitted' }; } };
        window.supa.auth.getSession=async()=>({data:{session:{user:{id:'cust1'}}}});
        window.currentUser=null;
        await window.glCheckPortal();
      }, {
        customer_users:[{id:'cu1',auth_user_id:'cust1',client_id:'cj',email:'dev@harborcanning.co',display_name:'Dev, Harbor Canning Co',active:true,role:'customer'}],
        clients:[{id:'cj',name:'Harbor Canning Co',contact_name:'Dev Patel',email:'dev@harborcanning.co'}],
        deal_documents:JSON.parse(JSON.stringify(JI_DOCS)),
        job_intakes:[], invoices:[], production_runs:[], lot_documents:[], client_artwork:[], client_allergen_declarations:[], sample_shipments:[], formulas:[], customer_requests:[]
      });
      await sleep(1400);
      await pg.evaluate(()=>window.__hud());
    },
    steps:[
      {say:"This is the customer portal, as your canning partner sees it. Every production job they send you starts here."},
      {say:"Click New production job.", act:{type:'click',sel:'[data-gl-action="glOpenJobIntakeForm"]'}},
      {say:"The form asks for everything you need to run the job. Fields with a red star are required.", act:{type:'move',sel:'#gl-ji-form >> text=NEW PRODUCTION JOB'}},
      {say:"The end customer.", act:{type:'type',sel:'#gl-ji-endcust',text:'Brightwater Seltzer'}},
      {say:"The product.", act:{type:'type',sel:'#gl-ji-product',text:'Lime'}},
      {say:"This one is a repeat run.", act:{type:'select',sel:'#gl-ji-jobtype',value:'repeat'}},
      {say:"Three hundred cases.", act:{type:'type',sel:'#gl-ji-cases',text:'300'}},
      {say:"Twelve ounce standard cans, shrink sleeved.", act:{type:'select',sel:'#gl-ji-can',value:'12oz_standard'}},
      {say:"Shrink sleeved.", act:{type:'select',sel:'#gl-ji-deco',value:'sleeved'}},
      {say:"Silver lids.", act:{type:'type',sel:'#gl-ji-lid',text:'Silver'}},
      {say:"Twelve count trays.", act:{type:'select',sel:'#gl-ji-tray',value:'12'}},
      {say:"Shrink wrapped.", act:{type:'select',sel:'#gl-ji-shrink',value:'yes'}},
      {say:"The expiration date to print on the cans is required. A batch code is optional, so leave it blank if you do not need one.", act:{type:'fill',sel:'#gl-ji-exp',text:'2027-10-31'}},
      {say:"Carbonated, at three point five volumes.", act:{type:'select',sel:'#gl-ji-carb',value:'carbonated'}},
      {say:"Three point five.", act:{type:'type',sel:'#gl-ji-co2',text:'3.5'}},
      {say:"Every job needs its formula. For a repeat run, pick the one already on file. For something new, upload the file right here.", act:{type:'click',sel:'input[name="gl-ji-fsrc"][value="onfile"]'}},
      {say:"Choose the formula.", act:{type:'select',sel:'#gl-ji-fdoc',value:'fd2'}},
      {say:"Add anything else the team should know in the notes, then submit.", act:{type:'click',sel:'#gl-ji-send'}},
      {say:"The job gets its number, and Good Liquid has the full spec by email the moment it is submitted. No more chasing details."}
    ]
  },
  dashboard:{
    title:'Dashboard — Your Business at a Glance',
    async setup(pg){
      await pg.evaluate(({clients,invoices,deals,acts})=>{
        window.__chain({});
        window.currentUser={id:'u1',email:'mike@krail.us',role:'admin',name:'Mike',initials:'MK'};
        window.clients.length=0; clients.forEach(c=>window.clients.push(c));
        window.invoices.length=0; invoices.forEach(i=>window.invoices.push(i));
        Object.keys(window.deals).forEach(s=>{ window.deals[s].length=0; });
        Object.keys(deals).forEach(s=>{ (deals[s]||[]).forEach(d=>{ (window.deals[s]=window.deals[s]||[]).push(d); }); });
        if(window.activities){ window.activities.length=0; acts.forEach(a=>window.activities.push(a)); }
        if(window.GL_HOOKS){ window.GL_HOOKS._navGuards=[]; }
        document.getElementById('crm-panel').classList.add('show');
        window.cNav('dashboard');
        if(typeof window.renderDash==='function') window.renderDash();
        // de-dupe the audit-readiness scorecard if it mounted more than once
        var sc=document.querySelectorAll('#gl-audit-scorecard'); for(var i=1;i<sc.length;i++) sc[i].remove();
        window.__hud();
      }, {clients:CORE_CLIENTS,invoices:CORE_INVOICES,deals:CORE_DEALS,acts:DASH_ACTS});
      await sleep(500); await pg.evaluate(()=>{ var sc=document.querySelectorAll('#gl-audit-scorecard'); for(var i=1;i<sc.length;i++) sc[i].remove(); window.__hud(); });
    },
    steps:[
      {say:"The Dashboard is your home screen — the health of the whole business in a single glance. Most people start their day right here."},
      {say:"Right at the top, an F D A audit-readiness scorecard grades how prepared you are — a green check for each thing that's handled, and a nudge for anything that still needs attention.", act:{type:'move',sel:'#gl-audit-scorecard'}},
      {say:"Your key financial numbers are here too: how much you've collected, what's still pending, what's gone overdue, and how many active brands you're working with.", act:{type:'move',sel:'#dash-metrics'}},
      {say:"A pipeline snapshot shows how your open deals are spread across the stages — an instant read on what's coming.", act:{type:'move',sel:'#pipe-snap'}},
      {say:"And a live activity feed shows the latest across the CRM — invoices sent, payments received, and deals moving.", act:{type:'move',sel:'#dash-act'}},
      {say:"One screen, the whole picture — compliance, money, and sales together. From here you see what needs attention and jump straight to it."}
    ]
  },
  'formula-vault':{
    title:'Formula Vault — Every Recipe, Versioned',
    async setup(pg){
      await pg.evaluate((formulas)=>{
        window.__chain({formulas:formulas.map(f=>Object.assign({},f))});  // refresh() reloads from supa
        window.currentUser={id:'u1',email:'mike@krail.us',role:'admin',name:'Mike',initials:'MK'};
        window.glFormulas=formulas.map(f=>Object.assign({},f));
        if(window.GL_HOOKS){ window.GL_HOOKS._navGuards=[]; }
        document.getElementById('crm-panel').classList.add('show');
        window.cNav('formulas');
        window.__hud();
      }, FORMULAS);
      await sleep(700); await pg.evaluate(()=>window.__hud());
    },
    steps:[
      {say:"The Formula Vault is where every product recipe lives — versioned, and kept in one secure place instead of scattered across spreadsheets."},
      {say:"Each formula shows its name, its version number, and its status — draft, or approved.", act:{type:'move',sel:'#cpg-formulas'}},
      {say:"Because it's versioned, every change is tracked. You can approve a formula, then clone it as the next version to iterate — so your history is never lost.", act:{type:'move',sel:'#cpg-formulas'}},
      {say:"Open any formula to see its full details.", act:{type:'click',sel:'tr:has-text("SunBurst Mango Seltzer")'}},
      {say:"Its name, version, status, batch size, target yield, and the allergens it carries — all captured, and all under version control.", act:{type:'move',sel:'#gl-fv-name'}},
      {say:"So R&D and production always work from the same, current recipe — no confusion, and no lost history."}
    ]
  },
  'production-runs':{
    title:'Production Runs — Your Production Schedule',
    async setup(pg){
      await pg.evaluate(async(data)=>{
        window.__chain(JSON.parse(JSON.stringify(data)));
        window.currentUser={id:'u1',email:'mike@krail.us',role:'admin',name:'Mike',initials:'MK'};
        if(window.GL_HOOKS){ window.GL_HOOKS._navGuards=[]; }
        document.getElementById('crm-panel').classList.add('show');
        window.cNav('production-runs');
        window.__hud();
      }, PROD_DATA);
      await sleep(1000); await pg.evaluate(()=>window.__hud());
    },
    steps:[
      {say:"The Production Runs board is your production schedule — every batch, and exactly where it stands in your process."},
      {say:"Runs are organized by stage, from Discovery and Formulation, through Sample and COA, all the way to Production and Ship.", act:{type:'move',sel:'#cpg-production-runs'}},
      {say:"Each card is one run — the brand, the product format, the case count, and its scheduled date.", act:{type:'move',sel:'text=Cold Brew R-2041'}},
      {say:"To schedule a new run, click Add Run.", act:{type:'click',sel:'button:has-text("Add Run"):visible'}},
      {say:"You pick the brand, the line, and the dates — and the board even warns you if two runs would collide on the same line at the same time."},
      {say:"It's the single shared view your operations team runs the floor by — and it feeds the production stage your customers see in their portal."}
    ]
  },
  portal:{
    title:'Customer Portal — Your Clients’ Private Login',
    url:'/index.html?portal=1',
    async setup(pg){
      await pg.evaluate(async(D)=>{
        window.__chain(D);
        window.supa.auth.getSession=async()=>({data:{session:{user:{id:'cust1'}}}});
        window.currentUser=null;
        await window.glCheckPortal();
      }, PORTAL_DATA);
      await sleep(1400);
      await pg.evaluate(()=>window.__hud());
    },
    steps:[
      {say:"This is the Customer Portal, a private page each of your brands logs into to manage their own account. They see only their own data, and nothing else in your business."},
      {say:"It opens on their dashboard, headed with your company name and their account, with their balance at the top.", act:{type:'move',sel:'text=GOOD LIQUID BEV CO'}},
      {say:"Quick action tiles let them send you a request: samples, a reorder, a quote, or a question. Partners who send you production jobs use New production job, which sends you the full spec and the formula for every run.", act:{type:'move',sel:'[data-gl-action="glOpenJobIntakeForm"]'}},
      {say:"Below that, tabs organize everything. Overview shows their project and where each production run stands.", act:{type:'move',sel:'#gl-portal-tabs, [data-gl-action="glPortalTab"][data-gl-arg1="overview"]'}},
      {say:"Production runs move from formulation all the way through to shipping, and they can follow along here.", act:{type:'move',sel:'[data-gl-portal-panel="overview"] >> text=PRODUCTION RUNS'}},
      {say:"Billing lists every invoice, with its status, the P D F, and a button to pay online.", act:{type:'click',sel:'[data-gl-action="glPortalTab"][data-gl-arg1="billing"]'}},
      {say:"Here are their invoices.", act:{type:'move',sel:'[data-gl-portal-panel="billing"] >> text=YOUR INVOICES'}},
      {say:"Documents holds their C O As and lot paperwork, plus agreements, including the ones they signed electronically.", act:{type:'click',sel:'[data-gl-action="glPortalTab"][data-gl-arg1="documents"]'}},
      {say:"Renders, Packaging and Artwork, and Market Analytics show a lock until you turn those services on for them.", act:{type:'move',sel:'[data-gl-action="glPortalTab"][data-gl-arg1="artwork"]'}},
      {say:"So the portal is self service for your customers, and it keeps every invoice, document, and design in one organized place."}
    ]
  },
  invoices:{
    title:'Invoices — Bill Your Brands',
    seedCore:true,
    async setup(pg){ await coreSetup(pg,'invoices'); await pg.evaluate(D=>{ window.__chain(D); }, {canning_rates:CANNING_RATES, pricing_settings:PRICING_ROWS, clients:[{id:'c1',name:'Perico Nutrition',email:'ana@perico.co'},{id:'c2',name:'Lotus Beverages',email:'sam@lotus.co'}]}); },
    steps:[
      {say:"Invoices is where you bill your brands and see exactly what has been paid and what is still outstanding."},
      {say:"Every invoice is listed with its client, service, amount, date, and a color-coded status — Draft, Pending, Paid, Overdue, or Partial payment.", act:{type:'move',sel:'#inv-body'}},
      {say:"When a client pays part of what they owe, record it with the Part button. The invoice keeps a partial payment badge and shows the balance still owing, so it never looks either fully paid or untouched.", act:{type:'move',sel:'#inv-body tr:has-text("GL-1040")'}},
      {say:"Use the pills at the top to filter. Let's show just the overdue invoices.", act:{type:'click',sel:'#inv-pills .cpill:has-text("Overdue")'}},
      {say:"To create a new one, click New invoice. The invoice builder opens.", act:{type:'move',sel:'button:has-text("New invoice"):visible'}},
      {act:{type:'js',fn:()=>window.openNewInvoiceBuilder()}, say:"First, pick the client the invoice is for."},
      {say:"Perico Nutrition.", act:{type:'select',sel:'#ginv-client',value:'c1'}},
      {say:"Add a canning line. It prices itself from your rate card.", act:{type:'click',sel:'[data-gl-action="glAddLine"][data-gl-arg1="canning"]'}},
      {say:"Each canning line has a case tray picker. Choose a twelve count tray and a case becomes twelve cans. The cans stay the same, and the case count changes to match.", act:{type:'select',sel:'#gl-inv-body select[id$="-tray"]',value:'12'}},
      {say:"Here you can see the cans and the cans per case.", act:{type:'move',sel:'#gl-inv-body [id$="-cans"]'}},
      {say:"Ticking the twelve count tray add on below puts every canning line on twelve count at once. Prices under a cent show in full, like two and a half cents, instead of rounding.", act:{type:'move',sel:'#gl-inv-addons'}},
      {say:"When it looks right, Save and Send emails it straight to the client, or save it as a draft for later.", act:{type:'move',sel:'[data-gl-action="glSaveAndSend"]'}},
      {say:"That is invoicing in a nutshell: pick a client, pick a service, and the price and the preview build themselves."}
    ]
  },
  pipeline:{
    title:'Pipeline — Your Sales Board',
    seedCore:true,
    async setup(pg){ await coreSetup(pg,'pipeline'); },
    steps:[
      {say:"The Pipeline is your sales board. Every opportunity moves left to right, from first contact all the way to a signed deal."},
      {say:"The columns are your stages — Prospecting, Proposal, Negotiation, and Closed Won or Lost. Each header shows how many deals are in it and their total value.", act:{type:'move',sel:'#kanban'}},
      {say:"Each card is one opportunity — the brand, the contact, and the estimated value.", act:{type:'move',sel:'.kcard:has-text("Quote Request")'}},
      {say:"You can log an outreach email right on the card, so you always know which brands are awaiting a reply.", act:{type:'move',sel:'button:has-text("Log email sent"):visible'}},
      {say:"Click a card to open the full deal — contact details, notes, and the email history with that brand.", act:{type:'click',sel:'.kcard:has-text("Quote Request")'}},
      {say:"As a deal moves forward, you drag it to the next stage. The board is always a live picture of where your sales stand."}
    ]
  },
  clients:{
    title:'Clients — Every Brand in One Place',
    seedCore:true,
    async setup(pg){ await coreSetup(pg,'clients'); },
    steps:[
      {say:"The Clients page is every beverage brand you work with, gathered in one list."},
      {say:"Each row shows the brand, its main contact, the service they use, their status, and how much you have billed them.", act:{type:'move',sel:'#client-body'}},
      {say:"Right from the list you can start a new invoice for a brand, or send them a customer-portal invite.", act:{type:'move',sel:'button:has-text("Invite"):visible'}},
      {say:"Click any brand to open its full record.", act:{type:'click',sel:'#client-body tr:has-text("Perico Nutrition")'}},
      {say:"Everything about that client lives here — contact and business details, the documents they've uploaded, their invoices and pipeline, and their label artwork — all editable in one place.", act:{type:'move',sel:'#gl-ec-artwork'}},
      {say:"So it is one click from the list to a complete, editable client record — no hunting through separate screens."}
    ]
  },
  auditor:{
    title:'Auditor Portal — Read-Only Records Access',
    url:'/auditor.html?token=DEMO-INSPECTOR-TOKEN',
    mockRest:audMock,
    steps:[
      {say:"When an auditor visits, you don't hand over your whole system or an account. You give them a single read-only link. Here's what they see."},
      {say:"Because you issued them a token, they land straight on a read-only dashboard — no password, no access to anything else in your business.", act:{type:'move',sel:'text=At a glance'}},
      {say:"At a glance shows the headline numbers: how many records, open deviations, approved suppliers, and mock recalls you have on file.", act:{type:'move',sel:'text=At a glance'}},
      {say:"They can browse every GMP register, and the most recent signed records, each showing who signed it and when.", act:{type:'move',sel:'text=Most recent records'}},
      {say:"Open deviations are shown in full, together with the corrective action taken — nothing is hidden.", act:{type:'move',sel:'text=Open deviations'}},
      {say:"Your approved suppliers are listed with their certificates and expiry dates.", act:{type:'move',sel:'text=Approved suppliers'}},
      {say:"And your documents — SOPs and the food safety plan — are available for them to open and read.", act:{type:'move',sel:'text=Documents'}},
      {say:"But here is the important part: everything on this page is read-only. The auditor can see it all, and cannot change, sign, or delete a single record. That is the auditor portal — total transparency, with zero risk to your data."}
    ]
  },
  audit:{
    title:'Internal Audit & Management Review',
    async setup(pg){
      await pg.evaluate(async(data)=>{
        window.__chain(JSON.parse(JSON.stringify(data)));
        window.__overlays('cpg-auditreview');
        await window.glRenderAuditReview();
      }, AUDIT_DATA);
    },
    steps:[
      {say:"Internal Audit and Management Review is how you check your own food-safety system, and prove it, before an outside auditor ever arrives."},
      {say:"The top section lists your internal audits — each with its date, scope, lead auditor, and status.", act:{type:'move',sel:'text=Allergen control program'}},
      {say:"Open an audit to see its findings.", act:{type:'click',sel:'button:has-text("Findings")'}},
      {say:"Any open finding can become a tracked corrective action with a single click — Raise NCR — linked right back to the audit.", act:{type:'move',sel:'button:has-text("Raise NCR")'}},
      {say:"To plan a new audit, click Schedule audit.", act:{type:'click',sel:'button:has-text("Schedule audit")'}},
      {say:"Set the scope, and the lead auditor.", act:{type:'type',sel:'#ar-a-scope',text:'Water & environmental monitoring'}},
      {say:"Name the lead auditor.", act:{type:'type',sel:'#ar-a-auditor',text:'Jane Smith (QA)'}},
      {say:"Then click Schedule to add it to the plan.", act:{type:'click',sel:'#ar-a-save'}},
      {say:"Below, Management Review shows a live snapshot of your key numbers — open deviations, open NCRs, approved suppliers, and your mock-recall pass rate.", act:{type:'move',sel:'text=Approved suppliers'}},
      {say:"Click New management review to record a meeting and lock those numbers into a dated record. That closes the loop: you audit, you fix, and you review — exactly what a certifier wants to see.", act:{type:'move',sel:'button:has-text("New management review")'}}
    ]
  },
  trace:{
    title:'Trace & Mock Recall — Account for Any Lot',
    async setup(pg){
      await pg.evaluate((data)=>{
        window.__chain(JSON.parse(JSON.stringify(data)));
        window.__overlays('cpg-trace');
        window.glRenderTrace();
      }, TRACE_DATA);
    },
    steps:[
      {say:"Trace and Recall proves you can find any lot fast — backward to what went into it, and forward to where it shipped. It is the drill auditors always test."},
      {say:"Start by typing the run or lot you want to trace. Here, Cold Brew R-2041.", act:{type:'type',sel:'#gl-trace-q',text:'Cold Brew R-2041'}},
      {say:"Then click Trace.", act:{type:'click',sel:'button:has-text("Trace")'}},
      {say:"Backward shows every material and supplier lot that went into the run — concentrate, water, and cans, each with its supplier lot number.", act:{type:'move',sel:'text=BACKWARD'}},
      {say:"Forward shows every customer the run shipped to, and the total units — so you know exactly who to contact.", act:{type:'move',sel:'text=FORWARD'}},
      {say:"The GMP trail links the food-safety checks from that run. A red flag marks any deviation, like the label check here.", act:{type:'move',sel:'text=GMP TRAIL'}},
      {say:"Now the real test. Click Run mock recall.", act:{type:'click',sel:'button:has-text("Run mock recall")'}},
      {say:"Enter how many units you produced, and how many you can account for.", act:{type:'type',sel:'#mr-produced',text:'13000'}},
      {say:"And the units accounted for.", act:{type:'type',sel:'#mr-accounted',text:'12950'}},
      {say:"Click Run recall. The system instantly computes the percent reconciled and a Pass or Fail, and logs the exercise for your records.", act:{type:'click',sel:'#mr-run'}},
      {say:"That is a complete, timed recall drill — the evidence an auditor asks for, produced in under a minute."}
    ]
  },
  training:{
    title:'Training & Competency — Keep Certifications Current',
    async setup(pg){
      await pg.evaluate(async(rows)=>{
        window.__chain({training_records:rows.map(r=>Object.assign({},r))});
        window.__overlays('cpg-training');
        await window.glRenderTraining();
      }, TRAIN_ROWS);
    },
    steps:[
      {say:"The Training and Competency page makes sure every employee's food-safety certifications stay current — and warns you before any of them lapse."},
      {say:"It's laid out as a matrix: each employee, and the courses they've completed, like HACCP and Better Process Control School.", act:{type:'move',sel:'text=Jane Smith'}},
      {say:"A colored badge does the watching for you. Amber means a certification is expiring soon; red means it has already lapsed and needs renewing.", act:{type:'move',sel:'text=Carlos Ruiz'}},
      {say:"To add a new record, click Add training record.", act:{type:'click',sel:'button:has-text("Add training record")'}},
      {say:"Enter the employee's name and the course they completed.", act:{type:'type',sel:'#tr-employee',text:'Dana Lee'}},
      {say:"And the course.", act:{type:'type',sel:'#tr-course',text:'GMP Annual Refresher'}},
      {say:"Add the completion date, and the date it expires, so the system can track the renewal for you.", act:{type:'fill',sel:'#tr-completed',text:'2026-07-31'}},
      {say:"Set the expiry date.", act:{type:'fill',sel:'#tr-expires',text:'2027-07-31'}},
      {say:"Then click Save. The new record joins the matrix, and its expiry is now tracked automatically.", act:{type:'click',sel:'#tr-save'}},
      {say:"That's all there is to it. One glance shows you who is trained, and what is coming due, before an auditor ever asks."}
    ]
  },
  schedule:{
    title:'GMP Schedule — What’s Due Today',
    async setup(pg){
      await pg.evaluate(async(tasks)=>{
        window.__chain({compliance_tasks:tasks.map(t=>Object.assign({},t)), gmp_task_defs:[]});
        window.__overlays('cpg-gmpsched');
        await window.glRenderGMPSchedule();
      }, SCHED_TASKS);
    },
    steps:[
      {say:"The GMP Schedule page answers one question every morning: what checks are due today, and is anything overdue? Let's walk through it."},
      {say:"Each day, you start by clicking Generate today's tasks. This creates the day's checks automatically from your recurring schedule — daily, weekly, monthly, and yearly.", act:{type:'move',sel:'button:has-text("Generate today")'}},
      {say:"The board then splits your tasks into three groups. Overdue, in red, is anything left open past its due date — here, a pest inspection and a glass audit.", act:{type:'move',sel:'#cpg-gmpsched'}},
      {say:"Due Today, in amber, shows what still needs doing today, like the pre-op sanitation and the daily hygiene check.", act:{type:'move',sel:'text=Daily GMP & hygiene check'}},
      {say:"As you finish each check, click Mark done, and it moves into the green Done Today column.", act:{type:'click',sel:'button:has-text("Mark done")'}},
      {say:"That is the whole rhythm. Generate the day's tasks, work down the list, and a single glance tells you nothing has been missed."}
    ]
  },
  daily:{
    title:'Daily GMP — Log Today’s Checks',
    async setup(pg){
      await pg.evaluate((tpls)=>{
        window.__chain({gmp_templates:tpls, compliance_records:[]}, ()=>null);
        window.__overlays('cpg-gmp'); window.glRenderGMPHub();
      }, DAILY_TPLS);
    },
    steps:[
      {say:"In this tutorial you will learn to log your daily G M P checks. The Daily G M P page works on a simple idea: type the shared details once, and they fan out to every form you fill in."},
      {say:"At the top of the page, click Log today's G M P to open the combined entry screen.", act:{type:'click',sel:'button:has-text("Log today")'}},
      {say:"First, fill in the shared header. The date and operator are already set. Just add the line or area you are working on.", act:{type:'type',sel:'#gmp-h-line',text:'Line 1'}},
      {say:"Now open the first form, Pre-Op Sanitation, by clicking its title.", act:{type:'click',sel:'summary:has-text("Pre-Op Sanitation")'}},
      {say:"Enter the area you cleaned, and mark the result. Choose Pass if it passed inspection.", act:{type:'type',sel:'#gmpf-GMP-PREOP-001-area',text:'Filler & capper'}},
      {say:"Set the result to Pass.", act:{type:'select',sel:'#gmpf-GMP-PREOP-001-result',value:'pass'}},
      {say:"Next, open the G M P and Personnel Hygiene check the same way.", act:{type:'click',sel:'summary:has-text("Personnel Hygiene")'}},
      {say:"Confirm the hygiene checks passed — garments and hairnets, and handwashing stations.", act:{type:'select',sel:'#gmpf-GMP-HYGIENE-001-garments',value:'pass'}},
      {say:"And the handwashing stations.", act:{type:'select',sel:'#gmpf-GMP-HYGIENE-001-handwashing',value:'pass'}},
      {say:"When you are done, click Sign and save. This is the magic step: one save writes a separate signed record for every form you filled, all tied together by one batch.", act:{type:'click',sel:'#gmp-save-sign'}},
      {say:"That is the whole daily routine. If any check had failed, the app would flag a deviation automatically, so nothing slips. You have now logged a full day's G M P."}
    ]
  },
  prp:{
    title:'Prerequisite Programs — Log a Calibration Check',
    async setup(pg){
      await pg.evaluate((tpl)=>{
        window.__chain({gmp_templates:[tpl], compliance_records:[]}, (t,f)=> t==='gmp_templates'&&f==='GMP-CAL-001'?tpl:null);
        window.__overlays('cpg-gmp'); window.glRenderGMPHub();
      }, CAL_TPL);
    },
    steps:[
      {say:"Welcome to Good Liquid Bev Co. In this short tutorial, you will learn how to log a calibration check — one of the prerequisite programs that keep your food safety system running."},
      {say:"Everything food safety lives on the Daily G M P page. Below the daily forms is a section called Prerequisite Programs. These are the periodic background jobs, like calibration, pest control, and water testing.", act:{type:'move',sel:'#cpg-gmp'}},
      {say:"To record a calibration, click the Calibration tile.", act:{type:'click',sel:'button:has-text("Calibration")'}},
      {say:"This shows every calibration you have logged so far. To add a new one, click New entry.", act:{type:'click',sel:'button:has-text("New entry")'}},
      {say:"Notice the date and your name are already filled in at the top, so you never have to type them each time.", act:{type:'move',sel:'#gmp-h-operator'}},
      {say:"First, enter the instrument you checked. For example, a digital thermometer.", act:{type:'type',sel:'#gmpf-GMP-CAL-001-instrument',text:'Digital thermometer'}},
      {say:"Next, enter the reference you compared it against. Here, a NIST traceable ice point.", act:{type:'type',sel:'#gmpf-GMP-CAL-001-reference',text:'NIST-traceable ice point'}},
      {say:"Now the most important field: within tolerance. If the instrument read correctly, choose Pass. If it had drifted, you would choose Fail, and the app would automatically flag it for follow up.", act:{type:'select',sel:'#gmpf-GMP-CAL-001-tolerance_ok',value:'pass'}},
      {say:"Set the date the next calibration is due, so it is scheduled and never forgotten.", act:{type:'fill',sel:'#gmpf-GMP-CAL-001-next_due',text:'2026-08-31'}},
      {say:"Finally, click Sign and save. This signs the record with your name and the exact time.", act:{type:'click',sel:'#gmp-save-sign'}},
      {say:"That is it. The calibration is logged, signed, and stored safely, ready for any auditor to review. Every prerequisite program works exactly the same way.", act:{type:'move',sel:'#cpg-gmp'}}
    ]
  }
};

// ─────────────────────────── driver ───────────────────────────
const ATO=4000;   // per-action timeout so a bad step can't overrun and wreck sync
async function moveCursor(pg,sel){
  let box=null;
  try { const loc=pg.locator(sel).first(); await loc.scrollIntoViewIfNeeded({timeout:ATO}); await sleep(180); box=await loc.boundingBox({timeout:ATO}); } catch(e){ return null; }
  if(!box) return null;
  const x=Math.round(box.x+box.width/2), y=Math.round(box.y+Math.min(box.height/2,22));
  await pg.evaluate(({x,y})=>{const c=document.getElementById('vcursor');c.style.left=x+'px';c.style.top=y+'px';},{x,y});
  await sleep(600); return {x,y};
}
async function doAct(pg,act){
  if(!act) return;
  if(act.type==='move'){ await moveCursor(pg,act.sel); return; }
  const pt=await moveCursor(pg,act.sel);
  if(act.type==='click'){ if(pt) await pg.evaluate(({x,y})=>window.__pulse(x,y),pt); await sleep(150); await pg.locator(act.sel).first().click({timeout:ATO}); }
  else if(act.type==='type'){ await pg.locator(act.sel).first().click({timeout:ATO}); await pg.locator(act.sel).first().pressSequentially(act.text,{delay:48,timeout:ATO}); }
  else if(act.type==='select'){ await pg.selectOption(act.sel, act.label?{label:act.label}:act.value, {timeout:ATO}); }
  else if(act.type==='fill'){ await pg.locator(act.sel).first().fill(act.text,{timeout:ATO}); }
  else if(act.type==='check'){ await pg.locator(act.sel).first().check({timeout:ATO}); }
  // js: run a page function after the cursor arrives (fill many fields at
  // once, open a modal the way a nav guard would). act.fn is a function.
  else if(act.type==='js'){ await pg.evaluate(act.fn, act.arg===undefined?null:act.arg); }
}

(async()=>{
const key=process.argv[2]||'prp';
const sb=STORYBOARDS[key]; if(!sb){ console.error('unknown storyboard',key); process.exit(1); }
const work=path.join(SCRATCH,'video',key); fs.mkdirSync(work,{recursive:true});

// GL_DRY_RUN=1: no narration and no MP4. Each step gets a short fixed slot and
// any act that fails is reported and fails the run, so a storyboard can be
// checked in a minute before spending a full render on it. Screenshots of each
// step land in <work>/dry_<i>.png.
const DRY=!!process.env.GL_DRY_RUN;
let actFailures=0;
// 1) synth narration per step, compute per-step target length T_i
const T=[]; let A=0;
const SPK=[];
let narration=null;
if(DRY){ sb.steps.forEach(function(){ T.push(1.6); SPK.push(1); A+=1.6; }); }
else {
console.log('synthesizing narration…');
synthAll(sb.steps.map((s,i)=>[s.say, path.join(work,`raw_${i}.wav`)]), work);
sb.steps.forEach((s,i)=>{
  const raw=path.join(work,`raw_${i}.wav`);
  const d=dur(raw); const Ti=LEAD+d+TAILPAD; T.push(Ti); A+=Ti; SPK.push(d);
  const seg=path.join(work,`seg_${i}.wav`);
  execSync(`ffmpeg -y -loglevel error -i "${raw}" -af "adelay=${Math.round(LEAD*1000)}:all=1,apad" -t ${Ti.toFixed(3)} -ar 22050 -ac 1 "${seg}"`);
});
// concat segments into one narration track
fs.writeFileSync(path.join(work,'list.txt'), sb.steps.map((_,i)=>`file 'seg_${i}.wav'`).join('\n'));
narration=path.join(work,'narration.wav');
execSync(`ffmpeg -y -loglevel error -f concat -safe 0 -i "${path.join(work,'list.txt')}" -c copy "${narration}"`);
console.log(`narration ${A.toFixed(1)}s across ${sb.steps.length} steps`);
}

// 2) record the video, forcing each step's wall-time to T_i
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'text/plain'});s.end(b);});});
await new Promise(r=>srv.listen(8941,r));
const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
const ctx=await br.newContext({viewport:{width:W,height:H},deviceScaleFactor:1,recordVideo:{dir:work,size:{width:W,height:H}}});
try { await ctx.grantPermissions(['clipboard-read','clipboard-write'],{origin:'http://127.0.0.1:8941'}); } catch(e){}
const pg=await ctx.newPage();
// confirm()/alert() would stall the recording; a storyboard that shows one
// narrates it, the browser just accepts it.
pg.on('dialog', d=>d.accept().catch(()=>{}));
// routes: a storyboard can answer requests a REST mock does not cover (edge
// functions on a standalone page). Installed before the page loads.
if(sb.routes) await sb.routes(pg);
if(sb.mockRest){
  // page mode: intercept Supabase REST and fulfill from sb.mockRest(table, url)
  await pg.route('**/rest/v1/**', async route=>{
    const u=route.request().url();
    // CORS: the page is on 127.0.0.1 and the REST host is supabase.co, so a
    // raw fetch (questionnaire.html) is cross origin and preflighted.
    const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET, POST, PATCH, OPTIONS'};
    if(route.request().method()==='OPTIONS'){ return route.fulfill({status:204,headers:cors,body:''}); }
    if(route.request().method()==='PATCH'){ return route.fulfill({status:204,headers:cors,body:''}); }
    const m=u.match(/\/rest\/v1\/([a-z_]+)/); const table=m?m[1]:'';
    const rows=sb.mockRest(table,u)||[];
    return route.fulfill({status:200,contentType:'application/json',headers:cors,body:JSON.stringify(rows)});
  });
}
const startUrl = sb.url ? ('http://127.0.0.1:8941'+sb.url) : 'http://127.0.0.1:8941/index.html';
await pg.goto(startUrl,{waitUntil:'domcontentloaded',timeout:30000});
await pg.waitForTimeout(sb.url?2200:1400);
await pg.evaluate(h=>{ window.__host=h; }, { svg: HOST.HOST_SVG, css: HOST.HOST_CSS });
await pg.evaluate(installCommon);
if(sb.seedCore){ await pg.evaluate(d=>{ window.__coreData=d; }, {clients:CORE_CLIENTS,invoices:CORE_INVOICES,deals:CORE_DEALS}); }
if(sb.url){ await pg.evaluate(()=>window.__hud()); }
if(sb.setup) await sb.setup(pg);
await sleep(300);

for(let i=0;i<sb.steps.length;i++){
  const t=Date.now();
  await pg.evaluate(({t,lead,ms})=>{ window.__vcap(t); setTimeout(function(){ window.__speak && window.__speak(ms); }, lead); }, { t: sb.steps[i].say, lead: LEAD*1000, ms: SPK[i]*1000 });
  // Checked BEFORE the act: a click can navigate away from its own target.
  if(DRY && sb.steps[i].act && sb.steps[i].act.sel && !(await pg.locator(sb.steps[i].act.sel).count().catch(()=>0))){ actFailures++; console.error('step',i,'selector not found:',sb.steps[i].act.sel); }
  try { await doAct(pg, sb.steps[i].act); } catch(e){ actFailures++; console.error('step',i,'act failed:',e.message); }
  if(DRY){ await sleep(500); await pg.screenshot({path:path.join(work,`dry_${i}.png`)}); }
  const el=(Date.now()-t)/1000, rem=T[i]-el;
  if(rem>0) await sleep(rem*1000);
}
const video=pg.video();
await ctx.close();
if(DRY){ await br.close(); srv.close(); console.log(actFailures?('DRY RUN: '+actFailures+' failed step(s)'):'DRY RUN: every step ok', '· screenshots in', work); process.exit(actFailures?1:0); }
const vpath=await video.path();
const V=dur(vpath);
console.log(`video ${V.toFixed(1)}s (audio ${A.toFixed(1)}s) → front-trim ${(V-A).toFixed(2)}s`);
await br.close(); srv.close();

// 3) trim pre-roll, mux narration, encode mp4 (+ keep a webm)
const P=Math.max(0, V-A);
const outMp4=path.join(SCRATCH,`tutorial-${key}.mp4`);
execSync(`ffmpeg -y -loglevel error -ss ${P.toFixed(3)} -i "${vpath}" -i "${narration}" -map 0:v:0 -map 1:a:0 -c:v libx264 -preset veryfast -pix_fmt yuv420p -r 25 -c:a aac -b:a 128k -shortest -movflags +faststart "${outMp4}"`);
console.log('WROTE', outMp4, fs.statSync(outMp4).size,'bytes', dur(outMp4).toFixed(1)+'s');
process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
