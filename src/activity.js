/*
 * AgentDesk — 账号活跃度轻量探测。
 *
 * stat + 缓存的有界首行身份读取；物理文件数与逻辑会话数分开。
 * 内部分支不贡献活跃统计；不在轮询中完整解析 transcript。
 */

const fs = require('node:fs');
const path = require('node:path');
const apps = require('./apps');
const { createCodexActivityPreference, replyStateOf, claudeCliIsSidechain } = require('./sessions');
const { freshReplyAt } = require('./session-marks');
const { WORKING_WINDOW } = require('./yard/cats');
const { createHash } = require('node:crypto');

const WALK_LIMIT = 12000;
const SKIP_DIRS = ['Cache', 'GPUCache', 'node_modules'];
// 「此刻进行中」窗口：会话文件在这段时间内被写过就算一路并行的活。
// CLI 会话工作时逐事件追加记录，闲置的终端窗口不会更新文件。
const ACTIVE_NOW_MS = 5 * 60_000;
// 「同时在跑」窗口：与猫的「干活」同一个常量（docs/SESSION_MARKS_PLAN.md 第 3.1 节）。
const WRITING_WINDOW_MS = WORKING_WINDOW;
const WRITING_KEYS_LIMIT = 32;
const FRESH_KEYS_LIMIT = 500;
// 只有这两种客户端读末尾就能知道最后一句是谁说的；其他客户端不标“新回复”。
const REPLY_APPS = new Set(['claude-cli', 'codex']);

// 「有新内容」看追加型记录（.jsonl）的长度变没变，不看 mtime：客户端会无故 touch 文件（Codex 尤甚）。
// 第一次见到的文件只能信 mtime；整文件重写的 .json 也只能信 mtime。
const contentClock = new Map();
function contentChangedAt(filePath, stat) {
  if (!filePath.endsWith('.jsonl')) return stat.mtimeMs;
  const cached = contentClock.get(filePath);
  if (cached && cached.size === stat.size) return cached.changedAt;
  if (contentClock.size >= 20000) contentClock.clear();
  const entry = { size: stat.size, changedAt: stat.mtimeMs };
  contentClock.set(filePath, entry);
  return entry.changedAt;
}

// 回复状态按文件版本缓存：没变的文件 8 秒一轮也不重读。
const replyCache = new Map();
function cachedReplyState(appId, filePath, stat) {
  const revision = `${stat.size}:${stat.mtimeMs}`;
  const cached = replyCache.get(filePath);
  if (cached && cached.revision === revision) return cached.value;
  const value = replyStateOf(appId, filePath);
  if (replyCache.size >= 12000) replyCache.clear();
  replyCache.set(filePath, { revision, value });
  return value;
}

function startOfDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function probeActivity(profile, now = Date.now(), options = {}) {
  const result = {
    profileId: profile.id,
    sourceKey: activitySourceKey(profile),
    sessionCount: 0,
    rootExists: false,
    rootReadable: false,
    latestMtime: null,
    contentActiveAt: null, // 会话记录内容里的最后活跃时间（比 mtime 干净），驱动干活/在岗
    fileCount: 0,
    activeToday: 0,   // 今天被写过的会话数（mtime 落在今天）
    createdToday: 0,  // 今天新建的会话数（birthtime 落在今天）
    activeNow: 0,     // 近 5 分钟仍在写入的并行会话数（按会话去重，多终端窗口可见）
    writingNow: 0     // 近 90 秒有新内容、还没回完的逻辑会话数（猫有多忙）；拿不到时为 null
  };
  // 下面两项只在本模块里用，probeActivities 按运行位置换成会话键后删掉。
  const writingAddresses = [];
  const replies = [];

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
  const records = new Map();
  const changedAtByKey = new Map();
  const prefer = profile.appId === 'codex'
    ? createCodexActivityPreference(profile)
    : (candidate, current) => candidate.mtime >= current.mtime;
  for (const area of app.scanAreas(profile)) {
    for (const filePath of walkFiles(area.dir, area.match, area.maxDepth)) {
      try {
        const stat = fs.statSync(filePath);
        result.fileCount += 1; // physical diagnostics only; never a session count
        const record = app.activityRecord
          ? app.activityRecord(filePath, stat)
          : { key: sessionKeyOf(filePath) };
        if (!record?.key) continue;
        const mtime = stat.mtimeMs;
        const archived = profile.appId === 'codex'
          && path.relative(profile.sessionRoot, filePath).split(path.sep)[0] === 'archived_sessions';
        const previous = records.get(record.key);
        const candidate = {
          filePath, mtime, archived,
          createdAt: Date.parse(record.createdAt || '') || stat.birthtimeMs
        };
        if (!previous || prefer(candidate, previous, record.key)) records.set(record.key, { ...candidate, stat });
        const changedAt = contentChangedAt(filePath, stat);
        if (changedAt > (changedAtByKey.get(record.key) || 0)) changedAtByKey.set(record.key, changedAt);
      } catch (_error) {
        // Disappearing or unreadable files cannot invalidate the other accounts.
      }
    }
  }
  result.sessionCount = records.size;
  for (const record of records.values()) {
    if (!result.latestMtime || record.mtime > result.latestMtime) {
      result.latestMtime = record.mtime;
      newestPath = record.filePath;
    }
    if (record.mtime >= todayStart && record.mtime <= now + 1000) result.activeToday += 1;
    if (!record.archived && record.mtime >= now - ACTIVE_NOW_MS && record.mtime <= now + 1000) result.activeNow += 1;
    if (record.createdAt >= todayStart && record.createdAt <= now + 1000) result.createdToday += 1;
  }

  // 同时在跑与新回复。读末尾只发生在最近有新内容、或首次启用之后动过的文件上，且按文件版本缓存。
  const addressOf = typeof app.sessionAddressOf === 'function' ? app.sessionAddressOf : null;
  const replyApp = REPLY_APPS.has(profile.appId);
  const baselineAt = Number(options.baselineAt) || 0;
  for (const [key, record] of records) {
    if (record.archived) continue;
    const changedAt = changedAtByKey.get(key) || record.mtime;
    const recent = changedAt >= now - WRITING_WINDOW_MS && changedAt <= now + 1000;
    const readsReply = replyApp && (recent || (baselineAt > 0 && record.mtime > baselineAt));
    if (!recent && !readsReply) continue;
    if (profile.appId === 'claude-cli' && claudeCliIsSidechain(record.filePath)) continue;
    const reply = readsReply ? cachedReplyState(profile.appId, record.filePath, record.stat) : null;
    // 知道这一轮已经回完的，不算在跑（回完以后客户端还会补写几行收尾记录）。
    const done = reply && reply.lastRole === 'assistant' && reply.replyDone === true;
    const writing = recent && !done;
    const address = addressOf ? addressOf(key) : null;
    if (writing) {
      result.writingNow += 1;
      if (address && writingAddresses.length < WRITING_KEYS_LIMIT) writingAddresses.push(address);
    }
    if (reply && address) {
      const at = freshReplyAt(reply, { writing, quiet: !recent, baselineAt });
      if (at !== null) replies.push({ address, at });
    }
  }
  Object.defineProperty(result, 'writingAddresses', { value: writingAddresses, enumerable: false });
  Object.defineProperty(result, 'replies', { value: replies, enumerable: false });

  // SQLite 型客户端（Cursor）：会话是 db 行不是文件，按文件数失真，改用适配器的聚合计数。
  // 包 try/catch：某个适配器出错也不能连累整轮探测（否则所有账号活跃度会被清空）。
  if (typeof app.sessionCounts === 'function') {
    try {
      const counts = app.sessionCounts(profile, now);
      for (const key of ['sessionCount', 'activeNow', 'activeToday', 'createdToday']) {
        if (Number.isFinite(counts[key])) result[key] = counts[key];
      }
      // 数据库型客户端按文件数不准；适配器没给“在跑”就是不知道，不显示 0 条。
      result.writingNow = Number.isFinite(counts.writingNow) ? counts.writingNow : null;
      writingAddresses.length = 0;
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

// Scope by adapter and canonical data root, never by title, account alias or credentials.
function activitySourceKey(profile) {
  if (!profile.sessionRoot) return null;
  let root;
  try { root = fs.realpathSync(profile.sessionRoot); } catch (_) { root = path.resolve(profile.sessionRoot); }
  return createHash('sha256').update(JSON.stringify([profile.appId, root])).digest('hex');
}

/*
 * marks（可选）：{ baselineAt, seenAt(key) }，来自本机的会话记号。会话键与 SessionTable.markKeyOf 同一口径：
 * “运行位置 ID::会话地址”。同一份数据根被几个运行位置共用时只扫一次，键按各自的运行位置给出。
 */
function probeActivities(profiles, now = Date.now(), marks = null) {
  const bySource = new Map();
  const baselineAt = marks && Number(marks.baselineAt) > 0 ? Number(marks.baselineAt) : 0;
  const seenAt = marks && typeof marks.seenAt === 'function' ? marks.seenAt : () => null;
  return profiles.map((profile) => {
    const key = activitySourceKey(profile);
    let raw;
    if (!key || !bySource.has(key)) {
      raw = probeActivity(profile, now, { baselineAt });
      if (key) bySource.set(key, raw);
    } else {
      raw = bySource.get(key);
    }
    const id = String(profile.id);
    const fresh = [];
    if (baselineAt > 0) {
      for (const reply of raw.replies || []) {
        const sessionKey = `${id}::${reply.address}`;
        const seen = Number(seenAt(sessionKey)) || 0;
        if (reply.at > seen && fresh.length < FRESH_KEYS_LIMIT) fresh.push({ key: sessionKey, at: reply.at });
      }
    }
    const replyApp = REPLY_APPS.has(profile.appId) && baselineAt > 0;
    return {
      ...raw,
      profileId: profile.id,
      writingKeys: (raw.writingAddresses || []).map((address) => `${id}::${address}`),
      freshReplies: replyApp ? fresh.length : null,
      freshKeys: fresh
    };
  });
}

module.exports = { probeActivity, probeActivities, WRITING_WINDOW_MS };
