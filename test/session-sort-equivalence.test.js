// AgentDesk — the session list's two sorts, computed faster, give the same
// rows in the same order: each row's sort value is read once instead of in
// every comparison. The reference functions below are the previous code,
// kept verbatim, so any difference in order fails here.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const SessionTable = require('../src/session-table');

// Previous SessionTable.sort (sortableValue inside the comparator).
function referenceSort(records, sortState = {}, locale = 'zh-CN') {
  const DATE_FIELDS = new Set(['createdAt', 'updatedAt']);
  const sortableValue = (session, key) => {
    const value = SessionTable.fieldValue(session, key);
    if (value === null || value === undefined || value === '') return null;
    if (DATE_FIELDS.has(key)) {
      const timestamp = new Date(value).getTime();
      return Number.isFinite(timestamp) ? timestamp : null;
    }
    return String(value);
  };
  const key = sortState.key || 'updatedAt';
  const direction = sortState.direction === 'asc' ? 'asc' : 'desc';
  const sign = direction === 'asc' ? 1 : -1;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  return (Array.isArray(records) ? records : [])
    .map((record, index) => ({ record, index }))
    .sort((left, right) => {
      const a = sortableValue(left.record, key);
      const b = sortableValue(right.record, key);
      if (a === null && b === null) return left.index - right.index;
      if (a === null) return 1;
      if (b === null) return -1;
      const compared = typeof a === 'number' && typeof b === 'number'
        ? a - b
        : collator.compare(String(a), String(b));
      return compared === 0 ? left.index - right.index : compared * sign;
    })
    .map((entry) => entry.record);
}

// Previous merge in loadLocalSessions (src/renderer/views/data.js).
function referenceMerge(lists) {
  return lists.flat().sort((a, b) => (
    new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
  ));
}

// A small deterministic generator, so a failure can be replayed.
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const DATES = ['2026-11-24T10:00:00.000Z', '2026-11-24T10:00:00.000Z', '2026-11-23T08:30:00.000Z', '2026-01-02', 'not a date', '', null, undefined, 0, 1732442400000];
const WORDS = ['Alpha', 'alpha', 'beta', '项目 2', '项目 10', 'プロジェクト', '', null, 'Zeta 3', 'zeta 21'];

function rows(next, count, profileId) {
  const pick = (list) => list[Math.floor(next() * list.length)];
  return Array.from({ length: count }, (_, index) => ({
    id: `${profileId}-${index}`,
    address: next() < 0.5 ? `addr-${Math.floor(next() * 50)}` : undefined,
    title: pick(WORDS),
    projectPath: pick(WORDS),
    status: pick(['active', 'archived', null]),
    model: pick(['gpt', 'claude', '', null]),
    source: pick(['desktop', 'cli', null]),
    updatedAt: pick(DATES),
    createdAt: pick(DATES),
    _profileId: profileId,
    _accountName: pick(WORDS),
    _profileName: pick(WORDS),
    _appLabel: pick(['Codex', 'Claude', 'Kimi', ''])
  }));
}

const KEYS = ['updatedAt', 'createdAt', 'title', 'project', 'account', 'app', 'source', 'status', 'model', 'id', 'unknown-key'];

test('SessionTable.sort：每一列、两个方向、三种语言，和原来的做法逐行相同', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const next = random(seed);
    const records = rows(next, 30 + Math.floor(next() * 150), `p${seed}`);
    // A filtered view: some rows dropped, as search and the mark filters do.
    const filtered = records.filter(() => next() < 0.7);
    for (const list of [records, filtered, []]) {
      for (const key of KEYS) {
        for (const direction of ['asc', 'desc', undefined]) {
          for (const locale of ['zh-CN', 'en', 'ja']) {
            const expected = referenceSort(list, { key, direction }, locale);
            const actual = SessionTable.sort(list, { key, direction }, locale);
            assert.deepEqual(actual.map((row) => row.id), expected.map((row) => row.id), `seed ${seed} ${key} ${direction} ${locale}`);
            assert.ok(actual.every((row, index) => row === expected[index]), 'the same row objects');
          }
        }
      }
    }
  }
  assert.deepEqual(SessionTable.sort(null), []);
});

test('合并各账号的行按最近活跃排：任意账号范围、空账号、缺失或无效的时间，和原来的做法逐行相同', () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const next = random(seed * 7919);
    const accounts = Array.from({ length: 1 + Math.floor(next() * 10) }, (_, index) => rows(next, Math.floor(next() * 120), `acct${index}`));
    // "Current agent" scope: only some accounts are listed.
    const scoped = accounts.filter(() => next() < 0.6);
    for (const lists of [accounts, scoped, [[]], []]) {
      const expected = referenceMerge(lists.map((list) => [...list]));
      const actual = SessionTable.byRecent(lists.flat());
      assert.deepEqual(actual.map((row) => row.id), expected.map((row) => row.id), `seed ${seed}`);
      assert.ok(actual.every((row, index) => row === expected[index]), 'the same row objects');
    }
  }
});

test('没有聚焦、勾选或选定副本时，按会话清单校验上下文得到的仍是同样的上下文（所以可以跳过）', () => {
  const UiContext = require('../src/ui-context');
  let context = UiContext.create();
  context = UiContext.setAgentScope(context, 'all');
  const validity = { validConversationIds: ['p1::a', 'p2::b'], validReplicaIdsByConversation: { 'p1::a': ['r1'] } };
  const cleared = UiContext.clearInvalid(context, validity);
  const plain = (value) => JSON.parse(JSON.stringify(value, (_key, item) => (item instanceof Set ? [...item] : item)));
  assert.deepEqual(plain(cleared), plain(context));
  assert.equal(context.focusedConversationId, null);
  assert.equal(context.checkedConversationIds.size, 0);
  assert.deepEqual(Object.keys(context.selectedReplicaKeyByConversation), []);
});
