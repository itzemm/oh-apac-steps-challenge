#!/usr/bin/env node
// Adds one person to a team — creating the team if it doesn't exist yet.
// Same provisioning as import-roster.js, just for a single person instead
// of a whole CSV. Safe to re-run for the same name; won't duplicate them.
//
// Usage: node add-participant.js "<Team Name>" "<Person Name>" [--captain]

import { initAdmin } from './lib/firebase-admin-init.js';
import { ensureUser } from './lib/provisioning.js';
import { toUsername, slugTeamId } from './lib/naming.js';

const MAX_TEAM_SIZE = 5;

async function main() {
  const teamName = process.argv[2];
  const personName = process.argv[3];
  const makeCaptain = process.argv.includes('--captain');

  if (!teamName || !personName) {
    console.error('Usage: node add-participant.js "<Team Name>" "<Person Name>" [--captain]');
    process.exit(1);
  }

  const { auth, db } = initAdmin();
  const teamId = slugTeamId(teamName);
  const teamRef = db.collection('teams').doc(teamId);
  const teamSnap = await teamRef.get();
  const existingMembers = teamSnap.exists ? (teamSnap.data().members || []) : [];

  if (existingMembers.length >= MAX_TEAM_SIZE) {
    console.error(`Team "${teamName}" already has ${MAX_TEAM_SIZE} members (the max). Remove someone first.`);
    process.exit(1);
  }

  const username = toUsername(teamName, personName);
  const uid = await ensureUser(auth, db, { name: personName, username, teamId, role: 'user' });

  if (!teamSnap.exists) {
    await teamRef.set({ id: teamId, name: teamName, captainUid: uid, members: [uid], createdAt: new Date().toISOString() });
    console.log(`Created new team "${teamName}" with ${personName} as captain.`);
  } else if (!existingMembers.includes(uid)) {
    const update = { members: [...existingMembers, uid] };
    if (makeCaptain) update.captainUid = uid;
    await teamRef.update(update);
    console.log(`Added ${personName} to "${teamName}"${makeCaptain ? ' as captain' : ''}.`);
  } else {
    console.log(`${personName} is already on "${teamName}".`);
  }

  console.log(`\nUsername: ${username}`);
  console.log(`Initial password: ${username} (same as username — the app shows them a reminder to change it)`);
}

main().catch(e => { console.error(e); process.exit(1); });
