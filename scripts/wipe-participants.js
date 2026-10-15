#!/usr/bin/env node
// Permanently wipes every non-admin account and its data: Firebase Auth
// logins, Firestore profiles, step/proof history, and every team. Admin
// accounts (role: 'admin') are left untouched, and so are config/main and
// the bonus collection's challenge definitions (title/points/dates) — only
// their per-person submissions/reviews are cleared, since those reference
// uids/teamIds this script is about to delete.
//
// Meant for a full reset before a fresh bulk import (see import-roster.js),
// not for removing one person — use delete-participant.js for that. This
// cannot be undone — asks for confirmation unless --yes is passed.
//
// Usage: node wipe-participants.js [--yes]

import readline from 'node:readline';
import { initAdmin } from './lib/firebase-admin-init.js';

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim().toLowerCase() === 'yes'); });
  });
}

async function main() {
  const skipConfirm = process.argv.includes('--yes');
  const { auth, db } = initAdmin();

  const usersSnap = await db.collection('users').get();
  const adminUids = new Set(usersSnap.docs.filter(d => d.data().role === 'admin').map(d => d.id));
  const nonAdminProfileUids = usersSnap.docs.filter(d => !adminUids.has(d.id)).map(d => d.id);

  // Auth accounts with no matching Firestore profile (e.g. left over from a
  // roster sync that wiped the profile but not the login) won't show up
  // above — list every Auth user directly too, so orphans get cleaned up.
  const allAuthUsers = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    allAuthUsers.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  const nonAdminAuthUids = allAuthUsers.map(u => u.uid).filter(uid => !adminUids.has(uid));

  const teamsSnap = await db.collection('teams').get();
  const allNonAdminUids = Array.from(new Set([...nonAdminProfileUids, ...nonAdminAuthUids]));

  console.log(`Found ${allNonAdminUids.length} non-admin account(s) (profile and/or Auth login) and ${teamsSnap.size} team(s). ${adminUids.size} admin account(s) will be kept.`);

  if (!allNonAdminUids.length && !teamsSnap.size) {
    console.log('Nothing to delete.');
    return;
  }

  if (!skipConfirm) {
    const ok = await confirm(
      `This will PERMANENTLY delete all ${allNonAdminUids.length} non-admin account(s), their profiles, step/proof history, and all ${teamsSnap.size} team(s). Admin accounts, config, and bonus challenge definitions are kept. This cannot be undone. Type "yes" to confirm: `
    );
    if (!ok) { console.log('Cancelled — nothing was deleted.'); process.exit(0); }
  }

  // Auth accounts, up to 1000 per call.
  for (let i = 0; i < nonAdminAuthUids.length; i += 1000) {
    const chunk = nonAdminAuthUids.slice(i, i + 1000);
    const result = await auth.deleteUsers(chunk);
    console.log(`Deleted ${result.successCount} Auth account(s)${result.failureCount ? `, ${result.failureCount} failed` : ''}.`);
  }

  // Firestore docs for every non-admin uid, plus every team.
  const deletes = [];
  for (const uid of allNonAdminUids) {
    deletes.push(db.collection('users').doc(uid).delete().catch(() => {}));
    deletes.push(db.collection('steps').doc(uid).delete().catch(() => {}));
    deletes.push(db.collection('proofs').doc(uid).delete().catch(() => {}));
    deletes.push(db.collection('bonusProofs').doc(uid).delete().catch(() => {}));
  }
  for (const teamDoc of teamsSnap.docs) {
    deletes.push(teamDoc.ref.delete());
    deletes.push(db.collection('bonusProofs').doc(teamDoc.id).delete().catch(() => {})); // team-challenge photos, keyed by teamId
  }
  await Promise.all(deletes);

  // Bonus challenges themselves stay, but their per-person submissions/
  // reviews now point at deleted uids/teamIds — clear just those two maps.
  const bonusSnap = await db.collection('bonus').get();
  await Promise.all(bonusSnap.docs.map(d => d.ref.update({ submissions: {}, reviews: {} }).catch(() => {})));

  console.log(`Deleted ${allNonAdminUids.length} account(s)/profile(s) and ${teamsSnap.size} team(s). Cleared submissions/reviews on ${bonusSnap.size} bonus challenge(s).`);
  console.log('Done. Run import-roster.js with your real roster next.');
}

main().catch(e => { console.error(e); process.exit(1); });
