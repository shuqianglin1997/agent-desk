#!/usr/bin/env node
'use strict';

/*
 * Reference captures of the real Catshelf window, for drawing the launch film.
 *
 * The film draws the Catshelf window itself (docs/LAUNCH_VIDEO_PLAN.md §7); this
 * script is how the drawing is checked against the app. It starts the real app
 * through scripts/hidden-electron-entry.js (never shown or focused, no client
 * launched, keychain mocked) with the film's accounts in a temporary data
 * folder, sets the viewport to the film's window (960×840 at 2×), and writes
 * for each state a screenshot and a JSON list of every visible element's box,
 * text, colours and font.
 *
 *   node media/launch-video/reference/capture.js <out-dir> [zh|en ...]
 *
 * Nothing here is used at render time, and nothing here changes the app.
 */

process.env.AGENTDESK_UI_ACCEPTANCE_HIDDEN = '1';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const { launchElectronApp, closeElectronApp, waitFor, settleDialogMotion, pressEscape, finishHidden } = require(path.join(ROOT, 'scripts', 'ui-acceptance.js'));
const { prepare } = require(path.join(ROOT, 'scripts', 'ui-snapshots.js'));

const FIXED_TIME = new Date('2026-08-12T06:00:00.000Z');
const NAMES = {
  zh: { work: '工作', personal: '个人', company: '公司接口', team: '团队' },
  en: { work: 'Work', personal: 'Personal', company: 'Company API', team: 'Team' }
};
const CAST = [['codex', 'work'], ['codex', 'personal'], ['codex', 'company'], ['claude', 'personal'], ['claude-cli', 'team'], ['qwen-code', 'personal']];
const TITLES = {
  zh: ['给首页加骨架屏', '修复退款接口超时', '整理部署脚本', '调研缓存方案', '补登录页测试', '迁移订单表字段'],
  en: ['Skeleton for the home page', 'Fix refund API timeout', 'Tidy deploy scripts', 'Look into caching', 'Login page tests', 'Migrate order fields']
};
const PROJECTS = ['shop-web', 'shop-api', 'infra', 'notes', 'shop-api', 'shop-api'];

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function writeCodexSession(root, input) {
  const dir = path.join(root, 'sessions', '2026', '08', '12');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `rollout-${input.physicalId}.jsonl`), `${JSON.stringify({
    timestamp: input.createdAt, type: 'session_meta',
    payload: { id: input.physicalId, session_id: input.conversationId, cwd: input.projectPath, model_provider: 'openai' }
  })}\n`, { mode: 0o600 });
  fs.appendFileSync(path.join(root, 'session_index.jsonl'), `${JSON.stringify({ id: input.conversationId, thread_name: input.title, updated_at: input.updatedAt })}\n`, { mode: 0o600 });
}

function seed(userData, lang) {
  const profiles = CAST.map(([appId, who], index) => {
    const root = path.join(userData, 'fixtures', `account-${index + 1}`);
    fs.mkdirSync(root, { recursive: true });
    const profilePath = path.join(userData, 'profiles', `account-${index + 1}`);
    fs.mkdirSync(profilePath, { recursive: true });
    return {
      id: `film-account-${index + 1}`, appId, name: NAMES[lang][who], group: '', note: '',
      identityKey: `film-login-${index + 1}`, profilePath, sessionRoot: root,
      profilePathMode: 'custom', sessionRootMode: 'custom', isProtected: false,
      createdAt: `2026-08-12T01:0${index}:00.000Z`
    };
  });
  TITLES[lang].forEach((title, k) => {
    const owner = [0, 2, 0, 1, 2, 1][k];
    writeCodexSession(profiles[owner].sessionRoot, {
      physicalId: `${String(k + 1).repeat(8)}-1111-4111-8111-${String(k + 1).repeat(12)}`,
      conversationId: `film-conversation-${k + 1}`, title,
      projectPath: path.join(userData, 'projects', PROJECTS[k]),
      createdAt: '2026-08-12T02:00:00.000Z', updatedAt: `2026-08-12T0${5 - Math.floor(k / 2)}:${k % 2 ? '30' : '00'}:00.000Z`
    });
  });
  writeJson(path.join(userData, 'profiles.json'), { version: 3, profiles });
  writeJson(path.join(userData, 'settings.json'), {
    version: 2,
    settings: {
      theme: 'light', view: 'yard', lang, sessionScope: 'current', sessionView: 'compact', remindersOn: false,
      atmosTime: 'day', atmosWeather: 'clear', welcomed: true,
      onboarding: { completedVersion: 1, completedAt: '2026-08-14T00:00:00.000Z' },
      ledger: null, meshSignalingUrls: [], meshStunUrls: [], yardPositions: {}
    }
  });
}

