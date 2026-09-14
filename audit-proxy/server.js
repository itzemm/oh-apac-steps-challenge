// Tiny proxy so the Gemini API key never has to ship to the browser.
//
// The static site (index.html) POSTs a proof photo + the participant's
// claimed daily step counts to POST /api/audit, along with the caller's own
// Firebase Auth ID token. This server verifies that token (proving the
// caller is a real signed-in member of the app — the same bar the app's
// Firestore rules use elsewhere), then calls Gemini server-side with the
// key from process.env.GEMINI_API_KEY, and returns Gemini's answer.
//
// GEMINI_API_KEY must be set as a real environment variable in Render's
// dashboard (or wherever this is deployed) — never commit it to source.

import express from 'express';
import cors from 'cors';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'oh-apac-steps-challenge';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ||
  'https://itzemm.github.io,http://localhost:8935,http://localhost:5173,http://localhost:3000'
).split(',').map(s => s.trim()).filter(Boolean);

// Firebase Auth ID tokens are signed with Google's rotating public keys —
// verifying them needs no secret of our own, just these published keys.
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

const app = express();

app.use(cors({
  origin(origin, callback) {
    // Allow same-origin/non-browser requests (no Origin header) and anything on the allowlist.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('Origin not allowed'));
  }
}));
app.use(express.json({ limit: '6mb' })); // compressed proof photos are small, but leave headroom

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
