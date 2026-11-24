// STUN URL normalisation is pure and used by settings (core) and by the
// network layer. These cases pin its behaviour; settings and ice-config must
// give the same answer.
const test = require('node:test');
const assert = require('node:assert/strict');
const iceConfig = require('../src/mesh/network/ice-config');
const { normalizeSettings } = require('../src/settings');

const CASES = [
  [undefined, []],
  [null, []],
  ['', []],
  ['stun:a.test:3478', ['stun:a.test:3478']],
  [' stun:a.test , STUNS:b.test ,turn:c.test, https://d.test ', ['stun:a.test', 'STUNS:b.test']],
  ['stun:a.test,stun:a.test', ['stun:a.test']],
  [['stun:a.test', 'stuns:b.test', 'turn:x.test'], ['stun:a.test', 'stuns:b.test']],
  [Array.from({ length: 12 }, (_, i) => `stun:s${i}.test`), Array.from({ length: 8 }, (_, i) => `stun:s${i}.test`)],
  [42, []]
];

test('STUN URLs keep stun/stuns entries, trimmed, unique, at most eight', () => {
  for (const [input, expected] of CASES) {
    assert.deepEqual(iceConfig.normalizeStunUrls(input), expected, JSON.stringify(input));
  }
});

test('settings normalise STUN URLs the same way', () => {
  for (const [input, expected] of CASES) {
    if (input !== undefined && !Array.isArray(input) && typeof input !== 'string') continue;
    assert.deepEqual(normalizeSettings({ meshStunUrls: input }).meshStunUrls, expected, JSON.stringify(input));
  }
});
