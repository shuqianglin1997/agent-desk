'use strict';

/*
 * AgentDesk — the session index.
 *
 * Every Main-side reader of a profile's session list goes through it: the list
 * shown in the window, the device page's counts, the local inventory other
 * devices receive, and finding a session by its id (reveal, open folder,
 * export, task packages, the hub).
 *
 *  - One scan serves every request for that profile that arrives while it runs
 *    or within `reuseMs` after it, so start-up scans each profile once.
 *  - A scan's outcome is a result (src/core/result.js): rows, which may be
 *    truncated, or a failure code. A failed rescan keeps the last good rows and
 *    marks them stale; a profile that never scanned well reports its failure.
 *  - An entry belongs to one profile definition (id, client, folders): a
 *    changed folder never serves the old rows.
 *  - Scanning runs through `scan(profile)`, a result or a promise of one.
 *    `scanSync` is the same scan done here and now, for the few synchronous
 *    callers that need rows the index does not have yet.
 */

const { ok, fail } = require('./core/result');

const DEFAULT_REUSE_MS = 3000;

function codeOf(error) {
  const code = String(error?.code || '');
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(code) ? code : 'session-scan-failed';
}

// A scan through the registry: rows with `truncated`, or a coded failure.
// Callers pass the registry object so instrumentation of getApp() applies.
function registryScan(apps) {
  return (profile) => {
    const report = {};
    try {
      const rows = apps.getApp(profile.appId).scan(profile, report);
      return ok(Array.isArray(rows) ? rows : [], { truncated: report.truncated === true });
    } catch (error) {
      return fail(codeOf(error));
    }
  };
}

/**
 * The one way to find a session in a profile's rows.
 *   key: 'id' compares `session.id`; 'address' compares `session.address`,
 *        falling back to `session.id` (the key the hub and the CLI use).
 *   unique: when true, two matches are ambiguous: { ambiguous: true }.
 * Returns the session, null, or { ambiguous: true }.
 */
function findSession(rows, sessionId, options = {}) {
  const wanted = String(sessionId ?? '');
  if (!wanted || !Array.isArray(rows)) return null;
  const keyOf = options.key === 'address'
    ? (session) => String(session?.address || session?.id || '')
    : (session) => String(session?.id ?? '');
  const matches = rows.filter((session) => keyOf(session) === wanted);
  if (!matches.length) return null;
  if (options.unique && matches.length > 1) return { ambiguous: true };
  return matches[0];
}

function profileKey(profile) {
  return [profile?.id, profile?.appId, profile?.sessionRoot || '', profile?.profilePath || ''].map(String).join('\u0000');
}

function createSessionIndex(options = {}) {
  const scan = options.scan;
  const scanSync = options.scanSync || scan;
  if (typeof scan !== 'function') throw new TypeError('scan is required');
  const now = options.now || (() => Date.now());
  const reuseMs = Number.isFinite(options.reuseMs) ? options.reuseMs : DEFAULT_REUSE_MS;
  const entries = new Map();
  const inFlight = new Map();
  let generation = 0;

  function record(profile, key, result) {
    const id = String(profile.id);
    const previous = entries.get(id);
    const lastGood = previous && previous.key === key ? previous.rows : null;
    const good = result && result.ok === true;
    const entry = {
      key,
      at: now(),
      generation: ++generation,
      result: good ? ok(result.value, { truncated: result.truncated === true }) : (result && result.ok === false ? result : fail('session-scan-failed')),
      rows: good ? result.value : lastGood,
      stale: !good && lastGood !== null,
      truncated: good ? result.truncated === true : Boolean(previous && previous.key === key && previous.truncated)
    };
    entries.set(id, entry);
    return entry;
  }

  function current(profile, maxAgeMs) {
    const entry = entries.get(String(profile.id));
    if (!entry || entry.key !== profileKey(profile)) return null;
    return now() - entry.at <= maxAgeMs ? entry : null;
  }

  // The entry for one profile, scanning when there is none recent enough.
  function refreshOne(profile, request = {}) {
    const maxAgeMs = Number.isFinite(request.maxAgeMs) ? request.maxAgeMs : reuseMs;
    const key = profileKey(profile);
    const fresh = current(profile, maxAgeMs);
    if (fresh) return Promise.resolve(fresh);
    const id = String(profile.id);
    const running = inFlight.get(id);
    if (running && running.key === key) return running.promise;
    const promise = Promise.resolve()
      .then(() => scan(profile))
      .catch((error) => fail(codeOf(error)))
      .then((result) => record(profile, key, result))
      .finally(() => { if (inFlight.get(id)?.promise === promise) inFlight.delete(id); });
    inFlight.set(id, { key, promise });
    return promise;
  }

  async function refresh(profiles, request = {}) {
    const list = (Array.isArray(profiles) ? profiles : []).filter((profile) => profile && profile.id !== undefined);
    const results = await Promise.all(list.map((profile) => refreshOne(profile, request)));
    return new Map(list.map((profile, index) => [String(profile.id), results[index]]));
  }

  function rowsOrThrow(entry) {
    if (entry.rows) return entry.rows;
    const error = new Error(entry.result?.code || 'session-scan-failed');
    error.code = entry.result?.code || 'session-scan-failed';
    throw error;
  }

  // Rows for the window: the last good rows; a profile that never scanned
  // well throws its failure, as a direct scan did.
  async function rows(profile, request = {}) {
    return rowsOrThrow(await refreshOne(profile, request));
  }

  // Rows without waiting: the entry for this profile definition when there is
  // one no older than maxAgeMs (any age by default), else one scan here and now.
  function rowsSync(profile, request = {}) {
    const maxAgeMs = Number.isFinite(request.maxAgeMs) ? request.maxAgeMs : Infinity;
    const entry = current(profile, maxAgeMs);
    if (entry) return rowsOrThrow(entry);
    let result;
    try { result = scanSync(profile); } catch (error) { result = fail(codeOf(error)); }
    if (result && typeof result.then === 'function') throw new TypeError('scanSync must not return a promise');
    return rowsOrThrow(record(profile, profileKey(profile), result));
  }

  async function find(profile, sessionId, request = {}) {
    return findSession(await rows(profile, request), sessionId, request);
  }

  function findSync(profile, sessionId, request = {}) {
    return findSession(rowsSync(profile, request), sessionId, request);
  }

  // The entry as it is, without scanning: { rows, result, stale, truncated, at, generation } or null.
  function peek(profile) {
    const entry = entries.get(String(profile?.id));
    return entry && entry.key === profileKey(profile) ? entry : null;
  }

  function forget(profileId) {
    entries.delete(String(profileId));
  }

  return { refresh, rows, rowsSync, find, findSync, peek, forget };
}

module.exports = { createSessionIndex, registryScan, findSession, DEFAULT_REUSE_MS };