function fixTimes(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) fixTimes(target);
    if (entry.isFile() || entry.isDirectory()) fs.utimesSync(target, FIXED_TIME, FIXED_TIME);
  }
}

// Every visible element: its box, own text, colours, borders and font.
const DUMP = `(() => {
  const out = [];
  const walk = (el, depth) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const r = el.getBoundingClientRect();
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).filter(Boolean).join(' ');
    if (r.width > 0 && r.height > 0) {
      const entry = { d: depth, tag: el.tagName.toLowerCase(), id: el.id || undefined, cls: el.className && String(el.className.baseVal ?? el.className) || undefined,
        x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2), text: own || undefined,
        color: cs.color, bg: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : undefined,
        bgi: cs.backgroundImage !== 'none' ? cs.backgroundImage.slice(0, 300) : undefined,
        border: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].some((v) => v !== '0px') ? [cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, cs.borderRightWidth + ' ' + cs.borderRightStyle + ' ' + cs.borderRightColor, cs.borderBottomWidth + ' ' + cs.borderBottomStyle + ' ' + cs.borderBottomColor, cs.borderLeftWidth + ' ' + cs.borderLeftStyle + ' ' + cs.borderLeftColor] : undefined,
        shadow: cs.boxShadow !== 'none' ? cs.boxShadow : undefined, clip: cs.clipPath !== 'none' ? cs.clipPath.slice(0, 200) : undefined,
        font: own ? cs.fontSize + ' ' + cs.fontWeight + ' ' + cs.fontFamily.slice(0, 60) + ' / ' + cs.lineHeight + ' ' + cs.textAlign : undefined,
        pad: cs.padding !== '0px' ? cs.padding : undefined, icon: el.dataset && el.dataset.i || undefined, opacity: cs.opacity !== '1' ? cs.opacity : undefined };
      for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(el, pseudo);
        if (ps.content && ps.content !== 'none' && ps.content !== 'normal') entry[pseudo] = { content: ps.content.slice(0, 40), w: ps.width, h: ps.height, bg: ps.backgroundColor, bgi: ps.backgroundImage.slice(0, 200), pos: ps.position, inset: [ps.top, ps.right, ps.bottom, ps.left].join(' '), border: ps.borderTopWidth + ' ' + ps.borderTopColor, color: ps.color };
      }
      out.push(entry);
    }
    for (const child of el.children) walk(child, depth + 1);
  };
  walk(document.body, 0);
  return out;
})()`;

