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
  const loaded = primaryExists ? candidates.map(options.read).find(Boolean) : null;
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

module.exports = { resolveProfileStore };
