'use strict';

// Kimi Code: copying a dropped or chosen sign-in file into a new isolated home
// (see src/credential-import.js for the rules every client follows).

const fs = require('node:fs');
const path = require('node:path');
const { MAX_FILE_BYTES, ImportError, readSmallFile, utf8, json, present } = require('../import-files');
const { splitLines, writePrivateFile, ensurePrivateDirectory } = require('../credential-files');

const KIMI_MANAGED_PROVIDER = 'managed:kimi-code';

// Kimi Code's login is credentials/kimi-code.json plus the provider and model
// entries that point at it. Only those entries are carried over.
function kimiConfigSection(sourceHome) {
  let text = null;
  try {
    const file = path.join(sourceHome, 'config.toml');
    const stat = fs.lstatSync(file);
    if (stat.isFile() && stat.size <= MAX_FILE_BYTES) text = fs.readFileSync(file, 'utf8');
  } catch (_error) { /* no config next to it */ }
  const fallback = [
    `[providers.${JSON.stringify(KIMI_MANAGED_PROVIDER)}]`,
    'type = "kimi"',
    'base_url = "https://api.kimi.com/coding/v1"',
    'api_key = ""',
    'oauth = { storage = "file", key = "oauth/kimi-code" }'
  ];
  if (text === null) return { lines: fallback, complete: false };
  const lines = splitLines(text);
  const blocks = [];
  let current = { header: null, lines: [] };
  for (const line of lines) {
    if (/^\s*\[/.test(line)) {
      blocks.push(current);
      current = { header: line.trim(), lines: [line] };
    } else current.lines.push(line);
  }
  blocks.push(current);
  const name = (header) => (header || '').replace(/^\[+|\]+$/g, '').split('.').map((part) => part.trim().replace(/^"(.*)"$/, '$1')).join('.');
  const kept = [];
  const aliases = new Set();
  for (const block of blocks.slice(1)) {
    const header = name(block.header);
    if (header === `providers.${KIMI_MANAGED_PROVIDER}` || header.startsWith(`providers.${KIMI_MANAGED_PROVIDER}.`)) {
      // Never carry an inline key: the managed provider signs in through OAuth.
      kept.push(...block.lines.filter((line) => !/^\s*api_key\s*=/.test(line) || /=\s*""\s*$/.test(line)));
    } else if (header.startsWith('models.') && block.lines.some((line) => new RegExp(`^\\s*provider\\s*=\\s*"${KIMI_MANAGED_PROVIDER}"`).test(line))) {
      aliases.add(header.slice('models.'.length));
      kept.push(...block.lines);
    }
  }
  if (!kept.some((line) => line.includes(KIMI_MANAGED_PROVIDER))) return { lines: fallback, complete: false };
  const top = [];
  const defaultLine = blocks[0].lines.find((line) => /^\s*default_model\s*=/.test(line));
  const defaultAlias = defaultLine && /=\s*"([^"]+)"/.exec(defaultLine)?.[1];
  if (defaultAlias && aliases.has(defaultAlias)) top.push(defaultLine.trim(), '');
  return { lines: [...top, ...kept], complete: true };
}

module.exports = {
  fileNames: Object.freeze(['kimi-code.json']),
  // A source home without the managed provider's config gets a minimal one.
  warningsFor: (payload) => (payload.config?.complete === false ? ['kimi-config-minimal'] : []),
  accepts: (fileName) => fileName === 'kimi-code.json',
  read(filePath) {
    const bytes = readSmallFile(filePath);
    const value = json(bytes);
    if (!present(value?.access_token) || typeof value.refresh_token !== 'string') throw new ImportError('credential-file-format');
    const home = path.basename(path.dirname(filePath)) === 'credentials' ? path.dirname(path.dirname(filePath)) : null;
    return { bytes, config: kimiConfigSection(home || path.dirname(filePath)) };
  },
  sourceHome: (filePath) => (path.basename(path.dirname(filePath)) === 'credentials' ? path.dirname(path.dirname(filePath)) : null),
  stage(profile, payload) {
    ensurePrivateDirectory(path.join(profile.sessionRoot, 'credentials'));
    writePrivateFile(path.join(profile.sessionRoot, 'credentials', 'kimi-code.json'), payload.bytes);
    writePrivateFile(path.join(profile.sessionRoot, 'config.toml'), `${payload.config.lines.join('\n')}\n`);
  },
  stagedFile: (profile) => path.join(profile.sessionRoot, 'credentials', 'kimi-code.json'),
  kimiConfigSection
};
