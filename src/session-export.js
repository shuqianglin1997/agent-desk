const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { crc32 } = require('node:zlib');
const { setImmediate: yieldToMain } = require('node:timers/promises');

const MAX_SESSION_EXPORT_BYTES = 128 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const MAX_RECORD_BYTES = 64 * 1024 * 1024;
const MEDIA_EXTENSIONS = new Map([
  ['image/png', '.png'], ['image/jpeg', '.jpg'], ['image/webp', '.webp'], ['image/gif', '.gif'],
  ['application/pdf', '.pdf'], ['text/plain', '.txt']
]);

function safeName(value, fallback) {
  const name = String(value || '').replace(/\\/g, '/').split('/').at(-1)
    .replace(/[<>:"|?*\x00-\x1f\u202a-\u202e\u2066-\u2069]/g, '_')
    .replace(/^[. ]+|[. ]+$/g, '').slice(0, 100).replace(/[. ]+$/g, '');
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) return fallback;
  return name;
}

function readBase64(value, mime = '') {
  if (typeof value !== 'string' || !value) return null;
  const uri = /^data:([\w.+-]+\/[\w.+-]+);base64,/i.exec(value);
  const encoded = uri ? value.slice(uri[0].length) : value;
  if (!encoded) return null;
  if (encoded.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4) throw new Error('session-export-too-large');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) return null;
  const data = Buffer.from(encoded, 'base64');
  if (data.length > MAX_ATTACHMENT_BYTES) throw new Error('session-export-too-large');
  if (!data.length) return null;
  return { data, mime: String(uri?.[1] || mime).toLowerCase() };
}

function inlineMedia(part) {
  if (part?.type === 'input_image' || part?.type === 'image_url' || part?.type === 'image') {
    const value = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
    if (typeof value === 'string' && value.startsWith('data:')) return readBase64(value);
    if (part.source?.type === 'base64') return readBase64(part.source.data, part.source.media_type || '');
  }
  if (part?.type === 'input_file' && typeof part.file_data === 'string') {
    return readBase64(part.file_data);
  }
  if (part?.type === 'document' && part.source?.type === 'base64') {
    return readBase64(part.source.data, part.source.media_type || '');
  }
  return null;
}

function readOwnedImage(root, file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return null;
  try {
    const home = fs.realpathSync.native(root);
    const real = fs.realpathSync.native(file);
    const relative = path.relative(home, real);
    if (path.isAbsolute(relative) || !['generated_images', 'visualizations'].includes(relative.split(path.sep)[0])) return null;
    const stat = fs.statSync(real);
    if (!stat.isFile() || stat.size === 0) return null;
    if (stat.size > MAX_ATTACHMENT_BYTES) throw new Error('session-export-too-large');
    return { data: fs.readFileSync(real), filename: path.basename(real) };
  } catch (error) {
    if (error.message === 'session-export-too-large') throw error;
    return null;
  }
}

function addCodexGeneratedImages(profile, session, add) {
  const database = path.join(profile.sessionRoot, 'thread_history_1.sqlite');
  if (!fs.existsSync(database)) return;
  let db;
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(database, { readOnly: true });
    const query = db.prepare(`
      SELECT CASE WHEN length(CAST(item_json AS BLOB)) <= ? THEN item_json END AS item_json
      FROM thread_items WHERE thread_id IN (?, ?) AND item_type = 'imageGeneration'
      ORDER BY turn_id, item_id
    `);
    for (const row of query.iterate(MAX_RECORD_BYTES, session.id, session.physicalRecordId || session.id)) {
      if (row.item_json === null) throw new Error('session-export-too-large');
      let item;
      try { item = JSON.parse(row.item_json); } catch (_error) { continue; }
      if (item?.status !== 'completed') continue;
      const image = readOwnedImage(profile.sessionRoot, item.savedPath) || readBase64(item.result, 'image/png');
      if (image) add(image, image.filename);
    }
  } catch (error) {
    if (error.message === 'session-export-too-large') throw error;
    // Older Codex versions may have no compatible image table.
  } finally {
    db?.close();
  }
}

