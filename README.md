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
- `functions/` — Cloud Functions (callable from the app via the Firebase SDK, not plain HTTP) that hold two things the browser must never see: the Gemini API key (admin "check with AI" audits) and Firebase Admin SDK access (admin add/delete/bulk-import participants, from the Admin tab). See **AI proof-photo audits** and **Provisioning accounts** below.

## Provisioning accounts (admin bootstrap + rosters)

There's no self-service sign-up. Two ways to create accounts:

**From the Admin tab (day-to-day use)** — once you're signed in as an admin, the Admin tab has:
- **Add a participant** — team name + person name (+ optional "make captain") → creates their account and shows you the username/initial password once.
- **Bulk import a roster** — upload a CSV (`Team Name, Captain, Member 1-4` columns; see `scripts/roster.example.csv`) → creates everyone at once and gives you a CSV of usernames/initial passwords to download.
- **Delete** button on each row in the Participants table — permanently removes that person's login, profile, and step/proof history, and takes them off their team.

These call Cloud Functions (`addParticipant`, `deleteParticipant`, `importRoster` in `functions/`), gated to callers whose Firestore profile has `role: 'admin'` — see **Security model**.

**From your own machine (the one thing that has to start here)** — creating your *first* admin account is a chicken-and-egg problem (the in-app tools above need you to already be signed in as an admin), so that one step still runs locally:

```bash
cd scripts
npm install
npm run setup-admin   # creates username admin_emily, role admin
```

Full details, including the CLI equivalents of add/delete/import (useful as
a fallback, or for scripting), are in **`scripts/README.md`**. Every created
account's initial password is the same string as its username; the app
forces a password change on first sign-in. `setup-admin` is also how you add
*more* admins later — "the admin group" is just everyone it's been run for,
not a separate Firestore concept.

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
4. **Upgrade the Firebase project to the Blaze (pay-as-you-go) plan**: Firebase Console → ⚙️ (top left) → Usage and billing → Modify plan. Cloud Functions require Blaze even to deploy — Firebase asks for a credit card, but at this app's scale (a handful of admin actions a day) you'll stay inside the free monthly allowance and pay **$0**. There's no way around this if you want the Admin tab's add/delete/bulk-import/AI-audit buttons to work from the website itself (the alternative is running everything from `/scripts` on your own machine instead — see **Provisioning accounts**).
5. **Deploy the Cloud Functions** in `functions/` (only works after step 4):
   ```bash
   npx firebase-tools deploy --only functions
   ```
   The first deploy also prompts you to set the `GEMINI_API_KEY` secret if it isn't set yet — or set it explicitly any time with:
   ```bash
   npx firebase-tools functions:secrets:set GEMINI_API_KEY
   ```
   Unlike the old Render proxy, these functions don't need a `FIREBASE_SERVICE_ACCOUNT_KEY` secret at all — Cloud Functions running inside your own Firebase project already have Admin SDK access implicitly.
6. **Provision your admin account and rosters** — see **Provisioning accounts** above.

Until steps 1, 3, and 5 are done, sign-in will fail (step 1), every read/write will be rejected (step 3), or the Admin tab's participant tools and AI audits will fail (step 5) even for correctly-provisioned accounts.

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

The Gemini key and Admin SDK access used to live in a second Render service (`audit-proxy/`) — that's been retired in favor of Cloud Functions, deployed straight into the Firebase project instead of a separately-billed server. See **One-time setup still needed** and **AI proof-photo audits** below.

## AI proof-photo audits (admin)

In the Admin tab, "🎲 Randomly select someone to audit" opens a participant's detail view. For any week with both a proof photo and logged daily steps, an admin can click **🤖 Check with AI**: it sends that week's photo and the person's self-reported daily step counts to Gemini, asks it to read whatever step counts/dates the photo actually shows, and flags any date where the photo and the claim don't line up. After reviewing (AI-assisted or just by eye), an admin sets that week's status to **Verified**, **Needs further verification**, or **Rejected** (or **Clear** to reset it back to pending) — the resulting colored pill (Excel's classic Good/Bad/Neutral cell colors, plus grey for pending) shows up next to that week everywhere it's displayed: the participant table, the detail modal, and on the participant's own "My trail" page once that week is locked.

