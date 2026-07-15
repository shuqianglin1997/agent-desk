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
    fileCount: 0,
    activeToday: 0,   // 今天被写过的会话数（mtime 落在今天）
    createdToday: 0   // 今天新建的会话数（birthtime 落在今天）
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

  const todayStart = startOfDay(now);
  for (const area of apps.getApp(profile.appId).scanAreas(profile)) {
    for (const filePath of walkFiles(area.dir, area.match)) {
      result.fileCount += 1;
      try {
        const stat = fs.statSync(filePath); // 只 stat，不读内容
        const mtime = stat.mtime.getTime();
        if (!result.latestMtime || mtime > result.latestMtime) result.latestMtime = mtime;
        if (mtime >= todayStart) result.activeToday += 1;
        const btime = stat.birthtime ? stat.birthtime.getTime() : 0;
        if (btime >= todayStart && btime <= now + 1000) result.createdToday += 1;
      } catch (_error) {
        // 文件在扫描间隙被删掉了，跳过即可
      }
    }
  }

  return result;
}

function walkFiles(root, match) {
  const output = [];
  if (!root || !fs.existsSync(root)) return output;
  const pending = [root];
  let scanned = 0;

  while (pending.length && scanned < WALK_LIMIT) {
    const current = pending.pop();
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
        if (!SKIP_DIRS.includes(entry.name)) pending.push(itemPath);
      } else if (entry.isFile() && match(entry.name)) {
        output.push(itemPath);
      }
    }
  }

  return output;
}

module.exports = { probeActivity };
