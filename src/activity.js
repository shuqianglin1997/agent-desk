/*
 * AgentDesk — 账号活跃度：窗口看到的样子。
 *
 * The file work (walks, stats, bounded reads) is in src/activity-files.js and
 * runs on the scan worker; this module, on Main, turns its plain results into
 * what the window sees: which replies are new since this machine last looked.
 */

const apps = require('./apps');
const { probeActivity, probeRawActivities, packRawActivity, WRITING_WINDOW_MS } = require('./activity-files');

const FRESH_KEYS_LIMIT = 500;

/*
 * marks（可选）：{ baselineAt, seenAt(key) }，来自本机的会话记号。会话键与 SessionTable.markKeyOf 同一口径：
 * “运行位置 ID::会话地址”。同一份数据根被几个运行位置共用时只扫一次，键按各自的运行位置给出。
 */
// The whole probe in one call (tests, the bench); Main runs the file work on
// the scan worker and only finishActivities() here.
function probeActivities(profiles, now = Date.now(), marks = null) {
  const baselineAt = marks && Number(marks.baselineAt) > 0 ? Number(marks.baselineAt) : 0;
  return finishActivities(profiles, probeRawActivities(profiles, now, baselineAt), marks);
}

// Restores the hidden fields packRawActivity() carried across the thread.
function unpackRawActivity(packed) {
  const raw = { ...(packed?.fields || {}) };
  Object.defineProperty(raw, 'writingAddresses', { value: Array.isArray(packed?.writingAddresses) ? packed.writingAddresses : [], enumerable: false });
  Object.defineProperty(raw, 'replies', { value: Array.isArray(packed?.replies) ? packed.replies : [], enumerable: false });
  return raw;
}

// The last step, in Main: which replies are new since this machine last looked.
// options.sessionCountOf(profile): the session index's count for the profile,
// or null when the index has not read it; with a count, the activity reports
// the same number as the list and the device page (the walk alone also counts
// files the list leaves out, such as Claude CLI sub-agent records).
function finishActivities(profiles, raws, marks = null, options = {}) {
  const baselineAt = marks && Number(marks.baselineAt) > 0 ? Number(marks.baselineAt) : 0;
  const seenAt = marks && typeof marks.seenAt === 'function' ? marks.seenAt : () => null;
  return profiles.map((profile, index) => {
    const raw = raws[index];
    const id = String(profile.id);
    const fresh = [];
    if (baselineAt > 0) {
      for (const reply of raw.replies || []) {
        const sessionKey = `${id}::${reply.address}`;
        const seen = Number(seenAt(sessionKey)) || 0;
        if (reply.at > seen && fresh.length < FRESH_KEYS_LIMIT) fresh.push({ key: sessionKey, at: reply.at });
      }
    }
    const replyApp = typeof apps.getApp(profile.appId).replyState === 'function' && baselineAt > 0;
    const indexed = typeof options.sessionCountOf === 'function' ? options.sessionCountOf(profile) : null;
    return {
      ...raw,
      ...(Number.isInteger(indexed) && indexed >= 0 ? { sessionCount: indexed } : {}),
      profileId: profile.id,
      writingKeys: (raw.writingAddresses || []).map((address) => `${id}::${address}`),
      freshReplies: replyApp ? fresh.length : null,
      freshKeys: fresh
    };
  });
}

module.exports = { probeActivity, probeActivities, probeRawActivities, finishActivities, packRawActivity, unpackRawActivity, WRITING_WINDOW_MS };
