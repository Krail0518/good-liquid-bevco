// wh-monthly-billing — invoice every client for last month's warehouse storage.
//
// On the 1st of each month (pg_cron, 20261115120000_wh_monthly_billing_cron.sql)
// this works out the month that just ended exactly as the Billing tab does
// (_shared/wh-billing.mjs is a port of the page's billMonth/billLines), and for
// each client with something to pay:
//   1. creates the invoice (next GL- number, the client's payment terms),
//   2. emails it from the company Gmail (gmail-send), with a View & Pay link,
//   3. logs the email (email_log), marks the month billed
//      (wh_billing_statements, invoice_ref = the invoice number) and audits it,
// then sends Mike one Telegram summary of what went out and what did not.
//
// It never bills a client twice for a month. A client is skipped, and named in
// the summary, when the month is already marked billed, when a storage invoice
// for that month already exists (made by hand), or when the client has no email.
//
// Callers and modes (POST JSON):
//   • pg_cron, x-cron-secret                     → real run for last month
//   • staff  { dryRun: true, period? }           → computes, writes nothing, sends nothing
//   • staff  { previewTo: "x@goodliquid.com" }   → sends each email to that address
//                                                  only; writes nothing
//   • admin  { period?: "YYYY-MM" }              → real run (catch-up / re-run)
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (auto); Telegram bot token
// via _shared/telegram.ts. Email goes through the gmail-send function.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { corsHeaders, jsonResponse, handlePreflight } from '../_shared/cors.ts';
import { isCronCall } from '../_shared/cron-auth.ts';
import { requireStaff } from '../_shared/auth.ts';
import { sendTelegram } from '../_shared/telegram.ts';
import {
  DEFAULT_RATES, billMonth, billLines, dueDate, emailHtml, emailSubject, emailText,
  monthBounds, monthLabel, nextInvoiceNumber, nyDay, previousMonth,
} from '../_shared/wh-billing.mjs';

const SITE = 'https://www.goodliquidbevco.com/';
const SUPA_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

