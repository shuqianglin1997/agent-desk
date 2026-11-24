/*
 * AgentDesk — 猫状态机与外观（庭院视图）。
 *
 * UMD：浏览器里挂到 window.YardCats，Node 里可 require 直接单测。
 * 纯函数，无 DOM / fs 依赖：输入账号信号，输出猫的状态、外观和它该演的动作。
 * 毛色与配饰的清单来自 yard/cat-art.js（浏览器里要先于本文件加载）。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./cat-art'));
  else root.YardCats = factory(root.CatArt || null);
})(typeof self !== 'undefined' ? self : this, function (art) {
  const SECOND = 1000;
  const MINUTE = 60e3;
  const DAY = 24 * 60 * MINUTE;

  // 状态元数据：优先级即 deriveState 的判断顺序
  const STATE_META = {
    confused: { label: '迷路', hint: '路径失效，点「诊断」体检' },
    working: { label: '干活中', hint: 'App 开着，且会话记录刚刚还在活跃' },
    onduty: { label: '在岗', hint: 'App 开着，但会话已有一阵没动静' },
    arriving: { label: '开工路上', hint: '刚打开账号，App 还没起来' },
    play: { label: '玩耍', hint: 'App 没开，今天活跃过' },
    rest: { label: '面包猫', hint: 'App 没开，1〜3 天没动静' },
    nap: { label: '打盹', hint: 'App 没开，3〜7 天没动静' },
    hibernate: { label: '冬眠', hint: 'App 没开，超过 7 天没动静' }
  };

  // 「干活中」= App 在跑，且会话记录在 WORKING_WINDOW 内还有活跃。
  const WORKING_WINDOW = 90 * SECOND; // 会话记录 90 秒内活跃过 = 还在干活（可调）
  const ARRIVING_WINDOW = 3 * MINUTE;

  /*
   * 信号 → 状态。activity 来自主进程：
   *   { rootExists, rootReadable, latestMtime, contentActiveAt, fileCount, running }
   *   running：该账号官方 App 进程是否在运行。true / false / null（探测不可用）。
   *   contentActiveAt：会话记录内容里的最后活跃时间戳（毫秒）。拿不到时退回 latestMtime。
   *
   * 关键：「干活中 vs 在岗」看的是**会话记录里的最后活跃时间**，不是文件 mtime、更不是 CPU。
   * 试过的都不行：文件 mtime 会被各 App 乱 touch（Codex 尤甚）带偏；CPU 又飘又不准（空闲
   * Claude 都能蹦到 50-100%）。会话记录的内容时间戳（Claude 的 lastActivityAt / Codex rollout
   * 末行事件时间 / Cursor 的 lastUpdatedAt）才是「这个账号的会话刚刚在不在动」的直接答案。
   */
  function deriveState(now, profile, activity) {
    if (!activity) return 'rest';
    if (!activity.rootExists || !activity.rootReadable) return 'confused';

    const launchedAgo = profile && profile.lastLaunchedAt
      ? now - Date.parse(profile.lastLaunchedAt)
      : Infinity;
    const activeAt = activity.contentActiveAt || activity.latestMtime;
    const activeAgo = activeAt ? now - activeAt : Infinity;
    const running = activity.running;

    // App 确认在跑（主路径）：会话记录窗口内还活跃=干活中，否则在岗待命。
    // 一旦探测到在跑就不再走「开工路上」——直接判在岗/干活。
    if (running === true) {
      return activeAgo < WORKING_WINDOW ? 'working' : 'onduty';
    }

    // 探测不可用(null/undefined)：无法确认开没开——会话记录窗口内还活跃就尽力当干活。
    // running===false(明确没开) 不走这条：近期写入只是残留、不算干活。
    if (running !== false && activeAgo < WORKING_WINDOW) return 'working';
    // 开工路上：刚点了「打开账号」、但 App 进程还没被探测到
    if (launchedAgo >= 0 && launchedAgo < ARRIVING_WINDOW && running !== true) return 'arriving';

    // App 没开（或探测不可用且近期无活动）：按上次活跃多久分档。
    if (activeAgo < DAY) return 'play';
    if (activeAgo < 3 * DAY) return 'rest';
    if (activeAgo < 7 * DAY) return 'nap';
    // 全新槽位：没有会话也没打开过 → 面包猫待机，别一上来就进纸箱
    if (!activity.latestMtime && launchedAgo === Infinity) return 'rest';
    return 'hibernate';
  }

  // ── 外观 ─────────────────────────────────────────────
  const BREED_KEYS = ['orange', 'calico', 'cow', 'black', 'white', 'tabby', 'blue', 'siamese'];
  const COLLAR_COLORS = ['#c94f2e', '#2f9e8f', '#d9a53a', '#3d6aa8', '#8a6bb8', '#6d9440'];
  const ACCESSORIES = ['none', 'scarf', 'glasses', 'bow', 'hat'];

  function hashText(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // 同一个账号 id 永远得到同一套默认外观。已有的猫靠它显示，所以这里的清单和算法不能改。
  function defaultCatFor(seedText) {
    const h = hashText(String(seedText || ''));
    return {
      breed: BREED_KEYS[h % BREED_KEYS.length],
      collar: COLLAR_COLORS[(h >>> 3) % COLLAR_COLORS.length],
      accessory: 'none'
    };
  }

  /*
   * 第二版：28 种毛色、12 种配饰。存下来的形状仍是旧版认得的那一份——
   *   breed     永远是旧版八种之一；新毛色另写在 coat，
   *   accessory 永远是旧版五种之一；新配饰另写在 wear，
   * coat / wear 只在 breed / accessory 仍等于它们的“旧版近似”时才算数。
   * 旧版设备（只认八种毛色、五种配饰）看到的是最接近的那只旧猫；它的归一化会原样保留 coat / wear，
   * 改名之类的编辑不会把新毛色冲掉。旧版上有人真的换了毛色或配饰，近似对不上了，新版就听它的。
   */
  const LOOKS = art ? art.LOOKS : {};
  const LOOK_KEYS = Object.keys(LOOKS).length ? Object.keys(LOOKS) : BREED_KEYS.slice();
  const ACCESSORY_KEYS = art ? Object.keys(art.ACCESSORIES) : ['none', 'scarf', 'bow', 'glasses', 'straw'];
  const LOOK_GROUP_IDS = { 家猫: 'home', 有来历的: 'storied', 跟着客户端: 'client' };
  const LOOK_GROUPS = ['home', 'storied', 'client'];
  const lookGroup = (look) => LOOK_GROUP_IDS[(LOOKS[look] || {}).group] || 'home';
  const LEGACY_BREED = {
    orange: 'orange', calico: 'calico', cow: 'cow', black: 'black', white: 'white', tabby: 'tabby', blue: 'blue', siamese: 'siamese',
    cream: 'orange', silver: 'tabby', tuxedo: 'black', tortie: 'calico',
    maneki: 'white', qinghua: 'white', ink: 'cow', koi: 'calico', tiger: 'orange', panda: 'cow', handheld: 'tabby',
    codex: 'white', cursor: 'black', qwen: 'blue', copilot: 'black', opencode: 'blue'
  };
  const LEGACY_ACCESSORY = {
    none: 'none', scarf: 'scarf', glasses: 'glasses', bow: 'bow', straw: 'hat',
    tie: 'scarf', bell: 'none', shades: 'glasses', beret: 'hat', bamboo: 'hat', phones: 'none', flower: 'bow'
  };
  const FROM_LEGACY_ACCESSORY = { none: 'none', scarf: 'scarf', glasses: 'glasses', bow: 'bow', hat: 'straw' };
  // 客户端 → 它那一组毛色。只取颜色，不画任何标志；没有对应毛色的客户端（品牌规定不许这样用颜色的 Claude、
  // DeepSeek、Kimi、Gemini，以及别的）仍用旧的确定性默认。
  const CLIENT_LOOKS = { codex: 'codex', cursor: 'cursor', 'qwen-code': 'qwen', opencode: 'opencode' };
  // 编辑器里能选的项圈：旧的六种加一种墨色；毛色自带的项圈色另外排在最前面。
  const COLLAR_CHOICES = COLLAR_COLORS.concat('#2b2018');
  const HEX = /^#[0-9a-f]{6}$/i;
  const isNewLook = (key) => LOOK_KEYS.includes(key) && !BREED_KEYS.includes(key) && Boolean(LEGACY_BREED[key]);
  const isNewWear = (key) => ACCESSORY_KEYS.includes(key) && Boolean(LEGACY_ACCESSORY[key])
    && FROM_LEGACY_ACCESSORY[LEGACY_ACCESSORY[key]] !== key;

  // profiles.json / 目录里的 cat 字段兜底：缺失/非法值回落到确定性默认；新 id 直接写进 breed / accessory 时拆回兼容形状
  function normalizeCat(cat, seedText) {
    const fallback = defaultCatFor(seedText);
    const input = cat && typeof cat === 'object' && !Array.isArray(cat) ? cat : {};
    // Preserve future appearance fields so an older normalizer does not
    // silently delete them during a routine profile read/write.
    const output = { ...input };
    delete output.coat;
    delete output.wear;

    let breed = input.breed;
    let coat = input.coat;
    if (BREED_KEYS.includes(breed)) coat = isNewLook(coat) && LEGACY_BREED[coat] === breed ? coat : null;
    else if (isNewLook(breed)) { coat = breed; breed = LEGACY_BREED[coat]; }
    else if (isNewLook(coat)) breed = LEGACY_BREED[coat];
    else { breed = fallback.breed; coat = null; }

    let accessory = input.accessory;
    let wear = input.wear;
    if (ACCESSORIES.includes(accessory)) wear = isNewWear(wear) && LEGACY_ACCESSORY[wear] === accessory ? wear : null;
    else if (ACCESSORY_KEYS.includes(accessory) && LEGACY_ACCESSORY[accessory]) {
      wear = isNewWear(accessory) ? accessory : null;
      accessory = LEGACY_ACCESSORY[accessory];
    } else if (isNewWear(wear)) accessory = LEGACY_ACCESSORY[wear];
    else { accessory = fallback.accessory; wear = null; }

    output.breed = breed;
    output.collar = typeof input.collar === 'string' && HEX.test(input.collar) ? input.collar : fallback.collar;
    output.accessory = accessory;
    if (coat) output.coat = coat;
    if (wear) output.wear = wear;
    return output;
  }

  // 存下来的样子 → 画的时候用的三项：毛色、配饰、项圈色
  function resolveCat(cat, seedText) {
    const stored = normalizeCat(cat, seedText);
    return {
      look: stored.coat || stored.breed,
      accessory: stored.wear || FROM_LEGACY_ACCESSORY[stored.accessory] || 'none',
      collar: stored.collar
    };
  }

  // 编辑器里的三项 → 存下来的样子。base 是原来存的那份，未知的将来字段原样带着。
  function storeCat(choice, base) {
    const input = choice && typeof choice === 'object' ? choice : {};
    const look = LOOK_KEYS.includes(input.look) && LEGACY_BREED[input.look] ? input.look : 'orange';
    const wear = ACCESSORY_KEYS.includes(input.accessory) && LEGACY_ACCESSORY[input.accessory] ? input.accessory : 'none';
    const output = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
    delete output.coat;
    delete output.wear;
    output.breed = LEGACY_BREED[look];
    if (output.breed !== look) output.coat = look;
    output.accessory = LEGACY_ACCESSORY[wear];
    if (FROM_LEGACY_ACCESSORY[output.accessory] !== wear) output.wear = wear;
    output.collar = typeof input.collar === 'string' && HEX.test(input.collar)
      ? input.collar
      : ((LOOKS[look] && LOOKS[look].collar) || COLLAR_COLORS[0]);
    return output;
  }

  // 新招募的猫：客户端有自己那一组毛色就用它（连同那种毛色自带的项圈和配饰）；没有就用确定性默认。
  function defaultCatForClient(appId, seedText) {
    const look = CLIENT_LOOKS[appId];
    if (!look || !LOOKS[look]) return defaultCatFor(seedText);
    const data = LOOKS[look];
    return storeCat({ look, accessory: data.accessory || 'none', collar: data.collar || defaultCatFor(seedText).collar });
  }

  /*
   * 卡片已经在说两件事：状态行说它在干嘛（活动），能量格说还剩多少力气（只认可信的本机额度，黄格是累了，红格是快没电）。
   * 一只猫一次只能演一件事，先后是：
   *   1. 迷糊、干活、赶来——眼下正在发生、或要你处理的事，状态行和猫说的是同一件；
   *   2. 能量格变红（快没电）→ 摊成饼；变黄（有点累）→ 累了；
   *   3. 平静的作息：在岗、玩耍、揣手、打盹、冬眠；活动未知时坐着待命。
   * 额度未知或不可信时不影响猫。
   */
  const STATE_ACTIONS = ['onduty', 'working', 'arriving', 'play', 'rest', 'nap', 'hibernate', 'confused', 'tired', 'spent'];
  const ONE_SHOT_ACTIONS = ['hop', 'pet', 'zap', 'cheer', 'no', 'arrive', 'leave', 'settle', 'wake'];
  const URGENT_ACTIVITY = ['confused', 'working', 'arriving'];
  const CALM_ACTIVITY = ['onduty', 'play', 'rest', 'nap', 'hibernate'];
  function actionFor(activity, energy) {
    if (URGENT_ACTIVITY.includes(activity)) return activity;
    if (energy === 'exhausted') return 'spent';
    if (energy === 'tired') return 'tired';
    if (CALM_ACTIVITY.includes(activity)) return activity;
    return 'onduty';
  }

  return {
    deriveState, WORKING_WINDOW, STATE_META, defaultCatFor, normalizeCat, BREED_KEYS, COLLAR_COLORS, ACCESSORIES,
    LOOK_KEYS, ACCESSORY_KEYS, LOOK_GROUPS, lookGroup, LEGACY_BREED, LEGACY_ACCESSORY, CLIENT_LOOKS, COLLAR_CHOICES,
    resolveCat, storeCat, defaultCatForClient, actionFor, STATE_ACTIONS, ONE_SHOT_ACTIONS
  };
});
