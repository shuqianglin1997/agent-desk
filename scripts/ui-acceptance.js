#!/usr/bin/env node

/*
 * Real-window acceptance for the fixed AgentDesk shell.
 *
 * The runner launches the actual Electron app against a disposable userData
 * directory, drives the renderer through Chrome DevTools Protocol, and keeps
 * every destructive Mesh/catalog action inside that temporary directory.
 * No clipboard write, account launch, filesystem reveal, remote connection,
 * or owner configuration is touched.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const APP_ROOT = path.resolve(__dirname, '..');
const TIMEOUT_MS = 30_000;

class DevToolsClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  async connect() {
    assert.equal(typeof WebSocket, 'function', 'Node 22+ WebSocket support is required');
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(this.url);
      const timer = setTimeout(() => reject(new Error('DevTools WebSocket connection timed out')), 10_000);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('DevTools WebSocket connection failed'));
      }, { once: true });
      socket.addEventListener('message', (event) => this.handleMessage(event.data));
      socket.addEventListener('close', () => this.rejectPending(new Error('DevTools WebSocket closed')));
    });
  }

  handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch (_error) {
      return;
    }
    if (message.id) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message || 'DevTools command failed'));
      else entry.resolve(message.result || {});
      return;
    }
    if (message.method) this.events.push(message);
  }

  rejectPending(error) {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  call(method, params = {}) {
    assert.ok(this.socket, 'DevTools client is not connected');
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools command timed out: ${method}`));
      }, TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.call('Runtime.evaluate', {
      expression,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || 'Renderer evaluation failed';
      throw new Error(description);
    }
    return result.result?.value;
  }

  close() {
    if (!this.socket) return;
    this.socket.close();
    this.socket = null;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function writeCodexSession(root, input) {
  const sessionsDir = path.join(root, 'sessions', '2026', '08', '12');
  fs.mkdirSync(sessionsDir, { recursive: true });
  const filePath = path.join(sessionsDir, `rollout-${input.physicalId}.jsonl`);
  const metadata = {
    timestamp: input.createdAt,
    type: 'session_meta',
    payload: {
      id: input.physicalId,
      session_id: input.conversationId,
      cwd: input.projectPath,
      model_provider: 'openai'
    }
  };
  fs.writeFileSync(filePath, `${JSON.stringify(metadata)}\n`, { mode: 0o600 });
  fs.appendFileSync(path.join(root, 'session_index.jsonl'), `${JSON.stringify({
    id: input.conversationId,
    thread_name: input.title,
    updated_at: input.updatedAt
  })}\n`, { mode: 0o600 });
}

function seedUserData(userData) {
  const roots = {
    workDesktop: path.join(userData, 'fixtures', 'work-desktop'),
    workCli: path.join(userData, 'fixtures', 'work-cli'),
    personal: path.join(userData, 'fixtures', 'personal')
  };
  for (const root of Object.values(roots)) fs.mkdirSync(root, { recursive: true });

  const profiles = [
    {
      id: 'acceptance-work-desktop',
      appId: 'codex',
      name: 'Work Agent Desktop',
      group: 'Work',
      note: 'Real-window acceptance fixture',
      identityKey: 'acceptance-work-login',
      profilePath: path.join(userData, 'profiles', 'work-desktop'),
      sessionRoot: roots.workDesktop,
      profilePathMode: 'custom',
      sessionRootMode: 'custom',
      isProtected: false,
      createdAt: '2026-08-12T01:00:00.000Z'
    },
    {
      id: 'acceptance-work-cli',
      appId: 'codex',
      name: 'Work Agent CLI',
      group: 'Work',
      note: 'Second Slot for the same login',
      identityKey: 'acceptance-work-login',
      profilePath: path.join(userData, 'profiles', 'work-cli'),
      sessionRoot: roots.workCli,
      profilePathMode: 'custom',
      sessionRootMode: 'custom',
      isProtected: false,
      createdAt: '2026-08-12T01:01:00.000Z'
    },
    {
      id: 'acceptance-personal',
      appId: 'codex',
      name: 'Personal Agent',
      group: 'Personal',
      note: 'Independent login',
      identityKey: 'acceptance-personal-login',
      profilePath: path.join(userData, 'profiles', 'personal'),
      sessionRoot: roots.personal,
      profilePathMode: 'custom',
      sessionRootMode: 'custom',
      isProtected: false,
      createdAt: '2026-08-12T01:02:00.000Z'
    }
  ];
  for (const profile of profiles) fs.mkdirSync(profile.profilePath, { recursive: true });

  writeCodexSession(roots.workDesktop, {
    physicalId: '11111111-1111-4111-8111-111111111111',
    conversationId: 'work-conversation-alpha',
    title: 'Work Alpha — renderer state',
    projectPath: path.join(userData, 'projects', 'alpha'),
    createdAt: '2026-08-12T02:00:00.000Z',
    updatedAt: '2026-08-12T06:00:00.000Z'
  });
  writeCodexSession(roots.workDesktop, {
    physicalId: '22222222-2222-4222-8222-222222222222',
    conversationId: 'work-conversation-beta',
    title: 'Work Beta — selection lifecycle',
    projectPath: path.join(userData, 'projects', 'beta'),
    createdAt: '2026-08-12T02:30:00.000Z',
    updatedAt: '2026-08-12T05:30:00.000Z'
  });
  writeCodexSession(roots.workCli, {
    physicalId: '33333333-3333-4333-8333-333333333333',
    conversationId: 'work-conversation-gamma',
    title: 'Work Gamma — Slot routing',
    projectPath: path.join(userData, 'projects', 'gamma'),
    createdAt: '2026-08-12T03:00:00.000Z',
    updatedAt: '2026-08-12T05:00:00.000Z'
  });
  writeCodexSession(roots.personal, {
    physicalId: '44444444-4444-4444-8444-444444444444',
    conversationId: 'personal-conversation-delta',
    title: 'Personal Delta — independent Agent',
    projectPath: path.join(userData, 'projects', 'delta'),
    createdAt: '2026-08-12T03:30:00.000Z',
    updatedAt: '2026-08-12T04:30:00.000Z'
  });

  writeJson(path.join(userData, 'profiles.json'), { version: 3, profiles });
  writeJson(path.join(userData, 'settings.json'), {
    version: 2,
    settings: {
      theme: 'light',
      view: 'classic',
      lang: 'zh',
      sessionScope: 'current',
      sessionView: 'compact',
      remindersOn: false,
      atmosTime: 'day',
      atmosWeather: 'clear',
      welcomed: true,
      ledger: null,
      meshSignalingUrls: [],
      meshStunUrls: [],
      yardPositions: {}
    }
  });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForTarget(port, childState) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (childState.exited) throw new Error(`Electron exited before DevTools became ready (${childState.code})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((item) => item.type === 'page' && /index\.html/.test(item.url || ''))
          || targets.find((item) => item.type === 'page');
        if (page?.webSocketDebuggerUrl) return page;
      }
    } catch (_error) {
      // Electron has not opened the debugging endpoint yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the AgentDesk renderer target');
}

async function waitFor(client, expression, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluate(`Boolean(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function capture(client, artifactDir, name) {
  if (!artifactDir) return null;
  fs.mkdirSync(artifactDir, { recursive: true });
  const result = await client.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false
  });
  const target = path.join(artifactDir, `${name}.png`);
  fs.writeFileSync(target, Buffer.from(result.data, 'base64'));
  return target;
}

async function layoutSnapshot(client) {
  return client.evaluate(`(() => {
    const rect = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return null;
      const value = node.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom };
    };
    const overlaps = (left, right) => left && right
      && left.x < right.right && left.right > right.x
      && left.y < right.bottom && left.bottom > right.y;
    const shell = document.querySelector('.app-shell');
    const brand = rect('.topbar-brand');
    const context = rect('.topbar-context');
    const actions = rect('.topbar-actions');
    return {
      outerWidth,
      outerHeight,
      innerWidth,
      innerHeight,
      shell: rect('.app-shell'),
      main: rect('#mainGrid'),
      status: rect('#statusBar'),
      rows: getComputedStyle(shell).gridTemplateRows.trim().split(/\\s+/),
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      bodyOverflow: document.body.scrollWidth - innerWidth,
      topbarOverlap: overlaps(brand, context) || overlaps(context, actions) || overlaps(brand, actions),
      bodyView: document.body.dataset.view,
      theme: document.documentElement.dataset.theme,
      lang: document.documentElement.lang
    };
  })()`);
}

function assertFixedShell(layout) {
  assert.equal(layout.outerWidth, 1040, 'BrowserWindow outer width must stay fixed at 1040');
  assert.equal(layout.outerHeight, 840, 'BrowserWindow outer height must stay fixed at 840');
  assert.equal(layout.shell.width, layout.innerWidth, 'app-shell must fill the renderer width');
  assert.equal(layout.shell.height, layout.innerHeight, 'app-shell must fill the renderer height');
  assert.equal(layout.rows.length, 7, 'app-shell must keep seven grid rows');
  assert.ok(layout.main.height >= 240, `row 6 is too short: ${layout.main.height}px`);
  assert.ok(layout.status.y >= layout.main.bottom - 1, 'status row must remain below the workspace');
  assert.ok(layout.documentOverflow <= 1 && layout.bodyOverflow <= 1, 'the fixed shell must not overflow horizontally');
  assert.equal(layout.topbarOverlap, false, 'topbar regions must not overlap');
}

async function dialogSnapshot(client, selector) {
  return client.evaluate(`(() => {
    const dialog = document.querySelector(${JSON.stringify(selector)});
    const rect = dialog.getBoundingClientRect();
    const body = dialog.querySelector('.dialog-body');
    return {
      open: dialog.open,
      modal: dialog.matches(':modal'),
      rect: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      bodyClientHeight: body?.clientHeight || 0,
      bodyScrollHeight: body?.scrollHeight || 0,
      viewport: { width: innerWidth, height: innerHeight },
      activeId: document.activeElement?.id || ''
    };
  })()`);
}

function assertDialogFits(snapshot, options = {}) {
  assert.equal(snapshot.open, true, 'dialog must be open');
  assert.ok(snapshot.rect.x >= -1 && snapshot.rect.y >= -1, 'dialog must start inside the viewport');
  assert.ok(snapshot.rect.right <= snapshot.viewport.width + 1, 'dialog must fit the viewport width');
  assert.ok(snapshot.rect.bottom <= snapshot.viewport.height + 1, 'dialog must fit the viewport height');
  if (options.noScroll) {
    assert.ok(snapshot.bodyScrollHeight <= snapshot.bodyClientHeight + 2, 'embedded device workspace must not overflow its row');
  }
}

async function runAcceptance(client, artifactDir) {
  const checks = [];
  const run = async (name, task) => {
    await task();
    checks.push(name);
    process.stdout.write(`✓ ${name}\n`);
  };

  await client.call('Runtime.enable');
  await client.call('Page.enable');
  await client.call('Log.enable');
  await waitFor(
    client,
    `typeof state !== 'undefined'
      && state.profiles.length === 3
      && state.sessions.length >= 3
      && document.querySelectorAll('#sessionRows tr:not(.empty-row)').length >= 3
      && !document.querySelector('#welcomeDialog').open`,
    'the seeded local workspace'
  );

  await run('1040×840 seven-row shell', async () => {
    assertFixedShell(await layoutSnapshot(client));
    const initial = await client.evaluate(`({
      profiles: state.profiles.length,
      focused: state.ui.focusedConversationId,
      checked: state.ui.checkedConversationIds.size,
      workspace: state.ui.workspaceMode,
      mesh: state.mesh.overview?.initialized === true
    })`);
    assert.equal(initial.profiles, 3);
    assert.equal(initial.focused, null, 'initial render must not auto-focus a session');
    assert.equal(initial.checked, 0, 'initial render must not auto-check a session');
    assert.equal(initial.workspace, 'sessions');
    assert.equal(initial.mesh, false);
  });
  await capture(client, artifactDir, '01-local-zh-light');

  await run('focus, explicit check, hidden selection, and clear lifecycle', async () => {
    await client.evaluate(`document.querySelectorAll('#sessionRows tr:not(.empty-row)')[0].click()`);
    const focused = await client.evaluate(`state.ui.focusedConversationId`);
    assert.ok(focused);
    let action = await client.evaluate(`({
      checked: state.ui.checkedConversationIds.size,
      barHidden: document.querySelector('#sessionSelectionBar').hidden,
      copyDisabled: document.querySelector('#copySessionInfoBtn').disabled
    })`);
    assert.deepEqual(action, { checked: 0, barHidden: false, copyDisabled: false });

    await client.evaluate(`document.querySelectorAll('#sessionRows .session-select-box')[1].click()`);
    action = await client.evaluate(`({
      focused: state.ui.focusedConversationId,
      checked: state.ui.checkedConversationIds.size,
      actionIds: window.UiContext.actionConversationIds(state.ui).length
    })`);
    assert.equal(action.focused, focused, 'checking another row must not steal focus');
    assert.equal(action.checked, 1);
    assert.equal(action.actionIds, 1, 'checked rows become the explicit batch action set');

    await client.evaluate(`(() => {
      const input = document.querySelector('#searchInput');
      input.value = 'acceptance-no-match';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    action = await client.evaluate(`({
      filtered: state.filteredSessions.length,
      checked: state.ui.checkedConversationIds.size,
      barHidden: document.querySelector('#sessionSelectionBar').hidden,
      issue: document.querySelector('#sessionSelectionIssue').textContent.trim()
    })`);
    assert.equal(action.filtered, 0);
    assert.equal(action.checked, 1, 'search must preserve a still-valid hidden check');
    assert.equal(action.barHidden, false);
    assert.ok(action.issue.length > 0, 'hidden selections need a visible explanation');

    await client.evaluate(`document.querySelector('#clearSessionSelectionBtn').click()`);
    action = await client.evaluate(`({
      focused: state.ui.focusedConversationId,
      checked: state.ui.checkedConversationIds.size,
      barHidden: document.querySelector('#sessionSelectionBar').hidden
    })`);
    assert.deepEqual(action, { focused: null, checked: 0, barHidden: true });
    await client.evaluate(`(() => {
      const input = document.querySelector('#searchInput');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  });

  await run('classic/yard, light/dark, and zh/en/ja layouts', async () => {
    await client.evaluate(`document.querySelector('#viewToggle').click()`);
    assert.equal((await layoutSnapshot(client)).bodyView, 'yard');
    await client.evaluate(`document.querySelector('#viewToggle').click()`);
    assert.equal((await layoutSnapshot(client)).bodyView, 'classic');
    await client.evaluate(`document.querySelector('#themeToggle').click()`);
    assert.equal((await layoutSnapshot(client)).theme, 'dark');

    for (const lang of ['zh', 'en', 'ja']) {
      await client.evaluate(`(() => {
        window.I18N.setLang(${JSON.stringify(lang)});
        updateLangToggle();
        applyView();
        rerenderLocalizedText();
      })()`);
      const layout = await layoutSnapshot(client);
      assertFixedShell(layout);
      assert.equal(layout.lang, lang === 'zh' ? 'zh-CN' : lang);
    }
  });
  await capture(client, artifactDir, '02-local-ja-dark');

  await run('pure-local add dialog fits without changing data', async () => {
    await client.evaluate(`openProfileCreationDialog()`);
    const snapshot = await dialogSnapshot(client, '#profileDialog');
    assertDialogFits(snapshot);
    assert.equal(snapshot.activeId, 'newProfileName');
    await client.evaluate(`document.querySelector('#profileDialog').close()`);
  });

  await run('non-modal row-6 Device Center and isolated Mesh initialization', async () => {
    await client.evaluate(`(() => {
      window.I18N.setLang('zh');
      rerenderLocalizedText();
      if (document.documentElement.dataset.theme === 'dark') document.querySelector('#themeToggle').click();
      document.querySelector('#deviceCenterBtn').click();
    })()`);
    await waitFor(client, `state.ui.workspaceMode === 'devices' && document.querySelector('#deviceCenterDialog').open`, 'Device Center');
    let snapshot = await dialogSnapshot(client, '#deviceCenterDialog');
    assertDialogFits(snapshot, { noScroll: true });
    assert.equal(snapshot.modal, false, 'Device Center must use show(), not showModal()');
    const geometry = await client.evaluate(`(() => {
      const workspace = document.querySelector('#mainGrid').getBoundingClientRect();
      const dialog = document.querySelector('#deviceCenterDialog').getBoundingClientRect();
      return { workspace: { x: workspace.x, y: workspace.y, width: workspace.width, height: workspace.height }, dialog: { x: dialog.x, y: dialog.y, width: dialog.width, height: dialog.height } };
    })()`);
    assert.deepEqual(geometry.dialog, geometry.workspace, 'Device Center must occupy only row 6');

    await client.evaluate(`document.querySelector('#initializeMeshBtn').click()`);
    await waitFor(
      client,
      `state.mesh.overview?.initialized === true || Boolean(state.mesh.errorCode)`,
      'temporary Mesh initialization',
      20_000
    );
    const initialized = await client.evaluate(`({
      initialized: state.mesh.overview?.initialized === true,
      error: state.mesh.errorCode,
      agent: currentAgentId(),
      currentScopeDisabled: document.querySelector('#sessionScopeCurrentBtn').disabled,
      detailKind: document.querySelector('#deviceDetailKind').textContent,
      detailStatus: document.querySelector('#deviceDetailStatus').textContent
    })`);
    assert.equal(initialized.initialized, true, `Mesh initialization failed: ${initialized.error || 'unknown error'}`);
    assert.equal(initialized.agent, null, 'Mesh initialization must not silently choose the first Agent');
    assert.equal(initialized.currentScopeDisabled, true);
    assert.equal(initialized.detailKind, '', 'unselected device detail must not retain a stale kind');
    assert.equal(initialized.detailStatus, '', 'unselected device detail must not retain a stale status');

    await client.evaluate(`document.querySelector('.device-list-item').click()`);
    const independence = await client.evaluate(`({
      detail: state.ui.selectedDeviceDetailId,
      lens: state.ui.selectedDeviceLensId,
      detailName: document.querySelector('#deviceDetailName').textContent,
      actionCount: document.querySelector('#deviceDetailActions').children.length
    })`);
    assert.ok(independence.detail);
    assert.equal(independence.lens, 'all', 'left-side device selection must not change the topbar Lens');
    assert.ok(independence.detailName.length > 0 && independence.actionCount >= 3);
    snapshot = await dialogSnapshot(client, '#deviceCenterDialog');
    assertDialogFits(snapshot, { noScroll: true });
  });
  await capture(client, artifactDir, '03-mesh-device-center');

  await run('device task navigation applies an atomic Lens/Agent/scope transition', async () => {
    await client.evaluate(`(() => {
      state.query = 'work';
      document.querySelector('#searchInput').value = 'work';
      document.querySelector('#deviceDetailActions > button').click();
    })()`);
    await waitFor(client, `state.ui.workspaceMode === 'sessions'
      && document.querySelector('#mainGrid').dataset.workspace === 'sessions'
      && !document.querySelector('#deviceCenterDialog').open
      && state.ui.selectedDeviceLensId !== 'all'
      && state.ui.agentScope === 'all'`, 'device all-session navigation');
    let result = await client.evaluate(`({
      query: state.query,
      focused: state.ui.focusedConversationId,
      checked: state.ui.checkedConversationIds.size,
      lens: state.ui.selectedDeviceLensId,
      scope: state.ui.agentScope
    })`);
    assert.equal(result.query, 'work');
    assert.equal(result.focused, null);
    assert.equal(result.checked, 0);
    assert.equal(result.scope, 'all');

    await client.evaluate(`document.querySelector('#deviceCenterBtn').click()`);
    await waitFor(client, `state.ui.workspaceMode === 'devices'`, 'Device Center re-entry');
    const expectedAgent = await client.evaluate(`(() => {
      const overview = state.mesh.overview;
      const deviceId = state.ui.selectedDeviceDetailId;
      const deviceAgents = overview.agents.filter((agent) => overview.slots.some((slot) => (
        slot.agentId === agent.agentId
        && slot.accountBindingId
        && slot.assignmentState === 'linked'
        && slot.deviceId === deviceId
      )));
      const target = deviceAgents.find((agent) => overview.slots.filter((slot) => (
        slot.agentId === agent.agentId
        && slot.deviceId === deviceId
        && slot.accountBindingId
        && slot.assignmentState === 'linked'
      )).length >= 2);
      if (!target) throw new Error('acceptance Agent with two Slots not found');
      const index = deviceAgents.findIndex((agent) => agent.agentId === target.agentId);
      document.querySelectorAll('.mesh-agent-card:not(.is-unassigned)')[index].click();
      return target.agentId;
    })()`);
    await waitFor(client, `state.ui.workspaceMode === 'sessions'
      && document.querySelector('#mainGrid').dataset.workspace === 'sessions'
      && !document.querySelector('#deviceCenterDialog').open
      && state.ui.agentScope === 'current'
      && Boolean(currentAgentId())`, 'device Agent navigation');
    result = await client.evaluate(`({
      query: state.query,
      lens: state.ui.selectedDeviceLensId,
      agent: currentAgentId(),
      slot: currentSlotKey(),
      scope: state.ui.agentScope
    })`);
    assert.equal(result.query, 'work');
    assert.ok(result.agent && result.slot);
    assert.equal(result.agent, expectedAgent);
    assert.equal(result.scope, 'current');
  });

  await run('Slot switching preserves search, focus, and explicit checks', async () => {
    await client.evaluate(`(() => {
      const input = document.querySelector('#searchInput');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const rows = document.querySelectorAll('#sessionRows tr:not(.empty-row)');
      if (rows.length < 2) throw new Error('acceptance Agent must expose at least two sessions');
      rows[0].click();
      rows[1].querySelector('.session-select-box').click();
      input.value = 'work';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    const before = await client.evaluate(`({
      query: state.query,
      focused: state.ui.focusedConversationId,
      checked: [...state.ui.checkedConversationIds],
      options: [...document.querySelector('#formSelect').options].map((item) => item.value),
      current: document.querySelector('#formSelect').value
    })`);
    assert.ok(before.options.length >= 2, 'the seeded shared login must expose two Slots');
    const nextSlot = before.options.find((item) => item !== before.current);
    await client.evaluate(`(() => {
      const select = document.querySelector('#formSelect');
      select.value = ${JSON.stringify(nextSlot)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const after = await client.evaluate(`({
      query: state.query,
      focused: state.ui.focusedConversationId,
      checked: [...state.ui.checkedConversationIds],
      current: document.querySelector('#formSelect').value
    })`);
    assert.equal(after.query, before.query);
    assert.equal(after.focused, before.focused);
    assert.deepEqual(after.checked, before.checked);
    assert.equal(after.current, nextSlot);
    await client.evaluate(`(() => {
      document.querySelector('#clearSessionSelectionBtn').click();
      const input = document.querySelector('#searchInput');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  });

  await run('Agent, binding, Slot, merge/split, and removal dialogs are explicit', async () => {
    await client.evaluate(`openAgentOrProfileEditor()`);
    let snapshot = await dialogSnapshot(client, '#editDialog');
    assertDialogFits(snapshot);
    assert.equal(snapshot.activeId, 'editName');
    let values = await client.evaluate(`({
      nameVisible: !document.querySelector('#editName').closest('label').hidden,
      identityHidden: document.querySelector('#editIdentityField').hidden
    })`);
    assert.equal(values.nameVisible, true);
    assert.equal(values.identityHidden, true, 'global Agent editing must not expose local identity linkage');
    await client.evaluate(`document.querySelector('#editDialog').close()`);

    await client.evaluate(`openProfileCreationDialog()`);
    snapshot = await dialogSnapshot(client, '#profileDialog');
    assertDialogFits(snapshot);
    values = await client.evaluate(`({
      mode: document.querySelector('#newProfileMode').value,
      confirmDisabled: document.querySelector('#confirmAddProfileBtn').disabled,
      assignmentVisible: !document.querySelector('#newProfileMeshAssignment').hidden
    })`);
    assert.deepEqual(values, { mode: '', confirmDisabled: true, assignmentVisible: true });
    await client.evaluate(`(() => {
      const mode = document.querySelector('#newProfileMode');
      mode.value = 'existing-agent';
      mode.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    values = await client.evaluate(`({
      agent: document.querySelector('#newProfileAgent').value,
      placeholderDisabled: document.querySelector('#newProfileAgent').options[0].disabled,
      confirmDisabled: document.querySelector('#confirmAddProfileBtn').disabled
    })`);
    assert.deepEqual(values, { agent: '', placeholderDisabled: true, confirmDisabled: true });
    await client.evaluate(`document.querySelector('#profileDialog').close()`);

    await client.evaluate(`openAgentRelationsDialog()`);
    snapshot = await dialogSnapshot(client, '#agentRelationsDialog');
    assertDialogFits(snapshot);
    values = await client.evaluate(`({
      merge: document.querySelector('#mergeAgentTarget').value,
      mergeDisabled: document.querySelector('#confirmMergeAgentBtn').disabled,
      split: document.querySelector('#splitAccountBinding').value,
      splitDisabled: document.querySelector('#confirmSplitBindingBtn').disabled
    })`);
    assert.deepEqual(values, { merge: '', mergeDisabled: true, split: '', splitDisabled: true });
    await client.evaluate(`document.querySelector('#agentRelationsDialog').close()`);

    await client.evaluate(`openAgentOrProfileRemoval()`);
    snapshot = await dialogSnapshot(client, '#removeCatalogDialog');
    assertDialogFits(snapshot);
    values = await client.evaluate(`({
      scopes: [...document.querySelectorAll('input[name="catalogRemoveScope"]')].map((item) => ({ value: item.value, disabled: item.disabled })),
      safety: document.querySelector('.catalog-data-safety').textContent.trim()
    })`);
    assert.deepEqual(values.scopes.map((item) => item.value), ['slot', 'account-binding', 'agent']);
    assert.equal(values.scopes.find((item) => item.value === 'agent').disabled, false);
    assert.ok(values.safety.length > 0);
    await client.evaluate(`document.querySelector('#removeCatalogDialog').close()`);
  });

  await run('multi-replica actions require one explicit source', async () => {
    const injected = await client.evaluate(`(() => {
      const overview = state.mesh.overview;
      const agent = overview.agents[0];
      const localSlot = overview.slots.find((item) => item.agentId === agent.agentId && item.deviceId === overview.localDeviceId);
      const binding = overview.accountBindings.find((item) => item.accountBindingId === localSlot.accountBindingId);
      const remoteId = 'acceptance-remote-device';
      overview.devices.push({
        deviceId: remoteId,
        name: 'Offline Windows Fixture',
        platform: 'win32',
        arch: 'x64',
        appVersion: '0.9.1',
        status: 'offline',
        isLocal: false,
        fingerprint: 'ACCEPTANCE',
        permissions: ['inventory.read', 'screen.view'],
        agentCount: 1,
        slotCount: 1,
        sessionCount: 1
      });
      overview.slots.push({
        deviceId: remoteId,
        profileId: 'acceptance-remote-profile',
        agentId: agent.agentId,
        accountBindingId: binding.accountBindingId,
        appId: 'codex',
        clientForm: 'desktop',
        localLabel: 'Remote Codex',
        assignmentState: 'linked',
        launchable: true,
        sessionCount: 1
      });
      const title = 'Cross-device replica acceptance';
      const common = {
        conversationId: 'acceptance-multi-replica',
        adapterConversationKey: 'acceptance-thread',
        title,
        createdAt: '2026-08-12T02:00:00.000Z',
        updatedAt: '2026-08-12T07:00:00.000Z',
        agentId: agent.agentId,
        accountBindingId: binding.accountBindingId,
        appId: 'codex',
        source: 'Codex',
        status: '可用',
        model: 'openai'
      };
      const replicas = [
        {
          ...common,
          replicaId: 'acceptance-local-replica',
          deviceId: overview.localDeviceId,
          deviceName: overview.devices.find((item) => item.isLocal).name,
          profileId: localSlot.profileId,
          projectPathHint: '/tmp/agentdesk-acceptance/local-project',
          sourceFileHint: '/tmp/agentdesk-acceptance/local-session.jsonl',
          stale: false
        },
        {
          ...common,
          replicaId: 'acceptance-remote-replica',
          deviceId: remoteId,
          deviceName: 'Offline Windows Fixture',
          profileId: 'acceptance-remote-profile',
          projectPathHint: 'D:/Projects/AgentDesk',
          sourceFileHint: 'D:/Sessions/acceptance.jsonl',
          stale: true
        }
      ];
      let row = sessionAtReplica({ ...common, id: common.adapterConversationKey, address: common.adapterConversationKey }, replicas[0], overview);
      row = enrichMeshSession({ ...row, conversationId: common.conversationId, replicas }, overview);
      state.ui = window.UiContext.setDeviceLens(state.ui, 'all', { validAgentIds: overview.agents.map((item) => item.agentId) });
      state.ui = window.UiContext.setAgent(state.ui, agent.agentId, { slotKey: overview.localDeviceId + ':' + localSlot.profileId });
      state.ui = window.UiContext.setAgentScope(state.ui, 'current');
      state.ui = window.UiContext.clearConversationActions(state.ui);
      state.sessions = [row];
      state.query = '';
      document.querySelector('#searchInput').value = '';
      validateUiContext();
      validateSessionContext();
      applySessionFilter();
      focusSession(row);
      renderDeviceLens(overview);
      renderAccounts();
      renderAccountHeader();
      renderSessions();
      renderInspector();
      return { remoteId, conversationId: common.conversationId };
    })()`);
    let result = await client.evaluate(`({
      pickerHidden: document.querySelector('#sessionReplicaPicker').hidden,
      options: document.querySelectorAll('#sessionReplicaOptions input').length,
      copyDisabled: document.querySelector('#copySessionInfoBtn').disabled,
      sendDisabled: document.querySelector('#sendSessionInfoBtn').disabled,
      openDisabled: document.querySelector('#openSessionFileBtn').disabled,
      issue: document.querySelector('#sessionSelectionIssue').textContent.trim()
    })`);
    assert.deepEqual(
      { pickerHidden: result.pickerHidden, options: result.options, copyDisabled: result.copyDisabled, sendDisabled: result.sendDisabled, openDisabled: result.openDisabled },
      { pickerHidden: false, options: 2, copyDisabled: true, sendDisabled: true, openDisabled: true }
    );
    assert.ok(result.issue.length > 0);

    await client.evaluate(`document.querySelectorAll('#sessionReplicaOptions input')[1].click()`);
    result = await client.evaluate(`({
      selected: state.ui.selectedReplicaKeyByConversation['mesh::${injected.conversationId}'],
      copyDisabled: document.querySelector('#copySessionInfoBtn').disabled,
      sendDisabled: document.querySelector('#sendSessionInfoBtn').disabled,
      openDisabled: document.querySelector('#openSessionFileBtn').disabled,
      location: document.querySelector('#detailLocation').textContent
    })`);
    assert.equal(result.selected, 'acceptance-remote-replica');
    assert.equal(result.copyDisabled, false, 'an offline cached replica remains copyable');
    assert.equal(result.sendDisabled, false);
    assert.equal(result.openDisabled, true, 'an offline remote replica must not be revealed locally');
    assert.ok(result.location.length > 0);

    await client.evaluate(`document.querySelectorAll('#sessionReplicaOptions input')[0].click()`);
    result = await client.evaluate(`({
      copyDisabled: document.querySelector('#copySessionInfoBtn').disabled,
      openDisabled: document.querySelector('#openSessionFileBtn').disabled
    })`);
    assert.deepEqual(result, { copyDisabled: false, openDisabled: false });
    assert.ok(injected.remoteId);
  });
  await capture(client, artifactDir, '04-multi-replica-source');

  await run('SessionPointer, file, and history dialogs keep independent drafts', async () => {
    await client.evaluate(`document.querySelector('#sendSessionInfoBtn').click()`);
    await waitFor(client, `document.querySelector('#sessionSendDialog').open`, 'SessionPointer dialog');
    let snapshot = await dialogSnapshot(client, '#sessionSendDialog');
    assertDialogFits(snapshot);
    let draft = await client.evaluate(`state.ui.transferDraft`);
    assert.equal(draft.kind, 'session-pointer');
    assert.equal(draft.selections.length, 1);
    await client.evaluate(`document.querySelector('#sessionSendDialog').close()`);
    await waitFor(client, `state.ui.transferDraft === null`, 'SessionPointer draft cleanup');
    assert.equal(await client.evaluate(`state.ui.transferDraft`), null);

    await client.evaluate(`openFileSendDialog('acceptance-remote-device')`);
    await waitFor(client, `document.querySelector('#fileSendDialog').open`, 'file dialog');
    snapshot = await dialogSnapshot(client, '#fileSendDialog');
    assertDialogFits(snapshot);
    draft = await client.evaluate(`state.ui.transferDraft`);
    assert.equal(draft.kind, 'files');
    assert.deepEqual(draft.selections, []);
    await client.evaluate(`document.querySelector('#fileSendDialog').close()`);
    await waitFor(client, `state.ui.transferDraft === null`, 'file draft cleanup');
    assert.equal(await client.evaluate(`state.ui.transferDraft`), null);

    await client.evaluate(`openTransferCenter()`);
    await waitFor(client, `document.querySelector('#transferCenterDialog').open`, 'transfer history dialog');
    snapshot = await dialogSnapshot(client, '#transferCenterDialog');
    assertDialogFits(snapshot);
    assert.equal(await client.evaluate(`state.ui.transferDraft`), null);
    await client.evaluate(`document.querySelector('#transferCenterDialog').close()`);
  });

  await run('background remote viewing is textual, reopenable, and clears on disconnect', async () => {
    await client.evaluate(`(() => {
      state.mesh.remoteSessions = [{
        sessionId: 'acceptance-remote-session',
        deviceId: 'acceptance-remote-device',
        deviceName: 'Offline Windows Fixture',
        direction: 'outgoing',
        state: 'viewing',
        mode: 'view',
        controlState: 'idle'
      }];
      state.ui = window.UiContext.returnFromRemote(state.ui, 'acceptance-remote-session');
      renderRemoteActivity();
      renderTopbarContext();
    })()`);
    let indicator = await client.evaluate(`({
      hidden: document.querySelector('#remoteActivityBtn').hidden,
      text: document.querySelector('#remoteActivityBtn').textContent.trim(),
      label: document.querySelector('#remoteActivityBtn').getAttribute('aria-label'),
      workspace: state.ui.workspaceMode
    })`);
    assert.equal(indicator.hidden, false);
    assert.match(indicator.text, /1/);
    assert.ok(indicator.label?.length > 0, 'remote state cannot be color-only');
    assert.equal(indicator.workspace, 'sessions');

    await client.evaluate(`(() => {
      state.mesh.remoteSessions = [];
      state.ui = window.UiContext.disconnectRemote(state.ui, 'acceptance-remote-session', []);
      renderRemoteActivity();
      renderTopbarContext();
    })()`);
    indicator = await client.evaluate(`({
      hidden: document.querySelector('#remoteActivityBtn').hidden,
      active: state.ui.activeRemoteSessionId
    })`);
    assert.deepEqual(indicator, { hidden: true, active: null });
  });

  await run('revoked device detail clears every stale field', async () => {
    const result = await client.evaluate(`(() => {
      const overview = state.mesh.overview;
      state.ui = window.UiContext.selectDeviceDetail(state.ui, 'acceptance-remote-device');
      renderSelectedDeviceDetail(overview);
      renderMeshAgentList(overview);
      overview.devices = overview.devices.filter((item) => item.deviceId !== 'acceptance-remote-device');
      validateUiContext();
      renderSelectedDeviceDetail(overview);
      renderMeshAgentList(overview);
      return {
        detail: state.ui.selectedDeviceDetailId,
        kind: document.querySelector('#deviceDetailKind').textContent,
        status: document.querySelector('#deviceDetailStatus').textContent,
        stats: document.querySelector('#deviceDetailStats').children.length,
        actions: document.querySelector('#deviceDetailActions').children.length,
        agentMeta: document.querySelector('#agentCatalogMeta').textContent
      };
    })()`);
    assert.deepEqual(result, { detail: null, kind: '', status: '', stats: 0, actions: 0, agentMeta: '' });
  });

  await run('reduced-motion keeps critical state readable without animation', async () => {
    await client.call('Emulation.setEmulatedMedia', {
      media: '',
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
    });
    const reduced = await client.evaluate(`({
      matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      cardTransition: getComputedStyle(document.querySelector('.account-card')).transitionDuration,
      remoteAnimation: getComputedStyle(document.querySelector('#remoteActivityBtn'), '::before').animationName,
      deviceAnimation: getComputedStyle(document.querySelector('.device-online-dot')).animationName
    })`);
    assert.equal(reduced.matches, true);
    assert.equal(reduced.cardTransition, '0s');
    assert.equal(reduced.remoteAnimation, 'none');
    assert.equal(reduced.deviceAnimation, 'none');
  });

  const exceptions = client.events.filter((event) => event.method === 'Runtime.exceptionThrown');
  assert.deepEqual(exceptions, [], 'renderer must not emit uncaught exceptions during acceptance');
  return checks;
}

async function stopChild(child, childState) {
  if (childState.exited) return;
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 4_000))
  ]);
  if (!stopped && !childState.exited) child.kill('SIGKILL');
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-ui-acceptance-'));
  const userData = path.join(tempRoot, 'user-data');
  const artifactDir = process.env.AGENTDESK_UI_ACCEPTANCE_ARTIFACTS
    ? path.resolve(process.env.AGENTDESK_UI_ACCEPTANCE_ARTIFACTS)
    : null;
  const keepTemp = process.env.AGENTDESK_UI_ACCEPTANCE_KEEP_TEMP === '1';
  let child = null;
  let client = null;
  const childState = { exited: false, code: null };
  const output = [];

  try {
    seedUserData(userData);
    const port = await freePort();
    const electronPath = require('electron');
    assert.ok(fs.existsSync(electronPath), `Electron runtime not found: ${electronPath}`);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(electronPath, [
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      `--user-data-dir=${userData}`,
      APP_ROOT
    ], {
      cwd: APP_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (chunk) => output.push(String(chunk)));
    child.stderr.on('data', (chunk) => output.push(String(chunk)));
    child.once('exit', (code) => {
      childState.exited = true;
      childState.code = code;
    });

    const target = await waitForTarget(port, childState);
    process.stdout.write(`Renderer target: ${target.url}\n`);
    client = new DevToolsClient(target.webSocketDebuggerUrl);
    await client.connect();
    assert.equal(await client.evaluate('1 + 1'), 2, 'DevTools renderer evaluation handshake failed');
    const checks = await runAcceptance(client, artifactDir);
    const seriousLogs = output.join('').split(/\r?\n/).filter((line) => (
      /\[renderer-gone\]|Uncaught (TypeError|ReferenceError|Error)|FATAL:/i.test(line)
    ));
    assert.deepEqual(seriousLogs, [], `Electron emitted serious errors:\n${seriousLogs.join('\n')}`);
    assert.ok(fs.existsSync(path.join(userData, 'mesh.db')), 'Mesh acceptance must stay inside the disposable userData directory');
    process.stdout.write(`\nAgentDesk real-window acceptance passed (${checks.length} task paths).\n`);
    if (artifactDir) process.stdout.write(`Screenshots: ${artifactDir}\n`);
  } catch (error) {
    const recentOutput = output.join('').trim().split(/\r?\n/).slice(-30).join('\n');
    if (recentOutput) process.stderr.write(`\nElectron output (tail):\n${recentOutput}\n`);
    throw error;
  } finally {
    client?.close();
    if (child) await stopChild(child, childState);
    if (keepTemp) process.stdout.write(`Temporary userData kept at: ${userData}\n`);
    else fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`\nUI acceptance failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
