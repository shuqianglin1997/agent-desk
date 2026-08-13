const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { Transform } = require('node:stream');
const { classifyCodexSessionMeta } = require('../mesh/domain/session-identity');
const { extractTaskPackageEntry } = require('./format');

const CODEX_TASK_ADAPTER_ID = 'codex-rollout-jsonl';
const CODEX_TASK_ADAPTER_VERSION = 1;
const MAX_DISCOVERED_RECORDS = 12_000;
const MAX_SNAPSHOT_ATTEMPTS = 3;
const MAX_JSONL_LINE_BYTES = 64 * 1024 * 1024;

async function captureCodexTaskSession(input = {}) {
  const profile = input.profile;
  const session = input.session;
  if (!profile || profile.appId !== 'codex') throw new Error('task-package-codex-profile');
  if (!session?.filePath || !session?.id) throw new Error('task-package-session-missing');
  const stagingRoot = requiredDirectory(input.stagingRoot);
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });
  const sessionRoot = fs.realpathSync(path.resolve(profile.sessionRoot));
  const sourcePath = trustedCodexRecordPath(session.filePath, sessionRoot);
  const rootSnapshot = path.join(stagingRoot, 'root.jsonl');
  await snapshotAppendOnlyJsonl(sourcePath, rootSnapshot);
  const rootIdentity = await validateCodexJsonl(rootSnapshot);
  if (rootIdentity.recordKind !== 'conversation-root' || rootIdentity.adapterConversationKey !== String(session.id)) {
    throw new Error('task-package-codex-root-identity');
  }

  const rootEntryId = 'session-root';
  const entries = [{
    entryId: rootEntryId,
    kind: 'native-session-root',
    name: 'native/codex/root.jsonl',
    sourcePath: rootSnapshot,
    metadata: recordMetadata(sourcePath, sessionRoot, rootIdentity)
  }];
  const childEntryIds = [];
  const physicalRecordIds = new Set([rootIdentity.physicalRecordId].filter(Boolean));
  const children = discoverCodexChildren(sessionRoot, session.id, sourcePath);
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const childEntryId = `session-child-${index + 1}`;
    const childSnapshot = path.join(stagingRoot, `child-${index + 1}.jsonl`);
    await snapshotAppendOnlyJsonl(child.filePath, childSnapshot);
    const identity = await validateCodexJsonl(childSnapshot);
    if (identity.recordKind !== 'internal-child' || identity.parentConversationKey !== String(session.id)) {
      throw new Error('task-package-codex-child-identity');
    }
    if (identity.physicalRecordId && physicalRecordIds.has(identity.physicalRecordId)) {
      throw new Error('task-package-native-record-duplicate');
    }
    if (identity.physicalRecordId) physicalRecordIds.add(identity.physicalRecordId);
    entries.push({
      entryId: childEntryId,
      kind: 'native-session-child',
      name: `native/codex/children/${String(index + 1).padStart(4, '0')}.jsonl`,
      sourcePath: childSnapshot,
      metadata: recordMetadata(child.filePath, sessionRoot, identity)
    });
    childEntryIds.push(childEntryId);
  }

  return {
    adapterId: CODEX_TASK_ADAPTER_ID,
    adapterVersion: CODEX_TASK_ADAPTER_VERSION,
    mode: 'native',
    contentEntryId: rootEntryId,
    childEntryIds,
    entries
  };
}

