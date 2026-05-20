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

const API_KEY = Deno.env.get('ANTHROPIC_API_KEY') || '';

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  if (!API_KEY) return errorResponse('ANTHROPIC_API_KEY not configured', 500);

  let payload: Record<string, unknown>;
  try { payload = await req.json(); }
  catch { return errorResponse('Invalid JSON body', 400); }

  const systemPrompt = String(payload.systemPrompt || '').trim();
  const userPrompt   = String(payload.userPrompt   || '').trim();
  if (!userPrompt) return errorResponse('userPrompt required', 400);

  const model     = String(payload.model     || 'claude-haiku-4-5-20251001');
  const maxTokens = Math.max(1, Math.min(4096, Number(payload.maxTokens) || 1024));

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
      messages: [{ role: 'user', content: userPrompt }],
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
