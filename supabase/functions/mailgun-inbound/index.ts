// Mailgun inbound webhook — receives client email replies and stores
// them in email_log (direction='inbound') so they appear in the
// per-client Email Thread panel inside the CRM.
//
// Deploy:
//   supabase functions deploy mailgun-inbound --no-verify-jwt
//
// DNS (add both records to mail.goodliquidbevco.com in Directnic):
//   MX  10  mxa.mailgun.org
//   MX  10  mxb.mailgun.org
//
// Mailgun inbound route (run the curl in the setup notes once DNS propagates):
//   Expression: match_recipient('reply@mail.goodliquidbevco.com')
//   Actions:    forward('https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/mailgun-inbound')
//               stop()

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function verifySignature(
  timestamp: string,
  token: string,
  signature: string,
  signingKey: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(timestamp + token));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex === signature;
}

// Strip quoted reply sections (lines starting with ">") and collapse whitespace.
function stripQuotes(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response("invalid form data", { status: 400 });
  }

  const timestamp  = form.get("timestamp")?.toString() ?? "";
  const token      = form.get("token")?.toString() ?? "";
  const signature  = form.get("signature")?.toString() ?? "";
  const signingKey = Deno.env.get("MAILGUN_WEBHOOK_SIGNING_KEY");

  if (signingKey && timestamp && token && signature) {
    const ok = await verifySignature(timestamp, token, signature, signingKey);
    if (!ok) return new Response("bad signature", { status: 401 });
  }

  // Mailgun sends `sender` (clean address) and `from` (display name + address).
  const fromRaw   = form.get("from")?.toString() ?? "";
  const fromEmail = (
    form.get("sender")?.toString() ||
    fromRaw.match(/<([^>]+)>/)?.[1] ||
    fromRaw
  ).trim().toLowerCase();

  const subject   = form.get("subject")?.toString() ?? "(no subject)";
  const bodyPlain = form.get("body-plain")?.toString() ?? "";
  const recipient = form.get("recipient")?.toString() ?? "reply@mail.goodliquidbevco.com";
  const messageId = (form.get("Message-Id") ?? form.get("message-id"))?.toString() ?? "";

  if (!fromEmail) return new Response("missing from", { status: 400 });

  const bodyPreview = (stripQuotes(bodyPlain) || "(no body)").slice(0, 500);

  // Match sender email to a client so the thread ties to the right record.
  let clientId: string | null = null;
  const { data: client } = await supa
    .from("clients")
    .select("id")
    .ilike("email", fromEmail)
    .maybeSingle();
  if (client) clientId = client.id;

  const { error } = await supa.from("email_log").insert({
    direction:    "inbound",
    from_email:   fromEmail,
    to_email:     recipient,
    subject:      subject,
    body_preview: bodyPreview,
    status:       "delivered",
    client_id:    clientId,
    mailgun_id:   messageId.replace(/[<>]/g, ""),
    sent_at:      new Date().toISOString(),
  });

  if (error) {
    console.error("[GL inbound] insert failed", error.message);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Fire-and-forget WhatsApp alert to Mike
  const supaUrl    = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const notifySecret = Deno.env.get("GL_NOTIFY_SECRET") || "";
  fetch(`${supaUrl}/functions/v1/notify-deal`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${serviceKey}` },
    body: JSON.stringify({
      event: "client_email_reply",
      secret: notifySecret,
      data: { from_email: fromEmail, subject, body_preview: bodyPreview },
    }),
  }).catch(e => console.warn("[GL inbound] notify-deal error:", e));

  return new Response(JSON.stringify({ ok: true, from: fromEmail, client_id: clientId }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
