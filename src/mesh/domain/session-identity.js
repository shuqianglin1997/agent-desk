'use strict';

function stableText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function hasSubagentSource(source) {
  return Boolean(
    source
    && typeof source === 'object'
    && Object.prototype.hasOwnProperty.call(source, 'subagent')
  );
}

/**
 * Classify one Codex session_meta payload without reading or mutating its file.
 *
 * A physical rollout id is not necessarily the user-visible conversation id:
 * guardian/subagent rollouts point back to their user root and remain hidden
 * from the default conversation list.
 */
function classifyCodexSessionMeta(payload = {}, fallbackPhysicalRecordId = null) {
  const physicalRecordId = stableText(payload.id) || stableText(fallbackPhysicalRecordId);
  const providerSessionKey = stableText(payload.session_id);
  const explicitParentKey = stableText(payload.parent_thread_id);
  const threadSource = stableText(payload.thread_source);
  const internal = Boolean(
    explicitParentKey
    || threadSource === 'subagent'
    || hasSubagentSource(payload.source)
  );
  const parentConversationKey = internal
    ? (explicitParentKey || providerSessionKey)
    : null;
  const adapterConversationKey = internal
    ? parentConversationKey
    : (providerSessionKey || physicalRecordId);

  return {
    recordKind: internal ? 'internal-child' : 'conversation-root',
    physicalRecordId,
    adapterConversationKey,
    parentConversationKey
  };
}

module.exports = {
  classifyCodexSessionMeta,
  hasSubagentSource,
  stableText
};
