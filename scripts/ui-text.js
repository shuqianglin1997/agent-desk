#!/usr/bin/env node
'use strict';

/*
 * Text in the main window, for changes to wording (docs/WORDING_PLAN.md).
 * Same hidden entry, seed and states as scripts/ui-snapshots.js (no window
 * shown or focused, no client launched), both themes and all three
 * languages, reduced motion. For every state:
 *   - overflow: every rendered element whose own text no longer fits:
 *     clipped (overflow hidden or clip, or an ellipsis) or spilling out of
 *     its box (overflow visible). Scroll containers (auto, scroll) are
 *     meant to scroll and are left out. Elements are named by their place
 *     in the document (tag:nth-child path).
 *   - words: every piece of text a person can see or hear there (rendered
 *     text, and title, placeholder and aria-label of rendered elements),
 *     checked against the retired names listed in WORDING_PLAN section 1.
 *
 *   node scripts/ui-text.js --write <file>     capture overflow into <file>
 *   node scripts/ui-text.js --compare <file>   capture again; report overflow
 *                                              that is new, and old words
 *   --only <theme>-<lang>                      one combination
 *
 * --compare exits 1 when an element overflows that did not before, or when a
 * retired name is still shown.
 */

process.env.AGENTDESK_UI_ACCEPTANCE_HIDDEN = '1';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedUserData, launchElectronApp, closeElectronApp, waitFor, pressEscape, finishHidden } = require('./ui-acceptance');
const { THEMES, LANGS, STATES, setSettings, seedEmptyDesk, fixTimes, prepare } = require('./ui-snapshots');

// Retired names (WORDING_PLAN section 1, "现在的叫法"), and the product's old
// name AgentDesk (docs/RENAME_PLAN.md). Kept on purpose and so not reported:
// the dossier's 资料 / Profile / プロフィール, 账号 after a provider's name, and
// the catalog's default name "Agent" (section 3.1).
const RETIRED = {
  zh: [/AgentDesk/, /(?<!Personal )Agent(?!Desk| Mesh)/, /员工/, /运行位置/, /槽位/, /\bProfile\b/, /账号目录/, /账号数据目录/, /登录账号/, /账号绑定/],
  en: [/AgentDesk/, /\bAgents?\b(?!Desk| Mesh)/, /\bemployees?\b/i, /\bslots?\b/i, /\bruntime locations?\b/i, /\bRun at\b/, /\baccount (?:folders?|dir(?:ector(?:y|ies))?|slots?|bindings?)\b/i, /\bsign-in accounts?\b/i, /\blogin (?:accounts?|bindings?)\b/i],
  ja: [/AgentDesk/, /Agent(?!Desk| Mesh)/, /従業員/, /実行場所/, /スロット/, /プロファイル/, /アカウント(?:ディレクトリ|フォルダ|スロット|枠|紐付け)/, /ログインアカウント/]
};

const CAPTURE = `(() => {
  const pathOf = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) parts.unshift(e.tagName.toLowerCase() + ':nth-child(' + ([...e.parentElement.children].indexOf(e) + 1) + ')');
    return ['html', ...parts].join(' > ');
  };
  const rendered = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const ownText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const overflow = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (!rendered(el) || !ownText(el)) continue;
    const cs = getComputedStyle(el);
    const scrolls = /auto|scroll/.test(cs.overflowX + cs.overflowY);
    if (scrolls) continue;
    const wide = el.scrollWidth > el.clientWidth + 1;
    const tall = el.scrollHeight > el.clientHeight + 1;
    if (!wide && !tall) continue;
    if (el.clientWidth === 0 && el.clientHeight === 0) continue; // inline boxes have no client size
    const clipped = /hidden|clip/.test(cs.overflowX + cs.overflowY) || cs.textOverflow === 'ellipsis';
    overflow.push([pathOf(el), (clipped ? 'clipped' : 'spills') + (wide ? '-x' : '') + (tall ? '-y' : ''), el.textContent.trim().slice(0, 60)]);
  }
  // The seed's own data (names, titles, groups, notes, paths) is not wording:
  // mask it before the words are checked.
  const data = new Set();
  const FIELDS = /^(name|title|displayName|group|note|label|localLabel|displayAlias|projectPath|filePath|profilePath|sessionRoot|cwd)$/;
  const walk = (v, depth) => {
    if (depth > 6 || !v || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string') { if (FIELDS.test(k) && x.trim().length >= 3) data.add(x.trim()); } else walk(x, depth + 1);
    }
  };
  try { const s = AgentDeskInspect.state; walk({ profiles: s.profiles, sessions: s.sessions, deviceOverview: s.deviceOverview, meshOverview: s.meshOverview }, 0); } catch (_error) { /* no state yet */ }
  const ordered = [...data].sort((a, b) => b.length - a.length);
  const mask = (t) => { let out = t; for (const d of ordered) out = out.split(d).join('«data»'); return out; };
  const texts = [];
  const body = document.body.innerText || '';
  texts.push(...body.split(/\\n+/).map((t) => t.trim()).filter(Boolean));
  for (const el of document.body.querySelectorAll('[title], [placeholder], [aria-label]')) {
    if (!rendered(el)) continue;
    for (const name of ['title', 'placeholder', 'aria-label']) { const v = el.getAttribute(name); if (v && v.trim()) texts.push(v.trim()); }
  }
  return { overflow, texts: [...new Set(texts.map(mask))] };
})()`;

