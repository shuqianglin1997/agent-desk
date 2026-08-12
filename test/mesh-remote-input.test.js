const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const { normalizeRemoteInput, InputRateGuard } = require('../src/mesh/domain/remote-input');
const {
  RemoteInputAdapter,
  helperLine,
  modifierMask,
  defaultInputHelperPath
} = require('../src/mesh/platform/input-adapter');
const { RemoteControlService } = require('../src/mesh/main/remote-control-service');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('远端输入只接受有界键鼠、滚轮、文本和释放事件', () => {
  assert.deepEqual(normalizeRemoteInput({ type: 'pointer', action: 'move', x: 0.25, y: 1 }), {
    type: 'pointer', action: 'move', x: 0.25, y: 1
  });
  assert.deepEqual(normalizeRemoteInput({ type: 'pointer', action: 'down', button: 'left', x: 0, y: 0 }), {
    type: 'pointer', action: 'down', button: 'left', x: 0, y: 0
  });
  assert.deepEqual(normalizeRemoteInput({
    type: 'key', action: 'down', code: 'KeyA', key: 'a', modifiers: ['Shift', 'evil'], repeat: false
  }), {
    type: 'key', action: 'down', code: 'KeyA', key: 'a', modifiers: ['Shift'], repeat: false
  });
  assert.deepEqual(normalizeRemoteInput({ type: 'text', text: '你好\n' }), { type: 'text', text: '你好\n' });
  assert.deepEqual(normalizeRemoteInput({ type: 'releaseAll' }), { type: 'releaseAll' });
  assert.throws(() => normalizeRemoteInput({ type: 'pointer', action: 'move', x: -1, y: 0 }), /pointer-x/);
  assert.throws(() => normalizeRemoteInput({ type: 'key', action: 'down', code: 'RunShell' }), /key-code/);
  assert.throws(() => normalizeRemoteInput({ type: 'command', argv: ['calc.exe'] }), /input-type/);
  assert.throws(() => normalizeRemoteInput({ type: 'text', text: 'x'.repeat(2049) }), /text-size/);
});

test('输入速率按会话和事件类型分别限流，释放后可清空', () => {
  let now = 10;
  const guard = new InputRateGuard({ now: () => now, keyLimit: 2 });
  const event = { type: 'key' };
  assert.equal(guard.accept('session-a', event), true);
  assert.equal(guard.accept('session-a', event), true);
  assert.throws(() => guard.accept('session-a', event), /remote-input-rate:key/);
  assert.equal(guard.accept('session-b', event), true);
  now += 1001;
  assert.equal(guard.accept('session-a', event), true);
  guard.clear('session-a');
  assert.equal(guard.accept('session-a', event), true);
});

test('Main 到原生助手只有固定行协议，不传 shell、路径或任意参数', () => {
  assert.equal(helperLine({ type: 'pointer', action: 'move', x: 0, y: 0 }, { point: { x: 120, y: 240 } }), 'MOVE\t120\t240');
  assert.equal(helperLine({
    type: 'key', action: 'down', code: 'KeyK', key: 'k', modifiers: ['Meta', 'Shift'], repeat: false
  }), 'KEY\tDOWN\tKeyK\t9\t0');
  assert.equal(modifierMask(['Shift', 'Control', 'Alt', 'Meta']), 15);
  const text = helperLine({ type: 'text', text: '一行\n二行' });
  assert.match(text, /^TEXT\t[A-Za-z0-9+/=]+$/);
  assert.doesNotMatch(text, /一行|\n二行|shell|argv/);
  assert.throws(() => helperLine({ type: 'command' }), /helper-event/);
});

test('输入适配器把归一化画面坐标映射到指定显示器并通过 stdin 写入', () => {
  const writes = [];
  const child = new EventEmitter();
  child.killed = false;
  child.stdin = {
    writable: true,
    writableLength: 0,
    write: (value) => { writes.push(value); return true; },
    end: () => {}
  };
  child.stderr = new EventEmitter();
  const adapter = new RemoteInputAdapter({
    platform: 'darwin',
    screen: { getAllDisplays: () => [{ id: 7, bounds: { x: 100, y: -20, width: 200, height: 100 } }] },
    systemPreferences: { isTrustedAccessibilityClient: () => true },
    helperPath: '/fixed/AgentDeskInputHelper',
    fs: { existsSync: () => true },
    spawn: (command, args, options) => {
      assert.equal(command, '/fixed/AgentDeskInputHelper');
      assert.deepEqual(args, []);
      assert.deepEqual(options.stdio, ['pipe', 'ignore', 'pipe']);
      return child;
    }
  });
  assert.equal(adapter.status().ready, true);
  adapter.inject({ type: 'pointer', action: 'move', x: 0.25, y: 0.5 }, { displayId: '7' });
  assert.equal(writes[0], 'MOVE\t150\t30\n');
  adapter.inject({ type: 'key', action: 'down', code: 'Escape', key: 'Escape' }, { displayId: '7' });
  assert.equal(writes[1], 'KEY\tDOWN\tEscape\t0\t0\n');
  adapter.stop();
  assert.match(writes.at(-1), /RELEASE/);
});

