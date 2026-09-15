#!/usr/bin/env node
// Bulk-provisions team rosters: for every person in roster.csv, creates a
// Firebase Auth account (username + a temporary password equal to the
// username) and the matching Firestore users/{uid} + teams/{teamId} docs,
// fully assigned — no further signup step needed. Safe to re-run: existing
// accounts/profiles/teams are left alone or merged, never duplicated.
//
// Usage: node import-roster.js roster.csv
// CSV columns (header row required): Team Name, Captain, Member 1, Member 2,
// Member 3, Member 4 — blank cells for a team with fewer than 5 people.

import fs from 'node:fs';
import path from 'node:path';
import { initAdmin } from './lib/firebase-admin-init.js';
import { toUsername, usernameToEmail, slugTeamId } from './lib/naming.js';

const MAX_TEAM_SIZE = 5;

function parseCsv(text) {
  return text
    .split(/\r?\n/)
    .filter(line => line.trim() !== '')
    .map(line => line.split(',').map(cell => cell.trim()));
}

async function ensureUser(auth, db, { name, username, teamId, role }) {
  const email = usernameToEmail(username);
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
    console.log(`  exists:  ${username} (${userRecord.uid}) — auth account left as-is`);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    userRecord = await auth.createUser({ email, password: username, displayName: name });
    console.log(`  created: ${username} (${userRecord.uid})`);
  }

  const userRef = db.collection('users').doc(userRecord.uid);
  const existing = await userRef.get();
  if (!existing.exists) {
    await userRef.set({
      name, email, country: '', provider: 'password', role,
      joinedAt: new Date().toISOString(), teamId, mustChangePassword: true
    });
  } else if (existing.data().teamId !== teamId) {
    await userRef.update({ teamId });
  }
  return userRecord.uid;
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: node import-roster.js <roster.csv>');
    process.exit(1);
  }

  const { auth, db } = initAdmin();
  const rows = parseCsv(fs.readFileSync(path.resolve(csvPath), 'utf8'));
  const header = rows[0].map(h => h.toLowerCase());
  const col = name => header.indexOf(name);
  const idx = {
    team: col('team name'),
    captain: col('captain'),
    m1: col('member 1'), m2: col('member 2'), m3: col('member 3'), m4: col('member 4')
  };
  if (idx.team === -1 || idx.captain === -1) {
    console.error('CSV must have "Team Name" and "Captain" columns (Member 1-4 optional).');
    process.exit(1);
  }

  const credentials = [];
  let skipped = 0;

  for (const cells of rows.slice(1)) {
    const teamName = cells[idx.team];
    if (!teamName) continue;
    const memberNames = [idx.captain, idx.m1, idx.m2, idx.m3, idx.m4]
      .map(i => (i > -1 ? cells[i] : ''))
      .filter(n => n && n.trim());

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
    console.log('Distribute these to each person — everyone is prompted to change their password on first login.');
    console.log('Delete generated-credentials.csv once distributed; it holds plaintext initial passwords.');
  }
  if (skipped) console.log(`\n${skipped} team row(s) skipped — see warnings above.`);
}

main().catch(e => { console.error(e); process.exit(1); });
