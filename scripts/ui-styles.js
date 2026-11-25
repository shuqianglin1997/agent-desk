#!/usr/bin/env node
'use strict';

/*
 * Computed styles of the main window, for changes that must not change what
 * is seen, including what screenshots cannot show (docs/ARCHITECTURE_PLAN.md
 * phase 7). Same hidden entry, seed and states as scripts/ui-snapshots.js
 * (no window shown or focused, no client launched), both themes and all three
 * languages, each with reduced motion and with full motion. For every state:
 *   - every element's full computed style (and ::before / ::after when they
 *     have content, ::backdrop of an open dialog), plus each CSS variable
 *     where its value differs from the parent element's;
 *   - every visible interactive element forced into :hover, :focus-visible and
 *     :active (DevTools protocol CSS.forcePseudoState): what changes in it and
 *     in its subtree.
 * Once per combination: every @keyframes rule and every variable on :root.
 * The one text that shows the clock (#toolCheckedAt, when the tools were
 * last checked) has its digits read as zeros, so its width does not change
 * from minute to minute.
 * Elements are named by their place in the document (tag:nth-child path), so
 * a class rename does not hide or invent a difference. Before reading,
 * transitions are finished and other animations paused at their start, so
 * nothing depends on timing.
 *
 *   node scripts/ui-styles.js --write <dir>     capture into <dir>
 *   node scripts/ui-styles.js --compare <dir>   capture again and compare
 *   --only <theme>-<lang>                       one combination (e.g. dark-en)
 *
 * --compare exits 1 on any difference and prints each one: the state, the
 * element, and the properties with their old and new values.
 */

process.env.AGENTDESK_UI_ACCEPTANCE_HIDDEN = '1';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { seedUserData, launchElectronApp, closeElectronApp, waitFor, settleDialogMotion, pressEscape, finishHidden } = require('./ui-acceptance');
const { THEMES, LANGS, STATES, setSettings, seedEmptyDesk, fixTimes, prepare } = require('./ui-snapshots');

const MOTIONS = ['reduce', 'no-preference'];
const PSEUDOS = ['hover', 'focus-visible', 'active'];

// Shared by every capture in the page: element paths, style text, settling.
const PRELUDE = `
  window.__styles ||= (() => {
    const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'HEAD', 'TEMPLATE', 'NOSCRIPT']);
    const names = (() => {
      const found = new Set();
      const walk = (rules) => { for (const rule of rules) { if (rule.style) for (const p of rule.style) if (p.startsWith('--')) found.add(p); if (rule.cssRules) walk(rule.cssRules); } };
      for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch (_error) { /* not readable */ } }
      return [...found].sort();
    })();
    const text = (cs) => { let out = ''; for (let i = 0; i < cs.length; i += 1) { const p = cs[i]; if (!p.startsWith('--')) out += p + ':' + cs.getPropertyValue(p) + ';'; } return out; };
    const varsOf = (cs) => Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n)]));
    const describe = (el, parentVars) => {
      const cs = getComputedStyle(el);
      const mine = varsOf(cs);
      let vars = '';
      for (const n of names) if (mine[n] !== parentVars[n]) vars += n + ':' + mine[n] + ';';
      let out = text(cs) + '|vars|' + vars;
      for (const pseudo of ['::before', '::after']) {
        const ps = getComputedStyle(el, pseudo);
        if (ps.content && ps.content !== 'none' && ps.content !== 'normal') out += '|' + pseudo + '|' + text(ps);
      }
      if (el.tagName === 'DIALOG' && el.open) out += '|::backdrop|' + text(getComputedStyle(el, '::backdrop'));
      return { out, mine };
    };
    const walkTree = (el, elPath, parentVars, into) => {
      if (SKIP.has(el.tagName)) return;
      const { out, mine } = describe(el, parentVars);
      into.push([elPath, out]);
      let index = 0;
      for (const child of el.children) { index += 1; walkTree(child, elPath + ' > ' + child.tagName.toLowerCase() + ':nth-child(' + index + ')', mine, into); }
    };
    const pathOf = (el) => {
      const parts = [];
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) parts.unshift(e.tagName.toLowerCase() + ':nth-child(' + ([...e.parentElement.children].indexOf(e) + 1) + ')');
      return ['html', ...parts].join(' > ');
    };
    const settle = () => {
      for (const animation of document.getAnimations()) {
        try {
          if (animation instanceof CSSTransition) animation.finish();
          else { animation.pause(); animation.currentTime = 0; }
        } catch (_error) { /* an infinite animation cannot finish */ }
      }
    };
    return { names, walkTree, pathOf, settle, varsOf };
  })();
`;

