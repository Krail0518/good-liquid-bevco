/*
 * calendar.js — extracted from crm-index-core.js (GL-037).
 *
 * VERBATIM move: the code below is byte-for-byte what was in the core, so
 * this diff is a relocation and nothing else.
 *
 * Loads AFTER crm-index-core.js and must stay a CLASSIC script — no defer,
 * async or type="module". Its top-level declarations become window
 * properties, which is how the inline on* handlers in index.html resolve
 * them. A module-scoped version would leave those handlers dead with no
 * error to show for it.
 *
 * Declares: glCalEventsBackfill, loadCalEvents, saveCalEvents, openCalEventModal, closeCalEventModal, saveCalEvent, renderCal, calPrev, calNext, setCalView, fmtCalTime, renderCalList, renderProductionRuns, updateProdStatus, deleteProdRun
 */
/* ═══════════════════════════════════════════
   CALENDAR SYSTEM
═══════════════════════════════════════════ */
/* Calendar events: source of truth is public.cal_events. In-memory
   cache rebuilt from DB on every page open + after each mutation. */
let calEvents = [];
let calCurrentDate = { general: new Date(), production: new Date() };
let calViewMode = 'month';

async function glCalEventsBackfill(){
  try {
    if(localStorage.getItem('gl_cal_events_migrated') === '1') return;
    if(!window.supa) return;
    const blob = localStorage.getItem('gl_cal_events');
    if(!blob){ localStorage.setItem('gl_cal_events_migrated','1'); return; }
    let legacy = []; try { legacy = JSON.parse(blob) || []; } catch(_e){ return; }
    if(!legacy.length){ localStorage.setItem('gl_cal_events_migrated','1'); return; }
    const rows = legacy.map(e => ({
      event_type:  e.type || 'general',
      title:       String(e.title || '(untitled)').slice(0, 500),
      event_date:  e.date,
      event_time:  e.time || null,
      notes:       e.notes || null,
      remind:      e.remind || null,
      client_id:   /^[0-9a-f-]{36}$/i.test(e.clientId||'') ? e.clientId : null,
      format:      e.format || null,
      qty:         e.qty || null,
      due_date:    e.dueDate || null,
      prod_status: e.prodStatus || null,
      created_at:  e.createdAt || new Date().toISOString()
    })).filter(r => r.event_date);
    if(!rows.length){ localStorage.setItem('gl_cal_events_migrated','1'); return; }
    const r = await window.supa.from('cal_events').insert(rows);
    if(r.error){ console.warn('[GL] cal_events backfill failed', r.error.message); return; }
    localStorage.setItem('gl_cal_events_migrated','1');
    if(typeof addNotification === 'function'){
      addNotification('📅 Calendar migrated', rows.length + ' event' + (rows.length===1?'':'s') + ' moved to the cloud.', 'success');
    }
  } catch(e){ console.warn('[GL] cal_events backfill threw', e); }
}

async function loadCalEvents(){
  if(!window.supa){ calEvents = []; return; }
  await glCalEventsBackfill();
  const r = await window.supa.from('cal_events')
    .select('id, event_type, title, event_date, event_time, notes, remind, client_id, format, qty, due_date, prod_status, created_at')
    .order('event_date', { ascending: true })
    .limit(2000);
  if(r.error){ console.warn('[GL] loadCalEvents failed', r.error.message); calEvents = []; return; }
  calEvents = (r.data || []).map(e => ({
    id: e.id, type: e.event_type, title: e.title, date: e.event_date,
    time: e.event_time, notes: e.notes, remind: e.remind, clientId: e.client_id,
    format: e.format, qty: e.qty, dueDate: e.due_date, prodStatus: e.prod_status,
    createdAt: e.created_at
  }));
}

function saveCalEvents(){ /* DEPRECATED no-op — calendar events persist via Supabase INSERT/UPDATE/DELETE now */ }

