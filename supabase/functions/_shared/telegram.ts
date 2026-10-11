// Telegram alerts, sent by notify-deal, attention-digest and inbound-heartbeat.
//
// Telegram's Bot API is free, official and has no message quota, and it says
// plainly when a send fails — unlike CallMeBot, whose free WhatsApp quota ran
// out in October 2026 while every reply still looked like success.
//
// Setup:
//   1. Mike creates a bot with @BotFather and presses Start in a chat with it.
//   2. The bot token goes in Vault as gl_telegram_bot_token (read through
//      gl_secret_get, service role only), or in the TELEGRAM_BOT_TOKEN secret,
//      which wins if both are set.
//   3. notify-deal's 'telegram_setup' event reads the bot's recent messages,
//      takes the private chat that pressed Start, saves its id in
//      app_settings.telegram_chat_id (staff-only RLS) and sends a test.
//      A TELEGRAM_CHAT_ID secret, if set, wins over the saved value.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { vaultGet } from './gmail-creds.ts';

export interface TelegramResult { ok: boolean; status: number; reply: string }

const SETTING_KEY = 'telegram_chat_id';

function admin() {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });
}

async function botToken(): Promise<string> {
  return Deno.env.get('TELEGRAM_BOT_TOKEN') || await vaultGet('gl_telegram_bot_token');
}

async function chatId(): Promise<string> {
  const fromEnv = Deno.env.get('TELEGRAM_CHAT_ID');
  if (fromEnv) return fromEnv;
  try {
    const { data } = await admin().from('app_settings').select('value').eq('key', SETTING_KEY).maybeSingle();
    const v = data && (data as { value: unknown }).value;
    return v == null ? '' : String(v);
  } catch (e) {
    console.error('[telegram] reading chat id:', e);
    return '';
  }
}

// A network error can quote the request URL, which contains the token.
function mask(e: unknown, token: string): string {
  return String(e).split(token).join('[token]').slice(0, 300);
}

// Telegram's reply, without anything that could carry the token.
function describe(status: number, body: Record<string, unknown>): string {
  if (body.ok) return 'sent';
  return `${status} ${String(body.description || 'no description')}`.slice(0, 300);
}

export async function sendTelegram(tag: string, text: string): Promise<TelegramResult> {
  const token = await botToken();
  if (!token) return { ok: false, status: 0, reply: 'no Telegram bot token set' };
  const chat = await chatId();
  if (!chat) return { ok: false, status: 0, reply: 'no Telegram chat yet — run telegram_setup' };
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: true }),
    });
    const body = await r.json().catch(() => ({})) as Record<string, unknown>;
    const reply = describe(r.status, body);
    if (!r.ok || !body.ok) {
      console.error(`[${tag}] Telegram refused:`, reply);
      return { ok: false, status: r.status, reply };
    }
    console.log(`[${tag}] Telegram sent`);
    return { ok: true, status: r.status, reply };
  } catch (e) {
    const reply = mask(e, token);
    console.error(`[${tag}] Telegram error:`, reply);
    return { ok: false, status: 0, reply };
  }
}

// Find the private chat that pressed Start, remember it, and send a test.
// Returns who it connected to, so the caller can confirm it is Mike.
export async function setupTelegram(): Promise<{ ok: boolean; reply: string; who?: string }> {
  const token = await botToken();
  if (!token) return { ok: false, reply: 'no Telegram bot token set' };
  let r: Response;
  try { r = await fetch(`https://api.telegram.org/bot${token}/getUpdates`); }
  catch (e) { return { ok: false, reply: mask(e, token) }; }
  const body = await r.json().catch(() => ({})) as { ok?: boolean; result?: Array<Record<string, any>>; description?: string };
  if (!r.ok || !body.ok) return { ok: false, reply: describe(r.status, body as Record<string, unknown>) };
  const chats = (body.result || [])
    .map((u) => u.message && u.message.chat)
    .filter((c) => c && c.type === 'private');
  if (!chats.length) return { ok: false, reply: 'no messages yet — open the bot in Telegram and press Start' };
  const chat = chats[chats.length - 1];
  const who = [chat.first_name, chat.last_name].filter(Boolean).join(' ') + (chat.username ? ` (@${chat.username})` : '');
  const { data, error } = await admin().from('app_settings')
    .upsert({ key: SETTING_KEY, value: String(chat.id), updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select();
  if (error || !data || !data.length) return { ok: false, reply: 'saving chat id: ' + (error ? error.message : 'no row written'), who };
  const test = await sendTelegram('telegram_setup', '🔔 Good Liquid CRM: Telegram alerts are connected. New tours, deals, quotes and the morning brief will arrive here.');
  return { ok: test.ok, reply: test.reply, who };
}
