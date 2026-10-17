#!/usr/bin/env node
// Read-only sanity check: compares what's actually in Firestore against the
// full 34-team, 170-person roster this event expects, and flags anything
// that doesn't line up -- a missing team, a team without exactly 5 members,
// or a team name that doesn't match any of the 34 expected ones (e.g. a
// typo, or one renamed without updating lib/team-index-map.js). Makes no
// changes.
//
// Usage: node check-roster.js

import { initAdmin } from './lib/firebase-admin-init.js';
import { NAME_TO_INDEX } from './lib/team-index-map.js';

async function main() {
  const { db } = initAdmin();
  const [teamsSnap, usersSnap] = await Promise.all([db.collection('teams').get(), db.collection('users').get()]);

  const participantCount = usersSnap.docs.filter(d => d.data().role !== 'admin').length;
  const teams = teamsSnap.docs.map(d => d.data());

  console.log(`Found ${teams.length} team(s) and ${participantCount} non-admin participant(s). Expected 34 teams, 170 people.\n`);

  const foundNames = new Set(teams.map(t => t.name));
  const expectedNames = Object.keys(NAME_TO_INDEX);
  const missing = expectedNames.filter(n => !foundNames.has(n)).sort((a, b) => NAME_TO_INDEX[a] - NAME_TO_INDEX[b]);
  const unexpected = teams.filter(t => !(t.name in NAME_TO_INDEX));
  const understaffed = teams.filter(t => (t.members || []).length !== 5);

  if (missing.length) {
    console.log('Missing team(s) — expected but not found in Firestore:');
    missing.forEach(n => console.log(`  Team${NAME_TO_INDEX[n]}_${n}`));
  } else {
    console.log('All 34 expected teams are present by name.');
  }

  if (unexpected.length) {
    console.log("\nTeam(s) found with a name not in the expected list (could be a typo, or a rename/new team not yet added to lib/team-index-map.js):");
    unexpected.forEach(t => console.log(`  "${t.name}" (${(t.members || []).length} member(s))`));
  }

  if (understaffed.length) {
    console.log("\nTeam(s) without exactly 5 members:");
    understaffed.forEach(t => console.log(`  ${t.name}: ${(t.members || []).length} member(s)`));
  }

  if (!missing.length && !unexpected.length && !understaffed.length && participantCount === 170) {
    console.log('\nEverything checks out: 34 teams, 170 participants, 5 members each.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