The Admin tab also has a **Proof photos** panel listing every uploaded proof photo across all participants and weeks, with an **Export all proof (ZIP)** button that bundles them all into one download (`name_weekN.jpg`).

This talks to Gemini through the `auditPhoto` Cloud Function in `functions/`, **not** directly from the browser — the Gemini key must never end up in `index.html` or this git repo, since the repo is public. See **Security model** for why.

### Deploying the Cloud Functions

Covered in **One-time setup still needed** above (upgrade to Blaze, then `npx firebase-tools deploy --only functions`). A few notes specific to this feature:

- `auditPhoto` only requires that the caller be signed in (the callable-functions SDK verifies their Firebase ID token automatically) — no admin check for that one. `addParticipant`, `deleteParticipant`, and `importRoster` additionally require a live Firestore lookup confirming `role: 'admin'` for the caller — see `functions/index.js`.
- Unlike the old Render proxy, there's no CORS allowlist or `PROXY_BASE_URL` to keep in sync — callable functions are invoked through the Firebase SDK (`httpsCallable`), which already knows which project it's talking to.
- **About the Gemini key you shared in this chat:** treat any key pasted directly into a conversation as already semi-exposed — I'd recommend generating a fresh key in Google AI Studio and using that one for the `GEMINI_API_KEY` secret instead of reusing the one from this conversation.

## Local development

No build step — just open `index.html` in a browser, or serve the folder locally (e.g. `npx serve .`). Firestore reads/writes and sign-in all work against the same live Firebase project, so treat local runs as touching real data — sign in with an account created via `/scripts`.

## Security model (why the rules are shaped this way)

This is an internal team-activity tool, not a system handling sensitive personal or financial data, so the rules favor "simple" over heavyweight infrastructure — but account creation/deletion and the Gemini key both still need code that never runs in the browser, which is what `functions/` is for:

- **Accounts and profiles can only ever be created or deleted via the Admin SDK** — either through `/scripts` run locally, or through the `addParticipant`/`deleteParticipant`/`importRoster` Cloud Functions, both of which bypass `firestore.rules` entirely. Client-side `create` on `users` and `teams` is hard-disabled (`allow create: if false;`), so there's no path to a self-registered account even by calling Firestore directly.
- **The admin Cloud Functions are the one place a compromised caller could do real damage**: they run with full Admin SDK access — read/write/delete over the *entire* Firebase project, not just this app's data. Callable functions verify the caller's Firebase ID token automatically (Firebase's SDK does this before your code even runs), and each admin function additionally does a live Firestore lookup confirming that uid has `role: 'admin'` — so only an actual admin account (not just any signed-in participant) can reach them. This is a deliberate tradeoff: the alternative (`/scripts`, run locally) keeps Admin SDK access off any always-on service entirely, at the cost of needing terminal access for every change. `scripts/` is kept as a fallback either way.
- **Roles** can only be changed by an existing admin — enforced in `firestore.rules`, not just the UI.
- **Bonus challenges and challenge config** (start date, step limits) are admin-write-only.
- **Steps** (`days`, `weekProof`) can be written by their own owner or an admin (admin access is used by the "reset challenge" feature). The `verified` audit stamp is the one exception carved out of "owner can write their own doc": only an admin can ever set it, enforced in `firestore.rules` — a participant can't self-verify even by calling Firestore directly, bypassing the UI entirely.
- **Teams are updatable** (not creatable) by any signed-in participant once they exist, since leaving/removing a teammate mutate the shared team document and there's no backend to arbitrate that. The practical risk is a participant mischievously editing another team's roster — annoying, not sensitive, and easy for an admin to fix.
- **The Gemini key** lives only in Secret Manager, injected into the `auditPhoto` Cloud Function at runtime, never in the static site's source. `auditPhoto` only requires a valid Firebase Auth ID token (any signed-in participant), not admin — the AI-audit feature itself is admin-only in the UI, but the function's blast radius if misused is "burn some Gemini quota," not "touch the database."
