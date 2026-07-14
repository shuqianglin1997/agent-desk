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
  const MINUTE = 60e3;
  const DAY = 24 * 60 * MINUTE;

  // 状态元数据：优先级即 deriveState 的判断顺序
  const STATE_META = {
    confused: { label: '迷路', hint: '路径失效，点「诊断」体检' },
    working: { label: '干活中', hint: '有会话正在写入' },
    arriving: { label: '开工路上', hint: '刚打开账号' },
    play: { label: '玩耍', hint: '今天活跃过' },
    rest: { label: '面包猫', hint: '1〜3 天没动静' },
    nap: { label: '打盹', hint: '3〜7 天没动静' },
    hibernate: { label: '冬眠', hint: '超过 7 天没动静' }
  };

  const WORKING_WINDOW = 5 * MINUTE;
  const ARRIVING_WINDOW = 3 * MINUTE;

  /*
   * 信号 → 状态。activity 来自主进程的 stat-only 探测：
   *   { rootExists, rootReadable, latestMtime(ms|null), fileCount }
   * 探测缺失（IPC 失败等）时不吓唬人，按面包猫待机处理。
   */
  function deriveState(now, profile, activity) {
    if (!activity) return 'rest';
    if (!activity.rootExists || !activity.rootReadable) return 'confused';

    const launchedAgo = profile && profile.lastLaunchedAt
      ? now - Date.parse(profile.lastLaunchedAt)
      : Infinity;
    const activeAgo = activity.latestMtime ? now - activity.latestMtime : Infinity;

    if (activeAgo < WORKING_WINDOW) return 'working';
    if (launchedAgo >= 0 && launchedAgo < ARRIVING_WINDOW) return 'arriving';
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