async function importCodexTaskSession(input = {}) {
  const profile = input.profile;
  const manifest = input.manifest;
  const archive = input.archive;
  if (!profile || profile.appId !== 'codex') throw new Error('task-package-target-not-codex');
  if (manifest?.session?.mode !== 'native'
    || manifest.session.adapterId !== CODEX_TASK_ADAPTER_ID
    || manifest.session.adapterVersion !== CODEX_TASK_ADAPTER_VERSION) {
    throw new Error('task-package-native-adapter-unsupported');
  }
  if (!archive?.plainPath || !Array.isArray(archive.entries)) throw new Error('task-package-archive-missing');
  const sessionRoot = path.resolve(profile.sessionRoot);
  const stagingRoot = requiredDirectory(input.stagingRoot);
  fs.mkdirSync(stagingRoot, { recursive: true, mode: 0o700 });

  const entryIds = [manifest.session.contentEntryId, ...(manifest.session.childEntryIds || [])];
  const staged = [];
  const stagedPhysicalIds = new Set();
  for (const entryId of entryIds) {
    const entry = archive.entries.find((item) => item.entryId === entryId);
    if (!entry) throw new Error('task-package-native-entry-missing');
    const target = path.join(stagingRoot, `${entry.index}-${entry.kind}.jsonl`);
    await extractTaskPackageEntry({
      plainPath: archive.plainPath,
      entry,
      destinationPath: target
    });
    const identity = await validateCodexJsonl(target);
    if (entry.kind === 'native-session-root') {
      if (identity.recordKind !== 'conversation-root' || identity.adapterConversationKey !== manifest.session.sessionId) {
        throw new Error('task-package-native-root-mismatch');
      }
    } else if (entry.kind === 'native-session-child') {
      if (identity.recordKind !== 'internal-child' || identity.parentConversationKey !== manifest.session.sessionId) {
        throw new Error('task-package-native-child-mismatch');
      }
    } else {
      throw new Error('task-package-native-entry-kind');
    }
    if (stagedPhysicalIds.has(identity.physicalRecordId)) {
      throw new Error('task-package-native-record-duplicate');
    }
    stagedPhysicalIds.add(identity.physicalRecordId);
    staged.push({ entry, target, identity });
  }

  const existing = findCodexConversationRecords(sessionRoot, manifest.session.sessionId);
  const rootItem = staged.find((item) => item.entry.kind === 'native-session-root');
  const createdFiles = [];
  for (const root of existing.roots) {
    const existingHash = await hashFile(root.filePath);
    if (existingHash !== rootItem.entry.sha256) throw new Error('task-package-session-conflict');
  }
  const existingChildrenByPhysicalId = new Map();
  for (const child of existing.children) {
    const physicalId = child.identity.physicalRecordId;
    if (physicalId && !existingChildrenByPhysicalId.has(physicalId)) {
      existingChildrenByPhysicalId.set(physicalId, child);
    }
  }

  const plannedDestinations = new Set();
  const plans = staged.map((item) => {
    if (item.entry.kind === 'native-session-root' && existing.root) return { ...item, destination: existing.root.filePath, skip: true };
    const existingChild = item.entry.kind === 'native-session-child'
      ? existingChildrenByPhysicalId.get(item.identity.physicalRecordId)
      : null;
    if (existingChild) return { ...item, destination: existingChild.filePath, skip: true, verifyExisting: true };
    const datePath = normalizedRecordDate(item.entry.metadata?.relativeDate, manifest.createdAt);
    const originalName = safeFileName(item.entry.metadata?.originalFileName || `${item.identity.physicalRecordId}.jsonl`);
    const destinationDirectory = path.join(sessionRoot, 'sessions', ...datePath.split('/'));
    const destination = collisionSafeRecordPath(
      destinationDirectory,
      originalName,
      item.identity.physicalRecordId,
      plannedDestinations
    );
    plannedDestinations.add(path.resolve(destination));
    return {
      ...item,
      destination,
      skip: false
    };
  });

  for (const plan of plans) {
    if (plan.skip && !plan.verifyExisting) continue;
    if (!fs.existsSync(plan.destination)) {
      if (plan.skip) throw new Error('task-package-session-file-conflict');
      continue;
    }
    const destinationHash = await hashFile(plan.destination);
    if (destinationHash === plan.entry.sha256) {
      plan.skip = true;
      continue;
    }
    throw new Error('task-package-session-file-conflict');
  }

  try {
    for (const plan of plans) {
      if (plan.skip) continue;
      fs.mkdirSync(path.dirname(plan.destination), { recursive: true });
      fs.copyFileSync(plan.target, plan.destination, fs.constants.COPYFILE_EXCL);
      try { fs.chmodSync(plan.destination, 0o600); } catch (_error) { /* Windows/best effort */ }
      createdFiles.push(plan.destination);
    }
    const title = importedConversationTitle(manifest);
    appendCodexTitle(sessionRoot, manifest.session.sessionId, title, input.now || new Date().toISOString());
    return {
      imported: true,
      idempotent: plans.every((plan) => plan.skip),
      sessionId: manifest.session.sessionId,
      title,
      rootPath: plans.find((plan) => plan.entry.kind === 'native-session-root')?.destination || null,
      createdFiles
    };
  } catch (error) {
    for (const filePath of createdFiles.reverse()) {
      try { fs.unlinkSync(filePath); } catch (_unlinkError) { /* exact rollback best effort */ }
    }
    throw error;
  }
}

