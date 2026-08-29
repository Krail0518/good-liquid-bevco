// estimate-deal-value — auto-assigns a first-run order value to a new lead.
//
// WHY
// Mike asked that every lead that comes in gets a deal value based on their
// request, so the pipeline is worth something the moment it lands (he can
// always correct it). This reads the request text a lead submitted, has the AI
// pull out the few numbers that drive price (roughly how many cases, can size,
// whether a formula has to be developed, add-ons), and then computes the value
// DETERMINISTICALLY from Good Liquid's real per-can pricing tiers — the model
// is never trusted to do the arithmetic. When the request is vague it estimates
// LOW (a pilot run), because an under-promise is easy to raise and a wild
// over-estimate pollutes forecasting.
//
// It only fills in a value when the deal doesn't already have one (> 0), so a
// value Mike typed by hand — or a prior estimate — is never clobbered.
//
// CALLERS
//   * DB trigger on deals INSERT (pg_net) — sends the shared gl_notify_secret in
//     the body, same pattern as notify-deal. Covers every path a lead can be
//     created (public quote form, manual add, etc.).
//   * A staff session (requireStaff) — for a future "re-estimate" button.
//
// AUTH: verify_jwt = false (config.toml); the body secret OR a staff JWT
// authorizes. Request: { deal_id: uuid, secret?: string }.
//
// SECRETS: ANTHROPIC_API_KEY (shared), GL_NOTIFY_SECRET / Vault gl_notify_secret.
//
// Deploy: supabase functions deploy estimate-deal-value

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';
import { requireStaff } from '../_shared/auth.ts';
import { vaultGet } from '../_shared/gmail-creds.ts';

const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';

// ── Good Liquid pricing (mirrors company_docs.capabilities_pricing) ─────────
// Per-can labor by first-run size, 12oz Std/Sleek. 16oz is +$0.10 at every tier.
function laborPerCan(cases: number, is16: boolean): number {
  const base =
    cases >= 5000 ? 0.28 :
    cases >= 2500 ? 0.31 :
    cases >= 1000 ? 0.35 :
    cases >= 501  ? 0.38 :
    cases >= 340  ? 0.43 : 0.48;
  return is16 ? base + 0.10 : base;
}
const CAN_COST  = 0.32;   // aluminum can, mid of $0.29–0.35
const PACKAGING = 0.055;  // trays + PakTechs, mid of $0.05–0.06
const CASE_CANS = 24;
const MIN_CASES = 200;    // MOQ
const RD_FEE    = 2500;   // new-formula R&D (3 iterations)
const TEST_BATCH = 500;   // trial run of an existing formula

interface Est {
  cases: number; canSize: string;
  needsRd: boolean; testBatch: boolean;
  flash: boolean; nitrogen: boolean;
  confidence: string;
}

function computeValue(e: Est): number {
  const cases = Math.max(MIN_CASES, Math.round(e.cases || MIN_CASES));
  const cans = cases * CASE_CANS;
  const is16 = e.canSize === '16oz';
  let perCan = laborPerCan(cases, is16) + CAN_COST + PACKAGING;
  if (e.flash)    perCan += 0.05;
  if (e.nitrogen) perCan += 0.03;
  let total = cans * perCan;
  if (e.needsRd)        total += RD_FEE;
  else if (e.testBatch) total += TEST_BATCH;
  // Round to the nearest $50 — this is an estimate, not an invoice.
  return Math.round(total / 50) * 50;
}

const SYS = `You price beverage co-packing leads for Good Liquid Bev Co. Given a lead's request, extract ONLY the facts that drive the FIRST production run's value and return strict JSON — no prose, no code fences.

Return exactly this shape:
{"cases": <int>, "can_size": "12oz"|"16oz", "needs_rd": <bool>, "test_batch": <bool>, "flash_pasteurization": <bool>, "nitrogen": <bool>, "confidence": "low"|"med"|"high"}

Rules:
- "cases" = the FIRST production run in cases (24 cans/case). If the lead gives an ANNUAL volume, a first run is a fraction of it — estimate a realistic first run, not the year. If unclear, estimate LOW (a pilot). Minimum 200.
- Be conservative: when the request is vague, prefer the smaller number and set confidence "low".
- "can_size": "16oz" only if they clearly say 16oz; otherwise "12oz".
- "needs_rd": true only if they need a NEW formula developed. "test_batch": true if they have an EXISTING formula to trial. Both false if unknown.
- "flash_pasteurization"/"nitrogen": true only if explicitly requested.
- Bottles: still estimate cases as if canned unless bottling is explicit; keep confidence "low".`;

