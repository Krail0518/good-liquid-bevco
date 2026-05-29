// booking-confirm — validates a booking request, persists it, creates a
// calendar event, and sends confirmation emails to both the booker and
// the rep who owns the booking page.
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
// Converts "YYYY-MM-DD" + "HH:MM" in a named timezone to a UTC Date.
// Uses the Intl.DateTimeFormat trick that works in Deno's V8 runtime.
function localToUTC(dateStr: string, timeStr: string, tz: string): Date {
  // Step 1: interpret the input as UTC (naive)
  const naiveUTC = new Date(`${dateStr}T${timeStr}:00.000Z`);
  // Step 2: find out what local time that UTC instant maps to in `tz`
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const localStr = fmt.format(naiveUTC); // "YYYY-MM-DD HH:MM:SS"
  const localAsUTC = new Date(localStr.replace(' ', 'T') + '.000Z');
  // Step 3: delta = naiveUTC - localAsUTC = TZ offset in ms
  const offsetMs = naiveUTC.getTime() - localAsUTC.getTime();
  // Step 4: actual UTC = naiveUTC - offsetMs
  return new Date(naiveUTC.getTime() - offsetMs);
}

function fmtLocalDate(d: Date, tz: string): string {
  return d.toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

function fmtLocalTime(d: Date, tz: string): string {
  return d.toLocaleTimeString('en-US', {
    timeZone: tz,
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function tzLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value ?? tz;
  } catch { return tz; }
}

// ── Mailgun sender ─────────────────────────────────────────────────────────
async function sendMail(opts: {
  to: string; subject: string; text: string; html?: string;
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

  // Service-role client — bypasses RLS
  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Load booking page config ───────────────────────────────────────────
  const { data: page, error: pageErr } = await supa
    .from('booking_pages')
    .select('*, profiles:user_id(name, email)')
    .eq('id', page_id)
    .eq('is_active', true)
    .maybeSingle() as { data: any; error: any };

  if (pageErr || !page) return errorResponse('Booking page not found', 404);

  const tz        = page.timezone || 'America/New_York';
  const duration  = Number(page.duration)     || 30;
  const buffer    = Number(page.buffer_after) || 0;
  const availDays = (page.avail_days as number[]) || [1,2,3,4,5];

  // ── Convert slot to UTC timestamps ────────────────────────────────────
  let startAt: Date;
  try { startAt = localToUTC(slot_date, slot_time, tz); }
  catch (e) { return errorResponse('Invalid date/time: ' + String(e), 400); }

  const endAt = new Date(startAt.getTime() + duration * 60_000);

  // Reject past slots
  if (startAt.getTime() < Date.now() - 60_000) {
    return errorResponse('That slot is in the past', 400);
  }

  // Validate requested day-of-week is in avail_days
  const dow = new Date(slot_date + 'T12:00:00Z').getUTCDay(); // 0=Sun … 6=Sat (date-only, avoid timezone shift)
  if (!availDays.includes(dow)) {
    return errorResponse('That day is not available', 400);
  }

  // Validate slot fits within start/end time window
  const [sh, sm] = (page.start_time || '09:00').split(':').map(Number);
  const [eh, em] = (page.end_time   || '17:00').split(':').map(Number);
  const [rh, rm] = slot_time.split(':').map(Number);
  const slotMin  = rh * 60 + rm;
  const startMin = sh * 60 + sm;
  const endMin   = eh * 60 + em;
  if (slotMin < startMin || slotMin + duration > endMin) {
    return errorResponse('Slot is outside availability window', 400);
  }

  // ── Check for conflicts ────────────────────────────────────────────────
  // A conflict exists if any confirmed booking overlaps [startAt, endAt)
  // accounting for buffer: existing booking "occupies" until end + buffer.
  const windowStart = startAt.toISOString();
  const windowEnd   = endAt.toISOString();

  const { data: conflicts } = await supa
    .from('bookings')
    .select('id, start_at, end_at')
    .eq('page_id', page_id)
    .eq('status', 'confirmed')
    .lt('start_at', windowEnd)
    .gt('end_at',   windowStart);   // overlapping: start < my_end AND end > my_start

  if (conflicts && conflicts.length > 0) {
    return errorResponse('That slot is no longer available', 409);
  }

  // ── Insert cal_event ───────────────────────────────────────────────────
  const calTitle     = `Meeting: ${booker_name}`;
  const calNotes     = [
    `Booked via scheduling link`,
    `Name: ${booker_name}`,
    `Email: ${booker_email}`,
    booker_company ? `Company: ${booker_company}` : null,
    notes          ? `Notes: ${notes}`             : null,
  ].filter(Boolean).join('\n');

  // event_date and event_time are stored in the page's timezone
  const localStartStr = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(startAt); // "YYYY-MM-DD HH:MM"

  const [calDate, calTime] = localStartStr.split(' ');

  const { data: calEvent, error: calErr } = await supa
    .from('cal_events')
    .insert([{
      event_type: 'general',
      title:      calTitle,
      event_date: calDate,
      event_time: calTime,
      notes:      calNotes,
    }])
    .select('id')
    .single();

  if (calErr) {
    console.error('[booking-confirm] cal_events insert error:', calErr);
  }

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
    console.error('[booking-confirm] bookings insert error:', bookErr);
    return errorResponse('Failed to save booking', 500);
  }

  // ── Format times for emails ───────────────────────────────────────────
  const dateLabel = fmtLocalDate(startAt, tz);
  const timeLabel = fmtLocalTime(startAt, tz) + ' – ' + fmtLocalTime(endAt, tz);
  const tzLbl     = tzLabel(tz);
  const hostName  = (page.profiles as any)?.name || 'the team';
  const hostEmail = (page.profiles as any)?.email || '';

  // ── Email: booker confirmation ─────────────────────────────────────────
  const bookerText = [
    `Hi ${booker_name},`,
    ``,
    `Your meeting is confirmed!`,
    ``,
    `📅  ${dateLabel}`,
    `🕐  ${timeLabel} (${tzLbl})`,
    `⏱   ${duration} minutes`,
    `👤  With: ${hostName}, Good Liquid Bev Co`,
    ``,
    `We look forward to speaking with you. If you need to reschedule or`,
    `cancel, reply to this email and we will get you sorted.`,
    ``,
    `— ${hostName}`,
    `Good Liquid Bev Co · Palmetto, FL`,
    `Mike@GoodLiquid.com · (803) 493-5065`,
  ].join('\n');

  const bookerHtml = `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#222">
  <div style="background:#0f1624;padding:24px 32px;border-radius:10px">
    <img src="https://goodliquidbevco.com/logo.png" alt="Good Liquid Bev Co" style="height:40px;margin-bottom:20px" onerror="this.style.display='none'">
    <h2 style="color:#00e5c0;margin:0 0 6px">Meeting Confirmed ✓</h2>
    <p style="color:#c8d8f0;margin:0 0 24px">Hi ${booker_name}, you're all set!</p>
    <div style="background:#192337;border-radius:8px;padding:20px;margin-bottom:20px">
      <div style="margin-bottom:12px"><span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">Date</span><br><span style="color:#fff;font-size:15px">${dateLabel}</span></div>
      <div style="margin-bottom:12px"><span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">Time</span><br><span style="color:#fff;font-size:15px">${timeLabel}</span><span style="color:#6b87ad;font-size:13px"> ${tzLbl}</span></div>
      <div style="margin-bottom:12px"><span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">Duration</span><br><span style="color:#fff;font-size:15px">${duration} minutes</span></div>
      <div><span style="color:#6b87ad;font-size:12px;text-transform:uppercase;letter-spacing:1px">With</span><br><span style="color:#fff;font-size:15px">${hostName} · Good Liquid Bev Co</span></div>
    </div>
    <p style="color:#9aa7bd;font-size:13px">Need to reschedule? Reply to this email and we'll get you sorted.</p>
    <hr style="border:none;border-top:1px solid #1f3059;margin:20px 0">
    <p style="color:#6b87ad;font-size:12px;margin:0">Good Liquid Bev Co · Palmetto, FL<br>Mike@GoodLiquid.com · (803) 493-5065</p>
  </div>
</div>`;

  await sendMail({
    to:      String(booker_email),
    subject: `Meeting confirmed: ${dateLabel} at ${fmtLocalTime(startAt, tz)}`,
    text:    bookerText,
    html:    bookerHtml,
  });

  // ── Email: host notification ───────────────────────────────────────────
  if (hostEmail) {
    const hostText = [
      `New booking on your scheduling link!`,
      ``,
      `📅  ${dateLabel}`,
      `🕐  ${timeLabel} (${tzLbl})`,
      ``,
      `👤  Name: ${booker_name}`,
      `📧  Email: ${booker_email}`,
      booker_company ? `🏢  Company: ${booker_company}` : null,
      notes          ? `📝  Notes: ${notes}`             : null,
    ].filter(Boolean).join('\n');

    await sendMail({
      to:      hostEmail,
      subject: `New booking: ${booker_name} on ${dateLabel}`,
      text:    hostText,
    });
  }

  return jsonResponse({ ok: true, booking_id: booking.id });
});
