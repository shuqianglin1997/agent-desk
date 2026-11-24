'use strict';

/*
 * AgentDesk — 会话的颜色标签与“看过”的记号（docs/SESSION_MARKS_PLAN.md 第 4、5 节）。
 *
 * 只存在本机 userData/session-marks.json，原子替换写入；不写进任何官方客户端的文件，本期也不随 Mesh 同步。
 * Main 是唯一写入者。Renderer 只能经四个专用 IPC 交来会话键、1–5 的数字和有界字符串，这里逐项重新校验。
 *
 * 应用不替人打标签、不规定含义、不排优先级：这里只记人自己打的标签和起的名字。
 * “看过”只是“人在 AgentDesk 里点开过”，不是“读过”——AgentDesk 看不到官方客户端里读没读。
 */

const { readJsonStore, writeJsonStore } = require('./json-store');

const STORE_VERSION = 1;
const TAG_COUNT = 5;
const MAX_ENTRIES = 5000;
const BATCH_MAX = 5000;
const KEY_MAX = 512;
const NAME_MAX = 12;
const MAX_TIME = 8.64e15;

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

// 会话键就是 SessionTable.markKeyOf 的结果：“运行位置::会话地址”或“mesh::逻辑会话”。只认形状，不认含义。
function normalizeKey(value) {
  if (typeof value !== 'string' || value.length < 3 || value.length > KEY_MAX) return null;
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;
  const split = value.indexOf('::');
  if (split <= 0 || split + 2 >= value.length) return null;
  return value;
}

function normalizeTag(value) {
  return Number.isInteger(value) && value >= 1 && value <= TAG_COUNT ? value : null;
}

// 名字只给人自己看：去掉控制字符，最长 12 个字（按字符数，不按字节）；空的回到默认名。
function normalizeName(value) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return [...clean].slice(0, NAME_MAX).join('');
}

function normalizeTime(value) {
  const ms = typeof value === 'number' ? value : (typeof value === 'string' ? Date.parse(value) : NaN);
  return Number.isFinite(ms) && ms > 0 && ms < MAX_TIME ? Math.round(ms) : null;
}

/*
 * 一条会话算“有新回复”，当且仅当：最后一句是助手、这一轮回完了、回复时间晚于“看过时间”和首次启用的起点。
 * replyDone 拿不准（null）时退回“最后一句是助手，且 90 秒内没有新内容”；正在写的一律不算。
 * 返回这条回复的时间（毫秒），不算就是 null。
 */
function freshReplyAt(reply, context = {}) {
  if (!reply || reply.lastRole !== 'assistant' || context.writing === true) return null;
  if (!(reply.replyDone === true || (reply.replyDone === null && context.quiet === true))) return null;
  const at = normalizeTime(reply.lastReplyAt);
  if (at === null) return null;
  const floor = Math.max(normalizeTime(context.baselineAt) || 0, normalizeTime(context.seenAt) || 0);
  return at > floor ? at : null;
}

function emptyNames() {
  return Array.from({ length: TAG_COUNT }, () => null);
}

class SessionMarksStore {
  constructor({ file, now = () => Date.now(), maxEntries = MAX_ENTRIES }) {
    this.file = file;
    this.now = now;
    this.maxEntries = maxEntries;
    this.state = null;
  }

  load() {
    if (this.state) return this.state;
    const stored = readJsonStore(this.file, (value) => isPlainObject(value))
      || readJsonStore(`${this.file}.bak`, (value) => isPlainObject(value));
    const input = stored ? stored.parsed : null;
    const entries = new Map();
    const raw = isPlainObject(input?.entries) ? Object.entries(input.entries) : [];
    for (const [rawKey, item] of raw.slice(0, this.maxEntries * 2)) {
      const key = normalizeKey(rawKey);
      if (!key || !isPlainObject(item)) continue;
      const entry = { tag: normalizeTag(item.tag), seen: normalizeTime(item.seen), at: normalizeTime(item.at) || 0 };
      if (entry.tag || entry.seen) entries.set(key, entry);
    }
    const names = emptyNames();
    if (Array.isArray(input?.names)) input.names.slice(0, TAG_COUNT).forEach((name, index) => { names[index] = normalizeName(name); });
    const baselineAt = normalizeTime(input?.baselineAt);
    this.state = { baselineAt: baselineAt || this.now(), names, entries };
    this.evict();
    // 首次启用：记下起点并落盘，早于它的回复一律不标。
    if (!baselineAt) this.save();
    return this.state;
  }

