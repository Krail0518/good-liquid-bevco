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

### Still outstanding

The `production-db` environment has no required reviewers, so the gate on
`apply-sql.yml` (#298) is currently decorative. Settings → Environments →
`production-db` → Required reviewers.

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
