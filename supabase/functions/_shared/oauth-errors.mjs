// Friendly explanations for Google OAuth token-endpoint errors.
// Plain ESM (no Deno/Node APIs) so tests/oauth-errors.test.mjs can run the
// exact code the gmail-oauth function runs — same pattern as email-text.mjs.
//
// The mapping matters because these errors cost real hours: 'invalid_client'
// looks like a server problem but almost always means the pasted Client
// Secret doesn't match the Client ID — and Google only checks the pair at the
// token exchange, so the consent screen succeeding proves nothing about it.

export function friendlyOAuthError(status, bodyText) {
  let code = '', desc = '';
  try {
    const d = JSON.parse(bodyText || '{}');
    code = String(d.error || '');
    desc = String(d.error_description || '');
  } catch {
    desc = String(bodyText || '').slice(0, 200);
  }

  const M = {
    invalid_client: 'Google rejected the Client ID / Client Secret pair. Re-copy BOTH values from the same OAuth client page in Google Console, save them, and connect again.',
    deleted_client: 'This OAuth client was deleted in Google Console. Create a new OAuth client, save its Client ID and Secret here, and connect again.',
    invalid_grant: 'The sign-in expired or was revoked. Click Connect Gmail and sign in again.',
    redirect_uri_mismatch: 'Google does not recognize this site as an allowed return address. In Google Console, open the OAuth client and add this site under "Authorized redirect URIs", then connect again.',
    access_denied: 'The Google sign-in was cancelled before finishing. Click Connect Gmail and approve access.',
    unauthorized_client: 'This OAuth client is not allowed to use this sign-in method. Make sure the client type is "Web application".',
  };

  const detail = [code, desc].filter(Boolean).join(': ');
  const friendly = M[code];
  if (friendly) return { code, friendly, detail };
  return {
    code: code || ('http_' + status),
    friendly: 'Google returned an unexpected error' + (detail ? ' (' + detail + ')' : '') + '.',
    detail,
  };
}
