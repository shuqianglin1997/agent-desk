'use strict';

// Where Claude desktop keeps its account ID. Only that one field is read.

const path = require('node:path');
const { readJson } = require('../../core/json-file');

// 桌面 Claude App：<profilePath>/config.json 的 lastKnownAccountUuid
function claudeDesktopAccountId(profile) {
  const json = readJson(path.join(profile.profilePath || '', 'config.json'));
  return json?.lastKnownAccountUuid ?? null;
}

module.exports = { claudeDesktopAccountId };
