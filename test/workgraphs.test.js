const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_NODES,
  MAX_PROMPT_LENGTH,
  advanceGraphRun,
  approveActivation,
  createGraphRun,
  createWorkgraph,
  initializeSchedule,
  markScheduleTriggered,
  normalizeWorkgraph,
  normalizeWorkgraphList,
  recordHeartbeat,
  retryActivation,
  scheduleIsDue,
  scheduleNextAt,
  sweepWatchdog,
  transitionActivation,
  validateEdgeAddition,
  validateWorkgraph,
  workgraphProgress
} = require('../src/workgraphs');

function ids(prefix = 'id') {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

function time(iso) {
  return () => Date.parse(iso);
}

function graphFrom({ nodes, edges, monitor, schedule }) {
  return normalizeWorkgraph({
    id: 'graph',
    title: '调度测试',
    executionMode: 'managed',
    nodes,
    edges,
    monitor,
    schedule
  }, { id: ids('normal'), now: time('2026-07-26T00:00:00Z') });
}

function activation(run, nodeId, index = 0) {
  return run.nodeRuns[nodeId].activations[index];
}

function complete(graph, run, nodeId, now, index = 0, status = 'succeeded') {
  const target = activation(run, nodeId, index);
  assert.ok(target, `missing activation for ${nodeId}`);
  return transitionActivation(
    graph,
    run,
    nodeId,
    target.id,
    status,
    {},
    { id: ids('event'), now: time(now) }
  );
}

test('默认工作图生成可编辑的节点与边，并把综合节点设为 ALL', () => {
  const id = ids();
  const graph = createWorkgraph({
    title: '并行调研',
    sessions: [
      { sessionKey: 'a::1', profileId: 'a', sessionId: '1', title: '市场' },
      { sessionKey: 'b::2', profileId: 'b', sessionId: '2', title: '技术' }
    ],
    taskPrompt: '完成当前分工并给出证据',
    synthesisSession: { sessionKey: 'c::3', profileId: 'c', sessionId: '3', title: '综合' },
    synthesisPrompt: '综合上游结论',
    dispatchMode: 'automatic'
  }, { id, now: time('2026-07-25T00:00:00Z') });

  assert.equal(graph.version, 2);
  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.nodes[0].profileId, 'a');
  assert.equal(graph.nodes[0].prompt, '完成当前分工并给出证据');
  assert.equal(graph.nodes[2].trigger.mode, 'all');
  assert.equal(graph.nodes[2].policy.requiresApproval, false);
  assert.notEqual(graph.nodes[0].id, graph.nodes[0].sessionId);
});

test('v1 固定并行图会迁移为 v2 节点、连线与独立运行实例', () => {
  const graph = normalizeWorkgraph({
    version: 1,
    id: 'legacy',
    title: '旧图',
    status: 'running',
    tasks: [
      { id: 'a', sessionKey: 'p::a', title: 'A', status: 'completed' },
      { id: 'b', sessionKey: 'p::b', title: 'B', status: 'running' }
    ],
    synthesis: { id: 's', sessionKey: 'p::s', title: '综合', status: 'waiting' },
    dispatchMode: 'review',
    startedAt: '2026-07-20T00:00:00Z'
  }, { id: ids('migrate'), now: time('2026-07-26T00:00:00Z') });

  assert.equal(graph.version, 2);
  assert.deepEqual(graph.nodes.map((node) => node.id), ['a', 'b', 's']);
  assert.deepEqual(graph.edges.map((edge) => [edge.from, edge.to]), [['a', 's'], ['b', 's']]);
  assert.equal(graph.nodes[2].policy.requiresApproval, true);
  assert.equal(graph.runs.length, 1);
  assert.equal(graph.runs[0].nodeRuns.a.activations[0].status, 'succeeded');
  assert.equal(graph.runs[0].nodeRuns.b.activations[0].status, 'running');
});

