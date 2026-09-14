# OH APAC Steps Challenge

A single-file web app for running a team steps challenge — daily step logging, weekly proof photos, teams, a leaderboard, bonus challenges, and an admin console. Sign-in is Google or Microsoft only; a user's first sign-in creates their profile, and admins can promote/demote other users from the Admin tab.

Live site (after GitHub Pages finishes deploying): **https://itzemm.github.io/OH-APAC-steps-challenge/**

## How it's built

- `index.html` — the entire app (markup, styles, and JS in one file, no build step).
- Auth: Firebase Authentication, Google + Microsoft (`microsoft.com`) OAuth providers only.
- Data: Cloud Firestore, with these collections:
  - `config/main` — challenge name, start date, number of weeks, optional weekly step limit.
  - `users/{uid}` — one profile per signer-in, keyed by their Firebase Auth uid (`name`, `email`, `country`, `provider`, `role: 'admin'|'user'`, `teamId`).
  - `teams/{teamId}` — `name`, `captainUid`, `members: [uid, ...]`.
  - `bonus/{bonusId}` — admin-authored bonus challenges and who/which team has been awarded them.
  - `steps/{uid}` — each user's daily step counts and weekly proof-photo (compressed, stored inline as a JPEG data URL).
- `firestore.rules` — access rules (see **Security model** below).

## Admin bootstrap

The account with email **chenjiayi25@gmail.com** automatically becomes admin the first time it creates a profile. That admin can then promote or demote any other user from the **Admin** tab once they've signed up. There's no other way to become admin — this is enforced both client-side and in `firestore.rules`, so it can't be bypassed by calling Firestore directly.

## One-time setup still needed

This code is pushed and (once Pages finishes its first build) live, but a few things only you can do from the Firebase/Microsoft/GitHub dashboards:

1. **Enable Google sign-in** (if not already): Firebase Console → your project → Authentication → Sign-in method → enable Google.
2. **Enable Microsoft sign-in**: Authentication → Sign-in method → Add new provider → Microsoft. This needs an app registration in the [Microsoft Entra admin center](https://entra.microsoft.com) (Azure AD): register an app, copy its **Application (client) ID** and a **client secret** into the Firebase provider config, and add the redirect URI Firebase shows you to the Azure app's "Redirect URIs" list. [Firebase's guide](https://firebase.google.com/docs/auth/web/microsoft-oauth) walks through this.
3. **Create the Firestore database** if you haven't yet: Firebase Console → Firestore Database → Create database (Production mode, any region close to your team is fine).
4. **Deploy the security rules** in `firestore.rules` (they are not live until you deploy them):
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules
   ```
   Run this from inside this project folder.
5. **Authorize the live domain** for sign-in: Authentication → Settings → Authorized domains → add `itzemm.github.io`. (`localhost` is already authorized by default, for local testing.)

Until steps 1–5 are done, the sign-in buttons will show a "sign-in method isn't enabled yet" / "domain isn't authorized" message rather than actually failing silently.

## Local development

No build step — just open `index.html` in a browser, or serve the folder locally (e.g. `npx serve .`). Firestore reads/writes and Google/Microsoft sign-in all work against the same live Firebase project, so treat local runs as touching real data.

## Security model (why the rules are shaped this way)

This is an internal team-activity tool, not a system handling sensitive personal or financial data, so the rules favor "simple and client-only" over building a Cloud Functions backend:

- **Roles** can only be changed by an existing admin (or granted to the one hardcoded owner email on first sign-up) — enforced in `firestore.rules`, not just the UI.
- **Bonus challenges and challenge config** (start date, step limits) are admin-write-only.
- **Steps** can only be written by their own owner or an admin (used only for the "reset challenge" feature).
- **Teams** are writable by any signed-in participant, since joining/leaving/removing a teammate all mutate the shared team document and there's no backend to arbitrate that. The practical risk is a participant mischievously editing another team's roster — annoying, not sensitive, and easy for an admin to fix. If this app ever needs to be hardened beyond an internal team challenge, move team membership changes into a Cloud Function that validates the whole transaction server-side.
