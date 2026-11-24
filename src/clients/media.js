'use strict';

// Attachments carried inside session records: base64 data, data: URLs and the
// image/file/document parts several clients use, decoded with fixed limits.
// Nothing here names a client.

const MAX_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const MAX_RECORD_BYTES = 64 * 1024 * 1024;

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

module.exports = { MAX_ATTACHMENT_BYTES, MAX_RECORD_BYTES, readBase64, inlineMedia };
