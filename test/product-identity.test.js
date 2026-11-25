'use strict';

// The rename to Catshelf (docs/RENAME_PLAN.md): the shown names change, the
// data folder, keychain item, bundle id and repository do not.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { makeTempDir } = require('./helpers/temp');
const product = require('../src/core/product');
const packageJson = require('../package.json');

function fakeApp({ switches = [], appData = '/Users/alice/Library/Application Support' } = {}) {
  const calls = [];
  const listeners = {};
  let name = 'Catshelf';
  return {
    calls,
    listeners,
    get name() { return name; },
    setName(value) { calls.push(['setName', value]); name = value; },
    getPath(key) { calls.push(['getPath', key]); return key === 'appData' ? appData : `/unexpected/${key}`; },
    setPath(key, value) { calls.push(['setPath', key, value]); },
    prependOnceListener(event, listener) { calls.push(['prependOnceListener', event]); listeners[event] = listener; },
    commandLine: { hasSwitch: (key) => switches.includes(key) }
  };
}

test('启动最早处：先用旧名，数据目录固定为 appData/AgentDesk，will-finish-launching 再换回 Catshelf', () => {
  const app = fakeApp();
  const made = [];
  const result = product.keepLegacyIdentity(app, { mkdir: (dir) => made.push(dir) });
  const userData = path.join('/Users/alice/Library/Application Support', 'AgentDesk');
  assert.deepEqual(app.calls, [
    ['setName', 'AgentDesk'],
    ['getPath', 'appData'],
    ['setPath', 'userData', userData],
    ['prependOnceListener', 'will-finish-launching']
  ]);
  assert.deepEqual(made, [userData], 'the folder exists before setPath');
  assert.deepEqual(result, { userData });
  assert.equal(app.name, 'AgentDesk', 'Electron fixes the keychain item while the old name is set');
  app.listeners['will-finish-launching']();
  assert.equal(app.name, 'Catshelf', 'menus, dialogs and the about panel show the new name');
  // Prepended: Electron's own will-finish-launching listener builds the default
  // menu from the app name, so ours must run before it.
});

test('显式 --user-data-dir（验收、便携）不被改写', () => {
  const app = fakeApp({ switches: ['user-data-dir'] });
  const made = [];
  assert.deepEqual(product.keepLegacyIdentity(app, { mkdir: (dir) => made.push(dir) }), { userData: null });
  assert.deepEqual(app.calls, [['setName', 'AgentDesk'], ['prependOnceListener', 'will-finish-launching']]);
  assert.deepEqual(made, []);
});

test('首次启动时数据目录还不存在：先建成只有本人能进的文件夹', (t) => {
  const appData = makeTempDir(t, 'agentdesk-product-');
  const app = fakeApp({ appData });
  product.keepLegacyIdentity(app);
  const folder = path.join(appData, 'AgentDesk');
  assert.ok(fs.statSync(folder).isDirectory());
  if (process.platform !== 'win32') assert.equal(fs.statSync(folder).mode & 0o777, 0o700);
  product.keepLegacyIdentity(fakeApp({ appData }));
  assert.ok(fs.statSync(folder).isDirectory(), 'an existing folder is kept');
});

test('名字：显示 Catshelf／猫架，程序包标识与数据目录名不变', () => {
  assert.equal(product.PRODUCT_NAME, 'Catshelf');
  assert.equal(product.PRODUCT_NAME_ZH, '猫架');
  assert.equal(product.LEGACY_NAME, 'AgentDesk');
  assert.equal(packageJson.productName, product.PRODUCT_NAME);
  assert.equal(packageJson.build.productName, product.PRODUCT_NAME);
  assert.equal(packageJson.build.appId, product.BUNDLE_ID);
  assert.equal(product.BUNDLE_ID, 'com.hupo.agentdesk');
  assert.deepEqual(product.CLI_COMMANDS, ['catshelf', 'agentdesk']);
});

test('仓库地址只在 package.json 的 repository 一处，其余两处跟着它', () => {
  const { owner, name } = product.REPOSITORY;
  // Renamed from agent-desk on 2026-11-25 (docs/RENAME_PLAN.md); the old address redirects.
  assert.deepEqual({ owner, name }, { owner: 'shuqianglin1997', name: 'catshelf' });
  assert.equal(packageJson.homepage, `https://github.com/${owner}/${name}`);
  assert.equal(packageJson.bugs.url, `https://github.com/${owner}/${name}/issues`);
  assert.equal(require('../src/updater').REPOSITORY, product.REPOSITORY);
  assert.deepEqual(product.repositoryOf({ repository: 'git@github.com:someone/catshelf.git' }), { owner: 'someone', name: 'catshelf' });
  assert.throws(() => product.repositoryOf({ repository: { url: 'https://example.com/x/y' } }), /GitHub/);
});
