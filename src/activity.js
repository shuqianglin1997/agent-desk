/*
 * AgentDesk — 账号活跃度轻量探测。
 *
 * 只做 stat，不读文件内容：回答「会话根目录在不在、最新会话文件
 * 什么时候被写过、有多少个会话文件」。庭院视图用它驱动猫的状态，
 * 完整的会话解析仍然只在 sessions.js。纯 Node，可单测。
 */

const fs = require('node:fs');
const path = require('node:path');
const apps = require('./apps');

const WALK_LIMIT = 12000;
const SKIP_DIRS = ['Cache', 'GPUCache', 'node_modules'];
// 「此刻进行中」窗口：会话文件在这段时间内被写过就算一路并行的活。
// 终端 agent 干活时逐事件追加记录，闲置的终端窗口不会更新文件。
const ACTIVE_NOW_MS = 5 * 60_000;

function startOfDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function probeActivity(profile, now = Date.now()) {
  const result = {
    profileId: profile.id,
    rootExists: false,
    rootReadable: false,
    latestMtime: null,
    contentActiveAt: null, // 会话记录内容里的最后活跃时间（比 mtime 干净），驱动干活/在岗
    fileCount: 0,
    activeToday: 0,   // 今天被写过的会话数（mtime 落在今天）
    createdToday: 0,  // 今天新建的会话数（birthtime 落在今天）
    activeNow: 0      // 近 5 分钟仍在写入的并行会话数（按会话去重，多终端窗口可见）
  };

  const root = profile.sessionRoot;
  if (!root) return result;

  try {
    const stat = fs.statSync(root);
    result.rootExists = stat.isDirectory() || stat.isFile();
  } catch (_error) {
    return result;
  }
  try {
    fs.accessSync(root, fs.constants.R_OK);
    result.rootReadable = true;
  } catch (_error) {
    return result;
  }

  const app = apps.getApp(profile.appId);
  const todayStart = startOfDay(now);
  let newestPath = null; // mtime 最新的会话文件，供下面读内容时间戳（复用这一趟 walk，不再二次遍历）
  // 一个会话可能由多个文件组成（Kimi 的 state.json + wire.jsonl），
  // 按适配器给的会话 key 去重；默认一文件一会话。
  const sessionKeyOf = typeof app.sessionKeyOf === 'function' ? app.sessionKeyOf : (filePath) => filePath;
  const activeNowKeys = new Set();
  for (const area of app.scanAreas(profile)) {
    for (const filePath of walkFiles(area.dir, area.match, area.maxDepth)) {
      result.fileCount += 1;
      try {
        const stat = fs.statSync(filePath); // 只 stat，不读内容
        const mtime = stat.mtime.getTime();
        if (!result.latestMtime || mtime > result.latestMtime) { result.latestMtime = mtime; newestPath = filePath; }
        if (mtime >= todayStart) result.activeToday += 1;
        if (mtime >= now - ACTIVE_NOW_MS) activeNowKeys.add(sessionKeyOf(filePath));
        const btime = stat.birthtime ? stat.birthtime.getTime() : 0;
        if (btime >= todayStart && btime <= now + 1000) result.createdToday += 1;
      } catch (_error) {
        // 文件在扫描间隙被删掉了，跳过即可
      }
    }
  }
  result.activeNow = activeNowKeys.size;

  // SQLite 型客户端（Cursor）：会话是 db 行不是文件，按文件数失真，改用适配器的聚合计数。
  // 包 try/catch：某个适配器出错也不能连累整轮探测（否则所有账号活跃度会被清空）。
  if (typeof app.sessionCounts === 'function') {
    try {
      const counts = app.sessionCounts(profile, now);
      result.activeToday = counts.activeToday;
      result.createdToday = counts.createdToday;
    } catch (_error) {
      // 退回上面按文件数算的结果
    }
  }

  // 会话记录里的最后活跃时间戳（内容，非文件 mtime）——干活/在岗判定用这个。
  // 复用上面 walk 找到的最新文件路径，适配器只读这一个文件/库，不再二次遍历。
  // 拿不到（适配器缺失/出错）就退回 latestMtime。
  if (typeof app.contentActivityAt === 'function') {
    try {
      const ts = app.contentActivityAt(profile, newestPath);
      if (ts) result.contentActiveAt = ts;
    } catch (_error) {
      // 退回 latestMtime（下方兜底）
    }
  }
  if (!result.contentActiveAt) result.contentActiveAt = result.latestMtime;

  return result;
}

// maxDepth：可选的递归深度上限（root 直下为 1）。会话量大的目录树
// （如 ~/.claude/projects 下的 memory/<uuid> 子目录）用它避免撞 WALK_LIMIT 截断。
function walkFiles(root, match, maxDepth = Infinity) {
  const output = [];
  if (!root || !fs.existsSync(root)) return output;
  const pending = [{ dir: root, depth: 0 }];
  let scanned = 0;

  while (pending.length && scanned < WALK_LIMIT) {
    const { dir: current, depth } = pending.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (_error) {
      continue;
    }
    for (const entry of entries) {
      scanned += 1;
      const itemPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (depth + 1 < maxDepth && !SKIP_DIRS.includes(entry.name)) {
          pending.push({ dir: itemPath, depth: depth + 1 });
        }
      } else if (entry.isFile() && match(entry.name)) {
        output.push(itemPath);
      }
    }
  }

  return output;
}

module.exports = { probeActivity };
