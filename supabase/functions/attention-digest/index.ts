// attention-digest — the morning "who needs you today" brief.
//
// Ranks every open pipeline deal by urgency (same logic as the in-app
// "🔥 Needs Attention" board) and sends Mike a WhatsApp + email each weekday
// morning. Computed server-side from deals + email_log + ai_brief_todos +
// ai_briefs, so it's current even when the CRM is closed.
//
// Callers:
//   • pg_cron weekday morning (x-cron-secret from Vault — see the cron migration)
//   • staff "🔥 Send my brief" button in the CRM (runAttentionDigestNow)
//
// Ranking (highest first): 🟡 your move (they replied, you haven't) →
//   ⏰ overdue to-do → 🧊 cold (no reply 7d+) → ✨ new (never contacted).
// Deals waiting on the customer with nothing overdue are omitted. If nothing
// needs attention, no message is sent (no morning spam).
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto), CALLMEBOT_PHONE,
//   CALLMEBOT_API_KEY (WhatsApp). Email goes through the gmail-send function.
//
// Deploy: supabase functions deploy attention-digest --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, jsonResponse, handlePreflight } from "../_shared/cors.ts";
import { isCronCall } from "../_shared/cron-auth.ts";
import { requireStaff } from "../_shared/auth.ts";

const MIKE_EMAIL = "mike@goodliquid.com";
const DAY = 86400000;
const CLOSED = new Set(["Closed Won", "Closed Lost"]);

function daysSince(ms: number): number { return ms ? Math.floor((Date.now() - ms) / DAY) : 0; }
function money(v: unknown): number { return Number(v) || 0; }
function fmtMoney(n: number): string { return n >= 1000 ? "$" + (n / 1000).toFixed(n % 1000 ? 1 : 0) + "k" : "$" + Math.round(n); }
function tMs(row: Record<string, unknown>): number { return new Date(String(row.sent_at || row.created_at || 0)).getTime() || 0; }

interface Item { name: string; co: string; stage: string; value: number; cat: string; tag: string; color: string; score: number; status: string; todos: string[]; }

