// Catshelf's own log and `--cli diagnostics` (docs/FIX_AND_REBUILD.md). The
// log holds fixed event names, reason codes and build facts only: a key, a
// token, an e-mail address, a session title or the home folder put into it on
// purpose (the sentinels below) must never reach the file or the output.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { makeTempDir } = require('./helpers/temp');
const { createLog, readTail, logFiles, logDirectory, redact, safeValue, errorFields, MAX_BYTES, KEEP_FILES } = require('../src/core/log');
const { startAppLog } = require('../src/main/app-log');
const { registerCommandIpc } = require('../src/main/ipc/command-shell');
const { createCliBroker, runPackagedCli } = require('../src/automation/packaged-cli');
const { collectDiagnostics, macAppLocation } = require('../src/automation/diagnostics');
const { InterfaceError } = require('../src/automation/service');

const HOME = '/Users/sentinel-person';
const SECRET = 'sk-ant-oat01-SENTINELkeyQ7f3Lm9Xc2Vb8Nz4Kd6Hs1';
const TOKEN = 'ghp_SENTINELtoken0123456789abcdefABCDEF';
const EMAIL = 'sentinel.person@example.com';
const TITLE = 'Sentinel session title about payroll';
const SENTINELS = [SECRET, TOKEN, EMAIL, TITLE, 'sentinel-person', 'SENTINEL', 'payroll'];

function assertClean(text, label) {
  for (const sentinel of SENTINELS) assert.equal(text.includes(sentinel), false, `${label} contains ${sentinel}`);
}

function readAll(directory) {
  return fs.readdirSync(directory).map((name) => fs.readFileSync(path.join(directory, name), 'utf8')).join('');
}

test('日志只写固定事件名和白名单里的值：密钥、令牌、邮箱、标题和主目录都进不去', (t) => {
  const directory = path.join(makeTempDir(t, 'catshelf-log-'), 'logs');
  const log = createLog({ directory, home: HOME, appRoot: path.join(__dirname, '..') });
  log.write('start', { version: '0.10.1-preview.1', commit: 'a'.repeat(40), dirty: false, pid: 42, os: '25.6.0' });
  log.write('command.failed', { id: 'profiles.launch', reason: 'client-missing', key: SECRET, token: TOKEN, mail: EMAIL, title: TITLE, path: `${HOME}/work` });
  log.write(`event ${SECRET}`, { 'bad key': SECRET });
  const error = new Error(`could not read ${HOME}/.codex/auth.json for ${EMAIL}: ${SECRET} "${TITLE}"`);
  error.code = 'ENOENT';
  log.error('uncaught', error, { origin: 'uncaughtException' });
  const text = fs.readFileSync(log.file, 'utf8');
  assertClean(text, 'log file');
  const lines = text.trim().split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^\d{4}-\d\d-\d\dT[\d:.]+Z start version=0\.10\.1-preview\.1 commit=a{40} dirty=false pid=42 os=25\.6\.0$/);
  assert.match(lines[1], / command\.failed id=profiles\.launch reason=client-missing key=\? token=\? mail=\? title=\? path=\?$/);
  assert.match(lines[2], / event-invalid$/);
  // The error's name, code and where in Catshelf's source; not its message.
  assert.match(lines[3], / uncaught origin=uncaughtException error=Error code=ENOENT at=test\/app-log\.test\.js:\d+:\d+/);
  assert.equal(fs.statSync(log.file).mode & 0o077, process.platform === 'win32' ? fs.statSync(log.file).mode & 0o077 : 0);
});

