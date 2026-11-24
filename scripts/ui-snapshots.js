#!/usr/bin/env node
'use strict';

/*
 * Pixel snapshots of the main window, for changes that must not change what
 * is seen (docs/ARCHITECTURE_PLAN.md phase 6: "看得见的东西一个像素都不变").
 *
 * Every run goes through scripts/hidden-electron-entry.js (the window is never
 * shown or focused, no client is launched, the keychain is mocked) with the
 * acceptance seed (8 profiles, fixed dates), reduced motion, and each of the
 * two themes and three languages. In each it captures the states listed in
 * STATES, plus the empty desk (no profiles).
 *
 *   node scripts/ui-snapshots.js --write <dir>     capture into <dir>
 *   node scripts/ui-snapshots.js --compare <dir>   capture again and compare
 *                                                  with <dir>, pixel by pixel
 *   --only <theme>-<lang>                          one combination (e.g. dark-en)
 *
 * --compare exits 1 when any image differs and prints, per image, how many
 * pixels differ and their bounding box; the new captures are kept next to
 * <dir> as <dir>-candidate for a look. A combination with a difference is
 * captured once more (text antialiasing very rarely differs by a few pixels
 * between two runs of the same code); the report lists every retry with what
 * the first capture differed in, and only the second capture decides.
 */

process.env.AGENTDESK_UI_ACCEPTANCE_HIDDEN = '1';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const {
  seedUserData,
  launchElectronApp,
  closeElectronApp,
  waitFor,
  settleDialogMotion,
  pressEscape,
  finishHidden
} = require('./ui-acceptance');

const THEMES = ['light', 'dark'];
const LANGS = ['zh', 'en', 'ja'];
const FIXED_TIME = new Date('2026-08-12T06:00:00.000Z');

// Each state: how to reach it from the resting workspace, and how to leave it.
const STATES = [
  { name: 'workspace' },
  {
    name: 'detailed',
    enter: `document.querySelector('#sessionDetailBtn').click()`,
    ready: `document.querySelector('#sessionTable')?.dataset.mode === 'detail'`,
    leave: `document.querySelector('#sessionCompactBtn').click()`,
    left: `document.querySelector('#sessionTable')?.dataset.mode === 'compact'`
  },
  {
    name: 'focused',
    enter: `document.querySelectorAll('#sessionRows tr:not(.empty-row)')[0].click()`,
    ready: `Boolean(AgentDeskInspect.state.ui.focusedConversationId)`
  },
  {
    name: 'checked',
    // One click per step: the rows are drawn again after each.
    enter: [`document.querySelectorAll('#sessionRows .session-select-box')[1].click()`, `document.querySelectorAll('#sessionRows .session-select-box')[2].click()`],
    ready: `AgentDeskInspect.state.ui.checkedConversationIds.size === 2`,
    leave: `document.querySelector('#clearSessionSelectionBtn').click()`,
    left: `AgentDeskInspect.state.ui.checkedConversationIds.size === 0`
  },
  { name: 'archive', enter: `document.querySelector('.account-card.selected .account-card-manage').click()`, ready: `document.querySelector('#agentManageDialog').open`, escape: true },
  { name: 'devices', enter: `document.querySelector('#deviceCenterBtn').click()`, ready: `document.querySelector('#deviceCenterDialog').open`, escape: true },
  { name: 'inbox', enter: `document.querySelector('#activityCenterBtn').click()`, ready: `document.querySelector('#activityCenterDialog').open`, escape: true },
  { name: 'system', enter: `document.querySelector('#systemBtn').click()`, ready: `document.querySelector('#systemDialog').open`, escape: true },
  { name: 'recruit', enter: `document.querySelector('#addProfileBtn').click()`, ready: `document.querySelector('#recruitDialog').open`, escape: true },
  {
    name: 'quota',
    enter: `document.querySelector('.account-card.selected .account-card-quota-summary').click()`,
    ready: `Boolean(document.querySelector(':popover-open'))`,
    escape: true
  }
];

function setSettings(userData, theme, lang) {
  const file = path.join(userData, 'settings.json');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  value.settings.theme = theme;
  value.settings.lang = lang;
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function seedEmptyDesk(userData, theme, lang) {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 2, settings: { theme, lang, sessionView: 'compact' } }, null, 2));
}

// Files the scanners read get one fixed time, so "last active" is the same in every run.
function fixTimes(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) fixTimes(target);
    if (entry.isFile() || entry.isDirectory()) fs.utimesSync(target, FIXED_TIME, FIXED_TIME);
  }
}

