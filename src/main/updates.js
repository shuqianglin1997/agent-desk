'use strict';

// Catshelf — checking for and installing app updates from the project's GitHub
// releases (docs/RELEASING.md, "In-app updates"): what Latest is and whether
// it is newer than this copy (src/updater.js: version for v* releases, commit
// for unsigned test builds), whether this copy can replace itself, the
// digest-checked download and the hand-over to the platform replacer
// (Windows: a PowerShell script; macOS: src/update-mac.js). Main's services
// come through `main` (mainContext), bound once at start-up. Installing is
// only ever started from the window; the command line only checks.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const updater = require('../updater');
const updateMac = require('../update-mac');
const { buildInfo } = require('../core/product');
const { mt } = require('../i18n/main-i18n');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

let main = null;
function bind(context) { main = context; }

// One check costs up to three GitHub API calls, and GitHub allows 60
// unauthenticated calls an hour. A result is reused for ten minutes; even the
// button reuses one younger than a minute. A rate limit is waited out.
const UPDATE_CACHE_TTL = 10 * 60_000;
const UPDATE_FORCE_FLOOR = 60_000;
const UPDATE_CHECK_TIMEOUT = 15_000;
// A download ends when no data has arrived for two minutes. Slow is fine:
// GitHub can be slow from some networks (about 100 KB/s seen on the owner's
// Mac on 2026-11-27, a 30-minute total limit would have failed a 209 MB
// package). The total limit only stops a trickle that never finishes.
const UPDATE_DOWNLOAD_STALL = 2 * 60_000;
const UPDATE_DOWNLOAD_TIMEOUT = 6 * 60 * 60_000;
const TOOL_TIMEOUT = 5 * 60_000;
const LAST_ATTEMPT_MAX_AGE = 7 * 24 * 60 * 60_000;
const UPDATE_DIRECTORY = 'AgentDesk-updates';
const MAC_RESULT_FILE = 'mac-update-result.json';
const WINDOWS_ERROR_LOG = 'update-error.log';

let latestUpdateCache = null;
let rateLimitedUntil = 0;
const lookupMemo = { tags: new Map(), comparisons: new Map() };
let updateInstalling = false;
let ownBuild = null;

function currentBuild() {
  if (!ownBuild) {
    const info = buildInfo();
    ownBuild = { version: info.version, commit: info.commit, dirty: info.dirty, packaged: info.packaged };
  }
  return ownBuild;
}

function codeOf(error) {
  if (error instanceof updater.UpdateError) return error.code;
  if (error?.name === 'AbortError') return 'github-timeout';
  return 'update-failed';
}

// The sentence for a fixed reason code, in the window's language (or `lang`).
function reasonText(code, details = {}, lang = null) {
  const params = { ...details };
  if (code === 'rate-limited') {
    params.minutes = Math.max(1, Math.ceil(((Number(details.resetAt) || Date.now()) - Date.now()) / 60_000));
  }
  const key = `main.upd.code.${code}`;
  const text = lang ? mt(lang, key, params) : main.t(key, params);
  return text === key ? (lang ? mt(lang, 'main.upd.code.update-failed') : main.t('main.upd.code.update-failed')) : text;
}

function failure(error, lang = null) {
  const code = typeof error === 'string' ? error : codeOf(error);
  const details = error instanceof updater.UpdateError ? error.details : {};
  return { ok: false, reasonCode: code, reason: reasonText(code, details, lang) };
}

// GitHub API reads through `fetchImpl`: Electron's net.fetch in the desktop,
// Node's fetch in the command line (which never waits for app-ready).
function githubRequester(fetchImpl, extra = {}) {
  return async (url, accept) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT);
    try {
      const response = await fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        credentials: 'omit',
        signal: controller.signal,
        headers: {
          Accept: accept,
          'User-Agent': `${main.APP_NAME}/${currentBuild().version}`,
          'X-GitHub-Api-Version': updater.GITHUB_API_VERSION
        },
        ...extra
      });
      const text = await response.text();
      if (text.length > 4 * 1024 * 1024) throw new updater.UpdateError('response-too-large');
      return { status: response.status, headers: response.headers, text };
    } catch (error) {
      if (error instanceof updater.UpdateError) throw error;
      if (error?.name === 'AbortError') throw new updater.UpdateError('github-timeout');
      throw new updater.UpdateError('github-unreachable');
    } finally {
      clearTimeout(timer);
    }
  };
}

