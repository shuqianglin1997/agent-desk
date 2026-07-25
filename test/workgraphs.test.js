const { test } = require('node:test');
const assert = require('node:assert');

const {
  MAX_TASKS,
  MAX_PROMPT_LENGTH,
  createWorkgraph,
  deriveWorkgraphStatus,
  normalizeWorkgraph,
  normalizeWorkgraphList,
  workgraphProgress
} = require('../src/workgraphs');

function ids() {
  let value = 0;
  return () => `id-${++value}`;
}

test('工作图把任务与会话绑定分开，并以全完成汇合作为固定首版语义', () => {
  const graph = createWorkgraph({
    title: '并行调研',
    sessions: [
      { sessionKey: 'a::1', profileId: 'a', sessionId: '1', title: '市场' },
      { sessionKey: 'b::2', profileId: 'b', sessionId: '2', title: '技术' }
    ],
    taskPrompt: '完成当前分工并给出证据',
    synthesisSession: { sessionKey: 'c::3', profileId: 'c', sessionId: '3', title: '综合' },
    synthesisPrompt: '综合上游结论'
  }, { id: ids(), now: () => Date.parse('2026-07-25T00:00:00Z') });

  assert.equal(graph.tasks.length, 2);
  assert.equal(graph.tasks[0].profileId, 'a');
  assert.equal(graph.tasks[0].prompt, '完成当前分工并给出证据');
  assert.equal(graph.synthesis.profileId, 'c');
  assert.equal(graph.joinMode, 'all');
  assert.notEqual(graph.tasks[0].id, graph.tasks[0].sessionId);
});

test('工作图归一化限制节点数与文本体积，过滤非法状态', () => {
  const graph = normalizeWorkgraph({
    id: 'graph',
    title: 'x'.repeat(500),
    status: 'invented',
    executionMode: 'unsafe-shell',
    tasks: Array.from({ length: MAX_TASKS + 4 }, (_, index) => ({
      id: `task-${index}`,
      title: `会话 ${index}`,
      prompt: 'p'.repeat(MAX_PROMPT_LENGTH + 500),
      status: 'unknown'
    })),
    synthesis: { status: 'mystery' }
  });

  assert.equal(graph.tasks.length, MAX_TASKS);
  assert.equal(graph.title.length, 120);
  assert.equal(graph.tasks[0].prompt.length, MAX_PROMPT_LENGTH);
  assert.equal(graph.status, 'draft');
  assert.equal(graph.executionMode, 'observe');
  assert.equal(graph.tasks[0].status, 'waiting');
  assert.equal(graph.synthesis.status, 'waiting');
});

test('汇合进度区分执行、失败、全部完成与综合完成', () => {
  const graph = normalizeWorkgraph({
    id: 'graph',
    status: 'running',
    tasks: [
      { id: 'a', status: 'completed' },
      { id: 'b', status: 'running' },
      { id: 'c', status: 'waiting' }
    ],
    synthesis: { id: 's', status: 'waiting' }
  });

  assert.deepEqual(workgraphProgress(graph), {
    total: 3,
    completed: 1,
    failed: 0,
    running: 1,
    waiting: 1,
    ready: false
  });
  assert.equal(deriveWorkgraphStatus(graph), 'running');

  graph.tasks[1].status = 'failed';
  assert.equal(deriveWorkgraphStatus(graph), 'attention');

  graph.tasks[1].status = 'completed';
  graph.tasks[2].status = 'skipped';
  assert.equal(deriveWorkgraphStatus(graph), 'ready');

  graph.synthesis.status = 'completed';
  assert.equal(deriveWorkgraphStatus(graph), 'completed');
});

test('工作图列表去重并按最后更新时间排序', () => {
  const list = normalizeWorkgraphList([
    { id: 'older', updatedAt: '2026-07-20T00:00:00Z' },
    { id: 'newer', updatedAt: '2026-07-25T00:00:00Z' },
    { id: 'older', updatedAt: '2026-07-26T00:00:00Z' }
  ]);

  assert.deepEqual(list.map((item) => item.id), ['newer', 'older']);
});
