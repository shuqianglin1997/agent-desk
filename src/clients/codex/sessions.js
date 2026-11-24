'use strict';

// Codex sessions: rollouts under <CODEX_HOME>/sessions and archived_sessions,
// titles from session_index.jsonl. The rollout format itself is read by
// ./rollout.js.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const codexRollout = require('./rollout');
const memo = require('../file-memo');
const { sortByRecency, dateMillis, latestDate, emptyReplyState, readTailEvents, eventTime, walkFiles, safeStat, parseDate, cleanTitle, text, uuidFromFilename } = require('../scan');

// Shared bounded metadata read: list rows and activity use exactly the same
// identity rule, remembered per file (src/clients/file-memo.js).
function codexRecordIdentity(filePath, stat) {
  return memo.remember('codex/identity', filePath, () => {
    const first = codexRollout.readFirstLine(filePath);
    return {
      first,
      identity: codexRollout.classifyCodexSessionMeta(first?.payload || {}, uuidFromFilename(filePath) || path.basename(filePath, '.jsonl'))
    };
  }, stat);
}

function scanCodex(profile, report = null) {
  const root = profile.sessionRoot || path.join(os.homedir(), '.codex');
  const index = readCodexIndex(path.join(root, 'session_index.jsonl'));
  const dirs = [
    { dir: path.join(root, 'sessions'), source: 'Codex', archived: false },
    { dir: path.join(root, 'archived_sessions'), source: 'Codex 归档', archived: true }
  ];
  const rootsByConversation = new Map();
  const internalBranchesByConversation = new Map();

  for (const area of dirs) {
    for (const filePath of walkFiles(area.dir, (entry) => entry.isFile() && entry.name.endsWith('.jsonl'), report)) {
      const stat = safeStat(filePath);
      const { first, identity } = codexRecordIdentity(filePath, stat);
      const payload = first?.payload || {};

      // guardian/subagent rollouts are physical execution branches of the user
      // root. They never become a default list row, even while the parent file
      // is temporarily absent. Keep only a diagnostic count for a known root.
      if (identity.recordKind === 'internal-child') {
        if (identity.parentConversationKey) {
          const branchKeys = internalBranchesByConversation.get(identity.parentConversationKey) || new Set();
          branchKeys.add(identity.physicalRecordId || filePath);
          internalBranchesByConversation.set(identity.parentConversationKey, branchKeys);
        }
        continue;
      }

      const id = identity.adapterConversationKey;
      if (!id) continue;

      // Codex keys session_index.jsonl by session_id, which differs from
      // payload.id for most rollouts; look it up by session_id first so
      // titles (thread_name) actually resolve.
      const indexed = index.get(text(payload.session_id) || id);
      const title = cleanTitle(indexed?.title) || cleanTitle(payload.title) || `Codex 会话 ${id.slice(0, 8)}`;
      const createdAt = parseDate(first?.timestamp) || stat?.birthtime?.toISOString() || null;
      // session_index.jsonl is a title index, not a reliable live activity log:
      // an ongoing rollout can keep appending for days after its index row stops
      // moving. Prefer the newest trustworthy content timestamp while retaining
      // the index value for clients that do keep it current. File mtime remains a
      // last-resort fallback for old or malformed records without event times.
      const tail = codexTailState(filePath, stat);
      const contentUpdatedAt = parseDate(tail.lastEventAt);
      const updatedAt = latestDate(indexed?.updatedAt, contentUpdatedAt)
        || stat?.mtime?.toISOString()
        || createdAt;
      const rootRevisionAt = stat?.mtime?.toISOString() || createdAt;
      const projectPath = text(payload.cwd) || text(payload.current_dir) || null;
      const model = text(payload.model) || text(payload.model_provider) || null;

      const record = {
        id,
        appId: 'codex',
        title,
        createdAt,
        updatedAt,
        projectPath,
        source: area.source,
        status: area.archived ? '已归档' : '可用',
        model,
        filePath,
        address: id,
        adapterConversationKey: id,
        physicalRecordId: identity.physicalRecordId,
        recordKind: identity.recordKind,
        lastRole: tail.lastRole,
        lastReplyAt: tail.lastReplyAt,
        replyDone: tail.replyDone
      };

      const existing = rootsByConversation.get(id);
      if (!existing) {
        rootsByConversation.set(id, {
          record,
          rootRevisionAt,
          lifecycleStates: new Set([record.status])
        });
        continue;
      }

      existing.lifecycleStates.add(record.status);
      if (preferCodexRoot(record, rootRevisionAt, existing.record, existing.rootRevisionAt)) {
        existing.record = record;
        existing.rootRevisionAt = rootRevisionAt;
      }
    }
  }

  const records = [];
  for (const [conversationKey, entry] of rootsByConversation) {
    records.push({
      ...entry.record,
      internalBranchCount: internalBranchesByConversation.get(conversationKey)?.size || 0,
      lifecycleConflict: entry.lifecycleStates.size > 1
    });
  }

  return sortByRecency(records);
}

