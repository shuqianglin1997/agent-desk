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
    working: { label: '干活中', hint: 'App 进程正在烧 CPU —— 真在生成/推理' },
    onduty: { label: '在岗', hint: 'App 开着但 CPU 空闲，没有任务在跑' },
    arriving: { label: '开工路上', hint: '刚打开账号，App 还没起来' },
    play: { label: '玩耍', hint: 'App 没开，今天活跃过' },
    rest: { label: '面包猫', hint: 'App 没开，1〜3 天没动静' },
    nap: { label: '打盹', hint: 'App 没开，3〜7 天没动静' },
    hibernate: { label: '冬眠', hint: 'App 没开，超过 7 天没动静' }
  };

  // 「干活中」的 CPU 门槛（该账号名下所有进程 %cpu 之和，可 >100=多核）。
  // 依据实测：空闲 App <1%、UI 渲染瞬时可冲到 ~40%、真正生成/推理持续 100%+。
  // 取 60 卡在 UI 噪声之上、生成之下：宁可漏报也不把「开着划屏」误判成干活。可按机器调。
  const WORKING_CPU = 60;
  const WORKING_WINDOW = 25 * SECOND; // 仅在 CPU 不可得（如 Windows）时的回退：会话 25 秒内写过 = 干活
  const ARRIVING_WINDOW = 3 * MINUTE;

  /*
   * 信号 → 状态。activity 来自主进程：
   *   { rootExists, rootReadable, latestMtime, fileCount, running, cpu }
   *   running：该账号官方 App 进程是否在运行。true / false / null（探测不可用）。
   *   cpu：该账号名下所有进程 %cpu 之和。数字 / null（无 CPU 列，如 Windows wmic）/ undefined。
   *
   * 关键：「干活中 vs 在岗」由 CPU 区分，不再靠会话文件 mtime——
   * 各 App 刷盘节奏天差地别（Codex 每轮狂写 → mtime 永远很新；Claude 桌面版写盘懒惰
   * → 生成时 mtime 反而不动），同一个时间窗口对不同 App 含义相反。CPU 是「进程此刻在不在
   * 算」的直接信号，跨 App 一致。mtime 仅作 CPU 不可得时的回退。
   */
  function deriveState(now, profile, activity) {
    if (!activity) return 'rest';
    if (!activity.rootExists || !activity.rootReadable) return 'confused';

    const launchedAgo = profile && profile.lastLaunchedAt
      ? now - Date.parse(profile.lastLaunchedAt)
      : Infinity;
    const activeAgo = activity.latestMtime ? now - activity.latestMtime : Infinity;
    const running = activity.running;
    const cpu = activity.cpu;

    // App 确认在跑（主路径）：CPU 高=干活中，CPU 空闲=在岗待命。CPU 不可得（Windows）时回退会话窗口。
    // 一旦探测到在跑就不再走「开工路上」——直接判在岗/干活。
    if (running === true) {
      if (typeof cpu === 'number') return cpu >= WORKING_CPU ? 'working' : 'onduty';
      return activeAgo < WORKING_WINDOW ? 'working' : 'onduty';
    }

    // 以下 running 为 false(明确没开) 或 null/undefined(探测不可用)。
    // 探测不可用时无法确认开没开：近 25 秒还在写 → 尽力当干活。这条排在「开工路上」之前，
    // 保持旧判据优先级（正在写入压过「刚点开」）；running===false(明确没开) 不走这条，近期写入只是残留。
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
      breed: BREED_KEYS.includes(input.breed) ? input.breed : fallback.breed,
      collar: typeof input.collar === 'string' && /^#[0-9a-f]{6}$/i.test(input.collar)
        ? input.collar
        : fallback.collar,
      accessory: ACCESSORIES.includes(input.accessory) ? input.accessory : fallback.accessory
    };
  }

  return { deriveState, STATE_META, defaultCatFor, normalizeCat, BREED_KEYS, COLLAR_COLORS, ACCESSORIES };
});
