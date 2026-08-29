// booking-confirm — validates a booking request, persists it, creates a
// calendar event, and sends confirmation emails to both the booker and
// the rep who owns the booking page.
//
// Both emails include:
//   • An .ics (iCalendar) attachment — one click adds the event to
//     Google Calendar, Apple Calendar, Outlook, or any calendar app.
//   • METHOD:REQUEST so Gmail shows Accept / Decline RSVP buttons.
//   • A "Add to Google Calendar" quick-add link in the HTML body.
//
// Called by the public book.html page (no auth required — anon callers).
//
// Request body (POST JSON):
//   {
//     page_id:         string   (uuid)     required
//     booker_name:     string              required
//     booker_email:    string              required
//     booker_company?: string              optional
//     notes?:          string              optional
//     slot_date:       string   "YYYY-MM-DD"  required  (local date in page timezone)
//     slot_time:       string   "HH:MM"       required  (local 24-h time in page timezone)
//   }
//
// Response:
//   { ok: true,  booking_id: string }  on success
//   { ok: false, error: string }       on failure
//
// Secrets used (all pre-set by Supabase or set via `supabase secrets set`):
//   SUPABASE_URL               — auto-provided
//   SUPABASE_SERVICE_ROLE_KEY  — auto-provided
//   MAILGUN_API_KEY            — Mailgun private key
//   MAILGUN_DOMAIN             — e.g. mail.goodliquidbevco.com
//   MAILGUN_FROM               — e.g. "Good Liquid Bev Co <noreply@mail.goodliquidbevco.com>"
//
// Deploy:
//   supabase functions deploy booking-confirm --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';
import { localToUTC, fmtLocalDate, fmtLocalTime, tzLabel, sendMail } from '../_shared/booking-email.ts';
import { signBooking } from '../_shared/booking-token.ts';
import { checkBusy } from '../_shared/google-calendar.ts';

