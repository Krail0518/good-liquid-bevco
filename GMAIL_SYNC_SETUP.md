# Turning on Gmail correspondence sync

This makes the CRM show **all** email with a client or lead — including replies
they send you, and messages you send from the Gmail app on your phone. Before
this, the CRM could only show mail sent from inside the CRM itself.

The code is already deployed. There is **one** thing left: Gmail currently only
lets the CRM *send* mail. It needs permission to *read* it too.

You do this once. Takes about 5 minutes.

---

## Step 1 — Allow read access in Google Cloud

1. Go to https://console.cloud.google.com/apis/credentials/consent
2. Select the project used for Gmail sending — for this account that is
   **CRM2026** (`crm2026-503223`, org `goodliquid.com`).
3. Open the scopes screen. Google renamed this, so you will see one of two
   layouts:
   - **Current layout** — the sidebar reads *Google Auth Platform*. Click
     **Data access**.
   - **Older layout** — click **Edit App**, then **Save and Continue** until
     you reach the **Scopes** step.
4. Click **Add or remove scopes**, then paste this into the
   "Manually add scopes" box:

   ```
   https://www.googleapis.com/auth/gmail.readonly
   ```

5. Click **Add to table**, tick it, then **Update**, then **Save**. (Older
   layout: **Save and Continue** to the end, then **Back to Dashboard**.)

> If Google warns the scope is "sensitive" and mentions verification: that
> applies to apps published to the public. Because this app is only used by
> you, keep the publishing status as **Testing** and make sure your own
> Google account is listed under **Test users**. That's enough.

---

## Step 1b — Get your Client ID and a usable Client secret

You cannot read these back out of Supabase (secrets there are write-only), and
Google no longer lets you view an existing client secret either — the console
says *"Viewing and downloading client secrets is no longer available."*

So get them from Google Cloud, adding a **second** secret rather than resetting
the existing one (Google supports multiple active secrets so you can rotate
without downtime):

1. Google Cloud → **Google Auth Platform → Clients** → open the
   **Web application** client (`CRM2026 Web`).
2. Copy the **Client ID** (public; safe to keep in a notepad).
3. Under **Client secrets**, click **+ Add secret** and copy the new value
   immediately — it is shown only once.
4. **Leave the old secret in place for now.** It is what the live app is still
   using; deleting it before Step 3 would break invoice sending instantly.
5. Under **Authorized redirect URIs**, add
   `https://developers.google.com/oauthplayground` and **Save**. Without this
   the OAuth Playground fails with `redirect_uri_mismatch`.

## Step 2 — Get a new refresh token (with both permissions)

The existing token only carries send permission, so it must be regenerated.

1. Go to https://developers.google.com/oauthplayground/
2. Click the **gear icon** (⚙️) at the top right.
3. Check **Use your own OAuth credentials**.
4. Enter the **Client ID** and the **new Client secret** from Step 1b.
5. In the left "Input your own scopes" box, paste **both** scopes,
   separated by a space:

   ```
   https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly
   ```

6. Click **Authorize APIs** → sign in as **mike@goodliquid.com** → **Allow**.
7. Click **Exchange authorization code for tokens**.
8. Copy the **Refresh token** value (a long string starting with `1//`).

> Important: include **both** scopes. If you only paste the read one, sending
> email will break.

---

## Step 3 — Save the new credentials in Supabase

Update **both**, so the secret and the refresh token stay a matched pair:

1. Go to your Supabase project → **Project Settings** → **Edge Functions** →
   **Secrets** (or **Configuration → Secrets**).
2. Set **`GMAIL_CLIENT_SECRET`** to the new secret from Step 1b.
3. Set **`GMAIL_REFRESH_TOKEN`** to the refresh token from Step 2.
4. Save.

### Step 3b — Verify sending still works, THEN retire the old secret

Do this in order; it is the safe rotation sequence Google's own warning
("disable and delete the old secret once you have verified...") refers to:

1. In the CRM: **AI toolbar → Quick Actions → 📧 Email Delivery → Test send**.
2. Confirm the test email arrives. If it does not, the old secret is still live
   in Google, so revert `GMAIL_CLIENT_SECRET` and investigate before going on —
   outbound email matters more than history.
3. Only once Test send succeeds: back in Google Cloud, **disable and then delete
   the old client secret**. You are down to one secret and Google's
   "more than one secret" warning clears.

---

## Step 4 — Run the first sync (from inside the CRM)

No dashboard needed — the sync has a button in the app:

1. Hard-refresh the CRM (`Ctrl + Shift + R`) so you have the latest build.
2. **AI toolbar → Quick Actions → 📧 Email Delivery**.
3. Click **🔄 Sync email history from Gmail** (180-day backfill). The button
   reports the outcome on itself when it finishes.
4. Afterwards, each client and lead has its own **🔄 Sync** button in the
   correspondence panel for a quick top-up of just that contact.

If you would rather invoke the function directly, Supabase → **Edge Functions**
→ **gmail-sync** → **Invoke** with body `{ "days": 90, "max": 300 }` returns:

   ```json
   { "ok": true, "scanned": 180, "matched": 24, "inserted": 24, "skipped": 0, "contacts": 37 }
   ```

   - **matched** = emails that involve one of your clients or leads
   - **inserted** = new rows added to the history
   - **skipped** = already logged (so re-running is safe)

Now open a client or a pipeline lead — the **📧 CORRESPONDENCE** panel will
show the real back-and-forth.

### If you get a 403

The response will say the token is missing the `gmail.readonly` scope. That
means Step 2 didn't include both scopes — redo Step 2 and Step 3.

---

## Step 5 — Syncing while the CRM is closed (optional)

You do **not** need this for normal use. The CRM already syncs itself:

- a quick check of the last 3 days shortly after you open it, then every 15
  minutes while the tab is open;
- opening a client or lead refreshes just that contact.

So if the CRM gets opened most days, history stays current on its own. Set up a
schedule only if you want replies filed even on days you never open the CRM.

### Easiest: Supabase's Cron UI (no keys to handle)

1. Supabase dashboard → **Integrations** → **Cron** (older projects: **Database
   → Cron Jobs**) → **Create job**.
2. Name: `gmail-sync-hourly`. Schedule: `0 * * * *` (every hour).
3. Type: **Supabase Edge Function** → choose **gmail-sync**.
4. Method **POST**, body:

   ```json
   { "days": 3, "max": 150 }
   ```

5. Create. Supabase attaches the authorization itself, so no key is copied
   anywhere.

Why this rather than a GitHub Action: the scheduler needs a credential, and the
only one that works from outside is the service-role key — which bypasses every
security rule in the database. Running the schedule inside Supabase keeps that
key in the one place it belongs.

### Alternative: SQL (if your project has no Cron UI)

In Supabase → **SQL Editor**. Replace `YOUR_CRON_SECRET` with the value of your
`CRON_SECRET` edge-function secret (set one if you haven't — any long random
string, saved in Supabase → Edge Functions → Secrets):

```sql
select cron.schedule(
  'gmail-sync-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/gmail-sync',
    headers := jsonb_build_object(
                 'Content-Type',   'application/json',
                 'x-cron-secret',  'YOUR_CRON_SECRET'),
    body    := jsonb_build_object('days', 3, 'max', 100)
  );
  $$
);
```

That checks the last 3 days every hour — cheap, and plenty to catch replies.

To stop it later: `select cron.unschedule('gmail-sync-hourly');`

---

## What gets logged, and what doesn't

**Logged:** any email where the sender or a recipient matches a client's email
address (including the extra addresses on the client record) or a pipeline
lead's email. Both directions.

**Not logged:** mail with people who aren't a client or lead in the CRM. This
is deliberate — the sync ignores your personal and unrelated email, and only
ever *reads* mail to build the history. It never sends, deletes, or modifies
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
