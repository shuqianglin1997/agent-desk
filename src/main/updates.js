'use strict';

// AgentDesk — checking for and installing app updates from the project's GitHub
// releases: the latest release, whether this build can update itself, the
// trusted download and the hand-over to the platform installer. Moved out of
// src/main.js unchanged; Main's services come through `main` (mainContext).

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const updater = require('../updater');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// Main's context (src/main.js mainContext): its services and state, read
// when used. Bound once at start-up.
let main = null;
function bind(context) { main = context; }

const UPDATE_CACHE_TTL = 5 * 60_000;

const UPDATE_CHECK_TIMEOUT = 15_000;

const UPDATE_DOWNLOAD_TIMEOUT = 30 * 60_000;

let latestUpdateCache = null;

let updateInstalling = false;

async function checkForUpdates(options = {}) {
  try {
    const update = await latestUpdateInfo(Boolean(options.force));
    return publicUpdateInfo(update);
  } catch (error) {
    return { ok: false, reason: updateErrorMessage(error) };
  }
}

async function latestUpdateInfo(force = false) {
  if (
    !force &&
    latestUpdateCache &&
    Date.now() - latestUpdateCache.at < UPDATE_CACHE_TTL
  ) {
    return latestUpdateCache.value;
  }

  const release = await fetchLatestGitHubRelease();
  // An unsigned test build as Latest is not an official release.
  if (updater.isTestBuildRelease(release)) throw new Error(main.t('main.upd.noRelease'));
  const resolved = updater.resolveRelease(release, {
    currentVersion: main.app.getVersion(),
    platform: process.platform,
    arch: process.arch
  });
  const capability = updateCapability(resolved);
  const value = { resolved, capability };
  latestUpdateCache = { at: Date.now(), value };
  return value;
}

async function fetchLatestGitHubRelease() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT);
  try {
    const response = await main.net.fetch(updater.LATEST_RELEASE_API, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      bypassCustomProtocolHandlers: true,
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `${main.APP_NAME}/${main.app.getVersion()}`,
        'X-GitHub-Api-Version': updater.GITHUB_API_VERSION
      }
    });
    if (!response.ok) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      if (response.status === 404) {
        throw new Error(main.t('main.upd.noRelease'));
      }
      if (response.status === 403 && remaining === '0') {
        throw new Error(main.t('main.upd.rateLimit'));
      }
      throw new Error(main.t('main.upd.queryFail', { status: response.status }));
    }
    const text = await response.text();
    if (text.length > 4 * 1024 * 1024) throw new Error(main.t('main.upd.respTooLarge'));
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function updateCapability(resolved) {
  if (!resolved.updateAvailable) {
    return { installSupported: false, mode: 'none', reason: null, targetPath: null };
  }
  if (!resolved.asset) {
    return {
      installSupported: false,
      mode: 'release-page',
      reason: main.t('main.upd.noAsset'),
      targetPath: null
    };
  }
  if (process.platform !== 'win32') {
    return {
      installSupported: false,
      mode: 'release-page',
      reason: main.t('main.upd.macDmg'),
      targetPath: null
    };
  }
  if (!main.app.isPackaged) {
    return {
      installSupported: false,
      mode: 'release-page',
      reason: main.t('main.upd.devMode'),
      targetPath: null
    };
  }

  const targetPath = updater.portableExecutablePath(process.env);
  if (!targetPath || !fs.existsSync(targetPath)) {
    return {
      installSupported: false,
      mode: 'release-page',
      reason: main.t('main.upd.notPortable'),
      targetPath: null
    };
  }
  if (!resolved.asset.sha256) {
    return {
      installSupported: false,
      mode: 'release-page',
      reason: main.t('main.upd.noDigest'),
      targetPath: null
    };
  }
  try {
    fs.accessSync(path.dirname(targetPath), fs.constants.W_OK);
    fs.accessSync(targetPath, fs.constants.R_OK | fs.constants.W_OK);
  } catch (_error) {
    return {
      installSupported: false,
      mode: 'release-page',
      reason: main.t('main.upd.dirNotWritable'),
      targetPath: null
    };
  }
  return {
    installSupported: true,
    mode: 'windows-portable',
    reason: null,
    targetPath
  };
}

function publicUpdateInfo(update) {
  const { resolved, capability } = update;
  return {
    ok: true,
    currentVersion: resolved.currentVersion,
    latestVersion: resolved.latestVersion,
    updateAvailable: resolved.updateAvailable,
    releaseUrl: resolved.releaseUrl,
    publishedAt: resolved.publishedAt,
    notes: resolved.notes,
    assetName: resolved.asset?.name || null,
    assetSize: resolved.asset?.size || null,
    installSupported: capability.installSupported,
    installMode: capability.mode,
    manualReason: capability.reason,
    platform: process.platform,
    packaged: main.app.isPackaged
  };
}