function addInlineAttachments(profile, session, add) {
  let file = session.filePath;
  if (!file) return;
  const kimi = profile.appId === 'kimi' || profile.appId === 'kimi-work';
  if (kimi) {
    if (path.basename(file) !== 'state.json') return;
    file = path.join(path.dirname(file), 'agents', 'main', 'wire.jsonl');
  } else if (profile.appId !== 'codex' && profile.appId !== 'claude-cli') return;

  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) return;
  if (stat.size > MAX_RECORD_BYTES) throw new Error('session-export-too-large');
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch (_error) { continue; }
    let message;
    if (profile.appId === 'codex' && entry?.type === 'response_item' && entry.payload?.type === 'message') message = entry.payload;
    else if (profile.appId === 'claude-cli' && ['user', 'assistant'].includes(entry?.type)) message = entry.message;
    else if (kimi && entry?.type === 'context.append_message') message = entry.message;
    if (!['user', 'assistant'].includes(message?.role) || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const media = inlineMedia(part);
      if (media) add(media, part.filename || part.title);
    }
  }
}

function collectAttachments(profile, session, prefix, budget) {
  const entries = [];
  const hashes = new Set();
  function add(media, name) {
    const hash = crypto.createHash('sha256').update(media.data).digest('hex');
    if (hashes.has(hash)) return;
    budget(media.data.length);
    hashes.add(hash);
    const extension = MEDIA_EXTENSIONS.get(media.mime) || '.bin';
    const label = safeName(name, `attachment${extension}`);
    entries.push({ name: `${prefix}/${entries.length + 1}-${label}`, data: media.data, label });
  }
  addInlineAttachments(profile, session, add);
  if (profile.appId === 'codex') addCodexGeneratedImages(profile, session, add);
  return entries;
}

async function prepareSessionExport(records, options = {}) {
  let totalBytes = 0;
  function budget(size) {
    totalBytes += size;
    if (totalBytes > MAX_SESSION_EXPORT_BYTES) throw new Error('session-export-too-large');
  }
  const sections = [];
  const attachments = [];
  let firstName = '';
  for (const { profile, session, client } of records) {
    await yieldToMain();
    const result = client.exportTranscript(session);
    const title = String(session.title || session.id).replace(/[\r\n]/g, ' ').trim();
    if (!firstName) firstName = safeName(result.suggestedName, 'session.md').replace(/\.md$/i, '');
    const files = collectAttachments(profile, session, `attachments/${sections.length + 1}`, budget);
    let section = result.markdown.trim();
    if (!/^#\s/.test(section)) section = `# ${title}\n\n${section}`;
    if (files.length) {
      const links = files.map((file) => {
        const label = file.label.replace(/[\[\]\\]/g, '\\$&');
        return `- [${label}](<${file.name.split('/').map(encodeURIComponent).join('/')}>)`;
      });
      section += `\n\n### ${options.attachmentsHeading || 'Attachments'}\n\n${links.join('\n')}`;
    }
    budget(Buffer.byteLength(section) + 7);
    sections.push(section);
    attachments.push(...files);
  }
  const markdown = sections.join('\n\n---\n\n') + '\n';
  const basename = records.length === 1 ? firstName : (options.batchName || 'sessions');
  return {
    suggestedName: `${basename}.${attachments.length ? 'zip' : 'md'}`,
    format: attachments.length ? 'zip' : 'md',
    attachmentCount: attachments.length,
    data: attachments.length ? makeZip([{ name: `${basename}.md`, data: Buffer.from(markdown) }, ...attachments]) : markdown
  };
}

function makeZip(entries) {
  if (entries.length > 0xffff) throw new Error('session-export-too-large');
  const files = [];
  const directory = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = entry.data;
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names, stored payload.
    local.writeUInt16LE(0x21, 12); // 1980-01-01.
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    local.copy(central, 6, 4, 30);
    central.writeUInt32LE(offset, 42);
    files.push(local, name, data);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.reduce((sum, value) => sum + value.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...files, ...directory, end]);
}

module.exports = { prepareSessionExport };
