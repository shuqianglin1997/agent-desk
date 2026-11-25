/*
 * AgentDesk — 后台对话在界面上的样子：账本里的一行、状态灯、搁板上的点线。
 *
 * 只造 DOM，不取数据、不发请求。数据来自 Main 推过来的 run（公开字段，没有提示词和回答）。
 * 一段后台对话在账本里只占一行：被叫的账号自己的会话找到以后，就是那条会话，只是标题、副行、
 * 时间和来源一栏换成后台对话的样子；还没找到会话时是单独的一行。
 */
(function (root) {
  'use strict';

  const ACTIVE = new Set(['starting', 'running']);

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of children) if (child) node.append(child);
    return node;
  }

  function formatElapsed(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '—';
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function elapsedOf(run, now = Date.now()) {
    const start = Date.parse(run.startedAt || run.createdAt || '');
    if (!Number.isFinite(start)) return null;
    const end = ACTIVE.has(run.state) ? now : Date.parse(run.endedAt || '');
    return Number.isFinite(end) ? Math.max(0, end - start) : null;
  }

  function lamp(state, t) {
    return el('i', { className: 'hub-lamp', dataset: { state }, role: 'img', 'aria-label': t(`hub.state.${state}`) });
  }

  /*
   * 谁叫的谁。发起方只有在 AgentDesk 确实知道是哪只猫时（它中转的上一段对话，或发起的进程
   * 就在那个账号的目录里）才写猫的名字；否则只把调用方自报的标签加上引号显示。
   */
  function pairText(run, ctx) {
    const t = ctx.t;
    const callerName = run.caller ? ctx.nameOf(run.caller.id) : null;
    const from = callerName || (run.from ? t('hub.from.label', { label: run.from }) : t('hub.from.unknown'));
    return t('hub.pair', { from, to: run.target.name });
  }

  // 运行中这一格的字随时间走；别处用 data-hub-elapsed 找到它每秒改一次
  function timeCell(run, ctx, cell) {
    const t = ctx.t;
    if (ACTIVE.has(run.state)) {
      cell.dataset.hubElapsed = run.id;
      cell.textContent = run.state === 'starting' ? t('hub.state.starting') : t('hub.elapsed.running', { t: formatElapsed(elapsedOf(run)) });
      cell.title = cell.textContent;
    } else {
      cell.textContent = ctx.compactDate(run.endedAt);
      cell.title = `${ctx.fullDate(run.endedAt)} · ${t('hub.elapsed.done', { t: formatElapsed(elapsedOf(run)) })}`;
    }
  }

  /* 一格。column 是会话表的列定义（精简或详细），每一列都有后台对话自己的写法。 */
  function cellFor(run, column, ctx) {
    const t = ctx.t;
    const cell = el('td', { className: [column.className, column.cellClass].filter(Boolean).join(' ') });
    switch (column.key) {
      case 'title': {
        const pair = pairText(run, ctx);
        cell.append(
          el('button', { type: 'button', className: 'title-cell-main' }, [lamp(run.state, t), el('span', { text: run.title })]),
          el('span', { className: 'cell-subline' }, [
            el('span', { className: 'hub-kind', tabindex: '0', dataset: { hubTip: 'run' }, text: t('hub.kind') }),
            el('span', { text: pair })
          ])
        );
        cell.title = `${run.title}\n${t('hub.kind')} · ${pair}${run.from && run.caller ? `\n${t('hub.from.declared', { label: run.from })}` : ''}`;
        return cell;
      }
      case 'project':
        cell.title = run.cwd || run.folder || '';
        cell.append(document.createTextNode(run.folder || '—'),
          el('b', { className: 'hub-access', dataset: { access: run.access }, text: t(run.access === 'write' ? 'hub.access.write' : 'hub.access.read') }));
        return cell;
      case 'updatedAt':
        timeCell(run, ctx, cell);
        return cell;
      case 'createdAt':
        cell.textContent = ctx.compactDate(run.startedAt || run.createdAt);
        cell.title = ctx.fullDate(run.startedAt || run.createdAt);
        return cell;
      case 'source':
      case 'status': {
        if (column.key === 'source' && ACTIVE.has(run.state)) {
          const stop = el('button', { type: 'button', className: 'hub-stop', title: t('hub.stop.title') }, [
            el('i', { className: 'pxi', dataset: { i: 'x' }, 'aria-hidden': 'true' }),
            el('span', { text: t('hub.stop') })
          ]);
          stop.addEventListener('click', (event) => { event.stopPropagation(); ctx.onStop(run.id); });
          cell.append(stop);
          return cell;
        }
        const reason = run.reasonCode ? t(`hub.reason.${run.reasonCode}`) : '';
        cell.append(el('span', { className: 'hub-state', dataset: { state: run.state }, text: t(`hub.state.${run.state}`) }));
        if (reason && reason !== `hub.reason.${run.reasonCode}`) cell.title = reason;
        return cell;
      }
      case 'account':
        cell.textContent = run.target.name;
        return cell;
      case 'app':
        cell.textContent = ctx.appLabel(run.target.app);
        return cell;
      case 'id':
        cell.textContent = run.session?.id || run.id;
        return cell;
      default:
        cell.textContent = '-';
        return cell;
    }
  }

  /*
   * 搁板上的点线：从发起的那只到被叫的那只，沿着木板慢慢流动。只画两头都在台面上的；
   * 发起方不在台面上时不画（信封从桌子边缘进来，之后只有灯和那只在干活的猫）。
   * layer 是名册旁边的一层（名册的子元素只能是卡片），位置按名册的滚动换算。
   */
  function renderLinks(layer, roster, links) {
    if (!layer || !roster) return;
    layer.replaceChildren();
    if (!links.length) return;
    const host = layer.offsetParent || layer.parentElement;
    const hostBox = host.getBoundingClientRect();
    const rosterBox = roster.getBoundingClientRect();
    const shelf = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--shelf-y')) || 100;
    const top = Math.round(rosterBox.top - hostBox.top + shelf + 2);
    const left = rosterBox.left - hostBox.left;
    const minX = left;
    const maxX = left + rosterBox.width;
    const centerOf = (key) => {
      const card = [...roster.children].find((item) => item.dataset.agentId === key);
      const cat = card?.querySelector('.account-card-avatar');
      if (!cat) return null;
      const box = cat.getBoundingClientRect();
      return box.left - hostBox.left + box.width / 2;
    };
    for (const link of links) {
      const a = centerOf(link.from);
      const b = centerOf(link.to);
      if (a === null || b === null || a === b) continue;
      const x1 = Math.max(minX, Math.min(a, b));
      const x2 = Math.min(maxX, Math.max(a, b));
      if (x2 - x1 < 8) continue;
      const line = el('i', { className: 'hub-link', dataset: { flow: b > a ? 'right' : 'left' } });
      line.style.left = `${Math.round(x1 / 2) * 2}px`;
      line.style.width = `${Math.round((x2 - x1) / 2) * 2}px`;
      line.style.top = `${top - (top % 2)}px`;
      layer.append(line);
    }
  }

  /*
   * 说明纸条：带 data-hub-tip 的入口（复制会话信息、送出里的两项、后台对话的标签、“允许被调用”）
   * 在鼠标停一下或键盘聚焦时出现一张纸条：标题、一句话、三件事（谁做、对话动不动、离不离开这台电脑）。
   * 按钮不可用时也看得到：用命中测试找入口，不靠不可用按钮自己发出的鼠标事件；这时界面标出的
   * 原因（data-hub-reason）作为最后一行。纸条开着时先收起按钮的原生提示，免得两张叠在一起。
   */
  const TIPS = new Set(['copy', 'send', 'package', 'run', 'allow']);

  function installTips(doc, t) {
    const win = doc.defaultView;
    if (doc.getElementById('hubTip')) return null;
    const tip = el('div', { id: 'hubTip', className: 'hub-tip', role: 'tooltip', popover: 'manual' });
    doc.body.append(tip);
    let anchor = null;
    let timer = null;
    let pending = null;
    const reduced = () => typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isOpen = () => { try { return tip.matches(':popover-open'); } catch (_error) { return false; } };
    const disabled = (target) => Boolean(target.matches?.(':disabled') || target.querySelector?.(':scope > input:disabled'));

    function fill(target) {
      const key = target.dataset.hubTip;
      const reason = disabled(target) ? (target.dataset.hubReason || '').trim() : '';
      // replaceChildren would write a null out as the text "null".
      tip.replaceChildren(...[
        el('b', { text: t(`hub.tip.${key}.title`) }),
        el('p', { text: t(`hub.tip.${key}.body`) }),
        el('small', { text: t(`hub.tip.${key}.facts`) }),
        reason ? el('small', { className: 'hub-tip-reason', text: reason }) : null
      ].filter(Boolean));
    }
    function place(target) {
      const rect = target.getBoundingClientRect();
      const box = tip.getBoundingClientRect();
      const gap = 8;
      const x = Math.max(8, Math.min(Math.round(rect.left), win.innerWidth - box.width - 8));
      let y = Math.round(rect.bottom + gap);
      if (y + box.height > win.innerHeight - 8) y = Math.round(rect.top - gap - box.height);
      // 落在 2px 的格子上
      tip.style.left = `${x - (x % 2)}px`;
      tip.style.top = `${Math.max(8, y - (y % 2))}px`;
    }
    function release() {
      if (!anchor) return;
      anchor.removeAttribute('aria-describedby');
      if (anchor.dataset.hubTitle !== undefined) {
        // 纸条开着时界面可能已经换了提示：那就留新的
        if (anchor.dataset.hubTitle && !anchor.hasAttribute('title')) anchor.setAttribute('title', anchor.dataset.hubTitle);
        delete anchor.dataset.hubTitle;
      }
      anchor = null;
    }
    function show(target) {
      clearTimeout(timer);
      if (!target?.isConnected || !TIPS.has(target.dataset.hubTip)) return;
      if (anchor !== target) {
        release();
        anchor = target;
        target.dataset.hubTitle = target.getAttribute('title') || '';
        target.removeAttribute('title');
      }
      fill(target);
      target.setAttribute('aria-describedby', 'hubTip');
      // 纸条要盖在打开着的弹窗上面：每次重新放进顶层
      if (isOpen()) tip.hidePopover();
      tip.showPopover();
      place(target);
    }
    function hide() {
      clearTimeout(timer);
      release();
      if (isOpen()) tip.hidePopover();
    }
    function targetAt(x, y) {
      for (const node of doc.elementsFromPoint(x, y)) {
        const found = node.closest?.('[data-hub-tip]');
        if (found) return found;
      }
      return null;
    }
    doc.addEventListener('pointermove', (event) => {
      if (pending) return;
      pending = win.requestAnimationFrame(() => {
        pending = null;
        const target = targetAt(event.clientX, event.clientY);
        if (target === anchor) return;
        if (!target) { hide(); return; }
        clearTimeout(timer);
        timer = setTimeout(() => show(target), anchor || reduced() ? 0 : 380);
      });
    });
    doc.documentElement.addEventListener('pointerleave', hide);
    doc.addEventListener('pointerdown', hide, true);
    doc.addEventListener('focusin', (event) => {
      const target = event.target.closest?.('[data-hub-tip]');
      if (target && event.target.matches?.(':focus-visible')) show(target);
    });
    doc.addEventListener('focusout', (event) => { if (anchor && anchor.contains(event.target)) hide(); });
    // Esc 先收起纸条，不连带关掉它下面的弹窗或菜单
    doc.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !anchor) return;
      event.preventDefault();
      event.stopPropagation();
      hide();
    }, true);
    win.addEventListener('scroll', hide, true);
    win.addEventListener('blur', hide);
    return { show, hide, element: tip };
  }

  root.AgentHubUi = { ACTIVE_STATES: ACTIVE, formatElapsed, elapsedOf, lamp, pairText, cellFor, timeCell, renderLinks, installTips, TIP_KEYS: TIPS };
})(typeof self !== 'undefined' ? self : this);
