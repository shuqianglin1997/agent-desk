/*
 * AgentDesk Workgraph v2 renderer/controller.
 *
 * Loaded after renderer.js so these definitions replace the fixed v1 board
 * while sharing the existing session, handoff and terminal services.
 */

var workgraphCoordinatorBusyV2 = false;

function workgraphApi() {
  return window.AgentDeskWorkgraphs || null;
}

function activeWorkgraph() {
  return state.workgraphs.find((graph) => graph.id === state.activeWorkgraphId) || null;
}

function workgraphRefKey(value) {
  return value?.sessionKey || sessionKey(value);
}

function workgraphSessionSnapshot(session) {
  if (!session) {
    return {
      sessionKey: '',
      profileId: '',
      sessionId: '',
      appId: '',
      title: '',
      accountName: '',
      profileName: '',
      projectPath: null,
      filePath: null,
      source: null
    };
  }
  const profileId = session._profileId || session.profileId || '';
  const owner = state.profiles.find((profile) => profile.id === profileId) || null;
  return {
    sessionKey: workgraphRefKey(session),
    profileId,
    sessionId: session.id || session.sessionId || '',
    appId: session.appId || owner?.appId || '',
    title: session.title || tr('handoff.artifacts.untitled'),
    accountName: session._accountName || session.accountName || owner?.name || '',
    profileName: session._profileName || session.profileName || owner?.name || '',
    projectPath: session.projectPath || null,
    filePath: session.filePath || null,
    source: session.source || null
  };
}

function workgraphLiveSession(ref) {
  const key = workgraphRefKey(ref);
  if (!key) return null;
  return state.sessions.find((session) => sessionKey(session) === key)
    || state.handoffSelection.get(key)
    || null;
}

function workgraphSessionOptions() {
  const byKey = new Map();
  for (const session of [...state.sessions, ...state.handoffSelection.values()]) {
    const key = sessionKey(session);
    if (key) byKey.set(key, session);
  }
  for (const graph of state.workgraphs) {
    for (const node of graph.nodes || []) {
      if (node.sessionKey && !byKey.has(node.sessionKey)) byKey.set(node.sessionKey, node);
    }
  }
  return [...byKey.values()].sort((left, right) => (
    new Date(right.updatedAt || right.createdAt || 0).getTime()
    - new Date(left.updatedAt || left.createdAt || 0).getTime()
  ));
}

function activeWorkgraphRun(graph = activeWorkgraph()) {
  if (!graph) return null;
  return workgraphApi()?.latestRun(graph) || null;
}

function workgraphActiveRuns(graph) {
  const terminal = workgraphApi()?.TERMINAL_RUN_STATUSES || new Set(['completed', 'failed', 'cancelled']);
  return (graph?.runs || []).filter((run) => !terminal.has(run.status));
}

function workgraphStructureLocked(graph) {
  return workgraphActiveRuns(graph).some((run) => !run.deferred);
}

function workgraphProgress(graph) {
  return workgraphApi()?.workgraphProgress(graph) || {
    total: graph?.nodes?.length || 0,
    completed: 0,
    failed: 0,
    running: 0,
    waitingApproval: 0,
    stalled: 0,
    waiting: graph?.nodes?.length || 0,
    ready: false
  };
}

function synchronizeWorkgraphState(graph) {
  if (!graph) return null;
  graph.status = workgraphApi()?.deriveWorkgraphStatus(graph) || graph.status || 'draft';
  return graph;
}

function markWorkgraphDirty(graph) {
  if (!graph) return;
  graph.updatedAt = new Date().toISOString();
  state.workgraphDirty = true;
}

async function loadWorkgraphs() {
  if (!window.manager.listWorkgraphs || !workgraphApi()) {
    state.workgraphs = [];
    state.activeWorkgraphId = null;
    renderWorkgraphTopCount();
    return;
  }
  try {
    const items = await window.manager.listWorkgraphs();
    state.workgraphs = workgraphApi().normalizeWorkgraphList(items, {
      id: () => cryptoId(),
      now: () => Date.now()
    });
    if (!state.workgraphs.some((graph) => graph.id === state.activeWorkgraphId)) {
      state.activeWorkgraphId = state.workgraphs[0]?.id || null;
    }
    await reconcileInterruptedWorkgraphs();
  } catch (_error) {
    state.workgraphs = [];
    state.activeWorkgraphId = null;
  }
  state.workgraphDirty = false;
  renderWorkgraphTopCount();
  renderWorkgraphDialog();
}

async function reconcileInterruptedWorkgraphs() {
  const liveRuntimeIds = new Set(state.runtime.runtimes.map((runtime) => runtime.id));
  for (const graph of state.workgraphs) {
    let changed = false;
    for (const run of workgraphActiveRuns(graph)) {
      for (const [nodeId, nodeRun] of Object.entries(run.nodeRuns || {})) {
        for (const activation of nodeRun.activations || []) {
          if (
            activation.status !== 'running'
            || !activation.runtimeId
            || liveRuntimeIds.has(activation.runtimeId)
          ) continue;
          activation.status = 'stalled';
          activation.error = tr('workgraph.error.interrupted');
          activation.runtimeId = null;
          activation.lastActivityAt = new Date().toISOString();
          nodeRun.status = 'stalled';
          run.status = 'attention';
          changed = true;
        }
      }
    }
    if (changed) {
      markWorkgraphDirty(graph);
      await saveWorkgraph(graph);
    }
  }
}

async function openWorkgraphDialog() {
  if (!els.workgraphDialog) return;
  if (!state.workgraphs.length && selectedHandoffSessions().length) {
    await createWorkgraphFromSelection({ open: false, allowEmpty: false });
  }
  renderWorkgraphDialog();
  if (!els.workgraphDialog.open) {
    els.workgraphDialog.showModal();
    requestAnimationFrame(() => fitActiveWorkgraph({ centerOnly: true }));
  }
}

async function createWorkgraphFromSelection({ open = true, allowEmpty = false } = {}) {
  const api = workgraphApi();
  if (!api) return null;
  let sessions = selectedHandoffSessions();
  if (!sessions.length && selectedSession()) sessions = [selectedSession()];
  if (!sessions.length && !allowEmpty) {
    setStatus(tr('status.workgraphSelectFirst'));
    renderWorkgraphDialog();
    if (open && els.workgraphDialog && !els.workgraphDialog.open) els.workgraphDialog.showModal();
    return null;
  }
  const graph = api.createWorkgraph({
    title: sessions.length
      ? tr('workgraph.defaultName', { n: sessions.length })
      : tr('workgraph.defaultBlankName'),
    sessions: sessions.map(workgraphSessionSnapshot),
    taskPrompt: tr('workgraph.defaultTaskPrompt'),
    executionMode: 'observe',
    dispatchMode: 'automatic',
    schedule: { enabled: false, type: 'manual' },
    monitor: {
      enabled: true,
      intervalSeconds: 30,
      staleAfterMinutes: 10,
      timeoutMinutes: 90,
      recovery: 'alert',
      maxConcurrency: 4
    }
  }, {
    id: () => cryptoId(),
    now: () => Date.now()
  });
  state.workgraphs.unshift(graph);
  state.activeWorkgraphId = graph.id;
  state.workgraphSelectedNodeId = graph.nodes[0]?.id || null;
  state.workgraphSelectedEdgeId = null;
  state.workgraphInspectorTab = 'node';
  state.workgraphDirty = true;
  await saveWorkgraph(graph);
  renderWorkgraphDialog();
  if (open && els.workgraphDialog && !els.workgraphDialog.open) {
    els.workgraphDialog.showModal();
  }
  requestAnimationFrame(() => fitActiveWorkgraph({ centerOnly: true }));
  return graph;
}

function replaceSavedWorkgraph(saved, snapshotText = null) {
  const index = state.workgraphs.findIndex((graph) => graph.id === saved.id);
  const current = index >= 0 ? state.workgraphs[index] : null;
  if (current && snapshotText && JSON.stringify(current) !== snapshotText) {
    state.workgraphDirty = true;
    return current;
  }
  if (index >= 0) state.workgraphs[index] = saved;
  else state.workgraphs.unshift(saved);
  state.workgraphs.sort((left, right) => (
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  ));
  if (state.activeWorkgraphId === saved.id) state.workgraphDirty = false;
  return saved;
}

function saveWorkgraph(graph, { announce = false } = {}) {
  if (!graph || !window.manager.saveWorkgraph || !workgraphApi()) return Promise.resolve(null);
  synchronizeWorkgraphState(graph);
  markWorkgraphDirty(graph);
  const snapshot = workgraphApi().normalizeWorkgraph(graph, {
    id: () => cryptoId(),
    now: () => Date.now()
  });
  const snapshotText = JSON.stringify(graph);
  workgraphSaveQueue = workgraphSaveQueue
    .catch(() => null)
    .then(async () => {
      const result = await window.manager.saveWorkgraph(snapshot);
      if (!result?.ok || !result.graph) {
        throw new Error(result?.reason || tr('status.workgraphSaveFail'));
      }
      const saved = workgraphApi().normalizeWorkgraph(result.graph, {
        id: () => cryptoId(),
        now: () => Date.now()
      });
      replaceSavedWorkgraph(saved, snapshotText);
      renderWorkgraphTopCount();
      if (els.workgraphDialog?.open) renderWorkgraphDialog();
      if (announce) setStatus(tr('status.workgraphSaved', { title: saved.title }));
      return saved;
    })
    .catch((error) => {
      state.workgraphDirty = true;
      if (announce) setStatus(error?.message || tr('status.workgraphSaveFail'));
      return null;
    });
  return workgraphSaveQueue;
}

function saveActiveWorkgraph(options = {}) {
  return saveWorkgraph(activeWorkgraph(), options);
}

async function deleteActiveWorkgraph() {
  const graph = activeWorkgraph();
  if (!graph || !window.manager.removeWorkgraph) return;
  if (workgraphActiveRuns(graph).length) {
    setStatus(tr('status.workgraphDeleteRunning'));
    return;
  }
  if (!window.confirm(tr('workgraph.confirm.delete', { title: graph.title }))) return;
  const result = await window.manager.removeWorkgraph(graph.id);
  if (!result?.ok) {
    setStatus(tr('status.workgraphDeleteFail'));
    return;
  }
  state.workgraphs = state.workgraphs.filter((item) => item.id !== graph.id);
  state.activeWorkgraphId = state.workgraphs[0]?.id || null;
  state.workgraphSelectedNodeId = null;
  state.workgraphSelectedEdgeId = null;
  state.workgraphDirty = false;
  renderWorkgraphTopCount();
  renderWorkgraphDialog();
  setStatus(tr('status.workgraphDeleted', { title: graph.title }));
}

