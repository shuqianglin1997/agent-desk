const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { rendererSource } = require('./helpers/renderer-source');
const { page, styleRules, declared, loadPreload } = require('./helpers/behaviour');

const ROOT = path.join(__dirname, '..');
const renderer = rendererSource();
const doc = page();

function bodyOf(name, nextName) {
  const start = renderer.indexOf(`function ${name}`);
  const end = nextName ? renderer.indexOf(`function ${nextName}`, start + 1) : -1;
  assert.notEqual(start, -1, `${name} should exist`);
  return renderer.slice(start, end === -1 ? renderer.length : end);
}

test('首次使用复用有界 Dialog，不改变 Header/Footer/三面板骨架', () => {
  assert.equal(doc.all((el) => el.tag === 'header' && doc.hasClass(el, 'app-topbar')).length, 1);
  assert.equal(doc.all((el) => el.tag === 'footer' && el.attrs.id === 'statusBar').length, 1);
  for (const id of ['agentPanel', 'sessionPane', 'detailPanel']) {
    assert.ok(doc.byId(id), `${id} exists`);
  }
  const dialog = doc.byId('welcomeDialog');
  assert.ok(doc.within(doc.byId('onboardingContent'), dialog));
  const steps = ['onboardingMigration', 'onboardingAgent', 'onboardingPreparation', 'onboardingComplete'].map((id) => doc.index(doc.byId(id)));
  assert.deepEqual(steps, [...steps].sort((a, b) => a - b), 'the steps keep their order');
  assert.ok(doc.hasClass(doc.byId('onboardingFooter'), 'utility-dialog-footer'));
  assert.equal(doc.byId('welcomeDialogCloseBtn').attrs.type, 'button');
  assert.deepEqual([dialog.attrs['aria-labelledby'], dialog.attrs['aria-describedby']], ['welcomeDialogTitle', 'welcomeDialogLead']);
  const boot = renderer.slice(
    renderer.indexOf("window.addEventListener('DOMContentLoaded'"),
    renderer.indexOf('const LEGACY_SETTING_KEYS')
  );
  const profileLoader = renderer.slice(
    renderer.indexOf('async function loadProfiles('),
    renderer.indexOf('async function loadSessions()')
  );
  const startupProfiles = boot.indexOf("await loadProfiles(null, { presentFirstUseBeforeSessions: true });");
  const startupHistory = boot.indexOf('await loadTaskPackageHistory();');
  const listProfiles = profileLoader.indexOf('await window.manager.listProfiles();');
  const presentFirstUse = profileLoader.indexOf('maybeShowWelcome();');
  const renderAccounts = profileLoader.indexOf('renderAccounts();');
  const loadSessions = profileLoader.indexOf('await loadSessions();');
  for (const index of [startupProfiles, startupHistory, listProfiles, presentFirstUse, renderAccounts, loadSessions]) {
    assert.ok(index >= 0, 'first-use startup ordering contract must remain explicit');
  }
  assert.ok(startupProfiles < startupHistory);
  assert.ok(listProfiles < presentFirstUse);
  assert.ok(presentFirstUse < renderAccounts);
  assert.ok(presentFirstUse < loadSessions);
});

test('首个 Agent 只提交稳定 Profile ID、名称和客户端枚举，不回退旧联网初始化', () => {
  const setup = bodyOf('startFirstAgentSetup', 'continueFirstPreparation');
  const { api, calls } = loadPreload();
  api.initializeFirstAgent({ displayName: 'x' });
  api.initializeFirstAgent();
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['invoke', 'onboarding:initializeFirstAgent', { displayName: 'x' }], ['invoke', 'onboarding:initializeFirstAgent', {}]]);
  assert.match(setup, /displayName:\s*model\.draft\.displayName/);
  assert.match(setup, /requestedAppId:\s*model\.draft\.requestedAppId/);
  assert.match(setup, /requestedClientForm:\s*model\.draft\.requestedClientForm/);
  assert.match(setup, /migrationProfileIds:\s*\[\.\.\.model\.selectedProfileIds\]/);
  assert.match(setup, /window\.manager\.initializeFirstAgent\(input\)/);
  assert.doesNotMatch(setup, /initializeMesh/);
  assert.doesNotMatch(setup, /profilePath|sessionRoot|executablePath|command|argv/);
});

test('欢迎完成版本不会在打开 Dialog 前写入，只在完成页可见后持久化', () => {
  const maybe = bodyOf('maybeShowWelcome', 'firstUseErrorText');
  const finish = bodyOf('finishFirstUse');
  assert.doesNotMatch(maybe, /persistSettings|welcomed\s*=\s*true/);
  assert.match(renderer, /type:\s*'rendered',[\s\S]*?phase:\s*'complete'/);
  assert.match(finish, /completionPatch\(state\.firstUse\.model\)/);
  assert.match(finish, /persistSettings\(patch\)/);
});

test('迁移预览、首选客户端和高级入口具备键盘与状态语义', () => {
  assert.ok(doc.byId('onboardingMigrationList'));
  assert.equal(doc.byId('onboardingAgentName').attrs.maxlength, '80');
  assert.ok('aria-label' in doc.byId('onboardingAgentClient').attrs);
  assert.deepEqual([doc.byId('onboardingStatus').attrs.role, doc.byId('onboardingStatus').attrs['aria-live']], ['status', 'polite']);
  assert.equal(doc.byId('onboardingAdvancedBtn').attrs.type, 'button');
  assert.match(renderer, /onboardingMigrationList[\s\S]*?checkbox\.type\s*=\s*'checkbox'/);
  assert.match(renderer, /welcomeDialog\?\.querySelector\('form'\)\?\.addEventListener\('submit'/);
});

test('首用 Dialog 只让 Content 滚动，Header 与事务 Footer 保持固定并支持小视口', () => {
  assert.match(declared('.welcome-dialog.is-onboarding', 'width'), /^min\(680px/);
  assert.deepEqual(styleRules(null).filter((rule) => '--dialog-preferred-height' in rule.decls), []);
  // The pixel skin's rule for the dialog shell sets the height (unlayered, so it
  // always wins over workspace.css's layers).
  const shell = styleRules('dialog .dialog-body.utility-dialog-shell').filter((rule) => rule.layer === null && !rule.conditional);
  assert.ok(shell.some((rule) => rule.decls.height === 'auto' && /^calc\(100dvh/.test(rule.decls['max-height'] || '')), 'the skin lets the shell grow up to the window');
  assert.equal(declared('.onboarding-migration-list', 'overflow'), 'auto');
  assert.equal(declared('.onboarding-footer > span', 'flex'), '1');
  assert.ok(styleRules('.onboarding-agent-form').some((rule) => rule.conditional && rule.decls['grid-template-columns'] === 'minmax(0, 1fr)'), 'one column on a narrow window');
});
