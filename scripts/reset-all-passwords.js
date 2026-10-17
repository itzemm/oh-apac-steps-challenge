#!/usr/bin/env node
// Resets every participant's password back to match their own username —
// the only way to get a complete, guaranteed-accurate username+password
// list again, since Firebase never exposes an existing password to anyone,
// admin included. Usernames/emails are left untouched; only the password
// changes, for anyone whose account has since diverged from "password =
// username" (because they logged in and changed it).
//
// Admin accounts are deliberately skipped: their username isn't reliably
// reconstructable the way a participant's TeamName_PersonName is (it's
// whatever was typed into setup-admin.js/"Create admin" at creation, not
// derived from any field still on the profile), so guessing wrong here
// risks locking an admin out. Reset a specific admin's password with
// reset-password.js "<username>" instead, or
// setup-admin.js <username> "<name>" --reset-password.
//
// Usage: node reset-all-passwords.js [--yes]
//
// This overwrites a real password for anyone who's already changed theirs
// — asks for confirmation unless --yes is passed. Writes
// all-credentials.csv (gitignored) with every username/password afterward.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { initAdmin } from './lib/firebase-admin-init.js';
import { toUsername } from './lib/naming.js';

function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => { rl.close(); resolve(answer.trim().toLowerCase() === 'yes'); });
  });
}

async function main() {
  const skipConfirm = process.argv.includes('--yes');
  const { auth, db } = initAdmin();

  const [usersSnap, teamsSnap] = await Promise.all([db.collection('users').get(), db.collection('teams').get()]);
  const teamsById = {};
  teamsSnap.forEach(d => { teamsById[d.id] = d.data(); });

  const plan = [];
  const skipped = [];
  usersSnap.forEach(d => {
    const u = d.data();
    if (u.role === 'admin') return; // see header comment
    const team = u.teamId ? teamsById[u.teamId] : null;
    if (!team) { skipped.push(u.name || d.id); return; }
    const username = toUsername(team.name, u.name);
    plan.push({ uid: d.id, team: team.name, name: u.name, username });
  });

  console.log(`${plan.length} participant(s) will have their password reset to match their username.`);
  if (skipped.length) console.log(`Skipped (no team, can't reconstruct a username): ${skipped.join(', ')}`);

  if (!skipConfirm) {
    const ok = await confirm('This overwrites the real password for anyone who already changed theirs. Type "yes" to confirm: ');
    if (!ok) { console.log('Cancelled — nothing was changed.'); process.exit(0); }
  }

  for (const p of plan) {
    await auth.updateUser(p.uid, { password: p.username });
    await db.collection('users').doc(p.uid).update({ mustChangePassword: true });
  }
  console.log(`Reset ${plan.length} password(s).`);

  const rows = [['Team', 'Name', 'Username', 'Password']]
    .concat(plan.map(p => [p.team, p.name, p.username, p.username]));
  const outPath = path.resolve('all-credentials.csv');
  fs.writeFileSync(outPath, rows.map(r => r.join(',')).join('\n'));
  console.log(`Wrote ${outPath}. Distribute these, then delete the file — plaintext passwords sitting on disk.`);
}

main().catch(e => { console.error(e); process.exit(1); });