function renderWorkgraphTopCount() {
  if (!els.workgraphTopCount) return;
  const count = state.workgraphs.filter((graph) => (
    ['running', 'waiting', 'attention', 'paused', 'scheduled'].includes(
      synchronizeWorkgraphState(graph)?.status
    )
  )).length;
  els.workgraphTopCount.hidden = count === 0;
  els.workgraphTopCount.textContent = String(count);
  els.workgraphBtn?.classList.toggle('has-active-graphs', count > 0);
}

function renderWorkgraphDialog() {
  if (!els.workgraphDialog) return;
  renderWorkgraphTopCount();
  renderWorkgraphFleetSummary();
  renderWorkgraphList();
  renderWorkgraphSessionDepot();
  const graph = activeWorkgraph();
  if (els.workgraphEmpty) els.workgraphEmpty.hidden = Boolean(graph);
  if (els.workgraphEditor) els.workgraphEditor.hidden = !graph;
  if (els.workgraphTitleInput) els.workgraphTitleInput.disabled = !graph;
  if (els.workgraphExecutionMode) els.workgraphExecutionMode.disabled = !graph;
  if (graph) renderWorkgraphEditor(graph);
  else renderWorkgraphInspector(null);
}

function renderWorkgraphFleetSummary() {
  if (!els.workgraphFleetSummary) return;
  const active = state.workgraphs.flatMap((graph) => workgraphActiveRuns(graph));
  const attention = active.filter((run) => ['attention', 'paused'].includes(run.status)).length;
  const running = active.filter((run) => ['running', 'waiting', 'queued'].includes(run.status)).length;
  const strong = els.workgraphFleetSummary.querySelector('strong');
  const small = els.workgraphFleetSummary.querySelector('small');
  const stateName = attention ? 'attention' : running ? 'running' : 'idle';
  els.workgraphFleetSummary.dataset.state = stateName;
  if (strong) {
    strong.textContent = active.length
      ? tr('workgraph.fleet.active', { n: active.length })
      : tr('workgraph.fleet.idle');
  }
  if (small) {
    small.textContent = attention
      ? tr('workgraph.fleet.attention', { n: attention })
      : running
        ? tr('workgraph.fleet.running', { n: running })
        : tr('workgraph.fleet.idleMeta');
  }
}

function renderWorkgraphList() {
  if (!els.workgraphList || !els.workgraphSavedSummary) return;
  els.workgraphList.replaceChildren();
  els.workgraphSavedSummary.textContent = state.workgraphs.length
    ? tr('workgraph.saved.summary', { n: state.workgraphs.length })
    : tr('workgraph.saved.empty');
  for (const graph of state.workgraphs) {
    synchronizeWorkgraphState(graph);
    const progress = workgraphProgress(graph);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'workgraph-list-item';
    button.dataset.state = graph.status;
    button.setAttribute('aria-current', String(graph.id === state.activeWorkgraphId));
    const copy = document.createElement('span');
    copy.className = 'workgraph-list-copy';
    const title = document.createElement('strong');
    title.textContent = graph.title;
    const meta = document.createElement('small');
    meta.textContent = [
      workgraphStatusLabel(graph.status),
      tr('workgraph.nodeProgress', { completed: progress.completed, total: progress.total })
    ].join(' · ');
    copy.append(title, meta);
    button.append(copy);
    button.addEventListener('click', () => {
      state.activeWorkgraphId = graph.id;
      state.workgraphSelectedNodeId = graph.nodes[0]?.id || null;
      state.workgraphSelectedEdgeId = null;
      state.workgraphConnectFrom = null;
      state.workgraphDirty = false;
      renderWorkgraphDialog();
      requestAnimationFrame(() => fitActiveWorkgraph({ centerOnly: true }));
    });
    const item = document.createElement('li');
    item.append(button);
    els.workgraphList.append(item);
  }
}

function renderWorkgraphSessionDepot() {
  if (!els.workgraphSessionList) return;
  const query = state.workgraphSessionQuery;
  const sessions = workgraphSessionOptions().filter((session) => {
    if (!query) return true;
    const haystack = [
      session.title,
      session._accountName,
      session.accountName,
      session._profileName,
      session.profileName,
      session.projectPath,
      session.appId
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query);
  }).slice(0, 120);
  els.workgraphSessionList.replaceChildren();
  if (els.workgraphSessionCount) els.workgraphSessionCount.textContent = String(sessions.length);
  for (const session of sessions) {
    const snapshot = workgraphSessionSnapshot(session);
    const ticket = document.createElement('article');
    ticket.className = 'workgraph-session-ticket';
    ticket.draggable = true;
    ticket.dataset.sessionKey = snapshot.sessionKey;
    ticket.style.setProperty('--ticket-color', appColor(snapshot.appId));
    const badge = document.createElement('span');
    badge.textContent = (appLabel(snapshot.appId) || 'AG').slice(0, 2).toUpperCase();
    const copy = document.createElement('p');
    const title = document.createElement('strong');
    title.textContent = snapshot.title;
    const meta = document.createElement('small');
    meta.textContent = [
      snapshot.accountName || snapshot.profileName,
      shortPath(snapshot.projectPath)
    ].filter((value) => value && value !== '-').join(' · ');
    copy.append(title, meta);
    ticket.append(badge, copy);
    ticket.addEventListener('dragstart', (event) => {
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData('application/x-agentdesk-session', snapshot.sessionKey);
      event.dataTransfer.setData('text/plain', snapshot.sessionKey);
    });
    ticket.addEventListener('dblclick', () => {
      const viewport = els.workgraphCanvasViewport;
      addSessionToActiveWorkgraph(snapshot.sessionKey, {
        x: (viewport?.scrollLeft || 0) + Math.max(60, (viewport?.clientWidth || 500) / 2 - 100),
        y: (viewport?.scrollTop || 0) + Math.max(60, (viewport?.clientHeight || 500) / 2 - 55)
      });
    });
    els.workgraphSessionList.append(ticket);
  }
}

function workgraphCanvasPoint(event) {
  const rect = els.workgraphCanvas?.getBoundingClientRect();
  if (!rect) return { x: 80, y: 80 };
  return {
    x: Math.max(0, Math.min(1380, Math.round(event.clientX - rect.left - 105))),
    y: Math.max(0, Math.min(850, Math.round(event.clientY - rect.top - 55)))
  };
}

function addSessionToActiveWorkgraph(key, position) {
  const graph = activeWorkgraph();
  if (!graph) {
    setStatus(tr('status.workgraphCreateFirst'));
    return;
  }
  if (workgraphStructureLocked(graph)) {
    setStatus(tr('status.workgraphStructureLocked'));
    return;
  }
  if (graph.nodes.length >= workgraphApi().MAX_NODES) {
    setStatus(tr('status.workgraphNodeLimit', { n: workgraphApi().MAX_NODES }));
    return;
  }
  const session = workgraphSessionOptions().find((item) => sessionKey(item) === key);
  if (!session) return;
  const snapshot = workgraphSessionSnapshot(session);
  const node = workgraphApi().normalizeNode({
    id: cryptoId(),
    type: 'session',
    session: snapshot,
    title: snapshot.title,
    prompt: tr('workgraph.defaultTaskPrompt'),
    position,
    trigger: { mode: 'all', threshold: 2 },
    policy: {
      requiresApproval: false,
      maxRetries: 0,
      timeoutMinutes: 0,
      staleAfterMinutes: 0,
      recovery: 'inherit'
    }
  }, graph.nodes.length, { id: () => cryptoId(), now: () => Date.now() });
  graph.nodes.push(node);
  state.workgraphSelectedNodeId = node.id;
  state.workgraphSelectedEdgeId = null;
  state.workgraphInspectorTab = 'node';
  markWorkgraphDirty(graph);
  renderWorkgraphEditor(graph);
  void saveWorkgraph(graph);
}

function addWorkgraphUtilityNode(type) {
  const graph = activeWorkgraph();
  if (!graph) return;
  if (workgraphStructureLocked(graph)) {
    setStatus(tr('status.workgraphStructureLocked'));
    return;
  }
  const viewport = els.workgraphCanvasViewport;
  const position = {
    x: (viewport?.scrollLeft || 0) + Math.max(70, (viewport?.clientWidth || 500) / 2 - 95),
    y: (viewport?.scrollTop || 0) + Math.max(70, (viewport?.clientHeight || 500) / 2 - 55)
  };
  const node = workgraphApi().normalizeNode({
    id: cryptoId(),
    type,
    title: type === 'approval'
      ? tr('workgraph.defaultApprovalName')
      : tr('workgraph.defaultDelayName'),
    description: type === 'approval'
      ? tr('workgraph.defaultApprovalDescription')
      : tr('workgraph.defaultDelayDescription'),
    delaySeconds: 300,
    position,
    trigger: { mode: 'all', threshold: 2 },
    policy: { recovery: 'inherit' }
  }, graph.nodes.length, { id: () => cryptoId(), now: () => Date.now() });
  graph.nodes.push(node);
  state.workgraphSelectedNodeId = node.id;
  state.workgraphSelectedEdgeId = null;
  state.workgraphInspectorTab = 'node';
  markWorkgraphDirty(graph);
  renderWorkgraphEditor(graph);
  void saveWorkgraph(graph);
}

function autoLayoutActiveWorkgraph() {
  const graph = activeWorkgraph();
  if (!graph?.nodes.length) return;
  const incoming = new Map(graph.nodes.map((node) => [node.id, []]));
  const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    incoming.get(edge.to)?.push(edge.from);
    outgoing.get(edge.from)?.push(edge.to);
  }
  const depth = new Map();
  const queue = graph.nodes.filter((node) => !incoming.get(node.id)?.length).map((node) => node.id);
  queue.forEach((id) => depth.set(id, 0));
  while (queue.length) {
    const current = queue.shift();
    for (const target of outgoing.get(current) || []) {
      const nextDepth = Math.max(depth.get(target) || 0, (depth.get(current) || 0) + 1);
      if (depth.get(target) !== nextDepth) depth.set(target, nextDepth);
      if (!queue.includes(target)) queue.push(target);
    }
  }
  const columns = new Map();
  graph.nodes.forEach((node) => {
    const value = depth.get(node.id) || 0;
    if (!columns.has(value)) columns.set(value, []);
    columns.get(value).push(node);
  });
  for (const [column, nodes] of columns) {
    nodes.forEach((node, index) => {
      node.position = {
        x: 70 + column * 310,
        y: 70 + index * 165
      };
    });
  }
  markWorkgraphDirty(graph);
  renderWorkgraphEditor(graph);
  fitActiveWorkgraph({ centerOnly: true });
  void saveWorkgraph(graph);
}

