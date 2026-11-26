'use strict';

/*
 * Words on screen.
 *
 * Everything the Catshelf window itself says comes from the app's own tables
 * (src/i18n/zh.js, src/i18n/en.js) through ui(); nothing is relabelled.
 * FILM holds only what the app does not say: captions, the end card, the
 * made-up account names and conversation titles, and what the neutral client
 * windows and the desktop show.
 */

const zhModule = require('../../../src/i18n/zh.js');
const enModule = require('../../../src/i18n/en.js');
const shared = typeof self !== 'undefined' && self.AgentDeskLocales ? self.AgentDeskLocales : {};
const LOCALES = { zh: shared.zh || (zhModule.AgentDeskLocales || {}).zh, en: shared.en || (enModule.AgentDeskLocales || {}).en };

// The app's own string for `key`, with {placeholders} filled in. {name|one|other}
// picks the singular when params[name] is 1, as the app's own t() does.
function ui(lang, key, params) {
  const table = LOCALES[lang];
  if (!table || typeof table[key] !== 'string') throw new Error(`launch film: the app has no ${lang} string for "${key}"`);
  return table[key].replace(/\{(\w+)(?:\|([^{}|]*)\|([^{}|]*))?\}/g, (_match, name, one, other) => {
    const given = Boolean(params) && params[name] !== undefined;
    if (one !== undefined) return given && Number(params[name]) === 1 ? one : other;
    return given ? String(params[name]) : `{${name}}`;
  });
}

