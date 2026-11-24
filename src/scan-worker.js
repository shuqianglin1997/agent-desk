'use strict';

/*
 * AgentDesk — the session scan worker (a worker thread).
 *
 * Scans one profile, or reads activity for several, and posts the data back.
 * It receives only the profile records and times Main chooses to send, never
 * a path from the window, and it never writes: the scanners only read files
 * (and run the system sqlite3 read-only).
 */

const { parentPort } = require('node:worker_threads');
const apps = require('./apps');
const { registryScan } = require('./session-index');
const { probeRawActivities, packRawActivity } = require('./activity-files');

const scan = registryScan(apps);

parentPort.on('message', (message) => {
  const id = message && message.id;
  try {
    if (message && message.type === 'scan') {
      parentPort.postMessage({ id, result: scan(message.profile) });
    } else if (message && message.type === 'activity') {
      parentPort.postMessage({ id, raws: probeRawActivities(message.profiles, message.now, message.baselineAt).map(packRawActivity) });
    } else {
      parentPort.postMessage({ id, error: 'scan-request-unknown' });
    }
  } catch (_error) {
    parentPort.postMessage({ id, error: 'scan-worker-failed' });
  }
});
