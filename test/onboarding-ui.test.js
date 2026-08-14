const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(ROOT, 'src/renderer.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'src/workspace.css'), 'utf8');
const preload = fs.readFileSync(path.join(ROOT, 'src/preload.js'), 'utf8');

function bodyOf(name, nextName) {
  const start = renderer.indexOf(`function ${name}`);
  const end = nextName ? renderer.indexOf(`function ${nextName}`, start + 1) : -1;
  assert.notEqual(start, -1, `${name} should exist`);
  return renderer.slice(start, end === -1 ? renderer.length : end);
}

test('首次使用复用有界 Dialog，不改变 Header/Footer/三面板骨架', () => {
  assert.equal((html.match(/<header class="app-topbar">/g) || []).length, 1);
  assert.equal((html.match(/<footer id="statusBar"/g) || []).length, 1);
  for (const id of ['agentPanel', 'sessionPane', 'detailPanel']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="welcomeDialog"[\s\S]*?id="onboardingContent"/);
  assert.match(html, /id="onboardingMigration"[\s\S]*?id="onboardingAgent"[\s\S]*?id="onboardingPreparation"[\s\S]*?id="onboardingComplete"/);
  assert.match(html, /id="onboardingFooter" class="utility-dialog-footer/);
  assert.match(html, /id="welcomeDialogCloseBtn"[^>]*type="button"/);
  assert.match(html, /id="welcomeDialog"[^>]*aria-labelledby="welcomeDialogTitle"[^>]*aria-describedby="welcomeDialogLead"/);
});

test('首个 Agent 只提交稳定 Profile ID、名称和客户端枚举，不回退旧联网初始化', () => {
  const setup = bodyOf('startFirstAgentSetup', 'continueFirstPreparation');
  assert.match(preload, /initializeFirstAgent:\s*\(input\s*=\s*\{\}\)\s*=>\s*ipcRenderer\.invoke\('onboarding:initializeFirstAgent', input\)/);
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
  assert.match(html, /id="onboardingMigrationList"/);
  assert.match(html, /id="onboardingAgentName"[^>]*maxlength="80"/);
  assert.match(html, /id="onboardingAgentClient"[^>]*aria-label=/);
  assert.match(html, /id="onboardingStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /id="onboardingAdvancedBtn"[^>]*type="button"/);
  assert.match(renderer, /onboardingMigrationList[\s\S]*?checkbox\.type\s*=\s*'checkbox'/);
  assert.match(renderer, /welcomeDialog\?\.querySelector\('form'\)\?\.addEventListener\('submit'/);
});

test('首用 Dialog 只让 Content 滚动，Header 与事务 Footer 保持固定并支持小视口', () => {
  assert.match(css, /\.welcome-dialog\.is-onboarding[\s\S]*?width:\s*min\(680px/);
  assert.match(css, /\.welcome-dialog\.is-onboarding \.dialog-body\.utility-dialog-shell[\s\S]*?--dialog-preferred-height:\s*610px/);
  assert.match(css, /\.onboarding-migration-list[\s\S]*?overflow:\s*auto/);
  assert.match(css, /\.onboarding-footer > span\s*\{\s*flex:\s*1/);
  assert.match(css, /@media \(max-width:\s*680px\)[\s\S]*?\.onboarding-agent-form\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
});
