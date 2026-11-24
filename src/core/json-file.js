'use strict';

// AgentDesk — reading JSON safely, writing files atomically, and small
// versioned stores. One implementation of each for every module.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ok, fail } = require('./result');

/** @typedef {{ maxBytes?: number, stripBom?: boolean, validate?: (value: any) => boolean }} ReadJsonOptions */
/**
 * @typedef {object} AtomicWriteOptions
 * @property {number} [mode]
 * @property {boolean} [fsync]
 * @property {string | null} [backupFile]
 * @property {boolean} [createDirectory]
 * @property {boolean} [copyIfRenameFails]
 * @property {boolean} [chmod]
 */
/**
 * @typedef {object} VersionedStoreDefinition
 * @property {string} file
 * @property {number} version
 * @property {() => any} [defaults]
 * @property {(value: any) => boolean} [validate]
 * @property {{ from: number, up: (value: any) => any }[]} [migrations]
 * @property {number} [mode]
 * @property {number} [maxBytes]
 * @property {string | null} [backupFile]
 */

// Read and parse a JSON file. Result codes: missing, not-a-file, too-large,
// unreadable, invalid-json, invalid-shape. Options:
//   maxBytes   reject larger files (checked with stat first)
//   stripBom   drop a leading byte-order mark
//   validate   (value) => boolean
/**
 * @param {string} filePath
 * @param {ReadJsonOptions} [options]
 * @returns {import('./result').Result<any>}
 */
function readJsonFile(filePath, options = {}) {
  try {
    if (Number.isFinite(options.maxBytes)) {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return fail('not-a-file');
      if (stat.size > /** @type {number} */ (options.maxBytes)) return fail('too-large');
    }
    let text = fs.readFileSync(filePath, 'utf8');
    if (options.stripBom) text = text.replace(/^﻿/, '');
    let value;
    try { value = JSON.parse(text); } catch (_error) { return fail('invalid-json'); }
    if (options.validate && !options.validate(value)) return fail('invalid-shape');
    return ok(value);
  } catch (error) {
    if (error?.code === 'ENOENT') return fail('missing');
    if (error?.code === 'EISDIR') return fail('not-a-file');
    return fail('unreadable');
  }
}

// The parsed value, or null when the read failed for any reason.
/**
 * @param {string} filePath
 * @param {ReadJsonOptions} [options]
 * @returns {any}
 */
function readJson(filePath, options = {}) {
  const result = readJsonFile(filePath, options);
  return result.ok ? result.value : null;
}

// Write a complete file next to the target, flush it, then rename it into
// place, so a reader sees the old file or the new one, never half of one.
//   mode (0o600)        permissions of the new file from its first byte
//   fsync (true)        flush before the rename
//   backupFile          copy the current file here just before replacing it
//   createDirectory     create the parent folder when missing (off by default)
//   copyIfRenameFails   fall back to copying over the target (Windows may
//                       refuse a rename over an existing file)
//   chmod               set mode again after the rename (not on Windows)
/**
 * @param {string} filePath
 * @param {string | NodeJS.ArrayBufferView} data
 * @param {AtomicWriteOptions} [options]
 */
function writeFileAtomic(filePath, data, options = {}) {
  const mode = options.mode ?? 0o600;
  const directory = path.dirname(filePath);
  if (options.createDirectory) fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', mode);
    fs.writeFileSync(descriptor, data);
    if (options.fsync !== false) fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    if (options.backupFile && fs.existsSync(filePath)) {
      try { fs.copyFileSync(filePath, options.backupFile); } catch (_error) { /* the complete temp file still protects this write */ }
    }
    try {
      fs.renameSync(temporary, filePath);
    } catch (error) {
      if (!options.copyIfRenameFails) throw error;
      fs.copyFileSync(temporary, filePath);
    }
    if (options.chmod && process.platform !== 'win32') fs.chmodSync(filePath, mode);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch (_error) { /* already closed */ }
    }
    try { fs.rmSync(temporary, { force: true }); } catch (_error) { /* already renamed or removed */ }
  }
}

