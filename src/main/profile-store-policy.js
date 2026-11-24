function resolveProfileStore(options = {}) {
  const candidates = Array.isArray(options.candidates) ? options.candidates : [];
  if (!candidates.length) throw new TypeError('profile-store-candidates-required');
  if (typeof options.read !== 'function') throw new TypeError('profile-store-reader-required');
  if (typeof options.normalize !== 'function') throw new TypeError('profile-store-normalizer-required');
  if (typeof options.persist !== 'function') throw new TypeError('profile-store-writer-required');

  const primaryFile = candidates[0];
  // A missing primary file is an intentional empty state. Backups remain a
  // recovery path for a present-but-damaged primary, but never a source from
  // which deleted/default Profiles can reappear after the primary is removed.
  const primaryExists = typeof options.exists === 'function'
    ? options.exists(primaryFile)
    : true;
  // Read in order and stop at the first usable file: a backup is read only
  // when the files before it are unusable.
  let loaded = null;
  if (primaryExists) {
    for (const candidate of candidates) {
      loaded = options.read(candidate) || null;
      if (loaded) break;
    }
  }
  if (!loaded && primaryExists) {
    // Present but unreadable (half-written, locked, damaged) and no usable
    // backup: show nothing this time, but never replace the file with an
    // empty list. A later read may succeed; an explicit save keeps a backup.
    return [];
  }
  if (!loaded) {
    // A missing store is a real empty workspace. Platform discovery must be an
    // explicit onboarding choice, otherwise deleting every Profile can be
    // undone merely by losing/restoring the primary JSON file.
    const empty = [];
    options.persist(empty, { skipBackup: true });
    return empty;
  }

  const rawProfiles = Array.isArray(loaded.parsed)
    ? loaded.parsed
    : loaded.parsed.profiles;
  const normalized = options.normalize(rawProfiles || []);
  const normalizedPayload = { version: options.version, profiles: normalized };
  const currentPayload = Array.isArray(loaded.parsed)
    ? { version: 0, profiles: loaded.parsed }
    : {
        version: loaded.parsed.version || 0,
        profiles: loaded.parsed.profiles || []
      };
  if (
    loaded.filePath !== primaryFile
    || JSON.stringify(currentPayload) !== JSON.stringify(normalizedPayload)
  ) {
    options.persist(normalized, { skipBackup: loaded.filePath !== primaryFile });
  }
  return normalized;
}

/*
 * The profile list for the renderer's refresh path (the 8-second activity
 * poll and the session list it reloads). Re-reading the store synchronously
 * every few seconds is file work on the main thread, so this keeps the last
 * list and checks the file asynchronously: only a changed file (device,
 * inode, size or modification time) is loaded again, through the same
 * load() everything else uses. Without a file to check, every call loads.
 * Callers get copies of the profiles.
 */
function createProfileSnapshot(options = {}) {
  const file = options.file;
  const load = options.load;
  const stat = options.stat || ((filePath) => require('node:fs').promises.stat(filePath));
  let last = null;
  const copies = (profiles) => profiles.map((profile) => (profile && typeof profile === 'object' ? { ...profile } : profile));
  return {
    async profiles() {
      let stamp = null;
      try {
        const current = await stat(file());
        stamp = `${current.dev}:${current.ino}:${current.size}:${current.mtimeMs}`;
      } catch (_error) {
        stamp = null;
      }
      if (stamp && last && last.stamp === stamp) return copies(last.profiles);
      const profiles = load();
      last = stamp ? { stamp, profiles: copies(profiles) } : null;
      return copies(profiles);
    },
    forget() { last = null; }
  };
}

module.exports = { resolveProfileStore, createProfileSnapshot };