async function shot(client, dir, name) {
  await settleDialogMotion(client);
  await client.evaluate(`document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const result = await client.call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(result.data, 'base64'));
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(await client.evaluate(DUMP)));
}

const STATES = [
  { name: 'all', enter: [`document.querySelector('#rosterAllCard').click()`] },
  { name: 'selected', enter: [`document.querySelectorAll('#accountRoster .account-card-select')[2].click()`] },
  { name: 'checked', enter: [`document.querySelector('#rosterAllCard').click()`, `document.querySelectorAll('#sessionRows .session-select-box')[1].click()`], leave: `document.querySelector('#clearSessionSelectionBtn')?.click()` },
  { name: 'send-menu', enter: [`document.querySelectorAll('#sessionRows .session-select-box')[1].click()`, `document.querySelector('#sessionSendMenu').open = true`], leave: `document.querySelector('#sessionSendMenu').open = false; document.querySelector('#clearSessionSelectionBtn')?.click()` },
  { name: 'recruit-new', enter: [`document.querySelector('#addProfileBtn').click()`], ready: `document.querySelector('#recruitDialog').open`, escape: true },
  { name: 'recruit-existing', enter: [`document.querySelector('#addProfileBtn').click()`, `[...document.querySelectorAll('#recruitDialog [role=tab]')][1]?.click()`], ready: `document.querySelector('#recruitDialog').open`, escape: true },
  { name: 'recruit-drop', enter: [`document.querySelector('#addProfileBtn').click()`, `[...document.querySelectorAll('#recruitDialog [role=tab]')][2]?.click()`], ready: `document.querySelector('#recruitDialog').open`, escape: true },
  { name: 'recruit-ai', enter: [`document.querySelector('#addProfileBtn').click()`, `[...document.querySelectorAll('#recruitDialog [role=tab]')][3]?.click()`], ready: `document.querySelector('#recruitDialog').open`, escape: true },
  { name: 'archive', enter: [`document.querySelectorAll('#accountRoster .account-card-manage')[0].click()`], ready: `document.querySelector('#agentManageDialog').open`, escape: true }
];

async function captureLanguage(outDir, lang, tempRoot) {
  const output = [];
  const userData = path.join(tempRoot, lang);
  seed(userData, lang);
  fixTimes(userData);
  const dir = path.join(outDir, lang);
  fs.mkdirSync(dir, { recursive: true });
  const instance = await launchElectronApp(userData, output);
  try {
    const { client } = instance;
    const ready = `typeof AgentDeskInspect !== 'undefined' && AgentDeskInspect.state.profiles.length === ${CAST.length} && !document.querySelector('#welcomeDialog').open && document.querySelectorAll('#sessionRows tr:not(.empty-row)').length >= 1`;
    await waitFor(client, ready, 'workspace', 40_000);
    await client.call('Emulation.setDeviceMetricsOverride', { width: 960, height: 840, deviceScaleFactor: 2, mobile: false });
    await prepare(client, ready, 'workspace after reload');
    for (const state of STATES) {
      try {
        for (const step of state.enter || []) { await client.evaluate(step); await new Promise((resolve) => setTimeout(resolve, 250)); }
        if (state.ready) await waitFor(client, state.ready, `${state.name} ready`);
        await shot(client, dir, state.name);
      } catch (error) {
        process.stdout.write(`${lang} ${state.name}: ${error.message}\n`);
      }
      if (state.escape) await pressEscape(client);
      if (state.leave) await client.evaluate(state.leave);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    await closeElectronApp(instance);
  }
}

// The desk before the first account: no profiles at all.
async function captureEmpty(outDir, lang, tempRoot) {
  const output = [];
  const userData = path.join(tempRoot, `${lang}-empty`);
  writeJson(path.join(userData, 'settings.json'), { version: 2, settings: { theme: 'light', lang, sessionView: 'compact' } });
  const dir = path.join(outDir, lang);
  fs.mkdirSync(dir, { recursive: true });
  const instance = await launchElectronApp(userData, output);
  try {
    const { client } = instance;
    const ready = `typeof AgentDeskInspect !== 'undefined' && AgentDeskInspect.state.startupStage === 'ready' && Boolean(document.querySelector('#accountRoster .account-roster-empty'))`;
    await waitFor(client, ready, 'empty desk', 40_000);
    await client.call('Emulation.setDeviceMetricsOverride', { width: 960, height: 840, deviceScaleFactor: 2, mobile: false });
    await prepare(client, ready, 'empty desk after reload');
    await shot(client, dir, 'empty');
    try {
      await client.evaluate(`document.querySelector('.account-roster-empty button.primary').click()`);
      await waitFor(client, `document.querySelector('#recruitDialog').open`, 'recruit on the empty desk');
      await shot(client, dir, 'empty-recruit');
    } catch (error) {
      process.stdout.write(`${lang} empty-recruit: ${error.message}\n`);
    }
  } finally {
    await closeElectronApp(instance);
  }
}

async function main() {
  const [target, ...langs] = process.argv.slice(2);
  if (!target) throw new Error('usage: capture.js <out-dir> [zh|en ...]');
  const outDir = path.resolve(target);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'catshelf-film-reference-'));
  try {
    for (const lang of langs.length ? langs : ['zh', 'en']) {
      if (!process.env.FILM_REFERENCE_EMPTY_ONLY) await captureLanguage(outDir, lang, tempRoot);
      await captureEmpty(outDir, lang, tempRoot);
      process.stdout.write(`captured ${lang}\n`);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    finishHidden();
  }
}

main().catch((error) => {
  process.stderr.write(`reference capture failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
