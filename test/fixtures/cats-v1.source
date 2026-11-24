/*
 * AgentDesk — 猫状态机与外观（庭院视图）。
 *
 * UMD：浏览器里挂到 window.YardCats，Node 里可 require 直接单测。
 * 纯函数，无 DOM / fs 依赖：输入账号信号，输出猫的状态与外观。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YardCats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
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

  // 同一个账号 id 永远得到同一套默认外观
  function defaultCatFor(seedText) {
    const h = hashText(String(seedText || ''));
    return {
      breed: BREED_KEYS[h % BREED_KEYS.length],
      collar: COLLAR_COLORS[(h >>> 3) % COLLAR_COLORS.length],
      accessory: 'none'
    };
  }

  // profiles.json 里的 cat 字段兜底：缺失/非法值回落到确定性默认
  function normalizeCat(cat, seedText) {
    const fallback = defaultCatFor(seedText);
    const input = cat && typeof cat === 'object' ? cat : {};
    return {
      // Preserve future appearance fields so an older normalizer does not
      // silently delete them during a routine profile read/write.
      ...input,
      breed: BREED_KEYS.includes(input.breed) ? input.breed : fallback.breed,
      collar: typeof input.collar === 'string' && /^#[0-9a-f]{6}$/i.test(input.collar)
        ? input.collar
        : fallback.collar,
      accessory: ACCESSORIES.includes(input.accessory) ? input.accessory : fallback.accessory
    };
  }

  return { deriveState, STATE_META, defaultCatFor, normalizeCat, BREED_KEYS, COLLAR_COLORS, ACCESSORIES };
});
