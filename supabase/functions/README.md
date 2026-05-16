# Good Liquid Bev Co — Edge Functions

Server-side functions that hold API keys for the third-party integrations the
CRM UI already wires up. Browsers can't store these credentials safely, so they
live here. The Supabase CLI deploys each function to a globally distributed
Deno runtime.

## Prerequisites (one-time, ~5 min)

1. **Install the Supabase CLI** (if you don't already have it):
   - macOS / Linux: `brew install supabase/tap/supabase`
   - Windows: `winget install Supabase.CLI`
   - Or download from https://supabase.com/docs/guides/cli

2. **Log in:**
   ```
   supabase login
   ```
   Pops a browser. Approve. Done.

3. **Link this repo to your project (once):**
   ```
   cd <repo root>
   supabase link --project-ref ufjkeqmxwuyhbqyugcgg
   ```

## What's here

| Function | Purpose | UI in CRM |
|---|---|---|
| `stripe-checkout-session` | Generate Stripe Checkout URL for an invoice | 💳 Stripe Checkout |
| `send-sms` | Send a single SMS via Twilio | 📱 SMS Alerts |
| `dropbox-sign` | Send a signature request (template or raw text) | 📝 E-Signatures |
| `qbo-connect` | Returns Intuit OAuth URL | 💼 QuickBooks → Connect |
| `qbo-callback` | OAuth redirect target — stores tokens | (Intuit redirect, no UI) |
| `qbo-disconnect` | Revoke Intuit token + clear local row | 💼 QuickBooks → Disconnect |
| `qbo-push-invoice` | Push a Good Liquid invoice to QuickBooks Online | 💼 Push to QuickBooks button on invoices |

Each subfolder has its `index.ts` with the full implementation. The header
comment of each file lists the secrets it needs.

## Required Supabase setup

### One table — only needed for QuickBooks

Run once in the SQL editor (https://supabase.com/dashboard/project/ufjkeqmxwuyhbqyugcgg/sql/new):

```sql
CREATE TABLE IF NOT EXISTS qbo_tokens (
  id            integer PRIMARY KEY DEFAULT 1,
  access_token  text,
  refresh_token text,
  realm_id      text,
  expires_at    timestamptz,
  updated_at    timestamptz DEFAULT now(),
  CHECK (id = 1)
);
-- Service role bypasses RLS so the Edge Functions can read/write tokens.
-- Anon should NOT be able to read tokens, so leave RLS enabled with no anon policy.
ALTER TABLE qbo_tokens ENABLE ROW LEVEL SECURITY;
```

## Deploy one function

```
supabase functions deploy stripe-checkout-session
```

Replace the name for the other six. The CLI bundles `_shared/cors.ts`
automatically because all functions import from it.

## Deploy everything in one go

```
supabase functions deploy stripe-checkout-session send-sms dropbox-sign qbo-connect qbo-callback qbo-disconnect qbo-push-invoice
```

## Setting secrets

The Edge Functions read configuration from env vars (Supabase secrets).
Set each before its function will work:

### Stripe Checkout (1 secret)

```
supabase secrets set STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxxxxxxx
```

Get the key from https://dashboard.stripe.com/apikeys. Use a `sk_test_…` key
while testing.

### Twilio SMS (3 secrets)

```
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxx
supabase secrets set TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxx
supabase secrets set TWILIO_FROM=+18135550199
```

`TWILIO_FROM` must be a Twilio phone number you've purchased and verified for
SMS in your Twilio console. E.164 format with country code.

### Dropbox Sign (2 secrets)

```
supabase secrets set HELLOSIGN_API_KEY=xxxxxxxxxxxxxxxxxx
supabase secrets set HELLOSIGN_TEST_MODE=1
```

Get the key from https://app.hellosign.com/home/myAccount#api. Leave
`HELLOSIGN_TEST_MODE=1` until you're ready to send real binding signatures —
test mode is free and stamps "test" on every doc.

### QuickBooks Online (3+ secrets)

```
supabase secrets set INTUIT_CLIENT_ID=xxxxxxxxxxxxxxxxxx
supabase secrets set INTUIT_CLIENT_SECRET=xxxxxxxxxxxxxxxxxx
supabase secrets set INTUIT_REDIRECT_URI=https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/qbo-callback
supabase secrets set INTUIT_ENV=sandbox
```

#### Getting Intuit credentials

1. Sign up at https://developer.intuit.com/app/developer/dashboard
2. Create an app → "QuickBooks Online and Payments"
3. Under **Keys & OAuth**, get the Client ID + Client Secret
4. In **Redirect URIs**, add:
   `https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/qbo-callback`
5. Use the **Development** keys while `INTUIT_ENV=sandbox`. When you're ready
   for real books, switch to **Production** keys and `INTUIT_ENV=production`.

## Verifying a deployed function

Every function logs to the Supabase dashboard under Functions → (name) → Logs.

Quick health check from any terminal:

```
curl -i -X POST https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/send-sms \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_ANON_KEY>" \
  -d '{"to":"+18135550100","body":"test from gl crm"}'
```

200 + a Twilio SID means it's wired up.

## What the CRM expects

The CRM defaults all function URLs to
`https://ufjkeqmxwuyhbqyugcgg.supabase.co/functions/v1/<name>`. Admin can
override per-feature in the relevant Settings modal (Stripe Settings,
SMS Settings, E-Signature Settings, QuickBooks Settings). No code change
needed if you ever move the project to a different Supabase ref.

## Cost notes

- **Supabase Edge Functions:** 500k invocations/month free, then $2/M
- **Stripe:** 2.9% + 30¢ per transaction. No fixed monthly fee.
- **Twilio:** ~$0.0079/SMS (US). Plus ~$1.15/mo phone number rental.
- **Dropbox Sign:** Test mode is free. Paid plans start at $20/mo.
- **QuickBooks Online API:** Free with any QBO subscription.

Net cost to run all four with light usage (under 100 SMS, under 50
signatures, under 1,000 invoice pushes per month): **roughly your existing
QuickBooks + Twilio bill**, no new fixed costs.
