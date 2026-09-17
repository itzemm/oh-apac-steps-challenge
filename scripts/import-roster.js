#!/usr/bin/env node
// Bulk-provisions team rosters: for every person in roster.csv, creates a
// Firebase Auth account (username + a temporary password equal to the
// username) and the matching Firestore users/{uid} + teams/{teamId} docs,
// fully assigned — no further signup step needed. Safe to re-run: existing
// accounts/profiles/teams are left alone or merged, never duplicated. Note
// this script only ever adds/merges — it doesn't unassign people missing
// from the CSV the way the Admin tab's "Sync the full roster" does.
//
// Usage: node import-roster.js roster.csv
// CSV columns, in this exact order (no header row needed — one is tolerated
// and skipped if the first cell is literally "Team Name"): Team Name,
// Captain, Member 2, Member 3, Member 4, Member 5 — blank cells for a team
// with fewer than 5 people.

import fs from 'node:fs';
import path from 'node:path';
import { initAdmin } from './lib/firebase-admin-init.js';
import { toUsername, slugTeamId } from './lib/naming.js';
import { ensureUser } from './lib/provisioning.js';

const MAX_TEAM_SIZE = 5;

function parseCsv(text) {
  return text
    .split(/\r?\n/)
    .filter(line => line.trim() !== '')
    .map(line => line.split(',').map(cell => cell.trim()));
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node import-roster.js <roster.csv>');
    process.exit(1);
  }

  const { auth, db } = initAdmin();
  const rows = parseCsv(fs.readFileSync(path.resolve(csvPath), 'utf8'));
  const dataRows = (rows[0][0] || '').toLowerCase() === 'team name' ? rows.slice(1) : rows;

  const credentials = [];
  let skipped = 0;

  for (const cells of dataRows) {
    const teamName = (cells[0] || '').trim();
    if (!teamName) continue;
    const memberNames = [cells[1], cells[2], cells[3], cells[4], cells[5]]
      .map(c => (c || '').trim())
      .filter(Boolean);

    if (!memberNames.length) { console.warn(`Skipping "${teamName}": no captain given.`); skipped++; continue; }
    if (memberNames.length > MAX_TEAM_SIZE) {
      console.warn(`Skipping "${teamName}": ${memberNames.length} people listed, max is ${MAX_TEAM_SIZE} (captain + 4 members). Fix the CSV and re-run.`);
      skipped++;
      continue;
    }

    console.log(`Team: ${teamName}`);
    const teamId = slugTeamId(teamName);
    const teamRef = db.collection('teams').doc(teamId);

    const uids = [];
    for (const personName of memberNames) {
      const username = toUsername(teamName, personName);
      const uid = await ensureUser(auth, db, { name: personName, username, teamId, role: 'user' });
      uids.push(uid);
      credentials.push({ team: teamName, name: personName, username, password: username });
    }

    const existingTeam = await teamRef.get();
    if (!existingTeam.exists) {
      await teamRef.set({ id: teamId, name: teamName, captainUid: uids[0], members: uids, createdAt: new Date().toISOString() });
    } else {
      const merged = Array.from(new Set([...(existingTeam.data().members || []), ...uids]));
      await teamRef.update({ members: merged });
    }
  }

  if (credentials.length) {
    const outPath = path.resolve('generated-credentials.csv');
    const csvOut = ['Team,Name,Username,Initial Password']
      .concat(credentials.map(c => `${c.team},${c.name},${c.username},${c.password}`))
      .join('\n');
    fs.writeFileSync(outPath, csvOut);
    console.log(`\nWrote ${credentials.length} account(s) to ${outPath}.`);
    console.log('Distribute these to each person — the app shows each of them a reminder to change their password.');
    console.log('Delete generated-credentials.csv once distributed; it holds plaintext initial passwords.');
  }
  if (skipped) console.log(`\n${skipped} team row(s) skipped — see warnings above.`);
}

main().catch(e => { console.error(e); process.exit(1); });
