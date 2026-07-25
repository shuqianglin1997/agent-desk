const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  indexSessionArtifacts,
  formatCodexPlan,
  isPlanningPath
} = require('../src/session-artifacts');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentdesk-artifacts-'));
  const sessionRoot = path.join(root, '.agent-home');
  const projectPath = path.join(root, 'project');
  fs.mkdirSync(sessionRoot, { recursive: true });
  fs.mkdirSync(projectPath, { recursive: true });
  return {
    root,
    sessionRoot,
    projectPath,
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

function session(input = {}) {
  return {
    id: 'session-1',
    appId: 'claude-cli',
    title: 'Plan the feature',
    createdAt: '2026-07-25T01:00:00.000Z',
    updatedAt: '2026-07-25T03:00:00.000Z',
    projectPath: input.projectPath,
    filePath: input.filePath,
    ...input
  };
}

test('Claude ExitPlanMode resolves its exact plan file and selects it by default', async () => {
  const fx = fixture();
  try {
    const projectDir = path.join(fx.sessionRoot, 'projects', 'project-slug');
    const planDir = path.join(fx.sessionRoot, 'plans');
    const transcript = path.join(projectDir, 'session-1.jsonl');
    const planPath = path.join(planDir, 'quiet-fox.md');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(planPath, '# Exact plan\n\nShip the artifact index.');
    fs.writeFileSync(transcript, JSON.stringify({
      type: 'assistant',
      timestamp: '2026-07-25T02:00:00.000Z',
      message: {
        content: [{
          type: 'tool_use',
          name: 'ExitPlanMode',
          input: {
            plan: '# Transcript plan',
            planFilePath: planPath
          }
        }]
      }
    }) + '\n');

    const result = await indexSessionArtifacts(
      { appId: 'claude-cli', sessionRoot: fx.sessionRoot },
      session({ projectPath: fx.projectPath, filePath: transcript })
    );

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, 'quiet-fox.md');
    assert.equal(result.items[0].confidence, 'exact');
    assert.equal(result.items[0].selectedByDefault, true);
    assert.equal(result.items[0].reason, 'session-plan');
    assert.match(result.items[0].content, /Ship the artifact index/);
    assert.equal(result.items[0].relativePath, path.join('plans', 'quiet-fox.md'));
  } finally {
    fx.cleanup();
  }
});

test('Claude keeps the in-session plan snapshot when its plan file was removed', async () => {
  const fx = fixture();
  try {
    const projectDir = path.join(fx.sessionRoot, 'projects', 'project-slug');
    const transcript = path.join(projectDir, 'session-1.jsonl');
    const missingPlan = path.join(fx.sessionRoot, 'plans', 'removed-plan.md');
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(transcript, JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          name: 'ExitPlanMode',
          input: {
            plan: '# Recoverable snapshot\n\nThe file no longer exists.',
            planFilePath: missingPlan
          }
        }]
      }
    }) + '\n');

    const result = await indexSessionArtifacts(
      { appId: 'claude-cli', sessionRoot: fx.sessionRoot },
      session({ projectPath: fx.projectPath, filePath: transcript })
    );

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].path, null);
    assert.equal(result.items[0].selectedByDefault, true);
    assert.match(result.items[0].content, /Recoverable snapshot/);
  } finally {
    fx.cleanup();
  }
});

test('Codex update_plan becomes a virtual handoff artifact', async () => {
  const fx = fixture();
  try {
    const sessionDir = path.join(fx.sessionRoot, 'sessions', '2026', '07', '25');
    const transcript = path.join(sessionDir, 'rollout-session-1.jsonl');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(transcript, [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-07-25T01:00:00.000Z',
        payload: { id: 'session-1', cwd: fx.projectPath }
      }),
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-07-25T02:00:00.000Z',
        payload: {
          type: 'function_call',
          name: 'update_plan',
          arguments: JSON.stringify({
            explanation: 'Keep the next agent aligned.',
            plan: [
              { step: 'Inspect the session', status: 'completed' },
              { step: 'Build artifact indexing', status: 'in_progress' },
              { step: 'Verify handoff copy', status: 'pending' }
            ]
          })
        }
      })
    ].join('\n'));

    const result = await indexSessionArtifacts(
      { appId: 'codex', sessionRoot: fx.sessionRoot },
      session({ appId: 'codex', projectPath: fx.projectPath, filePath: transcript })
    );

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].source, 'session-plan');
    assert.equal(result.items[0].selectedByDefault, true);
    assert.match(result.items[0].content, /- \[x\] Inspect the session/);
    assert.match(result.items[0].content, /- \[>\] Build artifact indexing/);
    assert.match(result.items[0].content, /- \[ \] Verify handoff copy/);
  } finally {
    fx.cleanup();
  }
});

test('nested JSON desktop sessions can expose an ExitPlanMode snapshot', async () => {
  const fx = fixture();
  try {
    const transcriptDir = path.join(fx.sessionRoot, 'claude-code-sessions');
    const transcript = path.join(transcriptDir, 'local_session-1.json');
    const planPath = path.join(fx.projectPath, 'plans', 'desktop-plan.md');
    fs.mkdirSync(transcriptDir, { recursive: true });
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, '# Desktop plan');
    fs.writeFileSync(transcript, JSON.stringify({
      sessionId: 'session-1',
      history: [{
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            name: 'ExitPlanMode',
            input: { plan: '# Snapshot', planFilePath: planPath }
          }]
        }
      }]
    }));

    const result = await indexSessionArtifacts(
      { appId: 'claude', sessionRoot: fx.sessionRoot },
      session({ appId: 'claude', projectPath: fx.projectPath, filePath: transcript })
    );
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, 'desktop-plan.md');
    assert.equal(result.items[0].selectedByDefault, true);
  } finally {
    fx.cleanup();
  }
});

