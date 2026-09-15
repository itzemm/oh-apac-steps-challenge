#!/usr/bin/env node
// Permanently removes one participant: deletes their Firebase Auth account,
// their Firestore profile, and their step/proof history, and takes them off
// their team (reassigning captain, or deleting the team if they were its
// only member). This cannot be undone — asks for confirmation unless --yes
// is passed.
//
// Usage: node delete-participant.js "<username>" [--yes]

import readline from 'node:readline';
import { initAdmin } from './lib/firebase-admin-init.js';
import { usernameToEmail } from './lib/naming.js';

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim().toLowerCase() === 'yes'); });
  });
}

async function main() {
  const username = process.argv[2];
  const skipConfirm = process.argv.includes('--yes');
  if (!username) {
    console.error('Usage: node delete-participant.js "<username>" [--yes]');
    process.exit(1);
  }

  const { auth, db } = initAdmin();
  const email = usernameToEmail(username);

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (e) {
    if (e.code === 'auth/user-not-found') { console.error(`No account found for username "${username}".`); process.exit(1); }
    throw e;
  }
  const uid = userRecord.uid;

  if (!skipConfirm) {
    const ok = await confirm(
      `This will PERMANENTLY delete ${username}'s login, profile, and all their step/proof history, and remove them from their team. This cannot be undone. Type "yes" to confirm: `
    );
    if (!ok) { console.log('Cancelled — nothing was deleted.'); process.exit(0); }
  }

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const profile = userSnap.exists ? userSnap.data() : null;

  if (profile && profile.teamId) {
    const teamRef = db.collection('teams').doc(profile.teamId);
    const teamSnap = await teamRef.get();
    if (teamSnap.exists) {
      const team = teamSnap.data();
      const members = (team.members || []).filter(m => m !== uid);
      if (members.length === 0) {
        await teamRef.delete();
        console.log(`Deleted team "${team.name}" (no members left).`);
      } else {
        const captainUid = team.captainUid === uid ? members[0] : team.captainUid;
        await teamRef.update({ members, captainUid });
        console.log(`Removed from team "${team.name}".`);
      }
    }
  }

  await auth.deleteUser(uid);
  console.log(`Deleted Auth account for ${username}.`);

  if (userSnap.exists) await userRef.delete();
  await db.collection('steps').doc(uid).delete().catch(() => {});
  console.log(`Deleted Firestore profile and step history for ${username}.`);
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
