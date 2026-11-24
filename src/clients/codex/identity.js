'use strict';

// Where Codex keeps its account ID (desktop and CLI share CODEX_HOME). Only that
// one field is read.

const path = require('node:path');
const { readJson } = require('../../core/json-file');

// Codex（桌面 App 与 CLI 共用 CODEX_HOME）：<sessionRoot>/auth.json 的 tokens.account_id
function codexAccountId(profile) {
  const json = readJson(path.join(profile.sessionRoot || '', 'auth.json'));
  return json?.tokens?.account_id ?? null;
}

module.exports = { codexAccountId };