async function snapshotAppendOnlyJsonl(sourcePath, destinationPath) {
  for (let attempt = 0; attempt < MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
    const source = fs.openSync(sourcePath, 'r');
    let before;
    let length;
    try {
      before = fs.fstatSync(source);
      if (!before.isFile() || before.size <= 0) throw new Error('task-package-session-empty');
      length = coherentJsonlLength(source, before.size);
      if (length <= 0) throw new Error('task-package-session-no-complete-record');
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true, mode: 0o700 });
      const target = fs.openSync(destinationPath, 'w', 0o600);
      const copiedHash = crypto.createHash('sha256');
      try {
        const buffer = Buffer.alloc(1024 * 1024);
        let offset = 0;
        while (offset < length) {
          const bytes = fs.readSync(source, buffer, 0, Math.min(buffer.length, length - offset), offset);
          if (!bytes) throw new Error('task-package-session-short-read');
          fs.writeSync(target, buffer, 0, bytes);
          copiedHash.update(buffer.subarray(0, bytes));
          offset += bytes;
        }
        fs.fsyncSync(target);
      } finally {
        fs.closeSync(target);
      }
      const after = fs.statSync(sourcePath);
      const currentPrefixHash = hashFilePrefix(source, length);
      const final = fs.statSync(sourcePath);
      if (
        before.dev === after.dev
        && before.ino === after.ino
        && after.dev === final.dev
        && after.ino === final.ino
        && after.size >= length
        && final.size >= length
        && copiedHash.digest('hex') === currentPrefixHash
      ) {
        await validateCodexJsonl(destinationPath);
        return { bytes: length };
      }
    } finally {
      fs.closeSync(source);
    }
    try { fs.unlinkSync(destinationPath); } catch (_error) { /* retry */ }
  }
  throw new Error('task-package-session-changing');
}

function coherentJsonlLength(fd, size) {
  const tailLength = Math.min(256 * 1024, size);
  const tail = Buffer.alloc(tailLength);
  fs.readSync(fd, tail, 0, tailLength, size - tailLength);
  if (tail[tail.length - 1] === 0x0a) return size;
  const lastNewline = tail.lastIndexOf(0x0a);
  const suffix = tail.subarray(lastNewline + 1).toString('utf8').trim();
  if (suffix) {
    try {
      JSON.parse(suffix);
      return size;
    } catch (_error) {
      // A live writer may have left a partial final record; use the last full line.
    }
  }
  return lastNewline >= 0 ? (size - tailLength + lastNewline + 1) : 0;
}

function hashFilePrefix(fd, length) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.alloc(1024 * 1024);
  let offset = 0;
  while (offset < length) {
    const bytes = fs.readSync(fd, buffer, 0, Math.min(buffer.length, length - offset), offset);
    if (!bytes) throw new Error('task-package-session-short-read');
    hash.update(buffer.subarray(0, bytes));
    offset += bytes;
  }
  return hash.digest('hex');
}

async function validateCodexJsonl(filePath) {
  let first = null;
  let count = 0;
  const stream = fs.createReadStream(filePath);
  const bounded = createJsonlLineLimiter();
  stream.on('error', (error) => bounded.destroy(error));
  stream.pipe(bounded);
  const lines = readline.createInterface({ input: bounded, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch (_error) {
        throw new Error('task-package-session-jsonl-invalid');
      }
      if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') {
        throw new Error('task-package-session-jsonl-invalid');
      }
      if (!first) first = event;
      count += 1;
    }
  } finally {
    lines.close();
    bounded.destroy();
    stream.destroy();
  }
  if (!first || !count) throw new Error('task-package-session-jsonl-empty');
  if (first.type !== 'session_meta' || !first.payload || typeof first.payload !== 'object' || Array.isArray(first.payload)) {
    throw new Error('task-package-session-meta-invalid');
  }
  const payload = first.payload || {};
  const fallback = uuidFromFilename(filePath) || path.basename(filePath, '.jsonl');
  return classifyCodexSessionMeta(payload, fallback);
}

