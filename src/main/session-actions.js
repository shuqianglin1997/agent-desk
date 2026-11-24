const fs = require('node:fs');
const path = require('node:path');

function resolveLocalSessions(input, profiles, getApp) {
  const refs = Array.isArray(input?.selections) ? input.selections : [input];
  if (!refs.length) throw new Error('no-session-selection');
  const owners = new Map(profiles.map((profile) => [String(profile.id), profile]));
  const scans = new Map();
  const seen = new Set();
  return refs.flatMap((ref) => {
    const { profileId, sessionId } = ref || {};
    if (typeof profileId !== 'string' || !profileId || profileId.length > 128
      || typeof sessionId !== 'string' || !sessionId || sessionId.length > 256) {
      throw new Error('invalid-session-selection');
    }
    const key = JSON.stringify([profileId, sessionId]);
    if (seen.has(key)) return [];
    seen.add(key);
    const profile = owners.get(profileId);
    if (!profile) throw new Error('session-not-found');
    const client = getApp(profile.appId);
    if (!scans.has(profileId)) {
      const sessions = new Map();
      for (const record of client.scan(profile)) {
        const id = String(record.id);
        sessions.set(id, sessions.has(id) ? null : record);
      }
      scans.set(profileId, sessions);
    }
    const session = scans.get(profileId).get(sessionId);
    if (!session) throw new Error('session-not-found');
    return [{ profile, session, client, ref: { profileId, sessionId } }];
  });
}

function sessionDirectories(records) {
  const grouped = new Map();
  for (const { session, ref } of records) {
    const file = session.filePath;
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw new Error('session-directory-unavailable');
    let directory;
    try {
      const stat = fs.statSync(file);
      if (!stat.isDirectory() && !stat.isFile()) throw new Error();
      directory = fs.realpathSync.native(stat.isDirectory() ? file : path.dirname(file));
    } catch (_error) {
      throw new Error('session-directory-unavailable');
    }
    const key = process.platform === 'win32' ? directory.toLowerCase() : directory;
    const existing = grouped.get(key);
    if (existing) existing.count += 1;
    else grouped.set(key, { path: directory, count: 1, ref });
  }
  return [...grouped.values()];
}

module.exports = { resolveLocalSessions, sessionDirectories };
