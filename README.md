# OH APAC Steps Challenge

A single-file web app for running a team steps challenge — daily step logging, weekly proof photos, teams, a leaderboard, bonus challenges, and an admin console. Sign-in is Google only; a user's first sign-in creates their profile, and admins can promote/demote other users from the Admin tab.

Live sites:
- GitHub Pages: **https://itzemm.github.io/oh-apac-steps-challenge/**
- Render: set up per **Deploying on Render.com** below.

## How it's built

- `index.html` — the entire app (markup, styles, and JS in one file, no build step, no server).
- Auth: Firebase Authentication, Google sign-in only.
- Data: Cloud Firestore, with these collections:
  - `config/main` — challenge name, start date, number of weeks, optional weekly step limit.
  - `users/{uid}` — one profile per signed-in user, keyed by their Firebase Auth uid (`name`, `email`, `country`, `provider`, `role: 'admin'|'user'`, `teamId`).
  - `teams/{teamId}` — `name`, `captainUid`, `members: [uid, ...]`.
  - `bonus/{bonusId}` — admin-authored bonus challenges and who/which team has been awarded them.
  - `steps/{uid}` — each user's daily step counts and weekly proof-photo (compressed, stored inline as a JPEG data URL).
- `firestore.rules` — access rules (see **Security model** below).

## Admin bootstrap

The account with email **chenjiayi25@gmail.com** automatically becomes admin the first time it creates a profile. That admin can then promote or demote any other user from the **Admin** tab once they've signed up. There's no other way to become admin — this is enforced both client-side and in `firestore.rules`, so it can't be bypassed by calling Firestore directly.

## One-time setup still needed

A few things only you can do from the Firebase dashboard:

1. **Enable Google sign-in** (if not already): Firebase Console → your project → Authentication → Sign-in method → enable Google.
2. **Create the Firestore database** if you haven't yet: Firebase Console → Firestore Database → Create database (Production mode, any region close to your team is fine).
3. **Deploy the security rules** in `firestore.rules` (they are not live until you deploy them):
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules
   ```
   Run this from inside this project folder.
4. **Authorize every domain the site is served from** for sign-in: Authentication → Settings → Authorized domains. Add:
   - `itzemm.github.io` (covers GitHub Pages)
   - your Render domain, e.g. `oh-apac-steps-challenge.onrender.com` (or your custom domain, once you have one)

   (`localhost` is already authorized by default, for local testing.)

Until steps 1–4 are done, the sign-in button will show a "sign-in method isn't enabled yet" / "domain isn't authorized" message rather than actually failing silently.

## Deploying on Render.com

This is a static site — no server, no build output, nothing to compile — so Render needs almost nothing from you.

**Option A — connect the repo in the Render dashboard:**
1. New → Static Site → connect the `oh-apac-steps-challenge` GitHub repo.
2. Build command: leave blank (or `echo "no build"`).
3. Publish directory: `.` (repo root — that's where `index.html` lives).
4. Create Static Site. Render gives you a URL like `https://oh-apac-steps-challenge.onrender.com`.

**Option B — Blueprint (Infrastructure as Code):** this repo already includes `render.yaml`. In the Render dashboard, New → Blueprint → select this repo, and Render reads `render.yaml` and creates the static site automatically with the settings above pre-filled.

### Environment variables to set in Render

**None are required.** This surprises people coming from apps with a backend, but it's correct here:

- The Firebase Web config (`apiKey`, `authDomain`, `projectId`, etc.) hardcoded in `index.html` is **not a secret** — Firebase's own docs are explicit about this. It's a public client identifier, safe to ship in source, the same way it's safe to view in any browser's dev tools on any Firebase web app. Actual access control lives in `firestore.rules` (who can read/write what) and Firebase Auth's authorized-domains list (who can even open a login popup) — not in hiding this config.
- This is a static site with no server process, so there is no `process.env` for a runtime environment variable to land in anyway. Render's env vars on a Static Site only affect the **build step**, and this site has no build step.

The only Render-side action item is step 4 above: add your Render URL to Firebase's authorized domains once you know it, or sign-in will fail with an "unauthorized domain" error.

## Local development

No build step — just open `index.html` in a browser, or serve the folder locally (e.g. `npx serve .`). Firestore reads/writes and Google sign-in all work against the same live Firebase project, so treat local runs as touching real data.

## Security model (why the rules are shaped this way)

This is an internal team-activity tool, not a system handling sensitive personal or financial data, so the rules favor "simple and client-only" over building a Cloud Functions backend:

- **Roles** can only be changed by an existing admin (or granted to the one hardcoded owner email on first sign-up) — enforced in `firestore.rules`, not just the UI.
- **Bonus challenges and challenge config** (start date, step limits) are admin-write-only.
- **Steps** can only be written by their own owner or an admin (used only for the "reset challenge" feature).
- **Teams** are writable by any signed-in participant, since joining/leaving/removing a teammate all mutate the shared team document and there's no backend to arbitrate that. The practical risk is a participant mischievously editing another team's roster — annoying, not sensitive, and easy for an admin to fix. If this app ever needs to be hardened beyond an internal team challenge, move team membership changes into a Cloud Function that validates the whole transaction server-side.