function openCalEventModal(type, date){
  document.getElementById('cal-event-type').value=type;
  document.getElementById('cal-prod-fields').style.display=type==='production'?'block':'none';
  document.getElementById('cal-ev-date').value=date||new Date().toISOString().split('T')[0];
  // Populate client dropdown
  const sel=document.getElementById('cal-ev-client');
  sel.innerHTML='<option value="">Select client…</option>'+clients.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  document.getElementById('cal-event-modal').classList.add('show');
}

function closeCalEventModal(){ document.getElementById('cal-event-modal').classList.remove('show'); }

async function saveCalEvent(){
  const type=document.getElementById('cal-event-type').value;
  const title=document.getElementById('cal-ev-title').value.trim();
  const date=document.getElementById('cal-ev-date').value;
  const time=document.getElementById('cal-ev-time').value;
  const notes=document.getElementById('cal-ev-notes').value;
  const remind=document.getElementById('cal-ev-remind').value;
  if(!title||!date){alert('Title and date are required');return;}
  
  // Build the DB row. type=production carries the prod-specific extras.
  const dbRow = {
    event_type: type,
    title,
    event_date: date,
    event_time: time || null,
    notes:      notes || null,
    remind:     remind || null
  };
  if(type === 'production'){
    const cid = document.getElementById('cal-ev-client').value || null;
    dbRow.client_id   = /^[0-9a-f-]{36}$/i.test(cid||'') ? cid : null;
    dbRow.format      = document.getElementById('cal-ev-format').value || null;
    dbRow.qty         = document.getElementById('cal-ev-qty').value || null;
    dbRow.due_date    = document.getElementById('cal-ev-due').value || null;
    dbRow.prod_status = 'scheduled';
  }
  if(!window.supa){ alert('Cloud sync unavailable — try reloading.'); return; }
  const ins = await window.supa.from('cal_events').insert([dbRow]).select('id').single();
  if(ins.error){ alert('Save event failed: ' + ins.error.message); return; }
  // Mirror into the in-memory cache (so renderers that read synchronously
  // see the new event before the next loadCalEvents()).
  const ev = { id: ins.data.id, type, title, date, time, notes, remind, createdAt: new Date().toISOString() };
  if(type === 'production'){
    ev.clientId = dbRow.client_id; ev.format = dbRow.format; ev.qty = dbRow.qty;
    ev.dueDate = dbRow.due_date; ev.prodStatus = dbRow.prod_status;
  }
  calEvents.push(ev);
  
  if(remind){
    addNotification('📅 Reminder set: '+title,'Reminder for '+date+' at '+time,'reminder');
  }
  
  closeCalEventModal();
  renderCal(type);
  if(type==='production') renderProductionRuns();
  addNotification('📅 Event added: '+title,date+' at '+time,'success');
  activities.unshift({type:'note',icon:'📅',name:'Calendar: '+title,detail:date+' '+time,time:'Just now'});saveActivities();
  document.getElementById('cal-ev-title').value='';
}