// The same write without blocking the main process, for large files such as
// session exports. Options: mode (0o600), fsync (true). The parent folder must
// exist; a failure leaves the target as it was and no temporary file.
/**
 * @param {string} filePath
 * @param {string | NodeJS.ArrayBufferView} data
 * @param {{ mode?: number, fsync?: boolean }} [options]
 */
async function writeFileAtomicAsync(filePath, data, options = {}) {
  const mode = options.mode ?? 0o600;
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  let handle;
  try {
    handle = await fs.promises.open(temporary, 'wx', mode);
    await handle.writeFile(data);
    if (options.fsync !== false) await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.promises.rename(temporary, filePath);
  } finally {
    if (handle) await handle.close().catch(() => {});
    await fs.promises.rm(temporary, { force: true }).catch(() => {});
  }
}

/**
 * @param {string} filePath
 * @param {unknown} value
 * @param {AtomicWriteOptions} [options]
 */
function writeJsonAtomic(filePath, value, options = {}) {
  writeFileAtomic(filePath, JSON.stringify(value, null, 2), options);
}

// A small JSON file with a version number and ordered migrations, for stores
// such as settings, ledgers and records of what was open:
//   const store = createVersionedStore({ file, version: 3, defaults: () => ({}),
//     validate: (value) => ..., migrations: [{ from: 2, up: (value) => next }] })
//   store.load()  -> ok({ value, version, migrated, newer }) | fail(code)
//   store.save(value)
// The file holds { version, data }. A missing file loads the defaults. A file
// from a newer build is returned untouched with newer: true and is not
// migrated; save() refuses to overwrite it. Migrations run in order from the
// file's version up to `version`; each must keep every field it does not own.
/** @param {VersionedStoreDefinition} definition */
function createVersionedStore(definition) {
  const { file, version } = definition;
  if (!file || !Number.isInteger(version) || version < 1) throw new TypeError('versioned-store-definition');
  const migrations = [...(definition.migrations || [])].sort((a, b) => a.from - b.from);
  const defaults = definition.defaults || (() => ({}));
  const validate = definition.validate || (() => true);
  const writeOptions = { mode: definition.mode ?? 0o600, createDirectory: true, copyIfRenameFails: true, backupFile: definition.backupFile || null };
  let newerOnDisk = false;

  function load() {
    const read = readJsonFile(file, { maxBytes: definition.maxBytes ?? 16 * 1024 * 1024 });
    if (!read.ok) {
      if (read.code === 'missing') return ok({ value: defaults(), version, migrated: false, newer: false });
      return read;
    }
    const raw = read.value;
    if (!raw || typeof raw !== 'object' || !Number.isInteger(raw.version) || !('data' in raw)) return fail('invalid-shape');
    if (raw.version > version) {
      newerOnDisk = true;
      return ok({ value: raw.data, version: raw.version, migrated: false, newer: true });
    }
    newerOnDisk = false;
    let value = raw.data;
    let current = raw.version;
    for (const migration of migrations) {
      if (migration.from !== current) continue;
      value = migration.up(value);
      current = migration.from + 1;
    }
    if (current !== version) return fail('migration-missing');
    if (!validate(value)) return fail('invalid-shape');
    return ok({ value, version, migrated: raw.version !== version, newer: false });
  }

  /** @param {any} value */
  function save(value) {
    if (newerOnDisk) throw new Error('versioned-store-newer-on-disk');
    if (!validate(value)) throw new TypeError('versioned-store-invalid');
    writeJsonAtomic(file, { version, data: value }, writeOptions);
  }

  return { file, version, load, save };
}

module.exports = { readJsonFile, readJson, writeFileAtomic, writeFileAtomicAsync, writeJsonAtomic, createVersionedStore };
