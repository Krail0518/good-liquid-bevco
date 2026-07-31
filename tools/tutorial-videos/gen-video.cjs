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
const ROOT='/home/user/good-liquid-bevco';
const SCRATCH='/tmp/claude-0/-home-user-good-liquid-bevco/a8dbf2c3-6093-5bf2-adf9-cca45eb015ed/scratchpad';
const MODEL='/opt/piper-voices/en-us-lessac-medium.onnx';
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
      ['order','limit','gte','lte','gt','lt','in','range','not','is','filter','contains','or','ilike','like','match'].forEach(function(m){ c[m]=function(){ return c; }; });
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

const STORYBOARDS={
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
async function moveCursor(pg,sel){
  const box=await pg.locator(sel).first().boundingBox();
  if(!box) return null;
  const x=Math.round(box.x+box.width/2), y=Math.round(box.y+Math.min(box.height/2,22));
  await pg.evaluate(({x,y})=>{const c=document.getElementById('vcursor');c.style.left=x+'px';c.style.top=y+'px';},{x,y});
  await sleep(600); return {x,y};
}
async function doAct(pg,act){
  if(!act) return;
  if(act.type==='move'){ await moveCursor(pg,act.sel); return; }
  const pt=await moveCursor(pg,act.sel);
  if(act.type==='click'){ if(pt) await pg.evaluate(({x,y})=>window.__pulse(x,y),pt); await sleep(150); await pg.locator(act.sel).first().click(); }
  else if(act.type==='type'){ await pg.locator(act.sel).first().click(); await pg.locator(act.sel).first().pressSequentially(act.text,{delay:48}); }
  else if(act.type==='select'){ await pg.selectOption(act.sel,act.value); }
  else if(act.type==='fill'){ await pg.locator(act.sel).first().fill(act.text); }
}

(async()=>{
const key=process.argv[2]||'prp';
const sb=STORYBOARDS[key]; if(!sb){ console.error('unknown storyboard',key); process.exit(1); }
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
if(sb.url){ await pg.evaluate(()=>window.__hud()); }
if(sb.setup) await sb.setup(pg);
await sleep(300);

for(let i=0;i<sb.steps.length;i++){
  const t=Date.now();
  await pg.evaluate(t=>window.__vcap(t), sb.steps[i].say);
  try { await doAct(pg, sb.steps[i].act); } catch(e){ console.error('step',i,'act failed:',e.message); }
  const el=(Date.now()-t)/1000, rem=T[i]-el;
  if(rem>0) await sleep(rem*1000);
}
const video=pg.video();
await ctx.close();
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
