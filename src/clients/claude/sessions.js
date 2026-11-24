'use strict';

// Claude desktop sessions: local_*.json under claude-code-sessions/ and
// local-agent-mode-sessions/ in the app's data folder.

const path = require('node:path');
const { sortByRecency, walkFiles, readJson, safeStat, parseDate, cleanTitle, text } = require('../scan');

function scanClaude(profile, report = null) {
  const roots = [
    { dir: path.join(profile.sessionRoot, 'claude-code-sessions'), source: 'Claude Code' },
    { dir: path.join(profile.sessionRoot, 'local-agent-mode-sessions'), source: 'Claude 本地' }
  ];
  const records = [];

  for (const root of roots) {
    for (const filePath of walkFiles(root.dir, (entry) => entry.isFile() && /^local_.*\.json$/i.test(entry.name), report)) {
      const json = readJson(filePath);
      if (!json) continue;
      const stat = safeStat(filePath);
      const id = text(json.sessionId) || text(json.cliSessionId) || path.basename(filePath, '.json').replace(/^local_/, '');
      const title = cleanTitle(json.title) || `Claude 会话 ${id.slice(0, 8)}`;
      const createdAt = parseDate(json.createdAt) || stat?.birthtime?.toISOString() || null;
      const updatedAt = parseDate(json.lastActivityAt) || parseDate(json.lastFocusedAt) || stat?.mtime?.toISOString() || createdAt;
      const projectPath = text(json.cwd) || text(json.originCwd) || null;
      const model = text(json.model) || text(json.effort) || null;

      records.push({
        id,
        appId: 'claude',
        title,
        createdAt,
        updatedAt,
        projectPath,
        source: root.source,
        status: json.isArchived ? '已归档' : '可用',
        model,
        filePath,
        // 会话身份必须独立于磁盘位置。Windows/MSIX 更新、路径迁移或
        // Claude 清理缓存后 filePath 可能变化，sessionId 仍然稳定。
        address: id
      });
    }
  }

  return sortByRecency(records);
}

// 「会话记录里的最后活跃时间」——比文件 mtime 干净（内容里的时间戳，不受乱 touch 影响）。
// 供猫状态判定用。filePath 由 activity.probeActivity 那趟 walk 顺带找出的最新会话文件传入，
// 这里只读这一个文件、不再自己遍历目录。返回毫秒时间戳或 null。

// Claude：读 local_*.json 内容里的 lastActivityAt（App 按轮次写）。用 parseDate 兼容数值/字符串两种格式。
function claudeActivityFromFile(filePath) {
  if (!filePath) return null;
  const json = readJson(filePath);
  if (!json) return null;
  const iso = parseDate(json.lastActivityAt);
  return iso ? new Date(iso).getTime() : null;
}

module.exports = { scanClaude, claudeActivityFromFile };
