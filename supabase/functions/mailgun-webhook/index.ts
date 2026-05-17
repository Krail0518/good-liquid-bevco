// Mailgun webhook receiver — updates email_log when Mailgun fires
// delivered / opened / clicked / failed events.
//
// Deploy: supabase functions deploy mailgun-webhook --no-verify-jwt
// In Mailgun: Sending → Webhooks → add a webhook for each event:
//   URL: https://<project>.functions.supabase.co/mailgun-webhook
//   Events: delivered, opened, clicked, complained, unsubscribed, permanent_failure
//
// Optional: Set MAILGUN_WEBHOOK_SIGNING_KEY in Edge Function secrets to verify HMAC.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function verifyMailgunSignature(timestamp: string, token: string, signature: string, signingKey: string): Promise<boolean> {
  // HMAC-SHA256(signing_key, timestamp + token) === signature
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(signingKey), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(timestamp + token));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hex === signature;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const body = await req.json().catch(() => null);
  if (!body) return new Response("invalid json", { status: 400 });

  // Modern Mailgun webhook envelope: { signature: {...}, event-data: {...} }
  const signing = body.signature;
  const event   = body["event-data"] || body;
  const signingKey = Deno.env.get("MAILGUN_WEBHOOK_SIGNING_KEY");
  if (signingKey && signing) {
    const ok = await verifyMailgunSignature(signing.timestamp, signing.token, signing.signature, signingKey);
    if (!ok) return new Response("bad signature", { status: 401 });
  }

  const messageId = event?.message?.headers?.["message-id"] || event?.message?.["message-id"] || event?.id;
  const ev        = event?.event;
  const recipient = event?.recipient || event?.message?.recipients?.[0];
  if (!messageId || !ev) return new Response("missing fields", { status: 400 });

  const cleanId = String(messageId).replace(/[<>]/g, "");

  // Find log row by mailgun_id; fall back to most-recent matching recipient.
  let { data: row } = await supa.from("email_log").select("*").eq("mailgun_id", cleanId).maybeSingle();
  if (!row && recipient) {
    const f = await supa.from("email_log").select("*").eq("to_email", recipient).order("created_at", { ascending: false }).limit(1).maybeSingle();
    row = f.data;
  }
  if (!row) return new Response("no matching log row", { status: 200 });

  const patch: Record<string, unknown> = {};
  const nowIso = new Date().toISOString();
  switch (ev) {
    case "delivered":
      patch.status = row.status === "opened" || row.status === "clicked" ? row.status : "delivered";
      patch.delivered_at = nowIso;
      break;
    case "opened":
      patch.status = row.status === "clicked" ? "clicked" : "opened";
      patch.open_count = (row.open_count || 0) + 1;
      if (!row.first_opened_at) patch.first_opened_at = nowIso;
      break;
    case "clicked":
      patch.status = "clicked";
      patch.click_count = (row.click_count || 0) + 1;
      break;
    case "failed":
    case "rejected":
    case "permanent_failure":
      patch.status = "bounced";
      patch.bounce_reason = (event?.reason || event?.["delivery-status"]?.message || "").toString().slice(0, 240);
      break;
    case "complained":
      patch.status = "bounced";
      patch.bounce_reason = "spam complaint";
      break;
  }
  if (Object.keys(patch).length) {
    await supa.from("email_log").update(patch).eq("id", row.id);
  }
  return new Response(JSON.stringify({ ok: true, event: ev }), { status: 200 });
});
