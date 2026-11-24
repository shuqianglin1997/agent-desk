'use strict';

// Architecture metrics for docs/ARCHITECTURE_PLAN.md §8. Read-only, no
// dependencies: a small tokenizer masks comments, strings, template text and
// regular-expression bodies so braces inside them never count, then brace
// matching gives function extents. Function counts and lengths are estimates
// (anonymous expression-bodied arrows are not functions here); every list the
// numbers come from is printed so a person can audit it.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'yield', 'await', 'instanceof']);
const NOT_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'return', 'else', 'do', 'try', 'typeof', 'new', 'await', 'yield', 'super', 'import', 'require']);

// Returns a string of the same length and line layout. Comments become spaces.
// With keepStrings=false, string/template/regex contents become spaces too
// (their delimiters stay, so code positions and line numbers never move).
function maskSource(source, { keepStrings = false } = {}) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let i = from; i < to; i++) if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
  };
  const stack = []; // 'template' frames and numbers (brace depth inside ${})
  let i = 0;
  let lastSignificant = '';
  let lastWord = '';
  const n = source.length;
  const regexAllowed = () => lastSignificant === '' || '(,=:[!&|?{};+-*%<>~^'.includes(lastSignificant) || REGEX_KEYWORDS.has(lastWord);
  function readTemplate(start) {
    // start is just after a backtick or a closing } of ${...}
    let j = start;
    while (j < n) {
      const ch = source[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === '`') { if (!keepStrings) blank(start, j); return { end: j + 1, interpolation: false }; }
      if (ch === '$' && source[j + 1] === '{') { if (!keepStrings) blank(start, j); return { end: j + 2, interpolation: true }; }
      j++;
    }
    if (!keepStrings) blank(start, n);
    return { end: n, interpolation: false };
  }
  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      blank(i, stop); i = stop; continue;
    }
    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(i, stop); i = stop; continue;
    }
    if (ch === '\'' || ch === '"') {
      let j = i + 1;
      while (j < n && source[j] !== ch && source[j] !== '\n') { if (source[j] === '\\') j++; j++; }
      if (!keepStrings) blank(i + 1, j);
      i = j + 1; lastSignificant = 'a'; lastWord = ''; continue;
    }
    if (ch === '`') {
      const result = readTemplate(i + 1);
      i = result.end;
      if (result.interpolation) stack.push(0);
      lastSignificant = 'a'; lastWord = ''; continue;
    }
    if (ch === '/' && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n && source[j] !== '\n') {
        const c = source[j];
        if (c === '\\') { j += 2; continue; }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        j++;
      }
      if (j < n && source[j] === '/') {
        if (!keepStrings) blank(i + 1, j);
        j++;
        while (j < n && /[a-z]/i.test(source[j])) j++;
        i = j; lastSignificant = 'a'; lastWord = ''; continue;
      }
    }
    if (stack.length) {
      if (ch === '{') stack[stack.length - 1]++;
      else if (ch === '}') {
        if (stack[stack.length - 1] === 0) {
          stack.pop();
          const result = readTemplate(i + 1);
          i = result.end;
          if (result.interpolation) stack.push(0);
          lastSignificant = 'a'; lastWord = ''; continue;
        }
        stack[stack.length - 1]--;
      }
    }
    if (/[A-Za-z_$0-9]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z_$0-9]/.test(source[j])) j++;
      lastWord = source.slice(i, j);
      lastSignificant = 'a';
      i = j; continue;
    }
    if (!/\s/.test(ch)) { lastSignificant = ch; lastWord = ''; }
    i++;
  }
  return out.join('');
}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return (offset) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

