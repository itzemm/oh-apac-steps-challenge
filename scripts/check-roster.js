#!/usr/bin/env node
// Read-only sanity check: compares what's actually in Firestore against the
// full 34-team, 170-person roster this event expects (lib/master-roster.js),
// person by person -- not just team/member counts. Flags a missing team, a
// team name it doesn't recognize, a missing or unexpected person on an
// otherwise-known team, and anyone whose stored account email doesn't match
// the username their team+name should produce (so they'd be logging in
// wrong). Makes no changes.
//
// Usage: node check-roster.js

import { initAdmin } from './lib/firebase-admin-init.js';
import { NAME_TO_INDEX } from './lib/team-index-map.js';
import { MASTER_ROSTER } from './lib/master-roster.js';
import { toUsername, usernameToEmail } from './lib/naming.js';

async function main() {
  const { db } = initAdmin();
  const [teamsSnap, usersSnap] = await Promise.all([db.collection('teams').get(), db.collection('users').get()]);

  const usersById = {};
  usersSnap.forEach(d => { usersById[d.id] = d.data(); });
  const participantCount = Object.values(usersById).filter(u => u.role !== 'admin').length;

  const teamsByName = {};
  teamsSnap.forEach(d => { teamsByName[d.data().name] = { id: d.id, ...d.data() }; });

  console.log(`Found ${teamsSnap.size} team(s) and ${participantCount} non-admin participant(s). Expected 34 teams, 170 people.\n`);

  const expectedTeamNames = Object.keys(NAME_TO_INDEX);
  const foundTeamNames = new Set(Object.keys(teamsByName));
  const missingTeams = expectedTeamNames.filter(n => !foundTeamNames.has(n)).sort((a, b) => NAME_TO_INDEX[a] - NAME_TO_INDEX[b]);
  const unexpectedTeams = [...foundTeamNames].filter(n => !(n in NAME_TO_INDEX));

  if (missingTeams.length) {
    console.log('Missing team(s) — expected but not found in Firestore:');
    missingTeams.forEach(n => console.log(`  Team${NAME_TO_INDEX[n]}_${n}`));
  } else {
    console.log('All 34 expected teams are present by name.');
  }
  if (unexpectedTeams.length) {
    console.log('\nTeam(s) found with a name not in the expected list (typo, or a rename not yet reflected in lib/team-index-map.js):');
    unexpectedTeams.forEach(n => console.log(`  "${n}" (${(teamsByName[n].members || []).length} member(s))`));
  }

  // A uid listed as a member of two different teams would make both teams
  // "find" their expected person without anything actually being missing
  // from either team's own member-name check — the real gap only shows up
  // as a lower overall participant count. Catch that directly instead.
  const teamsByUid = {};
  for (const teamName of expectedTeamNames) {
    const team = teamsByName[teamName];
    if (!team) continue;
    (team.members || []).forEach(uid => {
      if (!teamsByUid[uid]) teamsByUid[uid] = [];
      teamsByUid[uid].push(teamName);
    });
  }
  const sharedUids = Object.entries(teamsByUid).filter(([, teams]) => teams.length > 1);
  if (sharedUids.length) {
    console.log('\nUid(s) listed as a member on more than one team (the real issue behind a lower total than expected, even if every team "checks out"):');
    sharedUids.forEach(([uid, teams]) => {
      const name = usersById[uid] ? usersById[uid].name : '(no profile)';
      console.log(`  ${uid} (${name}) is on: ${teams.join(', ')}`);
    });
  }

  let anyPersonIssue = sharedUids.length > 0;
  for (const teamName of expectedTeamNames) {
    const team = teamsByName[teamName];
    if (!team) continue; // already reported above as a missing team
    const expectedNames = MASTER_ROSTER[teamName] || [];
    const members = team.members || [];

    // A uid in team.members with no matching users/{uid} doc is a broken
    // reference — e.g. their Auth account and team slot were created but
    // their own profile write never completed. Report it explicitly instead
    // of silently dropping it, which would hide exactly this kind of gap.
    const orphanUids = members.filter(uid => !usersById[uid]);
    if (orphanUids.length) {
      anyPersonIssue = true;
      console.log(`\n${teamName}: ${orphanUids.length} member uid(s) with no matching profile: ${orphanUids.join(', ')}`);
    }

    const profiles = members.map(uid => usersById[uid]).filter(Boolean);
    const foundNames = new Set(profiles.map(p => p.name));

    const missingPeople = expectedNames.filter(n => !foundNames.has(n));
    if (missingPeople.length) {
      anyPersonIssue = true;
      console.log(`\n${teamName}: missing expected member(s): ${missingPeople.join(', ')}`);
    }

    for (const profile of profiles) {
      if (!expectedNames.includes(profile.name)) {
        anyPersonIssue = true;
        console.log(`\n${teamName}: has "${profile.name}", who isn't in the confirmed roster for this team`);
        continue;
      }
      const expectedUsername = toUsername(teamName, profile.name);
      const expectedEmail = usernameToEmail(expectedUsername);
      if (profile.email !== expectedEmail) {
        anyPersonIssue = true;
        console.log(`\n${teamName}: ${profile.name}'s account email is "${profile.email}", expected "${expectedEmail}" — their username should be "${expectedUsername}"`);
      }
    }
  }

  if (!missingTeams.length && !unexpectedTeams.length && !anyPersonIssue && participantCount === 170) {
    console.log('\nEverything checks out: 34 teams, 170 participants, correct usernames throughout.');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
