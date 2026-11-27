#!/usr/bin/env node
'use strict';

/*
 * A real-machine check of the macOS one-click update, up to the swap and no
 * further (docs/RELEASING.md, "In-app updates"). It runs the steps the app
 * runs, with the same code (src/updater.js, src/update-mac.js): ask GitHub
 * for Latest and decide newer or not, download the DMG and check it against
 * GitHub's SHA-256 digest, mount it read-only and hidden, check the
 * Catshelf.app inside (bundle id, codesign --verify --deep --strict, the
 * commit it records against the release's commit, its version), copy it with
 * ditto --noqtn and check the copy. The copy goes into a scratch folder, not
 * /Applications; no updater script is started, nothing quits, nothing is
 * replaced. Everything it made is removed at the end unless --keep is given.
 * The scratch target is a parameter of this script only; the app always uses
 * /Applications/Catshelf.app.
 *
 *   node scripts/update-dry-run-macos.js [--current-commit <40 hex>] [--keep]
 *
 * Without --current-commit it reads the commit and version recorded by the
 * installed /Applications/Catshelf.app (without running it). It reads
 * Latest's update-manifest.json (a download, no API call) and downloads one
 * DMG; only a Latest without a manifest, or a commit the manifest cannot
 * place, costs GitHub API calls (up to three of the 60 anonymous ones an hour).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFile, spawnSync } = require('node:child_process');
const updater = require('../src/updater');
const updateMac = require('../src/update-mac');

const INSTALLED = updater.MAC_APPLICATIONS_BUNDLE;
const TIMEOUT = 15_000;

function parseArguments(argv) {
  const options = { currentCommit: null, keep: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--current-commit') {
      options.currentCommit = String(argv[index + 1] || '').toLowerCase();
      index += 1;
      if (!/^[0-9a-f]{40}$/.test(options.currentCommit)) throw new Error('--current-commit needs a full 40-character commit');
    } else if (argv[index] === '--keep') {
      options.keep = true;
    } else {
      throw new Error(`unknown argument ${argv[index]}`);
    }
  }
  return options;
}

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: 5 * 60_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout || ''));
    });
  });
}

async function request(url, accept) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, {
      redirect: 'error',
      signal: controller.signal,
      headers: { Accept: accept, 'User-Agent': 'Catshelf-update-dry-run', 'X-GitHub-Api-Version': updater.GITHUB_API_VERSION }
    });
    return { status: response.status, headers: response.headers, text: await response.text() };
  } catch (error) {
    if (error?.name === 'AbortError') throw new updater.UpdateError('github-timeout');
    throw new updater.UpdateError('github-unreachable');
  } finally {
    clearTimeout(timer);
  }
}

// Latest's update-manifest.json as the app reads it: redirects followed one
// at a time, each only to GitHub's download hosts.
async function fetchManifest() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await updater.fetchWithTrustedRedirects(async (url) => {
      const reply = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'Catshelf-update-dry-run' } });
      return { status: reply.status, headers: reply.headers, text: reply.status >= 200 && reply.status < 300 ? await reply.text() : '' };
    }, updater.LATEST_MANIFEST_URL);
    return { status: response.status, text: response.text };
  } catch (error) {
    if (error instanceof updater.UpdateError) throw error;
    if (error?.name === 'AbortError') throw new updater.UpdateError('github-timeout');
    throw new updater.UpdateError('github-unreachable');
  } finally {
    clearTimeout(timer);
  }
}

// The download as the app does it: only GitHub hosts, at most five
// redirects, size and SHA-256 against the asset's metadata.
function download(asset, destination) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    let received = 0;
    let lastShown = -1;
    const get = (url, redirects) => {
      if (!updater.isTrustedDownloadResponseUrl(url) || redirects > 5) {
        reject(new updater.UpdateError('download-untrusted'));
        return;
      }
      https.get(url, { headers: { Accept: 'application/octet-stream', 'User-Agent': 'Catshelf-update-dry-run' } }, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          get(new URL(response.headers.location, url).toString(), redirects + 1);
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(new updater.UpdateError('download-failed', { status: response.statusCode }));
          return;
        }
        const out = fs.createWriteStream(destination, { flags: 'wx' });
        response.on('data', (chunk) => {
          received += chunk.length;
          hash.update(chunk);
          const percent = Math.floor((received / asset.size) * 10) * 10;
          if (percent !== lastShown) {
            lastShown = percent;
            process.stdout.write(`  downloaded ${percent}%\n`);
          }
        });
        response.pipe(out);
        out.on('finish', () => {
          if (received !== asset.size) reject(new updater.UpdateError('size-mismatch', { expected: asset.size, received }));
          else if (hash.digest('hex') !== asset.sha256) reject(new updater.UpdateError('digest-mismatch'));
          else resolve();
        });
        out.on('error', () => reject(new updater.UpdateError('download-interrupted')));
        response.on('error', () => reject(new updater.UpdateError('download-interrupted')));
      }).on('error', () => reject(new updater.UpdateError('download-interrupted')));
    };
    get(asset.url, 0);
  });
}

async function installedBuild() {
  try {
    const info = updateMac.readAppBuildInfo(INSTALLED);
    const version = (await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', path.join(INSTALLED, 'Contents', 'Info.plist')])).trim();
    return { version, commit: info.commit, dirty: info.dirty };
  } catch (_error) {
    return null;
  }
}

function writable(file) {
  try {
    fs.accessSync(file, fs.constants.W_OK);
    return true;
  } catch (_error) {
    return false;
  }
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('macOS only');
  const options = parseArguments(process.argv.slice(2));
  const installed = await installedBuild();
  const current = {
    version: installed?.version || require('../package.json').version,
    commit: options.currentCommit || installed?.commit || null,
    dirty: installed?.dirty ?? null
  };
  process.stdout.write(`1. This copy: ${current.version} commit ${current.commit || 'unknown'} (${options.currentCommit ? '--current-commit' : installed ? INSTALLED : 'nothing installed'})\n`);

  const resolved = await updater.checkLatestRelease({ current, platform: 'darwin', arch: process.arch, fetchManifest, request });
  process.stdout.write(`2. Latest: ${resolved.tag} (${resolved.kind}, read from ${resolved.source === 'manifest' ? 'update-manifest.json' : 'the GitHub API'}) commit ${resolved.commit || '-'} published ${resolved.publishedAt || '-'}\n`);
  process.stdout.write(`   decision: ${resolved.state}${resolved.reasonCode ? ` [${resolved.reasonCode}]` : ''}; file ${resolved.asset?.name || '-'} ${resolved.asset?.size || '-'} bytes sha256 ${resolved.asset?.sha256 || '-'}\n`);
  const capability = updater.installCapability({ ...resolved, updateAvailable: true }, {
    platform: 'darwin',
    packaged: true,
    execPath: path.join(INSTALLED, 'Contents', 'MacOS', 'Catshelf'),
    exists: (file) => fs.existsSync(file),
    writable
  });
  process.stdout.write(`   the installed app would ${capability.installSupported ? 'install it itself (macos-app)' : `open the release page [${capability.reasonCode}]`}${resolved.updateAvailable ? '' : ', but does not offer it now'}\n`);
  if (!resolved.asset?.sha256) throw new updater.UpdateError(resolved.asset ? 'no-digest' : 'no-asset');

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'catshelf-update-dry-run-'));
  const applications = path.join(scratch, 'Applications');
  fs.mkdirSync(applications);
  try {
    const dmgPath = path.join(scratch, path.basename(resolved.asset.name));
    process.stdout.write(`3. Downloading to ${dmgPath}\n`);
    await download(resolved.asset, dmgPath);
    process.stdout.write(`   size and SHA-256 match ${resolved.source === 'manifest' ? 'the manifest' : 'GitHub\'s digest'}\n`);

    const prepared = await updateMac.prepareMacUpdate({
      dmgPath,
      workDir: scratch,
      target: path.join(applications, 'Catshelf.app'),
      expected: {
        commit: resolved.kind === 'test' ? resolved.commit : null,
        version: resolved.kind === 'version' ? resolved.version : null,
        notOlderThan: current.version
      },
      deps: { run },
      onStage: (stage) => process.stdout.write(`4. ${stage}\n`)
    });
    process.stdout.write(`   checked: ${JSON.stringify(prepared.checked)}\n`);
    process.stdout.write(`   staged copy (checked again): ${prepared.staged}\n`);

    const script = path.join(scratch, 'apply-update.sh');
    fs.writeFileSync(script, updateMac.macUpdaterScript(), { mode: 0o700 });
    const syntax = spawnSync('/bin/sh', ['-n', script], { encoding: 'utf8' });
    if (syntax.status !== 0) throw new Error(`updater script does not parse: ${syntax.stderr}`);
    process.stdout.write('5. Stopped before the swap. The app would now back up profiles.json and settings.json, then run detached:\n');
    process.stdout.write(`   /bin/sh <updates>/apply-update-<time>.sh <its pid> ${path.join(path.dirname(INSTALLED), '.Catshelf.update-<token>.app')} ${INSTALLED} <updates>/mac-update-result.json\n`);
    process.stdout.write(`   and quit, keeping the AI clients open. /Applications was not touched.\n`);
  } finally {
    if (options.keep) process.stdout.write(`Kept ${scratch}\n`);
    else {
      try {
        fs.rmSync(scratch, { recursive: true, force: true });
      } catch (_error) {
        process.stdout.write(`Could not remove ${scratch} (a DMG may still be mounted there: hdiutil info)\n`);
      }
    }
  }
}

main().then(() => {
  process.stdout.write('Dry run passed.\n');
}, (error) => {
  process.stderr.write(`Dry run failed: ${error?.code || error?.message || error}\n`);
  process.exitCode = 1;
});
