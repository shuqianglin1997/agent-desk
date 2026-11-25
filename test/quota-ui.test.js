// AgentDesk — 额度 UI 与慢轮询契约。
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { rendererSource, rendererFunction } = require('./helpers/renderer-source');

const { page, styleRules, declared } = require('./helpers/behaviour');
const { cssStyleRules, splitSelectors } = require('../scripts/arch-metrics');

const doc = page();
const renderer = rendererSource();
const allSelectors = ['src/workspace.css', 'src/pixel.css', 'src/cats.css']
  .flatMap((file) => cssStyleRules(fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).rules.flatMap((rule) => splitSelectors(rule.prelude)));

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return source.slice(start, end);
}

test('账号额度浮层保留手动刷新和可访问进度条', () => {
  assert.equal(doc.byId('quotaSummary').attrs['aria-live'], 'polite');
  const refresh = doc.byId('quotaRefreshBtn');
  assert.equal(refresh.tag, 'button');
  assert.ok(doc.within(refresh, doc.byId('quotaPopover')), 'refresh sits in the quota popover');
  assert.match(doc.text(refresh), /^↻ /);
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
  assert.equal(declared(':root', '--detail-w'), '316px');
  assert.equal(declared('.workspace-board', 'grid-template-columns'), 'minmax(0, 1fr) var(--detail-w)');
  assert.equal(declared('.workspace-board[data-detail="session"] > .session-pane', 'grid-column'), '1 / -1');
  assert.equal(declared('.quota-popover', 'position'), 'fixed');
  assert.deepEqual(allSelectors.filter((selector) => selector.includes('[data-detail="quota"]')), []);
});

test('单账号和跨账号额度共用原生浮层，聚合模块在 renderer 前加载', () => {
  const popover = doc.byId('quotaPopover');
  assert.equal(popover.attrs.popover, 'auto');
  assert.equal(popover.attrs.role, 'dialog');
  assert.ok(!doc.within(popover, doc.byId('mainGrid')), 'the popover is outside the workspace');
  for (const id of ['quotaSummary', 'quotaOverview', 'quotaOverviewMeta', 'quotaOverviewList']) assert.ok(doc.within(doc.byId(id), popover), `${id} is in the popover`);
  assert.ok(doc.index(doc.byId('quotaSummary')) < doc.index(doc.byId('quotaOverview')));
  assert.ok('hidden' in doc.byId('quotaOverview').attrs);
  // UMD 依赖链：yard/energy.js → quota-overview.js → renderer.js
  const scripts = doc.all((el) => el.tag === 'script' && el.attrs.src).map((el) => el.attrs.src);
  const at = (src) => scripts.indexOf(src);
  assert.ok(at('./yard/energy.js') >= 0 && at('./yard/energy.js') < at('./quota-overview.js') && at('./quota-overview.js') < at('./renderer.js'));
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
  const chipAll = doc.byId('quotaChipAll');
  assert.ok(doc.within(chipAll, doc.all((el) => doc.hasClass(el, 'presenter-head'))[0]));
  const cardQuota = doc.all((el) => doc.hasClass(el, 'account-card-quota-summary'))[0];
  for (const el of [cardQuota, chipAll]) assert.deepEqual([el.attrs.popovertarget, el.attrs['aria-controls']], ['quotaPopover', 'quotaPopover']);
  assert.match(renderer, /anchor\.setAttribute\('aria-expanded', 'true'\)/);
  assert.match(renderer, /state\.quotaAnchor\?\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(renderer, /value\.textContent = tr\('quotaMap\.minimum', \{ pct \}\)/);
  // Agent 管理已升级为原生模态 Dialog；Renderer 只打开确定对象，关闭和 Esc 交给原生 Dialog 语义。
  const manage = doc.all((el) => doc.hasClass(el, 'account-card-manage'))[0];
  assert.deepEqual([manage.attrs['aria-haspopup'], manage.attrs['aria-controls']], ['dialog', 'agentManageDialog']);
  assert.match(renderer, /function openAgentManageDialog\(\)[\s\S]*?openDialog\(els\.agentManageDialog\)/);
  // 子流程叠在档案上面，不再先把档案关掉；档案关上时被操作的猫回到正在看的那只。
  assert.doesNotMatch(renderer, /closeAgentManageDialog/);
  assert.match(renderer, /agentManageDialog\?\.addEventListener\('close', \(\) => \{[\s\S]*?if \(els\.agentManageDialog\.open\) return;\s*setActionAgent\(null\)/);
  assert.match(renderer, /function openAgentDossier\(agentId\) \{[\s\S]*?setActionAgent\(agentId\);[\s\S]*?openAgentManageDialog\(\)/);
  // 无官方额度接口的账号折叠为尾部一行，不逐行刷灰
  assert.match(renderer, /quota-overview-rest/);
  assert.ok(styleRules('.quota-overview-rest').length > 0);
  for (const level of ['fresh', 'steady', 'tired', 'exhausted']) {
    assert.ok(styleRules(`.quota-overview-item[data-level="${level}"]::before`).length > 0, `${level} has its colour`);
  }
});
