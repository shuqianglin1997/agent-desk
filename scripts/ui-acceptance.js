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
    const lens = rect('.topbar-lens');
    const actions = rect('.topbar-actions');
    const tableWrap = document.querySelector('#sessionPane .table-wrap');
    const sessionTable = document.querySelector('#sessionTable');
    return {
      outerWidth,
      outerHeight,
      innerWidth,
      innerHeight,
      shell: rect('.app-shell'),
      header: rect('.app-topbar'),
      main: rect('#mainGrid'),
      agent: rect('#agentPanel'),
      sessions: rect('#sessionPane'),
      detail: rect('#detailPanel'),
      status: rect('#statusBar'),
      rows: getComputedStyle(shell).gridTemplateRows.trim().split(/\\s+/),
      boardPanels: document.querySelectorAll('#mainGrid > .workspace-panel').length,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      bodyOverflow: document.body.scrollWidth - innerWidth,
      topbarOverlap: overlaps(brand, lens) || overlaps(lens, actions) || overlaps(brand, actions),
      brand: {
        rect: brand,
        display: getComputedStyle(document.querySelector('.topbar-brand')).display,
        visibility: getComputedStyle(document.querySelector('.topbar-brand')).visibility,
        opacity: getComputedStyle(document.querySelector('.topbar-brand')).opacity
      },
      compactTableOverflow: tableWrap && sessionTable?.dataset.mode === 'compact'
        ? Math.max(0, tableWrap.scrollWidth - tableWrap.clientWidth)
        : null,
      compactTableWidthOverflow: tableWrap && sessionTable?.dataset.mode === 'compact'
        ? Math.max(0, sessionTable.getBoundingClientRect().width - tableWrap.getBoundingClientRect().width)
        : null,
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
  assert.equal(layout.rows.length, 3, 'app-shell must contain Header, board, and Footer rows only');
  assert.equal(layout.boardPanels, 3, 'workspace board must contain exactly three fixed panels');
  assert.ok(Math.abs(layout.header.height - 58) <= 1, `Header must be 58px, got ${layout.header.height}px`);
  assert.ok(Math.abs(layout.status.height - 38) <= 1, `Footer must be 38px, got ${layout.status.height}px`);
  assert.ok(Math.abs(layout.agent.height - 244) <= 1, `Agent panel must be 244px, got ${layout.agent.height}px`);
  assert.ok(Math.abs(layout.detail.width - 316) <= 1, `Detail panel must be 316px, got ${layout.detail.width}px`);
  assert.ok(Math.abs(layout.sessions.width - 690) <= 2, `Session panel must be about 690px, got ${layout.sessions.width}px`);
  assert.ok(layout.agent.x <= layout.sessions.x + 1 && layout.agent.right >= layout.detail.right - 1, 'Agent panel must span the board');
  assert.ok(layout.sessions.y >= layout.agent.bottom + 8, 'sessions must stay below the Agent panel');
  assert.ok(layout.detail.y >= layout.agent.bottom + 8, 'detail must stay below the Agent panel');
  assert.ok(layout.sessions.right <= layout.detail.x - 8, 'sessions and detail must remain separate lower panels');
  assert.ok(layout.status.y >= layout.main.bottom - 1, 'Footer must remain below the board');
  assert.ok(layout.documentOverflow <= 1 && layout.bodyOverflow <= 1, 'the fixed shell must not overflow horizontally');
  if (layout.compactTableOverflow !== null) {
    assert.ok(layout.compactTableOverflow <= 1, `Compact table must not scroll horizontally, overflow ${layout.compactTableOverflow}px`);
    assert.ok(layout.compactTableWidthOverflow <= 1, `Compact table must fit its panel, overflow ${layout.compactTableWidthOverflow}px`);
  }
  assert.ok(layout.brand.rect?.width > 100 && layout.brand.rect?.height > 24, 'the AgentDesk brand must remain visible in every view');
  assert.notEqual(layout.brand.display, 'none');
  assert.equal(layout.brand.visibility, 'visible');
  assert.equal(layout.brand.opacity, '1');
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

  await run('1040×840 Header / three-panel board / Footer shell', async () => {
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
    const placement = await client.evaluate(`({
      detailOwnsActions: document.querySelector('#sessionInspector').contains(document.querySelector('#sessionSelectionBar')),
      footerOwnsActions: document.querySelector('#statusBar').contains(document.querySelector('#sessionSelectionBar')),
      footerHasGlobalState: ['ledgerDone', 'ledgerMin', 'reminderToggle'].every(id => document.querySelector('#statusBar').contains(document.getElementById(id))),
      yardLedger: Boolean(document.querySelector('#yardLedger')),
      dockHidden: document.querySelector('#sessionActionDock').hidden
    })`);
    assert.deepEqual(placement, {
      detailOwnsActions: true,
      footerOwnsActions: false,
      footerHasGlobalState: true,
      yardLedger: false,
      dockHidden: true
    });
  });
  await capture(client, artifactDir, '01-local-zh-light');

  await run('focus, explicit check, hidden selection, and clear lifecycle', async () => {
    await client.evaluate(`document.querySelectorAll('#sessionRows tr:not(.empty-row)')[0].click()`);
    const focused = await client.evaluate(`state.ui.focusedConversationId`);
    assert.ok(focused);
    let action = await client.evaluate(`({
      checked: state.ui.checkedConversationIds.size,
      dockHidden: document.querySelector('#sessionActionDock').hidden,
      barHidden: document.querySelector('#sessionSelectionBar').hidden,
      focusedActionsHidden: document.querySelector('#sessionFocusedActions').hidden,
      copyDisabled: document.querySelector('#copySessionInfoBtn').disabled
    })`);
    assert.deepEqual(action, { checked: 0, dockHidden: false, barHidden: false, focusedActionsHidden: false, copyDisabled: false });

    await client.evaluate(`document.querySelectorAll('#sessionRows .session-select-box')[1].click()`);
    action = await client.evaluate(`({
      focused: state.ui.focusedConversationId,
      checked: state.ui.checkedConversationIds.size,
      actionIds: window.UiContext.actionConversationIds(state.ui).length,
      focusedActionsHidden: document.querySelector('#sessionFocusedActions').hidden
    })`);
    assert.equal(action.focused, focused, 'checking another row must not steal focus');
    assert.equal(action.checked, 1);
    assert.equal(action.actionIds, 1, 'checked rows become the explicit batch action set');
    assert.equal(action.focusedActionsHidden, true, 'explicit batch actions must hide focused-session-only actions');

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
      barHidden: document.querySelector('#sessionSelectionBar').hidden,
      dockHidden: document.querySelector('#sessionActionDock').hidden
    })`);
    assert.deepEqual(action, { focused: null, checked: 0, barHidden: true, dockHidden: true });
    await client.evaluate(`(() => {
      const input = document.querySelector('#searchInput');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  });

  await run('yard/cards share state; scene popover uses Top Layer; Agent management is an object Dialog', async () => {
    await client.evaluate(`document.querySelector('#viewToggle').click()`);
    assert.equal((await layoutSnapshot(client)).bodyView, 'yard');
    let mode = await client.evaluate(`({
      yardPressed: document.querySelector('#viewToggle').getAttribute('aria-pressed'),
      cardsPressed: document.querySelector('#classicViewBtn').getAttribute('aria-pressed'),
      runtimeVisible: !document.querySelector('#formSwitcher').hidden,
      runtimeText: document.querySelector('#formSelect').selectedOptions[0]?.textContent || ''
    })`);
    assert.deepEqual({ yardPressed: mode.yardPressed, cardsPressed: mode.cardsPressed }, { yardPressed: 'true', cardsPressed: 'false' });
    assert.equal(mode.runtimeVisible, true, 'current runtime must remain visible for the selected Agent');
    assert.ok(mode.runtimeText.length > 0, 'current runtime must have an explicit label');
    await capture(client, artifactDir, '02-yard');

    await client.evaluate(`document.querySelector('#atmosSceneBtn').click()`);
    await waitFor(client, `document.querySelector('#atmosPopover').matches(':popover-open')`, 'yard scene Top Layer popover');
    const popover = await client.evaluate(`(() => {
      const node = document.querySelector('#atmosPopover');
      const rect = node.getBoundingClientRect();
      return {
        native: node.getAttribute('popover'),
        open: node.matches(':popover-open'),
        rect: { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom },
        viewport: { width: innerWidth, height: innerHeight },
        timeItems: document.querySelectorAll('#atmosTime button').length,
        weatherItems: document.querySelectorAll('#atmosWeather button').length
      };
    })()`);
    assert.equal(popover.native, 'auto');
    assert.equal(popover.open, true);
    assert.equal(popover.timeItems, 4);
    assert.equal(popover.weatherItems, 5);
    assert.ok(popover.rect.x >= 0 && popover.rect.y >= 0 && popover.rect.right <= popover.viewport.width && popover.rect.bottom <= popover.viewport.height);
    await new Promise((resolve) => setTimeout(resolve, 180));
    await capture(client, artifactDir, '03-yard-scene-popover');
    await client.evaluate(`document.querySelector('#atmosPopover').hidePopover()`);

    await client.evaluate(`document.querySelector('#accountManage').click()`);
    await waitFor(client, `document.querySelector('#agentManageDialog').open`, 'Agent management dialog');
    const agentDialog = await dialogSnapshot(client, '#agentManageDialog');
    assertDialogFits(agentDialog, { noScroll: true });
    assert.equal(agentDialog.modal, true);
    const sections = await client.evaluate(`({
      globalActions: document.querySelectorAll('#agentGlobalActions > button').length,
      runtimeActions: document.querySelectorAll('#yardManageActions > button').length,
      summary: document.querySelector('#agentManageSummary').textContent.trim(),
      runtime: document.querySelector('#agentManageRuntimeLabel').textContent.trim()
    })`);
    assert.deepEqual({ globalActions: sections.globalActions, runtimeActions: sections.runtimeActions }, { globalActions: 3, runtimeActions: 4 });
    assert.ok(sections.summary.length > 0 && sections.runtime.length > 0);
    await capture(client, artifactDir, '04-agent-manage-dialog');
    await client.evaluate(`document.querySelector('#agentManageDialog').close()`);

    await client.evaluate(`document.querySelector('#classicViewBtn').click()`);
    assert.equal((await layoutSnapshot(client)).bodyView, 'classic');
    mode = await client.evaluate(`({
      yardPressed: document.querySelector('#viewToggle').getAttribute('aria-pressed'),
      cardsPressed: document.querySelector('#classicViewBtn').getAttribute('aria-pressed')
    })`);
    assert.deepEqual(mode, { yardPressed: 'false', cardsPressed: 'true' });
  });

  await run('light/dark and zh/en/ja preserve the approved geometry', async () => {
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
  await capture(client, artifactDir, '05-local-ja-dark');

  await run('pure-local add dialog fits without changing data', async () => {
    await client.evaluate(`openProfileCreationDialog()`);
    const snapshot = await dialogSnapshot(client, '#profileDialog');
    assertDialogFits(snapshot);
    assert.equal(snapshot.activeId, 'newProfileName');
    await client.evaluate(`document.querySelector('#profileDialog').close()`);
  });

  await run('Header opens tools, activity, and settings as independent modals without mutating the workspace', async () => {
    const baseline = await client.evaluate(`(() => {
      const pick = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        geometry: { agent: pick('#agentPanel'), sessions: pick('#sessionPane'), detail: pick('#detailPanel') },
        workspace: state.ui.workspaceMode,
        detailMode: state.detailMode,
        lens: state.ui.selectedDeviceLensId,
        scope: state.ui.agentScope,
        agent: currentAgentId(),
        slot: currentSlotKey(),
        focused: state.ui.focusedConversationId,
        checked: [...state.ui.checkedConversationIds]
      };
    })()`);
    assert.equal(await client.evaluate(`document.querySelector('#globalMoreMenu')`), null);

    for (const [button, kind, dialog] of [
      ['#toolCenterBtn', 'tools', '#toolCenterDialog'],
      ['#activityCenterBtn', 'activity', '#activityCenterDialog'],
      ['#settingsBtn', 'settings', '#settingsDialog']
    ]) {
      await client.evaluate(`document.querySelector(${JSON.stringify(button)}).click()`);
      await waitFor(client, `state.utilityDialog === ${JSON.stringify(kind)} && document.querySelector(${JSON.stringify(dialog)}).open`, `${kind} modal`);
      const snapshot = await dialogSnapshot(client, dialog);
      assertDialogFits(snapshot);
      assert.equal(snapshot.modal, true, `${kind} must be a modal dialog`);
      const current = await client.evaluate(`(() => {
        const pick = (selector) => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        };
        return {
          geometry: { agent: pick('#agentPanel'), sessions: pick('#sessionPane'), detail: pick('#detailPanel') },
          workspace: state.ui.workspaceMode,
          detailMode: state.detailMode,
          lens: state.ui.selectedDeviceLensId,
          scope: state.ui.agentScope,
          agent: currentAgentId(),
          slot: currentSlotKey(),
          focused: state.ui.focusedConversationId,
          checked: [...state.ui.checkedConversationIds]
        };
      })()`);
      assert.deepEqual(current, baseline, `${kind} must not mutate or move the underlying workspace`);
      await capture(client, artifactDir, `06-${kind}-dialog`);
      await client.evaluate(`document.querySelector(${JSON.stringify(dialog)}).close()`);
      await waitFor(client, `state.utilityDialog === null && !document.querySelector(${JSON.stringify(dialog)}).open`, `${kind} modal close`);
    }

    await client.evaluate(`document.querySelector('#quotaChipSelf').click()`);
    await waitFor(client, `state.detailMode === 'quota' && !document.querySelector('#detailSurfaceQuota').hidden`, 'quota detail');
    const quotaGeometry = await client.evaluate(`(() => {
      const pick = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return { agent: pick('#agentPanel'), sessions: pick('#sessionPane'), detail: pick('#detailPanel') };
    })()`);
    assert.deepEqual(quotaGeometry, baseline.geometry, 'quota must not insert a new row');
    await client.evaluate(`setWorkspaceMode('sessions')`);
  });

  await run('modal Device Center preserves the underlying workspace during isolated Mesh initialization', async () => {
    const baseline = await client.evaluate(`({
      workspace: state.ui.workspaceMode,
      detailMode: state.detailMode,
      lens: state.ui.selectedDeviceLensId,
      scope: state.ui.agentScope,
      agent: currentAgentId(),
      slot: currentSlotKey(),
      focused: state.ui.focusedConversationId,
      checked: [...state.ui.checkedConversationIds]
    })`);
    await client.evaluate(`(() => {
      window.I18N.setLang('zh');
      rerenderLocalizedText();
      if (document.documentElement.dataset.theme === 'dark') document.querySelector('#themeToggle').click();
      document.querySelector('#deviceCenterBtn').click();
    })()`);
    await waitFor(
      client,
      `state.utilityDialog === 'devices' && document.querySelector('#deviceCenterDialog').open && state.mesh.loading === false`,
      'Device Center inventory'
    );
    let snapshot = await dialogSnapshot(client, '#deviceCenterDialog');
    assertDialogFits(snapshot);
    assert.equal(snapshot.modal, true, 'Device Center must use showModal()');
    const underlying = await client.evaluate(`({
      workspace: state.ui.workspaceMode,
      detailMode: state.detailMode,
      lens: state.ui.selectedDeviceLensId,
      scope: state.ui.agentScope,
      agent: currentAgentId(),
      slot: currentSlotKey(),
      focused: state.ui.focusedConversationId,
      checked: [...state.ui.checkedConversationIds]
    })`);
    assert.deepEqual(underlying, baseline, 'opening Device Center must not change the underlying workspace');

    const initializeGate = await client.evaluate(`(() => {
      const button = document.querySelector('#initializeMeshBtn');
      const emptyState = document.querySelector('#meshEmptyState');
      return {
        buttonDisabled: button.disabled,
        buttonHidden: button.hidden,
        emptyStateHidden: emptyState.hidden,
        loading: state.mesh.loading,
        initialized: state.mesh.overview?.initialized === true,
        storageIncomplete: state.mesh.overview?.storageIncomplete === true,
        keyState: state.mesh.overview?.keyState || null,
        initializeApi: typeof window.manager.initializeMesh
      };
    })()`);
    assert.equal(initializeGate.initializeApi, 'function', `Mesh initialize API unavailable: ${JSON.stringify(initializeGate)}`);
    assert.equal(initializeGate.buttonDisabled, false, `Mesh initialize button unexpectedly gated: ${JSON.stringify(initializeGate)}`);
    assert.equal(initializeGate.emptyStateHidden, false, `Mesh empty state unexpectedly hidden: ${JSON.stringify(initializeGate)}`);

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
    assertDialogFits(snapshot);
  });
  await capture(client, artifactDir, '07-devices-dialog');

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
    await waitFor(client, `state.utilityDialog === 'devices' && document.querySelector('#deviceCenterDialog').open`, 'Device Center re-entry');
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
  await capture(client, artifactDir, '08-multi-replica-source');

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
