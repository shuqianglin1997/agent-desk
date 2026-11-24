'use strict';

/*
 * AgentDesk — runs session scans and activity probes off the main thread.
 *
 * Requests go to one worker thread (src/scan-worker.js) and come back as data.
 * If the worker cannot start or keeps failing, the same work runs here in the
 * main process instead (slower for the window, never a wrong answer): a request
 * that was in flight when the worker failed is retried here once.
 */

const path = require('node:path');
const { unpackRawActivity } = require('./activity');

const MAX_WORKER_FAILURES = 3;

function createScanHost(options = {}) {
  const workerFile = options.workerFile || path.join(__dirname, 'scan-worker.js');
  const inProcess = options.inProcess;
  if (!inProcess || typeof inProcess.scan !== 'function' || typeof inProcess.activityRaw !== 'function') {
    throw new TypeError('inProcess scan and activityRaw are required');
  }
  const createWorker = options.createWorker || ((file) => new (require('node:worker_threads').Worker)(file));
  // Told where each scan ran ('worker' or 'here'); used by the hidden check to count scans.
  const onScan = typeof options.onScan === 'function' ? options.onScan : null;
  let worker = null;
  let failures = 0;
  let nextId = 1;
  const pending = new Map();

  function failPending() {
    const waiting = [...pending.values()];
    pending.clear();
    for (const request of waiting) request.retryHere();
  }

  function startWorker() {
    if (worker) return worker;
    if (failures >= MAX_WORKER_FAILURES) return null;
    try {
      worker = createWorker(workerFile);
    } catch (_error) {
      failures = MAX_WORKER_FAILURES;
      return null;
    }
    worker.unref?.();
    worker.on('message', (message) => {
      const request = pending.get(message && message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.retryHere();
      else request.resolve(message);
    });
    const broken = () => {
      worker = null;
      failures += 1;
      failPending();
    };
    worker.on('error', broken);
    worker.on('exit', (code) => { if (worker) broken(code); });
    return worker;
  }

  function send(message, here) {
    const active = startWorker();
    if (!active) return Promise.resolve().then(here).then((value) => ({ local: value }));
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, {
        resolve,
        retryHere: () => Promise.resolve().then(here).then((value) => resolve({ local: value }), reject)
      });
      try {
        active.postMessage({ ...message, id });
      } catch (_error) {
        pending.delete(id);
        Promise.resolve().then(here).then((value) => resolve({ local: value }), reject);
      }
    });
  }

  return {
    // A profile's scan as a result (src/core/result.js).
    async scan(profile) {
      const reply = await send({ type: 'scan', profile }, () => inProcess.scan(profile));
      onScan?.(profile, 'local' in reply ? 'here' : 'worker');
      return 'local' in reply ? reply.local : reply.result;
    },
    // The file work of an activity probe, one result per profile.
    async activityRaw(profiles, now, baselineAt) {
      const reply = await send({ type: 'activity', profiles, now, baselineAt }, () => inProcess.activityRaw(profiles, now, baselineAt));
      return 'local' in reply ? reply.local : reply.raws.map(unpackRawActivity);
    },
    usesWorker: () => worker !== null,
    close() {
      const active = worker;
      worker = null;
      failures = MAX_WORKER_FAILURES;
      failPending();
      if (active) return active.terminate();
      return Promise.resolve();
    }
  };
}

module.exports = { createScanHost };