function randToken(): string {
  const a = new Uint8Array(20); crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

// deno-lint-ignore no-explicit-any
async function fetchAll(build: () => any): Promise<Row[]> {
  let out: Row[] = [];
  for (let from = 0; from < 200000; from += 1000) {
    const r = await build().range(from, from + 999);
    if (r.error) throw new Error(r.error.message);
    out = out.concat(r.data || []);
    if (!r.data || r.data.length < 1000) break;
  }
  return out;
}

// deno-lint-ignore no-explicit-any
async function loadBills(db: any, ym: string) {
  const moves = await fetchAll(() => db.from('wh_movements')
    .select('seq,at,pallet_id,from_location,to_location,transfer:wh_transfers!wh_movements_transfer_id_fkey(type,transfer_number,scheduled_at,completed_at)')
    .or('to_location.eq.conri,from_location.eq.conri').order('seq'));
  const ids = [...new Set(moves.map((m) => m.pallet_id))];
  const pallets: Record<string, Row> = {};
  for (let i = 0; i < ids.length; i += 150) {
    const r = await db.from('wh_pallets')
      .select('id,pallet_tag,conri_pallet_id,received_at_conri,sku:wh_skus(client_id,upc_sku,description,client:clients(name))')
      .in('id', ids.slice(i, i + 150));
    if (r.error) throw new Error(r.error.message);
    (r.data || []).forEach((p: Row) => { pallets[p.id] = p; });
  }
  const rr = await db.from('wh_billing_rates').select('client_id,storage_per_pallet_month,pull_per_pallet');
  if (rr.error) throw new Error(rr.error.message);
  let def = { storage: DEFAULT_RATES.storage, pull: DEFAULT_RATES.pull };
  const per: Record<string, { storage: number; pull: number }> = {};
  (rr.data || []).forEach((x: Row) => {
    const v = { storage: Number(x.storage_per_pallet_month) || 0, pull: Number(x.pull_per_pallet) || 0 };
    if (x.client_id) per[x.client_id] = v; else def = v;
  });
  return billMonth(moves, pallets, ym, (cid: string) => per[cid] || def);
}

async function gmailSend(payload: Row): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const r = await fetch(`${SUPA_URL}/functions/v1/gmail-send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify(payload),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || body.error) return { ok: false, error: String(body.error || `HTTP ${r.status}`) };
    return { ok: true, id: body.id || body.messageId || undefined };
  } catch (e) { return { ok: false, error: String((e as Error).message || e) }; }
}

// A storage invoice for this client and month that someone already made.
// deno-lint-ignore no-explicit-any
async function existingInvoice(db: any, cid: string, ym: string): Promise<Row | null> {
  const label = monthLabel(ym);
  const r = await db.from('invoices').select('id,invoice_number,status,service')
    .eq('client_id', cid).is('voided_at', null).ilike('service', `%${label}:%`);
  if (r.error) throw new Error(r.error.message);
  const re = new RegExp(`(Warehouse storage|Pallet pulls), ${label}:`);
  const hit = (r.data || []).find((x: Row) => re.test(String(x.service || '')));
  if (!hit) return null;
  const e = await db.from('email_log').select('id').eq('invoice_id', hit.id).eq('direction', 'outbound').limit(1);
  return { ...hit, emailed: !!(e.data && e.data.length) };
}

// deno-lint-ignore no-explicit-any
async function createInvoice(db: any, row: Row): Promise<Row> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const nums = await db.from('invoices').select('invoice_number').like('invoice_number', 'GL-%');
    if (nums.error) throw new Error(nums.error.message);
    const invoice_number = nextInvoiceNumber((nums.data || []).map((x: Row) => x.invoice_number));
    const ins = await db.from('invoices').insert({ ...row, invoice_number }).select('*');
    if (!ins.error && ins.data && ins.data.length === 1) return ins.data[0];
    // 23505 = the CRM took that number between our read and our insert; take the next.
    if (ins.error && ins.error.code === '23505' && /invoice_number/.test(ins.error.message)) continue;
    throw new Error(ins.error ? ins.error.message : 'insert returned no row');
  }
  throw new Error('could not get a free invoice number after 5 tries');
}

const tag = (x: Row) => (x.conri_pallet_id ? `CONRI #${x.conri_pallet_id} (${x.pallet_tag})` : x.pallet_tag);
const usd = (n: number) => '$' + (Number(n) || 0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;
  if (req.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);

  let body: Row = {};
  try { body = await req.json(); } catch { body = {}; }

  const cron = await isCronCall(req);
  const dryRun = body.dryRun === true;
  const previewTo = typeof body.previewTo === 'string' ? body.previewTo.trim().toLowerCase() : '';
  if (!cron) {
    // Dry runs and previews write nothing and email only staff: any staff user.
    // A real run invoices clients: admin only.
    const auth = await requireStaff(req, { role: dryRun || previewTo ? 'staff' : 'admin' });
    if (!auth.ok) return jsonResponse({ error: auth.error || 'unauthorized' }, auth.status || 401);
  }
  if (previewTo && !/^[^\s@]+@goodliquid\.com$/.test(previewTo)) {
    return jsonResponse({ error: 'previewTo must be a goodliquid.com address' }, 400);
  }

  const ym = typeof body.period === 'string' && body.period ? body.period : previousMonth(new Date());
  const b = monthBounds(ym);
  if (!b) return jsonResponse({ error: 'period must be YYYY-MM' }, 400);
  if (b.last >= nyDay(new Date())) return jsonResponse({ error: `${monthLabel(ym)} is not over yet` }, 400);

  const db = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const today = nyDay(new Date());
  const results: Row[] = [];

  let bills: Row[];
  try { bills = await loadBills(db, ym); }
  catch (e) {
    const msg = String((e as Error).message || e);
    if (!dryRun && !previewTo) await sendTelegram('wh-monthly-billing', `⚠️ Warehouse billing for ${monthLabel(ym)} FAILED before any invoice: ${msg}`);
    return jsonResponse({ error: msg }, 500);
  }

  for (const o of bills.filter((x) => x.billable && x.total > 0)) {
    const r: Row = { client: o.name, client_id: o.client_id, total: o.total, pallets: o.stored.length, pulls: o.pulls.length };
    results.push(r);
    try {
      const st = await db.from('wh_billing_statements').select('invoice_ref,amount').eq('client_id', o.client_id).eq('period', ym + '-01').maybeSingle();
      if (st.error) throw new Error(st.error.message);
      if (st.data) { r.outcome = 'skipped'; r.reason = `already marked billed (${st.data.invoice_ref || 'no ref'}, ${usd(st.data.amount)})`; continue; }

      const ex = await existingInvoice(db, o.client_id, ym);
      if (ex) {
        r.outcome = 'skipped';
        r.reason = `invoice ${ex.invoice_number} already exists (${ex.status})` + (ex.emailed ? '' : ' and was NEVER EMAILED');
        continue;
      }

      const c = await db.from('clients').select('*').eq('id', o.client_id).maybeSingle();
      if (c.error || !c.data) throw new Error(c.error ? c.error.message : 'client not found');
      const client = c.data;
      const extra = (Array.isArray(client.additional_emails) ? client.additional_emails : [])
        .map((x: Row) => (typeof x === 'string' ? x : x && x.email)).filter(Boolean)
        .filter((x: string) => x.toLowerCase() !== String(client.email || '').toLowerCase());
      if (!client.email) { r.outcome = 'skipped'; r.reason = 'client has no email on file'; continue; }

      const lines = billLines(o, ym);
      const terms = client.payment_terms || 'Due on receipt';
      const draft: Row = {
        client_id: o.client_id, client_name: client.name, service: lines.map((l: Row) => l.desc).join(', '),
        amount: o.total, status: 'pending', invoice_date: today, due_date: dueDate(terms, today),
        payment_terms: terms, line_items: lines, share_token: randToken(),
        notes: `Warehouse storage at CONRI, ${monthLabel(ym)}. Invoiced automatically on the 1st.`,
      };

      if (dryRun) { r.outcome = 'would invoice'; r.to = client.email; r.lines = lines; continue; }

      const inv = previewTo ? { ...draft, invoice_number: 'GL-PREVIEW' } : await createInvoice(db, draft);
      const portalUrl = SITE + '?invoice_view=' + inv.share_token;
      const mail = await gmailSend({
        to: previewTo ? [previewTo] : [client.email],
        cc: previewTo ? [] : extra,
        subject: (previewTo ? '[PREVIEW] ' : '') + emailSubject(inv),
        text: emailText(inv, client, ym, portalUrl),
        html: emailHtml(inv, client, ym, previewTo ? '' : portalUrl),
      });
      if (previewTo) { r.outcome = mail.ok ? 'preview sent' : 'preview failed'; r.error = mail.error; continue; }

      r.invoice = inv.invoice_number;
      const logged = await db.from('email_log').insert({
        mailgun_id: mail.id || null, to_email: client.email, cc_emails: extra.length ? extra : null,
        subject: emailSubject(inv), body_preview: emailText(inv, client, ym, portalUrl).slice(0, 500),
        invoice_id: inv.id, invoice_number: inv.invoice_number, client_id: o.client_id,
        template_name: 'wh_monthly_invoice', status: mail.ok ? 'sent' : 'failed', direction: 'outbound',
        sent_at: mail.ok ? new Date().toISOString() : null, from_email: 'mike@goodliquid.com',
      }).select('id');
      if (logged.error) console.error('[wh-monthly-billing] email_log', logged.error.message);

      if (!mail.ok) {
        r.outcome = 'created, NOT emailed'; r.error = mail.error;
        await db.from('audit_log').insert({ action: 'wh_auto_invoice_send_failed', target: inv.invoice_number, actor_email: 'system:wh-monthly-billing', details: { client: o.name, month: ym, error: mail.error } });
        continue;
      }

      const stmt = await db.from('wh_billing_statements').insert({
        client_id: o.client_id, period: ym + '-01', storage_pallets: o.stored.length, storage_rate: Number(o.rate.storage) || 0,
        pulls: o.pulls.length, pull_rate: Number(o.rate.pull) || 0, amount: o.total, invoice_ref: inv.invoice_number,
        detail: { auto: true, stored: o.stored.map(tag), pulled: o.pulls.map((x: Row) => tag(x) + ' ' + x.day) },
        billed_by: null,
      }).select('id');
      if (stmt.error || !stmt.data || !stmt.data.length) r.warning = 'emailed, but not marked billed: ' + (stmt.error ? stmt.error.message : 'no row');
      await db.from('audit_log').insert({ action: 'wh_auto_invoice_sent', target: inv.invoice_number, actor_email: 'system:wh-monthly-billing', details: { client: o.name, month: ym, amount: o.total, to: client.email } });
      r.outcome = 'sent'; r.to = client.email;
    } catch (e) {
      r.outcome = 'error'; r.error = String((e as Error).message || e);
    }
  }

  if (!dryRun && !previewTo) {
    const sent = results.filter((r) => r.outcome === 'sent');
    const lines = results.map((r) => {
      if (r.outcome === 'sent') return `✅ ${r.client}: ${r.invoice} ${usd(r.total)} → ${r.to}${r.warning ? ' (' + r.warning + ')' : ''}`;
      if (r.outcome === 'skipped') return `⏭ ${r.client} ${usd(r.total)}: ${r.reason}`;
      return `⚠️ ${r.client} ${usd(r.total)}: ${r.outcome}${r.invoice ? ' ' + r.invoice : ''}: ${r.error || ''}`;
    });
    const text = `🏬 Warehouse storage invoices, ${monthLabel(ym)}\n` +
      (results.length ? `${sent.length} of ${results.length} sent, ${usd(sent.reduce((a, r) => a + r.total, 0))}\n\n` + lines.join('\n') : 'Nothing to bill: no client pallets at CONRI that month.');
    await sendTelegram('wh-monthly-billing', text);
  }

  return jsonResponse({ period: ym, dryRun, preview: !!previewTo, results });
});
