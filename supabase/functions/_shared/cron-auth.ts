// Shared "is this the scheduled caller?" check for cron-invoked functions.
//
// WHY VAULT AND NOT AN ENV SECRET
// The first design compared x-cron-secret against a CRON_SECRET env secret,
// which meant the same value had to be hand-copied into the pg_cron job SQL.
// One bad paste (a literal 'PASTE_SECRET_HERE') 401'd every scheduled run for
// hours and nothing surfaced it. The canonical secret now lives in Supabase
// Vault, GENERATED inside Postgres: the cron jobs read it from Vault in their
// own command, and this helper verifies a presented value through the
// service-role-only RPC gl_check_cron_secret() — so the value never leaves
// the database at all. The env CRON_SECRET is still honored when it matches,
// purely so a hand-configured setup keeps working.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function isCronCall(req: Request): Promise<boolean> {
  // x-cron-secret is the canonical carrier; Bearer is accepted for hand-rolled
  // curl setups. (Browser calls carry a user JWT as Bearer — that fails here
  // and falls through to the caller's requireStaff path, as intended.)
  const provided = req.headers.get('x-cron-secret')
    || (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!provided) return false;

  const envSecret = Deno.env.get('CRON_SECRET');
  if (envSecret && provided === envSecret) return true;

  try {
    const supa = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data, error } = await supa.rpc('gl_check_cron_secret', { candidate: provided });
    if (error) {
      console.error('[cron-auth] gl_check_cron_secret error:', error.message);
      return false;
    }
    return data === true;
  } catch (e) {
    console.error('[cron-auth] check failed:', e);
    return false;
  }
}