const CAPTURE_ALL = `(() => {${PRELUDE}
  const S = window.__styles;
  for (const el of document.querySelectorAll('#toolCheckedAt')) el.textContent = el.textContent.replace(/[0-9]/g, '0');
  S.settle();
  const into = [];
  S.walkTree(document.documentElement, 'html', {}, into);
  window.__styleBase = new Map(into);
  const table = [];
  const ids = new Map();
  const elements = into.map(([p, t]) => { if (!ids.has(t)) { ids.set(t, table.length); table.push(t); } return [p, ids.get(t)]; });
  const interactive = [...document.querySelectorAll('button, a[href], input, select, textarea, summary, label, [tabindex]:not([tabindex="-1"]), [role="button"], [role="menuitem"], [role="option"]')]
    .filter((el) => el.getClientRects().length > 0 && !el.closest('dialog:not([open])'))
    .map((el) => S.pathOf(el));
  return { elements, table, interactive };
})()`;

const CAPTURE_SUBTREE = (elementPath) => `(() => {${PRELUDE}
  const S = window.__styles;
  S.settle();
  const el = document.querySelector(${JSON.stringify(elementPath)});
  if (!el) return null;
  const parentVars = el.parentElement ? S.varsOf(getComputedStyle(el.parentElement)) : {};
  const into = [];
  S.walkTree(el, ${JSON.stringify(elementPath)}, parentVars, into);
  return into.filter(([p, t]) => window.__styleBase.get(p) !== t);
})()`;

const SHEET = `(() => {${PRELUDE}
  const keyframes = [];
  const walk = (rules) => { for (const rule of rules) { if (rule.type === CSSRule.KEYFRAMES_RULE) keyframes.push(rule.cssText); else if (rule.cssRules) walk(rule.cssRules); } };
  for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch (_error) { /* not readable */ } }
  return { keyframes: keyframes.sort(), rootVars: window.__styles.varsOf(getComputedStyle(document.documentElement)) };
})()`;