function fitActiveWorkgraph({ centerOnly = false } = {}) {
  const graph = activeWorkgraph();
  const viewport = els.workgraphCanvasViewport;
  if (!graph?.nodes.length || !viewport) {
    if (viewport) viewport.scrollTo({ left: 0, top: 0, behavior: centerOnly ? 'auto' : 'smooth' });
    return;
  }
  const minX = Math.min(...graph.nodes.map((node) => node.position.x));
  const maxX = Math.max(...graph.nodes.map((node) => node.position.x + 220));
  const minY = Math.min(...graph.nodes.map((node) => node.position.y));
  const maxY = Math.max(...graph.nodes.map((node) => node.position.y + 120));
  const left = Math.max(0, (minX + maxX - viewport.clientWidth) / 2);
  const top = Math.max(0, (minY + maxY - viewport.clientHeight) / 2);
  viewport.scrollTo({ left, top, behavior: centerOnly ? 'auto' : 'smooth' });
}

function selectedWorkgraphNode() {
  return activeWorkgraph()?.nodes.find((node) => node.id === state.workgraphSelectedNodeId) || null;
}

function selectedWorkgraphEdge() {
  return activeWorkgraph()?.edges.find((edge) => edge.id === state.workgraphSelectedEdgeId) || null;
}

function renderWorkgraphEditor(graph) {
  if (!graph) return;
  synchronizeWorkgraphState(graph);
  if (!graph.nodes.some((node) => node.id === state.workgraphSelectedNodeId)) {
    state.workgraphSelectedNodeId = null;
  }
  if (!graph.edges.some((edge) => edge.id === state.workgraphSelectedEdgeId)) {
    state.workgraphSelectedEdgeId = null;
  }
  if (document.activeElement !== els.workgraphTitleInput) els.workgraphTitleInput.value = graph.title;
  els.workgraphExecutionMode.value = graph.executionMode;
  els.workgraphStatusBadge.dataset.state = graph.status;
  els.workgraphStatusBadge.textContent = workgraphStatusLabel(graph.status);
  const validation = workgraphApi().validateWorkgraph(graph);
  const progress = workgraphProgress(graph);
  const run = activeWorkgraphRun(graph);
  els.workgraphRunDot.dataset.state = graph.status;
  const text = workgraphRunText(graph, progress, run, validation);
  els.workgraphRunSummary.textContent = text.title;
  els.workgraphRunMeta.textContent = text.meta;
  const activeRuns = workgraphActiveRuns(graph);
  els.workgraphStartBtn.disabled = !validation.ok
    || activeRuns.filter((item) => !item.deferred).length >= graph.schedule.maxConcurrentRuns;
  els.workgraphPauseBtn.hidden = !activeRuns.some((item) => !item.deferred);
  els.workgraphPauseBtn.textContent = activeRuns.some((item) => item.status === 'paused')
    ? tr('workgraph.resume')
    : tr('workgraph.pause');
  els.workgraphDeleteBtn.disabled = activeRuns.length > 0;
  els.workgraphCopyBtn.disabled = !run;
  els.workgraphAddApprovalBtn.disabled = workgraphStructureLocked(graph);
  els.workgraphAddDelayBtn.disabled = workgraphStructureLocked(graph);
  renderWorkgraphCanvas(graph);
  renderWorkgraphInspector(graph);
}

function renderWorkgraphCanvas(graph) {
  if (!els.workgraphNodeLayer || !els.workgraphEdgeLayer) return;
  els.workgraphNodeLayer.replaceChildren();
  els.workgraphEdgeLayer.replaceChildren();
  els.workgraphCanvasEmpty.hidden = graph.nodes.length > 0;
  renderWorkgraphEdges(graph);
  const run = activeWorkgraphRun(graph);
  graph.nodes.forEach((node, index) => {
    const nodeRun = run?.nodeRuns?.[node.id] || null;
    const card = document.createElement('article');
    card.className = 'workgraph-node';
    card.dataset.nodeId = node.id;
    card.dataset.type = node.type;
    card.dataset.state = nodeRun?.status || 'waiting';
    card.setAttribute('aria-current', String(node.id === state.workgraphSelectedNodeId));
    card.style.left = `${node.position.x}px`;
    card.style.top = `${node.position.y}px`;

    const inputPort = document.createElement('button');
    inputPort.type = 'button';
    inputPort.className = 'workgraph-node-port';
    inputPort.dataset.port = 'in';
    inputPort.title = tr('workgraph.connect.input');
    inputPort.addEventListener('click', (event) => {
      event.stopPropagation();
      completeWorkgraphConnection(node.id);
    });

    const outputPort = document.createElement('button');
    outputPort.type = 'button';
    outputPort.className = 'workgraph-node-port';
    outputPort.dataset.port = 'out';
    outputPort.dataset.active = String(state.workgraphConnectFrom === node.id);
    outputPort.title = tr('workgraph.connect.output');
    outputPort.addEventListener('click', (event) => {
      event.stopPropagation();
      state.workgraphConnectFrom = state.workgraphConnectFrom === node.id ? null : node.id;
      renderWorkgraphEditor(graph);
    });

    const head = document.createElement('header');
    head.className = 'workgraph-node-head';
    const badge = document.createElement('span');
    badge.textContent = node.type === 'session'
      ? (appLabel(node.appId) || 'AG').slice(0, 2).toUpperCase()
      : node.type === 'approval' ? 'OK' : 'T+';
    const copy = document.createElement('div');
    copy.className = 'workgraph-node-copy';
    const title = document.createElement('strong');
    title.textContent = node.title;
    const meta = document.createElement('small');
    meta.textContent = node.type === 'session'
      ? [node.accountName || node.profileName, appLabel(node.appId)].filter(Boolean).join(' · ')
      : workgraphNodeTypeLabel(node.type);
    copy.append(title, meta);
    const status = document.createElement('span');
    status.className = 'workgraph-node-state';
    status.textContent = workgraphNodeStatusLabel(nodeRun?.status || 'waiting');
    head.append(badge, copy, status);

    const body = document.createElement('div');
    body.className = 'workgraph-node-body';
    const description = document.createElement('p');
    description.textContent = node.prompt || node.description || (
      node.type === 'delay'
        ? tr('workgraph.node.delaySummary', { n: node.delaySeconds })
        : tr('workgraph.node.noPrompt')
    );
    const policy = document.createElement('strong');
    policy.textContent = workgraphNodePolicySummary(node);
    body.append(description, policy);

    const foot = document.createElement('footer');
    foot.className = 'workgraph-node-foot';
    const incoming = graph.edges.filter((edge) => edge.to === node.id).length;
    const rule = document.createElement('b');
    rule.textContent = incoming
      ? workgraphTriggerLabel(node.trigger.mode, node.trigger.threshold)
      : tr('workgraph.trigger.root');
    const count = document.createElement('span');
    count.textContent = tr('workgraph.node.activations', {
      n: nodeRun?.activations?.length || 0,
      incoming
    });
    foot.append(rule, count);

    card.append(inputPort, outputPort, head, body, foot);
    card.addEventListener('click', () => {
      state.workgraphSelectedNodeId = node.id;
      state.workgraphSelectedEdgeId = null;
      state.workgraphInspectorTab = 'node';
      renderWorkgraphEditor(graph);
    });
    card.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest('button')) return;
      workgraphNodeDrag = {
        graphId: graph.id,
        nodeId: node.id,
        startX: event.clientX,
        startY: event.clientY,
        originX: node.position.x,
        originY: node.position.y,
        moved: false
      };
      event.preventDefault();
    });
    els.workgraphNodeLayer.append(card);
  });
  if (els.workgraphConnectHint) {
    els.workgraphConnectHint.dataset.state = state.workgraphConnectFrom ? 'connecting' : 'idle';
    const text = els.workgraphConnectHint.querySelector('span');
    if (text) {
      const from = graph.nodes.find((node) => node.id === state.workgraphConnectFrom);
      text.textContent = from
        ? tr('workgraph.connect.pickTarget', { title: from.title })
        : tr('workgraph.connect.hint');
    }
  }
}

function svgWorkgraphElement(tag) {
  return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function renderWorkgraphEdges(graph) {
  if (!els.workgraphEdgeLayer) return;
  els.workgraphEdgeLayer.replaceChildren();
  const defs = svgWorkgraphElement('defs');
  const markerColors = {
    success: '#2d8069',
    failure: '#c85c3c',
    always: '#2d7087'
  };
  Object.entries(markerColors).forEach(([condition, color]) => {
    const marker = svgWorkgraphElement('marker');
    marker.id = `workgraph-arrow-${condition}`;
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '6');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('orient', 'auto-start-reverse');
    const path = svgWorkgraphElement('path');
    path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
    path.setAttribute('fill', color);
    marker.append(path);
    defs.append(marker);
  });
  els.workgraphEdgeLayer.append(defs);
  for (const edge of graph.edges) {
    const from = graph.nodes.find((node) => node.id === edge.from);
    const to = graph.nodes.find((node) => node.id === edge.to);
    if (!from || !to) continue;
    const fromWidth = from.type === 'session' ? 218 : 190;
    const toWidth = to.type === 'session' ? 218 : 190;
    const x1 = from.position.x + fromWidth;
    const y1 = from.position.y + 56;
    const x2 = to.position.x;
    const y2 = to.position.y + 56;
    const distance = Math.max(60, Math.abs(x2 - x1) * 0.45);
    const direction = x2 >= x1 ? 1 : -1;
    const d = `M ${x1} ${y1} C ${x1 + distance * direction} ${y1}, ${x2 - distance * direction} ${y2}, ${x2} ${y2}`;
    const group = svgWorkgraphElement('g');
    group.classList.add('workgraph-edge-group');
    group.dataset.edgeId = edge.id;
    group.setAttribute('aria-current', String(edge.id === state.workgraphSelectedEdgeId));
    const path = svgWorkgraphElement('path');
    path.classList.add('workgraph-edge');
    path.dataset.when = edge.when;
    path.setAttribute('d', d);
    path.setAttribute('marker-end', `url(#workgraph-arrow-${edge.when})`);
    const selectEdge = (event) => {
      event.stopPropagation();
      state.workgraphSelectedEdgeId = edge.id;
      state.workgraphSelectedNodeId = null;
      state.workgraphConnectFrom = null;
      state.workgraphInspectorTab = 'node';
      renderWorkgraphEditor(graph);
    };
    path.addEventListener('click', selectEdge);
    const hit = svgWorkgraphElement('path');
    hit.classList.add('workgraph-edge-hit');
    hit.setAttribute('d', d);
    hit.addEventListener('click', selectEdge);
    group.append(path, hit);
    const label = edge.label || workgraphEdgeConditionLabel(edge.when);
    if (label) {
      const text = svgWorkgraphElement('text');
      text.classList.add('workgraph-edge-label');
      text.setAttribute('x', String((x1 + x2) / 2));
      text.setAttribute('y', String((y1 + y2) / 2 - 7));
      text.setAttribute('text-anchor', 'middle');
      text.textContent = label;
      text.addEventListener('click', selectEdge);
      group.append(text);
    }
    els.workgraphEdgeLayer.append(group);
  }
}

