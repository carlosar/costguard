# Releasing CostGuard

Releases are fully automated. **Pushing to `main` publishes to npm and the VS Code
Marketplace.** There is no separate "publish" button — the commit message decides
whether a release happens and what the version number is.

---

## The short version

```bash
git commit -m "fix: correct FCG002 line numbers on JSX files"
git push origin main
```

That's the whole process. Everything below explains what that does, how to verify
it, and what to do when it goes wrong.

---

## What the commit type controls

`semantic-release` reads commit messages since the last tag and picks the version
bump. Nothing else determines it — not `package.json`, which is written by the bot.

| Commit prefix | Example | Result |
|---|---|---|
| `feat:` | `feat: add FCG019 trigger loop rule` | **minor** — 0.7.0 → 0.8.0 |
| `fix:` | `fix: FCG013 misses function declarations` | **patch** — 0.7.0 → 0.7.1 |
| `perf:` | `perf: parse each file once` | **patch** |
| `feat!:` or `BREAKING CHANGE:` in body | | **major** — 0.7.0 → 1.0.0 |
| `chore:` `ci:` `docs:` `test:` `refactor:` `style:` | `ci: bump runner to node 22` | **no release** |

Two practical consequences:

- **To push work without releasing**, type the commit `chore:` or `ci:`. The
  workflow still runs (so CI and the token check execute), but no version is cut.
- **Commit messages become the changelog**, verbatim. Write the subject line for
  someone reading release notes, not for yourself.

`commitlint` enforces this on commit via husky, so a malformed message is rejected
locally before it can confuse the pipeline.

---

## What actually happens on push

Two workflows fire in parallel on every push to `main`:

**`.github/workflows/ci.yml`** — typecheck, build, and a CostGuard self-scan
(`node out/cli.js src/ --format=github --max-risk=HIGH`). Advisory only; it does
not gate the release.

**`.github/workflows/release.yml`** — the one that ships:

1. `npm ci`
2. **Verify Marketplace token** — `vsce verify-pat soarone`. Fails the job here if
   the PAT is bad, *before* anything is published. See "Why this step exists".
3. `npx semantic-release`, which runs its plugins in the order configured in
   `.releaserc.json`:

   | Phase | Plugin | Action |
   |---|---|---|
   | analyze | commit-analyzer | decide the version bump |
   | | release-notes-generator | build the changelog entry |
   | prepare | changelog | write `CHANGELOG.md` |
   | prepare | npm | set the version in `package.json` |
   | prepare | exec | `npm run vscode:prepublish && npm run package` → builds the `.vsix` |
   | prepare | git | commit `CHANGELOG.md` + `package.json`, push, create the tag |
   | publish | **npm** | `npm publish` → the `costguard` CLI |
   | publish | **exec** | `vsce publish` → the VS Code Marketplace |
   | publish | **github** | create the GitHub release, attach the `.vsix` |

**The publish order matters.** npm and the git tag land *before* the Marketplace,
which lands before the GitHub release. A failure partway leaves a partial release —
see "Recovering a partial release".

---

## Required secrets

Set at `Settings → Secrets and variables → Actions`:

| Secret | Used for | Expires |
|---|---|---|
| `NPM_TOKEN` | publishing the CLI to npm | per npm settings |
| `VSCE_PAT` | publishing the extension to the Marketplace | **yes — see below** |
| `GITHUB_TOKEN` | tag, release, changelog commit | automatic, never expires |

`GITHUB_TOKEN` is provided by Actions; you never create it.

---

## Verifying a release

Run this from the repo root. It checks every channel independently rather than
trusting the workflow's exit code.

```bash
printf "%-30s" "npm latest:"; npm view costguard version
printf "%-30s" "marketplace:"; curl -sL -o /dev/null -w "http:%{http_code}\n" "https://marketplace.visualstudio.com/_apis/public/gallery/publishers/soarone/vsextensions/costguard/$(npm view costguard version)/vspackage"
printf "%-30s" "git tag:"; git ls-remote --tags origin | tail -1
printf "%-30s" "github release:"; curl -s "https://api.github.com/repos/carlosar/costguard/releases/latest" | python -c "import json,sys; print(json.load(sys.stdin).get('tag_name','NONE'))"
```

All four must agree on the same version.

**Note:** the Marketplace *web page* is CDN-cached and can show the previous
version for a while after a successful publish. The `vspackage` URL above returns
`http:200` as soon as the version is really live — trust that, not the page.

