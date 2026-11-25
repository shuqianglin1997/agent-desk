#!/usr/bin/env node
'use strict';

// One hash for a rendered stretch: the manifest and every distinct picture it names.
// Two renders with the same hash are the same film, frame for frame.
//
//   node media/launch-video/tools/fingerprint.js <frames dir>

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const dir = path.resolve(process.argv[2]);
const manifest = fs.readFileSync(path.join(dir, 'manifest.txt'), 'utf8');
const hash = createHash('sha256').update(manifest);
for (const name of [...new Set(manifest.trim().split('\n'))].sort()) hash.update(name).update(fs.readFileSync(path.join(dir, name)));
process.stdout.write(`${hash.digest('hex')}  ${manifest.trim().split('\n').length} frames\n`);
