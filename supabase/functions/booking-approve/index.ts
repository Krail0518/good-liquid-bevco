// booking-approve — Mike's approval gate for tour requests.
//
// A tour booked on book.html now lands as a PENDING request (see
// booking-confirm). This function is the other half: it serves a small review
// page from the capability link in Mike's WhatsApp/email, and on his explicit
// click either
//   • APPROVE  → creates the calendar event, marks the booking confirmed, and
//                emails the customer their confirmation + .ics invite; or
//   • DECLINE  → marks the booking declined and emails the customer that the
//                time didn't work, inviting them to reply for another.
//
// AUTH: no login. The link carries an HMAC token over the booking id (see
// _shared/booking-token.ts). Only someone holding a valid token for that
// booking can act on it, so this function is deployed with verify_jwt = false
// (config.toml) — a bare browser navigation from Mike's phone has no JWT.
//
// SAFETY: the state change happens only on an explicit POST (a button on the
// page), never on the initial GET — so an email client prefetching the link
// can't silently approve or decline a tour.
//
// Deploy: supabase functions deploy booking-approve --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import {
  fmtLocalDate, fmtLocalTime, tzLabel, buildICS, googleCalURL, sendMail,
} from '../_shared/booking-email.ts';
import { verifyBooking } from '../_shared/booking-token.ts';
import { createCalendarEvent } from '../_shared/google-calendar.ts';
import { jsonResponse, handlePreflight } from '../_shared/cors.ts';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The booking notes are the intake questionnaire summary — a newline-delimited
// block of "— Section —" headers and "Label: value" lines (see GL_INTAKE.
// summary). Rendered as one escaped string, HTML collapses the newlines into a
// wall of text. This parses it back into a readable, sectioned card. Falls back
// to a whitespace-preserving block if the notes aren't in the expected shape.
function renderNotes(raw: string): string {
  const lines = String(raw).split('\n');
  const parts: string[] = [];
  let sawStructure = false;
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    const sec = s.match(/^—\s*(.+?)\s*—$/);
    if (sec) { sawStructure = true; parts.push(`<div class="sec">${esc(sec[1])}</div>`); continue; }
    const kv = s.match(/^([^:]+):\s*(.*)$/);
    if (kv && kv[2]) {
      sawStructure = true;
      parts.push(`<div class="qr"><span class="qk">${esc(kv[1].trim())}</span><span class="qv">${esc(kv[2].trim())}</span></div>`);
      continue;
    }
    parts.push(`<div class="qv" style="padding:6px 0">${esc(s)}</div>`);
  }
  if (!sawStructure) return `<div class="notes-pre">${esc(raw)}</div>`;
  return parts.join('');
}

