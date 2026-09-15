// Proxy for two things the browser must never hold directly:
//   1. The Gemini API key (POST /api/audit) — any signed-in user may call this.
//   2. The Firebase Admin SDK service account (POST /api/admin/*) — full
//      read/write/delete over the whole Firebase project. Only callers whose
//      Firestore profile has role:'admin' may reach these routes.
//
// GEMINI_API_KEY and FIREBASE_SERVICE_ACCOUNT_KEY must both be set as real
// environment variables wherever this is deployed — never commit either to
// source. FIREBASE_SERVICE_ACCOUNT_KEY is the *entire contents* of the
// service-account JSON file, pasted as one env var value.

import express from 'express';
import cors from 'cors';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import admin from 'firebase-admin';
import { toUsername, slugTeamId, usernameToEmail } from './lib/naming.js';
import { ensureUser } from './lib/provisioning.js';

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'oh-apac-steps-challenge';
const MAX_TEAM_SIZE = 5;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://itzemm.github.io,http://localhost:8935,http://localhost:5173,http://localhost:3000'
).split(',').map(s => s.trim()).filter(Boolean);

// Firebase Auth ID tokens are signed with Google's rotating public keys —
// verifying them needs no secret of our own, just these published keys.
// Used for /api/audit, which only needs "is this a real signed-in user?".
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);
async function verifyFirebaseIdToken(idToken) {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
    audience: FIREBASE_PROJECT_ID
  });
  return payload; // payload.sub is the Firebase uid
}

// Lazily initialized: only /api/admin/* routes need this, and it should
// fail loudly on first use rather than crash the whole server at boot if
// the env var is briefly missing during setup.
let adminApp = null;
function getAdmin() {
  if (adminApp) return adminApp;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw Object.assign(new Error('Server is missing FIREBASE_SERVICE_ACCOUNT_KEY.'), { publicStatus: 500 });
  const serviceAccount = JSON.parse(raw);
  adminApp = admin.initializeApp({ credential: admin.credential.cert(serviceAccount) }, 'admin-routes');
  return adminApp;
}

// Verifies the caller's ID token via the Admin SDK (stronger than the JWKS
// check above — it also confirms the token wasn't issued for a disabled
// user) and requires their Firestore profile to have role:'admin'.
async function requireAdmin(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: 'Missing sign-in token.' });

    const app = getAdmin();
    const decoded = await admin.auth(app).verifyIdToken(idToken);
    const userDoc = await admin.firestore(app).collection('users').doc(decoded.uid).get();
    if (!userDoc.exists || userDoc.data().role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    req.adminUid = decoded.uid;
    req.fsAuth = admin.auth(app);
    req.fsDb = admin.firestore(app);
    next();
  } catch (e) {
    res.status(e.publicStatus || 401).json({ error: e.publicStatus ? e.message : 'Invalid or expired sign-in token.' });
  }
}

const app = express();

app.use(cors({
  origin(origin, callback) {
    // Allow same-origin/non-browser requests (no Origin header) and anything on the allowlist.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Origin not allowed'));
  }
}));
app.use(express.json({ limit: '6mb' })); // compressed proof photos / roster CSVs are small, but leave headroom

app.get('/', (req, res) => {
  res.send('OH APAC Steps Challenge — audit proxy is running.');
});

app.post('/api/audit', async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(500).json({ error: 'Server is missing GEMINI_API_KEY.' });
    }

    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: 'Missing sign-in token.' });
    await verifyFirebaseIdToken(idToken); // throws if invalid/expired

    const { imageBase64, mimeType, prompt } = req.body || {};
    if (!imageBase64 || !prompt) {
      return res.status(400).json({ error: 'Missing imageBase64 or prompt.' });
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
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
      return res.status(502).json({ error: data?.error?.message || 'Gemini request failed.' });
    }

    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    res.json({ raw: text });
  } catch (e) {
    const isTokenError = typeof e?.code === 'string' && e.code.startsWith('ERR_JW');
    const status = isTokenError ? 401
      : e?.message === 'Origin not allowed' ? 403
      : 500;
    const publicMessage = isTokenError ? 'Invalid or expired sign-in token.' : (e?.message || 'Unexpected error.');
    res.status(status).json({ error: publicMessage });
  }
});

