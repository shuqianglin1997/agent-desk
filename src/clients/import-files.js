'use strict';

// Reading a dropped or chosen sign-in file: with a size limit, without following
// links, as UTF-8 JSON. Failures are fixed reason codes. Nothing here names a
// client; each client's ./<id>/import.js says which files it takes.

const fs = require('node:fs');
const path = require('node:path');

const MAX_FILE_BYTES = 256 * 1024;

class ImportError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function readSmallFile(filePath) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new ImportError('credential-file-unreadable');
  let descriptor;
  try {
    if (!fs.lstatSync(filePath).isFile()) throw new Error();
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) throw new Error();
    if (stat.size > MAX_FILE_BYTES) throw new ImportError('credential-file-size');
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const read = fs.readSync(descriptor, buffer, offset, buffer.length - offset, null);
      if (!read) break;
      offset += read;
    }
    if (offset > MAX_FILE_BYTES) throw new ImportError('credential-file-size');
    let bytes = buffer.subarray(0, offset);
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
    return Buffer.from(bytes);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError('credential-file-unreadable');
  } finally {
    if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch (_error) { /* closed */ }
  }
}

function utf8(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_error) { throw new ImportError('credential-file-format'); }
}

function json(bytes) {
  try { return JSON.parse(utf8(bytes)); } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError('credential-file-format');
  }
}

const present = (value) => typeof value === 'string' && value.trim().length > 0;

module.exports = { MAX_FILE_BYTES, ImportError, readSmallFile, utf8, json, present };