function matchForward(code, open, openChar, closeChar) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === openChar) depth++;
    else if (code[i] === closeChar) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function matchBackward(code, close, openChar, closeChar) {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (code[i] === closeChar) depth++;
    else if (code[i] === openChar) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function skipSpace(code, i) { while (i < code.length && /\s/.test(code[i])) i++; return i; }
function skipSpaceBack(code, i) { while (i >= 0 && /\s/.test(code[i])) i--; return i; }

// Functions with a block body: declarations, function expressions, class and
// object methods, and block-bodied arrows. Returns { name, start, bodyStart, end, line, endLine, lines }.
function findFunctions(source, code = maskSource(source)) {
  const lineOf = lineIndex(code);
  const byBody = new Map();
  const add = (name, start, bodyStart) => {
    if (code[bodyStart] !== '{' || byBody.has(bodyStart)) return;
    const end = matchForward(code, bodyStart, '{', '}');
    if (end < 0) return;
    const line = lineOf(start);
    const endLine = lineOf(end);
    byBody.set(bodyStart, { name, start, bodyStart, end, line, endLine, lines: endLine - line + 1 });
  };
  const nameBefore = (index) => {
    const before = code.slice(Math.max(0, index - 160), index);
    const m = before.match(/(?:([A-Za-z_$][\w$]*)\s*(?:=|:)\s*|(?:^|\W)(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*)(?:async\s*)?$/);
    return m ? (m[1] || m[2]) : null;
  };
  for (const m of code.matchAll(/\b(?:async\s+)?function\b\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(/g)) {
    const paren = m.index + m[0].length - 1;
    const close = matchForward(code, paren, '(', ')');
    if (close < 0) continue;
    add(m[1] || nameBefore(m.index) || `<anonymous>`, m.index, skipSpace(code, close + 1));
  }
  for (const m of code.matchAll(/=>\s*\{/g)) {
    const bodyStart = m.index + m[0].length - 1;
    let p = skipSpaceBack(code, m.index - 1);
    let start;
    if (code[p] === ')') start = matchBackward(code, p, '(', ')');
    else { start = p; while (start > 0 && /[\w$]/.test(code[start - 1])) start--; }
    if (start < 0) continue;
    const head = skipSpaceBack(code, start - 1);
    let s = start;
    if (code.slice(Math.max(0, head - 4), head + 1) === 'async') s = head - 4;
    add(nameBefore(s) || '<arrow>', s, bodyStart);
  }
  for (const m of code.matchAll(/^[ \t]*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?\*?\s*(#?[A-Za-z_$][\w$]*)\s*\(/gm)) {
    if (NOT_METHOD.has(m[1])) continue;
    const paren = m.index + m[0].length - 1;
    const close = matchForward(code, paren, '(', ')');
    if (close < 0) continue;
    add(m[1], m.index + m[0].search(/\S/), skipSpace(code, close + 1));
  }
  return [...byBody.values()].sort((a, b) => a.start - b.start);
}

function listFiles(root, directory, filter) {
  const output = [];
  const walk = (relative) => {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const name = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(name);
      else if (entry.isFile() && filter(name)) output.push(name);
    }
  };
  walk(directory);
  return output.sort();
}

function countLines(text) {
  if (!text) return 0;
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') count++;
  return text.endsWith('\n') ? count : count + 1;
}

// Client ids: each adapter folder src/clients/<id>/index.js declares `  id: '<id>',`
// (an older layout declared them inside src/apps.js).
function clientIds(root) {
  const ids = new Set();
  const dir = path.join(root, 'src/clients');
  if (fs.existsSync(dir)) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name, 'index.js');
      if (!entry.isDirectory() || !fs.existsSync(file)) continue;
      for (const m of fs.readFileSync(file, 'utf8').matchAll(/^ {2}id: '([a-z0-9-]+)',$/gm)) ids.add(m[1]);
    }
  }
  const file = path.join(root, 'src/apps.js');
  if (fs.existsSync(file)) for (const m of fs.readFileSync(file, 'utf8').matchAll(/^ {4}id: '([a-z0-9-]+)',$/gm)) ids.add(m[1]);
  return [...ids].sort();
}

// The registry and the adapters are where client knowledge belongs.
const insideAdapters = (file) => file === 'src/apps.js' || file.startsWith('src/clients/');

// Main-process modules: everything reachable through relative requires from
// the two Node entry points.
function mainProcessFiles(root) {
  const seen = new Set();
  const visit = (relative) => {
    if (seen.has(relative)) return;
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute)) return;
    seen.add(relative);
    const code = maskSource(fs.readFileSync(absolute, 'utf8'), { keepStrings: true });
    for (const m of code.matchAll(/\brequire\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
      let target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), m[1]));
      if (!target.endsWith('.js') && !target.endsWith('.json')) {
        target = fs.existsSync(path.join(root, `${target}.js`)) ? `${target}.js` : path.posix.join(target, 'index.js');
      }
      if (target.endsWith('.js')) visit(target);
    }
  };
  for (const entry of ['src/main.js', 'src/automation/cli.js', 'src/clients/codex/history-retention.js']) visit(entry);
  return [...seen].sort();
}

