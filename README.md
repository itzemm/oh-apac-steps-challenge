# OH APAC Steps Challenge

A single-file web app for running a team steps challenge — daily step logging, weekly proof photos, teams, a leaderboard, bonus challenges, and an admin console. There's no self-service sign-up: every account (username, password, profile, and team) is provisioned ahead of time by an admin running the scripts in `/scripts`, and admins can promote/demote other users from the Admin tab. Admins can also randomly audit a participant's proof photos with AI (via a small server-side proxy — see below) and set each week's review status.

The Leaderboard tab defaults to team rankings — top 3 teams on a podium (varying heights), the rest in a compact expandable list — with a toggle to switch the same layout to individual rankings. Inside "My team," members race each other for the current week (Start → Finish), each otter's position set by their own share of that week's top walker.

Live sites:
- GitHub Pages: **https://itzemm.github.io/oh-apac-steps-challenge/**
- Render: set up per **Deploying on Render.com** below.

## How it's built

- `index.html` — the entire app (markup, styles, and JS in one file, no build step, no server).
- `assets/otters/` — the otter mascot artwork. One otter design is the "individual" racer, another the "team" racer; both appear as the header logo, the login screen, and — on the Leaderboard tab — a "🏁 The Race" section where each person/team gets its own lane and their otter's position is driven live by their current step total relative to the group leader. Also rides the current week's dot on the "My trail" progress line.
- Auth: Firebase Authentication, Email/Password only — but there's no password sign-up form in the app. A "username" like `trail-blazers_alice-tan` is really the local part of a synthetic email (`...@ohapac.local`); accounts only ever get created by `/scripts`, run locally by an admin with the Firebase Admin SDK.
- Data: Cloud Firestore, with these collections:
  - `config/main` — challenge name, start date, number of weeks, optional weekly step limit.
  - `users/{uid}` — one profile per account, keyed by Firebase Auth uid (`name`, `email` — the synthetic one, `country`, `provider: 'password'`, `role: 'admin'|'user'`, `teamId`, `mustChangePassword`).
  - `teams/{teamId}` — `name`, `captainUid`, `members: [uid, ...]`.
  - `bonus/{bonusId}` — admin-authored bonus challenges and who/which team has been awarded them. In the Admin tab, each challenge's award list gets a name filter once there are more than 8 people/teams to scroll through.
  - `steps/{uid}` — each user's daily step counts, weekly proof-photo (compressed, stored inline as a JPEG data URL), and `verified: { [weekIndex]: { status: 'verified'|'rejected'|'needs_review', verifiedBy, verifiedByName, verifiedAt } }` — no entry for a week means it hasn't been reviewed yet ("pending"). Set only by an admin, from the participant's detail modal.
- `firestore.rules` — access rules (see **Security model** below).
- `audit-proxy/` — a small standalone Node server (a separate Render **Web Service**, not part of the static site) that holds the Gemini API key and proxies the admin "check with AI" audit requests. See **AI proof-photo audits** below.

## Provisioning accounts (admin bootstrap + rosters)

There's no "first user becomes admin" bootstrap and no sign-up form — see
**`scripts/README.md`** for the full walkthrough, but in short:

```bash
cd scripts
npm install
npm run setup-admin          # creates username admin_emily, role admin
npm run import-roster -- roster.csv   # bulk-creates a team roster
```

Both are safe to re-run. `setup-admin` is also how you add *more* admins
later — "the admin group" is just everyone it's been run for, not a separate
Firestore concept. Every created account's initial password is the same
string as its username; the app forces a password change on first sign-in.

## One-time setup still needed

A few things only you can do from the Firebase dashboard:

1. **Enable Email/Password sign-in**: Firebase Console → your project → Authentication → Sign-in method → enable Email/Password. (This replaced Google sign-in — accounts are admin-provisioned now, not self-serve, so there's no need to verify a real Google identity.)
2. **Create the Firestore database** if you haven't yet: Firebase Console → Firestore Database → Create database (Production mode, any region close to your team is fine).
3. **Deploy the security rules** in `firestore.rules` (they are not live until you deploy them):
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules
   ```
   Run this from inside this project folder.
4. **Provision your admin account and rosters** — see **Provisioning accounts** above.

Until steps 1–3 are done, sign-in will fail (step 1) or every read/write will be rejected (step 3) even for correctly-provisioned accounts.

## Deploying on Render.com

This is a static site — no server, no build output, nothing to compile — so Render needs almost nothing from you.

**Option A — connect the repo in the Render dashboard:**
1. New → Static Site → connect the `oh-apac-steps-challenge` GitHub repo.
2. Build command: leave blank (or `echo "no build"`).
3. Publish directory: `.` (repo root — that's where `index.html` lives).
4. Create Static Site. Render gives you a URL like `https://oh-apac-steps-challenge.onrender.com`.

**Option B — Blueprint (Infrastructure as Code):** this repo already includes `render.yaml`. In the Render dashboard, New → Blueprint → select this repo, and Render reads `render.yaml` and creates the static site automatically with the settings above pre-filled.

### Environment variables to set in Render, for the static site itself

**None are required.** This surprises people coming from apps with a backend, but it's correct here:

- The Firebase Web config (`apiKey`, `authDomain`, `projectId`, etc.) hardcoded in `index.html` is **not a secret** — Firebase's own docs are explicit about this. It's a public client identifier, safe to ship in source, the same way it's safe to view in any browser's dev tools on any Firebase web app. Actual access control lives in `firestore.rules` (who can read/write what) — not in hiding this config.
- This is a static site with no server process, so there is no `process.env` for a runtime environment variable to land in anyway. Render's env vars on a Static Site only affect the **build step**, and this site has no build step.

Nothing Render-specific is needed for sign-in itself: Firebase's "authorized domains" restriction only applies to OAuth-style flows (Google, redirect/popup sign-in), not plain Email/Password sign-in, so there's no domain allowlist to maintain as you add GitHub Pages, Render, and any future custom domain.

**This is different for the audit proxy** (`audit-proxy/`), which is a real server and does need one secret — see the next section.

## AI proof-photo audits (admin)

In the Admin tab, "🎲 Randomly select someone to audit" opens a participant's detail view. For any week with both a proof photo and logged daily steps, an admin can click **🤖 Check with AI**: it sends that week's photo and the person's self-reported daily step counts to Gemini, asks it to read whatever step counts/dates the photo actually shows, and flags any date where the photo and the claim don't line up. After reviewing (AI-assisted or just by eye), an admin sets that week's status to **Verified**, **Needs further verification**, or **Rejected** (or **Clear** to reset it back to pending) — the resulting colored pill (Excel's classic Good/Bad/Neutral cell colors, plus grey for pending) shows up next to that week everywhere it's displayed: the participant table, the detail modal, and on the participant's own "My trail" page once that week is locked.

