'use strict';

// 调度中枢里由人来定的三处：档案里的两个开关、系统页的文件夹与上限、三个动作的说明纸条。
// 按所有者批准的原型实现；行为在不显示窗口的真实界面里另行核对，这里守住结构、接线与边界。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mainHandlerSource } = require('./helpers/main-handler-source');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function localeKeys(lang) {
  return new Set([...read(`src/i18n/${lang}.js`).matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1]));
}

test('the dossier has a calling section before farewell, with the two approved switches', () => {
  const html = read('src/index.html');
  const dialog = html.slice(html.indexOf('<dialog id="agentManageDialog"'), html.indexOf('</dialog>', html.indexOf('<dialog id="agentManageDialog"')));
  assert.match(dialog, /data-section="accounts"[\s\S]*?id="hubCallingSection"[^>]*data-section="calling"[^>]*hidden[\s\S]*?data-section="farewell"/);
  assert.match(dialog, /<label class="hub-switch" for="hubAllowCall" data-hub-tip="allow">\s*<input id="hubAllowCall" type="checkbox" role="switch">/);
  assert.match(dialog, /<label class="hub-switch" for="hubAllowWrite">\s*<input id="hubAllowWrite" type="checkbox" role="switch">/);
  assert.match(dialog, /data-i18n="hub\.dossier\.allow"[\s\S]*?data-i18n="hub\.dossier\.allow\.hint"[\s\S]*?data-i18n="hub\.dossier\.write"[\s\S]*?data-i18n="hub\.dossier\.write\.hint"/);
  assert.match(dialog, /id="hubCallingNotes"/);
});

test('the dossier switches act only on the expanded local location and only through hub:setAccess', () => {
  const renderer = read('src/renderer.js');
  assert.match(renderer, /renderAgentManageLocations\(group, profile\);\s*renderHubCalling\(group, profile\);/);
  const calling = renderer.slice(renderer.indexOf('function renderHubCalling('), renderer.indexOf('async function saveHubAccess('));
  // 远端位置不显示：调用只在这台电脑上
  assert.match(calling, /profile && profile\._remote !== true \? String\(profile\._meshProfileId \|\| profile\.id\) : ''/);
  // 改文件只能在允许调用时打开；不支持的客户端两个都不能开
  assert.match(calling, /els\.hubAllowCall\.disabled = !supported;/);
  assert.match(calling, /els\.hubAllowWrite\.disabled = !callable;/);
  // 每个不支持的原因都有自己的说明
  for (const key of ['hub.dossier.desktopOnly', 'hub.dossier.promptArgOnly', 'hub.dossier.noReadOnly', 'hub.dossier.notVerified', 'hub.dossier.via', 'hub.dossier.duplicate', 'hub.dossier.duplicateSelf', 'hub.dossier.noFolder']) {
    assert.ok(renderer.includes(`'${key}'`), `${key} 没有接上`);
  }
  const save = renderer.slice(renderer.indexOf('async function saveHubAccess('), renderer.indexOf('function renderHubSystem('));
  assert.match(save, /window\.manager\.hubSetAccess\(\{ profileId, callable: next\.callable === true, writable: next\.writable === true \}\)/);
  // 没存上就退回原样
  assert.match(save, /patch\(\{ callable: before\.callable, writable: before\.writable \}\);/);
  const preload = read('src/preload.js');
  assert.match(preload, /hubSetAccess: \(input = \{\}\) => ipcRenderer\.invoke\('hub:setAccess', \{\s*profileId: String\(input\?\.profileId \|\| ''\)\.slice\(0, 128\),\s*callable: input\?\.callable === true,\s*writable: input\?\.writable === true\s*\}\)/);
});