test('归一化限制节点数与文本体积，并过滤悬空连线', () => {
  const graph = normalizeWorkgraph({
    id: 'graph',
    title: 'x'.repeat(500),
    executionMode: 'unsafe-shell',
    nodes: Array.from({ length: MAX_NODES + 4 }, (_, index) => ({
      id: `node-${index}`,
      title: `会话 ${index}`,
      prompt: 'p'.repeat(MAX_PROMPT_LENGTH + 500),
      type: index === 0 ? 'unknown' : 'session'
    })),
    edges: [
      { id: 'valid', from: 'node-0', to: 'node-1' },
      { id: 'dangling', from: 'node-0', to: 'missing' }
    ]
  });

  assert.equal(graph.nodes.length, MAX_NODES);
  assert.equal(graph.title.length, 120);
  assert.equal(graph.nodes[0].prompt.length, MAX_PROMPT_LENGTH);
  assert.equal(graph.nodes[0].type, 'session');
  assert.equal(graph.executionMode, 'observe');
  assert.deepEqual(graph.edges.map((edge) => edge.id), ['valid']);
});

test('校验器拒绝环、自连接、重复边和非法 N-of-M', () => {
  const graph = graphFrom({
    nodes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B', trigger: { mode: 'threshold', threshold: 2 } }
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b' }]
  });

  const validation = validateWorkgraph(graph);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.code === 'invalid-threshold'));
  assert.equal(validateEdgeAddition(graph, 'a', 'a').reason, 'self-edge');
  assert.equal(validateEdgeAddition(graph, 'a', 'b').reason, 'duplicate-edge');
  assert.equal(validateEdgeAddition(graph, 'b', 'a').reason, 'cycle');
});

test('ALL 等全部上游成功后只触发目标一次', () => {
  const graph = graphFrom({
    nodes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C', trigger: { mode: 'all' } }
    ],
    edges: [
      { id: 'ac', from: 'a', to: 'c', when: 'success' },
      { id: 'bc', from: 'b', to: 'c', when: 'success' }
    ]
  });
  let run = createGraphRun(graph, { id: ids('all'), now: time('2026-07-26T00:00:00Z') });
  assert.equal(run.nodeRuns.a.status, 'queued');
  assert.equal(run.nodeRuns.b.status, 'queued');
  assert.equal(run.nodeRuns.c.status, 'waiting');

  run = complete(graph, run, 'a', '2026-07-26T00:01:00Z');
  assert.equal(run.nodeRuns.c.activations.length, 0);
  run = complete(graph, run, 'b', '2026-07-26T00:02:00Z');
  assert.equal(run.nodeRuns.c.activations.length, 1);
  assert.equal(run.nodeRuns.c.status, 'queued');
});

test('ANY 首个信号触发一次，迟到的上游不会造成重复运行', () => {
  const graph = graphFrom({
    nodes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C', trigger: { mode: 'any' } }
    ],
    edges: [
      { id: 'ac', from: 'a', to: 'c' },
      { id: 'bc', from: 'b', to: 'c' }
    ]
  });
  let run = createGraphRun(graph, { id: ids('any'), now: time('2026-07-26T00:00:00Z') });
  run = complete(graph, run, 'a', '2026-07-26T00:01:00Z');
  assert.equal(run.nodeRuns.c.activations.length, 1);
  run = complete(graph, run, 'b', '2026-07-26T00:02:00Z');
  assert.equal(run.nodeRuns.c.activations.length, 1);
});

test('EACH 为每个唯一上游 token 建立独立 activation', () => {
  const graph = graphFrom({
    nodes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: '逐条处理', trigger: { mode: 'each' } }
    ],
    edges: [
      { id: 'ac', from: 'a', to: 'c' },
      { id: 'bc', from: 'b', to: 'c' }
    ]
  });
  let run = createGraphRun(graph, { id: ids('each'), now: time('2026-07-26T00:00:00Z') });
  run = complete(graph, run, 'a', '2026-07-26T00:01:00Z');
  run = complete(graph, run, 'b', '2026-07-26T00:02:00Z');
  assert.equal(run.nodeRuns.c.activations.length, 2);
  assert.equal(new Set(run.nodeRuns.c.activations.map((item) => item.key)).size, 2);
});

test('N-of-M 达到阈值即触发，失败边也可以作为明确信号', () => {
  const graph = graphFrom({
    nodes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
      { id: 'd', title: 'D', trigger: { mode: 'threshold', threshold: 2 } }
    ],
    edges: [
      { id: 'ad', from: 'a', to: 'd', when: 'success' },
      { id: 'bd', from: 'b', to: 'd', when: 'failure' },
      { id: 'cd', from: 'c', to: 'd', when: 'always' }
    ]
  });
  let run = createGraphRun(graph, { id: ids('threshold'), now: time('2026-07-26T00:00:00Z') });
  run = complete(graph, run, 'a', '2026-07-26T00:01:00Z');
  run = complete(graph, run, 'b', '2026-07-26T00:02:00Z', 0, 'failed');
  assert.equal(run.nodeRuns.d.activations.length, 1);
  assert.equal(run.nodeRuns.d.activations[0].inputTokenIds.length, 2);
});

