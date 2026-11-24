#!/usr/bin/env node
'use strict';

// A test-only packaged build for scripts/hidden-check.js --packaged: the same
// electron-builder configuration as package.json (fuses, ASAR integrity,
// files), except that app.asar also holds scripts/hidden-electron-entry.js and
// uses it as its main, so the packaged runtime can be checked without a
// window. Never a release artifact: unsigned (ad-hoc on macOS), "dir" target
// only, written to a new folder under the system temp directory.
//
// Electron comes from a copy of node_modules/electron/dist without the
// development default_app.asar (electronDist), so the build downloads nothing;
// the result must pass scripts/verify-electron-package-integrity.js.
//
//   node scripts/hidden-package.js            prints { output, binary }
//   node scripts/hidden-check.js --packaged <binary>

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = 'scripts/hidden-electron-entry.js';

function testConfig(output, electronDist) {
  const config = JSON.parse(JSON.stringify(require(path.join(ROOT, 'package.json')).build));
  config.directories = { ...(config.directories || {}), output };
  config.files = [...config.files, ENTRY];
  config.extraMetadata = { ...(config.extraMetadata || {}), main: ENTRY };
  config.electronDist = electronDist;
  config.publish = null;
  config.mac = { ...(config.mac || {}), target: [{ target: 'dir', arch: [process.arch] }], forceCodeSigning: false, notarize: false, hardenedRuntime: false, identity: '-' };
  config.win = { ...(config.win || {}), target: [{ target: 'dir', arch: [process.arch] }] };
  return config;
}

function binaryIn(output) {
  if (process.platform === 'darwin') {
    const folder = fs.readdirSync(output).find((name) => name.startsWith('mac') && fs.existsSync(path.join(output, name, 'AgentDesk.app')));
    return folder ? path.join(output, folder, 'AgentDesk.app', 'Contents', 'MacOS', 'AgentDesk') : null;
  }
  const folder = fs.readdirSync(output).find((name) => name.endsWith('-unpacked'));
  if (!folder) return null;
  const name = process.platform === 'win32' ? 'AgentDesk.exe' : 'agentdesk';
  return path.join(output, folder, name);
}

function build() {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-hidden-package-'));
  const electronDist = path.join(output, 'electron-dist');
  fs.cpSync(path.join(ROOT, 'node_modules', 'electron', 'dist'), electronDist, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (source) => path.basename(source) !== 'default_app.asar'
  });
  const configFile = path.join(output, 'hidden-package-config.json');
  fs.writeFileSync(configFile, JSON.stringify(testConfig(path.join(output, 'out'), electronDist), null, 2));
  const builder = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
  const platformFlag = process.platform === 'darwin' ? '--mac' : (process.platform === 'win32' ? '--win' : '--linux');
  const result = spawnSync(builder, [platformFlag, 'dir', `--${process.arch}`, '--publish', 'never', '--config', configFile], {
    cwd: ROOT,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  fs.writeFileSync(path.join(output, 'build.log'), `${result.stdout || ''}${result.stderr || ''}`);
  if (result.status !== 0) throw new Error(`electron-builder failed (${result.status}); see ${path.join(output, 'build.log')}`);
  const log = `${result.stdout || ''}${result.stderr || ''}`;
  if (/downloaded\s+label=electron/i.test(log)) throw new Error('the build downloaded Electron; electronDist was not used');
  const binary = binaryIn(path.join(output, 'out'));
  if (!binary) throw new Error('no packaged binary in the build output');
  const artifact = process.platform === 'darwin' ? path.resolve(binary, '..', '..', '..') : path.dirname(binary);
  const verify = spawnSync(process.execPath, [path.join(__dirname, 'verify-electron-package-integrity.js'), '--artifact', artifact], { encoding: 'utf8' });
  if (verify.status !== 0) throw new Error(`the test build is not like a release build: ${(verify.stderr || verify.stdout || '').trim().slice(0, 400)}`);
  return { output, binary };
}

module.exports = { testConfig, build };

if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(build(), null, 2) + '\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
