/* followups.js — the in-CRM side of the lead-automation follow-up queue.
 *
 * The lead-automations edge function drafts a gentle nudge whenever a lead goes
 * quiet on us, and drops it in lead_followups (status 'ready'). This renders
 * those drafts as a review list: read it, tap Send (goes out as Mike via
 * gmail-send and is logged to the thread), or Dismiss. Mike can also do this
 * from his phone via the lead-action links, but this is the desk version.
 *
 * Exposes:
 *   window.glRenderFollowups(mount)   — render the ready-to-send list into an element
 *   window.glFollowupCount()          — Promise<number> of ready drafts (for a badge)
 */
(function () {
  'use strict';
  function sb() { return window.supa || null; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function elOf(m) { return typeof m === 'string' ? document.getElementById(m) : m; }

  window.glFollowupCount = async function () {
    if (!sb()) return 0;
    try {
      var r = await sb().from('lead_followups').select('id', { count: 'exact', head: true }).eq('status', 'ready');
      return r.count || 0;
    } catch (e) { return 0; }
  };

  async function sendOne(row, btn, host) {
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      // Send as Mike through the Gmail sender (staff JWT authorizes it).
      var resp = await sb().functions.invoke('gmail-send', { body: { to: row.to_email, subject: row.subject, text: row.body } });
      var failed = (resp && resp.error) || (resp && resp.data && resp.data.ok === false);
      if (failed) { btn.disabled = false; btn.textContent = '✓ Send'; toast(host, '#ff8579', 'Send failed — try again.'); return; }
      var now = new Date().toISOString();
      // Mark sent (append .select() so RLS-silent failures are caught).
      var upd = await sb().from('lead_followups').update({ status: 'sent', sent_at: now, decided_at: now }).eq('id', row.id).eq('status', 'ready').select('id');
      if (upd.error || !upd.data || !upd.data.length) { btn.disabled = false; btn.textContent = '✓ Send'; toast(host, '#ff8579', 'Saved send-state failed.'); return; }
      // Log to the correspondence thread so the ball flips and the brief sees it.
      try { await sb().from('email_log').insert([{ to_email: row.to_email, subject: row.subject, body_preview: row.body, direction: 'outbound', status: 'sent', sent_at: now, client_id: row.client_id || null }]); } catch (e) {}
      if (typeof addNotification === 'function') addNotification('✉️ Follow-up sent', row.to_name || row.to_email, 'success');
      window.glRenderFollowups(host);
    } catch (e) { btn.disabled = false; btn.textContent = '✓ Send'; toast(host, '#ff8579', 'Send error.'); }
  }

  async function dismissOne(row, btn, host) {
    btn.disabled = true;
    try {
      await sb().from('lead_followups').update({ status: 'dismissed', decided_at: new Date().toISOString() }).eq('id', row.id).eq('status', 'ready').select('id');
      window.glRenderFollowups(host);
    } catch (e) { btn.disabled = false; }
  }

  function toast(host, color, msg) {
    var t = host.querySelector('.gl-fu-toast'); if (!t) return;
    t.style.display = 'block'; t.style.color = color; t.textContent = msg;
  }

  window.glRenderFollowups = async function (mount) {
    var host = elOf(mount); if (!host) return;
    if (!sb()) { host.innerHTML = '<div style="color:#9aa7bd;font-size:12px">Not connected.</div>'; return; }
    host.innerHTML = '<div style="color:#9aa7bd;font-size:12px">Loading follow-ups…</div>';
    var rows = [];
    try {
      var r = await sb().from('lead_followups').select('*').eq('status', 'ready').order('created_at', { ascending: true });
      if (r.error) throw r.error;
      rows = r.data || [];
    } catch (e) { host.innerHTML = '<div style="color:#ff8579;font-size:12px">Could not load follow-ups: ' + esc(e.message || e) + '</div>'; return; }

    var head = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
      '<div style="font-size:14px;font-weight:800;color:#eef4ff">✍️ Follow-ups ready to send</div>' +
      '<span style="background:rgba(0,229,192,.14);color:#00e5c0;border:1px solid rgba(0,229,192,.35);border-radius:20px;padding:1px 9px;font-size:12px;font-weight:700">' + rows.length + '</span></div>';

    if (!rows.length) {
      host.innerHTML = head + '<div style="font-size:12.5px;color:#9aa7bd">You\'re all caught up — no leads are overdue for a nudge. New drafts appear here automatically when a lead goes quiet.</div>';
      return;
    }

    var cardCss = 'background:#0f1830;border:1px solid #23345c;border-radius:11px;padding:13px 14px;margin-bottom:10px';
    host.innerHTML = head +
      '<div style="font-size:12px;color:#9aa7bd;margin-bottom:12px">Drafted automatically for leads that went quiet. Read, then send as-is or dismiss.</div>' +
      rows.map(function (r) {
        return '<div class="gl-fu-card" style="' + cardCss + '" data-id="' + esc(r.id) + '">' +
          '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:5px">' +
            '<div style="font-weight:700;color:#fff;font-size:13.5px">' + esc(r.to_name || r.to_email) + ' <span style="color:#6b87ad;font-weight:400">&lt;' + esc(r.to_email) + '&gt;</span></div>' +
            (r.reason ? '<div style="color:#f5c842;font-size:11.5px">⏱ ' + esc(r.reason) + '</div>' : '') +
          '</div>' +
          '<div style="color:#c8d8f0;font-weight:600;font-size:13px;margin-bottom:4px">' + esc(r.subject) + '</div>' +
          '<div style="color:#9fb0cc;font-size:12.5px;white-space:pre-wrap;line-height:1.5;max-height:150px;overflow:auto;background:#0b1526;border:1px solid #1c2c4e;border-radius:8px;padding:9px 11px">' + esc(r.body) + '</div>' +
          '<div style="display:flex;gap:8px;margin-top:10px">' +
            '<button class="gl-fu-send" style="padding:8px 16px;background:#00c4a7;color:#0d1420;border:none;border-radius:8px;font-weight:800;font-size:13px;cursor:pointer">✓ Send</button>' +
            '<button class="gl-fu-dismiss" style="padding:8px 14px;background:#241a2a;color:#c9a6ff;border:1px solid #4a3a5a;border-radius:8px;font-weight:700;font-size:13px;cursor:pointer">✕ Dismiss</button>' +
          '</div>' +
        '</div>';
      }).join('') +
      '<div class="gl-fu-toast" style="display:none;font-size:12.5px;margin-top:6px"></div>';

    rows.forEach(function (r) {
      var card = host.querySelector('.gl-fu-card[data-id="' + r.id + '"]'); if (!card) return;
      card.querySelector('.gl-fu-send').addEventListener('click', function () { sendOne(r, this, host); });
      card.querySelector('.gl-fu-dismiss').addEventListener('click', function () { dismissOne(r, this, host); });
    });
    updateBadge(rows.length);
  };

  // Full-screen overlay opened from the pipeline "✍️ Follow-ups" button.
  window.glOpenFollowups = function () {
    var ex = document.getElementById('gl-followups-overlay'); if (ex) ex.remove();
    var ov = document.createElement('div');
    ov.id = 'gl-followups-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:950;background:rgba(6,13,26,.9);backdrop-filter:blur(12px);display:flex;align-items:flex-start;justify-content:center;padding:28px 16px;overflow:auto';
    ov.addEventListener('click', function (e) { if (e.target === ov) ov.remove(); });
    ov.innerHTML = '<div style="background:#101d33;border:1px solid #23345c;border-radius:16px;max-width:640px;width:100%;padding:22px 22px 26px;box-shadow:0 20px 70px rgba(0,0,0,.5)">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">' +
        '<div style="font-family:var(--ff-disp,inherit);font-size:18px;letter-spacing:1px;color:#00e5c0">AUTO FOLLOW-UPS</div>' +
        '<button data-gl-close="#gl-followups-overlay" style="background:none;border:none;color:#9aa7bd;font-size:22px;cursor:pointer;line-height:1">×</button>' +
      '</div>' +
      '<div id="gl-followups-mount"></div></div>';
    document.body.appendChild(ov);
    window.glRenderFollowups(document.getElementById('gl-followups-mount'));
  };

  function updateBadge(n) {
    var btn = document.getElementById('gl-followups-btn'); if (!btn) return;
    var base = '✍️ Follow-ups';
    btn.innerHTML = n > 0 ? base + ' <span style="background:#00e5c0;color:#0d1420;border-radius:20px;padding:0 7px;font-size:11px;font-weight:800;margin-left:2px">' + n + '</span>' : base;
  }

  // Reflect the ready count on the pipeline button shortly after load + hourly.
  function refreshBadge() { window.glFollowupCount().then(updateBadge).catch(function () {}); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(refreshBadge, 2500); });
  else setTimeout(refreshBadge, 2500);
  setInterval(refreshBadge, 3600000);
})();