function preferCodexRoot(candidate, candidateRevisionAt, current, currentRevisionAt) {
  const candidateRevisionTime = dateMillis(candidateRevisionAt);
  const currentRevisionTime = dateMillis(currentRevisionAt);
  if (candidateRevisionTime !== currentRevisionTime) return candidateRevisionTime > currentRevisionTime;

  const candidateTime = dateMillis(candidate.updatedAt || candidate.createdAt);
  const currentTime = dateMillis(current.updatedAt || current.createdAt);
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  if (candidate.status !== current.status) return candidate.status === '可用';
  return candidate.filePath.localeCompare(current.filePath) < 0;
}

// Read content/index only for tied root revisions; share the list's lifecycle rule.
function createCodexActivityPreference(profile) {
  let index;
  const records = new Map();
  function asRecord(record, key) {
    if (!records.has(record.filePath)) {
      index ||= readCodexIndex(path.join(profile.sessionRoot, 'session_index.jsonl'));
      records.set(record.filePath, {
        filePath: record.filePath,
        status: record.archived ? '已归档' : '可用',
        updatedAt: latestDate(index.get(key)?.updatedAt, codexTailState(record.filePath).lastEventAt) || record.mtime
      });
    }
    return records.get(record.filePath);
  }
  return (candidate, current, key) => {
    const revision = Math.trunc(candidate.mtime);
    const previousRevision = Math.trunc(current.mtime);
    if (revision !== previousRevision) return revision > previousRevision;
    return preferCodexRoot(asRecord(candidate, key), revision, asRecord(current, key), previousRevision);
  };
}

// Codex：response_item 里 role 为 assistant 的 message 是回复，event_msg 的 task_complete 是这一轮回完了；
// 推理、工具调用和它们的输出都还在这一轮里；turn_aborted 是人打断了，不算回完。
function codexReplyStep(state, event) {
  if (!event || typeof event !== 'object') return;
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
  if (event.type === 'response_item') {
    if (payload.type === 'message') {
      if (payload.role === 'user') {
        state.lastRole = 'user';
        state.replyDone = false;
      } else if (payload.role === 'assistant') {
        state.lastRole = 'assistant';
        const at = parseDate(event.timestamp);
        if (at) state.lastReplyAt = at;
        state.replyDone = payload.phase === 'commentary' ? false : null;
      }
      return;
    }
    state.replyDone = false;
    return;
  }
  if (event.type !== 'event_msg') return;
  if (payload.type === 'user_message') {
    state.lastRole = 'user';
    state.replyDone = false;
  } else if (payload.type === 'agent_message') {
    state.lastRole = 'assistant';
    const at = parseDate(event.timestamp);
    if (at) state.lastReplyAt = at;
    if (state.replyDone !== true) state.replyDone = null;
  } else if (payload.type === 'task_complete') {
    if (state.lastRole === 'assistant') state.replyDone = true;
  } else if (payload.type === 'task_started' || payload.type === 'turn_aborted') {
    state.replyDone = false;
  }
}

// The end of a rollout: when the last event happened and who spoke last.
// The list, the activity probe's reply state and its content time share this
// one remembered read.
function codexTailState(filePath, stat) {
  if (!filePath) return { lastEventAt: null, ...emptyReplyState() };
  try {
    return memo.remember('codex/tail', filePath, readCodexTail, stat);
  } catch (_error) {
    return { lastEventAt: null, ...emptyReplyState() };
  }
}

function readCodexTail(filePath) {
  const events = readTailEvents(filePath);
  if (!events) throw memo.unreadable(filePath);
  const reply = emptyReplyState();
  let lastEventAt = null;
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    codexReplyStep(reply, event);
    const ts = eventTime(event);
    if (ts) lastEventAt = ts;
  }
  return { lastEventAt, ...reply };
}

// Codex：rollout .jsonl 末尾最后一条带时间的事件（生成时逐事件实时追加）。
function codexActivityFromFile(filePath, stat) {
  return codexTailState(filePath, stat).lastEventAt;
}

function readCodexIndex(filePath) {
  const map = new Map();
  if (!fs.existsSync(filePath)) return map;
  let lines;
  try {
    lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  } catch (_error) {
    // An unreadable title index must not empty the whole list: titles fall back.
    return map;
  }
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const json = JSON.parse(line);
      const id = text(json.id);
      if (!id) continue;
      map.set(id, {
        title: text(json.thread_name),
        updatedAt: parseDate(json.updated_at)
      });
    } catch (_error) {
      // Ignore partial lines written by a running app.
    }
  }
  return map;
}

module.exports = { codexRecordIdentity, scanCodex, createCodexActivityPreference, codexReplyStep, codexTailState, codexActivityFromFile, readCodexIndex };
