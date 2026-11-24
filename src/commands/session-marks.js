'use strict';

// AgentDesk — colour tags and "seen" marks on sessions (docs/SESSION_MARKS_PLAN.md).
// Only session keys, tag numbers and bounded names cross; never paths. Bodies
// moved from main.js registerIpc unchanged.

const COMMANDS = [
  {
    id: 'sessionMarks.get',
    channel: 'sessionMarks:get',
    preload: ['getSessionMarks'],
    exec(deps) {
      const { sessionMarksResult } = deps;
      return sessionMarksResult((store) => store.snapshot());
    }
  },
  {
    id: 'sessionMarks.setTag',
    channel: 'sessionMarks:setTag',
    preload: ['setSessionTag'],
    exec(deps, input = {}) {
      const { sessionMarksResult } = deps;
      return sessionMarksResult((store) => (
        store.setTag(Array.isArray(input?.keys) ? input.keys : null, input?.tag)
      ));
    }
  },
  {
    id: 'sessionMarks.markSeen',
    channel: 'sessionMarks:markSeen',
    preload: ['markSessionsSeen'],
    exec(deps, input = {}) {
      const { sessionMarksResult } = deps;
      return sessionMarksResult((store) => (
        store.markSeen(Array.isArray(input?.entries)
          ? input.entries.slice(0, 5001).map((item) => ({ key: item?.key, at: item?.at }))
          : null)
      ));
    }
  },
  {
    id: 'sessionMarks.rename',
    channel: 'sessionMarks:rename',
    preload: ['renameSessionTag'],
    exec(deps, input = {}) {
      const { sessionMarksResult } = deps;
      return sessionMarksResult((store) => (
        store.rename(input?.tag, typeof input?.name === 'string' || input?.name === null ? input.name : undefined)
      ));
    }
  }
];

module.exports = { COMMANDS };