const FILM = {
  zh: {
    product: '猫架',
    names: { work: '工作', personal: '个人', company: '公司接口', team: '团队', open: '开源', writing: '写作' },
    login: '正在登录：',
    same: '同一家，三个账号',
    desktop: '电脑桌面', clock: '上午 10:24', terminal: '终端',
    signed: '已登录 ✓', placeholder: '在这里和它对话', sync: '同步', tasks: '分活', result: '结果',
    signin: { title: '登录', waiting: '正在登录…', done: '已经登录', keep: '下次打开还是登着的', account: '账号' },
    newChat: '新对话',
    sideCodex: ['重构登录页', '对账脚本', '查内存泄漏'],
    codexMany: ['首页骨架屏', '退款接口超时', '补登录测试', '升级依赖', '写部署文档'],
    codexTyped: '首页加个骨架屏', codexLines: ['你：首页加个骨架屏', 'Codex：在改，先看组件结构……'],
    you: '你：', path: '路径', coord: '坐标',
    claudeSide: '接手：订单表', claudeRead: 'Claude：读到了上一段对话。', claudeGo: 'Claude：从第 3 步接着写……', claudeOk: 'Claude：好，通过猫架叫三只猫',
    ask: '把这件事分给合适的猫', jobs: ['写实现', '查资料', '写测试'], jobDone: '：完成 ✓',
    other: '另一台电脑', received: '✓ 收到 1 条会话信息', lock: '本机', low: '快没电',
    rows: [['给首页加骨架屏', '2 分钟前'], ['修复退款接口超时', '5 分钟前'], ['整理部署脚本', '12 分钟前'], ['调研缓存方案', '半小时前'], ['补登录页测试', '1 小时前'],
      ['迁移订单表字段', '1 小时前'], ['查内存泄漏', '2 小时前'], ['写周报提纲', '昨天'], ['升级依赖', '昨天'], ['改写导出为 Markdown', '3 天前']],
    query: '退款',
    device: '书房电脑', thisDevice: '这台电脑', when: ['6/18 10:24', '6/18 10:23', '6/18 10:21', '6/18 09:48', '6/18 09:30', '6/17 21:05', '6/17 18:40', '6/16 16:22'],
    takeover: '接手：订单表', pasted: ['路径: /Users/me/work/shop-api', '坐标: …/sessions/2026/06/18/rollout-7f3c.jsonl#7f3c'],
    terminal2: '终端 · AI 在用', found: ['work@example.com', 'home@example.com'], sessionsFound: [12, 5],
    end: ['猫架', '每个 AI 账号，都是架子上的一只猫', 'github.com/shuqianglin1997/catshelf', '在 GitHub 搜 catshelf · 开源免费'],
    // One caption per shot, in the order of timeline.SHOTS; [[ ]] marks the word printed in seal red.
    captions: ['账号一多，只能[[轮流登]]', '对话[[散了一地]]', '[[猫架]]：管住所有 AI 客户端', '官方窗口[[登一次]]，一直在', '[[一只猫]]，一个账号', '同一平台，[[各登各的]]',
      '三个账号，[[同时开着]]', '客户端里干活，这里[[同步]]', '谁[[没电]]，谁在睡', '所有对话，[[一本账]]', '[[新回复]]、标签，一眼找到', '一搜就到',
      '这只[[没电]]了', '[[复制]]它的对话位置', '[[贴给]]另一只', '它自己读，[[接着干]]', '你只[[说一句]]', '它当[[管家]]，派活', '猫架只负责[[传话]]', '结果[[回到它这里]]',
      '换台电脑，[[接着干]]', '[[四种]]办法加猫', '[[24]] 种毛色，[[11]] 种配饰', '密码[[不出]]你的电脑', '', '']
  },
  en: {
    product: 'Catshelf',
    names: { work: 'Work', personal: 'Personal', company: 'Company API', team: 'Team', open: 'Open source', writing: 'Writing' },
    login: 'Signing in: ',
    same: 'One platform, three accounts',
    desktop: 'Desktop', clock: '10:24 AM', terminal: 'Terminal',
    signed: 'Signed in ✓', placeholder: 'Message it here', sync: 'Sync', tasks: 'Tasks', result: 'Result',
    signin: { title: 'Sign in', waiting: 'Signing in…', done: 'Signed in', keep: 'Still signed in next time', account: 'Account' },
    newChat: 'New chat',
    sideCodex: ['Login refactor', 'Reconcile script', 'Find a memory leak'],
    codexMany: ['Home page skeleton', 'Refund API timeout', 'Login page tests', 'Bump dependencies', 'Deploy docs'],
    codexTyped: 'Add a skeleton to home', codexLines: ['You: Add a skeleton to home', 'Codex: On it, reading the components…'],
    you: 'You: ', path: 'Path', coord: 'Coordinate',
    claudeSide: 'Take over: orders', claudeRead: 'Claude: Read the earlier session.', claudeGo: 'Claude: Continuing from step 3…', claudeOk: 'Claude: OK, calling three cats via Catshelf',
    ask: 'Split this among the right cats', jobs: ['Implement', 'Research', 'Write tests'], jobDone: ': done ✓',
    other: 'Another computer', received: '✓ 1 session received', lock: 'This computer', low: 'Low!',
    rows: [['Skeleton for the home page', '2 min ago'], ['Fix refund API timeout', '5 min ago'], ['Tidy deploy scripts', '12 min ago'], ['Look into caching', '30 min ago'], ['Login page tests', '1 hr ago'],
      ['Migrate order fields', '1 hr ago'], ['Find a memory leak', '2 hr ago'], ['Weekly report outline', 'Yesterday'], ['Bump dependencies', 'Yesterday'], ['Export as Markdown', '3 days ago']],
    query: 'refund',
    device: 'Study PC', thisDevice: 'This computer', when: ['6/18, 10:24 AM', '6/18, 10:23 AM', '6/18, 10:21 AM', '6/18, 9:48 AM', '6/18, 9:30 AM', '6/17, 9:05 PM', '6/17, 6:40 PM', '6/16, 4:22 PM'],
    takeover: 'Take over: orders', pasted: ['Path: /Users/me/work/shop-api', 'Coordinate: …/sessions/2026/06/18/rollout-7f3c.jsonl#7f3c'],
    terminal2: 'Terminal · the AI at work', found: ['work@example.com', 'home@example.com'], sessionsFound: [12, 5],
    end: ['Catshelf', 'Every AI account, a cat on your shelf.', 'github.com/shuqianglin1997/catshelf', 'Search catshelf on GitHub · Free & open source'],
    captions: ['Many accounts. [[One seat]].', 'Chats [[everywhere]].', '[[Catshelf]] keeps every client in view.', 'Sign in [[once]]. Stay in.', '[[One cat]], one account.', 'Same platform, [[many accounts]].',
      'All [[open at once]].', 'Work in the client. [[Synced]] here.', 'Who\'s [[out]], who\'s asleep.', 'Every chat, [[one ledger]].', '[[New replies]] and tags stand out.', 'Search. [[Found]].',
      'This one is [[out of quota]].', '[[Copy]] where the chat lives.', '[[Paste]] it to another cat.', 'It reads on and [[keeps going]].', 'You say [[one line]].', 'It becomes the [[lead]].', 'Catshelf only [[relays]].', 'Results [[come back]].',
      'Another computer, [[same work]].', '[[Four ways]] to add a cat.', '[[24]] coats, [[11]] accessories.', 'Passwords [[never leave]] your computer.', '', '']
  }
};

/*
 * The accounts on the shelf. Client labels are the app's own (src/clients/<id>/index.js);
 * coats follow the app's rule: a new cat wears its client's coat where one exists
 * (Codex, Qwen), otherwise a house-cat coat. Collars are from the app's six.
 */
