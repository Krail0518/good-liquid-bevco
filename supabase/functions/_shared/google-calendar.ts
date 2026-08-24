// google-calendar.ts — create an event on the CRM's connected Google Calendar.
//
// The CRM already holds a Google OAuth credential set (see gmail-creds.ts),
// minted by the in-app "Connect Gmail" flow and connected to the mailbox the
// business sends from (Mike@GoodLiquid.com). Once the calendar scope is granted
// on that same consent (gmail-oauth SCOPES now include calendar.events), the
// very same access token can write to that account's calendar — so a confirmed
// tour lands on the calendar Mike actually watches, automatically.
//
// Target: `primary` = the connected account's own primary calendar. We do NOT
// hardcode an address, so whichever mailbox is connected is the one written to.
//
// The booker is deliberately NOT added as an attendee here: booking-approve
// already emails them their confirmation + .ics invite, and adding them as a
// Google attendee too would send a second, duplicate invite. This event is for
// the host's calendar; sendUpdates=none keeps Google from emailing anyone.

import { getGmailAccessToken } from './gmail-creds.ts';

export interface CalEventInput {
  summary: string;
  description: string;
  startISO: string;   // absolute instant, e.g. booking.start_at (UTC 'Z')
  endISO: string;     // absolute instant, e.g. booking.end_at
  timeZone: string;   // IANA tz for display, e.g. 'America/New_York'
  location?: string;
}

export interface CalResult {
  ok: boolean;
  id?: string;
  htmlLink?: string;   // link to the created event (reveals WHICH calendar/account it landed on)
  calendar?: string;   // organizer/calendar email Google reports the event on
  status?: number;     // HTTP status on failure
  error?: string;      // raw Google error body / message on failure
}

export interface BusyResult {
  ok: boolean;
  busy?: boolean;                              // true if the window overlaps an event
  intervals?: Array<{ start: string; end: string }>;  // raw busy blocks (freeBusy)
  status?: number;
  error?: string;
}

// Busy-interval lookup on the connected account's primary calendar for the
// window [timeMinISO, timeMaxISO). Returns the busy blocks that overlap it.
//
// We deliberately use events.list, NOT freeBusy: the connected grant only holds
// the `calendar.events` scope (enough to read/write events), and Google's
// freeBusy.query requires the broader `calendar`/`calendar.readonly` scope — so
// freeBusy 403s on this token and the availability check would silently fail
// open. events.list IS authorized by `calendar.events`, needs no re-consent,
// and singleEvents=true expands recurrences so overlaps are exact.
//
// Never throws; ok:false means the check itself couldn't run (no token / API
// error) so the caller decides how to treat an inconclusive result.
export async function getBusyIntervals(timeMinISO: string, timeMaxISO: string, timeZone: string): Promise<BusyResult> {
  let token: string;
  try { token = await getGmailAccessToken(); }
  catch (e) { console.error('[google-calendar] busy lookup no token:', String(e)); return { ok: false, error: 'no access token: ' + String(e) }; }
  try {
    const url = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
      + '?timeMin=' + encodeURIComponent(timeMinISO)
      + '&timeMax=' + encodeURIComponent(timeMaxISO)
      + '&singleEvents=true&orderBy=startTime&maxResults=2500'
      + '&timeZone=' + encodeURIComponent(timeZone);
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error(`[google-calendar] events.list failed ${r.status}: ${t}`);
      return { ok: false, status: r.status, error: t };
    }
    const j = await r.json();
    const items = Array.isArray(j?.items) ? j.items : [];
    const intervals: Array<{ start: string; end: string }> = [];
    for (const ev of items) {
      // Skip cancelled instances and events the host marked "free" (transparent)
      // — those don't block the slot. Timed events (start.dateTime) are the ones
      // that represent a real conflict; all-day (date-only) events are skipped so
      // birthdays/reminders don't wipe out a whole day of tour slots.
      if (ev.status === 'cancelled') continue;
      if (ev.transparency === 'transparent') continue;
      const s = ev?.start?.dateTime;
      const e = ev?.end?.dateTime;
      if (!s || !e) continue;
      intervals.push({ start: s, end: e });
    }
    return { ok: true, intervals, busy: intervals.length > 0 };
  } catch (e) {
    console.error('[google-calendar] busy lookup threw:', String(e));
    return { ok: false, error: String(e) };
  }
}

// Is the host busy on their Google Calendar for exactly this slot?
export async function checkBusy(startISO: string, endISO: string, timeZone: string): Promise<BusyResult> {
  return await getBusyIntervals(startISO, endISO, timeZone);
}

// Creates the event and returns a rich result. Never throws: calendar sync is a
// nice-to-have on top of the booking, so a Google hiccup must not fail the
// approval (the DB row + booker email still go out).
export async function createCalendarEvent(ev: CalEventInput): Promise<CalResult> {
  let token: string;
  try {
    token = await getGmailAccessToken();
  } catch (e) {
    console.error('[google-calendar] no access token:', String(e));
    return { ok: false, error: 'no access token: ' + String(e) };
  }

  const body: Record<string, unknown> = {
    summary: ev.summary,
    description: ev.description,
    start: { dateTime: ev.startISO, timeZone: ev.timeZone },
    end:   { dateTime: ev.endISO,   timeZone: ev.timeZone },
  };
  if (ev.location) body.location = ev.location;

  try {
    const r = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error(`[google-calendar] insert failed ${r.status}: ${t}`);
      return { ok: false, status: r.status, error: t };
    }
    const j = await r.json();
    return {
      ok: true,
      id: (j?.id as string) || undefined,
      htmlLink: (j?.htmlLink as string) || undefined,
      calendar: (j?.organizer?.email as string) || undefined,
    };
  } catch (e) {
    console.error('[google-calendar] insert threw:', String(e));
    return { ok: false, error: String(e) };
  }
}
