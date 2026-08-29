// lead-automations — the safety net that keeps leads from slipping.
//
// Runs hourly (pg_cron). Two jobs:
//
//  1) FIRST-RESPONSE SLA WATCHDOG. The site promises a reply within one business
//     day. For every open lead we have NOT yet replied to, once 24 business
//     hours have passed we escalate to Mike over WhatsApp — once per lead
//     (deals.sla_alerted_at), so it nags exactly hard enough.
//
//  2) AUTO FOLLOW-UP DRAFTS. For every open lead where the ball is on THEM
//     (we emailed last, no reply) past a threshold of quiet days, we have the AI
//     draft a short, tailored follow-up and drop it in the lead_followups queue
//     as 'ready'. Mike approves/sends it with one tap (see lead-action). If the
//     lead's last message was about scheduling, the draft offers the booking
//     link so they can self-schedule.
//
// Leads Mike has snoozed (deals.snoozed_until) or marked handled
// (deals.handled_at), and closed deals, are left alone by both jobs.
//
// AUTH: cron caller (x-cron-secret via isCronCall) or a staff JWT. Same headers
// pattern as gmail-sync, so no config.toml verify_jwt override is needed.
//
// SECRETS: ANTHROPIC_API_KEY, GL_NOTIFY_SECRET (Vault gl_notify_secret).
//
// Deploy: supabase functions deploy lead-automations

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';
import { requireStaff } from '../_shared/auth.ts';
import { isCronCall } from '../_shared/cron-auth.ts';
import { vaultGet } from '../_shared/gmail-creds.ts';
import { signBooking } from '../_shared/booking-token.ts';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';
const SITE = 'https://goodliquidbevco.com';
const FOLLOWUP_QUIET_DAYS = 4;   // ball on them this long → draft a nudge
const SLA_BUSINESS_HOURS  = 24;  // first reply owed within one business day

const FREE = new Set([
  'gmail.com','googlemail.com','yahoo.com','ymail.com','yahoo.co.uk','hotmail.com',
  'outlook.com','live.com','msn.com','aol.com','icloud.com','me.com','mac.com',
  'proton.me','protonmail.com','gmx.com','zoho.com','mail.com','comcast.net',
  'verizon.net','att.net','sbcglobal.net',
]);
const CLOSED = new Set(['Closed Won', 'Closed Lost']);

function addrsOf(v: string): string[] {
  return String(v || '').toLowerCase().split(/[,;]/).map((s) => s.trim()).filter((s) => s.includes('@'));
}
function domainOf(email: string): string {
  const d = String(email || '').toLowerCase().split('@')[1] || '';
  const c = d.replace(/^www\./, '').trim();
  return (c && c.indexOf('.') > 0 && !FREE.has(c)) ? c : '';
}
function companyToken(co: string): string {
  let t = String(co || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const sfx of ['llc','inc','corp','ltd','company','beverages','beverage','brands','brand','drinks','drink']) {
    if (t.length > sfx.length + 3 && t.endsWith(sfx)) t = t.slice(0, -sfx.length);
  }
  return t.length >= 6 ? t : '';
}

// Whole hours between two instants, counting Mon–Fri only (Mike works odd
// hours, so we count the whole weekday, not a 9–5 window — we just skip
// weekends, which is where "within one business day" actually bites).
function businessHoursBetween(start: Date, end: Date): number {
  if (end <= start) return 0;
  let hrs = 0;
  const cur = new Date(start.getTime());
  // Step hour by hour — cheap at these horizons and dead simple to reason about.
  while (cur < end) {
    const dow = cur.getUTCDay(); // 0 Sun .. 6 Sat
    if (dow !== 0 && dow !== 6) hrs++;
    cur.setUTCHours(cur.getUTCHours() + 1);
  }
  return hrs;
}

interface MailRow { to_email: string; from_email: string | null; direction: string | null; sent_at: string | null; created_at: string | null }

// For a lead, the last time they wrote to us and the last time we wrote to them,
// matching by any of the lead's addresses OR their company domain OR a
// distinctive company-name token — the same net the pipeline view uses.
function contactTimes(mail: MailRow[], emails: string[], co: string): { lastIn: number; lastOut: number; firstOut: number } {
  const doms = new Set(emails.map(domainOf).filter(Boolean));
  const tok = companyToken(co);
  let lastIn = 0, lastOut = 0, firstOut = 0;
  for (const m of mail) {
    const t = Date.parse(String(m.sent_at || m.created_at || '')) || 0;
    if (!t) continue;
    const inbound = m.direction === 'inbound';
    const other = String((inbound ? m.from_email : m.to_email) || '').toLowerCase();
    if (!other) continue;
    const oDom = domainOf(other);
    const match = emails.some((e) => other.includes(e))
      || (oDom && doms.has(oDom))
      || (tok && oDom && oDom.indexOf(tok) >= 0);
    if (!match) continue;
    if (inbound) { if (t > lastIn) lastIn = t; }
    else { if (t > lastOut) lastOut = t; if (!firstOut || t < firstOut) firstOut = t; }
  }
  return { lastIn, lastOut, firstOut };
}

