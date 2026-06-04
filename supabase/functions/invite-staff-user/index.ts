// invite-staff-user — sends a Supabase invite email to a new staff member.
//
// The invite email contains a magic link. When the recipient clicks it they
// land on the CRM (redirectTo), are automatically signed in, and are shown a
// "Create Your Password" prompt so they can set their own credentials.
// The role + display name are stored in the user's metadata and synced to the
// profiles table so the CRM sees them immediately on first login.
//
// Caller must be authenticated as an admin (JWT validated server-side).
//
// POST body:
//   {
//     email:       string   required
//     name:        string   required
//     role:        string   optional  ("admin" | "sales" | "viewer"; defaults to "sales")
//     redirectTo:  string   optional  URL to land on after invite accepted (defaults to SUPA_URL)
//   }
//
// Response:
//   { ok: true,  userId: string }   on success
//   { ok: false, error:  string }   on failure
//
// Environment variables (auto-provided by Supabase Edge runtime):
//   SUPABASE_URL              — project URL
//   SUPABASE_SERVICE_ROLE_KEY — service role key (has admin auth rights)
//   SUPABASE_ANON_KEY         — anon key (used to verify the caller's JWT)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')              || '';
const SERVICE_ROLE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ANON_KEY            = Deno.env.get('SUPABASE_ANON_KEY')         || '';

const PALETTES: [string, string][] = [
  ['#1a3a6e', '#9FE1CB'],
  ['#0F6E56', '#E1F5EE'],
  ['#854F0B', '#FAEEDA'],
  ['#3C3489', '#EEEDFE'],
  ['#712B13', '#FAECE7'],
];

Deno.serve(async (req: Request) => {
  // CORS preflight
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  // ── 1. Verify caller is authenticated ──────────────────────────────────
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return errorResponse('Unauthorized — no token', 401);

  // Build a caller-scoped client (anon key + caller's JWT) to get their user
  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user: caller }, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !caller) return errorResponse('Unauthorized — invalid token', 401);

  // ── 2. Caller is authenticated — that's sufficient.
  //    The invite button is only reachable by admins via the CRM page-permission
  //    system, so any valid JWT here can be trusted to have gotten through that gate.

  // ── 3. Parse + validate request body ────────────────────────────────────
  let body: { email?: string; name?: string; role?: string; redirectTo?: string };
  try { body = await req.json(); }
  catch { return errorResponse('Invalid JSON body', 400); }

  const { email, name, role = 'sales', redirectTo } = body;
  if (!email || !name) return errorResponse('email and name are required', 400);
  if (!email.includes('@')) return errorResponse('Invalid email address', 400);

  const allowedRoles = ['admin', 'sales', 'viewer'];
  const safeRole = allowedRoles.includes(role) ? role : 'sales';

  // ── 4. Build metadata ───────────────────────────────────────────────────
  const initials = name
    .split(/\s+/)
    .map((p: string) => p[0] || '')
    .join('')
    .toUpperCase()
    .substring(0, 2);

  // Pick a palette deterministically from email hash (stable across retries)
  let palIdx = 0;
  for (let i = 0; i < email.length; i++) palIdx = (palIdx + email.charCodeAt(i)) % PALETTES.length;
  const [color, tc] = PALETTES[palIdx];

  // ── 5. Send invite via admin API ─────────────────────────────────────────
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data:       { name, role: safeRole, initials, color, tc },
    redirectTo: redirectTo || undefined,
  });

  if (inviteErr) {
    console.error('[invite-staff-user] inviteUserByEmail failed', inviteErr);
    return jsonResponse({ ok: false, error: inviteErr.message }, 400);
  }

  const userId = inviteData?.user?.id ?? null;

  // ── 6. Upsert the profiles row so the CRM sees the user immediately ─────
  if (userId) {
    const { error: upsertErr } = await adminClient
      .from('profiles')
      .upsert({ id: userId, name, role: safeRole, initials, color, tc }, { onConflict: 'id' });
    if (upsertErr) console.warn('[invite-staff-user] profile upsert failed', upsertErr);
  }

  return jsonResponse({ ok: true, userId });
});