function writable(file) {
  try {
    fs.accessSync(file, fs.constants.W_OK);
    return true;
  } catch (_error) {
    return false;
  }
}

function updateCapability(resolved) {
  return updater.installCapability(resolved, {
    platform: process.platform,
    packaged: Boolean(main.app.isPackaged),
    execPath: process.execPath,
    env: process.env,
    exists: (file) => fs.existsSync(file),
    writable
  });
}

async function latestUpdateInfo(force = false) {
  const now = Date.now();
  if (latestUpdateCache && now - latestUpdateCache.at < (force ? UPDATE_FORCE_FLOOR : UPDATE_CACHE_TTL)) {
    return latestUpdateCache.value;
  }
  if (rateLimitedUntil > now) throw new updater.UpdateError('rate-limited', { resetAt: rateLimitedUntil });
  let resolved;
  try {
    resolved = await updater.checkLatestRelease({
      current: currentBuild(),
      platform: process.platform,
      arch: process.arch,
      request: githubRequester((url, init) => main.net.fetch(url, init), { bypassCustomProtocolHandlers: true }),
      memo: lookupMemo
    });
  } catch (error) {
    if (error?.code === 'rate-limited') rateLimitedUntil = Number(error.details?.resetAt) || now + 10 * 60_000;
    throw error;
  }
  const value = { resolved, capability: updateCapability(resolved) };
  latestUpdateCache = { at: Date.now(), value };
  return value;
}

function latestLabel(resolved) {
  return resolved.version ? `v${resolved.version}` : resolved.tag;
}

function activeHubRuns() {
  try {
    return Number(main.agentHub?.activeCount?.()) || 0;
  } catch (_error) {
    return 0;
  }
}

function publicUpdateInfo(update) {
  const { resolved, capability } = update;
  return {
    ok: true,
    state: resolved.state,
    reasonCode: resolved.reasonCode,
    reason: resolved.reasonCode ? reasonText(resolved.reasonCode) : null,
    updateAvailable: resolved.updateAvailable,
    current: resolved.current,
    currentVersion: resolved.current.version,
    latest: {
      kind: resolved.kind,
      tag: resolved.tag,
      version: resolved.version,
      commit: resolved.commit,
      publishedAt: resolved.publishedAt
    },
    latestLabel: latestLabel(resolved),
    latestVersion: resolved.version,
    testBuild: resolved.kind === 'test',
    releaseUrl: resolved.releaseUrl,
    publishedAt: resolved.publishedAt,
    notes: resolved.notes,
    assetName: resolved.asset?.name || null,
    assetSize: resolved.asset?.size || null,
    installSupported: capability.installSupported,
    installMode: capability.mode,
    manualReasonCode: capability.reasonCode,
    manualReason: capability.reasonCode ? reasonText(capability.reasonCode) : null,
    platform: process.platform,
    packaged: main.app.isPackaged,
    activeHubRuns: activeHubRuns()
  };
}

function updateDirectory() {
  const directory = path.join(main.app.getPath('temp'), UPDATE_DIRECTORY);
  main.ensureDir(directory);
  return directory;
}

// What the replacer left after the last attempt: the macOS script's result,
// or the Windows script's error log. Read once and removed; only a failure is
// reported, since a success is the running copy itself.
function takeLastAttempt() {
  let directory;
  try {
    directory = path.join(main.app.getPath('temp'), UPDATE_DIRECTORY);
  } catch (_error) {
    return null;
  }
  const macResult = path.join(directory, MAC_RESULT_FILE);
  const windowsLog = path.join(directory, WINDOWS_ERROR_LOG);
  let code = null;
  let at = null;
  try {
    const stat = fs.statSync(macResult);
    const record = JSON.parse(fs.readFileSync(macResult, 'utf8'));
    at = Number(record?.at) * 1000 || stat.mtimeMs;
    if (record?.ok !== true) code = /^[a-z-]{1,40}$/.test(String(record?.code)) ? record.code : 'update-failed';
  } catch (_error) { /* no record */ }
  try {
    const stat = fs.statSync(windowsLog);
    code = 'replace-failed';
    at = stat.mtimeMs;
  } catch (_error) { /* no log */ }
  for (const file of [macResult, `${macResult}.log`, windowsLog]) {
    try { fs.rmSync(file, { force: true }); } catch (_error) { /* best effort */ }
  }
  if (!code || !at || Date.now() - at > LAST_ATTEMPT_MAX_AGE) return null;
  return { ok: false, reasonCode: code, reason: reasonText(code), at: new Date(at).toISOString() };
}

