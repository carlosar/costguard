# CostGuard

Catch expensive Firebase and React patterns before they hit production — and before they hit your bill.

CostGuard is a VS Code extension that detects runaway Firestore reads, missing listener cleanup, render loops, and other cost-heavy patterns as you write code. It adds inline squiggles, a per-file risk score, and optional gates that block bad code from being committed, merged, or deployed.

---

## Features

### Live diagnostics
Squiggles appear as you type (500ms debounce). No save required.

### Risk scoring
Every flagged file gets a score and a breakdown by risk category, visible inline and in the status bar.

```
$(shield) Risk Score: 82/100   Cost: HIGH   Scalability: MEDIUM   Memory Leak: HIGH
```

### Deployment gates
Three layers that stop risky code before it ships:

| Gate | When it runs | Blocks on |
|---|---|---|
| Pre-commit hook | `git commit` | HIGH risk |
| GitHub Actions PR gate | Every pull request | HIGH risk |
| Deploy gate | `npm run predeploy` | MEDIUM+ risk |

---

## Installation

1. Download `costguard-0.2.0.vsix`
2. Open VS Code → **Extensions** → `···` menu → **Install from VSIX**
3. Select the file and reload when prompted
4. The setup wizard appears automatically — choose which protection layers to enable

---

## Setup Wizard

On first install (and on every upgrade), a QuickPick appears ~1.5 seconds after VS Code loads:

```
CostGuard — Choose your protection layers

  ●  Pre-commit Hook         Block commits with HIGH risk violations
  ●  GitHub Actions PR Gate  Post risk card on PRs, block HIGH risk merges
  ○  Deploy Gate             Block firebase deploy on MEDIUM+ risk violations
```

Select what you want, press **Enter**. CostGuard writes all the necessary files automatically — no manual path setup.

To re-run the wizard at any time: **Command Palette** → `CostGuard: Setup`

---

## What it detects

### FCG001 — Unstable useEffect dependency `error`
Objects, arrays, functions, or call results used as `useEffect` dependencies without `useMemo`/`useCallback`. Every render creates a new reference, causing the effect to re-run infinitely — the root cause of most Firestore read runaway bills.

```ts
// Bad — query is a new object on every render
const query = { collection: 'invoices', status: 'open' };
useEffect(() => { fetchData(query); }, [query]); // ← FCG001

// Fix
const query = useMemo(() => ({ collection: 'invoices', status: 'open' }), []);
```

### FCG002 — Unbounded Firestore read `error`
`getDocs` or `collection` calls without `.limit()`. On a large collection this can read thousands of documents in one call.

```ts
// Bad
const snap = await getDocs(collection(db, 'invoices')); // ← FCG002

// Fix
const snap = await getDocs(query(collection(db, 'invoices'), limit(50)));
```

### FCG003 — Real-time listener on UI state `warning`
`onSnapshot` listeners that re-register whenever UI state like `activeTab`, `selectedId`, or `showModal` changes. Each re-registration opens a new listener and the old one may not be cleaned up.

```ts
// Bad — re-registers every time activeTab changes
useEffect(() => {
  return onSnapshot(collection(db, activeTab), ...);
}, [activeTab]); // ← FCG003
```

### FCG004 — onSnapshot without cleanup `error`
Real-time listeners must return their unsubscribe function. Without it, every component mount adds a new listener that never closes.

```ts
// Bad — listener leaks on every remount
useEffect(() => {
  onSnapshot(collection(db, 'invoices'), handler); // ← FCG004
}, []);

// Fix
useEffect(() => {
  return onSnapshot(collection(db, 'invoices'), handler); // return the unsub
}, []);
```

### FCG005 — Firestore read inside a loop `error`
`getDoc` or `getDocs` calls inside `for`, `while`, `forEach`, `map`, or similar constructs. Each iteration makes a separate network round-trip (N+1 reads).

```ts
// Bad — one read per invoice
for (const id of invoiceIds) {
  const doc = await getDoc(doc(db, 'invoices', id)); // ← FCG005
}

// Fix — use getAll / batched reads / a single query
```

### FCG006 — setInterval without cleanup `error`
`setInterval` inside `useEffect` without a corresponding `clearInterval` return. Intervals stack up on every remount, polling Firebase endlessly.

```ts
// Bad
useEffect(() => {
  setInterval(() => fetchStats(), 5000); // ← FCG006
}, []);

// Fix
useEffect(() => {
  const id = setInterval(() => fetchStats(), 5000);
  return () => clearInterval(id);
}, []);
```

---

## Risk scoring

Each violation carries a point weight based on its real-world cost impact. Scores are capped at 100.

| Rule | Risk categories | Points |
|---|---|---|
| FCG001 Unstable deps | Cost + Memory Leak | 10 |
| FCG002 Unbounded read | Cost + Scalability | 18 |
| FCG003 Listener UI dep | Cost | 12 |
| FCG004 No snapshot cleanup | Memory Leak | 22 |
| FCG005 Read in loop | Cost + Scalability | 20 |
| FCG006 No interval cleanup | Memory Leak | 18 |

**Risk levels per category**

| Points | Level |
|---|---|
| 0 | LOW |
| 1 – 24 | MEDIUM |
| 25+ | HIGH |

---

## Deployment gates

### Pre-commit hook
Blocks `git commit` if staged files contain HIGH risk violations.

```
  CostGuard
  ────────────────────────────────────────────────────────────

  src/invoices.tsx
  Risk 58/100  |  Cost: HIGH  |  Scalability: LOW  |  Memory Leak: HIGH
    ✗  Line 42  [FCG002]  Unbounded Firestore read — add .limit()
    ✗  Line 71  [FCG004]  onSnapshot missing cleanup return

  ────────────────────────────────────────────────────────────
  2 violations in 1 file

  ✗  Blocked — fix HIGH risk violations before proceeding.
```

Installed automatically by the setup wizard into `.git/hooks/pre-commit`.

### GitHub Actions PR gate
Runs on every pull request and posts a risk card comment. Fails the required check if HIGH risk violations are found, blocking the merge.

| File | Score | Cost | Scalability | Memory Leak | Violations |
|---|---|---|---|---|---|
| `src/invoices.tsx` | 🔴 58/100 | 🔴 HIGH | 🟢 LOW | 🔴 HIGH | 2 |

The workflow is written to `.github/workflows/costguard.yml` by the setup wizard. Requires `costguard` in `devDependencies` (added automatically).

### Deploy gate
Runs before `firebase deploy` or any deploy script and blocks if MEDIUM+ risk violations are found.

```bash
npm run predeploy   # or wired via firebase.json predeploy hook
```

---

## CLI

The analyzer is also available as a command-line tool for use in scripts and CI pipelines.

```bash
# Scan a directory
node out/cli.js src/

# Scan only staged files (for pre-commit hooks)
node out/cli.js --staged

# Output JSON for downstream tooling
node out/cli.js src/ --json

# GitHub Actions annotation format
node out/cli.js src/ --format=github

# Set the blocking threshold (default: HIGH)
node out/cli.js src/ --max-risk=MEDIUM
```

**Exit codes:** `0` = no violations above threshold · `1` = violations found

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `costGuard.enable` | `true` | Enable / disable all diagnostics |

Toggle from **Settings** → search `costGuard`, or add to your workspace `settings.json`:

```json
{
  "costGuard.enable": false
}
```

---

## Commands

| Command | Description |
|---|---|
| `CostGuard: Setup` | Re-run the feature setup wizard |
| `CostGuard: Show Risk Score Details` | Show full risk breakdown for the active file |
