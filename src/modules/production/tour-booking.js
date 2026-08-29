/*
 * tour-booking.js — extracted from crm-index-core.js (GL-037).
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
 * Declares: bk12, bkBuildTimes, bkResetSteps, bkBackToIntake, bkIntakeToSchedule, openBooking, closeBooking, renderBkCal, bkPrev, bkNext, selectBkDate, loadBkAvailability, renderBkTimes, selectBkTime, updateBkInfo, glNotifyDeal, submitBooking
 */
/* ═══════════════════════════════════════════
   TOUR BOOKING WIDGET
═══════════════════════════════════════════ */
let bkCurrentDate=new Date();
let bkSelectedDate=null, bkSelectedTime=null;
// Slot VALUES are 24-hour "HH:MM" (the format booking-confirm requires); the
// buttons DISPLAY them as 12-hour. They're rebuilt from the booking page's real
// window in openBooking so no offered slot can be rejected as out-of-window.
let BK_TIMES=['10:00','11:00','12:00','13:00'];
let bkPageCfg=null;

function bk12(v){
  var p=String(v||'').split(':'); var h=+p[0], m=+p[1]||0;
  var ap=h<12?'AM':'PM', hh=h%12||12;
  return hh+':'+String(m).padStart(2,'0')+' '+ap;
}
function bkBuildTimes(cfg){
  var sp=String((cfg&&cfg.start_time)||'10:00').split(':');
  var ep=String((cfg&&cfg.end_time)||'14:00').split(':');
  var startMin=(+sp[0])*60+(+sp[1]||0), endMin=(+ep[0])*60+(+ep[1]||0);
  var dur=Number(cfg&&cfg.duration)||30, step=Math.max(dur,60), out=[];
  for(var mm=startMin; mm+dur<=endMin; mm+=step){
    out.push(String(Math.floor(mm/60)).padStart(2,'0')+':'+String(mm%60).padStart(2,'0'));
  }
  return out.length?out:['10:00','11:00','12:00','13:00'];
}

let bkIntakeAnswers = null;
function bkResetSteps(){
  var si=document.getElementById('bk-step-intake'), ss=document.getElementById('bk-step-schedule');
  if(si) si.style.display=''; if(ss) ss.style.display='none';
}
function bkBackToIntake(){
  var si=document.getElementById('bk-step-intake'), ss=document.getElementById('bk-step-schedule');
  if(ss) ss.style.display='none'; if(si) si.style.display='';
}
// Gate: the questionnaire must be complete before the calendar unlocks, so Mike
// never gets a blind tour. On success we stash the answers and prefill the
// hidden name/email/notes fields submitBooking reads.
function bkIntakeToSchedule(){
  var err=document.getElementById('bk-intake-err');
  if(!window.GL_INTAKE){ if(err){ err.style.display='block'; err.textContent='Questionnaire didn’t load — please refresh and try again.'; } return; }
  var res=window.GL_INTAKE.collect(document.getElementById('bk-intake-mount'));
  if(!res.ok){
    if(err){ err.style.display='block'; err.innerHTML='<strong>Please finish these before continuing:</strong><br>• '+res.missing.map(function(m){return m;}).join('<br>• '); }
    var box=document.querySelector('#booking-overlay .booking-box'); if(box) box.scrollTop=0;
    return;
  }
  if(err) err.style.display='none';
  bkIntakeAnswers=res.answers;
  var n=document.getElementById('bk-name'); if(n) n.value=[res.answers.first_name,res.answers.last_name].filter(Boolean).join(' ')||res.answers.contact_name||'';
  var e=document.getElementById('bk-email'); if(e) e.value=res.answers.email||'';
  var nt=document.getElementById('bk-notes'); if(nt) nt.value=(res.answers.product_description||'')+(res.answers.goals?(' — Goals: '+res.answers.goals):'');
  document.getElementById('bk-step-intake').style.display='none';
  document.getElementById('bk-step-schedule').style.display='';
  renderBkCal(); renderBkTimes();
}
async function openBooking(){
  document.getElementById('booking-overlay').classList.add('show');
  var bkS=document.getElementById('bk-success'); if(bkS) bkS.style.display='none';
  if(window.GL_INTAKE){ window.GL_INTAKE.render(document.getElementById('bk-intake-mount'), bkIntakeAnswers||{}); }
  bkResetSteps();
  // Load the scheduling page config (same row book.html?u=mike-krail uses) so
  // the offered times match the real availability window.
  try {
    if(!bkPageCfg && window.supa){
      const { data: bp } = await supa.from('booking_pages').select('id,start_time,end_time,duration').eq('slug','mike-krail').eq('is_active',true).maybeSingle();
      bkPageCfg = bp || null;
      if(!bkPageCfg){
        const { data: anyPage } = await supa.from('booking_pages').select('id,start_time,end_time,duration').eq('is_active',true).limit(1);
        if(anyPage && anyPage[0]) bkPageCfg = anyPage[0];
      }
    }
    if(bkPageCfg) BK_TIMES = bkBuildTimes(bkPageCfg);
  } catch(e){ console.warn('booking config load:', e); }
  renderBkCal();
  renderBkTimes();
}
function closeBooking(){ document.getElementById('booking-overlay').classList.remove('show'); }

