const { test } = require('node:test');
const assert = require('node:assert');

const SessionTable = require('../src/session-table');

test('跨账号会话 key 由槽位与会话身份共同组成，同 ID 不碰撞', () => {
  const a = { _profileId: 'work', id: 'thread-1' };
  const b = { _profileId: 'personal', id: 'thread-1' };
  assert.equal(SessionTable.keyOf(a), 'work::thread-1');
  assert.equal(SessionTable.keyOf(b), 'personal::thread-1');
  assert.notEqual(SessionTable.keyOf(a), SessionTable.keyOf(b));
});

test('会话表日期默认建议降序，文本默认建议升序', () => {
  assert.equal(SessionTable.defaultDirection('updatedAt'), 'desc');
  assert.equal(SessionTable.defaultDirection('createdAt'), 'desc');
  assert.equal(SessionTable.defaultDirection('title'), 'asc');
  assert.equal(SessionTable.defaultDirection('account'), 'asc');
});

test('排序支持账号派生字段、日期与空值置底，并保持同值稳定', () => {
  const records = [
    { id: 'a', _accountName: '工作号', updatedAt: '2026-07-01T00:00:00.000Z' },
    { id: 'b', _accountName: '个人号', updatedAt: null },
    { id: 'c', _accountName: '工作号', updatedAt: '2026-07-03T00:00:00.000Z' }
  ];

  assert.deepEqual(
    SessionTable.sort(records, { key: 'updatedAt', direction: 'desc' }).map((item) => item.id),
    ['c', 'a', 'b']
  );
  assert.deepEqual(
    SessionTable.sort(records, { key: 'account', direction: 'asc' }, 'zh-CN').map((item) => item.id),
    ['b', 'a', 'c']
  );
});
