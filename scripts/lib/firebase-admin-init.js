import admin from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Initializes the Firebase Admin SDK from a locally-held service account
// key. This key is never uploaded anywhere by these scripts — it's read
// once, from your own disk, for the duration of the command you run.
export function initAdmin() {
  if (admin.apps.length) {
    return { auth: admin.auth(), db: admin.firestore() };
  }

  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || path.resolve(__dirname, '..', 'service-account-key.json');
  if (!fs.existsSync(keyPath)) {
    console.error(`Service account key not found at ${keyPath}.`);
    console.error('Download one from Firebase Console → Project Settings → Service Accounts → Generate new private key,');
    console.error('save it as scripts/service-account-key.json (already gitignored — never commit it),');
    console.error('or point FIREBASE_SERVICE_ACCOUNT_KEY at wherever you saved it.');
    process.exit(1);
  }

  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  return { auth: admin.auth(), db: admin.firestore() };
}
