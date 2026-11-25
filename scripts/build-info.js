'use strict';

/*
 * Records which source a package is built from (docs/FIX_AND_REBUILD.md):
 * build-info.json at the repository root, which package.json build.files
 * packs into app.asar. The beforePack hook (scripts/build-native-helpers.js)
 * writes it, so every electron-builder run carries it. Only the commit and
 * whether the packed files (src, assets, package.json) differ from it: no
 * time, so both halves of a universal macOS build pack the same file. Without
 * git (a source download) the commit is null rather than guessed.
 * src/core/product.js reads it back, only inside a package.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const FILE_NAME = 'build-info.json';
// What package.json build.files packs.
const PACKED_PATHS = ['src', 'assets', 'package.json'];

function readGitState(root = ROOT, run = spawnSync) {
  const options = { cwd: root, encoding: 'utf8', windowsHide: true, shell: false };
  const head = run('git', ['rev-parse', 'HEAD'], options);
  const commit = head?.status === 0 ? String(head.stdout || '').trim() : '';
  if (!/^[0-9a-f]{40}$/.test(commit)) return { commit: null, dirty: null };
  const status = run('git', ['status', '--porcelain', '--', ...PACKED_PATHS], options);
  return { commit, dirty: status?.status === 0 ? String(status.stdout || '').trim().length > 0 : null };
}

function writeBuildInfo(root = ROOT, options = {}) {
  const info = { schemaVersion: 1, ...readGitState(root, options.run) };
  fs.writeFileSync(path.join(root, FILE_NAME), `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

module.exports = { FILE_NAME, readGitState, writeBuildInfo };

if (require.main === module) process.stdout.write(`${JSON.stringify(writeBuildInfo())}\n`);
