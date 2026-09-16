// Cloud Functions replace the old Render "audit-proxy" service — same two
// jobs (hold the Gemini key, hold Admin SDK access), but deployed inside the
// Firebase project instead of a separately-hosted Node server. Callable
// functions verify the caller's Firebase ID token automatically (no manual
// JWT/JWKS code needed), so request.auth is trustworthy by the time a
// handler runs.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import admin from 'firebase-admin';
import { toUsername, slugTeamId, usernameToEmail } from './lib/naming.js';
import { ensureUser } from './lib/provisioning.js';

admin.initializeApp();
const auth = admin.auth();
const db = admin.firestore();

setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const MAX_TEAM_SIZE = 5;

async function requireAdmin(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Missing sign-in token.');
  const userDoc = await db.collection('users').doc(request.auth.uid).get();
  if (!userDoc.exists || userDoc.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }
}

export const addParticipant = onCall(async (request) => {
  await requireAdmin(request);
  const teamName = (request.data?.teamName || '').trim();
  const personName = (request.data?.personName || '').trim();
  const makeCaptain = !!request.data?.captain;
  if (!teamName || !personName) {
    throw new HttpsError('invalid-argument', 'teamName and personName are required.');
  }

  const teamId = slugTeamId(teamName);
  const teamRef = db.collection('teams').doc(teamId);
  const teamSnap = await teamRef.get();
  const existingMembers = teamSnap.exists ? (teamSnap.data().members || []) : [];

  if (existingMembers.length >= MAX_TEAM_SIZE) {
    throw new HttpsError('failed-precondition', `Team "${teamName}" already has ${MAX_TEAM_SIZE} members (the max).`);
  }

  const username = toUsername(teamName, personName);
  const { uid, created } = await ensureUser(auth, db, { name: personName, username, teamId, role: 'user' });

  let message;
  if (!teamSnap.exists) {
    await teamRef.set({ id: teamId, name: teamName, captainUid: uid, members: [uid], createdAt: new Date().toISOString() });
    message = `Created new team "${teamName}" with ${personName} as captain.`;
  } else if (!existingMembers.includes(uid)) {
    const update = { members: [...existingMembers, uid] };
    if (makeCaptain) update.captainUid = uid;
    await teamRef.update(update);
    message = `Added ${personName} to "${teamName}"${makeCaptain ? ' as captain' : ''}.`;
  } else {
    message = `${personName} is already on "${teamName}".`;
  }

  return { username, password: created ? username : null, alreadyExisted: !created, message };
});

export const deleteParticipant = onCall(async (request) => {
  await requireAdmin(request);
  const username = (request.data?.username || '').trim();
  if (!username) throw new HttpsError('invalid-argument', 'username is required.');

  const email = usernameToEmail(username);

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (e) {
    if (e.code === 'auth/user-not-found') throw new HttpsError('not-found', `No account found for username "${username}".`);
    throw e;
  }
  const uid = userRecord.uid;

  const userRef = db.collection('users').doc(uid);
  const userSnap = await userRef.get();
  const profile = userSnap.exists ? userSnap.data() : null;
  let teamMessage = '';

  if (profile && profile.teamId) {
    const teamRef = db.collection('teams').doc(profile.teamId);
    const teamSnap = await teamRef.get();
    if (teamSnap.exists) {
      const team = teamSnap.data();
      const members = (team.members || []).filter(m => m !== uid);
      if (members.length === 0) {
        await teamRef.delete();
        teamMessage = ` Team "${team.name}" was deleted (no members left).`;
      } else {
        const captainUid = team.captainUid === uid ? members[0] : team.captainUid;
        await teamRef.update({ members, captainUid });
        teamMessage = ` Removed from team "${team.name}".`;
      }
    }
  }

  await auth.deleteUser(uid);
  if (userSnap.exists) await userRef.delete();
  await db.collection('steps').doc(uid).delete().catch(() => {});

  return { message: `Deleted ${username}.${teamMessage}` };
});

export const importRoster = onCall(async (request) => {
  await requireAdmin(request);
  const csvText = request.data?.csvText;
  if (!csvText || typeof csvText !== 'string') throw new HttpsError('invalid-argument', 'csvText is required.');

  const rows = csvText.split(/\r?\n/).filter(l => l.trim() !== '').map(l => l.split(',').map(c => c.trim()));
  if (!rows.length) throw new HttpsError('invalid-argument', 'CSV is empty.');
  const header = rows[0].map(h => h.toLowerCase());
  const col = name => header.indexOf(name);
  const idx = { team: col('team name'), captain: col('captain'), m1: col('member 1'), m2: col('member 2'), m3: col('member 3'), m4: col('member 4') };
  if (idx.team === -1 || idx.captain === -1) {
    throw new HttpsError('invalid-argument', 'CSV must have "Team Name" and "Captain" columns (Member 1-4 optional).');
  }

  const credentials = [];
  const skipped = [];

  for (const cells of rows.slice(1)) {
    const teamName = cells[idx.team];
    if (!teamName) continue;
    const memberNames = [idx.captain, idx.m1, idx.m2, idx.m3, idx.m4]
      .map(i => (i > -1 ? cells[i] : ''))
      .filter(n => n && n.trim());

    if (!memberNames.length) { skipped.push(`${teamName}: no captain given.`); continue; }
    if (memberNames.length > MAX_TEAM_SIZE) { skipped.push(`${teamName}: ${memberNames.length} people listed, max is ${MAX_TEAM_SIZE}.`); continue; }

    const teamId = slugTeamId(teamName);
    const teamRef = db.collection('teams').doc(teamId);
    const uids = [];

    for (const personName of memberNames) {
      const username = toUsername(teamName, personName);
      const { uid, created } = await ensureUser(auth, db, { name: personName, username, teamId, role: 'user' });
      uids.push(uid);
      if (created) credentials.push({ team: teamName, name: personName, username, password: username });
    }

    const existingTeam = await teamRef.get();
    if (!existingTeam.exists) {
      await teamRef.set({ id: teamId, name: teamName, captainUid: uids[0], members: uids, createdAt: new Date().toISOString() });
    } else {
      const merged = Array.from(new Set([...(existingTeam.data().members || []), ...uids]));
      await teamRef.update({ members: merged });
    }
  }

  return { credentials, skipped };
});

export const auditPhoto = onCall({ secrets: [GEMINI_API_KEY] }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Missing sign-in token.');

  const { imageBase64, mimeType, prompt } = request.data || {};
  if (!imageBase64 || !prompt) throw new HttpsError('invalid-argument', 'Missing imageBase64 or prompt.');

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY.value()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: mimeType || 'image/jpeg', data: imageBase64 } }
          ]
        }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' }
      })
    }
  );

  const data = await geminiRes.json();
  if (!geminiRes.ok) {
    throw new HttpsError('unavailable', data?.error?.message || 'Gemini request failed.');
  }

  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  return { raw: text };
});
