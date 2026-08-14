'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');

const MAX_ANNOTATIONS = 20;
const MAX_NAME_LENGTH = 180;

function sanitizeFailureName(value) {
  let text = String(value || 'Unnamed failed test').slice(0, 2048);
  text = text
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    // Prefer fail-closed redaction over preserving prose after a path. A path
    // may legally contain whitespace and punctuation, so once an absolute path
    // begins the rest of this untrusted test name is discarded.
    .replace(/file:\/\/\/.*$/gi, '<path>')
    .replace(/\\\\.*$/g, '<path>')
    .replace(/\b[A-Za-z]:[\\/].*$/g, '<path>')
    .replace(/(^|[\s("'=])\/.*$/g, '$1<path>')
    .replace(
      /\bauthorization\s*[:=]\s*(?:(?:bearer|basic)\s+)?(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
      'Authorization=<redacted>'
    )
    .replace(/\bbearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <redacted>')
    .replace(
      /\b(token|secret|password|passwd|api[-_]?key|private[-_]?key|client[-_]?secret|access[-_]?token|refresh[-_]?token|session[-_]?token|auth[-_]?token|gh[-_]?token|github[-_]?token|aws[-_]?(?:session[-_]?token|secret[-_]?access[-_]?key|access[-_]?key[-_]?id))\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
      '$1=<redacted>'
    )
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '<redacted>')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '<redacted>')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) text = 'Unnamed failed test';
  if (text.length > MAX_NAME_LENGTH) {
    text = `${text.slice(0, MAX_NAME_LENGTH - 1)}…`;
  }
  return text;
}

function escapeWorkflowCommandData(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}

function safeFileLabel(value) {
  let text = String(value || '').trim();
  if (!text || /[\u0000-\u001f\u007f]/.test(text)) return null;
  if (/^file:/i.test(text)) {
    try {
      text = fileURLToPath(text);
    } catch (_error) {
      return null;
    }
  }
  if (/^[A-Za-z]:[\\/]/.test(text) || /^\\\\/.test(text)) {
    const normalized = text.replace(/\//g, '\\');
    if (!path.win32.isAbsolute(normalized)) return null;
    return sanitizeFailureName(path.win32.basename(normalized));
  }
  if (!path.posix.isAbsolute(text)) return null;
  return sanitizeFailureName(path.posix.basename(text));
}

function failureDisplayName(data) {
  const fileLabel = safeFileLabel(data?.file);
  const testName = String(data?.name || 'Unnamed failed test');
  return sanitizeFailureName(fileLabel ? `${fileLabel} › ${testName}` : testName);
}

module.exports = async function* windowsTestAnnotations(source) {
  let emitted = 0;
  let omitted = 0;

  for await (const event of source) {
    const data = event?.data;
    if (event?.type !== 'test:fail') continue;
    if (data?.details?.error?.failureType === 'subtestsFailed') continue;

    if (emitted >= MAX_ANNOTATIONS) {
      omitted += 1;
      continue;
    }
    emitted += 1;
    const name = failureDisplayName(data || {});
    yield `::error title=Windows Node test failed::${escapeWorkflowCommandData(name)}\n`;
  }

  if (omitted > 0) {
    yield `::error title=Windows Node tests failed::${omitted} additional failure annotation(s) omitted; see the spec output.\n`;
  }
};

module.exports.escapeWorkflowCommandData = escapeWorkflowCommandData;
module.exports.failureDisplayName = failureDisplayName;
module.exports.sanitizeFailureName = sanitizeFailureName;
