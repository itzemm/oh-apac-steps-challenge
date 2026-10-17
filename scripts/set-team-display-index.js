#!/usr/bin/env node
// One-time fix: tags each already-imported team with the original "TeamN_"
// index from the roster spreadsheet (Steps_Challenge_Team.xlsx), so the
// Admin tab can show "Team1_AliensWalking" alongside the clean "AliensWalking"
// name participants see everywhere else — see adminTeamLabel() in index.html.
// Only needed once: import-roster.js never strips/adds this on its own, and
// a team created later (e.g. via "Add a participant") just won't have one,
// which the app treats as "no prefix to show".
//
// Usage: node set-team-display-index.js
//
// Non-destructive (only adds a field, never deletes/overwrites anything
// meaningful), so there's no confirmation prompt. Matches teams by their
// exact current `name` field. A name this script
// doesn't recognize (e.g. edited after import, or Team 26/27 once they get
// real names) is reported and left untouched — rerun is safe.

import { initAdmin } from './lib/firebase-admin-init.js';
import { NAME_TO_INDEX } from './lib/team-index-map.js';

async function main() {
  const { db } = initAdmin();
  const snap = await db.collection('teams').get();

  const toUpdate = [];
  const unmatched = [];
  snap.forEach(doc => {
    const name = doc.data().name;
    const index = NAME_TO_INDEX[name];
    if (index == null) { unmatched.push(name); return; }
    toUpdate.push({ ref: doc.ref, name, index });
  });

  console.log(`Found ${snap.size} team(s): ${toUpdate.length} match a known index, ${unmatched.length} don't.`);
  if (unmatched.length) console.log('Unmatched (left untouched):', unmatched.join(', '));
  if (!toUpdate.length) { console.log('Nothing to update.'); return; }

  const batch = db.batch();
  toUpdate.forEach(({ ref, index }) => batch.update(ref, { displayIndex: index }));
  await batch.commit();

  toUpdate.forEach(({ name, index }) => console.log(`  Team${index}_${name}`));
  console.log(`\nDone — tagged ${toUpdate.length} team(s).`);
}

main().catch(e => { console.error(e); process.exit(1); });