test('不可能满足的成功条件会明确阻塞，而不是永远等待', () => {
  const graph = graphFrom({
    nodes: [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' }
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', when: 'success' }]
  });
  let run = createGraphRun(graph, { id: ids('block'), now: time('2026-07-26T00:00:00Z') });
  run = complete(graph, run, 'a', '2026-07-26T00:01:00Z', 0, 'failed');
  assert.equal(run.nodeRuns.b.status, 'blocked');
  assert.equal(run.status, 'failed');
});

test('人工闸门批准后发成功信号，拒绝后走失败信号', () => {
  const graph = graphFrom({
    nodes: [
      { id: 'gate', type: 'approval', title: '上线确认' },
      { id: 'ship', title: '发布', trigger: { mode: 'all' } },
      { id: 'rollback', title: '回滚', trigger: { mode: 'all' } }
    ],
    edges: [
      { id: 'success', from: 'gate', to: 'ship', when: 'success' },
      { id: 'failure', from: 'gate', to: 'rollback', when: 'failure' }
    ]
  });
  let approvedRun = createGraphRun(graph, { id: ids('approve'), now: time('2026-07-26T00:00:00Z') });
  assert.equal(approvedRun.nodeRuns.gate.status, 'waiting_approval');
  approvedRun = approveActivation(
    graph,
    approvedRun,
    'gate',
    activation(approvedRun, 'gate').id,
    true,
    { id: ids('approve-event'), now: time('2026-07-26T00:01:00Z') }
  );
  assert.equal(approvedRun.nodeRuns.ship.status, 'queued');

  let rejectedRun = createGraphRun(graph, { id: ids('reject'), now: time('2026-07-26T01:00:00Z') });
  rejectedRun = approveActivation(
    graph,
    rejectedRun,
    'gate',
    activation(rejectedRun, 'gate').id,
    false,
    { id: ids('reject-event'), now: time('2026-07-26T01:01:00Z') }
  );
  assert.equal(rejectedRun.nodeRuns.rollback.status, 'queued');
});

test('等待节点到点自动完成并触发下游', () => {
  const graph = graphFrom({
    nodes: [
      { id: 'wait', type: 'delay', title: '冷却', delaySeconds: 60 },
      { id: 'next', title: '下一步' }
    ],
    edges: [{ id: 'wn', from: 'wait', to: 'next' }]
  });
  let run = createGraphRun(graph, { id: ids('delay'), now: time('2026-07-26T00:00:00Z') });
  assert.equal(run.nodeRuns.wait.status, 'delayed');
  run = advanceGraphRun(graph, run, {
    id: ids('delay-event'),
    now: time('2026-07-26T00:01:01Z')
  });
  assert.equal(run.nodeRuns.wait.status, 'succeeded');
  assert.equal(run.nodeRuns.next.status, 'queued');
});

test('看门狗按心跳、卡住阈值、超时与重试预算处理运行节点', () => {
  const graph = graphFrom({
    monitor: {
      enabled: true,
      staleAfterMinutes: 5,
      timeoutMinutes: 60,
      recovery: 'retry'
    },
    nodes: [{
      id: 'a',
      title: 'A',
      policy: { maxRetries: 1, recovery: 'inherit' }
    }],
    edges: []
  });
  let run = createGraphRun(graph, { id: ids('watch'), now: time('2026-07-26T00:00:00Z') });
  run = transitionActivation(
    graph,
    run,
    'a',
    activation(run, 'a').id,
    'running',
    { runtimeId: 'runtime-1' },
    { id: ids('watch-start'), now: time('2026-07-26T00:00:10Z') }
  );
  run = recordHeartbeat(
    graph,
    run,
    'a',
    activation(run, 'a').id,
    { id: ids('heartbeat'), now: time('2026-07-26T00:04:00Z') }
  );
  let swept = sweepWatchdog(graph, run, {
    id: ids('sweep'),
    now: time('2026-07-26T00:08:00Z')
  });
  assert.equal(swept.actions.length, 0);

  swept = sweepWatchdog(graph, swept.run, {
    id: ids('sweep-late'),
    now: time('2026-07-26T00:10:00Z')
  });
  assert.equal(swept.actions[0].type, 'retry');
  assert.equal(activation(swept.run, 'a').status, 'queued');
  assert.equal(activation(swept.run, 'a').attempt, 2);

  let rerun = transitionActivation(
    graph,
    swept.run,
    'a',
    activation(swept.run, 'a').id,
    'running',
    { runtimeId: 'runtime-2' },
    { id: ids('rerun'), now: time('2026-07-26T00:11:00Z') }
  );
  const exhausted = sweepWatchdog(graph, rerun, {
    id: ids('exhausted'),
    now: time('2026-07-26T00:17:00Z')
  });
  assert.equal(exhausted.actions[0].type, 'alert');
  assert.equal(activation(exhausted.run, 'a').status, 'stalled');

  rerun = retryActivation(
    graph,
    exhausted.run,
    'a',
    activation(exhausted.run, 'a').id,
    { id: ids('manual-retry'), now: time('2026-07-26T00:18:00Z') }
  );
  assert.equal(activation(rerun, 'a').status, 'queued');
});

test('一次、间隔和日历计划都生成明确 nextAt，触发后推进游标', () => {
  const once = initializeSchedule({
    enabled: true,
    type: 'once',
    onceAt: '2026-07-26T08:00:00Z'
  }, '2026-07-26T07:00:00Z');
  assert.equal(once.nextAt, '2026-07-26T08:00:00.000Z');
  assert.equal(scheduleIsDue({ schedule: once }, '2026-07-26T08:00:01Z'), true);
  const onceDone = markScheduleTriggered(once, '2026-07-26T08:00:01Z');
  assert.equal(onceDone.enabled, false);
  assert.equal(onceDone.nextAt, null);

  const interval = initializeSchedule({
    enabled: true,
    type: 'interval',
    intervalMinutes: 30,
    anchorAt: '2026-07-26T00:00:00Z'
  }, '2026-07-26T00:05:00Z');
  assert.equal(interval.nextAt, '2026-07-26T00:30:00.000Z');
  assert.equal(
    scheduleNextAt(interval, '2026-07-26T00:30:00Z'),
    '2026-07-26T01:00:00.000Z'
  );

  const calendar = initializeSchedule({
    enabled: true,
    type: 'calendar',
    time: '09:15',
    weekdays: [0, 1, 2, 3, 4, 5, 6]
  }, new Date(2026, 6, 26, 8, 0, 0));
  const next = new Date(calendar.nextAt);
  assert.equal(next.getHours(), 9);
  assert.equal(next.getMinutes(), 15);
});

test('同一图的多个运行实例隔离，进度来自当前运行', () => {
  const graph = graphFrom({
    nodes: [{ id: 'a', title: 'A' }],
    edges: []
  });
  let first = createGraphRun(graph, { runId: 'run-1', now: time('2026-07-26T00:00:00Z') });
  first = complete(graph, first, 'a', '2026-07-26T00:01:00Z');
  const second = createGraphRun(graph, {
    runId: 'run-2',
    number: 2,
    now: time('2026-07-26T01:00:00Z')
  });
  const withRuns = normalizeWorkgraph({
    ...graph,
    runs: [first, second],
    activeRunId: second.id
  });

  assert.equal(first.status, 'completed');
  assert.equal(second.status, 'running');
  assert.deepEqual(workgraphProgress(withRuns), {
    total: 1,
    completed: 0,
    failed: 0,
    running: 1,
    waitingApproval: 0,
    stalled: 0,
    waiting: 0,
    ready: false
  });
});

test('工作图列表去重并按最后更新时间排序', () => {
  const list = normalizeWorkgraphList([
    { id: 'older', updatedAt: '2026-07-20T00:00:00Z' },
    { id: 'newer', updatedAt: '2026-07-25T00:00:00Z' },
    { id: 'older', updatedAt: '2026-07-26T00:00:00Z' }
  ]);

  assert.deepEqual(list.map((item) => item.id), ['newer', 'older']);
});
