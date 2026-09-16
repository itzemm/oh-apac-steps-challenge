# OH APAC Steps Challenge

A single-file web app for running a team steps challenge — daily step logging, weekly proof photos, teams, a leaderboard, bonus challenges, and an admin console. There's no self-service sign-up: every account (username, password, profile, and team) is provisioned ahead of time by an admin, either from the Admin tab or by running the scripts in `/scripts`, and admins can promote/demote other users from the Admin tab. Admins can also randomly audit a participant's proof photos with AI and set each week's review status. The whole thing runs with **no backend and no billing account anywhere** — see **How it's built** and **Security model** for how that works.

The Leaderboard tab defaults to team rankings — top 3 teams on a podium (varying heights), the rest in a compact expandable list — with a toggle to switch the same layout to individual rankings. Inside "My team," members race each other for the current week (Start → Finish), each otter's position set by their own share of that week's top walker.

Live sites:
- GitHub Pages: **https://itzemm.github.io/oh-apac-steps-challenge/**
- Render: set up per **Deploying on Render.com** below.

## How it's built

- `index.html` — the entire app (markup, styles, and JS in one file, no build step, no server).
- `assets/otters/` — the otter mascot artwork. One otter design is the "individual" racer, another the "team" racer; both appear as the header logo, the login screen, and — on the Leaderboard tab — a "🏁 The Race" section where each person/team gets its own lane and their otter's position is driven live by their current step total relative to the group leader. Also rides the current week's dot on the "My trail" progress line.
- Auth: Firebase Authentication, Email/Password only — but there's no password sign-up form in the app. A "username" like `trail-blazers_alice-tan` is really the local part of a synthetic email (`...@ohapac.local`); accounts only ever get created by an admin, either from the Admin tab or by `/scripts` run locally.
- Data: Cloud Firestore, with these collections:
  - `config/main` — challenge name, start date, number of weeks, optional weekly step limit.
  - `users/{uid}` — one profile per account, keyed by Firebase Auth uid (`name`, `email` — the synthetic one, `country`, `provider: 'password'`, `role: 'admin'|'user'`, `teamId`, `mustChangePassword`).
  - `teams/{teamId}` — `name`, `captainUid`, `members: [uid, ...]`.
  - `bonus/{bonusId}` — admin-authored bonus challenges and who/which team has been awarded them. In the Admin tab, each challenge's award list gets a name filter once there are more than 8 people/teams to scroll through.
  - `steps/{uid}` — each user's daily step counts, weekly proof-photo (compressed, stored inline as a JPEG data URL), and `verified: { [weekIndex]: { status: 'verified'|'rejected'|'needs_review', verifiedBy, verifiedByName, verifiedAt } }` — no entry for a week means it hasn't been reviewed yet ("pending"). Set only by an admin, from the participant's detail modal.
- `firestore.rules` — access rules (see **Security model** below). This is what actually gates who can create accounts/teams, not any server.
- No server, no Cloud Functions, no paid tier of anything. Admin actions that in a bigger app would go through a backend instead run either straight from the browser (add/import participants — see **Provisioning accounts**) or from an admin's own machine via `/scripts` (deleting a participant — see **Security model** for why that one specifically can't be done from a webpage). The one secret this app has (the Gemini API key, for AI photo audits) is a domain-restricted key embedded directly in `index.html` — see **AI proof-photo audits**.

## Provisioning accounts (admin bootstrap + rosters)

There's no self-service sign-up, and the whole thing runs on a simple two-phase model:

- **PRESTART** — before the actual start date has arrived (whether or not one is even set yet). There's no real personal data at stake, so team details (who exists, who's on what team) are fully editable and, deliberately, not precious.
- **START** — once the start date actually arrives. Team details freeze for the rest of the event: no more adding, re-keying, clearing, or reassigning. (Individual account actions unrelated to team structure — promoting/demoting a role, reviewing a week, running an AI audit — still work as normal.)

