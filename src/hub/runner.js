'use strict';

/*
 * AgentDesk 调度中枢 — Main's supervisor for background runs.
 *
 * One child per run, started only because a caller asked for it through the
 * CLI. The supervisor never starts, queues, retries or schedules anything by
 * itself and never passes one run's answer to another. The prompt is written
 * to the child's stdin and dropped; the answer is kept in memory only, so the
 * record on disk shows title and state, and points at the client's own session.
 */

const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { ACTIVE_STATES } = require('./store');

const KILL_GRACE_MS = 3000;
const STOP_WAIT_MS = 6000;
// How long a run that has exited waits for its session lookup before it is
// recorded as ended without the link (filled in later when found).
const LOOKUP_TIMEOUT_MS = 2000;

function defaultKillTree(child, signal, platform = process.platform, spawnImpl = spawn) {
  if (!child?.pid) return;
  if (platform === 'win32') {
    if (signal === 'SIGKILL') {
      try {
        spawnImpl('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, shell: false });
      } catch (_error) { /* best effort */ }
    }
    try { child.kill(); } catch (_error) { /* exited */ }
    return;
  }
  // The child leads its own process group, so tools it started stop with it.
  try { process.kill(-child.pid, signal); } catch (_error) {
    try { child.kill(signal); } catch (_innerError) { /* exited */ }
  }
}

class HubRunner {
  constructor(options) {
    this.store = options.store;
    this.spawnImpl = options.spawnImpl || spawn;
    this.platform = options.platform || process.platform;
    this.killTree = options.killTree || ((child, signal) => defaultKillTree(child, signal, this.platform, this.spawnImpl));
    // locateSession(profile, sessionId): the session's file, or a promise of it
    // (Main looks it up on the scan worker). onSessionUnlinked({ runId,
    // profileId, sessionId }) is told when a run ended without the link.
    this.locateSession = options.locateSession || (() => null);
    this.onSessionUnlinked = typeof options.onSessionUnlinked === 'function' ? options.onSessionUnlinked : () => {};
    this.lookupTimeoutMs = options.lookupTimeoutMs ?? LOOKUP_TIMEOUT_MS;
    this.now = options.now || (() => Date.now());
    this.killGraceMs = options.killGraceMs ?? KILL_GRACE_MS;
    this.stopWaitMs = options.stopWaitMs ?? STOP_WAIT_MS;
    this.onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
    this.active = new Map();
    this.answers = new Map();
  }

  iso() { return new Date(this.now()).toISOString(); }

  activeCount() { return this.active.size; }

  activeForProfile(profileId) {
    for (const entry of this.active.values()) if (entry.profileId === String(profileId)) return entry.id;
    return null;
  }

  isActive(id) { return this.active.has(id); }

  answer(id) {
    const value = this.answers.get(id);
    return value ? { ...value } : null;
  }

  changed(record) {
    try { this.onChange(record); } catch (_error) { /* presentation only */ }
  }

  start(spec) {
    const id = spec.id || this.store.newRunId();
    let record = this.store.putRun({
      id,
      title: spec.title,
      from: spec.from,
      depth: spec.depth,
      parentRunId: spec.parentRunId || null,
      caller: spec.caller || null,
      target: { profileId: spec.profile.id, app: spec.profile.appId, name: spec.targetName },
      access: spec.access,
      cwd: spec.cwd,
      folderId: spec.folderId,
      state: 'starting',
      createdAt: this.iso(),
      session: null
    });
    // Some clients take the session ID from the caller; then the ledger can point
    // at the client's own record from the start.
    const presetSessionId = spec.adapter.presetSessionId ? crypto.randomUUID() : null;
    if (presetSessionId) record = this.store.updateRun(id, { session: { id: presetSessionId, file: null } }) || record;
    const entry = { id, profileId: String(spec.profile.id), child: null, stopReason: null, closed: null, killTimer: null };
    this.active.set(id, entry);
    let resolveClosed;
    entry.closed = new Promise((resolve) => { resolveClosed = resolve; });

    const parser = spec.adapter.createParser({
      onSession: (sessionId) => {
        if (!this.store.getRun(id)) return;
        this.changed(this.store.updateRun(id, { session: { id: sessionId, file: null } }));
      }
    }, { sessionId: presetSessionId });

    // A run ends in two steps. When the process exits, how it ended and when
    // are fixed. The record says so once the session lookup returns, at most
    // lookupTimeoutMs later; a stop, a quit, a client that never started or a
    // run without a session does not wait for it. The state order stays
    // starting -> running -> completed/failed/stopped.
    let finished = false;
    const finish = (code, signal, spawnFailed = false) => {
      if (finished) return;
      finished = true;
      const endedAt = this.iso();
      clearTimeout(entry.killTimer);
      const result = parser.end();
      if (result.answer !== null) this.answers.set(id, { text: result.answer, truncated: result.truncated });
      let state;
      let reasonCode = null;
      if (entry.stopReason) { state = 'stopped'; reasonCode = entry.stopReason; }
      else if (spawnFailed) { state = 'failed'; reasonCode = 'client-start-failed'; }
      else if (code === 0 && !result.failed) state = 'completed';
      else { state = 'failed'; reasonCode = result.failed ? 'client-reported-error' : (signal ? 'client-killed' : 'client-exit-nonzero'); }
      const sessionId = result.sessionId || null;
      let lookupTimer = null;
      const complete = (file) => {
        if (entry.complete !== complete) return;
        entry.complete = null;
        clearTimeout(lookupTimer);
        this.active.delete(id);
        record = this.store.updateRun(id, { state, reasonCode, endedAt, session: sessionId ? { id: sessionId, file: file || null } : null }) || record;
        this.changed(record);
        resolveClosed(record);
        if (sessionId && !file && !spawnFailed) {
          try { this.onSessionUnlinked({ runId: id, profileId: String(spec.profile.id), sessionId }); } catch (_error) { /* presentation only */ }
        }
      };
      entry.complete = complete;
      if (!sessionId || spawnFailed) { complete(null); return; }
      let located;
      try { located = Promise.resolve(this.locateSession(spec.profile, sessionId)); } catch (_error) { located = Promise.resolve(null); }
      located.then((file) => {
        if (entry.complete === complete) complete(file || null);
        else if (file) this.linkSession(id, sessionId, file);
      }, () => complete(null));
      if (entry.stopReason) { complete(null); return; }
      lookupTimer = setTimeout(() => complete(null), this.lookupTimeoutMs);
      lookupTimer.unref?.();
    };

    let child;
    try {
      child = this.spawnImpl(spec.launcher.command, [...(spec.launcher.prefixArgs || []), ...spec.adapter.args(spec.access, { sessionId: presetSessionId })], {
        cwd: spec.cwd,
        env: spec.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        detached: this.platform !== 'win32'
      });
    } catch (_error) {
      finish(null, null, true);
      return this.store.getRun(id);
    }
    entry.child = child;
    child.on('error', () => finish(null, null, true));
    child.on('close', (code, signal) => finish(code, signal));
    child.stdout?.on('data', (chunk) => parser.push(chunk));
    // stderr may hold paths or account details; it is drained, never kept.
    child.stderr?.on('data', () => {});
    child.stdin?.on('error', () => {});
    child.once('spawn', () => {
      if (finished || entry.stopReason) return;
      record = this.store.updateRun(id, { state: 'running', startedAt: this.iso() }) || record;
      this.changed(record);
    });
    try { child.stdin?.end(spec.prompt); } catch (_error) { /* the close handler reports it */ }
    this.changed(record);
    return this.store.getRun(id);
  }

  // Fills in the session file of a run that ended without it, once; only for
  // the run's own session ID. Returns the updated record, or null.
  linkSession(id, sessionId, file) {
    const run = this.store.getRun(id);
    if (!run || !file || !run.session || run.session.id !== sessionId || run.session.file) return null;
    const updated = this.store.updateRun(id, { session: { id: sessionId, file } });
    if (updated) this.changed(updated);
    return updated;
  }

  async stop(id, reason = 'stopped-by-person') {
    const entry = this.active.get(id);
    if (!entry) return this.store.getRun(id);
    // Already exited and only waiting for its session lookup: end it now.
    if (entry.complete) { entry.complete(null); return this.store.getRun(id); }
    if (!entry.stopReason) {
      entry.stopReason = reason;
      if (entry.child) {
        this.killTree(entry.child, 'SIGTERM');
        entry.killTimer = setTimeout(() => this.killTree(entry.child, 'SIGKILL'), this.killGraceMs);
        entry.killTimer.unref?.();
      }
    }
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(null), this.stopWaitMs); timer.unref?.(); });
    const closed = await Promise.race([entry.closed, timeout]);
    clearTimeout(timer);
    return closed || this.store.getRun(id);
  }

  async stopAll(reason) {
    const ids = [...this.active.keys()];
    const results = await Promise.all(ids.map((id) => this.stop(id, reason)));
    return { ok: results.every((record) => record && !ACTIVE_STATES.has(record.state)), stopped: ids.length };
  }
}

module.exports = { HubRunner, KILL_GRACE_MS, LOOKUP_TIMEOUT_MS, defaultKillTree };
