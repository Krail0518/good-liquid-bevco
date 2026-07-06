/* ============================================================
   CALENDAR: show existing events when clicking a day + delete

   Overrides openCalEventModal so that clicking a day which
   already has events shows each one with a 🗑 Delete button
   before the Add-Event form. Uses direct function replacement
   rather than GL_HOOKS because it needs to extend (not block)
   the existing modal — a guard would suppress it entirely.
   ============================================================ */
(function(){
  'use strict';

  // Wrap the base openCalEventModal; capture it at module-load time
  // so the reference is stable regardless of script load order.
  var _origOpenCal = window.openCalEventModal;

  window.openCalEventModal = function(type, date) {
    // Run the original first (resets form, shows modal)
    if (typeof _origOpenCal === 'function') _origOpenCal(type, date);

    var modal = document.getElementById('cal-event-modal');
    if (!modal) return;
    var box = modal.querySelector('.modal-box');
    if (!box) return;

    // Remove any previously injected day panel (re-use between clicks)
    var oldPanel = box.querySelector('#gl-cal-day-panel');
    if (oldPanel) oldPanel.remove();

    // calEvents is a top-level `let` in index.html — shared global
    var cache = [];
    try { if (typeof calEvents !== 'undefined') cache = calEvents; } catch(e){}
    if (!Array.isArray(cache)) cache = [];

    var dayEvs = cache.filter(function(e) {
      if (e.date !== date) return false;
      return type === 'general' ? e.type !== 'production' : e.type === 'production';
    });

    if (!dayEvs.length) return; // empty day — show plain add-event form as before

    // ── Update modal title to show the date
    var titleEl = box.querySelector('.modal-title');
    if (titleEl && titleEl.firstChild && titleEl.firstChild.nodeType === 3) {
      var d = new Date(date + 'T12:00:00');
      titleEl.firstChild.nodeValue = d.toLocaleDateString('en-US', {weekday:'short', month:'short', day:'numeric'}) + '  ';
    }

    // ── Build the "existing events" panel
    var panel = document.createElement('div');
    panel.id = 'gl-cal-day-panel';

    var panelHdr = document.createElement('div');
    panelHdr.style.cssText = 'font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#6b87ad;margin-bottom:10px';
    panelHdr.textContent = dayEvs.length === 1 ? '1 event on this day' : dayEvs.length + ' events on this day';
    panel.appendChild(panelHdr);

    dayEvs.forEach(function(ev) {
      var timeStr = '';
      if (ev.time) {
        try {
          timeStr = typeof fmtCalTime === 'function' ? fmtCalTime(ev.time) : ev.time;
        } catch(e) { timeStr = ev.time; }
      }

      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:12px;' +
        'padding:10px 12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);' +
        'border-radius:8px;margin-bottom:8px';

      var info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0';
      info.innerHTML =
        '<div style="font-size:14px;font-weight:600;color:#eef4ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
          (ev.title || '(untitled)') + '</div>' +
        (timeStr ? '<div style="font-size:12px;color:#6b87ad;margin-top:3px">⏱ ' + timeStr + '</div>' : '') +
        (ev.notes ? '<div style="font-size:12px;color:#6b87ad;margin-top:3px;white-space:pre-line">' + ev.notes + '</div>' : '');

      var delBtn = document.createElement('button');
      delBtn.textContent = '🗑 Delete';
      delBtn.style.cssText = 'flex-shrink:0;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.3);' +
        'color:#f87171;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;' +
        'transition:background .2s';
      delBtn.onmouseover = function(){ this.style.background = 'rgba(248,113,113,.18)'; };
      delBtn.onmouseout  = function(){ this.style.background = 'rgba(248,113,113,.08)'; };

      // Close over the event copy so async mutation of the array doesn't affect this button
      (function(evCopy) {
        delBtn.onclick = function() {
          var evTitle = evCopy.title || 'this event';
          if (!confirm('Delete "' + evTitle + '"? This cannot be undone.')) return;
          window.glDeleteCalEvent(evCopy.id, type, date);
        };
      }(ev));

      row.appendChild(info);
      row.appendChild(delBtn);
      panel.appendChild(row);
    });

    // ── Separator + "Add another event" heading before the form
    var sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px solid rgba(255,255,255,.08);margin:16px 0 14px';
    panel.appendChild(sep);

    var addHdr = document.createElement('div');
    addHdr.style.cssText = 'font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#6b87ad;margin-bottom:10px';
    addHdr.textContent = 'Add another event';
    panel.appendChild(addHdr);

    // Insert the event list before the first form row inside the modal
    var firstFrow = box.querySelector('.frow');
    if (firstFrow) box.insertBefore(panel, firstFrow);
    else box.appendChild(panel);
  };

  // ── Delete handler — Supabase DELETE + in-memory splice + re-render ──
  window.glDeleteCalEvent = async function(id, type, date) {
    if (!window.supa) { alert('Cloud sync unavailable — try reloading.'); return; }

    var r = await window.supa.from('cal_events').delete().eq('id', id);
    if (r.error) { alert('Could not delete event: ' + r.error.message); return; }

    // Remove from shared in-memory cache so the calendar re-renders correctly
    try {
      if (typeof calEvents !== 'undefined' && Array.isArray(calEvents)) {
        var idx = calEvents.findIndex(function(e) { return e.id === id; });
        if (idx !== -1) calEvents.splice(idx, 1);
      }
    } catch(e) {}

    // Close modal and refresh the calendar view
    if (typeof closeCalEventModal === 'function') closeCalEventModal();
    if (typeof renderCal === 'function') renderCal(type);
    try {
      if (typeof calViewMode !== 'undefined' && calViewMode === 'list' && typeof renderCalList === 'function') {
        renderCalList(type);
      }
    } catch(e) {}

    if (typeof addNotification === 'function') {
      addNotification('🗑 Event deleted', 'Removed from your calendar.', 'success');
    }
  };

  console.log('[GL] Calendar day-view + delete v1 loaded');
}());
