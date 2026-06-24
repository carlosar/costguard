# CostGuard — Project Audit, Launch Guide & Monetization Roadmap

> Generated: June 2026 | Version at audit: 0.3.0

---

## Table of Contents

1. [What CostGuard Is](#1-what-costguard-is)
2. [Tech Stack & Architecture](#2-tech-stack--architecture)
3. [Current State Assessment](#3-current-state-assessment)
4. [Release Readiness Gaps](#4-release-readiness-gaps)
5. [Monetization Strategy](#5-monetization-strategy)
6. [Immediate Next Steps — Detailed Checklist](#6-immediate-next-steps--detailed-checklist)

---

## 1. What CostGuard Is

CostGuard is a **VS Code extension + CLI tool** that performs static analysis on JavaScript/TypeScript/JSX/TSX files to detect Firebase and React patterns that cause runaway cloud costs before they reach production.

### What it detects (17 rules)

| Rule | Code | Severity | Impact | Points |
|------|------|----------|--------|--------|
| Unstable useEffect dependencies | FCG001 | error | Cost + Memory Leak | 10 |
| Unbounded Firestore reads | FCG002 | error | Cost + Scalability | 18 |
| Real-time listeners on UI state | FCG003 | warning | Cost | 12 |
| Missing onSnapshot cleanup | FCG004 | error | Memory Leak | 22 |
| Firestore reads inside loops | FCG005 | error | Cost + Scalability | 20 |
| setInterval without cleanup | FCG006 | error | Memory Leak | 18 |
| Event listener cleanup missing | FCG007 | error | Memory Leak | 15 |
| fetch/axios inside loops | FCG008 | error | Cost + Scalability | 20 |
| getDoc/getDocs in component body | FCG009 | error | Cost + Scalability | 16 |
| Unstable deps + expensive op in same effect | FCG010 | error | Cost + Scalability + Memory Leak | 35 |
| Expensive op in high-freq handlers | FCG011 | error | Cost + Scalability | 25 |
| Unbatched writes in loops | FCG012 | error | Cost + Scalability | 20 |
| setInterval + Firestore read pattern | FCG013 | warning | Cost + Scalability | 18 |
| Client-side filtering of getDocs | FCG014 | warning | Cost + Scalability | 16 |
| Array operations without atomic updates | FCG015 | warning | Cost | 12 |
| Cloud Functions not exported | FCG016 | warning | Cost + Scalability | 10 |
| httpsCallable invoked in loops | FCG017 | error | Cost + Scalability | 25 |

### Risk Scoring

- **0 pts** → LOW
- **1–24 pts** → MEDIUM
- **25+ pts** → HIGH

### Three Protection Layers

1. **Pre-commit hook** — blocks commits with HIGH-risk violations
2. **GitHub Actions PR gate** — posts risk card to PR, blocks HIGH-risk merges
3. **Deploy gate** — blocks `npm run deploy` on MEDIUM+ risk

---

## 2. Tech Stack & Architecture

### Language & Runtime

- TypeScript 5.9.3 compiled to CommonJS targeting Node 20 / ES2020
- `ts-morph` 21.0.1 for AST parsing (wraps the TypeScript compiler API — no regex, proper AST traversal)

### Build

- `esbuild` 0.28.0 bundles two entry points: `src/extension.ts` → `out/extension.js` and `src/cli.ts` → `out/cli.js`
- `npm run compile` for development, minification enabled on publish

### Testing

- `vitest` 4.1.7 — 18 test files (fcg001–fcg017 + scorer), positive and negative cases per rule

### Distribution

- VS Code Extension: `@vscode/vsce` packages `.vsix` files, published to VS Code Marketplace under publisher `soarone`
- CLI: `bin` field in `package.json` exposes `costguard` binary (not yet on npm registry)

### Release Automation

- `semantic-release` on push to `main`: bumps version, generates CHANGELOG, creates GitHub release, attaches VSIX artifact
- Enforced conventional commits via `husky` + `commitlint`

### CI/CD Pipelines

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | push / PR to main | Typecheck → build → self-scan |
| `costguard.yml` | every PR | Posts risk card, blocks on HIGH violations |
| `release.yml` | push to main | Semantic release, GitHub release, VSIX artifact |

---

## 3. Current State Assessment

### Strengths

- Strict TypeScript (no `any`, proper interfaces)
- 18 test files with positive/negative cases for all 17 rules
- Each rule is isolated and wrapped in try/catch — analyzer never crashes the extension
- Self-checking CI (CostGuard scans its own `src/` on every push)
- Semantic versioning with fully automated releases
- Setup wizard auto-installs all three protection layers in user projects
- Clean separation: analyzer rules are completely independent of VS Code API

### Extension UI

- **CodeLens** at top of file showing risk score and category breakdown
- **Inline squiggles** on violations (error vs. warning)
- **Status bar item** showing overall risk level
- **Diagnostic messages** with rule code, description, and fix suggestion
- **500ms debounce** on text changes — no save required

### CLI Output Modes

- Human-readable (default, Unicode icons)
- JSON (`--json`) for downstream tooling
- GitHub Actions annotations (`--format=github`)
- Exit codes: `0` = clean, `1` = violations found above threshold

---

## 4. Release Readiness Gaps

These must be resolved before any significant marketing push.

### Gap 1 — Tests are untracked

`tests/` and `vitest.config.ts` show as untracked in git. They need to be committed. Without committed tests, CI cannot verify them and the project loses credibility with contributors.

### Gap 2 — CLI is not on the npm registry

`package.json` has a `bin` field and the setup wizard wires `costguard` as a dev dependency, but the package has never been published to npm. Anyone trying to `npx costguard` or add it as a devDependency today gets nothing. This must be resolved before any launch.

### Gap 3 — VS Code Marketplace listing needs visual polish

The Marketplace entry is text-only. Listings without screenshots have significantly lower install conversion. You need at minimum:
- A GIF or PNG showing inline squiggles on a violation
- A screenshot of the CodeLens risk score at the top of a file
- A screenshot of a blocked GitHub PR with the risk card comment

### Gap 4 — No usage telemetry

You cannot measure traction, rule hit rates, or setup completion without telemetry. This means you cannot prioritize which rules to improve, cannot know when users drop off during setup, and cannot prove growth to future investors or partners. VS Code provides `TelemetryReporter`; PostHog or Plausible work for the CLI.

### Gap 5 — Large VSIX bundle

The `.vsix` is ~9.8 MB. This is because `ts-morph` bundles the full TypeScript compiler. It's not a blocker, but worth tracking — users notice slow extension installs.

---

## 5. Monetization Strategy

### Phase 1 — Get Users (Free, Now)

The tool is production-ready. The only job right now is distribution. Goal: **500+ VS Code Marketplace installs** before touching any monetization mechanism.

**Distribution channels in priority order:**

1. **Product Hunt** — submit as "CostGuard: Firebase cost linter for VS Code"
2. **Reddit** — r/firebase, r/reactjs, r/webdev — lead with a real bill-shock story
3. **Dev.to / Hashnode** — "I built a linter that caught a $400 Firebase mistake before it shipped" — embed screenshots, link to Marketplace
4. **Twitter/X** — target `#Firebase`, `#React`, `#VSCode` communities
5. **Firebase community Slack/Discord** — share a rule walkthrough, not a sales pitch
6. **GitHub Stars** — add a star badge + CTA to README

### Phase 2 — Freemium Extension (~$5–15/month)

Add a **Pro license key** system inside the VS Code extension:

| Free Tier | Pro Tier |
|-----------|----------|
| FCG001–FCG008 (8 rules) | All 17 rules |
| File-level scoring | Project-wide dashboard panel |
| No history | 30-day violation trend |
| Community support | Email support |

**Implementation:**
- Sell license keys via [Lemon Squeezy](https://lemonsqueezy.com) or [Gumroad](https://gumroad.com) — both handle VAT/tax automatically and take ~5–10%
- Extension validates key against a simple HTTPS endpoint you control (a Cloudflare Worker or Firebase Function is sufficient)
- VS Code's `SecretStorage` API stores the key securely on the user's machine

**Revenue estimate:** 1,000 free installs → 2–5% convert → **$100–500/month**

### Phase 3 — GitHub App SaaS (~$20–50/team/month)

This is the highest-leverage opportunity. The GitHub Actions integration currently requires self-hosting the workflow. Turn it into a **managed GitHub App**:

- Teams install the app with one click — no YAML to write
- App posts risk-card PR comments automatically
- Web dashboard (e.g., `costguard.dev`) shows org-wide cost risk trends over time
- Team seats, Slack notifications, configurable rule thresholds

**Tech required:**
- A GitHub App (registered at github.com/settings/apps)
- A backend (Firebase Functions + Firestore fits perfectly given the domain)
- A frontend dashboard (Next.js or SvelteKit)
- Webhook receiver that runs the CostGuard CLI against PR diffs

**Revenue estimate:** 50 teams × $29/month = **$1,450 MRR**. This is the path to something sustainable.

### Phase 4 — Enterprise (~$500+/month)

Once you have 10+ paying teams:

- Custom rules (teams upload their own FCG-pattern rules)
- SSO / SAML integration
- On-prem / air-gapped deployment option
- Audit logs
- Dedicated support SLA

---

## 6. Immediate Next Steps — Detailed Checklist

Work through these in order. Each step is self-contained and can be completed in a single sitting.

---

### Step 1 — Commit Tests and Confirm They Pass

**Why:** Tests are untracked and will not run in CI until committed. This is a credibility and safety gap.

- [ ] Open a terminal in the project root
- [ ] Run `npm test` and confirm all 18 test files pass with no failures
- [ ] If any tests fail, fix the failures before proceeding
- [ ] Stage and commit:
  ```
  git add tests/ vitest.config.ts
  git commit -m "test: add rule test suite and vitest config"
  git push origin main
  ```
- [ ] Go to GitHub → Actions → confirm the `ci.yml` workflow runs green after the push

---

### Step 2 — Publish the CLI to npm

**Why:** The setup wizard installs `costguard` as a devDependency, but the package does not exist on npm. Any user following the README today gets an install error.

- [ ] Confirm you have an npm account at [npmjs.com](https://npmjs.com). If not, create one.
- [ ] Run `npm login` in the terminal and authenticate
- [ ] Check the package name is available:
  ```
  npm view costguard
  npm view firebase-cost-guard
  ```
  Pick whichever is available. If `costguard` is taken, use `firebase-cost-guard` and update `package.json` accordingly.
- [ ] In `package.json`, confirm these fields are correct:
  - `"name"`: the npm package name you chose
  - `"version"`: `"0.3.0"`
  - `"bin"`: `{ "costguard": "./out/cli.js" }`
  - `"main"`: `"./out/cli.js"`
  - `"files"`: add `["out/"]` so only the compiled bundle is published, not `src/` or `tests/`
- [ ] Build the project: `npm run compile`
- [ ] Do a dry run to see what will be published: `npm publish --dry-run`
- [ ] Review the file list. Confirm `out/cli.js` is included and `node_modules/`, `tests/`, `src/` are excluded
- [ ] Publish: `npm publish --access public`
- [ ] Verify: `npx costguard --version` (run from a different directory or use `npx --yes costguard --version`)
- [ ] Update the README to show `npm install -D costguard` (or `firebase-cost-guard`) for manual installation

---

### Step 3 — Polish the VS Code Marketplace Listing

**Why:** Text-only listings convert poorly. Screenshots are the single highest-leverage change to Marketplace install rate.

#### 3a — Create screenshots

- [ ] Open VS Code with a sample Firebase/React project (create one if needed with a few intentional violations)
- [ ] Capture a screenshot showing **inline squiggles** on a FCG005 or FCG002 violation with the hover tooltip visible
- [ ] Capture a screenshot showing the **CodeLens** risk score at the top of a file (`🔴 HIGH RISK · Cost: 35 | Scalability: 20`)
- [ ] Capture a screenshot showing the **status bar item** in the bottom bar
- [ ] Record a short **GIF** (use ScreenToGif on Windows — free) showing: open file → violations appear → fix one → score updates
- [ ] Capture a **screenshot of a blocked GitHub PR** with the risk card comment (create a test PR in your repo if needed)
- [ ] Save all assets to a `media/` or `images/` folder in the repo

#### 3b — Update package.json gallery metadata

- [ ] Add a `"galleryBanner"` field:
  ```json
  "galleryBanner": {
    "color": "#1a1a2e",
    "theme": "dark"
  }
  ```
- [ ] Add a `"screenshots"` array pointing to your image files:
  ```json
  "screenshots": [
    { "path": "images/squiggles.png", "alt": "Inline cost violation squiggles" },
    { "path": "images/codelens.png", "alt": "CodeLens risk score" },
    { "path": "images/pr-gate.png", "alt": "GitHub PR risk card" }
  ]
  ```
- [ ] Confirm `icon.png` is 128×128 px (it already exists in the project root)

#### 3c — Update the README description

The Marketplace listing uses `README.md` as its full description. Make the opening section more compelling:

- [ ] Add a one-sentence value prop at the very top (above the badges): *"Stop Firebase bill shock before it hits production — CostGuard catches expensive patterns as you type."*
- [ ] Add install count and version badges from Shields.io
- [ ] Add a "Quick demo" section that embeds the GIF you recorded above
- [ ] Add a "What it catches" section with a concrete bill-shock example (e.g., "FCG005 catches this pattern that caused a $400 Firebase bill in a real app")

#### 3d — Publish updated extension

- [ ] Bump the version if you've made any code changes: update `"version"` in `package.json`
- [ ] Build: `npm run compile`
- [ ] Package: `npx vsce package`
- [ ] Publish: `npx vsce publish` (requires your VS Code Marketplace Personal Access Token)
  - If not set up: go to [dev.azure.com](https://dev.azure.com) → your org → User Settings → Personal Access Tokens → create one with `Marketplace (Publish)` scope
  - Run `npx vsce login soarone` and paste the token
- [ ] Verify the listing at `https://marketplace.visualstudio.com/items?itemName=soarone.costguard`

---

### Step 4 — Write and Publish a Launch Article

**Why:** A personal story about catching a real Firebase cost mistake is the most effective distribution for a developer tool. It provides SEO value, social proof, and a shareable URL for every other channel.

- [ ] Choose a platform: [Dev.to](https://dev.to) is the fastest to get traffic. Hashnode is good for SEO on a custom domain.
- [ ] Write the article. Suggested structure:
  1. **Hook** (100 words): "I got a $400 Firebase bill. Here's the exact line of code that caused it." (Use a real or realistic example — FCG005: Firestore read inside a loop)
  2. **The pattern** (200 words): Show the bad code, explain why it multiplies reads, show the cost math
  3. **The fix** (100 words): Show the corrected code
  4. **How CostGuard catches it** (200 words): Show the VS Code squiggle, the pre-commit block, and the GitHub Actions risk card
  5. **How to install** (100 words): VS Code Marketplace link + `npm install -D costguard` for the CI gate
  6. **Closing** (50 words): GitHub link, request for feedback
- [ ] Add the GIF from Step 3 as the hero image
- [ ] Publish and note the URL

---

### Step 5 — Launch on Reddit and Communities

**Why:** Firebase and React developers are highly active on Reddit and Discord. A well-framed post (not a sales pitch) can drive hundreds of installs in 24 hours.

- [ ] **r/Firebase** — post title: "I built a VS Code linter that catches Firebase patterns that inflate your bill — open source, 17 rules, blocks bad PRs automatically"
  - Lead with the code pattern, not the tool. Show FCG002 or FCG005 catching an unbounded read
  - Link to your Dev.to article as the body, or write a brief summary with the Marketplace link
- [ ] **r/reactjs** — post title: "CostGuard: static analysis tool for expensive Firebase + React patterns (useEffect + Firestore leaks, reads in render, etc.)"
  - Focus on the React-specific rules (FCG001, FCG003, FCG009, FCG010)
- [ ] **r/webdev** — reuse the Dev.to article as a cross-post
- [ ] **Firebase Community Slack / Discord** — share a rule walkthrough in `#tips` or equivalent channel. Don't open with a link; start with the problem
- [ ] **Twitter/X** — post a thread: tweet 1 = the cost-shock hook, tweet 2 = GIF of the extension in action, tweet 3 = install link. Use `#Firebase #VSCode #WebDev`

---

### Step 6 — Submit to Product Hunt

**Why:** Product Hunt gives you a concentrated burst of installs and visibility from a tech-savvy audience on launch day.

- [ ] Create an account at [producthunt.com](https://producthunt.com) if you don't have one
- [ ] Go to [producthunt.com/posts/new](https://producthunt.com/posts/new)
- [ ] Fill in the submission:
  - **Name:** CostGuard
  - **Tagline:** Catch Firebase cost mistakes before they ship (max 60 chars)
  - **Topics:** Developer Tools, Open Source, Firebase
  - **Thumbnail:** 240×240 px logo (use `icon.png`)
  - **Gallery:** Add 3–5 screenshots from Step 3
  - **Description:** Copy your Dev.to article intro, condensed to 3 paragraphs
  - **First comment:** Write a "maker comment" explaining why you built it and what the biggest surprise was during development
- [ ] Schedule the launch for a **Tuesday or Wednesday** at **12:01 AM PST** — this is when Product Hunt's daily counter resets and you get the full day
- [ ] The day before launch, line up 10–15 people (friends, colleagues, online communities) to upvote and leave comments in the first 2 hours — early velocity determines placement

---

### Step 7 — Add Opt-in Telemetry

**Why:** Without data you cannot know what's working, which rules fire most, or where users drop off. This is necessary before any monetization work.

- [ ] Sign up for [PostHog](https://posthog.com) (free tier covers 1M events/month)
- [ ] Install the PostHog Node.js SDK: `npm install posthog-node`
- [ ] In `src/extension.ts`, add telemetry after extension activation:
  - Track: `extension_activated`, `scan_completed` (with `violation_count`, `risk_level`, `file_count`), `setup_wizard_opened`, `setup_wizard_completed`, `protection_layer_installed` (with `layer_type`)
  - Always check VS Code's `env.isTelemetryEnabled` before sending any event — respect the user's global telemetry setting
- [ ] In `src/cli.ts`, add equivalent events for CLI usage
- [ ] Add a `"telemetry"` section to README explaining what is collected and how to opt out
- [ ] Update the extension `package.json` to declare `"activationEvents"` includes telemetry intent if required by Marketplace policy

---

### Step 8 — Set Up a Simple Landing Page

**Why:** You need a URL to link to that isn't the Marketplace or GitHub. A landing page lets you capture email addresses and control the message.

- [ ] Register a domain: `costguard.dev` or `costguard.app` (~$10–15/year on Namecheap or Cloudflare)
- [ ] Use [Carrd](https://carrd.co) ($19/year for a custom domain) for the fastest path to a live page. Alternatively, deploy a simple HTML file to GitHub Pages for free.
- [ ] Landing page must include:
  - The tagline and one-sentence description
  - The GIF from Step 3
  - "Install for VS Code" button → Marketplace link
  - "Add to GitHub Actions" button → README section
  - Email capture field ("Get notified of new rules and features") → use [Buttondown](https://buttondown.email) or [ConvertKit](https://convertkit.com) free tier
- [ ] Add the landing page URL to your GitHub repository's "Website" field and to all social posts

---

### Tracking Progress

Use this table to track completion:

| Step | Task | Status |
|------|------|--------|
| 1 | Commit tests and confirm CI passes | ⬜ |
| 2 | Publish CLI to npm registry | ⬜ |
| 3a | Create screenshots and GIF | ⬜ |
| 3b | Update package.json gallery metadata | ⬜ |
| 3c | Update README opening and add demo GIF | ⬜ |
| 3d | Publish updated VS Code extension | ⬜ |
| 4 | Write and publish launch article on Dev.to | ⬜ |
| 5 | Post on r/firebase, r/reactjs, r/webdev, Discord | ⬜ |
| 6 | Submit to Product Hunt (schedule launch day) | ⬜ |
| 7 | Add opt-in telemetry (PostHog) | ⬜ |
| 8 | Set up landing page with email capture | ⬜ |

---

### After 500 Installs — Next Actions

Once you have 500+ Marketplace installs and real usage data from telemetry:

1. **Analyze which rules fire most** — those are your highest-value features to promote
2. **Survey early users** — one email to your list: "What's the most expensive Firebase mistake you've made?" — use responses as content
3. **Begin Phase 2** (freemium license key system) — gate the top 5 highest-value rules behind Pro
4. **Start the GitHub App** — this is the SaaS path. Firebase Functions + Firestore for the backend; a lightweight Next.js dashboard for the frontend

---

*Document last updated: June 2026*
