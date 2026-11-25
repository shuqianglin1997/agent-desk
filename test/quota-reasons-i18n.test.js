'use strict';

// Quota reasons are written by the main process (client adapters, the quota
// service) and shown in the quota panel, the card and the footer. They used
// to be fixed Chinese text, so English and Japanese users saw Chinese. A
// snapshot now carries the language-table keys of its reasons (`reasonKeys`);
// the renderer translates them, and `reason` keeps the Chinese text from the
// zh table for anything that reads it as text.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const apps = require('../src/apps');
const { quotaUnavailable } = require('../src/quota');
const { fetchProfileQuota } = require('../src/quota-service');
const { friendlyCodexFailure } = require('../src/clients/codex/quota');
const { mt, LOCALES } = require('../src/i18n/main-i18n');
const { buildQuotaOverview } = require('../src/quota-overview');
const { rendererSource } = require('./helpers/renderer-source');

const HAN = /\p{Script=Han}/u;

function reasonKeysInTables() {
  return Object.keys(LOCALES.zh).filter((key) => key.startsWith('quota.reason.'));
}

test('every quota reason the main process writes is a key with zh, en and ja text', () => {
  const written = new Set();
  for (const appId of apps.appIds()) {
    const reason = apps.getApp(appId).quota?.unsupportedReason;
    if (reason) written.add(reason);
  }
  for (const code of ['CODEX_CLI_NOT_FOUND', 'CODEX_RPC_UNSUPPORTED', 'CODEX_RPC_TIMEOUT', 'CODEX_RATE_LIMITS_FAILED', 'SOMETHING_ELSE']) {
    written.add(friendlyCodexFailure({ code }));
  }
  assert.ok(written.size >= 7);
  for (const key of written) {
    assert.match(key, /^quota\.reason\./, `a reason is a table key, not text: ${key}`);
    for (const lang of ['zh', 'en', 'ja']) assert.equal(typeof LOCALES[lang][key], 'string', `${lang} has ${key}`);
    assert.doesNotMatch(LOCALES.en[key], HAN, `en ${key} is English`);
    assert.notEqual(LOCALES.ja[key], LOCALES.zh[key], `ja ${key} is Japanese`);
  }
  for (const key of reasonKeysInTables()) {
    for (const lang of ['en', 'ja']) assert.equal(typeof LOCALES[lang][key], 'string', `${lang} has ${key}`);
  }
});

test('a snapshot carries its reason keys, and reason keeps the Chinese text', async () => {
  const snapshot = quotaUnavailable('p1', 'codex', 'signed_out', 'quota.reason.codex.signedOut');
  assert.deepEqual(snapshot.reasonKeys, ['quota.reason.codex.signedOut']);
  assert.equal(snapshot.reason, mt('zh', 'quota.reason.codex.signedOut'));
  assert.equal(snapshot.reason, 'Codex 尚未登录或尚未返回额度');

  const unsupported = await fetchProfileQuota({ id: 'p2', appId: 'claude' });
  assert.deepEqual(unsupported.reasonKeys, ['quota.reason.claude.unsupported']);
  assert.doesNotMatch(LOCALES.en[unsupported.reasonKeys[0]], HAN);

  // A failed live read that falls back to the session cache names both reasons.
  const cached = { profileId: 'p3', provider: 'codex', status: 'stale', windows: [], reason: mt('zh', 'quota.reason.codex.cached'), reasonKeys: ['quota.reason.codex.cached'] };
  const fallback = await fetchProfileQuota({ id: 'p3', appId: 'codex', sessionRoot: '/x' }, {
    readQuota: async () => { const error = new Error('t'); error.code = 'CODEX_RPC_TIMEOUT'; throw error; },
    readCachedQuota: () => cached
  });
  assert.deepEqual(fallback.reasonKeys, ['quota.reason.codex.timeout', 'quota.reason.codex.cached']);
  assert.equal(fallback.reason, `${mt('zh', 'quota.reason.codex.timeout')}；${mt('zh', 'quota.reason.codex.cached')}`);

  const overview = buildQuotaOverview([{ id: 'p2', appId: 'claude', name: 'C' }], { p2: unsupported });
  const row = (overview.rows || overview.items || overview).find?.((item) => item.profileId === 'p2') || overview.rows?.[0];
  assert.deepEqual(row.reasonKeys, ['quota.reason.claude.unsupported']);
});

test('the renderer shows reasons in the interface language', () => {
  const source = rendererSource();
  const match = source.match(/^export function quotaReasonText\([^\n]*\) \{\n[\s\S]*?^\}/m);
  assert.ok(match, 'quotaReasonText exists');
  const tables = { en: LOCALES.en, ja: LOCALES.ja, zh: LOCALES.zh };
  for (const lang of ['en', 'ja', 'zh']) {
    const tr = (key) => tables[lang][key] ?? key;
    const run = vm.runInNewContext(`(${match[0].replace(/^export /, '')})`, { tr });
    const two = { reason: '中文', reasonKeys: ['quota.reason.codex.timeout', 'quota.reason.codex.cached'] };
    assert.equal(run(two), `${tables[lang]['quota.reason.codex.timeout']}${tables[lang]['quota.reason.separator']}${tables[lang]['quota.reason.codex.cached']}`);
    if (lang === 'en') assert.doesNotMatch(run(two), HAN);
    if (lang === 'ja') assert.notEqual(run(two), `${tables.zh['quota.reason.codex.timeout']}${tables.zh['quota.reason.separator']}${tables.zh['quota.reason.codex.cached']}`);
    // From a device that does not send keys yet: the text it sent.
    assert.equal(run({ reason: 'remote text' }), 'remote text');
    assert.equal(run({}), '');
  }
  // Every place that shows a quota reason goes through it.
  for (const file of ['src/renderer/views/quota.js', 'src/renderer/views/roster.js']) {
    const text = read(file).replace(match[0], '');
    assert.doesNotMatch(text, /(?:snapshot|quota|row|trustedQuota\.snapshot)\??\.reason(?![\w.])/, `${file} shows reasons through quotaReasonText`);
  }
});

function read(file) { return fs.readFileSync(path.join(ROOT, file), 'utf8'); }