async function captureCombination(theme, lang, tempRoot) {
  const output = [];
  const states = {};
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
    await prepare(instance.client, ready, 'workspace (reduce)', 'reduce');
    for (const item of STATES) {
      for (const step of [].concat(item.enter || [])) await instance.client.evaluate(step);
      if (item.ready) await waitFor(instance.client, item.ready, `${item.name} ready`);
      await new Promise((resolve) => setTimeout(resolve, 400));
      states[item.name] = await instance.client.evaluate(CAPTURE);
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
    await prepare(instance.client, ready, 'empty desk (reduce)', 'reduce');
    states.empty = await instance.client.evaluate(CAPTURE);
  } finally {
    await closeElectronApp(instance);
  }
  return states;
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--compare') ? 'compare' : args.includes('--write') ? 'write' : null;
  const target = mode && args[args.indexOf(`--${mode}`) + 1];
  if (!mode || !target) throw new Error('usage: ui-text.js --write <file> | --compare <file> [--only theme-lang]');
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-ui-text-'));
  const result = {};
  try {
    for (const theme of THEMES) {
      for (const lang of LANGS) {
        const combo = `${theme}-${lang}`;
        if (only && only !== combo) continue;
        result[combo] = await captureCombination(theme, lang, tempRoot);
        const overflowing = Object.values(result[combo]).reduce((n, s) => n + s.overflow.length, 0);
        process.stdout.write(`captured ${combo}: ${Object.keys(result[combo]).length} states, ${overflowing} overflowing elements\n`);
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    finishHidden();
  }
  const overflowOnly = Object.fromEntries(Object.entries(result).map(([combo, states]) => [combo, Object.fromEntries(Object.entries(states).map(([name, s]) => [name, s.overflow]))]));
  if (mode === 'write') {
    fs.writeFileSync(path.resolve(target), JSON.stringify(overflowOnly, null, 1));
    return;
  }
  const before = JSON.parse(fs.readFileSync(path.resolve(target), 'utf8'));
  const newOverflow = [];
  const gone = [];
  for (const [combo, states] of Object.entries(overflowOnly)) {
    for (const [name, list] of Object.entries(states)) {
      const old = new Map((before[combo]?.[name] || []).map(([p, kind]) => [p, kind]));
      for (const [p, kind, text] of list) if (!old.has(p) || old.get(p) !== kind) newOverflow.push({ combo, state: name, element: p, kind, text });
      const now = new Set(list.map(([p]) => p));
      for (const [p] of before[combo]?.[name] || []) if (!now.has(p)) gone.push({ combo, state: name, element: p });
    }
  }
  const words = [];
  for (const [combo, states] of Object.entries(result)) {
    const lang = combo.split('-')[1];
    for (const [name, s] of Object.entries(states)) {
      for (const text of s.texts) for (const re of RETIRED[lang]) if (re.test(text)) words.push({ combo, state: name, word: String(re), text: text.slice(0, 120) });
    }
  }
  process.stdout.write(`${JSON.stringify({ newOverflow: newOverflow.length, noLongerOverflowing: gone.length, retiredWords: words.length, report: { newOverflow: newOverflow.slice(0, 200), noLongerOverflowing: gone.slice(0, 50), retiredWords: words.slice(0, 200) } }, null, 1)}\n`);
  if (newOverflow.length || words.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`ui-text failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