async function checkForUpdates(options = {}) {
  const lastAttempt = takeLastAttempt();
  try {
    const update = await latestUpdateInfo(Boolean(options.force));
    return { ...publicUpdateInfo(update), lastAttempt };
  } catch (error) {
    const build = currentBuild();
    return { ...failure(error), current: { version: build.version, commit: build.commit, dirty: build.dirty }, lastAttempt };
  }
}

// `updates check` on the command line: read-only, its own lookups (a CLI
// process is short-lived), English sentences, nothing removed or written.
async function checkForUpdatesFromCli() {
  const build = currentBuild();
  const current = { version: build.version, commit: build.commit, dirty: build.dirty };
  let resolved;
  try {
    resolved = await updater.checkLatestRelease({
      current,
      platform: process.platform,
      arch: process.arch,
      request: githubRequester((url, init) => globalThis.fetch(url, init)),
      memo: { tags: new Map(), comparisons: new Map() }
    });
  } catch (error) {
    return { ...failure(error, 'en'), current };
  }
  const capability = updateCapability(resolved);
  return {
    ok: true,
    current: { ...current, packaged: build.packaged },
    latest: {
      kind: resolved.kind,
      tag: resolved.tag,
      version: resolved.version,
      commit: resolved.commit,
      publishedAt: resolved.publishedAt,
      releaseUrl: resolved.releaseUrl,
      asset: resolved.asset ? { name: resolved.asset.name, size: resolved.asset.size, sha256: resolved.asset.sha256 } : null
    },
    state: resolved.state,
    updateAvailable: resolved.updateAvailable,
    reasonCode: resolved.reasonCode,
    reason: resolved.reasonCode ? reasonText(resolved.reasonCode, {}, 'en') : null,
    windowInstall: capability.installSupported ? capability.mode : (capability.mode === 'none' ? 'none' : 'release-page'),
    manualReasonCode: capability.reasonCode,
    install: 'window-only'
  };
}

function progress(webContents, stage, message, extra = {}) {
  sendUpdateProgress(webContents, { stage, percent: null, message, ...extra });
}

async function installLatestUpdate(webContents, input = {}) {
  if (updateInstalling) return failure('in-progress');

  let update;
  try {
    update = await latestUpdateInfo(false);
  } catch (error) {
    return failure(error);
  }

  const { resolved, capability } = update;
  const label = latestLabel(resolved);
  if (resolved.state === 'unknown' || (resolved.updateAvailable && !capability.installSupported)) {
    try {
      await main.shell.openExternal(resolved.releaseUrl);
    } catch (_error) {
      return failure('release-page-failed');
    }
    const reasonCode = resolved.updateAvailable ? capability.reasonCode : resolved.reasonCode;
    return {
      ok: true,
      manual: true,
      reasonCode,
      message: reasonCode ? `${reasonText(reasonCode)} ${main.t('main.upd.openedRelease')}` : main.t('main.upd.openedRelease')
    };
  }
  if (!resolved.updateAvailable) {
    return { ok: true, upToDate: true, message: main.t('main.upd.alreadyLatest', { label: resolved.current.version }) };
  }

  // Background runs end when Catshelf quits; the window asks first.
  const runs = activeHubRuns();
  if (runs > 0 && input?.stopRuns !== true) {
    return { ...failure(new updater.UpdateError('hub-runs-active', { n: runs })), activeHubRuns: runs };
  }

  updateInstalling = true;
  let restarting = false;
  let staged = null;
  try {
    progress(webContents, 'preparing', main.t('main.upd.preparing', { label }), { percent: 0 });
    const downloadedPath = await downloadReleaseAsset(resolved, webContents);
    if (capability.mode === 'macos-app') {
      try {
        const prepared = await updateMac.prepareMacUpdate({
          dmgPath: downloadedPath,
          workDir: path.dirname(downloadedPath),
          target: capability.targetPath,
          expected: {
            commit: resolved.kind === 'test' ? resolved.commit : null,
            version: resolved.kind === 'version' ? resolved.version : null,
            notOlderThan: resolved.current.version
          },
          deps: { run: runTool },
          onStage: (stage) => progress(webContents, stage, main.t(`main.upd.stage.${stage}`))
        });
        staged = prepared.staged;
      } finally {
        try { fs.rmSync(downloadedPath, { force: true }); } catch (_error) { /* best effort */ }
      }
    }
    progress(webContents, 'installing', main.t('main.upd.verifyRestart'), { percent: 100 });
    // The exact configuration, kept outside the app just before it is replaced
    // (profiles and settings; the data folder itself is never touched).
    try {
      main.snapshotConfigurationForUpdate();
    } catch (_error) {
      throw new updater.UpdateError('backup-failed');
    }
    if (capability.mode === 'macos-app') await launchMacUpdater(staged, capability.targetPath);
    else await launchWindowsPortableUpdater(downloadedPath, capability.targetPath);
    restarting = true;
    // Quits like the menu does, except that the AI clients Catshelf opened
    // keep running; background runs end (the window warned about them).
    setTimeout(() => main.quitForUpdate(), 600);
    const done = main.t('main.upd.downloadedRestart', { label });
    return {
      ok: true,
      restarting: true,
      message: capability.mode === 'macos-app' ? `${done} ${main.t('main.upd.keychainHint')}` : done
    };
  } catch (error) {
    if (staged) updateMac.removeStaged(updateMac.rawFs(), staged, capability.targetPath);
    const result = failure(error);
    sendUpdateProgress(webContents, { stage: 'error', percent: null, message: result.reason, reasonCode: result.reasonCode });
    return result;
  } finally {
    if (!restarting) updateInstalling = false;
  }
}