async function sendWhatsApp(message: string): Promise<boolean> {
  const phone = Deno.env.get("CALLMEBOT_PHONE"), apiKey = Deno.env.get("CALLMEBOT_API_KEY");
  if (!phone || !apiKey) { console.error("[attention-digest] CallMeBot secrets missing"); return false; }
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(apiKey)}`;
    const r = await fetch(url); const t = await r.text();
    if (!r.ok || t.toLowerCase().includes("error")) { console.error("[attention-digest] CallMeBot", r.status, t); return false; }
    return true;
  } catch (e) { console.error("[attention-digest] WhatsApp", e); return false; }
}

async function sendEmail(subject: string, text: string, html: string): Promise<boolean> {
  const supaUrl = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !key) return false;
  try {
    const r = await fetch(`${supaUrl}/functions/v1/gmail-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
      body: JSON.stringify({ to: [MIKE_EMAIL], subject, text, html }),
    });
    return r.ok;
  } catch (e) { console.error("[attention-digest] email", e); return false; }
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;

  if (!(await isCronCall(req))) {
    const auth = await requireStaff(req);
    if (!auth.ok) return new Response("unauthorized", { status: 401, headers: corsHeaders });
  }

  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const todayStr = new Date().toISOString().slice(0, 10);

  // ── Pull the raw material ────────────────────────────────────────────────
  const [dealsR, mailR, todosR, briefsR] = await Promise.all([
    supa.from("deals").select("id, name, co, email, val, stage, stage_entered_at, created_at"),
    supa.from("email_log").select("to_email, from_email, direction, sent_at, created_at").order("created_at", { ascending: false }).limit(3000),
    supa.from("ai_brief_todos").select("subject_id, body, owner, due_date").eq("subject_kind", "deal").eq("done", false),
    supa.from("ai_briefs").select("subject_id, status_text, ball, ball_since").eq("subject_kind", "deal"),
  ]);

  const deals = (dealsR.data || []).filter((d: any) => !CLOSED.has(d.stage));

  // Free/consumer providers — never treat one as a lead's "company" domain, or
  // unrelated personal-email leads would all cross-wire into one thread.
  const FREE = new Set(["gmail.com","googlemail.com","yahoo.com","ymail.com","yahoo.co.uk","hotmail.com","outlook.com","live.com","msn.com","aol.com","icloud.com","me.com","mac.com","proton.me","protonmail.com","gmx.com","zoho.com","mail.com","comcast.net","verizon.net","att.net","sbcglobal.net"]);
  // One row per email: the OTHER party's address + domain, direction, time.
  const META: Array<{ dir: string; addr: string; dom: string; t: number }> = [];
  (mailR.data || []).forEach((row: any) => {
    const inbound = row.direction === "inbound";
    const raw = String((inbound ? row.from_email : row.to_email) || "");
    const t = tMs(row);
    raw.split(/[,;]/).forEach((part: string) => {
      const a = part.trim().replace(/^[^<]*</, "").replace(/>.*$/, "").toLowerCase();
      if (!a || a.indexOf("@") < 0 || !t) return;
      META.push({ dir: inbound ? "in" : "out", addr: a, dom: a.split("@")[1] || "", t });
    });
  });

  function companyToken(co: string): string {
    let tok = String(co || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const sfx of ["llc","inc","corp","ltd","company","beverages","beverage","brands","brand","drinks","drink"]) {
      if (tok.length > sfx.length + 3 && tok.endsWith(sfx)) tok = tok.slice(0, -sfx.length);
    }
    return tok.length >= 6 ? tok : "";
  }
  // Last inbound / outbound for a lead's WHOLE company: match the exact address,
  // the company email domain (never a free provider), or a distinctive
  // company-name token — so a lead who switched to another address at the same
  // company still counts. Mirrors glLoadEmailLog on the client.
  function lastContact(email: string, co: string): { lastOut: number; lastIn: number } {
    const e = String(email || "").trim().toLowerCase();
    const eDom = e.split("@")[1] || "";
    const dom = eDom && !FREE.has(eDom) ? eDom : "";
    const tok = companyToken(co);
    let lastOut = 0, lastIn = 0;
    for (const m of META) {
      const hit = m.addr === e || (dom && m.dom === dom) || (tok !== "" && m.dom.indexOf(tok) >= 0);
      if (!hit) continue;
      if (m.dir === "in") { if (m.t > lastIn) lastIn = m.t; } else { if (m.t > lastOut) lastOut = m.t; }
    }
    return { lastOut, lastIn };
  }

  const todosBy: Record<string, any[]> = {};
  (todosR.data || []).forEach((t: any) => { (todosBy[t.subject_id] = todosBy[t.subject_id] || []).push(t); });
  const briefBy: Record<string, any> = {};
  (briefsR.data || []).forEach((b: any) => { briefBy[b.subject_id] = b; });

  // ── Classify + rank ──────────────────────────────────────────────────────
  const items: Item[] = [];
  for (const d of deals as any[]) {
    const email = d.email ? String(d.email).trim().toLowerCase() : "";
    const lc = email ? lastContact(email, d.co) : { lastOut: 0, lastIn: 0 };
    const e = (lc.lastOut || lc.lastIn) ? lc : null;
    const brief = briefBy[d.id];
    const dtodos = todosBy[d.id] || [];
    const overdue = dtodos.filter((x: any) => x.owner === "you" && x.due_date && x.due_date < todayStr);
    const valBoost = Math.min(money(d.val) / 1000, 150);
    const base = { name: d.name || d.co || "(unnamed)", co: d.co || "", stage: d.stage || "", value: money(d.val),
                   status: (brief && brief.status_text) || "", todos: dtodos.filter((t: any) => t.owner === "you").slice(0, 2).map((t: any) => t.body) };

    const replied = e && e.lastIn && e.lastOut && e.lastIn > e.lastOut;
    const ballYou = replied || (brief && brief.ball === "you");
    if (ballYou) {
      const since = replied ? e!.lastIn : (brief && brief.ball_since ? new Date(brief.ball_since).getTime() : (e ? e.lastIn : 0));
      const dw = daysSince(since);
      items.push({ ...base, cat: "your-move", tag: "🟡 Your move" + (dw ? ` ${dw}d` : ""), color: "#f5c842", score: 1000 + dw * 12 + valBoost });
    } else if (overdue.length) {
      const od = Math.max(...overdue.map((x: any) => daysSince(new Date(x.due_date + "T00:00:00").getTime())));
      items.push({ ...base, cat: "overdue", tag: "⏰ Overdue" + (od ? ` ${od}d` : ""), color: "#ff8579", score: 820 + od * 12 + valBoost });
    } else if (e && e.lastOut && (!e.lastIn || e.lastIn <= e.lastOut)) {
      const dc = daysSince(e.lastOut);
      if (dc >= 7) items.push({ ...base, cat: "cold", tag: `🧊 Cold ${dc}d`, color: "#7fc6f5", score: 400 + dc * 5 + valBoost });
    } else if (d.email && (!e || !e.lastOut)) {
      const age = daysSince(d.stage_entered_at ? new Date(d.stage_entered_at).getTime() : (d.created_at ? new Date(d.created_at).getTime() : 0));
      items.push({ ...base, cat: "new", tag: "✨ New — not contacted", color: "#c4a4f8", score: 300 + Math.min(age, 60) * 3 + valBoost });
    }
  }
  items.sort((a, b) => b.score - a.score);

  const counts = { "your-move": 0, overdue: 0, cold: 0, new: 0 } as Record<string, number>;
  items.forEach((x) => { counts[x.cat]++; });

  // Nothing needs you — stay quiet.
  if (!items.length) {
    return jsonResponse({ skipped: "nothing urgent", deals: deals.length }, 200);
  }

  const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  // ── WhatsApp (concise, top 8) ────────────────────────────────────────────
  const waLines = items.slice(0, 8).map((x) => `${x.tag} — ${x.name}${x.co && x.co !== x.name ? " (" + x.co + ")" : ""}${x.value ? " · " + fmtMoney(x.value) : ""}`);
  const moreWa = items.length > 8 ? `\n…and ${items.length - 8} more.` : "";
  const wa = `🔥 Good morning! ${items.length} deal${items.length === 1 ? "" : "s"} need you today:\n\n${waLines.join("\n")}${moreWa}\n\nOpen the CRM → 🔥 Needs Attention.`;

  // ── Email (full list) ────────────────────────────────────────────────────
  const chip = (n: number, label: string, color: string) => n ? `<span style="font-size:11px;padding:3px 9px;border-radius:20px;background:${color}22;color:${color};border:1px solid ${color}55;font-weight:700;margin-right:6px">${n} ${label}</span>` : "";
  const rowHtml = (x: Item) => `<tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06)">
      <div style="font-size:14px;color:#fff;font-weight:700">${x.name}${x.co && x.co !== x.name ? ` <span style="color:#8493a8;font-weight:400;font-size:12px">· ${x.co}</span>` : ""}</div>
      <div style="margin-top:2px"><span style="font-size:11px;font-weight:700;color:${x.color}">${x.tag}</span><span style="font-size:11px;color:#6b7c93"> · ${x.stage}${x.value ? " · " + fmtMoney(x.value) : ""}</span></div>
      ${x.status ? `<div style="font-size:12px;color:#c7d2e0;margin-top:4px">${x.status}</div>` : ""}
      ${x.todos.length ? `<div style="font-size:11.5px;color:#eef4ff;margin-top:3px">${x.todos.map((t) => "☐ " + t).join("<br>")}</div>` : ""}
    </td></tr>`;
  const html = `<!doctype html><html><body style="margin:0;background:#06101e;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#06101e"><tr><td align="center" style="padding:24px 12px">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#0a1628;border:1px solid rgba(255,255,255,.06);border-radius:14px;overflow:hidden">
        <tr><td style="padding:22px 28px;border-bottom:1px solid rgba(255,255,255,.06)">
          <div style="font-family:monospace;font-size:11px;letter-spacing:2px;color:#f5c842;margin-bottom:6px">🔥 NEEDS ATTENTION</div>
          <div style="font-size:22px;color:#fff;font-weight:700">${dateLabel}</div>
          <div style="font-size:12px;color:#9aa7bd;margin-top:8px">${chip(counts["your-move"], "your move", "#f5c842")}${chip(counts.overdue, "overdue", "#ff8579")}${chip(counts.cold, "cold", "#7fc6f5")}${chip(counts.new, "new", "#c4a4f8")}</div>
        </td></tr>
        <tr><td style="padding:8px 28px 24px"><table width="100%" cellpadding="0" cellspacing="0">${items.map(rowHtml).join("")}</table></td></tr>
        <tr><td style="padding:14px 28px;border-top:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.02);font-size:11px;color:#6b7c93;text-align:center">Open the CRM and click 🔥 Needs Attention to work the list.</td></tr>
      </table></td></tr></table></body></html>`;
  const text = `NEEDS ATTENTION — ${dateLabel}\n\n` + items.map((x) => `${x.tag} — ${x.name}${x.co ? " (" + x.co + ")" : ""}${x.value ? " · " + fmtMoney(x.value) : ""}${x.status ? "\n   " + x.status : ""}`).join("\n");
  const subject = `🔥 ${items.length} deal${items.length === 1 ? "" : "s"} need you — ${dateLabel}`;

  const whatsappSent = await sendWhatsApp(wa);
  const emailSent = await sendEmail(subject, text, html);

  try {
    await supa.from("audit_log").insert({ action: "attention_digest_sent", target: dateLabel,
      details: { items: items.length, ...counts, whatsappSent, emailSent } });
  } catch { /* non-fatal */ }

  return jsonResponse({ items: items.length, counts, whatsappSent, emailSent }, 200);
});