**From the Admin tab, prestart only:**
- **Add a participant** — person name, and optionally a team name (+ "make captain"). Leave the team blank to create just the account, and assign them to a team afterward from the **Team** dropdown next to their name in the Participants table. Creates their username and shows the initial password once. Runs entirely in the browser: it creates the Firebase Auth account on a second, throwaway app instance (so your own admin session is never touched — see `ensureUserClient()` in `index.html`), then writes their profile/team doc while you're still signed in as the admin. `firestore.rules`' `isAdmin()` check is what actually stops a non-admin from doing this, not anything about where the code runs.
- **Key in the team roster** — upload a CSV, or paste the list straight into the textbox, in this exact column order (no header row needed): `Team Name, Captain, Member 2, Member 3, Member 4, Member 5` (see `scripts/roster.example.csv`). **Every submission fully replaces the roster**: since prestart means there's no real data yet, re-keying wipes every existing participant's profile, step data, and team, and regenerates fresh accounts (new usernames, new passwords) from exactly what's in the list — nothing is merged or carried over between keyings. Gives you a downloadable CSV of every username/password afterward.
- **Clear all participants** — a button in the Participants panel that does the same wipe as the first half of a re-key, without needing to upload anything: every non-admin's profile, steps, and team, gone. Admin accounts are never touched by this or by keying in a roster, regardless of what's in the CSV.
- **The Team dropdown** next to each row in the Participants table lets you move any one person onto a different team, or off their team entirely, without redoing the whole list.
- Participants themselves also get a self-service safety net prestart: if someone has no team (never assigned, or removed by their captain), the "My team" tab shows them a list of existing teams (with live member counts) and a **Join** button. They can't create a *new* team that way — only an admin establishes team names.

Once the start date arrives, all of the above disappears from the UI and refuses if called directly — the Participants table's Team column becomes plain text, and "My team" no longer offers Join/Leave/Remove. The Participants table itself (and everything else in the Admin tab) is only ever visible to accounts with `role: admin` in the first place — the tab doesn't even render for anyone else.

There's no "delete a participant" button, prestart or otherwise — Firebase deliberately has no client-side way to delete *another* user's Auth account (only the Admin SDK can, or a user deleting themselves), so that can't run from a webpage no matter how it's hosted. In practice you shouldn't need it: fix the master list and re-key instead, which wipes and regenerates everyone anyway. A re-keyed or cleared person's old Auth login is left dangling in Firebase (harmless — it has no profile, so `handleAuthChange()` treats it as "not registered" and refuses to load the app for it) rather than actually deleted. If you genuinely need to delete a login outright, `scripts/delete-participant.js` is still there for that.

**From your own machine (the one thing that has to start here)** — creating your *first* admin account is a chicken-and-egg problem (the in-app tools above need you to already be signed in as an admin), so that one step still runs locally:

```bash
cd scripts
npm install
npm run setup-admin   # creates username admin_emily, role admin
```

Full details, including the CLI equivalents of add/import (useful as a
fallback, or for scripting) and `delete-participant.js` (for the rare case
you need to actually remove a login, not just unassign it), are in
**`scripts/README.md`**. Every created account's initial password is the
same string as its username; the app forces a password change on first
sign-in. `setup-admin` is also how you add *more* admins later — "the admin
group" is just everyone it's been run for, not a separate Firestore concept.

## One-time setup still needed

A few things only you can do from the Firebase dashboard — none of them need a billing account or credit card:

