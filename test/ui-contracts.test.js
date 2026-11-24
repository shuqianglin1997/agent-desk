// The Mesh plan's interface contracts that the phase 6 split of the renderer
// must keep (docs/ARCHITECTURE_PLAN.md phase 6, PERSONAL_AGENT_MESH_PLAN.md
// 11.11-11.13 and 12.2). Each contract names the behaviour tests that hold it:
// unit tests by title, and task paths of the hidden-window acceptance run
// (scripts/ui-acceptance.js) by name. This file fails when one of them is
// renamed or removed, so a contract cannot lose its test while code moves.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const CONTRACTS = [
  {
    contract: '11.11: Device Lens, each Lens\'s Agent, run location, focused and checked sessions, replica source, device detail, remote view and transfer draft are independent',
    unit: {
      'test/ui-context.test.js': [
        '设备 Lens 只恢复该 Lens 的 Agent 记忆，不改 scope，也不自动选第一项',
        '行聚焦与显式批量勾选互不覆盖，批量集合优先于聚焦项',
        '切换 Agent 和 Slot 只改变动作落点，保留焦点、勾选、副本与传输草稿',
        '设备详情选择与顶栏 Device Lens 独立，任一方向切换都不覆盖另一方',
        '多副本会话在全部设备视角必须显式选择，具体 Lens 的唯一副本可直接解析',
        'SessionPointer 与文件传输使用互不污染的草稿',
        '传输草稿的 kind 不可被补丁改写，文件草稿永远不继承会话选择',
        '远控返回保留查看会话，断开才清除活动提示',
        'setAgentSlot 只记住某只猫的运行位置，不改变正在看的是谁'
      ]
    },
    acceptance: [
      'device task navigation applies an atomic Lens/Agent/scope transition',
      'Slot switching preserves search, focus, and explicit checks',
      'multi-replica actions require one explicit source',
      'SessionPointer, file, and history dialogs keep independent drafts',
      'background remote viewing is textual, reopenable, and clears on disconnect'
    ]
  },
  {
    contract: '11.11 rule 10: render, filter and reconcile have no selection side effects; nothing selects the first item',
    unit: {
      'test/ui-context.test.js': ['刷新只清理已失效对象，不为用户补选任何会话、Agent 或 Slot']
    },
    acceptance: [
      '1040×840 Header / three-panel board / Footer shell',
      'render, filter and reconcile change no selection; popovers open in the Top Layer',
      'focus, explicit check, hidden selection, and clear lifecycle',
      'the session table keeps unchanged rows and draws again only what changed'
    ]
  },
  {
    contract: '11.1 / 11.13: opening and closing a dialog does not change the selection under it',
    acceptance: [
      'Header opens tools, activity, and settings as independent modals without mutating the workspace',
      'modal Device Center preserves the underlying workspace during isolated Mesh initialization'
    ]
  },
  {
    contract: '11.13: dialogs form a parent-child stack, Escape closes one layer, focus returns to the control that opened it',
    acceptance: [
      'system/help keep a real parent-child modal stack with layered Escape, and inbox records live inside the inbox page',
      'TaskPackage export and receive keep fixed transaction controls around one scrolling content owner',
      'Header opens tools, activity, and settings as independent modals without mutating the workspace'
    ]
  },
  {
    contract: '11.12: popovers open in the Top Layer',
    acceptance: [
      'render, filter and reconcile change no selection; popovers open in the Top Layer',
      'Header opens tools, activity, and settings as independent modals without mutating the workspace'
    ]
  },
  {
    contract: '11.8 / 14: the Remote Surface stays an isolated sandboxed view inside the lower-right panel',
    unit: {
      'test/mesh-remote-control.test.js': [
        '远控使用主窗口内嵌沙箱 Surface、目标端确认与常驻停止条',
        '右下详情面板承载隔离远控 Surface，其他两个面板和普通 Renderer 安全边界不变'
      ]
    },
    acceptance: ['background remote viewing is textual, reopenable, and clears on disconnect']
  },
  {
    contract: '12.2: copying session information gives only the path and the coordinate',
    unit: {
      'test/session-location.test.js': [
        '单会话定位只输出路径和精确坐标',
        '多选只编号分隔定位，不生成标题、账号、总结、优先级或交接话术',
        '收到的跨设备定位继续复用同一条路径加坐标格式'
      ]
    }
  }
];

test('every interface contract still has the behaviour tests that hold it', () => {
  const acceptance = read('scripts/ui-acceptance.js');
  const runs = new Set([...acceptance.matchAll(/await run\('([^']+)'/g)].map((match) => match[1]));
  for (const { contract, unit = {}, acceptance: paths = [] } of CONTRACTS) {
    assert.ok(Object.keys(unit).length + paths.length > 0, contract);
    for (const name of paths) assert.ok(runs.has(name), `${contract}: acceptance path "${name}"`);
    for (const [file, titles] of Object.entries(unit)) {
      const source = read(file);
      for (const title of titles) assert.ok(source.includes(`test('${title}'`), `${contract}: ${file} "${title}"`);
    }
  }
});
