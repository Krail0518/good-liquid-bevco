/*
 * book.js — extracted verbatim from book.html (GL-DEF-01).
 *
 * The code below is byte-for-byte what was inside the page's inline
 * <script> block. Nothing was rewritten: the move exists so that
 * script-src can drop 'unsafe-inline', which an inline block would keep
 * alive on its own regardless of how many on* handlers were converted.
 *
 * The tag replacing it sits in the same document position, so execution
 * order is unchanged. This page had 2 blocks; they keep their
 * relative order.
 */
(function(){
  'use strict';

  var SUPA_URL  = 'https://ufjkeqmxwuyhbqyugcgg.supabase.co';
  var ANON_KEY  = 'sb_publishable_-37mkPw8uLzEJM21T9jJOA_YQRQ7ikB';
  var CONFIRM_FN = SUPA_URL + '/functions/v1/booking-confirm';
  var AVAIL_FN   = SUPA_URL + '/functions/v1/booking-availability';

  var page = null;          // booking_pages row
  var takenSlots = [];      // array of { start_at, end_at } strings (UTC ISO)
  var calAvail   = {};      // 'HH:MM' -> boolean; false = busy on Mike's calendar
  var calAvailLoading = false;
  var viewYear  = 0;
  var viewMonth = 0;        // 0-indexed
  var selectedDate = null;  // "YYYY-MM-DD"
  var selectedTime = null;  // "HH:MM"

  // ── Bootstrap ──────────────────────────────────────────────────────────
  var slug = new URLSearchParams(window.location.search).get('u') || '';
  if(!slug){ showError('No scheduling link specified (missing ?u= parameter).'); }
  else { loadPage(slug); }

  async function loadPage(slug){
    try {
      var r = await apiFetch('/rest/v1/booking_pages?slug=eq.' + encodeURIComponent(slug) +
        '&is_active=eq.true&select=*&limit=1');
      if(!r || !r.length){ showError('This booking page doesn\'t exist or is no longer active.'); return; }
      page = r[0];
      document.title = page.title + ' – Good Liquid Bev Co';
      document.getElementById('page-title').textContent = page.title;
      var desc = document.getElementById('page-desc');
      if(page.description){ desc.textContent = page.description; }
      else { desc.style.display = 'none'; }
      document.getElementById('meta-duration').textContent = page.duration + ' min';
      document.getElementById('meta-tz').textContent = tzLabel(page.timezone || 'America/New_York');
      await loadTakenSlots();
      initCalendar();
      document.getElementById('loading').style.display = 'none';
      document.getElementById('main-content').classList.add('show');
    } catch(e){
      showError('Could not load booking page. Please try again later.');
      console.error(e);
    }
  }

  async function loadTakenSlots(){
    // Use the merged RPC so both confirmed bookings AND manually-added
    // calendar events (tours, client visits, etc.) block their slots.
    try {
      var res = await fetch(SUPA_URL + '/rest/v1/rpc/get_page_blocked_slots', {
        method: 'POST',
        headers: {
          'apikey':        ANON_KEY,
          'Authorization': 'Bearer ' + ANON_KEY,
          'Content-Type':  'application/json',
        },
        body: JSON.stringify({ p_page_id: page.id }),
      });
      if(!res.ok){ console.warn('[GL] get_page_blocked_slots HTTP', res.status); takenSlots = []; return; }
      takenSlots = (await res.json()) || [];
    } catch(e){ console.warn('[GL] loadTakenSlots error', e); takenSlots = []; }
  }

  // ── REST helper ────────────────────────────────────────────────────────
  async function apiFetch(path){
    var res = await fetch(SUPA_URL + path, {
      headers: {
        'apikey': ANON_KEY,
        'Authorization': 'Bearer ' + ANON_KEY,
        'Content-Type': 'application/json',
      }
    });
    if(!res.ok){ throw new Error('HTTP ' + res.status + ' ' + path); }
    return res.json();
  }

  // ── Calendar ───────────────────────────────────────────────────────────
  var MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
  var DOW = ['Su','Mo','Tu','We','Th','Fr','Sa'];

  function initCalendar(){
    var now = new Date();
    viewYear  = now.getFullYear();
    viewMonth = now.getMonth();
    document.getElementById('prev-month').addEventListener('click', function(){ shiftMonth(-1); });
    document.getElementById('next-month').addEventListener('click', function(){ shiftMonth(+1); });
    renderCalendar();
  }

  function shiftMonth(delta){
    viewMonth += delta;
    if(viewMonth < 0){ viewMonth = 11; viewYear--; }
    if(viewMonth > 11){ viewMonth = 0; viewYear++; }
    renderCalendar();
  }

  function renderCalendar(){
    document.getElementById('month-label').textContent = MONTHS[viewMonth] + ' ' + viewYear;
    var grid = document.getElementById('cal-grid');
    grid.innerHTML = '';

    // Day-of-week headers
    DOW.forEach(function(d){
      var el = document.createElement('div');
      el.className = 'cal-dow';
      el.textContent = d;
      grid.appendChild(el);
    });

    var today    = new Date();
    var todayStr = isoDate(today);
    var firstDow = new Date(viewYear, viewMonth, 1).getDay();
    var daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    // Blank cells before the 1st
    for(var i = 0; i < firstDow; i++){
      var blank = document.createElement('div');
      blank.className = 'cal-day';
      grid.appendChild(blank);
    }

    var avail = page.avail_days || [1,2,3,4,5];

    for(var d = 1; d <= daysInMonth; d++){
      var cell = document.createElement('div');
      cell.textContent = d;
      var dateStr = viewYear + '-' + pad(viewMonth + 1) + '-' + pad(d);
      var dow = new Date(dateStr + 'T12:00:00Z').getUTCDay(); // use UTC noon to avoid DST shift
      // Block same-day AND any date within 24 hours of now (first slot is at least 24h away)
      var minBookDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      var minDateStr  = isoDate(minBookDate);
      var isPast = dateStr <= minDateStr;
      var isAvail = !isPast && avail.indexOf(dow) >= 0;

      cell.className = 'cal-day' +
        (isAvail     ? ' available' : '') +
        (isPast      ? ' past'      : '') +
        (dateStr === todayStr   ? ' today' : '') +
        (dateStr === selectedDate ? ' selected' : '');

      if(isAvail){
        (function(ds){ cell.addEventListener('click', function(){ selectDate(ds); }); })(dateStr);
      }
      grid.appendChild(cell);
    }
  }

  function selectDate(dateStr){
    selectedDate = dateStr;
    selectedTime = null;
    renderCalendar();
    renderSlots(dateStr);
    document.getElementById('booking-form').classList.remove('show');
    // Cross-check the picked day against Mike's live calendar so we never
    // offer (and then reject at confirm time) a slot he's already busy.
    loadDayAvailability(dateStr);
  }

  async function loadDayAvailability(dateStr){
    calAvail = {}; calAvailLoading = true;
    if(selectedDate === dateStr) renderSlots(dateStr);
    try {
      if(page && page.id){
        var r = await fetch(AVAIL_FN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
          body: JSON.stringify({ page_id: page.id, date: dateStr }),
        });
        var d = await r.json().catch(function(){ return {}; });
        if(d && d.ok && Array.isArray(d.slots)){
          d.slots.forEach(function(s){ calAvail[s.time] = !!s.available; });
        }
      }
    } catch(e){ console.warn('[GL] day availability', e); }
    calAvailLoading = false;
    // If the slot the visitor already picked just came back busy, drop it.
    if(selectedTime && calAvail[selectedTime] === false){ clearSlot(); }
    if(selectedDate === dateStr) renderSlots(dateStr);
  }

  // ── Slot generation ────────────────────────────────────────────────────
  function renderSlots(dateStr){
    var ph = document.getElementById('slots-placeholder');
    var sc = document.getElementById('slots-container');
    var sl = document.getElementById('slots-label');
    var sg = document.getElementById('slots-grid');

    var slots = buildSlots(dateStr);
    var d = new Date(dateStr + 'T12:00:00Z');
    var label = d.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

    sl.textContent = label;
    sg.innerHTML = '';

    if(!slots.length){
      sg.innerHTML = '<div class="no-slots" style="grid-column:1/-1">No availability on this day.</div>';
    } else {
      slots.forEach(function(s, idx){
        var btn = document.createElement('button');
        btn.className = 'slot-btn' + (s.time === selectedTime ? ' selected' : '');
        btn.textContent = s.label;
        btn.style.animationDelay = (idx * 0.055) + 's';
        if(s.taken){
          btn.disabled = true;
          btn.title = 'Already booked';
        } else {
          (function(t, lbl){
            btn.addEventListener('click', function(e){
              // Ripple effect
              var r = document.createElement('span');
              r.className = 'ripple';
              var rect = btn.getBoundingClientRect();
              var size = Math.max(rect.width, rect.height) * 2.4;
              r.style.width  = size + 'px';
              r.style.height = size + 'px';
              r.style.left   = ((e.clientX || rect.left + rect.width  / 2) - rect.left - size / 2) + 'px';
              r.style.top    = ((e.clientY || rect.top  + rect.height / 2) - rect.top  - size / 2) + 'px';
              btn.appendChild(r);
              setTimeout(function(){ if(r.parentNode) r.parentNode.removeChild(r); }, 600);
              selectSlot(t, lbl, label);
            });
          })(s.time, s.label);
        }
        sg.appendChild(btn);
      });
    }

    ph.style.display = 'none';
    sc.style.display = 'block';
  }

  function buildSlots(dateStr){
    var dur    = Number(page.duration)     || 30;
    var buffer = Number(page.buffer_after) || 0;
    // Step is max(duration, 60), identical to the index.html widget and the
    // booking-availability endpoint, so slot start-times line up exactly and
    // the calendar-busy greying (keyed by 'HH:MM') never misses an offset slot.
    // (buffer_after is still honored at confirm time via real-duration overlap.)
    var stride = Math.max(dur, 60);
    var tz     = page.timezone || 'America/New_York';

    var startParts = (page.start_time || '09:00').split(':');
    var endParts   = (page.end_time   || '17:00').split(':');
    var startMin   = Number(startParts[0]) * 60 + Number(startParts[1]);
    var endMin     = Number(endParts[0])   * 60 + Number(endParts[1]);

    var now = new Date();
    // 24-hour advance notice: hide any slot whose start is within 24 hours of now
    var minSlotTime = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    var slots = [];
    for(var m = startMin; m + dur <= endMin; m += stride){
      var hh   = Math.floor(m / 60);
      var mm   = m % 60;
      var time = pad(hh) + ':' + pad(mm);

      // Build UTC start/end for conflict check
      var utcStart = localToUTC(dateStr, time, tz);
      var utcEnd   = new Date(utcStart.getTime() + dur * 60000);

      // Skip slots within 24 hours of right now
      if(utcStart < minSlotTime){ continue; }

      // Busy if an existing booking overlaps, or Mike's calendar returned this
      // slot as unavailable (calAvail[time] === false). Missing = not-yet-known
      // (still loading / lookup failed) → leave selectable, confirm-time guard
      // is the backstop.
      var taken = isSlotTaken(utcStart, utcEnd) || calAvail[time] === false;

      slots.push({
        time:  time,
        label: fmt12(hh, mm),
        taken: taken,
      });
    }
    return slots;
  }

  function isSlotTaken(start, end){
    return takenSlots.some(function(s){
      var sStart = new Date(s.start_at);
      var sEnd   = new Date(s.end_at);
      // Overlap: existing start < my end AND existing end > my start
      return sStart < end && sEnd > start;
    });
  }

  function selectSlot(time, label, dateLabel){
    selectedTime = time;
    // Clear any previous submission error
    var errEl = document.getElementById('form-err');
    if(errEl){ errEl.classList.remove('show'); }
    // Re-render slots to update selected state
    renderSlots(selectedDate);

    // Update pill
    var tz = page.timezone || 'America/New_York';
    var tzLbl = tzLabel(tz);
    document.getElementById('selected-label').textContent =
      '📅 ' + dateLabel + ' at ' + label + ' (' + tzLbl + ')';

    document.getElementById('booking-form').classList.add('show');
    document.getElementById('booking-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearSlot(){
    selectedTime = null;
    document.getElementById('booking-form').classList.remove('show');
    if(selectedDate) renderSlots(selectedDate);
  }
  window.clearSlot = clearSlot;

  // ── Booking submission ─────────────────────────────────────────────────
  async function submitBooking(){
    var errEl   = document.getElementById('form-err');
    var btn     = document.getElementById('btn-book');
    function setErr(msg){ errEl.textContent = msg; errEl.classList.add('show'); }
    function clearErr(){ errEl.classList.remove('show'); }
    clearErr();

    // The questionnaire is required — no blind tours. It also supplies the
    // name/email/company/notes the request needs.
    var bkAnswers = null;
    if(window.GL_INTAKE){
      var _q = window.GL_INTAKE.collect(document.getElementById('bk-intake-mount'));
      if(!_q.ok){ setErr('Please finish the questionnaire — missing: ' + _q.missing.slice(0,4).join(', ') + (_q.missing.length>4?'…':'')); return; }
      bkAnswers = _q.answers;
      document.getElementById('f-name').value    = [_q.answers.first_name,_q.answers.last_name].filter(Boolean).join(' ') || _q.answers.contact_name || '';
      document.getElementById('f-email').value   = _q.answers.email || '';
      document.getElementById('f-company').value = _q.answers.company || '';
      document.getElementById('f-notes').value   = window.GL_INTAKE.summary(_q.answers);
    }
    var name    = (document.getElementById('f-name').value    || '').trim();
    var email   = (document.getElementById('f-email').value   || '').trim();
    var company = (document.getElementById('f-company').value || '').trim();
    var notes   = (document.getElementById('f-notes').value   || '').trim();

    if(!name)                          { setErr('Please enter your name.');          return; }
    if(!email || !email.includes('@')) { setErr('Please enter a valid email.');      return; }
    if(!selectedDate || !selectedTime) { setErr('Please select a date and time.');   return; }

    // Create/attach a pipeline lead + store the structured intake (non-blocking).
    if(bkAnswers && window.GL_INTAKE){
      try {
        await fetch(SUPA_URL + '/rest/v1/rpc/gl_tour_intake_submit', {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'apikey':ANON_KEY, 'Authorization':'Bearer '+ANON_KEY },
          body: JSON.stringify({ p: { lead: window.GL_INTAKE.leadPayload(bkAnswers), answers: bkAnswers } })
        });
      } catch(e){ console.warn('tour intake submit:', e); }
    }

    btn.disabled = true;
    btn.textContent = 'Sending request…';

    try {
      var res = await fetch(CONFIRM_FN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
        body: JSON.stringify({
          page_id:        page.id,
          booker_name:    name,
          booker_email:   email,
          booker_company: company || null,
          notes:          notes   || null,
          slot_date:      selectedDate,
          slot_time:      selectedTime,
        }),
      });
      var data = await res.json();
      if(!res.ok || !data.ok){
        setErr(data.error || 'Something went wrong. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Request Tour';
        return;
      }

      // Show confirmation
      var tz  = page.timezone || 'America/New_York';
      var utcStart = localToUTC(selectedDate, selectedTime, tz);
      var utcEnd   = new Date(utcStart.getTime() + Number(page.duration) * 60000);
      var dateStr  = utcStart.toLocaleDateString('en-US', { timeZone: tz, weekday:'long', month:'long', day:'numeric', year:'numeric' });
      var timeStr  = utcStart.toLocaleTimeString('en-US', { timeZone: tz, hour:'numeric', minute:'2-digit', hour12:true }) +
                     ' – ' +
                     utcEnd.toLocaleTimeString('en-US',   { timeZone: tz, hour:'numeric', minute:'2-digit', hour12:true });

      document.getElementById('confirm-details').innerHTML =
        '<div class="confirm-detail"><span class="lbl">Date</span><span class="val">' + escHtml(dateStr) + '</span></div>' +
        '<div class="confirm-detail"><span class="lbl">Time</span><span class="val">' + escHtml(timeStr) + ' (' + escHtml(tzLabel(tz)) + ')</span></div>' +
        '<div class="confirm-detail"><span class="lbl">Duration</span><span class="val">' + page.duration + ' minutes</span></div>' +
        '<div class="confirm-detail"><span class="lbl">Name</span><span class="val">' + escHtml(name) + '</span></div>' +
        '<div class="confirm-detail"><span class="lbl">Email</span><span class="val">' + escHtml(email) + '</span></div>';

      document.getElementById('booking-ui').style.display = 'none';
      document.getElementById('confirm-screen').classList.add('show');
      fireConfetti();

    } catch(e) {
      setErr('Network error. Please try again.');
      btn.disabled = false;
      btn.textContent = 'Request Tour';
      console.error(e);
    }
  }
  window.submitBooking = submitBooking;

  // ── Timezone utilities ─────────────────────────────────────────────────
  function localToUTC(dateStr, timeStr, tz){
    // Treat the local time string as if it were UTC to get a reference point
    var naiveUTC = new Date(dateStr + 'T' + timeStr + ':00.000Z');
    // Find what the target timezone shows at that reference UTC moment
    var localStr = naiveUTC.toLocaleString('sv-SE', { timeZone: tz }); // "YYYY-MM-DD HH:MM:SS"
    // Parse that displayed time as UTC to get the offset direction
    var asUTC    = new Date(localStr.replace(' ', 'T') + '.000Z');
    // offsetMs = (reference UTC) - (what TZ shows at that UTC)
    // e.g. EDT: 09:00 UTC - 05:00 = +4 h  →  actual UTC = naiveUTC + offsetMs = 13:00 UTC ✓
    var offsetMs = naiveUTC.getTime() - asUTC.getTime();
    return new Date(naiveUTC.getTime() + offsetMs);
  }

  function tzLabel(tz){
    try {
      var parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
        .formatToParts(new Date());
      return parts.find(function(p){ return p.type === 'timeZoneName'; }).value;
    } catch(e){ return tz; }
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  function isoDate(d){ return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
  function pad(n){ return String(n).padStart(2, '0'); }
  function fmt12(h, m){
    var suffix = h < 12 ? 'AM' : 'PM';
    var h12 = h % 12 || 12;
    return h12 + ':' + pad(m) + ' ' + suffix;
  }
  function escHtml(v){ return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  function showError(msg){
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error-msg').textContent = msg;
    document.getElementById('error-state').style.display = 'block';
  }

  // ── Confetti celebration ───────────────────────────────────────────────
  function fireConfetti(){
    var colors = ['#00e5c0','#7f5af0','#f5c842','#5fcf9e','#fff','#00c4a7','#a78bfa'];
    for(var i = 0; i < 72; i++){
      (function(i){
        var el = document.createElement('div');
        el.className = 'confetti-piece';
        var w = 5 + Math.random() * 7;
        var h = 8 + Math.random() * 10;
        el.style.width    = w + 'px';
        el.style.height   = h + 'px';
        el.style.left     = (10 + Math.random() * 80) + 'vw';
        el.style.top      = '-20px';
        el.style.background   = colors[Math.floor(Math.random() * colors.length)];
        el.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        var dur = 1.8 + Math.random() * 2.2;
        el.style.animationDuration  = dur + 's';
        el.style.animationDelay     = (Math.random() * 1.2) + 's';
        el.style.opacity = '1';
        document.body.appendChild(el);
        setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); }, (dur + 1.5) * 1000);
      })(i);
    }
  }

}());


/* ── GL-DEF-01: bindings that were on* attributes ────────────────────── */
(function(){
  function bind(){
    var clear = document.getElementById('gl-clear-slot');
    if(clear) clear.addEventListener('click', function(){ clearSlot(); });
    var submit = document.getElementById('btn-book');
    if(submit) submit.addEventListener('click', function(){ submitBooking(); });
  }
  if(document.readyState !== 'loading') bind();
  else document.addEventListener('DOMContentLoaded', bind);
}());
