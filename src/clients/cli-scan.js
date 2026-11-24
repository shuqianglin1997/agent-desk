'use strict';

// Helpers the command-line clients' scanners share: bounded reads of text,
// JSON and JSON lines, folder listings, dates, titles. Nothing here names a
// client. Every reader is bounded and best-effort: a broken file or table is
// skipped, never repaired.

const fs = require('node:fs');
const coreJson = require('../core/json-file');

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 5000;
const MAX_FILES = 4000;

function iso(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  const date = Number.isFinite(number) && String(value).trim() !== ''
    ? new Date(number > 10_000_000_000 ? number : number * 1000)
    : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function cleanTitle(value, limit = 120) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function safeStat(filePath) {
  try { return fs.statSync(filePath); } catch (_error) { return null; }
}

function listDirectory(directory) {
  try { return fs.readdirSync(directory, { withFileTypes: true }); } catch (_error) { return []; }
}

function readText(filePath, limit = MAX_FILE_BYTES) {
  const stat = safeStat(filePath);
  if (!stat?.isFile()) return null;
  try {
    if (stat.size <= limit) return fs.readFileSync(filePath, 'utf8');
    const descriptor = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(limit);
      const read = fs.readSync(descriptor, buffer, 0, limit, 0);
      return buffer.subarray(0, read).toString('utf8');
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (_error) {
    return null;
  }
}

function readJson(filePath, limit = MAX_FILE_BYTES) {
  return coreJson.readJson(filePath, { maxBytes: limit });
}

function jsonLines(text) {
  const records = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch (_error) { /* half-written line */ }
  }
  return records;
}

function sortByRecency(records) {
  return records.sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
}

module.exports = { MAX_FILE_BYTES, MAX_ROWS, MAX_FILES, iso, cleanTitle, safeStat, listDirectory, readText, readJson, jsonLines, sortByRecency };
