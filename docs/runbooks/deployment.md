# Deployment

## What a merge to `main` actually deploys

**Only the static site.** Vercel builds and deploys `index.html`, the
`crm-*.js` modules and the other static files on every push to `main`.

**Nothing else.** These do not ship with a merge:

| Change | How it reaches production |
|---|---|
| Edge functions (`supabase/functions/*`) | `gh workflow run "Deploy Supabase"` |
| Migrations (`supabase/migrations/*`) | Supabase MCP `apply_migration`, then commit the file |
| `supabase/config.toml` | with the next function deploy |

This has been easy to forget. A PR whose fix lives partly in an edge function
looks finished when it merges and is not.

### Ordering rules that have already mattered

**Site before function, when the browser starts sending something new.**
#307 made `stripe-checkout-session` require a `share_token` that the site had
not been sending. Deploying the function first would have 404'd every public
payment until Vercel caught up. Merging first is safe: the old function simply
ignores an unknown field.

**Both functions together, when they share state.** #308 split the QuickBooks
OAuth flow across `qbo-connect` (writes the state) and `qbo-callback` (consumes
it). Deploying only the callback rejects every connect attempt, because nothing
would ever have stored a state.

**Migration before the code that depends on it.** Applying a migration early is
almost always safe — an unused table or column is inert. The reverse is not.

## The release gate

`main` is protected. These checks must pass before a merge:

| Check | What it guards |
|---|---|
| `smoke` | critical paths, plus the plain-node write/authorization suites |
| `invariants` | production probed from outside, as an attacker would |
| `drift` | production authorization state matches the committed baseline |

Two settings are deliberate, and worth understanding before changing them:

- **`enforce_admins` is off.** The owner can still push directly in an
  emergency. The gate exists to catch mistakes, not to lock the owner out of
  their own production system at 2am.
- **No required reviews.** GitHub does not let you approve your own pull
  request, so requiring an approving review would deadlock a solo owner
  entirely. When a second reviewer exists, turn this on.

Branch protection is repository configuration, not code, so it is not in this
repo and a `git revert` will not restore it. Settings → Branches.

### The SQL-apply gate

`apply-sql.yml` (#298) runs under the `production-db` environment, which now
requires a reviewer. Nothing applies SQL to production until a human approves
the run from the Actions tab.

That environment did not exist until 2026-08-29. A workflow referencing an
environment does not create it — GitHub creates it on the first run — so the
gate had been referenced but unenforced since #298 merged. It is worth
checking this after any workflow gains an `environment:` key, because the
reference reads as protection whether or not the environment is there.

`can_admins_bypass` is left at its default (true), for the same reason
`enforce_admins` is off on the branch protection above: the gate exists to
catch mistakes, not to lock the owner out of their own production database.

## Authorization changes

Any migration that touches policies, grants or function ACLs will fail `drift`
until its baseline is updated. That is intended — it forces the authorization
diff to be reviewed alongside the change that caused it.

1. Apply the migration.
2. `gh workflow run "DB Drift" -f update_baseline=true --ref <your-branch>`
3. Review the baseline diff. Every line is a policy, RLS flag, grant, function
   ACL or bucket that changed. Anything not explained by your migration is
   dashboard drift.
4. Commit the baseline **in the same pull request**.

Note that the baseline commit is made by `github-actions[bot]` using
`GITHUB_TOKEN`, and GitHub does not trigger workflows from it. The PR will show
no checks for that commit until a human-authored push follows.

## Verifying a release

```bash
bash scripts/security-invariants.sh          # outside-in, anon identity
gh workflow run "Security invariants"        # adds the self-signup probe
```

The second form supplies the token that lets section 5 run. Without it the
script says so explicitly rather than claiming full coverage — a run that
cannot check the authenticated identity does not print "all invariants hold".

For authorization specifically, `scripts/rls-identity-invariants.sql` asserts
all three identities in a rolled-back transaction: an active staff member, a
portal customer, and a self-registered stranger. It checks both directions —
that non-staff cannot write, **and** that staff still can — so a lockdown that
goes too far fails it as loudly as one that is too loose.

## Running the browser tests locally (Windows)

Sixteen of the suites drive a real browser. They are easy to conclude are
"broken locally" when they are only misconfigured, so the exact working setup
is recorded here.

```bash
# once — the package only, not the browsers
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright --prefix /tmp/pw
```

```bash
export NODE_PATH="/tmp/pw/node_modules"
export PW_CHROMIUM="C:\Program Files\Google\Chrome\Application\chrome.exe"
export REPO_ROOT="C:\Users\mike\Good_Liquid_Bev_Co_CRM_AI_Project_Scaffold\good-liquid-bev-crm-ai-scaffold"

node tests/smoke.test.cjs
node tests/full-sweep.cjs        # 120 checks
```

Three things matter, and each one fails in a way that looks like a real bug:

**`REPO_ROOT` must be a WINDOWS path.** The test server joins it with the
request path and refuses anything that escapes the root. Handed a Git Bash
path (`/c/Users/...`), every file 404s and the run reports `body text length
2`, `viewClientEnhanced missing`, `no sidebar "New Invoice" item found` — a
convincing impression of a broken application. The app is fine; nothing was
served.

**Point `PW_CHROMIUM` at the installed Chrome.** There is no need to download
Playwright's own build.

**A partial download in `%LOCALAPPDATA%\ms-playwright` is worse than none.**
That directory held a `chromium-1140` of 241 MB containing `chrome.dll` and a
manifest but **no `chrome.exe`** — an interrupted download. Playwright treats
the directory as present and fails at launch, and the error names a path that
exists, so it reads as a Playwright problem rather than a truncated file. If
launching fails, check for the `.exe` before anything else:

```bash
find "$LOCALAPPDATA/ms-playwright" -name "chrome.exe"
```

Empty output means the cache is broken; delete that directory and reinstall,
or use the installed Chrome as above.

### Why bother, when CI runs them

CI is the gate and stays authoritative. But a browser locally turns a
push-wait-read cycle into seconds, and the failure it catches first is usually
the one a source-text assertion cannot see at all — a handler that no longer
fires, an overlay stacked behind another, a module that stopped loading.
