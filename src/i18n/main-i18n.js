/* 主进程 i18n：复用 renderer 的同一份权威词表（zh/en/ja.js），提供 mt(lang, key, params)。
 * locale 文件是双载体 IIFE（浏览器挂 window，Node 挂 module.exports），这里按 Node 侧 require 取表。
 * 新增语言 = 加一个 locale 文件 + 在 LANGS 里多列一项。 */
const LANGS = ['zh', 'en', 'ja'];
const FALLBACK = 'zh';

const LOCALES = {};
for (const lang of LANGS) {
  try {
    const mod = require(`./${lang}.js`);
    const table = mod && mod.AgentDeskLocales && mod.AgentDeskLocales[lang];
    if (table) LOCALES[lang] = table;
  } catch (_error) {
    // 缺某个 locale 文件时安静降级到 fallback，绝不因词表缺失让主进程崩溃
  }
}

function mt(lang, key, params) {
  const table = LOCALES[lang] || LOCALES[FALLBACK] || {};
  let value = table[key];
  if (value == null) value = (LOCALES[FALLBACK] || {})[key];
  if (value == null) return key; // 兜底回 key，永不返回 undefined
  if (params) {
    value = String(value).replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? String(params[k]) : m));
  }
  return value;
}

module.exports = { mt, LOCALES, LANGS, FALLBACK };