function renderCal(type){
  const el=document.getElementById(`cal-grid-${type}`);
  const lblEl=document.getElementById(`cal-month-label-${type}`);
  if(!el) return;
  const d=calCurrentDate[type];
  const year=d.getFullYear(), month=d.getMonth();
  lblEl.textContent=d.toLocaleString('default',{month:'long',year:'numeric'});
  
  // DOW headers
  const dowEl=document.getElementById(`cal-dow-${type}`);
  if(dowEl) dowEl.innerHTML=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div class="cal-day-label">${d}</div>`).join('');
  
  const firstDay=new Date(year,month,1).getDay();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const today=new Date();
  let html='';
  
  // Blank cells before first
  for(let i=0;i<firstDay;i++){
    const prevDate=new Date(year,month,-(firstDay-i-1));
    const pdow=prevDate.getDay();
    html+=`<div class="cal-day other-month${pdow===0||pdow===6?' weekend':''}"><div class="cal-day-num" style="color:rgba(107,135,173,.2)">${prevDate.getDate()}</div></div>`;
  }

  const todayMidnight=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  for(let day=1;day<=daysInMonth;day++){
    const dateStr=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const dow=new Date(year,month,day).getDay();
    const isWeekend=dow===0||dow===6;
    const isToday=today.getFullYear()===year&&today.getMonth()===month&&today.getDate()===day;
    const isPast=new Date(year,month,day)<todayMidnight;
    const legacyDay=calEvents.filter(e=>e.date===dateStr&&(type==='general'?e.type!=='production':e.type==='production'));
    const prunDay=(window.glProductionRuns||[]).filter(r=>(r.scheduled_start_date||r.scheduled_date)===dateStr).map(r=>({title:(r.run_name||'(untitled)')+(r.client_name?' — '+r.client_name:''),type:type==='production'?'production':'production-run'}));
    const dayEvents=[...legacyDay,...prunDay];
    const hasEvents=dayEvents.length>0;
    html+=`<div class="cal-day${isToday?' today':''}${isWeekend?' weekend':''}${isPast&&!isToday?' past':''}${hasEvents?' has-events':''}" data-gl-action="openCalEventModal" data-gl-arg1="${esc(type)}" data-gl-arg2="${esc(dateStr)}">
      <div class="cal-day-num">${day}</div>
      ${dayEvents.slice(0,3).map(e=>`<div class="cal-event ${esc(e.type)}" title="${esc(e.title)}">${esc(String(e.title||'').substring(0,18))}${e.title.length>18?'…':''}</div>`).join('')}
      ${dayEvents.length>3?`<div class="cal-more">+${dayEvents.length-3} more</div>`:''}
    </div>`;
  }
  el.innerHTML=html;
}

function calPrev(type){ const d=calCurrentDate[type]; d.setMonth(d.getMonth()-1); if(type==='general'&&calViewMode==='list'){ renderCal(type); renderCalList(type); } else { renderCal(type); } }
function calNext(type){ const d=calCurrentDate[type]; d.setMonth(d.getMonth()+1); if(type==='general'&&calViewMode==='list'){ renderCal(type); renderCalList(type); } else { renderCal(type); } }

function setCalView(view,el){
  calViewMode=view;
  document.querySelectorAll('.cal-tab').forEach(t=>t.classList.remove('act'));
  el.classList.add('act');
  const grid   = document.getElementById('cal-grid-general');
  const header = document.getElementById('cal-dow-general');
  const list   = document.getElementById('cal-list-general');
  if(view==='month'){
    if(grid)   grid.style.display   = '';
    if(header) header.style.display = '';
    if(list)   list.style.display   = 'none';
    renderCal('general');
  } else {
    if(grid)   grid.style.display   = 'none';
    if(header) header.style.display = 'none';
    if(list){  list.style.display   = 'block'; renderCalList('general'); }
  }
}

function fmtCalTime(t){
  if(!t) return '';
  const [h,m] = t.split(':').map(Number);
  const s = h<12?'AM':'PM', h12 = h%12||12;
  return `${h12}:${String(m).padStart(2,'0')} ${s}`;
}

function renderCalList(type){
  const el = document.getElementById(`cal-list-${type}`);
  if(!el) return;
  const d = calCurrentDate[type];
  const year = d.getFullYear(), month = d.getMonth();
  const daysInMonth = new Date(year,month+1,0).getDate();
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const todayStr = new Date().toISOString().split('T')[0];
  const TYPE_CLR = {general:'#4a7fff',production:'#00e5c0','production-run':'#00c4a7',task:'#f5c842'};

  // Collect all events for the month, grouped by date
  const byDate = {};
  for(let day=1;day<=daysInMonth;day++){
    const dateStr=`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const legacy = calEvents.filter(e=>e.date===dateStr&&(type==='general'?e.type!=='production':e.type==='production'));
    const pruns  = (window.glProductionRuns||[]).filter(r=>(r.scheduled_start_date||r.scheduled_date)===dateStr)
                    .map(r=>({title:(r.run_name||'(untitled)')+(r.client_name?' — '+r.client_name:''),type:type==='production'?'production':'production-run',date:dateStr,time:''}));
    const evs = [...legacy,...pruns];
    if(evs.length) byDate[dateStr] = evs;
  }

  const dates = Object.keys(byDate).sort();
  if(!dates.length){
    el.innerHTML=`<div class="cal-list-empty"><div class="cal-list-empty-icon">📅</div><div>No events in ${MONTHS[month]} ${year}</div><div style="font-size:12px;margin-top:6px;opacity:.6">Click "+ Add Event" to schedule something</div></div>`;
    return;
  }

  el.innerHTML = dates.map(dateStr=>{
    const [y,m2,dd] = dateStr.split('-').map(Number);
    const dow = new Date(y,m2-1,dd).getDay();
    const isToday = dateStr===todayStr;
    const isPast  = dateStr<todayStr;
    const evHTML = byDate[dateStr].map(e=>{
      const clr = TYPE_CLR[e.type]||'#6b87ad';
      const timeStr = e.time ? `<div class="cal-list-event-time">⏱ ${fmtCalTime(e.time)}</div>` : '';
      return `<div class="cal-list-event" data-gl-action="openCalEventModal" data-gl-arg1="${esc(type)}" data-gl-arg2="${esc(dateStr)}">
        <div class="cal-list-event-bar" style="background:${clr}"></div>
        <div class="cal-list-event-body">
          <div class="cal-list-event-title">${esc(e.title||'(untitled)')}</div>
          ${timeStr}
        </div>
      </div>`;
    }).join('');
    return `<div class="cal-list-group${isPast&&!isToday?' cal-list-past':''}">
      <div class="cal-list-date">
        <div class="cal-list-day-num${isToday?' is-today':''}">${dd}</div>
        <div class="cal-list-day-info">
          <div class="cal-list-day-name">${DAYS[dow]}</div>
          <div class="cal-list-month-str">${MONTHS[m2-1].slice(0,3)}</div>
        </div>
        ${isToday?'<div class="cal-list-today-badge">TODAY</div>':''}
      </div>
      <div class="cal-list-events">${evHTML}</div>
    </div>`;
  }).join('');
}

