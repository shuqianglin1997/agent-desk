// AgentDesk — 官方 App 运行探测匹配单测（node:test，零依赖）。
const { test } = require('node:test');
const assert = require('node:assert');

const { isDefaultWindowsAppRunning, isRunningIn } = require('../src/process');

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

test('Windows：整段参数被引号包裹、大小写不同也能匹配', () => {
  const profile = 'C:\\Users\\Alice\\.agentdesk\\profiles\\Claude\\Work Account';
  const command = `"C:\\Program Files\\WindowsApps\\Claude.exe" "--user-data-dir=c:/users/alice/.agentdesk/profiles/claude/work account" --enable-sandbox`;
  assert.equal(isRunningIn(command, profile), true);
});

test('Windows：--user-data-dir="路径" 形式能匹配且不误判前缀', () => {
  const command = 'Claude.exe --user-data-dir="C:\\Users\\alice\\Claude Profiles\\work" --flag';
  assert.equal(isRunningIn(command, 'C:\\Users\\alice\\Claude Profiles\\work'), true);
  assert.equal(isRunningIn(command, 'C:\\Users\\alice\\Claude'), false);
});

test('Windows 默认槽位：识别无隔离参数的桌面 App 进程', () => {
  const ps = '"C:\\Program Files\\WindowsApps\\Claude_1.0.0_x64__abc\\app\\Claude.exe" --type=renderer';
  assert.equal(isDefaultWindowsAppRunning(ps, ['Claude.exe']), true);
});

test('Windows 默认槽位：独立账号进程和 CLI shim 不会冒充默认 App', () => {
  const ps = [
    '"C:\\Program Files\\WindowsApps\\Claude_1.0.0_x64__abc\\app\\Claude.exe" --user-data-dir=C:\\Users\\Alice\\.agentdesk\\profiles\\Claude\\work',
    'C:\\Users\\Alice\\AppData\\Roaming\\npm\\claude.exe --version'
  ].join('\n');
  assert.equal(isDefaultWindowsAppRunning(ps, ['Claude.exe']), false);
});
