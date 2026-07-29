# Gmail connection & correspondence sync

The CRM sends email from your Gmail (mike@goodliquid.com) and reads Gmail to
file every client/lead conversation into their record. Connecting it is now
done **entirely inside the CRM** — no OAuth Playground, no copying tokens, no
Supabase dashboard.

> History note: the old process (Playground → Exchange → paste three secrets
> into Supabase) is gone on purpose. Google only verifies the Client Secret at
> the token exchange, so a mismatched paste could look fine right up until
> sending died. The in-app flow does the exchange server-side and stores the
> whole credential set together in Supabase Vault, so it can't half-succeed.

---

## Connecting Gmail (one time, ~3 minutes)

**In Google Cloud Console** (console.cloud.google.com, project **CRM2026**):

1. **APIs & Services → Credentials** → open the **Web application** OAuth
   client (create one if none exists: *Create credentials → OAuth client ID →
   Web application*).
2. Under **Authorized redirect URIs** click **+ Add URI** and add exactly:
   - `https://goodliquidbevco.com/`
   - `https://www.goodliquidbevco.com/` (add both; whichever address you open
     the CRM at must be listed)

   Then **Save**.
3. Copy the **Client ID** (ends in `.apps.googleusercontent.com`). Under
   **Client secrets**, click **+ Add secret** and copy it immediately — Google
   shows it only once.
4. One-time, if not already done: **APIs & Services → OAuth consent screen** →
   **Publish app**. (Left in "Testing", Google expires the connection every
   7 days.)

**In the CRM:**

5. AI toolbar → Quick Actions → **📧 Email Delivery**.
6. Paste the Client ID and Client Secret into **GMAIL CONNECTION** →
   **💾 Save keys**. They go straight into Supabase Vault server-side; the
   browser keeps nothing.
7. Click **🔗 Connect Gmail** → sign in as **mike@goodliquid.com** → **Allow**.
   The consent asks for send + read together, so one approval covers both
   sending and sync.
8. You land back in the CRM with "✓ Gmail connected". Click **Test send** to
   prove it end-to-end — the result names the channel that actually delivered.

Reconnecting later (revoked grant, new OAuth client, expired token) is the
same flow. If the keys haven't changed, it's just steps 5, 7, 8.

---

## Scheduled jobs — nothing to configure, ever

Three pg_cron jobs run server-side:

| Job | Schedule | What it does |
|---|---|---|
| `email-scheduler-every-15min` | every 15 min | sends due scheduled follow-ups |
| `daily-digest` | 11:00 UTC daily | emails the daily summary to staff |
| `gmail-sync-hourly` | hourly | files new client/lead mail into the CRM |

Their shared secret is **generated inside Postgres and stored in Supabase
Vault**. The jobs read it from Vault at call time and the edge functions
verify it through a service-role-only database function. There is no value
for a human to copy, so there is no value for a human to mis-paste — the
failure that once silently 401'd every scheduled run for hours.

**Check they're landing:** Email Delivery → **SCHEDULED JOBS** shows each
job's last run and whether recent deliveries returned OK.

**Belt and braces:** while the CRM is open it also pings the follow-up
scheduler itself every 20 minutes with your staff login, so even a broken
cron can't stop due mail from going out on days you use the CRM.

---

## What gets logged, and what doesn't

**Logged:** any email where the sender or a recipient matches a client's email
address (including the extra addresses on the client record) or a pipeline
lead's email. Both directions.

**Not logged:** mail with people who aren't a client or lead in the CRM. This
is deliberate — the sync ignores personal and unrelated email, and only ever
*reads* mail to build the history. It never sends, deletes, or modifies
anything in your mailbox.

## Duplicates

An email the CRM sent is logged twice in principle — once by the CRM at send
time, once when the sync reads it back out of Gmail. Two things prevent you
seeing that:

1. `gmail-sync` skips a message that is already logged, matching on the Gmail
   message id and, failing that, on subject + time + contact.
2. The correspondence panels merge any remaining same-message pairs on display
   (`glDedupeEmailRows`), keeping whichever copy has more of the body text.

That second layer means rows logged twice *before* the fix still display once,
so no database cleanup is required. A genuine reply on the same subject line is
never merged — it is on the other side of the conversation.

## If sync says Gmail refused to read mail (403)

The connection is missing read permission. Fix: Email Delivery →
**🔗 Connect Gmail** and approve again — the flow requests read + send
together.
