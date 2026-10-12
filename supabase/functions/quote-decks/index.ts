// quote-decks — email the capabilities and pricing deck to a new website lead.
//
// CALLER
//   public.gl_dispatch_quote_decks(deal_id), via pg_net, from
//   submit_quote_request (the public website form) for every new or repeat
//   quote request; and gl_send_quote_decks for staff. Body:
//     { deal_id: uuid, secret: <Vault gl_notify_secret> }
//   The bearer is the publishable (anon) key, which only gets past the
//   gateway (verify_jwt = true, config.toml). The body secret is the
//   authorization: no secret, no email. A stranger cannot reach this with a
//   chosen deal id, because they do not have the secret.
//
// WHAT IT DOES
//   1. Loads the deal. Skips (200, sent:false, reason) when it is not a
//      website quote request, has no valid email, or already had the deck —
//      by deals.deck_sent_at OR by an earlier sales_deck email to the same
//      address in email_log. Once per prospect.
//   2. Picks the deck: sales_decks with auto_send AND active AND a PDF
//      uploaded. Refuses any deck labelled confidential or naming a client
//      (see _shared/sales-deck.mjs — lotus_nutra_pricing is another client's
//      confidential pricing and must never reach a prospect).
//   3. Claims the deal (update deck_sent_at where it is null, checked), so a
//      double-submit cannot send twice; downloads the PDF; sends through
//      gmail-send with the attachment; logs to email_log.
//   4. Any failure clears the claim and alerts Mike (notify-deal event
//      'deck_send_failed'). Never silent.
//
// RATE LIMITS (CLAUDE.md rule 7)
//   submit_quote_request already throttles 3/hour per email and 15 per 10
//   minutes site-wide, and each prospect gets the deck once. As a backstop
//   this function sends at most SEND_CAP_PER_HOUR decks an hour, counted by
//   gl_rate_limit_hit and FAILING CLOSED if the counter is unreachable.
//   Alerts about a missing deck or the cap are themselves limited (once a day
//   / once an hour) so a burst of leads cannot spam Mike.
//
// SECRETS: none of its own. Vault gl_notify_secret (or env GL_NOTIFY_SECRET
// while no Vault value exists, same order as notify-deal); service role (auto).
//
// Deploy: gh workflow run "Deploy Supabase"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { jsonResponse, handlePreflight } from '../_shared/cors.ts';
import { vaultGet } from '../_shared/gmail-creds.ts';
import { notifyDeal } from '../_shared/notify.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import {
  deckEmail, deckSendDecision, pickSendableDeck, validEmail,
  DECK_TEMPLATE, MAX_DECK_BYTES,
} from '../_shared/sales-deck.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BUCKET = 'sales-decks';
const SEND_CAP_PER_HOUR = 30;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const db = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function sameSecret(a: string, b: string): boolean {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

type Deal = {
  id: string; name: string | null; email: string | null; contact_name: string | null;
  client_name: string | null; deck_sent_at: string | null;
};

function skip(reason: string, extra: Record<string, unknown> = {}): Response {
  console.log('[quote-decks] skipped:', reason);
  return jsonResponse({ ok: true, sent: false, reason, ...extra });
}

// Alert Mike. `throttleKey` limits repeats of the same alert (once per window)
// so a run of leads hitting the same problem is one message, not thirty.
async function alertMike(deal: Deal | null, reason: string, throttle?: { key: string; seconds: number }): Promise<boolean> {
  if (throttle) {
    const rl = await checkRateLimit('quote-decks:alert:' + throttle.key, 1, throttle.seconds, { onOutage: 'allowance' });
    if (!rl.allowed) { console.error('[quote-decks] alert suppressed (already sent this window):', reason); return false; }
  }
  const r = await notifyDeal('quote-decks', 'deck_send_failed', {
    company: deal?.client_name || '',
    name: deal?.contact_name || '',
    email: deal?.email || '',
    reason,
  });
  if (!r.ok) console.error('[quote-decks] deck_send_failed alert did not arrive:', r.detail);
  return r.ok;
}

// Release a claim this run made, so a later request for the same prospect can
// try again. Matches on the exact claim timestamp so it can never clear a
// stamp another run wrote. Checked (rule 4): 0 rows is reported, not assumed.
async function releaseClaim(dealId: string, claimedAt: string): Promise<void> {
  const r = await db().from('deals').update({ deck_sent_at: null })
    .eq('id', dealId).eq('deck_sent_at', claimedAt).select('id');
  if (r.error || !r.data?.length) {
    console.error('[quote-decks] could not release the claim on', dealId, r.error?.message || 'no row matched');
  }
}

async function sendViaGmail(to: string, subject: string, text: string, html: string,
  pdf: Uint8Array, filename: string): Promise<{ ok: boolean; id?: string | null; reason?: string }> {
  let bin = '';
  for (let i = 0; i < pdf.length; i += 0x8000) bin += String.fromCharCode(...pdf.subarray(i, i + 0x8000));
  try {
    const r = await fetch(SUPABASE_URL + '/functions/v1/gmail-send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SERVICE_KEY, apikey: SERVICE_KEY },
      body: JSON.stringify({
        to, subject, text, html,
        attachments: [{ filename, contentBase64: btoa(bin), contentType: 'application/pdf' }],
      }),
      signal: AbortSignal.timeout(60000),
    });
    const j = await r.json().catch(() => ({})) as Record<string, unknown>;
    if (!r.ok || j.ok !== true) {
      return { ok: false, reason: 'gmail-send answered ' + r.status + (j.error ? ': ' + String(j.error).slice(0, 300) : '') };
    }
    return { ok: true, id: (j.id as string) || null };
  } catch (e) {
    return { ok: false, reason: 'gmail-send threw: ' + String(e).slice(0, 300) };
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse({ ok: false, error: 'Method not allowed' }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400); }

  // Authorization FIRST, before touching any data.
  const expected = (await vaultGet('gl_notify_secret')) || Deno.env.get('GL_NOTIFY_SECRET') || '';
  if (!sameSecret(String(body.secret || ''), expected)) {
    return jsonResponse({ ok: false, error: 'Unauthorized' }, 401);
  }

  const dealId = String(body.deal_id || '');
  if (!UUID_RE.test(dealId)) return jsonResponse({ ok: false, error: 'deal_id must be a uuid' }, 400);

  const sb = db();

  // 1. The deal, and whether this prospect already has the deck.
  const dr = await sb.from('deals')
    .select('id, name, email, contact_name, client_name, deck_sent_at')
    .eq('id', dealId).maybeSingle();
  if (dr.error) {
    console.error('[quote-decks] deal lookup failed', dr.error.message);
    await alertMike(null, 'could not read the deal (' + dr.error.message + ')', { key: 'deal-read', seconds: 3600 });
    return jsonResponse({ ok: false, sent: false, error: 'deal lookup failed' }, 500);
  }
  const deal = dr.data as Deal | null;
  const email = String(deal?.email || '').trim().toLowerCase();

  let sentToEmailAt: string | null = null;
  if (deal && validEmail(email)) {
    // eq, not ilike: '_' is common in addresses and is a wildcard to ilike.
    // This function always logs the address lowercased. Any status but
    // 'failed' counts: a webhook may later move 'sent' on to 'delivered'.
    const prior = await sb.from('email_log').select('sent_at')
      .eq('template_name', DECK_TEMPLATE).neq('status', 'failed').eq('to_email', email)
      .limit(1);
    if (prior.error) {
      // Cannot prove it was not sent before: do not risk a duplicate.
      console.error('[quote-decks] email_log lookup failed', prior.error.message);
      await alertMike(deal, 'could not check whether this address already had the deck (' + prior.error.message + ')', { key: 'log-read', seconds: 3600 });
      return jsonResponse({ ok: false, sent: false, error: 'email_log lookup failed' }, 500);
    }
    if (prior.data?.length) sentToEmailAt = prior.data[0].sent_at || 'unknown time';
  }
  const decision = deckSendDecision(deal, sentToEmailAt);
  if (!decision.send) return skip(decision.reason || 'not sendable');

  // 2. Which deck. Refuses confidential decks and decks that name a client.
  const [decksR, clientsR] = await Promise.all([
    sb.from('sales_decks').select('id, key, label, filename, storage_path, active, auto_send, sort_order, size_bytes')
      .eq('auto_send', true).eq('active', true),
    sb.from('clients').select('name'),
  ]);
  if (decksR.error || clientsR.error) {
    const why = (decksR.error || clientsR.error)!.message;
    console.error('[quote-decks] deck/client lookup failed', why);
    await alertMike(deal, 'could not read the sales decks (' + why + ')', { key: 'deck-read', seconds: 3600 });
    return jsonResponse({ ok: false, sent: false, error: 'deck lookup failed' }, 500);
  }
  const pick = pickSendableDeck(decksR.data || [], (clientsR.data || []).map((c: { name: string }) => c.name));
  for (const r of pick.refused) {
    console.error('[quote-decks] REFUSED deck', r.key, '—', r.reason);
    await alertMike(deal, 'the auto-send deck "' + r.label + '" was refused because ' + r.reason + '. Nothing was sent. Turn auto-send off for it in the CRM.', { key: 'refused:' + r.key, seconds: 3600 });
  }
  if (!pick.deck) {
    // No PDF uploaded yet (or nothing set to auto-send). Mike is told at most
    // once a day: until he uploads, every lead would otherwise repeat it.
    const reason = pick.missing ? 'no deck uploaded' : (pick.refused.length ? 'the auto-send deck was refused' : 'no deck is set to auto-send');
    if (!pick.refused.length) await alertMike(deal, reason + ' (this alert repeats at most once a day)', { key: 'no-deck', seconds: 86400 });
    return skip(reason);
  }
  const deck = pick.deck;

  // 3. Hourly backstop. Fails CLOSED: if the counter is down, no email.
  const rl = await checkRateLimit('quote-decks:send', SEND_CAP_PER_HOUR, 3600, { onOutage: 'closed' });
  if (!rl.allowed) {
    const reason = rl.outage
      ? 'the send counter is unavailable, so the deck was held back (' + (rl.degraded || 'outage') + ')'
      : 'more than ' + SEND_CAP_PER_HOUR + ' decks were sent in the last hour, so sending is paused';
    await alertMike(deal, reason, { key: rl.outage ? 'cap-outage' : 'cap', seconds: 3600 });
    return skip(rl.outage ? 'rate counter unavailable' : 'hourly cap reached');
  }

  // 4. Claim the deal before sending: one winner if two dispatches race.
  const claimedAt = new Date().toISOString();
  const claim = await sb.from('deals').update({ deck_sent_at: claimedAt })
    .eq('id', deal!.id).is('deck_sent_at', null).select('id');
  if (claim.error) {
    console.error('[quote-decks] claim failed', claim.error.message);
    await alertMike(deal, 'could not mark the deal before sending (' + claim.error.message + ')');
    return jsonResponse({ ok: false, sent: false, error: 'claim failed' }, 500);
  }
  if (!claim.data?.length) return skip('deck already being sent to this deal');

  const fail = async (reason: string, status = 502): Promise<Response> => {
    console.error('[quote-decks] NOT sent to', deal!.id, '—', reason);
    await releaseClaim(deal!.id, claimedAt);
    const alerted = await alertMike(deal, reason);
    return jsonResponse({ ok: false, sent: false, error: reason, alerted }, status);
  };

  // 5. The PDF.
  const dl = await sb.storage.from(BUCKET).download(String(deck.storage_path));
  if (dl.error || !dl.data) return fail('could not download the deck PDF (' + (dl.error?.message || 'empty') + ')');
  const pdf = new Uint8Array(await dl.data.arrayBuffer());
  if (!pdf.length) return fail('the uploaded deck PDF is empty');
  if (pdf.length > MAX_DECK_BYTES) return fail('the deck PDF is ' + Math.round(pdf.length / 1048576) + ' MB; Gmail cannot attach more than 15 MB. Upload a smaller PDF.');
  if (new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-') return fail('the uploaded deck is not a PDF file');

  // 6. Send.
  const msg = deckEmail(deal);
  const filename = String(deck.filename || 'Good Liquid Bev Co - Capabilities and Pricing.pdf').replace(/[\r\n"]/g, '').slice(0, 150);
  const sent = await sendViaGmail(email, msg.subject, msg.text, msg.html, pdf, filename);
  if (!sent.ok) return fail(sent.reason || 'gmail-send failed');

  // 7. Record it. The send already happened, so a logging failure is reported
  //    loudly but does not undo the claim (that would invite a second send).
  const log = await sb.from('email_log').insert([{
    to_email: email, subject: msg.subject, body_preview: msg.text.slice(0, 4000),
    template_name: DECK_TEMPLATE, client_id: null, direction: 'outbound', status: 'sent',
    mailgun_id: sent.id || null, sent_at: new Date().toISOString(),
  }]).select('id');
  const logged = !log.error && !!log.data?.length;
  if (!logged) console.error('[quote-decks] sent, but the email_log insert failed:', log.error?.message || 'no row returned');

  console.log('[quote-decks] sent', deck.key, 'to deal', deal!.id);
  return jsonResponse({ ok: true, sent: true, deck: deck.key, logged });
});
