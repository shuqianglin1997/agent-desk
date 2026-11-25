#!/usr/bin/env node
'use strict';

// npm test: the Node test suite, run with its own temp folder. TMPDIR, TMP
// and TEMP point at a fresh folder for the whole run; every test removes what
// it makes (test/helpers/temp.js), so anything still in the folder afterwards
// is listed and fails the run. The folder is removed either way, so a run
// never leaves anything in the system temp folder.
//
//   node scripts/run-tests.js [node --test options and files]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Short prefix: some tests put sockets under the temp folder, and Unix socket
// paths are limited to about 100 characters.
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'adt-'));
let status = 1;
let leftovers = [];
try {
  const env = { ...process.env, TMPDIR: base, TMP: base, TEMP: base };
  const result = spawnSync(process.execPath, ['--test', ...process.argv.slice(2)], { stdio: 'inherit', env });
  status = result.status === null ? 1 : result.status;
  leftovers = fs.readdirSync(base).sort();
} finally {
  fs.rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

if (leftovers.length) {
  process.stderr.write(`\nTests left ${leftovers.length} item(s) in the temp folder (removed now); each test must remove what it makes, see test/helpers/temp.js:\n`);
  for (const name of leftovers.slice(0, 50)) process.stderr.write(`  ${name}\n`);
  if (leftovers.length > 50) process.stderr.write(`  … and ${leftovers.length - 50} more\n`);
  if (status === 0) status = 1;
}
process.exitCode = status;
