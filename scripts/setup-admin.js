#!/usr/bin/env node
// Creates (or promotes) an admin account. Re-run this any time you need to
// add another admin — it's what "the admin group" is: everyone this script
// has been run for with role 'admin', not a separate Firestore concept.
//
// Usage: node setup-admin.js [username] [display name]
// Defaults to username "admin_emily", display name "Emily".
// The initial password is the same as the username — you'll be prompted to
// change it the first time you sign in.

import { initAdmin } from './lib/firebase-admin-init.js';
import { usernameToEmail } from './lib/naming.js';

async function main() {
  const username = process.argv[2] || 'admin_emily';
  const displayName = process.argv[3] || 'Emily';

  const { auth, db } = initAdmin();
  const email = usernameToEmail(username);

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
    console.log(`Account already exists: ${username} (${userRecord.uid}).`);
    console.log('Leaving its password as-is — reset it from Firebase Console → Authentication if needed.');
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    userRecord = await auth.createUser({ email, password: username, displayName });
    console.log(`Created admin account: ${username} (${userRecord.uid})`);
    console.log(`Initial password is the same as the username ("${username}") — you'll be prompted to change it on first login.`);
  }

  const userRef = db.collection('users').doc(userRecord.uid);
  const existing = await userRef.get();
  if (!existing.exists) {
    await userRef.set({
      name: displayName, email, country: '', provider: 'password', role: 'admin',
      joinedAt: new Date().toISOString(), teamId: null, mustChangePassword: true
    });
  } else if (existing.data().role !== 'admin') {
    await userRef.update({ role: 'admin' });
    console.log('Promoted existing account to admin.');
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