const CAST = [
  { app: 'codex', client: 'Codex', name: 'work', look: 'codex', collar: null },
  { app: 'codex', client: 'Codex', name: 'personal', look: 'codex', collar: '#d9a53a' },
  { app: 'codex', client: 'Codex', name: 'company', look: 'codex', collar: '#3d6aa8' },
  { app: 'claude', client: 'Claude', name: 'personal', look: 'orange', collar: '#2f9e8f' },
  { app: 'kimi', client: 'Kimi Code', name: 'team', look: 'tabby', collar: '#c94f2e' },
  { app: 'qwen-code', client: 'Qwen Code', name: 'open', look: 'qwen', collar: null }
];

// The cats that join in "four ways to add a cat": a new one, two brought back, one dropped in, one registered by an AI.
const JOINED = [
  { app: 'codex', client: 'Codex', name: 'writing', look: 'codex', collar: '#8a6bb8' },
  { app: 'claude-cli', client: 'Claude CLI', label: 'Claude CLI', look: 'cream', collar: '#6d9440' },
  { app: 'claude-cli', client: 'Claude CLI', label: 'Claude CLI 2', look: 'silver', collar: '#c94f2e' },
  { app: 'claude', client: 'Claude', label: 'Claude', look: 'calico', collar: '#3d6aa8' },
  { app: 'codex', client: 'Codex', label: 'Codex', look: 'codex', collar: '#6d9440' }
];

/*
 * The conversations in the ledger. Titles of the first five are the ones the
 * "Codex · Work" window lists, since the ledger shows what the client has.
 * owner is an index into CAST; when is an index into FILM[lang].when.
 */
const SESSIONS = [
  { id: 'skeleton', owner: 0, project: 'shop-web', when: 0, zh: '首页骨架屏', en: 'Home page skeleton' },
  { id: 'refund', owner: 0, project: 'shop-api', when: 0, zh: '退款接口超时', en: 'Refund API timeout', tag: 0 },
  { id: 'login', owner: 0, project: 'shop-web', when: 1, zh: '补登录测试', en: 'Login page tests' },
  { id: 'deps', owner: 0, project: 'shop-web', when: 1, zh: '升级依赖', en: 'Bump dependencies' },
  { id: 'deploy', owner: 0, project: 'infra', when: 1, zh: '写部署文档', en: 'Deploy docs' },
  { id: 'orders', owner: 1, project: 'shop-api', when: 2, zh: '迁移订单表字段', en: 'Migrate order fields' },
  { id: 'leak', owner: 2, project: 'shop-api', when: 3, zh: '查内存泄漏', en: 'Find a memory leak' },
  { id: 'cache', owner: 3, project: 'notes', when: 4, zh: '调研缓存方案', en: 'Look into caching' },
  { id: 'report', owner: 4, project: 'notes', when: 5, zh: '写周报提纲', en: 'Weekly report outline' },
  { id: 'export', owner: 5, project: 'tools', when: 6, zh: '导出改成 Markdown', en: 'Export as Markdown' },
  { id: 'scripts', owner: 2, project: 'infra', when: 7, zh: '整理部署脚本', en: 'Tidy deploy scripts' }
];

/*
 * The 15-second cut and the README loop: the same film recut, so they say only what the film already says, shorter.
 * Captions are [seconds, words]; '' ends one. Both speak of your own accounts and of nothing that gets round a limit.
 */
const SHORT = {
  zh: {
    captions: [[0, '你的账号，[[不用轮流登]]'], [1.5, '同一平台，[[同时开着]]'], [3.5, '谁在忙，谁[[没电]]，谁在睡'], [5, '所有对话，[[一本账]]'], [7, '一搜就到'],
      [8, '这只[[没电]]了'], [9, '[[复制]]它的对话位置'], [10.5, '[[贴给]]另一只'], [11.5, '它自己读，[[接着干]]'], [12.5, '']],
    loop: [[0, '谁在忙，谁[[没电]]，一眼看到'], [4, '你所有账号的对话，[[一本账]]']],
    keyword: 'catshelf'
  },
  en: {
    captions: [[0, 'Your accounts, [[all signed in]].'], [1.5, 'Same platform, [[open at once]].'], [3.5, 'Who\'s busy, [[out]], or asleep.'], [5, 'Every chat, [[one ledger]].'], [7, 'Search. [[Found]].'],
      [8, 'This one is [[out of quota]].'], [9, '[[Copy]] where the chat lives.'], [10.5, '[[Paste]] it to another cat.'], [11.5, 'It reads on and [[keeps going]].'], [12.5, '']],
    loop: [[0, 'Who\'s busy, who\'s [[out]]: one glance.'], [4, 'All your accounts\' chats, [[one ledger]].']],
    keyword: 'catshelf'
  }
};

module.exports = { ui, FILM, CAST, JOINED, SESSIONS, SHORT, LOCALES };