function completeWorkgraphConnection(targetId) {
  const graph = activeWorkgraph();
  const from = state.workgraphConnectFrom;
  if (!graph || !from) {
    state.workgraphSelectedNodeId = targetId;
    state.workgraphSelectedEdgeId = null;
    renderWorkgraphEditor(graph);
    return;
  }
  if (workgraphStructureLocked(graph)) {
    setStatus(tr('status.workgraphStructureLocked'));
    state.workgraphConnectFrom = null;
    renderWorkgraphEditor(graph);
    return;
  }
  const validation = workgraphApi().validateEdgeAddition(graph, from, targetId);
  if (!validation.ok) {
    setStatus(tr(`status.workgraphEdge.${validation.reason}`));
    state.workgraphConnectFrom = null;
    renderWorkgraphEditor(graph);
    return;
  }
  const edge = workgraphApi().normalizeEdge({
    id: cryptoId(),
    from,
    to: targetId,
    when: 'success',
    order: graph.edges.length
  }, graph.edges.length, { id: () => cryptoId() });
  graph.edges.push(edge);
  state.workgraphConnectFrom = null;
  state.workgraphSelectedNodeId = null;
  state.workgraphSelectedEdgeId = edge.id;
  markWorkgraphDirty(graph);
  renderWorkgraphEditor(graph);
  void saveWorkgraph(graph);
}

