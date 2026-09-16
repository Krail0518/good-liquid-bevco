// portal-formula-doc — hand a portal customer one published formula document,
// and record that it happened.
//
// WHY THIS IS A FUNCTION AND NOT A SIGNED URL FROM THE BROWSER
// -----------------------------------------------------------
// Everywhere else in the portal the browser mints its own short-lived signed
// URL, and that is fine: the storage policy already scopes those objects to the
// caller's own client prefix. Formula documents are the exception, because the
// owner asked for an access log — who downloaded which formulation, and when.
//
// A log the browser writes is a log the browser can decline to write. Fetch the
// file, skip the "I downloaded it" call, and the record is silently incomplete:
// a log everyone trusts and nobody can rely on, which is worse than no log.
//
// So the bytes are only reachable through here. formula_documents carries NO
// customer policy (20260915120000) — a customer cannot read file_path, so they
// cannot mint a URL themselves — and this function writes the download row
// BEFORE it returns one. If the log write fails, the download fails. That
// ordering is the entire point of the function.
//
// AUTHORIZATION, in order:
//   1. requireCustomer — an active portal account, not the anon key, not the
//      service-role key, not a staff-only token
//   2. the document must be PUBLISHED (published_at is not null)
//   3. the document's formula must belong to THIS customer's client
//
// Step 3 is done here rather than trusted from the client: the request carries
// a document id, and a document id is a guess away from another client's.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { corsHeaders, jsonResponse, errorResponse, handlePreflight } from '../_shared/cors.ts';
import { requireCustomer } from '../_shared/auth.ts';

const SUPABASE_URL     = Deno.env.get('SUPABASE_URL')              || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BUCKET           = 'client-docs';
const URL_TTL_SECONDS  = 60;

// Mirrors glDocFileName in the browser: the extension comes from the STORED
// path, never the typed name, so a document named "payload.exe" still arrives
// as the file it actually is.
function downloadName(name: string, path: string): string {
  const stored = String(path || '').split('/').pop() || 'document';
  const ext = stored.includes('.') ? stored.split('.').pop()!.toLowerCase() : '';
  const base = String(name || '')
    .replace(/\.[A-Za-z0-9]{1,8}$/, '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, 120)
    .trim();
  if (!base) return stored;
  return ext ? `${base}.${ext}` : base;
}

function callerIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for') || '';
  const first = fwd.split(',')[0].trim();
  return first || null;
}

Deno.serve(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const caller = await requireCustomer(req);
  if (!caller.ok) return errorResponse(caller.error || 'Unauthorized', caller.status);

  let documentId = '';
  try {
    const body = await req.json();
    documentId = String(body?.documentId || '').trim();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return errorResponse('documentId required', 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The document, its publication state, and the formula it belongs to.
  const { data: doc, error: docErr } = await admin
    .from('formula_documents')
    .select('id, name, file_path, published_at, formula_id, formulas(client_id)')
    .eq('id', documentId)
    .maybeSingle();

  if (docErr) {
    console.error('[portal-formula-doc] lookup failed:', docErr.message);
    return errorResponse('Could not read the document', 500);
  }

  // One message for "does not exist", "not published" and "belongs to someone
  // else". A distinct 404 vs 403 would turn this endpoint into an oracle for
  // which document ids exist and which client owns them.
  const NOT_FOR_YOU = 'Document not available';

  if (!doc || !doc.published_at || !doc.file_path) return errorResponse(NOT_FOR_YOU, 404);

  const ownerClient = (doc as Record<string, unknown>).formulas as { client_id?: string } | null;
  // formulas.client_id is TEXT while customer_users.client_id is uuid — the
  // known inconsistency this schema carries. Compare as text, explicitly.
  if (!ownerClient?.client_id || String(ownerClient.client_id) !== String(caller.clientId)) {
    return errorResponse(NOT_FOR_YOU, 404);
  }

  // Log BEFORE serving. A failure here refuses the download: an unlogged read
  // of a formulation is exactly what this function exists to prevent.
  const { error: logErr } = await admin
    .from('formula_document_downloads')
    .insert({
      formula_document_id: doc.id,
      customer_user_id: caller.customerUserId,
      ip: callerIp(req),
    });

  if (logErr) {
    console.error('[portal-formula-doc] download log failed:', logErr.message);
    return errorResponse('Could not record the download — please try again', 503);
  }

  const { data: signed, error: urlErr } = await admin
    .storage.from(BUCKET)
    .createSignedUrl(doc.file_path, URL_TTL_SECONDS, {
      download: downloadName(String(doc.name || ''), String(doc.file_path)),
    });

  if (urlErr || !signed?.signedUrl) {
    console.error('[portal-formula-doc] signed url failed:', urlErr?.message);
    return errorResponse('Could not prepare the download', 500);
  }

  return jsonResponse({ url: signed.signedUrl, expiresIn: URL_TTL_SECONDS });
});

// corsHeaders is imported for the preflight helper above; referenced here so
// the import cannot be pruned by a future refactor without a visible change.
void corsHeaders;
