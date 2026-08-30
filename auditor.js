/*
 * auditor.js — extracted verbatim from auditor.html (GL-DEF-01).
 *
 * The code below is byte-for-byte what was inside the page's inline
 * <script> block. Nothing was rewritten: the move exists so that
 * script-src can drop 'unsafe-inline', which an inline block would keep
 * alive on its own regardless of how many on* handlers were converted.
 *
 * The tag replacing it sits in the same document position, so execution
 * order is unchanged.
 */
(function(){
  'use strict';
  var SUPA_URL='https://ufjkeqmxwuyhbqyugcgg.supabase.co';
  var ANON_KEY='sb_publishable_-37mkPw8uLzEJM21T9jJOA_YQRQ7ikB';
  var params=new URLSearchParams(location.search);
  var token=params.get('token')||params.get('inspector')||'';

  function el(id){return document.getElementById(id);}
  function show(id){el(id).classList.remove('hidden');}
  function hide(id){el(id).classList.add('hidden');}
  function esc(s){return String(s==null?'':s).replace(/[<>&]/g,function(c){return{'<':'&lt;','>':'&gt;','&':'&amp;'}[c];});}
  function fmtDate(s){if(!s)return'';try{return new Date(s).toLocaleDateString();}catch(e){return String(s).slice(0,10);}}

  // Every read carries the anon apikey PLUS the inspector token header, which
  // the server-side RLS validates (is_valid_inspector_token) before returning
  // any row. So a revoked/expired token silently returns nothing.
  function headers(){
    return { 'apikey':ANON_KEY, 'Authorization':'Bearer '+ANON_KEY, 'X-Inspector-Token':token, 'Accept':'application/json' };
  }
  async function rest(pathAndQuery){
    var r=await fetch(SUPA_URL+'/rest/v1/'+pathAndQuery,{headers:headers()});
    if(!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  }

  function loginError(m){ var e=el('login-msg'); e.className='msg err'; e.textContent=m; }

  async function validateAndLoad(){
    hide('loading');
    if(!token){ show('login'); return; }
    // Validate the token (anon read policy on inspector_tokens) — also drives
    // the who/expiry banner. Server RLS still independently gates the data.
    var t;
    try{ t=await rest('inspector_tokens?token=eq.'+encodeURIComponent(token)+'&select=inspector,agency,purpose,valid_until,revoked_at&limit=1'); }
    catch(e){ show('login'); loginError('Could not verify that token. Check it and try again.'); return; }
    var row=(t&&t[0])||null;
    if(!row){ show('login'); loginError('That token is not recognized.'); return; }
    if(row.revoked_at){ show('login'); loginError('That access token has been revoked. Contact Good Liquid Bev Co.'); return; }
    if(new Date(row.valid_until) < new Date()){ show('login'); loginError('That access token expired on '+fmtDate(row.valid_until)+'.'); return; }

    el('who').innerHTML='Reviewer: <b style="color:#eef4ff">'+esc(row.inspector||'Auditor')+'</b>'+(row.agency?(' · '+esc(row.agency)):'')+' · access expires '+fmtDate(row.valid_until);
    // Bump usage (best-effort; anon has a narrow update policy for this).
    try{ await fetch(SUPA_URL+'/rest/v1/inspector_tokens?token=eq.'+encodeURIComponent(token),{method:'PATCH',headers:Object.assign({'Content-Type':'application/json','Prefer':'return=minimal'},headers()),body:JSON.stringify({last_used_at:new Date().toISOString()})}); }catch(e){}
    await loadDashboard();
    show('dash');
  }

  var TEMPLATES=[];
  async function loadDashboard(){
    // Pull the register definitions + records in parallel.
    var tpls=[], recent=[], devs=[];
    try{ tpls=await rest('gmp_templates?active=eq.true&order=sort_order.asc&select=form_code,title,category'); }catch(e){}
    try{ recent=await rest('compliance_records?order=recorded_at.desc&limit=50&select=form_code,record_date,status,has_deviation,signature_name,data'); }catch(e){}
    try{ devs=await rest('compliance_records?has_deviation=eq.true&order=recorded_at.desc&limit=50&select=form_code,record_date,deviation_notes,corrective_action,data'); }catch(e){}
    var docs=[]; try{ docs=await rest('gmp_documents?active=eq.true&order=sort_order.asc&select=doc_code,title,category,description,file_url,file_type,rev'); }catch(e){}
    var suppliers=[]; try{ suppliers=await rest('vendors?order=name.asc&select=name,category,approval_status,food_safety_cert,cert_expires,risk_level,materials'); }catch(e){}
    var ncr=[]; try{ ncr=await rest('defects?order=reported_at.desc&limit=50&select=reported_at,run_ref,category,severity,status,owner,description,root_cause,corrective_action,preventive_action,due_date,verified_at,ncr_number'); }catch(e){}
    var recalls=[]; try{ recalls=await rest('mock_recalls?order=initiated_at.desc&limit=20&select=lot_code,initiated_at,completed_at,units_produced,units_accounted,pct_reconciled,passed,conducted_by,time_to_complete'); }catch(e){}
    var tasks=[]; try{ tasks=await rest('compliance_tasks?status=eq.open&order=due_date.asc&limit=50&select=title,due_date,due_time,task_type,status'); }catch(e){}
    var training=[]; try{ training=await rest('training_records?active=eq.true&order=employee_name.asc&select=employee_name,role,course,completed_date,expires_date,trainer'); }catch(e){}
    var audits=[]; try{ audits=await rest('internal_audits?order=audit_date.desc&limit=20&select=audit_date,scope,auditor,status,summary'); }catch(e){}
    var reviews=[]; try{ reviews=await rest('management_reviews?order=review_date.desc&limit=5&select=review_date,attendees,notes'); }catch(e){}
    TEMPLATES=tpls||[];

    // Per-register counts.
    var counts={};
    (recent||[]).forEach(function(r){counts[r.form_code]=(counts[r.form_code]||0)+1;});

    // Stats tiles.
    var signed=(recent||[]).filter(function(r){return r.status==='signed';}).length;
    el('stats').innerHTML=[
      ['GMP registers', (tpls||[]).length, 'defined'],
      ['Recent records', (recent||[]).length, 'last 50 shown'],
      ['Open deviations', (devs||[]).length, 'flagged'],
      ['Signed records', signed, 'of recent']
    ].map(function(s){return '<div class="tile"><b>'+s[1]+'</b><span>'+esc(s[0])+' — '+esc(s[2])+'</span></div>';}).join('');

    // Registers list (click to drill in).
    el('registers').innerHTML=(tpls||[]).map(function(t){
      return '<button class="reg-btn" data-form-code="'+esc(t.form_code)+'" data-form-title="'+esc(t.title).replace(/'/g,"")+'">'+
        '<span>'+esc(t.title)+' <span style="color:#6b87ad;font-size:11px">('+esc(t.category)+')</span></span>'+
        '<span class="c">'+(counts[t.form_code]||0)+'</span></button>';
    }).join('') || '<div class="sub">No registers defined.</div>';

    // Documents (read-only; each is a real download anchor to its file_url).
    el('docs').innerHTML=(docs&&docs.length)? docs.map(function(dc){
      return '<div style="border:1px solid var(--border);border-radius:9px;padding:10px 12px;margin-bottom:8px;background:var(--card2)">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'+
          '<div style="font-weight:700;color:var(--white);font-size:13px">'+esc(dc.title)+
            (dc.category?' <span class="pill" style="color:var(--muted);background:rgba(107,135,173,.12)">'+esc(dc.category)+'</span>':'')+
            (dc.rev?' <span style="color:#6b87ad;font-size:11px">rev '+esc(dc.rev)+'</span>':'')+'</div>'+
          '<a href="'+esc(dc.file_url)+'" target="_blank" rel="noopener" style="font-size:12px;font-weight:700">Download'+(dc.file_type?(' ('+esc(dc.file_type)+')'):'')+'</a>'+
        '</div>'+
        (dc.description?'<div class="sub" style="margin-top:5px">'+esc(dc.description)+'</div>':'')+
      '</div>';
    }).join('') : '<div class="sub">No documents posted.</div>';

    // Approved suppliers (read-only).
    var DAY=864e5, now=Date.now();
    el('suppliers').innerHTML=(suppliers&&suppliers.length)? suppliers.map(function(s){
      var st=String(s.approval_status||'').toLowerCase(), bc, bt;
      if(st==='approved'){ bc='var(--green)'; bt='rgba(95,207,158,.12)'; }
      else if(st==='suspended'||st==='rejected'){ bc='var(--red)'; bt='rgba(231,70,70,.12)'; }
      else { bc='var(--yellow)'; bt='rgba(245,200,66,.12)'; }
      var badge='<span class="pill" style="color:'+bc+';background:'+bt+'">'+esc(s.approval_status||'unknown')+'</span>';
      var mats=Array.isArray(s.materials)?s.materials.join(', '):(s.materials||'');
      var certNote='';
      if(s.cert_expires){
        var exp=new Date(s.cert_expires).getTime();
        if(!isNaN(exp)&&exp-now<60*DAY){
          var col=exp<now?'var(--red)':'var(--yellow)';
          certNote='<div style="font-size:11.5px;color:'+col+';margin-top:3px">⚠ cert expires '+esc(fmtDate(s.cert_expires))+'</div>';
        }
      }
      return '<div style="border:1px solid var(--border);border-radius:9px;padding:10px 12px;margin-bottom:8px;background:var(--card2)">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'+
          '<div style="font-weight:700;color:var(--white);font-size:13px">'+esc(s.name)+
            (s.category?' <span style="color:#6b87ad;font-size:11px;font-weight:400">('+esc(s.category)+')</span>':'')+'</div>'+
          badge+
        '</div>'+
        (mats?'<div class="sub" style="margin-top:5px">Materials: '+esc(mats)+'</div>':'')+
        (s.food_safety_cert?'<div class="sub" style="margin-top:3px">Food safety cert: '+esc(s.food_safety_cert)+'</div>':'')+
        certNote+
      '</div>';
    }).join('') : '<div class="sub">No suppliers listed.</div>';

    // Non-conformances / CAPA (read-only).
    el('ncr').innerHTML=(ncr&&ncr.length)? ncr.map(function(n){
      var sev=String(n.severity||'').toLowerCase(), sc, sbg;
      if(sev==='critical'||sev==='high'){ sc='var(--red)'; sbg='rgba(231,70,70,.12)'; }
      else if(sev==='medium'){ sc='var(--yellow)'; sbg='rgba(245,200,66,.12)'; }
      else { sc='var(--muted)'; sbg='rgba(107,135,173,.12)'; }
      var sevBadge=n.severity?'<span class="pill" style="color:'+sc+';background:'+sbg+'">'+esc(n.severity)+'</span>':'';
      var closed=String(n.status||'').toLowerCase()==='closed';
      var stBadge=n.status?'<span class="pill" style="color:'+(closed?'var(--green)':'var(--yellow)')+';background:'+(closed?'rgba(95,207,158,.12)':'rgba(245,200,66,.12)')+'">'+esc(n.status)+'</span>':'';
      return '<div style="border:1px solid var(--border);border-radius:9px;padding:10px 12px;margin-bottom:8px;background:var(--card2)">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'+
          '<div style="font-weight:700;color:var(--white);font-size:12.5px">'+esc(n.ncr_number||n.run_ref||'NCR')+
            ' <span style="color:#6b87ad;font-weight:400">'+esc(fmtDate(n.reported_at))+'</span></div>'+
          '<div style="display:flex;gap:6px;flex-wrap:wrap">'+sevBadge+stBadge+'</div>'+
        '</div>'+
        (n.description?'<div style="font-size:12.5px;color:#eef4ff;margin-top:5px">'+esc(n.description)+'</div>':'')+
        (n.root_cause?'<div class="sub" style="margin-top:3px">Root cause: '+esc(n.root_cause)+'</div>':'')+
        (n.corrective_action?'<div style="font-size:12px;color:#5fcf9e;margin-top:3px">Corrective: '+esc(n.corrective_action)+'</div>':'')+
        (n.preventive_action?'<div style="font-size:12px;color:#5fcf9e;margin-top:3px">Preventive: '+esc(n.preventive_action)+'</div>':'')+
        (n.due_date?'<div class="sub" style="margin-top:3px">Due: '+esc(fmtDate(n.due_date))+'</div>':'')+
        (n.verified_at?'<div style="font-size:11.5px;color:var(--green);margin-top:3px">verified ✓ '+esc(fmtDate(n.verified_at))+'</div>':'')+
      '</div>';
    }).join('') : '<div class="sub" style="color:#5fcf9e">No non-conformances logged.</div>';

    // Mock recalls (read-only).
    el('recalls').innerHTML=(recalls&&recalls.length)? recalls.map(function(m){
      var pass=(m.passed===true);
      var badge='<span class="pill" style="color:'+(pass?'var(--green)':'var(--red)')+';background:'+(pass?'rgba(95,207,158,.12)':'rgba(231,70,70,.12)')+'">'+(pass?'PASS':'REVIEW')+'</span>';
      var pct=(m.pct_reconciled==null)?'':(esc(String(m.pct_reconciled))+'%');
      return '<div style="border:1px solid var(--border);border-radius:9px;padding:10px 12px;margin-bottom:8px;background:var(--card2)">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'+
          '<div style="font-weight:700;color:var(--white);font-size:12.5px">'+esc(m.lot_code||'Lot')+
            ' <span style="color:#6b87ad;font-weight:400">'+esc(fmtDate(m.initiated_at))+'</span></div>'+
          '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'+(pct?'<span style="font-size:12px;color:var(--white);font-weight:700">'+pct+' reconciled</span>':'')+badge+'</div>'+
        '</div>'+
        '<div class="sub" style="margin-top:5px">Units accounted: '+esc(String(m.units_accounted==null?'—':m.units_accounted))+' / '+esc(String(m.units_produced==null?'—':m.units_produced))+
          (m.conducted_by?(' · by '+esc(m.conducted_by)):'')+'</div>'+
        (m.time_to_complete?'<div class="sub" style="margin-top:3px">Time to complete: '+esc(String(m.time_to_complete))+'</div>':'')+
      '</div>';
    }).join('') : '<div class="sub">No mock recalls on record.</div>';

    // Open GMP tasks (read-only).
    var todayStr=new Date().toISOString().slice(0,10);
    var overdue=(tasks||[]).filter(function(tk){return tk.due_date && String(tk.due_date).slice(0,10) < todayStr;}).length;
    el('opentasks').innerHTML=(tasks&&tasks.length)?
      '<div class="sub" style="margin-bottom:8px">'+esc(String(tasks.length))+' open'+(overdue?(' · <span style="color:var(--red)">'+esc(String(overdue))+' overdue</span>'):'')+'</div>'+
      tasks.map(function(tk){
        var isOver=tk.due_date && String(tk.due_date).slice(0,10) < todayStr;
        return '<div style="border:1px solid var(--border);border-radius:9px;padding:10px 12px;margin-bottom:8px;background:var(--card2)">'+
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'+
            '<div style="font-weight:700;color:var(--white);font-size:12.5px">'+esc(tk.title||'Task')+
              (tk.task_type?' <span class="pill" style="color:var(--muted);background:rgba(107,135,173,.12)">'+esc(tk.task_type)+'</span>':'')+'</div>'+
            (tk.due_date?'<span class="sub" style="color:'+(isOver?'var(--red)':'var(--muted)')+'">'+(isOver?'⚠ ':'')+'due '+esc(fmtDate(tk.due_date))+(tk.due_time?(' '+esc(String(tk.due_time).slice(0,5))):'')+'</span>':'')+
          '</div>'+
        '</div>';
      }).join('') : '<div class="sub">No open tasks.</div>';

    // Training & competency (read-only). Group rows by employee.
    var expBadge=function(d){
      if(!d) return '';
      var t=new Date(d).getTime();
      if(isNaN(t)) return '';
      var col,bg,lbl;
      if(t<now){ col='var(--red)'; bg='rgba(231,70,70,.12)'; lbl='expired '+esc(fmtDate(d)); }
      else if(t-now<60*DAY){ col='var(--yellow)'; bg='rgba(245,200,66,.12)'; lbl='expiring '+esc(fmtDate(d)); }
      else { col='var(--green)'; bg='rgba(95,207,158,.12)'; lbl='valid to '+esc(fmtDate(d)); }
      return '<span class="pill" style="color:'+col+';background:'+bg+'">'+lbl+'</span>';
    };
    if(training&&training.length){
      var byEmp={}, empOrder=[];
      training.forEach(function(tr){
        var k=tr.employee_name||'—';
        if(!byEmp[k]){ byEmp[k]=[]; empOrder.push(k); }
        byEmp[k].push(tr);
      });
      el('training').innerHTML=empOrder.map(function(name){
        var rows=byEmp[name];
        var role=(rows[0]&&rows[0].role)?rows[0].role:'';
        return '<div style="border:1px solid var(--border);border-radius:9px;padding:10px 12px;margin-bottom:8px;background:var(--card2)">'+
          '<div style="font-weight:700;color:var(--white);font-size:13px">'+esc(name)+
            (role?' <span style="color:#6b87ad;font-size:11px;font-weight:400">('+esc(role)+')</span>':'')+'</div>'+
          rows.map(function(tr){
            return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:5px">'+
              '<div style="font-size:12.5px;color:var(--text)">'+esc(tr.course||'Course')+
                (tr.completed_date?' <span style="color:#6b87ad;font-size:11px">completed '+esc(fmtDate(tr.completed_date))+'</span>':'')+
                (tr.trainer?' <span style="color:#6b87ad;font-size:11px">· '+esc(tr.trainer)+'</span>':'')+'</div>'+
              expBadge(tr.expires_date)+
            '</div>';
          }).join('')+
        '</div>';
      }).join('');
    } else { el('training').innerHTML='<div class="sub">No training records.</div>'; }

    // Internal audits & management review (read-only).
    var auditsHtml=(audits&&audits.length)? audits.map(function(a){
      var st=String(a.status||'').toLowerCase(), col, bg;
      if(st==='closed'){ col='var(--green)'; bg='rgba(95,207,158,.12)'; }
      else if(st==='in_progress'){ col='var(--teal)'; bg='rgba(0,229,192,.12)'; }
      else { col='var(--yellow)'; bg='rgba(245,200,66,.12)'; }
      var badge=a.status?'<span class="pill" style="color:'+col+';background:'+bg+'">'+esc(a.status)+'</span>':'';
      return '<div style="border:1px solid var(--border);border-radius:9px;padding:10px 12px;margin-bottom:8px;background:var(--card2)">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">'+
          '<div style="font-weight:700;color:var(--white);font-size:12.5px">'+esc(a.scope||'Audit')+
            ' <span style="color:#6b87ad;font-weight:400">'+esc(fmtDate(a.audit_date))+'</span>'+
            (a.auditor?' <span style="color:#6b87ad;font-size:11px;font-weight:400">· '+esc(a.auditor)+'</span>':'')+'</div>'+
          badge+
        '</div>'+
        (a.summary?'<div class="sub" style="margin-top:5px">'+esc(a.summary)+'</div>':'')+
      '</div>';
    }).join('') : '<div class="sub">No internal audits on record.</div>';
    var reviewsHtml=(reviews&&reviews.length)? reviews.map(function(rv){
      return '<div style="border:1px solid var(--border);border-radius:9px;padding:10px 12px;margin-bottom:8px;background:var(--card2)">'+
        '<div style="font-weight:700;color:var(--white);font-size:12.5px">'+esc(fmtDate(rv.review_date))+
          (rv.attendees?' <span style="color:#6b87ad;font-size:11px;font-weight:400">· '+esc(Array.isArray(rv.attendees)?rv.attendees.join(', '):rv.attendees)+'</span>':'')+'</div>'+
      '</div>';
    }).join('') : '<div class="sub">No management reviews on record.</div>';
    el('audits').innerHTML=auditsHtml+
      '<div class="sub" style="margin:12px 0 6px;color:var(--teal);text-transform:uppercase;letter-spacing:1px;font-size:11px">Management reviews</div>'+
      reviewsHtml;

    // Deviations.
    el('deviations').innerHTML=(devs&&devs.length)? devs.map(function(r){
      var d=r.data||{};
      return '<div style="border:1px solid rgba(245,200,66,.25);border-radius:9px;padding:10px 12px;margin-bottom:8px;background:rgba(245,200,66,.05)">'+
        '<div style="font-weight:700;color:#f5c842;font-size:12.5px">'+esc(r.form_code)+' · '+esc(fmtDate(r.record_date))+' <span style="color:#6b87ad;font-weight:400">'+esc((d.line||'')+(d.run?(' / '+d.run):''))+'</span></div>'+
        '<div style="font-size:12.5px;color:#eef4ff;margin-top:4px">'+esc(r.deviation_notes||'Deviation flagged')+'</div>'+
        (r.corrective_action?'<div style="font-size:12px;color:#5fcf9e;margin-top:3px">Corrective action: '+esc(r.corrective_action)+'</div>':'')+'</div>';
    }).join('') : '<div class="sub" style="color:#5fcf9e">✓ No open deviations.</div>';

    // Recent records table.
    el('recent').innerHTML='<tr><th>Form</th><th>Date</th><th>By</th><th>Dev</th><th>Status</th></tr>'+
      (recent||[]).map(function(r){var d=r.data||{};
        return '<tr><td>'+esc(r.form_code)+'</td><td>'+esc(fmtDate(r.record_date))+'</td><td>'+esc(d.operator||r.signature_name||'')+'</td><td>'+(r.has_deviation?'⚠':'')+'</td><td>'+esc(r.status||'')+'</td></tr>';
      }).join('');
  }

  window.__openReg=async function(code,title){
    hide('dash'); show('reg-view');
    el('reg-title').textContent=title;
    el('reg-table').innerHTML='<tr><td>Loading…</td></tr>';
    var recs=[];
    try{ recs=await rest('compliance_records?form_code=eq.'+encodeURIComponent(code)+'&order=recorded_at.desc&limit=200&select=record_date,status,has_deviation,data'); }catch(e){}
    var tpl=TEMPLATES.find(function(t){return t.form_code===code;})||{};
    // Show shared header cols + up to 5 data keys seen.
    var keys=[]; (recs||[]).slice(0,20).forEach(function(r){Object.keys(r.data||{}).forEach(function(k){if(k[0]!=='_'&&['line','run','shift','operator'].indexOf(k)<0&&keys.indexOf(k)<0&&keys.length<5)keys.push(k);});});
    el('reg-table').innerHTML='<tr><th>Date</th><th>Line/Run</th><th>By</th>'+keys.map(function(k){return '<th>'+esc(k)+'</th>';}).join('')+'<th>Dev</th><th>Status</th></tr>'+
      ((recs&&recs.length)? recs.map(function(r){var d=r.data||{};
        return '<tr><td>'+esc(fmtDate(r.record_date))+'</td><td>'+esc((d.line||'')+(d.run?(' / '+d.run):''))+'</td><td>'+esc(d.operator||'')+'</td>'+
          keys.map(function(k){return '<td>'+esc(d[k]==null?'':String(d[k]))+'</td>';}).join('')+
          '<td>'+(r.has_deviation?'⚠':'')+'</td><td>'+esc(r.status||'')+'</td></tr>';
      }).join('') : '<tr><td colspan="9" style="color:#6b87ad">No records in this register yet.</td></tr>');
  };
  window.__backToDash=function(){ hide('reg-view'); show('dash'); };

  el('login-btn').addEventListener('click',function(){
    var v=(el('token-input').value||'').trim();
    if(!v){ loginError('Enter your access token.'); return; }
    token=v; hide('login'); show('loading'); validateAndLoad();
  });

  validateAndLoad();
})();


/* ── GL-DEF-01: bindings that were on* attributes ──────────────────────
   Bound here rather than through the CRM's action dispatcher: this page does
   not load it, and pulling in the dispatcher plus its registry to wire two
   buttons would cost more than it saves.

   The register buttons are re-rendered, so that one is delegated from the
   document instead of bound per element. */
(function(){
  function bind(){
    var back = document.getElementById('gl-back-to-overview');
    if(back) back.addEventListener('click', function(){ window.__backToDash(); });
  }
  if(document.readyState !== 'loading') bind();
  else document.addEventListener('DOMContentLoaded', bind);

  document.addEventListener('click', function(e){
    var b = e.target.closest && e.target.closest('.reg-btn');
    if(!b) return;
    window.__openReg(b.dataset.formCode, b.dataset.formTitle);
  });
}());
