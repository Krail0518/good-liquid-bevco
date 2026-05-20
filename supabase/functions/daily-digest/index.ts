// daily-digest — emails a "what happened in the last 24 hours" summary
// to every staff profile that hasn't opted out.
//
// Deploy:   supabase functions deploy daily-digest --no-verify-jwt
// Schedule: pg_cron job (see migration 20260520_daily_digest_cron.sql) calls
//           this function once a day at 11:00 UTC (7:00 AM ET).
//
// What goes in the email:
//   • $ collected in the last 24h (invoices.paid_at >= cutoff)
//   • New invoices created in the last 24h
//   • New customer requests opened (customer_requests where status='open' and created_at >= cutoff)
//   • Production-run stage transitions (audit_log where action='production_run_edited' since cutoff)
//   • New clients added (clients.created_at >= cutoff)
//   • Snapshot of total outstanding A/R (status in (pending, overdue))
//   • Any email bounces in the last 24h (email_log.status='bounced' if column exists)
//
// Required secrets:
//   SUPABASE_URL                — pre-set by Supabase
//   SUPABASE_SERVICE_ROLE_KEY   — pre-set by Supabase
//   MAILGUN_API_KEY             — your Mailgun private key
//   MAILGUN_DOMAIN              — e.g. mail.goodliquidbevco.com
//   MAILGUN_FROM                — e.g. "Good Liquid Bev Co <noreply@mail.goodliquidbevco.com>"

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const fmtMoney = (n: number) => {
  if (!Number.isFinite(n)) return "$0";
  if (n < 1000) return "$" + Math.round(n).toLocaleString();
  if (n < 1_000_000) return "$" + (n / 1000).toFixed(1) + "K";
  return "$" + (n / 1_000_000).toFixed(2) + "M";
};