async function draftFollowup(ctx: { name: string; co: string; product: string; lastInboundHint: string; days: number; bookingUrl: string }): Promise<{ subject: string; body: string } | null> {
  if (!ANTHROPIC_KEY) return null;
  const sys = `You write brief, warm follow-up emails for Good Liquid Bev Co, a beverage co-packer. The prospect went quiet after we last wrote. Write a SHORT nudge (3–5 sentences), friendly and low-pressure, that references their project and asks if they'd like to keep moving. Do NOT invent pricing or specifics. If — and only if — scheduling a call/tour would clearly help move it forward, include this booking link on its own line: ${ctx.bookingUrl}
Return STRICT JSON, no prose, no code fences: {"subject": "...", "body": "..."} — body is plain text with real newlines, signed "— Mike, Good Liquid Bev Co".`;
  const user = [
    `Prospect: ${ctx.name || '(unknown)'}${ctx.co ? ' at ' + ctx.co : ''}`,
    ctx.product ? `Interested in: ${ctx.product}` : '',
    `It has been about ${ctx.days} days since we last emailed them with no reply.`,
    ctx.lastInboundHint ? `Their last message to us mentioned: "${ctx.lastInboundHint.slice(0, 300)}"` : '',
  ].filter(Boolean).join('\n');
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 500, system: sys, messages: [{ role: 'user', content: user }] }),
    });
    if (!r.ok) { console.error('[lead-automations] anthropic', r.status, await r.text().catch(() => '')); return null; }
    const data = await r.json().catch(() => ({}));
    let txt = String(data?.content?.[0]?.text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
    if (a < 0 || b < 0) return null;
    const o = JSON.parse(txt.slice(a, b + 1));
    if (!o.body) return null;
    return { subject: String(o.subject || 'Following up').slice(0, 200), body: String(o.body).slice(0, 4000) };
  } catch (e) { console.error('[lead-automations] draft error', e); return null; }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  if (!(await isCronCall(req))) {
    const auth = await requireStaff(req);
    if (!auth.ok) return errorResponse(auth.error || 'Forbidden', auth.status);
  }

  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const now = new Date();
  const nowMs = now.getTime();

  // Active booking slug for the auto-offered link.
  let bookingUrl = `${SITE}/book.html`;
  try {
    const { data: bp } = await supa.from('booking_pages').select('slug').eq('is_active', true).order('created_at').limit(1).maybeSingle() as { data: any };
    if (bp?.slug) bookingUrl = `${SITE}/book.html?u=${bp.slug}`;
  } catch { /* default */ }

  // Open leads + recent mail (one pass, matched in memory).
  const { data: deals } = await supa.from('deals')
    .select('id, name, client_name, email, product_type, stage, created_at, first_response_at, sla_alerted_at, snoozed_until, handled_at')
    .not('stage', 'in', `(${[...CLOSED].map((s) => `"${s}"`).join(',')})`) as { data: any[] };
  const openDeals = (deals || []);

  const sinceIso = new Date(nowMs - 150 * 864e5).toISOString();
  const { data: mailData } = await supa.from('email_log')
    .select('to_email, from_email, direction, sent_at, created_at, body_preview')
    .gte('sent_at', sinceIso).limit(5000) as { data: any[] };
  const mail: MailRow[] = (mailData || []) as MailRow[];
  const bodyByKey = new Map<string, string>(); // latest inbound snippet per lead (for the draft hint)

  const slaOverdue: string[] = [];
  const firstResponseFixes: { id: string; at: string }[] = [];
  const followupCandidates: { deal: any; days: number; emails: string[]; hint: string }[] = [];

  // Existing ready follow-ups so we don't stack duplicates.
  const { data: existingF } = await supa.from('lead_followups').select('deal_id').eq('status', 'ready') as { data: any[] };
  const haveReady = new Set((existingF || []).map((r) => r.deal_id));

  for (const d of openDeals) {
    if (d.handled_at) continue;
    if (d.snoozed_until && Date.parse(d.snoozed_until) > nowMs) continue;
    const emails = addrsOf(d.email || '');
    if (!emails.length) continue;
    const { lastIn, lastOut, firstOut } = contactTimes(mail, emails, d.client_name || d.name || '');

    // Backfill first_response_at when we can see we already replied.
    if (firstOut && !d.first_response_at) firstResponseFixes.push({ id: d.id, at: new Date(firstOut).toISOString() });

    // (1) SLA: no reply from us yet, 24 business hours elapsed, not yet alerted.
    if (!firstOut && !d.sla_alerted_at && d.created_at) {
      const bh = businessHoursBetween(new Date(d.created_at), now);
      if (bh >= SLA_BUSINESS_HOURS) {
        const waited = Math.round((nowMs - Date.parse(d.created_at)) / 36e5);
        slaOverdue.push(`${d.client_name || d.name || 'Lead'} (${emails[0]}) — waiting ${waited}h`);
        firstResponseFixes.push({ id: '__sla__' + d.id, at: now.toISOString() }); // sentinel handled below
      }
    }

    // (2) Follow-up: ball on them, quiet past threshold, nothing queued yet.
    const ballOnThem = lastOut && (!lastIn || lastOut > lastIn);
    if (ballOnThem && !haveReady.has(d.id)) {
      const days = Math.floor((nowMs - lastOut) / 864e5);
      if (days >= FOLLOWUP_QUIET_DAYS) {
        // most recent inbound body as a hint
        let hint = '';
        let hintT = 0;
        for (const m of mail) {
          if (m.direction !== 'inbound') continue;
          const other = String(m.from_email || '').toLowerCase();
          if (!emails.some((e) => other.includes(e)) && !(domainOf(other) && emails.map(domainOf).includes(domainOf(other)))) continue;
          const t = Date.parse(String(m.sent_at || m.created_at || '')) || 0;
          if (t > hintT) { hintT = t; hint = String((m as any).body_preview || ''); }
        }
        followupCandidates.push({ deal: d, days, emails, hint });
      }
    }
  }

  // Apply first_response_at backfills + SLA stamps.
  for (const f of firstResponseFixes) {
    if (f.id.startsWith('__sla__')) {
      await supa.from('deals').update({ sla_alerted_at: f.at }).eq('id', f.id.slice(7));
    } else {
      await supa.from('deals').update({ first_response_at: f.at }).eq('id', f.id).is('first_response_at', null);
    }
  }

  // Generate follow-up drafts (cap per run so one cron tick can't fan out huge).
  let drafted = 0;
  for (const c of followupCandidates.slice(0, 20)) {
    const draft = await draftFollowup({
      name: c.deal.name || '', co: c.deal.client_name || '', product: c.deal.product_type || '',
      lastInboundHint: c.hint, days: c.days, bookingUrl,
    });
    if (!draft) continue;
    const ins = await supa.from('lead_followups').insert([{
      deal_id: c.deal.id,
      to_email: c.emails[0],
      to_name: c.deal.name || c.deal.client_name || '',
      subject: draft.subject,
      body: draft.body,
      reason: `No reply in ${c.days} days`,
      status: 'ready',
    }]).select('id');
    if (!ins.error) drafted++;
  }

  // Notify Mike (WhatsApp + email) via notify-deal.
  const notifySecret = (await vaultGet('gl_notify_secret')) || Deno.env.get('GL_NOTIFY_SECRET') || '';
  const supaUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  async function notify(event: string, data: Record<string, string>) {
    if (!notifySecret || !supaUrl || !serviceKey) return;
    try {
      await fetch(`${supaUrl}/functions/v1/notify-deal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${serviceKey}` },
        body: JSON.stringify({ event, secret: notifySecret, data }),
      });
    } catch { /* fire and forget */ }
  }

  if (slaOverdue.length) {
    await notify('lead_sla_overdue', { count: String(slaOverdue.length), summary: slaOverdue.slice(0, 8).join('\n') });
  }
  if (drafted > 0) {
    // One capability link to review + send all ready drafts from the phone.
    // Time-bound: the token signs a 7-day expiry so a leaked link isn't a
    // standing credential over all future follow-ups. A fresh link goes out
    // with each new batch of drafts.
    let reviewUrl = '';
    try {
      const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;
      const tok = await signBooking(`followups-review:${exp}`);
      reviewUrl = `${supaUrl}/functions/v1/lead-action?review=all&exp=${exp}&t=${tok}`;
    } catch { /* link optional */ }
    await notify('followups_ready', { count: String(drafted), review_url: reviewUrl });
  }

  return jsonResponse({ ok: true, sla_overdue: slaOverdue.length, followups_drafted: drafted, open_leads: openDeals.length });
});
