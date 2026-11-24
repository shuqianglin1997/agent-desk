'use strict';

// AgentDesk — small Main helpers the other modules share: bounded text, the
// language, a new cat's default look, the activity probe over the scan worker,
// the runtime supervisor created on first use (scheduled by the owner), and
// folder and path helpers. Moved out of src/main.js unchanged; Main's services
// come through `main` (mainContext).

const apps = require('../apps');
const fs = require('node:fs');
const { ProfileRuntimeSupervisor } = require('../profile-runtime');
const { defaultCatForLook } = require('../yard/cats');
const { finishActivities } = require('../activity');
const { isManagedProfilePath, loadProfiles, profileRuntimeStateFile, settingsFile } = require('./stores');
const { snapshotProcessRecords } = require('../process');

// Main's context (src/main.js mainContext): its services and state, read
// when used. Bound once at start-up.
let main = null;
function bind(context) { main = context; }

// The activity probe: file work on the worker, the "seen" comparison here.
async function probeActivities(profiles, now, marks) {
  const baselineAt = marks && Number(marks.baselineAt) > 0 ? Number(marks.baselineAt) : 0;
  const raws = await main.scanHost.activityRaw(profiles, now, baselineAt);
  // Session counts come from the session index, as in the list and the device page.
  return finishActivities(profiles, raws, marks, {
    sessionCountOf: (profile) => (Array.isArray(main.sessionIndex.peek(profile)?.rows) ? main.sessionIndex.peek(profile).rows.length : null)
  });
}

// A new cat wears its client's coat when the adapter declares one.
function defaultCatForClient(appId, seedText) {
  return defaultCatForLook(apps.isKnownApp(appId) ? apps.getApp(appId).catCoat : null, seedText);
}

// 主进程当前界面语言：直接读持久化 settings 文件（无副作用；renderer 切语言时已写入）。
function currentLang() {
  try {
    const lang = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))?.settings?.lang;
    if (lang === 'en' || lang === 'ja' || lang === 'zh') return lang;
  } catch (_error) {
    // 没有显式偏好时跟随 Electron 的系统 locale，与 renderer 的 navigator.language 保持一致。
  }
  try {
    const locale = String(main.app.isReady() ? main.app.getLocale() : process.env.LANG || '').toLowerCase();
    if (locale.startsWith('ja')) return 'ja';
    if (locale.startsWith('en')) return 'en';
    if (locale.startsWith('zh')) return 'zh';
  } catch (_error) {
    // app 尚未 ready 时回退中文。
  }
  return 'zh';
}

function finiteRevision(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error('catalog-revision-invalid');
  }
  return revision;
}

function resolveKnownProfilePath(input = {}) {
  if (boundedText(input.kind, 80) !== 'profile-directory') {
    throw new Error('known-path-kind-invalid');
  }
  const field = ['profilePath', 'sessionRoot'].includes(input.field) ? input.field : null;
  if (!field) throw new Error('known-path-field-invalid');
  const profile = loadProfiles().find((item) => item.id === boundedText(input.profileId, 128));
  if (!profile) throw new Error('profile-not-found');
  return profile[field];
}

function boundedText(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function getProfileRuntimeSupervisor() {
  if (main.profileRuntimeSupervisor) {
    main.profileRuntimeSupervisor.updateProfiles(loadProfiles());
    return main.profileRuntimeSupervisor;
  }
  main.profileRuntimeSupervisor = new ProfileRuntimeSupervisor({
    stateFile: profileRuntimeStateFile(),
    snapshotProcessRecords: (options) => main.processSnapshots.records(options),
    // The tick keeps running while the window is hidden: it guards disk and processes.
    schedule: (run, ms) => main.mainOwner.every('profile-runtime', ms, run),
    // status() after a launch, or before the first tick, collects synchronously.
    snapshotProcessRecordsSync: snapshotProcessRecords,
    isManagedProfile: (profile) => isManagedProfilePath(profile?.profilePath),
    onIncident: (incident) => {
      if (!main.mainWindow || main.mainWindow.isDestroyed()) return;
      main.mainWindow.webContents.send('profiles:runtimeIncident', {
        profileId: boundedText(incident.profileId, 128),
        occurredAt: incident.occurredAt || null,
        reason: boundedText(incident.reason, 80),
        fileCount: Number.isFinite(incident.fileCount) ? incident.fileCount : null,
        totalBytes: Number.isFinite(incident.totalBytes) ? incident.totalBytes : null,
        removedFiles: Number.isFinite(incident.removedFiles) ? incident.removedFiles : null
      });
    }
  });
  main.profileRuntimeSupervisor.updateProfiles(loadProfiles());
  return main.profileRuntimeSupervisor;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = { bind, probeActivities, defaultCatForClient, currentLang, finiteRevision, resolveKnownProfilePath, boundedText, getProfileRuntimeSupervisor, ensureDir };
