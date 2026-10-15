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

// From the original spreadsheet, in order. Team26 (TBDTeam2) and Team27
// (TBDName) are deliberately absent — they were excluded from the import.
const NAME_TO_INDEX = {
  AliensWalking: 1, ASCteam: 2, BEReadySetGo: 3, Beginnersluck: 4, BOBOGO: 5,
  BomberGirl: 6, Breakaleg: 7, CoffeeBlazer: 8, FeetFleet: 9, HeaWeGo: 10,
  Marunouchine: 11, MilesAhead: 12, OHSydneyTeam: 13, OhhWalkers: 14,
  OHttersWalkers: 15, OneTeamOneDirectionEndlessSteps: 16, OtterlyOHmazing: 17,
  RedHotChilliSteppers: 18, RegionalWealthnessChampions: 19, Skywalker: 20,
  SoleMates: 21, SOWDhurandhar: 22, StepUpSquad: 23, Stepswithoutborders: 24,
  MaxWalkstappen: 25, TeamFSO: 28, TeamTaiwan: 29, TheStepHustlers: 30,
  TheWonderWalkers: 31, WAE: 32, Walkaholics: 33, WeThoughtthiswasOptional: 34
};

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