async function installLatestUpdate(webContents) {
  if (updateInstalling) return { ok: false, reason: main.t('main.upd.inProgress') };

  let update;
  try {
    update = await latestUpdateInfo(false);
  } catch (error) {
    return { ok: false, reason: updateErrorMessage(error) };
  }

  const { resolved, capability } = update;
  if (!resolved.updateAvailable) {
    return { ok: true, upToDate: true, message: main.t('main.upd.alreadyLatest', { version: resolved.currentVersion }) };
  }

  if (!capability.installSupported) {
    try {
      await main.shell.openExternal(resolved.releaseUrl);
      return {
        ok: true,
        manual: true,
        message: capability.reason || main.t('main.upd.openedRelease')
      };
    } catch (error) {
      return { ok: false, reason: main.t('main.upd.cannotOpenRelease', { msg: error.message }) };
    }
  }

  updateInstalling = true;
  let restarting = false;
  try {
    sendUpdateProgress(webContents, {
      stage: 'preparing',
      percent: 0,
      message: main.t('main.upd.preparing', { version: resolved.latestVersion })
    });
    const downloadedPath = await downloadReleaseAsset(resolved, webContents);
    sendUpdateProgress(webContents, {
      stage: 'installing',
      percent: 100,
      message: main.t('main.upd.verifyRestart')
    });
    // Preserve the exact current user configuration immediately before the
    // executable is replaced. These snapshots are outside the portable exe
    // and remain available if a future schema or interrupted write misbehaves.
    main.snapshotConfigurationForUpdate();
    await launchWindowsPortableUpdater(downloadedPath, capability.targetPath);
    restarting = true;
    setTimeout(() => main.app.quit(), 600);
    return {
      ok: true,
      restarting: true,
      message: main.t('main.upd.downloadedRestart', { version: resolved.latestVersion })
    };
  } catch (error) {
    sendUpdateProgress(webContents, {
      stage: 'error',
      percent: null,
      message: updateErrorMessage(error)
    });
    return { ok: false, reason: updateErrorMessage(error) };
  } finally {
    if (!restarting) updateInstalling = false;
  }
}

async function downloadReleaseAsset(resolved, webContents) {
  const asset = resolved.asset;
  if (!asset?.url || !asset.sha256) throw new Error(main.t('main.upd.assetMissingSec'));

  const updateDir = path.join(main.app.getPath('temp'), 'AgentDesk-updates');
  main.ensureDir(updateDir);
  const safeName = path.basename(asset.name).replace(/[^a-z0-9._ -]+/gi, '-');
  const finalPath = path.join(updateDir, `${resolved.latestVersion}-${safeName}`);
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
    'User-Agent': `${main.APP_NAME}/${main.app.getVersion()}`
  });
  const timer = setTimeout(() => {
    timedOut = true;
    download.request?.abort();
  }, UPDATE_DOWNLOAD_TIMEOUT);

  try {
    const { response } = await download.response;
    const statusCode = Number(response.statusCode);
    if (!Number.isInteger(statusCode) || statusCode < 200 || statusCode >= 300) {
      response.resume();
      throw new Error(main.t('main.upd.downloadFail', { status: statusCode || '-' }));
    }

    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        const buffer = Buffer.from(chunk);
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
      throw new Error(main.t('main.upd.sizeMismatch', { expected: asset.size, received }));
    }
    const digest = hash.digest('hex');
    if (digest !== asset.sha256) throw new Error(main.t('main.upd.shaFail'));
    fs.renameSync(partialPath, finalPath);
    return finalPath;
  } catch (error) {
    try { fs.rmSync(partialPath, { force: true }); } catch (_error) { /* best effort */ }
    if (timedOut) throw new Error(main.t('main.upd.downloadTimeout'));
    throw error;
  } finally {
    clearTimeout(timer);
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
      if (redirects > 5) {
        failure = new Error(main.t('main.upd.tooManyRedirects'));
        finish(reject, failure);
        request.abort();
        return;
      }
      if (!updater.isTrustedDownloadResponseUrl(redirectUrl)) {
        failure = new Error(main.t('main.upd.redirectNonGithub'));
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
        failure = new Error(main.t('main.upd.respNonGithub'));
        finish(reject, failure);
        request.abort();
        return;
      }
      finish(resolve, { response: incoming, finalUrl: currentUrl });
    });
    request.once('error', (error) => finish(reject, failure || error));
    request.once('abort', () => {
      finish(reject, failure || new Error(main.t('main.upd.downloadCancelled')));
    });
    request.once('close', () => {
      finish(reject, failure || new Error(main.t('main.upd.connClosed')));
    });
    request.end();
  });
  return { request, response };
}

async function launchWindowsPortableUpdater(downloadedPath, targetPath) {
  const updateDir = path.dirname(downloadedPath);
  const scriptPath = path.join(updateDir, `apply-update-${Date.now()}.ps1`);
  const logPath = path.join(updateDir, 'update-error.log');
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

  let lastError = null;
  for (const executable of ['powershell.exe', 'pwsh.exe']) {
    try {
      await main.spawnDetached(executable, args, { ...process.env });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(main.t('main.upd.replacerFail', { msg: lastError?.message || 'PowerShell 不可用' }));
}

function sendUpdateProgress(webContents, payload) {
  if (!webContents || webContents.isDestroyed()) return;
  try {
    webContents.send('updates:progress', payload);
  } catch (_error) {
    // The download can outlive a window that was closed during the update.
  }
}

function updateErrorMessage(error) {
  if (error?.name === 'AbortError') return main.t('main.upd.githubTimeout');
  if (error instanceof SyntaxError) return main.t('main.upd.unparsable');
  return error?.message || main.t('main.upd.genericFail');
}

module.exports = { bind, checkForUpdates, latestUpdateInfo, fetchLatestGitHubRelease, updateCapability, publicUpdateInfo, installLatestUpdate, downloadReleaseAsset, createTrustedDownloadRequest, launchWindowsPortableUpdater, sendUpdateProgress, updateErrorMessage };
