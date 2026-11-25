const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { mainHandlerSource } = require('./helpers/main-handler-source');
const { rendererSource } = require('./helpers/renderer-source');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const { page, declared, loadPreload } = require('./helpers/behaviour');

test('one Recruit entry opens one dialog with four sections and one primary button', () => {
  const doc = page();
  const dialog = doc.byId('recruitDialog');
  const inDialog = (pred) => doc.all((el) => doc.within(el, dialog) && pred(el));
  assert.equal(doc.byId('addProfileBtn').attrs['aria-controls'], 'recruitDialog');
  assert.equal(doc.byId('windowAddMenu'), null);
  assert.equal(doc.byId('codexImportBtn'), null);
  assert.deepEqual([dialog.attrs['aria-labelledby'], dialog.attrs['aria-describedby']], ['recruitTitle', 'recruitSummary']);
  assert.deepEqual(inDialog((el) => el.attrs.role === 'tab').map((el) => el.attrs['data-section']), ['new', 'existing', 'drop', 'ai']);
  for (const section of ['recruitNew', 'recruitExisting', 'recruitDrop', 'recruitAi']) {
    const panel = doc.byId(section);
    assert.deepEqual([panel.tag, panel.attrs.role, doc.within(panel, dialog)], ['section', 'tabpanel', true]);
  }
  const primaries = inDialog((el) => doc.hasClass(el, 'primary'));
  assert.equal(primaries.length, 1, 'one filled primary button, in the footer');
  const footer = inDialog((el) => el.tag === 'footer')[0];
  assert.ok(doc.hasClass(footer, 'recruit-footer') && primaries[0].attrs.id === 'recruitPrimaryBtn' && doc.within(primaries[0], footer));
  // First use opens the matching sections of the same dialog.
  assert.equal(doc.byId('onboardingCodexImportBtn').attrs['aria-controls'], 'recruitDialog');
  const renderer = rendererSource();
  assert.match(renderer, /onboardingCodexImportBtn\?\.addEventListener\('click'[\s\S]*?recruitDialog\.open\('drop'\)/);
  assert.match(renderer, /onboardingAdvancedBtn\?\.addEventListener\('click'[\s\S]*?recruitDialog\.open\('existing'\)/);
  assert.match(renderer, /if \(els\.recruitDialog\?\.open\) recruitDialog\.render\(\);/);
  // The controller loads before the renderer that creates it.
  const scripts = doc.all((el) => el.tag === 'script' && el.attrs.src).map((el) => el.attrs.src);
  assert.ok(scripts.indexOf('./renderer/recruit.js') >= 0 && scripts.indexOf('./renderer/recruit.js') < scripts.indexOf('./renderer.js'));
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
  const file = {};
  const { api, calls } = loadPreload({ getPathForFile: (item) => (item === file ? '/dropped/auth.json' : '') });
  api.inspectRecruitItem(file);
  api.importRecruitItem('x'.repeat(200));
  api.importRecruitItem(undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['invoke', 'recruit:inspectItem', '/dropped/auth.json'],
    ['invoke', 'recruit:importItem', { selectionId: 'x'.repeat(128) }],
    ['invoke', 'recruit:importItem', { selectionId: '' }]
  ]);
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
  // A global `table { min-width: 720px }` once pushed the table out of the dialog.
  assert.deepEqual([declared('.recruit-accepts', 'width'), declared('.recruit-accepts', 'min-width')], ['100%', '0']);
  assert.deepEqual([declared('.recruit-content > section', 'display'), declared('.recruit-content > section', 'grid-template-columns')], ['grid', 'minmax(0, 1fr)']);
  for (const selector of ['.recruit-choice', '.recruit-home']) assert.equal(declared(selector, 'text-transform'), 'none');
});