function renderBkCal(){
  const d=bkCurrentDate;
  document.getElementById('bk-month-label').textContent=d.toLocaleString('default',{month:'long',year:'numeric'});
  const firstDay=new Date(d.getFullYear(),d.getMonth(),1).getDay();
  const daysInMonth=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
  const today=new Date(); today.setHours(0,0,0,0);
  let html='';
  for(let i=0;i<firstDay;i++) html+='<div></div>';
  for(let day=1;day<=daysInMonth;day++){
    const thisDate=new Date(d.getFullYear(),d.getMonth(),day);
    const isPast=thisDate<today;
    const isWeekend=thisDate.getDay()===0||thisDate.getDay()===6;
    const isToday=thisDate.getTime()===today.getTime();
    const dateStr=thisDate.toISOString().split('T')[0];
    const isSelected=bkSelectedDate===dateStr;
    html+=`<div class="bk-day${isPast||isWeekend?' bk-past':''}${isToday?' bk-today':''}${isSelected?' bk-selected':''}" 
      onclick="${!isPast&&!isWeekend?`selectBkDate('${dateStr}')`:''}">${day}</div>`;
  }
  document.getElementById('bk-cal-grid').innerHTML=html;
}

function bkPrev(){ bkCurrentDate.setMonth(bkCurrentDate.getMonth()-1); renderBkCal(); }
function bkNext(){ bkCurrentDate.setMonth(bkCurrentDate.getMonth()+1); renderBkCal(); }

let bkAvail = {};          // 'HH:MM' -> boolean (available); missing = not-yet-known
let bkAvailLoading = false;
function selectBkDate(date){
  bkSelectedDate=date;
  bkSelectedTime=null;       // new day → drop any prior time pick
  renderBkCal();
  renderBkTimes();
  updateBkInfo();
  loadBkAvailability(date);
}

// Ask the server which slots are free — combining existing bookings AND Mike's
// Google Calendar — so conflicting times are greyed out before anyone requests
// one. Fails open: if the check can't run, slots stay clickable (booking-confirm
// still guards the calendar server-side).
async function loadBkAvailability(date){
  bkAvail = {}; bkAvailLoading = true; renderBkTimes();
  try {
    var pid = (bkPageCfg && bkPageCfg.id) || null;
    if(pid){
      const r = await fetch(SUPA_URL + '/functions/v1/booking-availability', {
        method:'POST', headers:{ 'Content-Type':'application/json', 'apikey':SUPA_KEY },
        body: JSON.stringify({ page_id: pid, date: date })
      });
      const d = await r.json().catch(function(){ return {}; });
      if(d && d.ok && Array.isArray(d.slots)){ d.slots.forEach(function(s){ bkAvail[s.time] = !!s.available; }); }
    }
  } catch(e){ console.warn('booking availability:', e); }
  bkAvailLoading = false;
  if(bkSelectedTime && bkAvail[bkSelectedTime] === false){ bkSelectedTime=null; updateBkInfo(); }
  renderBkTimes();
}

function renderBkTimes(){
  var html = BK_TIMES.map(function(t){
    var avail = bkAvail[t] !== false;   // available until we hear otherwise
    if(avail) return '<div class="time-slot '+(bkSelectedTime===t?'selected':'')+'" data-gl-action="selectBkTime" data-gl-arg1="' + esc(t) + '">'+bk12(t)+'</div>';
    return '<div class="time-slot" title="Unavailable — already booked" style="opacity:.35;cursor:not-allowed;text-decoration:line-through">'+bk12(t)+'</div>';
  }).join('');
  if(bkAvailLoading) html += '<div style="font-size:11px;color:var(--muted);grid-column:1/-1;padding:6px 0">Checking availability…</div>';
  document.getElementById('bk-time-slots').innerHTML = html;
}

function selectBkTime(time){ if(bkAvail[time]===false) return; bkSelectedTime=time; renderBkTimes(); updateBkInfo(); }

function updateBkInfo(){
  const el=document.getElementById('bk-selected-info');
  if(bkSelectedDate&&bkSelectedTime){
    el.style.display='block';
    el.textContent='📅 '+new Date(bkSelectedDate+'T12:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'})+' at '+bk12(bkSelectedTime);
  }
}

