'use strict';

// Where Claude Code keeps its account ID. Only that one field is read.

const os = require('node:os');
const path = require('node:path');
const { readJson } = require('../../core/json-file');
const paths = require('../../core/paths');

// 路径比较需容忍尾分隔符与 Windows 大小写差异（路径可能经过用户手填/展开）
function samePath(a, b) {
  return paths.samePath(a, b);
}

// Claude Code CLI：配置文件是 <数据目录>/.claude.json；历史默认布局下数据目录
// 是 ~/.claude 而配置在 home 根（~/.claude.json），CLAUDE_CONFIG_DIR 布局则同目录。
function claudeCliAccountId(profile) {
  const root = profile.sessionRoot || '';
  const configPath = samePath(root, path.join(os.homedir(), '.claude'))
    ? path.join(os.homedir(), '.claude.json')
    : path.join(root, '.claude.json');
  const json = readJson(configPath);
  return json?.oauthAccount?.accountUuid ?? null;
}

module.exports = { claudeCliAccountId };