function runTool(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', timeout: TOOL_TIMEOUT, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(String(stdout || ''));
    });
  });
}

async function downloadReleaseAsset(resolved, webContents) {
  const asset = resolved.asset;
  if (!asset?.url || !asset.sha256) throw new updater.UpdateError('no-digest');

  const updateDir = updateDirectory();
  const safeName = path.basename(asset.name).replace(/[^a-z0-9._ -]+/gi, '-');
  const safeLabel = String(resolved.version || resolved.tag).replace(/[^a-z0-9._-]+/gi, '-');
  const finalPath = path.join(updateDir, `${safeLabel}-${safeName}`);
  const partialPath = `${finalPath}.partial`;
  try { fs.rmSync(partialPath, { force: true }); } catch (_error) { /* best effort */ }
  try { fs.rmSync(finalPath, { force: true }); } catch (_error) { /* best effort */ }

  let timedOut = false;
  let received = 0;
  let lastProgressAt = 0;
  let lastPercent = -1;
  const hash = crypto.createHash('sha256');
  const download = createTrustedDownloadRequest(asset.url, {
    Accept: 'application/octet-stream',
    'User-Agent': `${main.APP_NAME}/${currentBuild().version}`
  });
  const stop = () => {
    timedOut = true;
    download.request?.abort();
  };
  const timer = setTimeout(stop, UPDATE_DOWNLOAD_TIMEOUT);
  let stall = setTimeout(stop, UPDATE_DOWNLOAD_STALL);
  const progressed = () => {
    clearTimeout(stall);
    stall = setTimeout(stop, UPDATE_DOWNLOAD_STALL);
  };

  try {
    const { response } = await download.response;
    progressed();
    const statusCode = Number(response.statusCode);
    if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode >= 300) {
      response.resume();
      throw new updater.UpdateError('download-failed', { status: statusCode || '-' });
    }

    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = Buffer.from(chunk);
        progressed();
        received += buffer.length;
        hash.update(buffer);
        const percent = asset.size > 0
          ? Math.min(100, Math.floor((received / asset.size) * 100))
          : null;
        const now = Date.now();
        if (
          percent === 100 ||
          (percent !== lastPercent && now - lastProgressAt >= 150)
        ) {
          lastPercent = percent;
          lastProgressAt = now;
          sendUpdateProgress(webContents, {
            stage: 'downloading',
            percent,
            received,
            total: asset.size,
            message: percent === null ? main.t('main.upd.downloading') : main.t('main.upd.downloadingPct', { percent })
          });
        }
        callback(null, buffer);
      }
    });

    await pipeline(
      response,
      meter,
      fs.createWriteStream(partialPath, { flags: 'wx' })
    );

    if (received !== asset.size) {
      throw new updater.UpdateError('size-mismatch', { expected: asset.size, received });
    }
    if (hash.digest('hex') !== asset.sha256) throw new updater.UpdateError('digest-mismatch');
    fs.renameSync(partialPath, finalPath);
    return finalPath;
  } catch (error) {
    try { fs.rmSync(partialPath, { force: true }); } catch (_error) { /* best effort */ }
    if (timedOut) throw new updater.UpdateError('download-timeout');
    if (error instanceof updater.UpdateError) throw error;
    throw new updater.UpdateError('download-interrupted');
  } finally {
    clearTimeout(timer);
    clearTimeout(stall);
  }
}

