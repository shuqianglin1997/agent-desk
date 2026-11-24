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
  const extraRoots = Array.from({ length: 5 }, (_, index) => (
    path.join(userData, 'fixtures', `extra-${index + 1}`)
  ));
  for (const root of [...Object.values(roots), ...extraRoots]) fs.mkdirSync(root, { recursive: true });

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
  const extraNames = [
    'Research Agent With A Deliberately Long Name',
    '制作素材 Agent',
    '日本語テストエージェント',
    'Review Agent',
    'Archive Agent'
  ];
  for (let index = 0; index < extraNames.length; index += 1) {
    profiles.push({
      id: `acceptance-extra-${index + 1}`,
      appId: 'codex',
      name: extraNames[index],
      group: index % 2 === 0 ? 'Extended fixture' : '',
      note: 'Horizontal roster geometry fixture',
      identityKey: `acceptance-extra-login-${index + 1}`,
      profilePath: path.join(userData, 'profiles', `extra-${index + 1}`),
      sessionRoot: extraRoots[index],
      profilePathMode: 'custom',
      sessionRootMode: 'custom',
      isProtected: false,
      createdAt: `2026-08-12T01:${String(index + 3).padStart(2, '0')}:00.000Z`
    });
  }
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
      view: 'yard', // Old preferences still boot into the card workspace.
      lang: 'zh',
      sessionScope: 'current',
      sessionView: 'compact',
      remindersOn: false,
      atmosTime: 'day',
      atmosWeather: 'clear',
      welcomed: true,
      onboarding: {
        completedVersion: 1,
        completedAt: '2026-08-14T00:00:00.000Z'
      },
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
  const debug = await client.evaluate(`({ active: document.activeElement?.id, hidden: document.hidden, dialogs: [...document.querySelectorAll('dialog[open]')].map(d => d.id), utility: typeof state === 'undefined' ? null : state.utilityDialog, startup: typeof state === 'undefined' ? null : state.startupStage, firstUse: typeof state === 'undefined' ? null : state.firstUse.model?.phase, status: document.querySelector('#statusText')?.textContent })`);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(debug)}`);
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
      lens,
      lensControl: rect('#deviceLensButton'),
      topbarOverlap: [brand, lens, actions].some((left, index, targets) =>
        targets.slice(index + 1).some((right) => overlaps(left, right))),
      brand: {
        rect: brand,
        display: getComputedStyle(document.querySelector('.topbar-brand')).display,
        visibility: getComputedStyle(document.querySelector('.topbar-brand')).visibility,
        opacity: getComputedStyle(document.querySelector('.topbar-brand')).opacity
      },
      compactTableOverflow: tableWrap && sessionTable?.dataset.mode === 'compact'
        ? Math.max(0, tableWrap.scrollWidth - tableWrap.clientWidth)
        : null,
      // 出问题时说明是谁撑出去的，免得只看到一个数字。
      compactTableDebug: tableWrap ? (() => {
        const frame = tableWrap.getBoundingClientRect();
        const limit = frame.left + tableWrap.clientWidth + 0.5;
        return {
          client: tableWrap.clientWidth,
          scroll: tableWrap.scrollWidth,
          table: Math.round(sessionTable?.getBoundingClientRect().width || 0),
          rows: document.querySelectorAll('#sessionRows tr').length,
          beyond: [...tableWrap.querySelectorAll('*')]
            .filter((node) => { const box = node.getBoundingClientRect(); return box.width > 0 && box.right > limit; })
            .slice(0, 5)
            .map((node) => node.tagName + '.' + (node.id || String(node.className).slice(0, 28)) + '@' + Math.round(node.getBoundingClientRect().right - frame.left))
        };
      })() : null,
      compactTableWidthOverflow: tableWrap && sessionTable?.dataset.mode === 'compact'
        ? Math.max(0, sessionTable.getBoundingClientRect().width - tableWrap.getBoundingClientRect().width)
        : null,
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
  assert.ok(Math.abs(layout.agent.height - 222) <= 1, `Agent panel must be 222px, got ${layout.agent.height}px`);
  // 会话面板的边画在盒子外侧，所以盒子本身比 Agent 区缩进一条边的宽度（不超过 2px），看上去是对齐的。
  assert.ok(Math.abs(layout.agent.x - layout.sessions.x) <= 2, 'Agent and session panels must align');
  assert.ok(layout.sessions.y >= layout.agent.bottom + 8, 'sessions must stay below the Agent panel');
  if (layout.detail.width) {
    assert.ok(Math.abs(layout.detail.width - 316) <= 1, `Detail panel must be 316px, got ${layout.detail.width}px`);
    assert.ok(layout.sessions.right <= layout.detail.x - 8, 'the active side surface must fit next to the list');
    assert.ok(Math.abs(layout.detail.y - layout.sessions.y) <= 1, 'lower panels must align');
  } else {
    assert.ok(Math.abs(layout.sessions.width - layout.agent.width) <= 4, 'sessions must fill the lower board');
  }
  assert.ok(layout.status.y >= layout.main.bottom - 1, 'Footer must remain below the board');
  assert.ok(layout.documentOverflow <= 1 && layout.bodyOverflow <= 1, 'the fixed shell must not overflow horizontally');
  if (layout.compactTableOverflow !== null) {
    assert.ok(layout.compactTableOverflow <= 1, `Compact table must not scroll horizontally, overflow ${layout.compactTableOverflow}px ${JSON.stringify(layout.compactTableDebug)}`);
    assert.ok(layout.compactTableWidthOverflow <= 1, `Compact table must fit its panel, overflow ${layout.compactTableWidthOverflow}px`);
  }
  assert.ok(layout.brand.rect?.width > 45 && layout.brand.rect?.height > 15, 'the text-only AgentDesk title must remain visible');
  assert.notEqual(layout.brand.display, 'none');
  assert.equal(layout.brand.visibility, 'visible');
  assert.equal(layout.brand.opacity, '1');
  assert.equal(layout.topbarOverlap, false, 'topbar regions must not overlap');
  assert.ok(Math.abs(layout.lens.x + layout.lens.width / 2 - (layout.innerWidth / 2 - 25)) <= 1,
    'device view must stay at its original window position');
  if (layout.lensControl.width) {
    assert.equal(layout.lensControl.width, 216);
    assert.equal(layout.lensControl.height, 34);
  }
}

async function accountRosterSnapshot(client) {
  return client.evaluate(`(() => {
    const rectOf = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const contains = (outer, inner) => Boolean(outer && inner
      && inner.x >= outer.x - 1
      && inner.y >= outer.y - 1
      && inner.right <= outer.right + 1
      && inner.bottom <= outer.bottom + 1);
    const rosterNode = document.querySelector('#accountRoster');
    const roster = rectOf(rosterNode);
    const presenter = rectOf(document.querySelector('.agent-panel .presenter'));
    const cards = [...rosterNode.querySelectorAll('.account-card')]
      .filter((card) => !card.hidden)
      .map((card) => {
      const cardRect = rectOf(card);
      const select = rectOf(card.querySelector('.account-card-select'));
      const avatar = rectOf(card.querySelector('.account-card-avatar'));
      // 猫会跳、会从台面下蹦上来；判断上下顺序用它固定的站位，不用动画中的猫。
      const pit = rectOf(card.querySelector('.account-card-pit'));
      const name = rectOf(card.querySelector('.account-card-name'));
      const state = rectOf(card.querySelector('.account-card-state'));
      const quotaSummary = rectOf(card.querySelector('.account-card-quota-summary'));
      const quota = rectOf(card.querySelector('.account-card-quota'));
      const runtime = rectOf(card.querySelector('.account-card-runtime'));
      const actions = rectOf(card.querySelector('.account-card-actions'));
      const style = getComputedStyle(card);
      return {
        selected: card.classList.contains('selected'),
        label: card.querySelector('.account-card-name')?.textContent.trim() || '',
        rect: cardRect,
        display: style.display,
        computedHeight: style.height,
        whiteSpace: style.whiteSpace,
        select,
        avatar,
        name,
        state,
        stateActivity: card.querySelector('.account-card-state')?.dataset.activity || '',
        quotaSummary,
        quota,
        quotaTrusted: card.querySelector('.account-card-quota')?.dataset.trusted || '',
        // 猫允许跳出卡片上沿，所以只检查文字与控件留在卡片内。
        childrenInside: [name, state, quotaSummary, runtime, actions].every((item) => contains(cardRect, item)),
        selectChildrenInside: [name, state].every((item) => contains(select, item)),
        verticalOrder: pit.bottom <= name.y + 1 && name.bottom <= state.y + 1
          && state.bottom <= quotaSummary.y + 1 && quotaSummary.bottom <= runtime.y + 1
          && runtime.bottom <= actions.y + 1,
        quotaInside: contains(quotaSummary, quota),
        selectTitle: card.querySelector('.account-card-select')?.title || '',
        quotaLabel: card.querySelector('.account-card-quota-summary')?.getAttribute('aria-label')
          || card.querySelector('.account-card-quota-summary')?.title
          || card.querySelector('.account-card-quota-summary')?.textContent.trim() || ''
      };
    });
    const selected = cards.find((card) => card.selected) || null;
    const rosterStyle = getComputedStyle(rosterNode);
    // 搁板：从“全部”到名册里看得见的最后一张，相邻两截木板之间没有缝，且在同一高度（名册里的按名册边缘裁剪）。
    const allLedge = rectOf(document.querySelector('#rosterAllCard:not([hidden]) .account-card-ledge'));
    const shelf = (allLedge ? [allLedge] : []).concat([...rosterNode.querySelectorAll('.account-card')]
      .filter((card) => !card.hidden)
      .map((card) => rectOf(card.querySelector('.account-card-ledge')))
      .map((rect) => ({ x: Math.max(rect.x, roster.x), right: Math.min(rect.right, roster.right), y: rect.y }))
      .filter((rect) => rect.right > rect.x));
    return {
      roster,
      presenter,
      shelfGaps: shelf.slice(1).map((rect, index) => Math.round(rect.x - shelf[index].right)),
      shelfTops: [...new Set(shelf.map((rect) => Math.round(rect.y)))],
      overflowX: rosterStyle.overflowX,
      scrollbarGutter: rosterStyle.scrollbarGutter,
      scrollbarWidth: rosterStyle.scrollbarWidth,
      clientWidth: rosterNode.clientWidth,
      scrollWidth: rosterNode.scrollWidth,
      scrollLeft: rosterNode.scrollLeft,
      cards,
      selectedVisible: Boolean(selected
        && selected.rect.x >= roster.x - 1
        && selected.rect.right <= roster.right + 1)
    };
  })()`);
}

function assertAccountRosterGeometry(snapshot, options = {}) {
  const minimumCards = options.minimumCards ?? 7;
  const requireOverflow = options.requireOverflow !== false;
  assert.ok(snapshot.cards.length >= minimumCards, `geometry fixture must render at least ${minimumCards} Agent cards, got ${snapshot.cards.length}`);
  assert.equal(snapshot.overflowX, 'auto', 'the Agent roster must own one explicit horizontal scroller');
  // 名册不显示滚动条（滚轮、拖动和键盘都能横向浏览），所以不会因为滚动条出现而跳动；显示滚动条时才要求预留位置。
  assert.ok(
    snapshot.scrollbarWidth === 'none' || /stable/.test(snapshot.scrollbarGutter),
    'the roster must either hide its scrollbar or reserve a stable gutter'
  );
  if (requireOverflow) {
    assert.ok(snapshot.scrollWidth > snapshot.clientWidth + 100, '7+ Agent cards must overflow into the roster scroller');
  } else {
    assert.ok(snapshot.scrollWidth <= snapshot.clientWidth + 1, 'a small Agent set must not create horizontal overflow');
  }
  // 名册向右多伸出一段，让最后一张卡片的边和跳起来的猫不被裁掉。
  assert.ok(Math.abs(snapshot.roster.right - snapshot.presenter.right) <= 12, 'the card roster must fill the presenter width');
  assert.equal(snapshot.selectedVisible, true, 'the selected Agent card must be fully visible inside the roster scrollport');
  assert.ok(snapshot.shelfGaps.length >= 1 && snapshot.shelfGaps.every((gap) => gap === 0), `the cats must sit on one unbroken shelf: ${JSON.stringify(snapshot.shelfGaps)}`);
  assert.equal(snapshot.shelfTops.length, 1, `every shelf piece must sit at the same height: ${JSON.stringify(snapshot.shelfTops)}`);
  for (const [index, card] of snapshot.cards.entries()) {
    assert.ok(card.rect.width >= 179 && card.rect.width <= 181, `Agent card ${index + 1} must remain 180px wide, got ${card.rect.width}px`);
    assert.equal(card.display, 'grid', `Agent card ${index + 1} must use a card grid`);
    assert.notEqual(card.computedHeight, '32px', `Agent card ${index + 1} must leave room for the card controls`);
    assert.equal(card.whiteSpace, 'normal', `Agent card ${index + 1} must restore card text wrapping rules`);
    assert.ok(card.rect.height >= 90, `Agent card ${index + 1} is flattened to ${card.rect.height}px`);
    assert.ok(card.rect.height <= snapshot.roster.height + 1, `Agent card ${index + 1} escapes the roster vertically`);
    assert.equal(card.childrenInside, true, `Agent card ${index + 1} has content outside its border box`);
    assert.equal(card.selectChildrenInside, true, `Agent card ${index + 1} has name/state outside its select button`);
    assert.equal(card.verticalOrder, true, `Agent card ${index + 1} rows overlap vertically`);
    assert.equal(card.quotaInside, true, `Agent card ${index + 1} energy pips escape their button`);
    assert.ok(card.selectTitle.length > 0, `Agent card ${index + 1} must expose recent activity and positions in its tooltip`);
    assert.ok(card.quotaLabel.length > 0, `Agent card ${index + 1} must expose a quota fact`);
    assert.match(card.stateActivity, /^(working|onduty|arriving|confused|play|rest|nap|hibernate|unknown|ready|absent|planning|preparing|verifying|waiting-install|waiting-login|error|unsupported|offline|retired)$/);
    assert.match(card.quotaTrusted, /^(true|false)$/);
    if (index > 0) {
      assert.ok(snapshot.cards[index - 1].rect.right <= card.rect.x + 0.5, `Agent cards ${index} and ${index + 1} overlap`);
    }
  }
}

// 档案夹弹窗打开时有 144ms 的三档抽出动画，位移会算进 getBoundingClientRect；量弹窗几何之前先等它落定。
async function settleDialogMotion(client) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const settled = await client.evaluate(`[...document.querySelectorAll('dialog')].every((dialog) => dialog.getAnimations().every((animation) => animation.playState !== 'running'))`);
    if (settled) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function dialogSnapshot(client, selector) {
  await settleDialogMotion(client);
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

async function utilityDialogShellSnapshot(client, selector) {
  await settleDialogMotion(client);
  return client.evaluate(`(() => {
    const dialog = document.querySelector(${JSON.stringify(selector)});
    const shell = dialog.querySelector('.utility-dialog-shell');
    const header = shell?.querySelector('.utility-dialog-header');
    const commandbar = shell?.querySelector('.utility-dialog-commandbar');
    const content = shell?.querySelector('.utility-dialog-content');
    const footer = shell?.querySelector('.utility-dialog-footer');
    const close = header?.querySelector('.utility-dialog-close');
    const rectOf = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const styleOf = (node) => node ? getComputedStyle(node) : null;
    const shellStyle = styleOf(shell);
    const contentStyle = styleOf(content);
    return {
      shell: rectOf(shell),
      header: rectOf(header),
      commandbar: rectOf(commandbar),
      content: rectOf(content),
      footer: rectOf(footer),
      close: rectOf(close),
      shellOverflowY: shellStyle?.overflowY || '',
      shellScrollTop: shell?.scrollTop || 0,
      shellClientHeight: shell?.clientHeight || 0,
      shellScrollHeight: shell?.scrollHeight || 0,
      contentOverflowY: contentStyle?.overflowY || '',
      contentScrollTop: content?.scrollTop || 0,
      contentClientHeight: content?.clientHeight || 0,
      contentScrollHeight: content?.scrollHeight || 0,
      // 弹窗跟着内容长高：加进长内容以后、滚动之前量到的位置，才是“滚动时不许动”的基准。
      settled: dialog.__acceptanceSettledRects || null
    };
  })()`);
}

function assertRectStable(before, after, key) {
  if (!before[key] && !after[key]) return;
  assert.ok(before[key] && after[key], `${key} must remain mounted while content scrolls`);
  // 内容变长时弹窗会先长到窗口允许的高度；固定区是否稳定，要拿长高以后、滚动之前的位置来比。
  const base = after.settled?.[key] || before[key];
  for (const field of ['x', 'y', 'right', 'bottom', 'width', 'height']) {
    assert.ok(
      Math.abs(base[field] - after[key][field]) <= 0.5,
      `${key}.${field} moved while content scrolled: ${base[field]} -> ${after[key][field]}`
    );
  }
}

async function forceUtilityContentScroll(client, selector) {
  await settleDialogMotion(client);
  await client.evaluate(`(() => {
    const content = document.querySelector(${JSON.stringify(selector)})?.querySelector('.utility-dialog-content');
    if (!content) throw new Error('utility content not found');
    const fixture = document.createElement('div');
    fixture.dataset.acceptanceScrollFixture = 'true';
    fixture.style.cssText = 'height:1200px;min-height:1200px;pointer-events:none;visibility:hidden;';
    content.append(fixture);
    const dialog = document.querySelector(${JSON.stringify(selector)});
    const shell = dialog.querySelector('.utility-dialog-shell');
    const rectOf = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const header = shell?.querySelector('.utility-dialog-header');
    dialog.__acceptanceSettledRects = {
      header: rectOf(header),
      commandbar: rectOf(shell?.querySelector('.utility-dialog-commandbar')),
      footer: rectOf(shell?.querySelector('.utility-dialog-footer')),
      close: rectOf(header?.querySelector('.utility-dialog-close'))
    };
    content.scrollTop = content.scrollHeight;
  })()`);
}

async function clearUtilityContentScrollFixture(client, selector) {
  await client.evaluate(`(() => {
    const dialog = document.querySelector(${JSON.stringify(selector)});
    dialog?.querySelector('[data-acceptance-scroll-fixture]')?.remove();
    if (dialog) delete dialog.__acceptanceSettledRects;
    const content = dialog?.querySelector('.utility-dialog-content');
    if (content) content.scrollTop = 0;
  })()`);
}

async function pressEscape(client) {
  const key = {
    key: 'Escape',
    code: 'Escape',
    windowsVirtualKeyCode: 27,
    nativeVirtualKeyCode: 27
  };
  await client.call('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
  await client.call('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  // Let Chromium finish the native <dialog> cancel/close default action before
  // the next CDP evaluate call. Querying immediately can preempt that task and
  // make a real Escape close look flaky in the acceptance harness.
  await new Promise((resolve) => setTimeout(resolve, 100));
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
      && state.startupStage === 'ready'
      && state.profiles.length === 8
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
    assert.equal(initial.profiles, 8);
    assert.equal(initial.focused, null, 'initial render must not auto-focus a session');
    assert.equal(initial.checked, 0, 'initial render must not auto-check a session');
    assert.equal(initial.workspace, 'sessions');
    assert.equal(initial.mesh, false);
    const placement = await client.evaluate(`({
      toolbarOwnsActions: document.querySelector('.session-toolbar').contains(document.querySelector('#sessionActionDock')),
      footerOwnsActions: document.querySelector('#statusBar').contains(document.querySelector('#sessionSelectionBar')),
      footerHasGlobalState: document.querySelector('#statusBar').contains(document.getElementById('statusText')) && !document.querySelector('#ledgerDone, #ledgerMin, #reminderToggle'),
      yardLedger: Boolean(document.querySelector('#yardLedger')),
      buttonsDisabled: [...document.querySelectorAll('#sessionActionDock > button')].every(button => button.disabled)
    })`);
    assert.deepEqual(placement, {
      toolbarOwnsActions: true,
      footerOwnsActions: false,
      footerHasGlobalState: true,
      yardLedger: false,
      buttonsDisabled: true
    });
  });
  await capture(client, artifactDir, '01-local-zh-light');

  await run('focus, explicit check, hidden selection, and clear lifecycle', async () => {
    await client.evaluate(`document.querySelectorAll('#sessionRows tr:not(.empty-row)')[0].click()`);
    const focused = await client.evaluate(`state.ui.focusedConversationId`);
    assert.ok(focused);
    let action = await client.evaluate(`({
      checked: state.ui.checkedConversationIds.size,
      barHidden: document.querySelector('#sessionSelectionBar').hidden,
      copyDisabled: document.querySelector('#copySessionInfoBtn').disabled,
      openDisabled: document.querySelector('#openSessionFileBtn').disabled
    })`);
    assert.deepEqual(action, { checked: 0, barHidden: false, copyDisabled: false, openDisabled: false });

    await client.evaluate(`document.querySelectorAll('#sessionRows .session-select-box')[1].click()`);
    action = await client.evaluate(`({
      focused: state.ui.focusedConversationId,
      checked: state.ui.checkedConversationIds.size,
      actionIds: window.UiContext.actionConversationIds(state.ui).length,
      openDisabled: document.querySelector('#openSessionFileBtn').disabled
    })`);
    assert.equal(action.focused, focused, 'checking another row must not steal focus');
    assert.equal(action.checked, 1);
    assert.equal(action.actionIds, 1, 'checked rows become the explicit batch action set');
    assert.equal(action.openDisabled, false, 'explicit selection also enables local directory actions');

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
      buttonsDisabled: [...document.querySelectorAll('#sessionActionDock > button')].every(button => button.disabled)
    })`);
    assert.deepEqual(action, { focused: null, checked: 0, barHidden: true, buttonsDisabled: true });
    await client.evaluate(`(() => {
      const input = document.querySelector('#searchInput');
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
  });

  await run('TaskPackage export and receive keep fixed transaction controls around one scrolling content owner', async () => {
    await client.evaluate(`document.querySelectorAll('#sessionRows tr:not(.empty-row)')[0].click()`);
    assert.equal(
      await client.evaluate(`Boolean(document.querySelector('#sessionSendMenu #taskPackageActionBtn') && document.querySelector('#sessionSendMenu #sendSessionInfoBtn'))`),
      true,
      'send-to-device and task handoff must live in the session toolbar send menu'
    );
    await waitFor(client, `!document.querySelector('#taskPackageActionBtn').disabled`, 'TaskPackage action for a local Codex session');
    await client.evaluate(`document.querySelector('#taskPackageActionBtn').click()`);
    await waitFor(
      client,
      `document.querySelector('#taskPackageDialog').open
        && document.querySelector('#taskPackagePreview strong')?.textContent.trim().length > 0
        && !document.querySelector('#exportTaskPackageBtn').disabled`,
      'TaskPackage export preview'
    );
    let snapshot = await dialogSnapshot(client, '#taskPackageDialog');
    assertDialogFits(snapshot);
    assert.equal(snapshot.modal, true);
    let controls = await client.evaluate(`({
      closeType: document.querySelector('#taskPackageCloseBtn').type,
      cancelType: document.querySelector('#taskPackageCancelBtn').type,
      objectiveRequired: document.querySelector('#taskPackageObjective').required,
      sourceMode: document.querySelector('#taskPackagePreview b').textContent.trim()
    })`);
    assert.deepEqual(
      { closeType: controls.closeType, cancelType: controls.cancelType, objectiveRequired: controls.objectiveRequired },
      { closeType: 'button', cancelType: 'button', objectiveRequired: true }
    );
    assert.ok(controls.sourceMode.length > 0);
    let shellBefore = await utilityDialogShellSnapshot(client, '#taskPackageDialog');
    assert.equal(shellBefore.shellOverflowY, 'hidden');
    await forceUtilityContentScroll(client, '#taskPackageDialog');
    let shellAfter = await utilityDialogShellSnapshot(client, '#taskPackageDialog');
    assert.ok(shellAfter.contentScrollTop > 0);
    assert.equal(shellAfter.shellScrollTop, 0);
    for (const key of ['header', 'close', 'footer']) assertRectStable(shellBefore, shellAfter, key);
    await clearUtilityContentScrollFixture(client, '#taskPackageDialog');
    await capture(client, artifactDir, '02-task-package-export');
    await client.evaluate(`document.querySelector('#taskPackageCloseBtn').click()`);
    await waitFor(client, `!document.querySelector('#taskPackageDialog').open`, 'TaskPackage export close');
    // 菜单在选择后已经收起，焦点回到“送出”这个开关。
    await waitFor(client, `document.activeElement === document.querySelector('#sessionSendMenu > summary')`, 'TaskPackage export focus return');

    await client.evaluate(`document.querySelector('#activityCenterBtn').click()`);
    await waitFor(client, `state.utilityDialog === 'activity' && document.querySelector('#activityCenterDialog').open`, 'activity parent for TaskPackage receive');
    await client.evaluate(`document.querySelector('#importTaskPackageBtn').click()`);
    await waitFor(
      client,
      `document.querySelector('#activityCenterDialog').open && document.querySelector('#taskPackageImportDialog').open`,
      'TaskPackage receive child'
    );
    assert.equal(await client.evaluate(`state.utilityDialog`), 'activity');
    snapshot = await dialogSnapshot(client, '#taskPackageImportDialog');
    assertDialogFits(snapshot);
    controls = await client.evaluate(`({
      closeType: document.querySelector('#taskPackageImportCloseBtn').type,
      cancelType: document.querySelector('#taskPackageImportCancelBtn').type,
      commitDisabled: document.querySelector('#commitTaskPackageBtn').disabled
    })`);
    assert.deepEqual(controls, { closeType: 'button', cancelType: 'button', commitDisabled: true });
    shellBefore = await utilityDialogShellSnapshot(client, '#taskPackageImportDialog');
    assert.equal(shellBefore.shellOverflowY, 'hidden');
    await forceUtilityContentScroll(client, '#taskPackageImportDialog');
    shellAfter = await utilityDialogShellSnapshot(client, '#taskPackageImportDialog');
    assert.ok(shellAfter.contentScrollTop > 0);
    assert.equal(shellAfter.shellScrollTop, 0);
    for (const key of ['header', 'close', 'footer']) assertRectStable(shellBefore, shellAfter, key);
    await clearUtilityContentScrollFixture(client, '#taskPackageImportDialog');
    await capture(client, artifactDir, '03-task-package-import');
    await client.evaluate(`document.querySelector('#taskPackageImportCloseBtn').click()`);
    await waitFor(
      client,
      `document.querySelector('#activityCenterDialog').open && !document.querySelector('#taskPackageImportDialog').open`,
      'TaskPackage receive returns to activity'
    );
    await waitFor(client, `document.activeElement?.id === 'importTaskPackageBtn'`, 'TaskPackage receive focus return');
    await client.evaluate(`document.querySelector('#activityCenterDialog .utility-dialog-close').click()`);
    await waitFor(client, `state.utilityDialog === null && !document.querySelector('#activityCenterDialog').open`, 'activity closes after TaskPackage receive');
  });

  await run('card workspace ignores the legacy yard setting and keeps Agent management in its object dialog', async () => {
    const workspace = await client.evaluate(`(() => {
      const card = document.querySelector('.account-card.selected');
      const runtime = card.querySelector('.account-card-runtime');
      const select = runtime.querySelector('select');
      return {
        retiredUi: Boolean(document.querySelector('#viewToggle,#classicViewBtn,#yardStage,.topbar-brand img')),
        title: document.querySelector('.topbar-brand').textContent.trim(),
        runtimeText: select.hidden ? runtime.querySelector('.account-card-runtime-single').textContent : select.selectedOptions[0]?.textContent
      };
    })()`);
    assert.equal(workspace.retiredUi, false);
    assert.equal(workspace.title, 'AgentDesk');
    assert.ok(workspace.runtimeText?.length > 0);

    await client.evaluate(`document.querySelector('.account-card.selected .account-card-manage').click()`);
    await waitFor(client, `document.querySelector('#agentManageDialog').open`, 'Agent management dialog');
    const agentDialog = await dialogSnapshot(client, '#agentManageDialog');
    assertDialogFits(agentDialog, { noScroll: true });
    assert.equal(agentDialog.modal, true);
    // 猫的档案一页四段：资料、位置、账号、送走；位置逐个列出，展开的那个下面是它自己的六个动作。
    const sections = await client.evaluate(`({
      sections: [...document.querySelectorAll('#agentManageDialog .agent-manage-section')].map((node) => node.dataset.section),
      name: document.querySelector('#agentManageName').textContent.trim(),
      locations: [...document.querySelectorAll('#agentManageLocations .dossier-location')].map((node) => node.getAttribute('aria-expanded')),
      actionsUnderExpanded: document.querySelector('#agentManageLocations .dossier-location[aria-expanded="true"]')?.nextElementSibling?.id || '',
      runtimeActionIds: [...document.querySelectorAll('#yardManageActions > button')].map((button) => button.id),
      otherActions: ['editProfileBtn', 'addRuntimeLocationBtn', 'manageAgentRelationsBtn', 'removeProfileBtn']
        .every((id) => Boolean(document.querySelector('#agentManageDialog #' + id))),
      summary: document.querySelector('#agentManageSummary').textContent.trim()
    })`);
    assert.deepEqual(sections.sections, ['profile', 'locations', 'accounts', 'farewell']);
    assert.ok(sections.name.length > 0 && sections.summary.length > 0);
    assert.ok(sections.locations.length >= 1, 'the dossier must list this cat\'s runtime locations');
    assert.equal(sections.locations.filter((value) => value === 'true').length, 1, 'exactly one location is expanded');
    assert.equal(sections.actionsUnderExpanded, 'yardManageActions', 'location actions sit under the expanded location');
    assert.deepEqual(sections.runtimeActionIds, [
      'pathConfigBtn',
      'diagnosticsBtn',
      'refreshBtn',
      'stopProfileBtn',
      'cleanCrashpadBtn',
      'profileFolderBtn'
    ]);
    assert.equal(sections.otherActions, true);
    // 子流程叠在档案上面：路径弹窗打开时档案还在，关掉以后回到档案。
    await client.evaluate(`document.querySelector('#pathConfigBtn').click()`);
    await waitFor(client, `document.querySelector('#pathDialog').open && document.querySelector('#agentManageDialog').open`, 'path flow stacked over the dossier');
    await client.evaluate(`document.querySelector('#pathDialog').close()`);
    await waitFor(client, `!document.querySelector('#pathDialog').open && document.querySelector('#agentManageDialog').open`, 'back on the dossier');
    await capture(client, artifactDir, '04-agent-manage-dialog');
    await client.evaluate(`document.querySelector('#agentManageDialog').close()`);


    await waitFor(client, `document.querySelectorAll('#accountRoster .account-card').length >= 7`, '7+ Agent roster fixture');
    assertAccountRosterGeometry(await accountRosterSnapshot(client));

    // 在别的猫身上打开档案，不改变正在看的列表。
    const viewedBefore = await client.evaluate(`({ agent: currentAgentId(), scope: state.ui.agentScope, title: document.querySelector('#sessionTitle').textContent })`);
    await client.evaluate(`[...document.querySelectorAll('#accountRoster .account-card')].find((card) => card.dataset.agentId !== currentAgentId()).querySelector('.account-card-manage').click()`);
    await waitFor(client, `document.querySelector('#agentManageDialog').open && actionAgentId() !== currentAgentId()`, 'dossier for a cat that is not being viewed');
    assert.deepEqual(
      await client.evaluate(`({ agent: currentAgentId(), scope: state.ui.agentScope, title: document.querySelector('#sessionTitle').textContent })`),
      viewedBefore,
      'opening another cat\'s dossier must not change the viewed list'
    );
    await client.evaluate(`document.querySelector('#agentManageDialog').close()`);
    await waitFor(client, `actionAgentId() === currentAgentId()`, 'action context returns to the viewed cat');


    await client.evaluate(`(() => {
      const cards = document.querySelectorAll('#accountRoster .account-card');
      cards[cards.length - 1].querySelector('.account-card-select').click();
    })()`);
    await waitFor(
      client,
      `(() => {
        const cards = document.querySelectorAll('#accountRoster .account-card');
        return cards.length >= 7 && cards[cards.length - 1].classList.contains('selected');
      })()`,
      'rightmost Agent selection'
    );
    await new Promise((resolve) => setTimeout(resolve, 80));
    const scrolledRoster = await accountRosterSnapshot(client);
    assert.ok(
      scrolledRoster.scrollLeft > 0,
      `selecting a right-side Agent must scroll the roster horizontally: ${JSON.stringify({
        scrollLeft: scrolledRoster.scrollLeft,
        scrollWidth: scrolledRoster.scrollWidth,
        clientWidth: scrolledRoster.clientWidth,
        selected: scrolledRoster.cards.find((card) => card.selected)?.rect,
        roster: scrolledRoster.roster
      })}`
    );
    assertAccountRosterGeometry(scrolledRoster);

    // Reuse the same isolated renderer to prove that a small account set does
    // not redistribute the available track width. Hiding the fixture-only
    // surplus cards changes no persisted profile or Mesh data.
    await client.evaluate(`document.querySelector('#accountRoster .account-card-select').click()`);
    await waitFor(
      client,
      `document.querySelector('#accountRoster .account-card')?.classList.contains('selected')`,
      'leftmost Agent selection'
    );
    await client.evaluate(`(() => {
      const roster = document.querySelector('#accountRoster');
      [...roster.querySelectorAll('.account-card')].forEach((card, index) => { card.hidden = index >= 2; });
      roster.scrollLeft = 0;
    })()`);
    const smallRoster = await accountRosterSnapshot(client);
    assert.equal(smallRoster.cards.length, 2, 'the small-card geometry fixture must expose exactly two cards');
    assertAccountRosterGeometry(smallRoster, { minimumCards: 2, requireOverflow: false });
    assert.ok(
      smallRoster.roster.right - smallRoster.cards[1].rect.right > 200,
      'two fixed-width Agent cards must leave visible unused space instead of stretching across the roster'
    );
    await client.evaluate(`(() => {
      const roster = document.querySelector('#accountRoster');
      [...roster.querySelectorAll('.account-card')].forEach((card) => { card.hidden = false; });
    })()`);
    assertAccountRosterGeometry(await accountRosterSnapshot(client));
  });

  await run('light/dark and zh/en/ja preserve the approved geometry', async () => {
    await client.evaluate(`document.querySelector('#themeToggle').click()`);
    assert.equal((await layoutSnapshot(client)).theme, 'dark');

    for (const lang of ['zh', 'en', 'ja']) {
      await client.evaluate(`(() => {
        window.I18N.setLang(${JSON.stringify(lang)});
        updateLangToggle();
        rerenderLocalizedText();
      })()`);
      const layout = await layoutSnapshot(client);
      assertFixedShell(layout);
      assert.equal(layout.lang, lang === 'zh' ? 'zh-CN' : lang);
      assertAccountRosterGeometry(await accountRosterSnapshot(client));
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

    for (const [button, kind, dialog, focusTarget] of [
      ['#systemBtn', 'system', '#systemDialog', '#systemBtn'],
      ['#activityCenterBtn', 'activity', '#activityCenterDialog', '#activityCenterBtn']
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

      const shellBefore = await utilityDialogShellSnapshot(client, dialog);
      assert.equal(shellBefore.shellOverflowY, 'hidden', `${kind} shell must own no scroll`);
      await forceUtilityContentScroll(client, dialog);
      const shellAfter = await utilityDialogShellSnapshot(client, dialog);
      assert.ok(shellAfter.contentScrollTop > 0, `${kind} content must be the scroll owner`);
      assert.ok(['auto', 'scroll'].includes(shellAfter.contentOverflowY), `${kind} content must allow vertical scrolling`);
      assert.equal(shellAfter.shellScrollTop, 0, `${kind} shell must stay at scrollTop 0`);
      for (const key of ['header', 'close', 'commandbar', 'footer']) assertRectStable(shellBefore, shellAfter, key);
      await clearUtilityContentScrollFixture(client, dialog);

      // Exercise the actual user close control. Calling HTMLDialogElement.close()
      // directly has proven flaky under Electron's remote debugging transport
      // and skips the form-method=dialog interaction we need to certify.
      await client.evaluate(`document.querySelector(${JSON.stringify(dialog)})?.querySelector('.utility-dialog-close')?.click()`);
      await waitFor(client, `state.utilityDialog === null && !document.querySelector(${JSON.stringify(dialog)}).open`, `${kind} modal close`);
      await waitFor(client, `document.activeElement === document.querySelector(${JSON.stringify(focusTarget)})`, `${kind} trigger focus return`);
    }

    await client.evaluate(`document.querySelector('.account-card.selected .account-card-quota-summary').click()`);
    await waitFor(client, `document.querySelector('#quotaPopover').matches(':popover-open') && !document.querySelector('#quotaSummary').hidden`, 'account quota popover');
    const quotaGeometry = await client.evaluate(`(() => {
      const pick = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      };
      return {
        agent: pick('#agentPanel'), sessions: pick('#sessionPane'), detail: pick('#detailPanel'),
        popup: pick('#quotaPopover'), anchor: pick('.account-card.selected .account-card-quota-summary'),
        viewport: { width: innerWidth, height: innerHeight }
      };
    })()`);
    assert.deepEqual(quotaGeometry.agent, baseline.geometry.agent, 'quota must keep the Agent row fixed');
    assert.deepEqual(quotaGeometry.sessions, baseline.geometry.sessions, 'quota must keep the session list full-width');
    assert.deepEqual(quotaGeometry.detail, baseline.geometry.detail, 'quota must not occupy the remote pane');
    const { popup, anchor, viewport } = quotaGeometry;
    assert.ok(popup.width > 0 && popup.x >= 0 && popup.x + popup.width <= viewport.width);
    assert.ok(popup.y >= 0 && popup.y + popup.height <= viewport.height);
    assert.ok(Math.abs(popup.y - anchor.y - anchor.height) < 8 || Math.abs(anchor.y - popup.y - popup.height) < 8);
    await pressEscape(client);
    await waitFor(client, `!document.querySelector('#quotaPopover').matches(':popover-open')
      && document.activeElement === document.querySelector('.account-card.selected .account-card-quota-summary')`, 'Escape closes quota and restores trigger focus');
  });

  await run('system/help keep a real parent-child modal stack with layered Escape, and inbox records live inside the inbox page', async () => {
    await client.evaluate(`document.querySelector('#systemBtn').click()`);
    await waitFor(client, `state.utilityDialog === 'system' && document.querySelector('#systemDialog').open`, 'system parent');
    assert.deepEqual(await client.evaluate(`({
      tools: Boolean(document.querySelector('#systemDialog #systemTools #checkToolsBtn')),
      settings: Boolean(document.querySelector('#systemDialog #systemSettings #themeToggle')),
      oldDialogs: Boolean(document.querySelector('#toolCenterDialog, #settingsDialog'))
    })`), { tools: true, settings: true, oldDialogs: false });
    await client.evaluate(`(() => {
      const content = document.querySelector('#systemDialog .utility-dialog-content');
      const fixture = document.createElement('div');
      fixture.dataset.acceptanceParentScrollFixture = 'true';
      fixture.style.cssText = 'height:700px;min-height:700px;visibility:hidden;';
      content.append(fixture);
      content.scrollTop = 37;
      document.querySelector('#helpBtn').click();
    })()`);
    await waitFor(client, `document.querySelector('#systemDialog').open && document.querySelector('#welcomeDialog').open`, 'help child over system');
    assert.equal(await client.evaluate(`state.utilityDialog`), 'system');
    await pressEscape(client);
    await waitFor(client, `document.querySelector('#systemDialog').open && !document.querySelector('#welcomeDialog').open`, 'Escape closes help only');
    await waitFor(client, `document.activeElement?.id === 'helpBtn'`, 'help trigger focus return');
    const settingsReturn = await client.evaluate(`({
      focus: document.activeElement?.id,
      scrollTop: document.querySelector('#systemDialog .utility-dialog-content').scrollTop
    })`);
    assert.equal(settingsReturn.focus, 'helpBtn');
    assert.equal(settingsReturn.scrollTop, 37);
    await client.evaluate(`document.querySelector('#systemDialog [data-acceptance-parent-scroll-fixture]').remove()`);
    await pressEscape(client);
    await waitFor(client, `!document.querySelector('#systemDialog').open && state.utilityDialog === null`, 'Escape closes system root');
    await waitFor(client, `document.activeElement?.id === 'systemBtn'`, 'system trigger focus');

    await client.evaluate(`document.querySelector('#activityCenterBtn').click()`);
    await waitFor(client, `state.utilityDialog === 'activity' && document.querySelector('#activityCenterDialog').open`, 'activity parent');
    // 传输记录是收件箱里的一段，不再叠一层子弹窗。
    assert.deepEqual(await client.evaluate(`({
      sections: [...document.querySelectorAll('#activityCenterDialog .inbox-section')].map((node) => node.id),
      records: Boolean(document.querySelector('#inboxRecords #transferList') && document.querySelector('#inboxRecords #taskPackageHistory')),
      childDialog: Boolean(document.querySelector('#transferCenterDialog'))
    })`), { sections: ['inboxAttention', 'inboxIncoming', 'inboxRecords'], records: true, childDialog: false });
    assert.equal(await client.evaluate(`state.utilityDialog`), 'activity');
    await pressEscape(client);
    await waitFor(client, `!document.querySelector('#activityCenterDialog').open && state.utilityDialog === null`, 'Escape closes activity root');
    await waitFor(client, `document.activeElement?.id === 'activityCenterBtn'`, 'activity trigger focus');
  });

  await run('the three utility pages stay bounded in a 760×560 renderer viewport', async () => {
    await client.call('Emulation.setDeviceMetricsOverride', {
      width: 760,
      height: 560,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: 760,
      screenHeight: 560
    });
    try {
      await client.evaluate(`(() => {
        window.I18N.setLang('en');
        updateLangToggle();
        rerenderLocalizedText();
      })()`);
      for (const [kind, dialog] of [
        ['devices', '#deviceCenterDialog'],
        ['system', '#systemDialog'],
        ['activity', '#activityCenterDialog']
      ]) {
        await client.evaluate(`openUtilityDialog(${JSON.stringify(kind)})`);
        const snapshot = await dialogSnapshot(client, dialog);
        assert.deepEqual(snapshot.viewport, { width: 760, height: 560 });
        assertDialogFits(snapshot);
        const shell = await utilityDialogShellSnapshot(client, dialog);
        assert.equal(shell.shellOverflowY, 'hidden');
        assert.ok(shell.content && shell.content.height > 0, `${kind} content must retain usable height`);
        await client.evaluate(`document.querySelector(${JSON.stringify(dialog)}).close()`);
        await waitFor(client, `state.utilityDialog === null`, `${kind} small viewport close`);
      }
    } finally {
      await client.evaluate(`document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close())`);
      await client.call('Emulation.clearDeviceMetricsOverride');
    }
    await waitFor(client, `innerWidth === 1040`, 'fixed renderer viewport restore');
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
      allCardPressed: document.querySelector('#rosterAllCard').getAttribute('aria-pressed'),
      scope: state.ui.agentScope,
      detailKind: document.querySelector('#deviceDetailKind').textContent,
      detailStatus: document.querySelector('#deviceDetailStatus').textContent
    })`);
    assert.equal(initialized.initialized, true, `Mesh initialization failed: ${initialized.error || 'unknown error'}`);
    assert.equal(initialized.agent, null, 'Mesh initialization must not silently choose the first Agent');
    assert.equal(initialized.scope, 'all', 'with no Agent picked the roster must fall back to All');
    assert.equal(initialized.allCardPressed, 'true');
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

    await client.evaluate(`document.querySelector('#createDeviceInviteBtn').click()`);
    await waitFor(
      client,
      `document.querySelector('#deviceCenterDialog').open && document.querySelector('#deviceJourneyDialog').open`,
      'Add Device task journey over Device Center'
    );
    let journeySnapshot = await dialogSnapshot(client, '#deviceJourneyDialog');
    assertDialogFits(journeySnapshot);
    const journeyControls = await client.evaluate(`({
      closeType: document.querySelector('#deviceJourneyCloseBtn').type,
      progressSteps: document.querySelectorAll('#deviceJourneyProgress [data-step]').length,
      currentSteps: document.querySelectorAll('#deviceJourneyProgress [data-state="current"]').length,
      primaryAction: document.querySelector('#deviceJourneyPrimaryBtn').dataset.action,
      receiverEntryInsideJourney: document.querySelector('#deviceJourneyDialog').contains(document.querySelector('#receiveConnectionsBtn')),
      parentOpen: document.querySelector('#deviceCenterDialog').open
    })`);
    assert.deepEqual(journeyControls, {
      closeType: 'button',
      progressSteps: 5,
      currentSteps: 1,
      primaryAction: 'invite',
      receiverEntryInsideJourney: false,
      parentOpen: true
    });
    let journeyShellBefore = await utilityDialogShellSnapshot(client, '#deviceJourneyDialog');
    assert.equal(journeyShellBefore.shellOverflowY, 'hidden');
    await forceUtilityContentScroll(client, '#deviceJourneyDialog');
    let journeyShellAfter = await utilityDialogShellSnapshot(client, '#deviceJourneyDialog');
    assert.ok(journeyShellAfter.contentScrollTop > 0);
    assert.equal(journeyShellAfter.shellScrollTop, 0);
    for (const key of ['header', 'close', 'footer']) {
      assertRectStable(journeyShellBefore, journeyShellAfter, key);
    }
    await clearUtilityContentScrollFixture(client, '#deviceJourneyDialog');
    await client.evaluate(`document.querySelector('#deviceJourneyCloseBtn').click()`);
    await waitFor(
      client,
      `document.querySelector('#deviceCenterDialog').open && !document.querySelector('#deviceJourneyDialog').open`,
      'Add Device journey returns to Device Center'
    );
    await waitFor(client, `document.activeElement?.id === 'createDeviceInviteBtn'`, 'Add Device journey focus return');

    // 先放进长内容让弹窗长到窗口允许的高度，再量固定区的位置，然后才滚动。
    await client.evaluate(`(() => {
      const list = document.querySelector('#deviceList');
      const fixture = document.createElement('div');
      fixture.dataset.acceptanceDeviceScrollFixture = 'true';
      fixture.style.cssText = 'height:1000px;min-height:1000px;visibility:hidden;';
      list.append(fixture);
    })()`);
    const deviceShellBefore = await utilityDialogShellSnapshot(client, '#deviceCenterDialog');
    assert.equal(deviceShellBefore.shellOverflowY, 'hidden');
    assert.equal(deviceShellBefore.contentOverflowY, 'hidden', 'Device Center outer content must not compete with its named panes');
    await client.evaluate(`(() => {
      const list = document.querySelector('#deviceList');
      list.scrollTop = list.scrollHeight;
    })()`);
    const devicePaneScroll = await client.evaluate(`(() => {
      const list = document.querySelector('#deviceList');
      return { scrollTop: list.scrollTop, overflowY: getComputedStyle(list).overflowY };
    })()`);
    assert.ok(devicePaneScroll.scrollTop > 0, 'Device Center device list must be a named pane scroll owner');
    assert.ok(['auto', 'scroll'].includes(devicePaneScroll.overflowY));
    const deviceShellAfter = await utilityDialogShellSnapshot(client, '#deviceCenterDialog');
    assert.equal(deviceShellAfter.shellScrollTop, 0);
    for (const key of ['header', 'close', 'commandbar']) assertRectStable(deviceShellBefore, deviceShellAfter, key);
    await client.evaluate(`document.querySelector('#deviceList [data-acceptance-device-scroll-fixture]').remove()`);

    await client.evaluate(`(() => {
      document.querySelector('#deviceCenterMoreMenu').open = true;
      document.querySelector('#networkSettingsBtn').click();
    })()`);
    await waitFor(client, `document.querySelector('#deviceCenterDialog').open && document.querySelector('#meshNetworkDialog').open`, 'network child over Device Center');
    assert.equal(await client.evaluate(`state.utilityDialog`), 'devices');
    await pressEscape(client);
    await waitFor(client, `document.querySelector('#deviceCenterDialog').open && !document.querySelector('#meshNetworkDialog').open`, 'Escape closes network child only');
    await waitFor(client, `document.activeElement?.id === 'networkSettingsBtn'`, 'network trigger focus return');
    assert.equal(await client.evaluate(`document.activeElement?.id`), 'networkSettingsBtn');

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
      options: [...document.querySelector('.account-card.selected .account-card-runtime select').options].map((item) => item.value),
      current: document.querySelector('.account-card.selected .account-card-runtime select').value
    })`);
    assert.ok(before.options.length >= 2, 'the seeded shared login must expose two Slots');
    const nextSlot = before.options.find((item) => item !== before.current);
    await client.evaluate(`(() => {
      const select = document.querySelector('.account-card.selected .account-card-runtime select');
      select.value = ${JSON.stringify(nextSlot)};
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    const after = await client.evaluate(`({
      query: state.query,
      focused: state.ui.focusedConversationId,
      checked: [...state.ui.checkedConversationIds],
      current: document.querySelector('.account-card.selected .account-card-runtime select').value
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

  await run('direct TaskPackage UI follows authenticated feature/capability state and explicit receive stages', async () => {
    await client.evaluate(`(() => {
      state.mesh.overview.devices.push({
        deviceId: 'acceptance-direct-device',
        name: 'Trusted Remote Mac',
        isLocal: false,
        status: 'online',
        capabilities: ['task.package.receive'],
        permissions: ['task.package.receive']
      });
      state.mesh.overview.connections.push({
        deviceId: 'acceptance-direct-device',
        authenticated: true,
        protocolFeatures: ['task.package.transfer.v1']
      });
      document.querySelectorAll('#sessionRows tr:not(.empty-row)')[0].click();
    })()`);
    await client.evaluate(`document.querySelector('#activityCenterBtn').click()`);
    await waitFor(client, `!document.querySelector('#taskPackageActionBtn').disabled`, 'direct TaskPackage source');
    await client.evaluate(`document.querySelector('#taskPackageActionBtn').click()`);
    await waitFor(
      client,
      `document.querySelector('#taskPackageDialog').open
        && !document.querySelector('#taskPackageDeliveryDirect').disabled
        && !document.querySelector('#exportTaskPackageBtn').disabled`,
      'eligible direct TaskPackage target'
    );
    await client.evaluate(`document.querySelector('#taskPackageDeliveryDirect').click()`);
    const direct = await client.evaluate(`({
      selected: document.querySelector('#taskPackageDeliveryDirect').checked,
      targetVisible: !document.querySelector('#taskPackageDirectTargetField').hidden,
      targetCount: document.querySelector('#taskPackageDirectTarget').options.length,
      targetId: document.querySelector('#taskPackageDirectTarget').value,
      security: document.querySelector('#taskPackageSecurity').textContent.trim(),
      unlockVisible: !document.querySelector('#taskPackageExportResult').hidden,
      unlockCode: document.querySelector('#taskPackageUnlockCode').textContent.trim()
    })`);
    assert.equal(direct.selected, true);
    assert.equal(direct.targetVisible, true);
    assert.equal(direct.targetCount, 1);
    assert.equal(direct.targetId, 'acceptance-direct-device');
    assert.ok(direct.security.length > 0);
    assert.equal(direct.unlockVisible, false, 'direct send must not expose the unlock result panel');
    assert.equal(direct.unlockCode, '', 'direct send must not place a plaintext code in the Renderer');
    await client.evaluate(`document.querySelector('#taskPackageCloseBtn').click()`);
    await waitFor(client, `!document.querySelector('#taskPackageDialog').open`, 'direct TaskPackage composer close');

    await waitFor(
      client,
      `document.querySelector('#activityCenterDialog').open && state.mesh.transferLoading === false`,
      'activity transfer refresh before receive projection'
    );
    await client.evaluate(`(() => {
      state.mesh.transfers.push({
        transferId: 'acceptance-incoming-task-package',
        type: 'task-package',
        direction: 'incoming',
        state: 'received',
        acceptRequired: true,
        canImport: false,
        bytesTotal: 4096,
        bytesTransferred: 0,
        receivedFromName: 'Trusted Remote Mac',
        taskPackage: {
          packageId: 'acceptance-package',
          title: 'Continue renderer acceptance',
          sourceAgentName: 'Remote Research Agent',
          senderLabel: 'QA handoff',
          appId: 'codex',
          objective: 'Verify the receive decision before any import.',
          attachmentCount: 2
        }
      });
      renderIncomingTaskPackages();
    })()`);
    await waitFor(
      client,
      `document.querySelector('#activityCenterDialog').open
        && document.querySelectorAll('#incomingTaskPackageList .incoming-task-package-card').length === 1`,
      'incoming TaskPackage decision card'
    );
    let actions = await client.evaluate(`({
      count: document.querySelectorAll('#incomingTaskPackageList .incoming-task-package-actions button').length,
      primary: document.querySelectorAll('#incomingTaskPackageList .incoming-task-package-actions button.primary').length,
      title: document.querySelector('#incomingTaskPackageList strong').textContent.trim()
    })`);
    assert.deepEqual(actions, { count: 2, primary: 1, title: 'Continue renderer acceptance' });

    await client.evaluate(`(() => {
      const transfer = state.mesh.transfers.find((item) => item.transferId === 'acceptance-incoming-task-package');
      transfer.state = 'completed';
      transfer.acceptRequired = false;
      transfer.canImport = true;
      transfer.bytesTransferred = transfer.bytesTotal;
      renderIncomingTaskPackages();
    })()`);
    actions = await client.evaluate(`({
      count: document.querySelectorAll('#incomingTaskPackageList .incoming-task-package-actions button').length,
      primary: document.querySelectorAll('#incomingTaskPackageList .incoming-task-package-actions button.primary').length
    })`);
    assert.deepEqual(actions, { count: 1, primary: 1 }, 'verified package must offer import instead of another accept');
    await client.evaluate(`(() => {
      document.querySelector('#activityCenterDialog .utility-dialog-close').click();
      state.mesh.transfers = state.mesh.transfers.filter((item) => item.transferId !== 'acceptance-incoming-task-package');
      state.mesh.overview.devices = state.mesh.overview.devices.filter((item) => item.deviceId !== 'acceptance-direct-device');
      state.mesh.overview.connections = state.mesh.overview.connections.filter((item) => item.deviceId !== 'acceptance-direct-device');
      renderIncomingTaskPackages();
    })()`);
    await waitFor(client, `!document.querySelector('#activityCenterDialog').open`, 'incoming TaskPackage activity close');
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
      return { remoteId, conversationId: common.conversationId };
    })()`);
    await client.evaluate(`document.querySelector('#chooseSessionReplicaBtn').click()`);
    let result = await client.evaluate(`({
      pickerOpen: document.querySelector('#sessionReplicaPicker').open,
      options: document.querySelectorAll('#sessionReplicaOptions input').length,
      copyDisabled: document.querySelector('#copySessionInfoBtn').disabled,
      sendDisabled: document.querySelector('#sendSessionInfoBtn').disabled,
      openDisabled: document.querySelector('#openSessionFileBtn').disabled,
      issue: document.querySelector('#sessionSelectionIssue').textContent.trim()
    })`);
    assert.deepEqual(
      { pickerOpen: result.pickerOpen, options: result.options, copyDisabled: result.copyDisabled, sendDisabled: result.sendDisabled, openDisabled: result.openDisabled },
      { pickerOpen: true, options: 2, copyDisabled: true, sendDisabled: true, openDisabled: true }
    );
    assert.ok(result.issue.length > 0);

    await client.evaluate(`document.querySelectorAll('#sessionReplicaOptions input')[1].click()`);
    result = await client.evaluate(`({
      selected: state.ui.selectedReplicaKeyByConversation['mesh::${injected.conversationId}'],
      copyDisabled: document.querySelector('#copySessionInfoBtn').disabled,
      sendDisabled: document.querySelector('#sendSessionInfoBtn').disabled,
      openDisabled: document.querySelector('#openSessionFileBtn').disabled,
      location: document.querySelector('#sessionReplicaOptions input:checked').closest('label').textContent
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
    await client.evaluate(`document.querySelector('#sessionReplicaPicker').close()`);
  });
  await capture(client, artifactDir, '08-multi-replica-source');

  await run('SessionPointer, file, and history dialogs keep independent drafts', async () => {
    await client.evaluate(`document.querySelector('#activityCenterBtn').click()`);
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
    await waitFor(client, `state.utilityDialog === 'activity' && document.querySelector('#activityCenterDialog').open`, 'transfer records in the inbox');
    snapshot = await dialogSnapshot(client, '#activityCenterDialog');
    assertDialogFits(snapshot);
    assert.equal(await client.evaluate(`state.ui.transferDraft`), null);
    await client.evaluate(`document.querySelector('#activityCenterDialog .utility-dialog-close').click()`);
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

  await run('remove an unassigned local registration without deleting its Agent or files', async () => {
    await client.evaluate(`(() => {
      window.registrationRemovalFixture = null;
      loadDeviceOverview({ silent: true }).then(async () => {
        const overview = state.mesh.overview;
        const slot = overview.slots.find(item => item.profileId === 'acceptance-work-cli' && item.deviceId === overview.localDeviceId);
        const result = await window.manager.removeLocalAgentSlot({ deviceId: slot.deviceId, profileId: slot.profileId, baseRevision: currentCatalogRevision() });
        if (!result.ok) throw new Error(result.reasonCode);
        state.mesh.overview = result.overview;
        const pending = result.overview.slots.find(item => item.profileId === slot.profileId && item.deviceId === slot.deviceId);
        window.registrationRemovalFixture = { agentId: slot.agentId, profile: state.profiles.find(item => item.id === slot.profileId) };
        openSlotAssignmentDialog(pending);
      });
    })()`);
    await waitFor(client, `window.registrationRemovalFixture && document.querySelector('#slotAssignmentDialog').open`, 'unassigned local registration');
    const fixture = await client.evaluate('window.registrationRemovalFixture');
    const sentinel = path.join(fixture.profile.sessionRoot, 'keep-registration-removal.txt');
    fs.writeFileSync(sentinel, 'session files stay');
    assert.equal(await client.evaluate(`document.querySelector('#removeUnassignedSlotBtn').checkVisibility()`), true);
    const eventStart = client.events.length;
    const click = client.evaluate(`document.querySelector('#removeUnassignedSlotBtn').click()`);
    const deadline = Date.now() + 5000;
    while (!client.events.slice(eventStart).some(event => event.method === 'Page.javascriptDialogOpening')) {
      assert.ok(Date.now() < deadline, 'registration removal must request confirmation');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    await client.call('Page.handleJavaScriptDialog', { accept: true });
    await click;
    await waitFor(client, `!document.querySelector('#slotAssignmentDialog').open
      && !state.profiles.some(item => item.id === 'acceptance-work-cli')
      && !state.mesh.overview.slots.some(item => item.profileId === 'acceptance-work-cli')`, 'registration removed from profile and overview');
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'session files stay');
    assert.equal(await client.evaluate(`state.mesh.overview.agents.some(item => item.agentId === ${JSON.stringify(fixture.agentId)})`), true);
    assert.equal(await client.evaluate(`state.profiles.some(item => item.id === 'acceptance-work-desktop')`), true);
    assert.equal(await client.evaluate(`collectAttentionItems().some(item => item.slotKey?.includes('acceptance-work-cli'))`), false);
  });

  const exceptions = client.events.filter((event) => event.method === 'Runtime.exceptionThrown');
  assert.deepEqual(exceptions, [], 'renderer must not emit uncaught exceptions during acceptance');
  return checks;
}

async function readOnboardingProgress(userData) {
  const settingsPath = path.join(userData, 'settings.json');
  if (!fs.existsSync(settingsPath)) return { completedVersion: 0, completedAt: null };
  const stored = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  const value = stored?.settings?.onboarding || stored?.onboarding || {};
  return {
    completedVersion: Number(value.completedVersion) || 0,
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : null
  };
}

async function waitForOnboardingProgress(userData, completedVersion, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const progress = await readOnboardingProgress(userData);
    if (progress.completedVersion === completedVersion) return progress;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for onboarding completion version ${completedVersion}`);
}

async function runFreshFirstUseInitialization(client, userData, artifactDir) {
  await client.call('Runtime.enable');
  await client.call('Page.enable');
  await client.call('Log.enable');
  await waitFor(
    client,
    `typeof state !== 'undefined'
      && state.startupStage === 'ready'
      && state.profiles.length === 0
      && Boolean(document.querySelector('#accountRoster .account-roster-empty button.primary'))`,
    'fresh empty desk with its recruit button'
  );
  assert.equal(
    await client.evaluate(`document.querySelector('#welcomeDialog').open`),
    false,
    'a fresh install must not open the first-use dialog by itself'
  );
  await client.evaluate(`document.querySelector('#accountRoster .account-roster-empty button.primary').click()`);
  await waitFor(
    client,
    `document.querySelector('#welcomeDialog').open
      && state.firstUse.model?.phase === 'agent'
      && state.profiles.length === 0`,
    'fresh first-use Agent step'
  );
  assert.deepEqual(await readOnboardingProgress(userData), {
    completedVersion: 0,
    completedAt: null
  });

  const initial = await client.evaluate(`({
    mode: state.firstUse.mode,
    phase: state.firstUse.model.phase,
    version: state.firstUse.model.version,
    initialized: state.mesh.overview?.initialized === true,
    primaryDisabled: document.querySelector('#onboardingPrimaryBtn').disabled,
    draft: state.firstUse.model.draft,
    action: document.querySelector('#onboardingPrimaryBtn').dataset.action,
    controls: ['onboardingPrimaryBtn', 'onboardingSecondaryBtn', 'onboardingBackBtn', 'onboardingAdvancedBtn'].map(id => Boolean(document.getElementById(id))),
    completeHidden: document.querySelector('#onboardingComplete').hidden,
    safety: document.querySelector('#onboardingAgent .onboarding-safety-note')?.textContent.trim() || ''
  })`);
  assert.equal(initial.mode, 'onboarding');
  assert.equal(initial.phase, 'agent');
  assert.equal(initial.version, 1);
  assert.equal(initial.initialized, false);
  assert.equal(initial.primaryDisabled, true, 'initial first-use state: ' + JSON.stringify(initial));
  assert.equal(initial.completeHidden, true);
  assert.ok(initial.safety.length > 0, 'first-use must explain its local-only boundary');

  await client.evaluate(`(() => {
    const name = document.querySelector('#onboardingAgentName');
    name.value = 'Acceptance Research Agent';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    const client = document.querySelector('#onboardingAgentClient');
    const codex = [...client.options].find((option) => option.value.startsWith('codex\\u001f'));
    if (codex) {
      client.value = codex.value;
      client.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // The first-Agent catalog/device transaction remains real. Only the next
    // official-client launch boundary is held at waiting-login so this UI
    // acceptance cannot open or modify a third-party application.
    window.__acceptanceContinueFirstPreparation = continueFirstPreparation;
    continueFirstPreparation = async () => {
      state.firstUse.busy = false;
      state.firstUse.model = window.OnboardingState.transition(state.firstUse.model, {
        type: 'preparation-result',
        result: { ok: false, state: 'waiting-login', reasonCode: 'official-login-required' }
      });
      renderFirstUse();
    };
  })()`);
  await waitFor(client, `!document.querySelector('#onboardingPrimaryBtn').disabled`, 'valid first Agent draft');
  await client.evaluate(`document.querySelector('#onboardingPrimaryBtn').click()`);
  await waitFor(
    client,
    `state.mesh.overview?.initialized === true
      && state.firstUse.model?.phase === 'preparing'
      && state.firstUse.model?.preparation?.state === 'waiting-login'`,
    'offline first Agent initialization',
    20_000
  );

  const result = await client.evaluate(`({
    agentNames: (state.mesh.overview?.agents || []).map((agent) => agent.displayName),
    deviceCount: state.mesh.overview?.devices?.length || 0,
    connectionCount: state.mesh.overview?.connections?.length || 0,
    reachabilityActive: state.mesh.overview?.reachability?.active === true,
    reachabilityEnabled: state.mesh.overview?.reachability?.userEnabled === true,
    networkEnrollmentEnabled: state.mesh.overview?.reachability?.networkEnrollmentEnabled === true,
    endpointCount: state.mesh.overview?.reachability?.endpointCount || 0,
    phase: state.firstUse.model.phase,
    primaryAction: document.querySelector('#onboardingPrimaryBtn').dataset.action,
    laterVisible: !document.querySelector('#onboardingSecondaryBtn').hidden
  })`);
  assert.deepEqual(result.agentNames, ['Acceptance Research Agent']);
  assert.equal(result.deviceCount, 1);
  assert.equal(result.connectionCount, 0);
  assert.equal(result.reachabilityActive, false);
  assert.equal(result.reachabilityEnabled, false);
  assert.equal(result.networkEnrollmentEnabled, false);
  assert.equal(result.endpointCount, 0);
  assert.equal(result.phase, 'preparing');
  assert.equal(result.primaryAction, 'prepare');
  assert.equal(result.laterVisible, true);
  assert.deepEqual(await readOnboardingProgress(userData), {
    completedVersion: 0,
    completedAt: null
  }, 'initialization must not mark the guide complete');
  assert.ok(fs.existsSync(path.join(userData, 'mesh.db')), 'first Agent must create the local Mesh store');
  await capture(client, artifactDir, '00-first-use-offline-agent');
  process.stdout.write('✓ fresh first Agent creates only the local catalog/device identity\n');
  return ['fresh first Agent creates only the local catalog/device identity'];
}

async function runFreshFirstUseRecovery(client, userData, artifactDir) {
  await client.call('Runtime.enable');
  await client.call('Page.enable');
  await client.call('Log.enable');
  await waitFor(
    client,
    `typeof state !== 'undefined'
      && state.startupStage === 'ready'
      && document.querySelector('#welcomeDialog').open
      && state.firstUse.model?.phase === 'existing'
      && state.mesh.overview?.initialized === true`,
    'interrupted first-use recovery'
  );
  const recovered = await client.evaluate(`({
    phase: state.firstUse.model.phase,
    agents: state.firstUse.model.agents.map((agent) => agent.displayName),
    completion: state.onboardingProgress.completedVersion,
    connectionCount: state.mesh.overview?.connections?.length || 0,
    networkEnrollmentEnabled: state.mesh.overview?.reachability?.networkEnrollmentEnabled === true,
    primaryAction: document.querySelector('#onboardingPrimaryBtn').dataset.action
  })`);
  assert.equal(recovered.phase, 'existing');
  assert.deepEqual(recovered.agents, ['Acceptance Research Agent']);
  assert.equal(recovered.completion, 0);
  assert.equal(recovered.connectionCount, 0);
  assert.equal(recovered.networkEnrollmentEnabled, false);
  assert.equal(recovered.primaryAction, 'review');

  await client.evaluate(`document.querySelector('#onboardingPrimaryBtn').click()`);
  await waitFor(
    client,
    `state.firstUse.model?.phase === 'complete'
      && state.firstUse.model?.completeShown === true
      && !document.querySelector('#onboardingPrimaryBtn').disabled`,
    'rendered first-use completion'
  );
  assert.deepEqual(await readOnboardingProgress(userData), {
    completedVersion: 0,
    completedAt: null
  }, 'rendering completion must still not persist completion');
  await capture(client, artifactDir, '00-first-use-recovered');
  await client.evaluate(`document.querySelector('#onboardingPrimaryBtn').click()`);
  await waitFor(
    client,
    `!document.querySelector('#welcomeDialog').open && state.onboardingProgress.completedVersion === 1`,
    'persisted first-use completion'
  );
  const progress = await waitForOnboardingProgress(userData, 1);
  assert.ok(progress.completedAt, 'completion requires a timestamp after the complete view was shown');
  const profiles = JSON.parse(fs.readFileSync(path.join(userData, 'profiles.json'), 'utf8'));
  assert.deepEqual(profiles.profiles || profiles, [], 'fresh first use must not resurrect default Claude/Codex/Kimi Profiles');
  process.stdout.write('✓ interrupted first use resumes without default Profiles and completes only after review\n');
  return ['interrupted first use resumes without default Profiles and completes only after review'];
}

async function stopChild(child, childState) {
  if (childState.exited) return;
  child.kill('SIGTERM');
  const stopped = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), 4_000))
  ]);
  if (!stopped && !childState.exited) {
    child.kill('SIGKILL');
    await Promise.race([
      childState.exited
        ? Promise.resolve(true)
        : new Promise((resolve) => child.once('exit', () => resolve(true))),
      new Promise((resolve) => setTimeout(() => resolve(false), 4_000))
    ]);
  }
}

