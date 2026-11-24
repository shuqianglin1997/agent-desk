'use strict';

/*
 * AgentDesk 调度中枢 — per-client background-run adapters.
 *
 * Each adapter fixes the whole argument list of the client's official
 * non-interactive mode. A caller only chooses an account, a title, an allowed
 * folder, read or write, and the prompt; the prompt always goes to the child's
 * standard input, never into argv. Nothing here starts a process.
 *
 * Every adapter records where its facts come from (checked 2026-11-24):
 * how the prompt is read, how read-only and write are expressed, how the end is
 * judged, where the final answer comes from and where the session record lives.
 */

const apps = require('../apps');
const { CLAUDE_FIXED_QUERY, MAX_ANSWER_CHARS, lineParser } = require('../clients/hub-io');

// Clients that can be called declare `hub` (src/clients/<id>/hub.js); the
// others declare why not as `hubUnsupported`. Desktop-only clients can only
// open a window; to be called, the same account needs its command-line client.
const ADAPTERS = Object.freeze(Object.fromEntries(apps.appIds()
  .filter((appId) => apps.getApp(appId).hub)
  .map((appId) => [appId, apps.getApp(appId).hub])));
const UNSUPPORTED = Object.freeze(Object.fromEntries(apps.appIds()
  .filter((appId) => typeof apps.getApp(appId).hubUnsupported === 'string')
  .map((appId) => [appId, apps.getApp(appId).hubUnsupported])));

function adapterFor(appId) {
  return Object.hasOwn(ADAPTERS, appId) ? ADAPTERS[appId] : null;
}

function unsupportedReason(appId) {
  if (adapterFor(appId)) return null;
  return Object.hasOwn(UNSUPPORTED, appId) ? UNSUPPORTED[appId] : 'not-verified-yet';
}

module.exports = { ADAPTERS, UNSUPPORTED, MAX_ANSWER_CHARS, CLAUDE_FIXED_QUERY, adapterFor, unsupportedReason, lineParser };
