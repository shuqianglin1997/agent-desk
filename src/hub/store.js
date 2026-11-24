'use strict';

/*
 * AgentDesk 调度中枢 — the one persisted record: allowed folders, the
 * concurrency limit and the background-run ledger.
 *
 * A run record keeps only what the interface shows (title, caller label,
 * target, state, times) and where the answer and the session live (the
 * client's own session ID and record). It never holds the prompt or the
 * answer text. Main is the only writer; it holds the desktop instance lock.
 */

const crypto = require('node:crypto');
const path = require('node:path');
const { readJsonStore, writeJsonStore } = require('../json-store');
const { normalizeMaxConcurrent, MAX_FOLDERS } = require('./roster');

const STORE_VERSION = 1;
const MAX_RUNS = 200;
const RUN_STATES = Object.freeze(['starting', 'running', 'completed', 'failed', 'stopped']);
const ACTIVE_STATES = new Set(['starting', 'running']);
const RUN_ID = /^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function text(value, max) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max) : '';
}

function time(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

function absolute(value) {
  return typeof value === 'string' && path.isAbsolute(value) && !/[\x00-\x1f]/.test(value) && value.length <= 4096 ? value : null;
}

function normalizeFolder(value) {
  const folderPath = absolute(value?.path);
  if (!folderPath || typeof value.id !== 'string' || !/^[0-9a-f-]{8,64}$/.test(value.id)) return null;
  return { id: value.id, path: folderPath, addedAt: time(value.addedAt) };
}

function normalizeRun(value) {
  if (!value || typeof value !== 'object' || !RUN_ID.test(value.id || '')) return null;
  if (!RUN_STATES.includes(value.state)) return null;
  const sessionId = text(value.session?.id, 200) || null;
  return {
    id: value.id,
    title: text(value.title, 120),
    from: text(value.from, 80) || null,
    depth: Number.isInteger(value.depth) && value.depth >= 1 && value.depth <= 9 ? value.depth : 1,
    parentRunId: RUN_ID.test(value.parentRunId || '') ? value.parentRunId : null,
    // How AgentDesk knows the caller: the parent run it relayed, or the
    // caller's own account folder. A self-declared label is kept in `from`.
    caller: value.caller && typeof value.caller.profileId === 'string' && ['parent-run', 'account-home'].includes(value.caller.via)
      ? { profileId: value.caller.profileId.slice(0, 128), via: value.caller.via }
      : null,
    target: {
      profileId: text(value.target?.profileId, 128),
      app: text(value.target?.app, 40),
      name: text(value.target?.name, 120)
    },
    access: value.access === 'write' ? 'write' : 'read',
    cwd: absolute(value.cwd),
    folderId: typeof value.folderId === 'string' ? value.folderId.slice(0, 64) : null,
    state: value.state,
    reasonCode: text(value.reasonCode, 64) || null,
    createdAt: time(value.createdAt),
    startedAt: time(value.startedAt),
    endedAt: time(value.endedAt),
    session: sessionId ? { id: sessionId, file: absolute(value.session?.file) } : null
  };
}

class HubStore {
  constructor({ file, now = () => Date.now(), maxRuns = MAX_RUNS }) {
    this.file = file;
    this.now = now;
    this.maxRuns = maxRuns;
    this.state = { folders: [], maxConcurrent: normalizeMaxConcurrent(null), runs: [] };
    this.load();
  }

  load() {
    const loaded = this.file ? readJsonStore(this.file, (parsed) => parsed?.version === STORE_VERSION) : null;
    const parsed = loaded?.parsed || {};
    const folders = (Array.isArray(parsed.folders) ? parsed.folders : []).map(normalizeFolder).filter(Boolean).slice(0, MAX_FOLDERS);
    const runs = (Array.isArray(parsed.runs) ? parsed.runs : []).map(normalizeRun).filter(Boolean).slice(-this.maxRuns);
    this.state = { folders, maxConcurrent: normalizeMaxConcurrent(parsed.maxConcurrent), runs };
    // Whoever loads the store holds the desktop instance lock, so no other
    // process can still be supervising a run: an active record is stale.
    let changed = false;
    for (const run of runs) {
      if (!ACTIVE_STATES.has(run.state)) continue;
      run.state = 'failed';
      run.reasonCode = 'interrupted';
      run.endedAt = run.endedAt || new Date(this.now()).toISOString();
      changed = true;
    }
    if (changed) this.save();
  }

  save() {
    if (!this.file) return;
    writeJsonStore(this.file, { version: STORE_VERSION, ...this.state }, { skipBackup: true, mode: 0o600 });
  }

  folders() { return this.state.folders.map((folder) => ({ ...folder })); }

  maxConcurrent() { return this.state.maxConcurrent; }

  setMaxConcurrent(value) {
    this.state.maxConcurrent = normalizeMaxConcurrent(value);
    this.save();
    return this.state.maxConcurrent;
  }

  // Folders reach this only from Main's own folder picker.
  addFolder(folderPath) {
    const value = absolute(folderPath);
    if (!value) return { ok: false, reasonCode: 'folder-invalid' };
    const existing = this.state.folders.find((folder) => folder.path === value);
    if (existing) return { ok: true, folder: { ...existing }, existing: true };
    if (this.state.folders.length >= MAX_FOLDERS) return { ok: false, reasonCode: 'folder-limit' };
    const folder = { id: crypto.randomUUID(), path: value, addedAt: new Date(this.now()).toISOString() };
    this.state.folders.push(folder);
    this.save();
    return { ok: true, folder: { ...folder } };
  }

  removeFolder(id) {
    const before = this.state.folders.length;
    this.state.folders = this.state.folders.filter((folder) => folder.id !== id);
    if (this.state.folders.length === before) return false;
    this.save();
    return true;
  }

  newRunId() { return `run-${crypto.randomUUID()}`; }

  runs() { return this.state.runs.map((run) => structuredClone(run)); }

  getRun(id) {
    const run = this.state.runs.find((item) => item.id === id);
    return run ? structuredClone(run) : null;
  }

  putRun(record) {
    const run = normalizeRun(record);
    if (!run) throw new Error('hub-run-invalid');
    const index = this.state.runs.findIndex((item) => item.id === run.id);
    if (index >= 0) this.state.runs[index] = run;
    else this.state.runs.push(run);
    // Old finished records fall off the end; active ones are never dropped.
    while (this.state.runs.length > this.maxRuns) {
      const oldest = this.state.runs.findIndex((item) => !ACTIVE_STATES.has(item.state));
      if (oldest < 0) break;
      this.state.runs.splice(oldest, 1);
    }
    this.save();
    return structuredClone(run);
  }

  updateRun(id, patch) {
    const current = this.state.runs.find((item) => item.id === id);
    if (!current) return null;
    return this.putRun({ ...current, ...patch });
  }
}

module.exports = { STORE_VERSION, MAX_RUNS, RUN_STATES, ACTIVE_STATES, RUN_ID, HubStore, normalizeRun };
