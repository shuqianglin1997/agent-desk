'use strict';

// AgentDesk — the one path comparison. "Is this path the same as, or inside,
// that one?" used to be written a dozen times with small differences; every
// caller now states those differences as options:
//   platform / pathApi   which path rules apply (default: this machine)
//   resolve (true)       make absolute first; false compares as given (normalised)
//   caseInsensitive      default: Windows rules fold case
//   trim, windowsExtended  Windows input clean-up (spaces, \\?\ prefixes)
// Only a real ".." step leaves a folder; a child named "..cache" is inside.

const fs = require('node:fs');
const path = require('node:path');

const WINDOWS = Object.freeze({ platform: 'win32', resolve: false, windowsExtended: true, trim: true });

function apiFor(options = {}) {
  if (options.pathApi) return options.pathApi;
  return (options.platform || process.platform) === 'win32' ? path.win32 : path.posix;
}

// The rule itself, for callers that already have a relative path.
function relativeStaysInside(relative, pathApi = path) {
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative));
}

function comparable(value, options = {}) {
  const api = apiFor(options);
  let text = String(value);
  if (options.trim) text = text.trim();
  if (options.windowsExtended) text = text.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
  let out = options.resolve === false ? api.normalize(text) : api.resolve(text);
  if (options.caseInsensitive ?? api === path.win32) out = out.toLowerCase();
  return out;
}

function isInside(child, parent, options = {}) {
  if (!child || !parent) return false;
  const api = apiFor(options);
  return relativeStaysInside(api.relative(comparable(parent, options), comparable(child, options)), api);
}

function samePath(left, right, options = {}) {
  if (!left || !right) return false;
  return comparable(left, options) === comparable(right, options);
}

// Same as samePath, after following symbolic links of paths that exist.
function samePathReal(left, right, options = {}) {
  const real = (value) => {
    try { return fs.realpathSync.native(value); } catch (_error) { return value; }
  };
  return samePath(real(left), real(right), options);
}

// This machine's rules, as the desktop app has always compared paths:
// Windows input clean-up and case folding there, absolute paths elsewhere.
const native = Object.freeze(process.platform === 'win32'
  ? { isInside: (child, parent) => isInside(child, parent, WINDOWS), samePath: (left, right) => samePath(left, right, WINDOWS) }
  : { isInside: (child, parent) => isInside(child, parent), samePath: (left, right) => samePath(left, right) });

module.exports = { WINDOWS, relativeStaysInside, comparable, isInside, samePath, samePathReal, native };
