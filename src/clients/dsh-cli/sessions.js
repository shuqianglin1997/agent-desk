'use strict';

// DSH sessions: <home>/sessions/--<cwd>--/<id>/session.vN.jsonl[.zstd].

const fs = require('node:fs');
const path = require('node:path');
const { MAX_FILES, iso, cleanTitle, safeStat, listDirectory, jsonLines, sortByRecency } = require('../cli-scan');

// $DSH_HOME/sessions/--<cwd>--/<id>/session.vN.jsonl[.zstd]: the highest
// generation wins. Line 1 is the header ({ type: "session", id, createdAt,
// cwd?, parentSession?, delegationDepth }); a session with a parent or a
// delegation depth is a child and is not listed. The title is the latest
// session/title event.
const MAX_DSH_LOG_BYTES = 32 * 1024 * 1024;

function dshLogFile(directory) {
  let best = null;
  for (const entry of listDirectory(directory)) {
    if (!entry.isFile()) continue;
    const match = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/.exec(entry.name);
    if (!match) continue;
    const version = match[1] ? Number(match[1]) : 0;
    if (!best || version > best.version) best = { version, file: path.join(directory, entry.name), compressed: Boolean(match[2]) };
  }
  return best;
}

// The length of one zstd frame starting at offset (RFC 8878 frame and block
// headers), so concatenated frames can be decoded one at a time: Node's
// zstdDecompressSync stops after the first frame.
function zstdFrameLength(bytes, offset) {
  if (offset + 8 > bytes.length) return 0;
  const magic = bytes.readUInt32LE(offset);
  if ((magic & 0xfffffff0) === 0x184d2a50) return 8 + bytes.readUInt32LE(offset + 4); // skippable frame
  if (magic !== 0xfd2fb528) return 0;
  let position = offset + 4;
  const descriptor = bytes[position++];
  const sizeFlag = descriptor >> 6;
  const singleSegment = (descriptor >> 5) & 1;
  const checksum = (descriptor >> 2) & 1;
  if (!singleSegment) position += 1;
  position += [0, 1, 2, 4][descriptor & 3];
  position += sizeFlag === 0 ? singleSegment : [0, 2, 4, 8][sizeFlag];
  for (;;) {
    if (position + 3 > bytes.length) return 0;
    const header = bytes[position] | (bytes[position + 1] << 8) | (bytes[position + 2] << 16);
    position += 3;
    const type = (header >> 1) & 3;
    if (type === 3) return 0;
    position += type === 1 ? 1 : header >>> 3;
    if (header & 1) break;
  }
  if (checksum) position += 4;
  return position <= bytes.length ? position - offset : 0;
}

function decodeZstdFrames(bytes) {
  const zlib = require('node:zlib');
  const parts = [];
  let total = 0;
  for (let offset = 0; offset < bytes.length;) {
    const length = zstdFrameLength(bytes, offset);
    if (!length) break; // a torn last frame contributes nothing, as in DSH itself
    if (bytes.readUInt32LE(offset) === 0xfd2fb528) {
      const frame = zlib.zstdDecompressSync(bytes.subarray(offset, offset + length), { maxOutputLength: 4 * MAX_DSH_LOG_BYTES });
      total += frame.length;
      if (total > 4 * MAX_DSH_LOG_BYTES) break;
      parts.push(frame);
    }
    offset += length;
  }
  return Buffer.concat(parts).toString('utf8');
}

function readDshLog(log) {
  const stat = safeStat(log.file);
  if (!stat?.isFile() || stat.size > MAX_DSH_LOG_BYTES) return null;
  try {
    const bytes = fs.readFileSync(log.file);
    return log.compressed ? decodeZstdFrames(bytes) : bytes.toString('utf8');
  } catch (_error) {
    return null;
  }
}

function dshTitle(record) {
  const value = record?.data?.title ?? record?.payload?.title ?? record?.title;
  return typeof value === 'string' ? value : '';
}

function scanDsh(profile) {
  const root = path.join(profile.sessionRoot, 'sessions');
  const records = new Map();
  let files = 0;
  for (const projectEntry of listDirectory(root)) {
    if (!projectEntry.isDirectory()) continue;
    for (const sessionEntry of listDirectory(path.join(root, projectEntry.name))) {
      if (!sessionEntry.isDirectory() || ++files > MAX_FILES) continue;
      const log = dshLogFile(path.join(root, projectEntry.name, sessionEntry.name));
      if (!log) continue;
      const lines = jsonLines(readDshLog(log));
      const header = lines[0];
      if (!header || header.type !== 'session' || typeof header.id !== 'string') continue;
      if (header.parentSession || Number(header.delegationDepth) > 0 || records.has(header.id)) continue;
      let title = '';
      for (const record of lines.slice(1)) if (record?.type === 'session/title' && dshTitle(record)) title = dshTitle(record);
      const stat = safeStat(log.file);
      const createdAt = iso(header.createdAt);
      records.set(header.id, {
        id: header.id,
        appId: 'dsh-cli',
        title: cleanTitle(title) || `DSH ${header.id.replace(/^session-/, '').slice(0, 8)}`,
        createdAt,
        updatedAt: stat?.mtime?.toISOString() || createdAt,
        projectPath: typeof header.cwd === 'string' ? header.cwd : null,
        source: 'DSH',
        status: '可用',
        model: null,
        filePath: log.file,
        address: header.id
      });
    }
  }
  return sortByRecency([...records.values()]);
}

module.exports = { scanDsh };
