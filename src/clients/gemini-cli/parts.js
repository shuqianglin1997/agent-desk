'use strict';

// The Gemini parts format, read in one place. Gemini CLI keeps a message's
// text in `content`; Qwen Code (a Gemini CLI fork) in `message.parts`. Either
// is a string, one part, a list of parts, or an object holding `parts`.
// Thought parts are the model's reasoning, never its answer or a title.

function partsText(value, separator = '\n') {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((part) => partsText(part, separator)).filter(Boolean).join(separator);
  if (value && typeof value === 'object') {
    if (value.thought === true) return '';
    if (typeof value.text === 'string') return value.text;
    if (Array.isArray(value.parts)) return partsText(value.parts, separator);
  }
  return '';
}

module.exports = { partsText };
