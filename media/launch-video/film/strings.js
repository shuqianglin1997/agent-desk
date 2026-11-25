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

// The app's own string for `key`, with {placeholders} filled in.
function ui(lang, key, params) {
  const table = LOCALES[lang];
  if (!table || typeof table[key] !== 'string') throw new Error(`launch film: the app has no ${lang} string for "${key}"`);
  return table[key].replace(/\{(\w+)\}/g, (_match, name) => (params && params[name] !== undefined ? String(params[name]) : `{${name}}`));
}

const FILM = {
  zh: {
    product: '猫架',
    names: { work: '工作', personal: '个人', company: '公司接口', team: '团队', writing: '写作', home: '家里', term: '终端', editor: '编辑器' },
    login: '正在登录：',
    same: '同一家，三个账号',
    desktop: '电脑桌面', clock: '上午 10:24', terminal: '终端',
    signed: '已登录 ✓', placeholder: '在这里和它对话', sync: '同步', tasks: '分活', result: '结果',
    signin: { title: '登录', waiting: '正在登录…', done: '已经登录', keep: '下次打开还是登着的', account: '账号' },
    newChat: '新对话',
    sideCodex: ['重构登录页', '对账脚本', '写部署文档'],
    codexMany: ['首页骨架屏', '接口超时', '补登录测试', '升级依赖', '写部署文档'],
    codexTyped: '首页加个骨架屏', codexLines: ['你：首页加个骨架屏', 'Codex：在改，先看组件结构……'],
    you: '你：', path: '路径', coord: '坐标',
    claudeSide: '接手：订单表', claudeRead: 'Claude：读到了上一段对话。', claudeGo: 'Claude：从第 3 步接着写……', claudeOk: 'Claude：好，通过猫架叫三只猫',
    ask: '把这件事分给合适的猫', jobs: ['写实现', '查资料', '写测试'], jobDone: '：完成 ✓',
    other: '另一台电脑', received: '✓ 收到 1 条会话信息', lock: '本机', low: '快没电',
    rows: [['给首页加骨架屏', '2 分钟前'], ['修复退款接口超时', '5 分钟前'], ['整理部署脚本', '12 分钟前'], ['调研缓存方案', '半小时前'], ['补登录页测试', '1 小时前'],
      ['迁移订单表字段', '1 小时前'], ['查内存泄漏', '2 小时前'], ['写周报提纲', '昨天'], ['升级依赖', '昨天'], ['改写导出为 Markdown', '3 天前']],
    query: '退款',
    end: ['猫架', '每个 AI 账号，都是架子上的一只猫', 'github.com/shuqianglin1997/catshelf', '在 GitHub 搜 catshelf · 开源免费'],
    // One caption per shot, in the order of timeline.SHOTS; [[ ]] marks the word printed in seal red.
    captions: ['账号一多，只能[[轮流登]]', '对话[[散了一地]]', '[[猫架]]：管住所有 AI 客户端', '官方窗口[[登一次]]，一直在', '[[一只猫]]，一个账号', '同一平台，[[各登各的]]',
      '三个账号，[[同时开着]]', '客户端里干活，这里[[同步]]', '谁[[没电]]，谁在睡', '所有对话，[[一本账]]', '[[新回复]]、标签，一眼找到', '一搜就到',
      '这只[[没电]]了', '[[复制]]它的对话位置', '[[贴给]]另一只', '它自己读，[[接着干]]', '你只[[说一句]]', '它当[[管家]]，派活', '猫架只负责[[传话]]', '结果[[回到它这里]]',
      '换台电脑，[[接着干]]', '[[四种]]办法加猫', '[[24]] 种毛色，[[11]] 种配饰', '密码[[不出]]你的电脑', '', '']
  },
  en: {
    product: 'Catshelf',
    names: { work: 'Work', personal: 'Personal', company: 'Company API', team: 'Team', writing: 'Writing', home: 'Home', term: 'Terminal', editor: 'Editor' },
    login: 'Signing in: ',
    same: 'One platform, three accounts',
    desktop: 'Desktop', clock: '10:24 AM', terminal: 'Terminal',
    signed: 'Signed in ✓', placeholder: 'Message it here', sync: 'Sync', tasks: 'Tasks', result: 'Result',
    signin: { title: 'Sign in', waiting: 'Signing in…', done: 'Signed in', keep: 'Still signed in next time', account: 'Account' },
    newChat: 'New chat',
    sideCodex: ['Login refactor', 'Reconcile script', 'Deploy docs'],
    codexMany: ['Home skeleton', 'API timeout', 'Login tests', 'Bump deps', 'Deploy docs'],
    codexTyped: 'Add a skeleton to home', codexLines: ['You: Add a skeleton to home', 'Codex: On it, reading the components…'],
    you: 'You: ', path: 'Path', coord: 'Coordinate',
    claudeSide: 'Take over: orders', claudeRead: 'Claude: Read the earlier session.', claudeGo: 'Claude: Continuing from step 3…', claudeOk: 'Claude: OK, calling three cats via Catshelf',
    ask: 'Split this among the right cats', jobs: ['Implement', 'Research', 'Write tests'], jobDone: ': done ✓',
    other: 'Another computer', received: '✓ 1 session received', lock: 'This computer', low: 'Low!',
    rows: [['Skeleton for the home page', '2 min ago'], ['Fix refund API timeout', '5 min ago'], ['Tidy deploy scripts', '12 min ago'], ['Look into caching', '30 min ago'], ['Login page tests', '1 hr ago'],
      ['Migrate order fields', '1 hr ago'], ['Find a memory leak', '2 hr ago'], ['Weekly report outline', 'Yesterday'], ['Bump dependencies', 'Yesterday'], ['Export as Markdown', '3 days ago']],
    query: 'refund',
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
  { app: 'qwen-code', client: 'Qwen Code', name: 'personal', look: 'qwen', collar: null }
];

module.exports = { ui, FILM, CAST, LOCALES };
