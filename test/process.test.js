// AgentDesk — 官方 App 运行探测匹配单测（node:test，零依赖）。
const { test } = require('node:test');
const assert = require('node:assert');

const { isRunningIn, cpuFor } = require('../src/process');

const H = '/Users/hupo/Library/Application Support';
// 模拟 ps 输出：路径含空格、且短路径是长路径的前缀
const PS = [
  `/Applications/Claude.app/Contents/MacOS/Claude --user-data-dir=${H}/Claude --standard-schemes=app --enable-sandbox`,
  `/Applications/Claude.app/.../Claude Helper --type=renderer --user-data-dir=${H}/Claude Profiles/lyh --lang=en-US`,
  `/Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=${H}/Codex`,
  `/Applications/obsidian.app/... --user-data-dir=${H}/obsidian`
].join('\n');

test('精确匹配正在运行的账号目录', () => {
  assert.equal(isRunningIn(PS, `${H}/Claude`), true);
  assert.equal(isRunningIn(PS, `${H}/Codex`), true);
});

test('路径含空格也能匹配（Claude Profiles/lyh）', () => {
  assert.equal(isRunningIn(PS, `${H}/Claude Profiles/lyh`), true);
});

test('没有对应进程 → false（关键：GSJ 的 Claude-Alt 没跑）', () => {
  assert.equal(isRunningIn(PS, `${H}/Claude-Alt`), false);
});

test('前缀不误判：…/Claude 不会匹配到 …/Claude Profiles/lyh 那个进程', () => {
  // 只有第 1 行是真正的 …/Claude 进程；把它去掉后应为 false
  const psOnlyLyh = `/Applications/Claude.app/... --user-data-dir=${H}/Claude Profiles/lyh --lang=en-US`;
  assert.equal(isRunningIn(psOnlyLyh, `${H}/Claude`), false);
});

test('行尾即结束也算匹配', () => {
  assert.equal(isRunningIn(`foo --user-data-dir=${H}/Codex`, `${H}/Codex`), true);
});

test('空输入不炸', () => {
  assert.equal(isRunningIn('', `${H}/Claude`), false);
  assert.equal(isRunningIn(PS, ''), false);
  assert.equal(isRunningIn(null, null), false);
});

// ── cpuFor：按行「<%cpu> <args>」累加归属该账号的进程占用 ──
// 含前缀陷阱：…/Claude 是 …/Claude Profiles/lyh 的前缀，绝不能把 lyh 的占用算进去
const PS_CPU = [
  `  2.0 /Applications/Claude.app/Contents/MacOS/Claude --user-data-dir=${H}/Claude --enable-sandbox`,
  ` 12.0 /Applications/Claude.app/.../Claude Helper --type=renderer --user-data-dir=${H}/Claude --lang=en`,
  `130.0 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT --user-data-dir=${H}/Codex`,
  `  5.0 /Applications/Claude.app/.../Claude Helper --user-data-dir=${H}/Claude Profiles/lyh --lang=en`
].join('\n');

test('cpuFor：累加主进程+helper 的 %cpu', () => {
  assert.equal(cpuFor(PS_CPU, `${H}/Claude`), 14); // 2.0 + 12.0，绝不含 lyh 的 5.0
  assert.equal(cpuFor(PS_CPU, `${H}/Codex`), 130);
  assert.equal(cpuFor(PS_CPU, `${H}/Claude Profiles/lyh`), 5);
});

test('cpuFor：没跑的账号 → 0', () => {
  assert.equal(cpuFor(PS_CPU, `${H}/Claude-Alt`), 0);
});

test('cpuFor：空输入 → null', () => {
  assert.equal(cpuFor('', `${H}/Codex`), null);
  assert.equal(cpuFor(PS_CPU, ''), null);
});

test('cpuFor：Windows（wmic 无 CPU 列）→ null，交由上层回退 mtime', () => {
  const orig = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  try {
    assert.equal(cpuFor(`x --user-data-dir=${H}/Codex`, `${H}/Codex`), null);
  } finally {
    Object.defineProperty(process, 'platform', { value: orig, configurable: true });
  }
});