async function settle(client) {
  await settleDialogMotion(client);
  await client.evaluate(`document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function shot(client, dir, name) {
  await settle(client);
  const result = await client.call('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(result.data, 'base64'));
}

// Reduced motion (or, for scripts/ui-styles.js, full motion) from the first
// frame: set it, then load the page again, and wait until the lamp
// (src/pixel/boot.js) has finished.
async function prepare(client, ready, label, motion = 'reduce') {
  await client.call('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: motion }] });
  await client.call('Emulation.setFocusEmulationEnabled', { enabled: true });
  await client.call('Page.reload', { ignoreCache: true });
  await new Promise((resolve) => setTimeout(resolve, 300));
  await waitFor(client, `${ready} && typeof PixelLamp !== 'undefined' && PixelLamp.state().phase === 'done'`, label);
}

async function captureCombination(dir, theme, lang, tempRoot) {
  const output = [];
  const userData = path.join(tempRoot, `${theme}-${lang}`);
  seedUserData(userData);
  setSettings(userData, theme, lang);
  fixTimes(userData);
  let instance = await launchElectronApp(userData, output);
  try {
    const ready = `typeof AgentDeskInspect !== 'undefined' && AgentDeskInspect.state.profiles.length === 8
      && AgentDeskInspect.state.sessions.length >= 3 && !document.querySelector('#welcomeDialog').open
      && document.querySelectorAll('#sessionRows tr:not(.empty-row)').length >= 3`;
    await waitFor(instance.client, ready, 'workspace');
    await prepare(instance.client, ready, 'workspace after reload');
    for (const item of STATES) {
      for (const step of [].concat(item.enter || [])) await instance.client.evaluate(step);
      if (item.ready) await waitFor(instance.client, item.ready, `${item.name} ready`);
      await shot(instance.client, dir, `${theme}-${lang}-${item.name}`);
      if (item.escape) await pressEscape(instance.client);
      if (item.leave) await instance.client.evaluate(item.leave);
      if (item.left) await waitFor(instance.client, item.left, `${item.name} left`);
    }
  } finally {
    await closeElectronApp(instance);
  }
  const emptyData = path.join(tempRoot, `${theme}-${lang}-empty`);
  seedEmptyDesk(emptyData, theme, lang);
  instance = await launchElectronApp(emptyData, output);
  try {
    const ready = `typeof AgentDeskInspect !== 'undefined' && AgentDeskInspect.state.startupStage === 'ready'
      && Boolean(document.querySelector('#accountRoster .account-roster-empty'))`;
    await waitFor(instance.client, ready, 'empty desk');
    await prepare(instance.client, ready, 'empty desk after reload');
    await shot(instance.client, dir, `${theme}-${lang}-empty`);
  } finally {
    await closeElectronApp(instance);
  }
  const serious = output.join('').split(/\r?\n/).filter((line) => /\[renderer-gone\]|Uncaught (TypeError|ReferenceError|Error)|FATAL:/i.test(line));
  if (serious.length) throw new Error(`serious Electron output in ${theme}-${lang}:\n${serious.join('\n')}`);
}

// A small PNG reader (8-bit RGB/RGBA, not interlaced: what Chromium writes).
function readPng(file) {
  const data = fs.readFileSync(file);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const chunks = [];
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.toString('ascii', offset + 4, offset + 8);
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error(`${file}: unsupported PNG`);
      colorType = body[9];
    } else if (type === 'IDAT') chunks.push(body);
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`${file}: unsupported PNG colour type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + x] = value & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function compareImages(expectedFile, actualFile) {
  const expected = readPng(expectedFile);
  const actual = readPng(actualFile);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return { differing: -1, size: [`${expected.width}x${expected.height}`, `${actual.width}x${actual.height}`] };
  }
  let differing = 0;
  const box = [Infinity, Infinity, -1, -1];
  for (let y = 0; y < expected.height; y += 1) {
    for (let x = 0; x < expected.width; x += 1) {
      const a = (y * expected.width + x) * expected.channels;
      const b = (y * actual.width + x) * actual.channels;
      let same = true;
      for (let c = 0; c < 3; c += 1) if (expected.pixels[a + c] !== actual.pixels[b + c]) same = false;
      if (expected.channels === 4 && actual.channels === 4 && expected.pixels[a + 3] !== actual.pixels[b + 3]) same = false;
      if (same) continue;
      differing += 1;
      box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
      box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
    }
  }
  return differing ? { differing, box } : { differing: 0 };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--compare') ? 'compare' : args.includes('--write') ? 'write' : null;
  const target = mode && args[args.indexOf(`--${mode}`) + 1];
  if (!mode || !target) throw new Error('usage: ui-snapshots.js --write <dir> | --compare <dir> [--only theme-lang]');
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const base = path.resolve(target);
  const dir = mode === 'write' ? base : `${base}-candidate`;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-ui-snapshots-'));
  try {
    for (const theme of THEMES) {
      for (const lang of LANGS) {
        if (only && only !== `${theme}-${lang}`) continue;
        await captureCombination(dir, theme, lang, tempRoot);
        process.stdout.write(`captured ${theme}-${lang}\n`);
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    finishHidden();
  }
  const files = fs.readdirSync(dir).filter((file) => file.endsWith('.png')).sort();
  if (mode === 'write') {
    process.stdout.write(`${files.length} snapshots written to ${dir}\n`);
    return;
  }
  const differences = () => {
    const found = [];
    for (const file of files) {
      const expected = path.join(base, file);
      if (!fs.existsSync(expected)) { found.push({ file, missingBaseline: true }); continue; }
      const result = compareImages(expected, path.join(dir, file));
      if (result.differing) found.push({ file, ...result });
    }
    return found;
  };
  let report = differences();
  const retried = [];
  const combos = [...new Set(report.filter((item) => item.differing).map((item) => item.file.split('-').slice(0, 2).join('-')))];
  if (combos.length) {
    const retryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-ui-snapshots-'));
    try {
      for (const combo of combos) {
        const [theme, lang] = combo.split('-');
        retried.push({ combination: combo, firstCapture: report.filter((item) => item.file.startsWith(`${combo}-`)) });
        await captureCombination(dir, theme, lang, retryRoot);
      }
    } finally {
      fs.rmSync(retryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      finishHidden();
    }
    report = differences();
  }
  for (const file of fs.readdirSync(base).filter((name) => name.endsWith('.png'))) {
    if (!files.includes(file) && (!only || file.startsWith(`${only}-`))) report.push({ file, missingCandidate: true });
  }
  process.stdout.write(`${JSON.stringify({ compared: files.length, differing: report, retried }, null, 1)}\n`);
  if (report.length) process.exitCode = 1;
}

module.exports = { THEMES, LANGS, STATES, setSettings, seedEmptyDesk, fixTimes, prepare, settle };

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`ui-snapshots failed: ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
