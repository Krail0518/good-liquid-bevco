/*
 * gen-video.cjs — module tutorial-video generator with neural voiceover.
 *
 *   node gen-video.cjs <storyboardKey>
 *
 * Pipeline: Playwright drives the real app (stubbed data) → silent .webm with a
 * visible cursor + caption banner; Piper synthesizes each step's narration; the
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
      c.insert=function(r){ const a=Array.isArray(r)?r:[r]; a.forEach(function(x){ rows().push(x); }); window.__inserted.push({table:table,rows:a});
        return { select:async function(){ return {data:a.map(function(x,i){ return Object.assign({id:'new'+i},x); }),error:null}; }, then:function(res){ return Promise.resolve({data:a,error:null}).then(res); } }; };
      c.update=function(patch){ return { eq:function(k,v){ rows().forEach(function(r){ if(String(r[k])===String(v)) Object.assign(r,patch); }); return { then:function(res){ return Promise.resolve({data:null,error:null}).then(res); }, select:async function(){ return {data:[],error:null}; } }; } }; };
      c.delete=function(){ return { eq:function(k,v){ const a=rows(); for(let i=a.length-1;i>=0;i--){ if(String(a[i][k])===String(v)) a.splice(i,1); } return { then:function(res){ return Promise.resolve({data:null,error:null}).then(res); } }; } }; };
      c.then=function(res){ let d=applyF(rows()); const f=keyF(); if(!d.length && f && single(table,f.v)) d=[single(table,f.v)]; return Promise.resolve({data:d,count:(c._count?d.length:undefined),error:null}).then(res); };
      return c;
    }
    window.supa={from:function(t){ return chain(t); },rpc:async()=>({data:null,error:null}),
      functions:{invoke:async()=>({data:{ok:true},error:null})},
      auth:{getUser:async()=>({data:{user:{id:'u1'}},error:null}),getSession:async()=>({data:{session:null},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},
      channel:()=>({on(){return this;},subscribe(){return this;}}),removeChannel:()=>{}};
    window.currentUser={id:'u1',email:'mike@krail.us',role:'admin',name:'Mike',initials:'MK'};
  };
  window.__hud=function(){
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
      const st=document.createElement('style'); st.id='gm-style';
      st.textContent=
        // GL-088's session watchdog reads the real Supabase client, which has
        // no session here, so after 60s it would cover the top of every video
        // with "Your session has expired". Recordings are not sessions.
        '#gl-session-expired{display:none!important}'+
        '@keyframes gm-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}'+
        '@keyframes gm-blink{0%,90%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}'+
        '@keyframes gm-talk{0%,100%{transform:scaleY(.32)}50%{transform:scaleY(1)}}'+
        '@keyframes gm-wave{0%,100%{transform:rotate(-4deg)}50%{transform:rotate(-32deg)}}'+
        '#gm-mascot{animation:gm-bob 2.6s ease-in-out infinite}'+
        '#gm-mascot .gm-eyes{transform-box:fill-box;transform-origin:center;animation:gm-blink 4s infinite}'+
        '#gm-mascot .gm-mouth{transform-box:fill-box;transform-origin:center;animation:gm-talk .26s ease-in-out infinite}'+
        '#gm-mascot .gm-arm{transform-box:fill-box;transform-origin:top center;animation:gm-wave 1.1s ease-in-out infinite}';
      document.head.appendChild(st);
      const m=document.createElement('div'); m.id='gm-mascot';
      m.style.cssText='position:fixed;left:22px;bottom:92px;width:118px;height:152px;z-index:2147483646;pointer-events:none;filter:drop-shadow(0 6px 14px rgba(0,0,0,.5))';
      m.innerHTML='<svg viewBox="0 0 120 152" width="118" height="152">'+
        '<defs><linearGradient id="gmcan" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#00e5c0"/><stop offset="1" stop-color="#00a88c"/></linearGradient></defs>'+
        '<rect class="gm-arm" x="14" y="72" width="12" height="34" rx="6" fill="#00c4a7"/>'+
        '<rect x="94" y="74" width="12" height="30" rx="6" fill="#00c4a7"/>'+
        '<rect x="28" y="34" width="64" height="98" rx="16" fill="url(#gmcan)" stroke="#0a3d34" stroke-width="2"/>'+
        '<ellipse cx="60" cy="34" rx="32" ry="8" fill="#7ff0dd" stroke="#0a3d34" stroke-width="2"/>'+
        '<rect x="28" y="82" width="64" height="24" fill="rgba(255,255,255,.15)"/>'+
        '<text x="60" y="99" text-anchor="middle" font-family="Arial" font-weight="bold" font-size="12" fill="#eafff9">GOOD LIQUID</text>'+
        '<circle cx="42" cy="64" r="4" fill="rgba(255,120,120,.5)"/><circle cx="78" cy="64" r="4" fill="rgba(255,120,120,.5)"/>'+
        '<g class="gm-eyes"><circle cx="49" cy="54" r="9" fill="#fff"/><circle cx="71" cy="54" r="9" fill="#fff"/>'+
        '<circle cx="50" cy="55" r="4" fill="#08201b"/><circle cx="72" cy="55" r="4" fill="#08201b"/></g>'+
        '<ellipse class="gm-mouth" cx="60" cy="70" rx="8.5" ry="6" fill="#08201b"/>'+
        '<rect x="42" y="132" width="9" height="12" rx="4" fill="#00a88c"/><rect x="69" y="132" width="9" height="12" rx="4" fill="#00a88c"/>'+
        '</svg>';
      document.body.appendChild(m);
    }
    window.__vcap=t=>{const c=document.getElementById('vcap'); if(c) c.textContent=t;};
    // Step marker: a small grey square in the bottom-right corner whose shade
    // encodes the step number. The driver reads it back out of the recording
    // to find where each step really starts (see markLevel / stepStarts).
    window.__mark=lv=>{let m=document.getElementById('vmark');
      if(!m){ m=document.createElement('div'); m.id='vmark';
        m.style.cssText='position:fixed;right:0;bottom:0;width:12px;height:12px;z-index:2147483647;pointer-events:none';
        document.body.appendChild(m); }
      m.style.background='rgb('+lv+','+lv+','+lv+')'; };
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

// Client portal v2 (GL-071..GL-080): two projects, a milestone waiting on the
// client, one service unlocked, artwork with decisions, a released formula doc.
// rpc() answers from __rpc by function name (see the portal storyboard).
const futDays=n=>new Date(Date.now()+n*864e5).toISOString().slice(0,10);
const PORTAL_MS=[
 ['formulation','intake','Project intake','completed'],['formulation','formulation','Formulation','completed'],
 ['formulation','testing','Internal testing','completed'],['formulation','sample_prep','Sample preparation','completed'],
 ['formulation','sample_sent','Sample sent','completed'],['formulation','feedback','Your feedback','awaiting_client','client','Samples of round 2 shipped Monday. Please taste and send us your notes on sweetness and carbonation.',futDays(5),2],
 ['formulation','revisions','Formula revisions','not_started'],['formulation','approved','Formula approved','not_started'],
 ['formulation','pa_wait','Awaiting PA letter','not_started'],['formulation','pa_ok','PA letter obtained','not_started'],
 ['formulation','prod_ready','Production ready','not_started'],['formulation','complete','Complete','not_started'],
 ['artwork','artwork','Packaging and artwork','in_progress']
].map((m,i)=>({id:'m'+i,project_id:'p1',track:m[0],key:m[1],label:m[2],sort_order:i,round:m[7]||1,status:m[3],owner:m[4]||'gl',client_note:m[5]||null,target_date:m[6]||null}));
const PORTAL_DATA={
  customer_users:[{id:'cu1',auth_user_id:'cust1',client_id:'c1',email:'ana@perico.co',display_name:'Ana — Perico Nutrition',active:true,role:'customer',notify_run_stage_changes:true,notify_project_updates:true}],
  clients:[{id:'c1',name:'Perico Nutrition',contact_name:'Ana Perez',contact_type:'Owner',email:'ana@perico.co',phone:'',street:'',city:'',state:'',zip:''}],
  invoices:[
    {id:'i1',client_id:'c1',invoice_number:'GL-1042',amount:3850,paid_amount:0,status:'pending',invoice_date:isoDaysAgo(12),due_date:futDays(18),line_items:[],share_token:'t1'},
    {id:'i2',client_id:'c1',invoice_number:'GL-1039',amount:1500,paid_amount:1500,status:'paid',invoice_date:isoDaysAgo(40),due_date:isoDaysAgo(10),line_items:[],share_token:'t2'}
  ],
  production_runs:[{id:'r1',client_id:'c1',run_name:'Mango Seltzer pilot',format:'12oz can',cases:200,stage:'Sample',scheduled_start_date:futDays(20),lot_number:'MS-0101',updated_at:isoDaysAgo(2)}],
  lot_documents:[{id:'ld1',client_id:'c1',document_type:'COA',title:'COA — Mango Seltzer sample',lot_number:'MS-0101',file_name:'coa.pdf',file_size:120000,file_path:'x',mime_type:'application/pdf',uploaded_at:isoDaysAgo(3),production_run_id:'r1'}],
  deal_documents:[
    {id:'dd1',client_id:'c1',doc_type:'NDA',name:'Mutual NDA (signed)',notes:'',file_path:'c1/portal/nda.pdf',created_at:isoDaysAgo(30),project_id:null},
    {id:'dd2',client_id:'c1',doc_type:'Process Authority Letter',name:'Process Authority letter',notes:'',file_path:'c1/pa.pdf',created_at:isoDaysAgo(8),project_id:'p1'}
  ],
  projects:[
    {id:'p1',client_id:'c1',name:'Mango Seltzer',product_name:'Sparkling mango seltzer, 12oz',status:'active',started_on:isoDaysAgo(40),target_date:futDays(60),created_at:isoDaysAgo(40)},
    {id:'p2',client_id:'c1',name:'Cold Brew Line Extension',product_name:'Oat milk cold brew',status:'active',started_on:isoDaysAgo(5),target_date:futDays(120),created_at:isoDaysAgo(5)}
  ],
  project_milestones:PORTAL_MS,
  client_allergen_declarations:[],sample_shipments:[{id:'s1',client_id:'c1',kind:'Sample',qty:12,shipped_date:isoDaysAgo(4),carrier:'UPS',tracking:'1Z999AA10123456784',status:'delivered'}],
  customer_requests:[],
  __rpc:{
    gl_portal_entitlements:[{project_id:'p1',service_key:'packaging_artwork',action:'grant'}],
    gl_portal_formula_status:[{name:'Mango Seltzer',version:2,status:'benchtop',updated_at:isoDaysAgo(6)}],
    gl_portal_formula_documents:[{id:'fd1',name:'Mango Seltzer v2 spec sheet',doc_kind:'spec_sheet',formula_name:'Mango Seltzer',version:2,published_at:isoDaysAgo(6)}],
    gl_portal_artwork:[
      {artwork_id:'a1',project_id:'p1',sku_name:'Mango Seltzer 12oz',description:'Front panel',file_path:'c1/artwork/1.png',file_type:'png',created_at:isoDaysAgo(9),state:'changes_requested',decided_at:isoDaysAgo(2),client_note:'Nutrition panel needs to move to the back panel; the barcode needs 2mm more quiet zone.'},
      {artwork_id:'a2',project_id:'p1',sku_name:'Mango Seltzer 4-pack carrier',description:'',file_path:'c1/artwork/2.png',file_type:'png',created_at:isoDaysAgo(9),state:'approved',decided_at:isoDaysAgo(3),client_note:'Approved. Looks great.'}
    ]
  }
};


// Staff side of the portal: what Edit Client loads for projects, services,
// shared documents, artwork decisions and the quote's ⚙ Services panel.
const PORTAL_ADMIN_DATA={
  projects:PORTAL_DATA.projects, project_milestones:PORTAL_MS,
  project_entitlement_events:[{project_id:'p1',service_key:'packaging_artwork',action:'grant',seq:1,created_at:isoDaysAgo(12)}],
  client_artwork:[
    {id:'a1',client_id:'c1',project_id:'p1',sku_name:'Mango Seltzer 12oz',description:'Front panel',file_path:'c1/artwork/1.png',file_type:'png',created_at:isoDaysAgo(9)},
    {id:'a2',client_id:'c1',project_id:'p1',sku_name:'Mango Seltzer 4-pack carrier',description:'',file_path:'c1/artwork/2.png',file_type:'png',created_at:isoDaysAgo(9)}],
  artwork_reviews:[{artwork_id:'a1',decision:'in_review',decided_at:isoDaysAgo(8),client_note:'',seq:1},{artwork_id:'a2',decision:'approved',decided_at:isoDaysAgo(3),client_note:'Approved. Looks great.',seq:2}],
  deal_documents:[
    {id:'dd1',client_id:'c1',doc_type:'NDA',name:'Mutual NDA (signed)',file_path:'c1/nda.pdf',created_at:isoDaysAgo(30)},
    {id:'dd3',client_id:'c1',doc_type:'Product Render',name:'Mango Seltzer can render v1',file_path:'c1/render.png',created_at:isoDaysAgo(1)}],
  quotes:[{id:'q1',client_id:'c1',quote_number:'GLQ-202609-004',quote_date:isoDaysAgo(3),package_format:'12oz Standard',product_type:'canning',status:'sent',pdf_html:'<p></p>',project_id:null,services:[]}]
};

// ── Warehouse Storage (#435-#437), modelled on tests/warehouse.test.cjs ──
const whDay=n=>{const d=new Date(Date.now()+n*864e5);return d.toISOString().slice(0,10);};
const WH_PER={id:'c1',name:'Perico Nutrition'}, WH_CAMO={id:'c4',name:'Camo Energy'};
const WH_SKU={id:'s-glow',client_id:WH_CAMO.id,upc_sku:'600139057612',description:'Camo Energy Glow 12oz',brand:'Camo Energy',pack:'12 count tray',units_per_case:12,default_cases_per_pallet:200,default_pallet_weight_lbs:2000,default_pallet_height_in:60,inventory_type:'finished_good',active:true,notes:null,last_exported_at:whDay(-10)+'T12:00:00Z',client:WH_CAMO};
const WH_SKU2={id:'s-mango',client_id:WH_PER.id,upc_sku:'850012345678',description:'Mango Seltzer 12oz',brand:'Perico',pack:'24 count tray',units_per_case:24,default_cases_per_pallet:80,default_pallet_weight_lbs:1500,default_pallet_height_in:58,inventory_type:'finished_good',active:true,notes:null,last_exported_at:whDay(-20)+'T12:00:00Z',client:WH_PER};
const WH_SKU3={id:'s-cans',client_id:WH_PER.id,upc_sku:'CAN-12OZ',description:'Empty 12oz cans',brand:'Perico',pack:'bulk',units_per_case:null,default_cases_per_pallet:1,inventory_type:'empty_can',active:true,last_exported_at:whDay(-20)+'T12:00:00Z',client:WH_PER};
const WH_LOT={id:'l-628',sku_id:WH_SKU.id,lot_number:'628290B',production_date:whDay(-2),best_by_date:whDay(540),qa_status:'released'};
const WH_LOT2={id:'l-ms1',sku_id:WH_SKU2.id,lot_number:'MS-0101',production_date:whDay(-200),best_by_date:whDay(45),qa_status:'released'};
const WH_LOT3={id:'l-ms2',sku_id:WH_SKU2.id,lot_number:'MS-0102',production_date:whDay(-30),best_by_date:whDay(330),qa_status:'released'};
const WH_T1={id:'t-1',transfer_number:'GL-TR-'+whDay(0).replace(/-/g,'')+'-01',type:'to_conri_finished',transfer_date:whDay(1),status:'draft',scheduled_at:null,client_id:WH_CAMO.id,client:WH_CAMO,carrier:'Good Liquid truck',ship_to:'CONRI Services, Palmetto',conri_confirmation:null,released_by:'Mike Krail',notes:null};
const WH_T2={id:'t-2',transfer_number:'GL-TR-'+whDay(-6).replace(/-/g,'')+'-01',type:'to_conri_finished',transfer_date:whDay(-6),status:'completed',scheduled_at:whDay(-6)+'T14:00:00Z',client_id:WH_PER.id,client:WH_PER,carrier:'Good Liquid truck',ship_to:'CONRI Services, Palmetto',conri_confirmation:'C-55120',released_by:'Mike Krail',notes:null};
const WH_SEED=[1,2,3,4,5,6,7].map(i=>({id:'p-'+i,pallet_tag:'GL-P-00012'+i,cases:200,weight_lbs:2000,height_in:60,location:'good_liquid',status:'staged',current_transfer_id:WH_T1.id,received_at_conri:null,expected_pull_date:null,notes:null,sku:WH_SKU,lot:WH_LOT,line_no:i}));
const WH_AT=[
 {id:'q-1',pallet_tag:'GL-P-000101',cases:80,weight_lbs:1500,location:'conri',status:'stored',current_transfer_id:null,received_at_conri:whDay(-6)+'T15:00:00Z',sku:WH_SKU2,lot:WH_LOT2},
 {id:'q-2',pallet_tag:'GL-P-000102',cases:80,weight_lbs:1500,location:'conri',status:'stored',current_transfer_id:null,received_at_conri:whDay(-6)+'T15:00:00Z',sku:WH_SKU2,lot:WH_LOT2},
 {id:'q-3',pallet_tag:'GL-P-000103',cases:80,weight_lbs:1500,location:'conri',status:'stored',current_transfer_id:null,received_at_conri:whDay(-6)+'T15:00:00Z',sku:WH_SKU2,lot:WH_LOT3},
 {id:'q-4',pallet_tag:'GL-P-000104',cases:1,location:'conri',status:'stored',current_transfer_id:null,received_at_conri:new Date(Date.now()-3*864e5).toISOString(),expected_pull_date:whDay(-1),sku:WH_SKU3,lot:null}
];
const WH_DATA={
  clients:[WH_CAMO,WH_PER], wh_transfers:[WH_T1,WH_T2],
  wh_transfer_lines:WH_SEED.map(p=>({transfer_id:WH_T1.id,line_no:p.line_no,pallet:p})),
  wh_pallets:WH_SEED.concat(WH_AT), wh_movements:[], wh_outbound_orders:[],
  wh_skus:[WH_SKU,WH_SKU2,WH_SKU3], wh_lots:[WH_LOT,WH_LOT2,WH_LOT3]
};

// ── Quotes → invoices (#417, #420, #421, #434, #438, #439) ──
// Saved quotes as the 🗂 Quotes list reads them. The first one carries real
// sections so 🧾 Invoice can build its option list; the others only need the
// list columns. pkg keys are the canning pkg keys CANNING_ADDONS reads.
const Q_SECTION={productType:'canning',format:'12oz Standard',
  tiers:[{cases:501,cans:12024,fillPerCan:0.38},{cases:1000,cans:24000,fillPerCan:0.35}],
  pkg:{nitrogenOn:true,nitrogenPerCan:0.03,tray24On:true,tray24PerCase:0.5,palletOn:true,palletEach:12,palletWrapOn:true,palletWrapEach:8,casesPerPallet:80,changeOverOn:true,changeOverFee:100},
  bpkg:{},lines:[]};
const QUOTES_DATA=[
  {id:'q1',quote_number:'GLQ-202609-004',quote_date:isoDaysAgo(3),valid_days:30,status:'sent',package_format:'12oz Standard',client_id:'c1',deal_id:'d1',client_name:'Perico Nutrition',client_email:'ana@perico.co',sent_at:isoDaysAgo(3),sent_to:'ana@perico.co',sections:[Q_SECTION],custom_lines:[],created_at:isoDaysAgo(3)},
  {id:'q2',quote_number:'GLQ-202609-003',quote_date:isoDaysAgo(9),valid_days:30,status:'sent',package_format:'750ml Bottle',client_id:null,deal_id:'d2',client_name:'Lotus Beverages',client_email:'sam@lotus.co',sent_at:isoDaysAgo(9),sent_to:'sam@lotus.co',sections:[],custom_lines:[],created_at:isoDaysAgo(9)},
  {id:'q3',quote_number:'GLQ-202608-002',quote_date:isoDaysAgo(45),valid_days:30,status:'draft',package_format:'16oz Standard',client_id:null,deal_id:null,client_name:'Cold Brew Collective',client_email:'dana@coldbrew.co',sections:[],custom_lines:[],created_at:isoDaysAgo(45)},
  {id:'q4',quote_number:'GLQ-202608-001',quote_date:isoDaysAgo(50),valid_days:30,status:'accepted',package_format:'12oz Sleek',client_id:'c1',deal_id:null,client_name:'Perico Nutrition',client_email:'ana@perico.co',sections:[],custom_lines:[],created_at:isoDaysAgo(50)}
];

const STORYBOARDS={
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
        window.supa.rpc=async(n)=>({data:(D.__rpc[n]!==undefined?D.__rpc[n]:null),error:null});
        window.supa.auth.getSession=async()=>({data:{session:{user:{id:'cust1'}}}});
        window.currentUser=null;
        try{ sessionStorage.removeItem('gl-portal-tab'); sessionStorage.removeItem('gl-portal-project'); }catch(e){}
        await window.glCheckPortal();
      }, PORTAL_DATA);
      await sleep(1400);
      await pg.evaluate(()=>window.__hud());
    },
    steps:[
      {say:"This is the Customer Portal: the private page each of your brands signs into. They only ever see their own company's projects, documents and invoices."},
      {say:"Their balance and quick actions sit at the top. They can request samples, place an order, ask for a quote, or ask you a question.", act:{type:'move',sel:'text=Request a quote'}},
      {say:"Each project has its own tracker. A client with more than one project switches between them here.", act:{type:'move',sel:'[data-gl-action="glPortalPickProject"]'}},
      {say:"The status card tells them what is happening. When a milestone is waiting on them, it says so in plain words, with the note you wrote and the target date.", act:{type:'move',sel:'text=WE NEED SOMETHING FROM YOU',center:true}},
      {say:"Project Progress shows every development stage, and packaging and artwork as a separate track, so they always know what is done and what is next.", act:{type:'move',sel:'text=PROJECT PROGRESS',after:'text=WE NEED SOMETHING FROM YOU'}},
      {say:"Everything else is organized into tabs. Documents holds their C O As, agreements, and any file you have chosen to share with them.", act:{type:'click',sel:'[data-gl-action="glPortalTab"][data-gl-arg1="documents"]',after:'[data-gl-action="glPortalPickProject"]'}},
      {say:"The Formula tab shows the status of their formula, and any spec sheet or C O A you have released. The recipe itself is never shown, and every download is logged.", act:{type:'click',sel:'[data-gl-action="glPortalTab"][data-gl-arg1="formula"]',after:'[data-gl-action="glPortalPickProject"]'}},
      {say:"Tabs with a lock are services they have not bought yet. Opening one explains the service, with a button to ask you about it.", act:{type:'click',sel:'[data-gl-action="glPortalTab"][data-gl-arg1="analytics"]',after:'[data-gl-action="glPortalPickProject"]'}},
      {say:"Packaging and Artwork is unlocked for this project, because the quote they accepted included it.", act:{type:'click',sel:'[data-gl-action="glPortalTab"][data-gl-arg1="artwork"]',after:'[data-gl-action="glPortalPickProject"]'}},
      {say:"They upload each label here and see every decision you make, with your notes. When you request changes, they upload the revised artwork right from this card.", act:{type:'move',sel:'text=Changes requested'}},
      {say:"Billing lists every invoice, with a P D F and a button to pay online.", act:{type:'click',sel:'[data-gl-action="glPortalTab"][data-gl-arg1="billing"]',after:'[data-gl-action="glPortalPickProject"]'}},
      {say:"In Account settings they keep their contact details and addresses up to date.", act:{type:'click',sel:'#cp-account'}},
      {say:"At the bottom of Account settings, two switches let them choose the emails: production stage updates, and project updates.", act:{type:'move',sel:'#acct-notify-project',center:true}},
      {say:"On your side, all of this is set up from the client's card in the C R M: projects and milestones, portal services, shared documents, and artwork decisions. The Help section called Client Portal, Projects and Sharing walks through each one."}
    ]
  },
  'portal-setup':{
    title:'Setting Up a Client’s Portal',
    seedCore:true,
    async setup(pg){
      await coreSetup(pg,'clients');
      await pg.evaluate((D)=>{
        window.__chain(JSON.parse(JSON.stringify(D)));
        window.currentUser={id:'u1',email:'mike@krail.us',role:'admin',name:'Mike',initials:'MK'};
        window.glOpenEditClient('c1');
        window.__hud();
      }, PORTAL_ADMIN_DATA);
      await sleep(1800);
      // Room under the last panel so the caption bar does not cover it.
      await pg.evaluate(()=>{ const q=document.getElementById('gl-cq-panel'); if(q){ const sp=document.createElement('div'); sp.style.height='190px'; q.after(sp); } window.__hud(); });
    },
    steps:[
      {say:"Everything your client sees in their portal is set up from their client card, which opens when you click the client."},
      {say:"Documents comes first. Every file you upload starts as Internal, so only your team can see it.", act:{type:'move',sel:'#gl-ec-docs',center:true}},
      {say:"To share one, click its Internal badge and confirm. It switches to Visible to client, and the client gets an email that a new document is ready. Product renders and market analysis files land on those tabs in their portal.", act:{type:'move',sel:'#gl-ec-docs .gl-dd-vis >> nth=1'}},
      {say:"Further down is Projects and Milestones. New project creates the whole development track for you, from intake to production ready.", act:{type:'move',sel:'[data-gl-action="glProjectCreate"]',center:true}},
      {say:"Portal Services shows what this project has unlocked. A green check means the client has it. Services are normally unlocked by accepting a quote.", act:{type:'move',sel:'[data-gl-action="glProjectToggleService"] >> nth=1'}},
      {say:"Set each milestone's status, target date, and who acts. Set one to Waiting on client, and the client sees a We need something from you card, and gets an email.", act:{type:'move',sel:'[data-gl-action="glMilestoneSetStatus"] >> nth=5',center:true}},
      {say:"The Note button adds a message the client will read on that milestone. Write it for them, not for the team.", act:{type:'move',sel:'[data-gl-action="glMilestoneNote"] >> nth=5'}},
      {say:"Sending another round of samples? Sampling round adds a fresh sample, feedback and revision round, and keeps the earlier ones.", act:{type:'move',sel:'[data-gl-action="glMilestoneNewRound"]'}},
      {say:"Preview as client shows you exactly what they will see for this project, before they do.", act:{type:'click',sel:'[data-gl-action="glProjectPreviewAsClient"]'}},
      {say:"Close the preview to keep working.", act:{type:'click',sel:'#gl-proj-preview button:has-text("Close")'}},
      {say:"Label Artwork lists each SKU with its status. Record a decision with these buttons. Approved and Changes requested email the client, along with your note. Sent to printer is final.", act:{type:'move',sel:'#gl-ec-artwork .gl-art-decide',center:true}},
      {say:"At the bottom, Production Quotes. When the client accepts a quote, click Services on it.", act:{type:'click',sel:'.gl-q-svc',center:true}},
      {say:"Pick the project, tick what they bought, set the status to Accepted, and save. Those services unlock in their portal straight away and the client is emailed. An accepted quote is locked from then on.", act:{type:'move',sel:'.gl-q-svc-panel',center:true}},
      {say:"That is the whole setup: share documents, run the project, decide on artwork, and accept the quote. The client sees every step in their portal."}
    ]
  },
  warehouse:{
    title:'Warehouse Storage — Pallets at CONRI',
    seedCore:true,
    async setup(pg){
      await coreSetup(pg,'dashboard');
      await pg.evaluate((FIX)=>{
        // warehouse.js chains .eq on columns some joined rows do not carry, so
        // this stub (like tests/warehouse.test.cjs) lets a missing column pass.
        function Q(t,op,p){ this.t=t; this.op=op; this.payload=p; this.f=[]; }
        ['select','neq','in','is','not','order','limit','gte','lte','or'].forEach(m=>{ Q.prototype[m]=function(){ return this; }; });
        Q.prototype.eq=function(k,v){ this.f.push([k,v]); return this; };
        Q.prototype.maybeSingle=Q.prototype.single=function(){ this._one=true; return this; };
        Q.prototype.then=function(res,rej){ var s=this, rows;
          if(s.op==='select') rows=(FIX[s.t]||[]).filter(r=>s.f.every(f=>r[f[0]]===undefined||r[f[0]]===f[1]));
          else rows=[Object.assign({id:s.t+'-new'},s.payload||{})];
          return Promise.resolve({data:s._one?(rows[0]||null):rows,error:null}).then(res,rej); };
        window.supa=Object.assign({},window.supa,{from:t=>({select:()=>new Q(t,'select'),insert:p=>new Q(t,'insert',p),update:p=>new Q(t,'update',p),delete:()=>new Q(t,'delete')})});
        var nav=document.getElementById('nav-warehouse'); if(nav) nav.style.display='';
        window.cNav('warehouse', nav);
        window.__hud();
      }, WH_DATA);
      await sleep(1200); await pg.evaluate(()=>window.__hud());
    },
    steps:[
      {say:"Warehouse Storage tracks every pallet you keep at CONRI Services in Palmetto, and makes the paperwork for every move."},
      {say:"You will find it in the sidebar, under Operations.", act:{type:'move',sel:'#nav-warehouse'}},
      {say:"The dashboard opens with the totals: pallets, cases and units at CONRI, plus warning counts.", act:{type:'move',sel:'text=PALLETS AT CONRI'}},
      {say:"Below that is everything on hand, by client, S K U and lot. Lots within ninety days of their best-by date are highlighted in yellow.", act:{type:'move',sel:'text=On hand at CONRI',center:true}},
      {say:"Empty cans are listed separately, and turn red once they have been in storage more than two days.", act:{type:'move',sel:'text=Empty cans at CONRI',center:true}},
      {say:"Start in the S K U master. Add each client S K U once, then add its lots and release them from Q A hold.", act:{type:'click',sel:'[data-wh="tab"][data-arg="skus"]'}},
      {say:"Export C S V for CONRI makes the file to send them. CONRI has to receive a S K U before you can schedule it in, and if you change a S K U, you export it again.", act:{type:'move',sel:'text=Export CSV for CONRI'}},
      {say:"Every move is a transfer. New transfer starts one as a draft: to CONRI, a pull back, or an outbound pickup.", act:{type:'move',sel:'text=+ New transfer'}},
      {say:"The Transfers tab lists them all with their status. Let's open today's draft.", act:{type:'click',sel:'[data-wh="tab"][data-arg="transfers"]'}},
      {say:"Open it.", act:{type:'click',sel:'[data-wh="openTransfer"]'}},
      {say:"Here are its pallets. Quick build pallets creates them from a S K U and lot, each with its own pallet tag, or pick existing pallets earliest best-by first.", act:{type:'move',sel:'text=Pallets ·',center:true}},
      {say:"To schedule it, click Edit and enter the time agreed with CONRI. The scheduling email button writes the email for you to copy or open in your mail app. Then Mark scheduled.", act:{type:'move',sel:'text=Scheduling email to CONRI'}},
      {say:"Print paperwork downloads the packing list and a barcode label for every pallet.", act:{type:'move',sel:'text=Print paperwork'}},
      {say:"When the load arrives, click Complete, enter what was received, and upload the signed packing list. Completed transfers are locked."},
      {say:"Outbound orders handle a client's release to their carrier, and Reconciliation checks CONRI's inventory file against what the C R M expects, line by line.", act:{type:'move',sel:'[data-wh="tab"][data-arg="recon"]'}},
      {say:"So every pallet at CONRI is accounted for, from the day it leaves until the day it ships."}
    ]
  },
  invoices:{
    title:'Invoices — Bill Your Brands',
    seedCore:true,
    async setup(pg){ await coreSetup(pg,'invoices'); },
    steps:[
      {say:"Invoices is where you bill your brands and see exactly what has been paid and what is still outstanding."},
      {say:"Every invoice is listed with its client, service, amount, date, and a color-coded status — Draft, Pending, Paid, Overdue, or Partial payment.", act:{type:'move',sel:'#inv-body'}},
      {say:"When a client pays part of what they owe, record it with the Part button. The invoice keeps a partial payment badge and shows the balance still owing, so it never looks either fully paid or untouched.", act:{type:'move',sel:'#inv-body tr:has-text("GL-1040")'}},
      {say:"Use the pills at the top to filter. Let's show just the overdue invoices.", act:{type:'click',sel:'#inv-pills .cpill:has-text("Overdue")'}},
      {say:"To create a new one, click New invoice.", act:{type:'click',sel:'button:has-text("New invoice"):visible'}},
      {say:"First, pick the client the invoice is for.", act:{type:'select',sel:'#inv-client',label:'Perico Nutrition'}},
      {say:"Then choose the service. The app auto-prices it from your rate card and builds a live preview on the right — no manual math.", act:{type:'select',sel:'#inv-svc',value:'canning'}},
      {say:"When it looks right, Save and Send emails it straight to the client, or you can save it as a draft for later.", act:{type:'move',sel:'button:has-text("Save & Send"):visible'}},
      {say:"That is invoicing in a nutshell: pick a client, pick a service, and the price and the preview build themselves."}
    ]
  },
  quotes:{
    title:'Quotes → Invoices',
    seedCore:true,
    async setup(pg){
      await coreSetup(pg,'pipeline');
      await pg.evaluate((Q)=>{ window.__chain({quotes:JSON.parse(JSON.stringify(Q))});
        window.currentUser={id:'u1',email:'mike@krail.us',role:'admin',name:'Mike',initials:'MK'}; window.__hud(); }, QUOTES_DATA);
    },
    steps:[
      {say:"Here is how to quote a job, find the quote again, and turn it into an invoice. It all starts on the Pipeline page."},
      {say:"The Quote Builder button starts a new quote. Next to it, the Quotes button lists every quote you have saved.", act:{type:'move',sel:'#gl-pipeline-quote-btn'}},
      {say:"Let's build one. Click Quote Builder.", act:{type:'click',sel:'#gl-pipeline-quote-btn'}},
      {say:"Type who it is for. It suggests your existing clients as you type.", act:{type:'type',sel:'#gl-qb-client-name',text:'Perico Nutrition'}},
      {say:"Pick the product type and package format, then click Load Standard Tiers to fill in the standard volumes at your deck rates.", act:{type:'click',sel:'#gl-qb-auto-tiers'}},
      {say:"Each row is one volume the client can choose. Every number here can be typed over, and anything you change gets an amber border, so custom pricing is easy to spot.", act:{type:'move',sel:'#gl-qb-tiers'}},
      {say:"Below the tiers, tick the add-on services and packaging for this run. Each one is priced from your Price Settings and becomes its own line on the quote.", act:{type:'move',sel:'#gl-qb-addons'}},
      {say:"The new Change Over Fee is a flat charge. It is billed once, so it does not grow with the size of the run.", act:{type:'click',sel:'#gl-qb-changeover-on'}},
      {say:"Quoting more than one size? Duplicate copies this format's tiers and add-ons into a new tab, and you just change the format name.", act:{type:'move',sel:'#gl-qb-dup-section'}},
      {say:"For anything the price deck does not cover, like freight or R and D hours, add a custom line.", act:{type:'move',sel:'#gl-qb-add-line'}},
      {say:"Save and Email Quote sends it and marks it as Sent. The P D F is fully itemized, in the same layout as your invoices. And Save and Create Invoice goes straight to billing.", act:{type:'move',sel:'#gl-qb-send-email'}},
      {say:"Let's close the builder and open the Quotes list.", act:{type:'click',sel:'#gl-qb-close'}},
      {say:"Click Quotes.", act:{type:'click',sel:'#gl-pipeline-quotes-list-btn'}},
      {say:"Every saved quote is here, newest first. It opens on the ones you have sent. Click All to see every quote, or search by company, email or quote number.", act:{type:'click',sel:'#gl-ql-filters >> text=All'}},
      {say:"Each row shows when the quote was sent and to whom. Change its status here, and quotes past their validity are flagged as expired.", act:{type:'move',sel:'#gl-ql-list select'}},
      {say:"When the client says yes, click Invoice on their quote.", act:{type:'click',sel:'.gl-ql-inv'}},
      {say:"This quote offered two volumes, so it asks which option the client chose. Let's pick the thousand case run.", act:{type:'click',sel:'#gl-q2i-pick button:has-text("Option 2")'}},
      {say:"A new invoice opens, already filled in with that option's line items at the quoted prices, including the change over fee.", act:{type:'move',sel:'#gl-inv-body'}},
      {say:"The invoice builder now has the same add-on panel. Tick a box and it adds a line, with the quantity worked out from the case count.", act:{type:'move',sel:'#gl-inv-addons'}},
      {say:"Check it, and click Save Invoice. The invoice lands under Invoices, and the quote stays in your Quotes list as the record of what you offered."}
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
      {say:"Start by typing the run or lot you want to trace. Here, Cold Brew R-2041.", act:{type:'type',sel:'#gl-recall-q',text:'Cold Brew R-2041'}},
      {say:"Then click Trace.", act:{type:'click',sel:'button:has-text("Trace")'}},
      {say:"Backward shows every material and supplier lot that went into the run — concentrate, water, and cans, each with its supplier lot number.", act:{type:'move',sel:'text=/BACKWARD — INPUTS/'}},
      {say:"Forward shows every customer the run shipped to, and the total units — so you know exactly who to contact.", act:{type:'move',sel:'text=/FORWARD — SHIPMENTS/',center:true}},
      {say:"The GMP trail links the food-safety checks from that run. A red flag marks any deviation, like the label check here.", act:{type:'move',sel:'text=/GMP TRAIL \(/',center:true}},
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

// ─────────────────────────── step sync ───────────────────────────
// The recording does not keep wall-clock time: Playwright's recorder drops a
// few seconds over a long run, unevenly (a 132s storyboard came back 128s, with
// most of the loss in its second half). Trimming the front to make the lengths
// match, which is all this used to do, leaves narration drifting seconds away
// from what is on screen. Instead each step paints a marker whose grey level is
// its index; we find where each step starts in the recording and stretch or
// squeeze every step's slice to exactly its narration length.
// Base 40 keeps step 0 clear of the near-black page background (12-20).
const MARK_BASE=40, MARK_STEP=10, MARK_MAX=Math.floor((250-MARK_BASE)/MARK_STEP);   // 21 steps
function markLevel(i){ return MARK_BASE+MARK_STEP*i; }
function stepStarts(vpath, n){
  const FPS=50;
  const raw=execSync(`ffmpeg -loglevel error -i "${vpath}" -vf "crop=6:6:${W-9}:${H-9},fps=${FPS},format=gray" -f rawvideo -`,{maxBuffer:1<<28});
  const N=36, starts=new Array(n).fill(null);
  let next=0;
  // A step counts as started when its exact level holds for HOLD frames: the
  // page fading in at the start sweeps through every grey on the way, and a
  // single matching frame there once put step 12 at 0.5s.
  const HOLD=5, F=Math.floor(raw.length/N);
  const lv=f=>{ let sum=0; for(let k=0;k<N;k++) sum+=raw[f*N+k]; return sum/N; };
  for(let f=0; f+HOLD<=F && next<n; f++){
    let ok=true;
    for(let h=0; h<HOLD && ok; h++) ok=Math.abs(lv(f+h)-markLevel(next))<3.5;
    if(ok){ starts[next]=f/FPS; next++; f+=HOLD-1; }
  }
  return starts;
}

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
// Optional on any act: center:true scrolls the target to mid-screen first
// (scrollIntoViewIfNeeded leaves it wherever it already is, which can be under
// the caption bar); after:'<sel>' smooth-scrolls that element to the top once
// the act is done, e.g. a tab bar so the panel it opened is in view.
async function scrollTo(pg,sel,block){
  try { await pg.locator(sel).first().evaluate((e,block)=>e.scrollIntoView({block,behavior:'smooth'}), block, {timeout:ATO}); await sleep(650); } catch(e){}
}
async function doAct(pg,act){
  if(!act) return;
  if(act.center) await scrollTo(pg,act.sel,'center');
  await doAct1(pg,act);
  if(act.after) await scrollTo(pg,act.after,'start');
}
async function doAct1(pg,act){
  if(act.type==='move'){ await moveCursor(pg,act.sel); return; }
  const pt=await moveCursor(pg,act.sel);
  if(act.type==='click'){ if(pt) await pg.evaluate(({x,y})=>window.__pulse(x,y),pt); await sleep(150); await pg.locator(act.sel).first().click({timeout:ATO}); }
  else if(act.type==='type'){ await pg.locator(act.sel).first().click({timeout:ATO}); await pg.locator(act.sel).first().pressSequentially(act.text,{delay:48,timeout:ATO}); }
  else if(act.type==='select'){ await pg.selectOption(act.sel, act.label?{label:act.label}:act.value, {timeout:ATO}); }
  else if(act.type==='fill'){ await pg.locator(act.sel).first().fill(act.text,{timeout:ATO}); }
}

(async()=>{
const key=process.argv[2]||'prp';
const sb=STORYBOARDS[key]; if(!sb){ console.error('unknown storyboard',key); process.exit(1); }
if(sb.steps.length>MARK_MAX){ console.error(`storyboard ${key} has ${sb.steps.length} steps; step sync supports ${MARK_MAX}`); process.exit(1); }
const work=path.join(SCRATCH,'video',key); fs.mkdirSync(work,{recursive:true});

// 1) synth narration per step, compute per-step target length T_i
console.log('synthesizing narration…');
const T=[]; let A=0;
sb.steps.forEach((s,i)=>{
  const raw=path.join(work,`raw_${i}.wav`);
  execSync(`piper --model ${MODEL} --output_file "${raw}"`,{input:s.say});
  const d=dur(raw); const Ti=LEAD+d+TAILPAD; T.push(Ti); A+=Ti;
  const seg=path.join(work,`seg_${i}.wav`);
  execSync(`ffmpeg -y -loglevel error -i "${raw}" -af "adelay=${Math.round(LEAD*1000)}:all=1,apad" -t ${Ti.toFixed(3)} -ar 22050 -ac 1 "${seg}"`);
});
// concat segments into one narration track
fs.writeFileSync(path.join(work,'list.txt'), sb.steps.map((_,i)=>`file 'seg_${i}.wav'`).join('\n'));
const narration=path.join(work,'narration.wav');
execSync(`ffmpeg -y -loglevel error -f concat -safe 0 -i "${path.join(work,'list.txt')}" -c copy "${narration}"`);
console.log(`narration ${A.toFixed(1)}s across ${sb.steps.length} steps`);

// 2) record the video, forcing each step's wall-time to T_i
const srv=http.createServer((q,s)=>{let p=decodeURIComponent(q.url.split('?')[0]);if(p==='/')p='/index.html';
  fs.readFile(path.join(ROOT,p),(e,b)=>{if(e){s.writeHead(404);s.end();return;}s.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'text/plain'});s.end(b);});});
await new Promise(r=>srv.listen(8941,r));
const br=await chromium.launch({executablePath:process.env.PW_CHROMIUM||undefined,args:['--no-sandbox','--disable-setuid-sandbox']});
const ctx=await br.newContext({viewport:{width:W,height:H},deviceScaleFactor:1,recordVideo:{dir:work,size:{width:W,height:H}}});
const pg=await ctx.newPage();
if(sb.mockRest){
  // page mode: intercept Supabase REST and fulfill from sb.mockRest(table, url)
  await pg.route('**/rest/v1/**', async route=>{
    const u=route.request().url();
    if(route.request().method()==='PATCH'){ return route.fulfill({status:204,body:''}); }
    const m=u.match(/\/rest\/v1\/([a-z_]+)/); const table=m?m[1]:'';
    const rows=sb.mockRest(table,u)||[];
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows)});
  });
}
const startUrl = sb.url ? ('http://127.0.0.1:8941'+sb.url) : 'http://127.0.0.1:8941/index.html';
await pg.goto(startUrl,{waitUntil:'domcontentloaded',timeout:30000});
await pg.waitForTimeout(sb.url?2200:1400);
await pg.evaluate(installCommon);
if(sb.seedCore){ await pg.evaluate(d=>{ window.__coreData=d; }, {clients:CORE_CLIENTS,invoices:CORE_INVOICES,deals:CORE_DEALS}); }
if(sb.url){ await pg.evaluate(()=>window.__hud()); }
if(sb.setup) await sb.setup(pg);
await sleep(300);

const loopStart=Date.now();
for(let i=0;i<sb.steps.length;i++){
  const t=Date.now();
  await pg.evaluate(({t,lv})=>{ window.__vcap(t); window.__mark(lv); }, {t:sb.steps[i].say, lv:markLevel(i)});
  try { await doAct(pg, sb.steps[i].act); } catch(e){ console.error('step',i,'act failed:',e.message); }
  const el=(Date.now()-t)/1000, rem=T[i]-el;
  if(rem>0) await sleep(rem*1000);
}
console.log(`steps took ${((Date.now()-loopStart)/1000).toFixed(1)}s wall`);
const video=pg.video();
await ctx.close();
const vpath=await video.path();
const V=dur(vpath);
console.log(`video ${V.toFixed(1)}s (audio ${A.toFixed(1)}s) → front-trim ${(V-A).toFixed(2)}s`);
await br.close(); srv.close();

// 3) cut the recording at each step's marker, fit every slice to its
//    narration length, mux narration, encode mp4
const outMp4=path.join(SCRATCH,`tutorial-${key}.mp4`);
const S=stepStarts(vpath, sb.steps.length);
if(S.every(x=>x!=null)){
  const parts=[], labels=[];
  S.forEach((st,i)=>{
    const en = i+1<S.length ? S[i+1] : Math.min(V, st+T[i]);
    const L=Math.max(0.04, en-st), k=(T[i]/L);
    parts.push(`[0:v]trim=start=${st.toFixed(3)}:end=${en.toFixed(3)},setpts=(PTS-STARTPTS)*${k.toFixed(5)},fps=25[v${i}]`);
    labels.push(`[v${i}]`);
  });
  const worst=Math.max(...S.map((st,i)=>Math.abs((i+1<S.length?S[i+1]:st+T[i])-st-T[i])));
  console.log(`step sync: ${S.length} markers found, largest per-step correction ${worst.toFixed(2)}s`);
  const fg=path.join(work,'sync.filter');
  fs.writeFileSync(fg, parts.join(';')+';'+labels.join('')+`concat=n=${S.length}:v=1:a=0[vout]`);
  execSync(`ffmpeg -y -loglevel error -i "${vpath}" -i "${narration}" -filter_complex_script "${fg}" -map "[vout]" -map 1:a:0 -c:v libx264 -preset veryfast -pix_fmt yuv420p -r 25 -c:a aac -b:a 128k -shortest -movflags +faststart "${outMp4}"`);
} else {
  // Markers not readable (should not happen): fall back to the old front trim.
  console.warn(`step sync: only ${S.filter(x=>x!=null).length}/${S.length} markers found — falling back to front-trim`);
  const P=Math.max(0, V-A);
  execSync(`ffmpeg -y -loglevel error -ss ${P.toFixed(3)} -i "${vpath}" -i "${narration}" -map 0:v:0 -map 1:a:0 -c:v libx264 -preset veryfast -pix_fmt yuv420p -r 25 -c:a aac -b:a 128k -shortest -movflags +faststart "${outMp4}"`);
}
console.log('WROTE', outMp4, fs.statSync(outMp4).size,'bytes', dur(outMp4).toFixed(1)+'s');
process.exit(0);
})().catch(e=>{console.error('ERR',e);process.exit(1);});
