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
2. Make sure the project selected at the top is the same one you used to set up
   Gmail sending (the one holding your `GMAIL_CLIENT_ID`).
3. Click **Edit App**, then **Save and Continue** until you reach the
   **Scopes** step.
4. Click **Add or Remove Scopes**, then paste this into the
   "Manually add scopes" box:

   ```
   https://www.googleapis.com/auth/gmail.readonly
   ```

5. Click **Add to Table**, then **Update**, then **Save and Continue** to the
   end and **Back to Dashboard**.

> If Google warns the scope is "sensitive" and mentions verification: that
> applies to apps published to the public. Because this app is only used by
> you, keep the publishing status as **Testing** and make sure your own
> Google account is listed under **Test users**. That's enough.

---

## Step 2 — Get a new refresh token (with both permissions)

The existing token only carries send permission, so it must be regenerated.

1. Go to https://developers.google.com/oauthplayground/
2. Click the **gear icon** (⚙️) at the top right.
3. Check **Use your own OAuth credentials**.
4. Enter your **`GMAIL_CLIENT_ID`** and **`GMAIL_CLIENT_SECRET`**
   (the same values already stored in Supabase).
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

## Step 3 — Save the new token in Supabase

1. Go to your Supabase project → **Project Settings** → **Edge Functions** →
   **Secrets** (or **Configuration → Secrets**).
2. Find **`GMAIL_REFRESH_TOKEN`** and replace its value with the new refresh
   token from Step 2.
3. Save.

---

## Step 4 — Run the first sync

The sync is a function called `gmail-sync`. Trigger it once to backfill history:

1. Supabase → **Edge Functions** → **gmail-sync**.
2. Use the **Invoke / Test** panel and send this body:

   ```json
   { "days": 90, "max": 300 }
   ```

3. You should get a response like:

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

## Step 5 (optional) — Keep it up to date automatically

Run the sync on a schedule so history stays current without you doing anything.
In Supabase → **SQL Editor**, run this (replace `YOUR_CRON_SECRET` with the
value of the `CRON_SECRET` secret):

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
