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

// ── Timezone-aware UTC conversion ──────────────────────────────────────────
function localToUTC(dateStr: string, timeStr: string, tz: string): Date {
  // Treat the local time string as if it were UTC to get a reference point
  const naiveUTC   = new Date(`${dateStr}T${timeStr}:00.000Z`);
  // Find what the target timezone shows at that reference UTC moment
  const fmt        = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const localStr   = fmt.format(naiveUTC);
  const localAsUTC = new Date(localStr.replace(' ', 'T') + '.000Z');
  // offsetMs = (reference UTC) - (what TZ shows at that UTC)
  // e.g. EDT: 09:00 UTC - 05:00 = +4 h  →  actual UTC = naiveUTC + offsetMs = 13:00 UTC ✓
  const offsetMs   = naiveUTC.getTime() - localAsUTC.getTime();
  return new Date(naiveUTC.getTime() + offsetMs);
}

function fmtLocalDate(d: Date, tz: string): string {
  return d.toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function fmtLocalTime(d: Date, tz: string): string {
  return d.toLocaleTimeString('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function tzLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value ?? tz;
  } catch { return tz; }
}

// ── ICS / iCalendar generator ──────────────────────────────────────────────
// Produces a VCALENDAR with METHOD:REQUEST so Gmail renders RSVP buttons.
function buildICS(opts: {
  uid:            string;
  summary:        string;
  description:    string;
  startAt:        Date;
  endAt:          Date;
  organizerName:  string;
  organizerEmail: string;
  attendeeName:   string;
  attendeeEmail:  string;
}): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const dt = (d: Date) =>
    `${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;

  // Escape special ICS characters
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;')
    .replace(/,/g, '\\,').replace(/\n/g, '\\n');

  // RFC 5545 §3.1: fold lines longer than 75 octets
  const fold = (line: string): string => {
    if (line.length <= 75) return line;
    const chunks: string[] = [];
    chunks.push(line.slice(0, 75));
    let i = 75;
    while (i < line.length) { chunks.push(' ' + line.slice(i, i + 74)); i += 74; }
    return chunks.join('\r\n');
  };

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Good Liquid Bev Co//Scheduling//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `DTSTART:${dt(opts.startAt)}`,
    `DTEND:${dt(opts.endAt)}`,
    `DTSTAMP:${dt(new Date())}`,
    `UID:${opts.uid}@goodliquidbevco.com`,
    `ORGANIZER;CN="${esc(opts.organizerName)}":mailto:${opts.organizerEmail}`,
    `ATTENDEE;CN="${esc(opts.attendeeName)}";RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${opts.attendeeEmail}`,
    `SUMMARY:${esc(opts.summary)}`,
    `DESCRIPTION:${esc(opts.description)}`,
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Meeting reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(fold).join('\r\n');
}

// ── Google Calendar quick-add URL ─────────────────────────────────────────
function googleCalURL(opts: {
  summary: string; description: string; startAt: Date; endAt: Date;
}): string {
  const p  = (n: number) => String(n).padStart(2, '0');
  const dt = (d: Date) =>
    `${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const q = encodeURIComponent;
  return 'https://www.google.com/calendar/render?action=TEMPLATE' +
    `&text=${q(opts.summary)}` +
    `&dates=${dt(opts.startAt)}/${dt(opts.endAt)}` +
    `&details=${q(opts.description.slice(0, 400))}`;
}

// ── Mailgun sender (with optional .ics attachment) ────────────────────────
async function sendMail(opts: {
  to:          string;
  subject:     string;
  text:        string;
  html?:       string;
  icsContent?: string;   // raw ICS text to attach
}): Promise<void> {
  const apiKey = Deno.env.get('MAILGUN_API_KEY');
  const domain = Deno.env.get('MAILGUN_DOMAIN');
  const from   = Deno.env.get('MAILGUN_FROM') || 'Good Liquid Bev Co <noreply@goodliquidbevco.com>';
  if (!apiKey || !domain) {
    console.error('[booking-confirm] Mailgun secrets not configured');
    return;
  }
  const form = new FormData();
  form.set('from', from);
  form.set('to', opts.to);
  form.set('subject', opts.subject);
  form.set('text', opts.text);
  if (opts.html) form.set('html', opts.html);

  // Attach .ics file — Gmail, Apple Mail, and Outlook all recognise this
  // and render an "Add to Calendar" / RSVP prompt.
  if (opts.icsContent) {
    const icsBlob = new Blob(
      [opts.icsContent],
      { type: 'text/calendar;charset=utf-8;method=REQUEST' },
    );
    form.append('attachment', icsBlob, 'invite.ics');
  }

  const r = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + btoa('api:' + apiKey) },
    body: form,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error('[booking-confirm] Mailgun error', r.status, t);
  }
}

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

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

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
  const { data: conflicts } = await supa
    .from('bookings')
    .select('id')
    .eq('page_id', page_id)
    .eq('status', 'confirmed')
    .lt('start_at', endAt.toISOString())
    .gt('end_at',   startAt.toISOString());

  if (conflicts && conflicts.length > 0) {
    return errorResponse('That slot is no longer available', 409);
  }

  // ── Insert cal_event ───────────────────────────────────────────────────
  const calNotes = [
    'Booked via scheduling link',
    `Name: ${booker_name}`,
    `Email: ${booker_email}`,
    booker_company ? `Company: ${booker_company}` : null,
    notes          ? `Notes: ${notes}`             : null,
  ].filter(Boolean).join('\n');

  const localStartStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(startAt);
  const [calDate, calTime] = localStartStr.split(' ');

  const { data: calEvent } = await supa
    .from('cal_events')
    .insert([{
      event_type: 'general',
      title:      `Meeting: ${booker_name}`,
      event_date: calDate,
      event_time: calTime,
      notes:      calNotes,
    }])
    .select('id')
    .single();

  // ── Insert booking ─────────────────────────────────────────────────────
  const { data: booking, error: bookErr } = await supa
    .from('bookings')
    .insert([{
      page_id,
      cal_event_id:   calEvent?.id ?? null,
      booker_name:    String(booker_name),
      booker_email:   String(booker_email),
      booker_company: booker_company ? String(booker_company) : null,
      start_at:       startAt.toISOString(),
      end_at:         endAt.toISOString(),
      notes:          notes ? String(notes) : null,
      status:         'confirmed',
    }])
    .select('id')
    .single();

  if (bookErr || !booking) {
    console.error('[booking-confirm] booking insert error:', bookErr);
    return errorResponse('Failed to save booking', 500);
  }

  // ── Build shared email content ─────────────────────────────────────────
  const dateLabel  = fmtLocalDate(startAt, tz);
  const startLabel = fmtLocalTime(startAt, tz);
  const timeLabel  = startLabel + ' – ' + fmtLocalTime(endAt, tz);
  const tzLbl      = tzLabel(tz);
  const hostName   = hostProfile?.name  || 'the team';
  const hostEmail  = hostProfile?.email || '';
  const summary    = `Meeting: ${booker_name} + Good Liquid Bev Co`;

  const icsDesc = [
    'Booked via Good Liquid Bev Co scheduling link.',
    `Name: ${booker_name}`,
    `Email: ${booker_email}`,
    booker_company ? `Company: ${booker_company}` : null,
    notes          ? `Notes: ${notes}`             : null,
  ].filter(Boolean).join('\n');

  // Build ICS — used by both emails
  const icsContent = buildICS({
    uid:            booking.id,
    summary,
    description:    icsDesc,
    startAt,
    endAt,
    organizerName:  hostName,
    organizerEmail: hostEmail || 'Mike@GoodLiquid.com',
    attendeeName:   String(booker_name),
    attendeeEmail:  String(booker_email),
  });

  // Google Calendar quick-add link (for the HTML email body)
  const gcalURL = googleCalURL({ summary, description: icsDesc, startAt, endAt });

  // ── Email: booker confirmation ─────────────────────────────────────────
  const bookerText = [
    `Hi ${booker_name},`,
    '',
    'Your meeting with Good Liquid Bev Co is confirmed!',
    '',
    `📅  ${dateLabel}`,
    `🕐  ${timeLabel} (${tzLbl})`,
    `⏱   ${duration} minutes`,
    `👤  With: ${hostName}, Good Liquid Bev Co`,
    '',
    'The attached invite.ics file adds this event to Google Calendar,',
    'Apple Calendar, or Outlook — just open it.',
    '',
    'Need to reschedule? Reply to this email and we\'ll get you sorted.',
    '',
    `— ${hostName}`,
    'Good Liquid Bev Co · Palmetto, FL',
    'Mike@GoodLiquid.com · (803) 493-5065',
  ].join('\n');

  const bookerHtml = `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#222">
  <div style="background:#0f1624;padding:24px 32px;border-radius:10px">
    <h2 style="color:#00e5c0;margin:0 0 6px">Meeting Confirmed ✓</h2>
    <p style="color:#c8d8f0;margin:0 0 24px">Hi ${booker_name}, you're all set!</p>
    <div style="background:#192337;border-radius:8px;padding:20px;margin-bottom:20px">
      <div style="margin-bottom:12px">
        <span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">Date</span><br>
        <span style="color:#fff;font-size:15px">${dateLabel}</span>
      </div>
      <div style="margin-bottom:12px">
        <span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">Time</span><br>
        <span style="color:#fff;font-size:15px">${timeLabel}</span>
        <span style="color:#6b87ad;font-size:13px"> ${tzLbl}</span>
      </div>
      <div style="margin-bottom:12px">
        <span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">Duration</span><br>
        <span style="color:#fff;font-size:15px">${duration} minutes</span>
      </div>
      <div>
        <span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">With</span><br>
        <span style="color:#fff;font-size:15px">${hostName} · Good Liquid Bev Co</span>
      </div>
    </div>

    <!-- Calendar buttons -->
    <div style="margin-bottom:20px">
      <p style="color:#9aa7bd;font-size:13px;margin:0 0 12px">
        📎 <strong style="color:#c8d8f0">invite.ics</strong> is attached — open it to add this event to
        Google Calendar, Apple Calendar, or Outlook.
      </p>
      <a href="${gcalURL}"
         style="display:inline-block;padding:10px 20px;background:#4285F4;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;margin-right:8px">
        📅 Add to Google Calendar
      </a>
    </div>

    <p style="color:#9aa7bd;font-size:13px">Need to reschedule? Reply to this email and we'll get you sorted.</p>
    <hr style="border:none;border-top:1px solid #1f3059;margin:20px 0">
    <p style="color:#6b87ad;font-size:12px;margin:0">
      Good Liquid Bev Co · Palmetto, FL<br>
      Mike@GoodLiquid.com · (803) 493-5065
    </p>
  </div>
</div>`;

  await sendMail({
    to:         String(booker_email),
    subject:    `Meeting confirmed: ${dateLabel} at ${startLabel}`,
    text:       bookerText,
    html:       bookerHtml,
    icsContent,
  });

  // ── Email: host notification ───────────────────────────────────────────
  if (hostEmail) {
    const hostText = [
      'New booking on your scheduling link!',
      '',
      `📅  ${dateLabel}`,
      `🕐  ${timeLabel} (${tzLbl})`,
      '',
      `👤  Name: ${booker_name}`,
      `📧  Email: ${booker_email}`,
      booker_company ? `🏢  Company: ${booker_company}` : null,
      notes          ? `📝  Notes: ${notes}`             : null,
      '',
      'The attached invite.ics adds this event to your calendar.',
    ].filter(Boolean).join('\n');

    await sendMail({
      to:         hostEmail,
      subject:    `New booking: ${booker_name} on ${dateLabel}`,
      text:       hostText,
      icsContent,
    });
  }

  // WhatsApp alert to Mike via notify-deal
  const notifySecret = Deno.env.get('GL_NOTIFY_SECRET');
  const supaUrl      = Deno.env.get('SUPABASE_URL');
  const serviceKey   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (notifySecret && supaUrl && serviceKey) {
    fetch(`${supaUrl}/functions/v1/notify-deal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        event:  'tour_booked',
        secret: notifySecret,
        data: {
          name:    booker_name,
          company: booker_company || '',
          email:   booker_email,
          date:    dateLabel,
          time:    startLabel,
        },
      }),
    }).catch(() => {}); // fire-and-forget
  }

  return jsonResponse({ ok: true, booking_id: booking.id });
});
