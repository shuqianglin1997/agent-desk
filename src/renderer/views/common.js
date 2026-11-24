// AgentDesk — small helpers every view uses: the session key, dates, paths,
// sizes and the status line (docs/ARCHITECTURE_PLAN.md phase 6). Moved from
// src/renderer.js unchanged.

import { dateLocale, tr } from './settings.js';
import { els } from './shared.js';

function sessionKey(session) {
  if (window.SessionTable) return window.SessionTable.keyOf(session);
  if (!session) return '';
  return `${session._profileId || ''}::${session.address || session.id || session.filePath || ''}`;
}

function compactDate(value) {
  if (!value) return tr('common.unrecorded');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return tr('common.unrecorded');
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = date.toDateString() === now.toDateString();
  const options = sameDay
    ? { hour: '2-digit', minute: '2-digit' }
    : sameYear
      ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: 'numeric', day: 'numeric' };
  return new Intl.DateTimeFormat(dateLocale(), options).format(date);
}

function fullDate(value) {
  if (!value) return tr('common.unrecorded');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return tr('common.unrecorded');
  return new Intl.DateTimeFormat(dateLocale(), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function shortPath(value) {
  if (!value) return '-';
  return String(value).replace(/^\/Users\/[^/]+/, '~').replace(/^C:\\Users\\[^\\]+/i, '~');
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '-';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setStatus(message, tone = 'neutral') {
  els.statusText.parentElement.dataset.tone = tone;
  els.statusText.removeAttribute('data-i18n');
  delete els.statusText.dataset.emptyDesk;
  els.statusText.textContent = message;
  // 档案开着时主窗口的页脚被遮住，同一句话也写在档案页脚。
  if (els.agentManageStatus && els.agentManageDialog?.open) els.agentManageStatus.textContent = message;
}

export { sessionKey, compactDate, fullDate, shortPath, formatBytes, setStatus };
