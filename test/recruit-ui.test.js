const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { mainHandlerSource } = require('./helpers/main-handler-source');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('one Recruit entry opens one dialog with four sections and one primary button', () => {
  const html = read('src/index.html');
  const dialog = html.slice(html.indexOf('<dialog id="recruitDialog"'), html.indexOf('</dialog>', html.indexOf('<dialog id="recruitDialog"')));
  assert.match(html, /id="addProfileBtn"[^>]*aria-controls="recruitDialog"/);
  assert.doesNotMatch(html, /id="windowAddMenu"|id="codexImportBtn"/);
  assert.match(dialog, /aria-labelledby="recruitTitle"[^>]*aria-describedby="recruitSummary"/);
  const tabs = [...dialog.matchAll(/role="tab" id="(recruitTab\w+)" data-section="(\w+)"/g)].map((match) => match[2]);
  assert.deepEqual(tabs, ['new', 'existing', 'drop', 'ai']);
  for (const section of ['recruitNew', 'recruitExisting', 'recruitDrop', 'recruitAi']) {
    assert.match(dialog, new RegExp(`<section id="${section}" role="tabpanel"`));
  }
  assert.equal((dialog.match(/class="primary"/g) || []).length, 1, 'one filled primary button, in the footer');
  assert.match(dialog, /<footer class="utility-dialog-footer recruit-footer">[\s\S]*?id="recruitPrimaryBtn" class="primary"/);
  // First use opens the matching sections of the same dialog.
  assert.match(html, /id="onboardingCodexImportBtn"[^>]*aria-controls="recruitDialog"/);
  const renderer = read('src/renderer.js');
  assert.match(renderer, /onboardingCodexImportBtn\?\.addEventListener\('click'[\s\S]*?recruitDialog\.open\('drop'\)/);
  assert.match(renderer, /onboardingAdvancedBtn\?\.addEventListener\('click'[\s\S]*?recruitDialog\.open\('existing'\)/);
  assert.match(renderer, /if \(els\.recruitDialog\?\.open\) recruitDialog\.render\(\);/);
  // The controller loads before the renderer that creates it.
  assert.ok(html.indexOf('./renderer/recruit.js') < html.indexOf('./renderer.js'));
});

test('the dialog never handles a raw path and clears a pasted key right after reading it', () => {
  const recruit = read('src/renderer/recruit.js');
  const used = new Set([...recruit.matchAll(/manager\.(\w+)/g)].map((match) => match[1]));
  assert.deepEqual([...used].sort(), [
    'getProfileCredentialStatus', 'importRecruitItem', 'inspectRecruitItem', 'launchProfile', 'pickRecruitItem',
    'recruitCancelDiscover', 'recruitCreateAccount', 'recruitDiscover', 'recruitDiscoverFolder', 'recruitRegister', 'writeClipboard'
  ]);
  assert.match(recruit, /request\.secret = secretInput\?\.value \|\| '';\s*\/\/ The key goes once to Main; the field never keeps it\.\s*if \(secretInput\) secretInput\.value = '';/);
  assert.doesNotMatch(recruit, /localStorage|sessionStorage|console\.(log|info|debug)/);
  assert.doesNotMatch(recruit, /\.path\b|filePath|getPathForFile/);
  const preload = read('src/preload.js');
  assert.match(preload, /function inspectRecruitItem\(file\)[\s\S]*?webUtils\.getPathForFile\(file\)[\s\S]*?invoke\('recruit:inspectItem', selectedPath\)/);
  assert.match(preload, /importRecruitItem: \(selectionId\) => ipcRenderer\.invoke\('recruit:importItem', \{ selectionId: String\(selectionId \|\| ''\)\.slice\(0, 128\) \}\)/);
  const main = mainHandlerSource();
  assert.match(main, /ipcMain\.handle\('recruit:importItem'[\s\S]*?resolveEntry\(selectionId, 'recruit-item'\)[\s\S]*?executeRecruitItem\(itemPath, meta\?\.action\)/);
  assert.match(read('src/main/recruit-items.js'), /if \(planned\.action !== expectedAction\) throw new RecruitItemError\('location-changed'\);/);
});

test('the preload exposes the recruit methods without a generic invoke or a path argument', async () => {
  const calls = [];
  let manager;
  const file = {};
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, value) => { manager = value; } },
    ipcRenderer: { invoke: (...args) => { calls.push(args); return Promise.resolve({ ok: true }); }, on() {}, removeListener() {} },
    webUtils: { getPathForFile: (value) => (value === file ? '/Users/someone/.dsh' : '') }
  };
  vm.runInNewContext(read('src/preload.js'), { require: () => electron, process: { platform: 'darwin' } });
  assert.equal(manager.invoke, undefined);
  assert.equal((await manager.inspectRecruitItem('/etc/passwd')).reasonCode, 'credential-file-unreadable');
  await manager.inspectRecruitItem(file);
  await manager.importRecruitItem('id-1');
  await manager.recruitCreateAccount({ appId: 'dsh-cli', signIn: 'key', secret: 'sk-value', extra: 'dropped', provider: { baseUrl: 'https://x', command: 'rm' } });
  const plain = (value) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(calls[0]), ['recruit:inspectItem', '/Users/someone/.dsh']);
  assert.deepEqual(plain(calls[1]), ['recruit:importItem', { selectionId: 'id-1' }]);
  assert.equal(calls[2][0], 'recruit:createAccount');
  assert.deepEqual(Object.keys(calls[2][1]).sort(), ['appId', 'catalogProviderId', 'model', 'name', 'provider', 'secret', 'signIn']);
  assert.deepEqual(Object.keys(calls[2][1].provider).sort(), ['baseUrl', 'id', 'model']);
});

test('recruit copy exists in all three languages and the dialog styles stay inside the folder', () => {
  const tables = Object.fromEntries(['zh', 'en', 'ja'].map((lang) => [lang, require(`../src/i18n/${lang}.js`).AgentDeskLocales[lang]]));
  const keys = (lang) => Object.keys(tables[lang]).filter((key) => key.startsWith('recruit.')).sort();
  assert.ok(keys('zh').length > 100);
  assert.deepEqual(keys('en'), keys('zh'));
  assert.deepEqual(keys('ja'), keys('zh'));
  const used = new Set();
  for (const source of [read('src/renderer/recruit.js'), read('src/index.html')]) {
    for (const match of source.matchAll(/['"`](recruit\.[a-zA-Z0-9.-]+)['"`]/g)) used.add(match[1]);
  }
  for (const key of used) assert.ok(Object.hasOwn(tables.zh, key), `missing ${key}`);
  for (const section of ['tab.new', 'method.browser', 'note.plaintext', 'drop.move', 'ai.human']) {
    assert.ok(tables.en[`recruit.${section}`] && tables.en[`recruit.${section}`] !== tables.zh[`recruit.${section}`]);
  }
  const css = read('src/pixel.css');
  assert.match(css, /══ 招募 ══/);
  // A global `table { min-width: 720px }` once pushed the table out of the dialog.
  assert.match(css, /\.recruit-accepts \{ width: 100%; min-width: 0;/);
  assert.match(css, /\.recruit-content > section \{ display: grid; grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(css, /\.recruit-choice, \.recruit-home \{[^}]*text-transform: none;/);
});
