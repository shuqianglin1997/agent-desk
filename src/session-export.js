const crypto = require('node:crypto');
const fs = require('node:fs');
const { crc32 } = require('node:zlib');
const { setImmediate: yieldToMain } = require('node:timers/promises');
const { MAX_RECORD_BYTES, inlineMedia } = require('./clients/media');

const MAX_SESSION_EXPORT_BYTES = 128 * 1024 * 1024;
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





// The adapter says which record holds a session's messages and which line is a
// message (`attachments.recordFile`, `attachments.messageOf`); clients that do
// not declare it have no inline attachments.
function addInlineAttachments(client, session, add) {
  const source = client.attachments;
  const file = source?.recordFile?.(session);
  if (!file) return;

  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) return;
  if (stat.size > MAX_RECORD_BYTES) throw new Error('session-export-too-large');
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let entry;
    try { entry = JSON.parse(line); } catch (_error) { continue; }
    const message = source.messageOf(entry);
    if (!['user', 'assistant'].includes(message?.role) || !Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const media = inlineMedia(part);
      if (media) add(media, part.filename || part.title);
    }
  }
}

function collectAttachments(client, profile, session, prefix, budget) {
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
  addInlineAttachments(client, session, add);
  // Files the client produced beside the record (Codex generated images).
  client.attachments?.generated?.(profile, session, add);
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
    const files = collectAttachments(client, profile, session, `attachments/${sections.length + 1}`, budget);
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
