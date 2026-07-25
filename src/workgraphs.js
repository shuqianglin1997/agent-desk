/*
 * AgentDesk — session workgraph domain model.
 *
 * A graph node is a task. A session is the task's current executor binding.
 * Keeping those concepts separate lets a user rebind interrupted work without
 * losing the workflow, history, or upstream/downstream relationships.
 *
 * This file is deliberately dependency-free and is shared by the sandboxed
 * renderer and the Electron main process. The main process always normalizes
 * renderer payloads before persistence.
 */

(function exposeWorkgraphs(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AgentDeskWorkgraphs = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function workgraphFactory() {
  const WORKGRAPH_VERSION = 1;
  const MAX_WORKGRAPHS = 20;
  const MAX_TASKS = 12;
  const MAX_TITLE_LENGTH = 120;
  const MAX_PROMPT_LENGTH = 6_000;
  const MAX_NOTE_LENGTH = 8_000;
  const MAX_OUTPUT_LENGTH = 12_000;

  const GRAPH_STATUSES = new Set([
    'draft',
    'running',
    'ready',
    'attention',
    'paused',
    'completed'
  ]);
  const TASK_STATUSES = new Set([
    'waiting',
    'running',
    'completed',
    'failed',
    'blocked',
    'skipped'
  ]);
  const SYNTHESIS_STATUSES = new Set([
    'waiting',
    'ready',
    'running',
    'completed',
    'failed',
    'blocked'
  ]);
  const EXECUTION_MODES = new Set(['observe', 'managed']);
  const DISPATCH_MODES = new Set(['review', 'automatic']);

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
    return boundedText(value, 160, fallback).replace(/[\u0000-\u001f\u007f]/g, '');
  }

  function isoDate(value, fallback) {
    const timestamp = new Date(value || '').getTime();
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallback;
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

  function normalizeTask(value = {}, index = 0, options = {}) {
    const input = isObject(value) ? value : {};
    const fallbackId = typeof options.id === 'function'
      ? options.id()
      : `task-${index + 1}`;
    const session = normalizeSessionRef(input.session || input);
    return {
      id: safeId(input.id, fallbackId),
      ...session,
      prompt: boundedText(input.prompt, MAX_PROMPT_LENGTH),
      completionNote: boundedText(input.completionNote, MAX_NOTE_LENGTH),
      output: boundedText(input.output, MAX_OUTPUT_LENGTH),
      status: TASK_STATUSES.has(input.status) ? input.status : 'waiting',
      runtimeId: optionalText(input.runtimeId, 160),
      startedAt: isoDate(input.startedAt, null),
      completedAt: isoDate(input.completedAt, null),
      error: optionalText(input.error, 1_000)
    };
  }

  function normalizeSynthesis(value = {}, options = {}) {
    const input = isObject(value) ? value : {};
    const session = normalizeSessionRef(input.session || input);
    return {
      id: safeId(input.id, typeof options.id === 'function' ? options.id() : 'synthesis'),
      ...session,
      prompt: boundedText(input.prompt, MAX_PROMPT_LENGTH),
      output: boundedText(input.output, MAX_OUTPUT_LENGTH),
      status: SYNTHESIS_STATUSES.has(input.status) ? input.status : 'waiting',
      runtimeId: optionalText(input.runtimeId, 160),
      startedAt: isoDate(input.startedAt, null),
      completedAt: isoDate(input.completedAt, null),
      error: optionalText(input.error, 1_000)
    };
  }

  function normalizeWorkgraph(value = {}, options = {}) {
    const input = isObject(value) ? value : {};
    const now = isoDate(
      typeof options.now === 'function' ? options.now() : options.now,
      new Date().toISOString()
    );
    const idFactory = typeof options.id === 'function' ? options.id : null;
    const tasks = (Array.isArray(input.tasks) ? input.tasks : [])
      .slice(0, MAX_TASKS)
      .map((task, index) => normalizeTask(task, index, { id: idFactory }));
    const fallbackGraphId = idFactory ? idFactory() : `graph-${Date.now()}`;
    const createdAt = isoDate(input.createdAt, now);
    return {
      version: WORKGRAPH_VERSION,
      id: safeId(input.id, fallbackGraphId),
      title: boundedText(input.title, MAX_TITLE_LENGTH, 'Session orchestration'),
      status: GRAPH_STATUSES.has(input.status) ? input.status : 'draft',
      executionMode: EXECUTION_MODES.has(input.executionMode) ? input.executionMode : 'observe',
      dispatchMode: DISPATCH_MODES.has(input.dispatchMode) ? input.dispatchMode : 'review',
      joinMode: 'all',
      tasks,
      synthesis: normalizeSynthesis(input.synthesis, { id: idFactory }),
      createdAt,
      updatedAt: isoDate(input.updatedAt, createdAt),
      startedAt: isoDate(input.startedAt, null),
      completedAt: isoDate(input.completedAt, null)
    };
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

  function taskIsTerminal(task) {
    return Boolean(task && ['completed', 'skipped'].includes(task.status));
  }

  function workgraphProgress(graph) {
    const tasks = Array.isArray(graph?.tasks) ? graph.tasks : [];
    const completed = tasks.filter(taskIsTerminal).length;
    const failed = tasks.filter((task) => ['failed', 'blocked'].includes(task.status)).length;
    const running = tasks.filter((task) => task.status === 'running').length;
    return {
      total: tasks.length,
      completed,
      failed,
      running,
      waiting: Math.max(0, tasks.length - completed - failed - running),
      ready: tasks.length > 0 && completed === tasks.length
    };
  }

  function deriveWorkgraphStatus(graph) {
    if (graph?.synthesis?.status === 'completed') return 'completed';
    const progress = workgraphProgress(graph);
    if (progress.failed > 0) return 'attention';
    if (progress.ready) {
      return graph?.synthesis?.status === 'running' ? 'running' : 'ready';
    }
    if (progress.running > 0 || graph?.status === 'running') return 'running';
    if (graph?.status === 'paused') return 'paused';
    return 'draft';
  }

  function createWorkgraph(input = {}, options = {}) {
    const sessions = (Array.isArray(input.sessions) ? input.sessions : []).slice(0, MAX_TASKS);
    const idFactory = typeof options.id === 'function'
      ? options.id
      : () => `node-${Math.random().toString(36).slice(2, 10)}`;
    const nowFactory = typeof options.now === 'function' ? options.now : () => Date.now();
    const now = new Date(nowFactory()).toISOString();
    return normalizeWorkgraph({
      id: idFactory(),
      title: input.title,
      executionMode: input.executionMode,
      dispatchMode: input.dispatchMode,
      tasks: sessions.map((session) => ({
        id: idFactory(),
        session,
        prompt: input.taskPrompt,
        status: 'waiting'
      })),
      synthesis: {
        id: idFactory(),
        session: input.synthesisSession,
        prompt: input.synthesisPrompt,
        status: 'waiting'
      },
      createdAt: now,
      updatedAt: now
    }, { id: idFactory, now: nowFactory });
  }

  return {
    WORKGRAPH_VERSION,
    MAX_WORKGRAPHS,
    MAX_TASKS,
    MAX_TITLE_LENGTH,
    MAX_PROMPT_LENGTH,
    MAX_NOTE_LENGTH,
    MAX_OUTPUT_LENGTH,
    GRAPH_STATUSES,
    TASK_STATUSES,
    SYNTHESIS_STATUSES,
    EXECUTION_MODES,
    DISPATCH_MODES,
    normalizeSessionRef,
    normalizeTask,
    normalizeSynthesis,
    normalizeWorkgraph,
    normalizeWorkgraphList,
    taskIsTerminal,
    workgraphProgress,
    deriveWorkgraphStatus,
    createWorkgraph
  };
});
