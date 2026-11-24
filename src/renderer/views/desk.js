// AgentDesk — the desk's deliveries: envelopes flying out and in, parked
// sends and delivered ticks (docs/ARCHITECTURE_PLAN.md phase 6). Moved from
// src/renderer.js unchanged.

// ── 交接：发送到另一台电脑、收到别处送来的 ──────────────
// 发出去、对方确认收到都有回执，是确切的；对方不在线时信封停在顶栏，写着“等对方上线”。
const DESK_PENDING = new Set(['queued', 'sending', 'awaiting-ack']);

function deskTickRows(keys) {
  const floaters = document.getElementById('fxFloaters');
  if (!floaters) return;
  const wanted = new Set(keys || []);
  for (const row of document.querySelectorAll('#sessionRows tr[data-session-key]')) {
    if (!wanted.has(row.dataset.sessionKey)) continue;
    const box = row.getBoundingClientRect();
    if (box.bottom < 0 || box.top > window.innerHeight) continue;
    const tick = document.createElement('i');
    tick.className = 'desk-tick';
    tick.textContent = tr('transfers.delivered');
    // 停在标题那一栏的末尾，不压住时间和来源
    const project = row.querySelector('td.col-project')?.getBoundingClientRect();
    tick.style.left = `${Math.round((project ? project.left : box.right) - 112)}px`;
    tick.style.top = `${Math.round(box.top + box.height / 2 - 8)}px`;
    floaters.append(tick);
    setTimeout(() => tick.remove(), 2600);
  }
}

function deskLensPoint() {
  return window.PixelDesk?.center(document.getElementById('deviceLensButton'));
}

function deskFlyOut(entry) {
  const from = deskLensPoint();
  const out = from ? { x: window.innerWidth + 24, y: from.y } : null;
  window.PixelDesk?.fly({ from, to: out, arc: 0, onLand: () => deskTickRows(entry.keys) });
  if (!window.PixelDesk) deskTickRows(entry.keys);
}

function deskSendFlights() {
  for (const entry of state.hub.sent) {
    if (entry.flown) continue;
    entry.flown = true;
    const first = document.querySelector(`#sessionRows tr[data-session-key="${CSS.escape(entry.keys[0] || '')}"] .title-cell-main`);
    const from = window.PixelDesk?.center(first);
    window.PixelDesk?.fly({
      from, to: deskLensPoint(), arc: 10,
      onLand: () => {
        if (entry.state === 'completed') {
          entry.delivered = true;
          deskFlyOut(entry);
        }
        renderDeskParked();
      }
    });
  }
  renderDeskParked();
}

function deskTransfersChanged(previous, current) {
  const before = new Map((previous || []).map((item) => [item.transferId, item.state]));
  for (const entry of state.hub.sent) {
    const now = (current || []).find((item) => item.transferId === entry.transferId);
    if (!now) continue;
    entry.state = now.state;
    if (now.state === 'completed' && before.get(entry.transferId) !== 'completed' && entry.flown && !entry.delivered) {
      entry.delivered = true;
      deskFlyOut(entry);
    }
  }
  renderDeskParked();
  deskReceived(previous, current);
}

function renderDeskParked() {
  if (!els.deskParked) return;
  const waiting = (state.mesh.transfers || []).some((item) => (
    item.direction === 'outgoing' && item.type === 'session-pointer' && DESK_PENDING.has(item.state)
  ));
  els.deskParked.hidden = !waiting;
  els.deskParked.title = waiting ? tr('transfers.parked') : '';
  els.deskParked.setAttribute('aria-label', waiting ? tr('transfers.parked') : '');
}

// 收到：信封从窗口右上角飞进“收件箱”，按钮跳一下；数字由收件箱自己的计数更新
function deskReceived(previous, current) {
  const seen = new Set((previous || []).map((item) => item.transferId));
  const fresh = (current || []).some((item) => {
    if (item.direction !== 'incoming' || seen.has(item.transferId)) return false;
    const created = Date.parse(item.createdAt);
    return Number.isFinite(created) && Date.now() - created < 120000 && !['failed', 'cancelled', 'expired'].includes(item.state);
  });
  if (!fresh || !previous) return;
  const inbox = document.getElementById('activityCenterBtn');
  const to = window.PixelDesk?.center(inbox);
  const from = to ? { x: window.innerWidth + 16, y: -16 } : null;
  window.PixelDesk?.fly({
    from, to, arc: 12,
    onLand: (played) => {
      if (played) {
        window.PixelDesk.ring(to, 'brand');
        window.PixelFx?.once(inbox, 'fx-bump', 160);
      }
    }
  });
}

// Published by name while src/renderer.js is a classic script
// (docs/ARCHITECTURE_PLAN.md phase 6); the last batch turns these into imports.
export { deskTickRows, deskLensPoint, deskFlyOut, deskSendFlights, deskTransfersChanged, renderDeskParked, deskReceived };
Object.assign(window, { deskTickRows, deskLensPoint, deskFlyOut, deskSendFlights, deskTransfersChanged, renderDeskParked, deskReceived });