test('最后一道清理：主目录写成 ~，邮箱、密钥和令牌形状的东西被换掉，提交号留着', () => {
  const commit = 'b'.repeat(40);
  const cleaned = redact(`${HOME}/Library/Logs/Catshelf ${EMAIL} ${SECRET} ${TOKEN} eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc ${commit} ${'Q9'.repeat(20)}`, HOME);
  assert.equal(cleaned, `~/Library/Logs/Catshelf <email> <secret> <secret> <secret> ${commit} <secret>`);
  assert.equal(redact('C:\\Users\\sentinel-person\\AppData\\Roaming\\AgentDesk', 'C:\\Users\\sentinel-person'), '~\\AppData\\Roaming\\AgentDesk');
  assert.equal(safeValue('desktop-not-running'), 'desktop-not-running');
  assert.equal(safeValue('aB3dE5gH7jK9mN1pQ3sT5vW7'), '?');
  assert.equal(safeValue(SECRET), '?');
  assert.equal(safeValue({ nested: SECRET }), '?');
  assert.equal(safeValue(Number.NaN), '?');
  const fields = errorFields({ name: 'Weird Name!', message: SECRET, stack: `Error: ${SECRET}\n    at x (${HOME}/elsewhere/a.js:1:2)\n    at node:internal/x:3:4` }, path.join(__dirname, '..'));
  assert.deepEqual(fields, { error: 'object', at: '?,node:internal/x:3:4' });
});

test('滚动：每份不超过上限，最多留三份，最新的在 catshelf.log；同一行十分钟内不重复写', (t) => {
  const directory = makeTempDir(t, 'catshelf-log-roll-');
  let clock = Date.parse('2026-11-25T00:00:00.000Z');
  const log = createLog({ directory, home: HOME, maxBytes: 400, now: () => new Date(clock) });
  assert.equal(MAX_BYTES, 1024 * 1024);
  assert.equal(KEEP_FILES, 3);
  for (let index = 0; index < 60; index += 1) {
    clock += 1000;
    log.write('step', { n: index });
  }
  assert.deepEqual(fs.readdirSync(directory).sort(), ['catshelf.1.log', 'catshelf.2.log', 'catshelf.log']);
  for (const name of fs.readdirSync(directory)) assert.ok(fs.statSync(path.join(directory, name)).size <= 400, name);
  assert.match(fs.readFileSync(path.join(directory, 'catshelf.log'), 'utf8'), /step n=59\n$/);
  const tail = readTail(directory, 12, { home: HOME });
  assert.equal(tail.length, 12);
  assert.match(tail.at(-1), /step n=59$/);
  assert.match(tail[0], /step n=48$/);
  assert.deepEqual(logFiles(directory).files, 3);

  const before = fs.readFileSync(log.file, 'utf8');
  clock += 1000;
  assert.equal(log.write('step', { n: 59 }), false);
  assert.equal(fs.readFileSync(log.file, 'utf8'), before);
  clock += 10 * 60_000;
  assert.equal(log.write('step', { n: 59 }), true);
});

test('日志的位置：macOS 在 ~/Library/Logs/Catshelf，Windows 在数据目录的 logs；指定 --user-data-dir 时总在那里面', () => {
  assert.equal(logDirectory({ platform: 'darwin', home: '/Users/a', userData: '/Users/a/Library/Application Support/AgentDesk' }), path.join('/Users/a', 'Library', 'Logs', 'Catshelf'));
  assert.equal(logDirectory({ platform: 'win32', home: 'C:\\Users\\a', userData: 'C:\\Users\\a\\AppData\\Roaming\\AgentDesk' }), path.join('C:\\Users\\a\\AppData\\Roaming\\AgentDesk', 'logs'));
  assert.equal(logDirectory({ platform: 'darwin', home: '/Users/a', userData: '/tmp/test-data', explicitUserData: true }), path.join('/tmp/test-data', 'logs'));
});

function fakeApp(userData, explicit = true) {
  const app = new EventEmitter();
  app.getPath = (name) => { assert.equal(name, 'userData'); return userData; };
  app.commandLine = { hasSwitch: (name) => name === 'user-data-dir' && explicit };
  app.logsPath = null;
  app.setAppLogsPath = (value) => { app.logsPath = value; };
  return app;
}

