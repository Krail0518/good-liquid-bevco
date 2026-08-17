// lead-action — one-tap actions Mike can take from his phone, no login.
//
// Capability links (HMAC-signed, like booking-approve) that let Mike, straight
// from a WhatsApp/email, act on the lead automations:
//   • review=all      → a page listing every ready AI-drafted follow-up, each
//                       with Send / Dismiss buttons
//   • f=<id>          → one follow-up; Send emails it (as Mike, via gmail-send)
//                       and logs it, Dismiss drops it
//   • lead=<id>       → Snooze the lead 7 days, or mark it Handled, so the
//                       automations stop nagging about it
//
// The state change happens only on an explicit POST (a button), never the
// initial GET, so a link preview can't fire an action. verify_jwt=false
// (config.toml) — a bare browser navigation carries no JWT; the token is the
// credential.
//
// Deploy: supabase functions deploy lead-action --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyBooking, signBooking } from '../_shared/booking-token.ts';

const esc = (s: unknown) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page(title: string, inner: string, status = 200): Response {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} · Good Liquid Bev Co</title>
<style>
 *{box-sizing:border-box;margin:0;padding:0}
 body{background:#0d1420;color:#c8d8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;padding:24px;
      display:flex;align-items:flex-start;justify-content:center;background-image:radial-gradient(ellipse 80% 50% at 50% -10%,rgba(0,229,192,.07),transparent 60%)}
 .wrap{max-width:520px;width:100%}
 .card{background:#131f32;border:1px solid #1e3058;border-radius:16px;padding:22px 22px;margin-bottom:14px;box-shadow:0 8px 40px rgba(0,0,0,.4)}
 h1{font-size:21px;color:#fff;margin-bottom:6px}
 .sub{color:#6b87ad;font-size:13.5px;margin-bottom:16px;line-height:1.5}
 .lbl{color:#6b87ad;font-size:11px;text-transform:uppercase;letter-spacing:.7px;font-weight:700}
 .subj{color:#fff;font-weight:700;font-size:15px;margin:2px 0 6px}
 .body{color:#c8d8f0;font-size:13.5px;white-space:pre-wrap;line-height:1.5;background:#0f1830;border:1px solid #1e3058;border-radius:9px;padding:12px;max-height:230px;overflow:auto}
 .reason{color:#f5c842;font-size:12px;margin-top:8px}
 .btns{display:flex;gap:10px;margin-top:14px;flex-wrap:wrap}
 button{border:none;border-radius:9px;padding:12px 20px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit}
 .send{background:#00c4a7;color:#0d1420}
 .dismiss{background:#241a2a;color:#c9a6ff;border:1px solid #4a3a5a}
 .snooze{background:#1c2740;color:#8fb3ff;border:1px solid #2f4570}
 .big{font-size:50px;text-align:center;margin-bottom:8px}
 .ok{color:#5fcf9e}.warn{color:#f5c842}.bad{color:#e74646}
 p{line-height:1.6;color:#9aa7bd;font-size:14px} a{color:#00e5c0}
</style></head><body><div class="wrap">${inner}</div></body></html>`;
  const headers = new Headers();
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(new TextEncoder().encode(html), { status, headers });
}

async function sendViaGmail(to: string, subject: string, text: string): Promise<boolean> {
  const supaUrl = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supaUrl || !key) return false;
  try {
    const r = await fetch(`${supaUrl}/functions/v1/gmail-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ to, subject, text }),
    });
    const d = await r.json().catch(() => ({}));
    return r.ok && d.ok !== false;
  } catch { return false; }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Params from query (GET) or form (POST).
  const q = url.searchParams;
  let review = q.get('review') || '';
  let fId = q.get('f') || '';
  let leadId = q.get('lead') || '';
  let token = q.get('t') || '';
  let action = q.get('action') || '';
  let exp = q.get('exp') || '';
  if (req.method === 'POST') {
    try {
      const form = await req.formData();
      review = String(form.get('review') || review);
      fId = String(form.get('f') || fId);
      leadId = String(form.get('lead') || leadId);
      token = String(form.get('t') || token);
      action = String(form.get('action') || action);
      exp = String(form.get('exp') || exp);
    } catch { /* keep query */ }
  }

  const bad = (msg: string) => page('Invalid link', `<div class="card"><div class="big">🚫</div><h1 class="bad">Link not valid</h1><p>${esc(msg)}</p></div>`, 403);

  // ── Review-all: list every ready follow-up ──────────────────────────────
  if (review === 'all') {
    // The link is time-bound: the token signs the expiry, and we reject once
    // it's past. Without this the review-all link was a constant, non-expiring
    // HMAC — one leaked copy would be a standing credential over every future
    // drafted follow-up (contact PII + send capability).
    const expMs = Number(exp);
    if (!Number.isFinite(expMs) || expMs <= 0 || Date.now() > expMs) {
      return bad('This review link has expired. A fresh one goes out with the next batch of drafts.');
    }
    if (!(await verifyBooking(`followups-review:${expMs}`, token))) return bad("This link couldn't be verified.");
    const { data: rows } = await supa.from('lead_followups')
      .select('id, to_email, to_name, subject, body, reason, created_at')
      .eq('status', 'ready').order('created_at', { ascending: true }) as { data: any[] };
    if (!rows || !rows.length) {
      return page('Follow-ups', `<div class="card"><div class="big">✅</div><h1 class="ok">All clear</h1><p>No follow-ups waiting to send right now.</p></div>`);
    }
    let html = `<div class="card"><h1>Follow-ups ready</h1><div class="sub">${rows.length} drafted and waiting. Send the good ones — edit later in the CRM if you want to tweak wording.</div></div>`;
    for (const r of rows) {
      const t = await signBooking(r.id);
      html += `<div class="card">
        <div class="lbl">To</div><div style="color:#fff;margin-bottom:6px">${esc(r.to_name || '')} &lt;${esc(r.to_email)}&gt;</div>
        <div class="lbl">Subject</div><div class="subj">${esc(r.subject)}</div>
        <div class="body">${esc(r.body)}</div>
        ${r.reason ? `<div class="reason">⏱ ${esc(r.reason)}</div>` : ''}
        <div class="btns">
          <form method="POST" style="margin:0"><input type="hidden" name="f" value="${esc(r.id)}"><input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="action" value="send"><button class="send" type="submit">✓ Send</button></form>
          <form method="POST" style="margin:0"><input type="hidden" name="f" value="${esc(r.id)}"><input type="hidden" name="t" value="${esc(t)}"><input type="hidden" name="action" value="dismiss"><button class="dismiss" type="submit">✕ Dismiss</button></form>
        </div>
      </div>`;
    }
    return page('Follow-ups', html);
  }

  // ── Single follow-up (f=<id>) ───────────────────────────────────────────
  if (fId) {
    if (!(await verifyBooking(fId, token))) return bad("This link couldn't be verified.");
    const { data: f } = await supa.from('lead_followups').select('*').eq('id', fId).maybeSingle() as { data: any };
    if (!f) return page('Not found', `<div class="card"><div class="big">🔍</div><h1>Not found</h1><p>This follow-up no longer exists.</p></div>`, 404);
    if (f.status !== 'ready') {
      const m = f.status === 'sent' ? `<div class="big">✅</div><h1 class="ok">Already sent</h1>` : `<div class="big">✖️</div><h1 class="warn">Dismissed</h1>`;
      return page('Follow-up', `<div class="card">${m}<p>This follow-up to ${esc(f.to_name || f.to_email)} was already ${esc(f.status)}.</p></div>`);
    }
    if (req.method !== 'POST') {
      return page('Follow-up', `<div class="card">
        <h1>Send this follow-up?</h1>
        <div class="lbl">To</div><div style="color:#fff;margin-bottom:6px">${esc(f.to_name || '')} &lt;${esc(f.to_email)}&gt;</div>
        <div class="lbl">Subject</div><div class="subj">${esc(f.subject)}</div>
        <div class="body">${esc(f.body)}</div>
        <div class="btns">
          <form method="POST" style="margin:0"><input type="hidden" name="f" value="${esc(fId)}"><input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="action" value="send"><button class="send" type="submit">✓ Send it</button></form>
          <form method="POST" style="margin:0"><input type="hidden" name="f" value="${esc(fId)}"><input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="action" value="dismiss"><button class="dismiss" type="submit">✕ Dismiss</button></form>
        </div></div>`);
    }
    if (action === 'send') {
      const ok = await sendViaGmail(f.to_email, f.subject, f.body);
      if (!ok) return page('Send failed', `<div class="card"><div class="big">⚠️</div><h1 class="warn">Couldn't send</h1><p>Email didn't go out — try again from the CRM. The draft is still here.</p></div>`, 502);
      const upd = await supa.from('lead_followups').update({ status: 'sent', sent_at: new Date().toISOString(), decided_at: new Date().toISOString() }).eq('id', fId).eq('status', 'ready').select('id');
      if (!upd.error && upd.data?.length) {
        await supa.from('email_log').insert([{ to_email: f.to_email, subject: f.subject, body_preview: f.body, direction: 'outbound', status: 'sent', sent_at: new Date().toISOString(), client_id: f.client_id || null }]);
      }
      return page('Sent', `<div class="card"><div class="big">✅</div><h1 class="ok">Follow-up sent</h1><p>Off to ${esc(f.to_name || f.to_email)}. It'll show in the lead's correspondence.</p></div>`);
    }
    if (action === 'dismiss') {
      const upd = await supa.from('lead_followups').update({ status: 'dismissed', decided_at: new Date().toISOString() }).eq('id', fId).eq('status', 'ready').select('id');
      if (upd.error || !upd.data?.length) return page('Nothing to do', `<div class="card"><div class="big">↩️</div><h1 class="warn">Already handled</h1><p>This follow-up was already sent, dismissed, or updated elsewhere.</p></div>`, 409);
      return page('Dismissed', `<div class="card"><div class="big">✖️</div><h1 class="warn">Dismissed</h1><p>Won't send. I'll draft a fresh one if they stay quiet.</p></div>`);
    }
    return bad('Unknown action.');
  }

  // ── Lead-level actions (snooze / handled) ───────────────────────────────
  if (leadId) {
    if (!(await verifyBooking(leadId, token))) return bad("This link couldn't be verified.");
    const { data: d } = await supa.from('deals').select('id, name, client_name').eq('id', leadId).maybeSingle() as { data: any };
    if (!d) return page('Not found', `<div class="card"><div class="big">🔍</div><h1>Not found</h1></div>`, 404);
    const who = esc(d.client_name || d.name || 'this lead');
    if (req.method !== 'POST') {
      return page('Lead', `<div class="card"><h1>${who}</h1><div class="sub">Pause the automations for this lead?</div>
        <div class="btns">
          <form method="POST" style="margin:0"><input type="hidden" name="lead" value="${esc(leadId)}"><input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="action" value="snooze"><button class="snooze" type="submit">💤 Snooze 7 days</button></form>
          <form method="POST" style="margin:0"><input type="hidden" name="lead" value="${esc(leadId)}"><input type="hidden" name="t" value="${esc(token)}"><input type="hidden" name="action" value="handled"><button class="dismiss" type="submit">✓ Mark handled</button></form>
        </div></div>`);
    }
    if (action === 'snooze') {
      const until = new Date(Date.now() + 7 * 864e5).toISOString();
      const upd = await supa.from('deals').update({ snoozed_until: until }).eq('id', leadId).select('id');
      if (upd.error || !upd.data?.length) return page('Not updated', `<div class="card"><div class="big">⚠️</div><h1 class="warn">Couldn't snooze</h1><p>The change didn't save — try again from the CRM.</p></div>`, 409);
      return page('Snoozed', `<div class="card"><div class="big">💤</div><h1 class="ok">Snoozed 7 days</h1><p>No nudges about ${who} until then.</p></div>`);
    }
    if (action === 'handled') {
      const upd = await supa.from('deals').update({ handled_at: new Date().toISOString() }).eq('id', leadId).select('id');
      if (upd.error || !upd.data?.length) return page('Not updated', `<div class="card"><div class="big">⚠️</div><h1 class="warn">Couldn't update</h1><p>The change didn't save — try again from the CRM.</p></div>`, 409);
      return page('Handled', `<div class="card"><div class="big">✓</div><h1 class="ok">Marked handled</h1><p>The automations will leave ${who} alone.</p></div>`);
    }
    return bad('Unknown action.');
  }

  return bad('This link is missing its target.');
});
