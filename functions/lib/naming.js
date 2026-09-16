// Keep this in sync with usernameToEmail() in index.html — both must derive
// the exact same synthetic Firebase Auth email from a username.

export function toUsername(teamName, personName) {
  return `${teamName}_${personName}`.trim().replace(/\s+/g, '_');
}

export function usernameToEmail(username) {
  return username.trim().toLowerCase().replace(/\s+/g, '_') + '@ohapac.local';
}

export function slugTeamId(teamName) {
  return teamName.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'team';
}
