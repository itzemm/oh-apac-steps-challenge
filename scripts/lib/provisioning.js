import { usernameToEmail } from './naming.js';

// Creates the Firebase Auth account + Firestore profile for one person if
// they don't already exist, and keeps their team assignment in sync if they
// do. Shared by import-roster.js and add-participant.js so both scripts
// provision a person identically.
export async function ensureUser(auth, db, { name, username, teamId, role = 'user' }) {
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
    console.log(`    -> created Firestore profile, assigned to team`);
  } else if (existing.data().teamId !== teamId) {
    await userRef.update({ teamId });
    console.log(`    -> profile existed, updated team assignment`);
  }
  return userRecord.uid;
}
