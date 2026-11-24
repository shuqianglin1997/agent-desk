'use strict';

// Helpers the session scanners share: bounded directory walks, reading the
// head or tail of a file, dates, titles, the reply-state shape. Nothing here
// names a client; each client's scanner lives in its own folder.

const fs = require('node:fs');
const path = require('node:path');
const coreJson = require('../core/json-file');

// 按「最后活跃」新→旧排序（updatedAt 优先，退回 createdAt）。就地排序返回同一数组。
function sortByRecency(records) {
  return records.sort((a, b) => {
    const left = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const right = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return right - left;
  });
}

function dateMillis(value) {
  const timestamp = new Date(value || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function latestDate(...values) {
  let latest = null;
  let latestMillis = 0;
  for (const value of values) {
    const parsed = parseDate(value);
    const millis = dateMillis(parsed);
    if (millis > latestMillis) {
      latest = parsed;
      latestMillis = millis;
    }
  }
  return latest;
}

/*
 * 这一轮回完没有（docs/SESSION_MARKS_PLAN.md 第 4.2 节）。只看文件末尾 64KB 里的角色与结束标志：
 *   lastRole    最后一句是谁说的：'user' | 'assistant' | null（末尾里看不出来）
 *   lastReplyAt 最后一条助手消息的时间（ISO），没有就是 null
 *   replyDone   这一轮回完没有：true | false | null（拿不准，由上层按“90 秒内没有新内容”退回判断）
 * 看不到人在官方客户端里读没读，所以这里不说“已读”，只说回完没有。
 */
function emptyReplyState() {
  return { lastRole: null, lastReplyAt: null, replyDone: null };
}

// 一次读末尾 64KB：最后一条事件的时间，加上回复状态。Codex 列表与活动探测共用这一个读法。
function readTailEvents(filePath) {
  const lines = readChunkLines(filePath, true);
  if (!lines) return null;
  const events = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch (_error) { /* 首行可能是半行 */ }
  }
  return events;
}

function eventTime(obj) {
  const raw = obj.timestamp ?? obj.ts ?? obj.time ?? (obj.payload && obj.payload.timestamp);
  const ts = typeof raw === 'number' ? (raw > 10_000_000_000 ? raw : raw * 1000) : Date.parse(raw);
  return Number.isFinite(ts) && ts > 0 ? ts : null;
}

// 定点读文件头或尾一段，按行返回。尾部首行可能是半行，调用方逐行 try-parse 兼容。
function readChunkLines(filePath, fromEnd, maxBytes = 64 * 1024) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(maxBytes, size);
    const buffer = Buffer.alloc(len);
    if (len > 0) fs.readSync(fd, buffer, 0, len, fromEnd ? size - len : 0);
    return buffer.toString('utf8').split(/\r?\n/);
  } catch (_error) {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_error) { /* 已关或无效 */ } }
  }
}

// 只读文件末尾 64KB，反向找最后一条带 timestamp 的事件（大 rollout 也便宜）。
function lastEventTimestamp(filePath) {
  if (!filePath) return null;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(64 * 1024, size);
    const buffer = Buffer.alloc(len);
    if (len > 0) fs.readSync(fd, buffer, 0, len, size - len);
    const lines = buffer.subarray(0, len).toString('utf8').split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const obj = JSON.parse(lines[i]);
        // Codex 事件是 ISO 字符串 timestamp；Kimi wire 事件是数字毫秒 time
        const raw = obj.timestamp ?? obj.ts ?? obj.time ?? (obj.payload && obj.payload.timestamp);
        const ts = typeof raw === 'number' ? (raw > 10_000_000_000 ? raw : raw * 1000) : Date.parse(raw);
        if (Number.isFinite(ts) && ts > 0) return ts;
      } catch (_error) { /* 半行/非 JSON，继续往上找 */ }
    }
    return null;
  } catch (_error) {
    return null; // 打不开 / 读失败
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_error) { /* 已关或无效 */ } }
  }
}

// Walks at most WALK_LIMIT entries. `report.truncated` becomes true when the
// walk stopped with folders left unread (src/core/result.js carries it on).
const WALK_LIMIT = 12000;
function walkFiles(root, predicate, report = null) {
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
        if (!['Cache', 'GPUCache', 'node_modules'].includes(entry.name)) pending.push(itemPath);
      } else if (predicate(entry, itemPath)) {
        output.push(itemPath);
      }
    }
  }

  if (report && pending.length) report.truncated = true;
  return output;
}

function readJson(filePath) {
  return coreJson.readJson(filePath);
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch (_error) {
    return null;
  }
}

function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  if (/^\d+(\.\d+)?$/.test(String(value))) {
    const numeric = Number(value);
    return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanTitle(value) {
  const trimmed = text(value)?.trim();
  return trimmed || null;
}

function text(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function uuidFromFilename(filePath) {
  const match = path.basename(filePath).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match?.[0] || null;
}

module.exports = { sortByRecency, dateMillis, latestDate, emptyReplyState, readTailEvents, eventTime, readChunkLines, lastEventTimestamp, WALK_LIMIT, walkFiles, readJson, safeStat, parseDate, cleanTitle, text, uuidFromFilename };