function handleWorkgraphNodePointerMove(event) {
  if (!workgraphNodeDrag) return;
  const graph = state.workgraphs.find((item) => item.id === workgraphNodeDrag.graphId);
  const node = graph?.nodes.find((item) => item.id === workgraphNodeDrag.nodeId);
  if (!graph || !node) {
    workgraphNodeDrag = null;
    return;
  }
  const dx = event.clientX - workgraphNodeDrag.startX;
  const dy = event.clientY - workgraphNodeDrag.startY;
  if (Math.abs(dx) + Math.abs(dy) > 3) workgraphNodeDrag.moved = true;
  node.position.x = Math.max(0, Math.min(1380, Math.round((workgraphNodeDrag.originX + dx) / 10) * 10));
  node.position.y = Math.max(0, Math.min(850, Math.round((workgraphNodeDrag.originY + dy) / 10) * 10));
  const card = els.workgraphNodeLayer?.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`);
  if (card) {
    card.style.left = `${node.position.x}px`;
    card.style.top = `${node.position.y}px`;
  }
  renderWorkgraphEdges(graph);
}

function handleWorkgraphNodePointerUp() {
  if (!workgraphNodeDrag) return;
  const graph = state.workgraphs.find((item) => item.id === workgraphNodeDrag.graphId);
  const moved = workgraphNodeDrag.moved;
  workgraphNodeDrag = null;
  if (graph && moved) {
    markWorkgraphDirty(graph);
    void saveWorkgraph(graph);
  }
}

function renderWorkgraphInspector(graph) {
  const tab = ['node', 'schedule', 'runs'].includes(state.workgraphInspectorTab)
    ? state.workgraphInspectorTab
    : 'node';
  state.workgraphInspectorTab = tab;
  els.workgraphInspector?.querySelectorAll('[data-workgraph-tab]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.workgraphTab === tab));
    button.disabled = !graph;
  });
  els.workgraphNodePane.hidden = tab !== 'node';
  els.workgraphSchedulePane.hidden = tab !== 'schedule';
  els.workgraphRunsPane.hidden = tab !== 'runs';
  if (!graph) {
    els.workgraphInspectorEmpty.hidden = false;
    els.workgraphNodeInspector.hidden = true;
    els.workgraphEdgeInspector.hidden = true;
    return;
  }
  if (tab === 'node') renderWorkgraphNodeInspector(graph);
  if (tab === 'schedule') renderWorkgraphTimingInspector(graph);
  if (tab === 'runs') renderWorkgraphRuns(graph);
}

function renderWorkgraphNodeInspector(graph) {
  const node = selectedWorkgraphNode();
  const edge = selectedWorkgraphEdge();
  els.workgraphInspectorEmpty.hidden = Boolean(node || edge);
  els.workgraphNodeInspector.hidden = !node;
  els.workgraphEdgeInspector.hidden = !edge;
  if (edge) {
    const from = graph.nodes.find((item) => item.id === edge.from);
    const to = graph.nodes.find((item) => item.id === edge.to);
    els.workgraphEdgeRoute.textContent = `${from?.title || '?'}  →  ${to?.title || '?'}`;
    els.workgraphEdgeWhenSelect.value = edge.when;
    if (document.activeElement !== els.workgraphEdgeLabelInput) {
      els.workgraphEdgeLabelInput.value = edge.label || '';
    }
    const locked = workgraphStructureLocked(graph);
    els.workgraphEdgeWhenSelect.disabled = locked;
    els.workgraphEdgeLabelInput.disabled = locked;
    els.workgraphDeleteEdgeBtn.disabled = locked;
    return;
  }
  if (!node) return;
  const locked = workgraphStructureLocked(graph);
  els.workgraphNodeTypeBadge.textContent = node.type.toUpperCase();
  els.workgraphNodeInspectorTitle.textContent = node.title;
  if (document.activeElement !== els.workgraphNodeTitleInput) els.workgraphNodeTitleInput.value = node.title;
  els.workgraphNodeSessionField.hidden = node.type !== 'session';
  els.workgraphNodePromptField.hidden = node.type !== 'session';
  els.workgraphNodeDelayField.hidden = node.type !== 'delay';
  els.workgraphNodeApprovalInput.closest('label').hidden = node.type !== 'session';
  els.workgraphNodeTriggerMode.value = node.trigger.mode;
  els.workgraphNodeThresholdField.hidden = node.trigger.mode !== 'threshold';
  els.workgraphNodeThresholdInput.value = String(node.trigger.threshold);
  els.workgraphNodeDelayInput.value = String(node.delaySeconds);
  els.workgraphNodeApprovalInput.checked = node.policy.requiresApproval;
  els.workgraphNodeRetriesInput.value = String(node.policy.maxRetries);
  els.workgraphNodeTimeoutInput.value = String(node.policy.timeoutMinutes);
  els.workgraphNodeStaleInput.value = String(node.policy.staleAfterMinutes);
  els.workgraphNodeRecoverySelect.value = node.policy.recovery;
  if (document.activeElement !== els.workgraphNodePromptInput) {
    els.workgraphNodePromptInput.value = node.prompt || '';
  }
  renderWorkgraphNodeSessionOptions(node);
  [
    els.workgraphNodeTitleInput,
    els.workgraphNodeSessionSelect,
    els.workgraphNodePromptInput,
    els.workgraphNodeTriggerMode,
    els.workgraphNodeThresholdInput,
    els.workgraphNodeDelayInput,
    els.workgraphNodeApprovalInput,
    els.workgraphNodeRetriesInput,
    els.workgraphNodeTimeoutInput,
    els.workgraphNodeStaleInput,
    els.workgraphNodeRecoverySelect,
    els.workgraphDeleteNodeBtn
  ].forEach((element) => {
    if (element) element.disabled = locked;
  });
  els.workgraphOpenNodeSessionBtn.disabled = node.type !== 'session' || !node.sessionKey;
  renderWorkgraphNodeRuntime(graph, node);
}

function renderWorkgraphNodeSessionOptions(node) {
  if (!els.workgraphNodeSessionSelect) return;
  const active = document.activeElement === els.workgraphNodeSessionSelect;
  if (active) return;
  els.workgraphNodeSessionSelect.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = tr('workgraph.node.unbound');
  els.workgraphNodeSessionSelect.append(placeholder);
  for (const session of workgraphSessionOptions()) {
    const snapshot = workgraphSessionSnapshot(session);
    const option = document.createElement('option');
    option.value = snapshot.sessionKey;
    option.textContent = [
      snapshot.title,
      snapshot.accountName || snapshot.profileName,
      appLabel(snapshot.appId)
    ].filter(Boolean).join(' · ');
    els.workgraphNodeSessionSelect.append(option);
  }
  els.workgraphNodeSessionSelect.value = node.sessionKey || '';
}

function renderWorkgraphNodeRuntime(graph, node) {
  els.workgraphNodeRuntime.replaceChildren();
  const run = activeWorkgraphRun(graph);
  const nodeRun = run?.nodeRuns?.[node.id];
  if (!run || !nodeRun) return;
  nodeRun.activations.forEach((activation, index) => {
    const article = document.createElement('article');
    article.dataset.state = activation.status;
    const dot = document.createElement('i');
    const copy = document.createElement('p');
    const title = document.createElement('strong');
    title.textContent = tr('workgraph.activation.title', {
      n: index + 1,
      status: workgraphNodeStatusLabel(activation.status)
    });
    const meta = document.createElement('small');
    meta.textContent = [
      tr('workgraph.activation.attempt', { n: activation.attempt }),
      activation.error || compactDate(activation.startedAt || activation.queuedAt)
    ].filter(Boolean).join(' · ');
    copy.append(title, meta);
    const actions = document.createElement('span');
    if (activation.status === 'waiting_approval') {
      actions.append(
        workgraphRuntimeButton(tr('workgraph.approve'), () => {
          void handleWorkgraphActivationAction(graph, run, node, activation, 'approve');
        }),
        workgraphRuntimeButton(tr('workgraph.reject'), () => {
          void handleWorkgraphActivationAction(graph, run, node, activation, 'reject');
        })
      );
    } else if (['running', 'queued'].includes(activation.status)) {
      actions.append(
        workgraphRuntimeButton(tr('workgraph.task.complete'), () => {
          void handleWorkgraphActivationAction(graph, run, node, activation, 'complete');
        }),
        workgraphRuntimeButton(tr('workgraph.task.blocked'), () => {
          void handleWorkgraphActivationAction(graph, run, node, activation, 'fail');
        })
      );
    } else if (['failed', 'timed_out', 'stalled', 'cancelled'].includes(activation.status)) {
      actions.append(workgraphRuntimeButton(tr('workgraph.task.retry'), () => {
        void handleWorkgraphActivationAction(graph, run, node, activation, 'retry');
      }));
    }
    article.append(dot, copy, actions);
    els.workgraphNodeRuntime.append(article);
  });
}

function workgraphRuntimeButton(label, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', handler);
  return button;
}

function updateSelectedWorkgraphNodeFromForm() {
  const graph = activeWorkgraph();
  const node = selectedWorkgraphNode();
  if (!graph || !node || workgraphStructureLocked(graph)) return;
  node.title = els.workgraphNodeTitleInput.value.trim().slice(0, 120)
    || workgraphNodeTypeLabel(node.type);
  node.trigger.mode = ['all', 'any', 'each', 'threshold'].includes(els.workgraphNodeTriggerMode.value)
    ? els.workgraphNodeTriggerMode.value
    : 'all';
  node.trigger.threshold = Math.max(1, Math.min(48, Number(els.workgraphNodeThresholdInput.value) || 1));
  node.delaySeconds = Math.max(10, Math.min(86_400, Number(els.workgraphNodeDelayInput.value) || 300));
  node.policy.requiresApproval = els.workgraphNodeApprovalInput.checked;
  node.policy.maxRetries = Math.max(0, Math.min(5, Number(els.workgraphNodeRetriesInput.value) || 0));
  node.policy.timeoutMinutes = Math.max(0, Math.min(1_440, Number(els.workgraphNodeTimeoutInput.value) || 0));
  node.policy.staleAfterMinutes = Math.max(0, Math.min(1_440, Number(els.workgraphNodeStaleInput.value) || 0));
  node.policy.recovery = ['inherit', 'alert', 'retry', 'pause'].includes(els.workgraphNodeRecoverySelect.value)
    ? els.workgraphNodeRecoverySelect.value
    : 'inherit';
  if (node.type === 'session') {
    node.prompt = els.workgraphNodePromptInput.value.slice(0, 6_000);
    const session = workgraphSessionOptions()
      .find((item) => sessionKey(item) === els.workgraphNodeSessionSelect.value);
    if (session) {
      const snapshot = workgraphSessionSnapshot(session);
      Object.assign(node, snapshot);
    }
  }
  els.workgraphNodeThresholdField.hidden = node.trigger.mode !== 'threshold';
  els.workgraphNodeInspectorTitle.textContent = node.title;
  markWorkgraphDirty(graph);
  renderWorkgraphCanvas(graph);
}

function updateSelectedWorkgraphEdgeFromForm() {
  const graph = activeWorkgraph();
  const edge = selectedWorkgraphEdge();
  if (!graph || !edge || workgraphStructureLocked(graph)) return;
  edge.when = ['success', 'failure', 'always'].includes(els.workgraphEdgeWhenSelect.value)
    ? els.workgraphEdgeWhenSelect.value
    : 'success';
  edge.label = els.workgraphEdgeLabelInput.value.trim().slice(0, 80);
  markWorkgraphDirty(graph);
  renderWorkgraphEdges(graph);
}

function deleteSelectedWorkgraphNode() {
  const graph = activeWorkgraph();
  const node = selectedWorkgraphNode();
  if (!graph || !node) return;
  if (workgraphStructureLocked(graph)) {
    setStatus(tr('status.workgraphStructureLocked'));
    return;
  }
  graph.nodes = graph.nodes.filter((item) => item.id !== node.id);
  graph.edges = graph.edges.filter((edge) => edge.from !== node.id && edge.to !== node.id);
  state.workgraphSelectedNodeId = null;
  state.workgraphConnectFrom = null;
  markWorkgraphDirty(graph);
  renderWorkgraphEditor(graph);
  void saveWorkgraph(graph);
}

function deleteSelectedWorkgraphEdge() {
  const graph = activeWorkgraph();
  const edge = selectedWorkgraphEdge();
  if (!graph || !edge) return;
  if (workgraphStructureLocked(graph)) {
    setStatus(tr('status.workgraphStructureLocked'));
    return;
  }
  graph.edges = graph.edges.filter((item) => item.id !== edge.id);
  state.workgraphSelectedEdgeId = null;
  markWorkgraphDirty(graph);
  renderWorkgraphEditor(graph);
  void saveWorkgraph(graph);
}

function renderWorkgraphTimingInspector(graph) {
  const schedule = graph.schedule;
  const monitor = graph.monitor;
  els.workgraphScheduleEnabled.checked = schedule.enabled;
  els.workgraphScheduleType.value = schedule.type;
  els.workgraphScheduleOnceAt.value = workgraphLocalDateTimeValue(schedule.onceAt);
  els.workgraphScheduleInterval.value = String(schedule.intervalMinutes);
  els.workgraphScheduleTime.value = schedule.time;
  els.workgraphScheduleOverlap.value = schedule.overlapPolicy;
  els.workgraphScheduleMaxRuns.value = String(schedule.maxConcurrentRuns);
  els.workgraphScheduleWeekdays.querySelectorAll('input').forEach((input) => {
    input.checked = schedule.weekdays.includes(Number(input.value));
  });
  els.workgraphScheduleOnceField.hidden = schedule.type !== 'once';
  els.workgraphScheduleIntervalField.hidden = schedule.type !== 'interval';
  els.workgraphScheduleCalendarField.hidden = schedule.type !== 'calendar';
  els.workgraphScheduleEnabled.disabled = schedule.type === 'manual';
  els.workgraphMonitorEnabled.checked = monitor.enabled;
  els.workgraphMonitorInterval.value = String(monitor.intervalSeconds);
  els.workgraphMonitorStale.value = String(monitor.staleAfterMinutes);
  els.workgraphMonitorTimeout.value = String(monitor.timeoutMinutes);
  els.workgraphMonitorRecovery.value = monitor.recovery;
  els.workgraphMonitorConcurrency.value = String(monitor.maxConcurrency);
  renderWorkgraphNextSchedule(graph);
}

function workgraphLocalDateTimeValue(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function updateActiveWorkgraphTimingFromForm() {
  const graph = activeWorkgraph();
  if (!graph) return;
  const type = ['manual', 'once', 'interval', 'calendar'].includes(els.workgraphScheduleType.value)
    ? els.workgraphScheduleType.value
    : 'manual';
  const weekdays = [...els.workgraphScheduleWeekdays.querySelectorAll('input:checked')]
    .map((input) => Number(input.value));
  const onceValue = els.workgraphScheduleOnceAt.value;
  const rawSchedule = {
    ...graph.schedule,
    type,
    enabled: type !== 'manual' && els.workgraphScheduleEnabled.checked,
    onceAt: onceValue ? new Date(onceValue).toISOString() : null,
    intervalMinutes: Number(els.workgraphScheduleInterval.value) || 60,
    anchorAt: graph.schedule.anchorAt || new Date().toISOString(),
    time: els.workgraphScheduleTime.value || '09:00',
    weekdays: weekdays.length ? weekdays : [0, 1, 2, 3, 4, 5, 6],
    overlapPolicy: els.workgraphScheduleOverlap.value,
    maxConcurrentRuns: Number(els.workgraphScheduleMaxRuns.value) || 1
  };
  graph.schedule = workgraphApi().initializeSchedule(rawSchedule, Date.now());
  graph.monitor = workgraphApi().normalizeMonitor({
    enabled: els.workgraphMonitorEnabled.checked,
    intervalSeconds: Number(els.workgraphMonitorInterval.value) || 30,
    staleAfterMinutes: Number(els.workgraphMonitorStale.value) || 10,
    timeoutMinutes: Number(els.workgraphMonitorTimeout.value) || 90,
    recovery: els.workgraphMonitorRecovery.value,
    maxConcurrency: Number(els.workgraphMonitorConcurrency.value) || 4,
    lastCheckedAt: graph.monitor.lastCheckedAt
  });
  markWorkgraphDirty(graph);
  synchronizeWorkgraphState(graph);
  renderWorkgraphTimingInspector(graph);
  renderWorkgraphTopCount();
}

function renderWorkgraphNextSchedule(graph) {
  if (!els.workgraphNextSchedule) return;
  els.workgraphNextSchedule.replaceChildren();
  const copy = document.createElement('p');
  const title = document.createElement('strong');
  const meta = document.createElement('small');
  if (graph.schedule.enabled && graph.schedule.nextAt) {
    title.textContent = tr('workgraph.schedule.next', { time: fullDate(graph.schedule.nextAt) });
    meta.textContent = tr('workgraph.schedule.nextMeta', {
      policy: workgraphOverlapLabel(graph.schedule.overlapPolicy)
    });
  } else {
    title.textContent = tr('workgraph.schedule.off');
    meta.textContent = tr('workgraph.schedule.offMeta');
  }
  copy.append(title, meta);
  els.workgraphNextSchedule.append(copy);
}

function renderWorkgraphRuns(graph) {
  const runs = [...graph.runs].sort((left, right) => right.number - left.number);
  const active = activeWorkgraphRun(graph);
  els.workgraphActiveRunCard.replaceChildren();
  if (active) {
    const header = document.createElement('header');
    const title = document.createElement('strong');
    title.textContent = tr('workgraph.run.instance', { n: active.number });
    const status = document.createElement('span');
    status.textContent = workgraphRunStatusLabel(active.status);
    header.append(title, status);
    const progress = workgraphRunProgress(active);
    const meter = document.createElement('div');
    meter.className = 'workgraph-run-meter';
    const fill = document.createElement('i');
    fill.style.width = `${progress.percent}%`;
    meter.append(fill);
    const meta = document.createElement('p');
    meta.textContent = tr('workgraph.run.instanceMeta', {
      completed: progress.completed,
      total: progress.total,
      trigger: workgraphRunTriggerLabel(active.trigger?.type)
    });
    const actions = document.createElement('div');
    actions.className = 'workgraph-inspector-actions';
    if (['running', 'waiting', 'attention', 'paused'].includes(active.status)) {
      actions.append(
        workgraphRuntimeButton(
          active.status === 'paused' ? tr('workgraph.resume') : tr('workgraph.pause'),
          () => { void toggleWorkgraphRunPause(graph, active); }
        ),
        workgraphRuntimeButton(tr('workgraph.cancel'), () => {
          void cancelWorkgraphRun(graph, active);
        })
      );
    }
    els.workgraphActiveRunCard.append(header, meter, meta, actions);
    const events = document.createElement('ol');
    events.className = 'workgraph-event-log';
    active.events.slice(-12).reverse().forEach((event) => {
      const item = document.createElement('li');
      item.dataset.type = event.type;
      const dot = document.createElement('i');
      const text = document.createElement('span');
      text.textContent = workgraphEventMessage(graph, active, event);
      text.title = event.message || event.type;
      const at = document.createElement('time');
      at.textContent = compactDate(event.at);
      item.append(dot, text, at);
      events.append(item);
    });
    els.workgraphActiveRunCard.append(events);
  }
  els.workgraphRunList.replaceChildren();
  for (const run of runs) {
    const item = document.createElement('article');
    item.className = 'workgraph-run-item';
    item.dataset.state = run.status;
    const dot = document.createElement('i');
    const copy = document.createElement('p');
    const title = document.createElement('strong');
    title.textContent = `${tr('workgraph.run.instance', { n: run.number })} · ${workgraphRunStatusLabel(run.status)}`;
    const meta = document.createElement('small');
    meta.textContent = [
      workgraphRunTriggerLabel(run.trigger?.type),
      compactDate(run.startedAt || run.createdAt)
    ].join(' · ');
    copy.append(title, meta);
    const view = document.createElement('button');
    view.type = 'button';
    view.textContent = run.id === graph.activeRunId
      ? tr('workgraph.run.viewing')
      : tr('workgraph.run.view');
    view.disabled = run.id === graph.activeRunId;
    view.addEventListener('click', () => {
      graph.activeRunId = run.id;
      markWorkgraphDirty(graph);
      renderWorkgraphEditor(graph);
      void saveWorkgraph(graph);
    });
    item.append(dot, copy, view);
    els.workgraphRunList.append(item);
  }
}

function workgraphRunProgress(run) {
  const nodeRuns = Object.values(run?.nodeRuns || {});
  const completed = nodeRuns.filter((nodeRun) => (
    ['succeeded', 'skipped'].includes(nodeRun.status)
  )).length;
  return {
    total: nodeRuns.length,
    completed,
    percent: nodeRuns.length ? Math.round(completed / nodeRuns.length * 100) : 0
  };
}

function workgraphStatusLabel(status) {
  const known = new Set(['draft', 'scheduled', 'running', 'waiting', 'attention', 'paused', 'completed']);
  return tr(`workgraph.status.${known.has(status) ? status : 'draft'}`);
}

function workgraphNodeStatusLabel(status) {
  const known = new Set([
    'waiting',
    'queued',
    'waiting_approval',
    'delayed',
    'running',
    'stalled',
    'succeeded',
    'failed',
    'timed_out',
    'blocked',
    'skipped',
    'cancelled',
    'paused'
  ]);
  return tr(`workgraph.nodeStatus.${known.has(status) ? status : 'waiting'}`);
}

function workgraphTaskStatusLabel(status) {
  return workgraphNodeStatusLabel(status);
}

function workgraphRunStatusLabel(status) {
  const known = new Set(['queued', 'running', 'waiting', 'attention', 'paused', 'completed', 'failed', 'cancelled']);
  return tr(`workgraph.runStatus.${known.has(status) ? status : 'queued'}`);
}

function workgraphNodeTypeLabel(type) {
  return tr(`workgraph.nodeType.${['session', 'approval', 'delay'].includes(type) ? type : 'session'}`);
}

function workgraphTriggerLabel(mode, threshold) {
  if (mode === 'threshold') return tr('workgraph.trigger.threshold', { n: threshold });
  return tr(`workgraph.trigger.${['all', 'any', 'each'].includes(mode) ? mode : 'all'}`);
}

function workgraphEdgeConditionLabel(condition) {
  return tr(`workgraph.edge.${['success', 'failure', 'always'].includes(condition) ? condition : 'success'}`);
}

function workgraphNodePolicySummary(node) {
  if (node.type === 'delay') return tr('workgraph.node.delaySummary', { n: node.delaySeconds });
  if (node.type === 'approval') return tr('workgraph.node.approvalSummary');
  const pieces = [
    node.policy.requiresApproval ? tr('workgraph.node.manualGateShort') : null,
    node.policy.maxRetries
      ? tr('workgraph.node.retryShort', { n: node.policy.maxRetries })
      : tr('workgraph.node.noRetryShort')
  ].filter(Boolean);
  return pieces.join(' · ');
}

function workgraphOverlapLabel(policy) {
  return tr(`workgraph.schedule.${['skip', 'queue', 'parallel'].includes(policy) ? policy : 'skip'}`);
}

function workgraphRunTriggerLabel(type) {
  const known = ['manual', 'once', 'interval', 'calendar', 'migration'];
  return tr(`workgraph.runTrigger.${known.includes(type) ? type : 'manual'}`);
}

function workgraphEventMessage(graph, run, event) {
  const node = graph.nodes.find((item) => item.id === event.nodeId) || null;
  const nodeTitle = node?.title || event.nodeId || '';
  if (event.type === 'run-started') {
    return `${workgraphRunTriggerLabel(run.trigger?.type)} · ${workgraphRunStatusLabel('running')}`;
  }
  if (event.type === 'run-queued') {
    return `${workgraphRunTriggerLabel(run.trigger?.type)} · ${workgraphRunStatusLabel('queued')}`;
  }
  if (event.type === 'activation-created') {
    return `${nodeTitle} · ${workgraphTriggerLabel(node?.trigger?.mode, node?.trigger?.threshold)}`;
  }
  if (event.type === 'activation-state') {
    const transition = String(event.message || '').match(/^([a-z_]+) → ([a-z_]+)$/);
    if (transition) {
      return `${nodeTitle} · ${workgraphNodeStatusLabel(transition[1])} → ${workgraphNodeStatusLabel(transition[2])}`;
    }
  }
  if (event.type === 'signal-emitted') {
    const signal = String(event.message || '').match(/^(success|failure|always) signal → (.+)$/);
    if (signal) {
      const target = graph.nodes.find((item) => item.id === signal[2]);
      return `${nodeTitle} · ${workgraphEdgeConditionLabel(signal[1])} → ${target?.title || signal[2]}`;
    }
  }
  if (event.type === 'delay-completed') {
    return `${nodeTitle} · ${workgraphNodeStatusLabel('delayed')} → ${workgraphNodeStatusLabel('succeeded')}`;
  }
  if (event.type === 'node-blocked') {
    return `${nodeTitle} · ${workgraphNodeStatusLabel('blocked')}`;
  }
  if (event.type === 'activation-retry') {
    return `${nodeTitle} · ${event.message}`;
  }
  if (event.type === 'heartbeat-restored') {
    return `${nodeTitle} · ${workgraphNodeStatusLabel('stalled')} → ${workgraphNodeStatusLabel('running')}`;
  }
  if (event.type === 'watchdog-timeout') {
    return `${nodeTitle} · ${workgraphNodeStatusLabel('timed_out')}`;
  }
  if (event.type === 'watchdog-stalled') {
    return `${nodeTitle} · ${workgraphNodeStatusLabel('stalled')}`;
  }
  return [nodeTitle, event.message || event.type].filter(Boolean).join(' · ');
}

function workgraphRunText(graph, progress, run, validation) {
  if (!validation.ok) {
    return {
      title: tr('workgraph.run.invalid'),
      meta: workgraphValidationMessage(validation.errors[0])
    };
  }
  if (!run) {
    return graph.schedule.enabled
      ? {
          title: tr('workgraph.run.scheduled'),
          meta: graph.schedule.nextAt
            ? tr('workgraph.run.scheduledMeta', { time: compactDate(graph.schedule.nextAt) })
            : tr('workgraph.run.draftMeta')
        }
      : { title: tr('workgraph.run.draft'), meta: tr('workgraph.run.draftMeta') };
  }
  if (run.status === 'completed') {
    return { title: tr('workgraph.run.completed'), meta: tr('workgraph.run.completedMeta') };
  }
  if (['failed', 'attention'].includes(run.status)) {
    return {
      title: tr('workgraph.run.attention'),
      meta: tr('workgraph.run.attentionMeta', { n: progress.failed + progress.stalled })
    };
  }
  if (run.status === 'paused') {
    return { title: tr('workgraph.run.paused'), meta: tr('workgraph.run.pausedMeta') };
  }
  if (run.status === 'waiting') {
    return {
      title: tr('workgraph.run.waitingApproval'),
      meta: tr('workgraph.run.waitingApprovalMeta', { n: progress.waitingApproval })
    };
  }
  return {
    title: tr('workgraph.run.running'),
    meta: tr('workgraph.run.runningMeta', {
      completed: progress.completed,
      total: progress.total
    })
  };
}

function workgraphValidationMessage(error) {
  if (!error) return tr('workgraph.validation.unknown');
  return tr(`workgraph.validation.${error.code}`, { node: error.nodeId || '' });
}

async function handleWorkgraphActivationAction(graph, run, node, activation, action) {
  const api = workgraphApi();
  let next = run;
  if (action === 'approve' || action === 'reject') {
    next = api.approveActivation(
      graph,
      run,
      node.id,
      activation.id,
      action === 'approve',
      { id: () => cryptoId(), now: () => Date.now() }
    );
  } else if (action === 'retry') {
    next = api.retryActivation(
      graph,
      run,
      node.id,
      activation.id,
      { id: () => cryptoId(), now: () => Date.now() }
    );
  } else {
    if (activation.runtimeId) {
      try { await window.manager.stopTerminal({ runtimeId: activation.runtimeId }); } catch (_error) { /* done */ }
    }
    next = api.transitionActivation(
      graph,
      run,
      node.id,
      activation.id,
      action === 'complete' ? 'succeeded' : 'failed',
      action === 'fail' ? { error: tr('workgraph.error.manualBlock') } : {},
      { id: () => cryptoId(), now: () => Date.now() }
    );
  }
  replaceWorkgraphRun(graph, next);
  await settleWorkgraph(graph, next);
}

function replaceWorkgraphRun(graph, run) {
  const index = graph.runs.findIndex((item) => item.id === run.id);
  if (index >= 0) graph.runs[index] = run;
  else graph.runs.push(run);
  graph.runs = graph.runs.slice(-workgraphApi().MAX_RUNS);
  graph.activeRunId = run.id;
  synchronizeWorkgraphState(graph);
  markWorkgraphDirty(graph);
  return run;
}

async function startActiveWorkgraph() {
  const graph = activeWorkgraph();
  if (!graph) return;
  const validation = workgraphApi().validateWorkgraph(graph);
  if (!validation.ok) {
    setStatus(workgraphValidationMessage(validation.errors[0]));
    return;
  }
  const live = workgraphActiveRuns(graph).filter((run) => !run.deferred);
  if (live.length >= graph.schedule.maxConcurrentRuns) {
    setStatus(tr('status.workgraphRunLimit', { n: graph.schedule.maxConcurrentRuns }));
    return;
  }
  if (graph.executionMode === 'managed') {
    const ok = window.confirm(tr('workgraph.confirm.managed', { n: graph.nodes.filter((node) => node.type === 'session').length }));
    if (!ok) return;
  }
  await startWorkgraphRun(graph, { trigger: { type: 'manual' } });
}

async function startWorkgraphRun(graph, { trigger = { type: 'manual' }, deferred = false } = {}) {
  const run = workgraphApi().createGraphRun(graph, {
    id: () => cryptoId(),
    runId: cryptoId(),
    number: Math.max(0, ...graph.runs.map((item) => item.number)) + 1,
    now: () => Date.now(),
    trigger,
    deferred
  });
  replaceWorkgraphRun(graph, run);
  await saveWorkgraph(graph);
  renderWorkgraphDialog();
  if (!deferred) {
    setStatus(tr('status.workgraphRunStarted', { title: graph.title, n: run.number }));
    await dispatchQueuedWorkgraphNodes(graph, run);
  }
  return run;
}

async function settleWorkgraph(graph, run) {
  const advanced = workgraphApi().advanceGraphRun(graph, run, {
    id: () => cryptoId(),
    now: () => Date.now()
  });
  replaceWorkgraphRun(graph, advanced);
  await saveWorkgraph(graph);
  renderWorkgraphTopCount();
  if (els.workgraphDialog?.open) renderWorkgraphDialog();
  if (advanced.status === 'completed') {
    setStatus(tr('status.workgraphCompleted', { title: graph.title }));
  } else if (advanced.status === 'failed') {
    setStatus(tr('status.workgraphRunFailed', { title: graph.title }));
  } else {
    await dispatchQueuedWorkgraphNodes(graph, advanced);
  }
  return advanced;
}

async function dispatchQueuedWorkgraphNodes(graph, run) {
  if (!graph || !run || run.deferred || !['running', 'waiting', 'attention'].includes(run.status)) return;
  const busySessionKeys = new Set(workgraphSessionLaunching);
  for (const candidateGraph of state.workgraphs) {
    for (const candidateRun of candidateGraph.runs || []) {
      for (const candidateNode of candidateGraph.nodes || []) {
        if (candidateNode.type !== 'session') continue;
        const isBusy = candidateRun.nodeRuns?.[candidateNode.id]?.activations
          ?.some((activation) => ['running', 'stalled'].includes(activation.status));
        if (isBusy) {
          busySessionKeys.add(candidateNode.sessionKey || `${candidateGraph.id}:${candidateNode.id}`);
        }
      }
    }
  }
  const runningCount = graph.runs.reduce((total, candidate) => (
    total + Object.values(candidate.nodeRuns || {}).reduce((count, nodeRun) => (
      count + (nodeRun.activations || []).filter((activation) => activation.status === 'running').length
    ), 0)
  ), 0);
  let available = Math.max(0, graph.monitor.maxConcurrency - runningCount);
  if (!available) return;
  for (const node of graph.nodes) {
    const nodeRun = run.nodeRuns[node.id];
    if (!nodeRun) continue;
    for (const activation of nodeRun.activations) {
      if (activation.status !== 'queued' || available <= 0) continue;
      const lockKey = `${graph.id}:${run.id}:${activation.id}`;
      if (workgraphLaunching.has(lockKey)) continue;
      if (node.type !== 'session') continue;
      const sessionLockKey = node.sessionKey || `${graph.id}:${node.id}`;
      if (busySessionKeys.has(sessionLockKey)) continue;
      available -= 1;
      busySessionKeys.add(sessionLockKey);
      if (graph.executionMode === 'observe') {
        const next = workgraphApi().transitionActivation(
          graph,
          run,
          node.id,
          activation.id,
          'running',
          {},
          { id: () => cryptoId(), now: () => Date.now() }
        );
        replaceWorkgraphRun(graph, next);
        run = next;
        continue;
      }
      workgraphLaunching.add(lockKey);
      workgraphSessionLaunching.add(sessionLockKey);
      void startManagedWorkgraphNode(graph, run, node, activation)
        .finally(() => {
          workgraphLaunching.delete(lockKey);
          workgraphSessionLaunching.delete(sessionLockKey);
        });
    }
  }
  await saveWorkgraph(graph);
  if (els.workgraphDialog?.open) renderWorkgraphDialog();
}

async function workgraphAdapterFor(ref) {
  if (!window.manager.listTerminalAdapters) return null;
  const adapters = await window.manager.listTerminalAdapters(ref.profileId || null);
  const preferredId = ref.appId === 'codex'
    ? 'codex'
    : (ref.appId === 'claude' || ref.appId === 'claude-cli' ? 'claude' : null);
  return (Array.isArray(adapters) ? adapters : []).find((adapter) => (
    adapter.id === preferredId && adapter.mode === 'agent' && adapter.available
  )) || (Array.isArray(adapters) ? adapters : []).find((adapter) => (
    adapter.mode === 'agent' && adapter.available
  )) || null;
}

async function startManagedWorkgraphNode(graph, run, node, activation) {
  const adapter = await workgraphAdapterFor(node);
  if (!adapter) {
    const failed = workgraphApi().transitionActivation(
      graph,
      run,
      node.id,
      activation.id,
      'failed',
      { error: tr('workgraph.error.noAgent') },
      { id: () => cryptoId(), now: () => Date.now() }
    );
    replaceWorkgraphRun(graph, failed);
    await settleWorkgraph(graph, failed);
    return false;
  }
  const profile = state.profiles.find((item) => item.id === node.profileId) || null;
  const identityProfileId = adapter.identityAppId && profile?.appId === adapter.identityAppId
    ? profile.id
    : null;
  const result = await window.manager.startTerminal({
    adapterId: adapter.id,
    identityProfileId,
    workspaceProfileId: node.profileId || null,
    sessionId: node.sessionId || null,
    title: `${graph.title} · ${node.title} · #${run.number}`
  });
  const latestRun = graph.runs.find((item) => item.id === run.id) || run;
  if (!result?.ok) {
    const failed = workgraphApi().transitionActivation(
      graph,
      latestRun,
      node.id,
      activation.id,
      result?.cancelled ? 'cancelled' : 'failed',
      { error: result?.reason || tr('workgraph.error.launchFail') },
      { id: () => cryptoId(), now: () => Date.now() }
    );
    replaceWorkgraphRun(graph, failed);
    await settleWorkgraph(graph, failed);
    return false;
  }
  const running = workgraphApi().transitionActivation(
    graph,
    latestRun,
    node.id,
    activation.id,
    'running',
    { runtimeId: result.id },
    { id: () => cryptoId(), now: () => Date.now() }
  );
  replaceWorkgraphRun(graph, running);
  await saveWorkgraph(graph);
  if (result.status === 'ready') {
    await sendManagedWorkgraphNode(graph, running, node, activation.id);
  }
  if (els.workgraphDialog?.open) renderWorkgraphDialog();
  return true;
}

