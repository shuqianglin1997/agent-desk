'use strict';

// AgentDesk — scratch folders for tests. makeTempDir(t, prefix) makes one
// under the system temp folder and removes it when the test ends (t.after);
// called without a test context (makeTempDir(prefix)) it is removed when the
// test process exits. Every folder a test makes goes through here, so a full
// run leaves nothing behind; scripts/run-tests.js (npm test) checks that.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const made = new Set();

function remove(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch (_error) {
    // Best effort: the run's own temp folder is removed afterwards anyway.
  }
  made.delete(dir);
}

process.on('exit', () => {
  for (const dir of [...made]) remove(dir);
});

function makeTempDir(t, prefix = 'agentdesk-test-') {
  if (typeof t === 'string') {
    prefix = t;
    t = null;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.add(dir);
  if (t && typeof t.after === 'function') t.after(() => remove(dir));
  return dir;
}

module.exports = { makeTempDir };
