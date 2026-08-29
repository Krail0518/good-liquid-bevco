/* crm-booking-review.js — review & confirm a tour request INSIDE the admin area.
 *
 * The approval email/WhatsApp link now points at the CRM itself
 * (/?booking=<id>&t=<token>), not a standalone Supabase page. On login this
 * module detects those params, fetches the request from the booking-approve
 * edge function (JSON mode), and shows a review card. Approve/Decline call the
 * same function; the HMAC token in the link authorises the action, so it's safe
 * even before the page knows who's logged in.
 *
 * On approval the edge function books the slot, emails the customer their
 * confirmation + calendar invite, writes the row onto the admin General
 * Calendar (cal_events), AND creates the event on the host's Google Calendar.
 * This module then jumps to the General Calendar so the confirmed tour is
 * visible immediately.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fnBase() {
    var root = (typeof SUPA_URL !== 'undefined' && SUPA_URL) ||
               (window.supa && window.supa.supabaseUrl) || '';
    return root + '/functions/v1/booking-approve';
  }
  // The Supabase gateway wants the publishable key on cross-origin calls even
  // for verify_jwt=false functions; send it like book.html does.
  function bkKey() {
    return (typeof SUPA_KEY !== 'undefined' && SUPA_KEY) || window.SUPA_KEY || '';
  }
  function bkHeaders(extra) {
    var h = { 'apikey': bkKey(), 'Authorization': 'Bearer ' + bkKey() };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }

  // Small self-contained toast so the module never depends on a host helper.
  function toast(msg, ok) {
    try {
      var t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText =
        'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:100000;' +
        'max-width:90vw;padding:13px 20px;border-radius:10px;font-size:14px;font-weight:600;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.4);' +
        'color:' + (ok ? '#04231c' : '#fff') + ';background:' + (ok ? '#00c4a7' : '#e05252') + ';';
      document.body.appendChild(t);
      setTimeout(function () { t.style.transition = 'opacity .4s'; t.style.opacity = '0'; }, 3200);
      setTimeout(function () { if (t.parentNode) t.remove(); }, 3700);
    } catch (e) { /* non-fatal */ }
  }

  function closeModal() {
    var m = document.getElementById('gl-booking-review-ov');
    if (m) m.remove();
  }

  function row(lbl, val) {
    if (val == null || val === '') return '';
    return '<div style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)">' +
      '<div style="color:#6b87ad;font-size:11px;text-transform:uppercase;letter-spacing:.7px;font-weight:600;margin-bottom:3px">' + esc(lbl) + '</div>' +
      '<div style="color:#fff;font-size:15px;font-weight:600">' + val + '</div></div>';
  }

  // Render the review card. `already` non-null → read-only current-state view.
  function render(bk, bookingId, token, already) {
    closeModal();
    var ov = document.createElement('div');
    ov.id = 'gl-booking-review-ov';
    ov.className = 'modal-ov show';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99990;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(6,10,18,.72);padding:20px';

    var name = esc(bk.name || 'Guest') + (bk.company ? ' <span style="color:#6b87ad;font-weight:400">· ' + esc(bk.company) + '</span>' : '');
    var details =
      row('When', esc(bk.date)) +
      row('Time', esc(bk.time) + (bk.tz ? ' <span style="color:#6b87ad;font-weight:400">' + esc(bk.tz) + '</span>' : '')) +
      row('Who', name) +
      row('Contact', esc(bk.email)) +
      (bk.notes ? row('Notes', '<span style="font-weight:400;color:#c8d8f0;line-height:1.5">' + esc(bk.notes) + '</span>') : '');

    var header, actions;
    if (already) {
      var label = already === 'confirmed' ? '✅ Already approved'
                : already === 'declined' ? '✖️ Already declined'
                : already === 'cancelled' ? '🚫 Cancelled'
                : 'Status: ' + esc(already);
      header = '<h2 style="margin:0 0 4px;color:#fff;font-size:20px">Tour request</h2>' +
               '<div style="color:#6b87ad;font-size:13px;margin-bottom:18px">' + label + '</div>';
      actions = '<div style="margin-top:22px"><button data-act="close" style="width:100%;border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;background:#1c2740;color:#8fb3ff">Close</button></div>';
    } else {
      header = '<h2 style="margin:0 0 4px;color:#fff;font-size:20px">Tour request</h2>' +
               '<div style="color:#6b87ad;font-size:13px;margin-bottom:18px">Approve to confirm the tour and send the customer their invite, or decline to free the slot.</div>';
      actions = '<div style="display:flex;gap:12px;margin-top:22px;flex-wrap:wrap">' +
        '<button data-act="approve" style="flex:1;min-width:130px;border:none;border-radius:10px;padding:14px;font-size:15px;font-weight:800;cursor:pointer;background:#00c4a7;color:#04231c">✓ Approve</button>' +
        '<button data-act="decline" style="flex:1;min-width:130px;border-radius:10px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;background:#2a1620;color:#ff8a78;border:1px solid #5a2630">✕ Decline</button>' +
        '</div>' +
        '<div style="margin-top:12px;text-align:center"><button data-act="close" style="background:none;border:none;color:#6b87ad;font-size:13px;cursor:pointer">Not now</button></div>';
    }

    ov.innerHTML =
      '<div class="modal-box" style="background:#131f32;border:1px solid #1e3058;border-radius:16px;max-width:440px;width:100%;padding:28px 26px;box-shadow:0 12px 48px rgba(0,0,0,.5)">' +
      header +
      '<div style="background:#172038;border:1px solid #1e3058;border-radius:12px;padding:6px 16px">' + details + '</div>' +
      actions +
      '<div data-busy style="display:none;margin-top:14px;text-align:center;color:#8fb3ff;font-size:13px">Working…</div>' +
      '</div>';

    ov.addEventListener('click', function (e) {
      var act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
      if (!act && e.target === ov) { closeModal(); return; }   // click backdrop to dismiss
      if (act === 'close') { closeModal(); return; }
      if (act === 'approve' || act === 'decline') { doAction(bookingId, token, act, ov); }
    });
    document.body.appendChild(ov);
  }

  function setBusy(ov, on) {
    try {
      var b = ov.querySelector('[data-busy]');
      if (b) b.style.display = on ? 'block' : 'none';
      ov.querySelectorAll('button').forEach(function (btn) { btn.disabled = on; btn.style.opacity = on ? '.5' : '1'; });
    } catch (e) { /* ignore */ }
  }

  async function doAction(bookingId, token, action, ov) {
    setBusy(ov, true);
    try {
      var fd = new FormData();
      fd.append('b', bookingId);
      fd.append('t', token);
      fd.append('action', action);
      fd.append('format', 'json');
      var r = await fetch(fnBase() + '?format=json', { method: 'POST', body: fd, headers: bkHeaders({ Accept: 'application/json' }) });
      var j = await r.json().catch(function () { return {}; });
      if (!j || !j.ok) {
        setBusy(ov, false);
        toast((j && j.message) || 'Could not complete that — please try again.', false);
        return;
      }
      closeModal();
      if (action === 'approve') {
        toast((j.message || 'Tour approved.') + ' Added to your schedule.', true);
        goToCalendar();
      } else {
        toast(j.message || 'Request declined — the slot is free again.', true);
      }
    } catch (e) {
      setBusy(ov, false);
      toast('Network error — please try again.', false);
    }
  }

  // Jump to the admin General Calendar so the just-confirmed tour is visible.
  function goToCalendar() {
    try {
      if (typeof cNav === 'function') {
        cNav('calendar');
        // cNav's nav-hook reloads cal_events; re-render once more shortly after
        // in case the insert lands a beat behind the first fetch.
        setTimeout(function () {
          try { if (typeof loadCalEvents === 'function' && typeof renderCal === 'function') loadCalEvents().then(function () { renderCal('general'); }); } catch (e) {}
        }, 800);
      }
    } catch (e) { /* non-fatal */ }
  }

  async function openReview(bookingId, token) {
    try {
      var url = fnBase() + '?format=json&b=' + encodeURIComponent(bookingId) + '&t=' + encodeURIComponent(token);
      var r = await fetch(url, { headers: bkHeaders({ Accept: 'application/json' }) });
      var j = await r.json().catch(function () { return {}; });
      if (!j || (!j.ok && !j.already)) {
        toast((j && j.message) || 'This tour request could not be opened.', false);
        return;
      }
      render(j.booking || {}, bookingId, token, j.already ? j.status : null);
    } catch (e) {
      toast('Could not load the tour request.', false);
    }
  }

  function stripParams() {
    try {
      var p = new URLSearchParams(location.search);
      p.delete('booking'); p.delete('t'); p.delete('action');
      var qs = p.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    } catch (e) { /* ignore */ }
  }

  // Is a Supabase session present? getSession reads the persisted session, so
  // it's true whenever the browser is signed in — even before the CRM's own
  // login flow (loginUser) has run on this page load.
  async function hasSession() {
    try {
      if (window.supa && supa.auth && typeof supa.auth.getSession === 'function') {
        var s = await supa.auth.getSession();
        return !!(s && s.data && s.data.session);
      }
    } catch (e) { /* ignore */ }
    return false;
  }

  var _bkBooted = false;
  // The approval link (/?booking=<id>&t=<token>) opens the public site. This
  // runs on load AND after any login, so the review card appears whether or not
  // the visitor was already signed in:
  //   • already signed in → open the card immediately;
  //   • not signed in yet → pop the CRM login (openAdmin); once they sign in,
  //     the login hook re-runs this and the card opens. Params are left in the
  //     URL until the card actually opens, so they survive the login round-trip.
  async function boot() {
    if (_bkBooted) return;
    var bookingId, token;
    try {
      var p = new URLSearchParams(location.search);
      bookingId = p.get('booking');
      token = p.get('t');
    } catch (e) { return; }
    if (!bookingId || !token) return;

    if (!(await hasSession())) {
      // Not authenticated — surface the login box. Don't strip params yet.
      if (typeof window.openAdmin === 'function') { try { window.openAdmin(); } catch (e) { /* ignore */ } }
      return;
    }
    _bkBooted = true;
    stripParams();
    openReview(bookingId, token);
  }

  // Trigger on initial load (covers the already-signed-in case)…
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 500); });
  } else {
    setTimeout(boot, 500);
  }
  // …and again after any staff login (covers the sign-in-then-open case).
  function registerHook() {
    if (window.GL_HOOKS && typeof window.GL_HOOKS.registerLoginHook === 'function') {
      window.GL_HOOKS.registerLoginHook(function () { setTimeout(boot, 300); });
      return true;
    }
    return false;
  }
  if (!registerHook()) window.addEventListener('load', registerHook);
})();
