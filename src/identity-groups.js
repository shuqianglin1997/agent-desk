/*
 * AgentDesk — 账号身份分组。
 *
 * 一个登录账号可能以多个客户端槽位存在（桌面 Claude 与终端 Claude CLI、
 * Kimi Code 与 Kimi Work）。这里把槽位按「同一登录身份」归拢成组，庭院一只猫
 * 对应一个账号组、会话列表合流、额度总览按组去重 —— 账号才是轴，槽位只是形态。
 *
 * 关联依据（可传递，取并查集闭包）：
 *  - identityKey：用户手动标注的同账号词
 *  - identityFingerprint：main 侧按账号 UUID 哈希出的登录指纹
 *
 * primary（组代表，猫名牌用它的名字）：优先用户命名过的槽位（名字不以「默认」
 * 开头），其次创建时间早的。UMD：renderer 直接用，node:test 可单测。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.IdentityGroups = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  function findRoot(parent, index) {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  }

  function union(parent, a, b) {
    const ra = findRoot(parent, a);
    const rb = findRoot(parent, b);
    if (ra !== rb) parent[rb] = ra;
  }

  function isCustomName(profile) {
    return !/^默认\s?/.test(String(profile.name || ''));
  }

  function pickPrimary(members) {
    return [...members].sort((a, b) => {
      const custom = Number(isCustomName(b)) - Number(isCustomName(a));
      if (custom !== 0) return custom;
      const left = Date.parse(a.createdAt || '') || 0;
      const right = Date.parse(b.createdAt || '') || 0;
      return left - right;
    })[0];
  }

  function groupProfilesByIdentity(profiles) {
    const list = Array.isArray(profiles) ? profiles.filter((p) => p && p.id !== undefined) : [];
    const parent = list.map((_p, index) => index);

    const byKey = new Map();
    const byFingerprint = new Map();
    list.forEach((profile, index) => {
      const key = typeof profile.identityKey === 'string' && profile.identityKey.trim()
        ? profile.identityKey.trim()
        : null;
      const fingerprint = typeof profile.identityFingerprint === 'string' && profile.identityFingerprint
        ? profile.identityFingerprint
        : null;
      if (key) {
        if (byKey.has(key)) union(parent, byKey.get(key), index);
        else byKey.set(key, index);
      }
      if (fingerprint) {
        if (byFingerprint.has(fingerprint)) union(parent, byFingerprint.get(fingerprint), index);
        else byFingerprint.set(fingerprint, index);
      }
    });

    // 按首个成员出现顺序输出组，保证列表稳定
    const groupsByRoot = new Map();
    list.forEach((profile, index) => {
      const rootIndex = findRoot(parent, index);
      if (!groupsByRoot.has(rootIndex)) groupsByRoot.set(rootIndex, []);
      groupsByRoot.get(rootIndex).push(profile);
    });

    return [...groupsByRoot.values()].map((members) => {
      const primary = pickPrimary(members);
      return { key: String(primary.id), primary, members };
    });
  }

  // 组内多份 activity 探测聚合成一份：计数求和、时间取最大、存在性取或。
  // 输出可直接喂给 YardCats.deriveState —— 组内任一形态在干活，猫就在打字。
  function mergeActivity(activities) {
    const list = (Array.isArray(activities) ? activities : []).filter(Boolean);
    if (!list.length) return null;
    const maxOf = (field) => list.reduce((acc, item) => {
      const value = Number(item[field]);
      return Number.isFinite(value) && value > (acc ?? -Infinity) ? value : acc;
    }, null);
    const sumOf = (field) => list.reduce((acc, item) => acc + (Number(item[field]) || 0), 0);

    return {
      profileId: list[0].profileId,
      rootExists: list.some((item) => item.rootExists === true),
      rootReadable: list.some((item) => item.rootReadable === true),
      latestMtime: maxOf('latestMtime'),
      contentActiveAt: maxOf('contentActiveAt'),
      fileCount: sumOf('fileCount'),
      activeToday: sumOf('activeToday'),
      createdToday: sumOf('createdToday'),
      activeNow: sumOf('activeNow')
    };
  }

  return { groupProfilesByIdentity, mergeActivity };
});