function locateWorkgraphActivation(graph, runId, nodeId, activationId) {
  const run = graph.runs.find((item) => item.id === runId) || null;
  const node = graph.nodes.find((item) => item.id === nodeId) || null;
  const activation = run?.nodeRuns?.[nodeId]?.activations
    ?.find((item) => item.id === activationId) || null;
  return { run, node, activation };
}

async function sendManagedWorkgraphNode(graph, run, node, activationId) {
  const current = locateWorkgraphActivation(graph, run.id, node.id, activationId);
  if (!current.activation?.runtimeId || current.activation.dispatchedAt) return false;
  current.activation.dispatchedAt = new Date().toISOString();
  current.activation.lastActivityAt = current.activation.dispatchedAt;
  const text = await makeManagedWorkgraphNodePrompt(graph, current.run, node, current.activation);
  const result = await window.manager.sendTerminal({
    runtimeId: current.activation.runtimeId,
    text
  });
  if (!result?.ok) {
    const failed = workgraphApi().transitionActivation(
      graph,
      current.run,
      node.id,
      activationId,
      'failed',
      { error: result?.reason || tr('workgraph.error.sendFail') },
      { id: () => cryptoId(), now: () => Date.now() }
    );
    replaceWorkgraphRun(graph, failed);
    await settleWorkgraph(graph, failed);
    return false;
  }
  markWorkgraphDirty(graph);
  await saveWorkgraph(graph);
  return true;
}