function createJsonlLineLimiter() {
  let lineBytes = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      for (let index = 0; index < chunk.length; index += 1) {
        if (chunk[index] === 0x0a) {
          lineBytes = 0;
          continue;
        }
        lineBytes += 1;
        if (lineBytes > MAX_JSONL_LINE_BYTES) {
          callback(new Error('task-package-session-jsonl-line-too-large'));
          return;
        }
      }
      callback(null, chunk);
    }
  });
}

function discoverCodexChildren(sessionRoot, conversationId, excludePath) {
  const output = [];
  for (const base of ['sessions', 'archived_sessions']) {
    for (const filePath of walkJsonl(path.join(sessionRoot, base))) {
      if (path.resolve(filePath) === path.resolve(excludePath)) continue;
      const identity = readCodexIdentity(filePath);
      if (identity?.recordKind === 'internal-child' && identity.parentConversationKey === String(conversationId)) {
        output.push({ filePath, identity });
      }
    }
  }
  return output.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function findCodexConversationRecords(sessionRoot, conversationId) {
  const result = { root: null, roots: [], children: [] };
  for (const base of ['sessions', 'archived_sessions']) {
    for (const filePath of walkJsonl(path.join(sessionRoot, base))) {
      const identity = readCodexIdentity(filePath);
      if (!identity) continue;
      if (identity.recordKind === 'conversation-root' && identity.adapterConversationKey === String(conversationId)) {
        const root = { filePath, identity };
        result.roots.push(root);
        if (!result.root) result.root = root;
      } else if (identity.recordKind === 'internal-child' && identity.parentConversationKey === String(conversationId)) {
        result.children.push({ filePath, identity });
      }
    }
  }
  return result;
}

function readCodexIdentity(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(64 * 1024);
    const bytes = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const line = buffer.subarray(0, bytes).toString('utf8').split(/\r?\n/, 1)[0];
    if (!line) return null;
    const first = JSON.parse(line);
    if (
      !first
      || typeof first !== 'object'
      || Array.isArray(first)
      || first.type !== 'session_meta'
      || !first.payload
      || typeof first.payload !== 'object'
      || Array.isArray(first.payload)
    ) return null;
    return classifyCodexSessionMeta(first.payload || {}, uuidFromFilename(filePath) || path.basename(filePath, '.jsonl'));
  } catch (_error) {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_error) { /* best effort */ }
  }
}

function walkJsonl(root) {
  const output = [];
  if (!fs.existsSync(root)) return output;
  const pending = [root];
  let scanned = 0;
  while (pending.length) {
    const current = pending.pop();
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch (_error) { continue; }
    for (const entry of entries) {
      scanned += 1;
      if (scanned > MAX_DISCOVERED_RECORDS) throw new Error('task-package-codex-record-limit');
      const itemPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(itemPath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) output.push(itemPath);
    }
  }
  return output;
}

function trustedCodexRecordPath(filePath, sessionRoot) {
  const absolute = path.resolve(String(filePath || ''));
  const real = fs.realpathSync(absolute);
  const allowed = ['sessions', 'archived_sessions'].some((base) => isWithin(real, path.join(sessionRoot, base)));
  const stat = fs.lstatSync(real);
  if (!allowed || !stat.isFile() || stat.isSymbolicLink() || !real.endsWith('.jsonl')) {
    throw new Error('task-package-session-path-untrusted');
  }
  return real;
}

function recordMetadata(filePath, sessionRoot, identity) {
  const relative = path.relative(sessionRoot, filePath).split(path.sep);
  const bucketIndex = relative[0] === 'sessions' || relative[0] === 'archived_sessions' ? 1 : -1;
  const date = bucketIndex >= 0 && relative.length >= 4
    ? relative.slice(bucketIndex, bucketIndex + 3).join('/')
    : null;
  return {
    originalFileName: safeFileName(path.basename(filePath)),
    relativeDate: /^\d{4}\/\d{2}\/\d{2}$/.test(date || '') ? date : null,
    physicalRecordId: identity.physicalRecordId || null,
    recordKind: identity.recordKind
  };
}

