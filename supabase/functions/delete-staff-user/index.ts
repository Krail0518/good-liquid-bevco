// delete-staff-user — hard-deletes a staff account from Supabase Auth.
//
// When a user is removed from the CRM their auth.users row must be purged
// so their email can be re-invited later. This function requires the
// service-role key (auto-injected by the Supabase runtime) — the browser
// client (anon key) cannot admin-delete auth users.
//
// Caller must be authenticated as super-user.
//
// POST body:
//   { userId: string }   — the auth.users UUID to delete
//
// Response:
//   { ok: true }           on success
//   { ok: false, error }   on failure

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')              || '';
const SERVICE_ROLE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ANON_KEY            = Deno.env.get('SUPABASE_ANON_KEY')         || '';

Deno.serve(async (req: Request) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  // ── 1. Verify caller is authenticated ──────────────────────────────────
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return errorResponse('Unauthorized — no token', 401);

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user: caller }, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !caller) return errorResponse('Unauthorized — invalid token', 401);

  // ── 2. Verify caller is super-user ─────────────────────────────────────
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: callerProfile } = await adminClient
    .from('profiles').select('is_super_user').eq('id', caller.id).maybeSingle();
  if (!callerProfile?.is_super_user) {
    return errorResponse('Forbidden — super-user required', 403);
  }

  // ── 3. Parse body ───────────────────────────────────────────────────────
  let body: { userId?: string };
  try { body = await req.json(); }
  catch { return errorResponse('Invalid JSON body', 400); }

  const { userId } = body;
  if (!userId) return errorResponse('userId is required', 400);

  // Prevent deleting yourself
  if (userId === caller.id) return errorResponse('Cannot delete your own account', 400);

  // ── 4. Delete from auth.users ───────────────────────────────────────────
  const { error: delErr } = await adminClient.auth.admin.deleteUser(userId);
  if (delErr) {
    console.error('[delete-staff-user] deleteUser failed', delErr);
    return jsonResponse({ ok: false, error: delErr.message }, 400);
  }

  // ── 5. Hard-delete from profiles (auth is gone, row is orphaned) ────────
  await adminClient.from('profiles').delete().eq('id', userId);

  return jsonResponse({ ok: true });
});