// ── Main handler ──────────────────────────────────────────────────────────
Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return errorResponse('Invalid JSON body', 400); }

  const { page_id, booker_name, booker_email, booker_company, notes, slot_date, slot_time } = body as {
    page_id?: string; booker_name?: string; booker_email?: string;
    booker_company?: string; notes?: string; slot_date?: string; slot_time?: string;
  };

  if (!page_id)      return errorResponse('page_id required', 400);
  if (!booker_name)  return errorResponse('booker_name required', 400);
  if (!booker_email) return errorResponse('booker_email required', 400);
  if (!slot_date)    return errorResponse('slot_date required', 400);
  if (!slot_time)    return errorResponse('slot_time required', 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slot_date)) return errorResponse('slot_date must be YYYY-MM-DD', 400);
  if (!/^\d{2}:\d{2}$/.test(slot_time))        return errorResponse('slot_time must be HH:MM', 400);
  // This endpoint is public and each booking sends email and fills a real
  // calendar slot, so the inputs are bounded and rate limited below.
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(String(booker_email))) {
    return errorResponse('Please enter a valid email address', 400);
  }
  // That pattern excludes only '@' and whitespace, so it happily accepts
  // a<svg/onload=alert(1)>@b.co -- no space and no second '@' is required to
  // build a payload. booker_email was the one field stripAngles() below never
  // touched, and it is interpolated into the approval email that carries the
  // Approve link. Reject rather than strip: unlike a name or a note, none of
  // these characters belongs in a deliverable address.
  if (/[<>"'`]/.test(String(booker_email))) {
    return errorResponse('Please enter a valid email address', 400);
  }
  if (String(booker_name).length > 200 || String(booker_company || '').length > 200) {
    return errorResponse('Name or company is too long', 400);
  }
  if (String(notes || '').length > 2000) {
    return errorResponse('Please shorten your note', 400);
  }

  /* Defence in depth against stored XSS. These fields come from an anonymous
     caller and are later rendered on staff screens and interpolated into the
     approval email's HTML. Rendering is the primary defence and must stay
     correct on its own, but angle brackets have no legitimate use in a name,
     company or tour note — dropping them here means a payload never reaches
     storage in the first place. Strip rather than reject so a stray "<" in a
     note does not fail an otherwise valid booking.
     Everything below persists or sends these SAFE_* values, never the raw ones. */
  const stripAngles = (v: unknown) => String(v ?? '').replace(/[<>]/g, '');

  /* Escaping for the email templates below.
     stripAngles() is defence in depth at ingestion, not the fix. It cannot be
     the fix: it never covered booker_email, it does not touch '&' (so
     "Tom & Jerry" can still form an entity), and it says nothing about values
     that reach these templates from somewhere other than this request --
     hostName comes from the staff profile row. Rendering is the primary
     defence and has to be correct on its own, which is what GL-006 asked for.
     Applied to every interpolation of a value this function did not construct
     itself. */
  const escapeHtml = (v: unknown) =>
    String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const safeName    = stripAngles(booker_name).trim();
  const safeCompany = booker_company ? stripAngles(booker_company).trim() : null;
  const safeNotes   = notes ? stripAngles(notes) : null;

  if (!safeName) return errorResponse('Please enter your name', 400);

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Rate limit: 3 bookings per email per day, and 20 site-wide per hour, so a
  // stranger cannot fill the calendar or use the confirmation mail as a relay.
  const dayAgo  = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const [{ count: mineToday }, { count: allRecent }] = await Promise.all([
    supa.from('bookings').select('id', { count: 'exact', head: true })
        .eq('booker_email', String(booker_email)).gte('created_at', dayAgo),
    supa.from('bookings').select('id', { count: 'exact', head: true })
        .gte('created_at', hourAgo),
  ]) as Array<{ count: number | null }>;
  if ((mineToday ?? 0) >= 3) {
    return errorResponse('You already have a booking request in — we will be in touch shortly.', 429);
  }
  if ((allRecent ?? 0) >= 20) {
    return errorResponse('We are receiving a lot of requests right now — please try again shortly.', 429);
  }

  // ── Load booking page config ───────────────────────────────────────────
  const { data: page, error: pageErr } = await supa
    .from('booking_pages')
    .select('*')
    .eq('id', page_id)
    .eq('is_active', true)
    .maybeSingle() as { data: any; error: any };

  if (pageErr || !page) return errorResponse('Booking page not found', 404);

  // Load host profile separately (booking_pages.user_id → auth.users, not profiles)
  const { data: hostProfile } = await supa
    .from('profiles')
    .select('name, email')
    .eq('id', page.user_id)
    .maybeSingle() as { data: any; error: any };

  const tz        = page.timezone || 'America/New_York';
  const duration  = Number(page.duration)     || 30;
  const availDays = (page.avail_days as number[]) || [1,2,3,4,5];

  // ── Convert slot to UTC timestamps ────────────────────────────────────
  let startAt: Date;
  try { startAt = localToUTC(slot_date, slot_time, tz); }
  catch (e) { return errorResponse('Invalid date/time: ' + String(e), 400); }

  const endAt = new Date(startAt.getTime() + duration * 60_000);

  if (startAt.getTime() < Date.now() - 60_000) {
    return errorResponse('That slot is in the past', 400);
  }

  // Require 24-hour advance notice
  if (startAt.getTime() < Date.now() + 24 * 60 * 60 * 1000) {
    return errorResponse('Bookings require at least 24 hours advance notice.', 400);
  }

  const dow = new Date(slot_date + 'T12:00:00Z').getUTCDay();
  if (!availDays.includes(dow)) {
    return errorResponse('That day is not available', 400);
  }

  const [sh, sm] = (page.start_time || '10:00').split(':').map(Number);
  const [eh, em] = (page.end_time   || '14:00').split(':').map(Number);
  const [rh, rm] = slot_time.split(':').map(Number);
  const slotMin  = rh * 60 + rm;
  if (slotMin < sh * 60 + sm || slotMin + duration > eh * 60 + em) {
    return errorResponse('Slot is outside availability window', 400);
  }

  // ── Check for conflicts ────────────────────────────────────────────────
  // A pending request holds its slot too, so two people can't both request the
  // same time before Mike has approved either. (A declined request frees it.)
  const { data: conflicts } = await supa
    .from('bookings')
    .select('id')
    .eq('page_id', page_id)
    .in('status', ['confirmed', 'pending'])
    .lt('start_at', endAt.toISOString())
    .gt('end_at',   startAt.toISOString());

  if (conflicts && conflicts.length > 0) {
    return errorResponse('That slot is no longer available', 409);
  }

  // ── Google Calendar availability gate ──────────────────────────────────
  // Mike does not want an approval email for a time he's already busy. Check
  // his connected Google Calendar and block on a DEFINITE conflict — nothing is
  // inserted and no approval email goes out. If the check itself can't run
  // (token/API hiccup) we let it through: he still has the final Approve/Decline.
  try {
    const busyRes = await checkBusy(startAt.toISOString(), endAt.toISOString(), tz);
    if (busyRes.ok && busyRes.busy) {
      return errorResponse('That time is already booked on our calendar — please pick another.', 409);
    }
    if (!busyRes.ok) console.warn('[booking-confirm] calendar availability check inconclusive:', busyRes.error);
  } catch (e) {
    console.warn('[booking-confirm] calendar availability check threw:', String(e));
  }

  // ── Insert booking as a PENDING request ────────────────────────────────
  // No calendar event and no confirmation to the booker yet: the slot is only
  // requested. Mike approves it in booking-approve, and only then does the
  // cal_event get created and the confirmation + .ics go out. This is the
  // authorization gate — nothing is promised to the customer until Mike okays
  // the day and time.
  const { data: booking, error: bookErr } = await supa
    .from('bookings')
    .insert([{
      page_id,
      cal_event_id:   null,
      booker_name:    safeName,
      booker_email:   String(booker_email),
      booker_company: safeCompany,
      start_at:       startAt.toISOString(),
      end_at:         endAt.toISOString(),
      notes:          safeNotes,
      status:         'pending',
    }])
    .select('id')
    .single();

  if (bookErr || !booking) {
    console.error('[booking-confirm] booking insert error:', bookErr);
    return errorResponse('Failed to save booking', 500);
  }

  // ── Labels shared across the emails/notification ────────────────────────
  const dateLabel  = fmtLocalDate(startAt, tz);
  const startLabel = fmtLocalTime(startAt, tz);
  const timeLabel  = startLabel + ' – ' + fmtLocalTime(endAt, tz);
  const tzLbl      = tzLabel(tz);
  const hostName   = hostProfile?.name  || 'the team';
  const hostEmail  = hostProfile?.email || '';

  // Capability link Mike uses to approve/decline (unforgeable HMAC token).
  // This points at the SELF-CONTAINED booking-approve page (not the CRM app):
  // it renders its own Approve/Decline page, needs no login, and works from any
  // device including a phone. Clicking Approve there does everything server-side
  // — books the slot, writes the admin General Calendar (cal_events) row, creates
  // the event on the host's Google Calendar, and emails the customer. Keeping the
  // whole flow server-side sidesteps the CRM's login/cache fragility entirely.
  const supaUrl    = Deno.env.get('SUPABASE_URL');
  const siteUrl    = Deno.env.get('GL_SITE_URL') || 'https://goodliquidbevco.com';
  let reviewUrl = '';
  try {
    const token = await signBooking(booking.id);
    reviewUrl = `${siteUrl}/approve.html?b=${booking.id}&t=${token}`;
  } catch (e) {
    console.error('[booking-confirm] could not sign review token:', e);
  }

  // Escaped once, used by both templates below. The plain-text bodies keep
  // the unescaped values -- entities in a text/plain part render literally,
  // so escaping there would corrupt the message rather than protect anything.
  const eName    = escapeHtml(safeName);
  const eCompany = safeCompany ? escapeHtml(safeCompany) : null;
  const eNotes   = safeNotes   ? escapeHtml(safeNotes)   : null;
  const eEmail   = escapeHtml(booker_email);
  const eHost    = escapeHtml(hostName);
  const eApprove = escapeHtml(reviewUrl ? reviewUrl + '&action=approve' : '');
  const eDecline = escapeHtml(reviewUrl ? reviewUrl + '&action=decline' : '');

  // ── Email: booker "request received" (NO calendar invite yet) ───────────
  const bookerText = [
    `Hi ${safeName},`,
    '',
    'Thanks for requesting a tour with Good Liquid Bev Co!',
    '',
    `You asked for:`,
    `📅  ${dateLabel}`,
    `🕐  ${timeLabel} (${tzLbl})`,
    '',
    'We’re confirming availability on our end and will email you a confirmation',
    'with a calendar invite shortly — usually within one business day. Your time',
    'isn’t locked in until you hear back from us.',
    '',
    'Questions or a change of plans? Just reply to this email.',
    '',
    `— ${hostName}`,
    'Good Liquid Bev Co · Palmetto, FL',
    'Mike@GoodLiquid.com · (803) 493-5065',
  ].join('\n');

  const bookerHtml = `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#222">
  <div style="background:#0f1624;padding:24px 32px;border-radius:10px">
    <h2 style="color:#00e5c0;margin:0 0 6px">Tour request received ✓</h2>
    <p style="color:#c8d8f0;margin:0 0 24px">Hi ${eName} — thanks! We’ll confirm your time shortly.</p>
    <div style="background:#192337;border-radius:8px;padding:20px;margin-bottom:20px">
      <div style="margin-bottom:12px">
        <span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">Requested date</span><br>
        <span style="color:#fff;font-size:15px">${dateLabel}</span>
      </div>
      <div>
        <span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">Requested time</span><br>
        <span style="color:#fff;font-size:15px">${timeLabel}</span>
        <span style="color:#6b87ad;font-size:13px"> ${tzLbl}</span>
      </div>
    </div>
    <p style="color:#9aa7bd;font-size:13px;line-height:1.6">
      We’re confirming availability and will send a confirmation with a calendar
      invite shortly — usually within one business day. <strong style="color:#c8d8f0">Your
      time isn’t locked in until you hear back from us.</strong>
    </p>
    <p style="color:#9aa7bd;font-size:13px">Questions or a change of plans? Just reply to this email.</p>
    <hr style="border:none;border-top:1px solid #1f3059;margin:20px 0">
    <p style="color:#6b87ad;font-size:12px;margin:0">
      Good Liquid Bev Co · Palmetto, FL<br>
      Mike@GoodLiquid.com · (803) 493-5065
    </p>
  </div>
</div>`;

  await sendMail({
    to:      String(booker_email),
    subject: `Tour request received — ${dateLabel}`,
    text:    bookerText,
    html:    bookerHtml,
  });

  // ── Email: host approval request (Approve / Decline buttons) ────────────
  if (hostEmail && reviewUrl) {
    const approveUrl = reviewUrl + '&action=approve';
    const declineUrl = reviewUrl + '&action=decline';
    const hostText = [
      'New TOUR REQUEST awaiting your approval.',
      '',
      `📅  ${dateLabel}`,
      `🕐  ${timeLabel} (${tzLbl})`,
      '',
      `👤  Name: ${safeName}`,
      `📧  Email: ${booker_email}`,
      safeCompany ? `🏢  Company: ${safeCompany}` : null,
      safeNotes   ? `📝  Notes: ${safeNotes}`         : null,
      '',
      `Approve: ${approveUrl}`,
      `Decline: ${declineUrl}`,
      '',
      'Approving sends the customer their confirmation + calendar invite and books the slot.',
    ].filter(Boolean).join('\n');

    const hostHtml = `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#222">
  <div style="background:#0f1624;padding:24px 32px;border-radius:10px">
    <h2 style="color:#f5c842;margin:0 0 6px">Tour request — needs your OK</h2>
    <div style="background:#192337;border-radius:8px;padding:20px;margin:16px 0">
      <div style="margin-bottom:10px"><span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">When</span><br><span style="color:#fff;font-size:15px">${dateLabel} · ${timeLabel} ${tzLbl}</span></div>
      <div style="margin-bottom:10px"><span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">Who</span><br><span style="color:#fff;font-size:15px">${eName}${eCompany ? ' · ' + eCompany : ''}</span></div>
      <div><span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">Contact</span><br><span style="color:#fff;font-size:15px">${eEmail}</span></div>
      ${eNotes ? `<div style="margin-top:10px"><span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">Notes</span><br><span style="color:#c8d8f0;font-size:14px">${eNotes}</span></div>` : ''}
    </div>
    <div style="margin:22px 0">
      <a href="${eApprove}" style="display:inline-block;padding:12px 26px;background:#00c4a7;color:#0d1420;border-radius:8px;text-decoration:none;font-size:14px;font-weight:800;margin-right:10px">✓ Approve</a>
      <a href="${eDecline}" style="display:inline-block;padding:12px 26px;background:#2a1620;color:#ff8a78;border:1px solid #5a2630;border-radius:8px;text-decoration:none;font-size:14px;font-weight:700">✕ Decline</a>
    </div>
    <p style="color:#6b87ad;font-size:12px;margin:0">Approving emails the customer their confirmation + calendar invite and books the slot.</p>
  </div>
</div>`;

    await sendMail({
      to:      hostEmail,
      subject: `Approve tour? ${safeName} — ${dateLabel}`,
      text:    hostText,
      html:    hostHtml,
    });
  }

  // ── WhatsApp alert to Mike via notify-deal (with the review link) ───────
  const notifySecret = Deno.env.get('GL_NOTIFY_SECRET');
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (notifySecret && supaUrl && serviceKey) {
    fetch(`${supaUrl}/functions/v1/notify-deal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        event:  'tour_requested',
        secret: notifySecret,
        data: {
          name:       safeName,
          company:    safeCompany || '',
          email:      booker_email,
          date:       dateLabel,
          time:       startLabel,
          review_url: reviewUrl,
        },
      }),
    }).catch(() => {}); // fire-and-forget
  }

  return jsonResponse({ ok: true, booking_id: booking.id, pending: true });
});
