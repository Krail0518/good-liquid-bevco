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

// Creates the event and returns its Google event id, or null on any failure.
// Never throws: calendar sync is a nice-to-have on top of the booking, so a
// Google hiccup must not fail the approval (the DB row + booker email still go
// out). Failures are logged for diagnosis.
export async function createCalendarEvent(ev: CalEventInput): Promise<string | null> {
  let token: string;
  try {
    token = await getGmailAccessToken();
  } catch (e) {
    console.error('[google-calendar] no access token (is Gmail connected with the calendar scope?):', String(e));
    return null;
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
      // 403 with "insufficient" almost always means the calendar scope was
      // never granted — the mailbox is connected for mail only. Surface it
      // clearly so the fix ("reconnect Gmail") is obvious in the logs.
      console.error(`[google-calendar] insert failed ${r.status}: ${t}`);
      return null;
    }
    const j = await r.json();
    return (j?.id as string) || null;
  } catch (e) {
    console.error('[google-calendar] insert threw:', String(e));
    return null;
  }
}
