'use strict';

// English counts: {name|one|other} picks "1 cat" or "2 cats". Both translate
// functions (renderer t() and main-process mt()) follow the same rule.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mt } = require('../src/i18n/main-i18n');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function rendererI18n(lang) {
  const win = {};
  for (const file of ['src/i18n/zh.js', 'src/i18n/en.js', 'src/i18n/ja.js', 'src/i18n/i18n.js']) {
    new Function('self', read(file))(win);
  }
  win.I18N.setLang(lang);
  return win.I18N;
}

test('renderer t(): one cat, two cats; Chinese and Japanese unchanged', () => {
  const en = rendererI18n('en');
  assert.equal(en.t('roster.allMeta', { agents: 1, n: 0 }), '1 cat · 0');
  assert.equal(en.t('roster.allMeta', { agents: 2, n: 5 }), '2 cats · 5');
  assert.equal(en.t('roster.allAgents', { agents: 0 }), '0 cats');
  assert.equal(en.t('card.replies', { n: 1 }), '1 new reply');
  assert.equal(en.t('card.mail.title', { n: 1 }), '1 new reply. Click to see only this one');
  assert.equal(en.t('card.mail.title', { n: 3 }), '3 new replies. Click to see only these');
  assert.equal(en.t('recruit.existing.found', { n: '1' }), 'Found 1 account in the usual folders.');
  assert.equal(en.t('roster.allAgents'), '{agents} cats', 'without params the count stays a placeholder and the noun is plural');
  assert.equal(rendererI18n('zh').t('roster.allMeta', { agents: 1, n: 0 }), '1 只 · 0 条');
  assert.equal(rendererI18n('ja').t('roster.allAgents', { agents: 1 }), '1 匹');
});

test('main-process mt() follows the same rule', () => {
  assert.equal(mt('en', 'roster.allAgents', { agents: 1 }), '1 cat');
  assert.equal(mt('en', 'quota.overview.rest', { n: 1 }), '1 more account has no official quota API');
  assert.equal(mt('en', 'quota.overview.rest', { n: 4 }), '4 more accounts have no official quota API');
  assert.equal(mt('en', 'status.crashpadPruned', { n: 1 }).includes('1 old file was safely removed.'), true);
  assert.equal(mt('zh', 'roster.allAgents', { agents: 1 }), '1 只');
});

test('every brace in the language tables is a well-formed placeholder', () => {
  const tokens = /\{\w+(?:\|[^{}|]*\|[^{}|]*)?\}/g;
  for (const lang of ['zh', 'en', 'ja']) {
    const table = require(`../src/i18n/${lang}.js`).AgentDeskLocales[lang];
    for (const [key, value] of Object.entries(table)) {
      if (typeof value !== 'string') continue;
      const rest = value.replace(tokens, '');
      assert.ok(!/[{}]/.test(rest) || /<[a-z]/i.test(value), `${lang} ${key} has a brace that is not a placeholder: ${value}`);
      for (const match of value.matchAll(/\{(\w+)\|[^{}|]*\|[^{}|]*\}/g)) {
        assert.ok(value.includes(`{${match[1]}}`), `${lang} ${key}: the plural for {${match[1]}} has no count beside it`);
      }
    }
  }
});
