// booking-availability — public endpoint the tour booking widgets call when a
// visitor picks a date. Returns, for each time slot that day, whether it can be
// requested — combining (a) existing pending/confirmed bookings and (b) Mike's
// connected Google Calendar free/busy. Slots he's already busy on come back
// available:false, so a visitor can't even request a time that conflicts.
//
// This is the "before they request a time" half of the availability guard;
// booking-confirm re-checks the calendar server-side so nothing slips through
// even if a stale page is used.
//
// Request (POST JSON): { page_id: string(uuid), date: "YYYY-MM-DD" }
// Response: { ok:true, slots: [{ time:"HH:MM", available:boolean }], calendarChecked:boolean }
//
// Deploy: supabase functions deploy booking-availability --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';
import { localToUTC } from '../_shared/booking-email.ts';
import { getBusyIntervals } from '../_shared/google-calendar.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return errorResponse('Invalid JSON body', 400); }
  const page_id = body.page_id as string | undefined;
  const date    = body.date as string | undefined;
  if (!page_id) return errorResponse('page_id required', 400);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return errorResponse('date must be YYYY-MM-DD', 400);

  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: page } = await supa.from('booking_pages').select('*').eq('id', page_id).eq('is_active', true).maybeSingle() as { data: any };
  if (!page) return errorResponse('Booking page not found', 404);

  const tz       = page.timezone || 'America/New_York';
  const duration = Number(page.duration) || 30;
  const availDays = (page.avail_days as number[]) || [1,2,3,4,5];

  // Build candidate slots the same way the widgets do (step = max(duration,60)).
  const [sh, sm] = String(page.start_time || '10:00').split(':').map(Number);
  const [eh, em] = String(page.end_time   || '14:00').split(':').map(Number);
  const startMin = sh*60 + sm, endMin = eh*60 + em, step = Math.max(duration, 60);
  const times: string[] = [];
  for (let mm = startMin; mm + duration <= endMin; mm += step) {
    times.push(String(Math.floor(mm/60)).padStart(2,'0') + ':' + String(mm%60).padStart(2,'0'));
  }

  const dow = new Date(date + 'T12:00:00Z').getUTCDay();
  const dayAllowed = availDays.includes(dow);

  // Absolute start/end for each slot.
  const slotBounds = times.map(t => {
    try {
      const s = localToUTC(date, t, tz);
      return { time: t, start: s, end: new Date(s.getTime() + duration*60_000) };
    } catch { return { time: t, start: null as Date | null, end: null as Date | null }; }
  });

  // Existing pending/confirmed bookings that overlap this day.
  const dayStartUTC = slotBounds.find(s => s.start)?.start || new Date(date + 'T00:00:00Z');
  const dayEndUTC   = [...slotBounds].reverse().find(s => s.end)?.end || new Date(date + 'T23:59:59Z');
  const { data: booked } = await supa.from('bookings').select('start_at,end_at')
    .eq('page_id', page_id).in('status', ['confirmed','pending'])
    .lt('start_at', dayEndUTC.toISOString()).gt('end_at', dayStartUTC.toISOString()) as { data: any[] };
  const bookedIv = (booked || []).map(b => ({ start: new Date(b.start_at).getTime(), end: new Date(b.end_at).getTime() }));

  // Google Calendar busy intervals for the day (one call). Inconclusive → we
  // simply don't grey anything from the calendar (booking-confirm still guards).
  let calChecked = false;
  let calIv: Array<{ start: number; end: number }> = [];
  const fb = await getBusyIntervals(dayStartUTC.toISOString(), dayEndUTC.toISOString(), tz);
  if (fb.ok) {
    calChecked = true;
    calIv = (fb.intervals || []).map(i => ({ start: new Date(i.start).getTime(), end: new Date(i.end).getTime() }));
  }

  const now = Date.now();
  const overlaps = (s: number, e: number, list: Array<{start:number;end:number}>) =>
    list.some(iv => s < iv.end && e > iv.start);

  const slots = slotBounds.map(sb => {
    let available = dayAllowed && !!sb.start && !!sb.end;
    if (available && sb.start && sb.end) {
      const s = sb.start.getTime(), e = sb.end.getTime();
      if (s < now + 24*60*60*1000) available = false;               // 24h advance notice
      else if (overlaps(s, e, bookedIv)) available = false;         // already requested/booked
      else if (overlaps(s, e, calIv))    available = false;         // busy on Mike's calendar
    }
    return { time: sb.time, available };
  });

  return jsonResponse({ ok: true, slots, calendarChecked: calChecked });
});
