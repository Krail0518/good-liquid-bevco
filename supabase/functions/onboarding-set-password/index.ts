// onboarding-set-password — lets a client set their portal password while
// completing the public onboarding form (onboard.html).
//
// WHY AN EDGE FUNCTION: creating/updating a Supabase Auth password requires
// the admin API (service-role) — it cannot be done from the anon page or from
// SQL safely. This function is public (verify_jwt = false in config.toml) but
// TOKEN-GATED: the caller must present the onboarding token, and the target
// email is read from that onboarding row server-side — never trusted from the
// request — so nobody can set a password on an address they don't hold a token
// for. Login is the email address (Supabase Auth has no separate username).
//
// POST { token: string, password: string }
//   → { ok: true, email, portal_url }   on success
//   → { ok: false, error }               otherwise
//
// Deploy: supabase functions deploy onboarding-set-password --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// Shared password policy: ≥8 chars, an uppercase letter, a number, and a
// special character. Returns a human message when the password fails, or ''
// when it passes. The onboarding page states the same rule and pre-checks it.
export function passwordProblem(pw: string): string {
  if (!pw || pw.length < 8)        return 'Password must be at least 8 characters long.';
  if (!/[A-Z]/.test(pw))           return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(pw))           return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(pw))    return 'Password must include a special character (e.g. ! ? @ #).';
  return '';
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  let body: { token?: string; password?: string };
  try { body = await req.json(); }
  catch { return errorResponse('Invalid JSON body', 400); }

  const token = String(body.token || '').trim();
  const password = String(body.password || '');
  if (token.length < 32) return jsonResponse({ ok: false, error: 'Invalid onboarding link.' }, 400);
  // Complexity is enforced HERE (server-side) as the real gate — the browser
  // check is only for instant feedback and can be bypassed.
  const pwErr = passwordProblem(password);
  if (pwErr) return jsonResponse({ ok: false, error: pwErr }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The token is the credential: derive the email + client from the onboarding
  // row, never from the request body.
  const { data: ob, error: obErr } = await admin
    .from('onboarding').select('client_id, contact_email, status').eq('token', token).maybeSingle();
  if (obErr)  { console.error('[onboarding-set-password] lookup', obErr); return jsonResponse({ ok: false, error: 'Could not verify your onboarding link.' }, 500); }
  if (!ob)    return jsonResponse({ ok: false, error: 'This onboarding link is not valid.' }, 400);
  const email = String(ob.contact_email || '').trim().toLowerCase();
  if (!email) return jsonResponse({ ok: false, error: 'No email is on file for this onboarding — contact us and we\'ll sort it out.' }, 400);

  // Create the auth user with the chosen password, or set it if they already
  // exist (idempotent — a retry or a pre-existing invite must still work).
  const redirectTo = new URL(req.url).origin;   // cosmetic; not used for password login
  let userId: string | null = null;
  const created = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { onboarded: true },
  });
  if (created.error) {
    const msg = (created.error.message || '').toLowerCase();
    if (msg.includes('already') || (created.error as { status?: number }).status === 422) {
      // Find the existing user and update their password.
      const listRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
        headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      const listJson = await listRes.json().catch(() => ({})) as { users?: { id: string; email: string }[] };
      const existing = (listJson.users || []).find(u => (u.email || '').toLowerCase() === email);
      if (!existing) { console.error('[onboarding-set-password] exists but not found'); return jsonResponse({ ok: false, error: 'Could not set up your login — please contact us.' }, 500); }
      const upd = await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
      if (upd.error) { console.error('[onboarding-set-password] update', upd.error); return jsonResponse({ ok: false, error: 'Could not set your password — please contact us.' }, 500); }
      userId = existing.id;
    } else {
      console.error('[onboarding-set-password] create', created.error);
      return jsonResponse({ ok: false, error: 'Could not set up your login — please contact us.' }, 500);
    }
  } else {
    userId = created.data.user?.id || null;
  }

  // Link the auth user to their client so the portal shows their data.
  // Done directly with the service-role client: the link_customer_user_by_email
  // RPC is gated on is_staff_user(), which is always false for service-role
  // calls (auth.uid() is null), so it returned { ok:false, error:'forbidden' }
  // as DATA — no .error — and clients ended up with no customer_users row and
  // a portal that rejected them after a successful password sign-in.
  if (ob.client_id && userId) {
    const existing = await admin.from('customer_users')
      .select('id').eq('auth_user_id', userId).maybeSingle();
    const link = existing.data
      ? await admin.from('customer_users')
          .update({ client_id: ob.client_id, email, active: true })
          .eq('id', existing.data.id)
      : await admin.from('customer_users')
          .insert({ auth_user_id: userId, client_id: ob.client_id, email, active: true, role: 'owner' });
    if (link.error) {
      console.error('[onboarding-set-password] portal link failed', link.error);
      return jsonResponse({ ok: false, error: 'Your password was saved, but we could not finish setting up portal access — please contact us and we\'ll sort it out.' }, 500);
    }
  }

  console.log('[onboarding-set-password] set for', email, 'user', userId);
  return jsonResponse({ ok: true, email, portal_url: redirectTo + '/?portal=1' });
});
