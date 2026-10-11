// CallMeBot WhatsApp sender, shared by notify-deal (alerts) and
// attention-digest (the morning brief).
//
// CallMeBot answers HTTP 200 with a plain-text (often HTML) page whether or
// not it delivered. A blocked, throttled or out-of-quota key still gets a 200;
// in October 2026 the free key ran out and every reply read "You have 0
// messages left ... Message not sent". We used to treat anything without the
// word "error" in it as sent, so the logs said "sent ok" for days while no
// WhatsApp arrived. Now CallMeBot's own words are returned and logged on every
// send (tags stripped, key and phone masked), and its refusals count as
// failures.
//
// Secrets: CALLMEBOT_PHONE, CALLMEBOT_API_KEY.

export interface CallMeBotResult { ok: boolean; status: number; reply: string }

function cleanReply(text: string, phone: string, apiKey: string): string {
  let t = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (apiKey) t = t.split(apiKey).join('[key]');
  if (phone) t = t.split(phone).join('[phone]');
  return t.slice(0, 400);
}

// How CallMeBot says no while still answering 200.
function refused(reply: string): boolean {
  const lower = reply.toLowerCase();
  return lower.includes('error') || lower.includes('not sent') || lower.includes('0 messages left');
}

export async function sendCallMeBot(tag: string, message: string): Promise<CallMeBotResult> {
  const phone  = Deno.env.get('CALLMEBOT_PHONE');
  const apiKey = Deno.env.get('CALLMEBOT_API_KEY');
  if (!phone || !apiKey) {
    console.error(`[${tag}] CALLMEBOT_PHONE or CALLMEBOT_API_KEY not set`);
    return { ok: false, status: 0, reply: 'CALLMEBOT_PHONE or CALLMEBOT_API_KEY not set' };
  }
  try {
    // URL-encode every value — a phone stored with a leading '+' would otherwise
    // be read as a space by the receiver and the message would never arrive.
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(apiKey)}`;
    const r = await fetch(url);
    const reply = cleanReply(await r.text(), phone, apiKey);
    if (!r.ok || refused(reply)) {
      console.error(`[${tag}] CallMeBot refused:`, r.status, reply);
      return { ok: false, status: r.status, reply };
    }
    console.log(`[${tag}] CallMeBot replied:`, r.status, reply);
    return { ok: true, status: r.status, reply };
  } catch (e) {
    console.error(`[${tag}] WhatsApp error:`, e);
    return { ok: false, status: 0, reply: String(e) };
  }
}