const SYNC_NAMES = (() => {
  const names = new Set(Object.keys(require('node:fs')).filter((key) => key.endsWith('Sync')));
  for (const key of ['execSync', 'execFileSync', 'spawnSync']) names.add(key);
  return names;
})();

// Modules whose code runs on the main thread for the renderer's refresh path
// (activity poll, list refresh, overview counts). Since architecture phase 4
// the scans and the activity probe's file work run on the scan worker
// (SCAN_WORKER_PATH below), so their synchronous calls no longer block Main.
// A static count cannot tell which functions of a module run on the refresh
// path; scripts/hidden-check.js measures that at run time (syncOnRefresh).
const REFRESH_PATH = [
  'src/main/ipc/local-reads.js', 'src/activity.js', 'src/session-index.js', 'src/scan-host.js', 'src/process-snapshots.js',
  'src/process.js', 'src/identity.js', 'src/session-marks.js', 'src/apps.js', 'src/mesh/main/mesh-service.js'
];

// Modules the scan worker (src/scan-worker.js) runs: session scans and the
// activity probe's file work.
const SCAN_WORKER_PATH = [
  'src/scan-worker.js', 'src/activity-files.js', 'src/clients/scan.js', 'src/clients/file-memo.js', 'src/clients/claude/sessions.js',
  'src/clients/claude-cli/sessions.js', 'src/clients/codex/sessions.js', 'src/clients/codex/rollout.js', 'src/clients/kimi/sessions.js',
  'src/clients/cli-scan.js', 'src/clients/opencode/sessions.js', 'src/clients/gemini-cli/sessions.js',
  'src/clients/qwen-code/sessions.js', 'src/clients/dsh-cli/sessions.js', 'src/clients/sqlite.js',
  'src/clients/cursor/sessions.js', 'src/clients/kimi-work/sessions.js'
];