test('桌面进程写下启动和异常，命令行进程什么都不写', (t) => {
  const userData = makeTempDir(t, 'catshelf-app-log-');
  const cliLog = startAppLog({ app: fakeApp(userData), cli: true, home: HOME });
  assert.equal(cliLog.directory, path.join(userData, 'logs'));
  cliLog.write('start');
  assert.equal(fs.existsSync(cliLog.directory), false);

  const app = fakeApp(userData);
  const processRef = Object.assign(new EventEmitter(), { arch: 'arm64', pid: 7, versions: { electron: '43.3.0' }, uptime: () => 1.5 });
  const log = startAppLog({ app, cli: false, home: HOME, processRef });
  assert.equal(app.logsPath, log.directory);
  const error = new Error(`${SECRET} ${EMAIL}`);
  processRef.emit('uncaughtExceptionMonitor', error, 'unhandledRejection');
  app.emit('render-process-gone', {}, {}, { reason: 'clean-exit', exitCode: 0 });
  app.emit('render-process-gone', {}, {}, { reason: 'crashed', exitCode: 11 });
  app.emit('child-process-gone', {}, { type: 'GPU', reason: 'oom', exitCode: 1 });
  app.emit('will-quit');
  const lines = readTail(log.directory, 20, { home: HOME });
  const text = lines.join('\n');
  assertClean(text, 'app log');
  assert.match(lines[0], / start version=\S+ commit=\S+ dirty=\S+ packaged=false platform=\S+ arch=arm64 os=\S+ electron=43\.3\.0 pid=7$/);
  assert.match(lines[1], / uncaught origin=unhandledRejection error=Error at=test\/app-log\.test\.js:/);
  assert.match(lines[2], / renderer\.gone reason=crashed exitCode=11$/);
  assert.match(lines[3], / child\.gone type=GPU reason=oom exitCode=1$/);
  assert.match(lines[4], / quit ms=1500$/);
  assert.equal(lines.length, 5);
});

test('窗口命令失败只记命令编号和固定原因码，不记输入、结果或异常的文字', async (t) => {
  const directory = makeTempDir(t, 'catshelf-command-log-');
  const log = createLog({ directory, home: HOME });
  const handlers = new Map();
  const commands = [
    { id: 'profiles.launch', channel: 'profiles:launch', preload: ['launch'], exec: async () => ({ ok: false, reasonCode: 'client-missing', detail: TITLE }) },
    { id: 'profiles.rename', channel: 'profiles:rename', preload: ['rename'], exec: async () => ({ ok: false, reason: `${HOME} ${EMAIL}` }) },
    { id: 'sessions.export', channel: 'sessions:export', preload: ['exportIt'], exec: async () => { throw Object.assign(new Error(`${SECRET} ${TITLE}`), { code: 'EACCES' }); } },
    { id: 'sessions.list', channel: 'sessions:list', preload: ['list'], exec: async () => ({ ok: true, title: TITLE }) }
  ];
  registerCommandIpc({ ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) }, deps: {}, commands, log });
  assert.deepEqual(await handlers.get('profiles:launch')(null, { secret: SECRET }), { ok: false, reasonCode: 'client-missing', detail: TITLE });
  await handlers.get('profiles:rename')(null, { name: TITLE });
  await assert.rejects(handlers.get('sessions:export')(null, { title: TITLE }), /SENTINEL/);
  await handlers.get('sessions:list')(null, {});
  const lines = readTail(directory, 10, { home: HOME });
  assertClean(lines.join('\n'), 'command log');
  assert.equal(lines.length, 3);
  assert.match(lines[0], / command\.failed id=profiles\.launch reason=client-missing$/);
  assert.match(lines[1], / command\.failed id=profiles\.rename$/);
  assert.match(lines[2], / command\.threw id=sessions\.export error=Error code=EACCES at=/);
});

