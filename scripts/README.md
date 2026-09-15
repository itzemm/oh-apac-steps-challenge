# Admin scripts

The site has no self-service sign-up: every account is provisioned ahead of
time by running these scripts locally. They use the **Firebase Admin SDK**,
which has full read/write/delete access to the entire Firebase project —
far more powerful than anything in the deployed app — so they're designed to
run from your own machine, once, per import. Nothing here runs on a server.

## One-time setup

1. **Get a service account key**: Firebase Console → ⚙️ Project Settings →
   Service Accounts → **Generate new private key**. This downloads a JSON
   file.
2. Save it as `scripts/service-account-key.json` (this exact path is already
   in `.gitignore` — it will never be committed). Treat this file like a
   master password to your entire Firebase project: don't email it, don't
   paste it anywhere, don't commit it under a different name.
3. Install dependencies:
   ```bash
   cd scripts
   npm install
   ```
4. **Enable Email/Password sign-in** in Firebase Console → Authentication →
   Sign-in method (this replaced Google sign-in — see the main README).

## Set up your own admin account

```bash
npm run setup-admin
```

Creates username `admin_emily` (role `admin`) with an initial password equal
to the username — sign in with that, and the app will immediately prompt you
to set a real password. To use a different username or add another admin
later, pass arguments:

```bash
node setup-admin.js admin_someone "Some One"
```

Running it again for a username that already exists leaves that account's
password untouched and just makes sure its profile has `role: 'admin'`.

## Import a team roster

1. Copy `roster.example.csv` to `roster.csv` and fill in real names. Columns:
   `Team Name, Captain, Member 1, Member 2, Member 3, Member 4` — leave
   later member columns blank for a team with fewer than 5 people (captain +
   up to 4 members is the app's team size limit).
2. Run:
   ```bash
   npm run import-roster -- roster.csv
   ```

For every person listed, this creates:
- A Firebase Auth account. Username is `TeamName_PersonName` (spaces become
  underscores), e.g. `Trail_Blazers_Alice_Tan`; the initial password is that
  same string.
- A Firestore `users/{uid}` profile, already in `role: 'user'` and already
  assigned to their team — `mustChangePassword: true`, so the app forces a
  password change on their first sign-in.
- A Firestore `teams/{teamId}` doc (or updates the existing one if you're
  re-running with more people for a team you already imported).

It's safe to re-run for the same CSV or an updated one — existing accounts
and profiles are detected and left alone (or merged into their team) rather
than duplicated.

**After running it**, the script writes `generated-credentials.csv` (also
gitignored) listing every username and initial password from that run.
Distribute these to each person, then **delete the file** — it's plaintext
passwords sitting on disk.

## Why a local script instead of an "upload roster" button on the website

Bulk-creating login accounts needs the Admin SDK's service account key. That
key can never be shipped to a browser (anyone could extract it from page
source) and ideally shouldn't sit as a permanent environment variable on a
server either, since a compromise there would expose everything in the
Firebase project — not just this app's data. Running it locally, only when
you actually need to import a roster, keeps that key off any 24/7-running
service entirely.
