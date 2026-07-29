// Email scheduler — picks up due rows from email_schedule and sends via Mailgun.
// Deploy:  supabase functions deploy email-scheduler --no-verify-jwt
//
// CALLERS (both legitimate):
//   * pg_cron every 15 minutes, authenticated with the Vault-held cron secret
//     (see _shared/cron-auth.ts for why the secret lives in Vault), and
//   * the CRM itself: while the app is open it pings this function with the
//     signed-in staff JWT, so due follow-ups still go out on time even if the
//     cron plumbing breaks. A broken cron once silently stopped ALL scheduled
//     mail for hours — the redundancy is deliberate.
// With neither credential the endpoint is closed: it can force-send queued
// email, so it must never be anonymous.
//
// Required secrets (set in Supabase Dashboard → Project Settings → Edge Functions → Secrets):
//   SUPABASE_URL                — pre-set
//   SUPABASE_SERVICE_ROLE_KEY   — pre-set
//   MAILGUN_API_KEY             — your Mailgun private key
//   MAILGUN_DOMAIN              — e.g. mail.goodliquidbevco.com
//   MAILGUN_FROM                — e.g. "Good Liquid Bev Co <noreply@mail.goodliquidbevco.com>"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";
import { isCronCall } from "../_shared/cron-auth.ts";
import { requireStaff } from "../_shared/auth.ts";

const JSON_HEADERS = { ...corsHeaders, "Content-Type": "application/json" };

Deno.serve(async (req) => {
  // The CRM's belt-and-braces tick is a browser call, so preflight + CORS.
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (!(await isCronCall(req))) {
    const auth = await requireStaff(req);
    if (!auth.ok) return new Response("unauthorized", { status: 401, headers: corsHeaders });
  }

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const apiKey = Deno.env.get("MAILGUN_API_KEY");
  const domain = Deno.env.get("MAILGUN_DOMAIN");
  const from   = Deno.env.get("MAILGUN_FROM") || "Good Liquid Bev Co <noreply@goodliquidbevco.com>";
  if (!apiKey || !domain) {
    return new Response(JSON.stringify({ error: "Mailgun secrets not set" }), { status: 500, headers: JSON_HEADERS });
  }

  const { data: due, error } = await supa
    .from("email_schedule")
    .select("*")
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString())
    .limit(50);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: JSON_HEADERS });
  }
  if (!due || due.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), { status: 200, headers: JSON_HEADERS });
  }

  let sent = 0, failed = 0;
  for (const row of due) {
    try {
      const fd = new FormData();
      fd.append("from", from);
      fd.append("to", row.to_email);
      if (Array.isArray(row.cc_emails) && row.cc_emails.length) fd.append("cc", row.cc_emails.join(", "));
      fd.append("subject", row.subject);
      fd.append("text", row.body);

      const r = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
        method: "POST",
        headers: { Authorization: "Basic " + btoa("api:" + apiKey) },
        body: fd
      });

      if (r.ok) {
        const json = await r.json().catch(() => ({}));
        await supa.from("email_schedule").update({
          status: "sent",
          sent_at: new Date().toISOString(),
          attempts: row.attempts + 1
        }).eq("id", row.id);
        // Also log to email_log
        await supa.from("email_log").insert({
          mailgun_id: json.id || null,
          to_email: row.to_email,
          cc_emails: row.cc_emails,
          subject: row.subject,
          body_preview: (row.body || "").slice(0, 280),
          invoice_id: row.invoice_id,
          status: "sent",
          sent_at: new Date().toISOString()
        });
        sent++;
      } else {
        const errText = await r.text().catch(() => "no body");
        await supa.from("email_schedule").update({
          status: row.attempts >= 2 ? "failed" : "pending",
          attempts: row.attempts + 1,
          last_error: `HTTP ${r.status}: ${errText.slice(0, 240)}`
        }).eq("id", row.id);
        failed++;
      }
    } catch (e) {
      await supa.from("email_schedule").update({
        status: row.attempts >= 2 ? "failed" : "pending",
        attempts: row.attempts + 1,
        last_error: String(e).slice(0, 240)
      }).eq("id", row.id);
      failed++;
    }
  }

  return new Response(JSON.stringify({ processed: due.length, sent, failed }), { status: 200, headers: JSON_HEADERS });
});