// WhatsApp/email alert to Mike via notify-deal edge function.
// Auth is the signed-in staff JWT (supa.functions.invoke attaches it) — no
// shared secret in the page anymore. Public-page events (tour bookings,
// quote requests) don't call this at all: their table inserts fire DB
// triggers that alert server-side with a Vault-held secret.
async function glNotifyDeal(event, data){
  try {
    if(!window.supa || !supa.functions || !supa.functions.invoke) return;
    await supa.functions.invoke('notify-deal', { body: {event, data} });
  } catch(e){ console.warn('notify-deal:', e); }
}

async function submitBooking(){
  if(!bkSelectedDate||!bkSelectedTime){alert('Please select a date and time');return;}
  const name=document.getElementById('bk-name').value.trim();
  const email=document.getElementById('bk-email').value.trim();
  if(!name||!email){alert('Please enter your name and email');return;}
  const notes=document.getElementById('bk-notes').value;

  // Validate: Mon-Fri only
  const dow=new Date(bkSelectedDate+'T12:00:00Z').getUTCDay();
  if(dow===0||dow===6){alert('Tours are available Monday–Friday only.');return;}

  // Validate: 24-hour advance notice
  const slotMs=new Date(bkSelectedDate+'T'+bkSelectedTime+':00').getTime();
  if(slotMs<Date.now()+24*60*60*1000){alert('Tours require at least 24 hours advance notice. Please select a later date.');return;}

  // Route through the SAME approval flow as book.html: booking-confirm creates a
  // PENDING request, emails the visitor a "request received" note, and emails
  // Mike the in-app Approve/Decline link. NOTHING is auto-added and nothing is
  // confirmed until Mike approves it in the admin area — that approval is what
  // writes the schedule row AND the Google Calendar event. (Previously this
  // widget wrote a `confirmed` booking + calendar row directly, bypassing the
  // whole approval gate; that's the bug this replaces.)
  // Save the intake answers + create/attach a pipeline lead so Mike knows what
  // the tour is about. Non-blocking: a genuine tour still books if this hiccups.
  let bkNotes = notes || null;
  try {
    if(bkIntakeAnswers && window.GL_INTAKE && window.supa){
      bkNotes = window.GL_INTAKE.summary(bkIntakeAnswers);
      const { error: intakeErr } = await supa.rpc('gl_tour_intake_submit', { p: { lead: window.GL_INTAKE.leadPayload(bkIntakeAnswers), answers: bkIntakeAnswers } });
      if(intakeErr) console.warn('tour intake submit:', intakeErr.message);
    }
  } catch(e){ console.warn('tour intake submit failed:', e); }

  const bkBtn = document.querySelector('#booking-overlay button[data-gl-action="submitBooking"]');
  const bkRestore = function(){ if(bkBtn){ bkBtn.disabled=false; bkBtn.textContent='Confirm Booking →'; } };
  if(bkBtn){ bkBtn.disabled=true; bkBtn.textContent='Sending request…'; }

  // Resolve the default scheduling page (loaded when the widget opened; re-fetch
  // as a fallback). Same row book.html?u=mike-krail uses.
  let bkPageId = (bkPageCfg && bkPageCfg.id) || null;
  if(!bkPageId){
    try {
      const { data: bp } = await supa.from('booking_pages').select('id').eq('slug','mike-krail').eq('is_active',true).maybeSingle();
      if(bp && bp.id) bkPageId = bp.id;
      if(!bkPageId){
        const { data: anyPage } = await supa.from('booking_pages').select('id').eq('is_active',true).limit(1);
        if(anyPage && anyPage[0]) bkPageId = anyPage[0].id;
      }
    } catch(e){ console.warn('booking_pages lookup:', e); }
  }
  if(!bkPageId){ alert('Booking is temporarily unavailable. Please email Mike@GoodLiquid.com and we’ll get you scheduled.'); bkRestore(); return; }

  try {
    const r = await fetch(SUPA_URL + '/functions/v1/booking-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY },
      body: JSON.stringify({
        page_id:      bkPageId,
        booker_name:  name,
        booker_email: email,
        notes:        bkNotes,
        slot_date:    bkSelectedDate,
        slot_time:    bkSelectedTime,
      }),
    });
    const data = await r.json().catch(function(){ return {}; });
    if(!r.ok || !data.ok){
      alert(data.error || 'Something went wrong submitting your request. Please try again.');
      bkRestore();
      return;
    }
  } catch(e){
    alert('Network error submitting your request. Please try again in a moment.');
    bkRestore();
    return;
  }

  addNotification('📅 Tour requested: '+name,bkSelectedDate+' at '+bkSelectedTime,'info');
  document.getElementById('bk-success').style.display='block';
  setTimeout(()=>closeBooking(),3000);
}