function createTrustedDownloadRequest(url, headers) {
  let request;
  const response = new Promise((resolve, reject) => {
    let settled = false;
    let redirects = 0;
    let currentUrl = url;
    let failure = null;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    request = main.net.request({
      method: 'GET',
      url,
      redirect: 'manual',
      credentials: 'omit',
      headers
    });
    request.on('redirect', (_statusCode, _method, redirectUrl) => {
      redirects += 1;
      if (redirects > 5 || !updater.isTrustedDownloadResponseUrl(redirectUrl)) {
        failure = new updater.UpdateError('download-untrusted');
        finish(reject, failure);
        request.abort();
        return;
      }
      currentUrl = redirectUrl;
      try {
        request.followRedirect();
      } catch (error) {
        failure = error;
        finish(reject, error);
        request.abort();
      }
    });
    request.once('response', (incoming) => {
      if (!updater.isTrustedDownloadResponseUrl(currentUrl)) {
        failure = new updater.UpdateError('download-untrusted');
        finish(reject, failure);
        request.abort();
        return;
      }
      finish(resolve, { response: incoming, finalUrl: currentUrl });
    });
    request.once('error', (error) => finish(reject, failure || error));
    request.once('abort', () => {
      finish(reject, failure || new updater.UpdateError('download-interrupted'));
    });
    // No 'close' handler: Electron's ClientRequest is a writable stream and
    // emits 'close' as soon as the request itself is sent (before 'redirect'
    // and 'response'), so treating it as an interruption failed every
    // download. A request that never answers ends in 'error', or in 'abort'
    // from the download timeout.
    request.end();
  });
  return { request, response };
}

async function launchMacUpdater(staged, targetPath) {
  const updateDir = updateDirectory();
  const scriptPath = path.join(updateDir, `apply-update-${Date.now()}.sh`);
  const resultPath = path.join(updateDir, MAC_RESULT_FILE);
  for (const file of [resultPath, `${resultPath}.log`]) {
    try { fs.rmSync(file, { force: true }); } catch (_error) { /* best effort */ }
  }
  fs.writeFileSync(scriptPath, updateMac.macUpdaterScript(), { encoding: 'ascii', mode: 0o700 });
  try {
    await main.spawnDetached('/bin/sh', [scriptPath, String(process.pid), staged, targetPath, resultPath], {
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      HOME: process.env.HOME || ''
    });
  } catch (_error) {
    try { fs.rmSync(scriptPath, { force: true }); } catch (_cleanup) { /* best effort */ }
    throw new updater.UpdateError('replacer-failed');
  }
}

async function launchWindowsPortableUpdater(downloadedPath, targetPath) {
  const updateDir = path.dirname(downloadedPath);
  const scriptPath = path.join(updateDir, `apply-update-${Date.now()}.ps1`);
  const logPath = path.join(updateDir, WINDOWS_ERROR_LOG);
  fs.writeFileSync(scriptPath, updater.windowsUpdaterScript(), 'ascii');

  const args = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-ProcessId',
    String(process.pid),
    '-Source',
    downloadedPath,
    '-Target',
    targetPath,
    '-LogPath',
    logPath
  ];

  for (const executable of ['powershell.exe', 'pwsh.exe']) {
    try {
      await main.spawnDetached(executable, args, { ...process.env });
      return;
    } catch (_error) {
      // Try the next PowerShell.
    }
  }
  throw new updater.UpdateError('replacer-failed');
}

function sendUpdateProgress(webContents, payload) {
  if (!webContents || webContents.isDestroyed()) return;
  try {
    webContents.send('updates:progress', payload);
  } catch (_error) {
    // The download can outlive a window that was closed during the update.
  }
}

module.exports = { bind, checkForUpdates, checkForUpdatesFromCli, latestUpdateInfo, updateCapability, publicUpdateInfo, installLatestUpdate, downloadReleaseAsset, createTrustedDownloadRequest, launchMacUpdater, launchWindowsPortableUpdater, sendUpdateProgress, takeLastAttempt, reasonText };
