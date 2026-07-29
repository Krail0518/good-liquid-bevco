// Shared caller-authorization helper for privileged Good Liquid edge functions.
//
// Several functions run with the service-role key (which bypasses RLS) or send
// email / SMS / money operations. They MUST verify the *caller* — not just that
// a request carries the public anon key. A logged-in portal customer holds a
// valid Supabase user JWT, so "has a valid JWT" is NOT authorization on its own.
//
// requireStaff() confirms the request carries a real user token, that the user
// is NOT a portal customer, and (optionally) that they are an admin/super-user.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')         || '';

export interface CallerCheck {
  ok: boolean;
  status: number;
  error?: string;
  userId?: string;
  role?: string;
  isSuper?: boolean;
}

/**
 * Verify the caller. opts.role: undefined/'staff' = any active staff user;
 * 'admin' = admin or super-user; 'super' = super-user only.
 * Returns { ok:false, status } (401/403) when the caller is not permitted.
 */
export async function requireStaff(
  req: Request,
  opts: { role?: 'staff' | 'admin' | 'super' } = {},
): Promise<CallerCheck> {
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  // Internal server-to-server calls (e.g. notify-deal → gmail-send) present the
  // service-role key as the bearer. Only trusted server code holds that secret,
  // so treat it as a fully-authorized internal caller.
  if (token && SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) {
    return { ok: true, status: 200, role: 'service', isSuper: true };
  }
  // Reject a missing token or the bare anon/publishable key (not a user login).
  if (!token || token === ANON_KEY) {
    return { ok: false, status: 401, error: 'Unauthorized — sign in required' };
  }

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user }, error } = await callerClient.auth.getUser();
  if (error || !user) return { ok: false, status: 401, error: 'Unauthorized — invalid token' };

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Staff profile FIRST. An active staff profile wins even when the same auth
  // user also appears in customer_users: testing the portal invite flow on
  // your own address links your account as a "customer", and checking
  // customer_users first locked the owner's own admin panel with
  // "Forbidden — staff only". A genuine portal customer has no profiles row,
  // so the portal-must-never-reach-staff-functions guarantee still holds.
  const { data: profile } = await admin
    .from('profiles').select('role, is_super_user, status').eq('id', user.id).maybeSingle();

  if (!profile || profile.status === 'inactive') {
    // No usable staff profile — distinguish a portal customer (clearer error)
    // from a token that matches nothing at all.
    const { data: cust } = await admin
      .from('customer_users').select('id').eq('auth_user_id', user.id).eq('active', true).maybeSingle();
    if (cust) return { ok: false, status: 403, error: 'Forbidden — staff only' };
    return { ok: false, status: 403, error: 'Forbidden — inactive or unknown account' };
  }

  const isSuper = !!profile.is_super_user;
  const role = profile.role || 'sales';
  if (opts.role === 'super' && !isSuper) {
    return { ok: false, status: 403, error: 'Forbidden — super-user required' };
  }
  if (opts.role === 'admin' && !(isSuper || role === 'admin')) {
    return { ok: false, status: 403, error: 'Forbidden — admin required' };
  }

  return { ok: true, status: 200, userId: user.id, role, isSuper };
}