async function makeManagedWorkgraphNodePrompt(graph, run, node, activation) {
  const tokenSet = new Set(activation.inputTokenIds || []);
  const inputTokens = (run.tokens || []).filter((token) => tokenSet.has(token.id));
  const upstream = [];
  for (const token of inputTokens) {
    const sourceNode = graph.nodes.find((item) => item.id === token.from);
    const sourceActivation = run.nodeRuns[token.from]?.activations
      ?.find((item) => item.id === token.sourceActivationId);
    if (!sourceNode || !sourceActivation) continue;
    const live = workgraphLiveSession(sourceNode);
    if (live) await prepareHandoffArtifacts([live], { announce: false });
    const artifacts = live ? selectedSessionArtifacts(live).slice(0, 4) : [];
    upstream.push([
      `## ${sourceNode.title}`,
      `${tr('workgraph.edge.title')}: ${workgraphEdgeConditionLabel(
        graph.edges.find((edge) => edge.id === token.edgeId)?.when || 'success'
      )}`,
      sourceActivation.output || sourceActivation.error || tr('workgraph.handoff.noResult'),
      artifacts.length
        ? artifacts.map((artifact) => [
            `### ${artifact.title}`,
            artifact.relativePath || artifact.path || tr('handoff.artifacts.virtualPath'),
            artifact.content
          ].join('\n\n')).join('\n\n')
        : ''
    ].filter(Boolean).join('\n\n'));
  }
  let ownContext = '';
  const live = workgraphLiveSession(node);
  if (!inputTokens.length && live) {
    await prepareHandoffArtifacts([live], { announce: false });
    const owner = sessionOwnerProfile(live);
    if (owner) ownContext = makeHandoffText(owner, live);
  }
  const instruction = [
    `# ${graph.title} · ${node.title}`,
    tr('workgraph.managedNode', {
      run: run.number,
      task: node.prompt || tr('workgraph.defaultTaskPrompt')
    }),
    upstream.length ? `# ${tr('workgraph.handoff.upstream')}\n\n${upstream.join('\n\n---\n\n')}` : null,
    ownContext || null
  ].filter(Boolean).join('\n\n---\n\n');
  return clipUtf8(instruction, 32 * 1024).text;
}

function locateWorkgraphRuntime(runtimeId) {
  for (const graph of state.workgraphs) {
    for (const run of graph.runs || []) {
      for (const node of graph.nodes || []) {
        const activation = run.nodeRuns?.[node.id]?.activations
          ?.find((item) => item.runtimeId === runtimeId);
        if (activation) return { graph, run, node, activation };
      }
    }
  }
  return null;
}

