// Unit tests for the OAuth error mapping the in-app Gmail connect flow shows.
// Runs the REAL shared module (supabase/functions/_shared/oauth-errors.mjs),
// not a copy — same pattern as email-text.test.mjs.
//
// These messages are the difference between "invalid_client" (a wasted
// afternoon) and "your Client Secret doesn't match — re-copy both values"
// (a 30-second fix), so they get pinned by tests.

import { friendlyOAuthError } from '../supabase/functions/_shared/oauth-errors.mjs';

let n = 0, failed = 0;
function t(name, cond, detail) {
  n++;
  if (cond) { console.log('  pass  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (detail ? '  — got: ' + detail : '')); }
}

const ic = friendlyOAuthError(401, JSON.stringify({ error: 'invalid_client', error_description: 'Unauthorized' }));
t('invalid_client → re-copy both values', /Client ID \/ Client Secret/.test(ic.friendly), ic.friendly);
t('invalid_client code preserved', ic.code === 'invalid_client', ic.code);
t('invalid_client detail keeps Google text', /invalid_client: Unauthorized/.test(ic.detail), ic.detail);

const dc = friendlyOAuthError(401, JSON.stringify({ error: 'deleted_client', error_description: 'The OAuth client was deleted.' }));
t('deleted_client → create a new client', /deleted in Google Console/.test(dc.friendly), dc.friendly);

const ig = friendlyOAuthError(400, JSON.stringify({ error: 'invalid_grant' }));
t('invalid_grant → sign in again', /sign in again/i.test(ig.friendly), ig.friendly);

const rm = friendlyOAuthError(400, JSON.stringify({ error: 'redirect_uri_mismatch' }));
t('redirect_uri_mismatch → add the URI', /Authorized redirect URIs/.test(rm.friendly), rm.friendly);

const ad = friendlyOAuthError(400, JSON.stringify({ error: 'access_denied' }));
t('access_denied → approve access', /cancelled/.test(ad.friendly), ad.friendly);

const uc = friendlyOAuthError(400, JSON.stringify({ error: 'unauthorized_client' }));
t('unauthorized_client → check client type', /Web application/.test(uc.friendly), uc.friendly);

const unk = friendlyOAuthError(500, 'gateway timeout');
t('non-JSON body handled without throwing', /unexpected error/i.test(unk.friendly), unk.friendly);
t('non-JSON body code carries HTTP status', unk.code === 'http_500', unk.code);
t('non-JSON body text surfaces in the message', /gateway timeout/.test(unk.friendly), unk.friendly);

const empty = friendlyOAuthError(502, '');
t('empty body handled', /unexpected error/i.test(empty.friendly), empty.friendly);
t('empty body code carries HTTP status', empty.code === 'http_502', empty.code);

const unknownCode = friendlyOAuthError(400, JSON.stringify({ error: 'brand_new_error', error_description: 'huh' }));
t('unknown Google code still shows its detail', /brand_new_error: huh/.test(unknownCode.friendly), unknownCode.friendly);
t('unknown Google code preserved', unknownCode.code === 'brand_new_error', unknownCode.code);

console.log('\n' + n + ' checks, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