function syncCalls(code) {
  let total = 0;
  for (const m of code.matchAll(/\b([A-Za-z]+Sync)\s*\(/g)) if (SYNC_NAMES.has(m[1])) total++;
  return total;
}

function cssStyleRules(css) {
  // Strip comments and string bodies, then walk blocks.
  // Braces are found in a copy with string bodies blanked; selectors are read
  // from the comment-free original so [data-theme="dark"] stays distinct.
  const original = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const text = original.replace(/(["'])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => m[0] + ' '.repeat(m.length - 2) + m[m.length - 1]);
  const rules = [];
  const stack = [];
  let preludeStart = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      const prelude = original.slice(preludeStart, i).trim();
      let kind = 'style';
      if (prelude.startsWith('@')) {
        const at = prelude.slice(1).split(/[\s({]/)[0].toLowerCase();
        if (['media', 'supports', 'container', 'document', 'scope'].includes(at)) kind = 'conditional';
        else if (at === 'layer') kind = 'layer';
        else if (at.endsWith('keyframes')) kind = 'keyframes';
        else kind = 'atblock';
      } else if (stack.some((frame) => frame === 'keyframes')) kind = 'frame';
      if (kind === 'style') {
        rules.push({ prelude, conditional: stack.includes('conditional'), declarationsStart: i + 1 });
      }
      stack.push(kind);
      preludeStart = i + 1;
    } else if (ch === '}') {
      stack.pop();
      preludeStart = i + 1;
    } else if (ch === ';') {
      preludeStart = i + 1;
    }
  }
  return { text, rules };
}

function splitSelectors(prelude) {
  const parts = [];
  let depth = 0, start = 0;
  for (let i = 0; i < prelude.length; i++) {
    const ch = prelude[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) { parts.push(prelude.slice(start, i)); start = i + 1; }
  }
  parts.push(prelude.slice(start));
  return parts.map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function mainWindowStylesheets(root) {
  const html = path.join(root, 'src/index.html');
  if (!fs.existsSync(html)) return [];
  return [...fs.readFileSync(html, 'utf8').matchAll(/<link[^>]+rel="stylesheet"[^>]+href="\.\/([^"]+)"/g)]
    .map((m) => `src/${m[1]}`).filter((file) => fs.existsSync(path.join(root, file)));
}

function cssMetrics(root) {
  const all = listFiles(root, 'src', (name) => name.endsWith('.css'));
  const main = mainWindowStylesheets(root);
  const perFile = {};
  const selectorFiles = new Map();
  const propertyFiles = new Map();
  let important = 0, rules = 0;
  for (const file of all) {
    const { text, rules: styleRules } = cssStyleRules(fs.readFileSync(path.join(root, file), 'utf8'));
    const fileImportant = (text.match(/!\s*important/g) || []).length;
    important += fileImportant;
    rules += styleRules.length;
    perFile[file] = { rules: styleRules.length, important: fileImportant };
    if (!main.includes(file)) continue;
    for (const rule of styleRules) {
      if (rule.conditional) continue;
      for (const selector of splitSelectors(rule.prelude)) {
        if (!selectorFiles.has(selector)) selectorFiles.set(selector, new Set());
        selectorFiles.get(selector).add(file);
      }
    }
    for (const m of text.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)) {
      if (!propertyFiles.has(m[1])) propertyFiles.set(m[1], new Set());
      propertyFiles.get(m[1]).add(file);
    }
  }
  const duplicateSelectors = [...selectorFiles].filter(([, files]) => files.size > 1).map(([selector, files]) => ({ selector, files: [...files] }));
  const multiFileProperties = [...propertyFiles].filter(([, files]) => files.size > 1).map(([name, files]) => ({ name, files: [...files] }));
  return {
    files: perFile,
    mainWindowSheets: main,
    styleRules: rules,
    important,
    selectorsInMoreThanOneSheet: duplicateSelectors.length,
    customProperties: propertyFiles.size,
    customPropertiesInMoreThanOneSheet: multiFileProperties.length,
    examples: { selectors: duplicateSelectors.slice(0, 12).map((d) => d.selector), properties: multiFileProperties.slice(0, 12).map((d) => d.name) }
  };
}

function testMetrics(root) {
  const files = listFiles(root, 'test', (name) => /\.(?:c|m)?js$/.test(name));
  let readsSource = 0, textOnly = 0, testCalls = 0;
  const textOnlyFiles = [];
  const runsExtracts = [];
  const srcLiteral = /['"`](?:\.\.\/)*src\/[^'"`]*\.(?:js|css|html)['"`]|['"`]\.\.['"`]\s*,\s*['"`]src['"`]|['"`]src['"`]\s*,\s*['"`][^'"`]+\.(?:js|css|html)['"`]/;
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const code = maskSource(source, { keepStrings: true });
    testCalls += (code.match(/^\s*(?:for\s*\([^\n]*\)\s*)?(?:test|it)\(/gm) || []).length;
    // Reading source as text: a src path inside a readFileSync(...) call, or a
    // 'src/...' literal handed to a reader helper. Paths given to spawn/require
    // (running the code) do not count.
    const readArgs = [...code.matchAll(/readFileSync\(/g)].map((m) => {
      const open = m.index + m[0].length - 1;
      return code.slice(open, Math.max(open, matchForward(code, open, '(', ')')));
    });
    const direct = readArgs.some((arg) => srcLiteral.test(arg));
    const viaHelper = readArgs.length > 0 && /['"`]src\/[^'"`]*\.(?:js|css|html)['"`]/.test(code.replace(/require\(\s*['"][^'"]+['"]\s*\)/g, ''));
    const reads = direct || viaHelper;
    if (!reads) continue;
    readsSource++;
    const requiresSrc = /require\(\s*(?:['"](?:\.\.\/)+src\/|path\.(?:join|resolve)\([^)]*['"]src['"])/.test(code);
    if (!requiresSrc) { textOnly++; textOnlyFiles.push(file); if (/\bvm\.(?:runInContext|createContext|Script)\b/.test(code)) runsExtracts.push(file); }
  }
  // textOnlyFiles never require src; some of them still run extracted source
  // in a vm context, which is a behaviour check, listed separately.
  return { files: files.length, testCallsAtLineStart: testCalls, filesReadingSourceAsText: readsSource, textOnlyFiles: textOnly, textOnlyList: textOnlyFiles, textOnlyButRunExtractedSource: runsExtracts };
}

function innermost(functions, offset) {
  let best = null;
  for (const fn of functions) if (fn.bodyStart <= offset && offset <= fn.end && (!best || fn.bodyStart > best.bodyStart)) best = fn;
  return best;
}

function collect(root = ROOT) {
  const sources = listFiles(root, 'src', (name) => name.endsWith('.js') && !/^src\/i18n\/(?:zh|en|ja)\.js$/.test(name));
  const ids = clientIds(root);
  const idPattern = ids.map((id) => id.replace(/[-]/g, '\\-')).join('|');
  const comparisonRe = idPattern ? new RegExp(`(?:[!=]==?\\s*(['"])(?:${idPattern})\\1)|(?:(['"])(?:${idPattern})\\2\\s*[!=]==?)|(?:\\bcase\\s+(['"])(?:${idPattern})\\3\\s*:)`, 'g') : null;
  const tableKeyRe = idPattern ? new RegExp(`^\\s*(['"]?)(${idPattern})\\1\\s*:`, 'gm') : null;
  const mainFiles = new Set(mainProcessFiles(root));
  const functionsAll = [];
  const clientComparisons = { total: 0, files: {} };
  const perClientTables = [];
  const ipc = { total: 0, files: {} };
  const sync = { mainProcessTotal: 0, mainProcessFiles: 0, refreshPathTotal: 0, refreshPath: {}, scanWorkerTotal: 0, scanWorker: {} };
  const findSessionById = [];
  const pathHelpers = [];
  for (const file of sources) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const code = maskSource(source);
    const withStrings = maskSource(source, { keepStrings: true });
    const functions = findFunctions(source, code);
    const fileLines = countLines(source);
    for (const fn of functions) {
      // UMD/IIFE module wrappers are not functions a person would split.
      const moduleWrapper = /^<(?:anonymous|arrow)>$/.test(fn.name) && fn.lines >= fileLines * 0.8;
      functionsAll.push({ file, name: fn.name, line: fn.line, lines: fn.lines, moduleWrapper });
    }
    if (comparisonRe && !insideAdapters(file)) {
      const count = (withStrings.match(comparisonRe) || []).length;
      if (count) { clientComparisons.total += count; clientComparisons.files[file] = count; }
    }
    if (tableKeyRe && !insideAdapters(file)) {
      const keys = new Set([...withStrings.matchAll(tableKeyRe)].map((m) => m[2]));
      if (keys.size >= 3) perClientTables.push({ file, clientKeys: keys.size });
    }
    const handles = (withStrings.match(/\bipcMain\.handle\(\s*['"`]/g) || []).length;
    if (handles) { ipc.total += handles; ipc.files[file] = handles; }
    if (mainFiles.has(file)) {
      const calls = syncCalls(code);
      sync.mainProcessTotal += calls;
      if (calls) sync.mainProcessFiles++;
      if (REFRESH_PATH.includes(file)) { sync.refreshPathTotal += calls; sync.refreshPath[file] = calls; }
      if (SCAN_WORKER_PATH.includes(file)) { sync.scanWorkerTotal += calls; sync.scanWorker[file] = calls; }
    }
    const lineOf = lineIndex(code);
    const seenFns = new Set();
    for (const m of code.matchAll(/(?:\.scan|\bscanProfile)\s*\(/g)) {
      const fn = innermost(functions, m.index);
      if (!fn || seenFns.has(fn.bodyStart)) continue;
      // Only a lookup that runs on what the scan returned counts.
      const after = code.slice(m.index, fn.end);
      // A row callback that compares the row's id or address, or a Map keyed by it.
      const byId = /\.(?:find|filter)\(\s*\(?\s*(\w+)\s*\)?\s*=>[^;]*?(?:\b\1\.(?:id|address)\b|\bsessionId\(\s*\1\s*\))/.test(after)
        || (/\.get\(/.test(after) && /\.(?:set|map)\(/.test(after) && /\b\w+\.(?:id|address)\b/.test(after));
      if (byId) {
        seenFns.add(fn.bodyStart);
        findSessionById.push({ file, function: fn.name, line: lineOf(m.index) });
      }
    }
    for (const fn of functions) {
      const body = code.slice(fn.bodyStart, fn.end);
      const named = /^(?:is)?(?:same|paths?equal|equalpaths?|sub ?path|inside|within|contains?path|path(?:inside|contains)|overlaps?|isinside|iswithin|isSubpath)/i.test(fn.name.replace(/\W/g, ''));
      const relativeCheck = /path(?:Impl)?\.relative\(/.test(body) && /startsWith\(|isAbsolute\(/.test(body);
      if ((named && /\b(?:path|pathImpl)\.(?:relative|resolve)\(|realpath/.test(body)) || (relativeCheck && fn.lines <= 12)) {
        pathHelpers.push({ file, function: fn.name, line: fn.line });
      }
    }
  }
  const sharedLookup = fs.existsSync(path.join(root, 'src/session-index.js')) && /\bfunction findSession\(/.test(fs.readFileSync(path.join(root, 'src/session-index.js'), 'utf8'))
    ? 'src/session-index.js findSession' : null;
  const real = functionsAll.filter((fn) => !fn.moduleWrapper);
  const longest = [...real].sort((a, b) => b.lines - a.lines).map(({ moduleWrapper, ...fn }) => fn);
  const lineCount = (file) => fs.existsSync(path.join(root, file)) ? countLines(fs.readFileSync(path.join(root, file), 'utf8')) : 0;
  const html = fs.existsSync(path.join(root, 'src/index.html')) ? fs.readFileSync(path.join(root, 'src/index.html'), 'utf8') : '';
  return {
    schemaVersion: 1,
    srcFiles: listFiles(root, 'src', () => true).length,
    srcJsLines: sources.reduce((sum, file) => sum + lineCount(file), 0),
    mainJsLines: lineCount('src/main.js'),
    rendererJsLines: lineCount('src/renderer.js'),
    rendererScripts: (html.match(/<script\s[^>]*src=/g) || []).length,
    functions: {
      total: real.length,
      moduleWrappers: functionsAll.length - real.length,
      rendererJs: real.filter((fn) => fn.file === 'src/renderer.js').length,
      mainJs: real.filter((fn) => fn.file === 'src/main.js').length,
      over150Lines: real.filter((fn) => fn.lines > 150).length,
      longest: longest.slice(0, 12)
    },
    ipcHandleLiterals: { total: ipc.total, mainJs: ipc.files['src/main.js'] || 0, files: ipc.files },
    clientNameComparisonsOutsideApps: clientComparisons,
    perClientTablesOutsideApps: perClientTables,
    // The shared lookup (src/session-index.js findSession) counts as one implementation; every
    // other site that scans and then compares ids itself is another.
    findSessionByIdAfterRescan: { count: findSessionById.length + (sharedLookup ? 1 : 0), shared: sharedLookup, sites: findSessionById },
    pathEqualityOrContainmentHelpers: { count: pathHelpers.length, sites: pathHelpers },
    syncCalls: sync,
    css: cssMetrics(root),
    tests: testMetrics(root)
  };
}

module.exports = { maskSource, findFunctions, cssStyleRules, splitSelectors, collect, mainProcessFiles, countLines };

if (require.main === module) {
  const args = process.argv.slice(2);
  const root = args.includes('--root') ? path.resolve(args[args.indexOf('--root') + 1]) : ROOT;
  const result = collect(root);
  if (args.includes('--write')) {
    const output = { recordedAt: new Date().toISOString(), sourceSha256: require('./validation-source').sourceDigest(root), ...result };
    const file = path.join(root, 'docs/validation/architecture-metrics.json');
    fs.writeFileSync(file, JSON.stringify(output, null, 2) + '\n');
  }
  if (args.includes('--summary')) {
    const summary = {
      mainJsLines: result.mainJsLines, rendererJsLines: result.rendererJsLines,
      longestFunction: result.functions.longest[0], functionsOver150: result.functions.over150Lines,
      ipcInMainJs: result.ipcHandleLiterals.mainJs, clientComparisons: result.clientNameComparisonsOutsideApps.total,
      findSessionById: result.findSessionByIdAfterRescan.count, pathHelpers: result.pathEqualityOrContainmentHelpers.count,
      syncRefreshPath: result.syncCalls.refreshPathTotal, syncScanWorker: result.syncCalls.scanWorkerTotal, syncMainProcess: result.syncCalls.mainProcessTotal,
      cssDuplicateSelectors: result.css.selectorsInMoreThanOneSheet, cssImportant: result.css.important,
      cssMultiFileProperties: result.css.customPropertiesInMoreThanOneSheet, textOnlyTestFiles: result.tests.textOnlyFiles,
      textComparisonOnlyTestFiles: result.tests.textOnlyFiles - result.tests.textOnlyButRunExtractedSource.length
    };
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  } else {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
}
