'use strict';

// Images Codex generated in a conversation: rows of thread_history_1.sqlite
// (read-only), with the file under the home's generated_images/ or
// visualizations/ when it is still there, otherwise the stored base64.

const fs = require('node:fs');
const path = require('node:path');
const { MAX_ATTACHMENT_BYTES, MAX_RECORD_BYTES, readBase64 } = require('../media');

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

function addGeneratedImages(profile, session, add) {
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

module.exports = { addGeneratedImages };
