#!/usr/bin/env node
// Renames one participant's display name AND username/password, which are
// derived from TeamName_PersonName (see lib/naming.js) — doesn't touch
// anyone else on their team or the team's own name. For renaming the whole
// team, use rename-team.js instead.
//
// Usage: node rename-participant.js "<team name>" "<old name>" "<new name>" [--yes]
//
// Finds the member by matching their current profile name exactly against
// <old name> among that team's members. This changes a real login — asks
// for confirmation unless --yes is passed.

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
  const skipConfirm = process.argv.includes('--yes');
  const [teamName, oldName, newName] = process.argv.slice(2).filter(a => a !== '--yes');
  if (!teamName || !oldName || !newName) {
    console.error('Usage: node rename-participant.js "<team name>" "<old name>" "<new name>" [--yes]');
    process.exit(1);
  }

  const { auth, db } = initAdmin();
  const teamsSnap = await db.collection('teams').where('name', '==', teamName).get();
  if (teamsSnap.empty) { console.error(`No team found with name "${teamName}".`); process.exit(1); }
  if (teamsSnap.size > 1) { console.error(`More than one team is named "${teamName}" — handle this directly in Firestore instead.`); process.exit(1); }
  const team = teamsSnap.docs[0].data();

  let targetUid = null;
  for (const uid of team.members || []) {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists && snap.data().name === oldName) { targetUid = uid; break; }
  }
  if (!targetUid) { console.error(`No member named "${oldName}" found on team "${teamName}".`); process.exit(1); }

  const newUsername = toUsername(teamName, newName);
  const newEmail = usernameToEmail(newUsername);

  console.log(`${oldName} -> ${newName} on team "${teamName}": new username "${newUsername}" (password: ${newUsername}).`);
  if (!skipConfirm) {
    const ok = await confirm('This changes their login — their old username/password will stop working. Type "yes" to confirm: ');
    if (!ok) { console.log('Cancelled — nothing was changed.'); process.exit(0); }
  }

  await auth.updateUser(targetUid, { email: newEmail, password: newUsername, displayName: newName });
  await db.collection('users').doc(targetUid).update({ name: newName, email: newEmail, mustChangePassword: true });
  console.log(`Done. New username: ${newUsername} — password: ${newUsername}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
