const test = require('node:test');
const assert = require('node:assert/strict');
const Vhs = require('../src/skins/vhs-presenter');

test('provider aliases use known brands and unknown clients remain independent', () => {
  for (const key of ['Codex', 'codex_cli', 'OpenAI', ' ChatGPT ']) assert.equal(Vhs.normalizeProvider(key), 'codex');
  for (const key of ['Claude', 'claude-desktop', 'anthropic']) assert.equal(Vhs.normalizeProvider(key), 'claude');
  for (const key of ['DSH', 'dsh-cli', 'dsh_desktop']) assert.equal(Vhs.normalizeProvider(key), 'dsh');
  for (const key of ['', null, {}, 'kimi', 'cursor', 'not-claude', '__proto__']) assert.equal(Vhs.normalizeProvider(key), 'other');
});

test('appearance colors are stable, independent of names and reject CSS injection', () => {
  const first = Vhs.defaultColor('agent-work');
  assert.equal(first, Vhs.defaultColor('agent-work'));
  assert.ok(Vhs.palette.includes(first));
  assert.equal(new Set(Vhs.palette).size, Vhs.palette.length);
  assert.notEqual(Vhs.defaultColor('a', 0), Vhs.defaultColor('a', 1));
  assert.equal(Vhs.normalizeColor('#AABBCC'), '#aabbcc');
  for (const color of ['url(https://example.org)', '#123; color:red', 'transparent', '#fff', null]) {
    assert.equal(Vhs.normalizeColor(color, '#abcdef'), '#abcdef');
  }
  assert.equal(Vhs.normalizeColor(null, 'invalid'), Vhs.palette[0]);
});

test('city grouping renders only real identities, deduplicates IDs, and never mutates input', () => {
  const input = Object.freeze([
    Object.freeze({ id: 'c1', name: '<script>', provider: 'Claude', color: '#aabbcc', selected: true }),
    Object.freeze({ id: 'o1', name: 'Personal', provider: 'Codex', status: 'ready' }),
    Object.freeze({ id: 'c2', name: 'Work', provider: 'claude-cli' }),
    Object.freeze({ id: 'd1', name: 'Work', provider: 'DSH' }),
    Object.freeze({ id: 'c1', name: 'Duplicate', provider: 'Codex' }),
    Object.freeze({ id: 'u1', name: 'Other', provider: 'kimi' }), null, { name: 'No ID' }
  ]);
  const groups = Vhs.groupAgents(input);
  assert.deepEqual(groups.map(group => group.provider), ['codex', 'claude', 'dsh', 'other']);
  assert.deepEqual(groups.map(group => group.agents.map(agent => agent.id)), [['o1'], ['c1', 'c2'], ['d1'], ['u1']]);
  assert.equal(groups[1].agents[0].name, '<script>');
  assert.equal(groups[1].agents[0].selected, true);
  assert.equal(input[0].provider, 'Claude');
  assert.deepEqual(Vhs.groupAgents([]), []);
  assert.deepEqual(Vhs.groupAgents(null), []);
});
