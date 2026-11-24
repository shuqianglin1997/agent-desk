/* 会话的记号：新回复、在跑、五种颜色标签，以及搜索框左边那排筛选（docs/SESSION_MARKS_PLAN.md 第 4、5 节）。
 *
 * 只呈现 AgentDesk 确实知道的东西：新回复和在跑来自主进程的活动探测（8 秒一轮），标签和名字来自本机的
 * session-marks.json，经四个专用 IPC 读写，这里从不交路径。应用不替人打标签、不规定含义、不排优先级。
 *
 * 筛选只是这一次看的方式，不记进设置；它和搜索框一样只决定哪些行显示，不碰正在看的那一条和已勾选的那些。
 * 排序方式由 renderer 记进稳定设置。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.createSessionMarks = factory;
})(typeof self !== 'undefined' ? self : this, function (deps) {
  const { document, manager, tr, keyOf, rerender, setStatus, onChange = () => {} } = deps;
  const TAGS = [1, 2, 3, 4, 5];
  const ORDERS = ['recent', 'fresh', 'tag'];
  const NAME_MAX = 12;
  const state = {
    marks: { tags: {}, seen: {}, names: [null, null, null, null, null], baselineAt: 0 },
    filter: { fresh: false, tags: new Set() },
    order: 'recent',
    fresh: new Map(),
    writing: new Set(),
    shown: new Set(),
    primed: false,
    popReady: false,
    pickerKeys: [],
    pickerReturn: null
  };
  const picker = document.querySelector('#sessionTagPicker');

  function applySnapshot(snapshot) {
    if (!snapshot || snapshot.ok !== true) return false;
    state.marks = {
      tags: snapshot.tags && typeof snapshot.tags === 'object' ? snapshot.tags : {},
      seen: snapshot.seen && typeof snapshot.seen === 'object' ? snapshot.seen : {},
      names: Array.isArray(snapshot.names) ? snapshot.names.slice(0, 5) : [null, null, null, null, null],
      baselineAt: Number(snapshot.baselineAt) || 0
    };
    return true;
  }

  async function load() {
    try { applySnapshot(await manager.getSessionMarks()); } catch (_error) { /* 读不到就当没有记号 */ }
  }

  // ── 名字与形状 ───────────────────────────────────────
  const colorWord = (tag) => tr(`marks.color.${tag}`);
  const shapeWord = (tag) => tr(`marks.shape.${tag}`);
  const nameOf = (tag) => state.marks.names[tag - 1] || colorWord(tag);
  function fullName(tag) {
    const custom = state.marks.names[tag - 1];
    return custom
      ? tr('marks.tag.full', { name: custom, color: colorWord(tag), shape: shapeWord(tag) })
      : tr('marks.tag.plain', { name: colorWord(tag), shape: shapeWord(tag) });
  }
  function shape(tag, className = 'mark-shape') {
    const icon = document.createElement('i');
    icon.className = `pxi ${className}`;
    icon.dataset.i = `tag${tag}`;
    icon.dataset.tag = String(tag);
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }
  function slot(className) {
    const empty = document.createElement('i');
    empty.className = `mark-slot ${className}`;
    empty.setAttribute('aria-hidden', 'true');
    return empty;
  }

  // ── 新回复与在跑 ─────────────────────────────────────
  // activity 是主进程按运行位置给出的探测结果；hubWriting 是调度中枢正在跑的那几段的会话键。
  // 返回这一轮新冒出来的新回复条数（第一轮只当基准，不算“新冒出来”）。
  function updateFromActivity(activity, hubWriting = []) {
    const fresh = new Map();
    const writing = new Set(hubWriting);
    for (const item of activity || []) {
      for (const key of Array.isArray(item?.writingKeys) ? item.writingKeys : []) writing.add(String(key));
      for (const entry of Array.isArray(item?.freshKeys) ? item.freshKeys : []) {
        const key = String(entry?.key || '');
        const at = Number(entry?.at);
        if (key && Number.isFinite(at)) fresh.set(key, Math.max(at, fresh.get(key) || 0));
      }
    }
    state.popReady = state.primed;
    let added = 0;
    for (const [key, at] of fresh) {
      if (writing.has(key) || (Number(state.marks.seen[key]) || 0) >= at) continue;
      if (state.primed && !state.fresh.has(key)) added += 1;
    }
    state.fresh = fresh;
    state.writing = writing;
    state.primed = true;
    return added;
  }

  const freshAt = (key) => {
    const at = state.fresh.get(key);
    return at && !state.writing.has(key) && (Number(state.marks.seen[key]) || 0) < at ? at : 0;
  };
  const isFresh = (session) => { const key = keyOf(session); return Boolean(key && freshAt(key)); };
  const isWriting = (session) => { const key = keyOf(session); return Boolean(key && state.writing.has(key)); };
  const tagOf = (session) => { const key = keyOf(session); return key ? (Number(state.marks.tags[key]) || 0) : 0; };
  // 一只猫的新回复条数：它本机各运行位置的探测结果里还没看过、也不在跑的那些。
  function freshCount(activityItems) {
    const keys = new Set();
    for (const item of activityItems || []) {
      for (const entry of Array.isArray(item?.freshKeys) ? item.freshKeys : []) {
        if (entry?.key && freshAt(String(entry.key))) keys.add(String(entry.key));
      }
    }
    return keys.size;
  }

  // 人在列表里点开这一行，或用了“全部标为已看”：看过时间记成那条回复的时间。
  async function markSeen(sessions) {
    const entries = [];
    for (const session of sessions || []) {
      const key = keyOf(session);
      const at = key ? freshAt(key) : 0;
      if (!at) continue;
      entries.push({ key, at });
      state.marks.seen[key] = at;
    }
    if (!entries.length) return 0;
    onChange();
    try {
      applySnapshot(await manager.markSessionsSeen(entries));
    } catch (_error) { /* 这一次的界面已经更新；下次启动再看到它也只是多一个记号 */ }
    return entries.length;
  }

  // ── 筛选与排序 ───────────────────────────────────────
  const filterActive = () => state.filter.fresh || state.filter.tags.size > 0;
  function filter(list) {
    if (!filterActive()) return list;
    return list.filter((session) => (
      (!state.filter.fresh || isFresh(session))
      && (!state.filter.tags.size || state.filter.tags.has(tagOf(session)))
    ));
  }
  // 在表头排序之后再按分组稳定地排：新回复在前、或按标签（没有标签的排最后）。
  function order(list) {
    if (state.order === 'recent') return list;
    const rank = state.order === 'fresh'
      ? (session) => (isFresh(session) ? 0 : 1)
      : (session) => tagOf(session) || 9;
    return list.map((session, index) => ({ session, index, rank: rank(session) }))
      .sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
      .map((entry) => entry.session);
  }
  function setOrder(value) {
    state.order = ORDERS.includes(value) ? value : 'recent';
    for (const button of document.querySelectorAll('[data-session-order]')) {
      button.setAttribute('aria-pressed', String(button.dataset.sessionOrder === state.order));
    }
  }
  function clearFilters() {
    state.filter.fresh = false;
    state.filter.tags.clear();
  }
  function showFresh() {
    state.filter.fresh = true;
  }

  // 筛选条只建一次，之后原地更新：重建会让双击的第二下落在新元素上，浏览器就不再发出双击。
  function buildFilters(box) {
    const freshButton = document.createElement('button');
    freshButton.type = 'button';
    freshButton.className = 'mark-filter mark-filter-fresh';
    freshButton.dataset.markFilter = 'fresh';
    const bubble = document.createElement('i');
    bubble.className = 'pxi mark-reply';
    bubble.dataset.i = 'reply';
    bubble.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    const count = document.createElement('b');
    freshButton.append(bubble, label, count);
    const separator = document.createElement('i');
    separator.className = 'mark-filter-sep';
    separator.setAttribute('aria-hidden', 'true');
    const nodes = [freshButton, separator];
    for (const tag of TAGS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mark-filter mark-filter-tag';
      button.dataset.markFilter = String(tag);
      button.append(shape(tag));
      nodes.push(button);
    }
    box.replaceChildren(...nodes);
  }

  function renderFilters(rows, options = {}) {
    const box = document.querySelector('#sessionMarkFilters');
    if (!box || box.querySelector('.mark-rename')) return;
    if (!box.querySelector('[data-mark-filter="fresh"]') || box.querySelectorAll('[data-mark-filter]').length !== TAGS.length + 1) buildFilters(box);
    const list = Array.isArray(rows) ? rows : [];
    const freshN = list.filter(isFresh).length;
    const freshButton = box.querySelector('[data-mark-filter="fresh"]');
    freshButton.setAttribute('aria-pressed', String(state.filter.fresh));
    freshButton.title = tr('marks.fresh.title', { n: freshN });
    freshButton.querySelector('span').textContent = tr('marks.fresh');
    freshButton.querySelector('b').textContent = String(freshN);
    for (const tag of TAGS) {
      const n = list.filter((session) => tagOf(session) === tag).length;
      const button = box.querySelector(`[data-mark-filter="${tag}"]`);
      button.setAttribute('aria-pressed', String(state.filter.tags.has(tag)));
      button.title = tr('marks.tag.title', { name: fullName(tag), n });
      button.setAttribute('aria-label', `${nameOf(tag)} · ${n}`);
    }
    const clear = document.querySelector('#clearSessionFiltersBtn');
    if (clear) clear.hidden = !(filterActive() || options.query);
  }

  function toggleFilter(value) {
    if (value === 'fresh') state.filter.fresh = !state.filter.fresh;
    else {
      const tag = Number(value);
      if (!TAGS.includes(tag)) return;
      if (state.filter.tags.has(tag)) state.filter.tags.delete(tag);
      else state.filter.tags.add(tag);
    }
    rerender();
  }

  // 改名：双击筛选条里的形状（或键盘 F2），就地改，最长 12 个字；Esc 放弃，回车或离开就存。
  function startRename(tag) {
    const box = document.querySelector('#sessionMarkFilters');
    const button = box?.querySelector(`[data-mark-filter="${tag}"]`);
    if (!button) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'mark-rename';
    input.maxLength = NAME_MAX;
    input.value = nameOf(tag);
    input.setAttribute('aria-label', tr('marks.rename.aria', { color: colorWord(tag) }));
    button.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (keep) => {
      if (done) return;
      done = true;
      const value = [...input.value.trim()].slice(0, NAME_MAX).join('');
      input.replaceWith(button);
      if (keep && value !== nameOf(tag)) {
        try {
          const result = await manager.renameSessionTag(tag, value === colorWord(tag) ? '' : value);
          if (!applySnapshot(result)) setStatus(tr('marks.status.failed'), 'error');
        } catch (_error) {
          setStatus(tr('marks.status.failed'), 'error');
        }
      }
      rerender();
      document.querySelector(`#sessionMarkFilters [data-mark-filter="${tag}"]`)?.focus({ preventScroll: true });
    };
    input.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Enter') { event.preventDefault(); void finish(true); }
      if (event.key === 'Escape') { event.preventDefault(); void finish(false); }
    });
    input.addEventListener('blur', () => { void finish(true); });
  }

  function bindFilters() {
    const box = document.querySelector('#sessionMarkFilters');
    if (!box) return;
    box.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-mark-filter]');
      if (button) toggleFilter(button.dataset.markFilter);
    });
    box.addEventListener('dblclick', (event) => {
      const button = event.target.closest('button[data-mark-filter]');
      if (!button || button.dataset.markFilter === 'fresh') return;
      // 双击的两下各算了一次开关，一开一关正好还原；这里只改名。
      startRename(Number(button.dataset.markFilter));
    });
    box.addEventListener('keydown', (event) => {
      const button = event.target.closest('button[data-mark-filter]');
      if (button && event.key === 'F2' && button.dataset.markFilter !== 'fresh') {
        event.preventDefault();
        startRename(Number(button.dataset.markFilter));
      }
    });
  }

  // ── 行上的记号 ───────────────────────────────────────
  // 标签的形状在最前，然后是新回复的小气泡或在跑的三个点；标题加粗；后面是“新回复”或“在跑”小标，
  // 最后是正在看（或指着、聚焦在里面）的那一行才露出来的“标签”按钮。
  // Everything decorateTitle draws for this session, as one string: the
  // session table keeps a row while this (and the rest of the row) is the
  // same, and draws it again when it changes. A "new reply" that has not
  // popped yet counts as a change, so it still pops.
  function titleSignature(session) {
    const key = keyOf(session);
    if (!key) return '';
    const tag = tagOf(session);
    const fresh = isFresh(session);
    return JSON.stringify([key, tag, tag ? fullName(tag) : null, fresh, isWriting(session), fresh && state.popReady && !state.shown.has(key)]);
  }

  function decorateTitle(cell, session, title, options = {}) {
    if (!keyOf(session)) return;
    const key = keyOf(session);
    const tag = tagOf(session);
    const fresh = isFresh(session);
    const writing = isWriting(session);
    const line = document.createElement('span');
    line.className = 'title-line';
    const tagMark = tag ? shape(tag, 'mark-shape session-tag-mark') : slot('session-tag-mark');
    if (tag) {
      tagMark.removeAttribute('aria-hidden');
      tagMark.setAttribute('role', 'img');
      tagMark.setAttribute('aria-label', fullName(tag));
      tagMark.title = fullName(tag);
    }
    let stateMark;
    if (writing) {
      stateMark = document.createElement('span');
      stateMark.className = 'session-writing';
      stateMark.setAttribute('aria-hidden', 'true');
      stateMark.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
    } else if (fresh) {
      stateMark = document.createElement('i');
      stateMark.className = 'pxi mark-reply session-fresh-mark';
      stateMark.dataset.i = 'reply';
      stateMark.setAttribute('aria-hidden', 'true');
    } else {
      stateMark = slot('session-state-mark');
    }
    const pop = fresh && state.popReady && !state.shown.has(key) && options.pop !== false;
    if (fresh) state.shown.add(key);
    line.append(tagMark, stateMark, title);
    if (writing || fresh) {
      const badge = document.createElement('span');
      badge.className = writing ? 'session-run-word' : 'session-new-badge';
      badge.textContent = tr(writing ? 'marks.row.running' : 'marks.row.fresh');
      badge.title = tr(writing ? 'marks.row.runningHint' : 'marks.row.freshHint');
      if (pop) { badge.classList.add('fx-pop'); stateMark.classList.add('fx-pop'); }
      line.append(badge);
    }
    const tagButton = document.createElement('button');
    tagButton.type = 'button';
    tagButton.className = 'session-tag-btn';
    tagButton.textContent = tr('marks.tagButton');
    tagButton.setAttribute('aria-haspopup', 'menu');
    tagButton.setAttribute('aria-label', tr('marks.tagButton.aria', { title: session.title || session.id || '' }));
    tagButton.dataset.markKey = key;
    line.append(tagButton);
    cell.classList.toggle('is-fresh', fresh);
    cell.classList.toggle('is-writing', writing);
    cell.prepend(line);
  }

  // ── 标签选择器 ───────────────────────────────────────
  function openPicker(keys, anchor) {
    if (!picker) return;
    const list = [...new Set((keys || []).filter(Boolean))];
    if (!list.length) return;
    state.pickerKeys = list;
    state.pickerReturn = document.activeElement;
    const current = list.length === 1 ? (Number(state.marks.tags[list[0]]) || 0) : -1;
    const heading = document.createElement('div');
    heading.className = 'session-tag-picker-title';
    heading.textContent = list.length > 1 ? tr('marks.picker.checked', { n: list.length }) : tr('marks.picker');
    const items = TAGS.map((tag) => pickerItem(tag, nameOf(tag), String(tag), current === tag, shape(tag)));
    items.push(pickerItem(0, tr('marks.none'), '0', current === 0, slot('mark-none')));
    picker.replaceChildren(heading, ...items);
    if (picker.matches(':popover-open')) picker.hidePopover();
    picker.showPopover();
    const rect = anchor && typeof anchor.getBoundingClientRect === 'function'
      ? anchor.getBoundingClientRect()
      : { left: Number(anchor?.x) || 0, bottom: Number(anchor?.y) || 0 };
    const width = picker.offsetWidth;
    const height = picker.offsetHeight;
    picker.style.left = `${Math.max(8, Math.min(Math.round(rect.left), window.innerWidth - width - 8))}px`;
    const top = rect.bottom + 4 + height > window.innerHeight - 8 ? (rect.top ?? rect.bottom) - height - 4 : rect.bottom + 4;
    picker.style.top = `${Math.max(8, Math.round(top))}px`;
    (picker.querySelector('[aria-checked="true"]') || picker.querySelector('button'))?.focus({ preventScroll: true });
  }
  function pickerItem(tag, text, key, checked, icon) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', String(checked));
    button.dataset.pickTag = String(tag);
    const name = document.createElement('span');
    name.textContent = text;
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    button.append(icon, name, kbd);
    return button;
  }
  function closePicker() {
    if (picker?.matches(':popover-open')) picker.hidePopover();
  }

  async function setTag(keys, tag) {
    const list = [...new Set((keys || []).filter(Boolean))];
    if (!list.length) return;
    const value = TAGS.includes(tag) ? tag : 0;
    for (const key of list) {
      if (value) state.marks.tags[key] = value;
      else delete state.marks.tags[key];
    }
    rerender();
    try {
      const result = await manager.setSessionTag(list, value);
      if (!applySnapshot(result)) throw new Error('rejected');
      setStatus(value
        ? tr('marks.status.tagged', { n: list.length, name: nameOf(value) })
        : tr('marks.status.untagged', { n: list.length }));
    } catch (_error) {
      await load();
      setStatus(tr('marks.status.failed'), 'error');
    }
    rerender();
  }

  function bindPicker() {
    if (!picker) return;
    picker.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-pick-tag]');
      if (!button) return;
      const keys = state.pickerKeys;
      const back = state.pickerReturn;
      closePicker();
      void setTag(keys, Number(button.dataset.pickTag));
      if (back?.isConnected) back.focus({ preventScroll: true });
    });
    picker.addEventListener('keydown', (event) => {
      if (/^[0-5]$/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        picker.querySelector(`button[data-pick-tag="${event.key}"]`)?.click();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const buttons = [...picker.querySelectorAll('button')];
        const index = buttons.indexOf(document.activeElement);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
      }
    });
    picker.addEventListener('toggle', (event) => {
      if (event.newState === 'closed') state.pickerKeys = [];
    });
  }

  bindFilters();
  bindPicker();

  return {
    load,
    updateFromActivity,
    isFresh,
    isWriting,
    tagOf,
    freshAt: (session) => freshAt(keyOf(session)),
    freshCount,
    markSeen,
    filter,
    order,
    filterActive,
    setOrder,
    currentOrder: () => state.order,
    clearFilters,
    showFresh,
    renderFilters,
    decorateTitle,
    titleSignature,
    openPicker,
    closePicker,
    setTag,
    fullName,
    shape,
    tags: () => state.marks.tags,
    snapshot: () => ({ ...state.marks, filter: { fresh: state.filter.fresh, tags: [...state.filter.tags] }, order: state.order })
  };
});
