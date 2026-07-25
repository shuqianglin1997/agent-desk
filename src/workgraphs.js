/*
 * AgentDesk — Workgraph definition, scheduler and watchdog.
 *
 * A graph definition is reusable. Every execution creates an isolated run with
 * its own activations, signals and event log. Keeping definitions and runs
 * separate is what allows schedules, retries and several graphs to run at once.
 *
 * This module is dependency-free so the Electron main process can normalize
 * persisted payloads while the sandboxed renderer can use the same semantics.
 */

(function exposeWorkgraphs(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AgentDeskWorkgraphs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function workgraphFactory() {
  const WORKGRAPH_VERSION = 2;
  const MAX_WORKGRAPHS = 30;
  const MAX_NODES = 48;
  const MAX_TASKS = MAX_NODES;
  const MAX_EDGES = 160;
  const MAX_RUNS = 16;
  const MAX_ACTIVATIONS_PER_NODE = 64;
  const MAX_EVENTS = 240;
  const MAX_TITLE_LENGTH = 120;
  const MAX_PROMPT_LENGTH = 6_000;
  const MAX_NOTE_LENGTH = 8_000;
  const MAX_OUTPUT_LENGTH = 12_000;

  const GRAPH_STATUSES = new Set([
    'draft',
    'scheduled',
    'running',
    'waiting',
    'attention',
    'paused',
    'completed'
  ]);
  const RUN_STATUSES = new Set([
    'queued',
    'running',
    'waiting',
    'attention',
    'paused',
    'completed',
    'failed',
    'cancelled'
  ]);
  const NODE_TYPES = new Set(['session', 'approval', 'delay']);
  const NODE_STATUSES = new Set([
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
  const ACTIVATION_STATUSES = new Set([
    'queued',
    'waiting_approval',
    'delayed',
    'running',
    'stalled',
    'succeeded',
    'failed',
    'timed_out',
    'skipped',
    'cancelled'
  ]);
  const TERMINAL_ACTIVATION_STATUSES = new Set([
    'succeeded',
    'failed',
    'timed_out',
    'skipped',
    'cancelled'
  ]);
  const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'cancelled']);
  const TRIGGER_MODES = new Set(['all', 'any', 'each', 'threshold']);
  const EDGE_CONDITIONS = new Set(['success', 'failure', 'always']);
  const EXECUTION_MODES = new Set(['observe', 'managed']);
  const DISPATCH_MODES = new Set(['review', 'automatic']);
  const SCHEDULE_TYPES = new Set(['manual', 'once', 'interval', 'calendar']);
  const OVERLAP_POLICIES = new Set(['skip', 'queue', 'parallel']);
  const RECOVERY_POLICIES = new Set(['alert', 'retry', 'pause']);
  const NODE_RECOVERY_POLICIES = new Set(['inherit', 'alert', 'retry', 'pause']);
  const FAILURE_POLICIES = new Set(['stop', 'continue']);

  function isObject(value) {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
  }

  function boundedText(value, maxLength, fallback = '') {
    const text = typeof value === 'string' ? value.trim() : '';
    return (text || fallback).slice(0, maxLength);
  }

  function optionalText(value, maxLength) {
    return boundedText(value, maxLength, '') || null;
  }

  function safeId(value, fallback) {
    return boundedText(value, 180, fallback).replace(/[\u0000-\u001f\u007f]/g, '');
  }

  function safeNumber(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function safeInteger(value, fallback, min, max) {
    return Math.round(safeNumber(value, fallback, min, max));
  }

  function isoDate(value, fallback = null) {
    const timestamp = new Date(value || '').getTime();
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
  }

  function nowIso(options = {}) {
    const value = typeof options.now === 'function' ? options.now() : options.now;
    return isoDate(value, new Date().toISOString());
  }

  function makeId(options, prefix) {
    if (typeof options?.id === 'function') return safeId(options.id(), `${prefix}-${Date.now()}`);
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeSessionRef(value = {}) {
    const input = isObject(value) ? value : {};
    return {
      sessionKey: safeId(input.sessionKey, ''),
      profileId: safeId(input.profileId, ''),
      sessionId: safeId(input.sessionId, ''),
      appId: boundedText(input.appId, 80),
      title: boundedText(input.title, MAX_TITLE_LENGTH, 'Untitled session'),
      accountName: boundedText(input.accountName, MAX_TITLE_LENGTH),
      profileName: boundedText(input.profileName, MAX_TITLE_LENGTH),
      projectPath: optionalText(input.projectPath, 2_048),
      filePath: optionalText(input.filePath, 2_048),
      source: optionalText(input.source, 120)
    };
  }

  function normalizePosition(value = {}, fallback = {}) {
    const input = isObject(value) ? value : {};
    return {
      x: safeInteger(input.x, fallback.x || 80, 0, 2_300),
      y: safeInteger(input.y, fallback.y || 80, 0, 1_500)
    };
  }

  function normalizeTrigger(value = {}, fallbackMode = 'all') {
    const input = isObject(value) ? value : {};
    const modeCandidate = input.mode || input.joinMode || fallbackMode;
    const mode = TRIGGER_MODES.has(modeCandidate) ? modeCandidate : fallbackMode;
    return {
      mode,
      threshold: safeInteger(input.threshold, 2, 1, MAX_NODES)
    };
  }

  function normalizeNodePolicy(value = {}, input = {}) {
    const policy = isObject(value) ? value : {};
    return {
      requiresApproval: policy.requiresApproval === true || input.requiresApproval === true,
      maxRetries: safeInteger(policy.maxRetries ?? input.maxRetries, 0, 0, 5),
      timeoutMinutes: safeInteger(policy.timeoutMinutes ?? input.timeoutMinutes, 0, 0, 1_440),
      staleAfterMinutes: safeInteger(
        policy.staleAfterMinutes ?? input.staleAfterMinutes,
        0,
        0,
        1_440
      ),
      recovery: NODE_RECOVERY_POLICIES.has(policy.recovery)
        ? policy.recovery
        : (NODE_RECOVERY_POLICIES.has(input.recovery) ? input.recovery : 'inherit'),
      onFailure: FAILURE_POLICIES.has(policy.onFailure)
        ? policy.onFailure
        : (FAILURE_POLICIES.has(input.onFailure) ? input.onFailure : 'stop')
    };
  }

  function normalizeNode(value = {}, index = 0, options = {}) {
    const input = isObject(value) ? value : {};
    const type = NODE_TYPES.has(input.type) ? input.type : 'session';
    const fallbackId = makeId(options, 'node');
    const session = normalizeSessionRef(input.session || input);
    const fallbackTitle = type === 'approval'
      ? 'Human approval'
      : type === 'delay'
        ? 'Wait'
        : session.title;
    return {
      id: safeId(input.id, fallbackId),
      type,
      title: boundedText(input.title, MAX_TITLE_LENGTH, fallbackTitle),
      ...session,
      prompt: boundedText(input.prompt, MAX_PROMPT_LENGTH),
      description: boundedText(input.description, MAX_NOTE_LENGTH),
      position: normalizePosition(input.position, {
        x: 80 + (index % 4) * 300,
        y: 80 + Math.floor(index / 4) * 190
      }),
      trigger: normalizeTrigger(input.trigger, input.triggerMode || 'all'),
      policy: normalizeNodePolicy(input.policy, input),
      delaySeconds: safeInteger(input.delaySeconds, 300, 10, 86_400),
      enabled: input.enabled !== false
    };
  }

  function normalizeEdge(value = {}, index = 0, options = {}) {
    const input = isObject(value) ? value : {};
    return {
      id: safeId(input.id, makeId(options, 'edge')),
      from: safeId(input.from || input.source, ''),
      to: safeId(input.to || input.target, ''),
      when: EDGE_CONDITIONS.has(input.when) ? input.when : 'success',
      label: boundedText(input.label, 80),
      order: safeInteger(input.order, index, 0, MAX_EDGES)
    };
  }

  function normalizeSchedule(value = {}) {
    const input = isObject(value) ? value : {};
    const type = SCHEDULE_TYPES.has(input.type) ? input.type : 'manual';
    const time = /^\d{2}:\d{2}$/.test(input.time || '') ? input.time : '09:00';
    const weekdays = [...new Set(
      (Array.isArray(input.weekdays) ? input.weekdays : [1, 2, 3, 4, 5])
        .map((day) => safeInteger(day, -1, -1, 6))
        .filter((day) => day >= 0)
    )].sort();
    return {
      enabled: input.enabled === true && type !== 'manual',
      type,
      onceAt: isoDate(input.onceAt, null),
      intervalMinutes: safeInteger(input.intervalMinutes, 60, 1, 43_200),
      anchorAt: isoDate(input.anchorAt, null),
      time,
      weekdays: weekdays.length ? weekdays : [0, 1, 2, 3, 4, 5, 6],
      overlapPolicy: OVERLAP_POLICIES.has(input.overlapPolicy)
        ? input.overlapPolicy
        : 'skip',
      maxConcurrentRuns: safeInteger(input.maxConcurrentRuns, 1, 1, 4),
      nextAt: isoDate(input.nextAt, null),
      lastTriggeredAt: isoDate(input.lastTriggeredAt, null)
    };
  }

  function normalizeMonitor(value = {}) {
    const input = isObject(value) ? value : {};
    return {
      enabled: input.enabled !== false,
      intervalSeconds: safeInteger(input.intervalSeconds, 30, 10, 3_600),
      staleAfterMinutes: safeInteger(input.staleAfterMinutes, 10, 1, 1_440),
      timeoutMinutes: safeInteger(input.timeoutMinutes, 90, 1, 10_080),
      recovery: RECOVERY_POLICIES.has(input.recovery) ? input.recovery : 'alert',
      maxConcurrency: safeInteger(input.maxConcurrency, 4, 1, 12),
      lastCheckedAt: isoDate(input.lastCheckedAt, null)
    };
  }

  function normalizeActivation(value = {}, index = 0, options = {}) {
    const input = isObject(value) ? value : {};
    return {
      id: safeId(input.id, makeId(options, 'activation')),
      key: safeId(input.key, `activation-${index + 1}`),
      status: ACTIVATION_STATUSES.has(input.status) ? input.status : 'queued',
      attempt: safeInteger(input.attempt, 1, 1, 20),
      inputTokenIds: (Array.isArray(input.inputTokenIds) ? input.inputTokenIds : [])
        .slice(0, MAX_EDGES)
        .map((id) => safeId(id, ''))
        .filter(Boolean),
      runtimeId: optionalText(input.runtimeId, 180),
      output: boundedText(input.output, MAX_OUTPUT_LENGTH),
      error: optionalText(input.error, 1_000),
      queuedAt: isoDate(input.queuedAt, null),
      startedAt: isoDate(input.startedAt, null),
      dueAt: isoDate(input.dueAt, null),
      lastActivityAt: isoDate(input.lastActivityAt, null),
      completedAt: isoDate(input.completedAt, null),
      dispatchedAt: isoDate(input.dispatchedAt, null)
    };
  }

  function summarizeNodeRun(nodeRun) {
    const activations = Array.isArray(nodeRun?.activations) ? nodeRun.activations : [];
    if (!activations.length) return nodeRun?.status === 'blocked' ? 'blocked' : 'waiting';
    const statuses = new Set(activations.map((activation) => activation.status));
    const priority = [
      'running',
      'queued',
      'waiting_approval',
      'delayed',
      'stalled',
      'failed',
      'timed_out'
    ];
    for (const status of priority) {
      if (statuses.has(status)) return status;
    }
    if ([...statuses].every((status) => status === 'cancelled')) return 'cancelled';
    if ([...statuses].every((status) => status === 'skipped')) return 'skipped';
    if (statuses.has('succeeded')) return 'succeeded';
    return 'waiting';
  }

  function normalizeNodeRun(value = {}, nodeId, options = {}) {
    const input = isObject(value) ? value : {};
    const activations = (Array.isArray(input.activations) ? input.activations : [])
      .slice(0, MAX_ACTIVATIONS_PER_NODE)
      .map((activation, index) => normalizeActivation(activation, index, options));
    const normalized = {
      nodeId,
      status: NODE_STATUSES.has(input.status) ? input.status : 'waiting',
      activations,
      firedKeys: (Array.isArray(input.firedKeys) ? input.firedKeys : [])
        .slice(0, MAX_ACTIVATIONS_PER_NODE)
        .map((key) => safeId(key, ''))
        .filter(Boolean),
      reason: optionalText(input.reason, 500),
      lastChangedAt: isoDate(input.lastChangedAt, null)
    };
    if (activations.length) normalized.status = summarizeNodeRun(normalized);
    return normalized;
  }

  function normalizeToken(value = {}, index = 0, options = {}) {
    const input = isObject(value) ? value : {};
    return {
      id: safeId(input.id, makeId(options, 'token')),
      edgeId: safeId(input.edgeId, ''),
      from: safeId(input.from, ''),
      to: safeId(input.to, ''),
      sourceActivationId: safeId(input.sourceActivationId, ''),
      outcome: input.outcome === 'failure' ? 'failure' : 'success',
      createdAt: isoDate(input.createdAt, nowIso(options))
    };
  }

  function normalizeEvent(value = {}, index = 0, options = {}) {
    const input = isObject(value) ? value : {};
    return {
      id: safeId(input.id, makeId(options, 'event')),
      type: boundedText(input.type, 80, 'event'),
      nodeId: optionalText(input.nodeId, 180),
      activationId: optionalText(input.activationId, 180),
      message: boundedText(input.message, 500),
      at: isoDate(input.at, nowIso(options)),
      sequence: safeInteger(input.sequence, index + 1, 1, 100_000)
    };
  }

  function normalizeRun(value = {}, nodes = [], options = {}) {
    const input = isObject(value) ? value : {};
    const createdAt = isoDate(input.createdAt, nowIso(options));
    const rawNodeRuns = isObject(input.nodeRuns) ? input.nodeRuns : {};
    const nodeRuns = {};
    for (const node of nodes) {
      nodeRuns[node.id] = normalizeNodeRun(rawNodeRuns[node.id], node.id, options);
    }
    const run = {
      id: safeId(input.id, makeId(options, 'run')),
      number: safeInteger(input.number, 1, 1, 100_000),
      status: RUN_STATUSES.has(input.status) ? input.status : 'queued',
      deferred: input.deferred === true,
      trigger: {
        type: boundedText(input.trigger?.type, 40, 'manual'),
        scheduledFor: isoDate(input.trigger?.scheduledFor, null)
      },
      nodeRuns,
      tokens: (Array.isArray(input.tokens) ? input.tokens : [])
        .slice(0, MAX_EVENTS)
        .map((token, index) => normalizeToken(token, index, options)),
      events: (Array.isArray(input.events) ? input.events : [])
        .slice(-MAX_EVENTS)
        .map((event, index) => normalizeEvent(event, index, options)),
      createdAt,
      startedAt: isoDate(input.startedAt, null),
      completedAt: isoDate(input.completedAt, null),
      updatedAt: isoDate(input.updatedAt, createdAt),
      lastWatchdogAt: isoDate(input.lastWatchdogAt, null)
    };
    return run;
  }

  function migrateLegacyWorkgraph(input, options = {}) {
    const tasks = (Array.isArray(input.tasks) ? input.tasks : []).slice(0, MAX_NODES - 1);
    const synthesis = isObject(input.synthesis) ? input.synthesis : null;
    const nodes = tasks.map((task, index) => ({
      ...task,
      type: 'session',
      position: { x: 80, y: 70 + index * 170 },
      trigger: { mode: 'all' }
    }));
    if (synthesis) {
      nodes.push({
        ...synthesis,
        type: 'session',
        title: synthesis.title || 'Synthesis',
        position: {
          x: 620,
          y: Math.max(80, 70 + Math.floor(Math.max(0, tasks.length - 1) / 2) * 170)
        },
        trigger: { mode: 'all' },
        policy: {
          requiresApproval: input.dispatchMode !== 'automatic'
        }
      });
    }
    const edges = synthesis
      ? tasks.map((task, index) => ({
          id: `edge-${safeId(task.id, String(index + 1))}-${safeId(synthesis.id, 'synthesis')}`,
          from: task.id,
          to: synthesis.id,
          when: 'success',
          order: index
        }))
      : [];

    const hadRuntimeState = Boolean(
      input.startedAt
      || tasks.some((task) => task.status && task.status !== 'waiting')
      || (synthesis && synthesis.status && synthesis.status !== 'waiting')
    );
    const runs = [];
    if (hadRuntimeState) {
      const nodeRuns = {};
      const statusMap = {
        waiting: 'queued',
        running: 'running',
        completed: 'succeeded',
        failed: 'failed',
        blocked: 'failed',
        skipped: 'skipped',
        ready: 'waiting_approval'
      };
      for (const legacyNode of [...tasks, ...(synthesis ? [synthesis] : [])]) {
        const activationStatus = statusMap[legacyNode.status] || 'queued';
        nodeRuns[legacyNode.id] = {
          nodeId: legacyNode.id,
          activations: [{
            id: `legacy-activation-${legacyNode.id}`,
            key: 'legacy',
            status: activationStatus,
            attempt: 1,
            runtimeId: legacyNode.runtimeId,
            output: legacyNode.output,
            error: legacyNode.error,
            startedAt: legacyNode.startedAt,
            completedAt: legacyNode.completedAt,
            dispatchedAt: legacyNode.dispatchedAt,
            lastActivityAt: legacyNode.startedAt
          }],
          firedKeys: ['legacy']
        };
      }
      runs.push({
        id: `legacy-run-${safeId(input.id, 'graph')}`,
        number: 1,
        status: input.status === 'completed'
          ? 'completed'
          : input.status === 'paused'
            ? 'paused'
            : input.status === 'attention'
              ? 'attention'
              : 'running',
        trigger: { type: 'migration' },
        nodeRuns,
        createdAt: input.startedAt || input.createdAt,
        startedAt: input.startedAt,
        completedAt: input.completedAt
      });
    }
    return {
      ...input,
      version: WORKGRAPH_VERSION,
      nodes,
      edges,
      runs,
      activeRunId: runs[0]?.id || null,
      schedule: { type: 'manual', enabled: false },
      monitor: {},
      legacyMigratedAt: nowIso(options)
    };
  }

  function normalizeWorkgraph(value = {}, options = {}) {
    let input = isObject(value) ? value : {};
    if (input.version !== WORKGRAPH_VERSION && (Array.isArray(input.tasks) || input.synthesis)) {
      input = migrateLegacyWorkgraph(input, options);
    }
    const now = nowIso(options);
    const nodes = (Array.isArray(input.nodes) ? input.nodes : [])
      .slice(0, MAX_NODES)
      .map((node, index) => normalizeNode(node, index, options));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const seenEdges = new Set();
    const edges = (Array.isArray(input.edges) ? input.edges : [])
      .slice(0, MAX_EDGES)
      .map((edge, index) => normalizeEdge(edge, index, options))
      .filter((edge) => {
        if (
          !edge.id
          || seenEdges.has(edge.id)
          || edge.from === edge.to
          || !nodeIds.has(edge.from)
          || !nodeIds.has(edge.to)
        ) return false;
        seenEdges.add(edge.id);
        return true;
      });
    const runs = (Array.isArray(input.runs) ? input.runs : [])
      .slice(-MAX_RUNS)
      .map((run) => normalizeRun(run, nodes, options))
      .sort((left, right) => left.number - right.number);
    const createdAt = isoDate(input.createdAt, now);
    const graph = {
      version: WORKGRAPH_VERSION,
      id: safeId(input.id, makeId(options, 'graph')),
      title: boundedText(input.title, MAX_TITLE_LENGTH, 'Session orchestration'),
      description: boundedText(input.description, MAX_NOTE_LENGTH),
      status: GRAPH_STATUSES.has(input.status) ? input.status : 'draft',
      executionMode: EXECUTION_MODES.has(input.executionMode) ? input.executionMode : 'observe',
      dispatchMode: DISPATCH_MODES.has(input.dispatchMode) ? input.dispatchMode : 'review',
      nodes,
      edges,
      schedule: normalizeSchedule(input.schedule),
      monitor: normalizeMonitor(input.monitor),
      runs,
      activeRunId: safeId(input.activeRunId, ''),
      createdAt,
      updatedAt: isoDate(input.updatedAt, createdAt)
    };
    if (!runs.some((run) => run.id === graph.activeRunId)) {
      graph.activeRunId = runs[runs.length - 1]?.id || '';
    }
    graph.status = deriveWorkgraphStatus(graph);
    return graph;
  }

  function normalizeWorkgraphList(value, options = {}) {
    const seen = new Set();
    return (Array.isArray(value) ? value : [])
      .slice(0, MAX_WORKGRAPHS)
      .map((graph) => normalizeWorkgraph(graph, options))
      .filter((graph) => {
        if (!graph.id || seen.has(graph.id)) return false;
        seen.add(graph.id);
        return true;
      })
      .sort((left, right) => (
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      ));
  }

  function graphAdjacency(graph) {
    const adjacency = new Map((graph.nodes || []).map((node) => [node.id, []]));
    for (const edge of graph.edges || []) {
      if (adjacency.has(edge.from)) adjacency.get(edge.from).push(edge.to);
    }
    return adjacency;
  }

  function graphHasCycle(graph) {
    const adjacency = graphAdjacency(graph);
    const visiting = new Set();
    const visited = new Set();
    function visit(nodeId) {
      if (visiting.has(nodeId)) return true;
      if (visited.has(nodeId)) return false;
      visiting.add(nodeId);
      for (const target of adjacency.get(nodeId) || []) {
        if (visit(target)) return true;
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      return false;
    }
    return [...adjacency.keys()].some(visit);
  }

  function validateEdgeAddition(graph, from, to) {
    if (!from || !to) return { ok: false, reason: 'missing-node' };
    if (from === to) return { ok: false, reason: 'self-edge' };
    const nodeIds = new Set((graph.nodes || []).map((node) => node.id));
    if (!nodeIds.has(from) || !nodeIds.has(to)) return { ok: false, reason: 'unknown-node' };
    if ((graph.edges || []).some((edge) => edge.from === from && edge.to === to)) {
      return { ok: false, reason: 'duplicate-edge' };
    }
    if (graphHasCycle({ ...graph, edges: [...(graph.edges || []), { from, to }] })) {
      return { ok: false, reason: 'cycle' };
    }
    return { ok: true, reason: null };
  }

  function validateWorkgraph(graph) {
    const errors = [];
    const warnings = [];
    const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
    const edges = Array.isArray(graph?.edges) ? graph.edges : [];
    const ids = new Set(nodes.map((node) => node.id));
    if (!nodes.length) errors.push({ code: 'no-nodes' });
    if (ids.size !== nodes.length) errors.push({ code: 'duplicate-node-id' });
    if (edges.some((edge) => !ids.has(edge.from) || !ids.has(edge.to))) {
      errors.push({ code: 'dangling-edge' });
    }
    if (graphHasCycle({ nodes, edges })) errors.push({ code: 'cycle' });
    const incoming = new Map(nodes.map((node) => [node.id, []]));
    const outgoing = new Map(nodes.map((node) => [node.id, []]));
    for (const edge of edges) {
      incoming.get(edge.to)?.push(edge);
      outgoing.get(edge.from)?.push(edge);
    }
    if (nodes.length && !nodes.some((node) => !(incoming.get(node.id) || []).length)) {
      errors.push({ code: 'no-root' });
    }
    for (const node of nodes) {
      const count = (incoming.get(node.id) || []).length;
      if (node.trigger.mode === 'threshold' && (node.trigger.threshold < 1 || node.trigger.threshold > count)) {
        errors.push({ code: 'invalid-threshold', nodeId: node.id });
      }
      if (node.type === 'session' && !node.sessionKey) {
        warnings.push({ code: 'unbound-session', nodeId: node.id });
      }
      if (!count && node.trigger.mode !== 'all') {
        warnings.push({ code: 'root-trigger-ignored', nodeId: node.id });
      }
      if (!(outgoing.get(node.id) || []).length && node.type !== 'session') {
        warnings.push({ code: 'utility-terminal', nodeId: node.id });
      }
    }
    return { ok: errors.length === 0, errors, warnings };
  }

  function appendEvent(run, event, options = {}) {
    const at = isoDate(event.at, nowIso(options));
    run.events.push(normalizeEvent({
      ...event,
      id: event.id || makeId(options, 'event'),
      at,
      sequence: (run.events[run.events.length - 1]?.sequence || 0) + 1
    }, run.events.length, options));
    run.events = run.events.slice(-MAX_EVENTS);
    run.updatedAt = at;
  }

  function activationOutcome(status) {
    if (status === 'succeeded') return 'success';
    if (['failed', 'timed_out', 'cancelled'].includes(status)) return 'failure';
    return null;
  }

  function edgeMatches(edge, activation) {
    const outcome = activationOutcome(activation.status);
    if (!outcome) return false;
    return edge.when === 'always' || edge.when === outcome;
  }

  function makeActivation(node, key, tokenIds, at, options = {}) {
    const status = node.type === 'approval' || node.policy.requiresApproval
      ? 'waiting_approval'
      : node.type === 'delay'
        ? 'delayed'
        : 'queued';
    return {
      id: makeId(options, 'activation'),
      key,
      status,
      attempt: 1,
      inputTokenIds: tokenIds,
      runtimeId: null,
      output: '',
      error: null,
      queuedAt: at,
      startedAt: null,
      dueAt: node.type === 'delay'
        ? new Date(new Date(at).getTime() + node.delaySeconds * 1_000).toISOString()
        : null,
      lastActivityAt: at,
      completedAt: null,
      dispatchedAt: null
    };
  }

  function runNodeFinished(nodeRun) {
    if (!nodeRun) return false;
    if (nodeRun.status === 'blocked') return true;
    const activations = nodeRun.activations || [];
    return activations.length > 0
      && activations.every((activation) => TERMINAL_ACTIVATION_STATUSES.has(activation.status));
  }

  function nodeTriggerCandidates(graph, run, node) {
    const inbound = graph.edges.filter((edge) => edge.to === node.id);
    const tokens = run.tokens.filter((token) => token.to === node.id);
    const nodeRun = run.nodeRuns[node.id];
    if (!inbound.length) {
      return nodeRun.firedKeys.includes('root')
        ? []
        : [{ key: 'root', tokenIds: [] }];
    }
    if (node.trigger.mode === 'each') {
      return tokens
        .filter((token) => !nodeRun.firedKeys.includes(`token:${token.id}`))
        .map((token) => ({ key: `token:${token.id}`, tokenIds: [token.id] }));
    }
    if (nodeRun.firedKeys.length) return [];
    if (node.trigger.mode === 'any' && tokens.length) {
      const first = tokens.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      return [{ key: `any:${first.id}`, tokenIds: [first.id] }];
    }
    const firstByEdge = new Map();
    for (const token of tokens) {
      if (!firstByEdge.has(token.edgeId)) firstByEdge.set(token.edgeId, token);
    }
    if (node.trigger.mode === 'threshold' && firstByEdge.size >= node.trigger.threshold) {
      return [{
        key: `threshold:${[...firstByEdge.keys()].sort().join(',')}`,
        tokenIds: [...firstByEdge.values()].slice(0, node.trigger.threshold).map((token) => token.id)
      }];
    }
    if (node.trigger.mode === 'all' && inbound.every((edge) => firstByEdge.has(edge.id))) {
      return [{
        key: `all:${inbound.map((edge) => edge.id).sort().join(',')}`,
        tokenIds: inbound.map((edge) => firstByEdge.get(edge.id).id)
      }];
    }
    return [];
  }

  function refreshNodeRunStatus(nodeRun, at) {
    const nextStatus = summarizeNodeRun(nodeRun);
    if (nodeRun.status !== nextStatus) {
      nodeRun.status = nextStatus;
      nodeRun.lastChangedAt = at;
    }
  }

  function refreshRunStatus(graph, run, at) {
    if (run.status === 'cancelled') return;
    if (run.status === 'paused') return;
    const nodeRuns = Object.values(run.nodeRuns);
    if (nodeRuns.length && nodeRuns.every(runNodeFinished)) {
      const failed = nodeRuns.some((nodeRun) => (
        ['failed', 'timed_out', 'blocked', 'cancelled'].includes(nodeRun.status)
      ));
      run.status = failed ? 'failed' : 'completed';
      run.completedAt = run.completedAt || at;
      return;
    }
    if (nodeRuns.some((nodeRun) => nodeRun.status === 'stalled')) {
      run.status = 'attention';
      return;
    }
    if (nodeRuns.some((nodeRun) => nodeRun.status === 'waiting_approval')) {
      run.status = 'waiting';
      return;
    }
    run.status = run.deferred ? 'queued' : 'running';
  }

  function advanceGraphRun(graphValue, runValue, options = {}) {
    const graph = normalizeWorkgraph(graphValue, options);
    const run = normalizeRun(runValue, graph.nodes, options);
    if (run.deferred || TERMINAL_RUN_STATUSES.has(run.status) || run.status === 'paused') return run;
    const at = nowIso(options);
    const tokenIds = new Set(run.tokens.map((token) => token.id));
    let changed = true;
    let passes = 0;
    while (changed && passes < MAX_NODES * 4) {
      changed = false;
      passes += 1;

      for (const node of graph.nodes.filter((item) => item.enabled)) {
        const nodeRun = run.nodeRuns[node.id];
        for (const activation of nodeRun.activations) {
          if (activation.status === 'delayed' && activation.dueAt && new Date(activation.dueAt) <= new Date(at)) {
            activation.status = 'succeeded';
            activation.completedAt = at;
            activation.lastActivityAt = at;
            appendEvent(run, {
              type: 'delay-completed',
              nodeId: node.id,
              activationId: activation.id,
              message: `${node.title} delay elapsed`,
              at
            }, options);
            changed = true;
          }
          if (!TERMINAL_ACTIVATION_STATUSES.has(activation.status)) continue;
          for (const edge of graph.edges.filter((item) => item.from === node.id)) {
            if (!edgeMatches(edge, activation)) continue;
            const tokenId = `${activation.id}:${edge.id}`;
            if (tokenIds.has(tokenId)) continue;
            const outcome = activationOutcome(activation.status) || 'failure';
            run.tokens.push({
              id: tokenId,
              edgeId: edge.id,
              from: edge.from,
              to: edge.to,
              sourceActivationId: activation.id,
              outcome,
              createdAt: activation.completedAt || at
            });
            tokenIds.add(tokenId);
            appendEvent(run, {
              type: 'signal-emitted',
              nodeId: node.id,
              activationId: activation.id,
              message: `${edge.when} signal → ${edge.to}`,
              at
            }, options);
            changed = true;
          }
        }
      }

      for (const node of graph.nodes.filter((item) => item.enabled)) {
        const nodeRun = run.nodeRuns[node.id];
        const candidates = nodeTriggerCandidates(graph, run, node);
        for (const candidate of candidates) {
          if (nodeRun.activations.length >= MAX_ACTIVATIONS_PER_NODE) break;
          const activation = makeActivation(node, candidate.key, candidate.tokenIds, at, options);
          nodeRun.activations.push(activation);
          nodeRun.firedKeys.push(candidate.key);
          nodeRun.reason = null;
          nodeRun.lastChangedAt = at;
          appendEvent(run, {
            type: 'activation-created',
            nodeId: node.id,
            activationId: activation.id,
            message: `${node.title} triggered by ${node.trigger.mode}`,
            at
          }, options);
          changed = true;
        }

        const inbound = graph.edges.filter((edge) => edge.to === node.id);
        if (
          inbound.length
          && !nodeRun.activations.length
          && inbound.every((edge) => runNodeFinished(run.nodeRuns[edge.from]))
          && !nodeTriggerCandidates(graph, run, node).length
        ) {
          nodeRun.status = 'blocked';
          nodeRun.reason = 'upstream-condition-unmet';
          nodeRun.lastChangedAt = at;
          appendEvent(run, {
            type: 'node-blocked',
            nodeId: node.id,
            message: `${node.title} cannot satisfy its inbound rule`,
            at
          }, options);
          changed = true;
        } else {
          refreshNodeRunStatus(nodeRun, at);
        }
      }
    }
    refreshRunStatus(graph, run, at);
    run.updatedAt = at;
    return run;
  }

  function createGraphRun(graphValue, options = {}) {
    const graph = normalizeWorkgraph(graphValue, options);
    const at = nowIso(options);
    const number = safeInteger(
      options.number,
      Math.max(0, ...graph.runs.map((run) => run.number)) + 1,
      1,
      100_000
    );
    const nodeRuns = {};
    for (const node of graph.nodes.filter((item) => item.enabled)) {
      nodeRuns[node.id] = {
        nodeId: node.id,
        status: 'waiting',
        activations: [],
        firedKeys: [],
        reason: null,
        lastChangedAt: at
      };
    }
    const run = normalizeRun({
      id: options.runId || makeId(options, 'run'),
      number,
      status: options.deferred ? 'queued' : 'running',
      deferred: options.deferred === true,
      trigger: options.trigger || { type: 'manual' },
      nodeRuns,
      tokens: [],
      events: [{
        type: options.deferred ? 'run-queued' : 'run-started',
        message: options.deferred ? 'Run queued' : 'Run started',
        at
      }],
      createdAt: at,
      startedAt: options.deferred ? null : at,
      updatedAt: at
    }, graph.nodes, options);
    return options.deferred ? run : advanceGraphRun(graph, run, options);
  }

  function activateDeferredRun(graphValue, runValue, options = {}) {
    const graph = normalizeWorkgraph(graphValue, options);
    const run = normalizeRun(runValue, graph.nodes, options);
    if (!run.deferred) return advanceGraphRun(graph, run, options);
    const at = nowIso(options);
    run.deferred = false;
    run.status = 'running';
    run.startedAt = at;
    appendEvent(run, { type: 'run-started', message: 'Queued run started', at }, options);
    return advanceGraphRun(graph, run, options);
  }

  function findActivation(run, nodeId, activationId) {
    const nodeRun = run.nodeRuns[nodeId];
    if (!nodeRun) return { nodeRun: null, activation: null };
    const activation = nodeRun.activations.find((item) => item.id === activationId) || null;
    return { nodeRun, activation };
  }

  function transitionActivation(graphValue, runValue, nodeId, activationId, nextStatus, patch = {}, options = {}) {
    const graph = normalizeWorkgraph(graphValue, options);
    let run = normalizeRun(runValue, graph.nodes, options);
    if (!ACTIVATION_STATUSES.has(nextStatus)) return run;
    const { nodeRun, activation } = findActivation(run, nodeId, activationId);
    if (!nodeRun || !activation || TERMINAL_RUN_STATUSES.has(run.status)) return run;
    const at = nowIso(options);
    const previous = activation.status;
    activation.status = nextStatus;
    if (Object.prototype.hasOwnProperty.call(patch, 'runtimeId')) {
      activation.runtimeId = optionalText(patch.runtimeId, 180);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'output')) {
      activation.output = boundedText(patch.output, MAX_OUTPUT_LENGTH);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'error')) {
      activation.error = optionalText(patch.error, 1_000);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'dispatchedAt')) {
      activation.dispatchedAt = isoDate(patch.dispatchedAt, null);
    }
    if (nextStatus === 'running') {
      activation.startedAt = activation.startedAt || at;
      activation.lastActivityAt = at;
      activation.error = null;
    }
    if (TERMINAL_ACTIVATION_STATUSES.has(nextStatus)) {
      activation.completedAt = at;
      activation.lastActivityAt = at;
      activation.runtimeId = null;
    }
    nodeRun.lastChangedAt = at;
    appendEvent(run, {
      type: 'activation-state',
      nodeId,
      activationId,
      message: `${previous} → ${nextStatus}`,
      at
    }, options);
    run = advanceGraphRun(graph, run, { ...options, now: () => new Date(at).getTime() });
    return run;
  }

  function approveActivation(graphValue, runValue, nodeId, activationId, approved, options = {}) {
    const graph = normalizeWorkgraph(graphValue, options);
    const run = normalizeRun(runValue, graph.nodes, options);
    const node = graph.nodes.find((item) => item.id === nodeId);
    const { activation } = findActivation(run, nodeId, activationId);
    if (!node || !activation || activation.status !== 'waiting_approval') return run;
    if (!approved) {
      return transitionActivation(
        graph,
        run,
        nodeId,
        activationId,
        'failed',
        { error: 'Approval rejected' },
        options
      );
    }
    return transitionActivation(
      graph,
      run,
      nodeId,
      activationId,
      node.type === 'approval' ? 'succeeded' : 'queued',
      {},
      options
    );
  }

  function retryActivation(graphValue, runValue, nodeId, activationId, options = {}) {
    const graph = normalizeWorkgraph(graphValue, options);
    let run = normalizeRun(runValue, graph.nodes, options);
    const { nodeRun, activation } = findActivation(run, nodeId, activationId);
    if (!nodeRun || !activation || !['failed', 'timed_out', 'stalled', 'cancelled'].includes(activation.status)) {
      return run;
    }
    const at = nowIso(options);
    activation.status = 'queued';
    activation.attempt += 1;
    activation.runtimeId = null;
    activation.error = null;
    activation.queuedAt = at;
    activation.startedAt = null;
    activation.completedAt = null;
    activation.dispatchedAt = null;
    activation.lastActivityAt = at;
    run.status = 'running';
    run.completedAt = null;
    nodeRun.reason = null;
    refreshNodeRunStatus(nodeRun, at);
    appendEvent(run, {
      type: 'activation-retry',
      nodeId,
      activationId,
      message: `Retry attempt ${activation.attempt}`,
      at
    }, options);
    return advanceGraphRun(graph, run, options);
  }

  function recordHeartbeat(graphValue, runValue, nodeId, activationId, options = {}) {
    const graph = normalizeWorkgraph(graphValue, options);
    const run = normalizeRun(runValue, graph.nodes, options);
    const { nodeRun, activation } = findActivation(run, nodeId, activationId);
    if (!nodeRun || !activation || !['running', 'stalled'].includes(activation.status)) return run;
    const at = nowIso(options);
    activation.lastActivityAt = at;
    if (activation.status === 'stalled') {
      activation.status = 'running';
      run.status = 'running';
      refreshNodeRunStatus(nodeRun, at);
      appendEvent(run, {
        type: 'heartbeat-restored',
        nodeId,
        activationId,
        message: 'Activity resumed',
        at
      }, options);
    }
    run.updatedAt = at;
    return run;
  }

  function sweepWatchdog(graphValue, runValue, options = {}) {
    const graph = normalizeWorkgraph(graphValue, options);
    let run = normalizeRun(runValue, graph.nodes, options);
    const at = nowIso(options);
    const nowMs = new Date(at).getTime();
    const actions = [];
    if (!graph.monitor.enabled || !['running', 'waiting', 'attention'].includes(run.status)) {
      return { run, actions };
    }
    for (const node of graph.nodes) {
      const nodeRun = run.nodeRuns[node.id];
      if (!nodeRun) continue;
      for (const activation of nodeRun.activations) {
        if (activation.status !== 'running') continue;
        const timeoutMinutes = node.policy.timeoutMinutes || graph.monitor.timeoutMinutes;
        const staleMinutes = node.policy.staleAfterMinutes || graph.monitor.staleAfterMinutes;
        const recovery = node.policy.recovery === 'inherit'
          ? graph.monitor.recovery
          : node.policy.recovery;
        const startedMs = new Date(activation.startedAt || activation.queuedAt || at).getTime();
        const activityMs = new Date(activation.lastActivityAt || activation.startedAt || at).getTime();
        const timedOut = timeoutMinutes > 0 && nowMs - startedMs >= timeoutMinutes * 60_000;
        const stale = staleMinutes > 0 && nowMs - activityMs >= staleMinutes * 60_000;
        if (!timedOut && !stale) continue;

        const previousRuntimeId = activation.runtimeId;
        const problem = timedOut ? 'timed_out' : 'stalled';
        const canRetry = recovery === 'retry' && activation.attempt <= node.policy.maxRetries;
        if (canRetry) {
          activation.status = 'queued';
          activation.attempt += 1;
          activation.runtimeId = null;
          activation.error = timedOut ? 'Execution timed out; retry queued' : 'No activity; retry queued';
          activation.queuedAt = at;
          activation.startedAt = null;
          activation.completedAt = null;
          activation.dispatchedAt = null;
          activation.lastActivityAt = at;
          actions.push({
            type: 'retry',
            nodeId: node.id,
            activationId: activation.id,
            runtimeId: previousRuntimeId
          });
        } else {
          activation.status = problem;
          activation.error = timedOut ? 'Execution exceeded timeout' : 'No activity within watchdog window';
          activation.lastActivityAt = at;
          if (timedOut) activation.completedAt = at;
          actions.push({
            type: recovery === 'pause' ? 'pause' : 'alert',
            nodeId: node.id,
            activationId: activation.id,
            runtimeId: previousRuntimeId
          });
          if (recovery === 'pause') run.status = 'paused';
        }
        refreshNodeRunStatus(nodeRun, at);
        appendEvent(run, {
          type: timedOut ? 'watchdog-timeout' : 'watchdog-stalled',
          nodeId: node.id,
          activationId: activation.id,
          message: canRetry ? 'Watchdog queued a retry' : `Watchdog policy: ${recovery}`,
          at
        }, options);
      }
    }
    run.lastWatchdogAt = at;
    if (run.status !== 'paused') run = advanceGraphRun(graph, run, options);
    return { run, actions };
  }

  function scheduleNextAt(scheduleValue, afterValue = Date.now()) {
    const schedule = normalizeSchedule(scheduleValue);
    if (!schedule.enabled || schedule.type === 'manual') return null;
    const after = new Date(afterValue);
    if (Number.isNaN(after.getTime())) return null;
    if (schedule.type === 'once') {
      const once = new Date(schedule.onceAt || '');
      return !Number.isNaN(once.getTime()) && once.getTime() > after.getTime()
        ? once.toISOString()
        : null;
    }
    if (schedule.type === 'interval') {
      const intervalMs = schedule.intervalMinutes * 60_000;
      const anchor = new Date(schedule.anchorAt || schedule.lastTriggeredAt || after);
      const anchorMs = Number.isNaN(anchor.getTime()) ? after.getTime() : anchor.getTime();
      if (anchorMs > after.getTime()) return new Date(anchorMs).toISOString();
      const steps = Math.floor((after.getTime() - anchorMs) / intervalMs) + 1;
      return new Date(anchorMs + steps * intervalMs).toISOString();
    }
    const [hour, minute] = schedule.time.split(':').map(Number);
    for (let offset = 0; offset <= 8; offset += 1) {
      const candidate = new Date(after);
      candidate.setSeconds(0, 0);
      candidate.setDate(candidate.getDate() + offset);
      candidate.setHours(hour, minute, 0, 0);
      if (
        candidate.getTime() > after.getTime()
        && schedule.weekdays.includes(candidate.getDay())
      ) return candidate.toISOString();
    }
    return null;
  }

  function initializeSchedule(scheduleValue, nowValue = Date.now()) {
    const schedule = normalizeSchedule(scheduleValue);
    if (!schedule.enabled) return { ...schedule, nextAt: null };
    const justBefore = new Date(new Date(nowValue).getTime() - 1);
    return { ...schedule, nextAt: scheduleNextAt(schedule, justBefore) };
  }

  function scheduleIsDue(graph, nowValue = Date.now()) {
    const schedule = normalizeSchedule(graph?.schedule);
    if (!schedule.enabled || !schedule.nextAt) return false;
    const now = new Date(nowValue).getTime();
    const next = new Date(schedule.nextAt).getTime();
    return Number.isFinite(now) && Number.isFinite(next) && next <= now;
  }

  function markScheduleTriggered(scheduleValue, nowValue = Date.now()) {
    const schedule = normalizeSchedule(scheduleValue);
    const at = isoDate(nowValue, new Date().toISOString());
    const next = schedule.type === 'once' ? null : scheduleNextAt(schedule, at);
    return {
      ...schedule,
      enabled: schedule.type === 'once' ? false : schedule.enabled,
      lastTriggeredAt: at,
      nextAt: next
    };
  }

  function latestRun(graph) {
    const runs = Array.isArray(graph?.runs) ? graph.runs : [];
    if (!runs.length) return null;
    return runs.find((run) => run.id === graph.activeRunId) || runs[runs.length - 1];
  }

  function workgraphProgress(graph) {
    const run = latestRun(graph);
    const nodeRuns = run ? Object.values(run.nodeRuns || {}) : [];
    const total = (graph?.nodes || []).filter((node) => node.enabled).length;
    const completed = nodeRuns.filter((nodeRun) => nodeRun.status === 'succeeded').length;
    const failed = nodeRuns.filter((nodeRun) => (
      ['failed', 'timed_out', 'blocked', 'cancelled'].includes(nodeRun.status)
    )).length;
    const running = nodeRuns.filter((nodeRun) => (
      ['queued', 'running', 'delayed'].includes(nodeRun.status)
    )).length;
    const waitingApproval = nodeRuns.filter((nodeRun) => nodeRun.status === 'waiting_approval').length;
    const stalled = nodeRuns.filter((nodeRun) => nodeRun.status === 'stalled').length;
    return {
      total,
      completed,
      failed,
      running,
      waitingApproval,
      stalled,
      waiting: Math.max(0, total - completed - failed - running - waitingApproval - stalled),
      ready: Boolean(run && run.status === 'completed')
    };
  }

  function deriveWorkgraphStatus(graph) {
    const runs = Array.isArray(graph?.runs) ? graph.runs : [];
    const active = runs.filter((run) => !TERMINAL_RUN_STATUSES.has(run.status));
    if (active.some((run) => run.status === 'paused')) return 'paused';
    if (active.some((run) => run.status === 'attention')) return 'attention';
    if (active.some((run) => run.status === 'waiting')) return 'waiting';
    if (active.some((run) => ['running', 'queued'].includes(run.status))) return 'running';
    const latest = latestRun(graph);
    if (latest?.status === 'failed') return 'attention';
    if (latest?.status === 'completed') return graph?.schedule?.enabled ? 'scheduled' : 'completed';
    if (graph?.schedule?.enabled) return 'scheduled';
    return 'draft';
  }

  function createWorkgraph(input = {}, options = {}) {
    const sessions = (Array.isArray(input.sessions) ? input.sessions : []).slice(0, MAX_NODES - 1);
    const nodes = sessions.map((session, index) => ({
      id: makeId(options, 'node'),
      type: 'session',
      session,
      title: session.title,
      prompt: input.taskPrompt,
      position: { x: 70, y: 70 + index * 170 },
      trigger: { mode: 'all' }
    }));
    let synthesisId = null;
    if (input.synthesisSession?.sessionKey) {
      synthesisId = makeId(options, 'node');
      nodes.push({
        id: synthesisId,
        type: 'session',
        session: input.synthesisSession,
        title: input.synthesisSession.title || 'Synthesis',
        prompt: input.synthesisPrompt,
        position: {
          x: 600,
          y: Math.max(70, 70 + Math.floor(Math.max(0, sessions.length - 1) / 2) * 170)
        },
        trigger: { mode: 'all' },
        policy: { requiresApproval: input.dispatchMode !== 'automatic' }
      });
    }
    const edges = synthesisId
      ? nodes
          .filter((node) => node.id !== synthesisId)
          .map((node, index) => ({
            id: makeId(options, 'edge'),
            from: node.id,
            to: synthesisId,
            when: 'success',
            order: index
          }))
      : [];
    const now = nowIso(options);
    return normalizeWorkgraph({
      id: makeId(options, 'graph'),
      title: input.title,
      description: input.description,
      executionMode: input.executionMode,
      dispatchMode: input.dispatchMode,
      nodes,
      edges,
      schedule: input.schedule,
      monitor: input.monitor,
      runs: [],
      createdAt: now,
      updatedAt: now
    }, options);
  }

  return {
    WORKGRAPH_VERSION,
    MAX_WORKGRAPHS,
    MAX_NODES,
    MAX_TASKS,
    MAX_EDGES,
    MAX_RUNS,
    MAX_ACTIVATIONS_PER_NODE,
    MAX_EVENTS,
    MAX_TITLE_LENGTH,
    MAX_PROMPT_LENGTH,
    MAX_NOTE_LENGTH,
    MAX_OUTPUT_LENGTH,
    GRAPH_STATUSES,
    RUN_STATUSES,
    NODE_TYPES,
    NODE_STATUSES,
    ACTIVATION_STATUSES,
    TERMINAL_ACTIVATION_STATUSES,
    TERMINAL_RUN_STATUSES,
    TRIGGER_MODES,
    EDGE_CONDITIONS,
    EXECUTION_MODES,
    DISPATCH_MODES,
    SCHEDULE_TYPES,
    OVERLAP_POLICIES,
    RECOVERY_POLICIES,
    NODE_RECOVERY_POLICIES,
    FAILURE_POLICIES,
    normalizeSessionRef,
    normalizePosition,
    normalizeTrigger,
    normalizeNode,
    normalizeEdge,
    normalizeSchedule,
    normalizeMonitor,
    normalizeActivation,
    normalizeNodeRun,
    normalizeRun,
    normalizeWorkgraph,
    normalizeWorkgraphList,
    migrateLegacyWorkgraph,
    graphHasCycle,
    validateEdgeAddition,
    validateWorkgraph,
    summarizeNodeRun,
    activationOutcome,
    advanceGraphRun,
    createGraphRun,
    activateDeferredRun,
    transitionActivation,
    approveActivation,
    retryActivation,
    recordHeartbeat,
    sweepWatchdog,
    scheduleNextAt,
    initializeSchedule,
    scheduleIsDue,
    markScheduleTriggered,
    latestRun,
    workgraphProgress,
    deriveWorkgraphStatus,
    createWorkgraph
  };
});