function appendCodexTitle(sessionRoot, sessionId, title, now) {
  fs.mkdirSync(sessionRoot, { recursive: true });
  const indexPath = path.join(sessionRoot, 'session_index.jsonl');
  const line = `${JSON.stringify({
    id: String(sessionId),
    thread_name: title,
    updated_at: new Date(now).toISOString()
  })}\n`;
  if (codexTitleEntryExists(indexPath, sessionId, title)) return false;
  const fd = fs.openSync(indexPath, 'a+', 0o600);
  const originalSize = fs.fstatSync(fd).size;
  try {
    fs.writeSync(fd, line, null, 'utf8');
    fs.fsyncSync(fd);
    return true;
  } catch (error) {
    try {
      fs.ftruncateSync(fd, originalSize);
      fs.fsyncSync(fd);
    } catch (_rollbackError) { /* native files are still rolled back by the caller */ }
    throw error;
  } finally {
    fs.closeSync(fd);
  }
}

function codexTitleEntryExists(indexPath, sessionId, title) {
  if (!fs.existsSync(indexPath)) return false;
  let fd;
  try {
    fd = fs.openSync(indexPath, 'r');
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, 512 * 1024);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split(/\r?\n/);
    if (size > length) lines.shift();
    return lines.some((line) => {
      if (!line.trim()) return false;
      try {
        const entry = JSON.parse(line);
        return String(entry.id || '') === String(sessionId) && entry.thread_name === title;
      } catch (_error) {
        return false;
      }
    });
  } catch (_error) {
    return false;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_error) { /* best effort */ }
  }
}

function importedConversationTitle(manifest) {
  const source = manifest.source || {};
  const sourceLabel = ([source.senderLabel, source.agentName].filter(Boolean).join(' / ') || 'Agent').slice(0, 180);
  const suffix = ` · 来自「${sourceLabel}」`;
  const original = String(manifest.session?.originalTitle || '已交接会话').trim();
  return `${original.slice(0, Math.max(1, 240 - suffix.length))}${suffix}`;
}

function collisionSafeRecordPath(directory, originalName, physicalRecordId, reserved) {
  const original = path.join(directory, originalName);
  if (!reserved.has(path.resolve(original))) return original;
  const extension = '.jsonl';
  const stem = originalName.slice(0, -extension.length);
  const identitySuffix = String(physicalRecordId || '')
    .replace(/[^A-Za-z0-9-]/g, '')
    .slice(0, 48);
  let index = 1;
  while (index <= 10_000) {
    const suffix = identitySuffix ? `-${identitySuffix}${index === 1 ? '' : `-${index}`}` : `-${index + 1}`;
    const fileName = safeFileName(`${stem.slice(0, Math.max(1, 239 - extension.length - suffix.length))}${suffix}${extension}`);
    const candidate = path.join(directory, fileName);
    if (!reserved.has(path.resolve(candidate))) return candidate;
    index += 1;
  }
  throw new Error('task-package-session-file-conflict');
}

function normalizedRecordDate(value, fallback) {
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(String(value || ''))) return String(value);
  const date = new Date(fallback || Date.now());
  if (Number.isNaN(date.getTime())) return '1970/01/01';
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('/');
}

function safeFileName(value) {
  const name = path.basename(String(value || '')).normalize('NFC').replace(/[\0-\x1f\x7f<>:"/\\|?*]/g, '_');
  if (!name || name === '.' || name === '..' || !name.endsWith('.jsonl')) throw new Error('task-package-session-file-name');
  return name.slice(0, 240);
}

function requiredDirectory(value) {
  const resolved = path.resolve(String(value || ''));
  if (!path.isAbsolute(resolved) || resolved.includes('\0')) throw new Error('task-package-staging-root');
  return resolved;
}

function isWithin(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

function uuidFromFilename(filePath) {
  return path.basename(filePath).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] || null;
}

module.exports = {
  CODEX_TASK_ADAPTER_ID,
  CODEX_TASK_ADAPTER_VERSION,
  captureCodexTaskSession,
  importCodexTaskSession,
  snapshotAppendOnlyJsonl,
  validateCodexJsonl,
  importedConversationTitle,
  findCodexConversationRecords
};
