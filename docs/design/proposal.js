/*
 * AgentDesk 提案展示脚本（design proposal · after harness 专用）
 * ────────────────────────────────────────────────────────────
 * 状态：提案，未并入产品。只被 docs/design/after.html 注入，用于展示「碎块归一」后的样子。
 * 职责：把被 proposal.css 隐藏的「今日陪伴（原小账本）」和「需要留意」两块信息，
 *       搬进底部状态栏一条集中显示——演示效果，产品 renderer.js 一行未改。
 * 控制台（#runtimeDock / #consoleToggle）由 proposal.css 直接隐藏，此处不涉及。
 */
(function () {
  function syncStatusMeta() {
    const status = document.getElementById('statusBar');
    if (!status) return;

    // 今日陪伴：从原小账本的数值节点读（元素仍在 DOM，只是被 CSS 隐藏）
    const done = (document.getElementById('ledgerDone') || {}).textContent || '0';
    const min = (document.getElementById('ledgerMin') || {}).textContent || '0';

    // 需要留意：数原 attention 区里的条目（li / 直接子块）
    const att = document.getElementById('attentionInbox');
    let warnCount = 0;
    let warnText = '';
    if (att) {
      const items = att.querySelectorAll('li, .attention-item, [data-attention], button');
      warnCount = items.length;
      const first = att.querySelector('li, .attention-item, [data-attention]');
      if (first) warnText = first.textContent.trim().replace(/\s+/g, ' ').slice(0, 22);
    }

    // 保活重建（产品 renderer 的 setStatus 会覆盖 statusBar 文本，故每次重挂集中条）
    let meta = status.querySelector('.status-meta');
    if (!meta) {
      meta = document.createElement('div');
      meta.className = 'status-meta';
      status.appendChild(meta);
    }
    meta.replaceChildren();

    const life = document.createElement('span');
    life.innerHTML = `今日 · 收工 <b>${done}</b> · 陪伴 <b>${min}</b> 分`;
    meta.appendChild(life);

    if (warnCount > 0) {
      const sep = document.createElement('span');
      sep.className = 'dot';
      sep.textContent = '·';
      meta.appendChild(sep);
      const warn = document.createElement('span');
      warn.className = 'warn';
      warn.title = warnText ? `需要留意：${warnText}…` : '有账号需要留意';
      warn.textContent = `${warnCount} 个需留意`;
      meta.appendChild(warn);
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(syncStatusMeta, 700);
    setInterval(syncStatusMeta, 1500);
  });
})();