test('转给桌面的命令行操作失败时只记命令名和错误码，不记参数、密钥或提示词', async (t) => {
  const root = makeTempDir(t, 'catshelf-broker-log-');
  const userData = path.join(root, 'AgentDesk');
  const directory = path.join(root, 'logs');
  const log = createLog({ directory, home: HOME });
  const broker = createCliBroker({
    userData, whenReady: async () => {}, log,
    dispatch: async (command) => {
      if (command === 'profiles set-key') throw new InterfaceError('secret-invalid', `rejected ${SECRET}`, 2);
      throw new Error(`${TITLE} ${EMAIL}`);
    }
  });
  const app = new EventEmitter();
  app.requestSingleInstanceLock = () => true;
  const run = (argv, secret) => runPackagedCli(argv, {
    app, userData, broker, version: 'test', timeoutMs: 500, readSecret: async () => secret,
    stdout: { write() {} }
  });
  assert.equal(await run(['profiles', 'set-key', '--profile', 'p1'], SECRET), 2);
  assert.equal(await run(['profiles', 'launch', '--profile', TITLE.replace(/ /g, '-')]), 1);
  const lines = readTail(directory, 10, { home: HOME });
  assertClean(lines.join('\n'), 'broker log');
  assert.match(lines[0], / cli\.failed command=profiles\.set-key code=secret-invalid$/);
  assert.match(lines[1], / cli\.failed command=profiles\.launch error=Error at=/);
});

function diagnosticsHarness(t, { running = false } = {}) {
  const root = makeTempDir(t, 'catshelf-diagnostics-');
  const home = path.join(root, 'sentinel-person');
  const userData = path.join(home, 'Library', 'Application Support', 'AgentDesk');
  const logDirectory = path.join(home, 'Library', 'Logs', 'Catshelf');
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'profiles.json'), JSON.stringify({ version: 2, profiles: [{ id: 'p', name: TITLE, email: EMAIL }] }));
  const log = createLog({ directory: logDirectory, home });
  log.write('start', { version: '0.10.1-preview.1', commit: 'c'.repeat(40) });
  log.write('command.failed', { id: 'profiles.launch', reason: 'client-missing' });
  // A line someone wrote by hand is cleaned when read back.
  fs.appendFileSync(log.file, `2026-11-25T00:00:00.000Z note ${home}/x ${EMAIL} ${SECRET}\n`);
  const probes = [];
  const options = {
    lines: 2,
    build: { version: '0.10.1-preview.1', packaged: true, commit: 'c'.repeat(40), dirty: false, repository: 'https://github.com/shuqianglin1997/catshelf' },
    system: { platform: 'darwin', arch: 'arm64', osRelease: '25.6.0', osVersion: '26.1', electron: '43.3.0', chrome: '1', node: '24' },
    userData, logDirectory, home, platform: 'darwin',
    executable: '/Applications/Catshelf.app/Contents/MacOS/Catshelf',
    probeDesktop: () => { probes.push(true); return running; }
  };
  return { root, home, userData, logDirectory, options, probes };
}

