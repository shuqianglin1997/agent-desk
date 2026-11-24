/*
 * AgentDesk — 界面增强层。
 *
 * 只做呈现：画猫、设备视角下拉、页脚对白、选中括号、会话高亮条，以及把用户操作接到动效引擎上。
 * 它不拥有任何业务状态。选择、范围、打开、复制都仍由 renderer.js 决定，这里只读 DOM 结果，
 * 或者在 renderer 明确调用时给出反馈。
 */
(function (root) {
  'use strict';

  const Fx = root.PixelFx;
  const $ = (selector, scope) => (scope || document).querySelector(selector);
  const $$ = (selector, scope) => Array.from((scope || document).querySelectorAll(selector));

  // 声音：播放规则（档位、前台、一次一个、节流）都在 pixel/sfx.js；这里只把界面上发生的事翻译成事件名。
  const Sfx = root.PixelSfx || null;
  const cue = (event, detail) => (Sfx ? Sfx.cue(event, detail) : false);
  const clock = () => (root.performance && typeof root.performance.now === 'function' ? root.performance.now() : Date.now());
  const tr = (key) => (root.I18N ? root.I18N.t(key) : key);
  // 最近一次真实的“操作”：点按，或回车、空格、Esc、带修饰键的快捷键。在输入框里打字不算。
  let lastActionAt = -Infinity;
  const recentAction = (ms) => clock() - lastActionAt <= ms;

  /* ── 猫 ─────────────────────────────────────────── */
  // 画和动都交给 pixel/cats.js：一个钟、逐帧、没有缩放和旋转。这里只把界面上发生的事翻译成猫的动作。
  const Cats = root.PixelCats || null;
  const POSES = { rest: 'loaf', nap: 'sleep', hibernate: 'sleep' };
  const poseFor = (state) => POSES[state] || 'sit'; // 旧调用方还在用
  const overrides = new WeakMap(); // 点了“打开”还没有结果时，那只猫先赶来
  const lastSpecs = new WeakMap();

  // 外观或状态变了才换；轮询刷新不会打断正在演的一次性动作。
  function setCat(canvas, spec) {
    if (!canvas || !Cats || typeof Cats.show !== 'function') return;
    const value = spec || {};
    lastSpecs.set(canvas, value);
    const override = overrides.get(canvas);
    Cats.show(canvas, override ? { ...value, action: override } : value);
  }

  // 画猫的那块画布：可以给画布本身、卡片里的任何元素，或 Agent 的 id。
  function catCanvas(target) {
    if (!target) return null;
    if (typeof target === 'string') {
      const card = $$('#accountRoster .account-card').find((item) => item.dataset.agentId === target);
      return card ? $('canvas.account-card-avatar', card) : null;
    }
    if (target.tagName === 'CANVAS') return target;
    const card = target.closest ? target.closest('.account-card') : null;
    return $('canvas.account-card-avatar', target) || (card ? $('canvas.account-card-avatar', card) : null);
  }

  // 让一只猫演一次性动作：hop pet zap cheer no arrive leave settle wake。
  // 返回 Promise<boolean>，播完为 true。hold 为 true 时停在最后一帧，直到 catRelease。
  function catAct(target, name, options) {
    const canvas = catCanvas(target);
    if (!canvas || !Cats || typeof Cats.play !== 'function') return Promise.resolve(false);
    return Cats.play(canvas, name, options);
  }
  function catRelease(target, options) {
    const canvas = catCanvas(target);
    if (!canvas || !Cats || typeof Cats.release !== 'function') return Promise.resolve(false);
    return Cats.release(canvas, options);
  }

  // 关灯时让猫睡下（name 为 'sleep'，睡着以后一直躺着），亮灯时放开（name 为空：醒来，回到它原来的状态）。
  function pose(canvas, name) {
    if (!canvas) return;
    if (name) catAct(canvas, 'settle', { hold: true });
    else catRelease(canvas, { wake: true });
  }

  // 暂时让一只猫演某个循环状态（点了“打开”、客户端还没起来时先赶来），给空值就回到它自己的状态。
  function holdState(canvas, action) {
    if (!canvas) return;
    if (action) overrides.set(canvas, action);
    else overrides.delete(canvas);
    setCat(canvas, lastSpecs.get(canvas) || {});
  }

  // “全部”那张：三只猫的合影，不动。
  function drawAll(canvas) {
    if (!canvas || !Cats || typeof Cats.drawStill !== 'function') return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const [look, dx, dy] of [['cow', -2, 26], ['black', 42, 26], ['orange', 20, 44]]) {
      Cats.drawStill(canvas, { look, accessory: 'none', collar: '#2f9e8f', action: 'onduty', frame: 5, scale: 2, headroom: 0, dx, dy, clear: false });
    }
  }

  /* ── 设备视角 ───────────────────────────────────── */
  // data: { initialized, current, allLabel, localLabel, onlineLabel(online,total), devices:[{id,name,online,meta}] }
  function renderLens(data) {
    const label = $('#deviceLensLabel');
    const meta = $('#deviceLensMeta');
    const options = $('#deviceLensOptions');
    if (!label || !meta || !options) return;
    const devices = data.initialized ? data.devices || [] : [];
    const current = devices.find((device) => device.id === data.current) || null;
    label.textContent = data.initialized ? (current ? current.name : data.allLabel) : data.localLabel;
    meta.textContent = data.initialized ? data.onlineLabel : '';
    options.replaceChildren();
    if (!data.initialized) return;
    const entries = [{ id: 'all', name: data.allLabel, online: true, meta: data.onlineLabel }].concat(devices);
    for (const entry of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'option');
      button.dataset.lens = entry.id;
      button.setAttribute('aria-selected', String((data.current || 'all') === entry.id));
      const lamp = document.createElement('i');
      lamp.className = `px-lamp${entry.online ? ' ok' : ''}`;
      const name = document.createElement('span');
      name.textContent = entry.name;
      const small = document.createElement('small');
      small.textContent = entry.meta || '';
      button.append(lamp, name, small);
      options.append(button);
    }
  }

  function bindLens() {
    const options = $('#deviceLensOptions');
    const select = $('#deviceLensSelect');
    if (!options || !select) return;
    options.addEventListener('click', (event) => {
      const button = event.target.closest('[data-lens]');
      if (!button) return;
      const menu = $('#deviceLensMenu');
      if (menu) menu.open = false;
      if (select.value === button.dataset.lens) return;
      if (event.isTrusted) cue('lens.change');
      sinkCats();
      select.value = button.dataset.lens;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  // 换了工作环境：台上的猫依次重新跳上搁板（逐帧的“跳上来”，一只比一只晚 60 毫秒）。
  function sinkCats() {
    if (Fx.reduced()) return;
    $$('#accountRoster .account-card canvas.account-card-avatar').forEach((canvas, index) => {
      setTimeout(() => { if (canvas.isConnected) catAct(canvas, 'arrive'); }, index * 60);
    });
  }

  /* ── 页脚对白 ───────────────────────────────────── */
  function bindStatus() {
    const source = $('#statusText');
    const typed = $('#statusTyped');
    const next = $('#statusNext');
    const mascot = $('#statusMascot');
    if (!source || !typed) return;
    if (mascot) setCat(mascot, { look: 'orange', accessory: 'none', collar: '#2f9e8f', action: 'rest', scale: 1, headroom: 0, seed: 'footer' });
    let last = null;
    const retype = () => {
      const text = source.textContent;
      if (text === last) return;
      last = text;
      if (next) next.hidden = true;
      // 逐字声只给“你刚做了一件事”换来的那句话；后台自己更新的状态安静地打出来。
      const audible = recentAction(2000);
      if (Sfx) Sfx.textReset();
      Fx.type(typed, text, {
        onTick() { if (mascot) mascot.classList.toggle('talk'); if (audible) cue('footer.type', { chars: 2 }); },
        onDone() { if (mascot) mascot.classList.remove('talk'); if (next) next.hidden = !text; }
      });
    };
    new MutationObserver(retype).observe(source, { childList: true, characterData: true, subtree: true });
    retype();
  }

  function setGlobal(text, online) {
    const element = $('#footerGlobal');
    if (!element) return;
    element.replaceChildren();
    if (!text) return;
    const lamp = document.createElement('i');
    lamp.className = `px-lamp${online === false ? '' : ' ok'}`;
    element.append(lamp, document.createTextNode(text));
  }

  /* ── 选中括号 ───────────────────────────────────── */
  let bracketQueued = false;
  function placeBracket() {
    bracketQueued = false;
    const host = $('.agent-panel .presenter');
    const bracket = $('#rosterBracket');
    if (!host || !bracket) return;
    const target = $('#rosterAllCard[aria-pressed="true"]:not([hidden])') || $('#accountRoster .account-card.selected');
    const roster = $('#accountRoster');
    if (!target) { bracket.hidden = true; return; }
    const hostRect = host.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    if (roster && roster.contains(target)) {
      const view = roster.getBoundingClientRect();
      if (rect.left < view.left - 4 || rect.right > view.right + 4) { bracket.hidden = true; return; }
    }
    bracket.hidden = false;
    bracket.style.width = `${Math.round(rect.width + 12)}px`;
    bracket.style.height = `${Math.round(rect.height + 12)}px`;
    bracket.style.transform = `translate(${Math.round(rect.left - hostRect.left - 6)}px, ${Math.round(rect.top - hostRect.top - 6)}px)`;
  }
  function queueBracket() {
    if (bracketQueued) return;
    bracketQueued = true;
    requestAnimationFrame(placeBracket);
  }

  /* ── 会话高亮条、逐行进场、盖章 ─────────────────── */
  let band = null;
  let rowSignature = '';
  let stampKey = null;

  function placeBand() {
    const wrap = $('.session-pane .table-wrap');
    if (!wrap) return;
    if (!band) {
      band = document.createElement('i');
      band.className = 'session-band';
      band.hidden = true;
      wrap.prepend(band);
    }
    const row = $('#sessionRows tr.session-active');
    if (!row) { band.hidden = true; return; }
    const wrapRect = wrap.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    band.hidden = false;
    band.style.height = `${Math.round(rect.height)}px`;
    band.style.transform = `translateY(${Math.round(rect.top - wrapRect.top + wrap.scrollTop)}px)`;
  }

  function rowsChanged() {
    const rows = $$('#sessionRows tr[data-session-key]');
    const signature = rows.map((row) => row.dataset.sessionKey).join('|');
    const typing = document.activeElement && document.activeElement.id === 'searchInput';
    // 只有用户自己的操作带出来的新行才从左写进来；后台刷新和启动时的行由开灯编排（boot.js）管，这里不演。
    const userCaused = !root.PixelLamp || root.PixelLamp.userCaused();
    if (signature !== rowSignature && !typing && !Fx.reduced() && userCaused) {
      rows.slice(0, 12).forEach((row, index) => {
        row.style.setProperty('--i', String(index));
        // The table keeps unchanged rows (src/renderer/views/sessions.js); a
        // kept row starts its write-in again, as a newly drawn one does: the
        // style is flushed without the class before it is added.
        row.classList.remove('fx-in');
        void row.offsetWidth;
        row.classList.add('fx-in');
      });
    }
    rowSignature = signature;
    placeBand();
    if (stampKey) {
      const box = rows.find((row) => row.dataset.sessionKey === stampKey)?.querySelector('.session-select-box');
      stampKey = null;
      if (box && box.checked && !Fx.reduced()) {
        Fx.once(box, 'fx-stamp', 160);
        const p = Fx.point(box);
        Fx.burst(p.x, p.y, 6, null, { spread: 7, up: 5, life: 9, size: 4 });
        Fx.once($('#copySessionInfoBtn'), 'fx-bump', 160);
      }
    }
  }

  function bindSessions() {
    const body = $('#sessionRows');
    if (!body) return;
    new MutationObserver(rowsChanged).observe(body, { childList: true });
    // The table announces every drawing, also one that kept every row.
    body.addEventListener('agentdesk:session-rows', rowsChanged);
    body.addEventListener('change', (event) => {
      const box = event.target.closest('.session-select-box');
      if (box && box.checked) stampKey = box.closest('tr')?.dataset.sessionKey || null;
    }, true);
    const wrap = $('.session-pane .table-wrap');
    if (wrap) wrap.addEventListener('scroll', placeBand, { passive: true });
  }

  /* ── 队伍：起跳、灰尘、进场 ─────────────────────── */
  function bindRoster() {
    const host = $('.agent-panel .presenter');
    const roster = $('#accountRoster');
    if (!host || !roster) return;
    let lastPet = null;
    host.addEventListener('click', (event) => {
      if (event.target.closest('[data-roster-control]')) return;
      const card = event.target.closest('.account-card');
      const cat = card && $('.account-card-cat', card);
      const canvas = cat && $('canvas.account-card-avatar', cat);
      if (!canvas) return;
      if (event.target.closest('.account-card-cat') && card.dataset.agentId) {
        const at = clock();
        const zap = lastPet && lastPet.agentId === card.dataset.agentId && at - lastPet.at < 1200;
        lastPet = zap ? null : { agentId: card.dataset.agentId, at };
        catAct(canvas, zap ? 'zap' : 'pet');
        return;
      }
      catAct(canvas, 'hop');
      if (Fx.reduced()) return;
      setTimeout(() => {
        const p = Fx.point(cat, 'bottom');
        Fx.burst(p.x, p.y - 2, 6, [Fx.token('--ink-tertiary'), Fx.token('--line-mid')], { spread: 10, up: 3, gravity: 0.5, life: 8, size: 4 });
      }, 300);
    });
    // 名册两头：哪一侧还有没露出来的猫，就标出来，样式让那一侧化成网点而不是一刀切掉。
    let edgeFrame = 0;
    const markEdges = () => {
      edgeFrame = 0;
      const hidden = roster.scrollWidth - roster.clientWidth;
      const start = String(roster.scrollLeft > 1);
      const end = String(roster.scrollLeft < hidden - 1);
      if (roster.dataset.moreStart !== start) roster.dataset.moreStart = start;
      if (roster.dataset.moreEnd !== end) roster.dataset.moreEnd = end;
    };
    const queueEdges = () => { if (!edgeFrame) edgeFrame = requestAnimationFrame(markEdges); };
    const known = new WeakSet();
    const observer = new MutationObserver(() => {
      let index = 0;
      for (const cat of $$('.account-card-cat', host)) {
        if (!known.has(cat)) {
          known.add(cat);
          cat.style.setProperty('--i', String(index));
          cat.style.setProperty('--d', `-${((index * 0.47) % 1.8).toFixed(2)}s`);
          // 猫怎么上场（开灯时跳上搁板、新来的一只、送走的一只）由 boot.js 编排；没有它时逐帧跳上搁板。
          const canvas = $('canvas.account-card-avatar', cat);
          if (canvas && !Fx.reduced() && !root.PixelLamp) setTimeout(() => { if (canvas.isConnected) catAct(canvas, 'arrive'); }, index * 60);
        }
        index += 1;
      }
      queueBracket();
      queueEdges();
    });
    observer.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-pressed', 'hidden'] });
    roster.addEventListener('scroll', queueBracket, { passive: true });
    window.addEventListener('resize', queueBracket);
    roster.addEventListener('scroll', queueEdges, { passive: true });
    window.addEventListener('resize', queueEdges);
    queueEdges();
    drawAll($('#rosterAllAvatar'));
  }

  const catOf = (agentId) => {
    const card = $$('#accountRoster .account-card').find((item) => item.dataset.agentId === agentId);
    return card ? $('.account-card-cat', card) : null;
  };

  function launchStart(agentId) {
    cue('agent.launch');
    holdState(catCanvas(agentId), 'arriving');
  }

  // outcome: 'ok' | 'wait' | 'fail'
  function launchEnd(agentId, outcome, label) {
    cue(outcome === 'ok' ? 'agent.ready' : outcome === 'wait' ? 'agent.wait' : 'action.failed');
    const canvas = catCanvas(agentId);
    holdState(canvas, null);
    const cat = catOf(agentId);
    if (!cat) return;
    if (outcome === 'ok') catAct(canvas, 'cheer');
    else if (outcome !== 'wait') catAct(canvas, 'no');
    if (Fx.reduced()) return;
    const top = Fx.point(cat, 'top');
    if (outcome === 'ok') {
      const middle = Fx.point(cat);
      Fx.burst(middle.x, middle.y, 16);
      Fx.floatText(top.x, top.y + 4, label, 'ok');
    } else if (outcome === 'wait') {
      Fx.floatText(top.x, top.y + 6, label, 'warn');
    } else {
      Fx.quake();
    }
  }

  function copied(keys, label) {
    if (Fx.reduced()) return;
    const wanted = new Set(keys || []);
    const rows = $$('#sessionRows tr[data-session-key]').filter((row) => wanted.has(row.dataset.sessionKey));
    const mascot = $('#statusMascot');
    rows.forEach((row) => Fx.once(row, 'fx-flash', 320));
    rows.slice(0, 6).forEach((row, index) => Fx.fly($('.title-cell-main', row) || row, mascot, index));
    // 朱印真的盖一下：被复制的每一行行尾落一个小红印，停一下再淡掉。
    const floaters = $('#fxFloaters');
    rows.slice(0, 12).forEach((row, index) => {
      if (!floaters) return;
      const box = row.getBoundingClientRect();
      if (box.bottom < 0 || box.top > window.innerHeight) return;
      const seal = document.createElement('i');
      seal.className = 'fx-seal';
      seal.style.left = `${Math.round(box.right - 34)}px`;
      seal.style.top = `${Math.round(box.top + box.height / 2)}px`;
      seal.style.animationDelay = `${index * 50}ms`;
      seal.addEventListener('animationend', () => seal.remove(), { once: true });
      floaters.append(seal);
    });
    const landing = rows.length ? 420 + Math.min(rows.length, 6) * 60 : 0;
    setTimeout(() => {
      if (!mascot) return;
      catAct(mascot, 'hop');
      const p = Fx.point(mascot);
      Fx.burst(p.x, p.y - 4, 12);
      Fx.floatText(p.x + 44, p.y - 14, label, 'ok');
    }, landing);
    Fx.once($('#copySessionInfoBtn'), 'fx-bump', 160);
  }

  /* ── 主题切换后的竖帘 ───────────────────────────── */
  function bindTheme() {
    const started = Date.now();
    let theme = document.documentElement.dataset.theme || '';
    new MutationObserver(() => {
      const next = document.documentElement.dataset.theme || '';
      if (next === theme) return;
      theme = next;
      // 你按了外观开关才响：开灯是正常主题，关灯是夜间；跟着系统自动换不响。
      if (recentAction(1500)) cue(next === 'dark' ? 'theme.dark' : 'theme.light');
      if (Date.now() - started > 1500) Fx.wipe();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* ── 声音：只在“你做了一件事并且它有了结果”或“有事需要你”时出声 ─────
     悬停、滚动、在搜索框里打字、点一下会话行看详情、后台刷新都不接到这里。 */
  const ACTION_KEYS = new Set(['Enter', ' ', 'Escape']);
  const SOUND_CONTROLS = new Set(['soundLevel', 'soundVolume']);
  const STATUS_LINES = ['#statusText', '#sessionSendStatus', '#fileSendStatus', '#taskPackageStatus', '#taskPackageImportStatus'];
  const RESULT_WINDOW_MS = 120000;
  let resultActionAt = -Infinity;   // 已经换过一个结果声的那次操作
  let lastArriveAt = -Infinity;
  let pendingBye = -Infinity;
  let lastAudible = 'key';
  let statusMatchers = null;
  let statusLang = null;

  function onGesture(event) {
    if (!event.isTrusted || !Sfx) return;
    const typing = event.type === 'keydown' && !ACTION_KEYS.has(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey;
    if (!typing) lastActionAt = clock();
    Sfx.unlock();
  }

  // 结果声：一次操作最多换来一个，两分钟内有效。后台反复写同一句状态不会反复响。
  function resultCue(event) {
    if (!event || lastActionAt <= resultActionAt || clock() - lastActionAt > RESULT_WINDOW_MS) return false;
    resultActionAt = lastActionAt;
    return cue(event);
  }

  function statusEvent(text) {
    const lang = root.I18N && typeof root.I18N.getLang === 'function' ? root.I18N.getLang() : 'zh';
    if (!statusMatchers || statusLang !== lang) {
      const locales = root.AgentDeskLocales || {};
      statusMatchers = Sfx.statusMatchers(locales[lang] || {}, locales.zh || {});
      statusLang = lang;
    }
    return Sfx.statusEventFor(text, statusMatchers);
  }

  function bindSoundHooks() {
    if (!Sfx) return;
    const started = clock();
    document.addEventListener('pointerdown', onGesture, true);
    document.addEventListener('keydown', onGesture, true);

    // 弹窗：你打开的响“打开档案夹”，你关上的响“合上”；不是你点出来、自己冒出来要你确认的，响“等你处理”。
    new MutationObserver((records) => {
      for (const record of records) {
        const element = record.target;
        if (element.tagName !== 'DIALOG') continue;
        const open = element.hasAttribute('open');
        const was = record.oldValue !== null;
        if (open && !was) cue(recentAction(3000) ? 'dialog.open' : 'confirm.requested');
        else if (!open && was && recentAction(3000)) cue('dialog.close');
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'], attributeOldValue: true });

    // 展开菜单（details、浮层）。toggle 不冒泡，在捕获阶段统一接。
    document.addEventListener('toggle', (event) => {
      const element = event.target;
      if (!element || element.tagName === 'DIALOG' || !recentAction(1500)) return;
      const opened = element.tagName === 'DETAILS' ? element.open : event.newState === 'open';
      if (opened) cue('menu.open');
    }, true);

    // 勾选会话、换运行位置、点小开关和下拉。声音设置自己的控件在 bindSoundSettings 里试听。
    document.addEventListener('change', (event) => {
      const element = event.target;
      if (!event.isTrusted || !element || !element.matches || SOUND_CONTROLS.has(element.id)) return;
      if (element.matches('.session-table input[type="checkbox"], #sessionRows input[type="checkbox"]')) {
        cue(element.checked ? 'session.check' : 'session.uncheck');
      } else if (element.matches('.account-card select')) {
        cue('location.change');
      } else if (element.matches('select, input[type="checkbox"], input[type="radio"]')) {
        cue('toggle');
      }
    }, true);
    const clearSelection = $('#clearSessionSelectionBtn');
    if (clearSelection) clearSelection.addEventListener('click', (event) => { if (event.isTrusted) cue('session.uncheck'); });
    const lang = $('#langToggle');
    if (lang) lang.addEventListener('click', (event) => { if (event.isTrusted) cue('language.change'); });
    // 送走：没建设备网时档案里的“移除”直接确认后删除，建了以后在移除弹窗里确认；猫真的离开名册才响。
    for (const selector of ['#removeProfileBtn', '#confirmRemoveCatalogBtn']) {
      const button = $(selector);
      if (button) button.addEventListener('click', (event) => { if (event.isTrusted) pendingBye = clock(); });
    }

    bindRosterSounds(started);

    // 状态句子：导出完成、导入成功、送出、失败。
    for (const selector of STATUS_LINES) {
      const line = $(selector);
      if (!line) continue;
      new MutationObserver(() => resultCue(statusEvent(line.textContent)))
        .observe(line, { childList: true, characterData: true, subtree: true });
    }
    // 应用里表示“这一步出错了”的现成标记：状态行的 data-state / data-tone 变成 error。
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.target.getAttribute(record.attributeName) === 'error' && record.oldValue !== 'error') {
          resultCue('action.failed');
          break;
        }
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-state', 'data-tone'], attributeOldValue: true });

    // 来了东西：别的设备送来的会话信息、文件或任务包。只认第一次见到、两分钟内创建的那一条。
    const seenIncoming = new Set();
    if (root.manager && typeof root.manager.onTransfersChanged === 'function') {
      root.manager.onTransfersChanged((transfers) => {
        let fresh = false;
        for (const item of Array.isArray(transfers) ? transfers : []) {
          if (!item || item.direction !== 'incoming' || !item.transferId || seenIncoming.has(item.transferId)) continue;
          seenIncoming.add(item.transferId);
          const created = Date.parse(item.createdAt);
          if (Number.isFinite(created) && Date.now() - created < 120000 && !['failed', 'cancelled', 'expired'].includes(item.state)) fresh = true;
        }
        if (fresh) {
          lastArriveAt = clock();
          cue('mesh.arrive');
        }
      });
    }

    // 新回复：有对话回完了。只在窗口不在前台时响，半分钟内最多一声；首次启用之前的回复主进程本来就不报。
    let lastReplyAt = -Infinity;
    document.addEventListener('agentdesk:replies', (event) => {
      if (!(Number(event.detail?.added) > 0)) return;
      if (typeof document.hasFocus === 'function' && document.hasFocus()) return;
      if (clock() - lastReplyAt < 30000) return;
      lastReplyAt = clock();
      cue('session.reply');
    });

    // 收件箱里要你处理的事变多了：等你处理。启动头几秒的第一次计数只当基准。
    const badge = $('#activityCountBadge');
    if (badge) {
      let count = null;
      new MutationObserver(() => {
        const value = badge.hidden ? 0 : (Number.parseInt(badge.textContent, 10) || 0);
        if (count !== null && clock() - started > 5000 && value > count && clock() - lastArriveAt > 3000) cue('inbox.attention');
        count = value;
      }).observe(badge, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    }
  }

  function bindRosterSounds(started) {
    const host = $('.agent-panel .presenter');
    const roster = $('#accountRoster');
    if (!host || !roster) return;
    const selectionKey = () => {
      if ($('#rosterAllCard[aria-pressed="true"]:not([hidden])')) return 'all';
      const card = $('#accountRoster .account-card.selected');
      return card ? card.dataset.agentId || '' : '';
    };
    const ids = () => $$('#accountRoster .account-card[data-agent-id]').map((card) => card.dataset.agentId);
    let before = null;
    let pendingSelect = null;
    let lastPoke = null;
    const settleSelect = () => {
      if (!pendingSelect) return;
      if (clock() - pendingSelect.at > 1500) { pendingSelect = null; return; }
      const key = selectionKey();
      if (key === pendingSelect.before) return;
      pendingSelect = null;
      cue(key === 'all' ? 'agent.all' : 'agent.select');
    };
    // 先在捕获阶段记下点之前选的是谁，卡片自己的点击处理之后再比较。
    host.addEventListener('click', () => { before = selectionKey(); }, true);
    host.addEventListener('click', (event) => {
      const previous = before;
      before = null;
      if (!event.isTrusted || event.target.closest('[data-roster-control]')) return;
      const card = event.target.closest('.account-card[data-agent-id]');
      if (card && event.target.closest('.account-card-cat')) {
        // 点猫本身：叫一声；叫过之后马上再点它一下就是逗它，电一下。
        const agentId = card.dataset.agentId;
        const at = clock();
        if (lastPoke && lastPoke.agentId === agentId && at - lastPoke.at < 1200) {
          lastPoke = null;
          cue('cat.zap');
        } else {
          lastPoke = { agentId, at };
          cue('cat.poke', { agentId });
        }
        pendingSelect = null;
        return;
      }
      if (!card && !event.target.closest('#rosterAllCard')) return;
      pendingSelect = { before: previous === null ? selectionKey() : previous, at: clock() };
      settleSelect();
      setTimeout(settleSelect, 0);
      setTimeout(settleSelect, 250);
    });
    // 用键盘换排序（Alt + 左右）。
    roster.addEventListener('keydown', (event) => {
      if (!event.isTrusted || !event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const order = ids().join('\u0000');
      setTimeout(() => { if (ids().join('\u0000') !== order) cue('order.change'); }, 0);
    }, true);

    // 拿起、放下；新招募的猫落到搁板上；送走的猫离开；额度第一次掉到最低一档。
    let known = null;
    const everSeen = new Set();
    const levels = new Map();
    const tired = new Set();
    let scan = 0;
    const scanRoster = () => {
      scan = 0;
      settleSelect();
      const cards = $$('#accountRoster .account-card[data-agent-id]');
      const present = new Set(cards.map((card) => card.dataset.agentId));
      // 名册第一次真正画出来（有卡片，或者是空台面）时只记基准，启动时载入的猫不算新来的。
      if (!known && !cards.length && !$('.account-roster-empty', host)) return;
      if (known) {
        const added = [...present].filter((id) => !known.has(id) && !everSeen.has(id));
        const removed = [...known].filter((id) => !present.has(id));
        if (removed.length && clock() - pendingBye < 15000) {
          pendingBye = -Infinity;
          cue('agent.removed');
        } else if (added.length && clock() - started > 3000 && recentAction(10000)) {
          cue('cat.recruited', { agentId: added[0] });
        }
      }
      present.forEach((id) => everSeen.add(id));
      known = present;
      for (const card of cards) {
        const level = card.querySelector('.account-card-quota')?.dataset.level;
        if (!level || level === 'unknown') continue;
        const id = card.dataset.agentId;
        const previous = levels.get(id);
        levels.set(id, level);
        if (level === 'exhausted' && previous && previous !== 'exhausted' && !tired.has(id)) {
          tired.add(id);
          cue('quota.exhausted');
        }
      }
    };
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target;
        if (record.attributeName !== 'class' || !target.classList || !target.classList.contains('account-card')) continue;
        const had = /(^|\s)roster-dragging(\s|$)/.test(record.oldValue || '');
        const has = target.classList.contains('roster-dragging');
        if (!had && has) cue('roster.pickup');
        else if (had && !has) cue('roster.drop');
      }
      if (!scan) scan = setTimeout(scanRoster, 60);
    }).observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-level', 'aria-pressed'], attributeOldValue: true });
    scanRoster();
  }

  /* ── 声音设置：系统页的档位与音量，页脚的一键静音 ─────── */
  function persistSound(patch) {
    try {
      const request = root.manager && typeof root.manager.updateSettings === 'function' ? root.manager.updateSettings(patch) : null;
      if (request && typeof request.catch === 'function') request.catch(() => {});
    } catch (_error) { /* 存不下时这次运行仍按新值响 */ }
  }

  function renderSound() {
    if (!Sfx) return;
    const { level, volume } = Sfx.state();
    const select = $('#soundLevel');
    const range = $('#soundVolume');
    const mute = $('#soundMuteBtn');
    if (select && select.value !== level) select.value = level;
    if (range && document.activeElement !== range) range.value = String(volume);
    if (mute) {
      const off = level === 'off';
      mute.setAttribute('aria-pressed', String(off));
      const icon = $('.pxi', mute);
      if (icon) icon.dataset.i = off ? 'mute' : 'sound';
      const label = tr(off ? 'footer.sound.unmute' : 'footer.sound.mute');
      mute.title = label;
      mute.setAttribute('aria-label', label);
    }
  }

  function changeLevel(level) {
    const next = Sfx.normalizeLevel(level);
    const previous = Sfx.state().level;
    if (previous !== 'off') lastAudible = previous;
    if (next !== 'off') lastAudible = next;
    Sfx.setLevel(next);
    persistSound({ soundLevel: next });
    if (next !== 'off') {
      Sfx.unlock();
      Sfx.preview();
    }
  }

  function bindSoundSettings() {
    if (!Sfx) return;
    const select = $('#soundLevel');
    const range = $('#soundVolume');
    const mute = $('#soundMuteBtn');
    if (select) select.addEventListener('change', () => changeLevel(select.value));
    if (range) {
      range.addEventListener('input', () => Sfx.setVolume(range.value));
      range.addEventListener('change', () => {
        Sfx.setVolume(range.value);
        persistSound({ soundVolume: Sfx.state().volume });
        Sfx.preview();
      });
    }
    if (mute) mute.addEventListener('click', () => changeLevel(Sfx.state().level === 'off' ? lastAudible : 'off'));
    Sfx.onChange(renderSound);
    if (typeof root.addEventListener === 'function') root.addEventListener('i18n:changed', renderSound);
    renderSound();
  }

  // 复制会话信息：声音不属于动态效果。减少动态效果时印不落下，但盖印声照样响（最多三下）。
  function copiedWithSound(keys, label) {
    cue('session.copy', { count: (keys || []).length });
    copied(keys, label);
  }

  // renderer 读到稳定设置后调用一次（和主题、语言走同一条路）。
  function setSound(value = {}) {
    if (!Sfx) return;
    Sfx.configure({ level: value.soundLevel, volume: value.soundVolume });
    const level = Sfx.state().level;
    if (level !== 'off') lastAudible = level;
  }

  function start() {
    bindLens();
    bindStatus();
    bindSessions();
    bindRoster();
    bindTheme();
    bindSoundHooks();
    bindSoundSettings();
    cue('app.start');
  }

  const mascot = (name) => catAct($('#statusMascot'), name);

  // 后台对话的声音：台面上的一只叫另一只时信封出发（送出），台面外来的信封落进来（到达），结果交回（好了）。
  // 失败由状态行的出错标记带出“出错”，这里不另响。
  function hubSound(kind) {
    cue(kind === 'outside' ? 'hub.arrive' : kind === 'done' ? 'hub.done' : 'hub.start');
  }

  root.PixelUi = {
    setCat, pose, poseFor, drawAll, renderLens, setGlobal, placeBracket: queueBracket, placeBand, launchStart, launchEnd, copied: copiedWithSound, setSound,
    catAct, catRelease, mascot, hubSound
  };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof self !== 'undefined' ? self : this);