function handleWorkgraphRuntimeEvent(event) {
  if (!event?.runtimeId) return;
  const link = locateWorkgraphRuntime(event.runtimeId);
  if (!link) return;
  const { graph, run, node, activation } = link;
  if (event.type === 'output' && event.text && ['agent', 'tool', 'stderr', 'stdout'].includes(event.stream)) {
    activation.output = `${activation.output || ''}${event.text}`.slice(-12_000);
    activation.lastActivityAt = new Date().toISOString();
    if (event.stream === 'stderr') {
      activation.error = String(event.text).trim().slice(0, 1_000) || activation.error;
    }
    run.updatedAt = activation.lastActivityAt;
    scheduleWorkgraphOutputSave(graph);
  }
  if (event.type !== 'state') return;
  if (event.status === 'ready') {
    if (!activation.dispatchedAt) {
      void sendManagedWorkgraphNode(graph, run, node, activation.id);
      return;
    }
    if (activation.status === 'running') {
      const completed = workgraphApi().transitionActivation(
        graph,
        run,
        node.id,
        activation.id,
        'succeeded',
        { output: activation.output },
        { id: () => cryptoId(), now: () => Date.now() }
      );
      replaceWorkgraphRun(graph, completed);
      void settleWorkgraph(graph, completed);
    }
    return;
  }
  if (['error', 'exited', 'stopped'].includes(event.status)) {
    const failed = workgraphApi().transitionActivation(
      graph,
      run,
      node.id,
      activation.id,
      event.status === 'stopped' ? 'cancelled' : 'failed',
      { error: activation.error || tr('workgraph.error.runtimeExit') },
      { id: () => cryptoId(), now: () => Date.now() }
    );
    replaceWorkgraphRun(graph, failed);
    void settleWorkgraph(graph, failed);
  }
}

function scheduleWorkgraphOutputSave(graph) {
  clearTimeout(workgraphOutputTimers.get(graph.id));
  const timer = setTimeout(() => {
    workgraphOutputTimers.delete(graph.id);
    void saveWorkgraph(graph);
  }, 650);
  workgraphOutputTimers.set(graph.id, timer);
  if (els.workgraphDialog?.open && graph.id === state.activeWorkgraphId) {
    renderWorkgraphCanvas(graph);
    renderWorkgraphNodeInspector(graph);
  }
}

async function copyActiveWorkgraphHandoff() {
  const graph = activeWorkgraph();
  const run = activeWorkgraphRun(graph);
  if (!graph || !run) return;
  const text = await makeWorkgraphHandoff(graph, run, 384 * 1024);
  await window.manager.writeClipboard(text);
  setStatus(tr('status.workgraphCopied', { n: graph.nodes.length }));
}

async function makeWorkgraphHandoff(graph, run, maxBytes) {
  const sessionNodes = graph.nodes.filter((node) => node.type === 'session');
  const liveSessions = sessionNodes.map(workgraphLiveSession).filter(Boolean);
  if (liveSessions.length) await prepareHandoffArtifacts(liveSessions, { announce: false });
  const blocks = [
    tr('workgraph.handoff.graphHeader', {
      title: graph.title,
      run: run.number,
      status: workgraphRunStatusLabel(run.status),
      n: graph.nodes.length
    })
  ];
  graph.nodes.forEach((node, index) => {
    const nodeRun = run.nodeRuns[node.id];
    if (!nodeRun) return;
    const live = workgraphLiveSession(node);
    const artifacts = live ? selectedSessionArtifacts(live).slice(0, 4) : [];
    const artifactText = artifacts.map((artifact) => [
      `#### ${artifact.title}`,
      `${artifact.relativePath || artifact.path || tr('handoff.artifacts.virtualPath')}`,
      artifact.content
    ].join('\n\n')).join('\n\n');
    const activationText = nodeRun.activations.map((activation, activationIndex) => [
      `### ${tr('workgraph.activation.title', {
        n: activationIndex + 1,
        status: workgraphNodeStatusLabel(activation.status)
      })}`,
      activation.output || activation.error || tr('workgraph.handoff.noResult')
    ].join('\n\n')).join('\n\n');
    blocks.push(tr('workgraph.handoff.node', {
      index: index + 1,
      title: node.title,
      type: workgraphNodeTypeLabel(node.type),
      account: node.accountName || node.profileName || tr('common.unrecorded'),
      trigger: workgraphTriggerLabel(node.trigger.mode, node.trigger.threshold),
      task: node.prompt || node.description || tr('common.unrecorded'),
      result: activationText || tr('workgraph.handoff.noResult'),
      artifacts: artifactText || tr('workgraph.handoff.noArtifacts')
    }));
  });
  const body = clipUtf8(blocks.join('\n\n---\n\n'), maxBytes);
  return [
    body.text,
    body.truncated ? tr('workgraph.handoff.truncated') : null
  ].filter(Boolean).join('\n\n---\n\n');
}

async function toggleActiveWorkgraphPause() {
  const graph = activeWorkgraph();
  if (!graph) return;
  const active = workgraphActiveRuns(graph).filter((run) => !run.deferred);
  if (!active.length) return;
  for (const run of active) await toggleWorkgraphRunPause(graph, run, { save: false });
  await saveWorkgraph(graph);
  renderWorkgraphDialog();
}

async function toggleWorkgraphRunPause(graph, run, { save = true } = {}) {
  if (run.status === 'paused') {
    run.status = 'running';
    run.events.push({
      id: cryptoId(),
      type: 'run-resumed',
      message: tr('workgraph.event.resumed'),
      at: new Date().toISOString(),
      sequence: (run.events.at(-1)?.sequence || 0) + 1
    });
    const advanced = workgraphApi().advanceGraphRun(graph, run, {
      id: () => cryptoId(),
      now: () => Date.now()
    });
    replaceWorkgraphRun(graph, advanced);
    await dispatchQueuedWorkgraphNodes(graph, advanced);
  } else {
    run.status = 'paused';
    run.events.push({
      id: cryptoId(),
      type: 'run-paused',
      message: tr('workgraph.event.paused'),
      at: new Date().toISOString(),
      sequence: (run.events.at(-1)?.sequence || 0) + 1
    });
    replaceWorkgraphRun(graph, run);
  }
  if (save) await saveWorkgraph(graph);
  renderWorkgraphDialog();
}

async function cancelWorkgraphRun(graph, run) {
  if (!window.confirm(tr('workgraph.confirm.cancel', { n: run.number }))) return;
  for (const nodeRun of Object.values(run.nodeRuns || {})) {
    for (const activation of nodeRun.activations || []) {
      if (activation.runtimeId) {
        try { await window.manager.stopTerminal({ runtimeId: activation.runtimeId }); } catch (_error) { /* done */ }
      }
      if (!workgraphApi().TERMINAL_ACTIVATION_STATUSES.has(activation.status)) {
        activation.status = 'cancelled';
        activation.runtimeId = null;
        activation.completedAt = new Date().toISOString();
      }
    }
    nodeRun.status = workgraphApi().summarizeNodeRun(nodeRun);
  }
  run.status = 'cancelled';
  run.completedAt = new Date().toISOString();
  run.events.push({
    id: cryptoId(),
    type: 'run-cancelled',
    message: tr('workgraph.event.cancelled'),
    at: run.completedAt,
    sequence: (run.events.at(-1)?.sequence || 0) + 1
  });
  replaceWorkgraphRun(graph, run);
  await saveWorkgraph(graph);
  renderWorkgraphDialog();
}

function startWorkgraphCoordinator() {
  if (workgraphCoordinatorTimer) clearInterval(workgraphCoordinatorTimer);
  workgraphCoordinatorTimer = setInterval(() => {
    void workgraphCoordinatorTick();
  }, 5_000);
  void workgraphCoordinatorTick();
}

async function workgraphCoordinatorTick() {
  if (workgraphCoordinatorBusyV2 || !workgraphApi()) return;
  workgraphCoordinatorBusyV2 = true;
  try {
    const now = Date.now();
    for (const graph of state.workgraphs) {
      let changed = false;
      if (graph.schedule.enabled && !graph.schedule.nextAt) {
        graph.schedule = workgraphApi().initializeSchedule(graph.schedule, now);
        changed = true;
      }
      if (workgraphApi().scheduleIsDue(graph, now)) {
        const active = workgraphActiveRuns(graph).filter((run) => !run.deferred);
        const policy = graph.schedule.overlapPolicy;
        const canParallel = active.length < graph.schedule.maxConcurrentRuns;
        const scheduledFor = graph.schedule.nextAt;
        if (!active.length || (policy === 'parallel' && canParallel)) {
          await startWorkgraphRun(graph, {
            trigger: { type: graph.schedule.type, scheduledFor }
          });
        } else if (policy === 'queue') {
          await startWorkgraphRun(graph, {
            trigger: { type: graph.schedule.type, scheduledFor },
            deferred: true
          });
        }
        graph.schedule = workgraphApi().markScheduleTriggered(graph.schedule, now);
        changed = true;
      }

      const running = workgraphActiveRuns(graph).filter((run) => !run.deferred);
      const deferred = workgraphActiveRuns(graph).filter((run) => run.deferred);
      if (!running.length && deferred.length) {
        const queued = deferred.sort((left, right) => left.number - right.number)[0];
        const activated = workgraphApi().activateDeferredRun(graph, queued, {
          id: () => cryptoId(),
          now: () => Date.now()
        });
        replaceWorkgraphRun(graph, activated);
        await dispatchQueuedWorkgraphNodes(graph, activated);
        changed = true;
      }

      for (const run of workgraphActiveRuns(graph).filter((item) => !item.deferred)) {
        let current = workgraphApi().advanceGraphRun(graph, run, {
          id: () => cryptoId(),
          now: () => Date.now()
        });
        const lastCheck = new Date(current.lastWatchdogAt || 0).getTime();
        if (
          graph.monitor.enabled
          && now - lastCheck >= graph.monitor.intervalSeconds * 1_000
        ) {
          const sweep = workgraphApi().sweepWatchdog(graph, current, {
            id: () => cryptoId(),
            now: () => Date.now()
          });
          current = sweep.run;
          for (const action of sweep.actions) {
            if (action.runtimeId && action.type === 'retry') {
              try { await window.manager.stopTerminal({ runtimeId: action.runtimeId }); } catch (_error) { /* done */ }
            }
          }
          graph.monitor.lastCheckedAt = new Date().toISOString();
          changed = changed || sweep.actions.length > 0;
        }
        if (JSON.stringify(current) !== JSON.stringify(run)) changed = true;
        replaceWorkgraphRun(graph, current);
        await dispatchQueuedWorkgraphNodes(graph, current);
      }
      if (changed) await saveWorkgraph(graph);
    }
    if (els.workgraphDialog?.open) renderWorkgraphDialog();
  } finally {
    workgraphCoordinatorBusyV2 = false;
  }
}
