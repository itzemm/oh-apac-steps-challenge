#!/usr/bin/env node
// Renames a team and regenerates every member's login to match — usernames
// are `TeamName_PersonName` (see lib/naming.js), so a team rename alone
// would leave everyone logging in under a name that no longer matches what
// they see in the app. For each member this resets their email/username AND
// their password back to that new username (same "password = username"
// convention as import-roster.js/reset-password.js), and flags their
// profile to show the change-password reminder again.
//
// The team's Firestore document id is NOT changed (only its `name` field) —
// that id is never shown to anyone, and changing it would mean migrating
// every bonus challenge's `completed`/`submissions`/`reviews` entries and
// any bonusProofs/{teamId} doc that reference it by id. Safe to leave alone.
//
// Usage: node rename-team.js "<old team name>" "<new team name>" [--yes]
//
// This changes real people's logins — asks for confirmation unless --yes is
// passed, and prints the new username/password for each member so you can
// redistribute them.

import readline from 'node:readline';
import { initAdmin } from './lib/firebase-admin-init.js';
import { toUsername, usernameToEmail } from './lib/naming.js';

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim().toLowerCase() === 'yes'); });
  });
}

async function main() {
  const oldName = process.argv[2];
  const newName = process.argv[3];
  const skipConfirm = process.argv.includes('--yes');
  if (!oldName || !newName) {
    console.error('Usage: node rename-team.js "<old team name>" "<new team name>" [--yes]');
    process.exit(1);
  }

  const { auth, db } = initAdmin();
  const teamsSnap = await db.collection('teams').where('name', '==', oldName).get();
  if (teamsSnap.empty) { console.error(`No team found with name "${oldName}".`); process.exit(1); }
  if (teamsSnap.size > 1) { console.error(`More than one team is named "${oldName}" — rename them directly in Firestore instead.`); process.exit(1); }
  const teamDoc = teamsSnap.docs[0];
  const team = teamDoc.data();
  const members = team.members || [];

  const plan = [];
  for (const uid of members) {
    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) { console.warn(`  skipping ${uid}: no profile found.`); continue; }
    const profile = userSnap.data();
    const newUsername = toUsername(newName, profile.name);
    const newEmail = usernameToEmail(newUsername);
    plan.push({ uid, personName: profile.name, newUsername, newEmail });
  }

  console.log(`Team "${oldName}" -> "${newName}": ${plan.length} member(s) will get a new username and password.`);
  plan.forEach(p => console.log(`  ${p.personName}: ${p.newUsername} (password: ${p.newUsername})`));

  if (!skipConfirm) {
    const ok = await confirm('This changes real logins for everyone listed above — their old username/password will stop working. Type "yes" to confirm: ');
    if (!ok) { console.log('Cancelled — nothing was changed.'); process.exit(0); }
  }

  for (const p of plan) {
    await auth.updateUser(p.uid, { email: p.newEmail, password: p.newUsername });
    await db.collection('users').doc(p.uid).update({ email: p.newEmail, mustChangePassword: true });
    console.log(`  Updated login for ${p.personName}.`);
  }
  await teamDoc.ref.update({ name: newName });
  console.log(`\nTeam renamed to "${newName}". Redistribute the new username/password to each member above.`);
}

main().catch(e => { console.error(e); process.exit(1); });
