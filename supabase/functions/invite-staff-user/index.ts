// invite-staff-user — sends a Supabase invite email to a new staff member.
//
// The invite email contains a magic link. When the recipient clicks it they
// land on the CRM (redirectTo), are automatically signed in, and are shown a
// "Create Your Password" prompt so they can set their own credentials.
//
// GL-125: that link dies after the project's Email OTP expiry window, which is
// an Auth setting (Dashboard → Authentication → Email → Email OTP Expiration),
// NOT anything this function controls. It has been at most 1 hour, so an invite
// sent in the evening is already dead by morning — on 2026-09-21 a new salesper-
// son opened theirs 3h25m after it was sent, got "email link has expired", and
// the site showed a blank marketing page. The landing page now surfaces
// that failure and offers a fresh link (src/shared/admin-tools.js). If invites
// are still going stale, check the expiry setting before reading this code.
//
// Re-inviting someone who never accepted works: Supabase re-sends the invite
// for an existing UNCONFIRMED user and only refuses once they are confirmed.
// The "Email reset" button on their row in Users & Permissions also works, and
// verifying a recovery link confirms the address on the way through.
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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { corsHeaders, jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';
import { requireStaff } from '../_shared/auth.ts';

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

  // ── 1+2. Verify the caller is an ADMIN (server-side). A valid JWT alone is
  //    NOT enough — a portal customer or a non-admin staffer holds one too and
  //    could otherwise POST { role:'admin' } to grant themselves admin.
  const auth = await requireStaff(req, { role: 'admin' });
  if (!auth.ok) return errorResponse(auth.error || 'Forbidden', auth.status);

  // ── 3. Parse + validate request body ────────────────────────────────────
  let body: { email?: string; name?: string; role?: string; redirectTo?: string };
  try { body = await req.json(); }
  catch { return errorResponse('Invalid JSON body', 400); }

  const { email, name, role = 'sales', redirectTo } = body;
  if (!email || !name) return errorResponse('email and name are required', 400);
  if (!email.includes('@')) return errorResponse('Invalid email address', 400);

  // GL-116: 'warehouse' was missing, so inviting a Warehouse user silently
  // created a SALES user. An unknown role is now refused, not quietly swapped;
  // the list matches profiles_role_check.
  const allowedRoles = ['admin', 'sales', 'viewer', 'warehouse'];
  if (!allowedRoles.includes(role)) {
    return errorResponse(`Unknown role "${role}". Choose admin, sales, warehouse or viewer.`, 400);
  }
  const safeRole = role;

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

  let inviteData: Awaited<ReturnType<typeof adminClient.auth.admin.inviteUserByEmail>>['data'] = null;
  let inviteErr:  Awaited<ReturnType<typeof adminClient.auth.admin.inviteUserByEmail>>['error'] = null;

  ({ data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
    data:       { name, role: safeRole, initials, color, tc },
    redirectTo: redirectTo || undefined,
  }));

  // ── If "already registered", check if the profile is inactive (removed user).
  //    If so: hard-delete the stale auth record and retry the invite so that
  //    re-inviting a previously removed user works without manual SQL cleanup.
  if (inviteErr) {
    const msg = inviteErr.message?.toLowerCase() ?? '';
    if (msg.includes('already registered') || msg.includes('already been registered') || (inviteErr as { status?: number }).status === 422) {
      // Find the existing auth user by email via the admin REST list endpoint
      const listRes  = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=1000`, {
        headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      });
      const listJson = await listRes.json() as { users?: { id: string; email: string }[] };
      const existing = (listJson.users ?? []).find(u => u.email === email);

      if (existing) {
        // Check profile status — only auto-purge if they were deactivated/removed from CRM
        const { data: profile } = await adminClient
          .from('profiles').select('status').eq('id', existing.id).maybeSingle();
        const isRemoved = !profile || profile.status === 'inactive';

        if (!isRemoved) {
          return jsonResponse({ ok: false, error: `${email} already has an active account. Deactivate them in Users & Permissions first.` }, 409);
        }

        // Safe to purge and re-invite
        const { error: delErr } = await adminClient.auth.admin.deleteUser(existing.id);
        if (delErr) {
          console.error('[invite-staff-user] deleteUser failed', delErr);
          return jsonResponse({ ok: false, error: 'Could not clear the old auth record: ' + delErr.message }, 400);
        }

        // Retry invite on clean slate
        ({ data: inviteData, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
          data:       { name, role: safeRole, initials, color, tc },
          redirectTo: redirectTo || undefined,
        }));
      }
    }

    if (inviteErr) {
      console.error('[invite-staff-user] inviteUserByEmail failed', inviteErr);
      return jsonResponse({ ok: false, error: inviteErr.message }, 400);
    }
  }

  const userId = inviteData?.user?.id ?? null;

  // ── 6. Create the profiles row so the CRM sees the user immediately ─────
  // GL-116: this upsert omitted `email`, which profiles requires (NOT NULL), so
  // it failed on EVERY invite — and the failure was only logged, so the admin
  // was told "Invite sent" while the user never appeared in Users & Permissions
  // and could not reach the CRM. The result is now checked, and a failure rolls
  // back the half-created login instead of leaving an orphan behind.
  if (!userId) {
    return jsonResponse({ ok: false, error: 'The invite did not return a user. Nothing was created.' }, 500);
  }
  const { data: prof, error: upsertErr } = await adminClient
    .from('profiles')
    .upsert({ id: userId, email, name, role: safeRole, status: 'active', initials, color, tc }, { onConflict: 'id' })
    .select('id, role');
  if (upsertErr || !prof || !prof.length || prof[0].role !== safeRole) {
    console.error('[invite-staff-user] profile save failed; rolling back the auth user', upsertErr);
    const { error: rbErr } = await adminClient.auth.admin.deleteUser(userId);
    if (rbErr) console.error('[invite-staff-user] rollback deleteUser failed', rbErr);
    return jsonResponse({
      ok: false,
      error: 'The account could not be set up (' + (upsertErr?.message || 'profile not saved') + '). Nothing was created — try again.',
    }, 500);
  }

  return jsonResponse({ ok: true, userId, role: safeRole });
});
