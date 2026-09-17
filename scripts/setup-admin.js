#!/usr/bin/env node
// Creates (or promotes) an admin account. Re-run this any time you need to
// add another admin — it's what "the admin group" is: everyone this script
// has been run for with role 'admin', not a separate Firestore concept.
//
// Usage: node setup-admin.js [username] [display name] [--reset-password]
// Defaults to username "admin_emily", display name "Emily".
// The initial password is the same as the username — you'll be prompted to
// change it the first time you sign in.
// Pass --reset-password to force an *existing* account's password back to
// its username (e.g. after a lockout) and require a change on next login.

import { initAdmin } from './lib/firebase-admin-init.js';
import { usernameToEmail } from './lib/naming.js';

async function main() {
  const args = process.argv.slice(2).filter(a => a !== '--reset-password');
  const resetPassword = process.argv.includes('--reset-password');
  const username = args[0] || 'admin_emily';
  const displayName = args[1] || 'Emily';

  const { auth, db } = initAdmin();
  const email = usernameToEmail(username);

  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
    console.log(`Account already exists: ${username} (${userRecord.uid}).`);
    if (resetPassword) {
      await auth.updateUser(userRecord.uid, { password: username });
      console.log(`Password reset to "${username}" — you'll be prompted to change it on next login.`);
    } else {
      console.log('Leaving its password as-is — pass --reset-password to reset it back to the username.');
    }
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
    console.log('Created its Firestore profile (role: admin).');
  } else {
    const updates = {};
    if (existing.data().role !== 'admin') updates.role = 'admin';
    if (resetPassword) updates.mustChangePassword = true;
    if (Object.keys(updates).length) {
      await userRef.update(updates);
      console.log(updates.role ? 'Profile already existed — promoted it to admin.' : 'Profile already existed — flagged to require a password change.');
    } else {
      console.log('Profile already existed and is already admin — nothing to change.');
    }
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