// ── Minimal branded HTML shell so the review page matches book.html ─────────
function page(title: string, inner: string, status = 200): Response {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} · Good Liquid Bev Co</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d1420;color:#c8d8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;
       display:flex;align-items:center;justify-content:center;padding:24px;
       background-image:radial-gradient(ellipse 80% 50% at 50% -10%,rgba(0,229,192,.07) 0%,transparent 60%)}
  .card{background:#131f32;border:1px solid #1e3058;border-radius:18px;max-width:460px;width:100%;padding:34px 30px;
        box-shadow:0 8px 40px rgba(0,0,0,.4)}
  h1{font-size:22px;color:#fff;margin-bottom:6px;letter-spacing:-.3px}
  .sub{color:#6b87ad;font-size:14px;margin-bottom:22px;line-height:1.6}
  .row{display:flex;flex-direction:column;gap:3px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.05)}
  .row:last-of-type{border-bottom:none}
  .lbl{color:#6b87ad;font-size:11px;text-transform:uppercase;letter-spacing:.8px;font-weight:600}
  .val{color:#fff;font-size:15px;font-weight:600}
  .box{background:#172038;border:1px solid #1e3058;border-radius:12px;padding:16px 18px;margin:18px 0}
  .sec{color:#00e5c0;font-size:11px;text-transform:uppercase;letter-spacing:1px;font-weight:800;
       margin:16px 0 4px;padding-bottom:6px;border-bottom:1px solid rgba(0,229,192,.18)}
  .sec:first-child{margin-top:0}
  .qr{display:flex;flex-direction:column;gap:2px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.05)}
  .qr:last-child{border-bottom:none}
  .qk{color:#7d97bd;font-size:11px;letter-spacing:.3px}
  .qv{color:#eaf1fb;font-size:14px;font-weight:600;line-height:1.4;word-break:break-word}
  .boxlbl{color:#6b87ad;font-size:11px;text-transform:uppercase;letter-spacing:.8px;font-weight:700;margin-bottom:10px}
  .notes-pre{white-space:pre-wrap;color:#dbe6f7;font-size:14px;line-height:1.5}
  .btns{display:flex;gap:12px;margin-top:24px;flex-wrap:wrap}
  button{border:none;border-radius:10px;padding:14px 28px;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;flex:1;min-width:130px}
  .approve{background:#00c4a7;color:#0d1420}
  .decline{background:#2a1620;color:#ff8a78;border:1px solid #5a2630}
  .ok{color:#5fcf9e}.bad{color:#e74646}.warn{color:#f5c842}
  .big{font-size:52px;text-align:center;margin-bottom:10px}
  a{color:#00e5c0}
  p{line-height:1.65;color:#9aa7bd;font-size:14px}
</style></head><body><div class="card">${inner}</div></body></html>`;
  // Build the header as a real Headers instance: a plain-object header can be
  // dropped by the edge runtime, and then the browser renders the HTML as plain
  // text (raw markup + mojibake) instead of a page. TextEncoder → the body is
  // unambiguously UTF-8 bytes with a matching charset.
  const headers = new Headers();
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(new TextEncoder().encode(html), { status, headers });
}

interface Booking {
  id: string; page_id: string; cal_event_id: string | null;
  booker_name: string; booker_email: string; booker_company: string | null;
  start_at: string; end_at: string; notes: string | null; status: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // The CRM admin area calls this cross-origin (goodliquidbevco.com → supabase)
  // as a JSON fetch, so answer the browser preflight.
  const pre = handlePreflight(req);
  if (pre) return pre;

  const url = new URL(req.url);

  // Params come from the query string on GET, and the form body on POST.
  let b = url.searchParams.get('b') || '';
  let t = url.searchParams.get('t') || '';
  let action = url.searchParams.get('action') || '';
  let fmt = url.searchParams.get('format') || '';
  if (req.method === 'POST') {
    try {
      const form = await req.formData();
      b = String(form.get('b') || b);
      t = String(form.get('t') || t);
      action = String(form.get('action') || action);
      fmt = String(form.get('format') || fmt);
    } catch { /* keep query params */ }
  }

  // Two audiences share this endpoint: the CRM admin card (wants JSON) and a
  // bare browser navigation from an old email link (wants the branded page).
  const wantsJson = fmt === 'json' || (req.headers.get('accept') || '').includes('application/json');
  const reply = (
    status: number, title: string, inner: string, json: Record<string, unknown>,
  ): Response => wantsJson ? jsonResponse(json, status) : page(title, inner, status);

  if (!b || !t) return reply(400, 'Invalid link', `<div class="big">🔗</div><h1>Link incomplete</h1><p>This approval link is missing information. Please open it directly from your WhatsApp or email.</p>`, { ok: false, error: 'link_incomplete', message: 'This approval link is missing information.' });
  if (!(await verifyBooking(b, t))) {
    return reply(403, 'Invalid link', `<div class="big">🚫</div><h1 class="bad">Link not valid</h1><p>This approval link couldn't be verified. If you copied it, make sure you got the whole thing — or just reply to the request email.</p>`, { ok: false, error: 'invalid_token', message: "This approval link couldn't be verified." });
  }

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: booking } = await supa
    .from('bookings').select('*').eq('id', b).maybeSingle() as { data: Booking | null };
  if (!booking) return reply(404, 'Not found', `<div class="big">🔍</div><h1>Request not found</h1><p>We couldn't find this tour request. It may have been removed.</p>`, { ok: false, error: 'not_found', message: "We couldn't find this tour request." });

  const { data: pg } = await supa
    .from('booking_pages').select('*').eq('id', booking.page_id).maybeSingle() as { data: any };
  const tz = (pg?.timezone) || 'America/New_York';
  const duration = Number(pg?.duration) || 30;
  const startAt = new Date(booking.start_at);
  const endAt = new Date(booking.end_at);
  const dateLabel = fmtLocalDate(startAt, tz);
  const timeLabel = fmtLocalTime(startAt, tz) + ' – ' + fmtLocalTime(endAt, tz);
  const tzLbl = tzLabel(tz);

  const detailRows = `
    <div class="box">
      <div class="row"><span class="lbl">When</span><span class="val">${esc(dateLabel)}</span></div>
      <div class="row"><span class="lbl">Time</span><span class="val">${esc(timeLabel)} <span style="color:#6b87ad;font-weight:400">${esc(tzLbl)}</span></span></div>
      <div class="row"><span class="lbl">Who</span><span class="val">${esc(booking.booker_name)}${booking.booker_company ? ' · ' + esc(booking.booker_company) : ''}</span></div>
      <div class="row"><span class="lbl">Contact</span><span class="val">${esc(booking.booker_email)}</span></div>
    </div>${booking.notes ? `
    <div class="box">
      <div class="boxlbl">What they told us</div>
      ${renderNotes(booking.notes)}
    </div>` : ''}`;

  // Compact machine-readable view of the request for the CRM admin card.
  const bookingInfo = {
    id: booking.id,
    name: booking.booker_name,
    company: booking.booker_company,
    email: booking.booker_email,
    date: dateLabel,
    time: timeLabel,
    tz: tzLbl,
    notes: booking.notes,
  };

  // Already decided — show current state (idempotent, safe to re-open the link).
  if (booking.status !== 'pending') {
    const map: Record<string, string> = {
      confirmed: `<div class="big">✅</div><h1 class="ok">Already approved</h1><p>This tour is confirmed and ${esc(booking.booker_name.split(' ')[0])} has their calendar invite.</p>`,
      declined:  `<div class="big">✖️</div><h1 class="warn">Already declined</h1><p>This request was declined. ${esc(booking.booker_name.split(' ')[0])} was let know the time didn't work.</p>`,
      cancelled: `<div class="big">🚫</div><h1 class="warn">Cancelled</h1><p>This booking was cancelled.</p>`,
    };
    return reply(200, 'Tour request',
      (map[booking.status] || `<div class="big">ℹ️</div><h1>Status: ${esc(booking.status)}</h1>`) + detailRows,
      { ok: true, already: true, status: booking.status, booking: bookingInfo });
  }

  // ── GET → show the review page (state changes only on the POST below) ────
  if (req.method !== 'POST') {
    // The CRM admin card fetches details as JSON and renders its own review UI.
    if (wantsJson) {
      return jsonResponse({ ok: true, status: 'pending', action: action || null, booking: bookingInfo });
    }
    const confirmOnly = action === 'approve' || action === 'decline';
    const hidden = `<input type="hidden" name="b" value="${esc(b)}"><input type="hidden" name="t" value="${esc(t)}">`;
    let buttons: string;
    if (confirmOnly) {
      const isApprove = action === 'approve';
      buttons = `<form method="POST" style="margin:0">${hidden}
        <input type="hidden" name="action" value="${esc(action)}">
        <p style="margin-bottom:14px">${isApprove
          ? 'Approving books this slot and emails the customer their confirmation + calendar invite.'
          : 'Declining lets the customer know this time didn’t work and frees the slot.'}</p>
        <button class="${isApprove ? 'approve' : 'decline'}" type="submit">${isApprove ? '✓ Confirm approval' : '✕ Confirm decline'}</button></form>
        <p style="margin-top:16px;font-size:13px"><a href="?b=${esc(b)}&t=${esc(t)}">← see both options</a></p>`;
    } else {
      buttons = `<div class="btns">
        <form method="POST" style="flex:1;margin:0">${hidden}<input type="hidden" name="action" value="approve"><button class="approve" type="submit">✓ Approve</button></form>
        <form method="POST" style="flex:1;margin:0">${hidden}<input type="hidden" name="action" value="decline"><button class="decline" type="submit">✕ Decline</button></form>
      </div>`;
    }
    return page('Tour request', `<h1>Tour request</h1><div class="sub">Approve to confirm the tour and send the customer their invite, or decline to free the slot.</div>${detailRows}${buttons}`);
  }

  // ── POST → perform the action ───────────────────────────────────────────
  const hostName = 'the Good Liquid team';
  if (action === 'approve') {
    // Re-check the slot is still free among CONFIRMED bookings (someone else's
    // request may have been approved into this slot in the meantime).
    const { data: clash } = await supa
      .from('bookings').select('id')
      .eq('page_id', booking.page_id).eq('status', 'confirmed').neq('id', booking.id)
      .lt('start_at', booking.end_at).gt('end_at', booking.start_at);
    if (clash && clash.length > 0) {
      return reply(409, 'Slot taken', `<div class="big">⛔</div><h1 class="bad">That slot is already booked</h1><p>Another tour was confirmed for this time, so this one can't be approved. Reply to ${esc(booking.booker_email)} to offer a new time; then you can decline this request.</p>${detailRows}`, { ok: false, error: 'slot_taken', message: 'Another tour was confirmed for this time, so this one can’t be approved.' });
    }

    // Create the calendar event now that it's real.
    const localStartStr = new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(startAt);
    const [calDate, calTime] = localStartStr.split(' ');
    const calNotes = [
      'Tour approved via scheduling link',
      `Name: ${booking.booker_name}`,
      `Email: ${booking.booker_email}`,
      booking.booker_company ? `Company: ${booking.booker_company}` : null,
      booking.notes ? `Notes: ${booking.notes}` : null,
    ].filter(Boolean).join('\n');

    const { data: calEvent } = await supa.from('cal_events').insert([{
      event_type: 'general',
      title: `Meeting: ${booking.booker_name}`,
      event_date: calDate, event_time: calTime, notes: calNotes,
    }]).select('id').single();

    const { data: updated, error: upErr } = await supa
      .from('bookings')
      .update({ status: 'confirmed', cal_event_id: calEvent?.id ?? null })
      .eq('id', booking.id).eq('status', 'pending')
      .select('id');
    if (upErr || !updated || updated.length === 0) {
      // Someone approved/declined it a moment ago — treat as already handled.
      return reply(409, 'Already handled', `<div class="big">↩️</div><h1 class="warn">Nothing to do</h1><p>This request was just updated elsewhere. Re-open the link to see its current state.</p>`, { ok: false, error: 'already_handled', message: 'This request was just updated elsewhere.' });
    }

    // Host info for the invite organizer.
    const { data: hostProfile } = await supa
      .from('profiles').select('name, email').eq('id', pg?.user_id).maybeSingle() as { data: any };
    const organizerName = hostProfile?.name || 'Good Liquid Bev Co';
    const organizerEmail = hostProfile?.email || 'Mike@GoodLiquid.com';

    const summary = `Meeting: ${booking.booker_name} + Good Liquid Bev Co`;
    const icsDesc = [
      'Tour with Good Liquid Bev Co.',
      `Name: ${booking.booker_name}`,
      booking.booker_company ? `Company: ${booking.booker_company}` : null,
      booking.notes ? `Notes: ${booking.notes}` : null,
    ].filter(Boolean).join('\n');
    const icsContent = buildICS({
      uid: booking.id, summary, description: icsDesc, startAt, endAt,
      organizerName, organizerEmail,
      attendeeName: booking.booker_name, attendeeEmail: booking.booker_email,
    });
    const gcalURL = googleCalURL({ summary, description: icsDesc, startAt, endAt });

    const bookerHtml = `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#222">
  <div style="background:#0f1624;padding:24px 32px;border-radius:10px">
    <h2 style="color:#00e5c0;margin:0 0 6px">Tour confirmed ✓</h2>
    <p style="color:#c8d8f0;margin:0 0 24px">Hi ${esc(booking.booker_name)}, you're all set — we look forward to seeing you!</p>
    <div style="background:#192337;border-radius:8px;padding:20px;margin-bottom:20px">
      <div style="margin-bottom:12px"><span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">Date</span><br><span style="color:#fff;font-size:15px">${esc(dateLabel)}</span></div>
      <div style="margin-bottom:12px"><span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">Time</span><br><span style="color:#fff;font-size:15px">${esc(timeLabel)}</span><span style="color:#6b87ad;font-size:13px"> ${esc(tzLbl)}</span></div>
      <div><span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">Duration</span><br><span style="color:#fff;font-size:15px">${duration} minutes</span></div>
    </div>
    <div style="margin-bottom:20px">
      <p style="color:#9aa7bd;font-size:13px;margin:0 0 12px">📎 <strong style="color:#c8d8f0">invite.ics</strong> is attached — open it to add this to Google Calendar, Apple Calendar, or Outlook.</p>
      <a href="${gcalURL}" style="display:inline-block;padding:10px 20px;background:#4285F4;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">📅 Add to Google Calendar</a>
    </div>
    <p style="color:#9aa7bd;font-size:13px">Need to reschedule? Just reply to this email.</p>
    <hr style="border:none;border-top:1px solid #1f3059;margin:20px 0">
    <p style="color:#6b87ad;font-size:12px;margin:0">Good Liquid Bev Co · Palmetto, FL<br>Mike@GoodLiquid.com · (803) 493-5065</p>
  </div>
</div>`;
    const bookerText = [
      `Hi ${booking.booker_name},`, '',
      'Good news — your tour with Good Liquid Bev Co is confirmed!', '',
      `📅  ${dateLabel}`, `🕐  ${timeLabel} (${tzLbl})`, `⏱   ${duration} minutes`, '',
      'The attached invite.ics adds this to your calendar. Need to reschedule? Just reply.', '',
      'Good Liquid Bev Co · Palmetto, FL', 'Mike@GoodLiquid.com · (803) 493-5065',
    ].join('\n');

    await sendMail({
      to: booking.booker_email,
      subject: `Tour confirmed: ${dateLabel} at ${fmtLocalTime(startAt, tz)}`,
      text: bookerText, html: bookerHtml, icsContent,
    });

    // Drop the confirmed tour onto the host's own Google Calendar (the mailbox
    // the CRM is connected to — Mike@GoodLiquid.com). Best-effort: a Google
    // failure (e.g. the calendar scope not yet granted) never blocks the
    // approval — the admin schedule row + booker email already went out.
    const calRes = await createCalendarEvent({
      summary,
      description: icsDesc + `\nContact: ${booking.booker_email}`,
      startISO: booking.start_at,
      endISO: booking.end_at,
      timeZone: tz,
    });
    if (calRes.ok) console.log('[booking-approve] google-calendar event created', calRes.id, 'on', calRes.calendar);
    else console.warn('[booking-approve] google-calendar NOT created:', calRes.status, calRes.error);

    return reply(200, 'Approved', `<div class="big">✅</div><h1 class="ok">Tour approved</h1><p>${esc(booking.booker_name.split(' ')[0])} just got their confirmation and calendar invite, and the slot is booked on your calendar.</p>${detailRows}`, { ok: true, status: 'confirmed', gcal: calRes.ok, booking: bookingInfo, message: `${booking.booker_name.split(' ')[0]} got their confirmation and calendar invite.` });
  }

  if (action === 'decline') {
    const { data: updated, error: upErr } = await supa
      .from('bookings').update({ status: 'declined' })
      .eq('id', booking.id).eq('status', 'pending').select('id');
    if (upErr || !updated || updated.length === 0) {
      return reply(409, 'Already handled', `<div class="big">↩️</div><h1 class="warn">Nothing to do</h1><p>This request was just updated elsewhere. Re-open the link to see its current state.</p>`, { ok: false, error: 'already_handled', message: 'This request was just updated elsewhere.' });
    }

    const firstName = booking.booker_name.split(' ')[0];
    const declineText = [
      `Hi ${firstName},`, '',
      'Thanks for your interest in touring Good Liquid Bev Co. Unfortunately that',
      'particular time doesn’t work on our end.', '',
      'We’d still love to host you — just reply to this email with a couple of times',
      'that suit you and we’ll get it set up.', '',
      '— The Good Liquid team', 'Mike@GoodLiquid.com · (803) 493-5065',
    ].join('\n');
    const declineHtml = `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#222">
  <div style="background:#0f1624;padding:24px 32px;border-radius:10px">
    <h2 style="color:#f5c842;margin:0 0 12px">About your tour time</h2>
    <p style="color:#c8d8f0;line-height:1.7">Hi ${esc(firstName)}, thanks for your interest in touring Good Liquid Bev Co! Unfortunately your requested time (${esc(dateLabel)}, ${esc(timeLabel)} ${esc(tzLbl)}) doesn’t work on our end.</p>
    <p style="color:#c8d8f0;line-height:1.7">We’d still love to host you — just reply with a couple of times that suit you and we’ll set it up.</p>
    <hr style="border:none;border-top:1px solid #1f3059;margin:20px 0">
    <p style="color:#6b87ad;font-size:12px;margin:0">Good Liquid Bev Co · Palmetto, FL<br>Mike@GoodLiquid.com · (803) 493-5065</p>
  </div>
</div>`;
    await sendMail({
      to: booking.booker_email,
      subject: `Your tour request — let’s find another time`,
      text: declineText, html: declineHtml,
    });

    return reply(200, 'Declined', `<div class="big">✖️</div><h1 class="warn">Request declined</h1><p>${esc(firstName)} was let know this time didn’t work and invited to suggest another. The slot is free again.</p>${detailRows}`, { ok: true, status: 'declined', booking: bookingInfo, message: `${firstName} was let know this time didn’t work and invited to suggest another.` });
  }

  return reply(400, 'Unknown action', `<div class="big">❓</div><h1>Unknown action</h1><p>Please use the Approve or Decline button.</p>`, { ok: false, error: 'unknown_action', message: 'Please use Approve or Decline.' });
});
