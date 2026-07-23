/*
 * AgentDesk i18n runtime —— 独立模块，无第三方依赖。
 *
 * 词表在 src/i18n/{zh,en,ja}.js 里各自注册到 window.AgentDeskLocales.<code>。
 * 加一门语言 = 加一个 <code>.js（注册 { meta:{label}, ...keys }）+ 在 index.html 多引一行 <script>。
 * 运行时无需改动本文件。
 *
 * 用法：
 *   静态文案 —— HTML 元素加 data-i18n="key"（或 data-i18n-title / -placeholder / -aria / -html），
 *              I18N.apply() 会按当前语言替换。
 *   动态文案 —— JS 里用 I18N.t('key', { name: '…' })，占位符写成 {name}。
 *   缺 key 时逐级回退：当前语言 → FALLBACK(zh) → key 本身（永不抛错、永不显示空白）。
 */
(function (root) {
  const LOCALES = root.AgentDeskLocales || (root.AgentDeskLocales = {});
  const FALLBACK = 'zh';
  let current = FALLBACK;

  const has = (lang) => Object.prototype.hasOwnProperty.call(LOCALES, lang);
  const dict = (lang) => LOCALES[lang] || {};
  const hasKey = (d, key) => Object.prototype.hasOwnProperty.call(d, key);

  // 系统语言 → 支持的语言码（不支持则 FALLBACK）
  function detect() {
    const nav = String((root.navigator && root.navigator.language) || '').toLowerCase();
    if (nav.startsWith('ja') && has('ja')) return 'ja';
    if (nav.startsWith('en') && has('en')) return 'en';
    if (nav.startsWith('zh') && has('zh')) return 'zh';
    return FALLBACK;
  }

  // 取翻译：当前 → 回退 → key；{param} 占位用 params 替换
  function t(key, params) {
    const d = dict(current);
    let s = hasKey(d, key) ? d[key] : (hasKey(dict(FALLBACK), key) ? dict(FALLBACK)[key] : key);
    if (params) s = String(s).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
    return s;
  }

  // 替换 DOM 里的 data-i18n（文本）/ -title / -placeholder / -aria / -html
  function apply(scope) {
    const el = scope || root.document;
    if (!el || !el.querySelectorAll) return;
    el.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.getAttribute('data-i18n')); });
    el.querySelectorAll('[data-i18n-html]').forEach((n) => { n.innerHTML = t(n.getAttribute('data-i18n-html')); });
    el.querySelectorAll('[data-i18n-title]').forEach((n) => { n.title = t(n.getAttribute('data-i18n-title')); });
    el.querySelectorAll('[data-i18n-placeholder]').forEach((n) => { n.setAttribute('placeholder', t(n.getAttribute('data-i18n-placeholder'))); });
    el.querySelectorAll('[data-i18n-aria]').forEach((n) => { n.setAttribute('aria-label', t(n.getAttribute('data-i18n-aria'))); });
  }

  function setLang(lang, opts) {
    current = has(lang) ? lang : FALLBACK;
    if (root.document && root.document.documentElement) {
      root.document.documentElement.lang = current === 'zh' ? 'zh-CN' : current;
    }
    apply();
    if (root.dispatchEvent && typeof root.CustomEvent === 'function') {
      root.dispatchEvent(new root.CustomEvent('i18n:changed', {
        detail: { lang: current, persist: !!(opts && opts.persist) }
      }));
    }
    return current;
  }

  // 初始化：优先用户存过的语言，否则跟随系统
  function init(saved) {
    return setLang(saved && has(saved) ? saved : detect());
  }

  // 可用语言列表（[{code,label}]），供语言切换 UI 用；加语言自动出现
  function langs() {
    return Object.keys(LOCALES).map((code) => ({
      code,
      label: (LOCALES[code].meta && LOCALES[code].meta.label) || code
    }));
  }

  // 下一门语言（循环切换用）
  function next() {
    const codes = Object.keys(LOCALES);
    if (!codes.length) return FALLBACK;
    return codes[(codes.indexOf(current) + 1) % codes.length];
  }

  root.I18N = { t, apply, setLang, getLang: () => current, langs, next, detect, init, FALLBACK };
})(typeof self !== 'undefined' ? self : this);