test('diagnostics：构建、系统、数据目录和日志的位置、日志最后几行与自检，路径写成 ~，没有敏感内容', async (t) => {
  const { userData, options, probes } = diagnosticsHarness(t);
  const app = new EventEmitter();
  app.requestSingleInstanceLock = () => { throw new Error('diagnostics asks through its own probe'); };
  let output = '';
  const code = await runPackagedCli(['diagnostics', '--lines', '2'], {
    app, userData, broker: null, version: 'test',
    diagnostics: (input) => collectDiagnostics({ ...options, lines: input.lines }),
    stdout: { write: (value) => { output += value; } }
  });
  assert.equal(code, 0);
  assertClean(output, 'diagnostics output');
  const { data } = JSON.parse(output);
  assert.equal(data.build.commit, 'c'.repeat(40));
  assert.equal(data.system.arch, 'arm64');
  assert.deepEqual(data.paths, {
    dataFolder: '~/Library/Application Support/AgentDesk',
    logFolder: '~/Library/Logs/Catshelf',
    logFile: '~/Library/Logs/Catshelf/catshelf.log'
  });
  assert.equal(data.executable, '/Applications/Catshelf.app/Contents/MacOS/Catshelf');
  assert.deepEqual(data.checks.dataFolder, { state: 'ok', files: { 'profiles.json': true, 'settings.json': false } });
  assert.equal(data.checks.desktop.running, false);
  assert.equal(data.checks.appLocation, 'applications');
  assert.equal(data.checks.log.files, 1);
  assert.equal(data.log.lines.length, 2);
  assert.match(data.log.lines[0], / command\.failed id=profiles\.launch reason=client-missing$/);
  assert.match(data.log.lines[1], / note ~\/x <email> <secret>$/);
  assert.equal(data.guide, 'docs/FIX_AND_REBUILD.md');
  assert.equal(probes.length, 1);
  // The write check leaves nothing behind.
  assert.deepEqual(fs.readdirSync(userData), ['profiles.json']);
});

test('diagnostics 的自检：桌面在跑、数据目录不能写或不存在、App 从哪里运行', (t) => {
  const { userData, options } = diagnosticsHarness(t, { running: true });
  assert.equal(collectDiagnostics(options).checks.desktop.running, true);
  assert.deepEqual(collectDiagnostics({ ...options, probeDesktop: () => { throw new Error('x'); } }).checks.desktop, { running: null, reasonCode: 'desktop-probe-failed' });
  assert.equal(collectDiagnostics({ ...options, userData: path.join(userData, 'missing') }).checks.dataFolder.state, 'missing');
  if (process.platform !== 'win32' && process.getuid?.() !== 0) {
    fs.chmodSync(userData, 0o500);
    try {
      assert.equal(collectDiagnostics(options).checks.dataFolder.state, 'not-writable');
    } finally {
      // Before the temp folder is removed, which needs write access.
      fs.chmodSync(userData, 0o700);
    }
  }
  assert.equal(collectDiagnostics({ ...options, platform: 'win32' }).checks.appLocation, undefined);
  assert.equal(macAppLocation('/private/var/folders/x/AppTranslocation/ABC/d/Catshelf.app/Contents/MacOS/Catshelf'), 'translocated');
  assert.equal(macAppLocation('/Volumes/Catshelf/Catshelf.app/Contents/MacOS/Catshelf'), 'disk-image');
  assert.equal(macAppLocation('/Users/a/Downloads/Catshelf.app/Contents/MacOS/Catshelf'), 'other');
});

test('capabilities 列出只读的 diagnostics 并指向排查指南；没有桌面进程提供它时如实拒绝', async (t) => {
  const root = makeTempDir(t, 'catshelf-diagnostics-caps-');
  const app = new EventEmitter();
  let output = '';
  const invoke = async (argv) => {
    output = '';
    const code = await runPackagedCli(argv, { app, userData: path.join(root, 'AgentDesk'), broker: null, version: 'test', stdout: { write: (value) => { output += value; } } });
    return { code, body: JSON.parse(output) };
  };
  const { body } = await invoke(['capabilities']);
  const entry = body.data.commands.find((item) => item.name === 'diagnostics');
  assert.equal(entry.effects, 'read-only');
  assert.deepEqual(Object.keys(entry.parameters), ['lines']);
  assert.equal(body.data.troubleshooting.command, 'diagnostics');
  assert.equal(body.data.troubleshooting.guide, 'docs/FIX_AND_REBUILD.md');
  const refused = await invoke(['diagnostics']);
  assert.equal(refused.code, 5);
  assert.equal(refused.body.error.code, 'diagnostics-unavailable');
  assert.equal((await invoke(['diagnostics', '--lines', '201'])).code, 2);
});