async function settleAll(client) {
  // One-shot effects (the copy stamp, a button's bump) take their class off
  // within 160 ms; wait them out so a capture never lands inside one.
  await new Promise((resolve) => setTimeout(resolve, 500));
  await settleDialogMotion(client);
  await client.evaluate(`document.fonts.ready.then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
  // The footer's typed line has finished typing.
  for (let i = 0; i < 60; i += 1) {
    if (await client.evaluate(`(document.querySelector('#statusTyped')?.textContent || '') === (document.querySelector('#statusText')?.textContent || '')`)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function captureState(client) {
  await settleAll(client);
  const all = await client.evaluate(CAPTURE_ALL);
  await client.call('DOM.enable');
  await client.call('CSS.enable');
  const { root } = await client.call('DOM.getDocument', { depth: 0 });
  const forced = [];
  for (const elementPath of all.interactive) {
    const { nodeId } = await client.call('DOM.querySelector', { nodeId: root.nodeId, selector: elementPath });
    if (!nodeId) continue;
    for (const pseudo of PSEUDOS) {
      await client.call('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [pseudo] });
      const changed = await client.evaluate(CAPTURE_SUBTREE(elementPath));
      await client.call('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
      if (changed && changed.length) forced.push([elementPath, pseudo, changed]);
    }
  }
  return { elements: all.elements, table: all.table, forced };
}

async function captureCombination(theme, lang, tempRoot) {
  const output = [];
  const result = { states: {}, sheet: null };
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
    for (const motion of MOTIONS) {
      await prepare(instance.client, ready, `workspace (${motion})`, motion);
      if (!result.sheet) result.sheet = await instance.client.evaluate(SHEET);
      for (const item of STATES) {
        for (const step of [].concat(item.enter || [])) await instance.client.evaluate(step);
        if (item.ready) await waitFor(instance.client, item.ready, `${item.name} ready`);
        result.states[`${item.name}|${motion}`] = await captureState(instance.client);
        if (item.escape) await pressEscape(instance.client);
        if (item.leave) await instance.client.evaluate(item.leave);
        if (item.left) await waitFor(instance.client, item.left, `${item.name} left`);
      }
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
    for (const motion of MOTIONS) {
      await prepare(instance.client, ready, `empty desk (${motion})`, motion);
      result.states[`empty|${motion}`] = await captureState(instance.client);
    }
  } finally {
    await closeElectronApp(instance);
  }
  const serious = output.join('').split(/\r?\n/).filter((line) => /\[renderer-gone\]|Uncaught (TypeError|ReferenceError|Error)|FATAL:/i.test(line));
  if (serious.length) throw new Error(`serious Electron output in ${theme}-${lang}:\n${serious.join('\n')}`);
  return result;
}

function properties(text) {
  const out = new Map();
  if (!text) return out;
  let section = '';
  for (const part of text.split('|')) {
    if (/^(vars|::before|::after|::backdrop)$/.test(part)) { section = `${part} `; continue; }
    for (const item of part.split(/;(?=-{0,2}[a-z][a-z0-9-]*:)/)) {
      const at = item.indexOf(':');
      if (at > 0) out.set(section + item.slice(0, at), item.slice(at + 1).replace(/;$/, ''));
    }
  }
  return out;
}

function differences(before, after) {
  const a = properties(before);
  const b = properties(after);
  const changed = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) if (a.get(key) !== b.get(key)) changed.push([key, a.get(key) ?? null, b.get(key) ?? null]);
  return changed;
}

function compareCombination(expected, actual) {
  const report = [];
  for (const kind of ['keyframes']) {
    const a = new Set(expected.sheet[kind]);
    const b = new Set(actual.sheet[kind]);
    for (const k of a) if (!b.has(k)) report.push({ where: 'keyframes', gone: k.slice(0, 160) });
    for (const k of b) if (!a.has(k)) report.push({ where: 'keyframes', added: k.slice(0, 160) });
  }
  for (const [name, value] of Object.entries(expected.sheet.rootVars)) {
    if (actual.sheet.rootVars[name] !== value) report.push({ where: ':root', variable: name, before: value, after: actual.sheet.rootVars[name] ?? null });
  }
  for (const name of Object.keys(actual.sheet.rootVars)) if (!(name in expected.sheet.rootVars)) report.push({ where: ':root', variable: name, added: actual.sheet.rootVars[name] });
  for (const [state, exp] of Object.entries(expected.states)) {
    const act = actual.states[state];
    if (!act) { report.push({ state, missing: true }); continue; }
    const before = new Map(exp.elements.map(([p, id]) => [p, exp.table[id]]));
    const after = new Map(act.elements.map(([p, id]) => [p, act.table[id]]));
    for (const p of new Set([...before.keys(), ...after.keys()])) {
      if (before.get(p) === after.get(p)) continue;
      report.push({ state, element: p, properties: before.has(p) && after.has(p) ? differences(before.get(p), after.get(p)) : (before.has(p) ? 'element gone' : 'element added') });
    }
    const forcedKey = (list) => new Map(list.flatMap(([el, pseudo, changed]) => changed.map(([p, t]) => [`${el}|:${pseudo}|${p}`, t])));
    const fa = forcedKey(exp.forced);
    const fb = forcedKey(act.forced);
    for (const k of new Set([...fa.keys(), ...fb.keys()])) {
      if (fa.get(k) === fb.get(k)) continue;
      report.push({ state, forced: k, properties: differences(fa.get(k) ?? before.get(k.split('|')[2]) ?? '', fb.get(k) ?? after.get(k.split('|')[2]) ?? '') });
    }
  }
  return report;
}

const save = (file, value) => fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(value)));
const load = (file) => JSON.parse(zlib.gunzipSync(fs.readFileSync(file)));

async function main() {
  const args = process.argv.slice(2);
  const mode = args.includes('--compare') ? 'compare' : args.includes('--write') ? 'write' : null;
  const target = mode && args[args.indexOf(`--${mode}`) + 1];
  if (!mode || !target) throw new Error('usage: ui-styles.js --write <dir> | --compare <dir> [--only theme-lang]');
  const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
  const base = path.resolve(target);
  const dir = mode === 'write' ? base : `${base}-candidate`;
  fs.mkdirSync(dir, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-ui-styles-'));
  const report = [];
  let compared = 0;
  try {
    for (const theme of THEMES) {
      for (const lang of LANGS) {
        const combo = `${theme}-${lang}`;
        if (only && only !== combo) continue;
        const started = Date.now();
        const result = await captureCombination(theme, lang, tempRoot);
        save(path.join(dir, `${combo}.json.gz`), result);
        const elements = Object.values(result.states).reduce((n, s) => n + s.elements.length, 0);
        const forced = Object.values(result.states).reduce((n, s) => n + s.forced.length, 0);
        process.stdout.write(`captured ${combo}: ${Object.keys(result.states).length} states, ${elements} elements, ${forced} forced changes, ${result.sheet.keyframes.length} keyframes, ${Object.keys(result.sheet.rootVars).length} variables (${Math.round((Date.now() - started) / 1000)} s)\n`);
        if (mode === 'compare') {
          const expectedFile = path.join(base, `${combo}.json.gz`);
          if (!fs.existsSync(expectedFile)) { report.push({ combo, missingBaseline: true }); continue; }
          compared += 1;
          for (const item of compareCombination(load(expectedFile), result)) report.push({ combo, ...item });
        }
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    finishHidden();
  }
  if (mode === 'compare') {
    process.stdout.write(`${JSON.stringify({ compared, differences: report.length, report: report.slice(0, 400) }, null, 1)}\n`);
    // The candidate records are kept only when they differ, for looking at.
    if (report.length) {
      process.stdout.write(`candidate records kept in ${dir}\n`);
      process.exitCode = 1;
    } else {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`ui-styles failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