  save() {
    const entries = {};
    for (const [key, entry] of this.state.entries) {
      entries[key] = { ...(entry.tag ? { tag: entry.tag } : {}), ...(entry.seen ? { seen: entry.seen } : {}), at: entry.at };
    }
    writeJsonStore(this.file, {
      version: STORE_VERSION,
      baselineAt: this.state.baselineAt,
      names: this.state.names,
      entries
    });
  }

  // 超过上限先清最久没动过的；人亲手打的标签排在自动记下的“看过”之后才清。
  evict() {
    const { entries } = this.state;
    if (entries.size <= this.maxEntries) return;
    const order = [...entries.entries()].sort((left, right) => (
      (Number(Boolean(left[1].tag)) - Number(Boolean(right[1].tag))) || (left[1].at - right[1].at)
    ));
    for (const [key] of order.slice(0, entries.size - this.maxEntries)) entries.delete(key);
  }

  snapshot() {
    const state = this.load();
    const tags = {};
    const seen = {};
    for (const [key, entry] of state.entries) {
      if (entry.tag) tags[key] = entry.tag;
      if (entry.seen) seen[key] = entry.seen;
    }
    return { ok: true, baselineAt: state.baselineAt, names: [...state.names], tags, seen };
  }

  // 给活动探测用：起点和每条会话的看过时间。
  freshContext() {
    const state = this.load();
    return {
      baselineAt: state.baselineAt,
      seenAt: (key) => state.entries.get(key)?.seen || null
    };
  }

  setTag(keys, tag) {
    const state = this.load();
    const list = normalizeKeys(keys);
    const value = tag === 0 || tag === null ? null : normalizeTag(tag);
    if (!list || (value === null && !(tag === 0 || tag === null))) return { ok: false, reasonCode: 'session-marks-input-invalid' };
    const at = this.now();
    for (const key of list) {
      const entry = state.entries.get(key) || { tag: null, seen: null, at };
      entry.tag = value;
      entry.at = at;
      if (entry.tag || entry.seen) state.entries.set(key, entry);
      else state.entries.delete(key);
    }
    this.evict();
    this.save();
    return this.snapshot();
  }

  // 看过时间只往后走：交来更早的时间不会把它往回拨。
  markSeen(items) {
    const state = this.load();
    if (!Array.isArray(items) || !items.length || items.length > BATCH_MAX) return { ok: false, reasonCode: 'session-marks-input-invalid' };
    const parsed = [];
    for (const item of items) {
      const key = normalizeKey(item?.key);
      const seen = normalizeTime(item?.at);
      if (!key || !seen) return { ok: false, reasonCode: 'session-marks-input-invalid' };
      parsed.push({ key, seen });
    }
    const at = this.now();
    for (const { key, seen } of parsed) {
      const entry = state.entries.get(key) || { tag: null, seen: null, at };
      entry.seen = Math.max(entry.seen || 0, seen);
      entry.at = at;
      state.entries.set(key, entry);
    }
    this.evict();
    this.save();
    return this.snapshot();
  }

  rename(tag, name) {
    const state = this.load();
    const index = normalizeTag(tag);
    if (!index || !(typeof name === 'string' || name === null) || (typeof name === 'string' && name.length > 200)) {
      return { ok: false, reasonCode: 'session-marks-input-invalid' };
    }
    state.names[index - 1] = normalizeName(name);
    this.save();
    return this.snapshot();
  }
}

function normalizeKeys(keys) {
  if (!Array.isArray(keys) || !keys.length || keys.length > BATCH_MAX) return null;
  const list = [];
  for (const raw of keys) {
    const key = normalizeKey(raw);
    if (!key) return null;
    list.push(key);
  }
  return [...new Set(list)];
}

module.exports = {
  SessionMarksStore,
  freshReplyAt,
  normalizeKey,
  normalizeName,
  TAG_COUNT,
  MAX_ENTRIES,
  NAME_MAX
};