test('macOS 与 Windows 助手均实现心跳释放，打包只带编译产物', () => {
  const swift = read('native/macos/AgentDeskInputHelper.swift');
  const windows = read('native/windows/AgentDeskInputHelper.cpp');
  const build = read('scripts/build-native-helpers.js');
  const pkg = JSON.parse(read('package.json'));
  assert.match(swift, /releaseIfExpired[\s\S]*?releaseAllLocked/);
  assert.match(swift, /while let line = readLine/);
  assert.match(windows, /nowMs\(\) - lastPing\.load\(\) > 3500[\s\S]*?releaseAll\(\)/);
  assert.match(windows, /SendInput/);
  assert.doesNotMatch(`${swift}\n${windows}`, /system\(|CreateProcess|ShellExecute|popen|NSTask|Process\(/);
  assert.match(build, /swiftc[\s\S]*?lipo/);
  assert.match(build, /cl\.exe/);
  assert.equal(pkg.build.beforePack, 'scripts/build-native-helpers.js');
  assert.deepEqual(pkg.build.extraResources[0].filter, ['AgentDeskInputHelper', 'AgentDeskInputHelper.exe']);
  assert.match(defaultInputHelperPath({ platform: 'darwin', isPackaged: true, resourcesPath: '/App/Resources' }), /Resources[\\/]native[\\/]AgentDeskInputHelper$/);
});

test('控制输入只走两条固定 DataChannel，状态更新保留控制授权字段', () => {
  const consoleRenderer = read('src/remote/console.js');
  const hostRenderer = read('src/remote/host.js');
  const hostPreload = read('src/remote/host-preload.js');
  assert.match(consoleRenderer, /createDataChannel\('input\.keys', \{ ordered: true \}\)/);
  assert.match(consoleRenderer, /createDataChannel\('input\.motion', \{ ordered: false, maxRetransmits: 0 \}\)/);
  assert.match(consoleRenderer, /'state', 'mode', 'controlState', 'inputPermission', 'canControl'/);
  assert.match(consoleRenderer, /previous\.controlState === 'waiting-consent'/);
  assert.match(hostRenderer, /\['input\.keys', 'input\.motion'\]\.includes\(channel\.label\)/);
  assert.match(hostPreload, /input: \(event\) => ipcRenderer\.invoke\('remote-host:input', \{ token, event \}\)/);
  assert.doesNotMatch(`${consoleRenderer}\n${hostRenderer}\n${hostPreload}`, /remoteCommand|shell\.run|generic\.exec/);
});

test('目标端只有在 input.control 权限与本次同意都成立后才注入，并始终只有一个输入目标', async () => {
  const injected = [];
  let releases = 0;
  const semantic = [];
  const fakeWindow = {
    isDestroyed: () => false,
    getSize: () => [420, 236],
    setResizable: () => {},
    setSize: () => {},
    showInactive: () => {},
    webContents: { send: () => {} }
  };
  const service = new RemoteControlService({
    ipcMain: { handle: () => {} },
    meshService: {
      getPeerContext: () => ({ remote: { status: 'online', permissions: ['input.control'] } })
    },
    peerManagerProvider: () => ({
      sendSemantic: async (...args) => { semantic.push(args); }
    }),
    inputAdapter: {
      ensureReady: () => ({ permission: 'granted', ready: true }),
      status: () => ({ permission: 'granted', ready: true }),
      inject: (event, options) => injected.push({ event, options }),
      releaseAll: () => { releases += 1; return true; }
    }
  });
  const session = {
    sessionId: 'input-session',
    deviceId: 'controller-device',
    deviceName: 'Controller',
    direction: 'incoming',
    state: 'viewing',
    mode: 'view',
    controlState: 'waiting-consent',
    displayId: 'display-1',
    displays: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    closed: false,
    hostContext: null
  };
  const context = { session, window: fakeWindow, token: 'host-token' };
  session.hostContext = context;
  service.sessions.set(session.sessionId, session);

  assert.throws(() => service.handleHostInput(context, {
    event: { type: 'pointer', action: 'move', x: 0.5, y: 0.5 }
  }), /not-authorized/);
  assert.equal(service.handleHostInput(context, { event: { type: 'releaseAll' } }), false);
  assert.equal(releases, 0);
  service.pendingInputSessionId = session.sessionId;
  const accepted = await service.handleHostControlResponse(context, { accepted: true });
  assert.equal(accepted.mode, 'control');
  assert.equal(service.currentInputSessionId, session.sessionId);
  assert.equal(semantic[0][1], 'remote.control.response');
  service.handleHostInput(context, { event: { type: 'key', action: 'down', code: 'Escape', key: 'Escape' } });
  assert.equal(injected.length, 1);
  assert.equal(injected[0].options.displayId, 'display-1');

  const competing = {
    ...session,
    sessionId: 'competing-session',
    deviceId: 'other-controller',
    deviceName: 'Other controller',
    mode: 'view',
    controlState: 'idle',
    hostContext: { token: 'other-token', window: fakeWindow }
  };
  service.sessions.set(competing.sessionId, competing);
  await service.receiveControlRequest({
    peer: { remote: { deviceId: competing.deviceId, permissions: ['input.control'] } }
  }, { sessionId: competing.sessionId });
  assert.equal(competing.controlState, 'idle');
  assert.equal(service.currentInputSessionId, session.sessionId);
  assert.equal(semantic.at(-1)[1], 'remote.control.response');
  assert.equal(semantic.at(-1)[3].reason, 'remote-input-busy');

  await service.releaseControl(session, 'test-release', { notify: false });
  assert.equal(session.mode, 'view');
  assert.equal(service.currentInputSessionId, null);
  assert.ok(releases >= 1);
});

test('返回工作台释放所有远端输入但保留查看会话，断开才结束连接', async () => {
  const semantic = [];
  const returned = [];
  const service = new RemoteControlService({
    ipcMain: { handle: () => {} },
    meshService: {},
    peerManagerProvider: () => ({
      sendSemantic: async (...args) => { semantic.push(args); }
    }),
    onReturnToWorkspace: (value) => returned.push(value)
  });
  const makeSession = (sessionId, mode, controlState) => ({
    sessionId,
    deviceId: `device-${sessionId}`,
    deviceName: sessionId,
    direction: 'outgoing',
    state: 'viewing',
    mode,
    controlState,
    displays: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    closed: false
  });
  const first = makeSession('one', 'control', 'granted');
  const second = makeSession('two', 'view', 'waiting-consent');
  service.sessions.set(first.sessionId, first);
  service.sessions.set(second.sessionId, second);

  const result = await service.returnToWorkspace('two');
  assert.equal(result.activeSessionId, 'two');
  assert.equal(service.list().length, 2);
  assert.ok(service.list().every((session) => session.mode === 'view' && session.controlState === 'idle'));
  assert.equal(service.consoleSurface.visible, false);
  assert.equal(semantic.filter((item) => item[1] === 'remote.control.release').length, 2);
  assert.equal(returned.length, 1);

  await service.disconnect('two');
  assert.deepEqual(service.list().map((session) => session.sessionId), ['one']);
});

test('终态远控重试会先清理旧会话，不累积伪造的后台查看数量', async () => {
  const service = new RemoteControlService({
    ipcMain: { handle: () => {} },
    meshService: {
      getPeerContext: () => ({
        remote: {
          deviceId: 'device-a',
          name: 'Device A',
          status: 'online',
          permissions: ['screen.view']
        }
      })
    },
    peerManagerProvider: () => ({
      listConnections: () => [{ deviceId: 'device-a', authenticated: true, transport: { networkPath: 'direct' } }]
    })
  });
  const old = {
    sessionId: 'old-session',
    deviceId: 'device-a',
    deviceName: 'Device A',
    direction: 'outgoing',
    state: 'error',
    mode: 'view',
    controlState: 'idle',
    displays: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    closed: false
  };
  service.sessions.set(old.sessionId, old);
  service.outgoingByDevice.set(old.deviceId, old.sessionId);
  service.ensureConsole = async () => ({ webContents: { send: () => {} } });
  service.focusConsole = () => {};

  const next = await service.openDevice('device-a');
  assert.notEqual(next.sessionId, old.sessionId);
  assert.equal(next.state, 'connecting');
  assert.equal(service.sessions.has(old.sessionId), false);
  assert.deepEqual(service.list().map((session) => session.sessionId), [next.sessionId]);
});