---

## When a release fails

### First: find out what actually failed

Workflow logs need authentication, but the failure annotations are public:

```bash
ID=$(curl -s "https://api.github.com/repos/carlosar/costguard/commits/main/check-runs" | python -c "import json,sys; [print(c['id']) for c in json.load(sys.stdin)['check_runs'] if c['conclusion']=='failure']")
curl -s "https://api.github.com/repos/carlosar/costguard/check-runs/$ID/annotations" | python -c "import json,sys; [print(a['message']) for a in json.load(sys.stdin)]"
```

This usually gives the exact error without opening a browser.

### Recovering a partial release

If the version reached npm and got tagged but not the Marketplace, **do not try to
re-run the workflow** — semantic-release sees the existing tag and does nothing.
Finish the remaining steps by hand:

```bash
git pull --ff-only origin main          # get the version bump commit
npm run vscode:prepublish && npm run package
npx vsce publish --packagePath costguard-<version>.vsix --pat $p
```

Then create the missing GitHub release at
`https://github.com/carlosar/costguard/releases/new?tag=v<version>`, attaching the
`.vsix`, with the changelog entry as the body.

---

## Rotating the Marketplace PAT

The `VSCE_PAT` is an Azure DevOps Personal Access Token and **it expires**. When it
does, every release fails. This is the single most likely cause of a broken release.

### Creating the token

At <https://dev.azure.com> → user settings (top right) → **Personal Access Tokens**
→ **+ New Token**. Sign in with the account that owns the `soarone` publisher —
verify at <https://marketplace.visualstudio.com/manage/publishers/soarone>.

- **Name** — anything, e.g. `vsce-costguard`
- **Organization** — `soarone` works fine. (The "All accessible organizations"
  advice in vsce's docs is not a hard requirement; an org-scoped token published
  every release through 0.6.0. Global tokens are also being retired — see below.)
- **Expiration** — maximum. Put a calendar reminder one month before.
- **Scopes** — click **Show all scopes**, then **Marketplace → Manage**.
  `Manage` is required; `Publish` alone is not enough.

Copy the value immediately. It is shown exactly once and cannot be retrieved later.

### Gotchas that cost real time

- **The token list is filtered.** The page filters by *Access scope*, so tokens
  created under a different scope appear to be missing entirely. Clear the filter
  before concluding a token doesn't exist.
- **"Edit" cannot change the organization.** That field is immutable on an existing
  token and shows greyed out — which looks like a permissions problem but isn't.
  Create a new token instead.
- **"Regenerate" keeps the original expiry.** Regenerating an expired token hands
  you a new value that is *already expired*. Edit the expiry first, then regenerate.
- **`vsce` caches credentials.** If it reports "expired" right after you supplied a
  fresh token, it is using a stored one. Run `npx vsce logout soarone` first.
- **Never put the token on the command line** — it lands in shell history. Use the
  prompt-based flow below.

### Using it safely

```bash
npx vsce logout soarone
```

```bash
$p = Read-Host "PAT"
```

Press Enter **first**, then paste at the blank line. Input is invisible — that is
expected. (`Read-Host "text"` uses its argument as the *prompt label*, not the
value; pasting the token there exposes it and sets the wrong value.)

```bash
npx vsce publish --packagePath costguard-<version>.vsix --pat $p
```

Then update the `VSCE_PAT` secret and push any `ci:`-typed commit — the verify-pat
step validates the new secret without cutting a release.

Close the terminal afterwards so `$p` is gone.

---

## Why the verify-pat step exists

`vsce publish` runs *after* `npm publish` and the git tag. Before this step existed,
an expired PAT produced a release that was live on npm and tagged in git but absent
from the Marketplace — with no way to re-run it, because the tag already existed.
This happened to v0.7.0.

The check now fails the job before anything is published, so a bad token costs a
red build instead of a broken release.

---

## Deadline: global PATs retire 2026-12-01

Azure DevOps is discontinuing PATs scoped to "all accessible organizations".
Org-scoped tokens are unaffected and keep working, so the low-effort path is simply
to ensure `VSCE_PAT` is an **org-scoped** token with Marketplace **Manage**.

The better long-term fix is Microsoft Entra ID federated credentials between GitHub
Actions and Azure, which eliminates the stored secret and the expiry entirely. If
you migrate, replace the verify-pat step with the equivalent Entra check.
