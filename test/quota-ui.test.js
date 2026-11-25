// AgentDesk — 额度 UI 与慢轮询契约。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { rendererSource, rendererFunction } = require('./helpers/renderer-source');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.html'), 'utf8');
const renderer = rendererSource();
const styles = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace.css'), 'utf8');
const workspaceStyles = fs.readFileSync(path.join(__dirname, '..', 'src', 'workspace.css'), 'utf8');

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

test('账号额度浮层保留手动刷新和可访问进度条', () => {
  assert.match(html, /id="quotaSummary"[^>]*aria-live="polite"/);
  assert.match(html, /id="quotaRefreshBtn"[^>]*>↻ 刷新额度<\/button>/);
  assert.match(renderer, /setAttribute\('role', 'progressbar'\)/);
  assert.match(renderer, /listQuotas\(\{ force: force === true \}\)/);
});

test('额度慢轮询不混进 8 秒 activity IPC', () => {
  assert.match(renderer, /const QUOTA_REFRESH_INTERVAL = 5 \* 60_000/);
  const activity = rendererFunction('loadActivity') + rendererFunction('hubWritingKeys');
  assert.doesNotMatch(activity, /listQuotas|loadQuotas/);
  const quota = rendererFunction('loadQuotas');
  assert.doesNotMatch(quota, /listActivity/);
});

test('额度浮层独立于工作台布局，会话默认跨栏，远控详情列保留', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'src', 'pixel.css'), 'utf8'), /--detail-w:\s*316px/);
  assert.match(workspaceStyles, /\.workspace-board\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) var\(--detail-w\)/);
  assert.match(workspaceStyles, /\.workspace-board\[data-detail="session"\] > \.session-pane \{ grid-column: 1 \/ -1; \}/);
  assert.match(workspaceStyles, /\.quota-popover\s*\{\s*position: fixed/);
  assert.doesNotMatch(workspaceStyles, /\[data-detail="quota"\]/);
});

test('单账号和跨账号额度共用原生浮层，聚合模块在 renderer 前加载', () => {
  assert.match(html, /<\/main>[\s\S]*?id="quotaPopover"[^>]*popover="auto"[^>]*role="dialog"[\s\S]*?id="quotaSummary"[\s\S]*?id="quotaOverview"/);
  assert.match(html, /id="quotaOverview"[^>]*hidden/);
  assert.match(html, /id="quotaOverviewMeta"/);
  assert.match(html, /id="quotaOverviewList"/);
  // UMD 依赖链：yard/energy.js → quota-overview.js → renderer.js
  const energyIndex = html.indexOf('./yard/energy.js');
  const overviewIndex = html.indexOf('./quota-overview.js');
  const rendererIndex = html.indexOf('./renderer.js');
  assert.ok(energyIndex > 0 && energyIndex < overviewIndex && overviewIndex < rendererIndex);
});

test('额度随数据刷新，按账号组归拢，展开状态和浮层同步', () => {
  assert.match(renderer, /function renderQuotaSummary\(\) \{[\s\S]{0,200}?renderQuotaOverview\(\);/);
  assert.match(renderer, /els\.quotaOverview\.hidden = state\.quotaAnchor !== els\.quotaChipAll \|\| groups\.length < 2/);
  assert.match(renderer, /buildTrustedQuotaOverview\(groups, state\.quotas/);
  assert.match(renderer, /renderQuotaOverviewButton\(groups, rows\)/);
  // 额度浮层跟着被点的那张卡片，不要求它是正在看的那只猫。
  assert.match(renderer, /els\.quotaSummary\.hidden = .*anchor !== accountCardControl\(actionAgentId\(\), '\.account-card-quota-summary'\)/);
  assert.match(renderer, /account-card-quota-summary'\)\.addEventListener\('click',[\s\S]*?setActionAgent\(agentId\);[\s\S]*?toggleQuotaPopover\(anchor\)/);
  assert.match(renderer, /quotaPopover\.addEventListener\('beforetoggle',[\s\S]*?setActionAgent\(null\)/);
  assert.match(html, /class="presenter-head"[\s\S]*?id="quotaChipAll"/);
  assert.match(html, /class="account-card-quota-summary"[^>]*popovertarget="quotaPopover"[^>]*aria-controls="quotaPopover"/);
  assert.match(html, /id="quotaChipAll"[^>]*popovertarget="quotaPopover"[^>]*aria-controls="quotaPopover"/);
  assert.match(renderer, /anchor\.setAttribute\('aria-expanded', 'true'\)/);
  assert.match(renderer, /state\.quotaAnchor\?\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(renderer, /value\.textContent = tr\('quotaMap\.minimum', \{ pct \}\)/);
  // Agent 管理已升级为原生模态 Dialog；Renderer 只打开确定对象，关闭和 Esc 交给原生 Dialog 语义。
  assert.match(html, /class="account-card-manage"[^>]*aria-haspopup="dialog"[^>]*aria-controls="agentManageDialog"/);
  assert.match(renderer, /function openAgentManageDialog\(\)[\s\S]*?openDialog\(els\.agentManageDialog\)/);
  // 子流程叠在档案上面，不再先把档案关掉；档案关上时被操作的猫回到正在看的那只。
  assert.doesNotMatch(renderer, /closeAgentManageDialog/);
  assert.match(renderer, /agentManageDialog\?\.addEventListener\('close', \(\) => \{[\s\S]*?if \(els\.agentManageDialog\.open\) return;\s*setActionAgent\(null\)/);
  assert.match(renderer, /function openAgentDossier\(agentId\) \{[\s\S]*?setActionAgent\(agentId\);[\s\S]*?openAgentManageDialog\(\)/);
  // 无官方额度接口的账号折叠为尾部一行，不逐行刷灰
  assert.match(renderer, /quota-overview-rest/);
  assert.match(styles, /\.quota-overview-rest\s*\{/);
  for (const level of ['fresh', 'steady', 'tired', 'exhausted']) {
    assert.match(styles, new RegExp(`\\.quota-overview-item\\[data-level="${level}"\\]::before`));
  }
});
