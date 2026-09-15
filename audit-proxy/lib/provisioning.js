import { usernameToEmail } from './naming.js';

// Creates the Firebase Auth account + Firestore profile for one person if
// they don't already exist, and keeps their team assignment in sync if they
// do. Mirrors scripts/lib/provisioning.js exactly (used by the local CLI
// scripts) — kept as a separate copy since this service deploys
// independently, but any behavior change should be made in both places.
//
// Returns { uid, created } — created is false when the account already
// existed, since in that case we must never claim to know its current
// password (the local script prints the initial password because it's the
// only place that generates it; here it's returned to the caller instead so
// the admin UI can decide what to show).
export async function ensureUser(auth, db, { name, username, teamId, role = 'user' }) {
  const email = usernameToEmail(username);
  let userRecord;
  let created = false;
  try {
    userRecord = await auth.getUserByEmail(email);
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    userRecord = await auth.createUser({ email, password: username, displayName: name });
    created = true;
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
  return { uid: userRecord.uid, created };
}
