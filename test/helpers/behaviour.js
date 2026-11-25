'use strict';

// Helpers for tests that check what the code does rather than what its
// source text says (docs/ARCHITECTURE_PLAN.md phase 8):
//   loadPreload()      run src/preload.js with a stubbed electron; returns the
//                      exposed API and the IPC calls it makes
//   commandFor(ch)     the command-table entry for an IPC channel
//   runCommand(ch,…)   run that command's exec with stub deps
//   page()             src/index.html parsed into an element tree, with
//                      byId / all / text helpers (structure, not text match)

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');

function loadPreload(options = {}) {
  const calls = [];
  const listeners = [];
  let api = null;
  const electron = {
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
    ipcRenderer: {
      invoke: (...args) => { calls.push(['invoke', ...args]); return Promise.resolve(options.reply ?? { ok: true }); },
      send: (...args) => { calls.push(['send', ...args]); },
      on: (channel, fn) => { listeners.push([channel, fn]); },
      removeListener: () => {}
    },
    webUtils: { getPathForFile: () => '' }
  };
  const source = fs.readFileSync(path.join(ROOT, 'src', 'preload.js'), 'utf8');
  vm.runInNewContext(source, { require: () => electron, console, setTimeout, clearTimeout, Promise });
  return { api, calls, listeners };
}

function commandFor(channel) {
  const { commandTable } = require('../../src/commands/registry');
  const found = commandTable().commands.find((command) => command.channel === channel);
  if (!found) throw new Error(`no command for ${channel}`);
  return found;
}

// Run the command for an IPC channel the way the IPC shell does (input
// shaping, poll, exec), with the deps the test supplies.
function runCommand(channel, deps, raw, context = {}) {
  const registry = require('../../src/commands/registry');
  return registry.runCommand(commandFor(channel), deps, raw, context);
}

// A small, tolerant HTML parser for src/index.html: elements with tag,
// attributes, children and text. Void elements and <script>/<style>
// bodies are handled; comments are skipped.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
function parseHtml(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let current = root;
  const re = /<!--[\s\S]*?-->|<\/([a-zA-Z0-9-]+)\s*>|<([a-zA-Z0-9-]+)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('<!--')) continue;
    if (m[1]) {
      const tag = m[1].toLowerCase();
      for (let e = current; e && e !== root; e = e.parent) if (e.tag === tag) { current = e.parent; break; }
    } else if (m[2]) {
      const tag = m[2].toLowerCase();
      const attrs = {};
      for (const a of m[3].matchAll(/([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) attrs[a[1].toLowerCase()] = a[2] ?? a[3] ?? a[4] ?? '';
      const el = { tag, attrs, children: [], parent: current };
      current.children.push(el);
      if (tag === 'script' || tag === 'style') {
        const end = html.indexOf(`</${tag}`, re.lastIndex);
        el.children.push({ text: html.slice(re.lastIndex, end), parent: el });
        re.lastIndex = end;
      } else if (!VOID.has(tag) && !m[4]) current = el;
    } else if (m[5] && m[5].trim()) current.children.push({ text: m[5], parent: current });
  }
  return root;
}

function page(file = 'src/index.html') {
  const root = parseHtml(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const elements = [];
  const walk = (el) => { for (const c of el.children || []) if (c.tag) { elements.push(c); walk(c); } };
  walk(root);
  const classes = (el) => (el.attrs.class || '').split(/\s+/).filter(Boolean);
  const text = (el) => (el.text != null ? el.text : (el.children || []).map(text).join('')).replace(/\s+/g, ' ').trim();
  const within = (el, ancestor) => { for (let e = el.parent; e; e = e.parent) if (e === ancestor) return true; return false; };
  return {
    root,
    elements,
    byId: (id) => elements.find((el) => el.attrs.id === id) || null,
    all: (pred) => elements.filter(pred),
    classes,
    hasClass: (el, name) => classes(el).includes(name),
    text,
    within,
    children: (el) => (el.children || []).filter((c) => c.tag),
    index: (el) => elements.indexOf(el)
  };
}

// The main window's style rules, parsed: for a selector, every rule whose
// selector list contains it exactly, with its sheet, layer, media and
// declarations ({ property: value }, !important kept on the value).
function styleRules(selector, files = ['src/workspace.css', 'src/pixel.css', 'src/cats.css']) {
  const { cssStyleRules, splitSelectors } = require('../../scripts/arch-metrics');
  const out = [];
  for (const file of files) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const { text, rules } = cssStyleRules(source);
    const original = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    // the cascade layer enclosing each '{' (one pass, brace depth)
    const layerAt = new Map(); const stack = []; let preludeStart = 0;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === '{') {
        const prelude = text.slice(preludeStart, i).trim();
        const enclosing = [...stack].reverse().find((x) => x) || null;
        layerAt.set(i, enclosing);
        const m = prelude.match(/^@layer\s+([\w-]+)$/);
        stack.push(m ? m[1] : null);
        preludeStart = i + 1;
      } else if (text[i] === '}') { stack.pop(); preludeStart = i + 1; } else if (text[i] === ';') preludeStart = i + 1;
    }
    for (const rule of rules) {
      if (!splitSelectors(rule.prelude).includes(selector)) continue;
      const end = text.indexOf('}', rule.declarationsStart);
      const decls = {};
      for (const part of original.slice(rule.declarationsStart, end).split(/;(?![^(]*\))/)) {
        const i = part.indexOf(':');
        if (i > 0) decls[part.slice(0, i).trim()] = part.slice(i + 1).trim().replace(/\s+/g, ' ');
      }
      out.push({ file, conditional: rule.conditional, layer: layerAt.get(rule.declarationsStart - 1) ?? null, decls });
    }
  }
  return out;
}

// The one value a property has in the rules listing exactly this selector
// (unconditional rules; the later one in cascade order wins on a tie of
// layer, as the sheets are loaded in this order).
function declared(selector, property, files) {
  const values = styleRules(selector, files).filter((r) => !r.conditional && property in r.decls).map((r) => r.decls[property]);
  return values.length ? values[values.length - 1] : undefined;
}

module.exports = { ROOT, loadPreload, commandFor, runCommand, parseHtml, page, styleRules, declared };