test('project planning files in the session time window are opt-in candidates', async () => {
  const fx = fixture();
  try {
    const transcriptDir = path.join(fx.sessionRoot, 'sessions');
    const transcript = path.join(transcriptDir, 'session-1.jsonl');
    const roadmap = path.join(fx.projectPath, 'docs', 'ROADMAP.md');
    fs.mkdirSync(transcriptDir, { recursive: true });
    fs.mkdirSync(path.dirname(roadmap), { recursive: true });
    fs.writeFileSync(transcript, '{}\n');
    fs.writeFileSync(roadmap, '# Roadmap\n\nCandidate work.');
    const inWindow = new Date('2026-07-25T02:30:00.000Z');
    fs.utimesSync(roadmap, inWindow, inWindow);

    const result = await indexSessionArtifacts(
      { appId: 'codex', sessionRoot: fx.sessionRoot },
      session({ appId: 'codex', projectPath: fx.projectPath, filePath: transcript })
    );

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].kind, 'roadmap');
    assert.equal(result.items[0].confidence, 'related');
    assert.equal(result.items[0].selectedByDefault, false);
    assert.equal(result.items[0].reason, 'activity-window');
    assert.equal(result.items[0].relativePath, path.join('docs', 'ROADMAP.md'));
  } finally {
    fx.cleanup();
  }
});

test('a live transcript mtime extends a stale indexed session window', async () => {
  const fx = fixture();
  try {
    const transcriptDir = path.join(fx.sessionRoot, 'sessions');
    const transcript = path.join(transcriptDir, 'session-1.jsonl');
    const handoff = path.join(fx.projectPath, 'HANDOFF-NOTES.md');
    fs.mkdirSync(transcriptDir, { recursive: true });
    fs.writeFileSync(transcript, '{}\n');
    fs.writeFileSync(handoff, '# Current-session notes');
    const liveTime = new Date('2026-07-25T14:00:00.000Z');
    fs.utimesSync(transcript, liveTime, liveTime);
    fs.utimesSync(handoff, liveTime, liveTime);

    const result = await indexSessionArtifacts(
      { appId: 'codex', sessionRoot: fx.sessionRoot },
      session({
        appId: 'codex',
        projectPath: fx.projectPath,
        filePath: transcript,
        // Simulates Codex session_index.jsonl staying at thread creation.
        updatedAt: '2026-07-25T01:01:00.000Z'
      })
    );

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, 'HANDOFF-NOTES.md');
    assert.equal(result.items[0].confidence, 'related');
  } finally {
    fx.cleanup();
  }
});

test('an explicit planning path outside the project and session roots is rejected', async () => {
  const fx = fixture();
  try {
    const transcriptDir = path.join(fx.sessionRoot, 'projects');
    const transcript = path.join(transcriptDir, 'session-1.jsonl');
    const outside = path.join(fx.root, 'other', 'PLAN.md');
    fs.mkdirSync(transcriptDir, { recursive: true });
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, '# Must not leak');
    fs.writeFileSync(transcript, JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          name: 'Read',
          input: { file_path: outside }
        }]
      }
    }) + '\n');

    const result = await indexSessionArtifacts(
      { appId: 'claude-cli', sessionRoot: fx.sessionRoot },
      session({ projectPath: fx.projectPath, filePath: transcript })
    );
    assert.deepEqual(result.items, []);
  } finally {
    fx.cleanup();
  }
});

test('artifact content is clipped at the per-file handoff limit', async () => {
  const fx = fixture();
  try {
    const transcriptDir = path.join(fx.sessionRoot, 'projects');
    const transcript = path.join(transcriptDir, 'session-1.jsonl');
    const planPath = path.join(fx.projectPath, 'PLAN-LARGE.md');
    fs.mkdirSync(transcriptDir, { recursive: true });
    fs.writeFileSync(planPath, `# Large plan\n${'x'.repeat(100 * 1024)}`);
    fs.writeFileSync(transcript, JSON.stringify({
      type: 'assistant',
      message: {
        content: [{
          type: 'tool_use',
          name: 'Read',
          input: { file_path: planPath }
        }]
      }
    }) + '\n');

    const result = await indexSessionArtifacts(
      { appId: 'claude-cli', sessionRoot: fx.sessionRoot },
      session({ projectPath: fx.projectPath, filePath: transcript })
    );
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].truncated, true);
    assert.ok(Buffer.byteLength(result.items[0].content, 'utf8') <= 64 * 1024);
  } finally {
    fx.cleanup();
  }
});

test('planning path classifier stays narrow and Codex plan formatting tolerates bad input', () => {
  assert.equal(isPlanningPath('/repo/PLAN.md'), true);
  assert.equal(isPlanningPath('/repo/docs/TASKS.txt'), true);
  assert.equal(isPlanningPath('/repo/plans/quiet-fox.md'), true);
  assert.equal(isPlanningPath('/repo/src/planner.js'), false);
  assert.equal(isPlanningPath('/repo/docs/PRODUCT.md'), false);
  assert.equal(formatCodexPlan({ plan: [{ step: 'Only step', status: 'pending' }] }), [
    '# Session execution plan',
    '',
    '- [ ] Only step'
  ].join('\n'));
  assert.equal(formatCodexPlan({ plan: [] }), '');
});
