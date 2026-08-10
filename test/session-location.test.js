const { test } = require('node:test');
const assert = require('node:assert');

const SessionLocation = require('../src/session-location');

test('单会话定位只输出路径和精确坐标', () => {
  const session = {
    id: 'thread-123',
    address: 'thread-123',
    projectPath: '/Users/demo/project',
    filePath: '/Users/demo/.codex/sessions/rollout.jsonl',
    title: '不应进入剪贴板',
    source: 'Codex',
    status: '可用'
  };

  assert.equal(SessionLocation.pathOf(session), '/Users/demo/project');
  assert.equal(
    SessionLocation.coordinateOf(session),
    '/Users/demo/.codex/sessions/rollout.jsonl#thread-123'
  );
  assert.equal(
    SessionLocation.format(session, { path: '路径', coordinate: '坐标', empty: '未记录' }),
    '路径: /Users/demo/project\n坐标: /Users/demo/.codex/sessions/rollout.jsonl#thread-123'
  );
});

test('项目路径缺失时退回会话源文件，SQLite 行仍由文件加 ID 定位', () => {
  const session = {
    id: 'composer-9',
    projectPath: null,
    filePath: '/Users/demo/Library/Application Support/Cursor/User/globalStorage/state.vscdb'
  };

  assert.equal(SessionLocation.pathOf(session), session.filePath);
  assert.equal(SessionLocation.coordinateOf(session), `${session.filePath}#composer-9`);
});

test('多选只编号分隔定位，不生成标题、账号、总结、优先级或交接话术', () => {
  const text = SessionLocation.format([
    {
      id: 'a',
      projectPath: '/work/a',
      filePath: '/history/a.jsonl',
      title: '标题 A',
      account: '工作号'
    },
    {
      id: 'b',
      projectPath: '/work/b',
      filePath: '/history/b.jsonl',
      title: '标题 B',
      summary: '交接摘要'
    }
  ], { path: '路径', coordinate: '坐标' });

  assert.equal(text, [
    '1.',
    '路径: /work/a',
    '坐标: /history/a.jsonl#a',
    '',
    '2.',
    '路径: /work/b',
    '坐标: /history/b.jsonl#b'
  ].join('\n'));
  assert.doesNotMatch(text, /标题|账号|摘要|优先级|交接|请继续|prompt/i);
});

test('收到的跨设备定位继续复用同一条路径加坐标格式', () => {
  const text = SessionLocation.formatLocations([
    { path: 'D:\\Projects\\AgentDesk', coordinate: 'D:\\Sessions\\a.jsonl#thread-a', device: 'GPU PC' },
    { path: '/Users/me/AgentDesk', coordinate: '/Users/me/.codex/b.jsonl#thread-b', title: 'hidden' }
  ], { path: '路径', coordinate: '坐标' });
  assert.equal(text, [
    '1.',
    '路径: D:\\Projects\\AgentDesk',
    '坐标: D:\\Sessions\\a.jsonl#thread-a',
    '',
    '2.',
    '路径: /Users/me/AgentDesk',
    '坐标: /Users/me/.codex/b.jsonl#thread-b'
  ].join('\n'));
  assert.doesNotMatch(text, /GPU PC|hidden/);
});