// ---------- Admin-only participant management ----------

app.post('/api/admin/add-participant', requireAdmin, async (req, res) => {
  try {
    const teamName = (req.body?.teamName || '').trim();
    const personName = (req.body?.personName || '').trim();
    const makeCaptain = !!req.body?.captain;
    if (!teamName || !personName) {
      return res.status(400).json({ error: 'teamName and personName are required.' });
    }

    const teamId = slugTeamId(teamName);
    const teamRef = req.fsDb.collection('teams').doc(teamId);
    const teamSnap = await teamRef.get();
    const existingMembers = teamSnap.exists ? (teamSnap.data().members || []) : [];

    if (existingMembers.length >= MAX_TEAM_SIZE) {
      return res.status(409).json({ error: `Team "${teamName}" already has ${MAX_TEAM_SIZE} members (the max).` });
    }

    const username = toUsername(teamName, personName);
    const { uid, created } = await ensureUser(req.fsAuth, req.fsDb, { name: personName, username, teamId, role: 'user' });

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

    res.json({ username, password: created ? username : null, alreadyExisted: !created, message });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not add participant.' });
  }
});

app.post('/api/admin/delete-participant', requireAdmin, async (req, res) => {
  try {
    const username = (req.body?.username || '').trim();
    if (!username) return res.status(400).json({ error: 'username is required.' });

    const email = usernameToEmail(username);

    let userRecord;
    try {
      userRecord = await req.fsAuth.getUserByEmail(email);
    } catch (e) {
      if (e.code === 'auth/user-not-found') return res.status(404).json({ error: `No account found for username "${username}".` });
      throw e;
    }
    const uid = userRecord.uid;

    const userRef = req.fsDb.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const profile = userSnap.exists ? userSnap.data() : null;
    let teamMessage = '';

    if (profile && profile.teamId) {
      const teamRef = req.fsDb.collection('teams').doc(profile.teamId);
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

    await req.fsAuth.deleteUser(uid);
    if (userSnap.exists) await userRef.delete();
    await req.fsDb.collection('steps').doc(uid).delete().catch(() => {});

    res.json({ message: `Deleted ${username}.${teamMessage}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not delete participant.' });
  }
});

app.post('/api/admin/import-roster', requireAdmin, async (req, res) => {
  try {
    const csvText = req.body?.csvText;
    if (!csvText || typeof csvText !== 'string') return res.status(400).json({ error: 'csvText is required.' });

    const rows = csvText.split(/\r?\n/).filter(l => l.trim() !== '').map(l => l.split(',').map(c => c.trim()));
    if (!rows.length) return res.status(400).json({ error: 'CSV is empty.' });
    const header = rows[0].map(h => h.toLowerCase());
    const col = name => header.indexOf(name);
    const idx = { team: col('team name'), captain: col('captain'), m1: col('member 1'), m2: col('member 2'), m3: col('member 3'), m4: col('member 4') };
    if (idx.team === -1 || idx.captain === -1) {
      return res.status(400).json({ error: 'CSV must have "Team Name" and "Captain" columns (Member 1-4 optional).' });
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
      const teamRef = req.fsDb.collection('teams').doc(teamId);
      const uids = [];

      for (const personName of memberNames) {
        const username = toUsername(teamName, personName);
        const { uid, created } = await ensureUser(req.fsAuth, req.fsDb, { name: personName, username, teamId, role: 'user' });
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

    res.json({ credentials, skipped });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not import roster.' });
  }
});

// Catches errors thrown by middleware (e.g. the CORS origin check above)
// before they ever reach a route handler's own try/catch — without this,
// Express's default handler would leak a stack trace to the client.
app.use((err, req, res, next) => {
  if (err && err.message === 'Origin not allowed') {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Unexpected server error.' });
});

app.listen(PORT, () => {
  console.log(`Audit proxy listening on port ${PORT}`);
});