The Admin tab also has a **Proof photos** panel listing every uploaded proof photo across all participants and weeks, with an **Export all proof (ZIP)** button that bundles them all into one download (`name_weekN.jpg`).

This talks to Gemini through `audit-proxy/`, a tiny separate server, **not** directly from the browser — the Gemini key must never end up in `index.html` or this git repo, since the repo is public. See **Security model** for why.

### Deploying the audit proxy

1. In the Render dashboard: **New → Blueprint → select this repo.** `render.yaml` now defines *two* services — the static site, and `oh-apac-steps-audit` (a Node Web Service, rooted at `audit-proxy/`). Render creates both.
2. Open the **oh-apac-steps-audit** service → **Environment** → add `GEMINI_API_KEY` with your Gemini key as the value. This is the one place the key should ever be typed in — not in any file, not in chat, not in a commit.
3. Once it deploys, note the URL Render gives that service (it should be `https://oh-apac-steps-audit.onrender.com`, matching what's already set in `index.html` as `AUDIT_PROXY_URL` — but Render appends a random suffix instead if that exact name was taken. If your URL differs, update the `AUDIT_PROXY_URL` constant near the top of `index.html`'s script and redeploy the static site).
4. Double check the `ALLOWED_ORIGINS` env var on that service (pre-filled by `render.yaml`) lists every domain the static site is actually served from — it's a CORS allowlist, so the proxy will otherwise silently refuse requests from a domain you forgot to add.

**About the key you shared in this chat:** treat any key pasted directly into a conversation as already semi-exposed — I'd recommend generating a fresh key in Google AI Studio and using that one for `GEMINI_API_KEY` instead of reusing the one from this conversation.

The proxy doesn't just trust anyone who finds its URL: every request must carry the caller's Firebase Auth ID token, which the proxy verifies against Google's public signing keys before doing anything (no service-account secret needed for that check) — see `audit-proxy/server.js`. That confirms the caller is a real signed-in member of this app, the same bar `firestore.rules` uses for the `teams` collection.

## Local development

No build step — just open `index.html` in a browser, or serve the folder locally (e.g. `npx serve .`). Firestore reads/writes and sign-in all work against the same live Firebase project, so treat local runs as touching real data — sign in with an account created via `/scripts`.

## Security model (why the rules are shaped this way)

This is an internal team-activity tool, not a system handling sensitive personal or financial data, so the rules favor "simple and client-only" over building a Cloud Functions backend:

- **Accounts and profiles can only ever be created by `/scripts`**, run locally with the Admin SDK, which bypasses `firestore.rules` entirely — client-side `create` on `users` and `teams` is hard-disabled (`allow create: if false;`), so there's no path to a self-registered account even by calling Firestore directly.
- **Roles** can only be changed by an existing admin — enforced in `firestore.rules`, not just the UI.
- **Bonus challenges and challenge config** (start date, step limits) are admin-write-only.
- **Steps** (`days`, `weekProof`) can be written by their own owner or an admin (admin access is used by the "reset challenge" feature). The `verified` audit stamp is the one exception carved out of "owner can write their own doc": only an admin can ever set it, enforced in `firestore.rules` — a participant can't self-verify even by calling Firestore directly, bypassing the UI entirely.
- **Teams are updatable** (not creatable) by any signed-in participant once they exist, since leaving/removing a teammate mutate the shared team document and there's no backend to arbitrate that. The practical risk is a participant mischievously editing another team's roster — annoying, not sensitive, and easy for an admin to fix.
- **The Gemini key lives only on the audit-proxy server**, set as a real environment variable, never in the static site's source. The proxy itself checks that every caller presents a valid Firebase Auth ID token before it will spend a Gemini call on their behalf.
