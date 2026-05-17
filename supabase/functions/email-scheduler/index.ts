// Email scheduler — picks up due rows from email_schedule and sends via Mailgun.
// Deploy:  supabase functions deploy email-scheduler --no-verify-jwt
// Schedule: in Supabase Dashboard → Database → Scheduled Tasks (pg_cron), create
//   a job that calls this function every 15 minutes:
//   select net.http_post(
//     url:='https://<project>.functions.supabase.co/email-scheduler',
//     headers:=jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret', true)),
//     body:=jsonb_build_object()
//   );
// Or, simpler, point cron-job.org at the function URL with a basic-auth header.

// Required secrets (set in Supabase Dashboard → Project Settings → Edge Functions → Secrets):
//   SUPABASE_URL                — pre-set
//   SUPABASE_SERVICE_ROLE_KEY   — pre-set
//   MAILGUN_API_KEY             — your Mailgun private key
//   MAILGUN_DOMAIN              — e.g. mail.goodliquidbevco.com
//   MAILGUN_FROM                — e.g. "Good Liquid Bev Co <noreply@mail.goodliquidbevco.com>"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const apiKey = Deno.env.get("MAILGUN_API_KEY");
  const domain = Deno.env.get("MAILGUN_DOMAIN");
  const from   = Deno.env.get("MAILGUN_FROM") || "Good Liquid Bev Co <noreply@goodliquidbevco.com>";
  if (!apiKey || !domain) {
    return new Response(JSON.stringify({ error: "Mailgun secrets not set" }), { status: 500 });
  }

  const { data: due, error } = await supa
    .from("email_schedule")
    .select("*")
    .eq("status", "pending")
    .lte("send_at", new Date().toISOString())
    .limit(50);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  if (!due || due.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
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

  return new Response(JSON.stringify({ processed: due.length, sent, failed }), { status: 200 });
});
