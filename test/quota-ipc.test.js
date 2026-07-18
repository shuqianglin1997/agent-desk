// AgentDesk — 主进程额度 IPC 契约回归。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.js'), 'utf8');

test('额度 IPC 与 8 秒 activity 探测分离，并支持手动 force', () => {
  assert.match(main, /ipcMain\.handle\('quota:all'/);
  assert.match(main, /quotaService\.getAll\(loadProfiles\(\), \{/);
  assert.match(main, /force: options\.force === true/);
  assert.match(main, /clientVersion: app\.getVersion\(\)/);
  assert.match(preload, /listQuotas: \(options = \{\}\) => ipcRenderer\.invoke\('quota:all', options\)/);
});

test('账号路径或槽位移除时额度缓存会失效', () => {
  assert.match(main, /quotaService\.invalidate\(input\.id\)/);
  assert.match(main, /quotaService\.invalidate\(id\)/);
});