Deno.serve(async (_req) => {
  const supa = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const apiKey = Deno.env.get("MAILGUN_API_KEY");
  const domain = Deno.env.get("MAILGUN_DOMAIN");
  const from   = Deno.env.get("MAILGUN_FROM") || "Good Liquid Bev Co <noreply@goodliquidbevco.com>";
  if (!apiKey || !domain) {
    return new Response(JSON.stringify({ error: "Mailgun secrets not set" }), { status: 500 });
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // ── 1) Recipients: every admin/staff profile that hasn't opted out ─────
  // The opt-out column is added by 20260520_daily_digest_cron.sql. If a
  // deployment runs before the migration, fall back to "all admins".
  let recipients: Array<{ email: string; name?: string | null }> = [];
  try {
    const r = await supa.from("profiles")
      .select("email, name, role, notify_daily_digest")
      .in("role", ["admin", "staff"])
      .neq("email", null);
    if (r.data) {
      recipients = r.data
        .filter((p: any) => p.email && (p.notify_daily_digest !== false))
        .map((p: any) => ({ email: p.email, name: p.name }));
    }
  } catch {
    const r2 = await supa.from("profiles")
      .select("email, name, role")
      .in("role", ["admin", "staff"]);
    if (r2.data) {
      recipients = r2.data.filter((p: any) => p.email).map((p: any) => ({ email: p.email, name: p.name }));
    }
  }

  if (!recipients.length) {
    return new Response(JSON.stringify({ skipped: "no recipients" }), { status: 200 });
  }

  // ── 2) Pull the data in parallel ───────────────────────────────────────
  const [paidR, newInvR, requestsR, runsR, clientsR, outstandingR] = await Promise.all([
    supa.from("invoices").select("invoice_number, client_name, amount, paid_at").gte("paid_at", cutoff).eq("status", "paid"),
    supa.from("invoices").select("invoice_number, client_name, amount, status, created_at").gte("created_at", cutoff).order("created_at", { ascending: false }),
    supa.from("customer_requests").select("id, client_id, subject, kind, created_at, status, body").gte("created_at", cutoff).order("created_at", { ascending: false }),
    supa.from("audit_log").select("target, details, created_at, actor_email").eq("action", "production_run_edited").gte("created_at", cutoff).order("created_at", { ascending: false }).limit(20),
    supa.from("clients").select("name, contact_name, created_at").gte("created_at", cutoff).order("created_at", { ascending: false }),
    supa.from("invoices").select("amount, status").in("status", ["pending", "overdue"]),
  ]);

  const paid          = paidR.data || [];
  const newInvoices   = newInvR.data || [];
  const requests      = requestsR.data || [];
  const runStages     = runsR.data || [];
  const newClients    = clientsR.data || [];
  const outstanding   = outstandingR.data || [];

  const paidTotal       = paid.reduce((a: number, i: any) => a + (Number(i.amount) || 0), 0);
  const newInvTotal     = newInvoices.reduce((a: number, i: any) => a + (Number(i.amount) || 0), 0);
  const arTotal         = outstanding.reduce((a: number, i: any) => a + (Number(i.amount) || 0), 0);
  const arOverdueTotal  = outstanding.filter((i: any) => i.status === "overdue").reduce((a: number, i: any) => a + (Number(i.amount) || 0), 0);
  const newCustReqOpen  = requests.filter((r: any) => r.status === "open").length;

  // If nothing happened, skip the email — no spam on quiet days.
  const totalActivity = paid.length + newInvoices.length + requests.length + runStages.length + newClients.length;
  if (totalActivity === 0) {
    return new Response(JSON.stringify({ skipped: "no activity in last 24h", recipients: recipients.length }), { status: 200 });
  }

  // ── 3) Build the HTML email body ───────────────────────────────────────
  const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const kpiCard = (label: string, value: string, color: string) =>
    `<td style="background:#1a2c48;border:1px solid ${color}40;border-radius:8px;padding:14px;width:25%;vertical-align:top">
       <div style="font-size:10px;letter-spacing:1.5px;color:${color};font-family:'SF Mono',Menlo,monospace;margin-bottom:5px">${label}</div>
       <div style="font-size:22px;color:#ffffff;font-weight:700">${value}</div>
     </td>`;

  const section = (title: string, html: string) =>
    `<div style="margin:24px 0">
       <div style="font-size:13px;letter-spacing:2px;color:#00e5c0;font-family:'SF Mono',Menlo,monospace;border-bottom:1px solid rgba(0,229,192,.25);padding-bottom:8px;margin-bottom:12px">${title}</div>
       ${html}
     </div>`;

  const row = (left: string, right: string) =>
    `<tr><td style="padding:6px 0;color:#cfd9e6;font-size:13px">${left}</td><td style="padding:6px 0;color:#9aa7bd;font-size:13px;text-align:right">${right}</td></tr>`;

  const stageLabel = (d: any) => {
    if (!d) return "(advanced)";
    const a = d.from_stage || d.previous_stage;
    const b = d.to_stage   || d.stage;
    return a && b ? `${a} → ${b}` : (b ? `now ${b}` : "(advanced)");
  };

  const sections: string[] = [];

  // KPI row — always shown
  sections.push(`
    <table cellpadding="0" cellspacing="8" border="0" width="100%" style="border-collapse:separate;border-spacing:8px 0">
      <tr>
        ${kpiCard("COLLECTED 24H",  fmtMoney(paidTotal),  "#5fcf9e")}
        ${kpiCard("NEW INVOICES",   newInvoices.length.toString() + " · " + fmtMoney(newInvTotal), "#00e5c0")}
        ${kpiCard("OPEN REQUESTS",  newCustReqOpen.toString(),   "#f5c842")}
        ${kpiCard("A/R OUTSTANDING", fmtMoney(arTotal) + (arOverdueTotal ? " (" + fmtMoney(arOverdueTotal) + " overdue)" : ""), arOverdueTotal ? "#e74c3c" : "#6b9fff")}
      </tr>
    </table>
  `);

  if (paid.length) {
    sections.push(section("✓ PAYMENTS RECEIVED",
      `<table cellpadding="0" cellspacing="0" border="0" width="100%">${
        paid.map((i: any) => row(
          `<b style="color:#5fcf9e">${i.invoice_number || "—"}</b> · ${i.client_name || "(no client)"}`,
          fmtMoney(Number(i.amount) || 0)
        )).join("")
      }</table>`
    ));
  }

  if (newInvoices.length) {
    sections.push(section("📄 NEW INVOICES",
      `<table cellpadding="0" cellspacing="0" border="0" width="100%">${
        newInvoices.map((i: any) => row(
          `<b style="color:#00e5c0">${i.invoice_number || "—"}</b> · ${i.client_name || "(no client)"} <span style="color:#6b9fff;font-size:11px">${i.status}</span>`,
          fmtMoney(Number(i.amount) || 0)
        )).join("")
      }</table>`
    ));
  }

  if (requests.length) {
    sections.push(section("📩 CUSTOMER REQUESTS",
      `<table cellpadding="0" cellspacing="0" border="0" width="100%">${
        requests.map((r: any) => row(
          `<b style="color:#f5c842">${r.kind || "request"}</b> · ${r.subject || "(no subject)"}`,
          `<span style="color:${r.status === "open" ? "#f5c842" : "#9aa7bd"}">${r.status || "open"}</span>`
        )).join("")
      }</table>`
    ));
  }

  if (runStages.length) {
    sections.push(section("🏭 PRODUCTION STAGE CHANGES",
      `<table cellpadding="0" cellspacing="0" border="0" width="100%">${
        runStages.map((a: any) => row(
          `<b style="color:#c4a4f8">${a.target || "(unnamed run)"}</b>`,
          stageLabel(a.details)
        )).join("")
      }</table>`
    ));
  }

  if (newClients.length) {
    sections.push(section("🆕 NEW CLIENTS",
      `<table cellpadding="0" cellspacing="0" border="0" width="100%">${
        newClients.map((c: any) => row(
          `<b style="color:#7fc6f5">${c.name}</b>` + (c.contact_name ? ` · ${c.contact_name}` : ""),
          new Date(c.created_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        )).join("")
      }</table>`
    ));
  }

  // ── 4) Wrap in shell ───────────────────────────────────────────────────
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#06101e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#06101e">
    <tr><td align="center" style="padding:24px 12px">
      <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#0a1628;border:1px solid rgba(255,255,255,.06);border-radius:14px;overflow:hidden">
        <tr><td style="padding:24px 28px;border-bottom:1px solid rgba(255,255,255,.06)">
          <div style="font-family:'SF Mono',Menlo,monospace;font-size:11px;letter-spacing:2px;color:#00e5c0;margin-bottom:6px">DAILY DIGEST</div>
          <div style="font-size:22px;color:#ffffff;font-weight:700">${dateLabel}</div>
          <div style="font-size:12px;color:#9aa7bd;margin-top:4px">Activity in the last 24 hours · Good Liquid Bev Co</div>
        </td></tr>
        <tr><td style="padding:18px 28px 28px">
          ${sections.join("")}
        </td></tr>
        <tr><td style="padding:14px 28px;border-top:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02);font-size:11px;color:#6b7c93;text-align:center">
          You're receiving this because you're an admin/staff user. Reply with feedback or change
          your preference in Profile → Notifications.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  // Plain-text fallback
  const text = [
    `DAILY DIGEST — ${dateLabel}`,
    "",
    `• Collected (24h): ${fmtMoney(paidTotal)}`,
    `• New invoices:    ${newInvoices.length} · ${fmtMoney(newInvTotal)}`,
    `• Open requests:   ${newCustReqOpen}`,
    `• A/R outstanding: ${fmtMoney(arTotal)}${arOverdueTotal ? " (" + fmtMoney(arOverdueTotal) + " overdue)" : ""}`,
    "",
    paid.length         ? `Payments received: ${paid.map((i: any) => `${i.invoice_number} ${fmtMoney(Number(i.amount)||0)}`).join(", ")}` : "",
    newInvoices.length  ? `New invoices: ${newInvoices.map((i: any) => `${i.invoice_number} (${i.client_name})`).join(", ")}` : "",
    requests.length     ? `Customer requests: ${requests.map((r: any) => `${r.kind} — ${r.subject}`).join("; ")}` : "",
    runStages.length    ? `Production stage changes: ${runStages.map((a: any) => `${a.target} ${stageLabel(a.details)}`).join("; ")}` : "",
    newClients.length   ? `New clients: ${newClients.map((c: any) => c.name).join(", ")}` : "",
  ].filter(Boolean).join("\n");

  const subject = `Daily Digest · ${dateLabel} · ${fmtMoney(paidTotal)} collected, ${newInvoices.length} new invoices`;

  // ── 5) Send via Mailgun (single send, BCC every recipient) ─────────────
  let sent = 0, failed = 0, errors: string[] = [];
  for (const rcpt of recipients) {
    try {
      const fd = new FormData();
      fd.append("from", from);
      fd.append("to", rcpt.email);
      fd.append("subject", subject);
      fd.append("text", text);
      fd.append("html", html);
      const r = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
        method: "POST",
        headers: { Authorization: "Basic " + btoa("api:" + apiKey) },
        body: fd,
      });
      if (r.ok) sent++;
      else { failed++; errors.push(`${rcpt.email}: HTTP ${r.status}`); }
    } catch (e) {
      failed++; errors.push(`${rcpt.email}: ${String(e).slice(0, 120)}`);
    }
  }

  // Log to audit_log so Mike can see the digest fired (and how it landed)
  try {
    await supa.from("audit_log").insert({
      action: "daily_digest_sent",
      target: dateLabel,
      details: {
        recipients: recipients.length, sent, failed, errors: errors.slice(0, 3),
        paid_total: paidTotal, new_invoices: newInvoices.length, requests: requests.length,
        run_stages: runStages.length, new_clients: newClients.length, ar_total: arTotal,
      },
    });
  } catch {}

  return new Response(JSON.stringify({
    recipients: recipients.length, sent, failed, errors: errors.slice(0, 5),
  }), { status: 200, headers: { "Content-Type": "application/json" } });
});