test('Main exposes caller names and switches per account, nothing else, and refuses unsupported clients', () => {
  const main = mainHandlerSource();
  const accounts = main.slice(main.indexOf('function hubAccounts()'), main.indexOf('function hubPublicState()'));
  assert.match(accounts, /const names = hubCatNames\(profiles\);/);
  assert.match(accounts, /return \{\s*id: String\(profile\.id\),\s*name: [^\n]+,\s*callable: access\.callable,\s*writable: access\.writable\s*\};/);
  assert.match(main, /function hubPublicState\(\) \{[\s\S]*?accounts: hubAccounts\(\),/);
  assert.match(main, /\? \{ callable: true, reason: null, via: adapterFor\(appId\)\.label \}/);
  assert.match(main, /if \(callable && !adapterFor\(profile\.appId\)\) return \{ ok: false, reasonCode: 'client-unsupported'/);
  // The callable clients and the labels Main shows for them (each declared in src/clients/<id>/hub.js).
  const { ADAPTERS } = require('../src/hub/adapters');
  assert.deepEqual(Object.values(ADAPTERS).map((adapter) => adapter.label).sort(), ['Claude Code', 'Codex CLI', 'Gemini CLI', 'Qwen Code']);
  // 命令行没有改开关、文件夹或上限的命令：一个 Agent 不能给自己或别人开门
  const { PACKAGED_COMMANDS } = require('../src/automation/packaged-cli.js');
  const commands = [...(PACKAGED_COMMANDS instanceof Map ? PACKAGED_COMMANDS.keys() : Object.keys(PACKAGED_COMMANDS || {}))].join(' | ');
  assert.doesNotMatch(commands, /access|callable|writable|folder|max-concurrent|limit/i);
});

test('the System page holds allowed folders and the limit; folders come only from the Main picker', () => {
  const html = read('src/index.html');
  const settings = html.slice(html.indexOf('id="systemSettings"'), html.indexOf('</section>\n        </div>', html.indexOf('id="systemSettings"')));
  assert.match(settings, /class="system-setting-line settings-runtime-policy"[\s\S]*?<section id="hubSystem" class="hub-system" aria-labelledby="hubSystemTitle">/);
  assert.match(settings, /id="hubAddFolderBtn" type="button"[\s\S]*?id="hubFolderList" class="hub-folder-list"[\s\S]*?data-i18n="hub\.system\.foldersHint"/);
  const select = settings.slice(settings.indexOf('<select id="hubMaxConcurrent">'), settings.indexOf('</select>', settings.indexOf('<select id="hubMaxConcurrent">')));
  assert.deepEqual([...select.matchAll(/<option value="(\d)"/g)].map((match) => match[1]), ['1', '2', '3', '4']);
  const renderer = read('src/renderer.js');
  assert.match(renderer, /try \{ result = await window\.manager\.hubAddFolder\(\); \}/);
  assert.match(renderer, /window\.manager\.hubRemoveFolder\(id\)/);
  assert.doesNotMatch(renderer, /hubAddFolder\([^)]/);
  assert.match(read('src/preload.js'), /hubAddFolder: \(\) => ipcRenderer\.invoke\('hub:addFolder'\),/);
  assert.match(mainHandlerSource(), /ipcMain\.handle\('hub:addFolder', async (?:\(\) =>|exec\(deps\)) \{\s*(?:const \{[^}]*\} = deps;\s*)?const result = await dialog\.showOpenDialog\(mainWindow,/);
  // 换语言时动态的那几行也换
  assert.match(renderer, /function rerenderLocalizedText\(\) \{[\s\S]*?renderHubSystem\(\);/);
});

test('the two send items carry an icon and a one-line hint; four actions and the run tag explain themselves', () => {
  const html = read('src/index.html');
  assert.match(html, /<div class="context-menu-panel hub-send-panel">\s*<button id="sendSessionInfoBtn" class="hub-menu-item" type="button" disabled data-hub-tip="send"><i class="pxi" data-i="pin" aria-hidden="true"><\/i><span id="sendSessionInfoLabel" data-i18n="session\.sendInfo">[^<]+<\/span><small data-i18n="hub\.menu\.send\.hint">/);
  assert.match(html, /<button id="taskPackageActionBtn" class="hub-menu-item" type="button" disabled data-hub-tip="package"><i class="pxi" data-i="box" aria-hidden="true"><\/i><span data-i18n="taskPackage\.action">[^<]+<\/span><small data-i18n="hub\.menu\.package\.hint">/);
  assert.match(html, /id="copySessionInfoBtn"[^>]*data-hub-tip="copy"/);
  // 计数写在标签里，不把图标和小字冲掉
  const renderer = read('src/renderer.js');
  assert.match(renderer, /\(els\.sendSessionInfoLabel \|\| els\.sendSessionInfoBtn\)\.textContent = count > 1/);
  assert.doesNotMatch(renderer, /els\.sendSessionInfoBtn\.textContent =/);
  assert.match(renderer, /window\.AgentHubUi\?\.installTips\?\.\(document, tr\);/);
  const hub = read('src/renderer/hub.js');
  assert.match(hub, /className: 'hub-kind', tabindex: '0', dataset: \{ hubTip: 'run' \}/);

  global.self = {};
  delete require.cache[require.resolve('../src/renderer/hub.js')];
  require('../src/renderer/hub.js');
  const Ui = global.self.AgentHubUi;
  delete global.self;
  assert.deepEqual([...Ui.TIP_KEYS].sort(), ['allow', 'copy', 'package', 'run', 'send']);
  const used = new Set([...html.matchAll(/data-hub-tip="([a-z]+)"/g)].map((match) => match[1]));
  used.add('run');
  for (const key of used) assert.ok(Ui.TIP_KEYS.has(key), `${key} 没有说明`);
  for (const lang of ['zh', 'en', 'ja']) {
    const keys = localeKeys(lang);
    for (const key of Ui.TIP_KEYS) {
      for (const part of ['title', 'body', 'facts']) assert.ok(keys.has(`hub.tip.${key}.${part}`), `${lang} 缺少 hub.tip.${key}.${part}`);
    }
  }
});

test('the tip appears on hover even over disabled buttons, on keyboard focus, and Escape closes only the tip', () => {
  const hub = read('src/renderer/hub.js');
  const tips = hub.slice(hub.indexOf('function installTips('));
  assert.match(tips, /popover: 'manual'/);
  assert.match(tips, /doc\.elementsFromPoint\(x, y\)/);
  assert.match(tips, /event\.target\.matches\?\.\(':focus-visible'\)/);
  assert.match(tips, /event\.key !== 'Escape' \|\| !anchor\) return;\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  // 不和按钮自己的原生提示叠在一起；不可用时写出原因
  assert.match(tips, /target\.removeAttribute\('title'\);/);
  assert.match(tips, /className: 'hub-tip-reason'/);
  // 原因由界面明确标出，不拿按钮的通用说明冒充原因
  assert.match(tips, /const reason = disabled\(target\) \? \(target\.dataset\.hubReason \|\| ''\)\.trim\(\) : '';/);
  const renderer = read('src/renderer.js');
  for (const button of ['copySessionInfoBtn', 'taskPackageActionBtn', 'sendSessionInfoBtn']) {
    assert.match(renderer, new RegExp(`setHubReason\\(els\\.${button}, `), button);
  }
  for (const lang of ['zh', 'en', 'ja']) {
    const keys = localeKeys(lang);
    for (const key of ['hub.tip.reason.select', 'hub.tip.reason.single', 'hub.tip.reason.localOnly', 'hub.tip.reason.noDevice']) assert.ok(keys.has(key), `${lang} ${key}`);
  }
  // 2px 的格子；减少动态效果时不等、不动
  assert.match(tips, /tip\.style\.left = `\$\{x - \(x % 2\)\}px`;/);
  assert.match(tips, /anchor \|\| reduced\(\) \? 0 : 380/);
  const css = read('src/pixel.css');
  const hubCss = css.slice(css.indexOf('/* ══ 后台对话（调度中枢）'));
  assert.match(hubCss, /\.hub-tip \{[\s\S]*?pointer-events: none;/);
  assert.match(hubCss, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\.hub-tip:popover-open \{ animation: none; \}/);
});

test('every hub string exists in Chinese, English and Japanese', () => {
  const sets = Object.fromEntries(['zh', 'en', 'ja'].map((lang) => [lang, [...localeKeys(lang)].filter((key) => key.startsWith('hub.')).sort()]));
  assert.deepEqual(sets.en, sets.zh);
  assert.deepEqual(sets.ja, sets.zh);
  for (const prefix of ['hub.tip.', 'hub.menu.', 'hub.dossier.', 'hub.system.']) {
    assert.ok(sets.zh.some((key) => key.startsWith(prefix)), prefix);
  }
  const html = read('src/index.html');
  const zh = localeKeys('zh');
  for (const match of html.matchAll(/data-i18n="(hub\.[^"]+)"/g)) assert.ok(zh.has(match[1]), `${match[1]} 不在词表里`);
});