1. **Enable Email/Password sign-in**: Firebase Console → your project → Authentication → Sign-in method → enable Email/Password. (This replaced Google sign-in — accounts are admin-provisioned now, not self-serve, so there's no need to verify a real Google identity.)
2. **Create the Firestore database** if you haven't yet: Firebase Console → Firestore Database → Create database (Production mode, any region close to your team is fine).
3. **Deploy the security rules** in `firestore.rules` (they are not live until you deploy them):
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules
   ```
   Run this from inside this project folder. Do this again any time `firestore.rules` changes.
4. **Get a Gemini API key and lock it down**, then paste it into the `GEMINI_API_KEY` constant near the top of `index.html`'s script — see **AI proof-photo audits** below for exactly how to restrict it.
5. **Provision your admin account and rosters** — see **Provisioning accounts** above.

Until steps 1 and 3 are done, sign-in will fail (step 1) or every read/write will be rejected (step 3) even for correctly-provisioned accounts.

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

There used to be a second Render service (`audit-proxy/`) holding the Gemini key and Firebase Admin SDK access. That's gone — see **AI proof-photo audits** and **Provisioning accounts** for how those work now with no server at all.

## AI proof-photo audits (admin)

In the Admin tab, "🎲 Randomly select someone to audit" opens a participant's detail view. For any week with both a proof photo and logged daily steps, an admin can click **🤖 Check with AI**: it sends that week's photo and the person's self-reported daily step counts to Gemini, asks it to read whatever step counts/dates the photo actually shows, and flags any date where the photo and the claim don't line up. After reviewing (AI-assisted or just by eye), an admin sets that week's status to **Verified**, **Needs further verification**, or **Rejected** (or **Clear** to reset it back to pending) — the resulting colored pill (Excel's classic Good/Bad/Neutral cell colors, plus grey for pending) shows up next to that week everywhere it's displayed: the participant table, the detail modal, and on the participant's own "My trail" page once that week is locked.

The Admin tab also has a **Proof photos** panel listing every uploaded proof photo across all participants and weeks, with an **Export all proof (ZIP)** button that bundles them all into one download (`name_weekN.jpg`).

### The Gemini key lives directly in `index.html` — this is a deliberate tradeoff, not an oversight

There's no server anywhere in this app, and standing one up (Render, Cloud Functions) needs either a paid plan or a billing account on file — both ruled out for this project. So `runAiAudit()` calls Gemini straight from the browser, with the key sitting in the `GEMINI_API_KEY` constant near the top of `index.html`'s script. **Because this repo is public, that key is visible to anyone who looks at the source** — there's no way around that while keeping things server-free. What keeps this acceptable is locking the key down so a scraped copy can't do any real damage:

1. In [Google AI Studio](https://aistudio.google.com/apikey) or Google Cloud Console → APIs & Services → Credentials, generate a **new** key just for this app (don't reuse one from anywhere else, including any key ever pasted into a chat — treat those as already burned).
2. Edit the key's restrictions:
   - **API restrictions** → restrict it to just the **Generative Language API**.
   - **Application restrictions** → **Websites** → add the exact origins this app is served from (e.g. `https://itzemm.github.io/*` and your Render static site's URL). A key restricted this way will reject requests whose `Referer` isn't one of those origins, so it can't be lifted and reused from a random script or a different site.
3. In Google Cloud Console → APIs & Services → the Generative Language API → Quotas, set a low daily request cap — enough for your team's actual audit volume, not the default. This bounds the worst case (someone finds the key anyway and hammers it) to "burned quota for a day," not an open-ended bill.
4. Paste the restricted key into `GEMINI_API_KEY` in `index.html` and redeploy the static site.

This is the same "check with AI" feature as before — the only thing that changed is where the key sits and the restrictions around it. See **Security model** for the full reasoning.

## Local development

No build step — just open `index.html` in a browser, or serve the folder locally (e.g. `npx serve .`). Firestore reads/writes and sign-in all work against the same live Firebase project, so treat local runs as touching real data — sign in with an account created via `/scripts`.

## Security model (why the rules are shaped this way)

This is an internal team-activity tool, not a system handling sensitive personal or financial data, and there's a hard constraint on top of that: no billing account anywhere, which rules out Cloud Functions (needs Blaze) and effectively rules out an always-on paid server too. So the rules lean on what Firebase's client SDK and Firestore rules can enforce on their own, with two narrow exceptions carved out for the things that genuinely can't be done from a browser:

- **Creating an account/profile/team** happens client-side (Admin tab → Add/Bulk import, or the equivalent in `/scripts`) but is gated by `firestore.rules`' `isAdmin()` check on `users/{uid}` and `teams/{teamId}` — only a caller whose *own* Firestore profile already has `role: 'admin'` can write a new one. The Auth account itself is created via a second, throwaway Firebase app instance in the page (see `provisioningAuth` / `ensureUserClient()` in `index.html`) so creating someone else's login never disturbs the admin's own signed-in session.
- **A self-registered account can't do anything.** Because the public Firebase Web API key was always technically enough for anyone to call Firebase's own signup REST endpoint directly (this was true even before admin-provisioned accounts existed, and no amount of hiding client config prevents it — see below), the real protection was always downstream: `handleAuthChange()` checks for a matching Firestore profile on every sign-in, and treats "signed in but no profile" as "not registered," refusing to load the app. Since `users/{uid}` creation requires `isAdmin()`, a rogue self-registered Auth account can never get itself a profile, and so can never get past that screen.
- **Deleting a participant's Auth *login* is the one thing Firebase flatly does not allow from a browser** — its client SDK has no "delete another user's account" method at all, only the Admin SDK (server-only) or a user deleting themselves. No hosting choice changes this. That's why it's the one action still confined to `/scripts`. Deleting the Firestore *profile and step data* is a different matter and is allowed client-side for admins (`allow delete: if isAdmin()` on both `users/{uid}` and `steps/{uid}`) — that's what powers "Key in the team roster" and "Clear all participants" wiping and regenerating cleanly prestart. A wiped person's dangling Auth login is harmless: with no profile, `handleAuthChange()` treats them as unregistered.
- **Team-structure changes (creating, re-keying, clearing, assigning, joining, leaving) only work prestart.** This is enforced in the app's own logic (`isPrestart()` in `index.html`, checked at the top of every such method, not in `firestore.rules`) rather than in the database rules themselves — `firestore.rules` still technically permits an admin to write these fields at any time, matching how the rest of this app leans on client-side gating for anything that isn't a genuine security boundary (self-registration, non-admins editing roles, etc.). The practical risk of that gap is an admin's own browser console, not an outside attacker, so it wasn't worth the added rule complexity of threading challenge-start-date logic into `firestore.rules` itself.
- **Roles** can only be changed by an existing admin — enforced in `firestore.rules`, not just the UI. Admins can otherwise update any field on any `users/{uid}` doc (needed so client-side provisioning can reassign `teamId`), but a non-admin can only ever touch their own profile, and never their own `role`.
- **Bonus challenges and challenge config** (start date, step limits) are admin-write-only.
- **Steps** (`days`, `weekProof`) can be written by their own owner or an admin (admin access is used by the "reset challenge" feature). The `verified` audit stamp is the one exception carved out of "owner can write their own doc": only an admin can ever set it, enforced in `firestore.rules` — a participant can't self-verify even by calling Firestore directly, bypassing the UI entirely.
- **Teams are updatable** (not creatable) by any signed-in participant once they exist, since leaving/removing a teammate mutate the shared team document and there's no backend to arbitrate that. The practical risk is a participant mischievously editing another team's roster — annoying, not sensitive, and easy for an admin to fix.
- **The Gemini key** is visible in `index.html`'s source, by necessity — see **AI proof-photo audits** for the restrictions (domain lock, API restriction, quota cap) that keep a scraped copy from being useful for anything beyond a little wasted quota.
- **The Firebase Web config** (`apiKey`, `authDomain`, `projectId`, etc.) hardcoded in `index.html` was never a secret in the first place — Firebase's own docs are explicit about this, it's a public client identifier by design. This is *not* the same category of exposure as the Gemini key: Firebase access control lives entirely in `firestore.rules` and Auth settings, both of which are designed to be safe with a public API key. The Gemini API, by contrast, has no equivalent per-request authorization model — hence needing the manual referrer/quota restrictions instead.
