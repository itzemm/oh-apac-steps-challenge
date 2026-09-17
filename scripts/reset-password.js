#!/usr/bin/env node
// Resets one person's password back to their username — for when they've
// forgotten it. Works for any existing account, participant or admin (for
// an admin specifically, setup-admin.js's --reset-password flag does the
// same thing while also making sure their profile stays role: 'admin').
//
// Usage: node reset-password.js "<username>"

import { initAdmin } from './lib/firebase-admin-init.js';
import { usernameToEmail } from './lib/naming.js';

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error('Usage: node reset-password.js "<username>"');
    process.exit(1);
  }

  const { auth, db } = initAdmin();
  const email = usernameToEmail(username);

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (e) {
    if (e.code === 'auth/user-not-found') { console.error(`No account found for username "${username}".`); process.exit(1); }
    throw e;
  }

  await auth.updateUser(userRecord.uid, { password: username });
  console.log(`Password for ${username} reset to "${username}" (same as the username).`);

  const userRef = db.collection('users').doc(userRecord.uid);
  const existing = await userRef.get();
  if (existing.exists) {
    await userRef.update({ mustChangePassword: true });
    console.log('The app will show them a reminder to change it on next login.');
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