async function launchElectronApp(userData, output) {
  const port = await freePort();
  const electronPath = require('electron');
  assert.ok(fs.existsSync(electronPath), `Electron runtime not found: ${electronPath}`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const childState = { exited: false, code: null };
  const child = spawn(electronPath, [
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
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
  try {
    const target = await waitForTarget(port, childState);
    process.stdout.write(`Renderer target: ${target.url}\n`);
    const client = new DevToolsClient(target.webSocketDebuggerUrl);
    await client.connect();
    assert.equal(await client.evaluate('1 + 1'), 2, 'DevTools renderer evaluation handshake failed');
    return { child, childState, client };
  } catch (error) {
    await stopChild(child, childState);
    throw error;
  }
}

async function closeElectronApp(instance) {
  if (!instance) return;
  instance.client?.close();
  await stopChild(instance.child, instance.childState);
}

async function runRosterAcceptance(client, userData) {
  await waitFor(client, `typeof state !== 'undefined' && state.profiles.length === 8
    && state.sessions.length >= 3 && !document.querySelector('#welcomeDialog').open`, 'roster workspace');
  await client.call('Emulation.setFocusEmulationEnabled', { enabled: true });
  try { return await runFocusedRosterAcceptance(client, userData); }
  finally { await client.call('Emulation.setFocusEmulationEnabled', { enabled: false }); }
}

async function runFocusedRosterAcceptance(client, userData) {
  await client.call('Page.bringToFront');
  const order = () => client.evaluate(`[...document.querySelectorAll('#accountRoster .account-card')].map(card => card.dataset.agentId)`);
  const selected = await client.evaluate('currentAgentId()');
  const initial = await order();
  assert.ok(initial.length > 3, 'drag fixture must have several agents');
  const point = async (index) => client.evaluate(`(() => {
    const node = document.querySelectorAll('#accountRoster .account-card')[${index}];
    const rect = node.querySelector('.account-card-select').getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  const mouse = (type, position, extra = {}) => client.call('Input.dispatchMouseEvent', {type, ...position, ...extra});
  await client.evaluate(`document.querySelector('#accountRoster').scrollLeft = 0`);
  let start = await point(0);
  await mouse('mousePressed', start, {button: 'left', buttons: 1, clickCount: 1});
  await mouse('mouseReleased', start, {button: 'left', buttons: 0, clickCount: 1});
  assert.equal(await client.evaluate('currentAgentId()'), initial[0], 'short press must select normally');
  assert.deepEqual(await order(), initial, 'short press must not reorder');
  start = await point(0); const target = await point(2);
  await mouse('mousePressed', start, {button: 'left', buttons: 1, clickCount: 1});
  await waitFor(client, `document.querySelector('#accountRoster').classList.contains('roster-reordering')`, 'long-press reorder activation');
  await mouse('mouseMoved', target, {button: 'left', buttons: 1});
  await client.call('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
  await client.call('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27});
  await mouse('mouseReleased', target, {button: 'left', buttons: 0, clickCount: 1});
  assert.deepEqual(await order(), initial, 'Esc must restore the starting order');
  assert.equal(await client.evaluate('currentAgentId()'), initial[0], 'cancelled drag cannot select another card');
  start = await point(0);
  await mouse('mousePressed', start, {button: 'left', buttons: 1, clickCount: 1});
  await waitFor(client, `document.querySelector('#accountRoster').classList.contains('roster-reordering')`, 'blur-cancel reorder activation');
  await mouse('mouseMoved', target, {button: 'left', buttons: 1});
  await client.evaluate(`window.dispatchEvent(new Event('blur'))`);
  await mouse('mouseReleased', target, {button: 'left', buttons: 0, clickCount: 1});
  assert.deepEqual(await order(), initial, 'window blur must restore the starting order');
  assert.equal(await client.evaluate('rosterController.isInteracting()'), false, 'window blur must end the gesture');
  assert.equal(await client.evaluate('currentAgentId()'), initial[0], 'blur-cancelled drag cannot select another card');
  start = await point(0);
  await mouse('mousePressed', start, {button: 'left', buttons: 1, clickCount: 1});
  await waitFor(client, `document.querySelector('#accountRoster').classList.contains('roster-reordering')`, 'long-press reorder activation');
  await mouse('mouseMoved', target, {button: 'left', buttons: 1});
  await mouse('mouseReleased', target, {button: 'left', buttons: 0, clickCount: 1});
  const dragged = await order();
  assert.notDeepEqual(dragged, initial, 'long press must commit a changed order');
  assert.equal(await client.evaluate('currentAgentId()'), initial[0], 'drag must not change the selected Agent');
  await client.evaluate(`document.querySelector('#accountRoster').scrollLeft = 0`);
  const wheelPoint = await point(0);
  await mouse('mouseWheel', wheelPoint, {deltaX: 0, deltaY: 180});
  await new Promise(resolve => setTimeout(resolve, 150));
  const scrolled = await client.evaluate(`document.querySelector('#accountRoster').scrollLeft`);
  assert.ok(scrolled > 0, 'vertical mouse wheel must scroll roster horizontally');
  await client.evaluate('renderAccountRoster()');
  assert.equal(await client.evaluate(`document.querySelector('#accountRoster').scrollLeft`), scrolled, 'refresh must preserve manual scroll');
  const movingId = dragged[1];
  await client.evaluate(`[...document.querySelectorAll('#accountRoster .account-card')].find(card => card.dataset.agentId === ${JSON.stringify(movingId)}).querySelector('.account-card-select').focus()`);
  await client.call('Input.dispatchKeyEvent', {type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, modifiers: 1});
  await client.call('Input.dispatchKeyEvent', {type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37, modifiers: 1});
  const reordered = await order();
  assert.equal(reordered[0], movingId, 'Alt+Left must move the focused Agent');
  assert.equal(await client.evaluate(`document.activeElement.closest('.account-card')?.dataset.agentId`), movingId, 'keyboard reorder must retain focus');
  const deadline = Date.now() + 5000;
  let saved;
  do {
    saved = JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).settings;
    if (JSON.stringify(saved.agentOrder) === JSON.stringify(reordered)) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  assert.deepEqual(saved.agentOrder, reordered, 'order must be written to disk');
  await client.evaluate(`selectAgent(${JSON.stringify(selected)})`);
  process.stdout.write('✓ real pointer/keyboard roster sorting, wheel and refresh scroll preservation\n');
  return reordered;
}


async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-ui-acceptance-'));
  const userData = path.join(tempRoot, 'user-data');
  const firstUseData = path.join(tempRoot, 'first-use-user-data');
  const rosterData = path.join(tempRoot, 'roster-user-data');
  const artifactDir = process.env.AGENTDESK_UI_ACCEPTANCE_ARTIFACTS
    ? path.resolve(process.env.AGENTDESK_UI_ACCEPTANCE_ARTIFACTS)
    : null;
  const keepTemp = process.env.AGENTDESK_UI_ACCEPTANCE_KEEP_TEMP === '1';
  let instance = null;
  const output = [];
  const checks = [];

  try {
    instance = await launchElectronApp(firstUseData, output);
    checks.push(...await runFreshFirstUseInitialization(instance.client, firstUseData, artifactDir));
    await closeElectronApp(instance);
    instance = null;

    instance = await launchElectronApp(firstUseData, output);
    checks.push(...await runFreshFirstUseRecovery(instance.client, firstUseData, artifactDir));
    await closeElectronApp(instance);
    instance = null;

    seedUserData(rosterData);
    instance = await launchElectronApp(rosterData, output);
    const expectedOrder = await runRosterAcceptance(instance.client, rosterData);
    checks.push('roster pointer keyboard and wheel');
    await closeElectronApp(instance);
    instance = await launchElectronApp(rosterData, output);
    await waitFor(instance.client, `typeof state !== 'undefined' && state.profiles.length === 8
      && !document.querySelector('#welcomeDialog').open`, 'roster restart');
    assert.deepEqual(await instance.client.evaluate('state.agentOrder'), expectedOrder);
    assert.deepEqual(await instance.client.evaluate(`[...document.querySelectorAll('#accountRoster .account-card')].map(card => card.dataset.agentId)`), expectedOrder);
    checks.push('roster order survives application restart');
    await closeElectronApp(instance);
    instance = null;

    seedUserData(userData);
    instance = await launchElectronApp(userData, output);
    checks.push(...await runAcceptance(instance.client, artifactDir));
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
    await closeElectronApp(instance);
    if (keepTemp) process.stdout.write(`Temporary userData kept at: ${userData}\n`);
    else fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write(`\nUI acceptance failed: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