function parseEst(text: string): Est | null {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < 0) return null;
  try {
    const o = JSON.parse(t.slice(a, b + 1));
    return {
      cases: Number(o.cases) || MIN_CASES,
      canSize: o.can_size === '16oz' ? '16oz' : '12oz',
      needsRd: !!o.needs_rd,
      testBatch: !!o.test_batch,
      flash: !!o.flash_pasteurization,
      nitrogen: !!o.nitrogen,
      confidence: ['low', 'med', 'high'].includes(o.confidence) ? o.confidence : 'low',
    };
  } catch { return null; }
}

async function aiEstimate(context: string): Promise<Est | null> {
  if (!ANTHROPIC_KEY) return null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        system: SYS,
        messages: [{ role: 'user', content: context }],
      }),
    });
    if (!r.ok) { console.error('[estimate] anthropic', r.status, await r.text().catch(() => '')); return null; }
    const data = await r.json().catch(() => ({}));
    return parseEst(data?.content?.[0]?.text || '');
  } catch (e) { console.error('[estimate] ai error', e); return null; }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return errorResponse('Invalid JSON', 400); }

  // Authorize: shared secret (DB trigger) OR staff JWT.
  const expected = (await vaultGet('gl_notify_secret')) || Deno.env.get('GL_NOTIFY_SECRET') || '';
  const secretOk = !!expected && body.secret === expected;
  if (!secretOk) {
    const auth = await requireStaff(req);
    if (!auth.ok) return errorResponse('Unauthorized', 401);
  }

  const dealId = String(body.deal_id || '').trim();
  if (!dealId) return errorResponse('deal_id required', 400);

  const supa = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: deal, error: dErr } = await supa
    .from('deals')
    .select('id, name, client_name, value, notes, product_type, volume, service, timeline')
    .eq('id', dealId).maybeSingle() as { data: any; error: any };
  if (dErr || !deal) return errorResponse('Deal not found', 404);

  // Never overwrite a value that's already set (manual entry or prior estimate).
  if (Number(deal.value) > 0) {
    return jsonResponse({ ok: true, skipped: 'value already set', value: Number(deal.value) });
  }

  const context = [
    deal.client_name ? `Company: ${deal.client_name}` : null,
    deal.product_type ? `Product type: ${deal.product_type}` : null,
    deal.service ? `Service requested: ${deal.service}` : null,
    deal.volume ? `Volume (as they described it): ${deal.volume}` : null,
    deal.timeline ? `Timeline: ${deal.timeline}` : null,
    deal.notes ? `\nTheir request / notes:\n${deal.notes}` : null,
  ].filter(Boolean).join('\n') || (deal.name || 'A new beverage lead, no details given.');

  const est = await aiEstimate(context)
    // Fall back to a conservative pilot run when the AI is unavailable/unparseable.
    || { cases: MIN_CASES, canSize: '12oz', needsRd: false, testBatch: false, flash: false, nitrogen: false, confidence: 'low' };

  const value = computeValue(est);

  const { data: upd, error: uErr } = await supa
    .from('deals')
    .update({ value })
    .eq('id', dealId)
    .or('value.is.null,value.eq.0')   // race guard: only if still unset
    .select('id');
  if (uErr) { console.error('[estimate] update failed', uErr); return errorResponse('Update failed', 500); }
  if (!upd || upd.length === 0) {
    return jsonResponse({ ok: true, skipped: 'value set by another writer', value });
  }

  console.log(`[estimate] deal ${dealId} → $${value} (cases=${est.cases} ${est.canSize} rd=${est.needsRd} conf=${est.confidence})`);
  return jsonResponse({ ok: true, value, estimate: est });
});
