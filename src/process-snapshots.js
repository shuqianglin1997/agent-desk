'use strict';

// One process list for the whole app. Callers share one in-flight collection
// and a copy no older than they ask for (maxAgeMs), so the activity probe and
// the runtime supervisor no longer run `ps` each on their own, and nothing
// waits on it synchronously. A failed collection is null (unavailable) and is
// shared like a result, so callers fail closed.

const { collectProcessRecords } = require('./process');

function createProcessSnapshots(options = {}) {
  const collect = options.collect || collectProcessRecords;
  const now = options.now || (() => Date.now());
  const defaultMaxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : 1000;
  let latest = null;
  let inFlight = null;

  async function records(request = {}) {
    const maxAgeMs = Number.isFinite(request.maxAgeMs) ? request.maxAgeMs : defaultMaxAgeMs;
    if (latest && now() - latest.at <= maxAgeMs) return latest.records;
    if (!inFlight) {
      inFlight = Promise.resolve()
        .then(() => collect())
        .catch(() => null)
        .then((value) => {
          latest = { at: now(), records: Array.isArray(value) ? value : null };
          return latest.records;
        })
        .finally(() => { inFlight = null; });
    }
    return inFlight;
  }

  return {
    records,
    // The last collected list and when, without collecting.
    latest: () => latest
  };
}

module.exports = { createProcessSnapshots };