function renderProductionRuns(){
  const el=document.getElementById('prod-runs-list');
  if(!el) return;
  const STAGE_CLR={Discovery:'#9aa7bd',Formulation:'#7fc6f5',Sample:'#c4a4f8',COA:'#f5c842',Production:'#5fcf9e',Ship:'#00e5c0'};
  // Legacy cal_events production entries
  const legacyRuns=calEvents.filter(e=>e.type==='production').map(e=>({_src:'cal',id:e.id,title:e.title,clientId:e.clientId,clientName:'',date:e.date||'',dueDate:e.dueDate||'',format:e.format||'',qty:e.qty||'',stage:'',prodStatus:e.prodStatus}));
  // New production_runs table entries — merge into schedule
  const prunRuns=(window.glProductionRuns||[]).map(r=>({_src:'prun',id:r.id,title:r.run_name||'(untitled)',clientId:r.client_id,clientName:r.client_name||'',date:r.scheduled_start_date||r.scheduled_date||'',dueDate:r.scheduled_end_date||'',format:r.format||'',qty:r.cases||'',stage:r.stage||'Discovery',prodStatus:''}));
  const allRuns=[...legacyRuns,...prunRuns].sort((a,b)=>(a.date||'zzz')>(b.date||'zzz')?1:-1);
  if(!allRuns.length){ el.innerHTML='<div style="color:var(--muted);font-size:13px">No production runs scheduled. Click "+ Add Production Run" to get started.</div>'; return; }
  el.innerHTML=allRuns.map(e=>{
    if(e._src==='prun'){
      const stageClr=STAGE_CLR[e.stage]||'#9aa7bd';
      return `<div class="prod-run">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
          <div>
            <div style="font-weight:700;font-size:14px;color:var(--white);margin-bottom:4px">${esc(e.title)} <span style="font-size:10px;font-family:var(--ff-disp);letter-spacing:1px;color:${stageClr};background:rgba(255,255,255,.05);border:1px solid ${stageClr}33;padding:2px 7px;border-radius:8px">${esc(e.stage.toUpperCase())}</span></div>
            <div style="font-size:12px;color:var(--muted);line-height:1.8">
              🏢 ${esc(e.clientName||'Unknown client')} &nbsp;·&nbsp;
              📅 Start: ${esc(e.date||'TBD')} &nbsp;·&nbsp;
              🏁 End: ${esc(e.dueDate||'TBD')}<br>
              🥫 ${esc(e.format||'—')} &nbsp;·&nbsp; 📦 ${esc(e.qty||'?')} cases
            </div>
          </div>
          <div style="flex-shrink:0">
            <button class="cbtn" style="font-size:10px;padding:4px 10px" data-gl-action="glOpenEditProductionRun" data-gl-arg1="${esc(e.id)}">✏️ Edit run</button>
          </div>
        </div>
        <div style="height:3px;border-radius:2px;background:${stageClr};opacity:.35;margin-top:8px"></div>
      </div>`;
    }
    // Legacy cal_events entry
    const client=clients.find(c=>c.id===e.clientId);
    return `<div class="prod-run">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
        <div>
          <div style="font-weight:700;font-size:14px;color:var(--white);margin-bottom:4px">${esc(e.title)}</div>
          <div style="font-size:12px;color:var(--muted);line-height:1.8">
            🏢 ${esc(client?client.name:'Unknown client')} &nbsp;·&nbsp;
            📅 Start: ${esc(e.date)} &nbsp;·&nbsp;
            🏁 Due: ${esc(e.dueDate||'TBD')}<br>
            🥫 ${esc(e.format||'')} &nbsp;·&nbsp; 📦 ${esc(e.qty||'?')} cases
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <select class="fsel" style="font-size:10px;padding:4px 8px" data-gl-action="updateProdStatus" data-gl-on="change" data-gl-arg1="${e.id}" data-gl-el-prop="value">
            <option value="scheduled" ${(e.prodStatus||'scheduled')==='scheduled'?'selected':''}>📋 Scheduled</option>
            <option value="in-production" ${e.prodStatus==='in-production'?'selected':''}>⚙️ In Production</option>
            <option value="completed" ${e.prodStatus==='completed'?'selected':''}>✅ Completed</option>
          </select>
          <button class="cbtn red" style="font-size:10px;padding:3px 8px" data-gl-action="deleteProdRun" data-gl-arg1="${esc(e.id)}">✕</button>
        </div>
      </div>
      <div class="prod-status-bar ${e.prodStatus||'scheduled'}"></div>
    </div>`;
  }).join('');
}

async function updateProdStatus(id,status){
  const ev=calEvents.find(e=>e.id===id);
  if(!ev) return;
  ev.prodStatus = status;
  if(window.supa){
    const r = await window.supa.from('cal_events').update({ prod_status: status }).eq('id', id).select();
    if(r.error){ alert('Status update failed: ' + r.error.message); return; }
    if(!r.data || !r.data.length){ alert('Status update failed' + " (nothing was saved — you may not have permission)"); return; }
  }
  renderProductionRuns();
}
async function deleteProdRun(id){
  if(!confirm('Delete this production run?')) return;
  if(window.supa){
    const res = await glCheckedDelete(sb => sb.from('cal_events').delete().eq('id', id).select('id'));
    if(!res.ok){ alert('Delete failed — the production run has NOT been deleted: ' + res.reason); return; }
  }
  calEvents=calEvents.filter(e=>e.id!==id);
  renderProductionRuns();
  renderCal('production');
}

