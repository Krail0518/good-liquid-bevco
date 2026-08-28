// booking-email — shared calendar + email helpers for the tour scheduling flow.
//
// Extracted from booking-confirm so booking-approve can reuse the exact same
// ICS invite, Google-Calendar link, timezone formatting, and Mailgun sender.
// The tour request lands in booking-confirm (status pending, no calendar hold);
// the confirmation email + .ics only go out once Mike approves in booking-approve.

// ── Timezone-aware UTC conversion ──────────────────────────────────────────
export function localToUTC(dateStr: string, timeStr: string, tz: string): Date {
  const naiveUTC = new Date(`${dateStr}T${timeStr}:00.000Z`);
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const localStr = fmt.format(naiveUTC);
  const localAsUTC = new Date(localStr.replace(' ', 'T') + '.000Z');
  const offsetMs = naiveUTC.getTime() - localAsUTC.getTime();
  return new Date(naiveUTC.getTime() + offsetMs);
}

export function fmtLocalDate(d: Date, tz: string): string {
  return d.toLocaleDateString('en-US', {
    timeZone: tz, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

export function fmtLocalTime(d: Date, tz: string): string {
  return d.toLocaleTimeString('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

export function tzLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date());
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
  } catch { return tz; }
}

// ── ICS / iCalendar generator (METHOD:REQUEST → Gmail RSVP buttons) ─────────
export function buildICS(opts: {
  uid: string; summary: string; description: string;
  startAt: Date; endAt: Date;
  organizerName: string; organizerEmail: string;
  attendeeName: string; attendeeEmail: string;
}): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const dt = (d: Date) =>
    `${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;')
    .replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const fold = (line: string): string => {
    if (line.length <= 75) return line;
    const chunks: string[] = [line.slice(0, 75)];
    let i = 75;
    while (i < line.length) { chunks.push(' ' + line.slice(i, i + 74)); i += 74; }
    return chunks.join('\r\n');
  };
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Good Liquid Bev Co//Scheduling//EN', 'CALSCALE:GREGORIAN', 'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `DTSTART:${dt(opts.startAt)}`, `DTEND:${dt(opts.endAt)}`, `DTSTAMP:${dt(new Date())}`,
    `UID:${opts.uid}@goodliquidbevco.com`,
    `ORGANIZER;CN="${esc(opts.organizerName)}":mailto:${opts.organizerEmail}`,
    `ATTENDEE;CN="${esc(opts.attendeeName)}";RSVP=TRUE;PARTSTAT=NEEDS-ACTION:mailto:${opts.attendeeEmail}`,
    `SUMMARY:${esc(opts.summary)}`, `DESCRIPTION:${esc(opts.description)}`,
    'STATUS:CONFIRMED', 'SEQUENCE:0',
    'BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Meeting reminder', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n');
}

// ── Google Calendar quick-add URL ─────────────────────────────────────────
export function googleCalURL(opts: {
  summary: string; description: string; startAt: Date; endAt: Date;
}): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const dt = (d: Date) =>
    `${d.getUTCFullYear()}${p(d.getUTCMonth()+1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  const q = encodeURIComponent;
  return 'https://www.google.com/calendar/render?action=TEMPLATE' +
    `&text=${q(opts.summary)}` +
    `&dates=${dt(opts.startAt)}/${dt(opts.endAt)}` +
    `&details=${q(opts.description.slice(0, 400))}`;
}

// ── Mailgun sender (optional .ics and/or file attachments) ────────────────
// Returns the outcome rather than only logging it: the booking flows ignore
// the result (a missed confirmation must not fail the booking), but quote-decks
// has to know whether the mail actually left before it writes an email_log row
// saying it did.
export interface MailAttachment {
  filename: string;
  bytes: Uint8Array;
  contentType?: string;
}
export interface MailResult { ok: boolean; id?: string; error?: string }

export async function sendMail(opts: {
  to: string; subject: string; text: string; html?: string; icsContent?: string;
  replyTo?: string; attachments?: MailAttachment[];
}): Promise<MailResult> {
  const apiKey = Deno.env.get('MAILGUN_API_KEY');
  const domain = Deno.env.get('MAILGUN_DOMAIN');
  const from = Deno.env.get('MAILGUN_FROM') || 'Good Liquid Bev Co <noreply@goodliquidbevco.com>';
  if (!apiKey || !domain) {
    console.error('[booking-email] Mailgun secrets not configured');
    return { ok: false, error: 'Mailgun secrets not configured' };
  }
  const form = new FormData();
  form.set('from', from);
  form.set('to', opts.to);
  form.set('subject', opts.subject);
  form.set('text', opts.text);
  if (opts.html) form.set('html', opts.html);
  if (opts.replyTo) form.set('h:Reply-To', opts.replyTo);
  if (opts.icsContent) {
    const icsBlob = new Blob([opts.icsContent], { type: 'text/calendar;charset=utf-8;method=REQUEST' });
    form.append('attachment', icsBlob, 'invite.ics');
  }
  for (const a of opts.attachments || []) {
    form.append(
      'attachment',
      new Blob([a.bytes], { type: a.contentType || 'application/octet-stream' }),
      a.filename,
    );
  }
  let r: Response;
  try {
    r = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + btoa('api:' + apiKey) },
      body: form,
    });
  } catch (e) {
    console.error('[booking-email] Mailgun request failed', e);
    return { ok: false, error: String((e as Error)?.message || e) };
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.error('[booking-email] Mailgun error', r.status, t);
    return { ok: false, error: `Mailgun ${r.status}: ${t}` };
  }
  const body = await r.json().catch(() => ({} as Record<string, unknown>));
  return { ok: true, id: String((body as { id?: string }).id || '') };
}
