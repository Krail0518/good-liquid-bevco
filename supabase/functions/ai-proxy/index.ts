// ai-proxy — server-side proxy for Anthropic API calls.
//
// Replaces direct browser → api.anthropic.com calls (which required
// the user's API key to live in localStorage). Now the key is a
// Supabase secret only available to this edge function.
//
// Request body (POST JSON):
//   {
//     systemPrompt: string         the system message
//     userPrompt:   string         the user turn
//     model?:       string         default 'claude-haiku-4-5-20251001'
//     maxTokens?:   number         default 1024
//   }
//
// Response:
//   { ok: true, text: string }      on success
//   { ok: false, error: string }    on failure
//
// Secrets required:
//   ANTHROPIC_API_KEY   — sk-ant-api03-...
//
// Deploy:
//   supabase functions deploy ai-proxy
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-api03-...

import { corsHeaders, jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';
import { requireStaff } from '../_shared/auth.ts';
import { checkRateLimit, rateLimitMessage, rateLimitOutageMessage } from '../_shared/rate-limit.ts';

const API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  // Authorize the caller: staff user JWT (or an internal service-role call).
  // A valid JWT alone is not enough — portal customers hold one too.
  const _auth = await requireStaff(req);
  if (!_auth.ok) return errorResponse(_auth.error || 'Forbidden', _auth.status);

  // Bound how often ONE account can spend money here. Authorization above says
  // who may call; this says how often. Keyed by user so one account cannot
  // exhaust everyone else's budget. What happens when the counter itself
  // is down is chosen per endpoint — see rate-limit.ts.
  const _rl = await checkRateLimit(
    'ai-proxy:' + (_auth.userId || 'role:' + (_auth.role || 'unknown')),
    60, 60,
    // Anthropic tokens are dollars, and nothing operational breaks if AI
    // pauses for a few minutes. No argument for spending unmetered money
    // while the meter is broken.
    { onOutage: 'closed' },
  );
  if (_rl.degraded) console.warn('[ai-proxy] rate limit check degraded:', _rl.degraded);
  if (!_rl.allowed) {
    return _rl.outage
      ? errorResponse(rateLimitOutageMessage('AI'), 503)
      : errorResponse(rateLimitMessage('AI'), 429);
  }

  if (!API_KEY) return errorResponse('ANTHROPIC_API_KEY not configured', 500);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return errorResponse('Invalid JSON body', 400); }

  const systemPrompt = String(payload.systemPrompt || '').trim();
  const model     = String(payload.model     || 'claude-haiku-4-5');
  const maxTokens = Math.max(1, Math.min(4096, Number(payload.maxTokens) || 1024));

  // Two input shapes:
  //   1) { userPrompt: 'text' }            — simple text turn (most callers)
  //   2) { messages: [{role, content}] }   — full message array (Vision, multi-turn)
  let messages: Array<{ role: string; content: unknown }>;
  if (Array.isArray(payload.messages) && payload.messages.length) {
    messages = payload.messages as Array<{ role: string; content: unknown }>;
  } else {
    const userPrompt = String(payload.userPrompt || '').trim();
    if (!userPrompt) return errorResponse('userPrompt or messages required', 400);
    messages = [{ role: 'user', content: userPrompt }];
  }

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages,
      system: systemPrompt || undefined,
    }),
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => '<no body>');
    console.error('[ai-proxy] Anthropic error:', r.status, errText);
    return errorResponse('Anthropic rejected: ' + errText, r.status);
  }
  const data = await r.json().catch(() => ({}));
  const text = data?.content?.[0]?.text || '';
  return jsonResponse({ ok: true, text });
});
